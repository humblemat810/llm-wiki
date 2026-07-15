import { FEEDBACK_FORMAT, GRAPH_SCHEMA, MAX_ALIASES, MAX_DOCUMENT_CHARS, MAX_DOCUMENT_TITLE_CHARS, MAX_FEEDBACK_EXAMPLES, MAX_FEEDBACK_LABEL_CHARS, MAX_ID_CHARS, normalizeExtractionForDocument, normalizeSourceUri, parseJsonWithUniqueKeys, relationSemanticKey, slugify } from "./graph-core.js";

export const MAX_FEEDBACK_CHARS = 500000;
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_RETRIES = 1;
export const DEFAULT_RETRY_DELAY_MS = 250;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
export const retryBackoffDelay = (retryDelay, attemptNumber) => Math.min(
  5000,
  Math.max(0, Number(retryDelay) || 0) * (2 ** Math.max(0, Math.floor(Number(attemptNumber) || 0) - 1))
);
const FEEDBACK_HINT_KEYS = new Set([
  "kind",
  "id",
  "label",
  "aliases",
  "source",
  "sourceLabel",
  "target",
  "targetLabel",
  "status"
]);
const DOCUMENT_KEYS = new Set(["title", "uri", "text"]);

export class ExtractorAdapterError extends Error {
  constructor(message, { code = "EXTRACTOR_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "ExtractorAdapterError";
    this.code = code;
  }
}

function compactFeedbackHint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !FEEDBACK_HINT_KEYS.has(key))) return null;
  if (!["concept", "relation"].includes(value.kind) || !["accepted", "rejected"].includes(value.status)) return null;
  if (typeof value.id !== "string" || !value.id.trim() || value.id.length > MAX_ID_CHARS) return null;
  for (const key of ["label", "sourceLabel", "targetLabel"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > MAX_FEEDBACK_LABEL_CHARS)) return null;
  }
  for (const key of ["source", "target"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > MAX_ID_CHARS)) return null;
  }
  if (value.aliases !== undefined && (
    !Array.isArray(value.aliases)
    || value.aliases.length > MAX_ALIASES
    || new Set(value.aliases).size !== value.aliases.length
    || value.aliases.some((alias) => typeof alias !== "string" || alias.length > MAX_FEEDBACK_LABEL_CHARS)
  )) return null;
  const compact = {
    kind: value.kind,
    id: value.id,
    status: value.status
  };
  for (const key of ["label", "source", "sourceLabel", "target", "targetLabel"]) {
    if (typeof value[key] === "string") compact[key] = value[key];
  }
  if (Array.isArray(value.aliases)) compact.aliases = [...value.aliases];
  return compact;
}

function boundFeedback(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ExtractorAdapterError("Reviewed feedback must be an array.", { code: "INVALID_FEEDBACK" });
  }
  if (value.length > MAX_FEEDBACK_EXAMPLES) {
    throw new ExtractorAdapterError(`Reviewed feedback exceeds the ${MAX_FEEDBACK_EXAMPLES} example limit.`, { code: "FEEDBACK_TOO_LARGE" });
  }
  const output = [];
  const statuses = new Map();
  let size = 2;
  for (const rawItem of value) {
    const item = compactFeedbackHint(rawItem);
    if (!item) {
      throw new ExtractorAdapterError("Reviewed feedback contains an invalid hint.", { code: "INVALID_FEEDBACK" });
    }
    const keys = item.kind === "concept"
      ? [`concept|${item.id}`]
      : [
        `relation-id|${item.id}`,
        `relation-semantic|${relationSemanticKey(
          slugify(item.sourceLabel || item.source),
          slugify(item.targetLabel || item.target),
          item.label
        )}`
      ];
    if (keys.some((key) => statuses.has(key) && statuses.get(key) !== item.status)) {
      throw new ExtractorAdapterError("Reviewed feedback contains contradictory decisions for the same concept or relation.", { code: "CONTRADICTORY_FEEDBACK" });
    }
    keys.forEach((key) => statuses.set(key, item.status));
    let serialized;
    try {
      serialized = JSON.stringify(item);
    } catch {
      continue;
    }
    if (!serialized) continue;
    if (size + serialized.length + (output.length ? 1 : 0) > MAX_FEEDBACK_CHARS) {
      throw new ExtractorAdapterError(`Reviewed feedback exceeds the ${MAX_FEEDBACK_CHARS.toLocaleString("en-US")} character limit.`, { code: "FEEDBACK_TOO_LARGE" });
    }
    output.push(item);
    size += serialized.length + (output.length ? 1 : 0);
  }
  return output;
}

function validateEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ExtractorAdapterError("Extractor endpoint must be a valid URL.", { code: "INVALID_ENDPOINT" });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ExtractorAdapterError("Extractor endpoint must use HTTP or HTTPS.", { code: "INVALID_ENDPOINT" });
  }
  if (url.username || url.password) {
    throw new ExtractorAdapterError("Extractor endpoint must not contain embedded credentials.", { code: "INVALID_ENDPOINT" });
  }
  return url.toString();
}

function responseTooLarge() {
  return new ExtractorAdapterError("Extractor response exceeds the 10 MB safety limit.", { code: "RESPONSE_TOO_LARGE" });
}

function responseLengthMismatch() {
  return new ExtractorAdapterError("Extractor response byte length does not match Content-Length.", { code: "INVALID_RESPONSE" });
}

function invalidResponseLength() {
  return new ExtractorAdapterError("Extractor response Content-Length is invalid.", { code: "INVALID_RESPONSE" });
}

function asByteView(value) {
  if (!ArrayBuffer.isView(value)
    || !Number.isSafeInteger(value.byteLength)
    || value.byteLength < 0
    || !Number.isSafeInteger(value.byteOffset)
    || value.byteOffset < 0) return null;
  try {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } catch {
    return null;
  }
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function cancelResponseBody(response) {
  try {
    const cancellation = response?.body?.cancel?.();
    Promise.resolve(cancellation).catch(() => {});
  } catch {
    // A non-conforming response body must not suppress cancellation
    // classification or timeout handling.
  }
  return Promise.resolve();
}

async function readBoundedResponse(response, signal) {
  const declaredHeader = response.headers?.get?.("content-length");
  const normalizedDeclaredHeader = typeof declaredHeader === "string" ? declaredHeader.trim() : "";
  const declaredLength = /^\d+$/.test(normalizedDeclaredHeader)
    ? Number(normalizedDeclaredHeader)
    : Number.NaN;
  if (normalizedDeclaredHeader && (!Number.isSafeInteger(declaredLength))) {
    await cancelResponseBody(response);
    throw invalidResponseLength();
  }
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await cancelResponseBody(response);
    throw responseTooLarge();
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    const abortReader = () => {
      try {
        Promise.resolve(reader.cancel?.()).catch(() => {});
      } catch {
        // A non-conforming reader must not turn cancellation into an
        // unhandled rejection.
      }
    };
    if (signal?.aborted) abortReader();
    signal?.addEventListener?.("abort", abortReader, { once: true });
    const cancelReader = () => {
      try {
        Promise.resolve(reader.cancel?.()).catch(() => {});
      } catch {
        // A non-conforming reader must not suppress the size failure.
      }
    };
    let pendingReadSettled = true;
    try {
      const readChunk = () => {
        pendingReadSettled = false;
        const readPromise = Promise.resolve()
          .then(() => reader.read())
          .then(
            (result) => {
              pendingReadSettled = true;
              return result;
            },
            (error) => {
              pendingReadSettled = true;
              throw error;
            }
          );
        if (!signal) return readPromise;
        let readAbortHandler;
        const readAbortPromise = new Promise((_, reject) => {
          readAbortHandler = () => reject(Object.assign(new Error("Extractor response reading was aborted."), { name: "AbortError" }));
          if (signal.aborted) readAbortHandler();
          else signal.addEventListener("abort", readAbortHandler, { once: true });
        });
        return Promise.race([readPromise, readAbortPromise]).finally(() => {
          signal.removeEventListener("abort", readAbortHandler);
        });
      };
      while (true) {
        if (signal?.aborted) throw Object.assign(new Error("Extractor response reading was aborted."), { name: "AbortError" });
        const result = await readChunk();
        if (signal?.aborted) throw Object.assign(new Error("Extractor response reading was aborted."), { name: "AbortError" });
        if (!result
          || typeof result !== "object"
          || typeof result.done !== "boolean"
          || (result.done && result.value !== undefined)) {
          cancelReader();
          throw new ExtractorAdapterError("Extractor response contains an invalid stream result.", { code: "INVALID_RESPONSE" });
        }
        if (result.done) break;
        const chunk = asByteView(result.value);
        if (!chunk) {
          cancelReader();
          throw new ExtractorAdapterError("Extractor response contains an invalid byte chunk.", { code: "INVALID_RESPONSE" });
        }
        size += chunk.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          cancelReader();
          throw responseTooLarge();
        }
        chunks.push(chunk);
      }
    } finally {
      signal?.removeEventListener?.("abort", abortReader);
      // A non-conforming reader may ignore cancel() and leave read() pending.
      // Releasing that lock would throw and obscure the timeout/cancellation.
      // Standard readers settle the read before this path completes.
      if (pendingReadSettled) reader.releaseLock?.();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    chunks.forEach((chunk) => {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    });
    if (Number.isFinite(declaredLength) && size !== declaredLength) throw responseLengthMismatch();
    return parseJsonWithUniqueKeys(new TextDecoder("utf-8", { fatal: true }).decode(bytes), "Extractor response");
  }
  if (!Number.isFinite(declaredLength)) {
    throw responseTooLarge();
  }
  if (typeof response.arrayBuffer === "function") {
    let abortHandler;
    const abortPromise = signal
      ? new Promise((_, reject) => {
        abortHandler = () => {
          void cancelResponseBody(response);
          reject(Object.assign(new Error("Extractor response reading was aborted."), { name: "AbortError" }));
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      })
      : null;
    try {
        const rawBytes = abortPromise
        ? await Promise.race([response.arrayBuffer(), abortPromise])
        : await response.arrayBuffer();
      const bytes = rawBytes instanceof ArrayBuffer
        ? new Uint8Array(rawBytes)
        : asByteView(rawBytes);
      if (!bytes) {
        throw new ExtractorAdapterError("Extractor response does not contain byte data.", { code: "INVALID_RESPONSE" });
      }
      if (!Number.isSafeInteger(bytes.byteLength) || bytes.byteLength < 0) {
        throw new ExtractorAdapterError("Extractor response contains an invalid byte length.", { code: "INVALID_RESPONSE" });
      }
      if (bytes.byteLength > MAX_RESPONSE_BYTES) throw responseTooLarge();
      if (Number.isFinite(declaredLength) && bytes.byteLength !== declaredLength) throw responseLengthMismatch();
      return parseJsonWithUniqueKeys(new TextDecoder("utf-8", { fatal: true }).decode(bytes), "Extractor response");
    } finally {
      if (abortHandler) signal.removeEventListener("abort", abortHandler);
    }
  }
  throw new ExtractorAdapterError("Extractor response does not expose raw bytes for safe decoding.", { code: "INVALID_RESPONSE" });
}

export function createRemoteExtractor({
  endpoint,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  headers = {}
} = {}) {
  const url = validateEndpoint(endpoint);
  if (typeof fetchImpl !== "function") {
    throw new ExtractorAdapterError("A fetch implementation is required.", { code: "NO_FETCH" });
  }
  if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) < 100 || Number(timeoutMs) > 120000) {
    throw new ExtractorAdapterError("Extractor timeout must be between 100 ms and 120 seconds.", { code: "INVALID_TIMEOUT" });
  }
  if (!Number.isSafeInteger(Number(maxRetries)) || Number(maxRetries) < 0 || Number(maxRetries) > 3) {
    throw new ExtractorAdapterError("Extractor retries must be between 0 and 3.", { code: "INVALID_RETRIES" });
  }
  if (!Number.isSafeInteger(Number(retryDelayMs)) || Number(retryDelayMs) < 0 || Number(retryDelayMs) > 5000) {
    throw new ExtractorAdapterError("Extractor retry delay must be between 0 and 5000 ms.", { code: "INVALID_RETRY_DELAY" });
  }
  const requestTimeoutMs = Number(timeoutMs);
  const retryCount = Number(maxRetries);
  const retryDelay = Number(retryDelayMs);
  return async function extract(document, { feedback = [], signal } = {}) {
    if (!document || typeof document !== "object" || Array.isArray(document)
      || Object.keys(document).some((key) => !DOCUMENT_KEYS.has(key))) {
      throw new ExtractorAdapterError("Document contains fields outside the closed request contract.", { code: "INVALID_DOCUMENT" });
    }
    const rawTitle = document?.title;
    if (rawTitle !== undefined && rawTitle !== null && (typeof rawTitle !== "string" || rawTitle.trim().length > MAX_DOCUMENT_TITLE_CHARS)) {
      throw new ExtractorAdapterError(`Document title must be a string no longer than ${MAX_DOCUMENT_TITLE_CHARS} characters.`, { code: "INVALID_DOCUMENT" });
    }
    const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : "Untitled document";
    const text = typeof document?.text === "string" ? document.text.trim() : "";
    const rawUri = document?.uri;
    const uri = typeof rawUri === "string" && rawUri.trim() ? normalizeSourceUri(rawUri) : "";
    if (rawUri !== undefined && rawUri !== null
      && (typeof rawUri !== "string" || (rawUri.trim() && !uri))) {
      throw new ExtractorAdapterError("Source URI is invalid or exceeds the 2,048 character limit.", { code: "INVALID_DOCUMENT" });
    }
    if (text.length < 40) throw new ExtractorAdapterError("Documents must contain at least 40 characters.", { code: "INVALID_DOCUMENT" });
    if (text.length > MAX_DOCUMENT_CHARS) throw new ExtractorAdapterError("Document exceeds the local extraction size limit.", { code: "DOCUMENT_TOO_LARGE" });
    if (signal?.aborted) throw new ExtractorAdapterError("Extractor request was canceled.", { code: "CANCELED" });
    const controller = new AbortController();
    let rejectExternalAbort;
    const externalAbortPromise = signal
      ? new Promise((_, reject) => {
        rejectExternalAbort = reject;
      })
      : null;
    const abortExternal = () => {
      controller.abort();
      rejectExternalAbort?.(new ExtractorAdapterError("Extractor request was canceled.", { code: "CANCELED" }));
    };
    signal?.addEventListener?.("abort", abortExternal, { once: true });
    if (signal?.aborted) abortExternal();
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error("Extractor request timed out."), { name: "AbortError" }));
      }, requestTimeoutMs);
    });
    const waitBeforeRetry = (response, attemptNumber) => new Promise((resolve, reject) => {
      const retryAfterHeader = response?.headers?.get?.("retry-after");
      const retryAfterSeconds = typeof retryAfterHeader === "string" ? Number(retryAfterHeader) : Number.NaN;
      const retryAfterDate = typeof retryAfterHeader === "string" ? Date.parse(retryAfterHeader) : Number.NaN;
      const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
        ? retryAfterSeconds * 1000
        : Number.isFinite(retryAfterDate)
          ? Math.max(0, retryAfterDate - Date.now())
          : Number.NaN;
      const exponentialDelay = retryBackoffDelay(retryDelay, attemptNumber);
      const delay = Number.isFinite(retryAfterMs)
        ? Math.min(5000, retryAfterMs)
        : exponentialDelay;
      let timer;
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", abort);
        controller.signal.removeEventListener("abort", abort);
        reject(Object.assign(new Error("Extractor request was aborted."), { name: "AbortError" }));
      };
      const finish = () => {
        signal?.removeEventListener?.("abort", abort);
        controller.signal.removeEventListener("abort", abort);
        resolve();
      };
      timer = setTimeout(finish, delay);
      signal?.addEventListener?.("abort", abort, { once: true });
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const requestBody = JSON.stringify({
        operation: "extract-graph",
        schema: GRAPH_SCHEMA,
        feedbackFormat: FEEDBACK_FORMAT,
        document: { title, text, ...(uri ? { uri } : {}) },
        feedback: boundFeedback(feedback)
      });
      if (byteLength(requestBody) > MAX_REQUEST_BYTES) {
        throw new ExtractorAdapterError("Extractor request exceeds the 2 MB safety limit.", { code: "REQUEST_TOO_LARGE" });
      }
      let response;
      let attempt = 0;
      while (true) {
        try {
          const fetchAttempt = Promise.resolve().then(() => fetchImpl(url, {
              method: "POST",
              credentials: "same-origin",
              headers: { ...headers, "content-type": "application/json", accept: "application/json" },
              body: requestBody,
              signal: controller.signal
            })).then((candidate) => {
              if (!candidate || typeof candidate !== "object" || typeof candidate.ok !== "boolean"
                || !Number.isInteger(Number(candidate.status)) || Number(candidate.status) < 100 || Number(candidate.status) > 599) {
                throw new ExtractorAdapterError("Extractor returned an invalid response object.", { code: "INVALID_RESPONSE" });
              }
              if (controller.signal.aborted) void cancelResponseBody(candidate);
              return candidate;
            });
          response = await Promise.race([
            fetchAttempt,
            timeoutPromise,
            ...(externalAbortPromise ? [externalAbortPromise] : [])
          ]);
        } catch (error) {
          if (signal?.aborted || controller.signal.aborted || attempt >= retryCount || error?.code === "INVALID_RESPONSE") throw error;
          attempt += 1;
          await waitBeforeRetry(null, attempt);
          continue;
        }
        if (response.ok || !RETRYABLE_STATUSES.has(Number(response.status)) || attempt >= retryCount) break;
        await cancelResponseBody(response);
        attempt += 1;
        await waitBeforeRetry(response, attempt);
      }
      if (signal?.aborted) {
        await cancelResponseBody(response);
        throw new ExtractorAdapterError("Extractor request was canceled.", { code: "CANCELED" });
      }
      if (controller.signal.aborted) {
        await cancelResponseBody(response);
        throw new ExtractorAdapterError("Extractor request timed out.", { code: "TIMEOUT" });
      }
      if (!response.ok) {
        await cancelResponseBody(response);
        const requestId = response.headers?.get?.("x-request-id");
        throw new ExtractorAdapterError(`Extractor returned HTTP ${response.status}.${requestId ? ` Request ID: ${requestId}.` : ""}`, { code: "REMOTE_ERROR" });
      }
      const responseContentType = response.headers?.get?.("content-type");
      const responseMediaType = responseContentType?.split(";", 1)[0].trim().toLowerCase();
      if (responseMediaType !== "application/json") {
        await cancelResponseBody(response);
        throw new ExtractorAdapterError("Extractor returned a non-JSON response.", { code: "INVALID_RESPONSE" });
      }
      let payload;
      try {
        payload = await readBoundedResponse(response, controller.signal);
      } catch (cause) {
        if (signal?.aborted) {
          throw new ExtractorAdapterError("Extractor request was canceled.", { code: "CANCELED", cause });
        }
        if (controller.signal.aborted) {
          throw new ExtractorAdapterError("Extractor request timed out.", { code: "TIMEOUT", cause });
        }
        if (cause instanceof ExtractorAdapterError) throw cause;
        throw new ExtractorAdapterError("Extractor returned invalid JSON.", { code: "INVALID_RESPONSE", cause });
      }
      if (signal?.aborted) {
        throw new ExtractorAdapterError("Extractor request was canceled.", { code: "CANCELED" });
      }
      if (controller.signal.aborted) {
        throw new ExtractorAdapterError("Extractor request timed out.", { code: "TIMEOUT" });
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new ExtractorAdapterError("Extractor returned an invalid response shape.", { code: "INVALID_RESPONSE" });
      }
      if (payload.schema !== undefined && payload.schema !== GRAPH_SCHEMA) {
        throw new ExtractorAdapterError("Extractor returned an incompatible graph schema.", { code: "INVALID_RESPONSE" });
      }
      if (payload.feedbackFormat !== undefined && payload.feedbackFormat !== FEEDBACK_FORMAT) {
        throw new ExtractorAdapterError("Extractor returned an incompatible feedback format.", { code: "INVALID_RESPONSE" });
      }
      const extraction = payload.extraction === undefined ? payload : payload.extraction;
      if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) {
        throw new ExtractorAdapterError("Extractor returned an invalid extraction shape.", { code: "INVALID_RESPONSE" });
      }
      if (extraction.schema !== undefined && extraction.schema !== GRAPH_SCHEMA) {
        throw new ExtractorAdapterError("Extractor returned an incompatible extraction graph schema.", { code: "INVALID_RESPONSE" });
      }
      try {
        return normalizeExtractionForDocument(extraction, { title, text, uri, feedback });
      } catch (cause) {
        if ([
          "EXTRACTION_NODES_TOO_LARGE",
          "EXTRACTION_EDGES_TOO_LARGE",
          "EXTRACTION_NODES_SHAPE",
          "EXTRACTION_EDGES_SHAPE",
          "EXTRACTION_ALIASES_TOO_LARGE",
          "EXTRACTION_PROVENANCE_SHAPE",
          "EXTRACTION_EVIDENCE_TOO_LARGE",
          "EXTRACTION_SOURCES_TOO_LARGE",
          "EXTRACTION_EVIDENCE_TEXT_TOO_LARGE",
          "EXTRACTION_EVIDENCE_SOURCES_TOO_LARGE"
        ].includes(cause?.code)) {
          throw new ExtractorAdapterError(cause.message, { code: "INVALID_RESPONSE", cause });
        }
        throw cause;
      }
    } catch (error) {
      if (error instanceof ExtractorAdapterError) throw error;
      if (signal?.aborted) throw new ExtractorAdapterError("Extractor request was canceled.", { code: "CANCELED", cause: error });
      if (error?.name === "AbortError") throw new ExtractorAdapterError("Extractor request timed out.", { code: "TIMEOUT", cause: error });
      throw new ExtractorAdapterError("Extractor request failed.", { code: "NETWORK_ERROR", cause: error });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener?.("abort", abortExternal);
    }
  };
}
