import { FEEDBACK_FORMAT, GRAPH_SCHEMA, MAX_DOCUMENT_CHARS, MAX_FEEDBACK_EXAMPLES, normalizeExtractionForDocument, normalizeSourceUri } from "./graph-core.js";

export const MAX_FEEDBACK_CHARS = 500000;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export class ExtractorAdapterError extends Error {
  constructor(message, { code = "EXTRACTOR_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "ExtractorAdapterError";
    this.code = code;
  }
}

function boundFeedback(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  let size = 2;
  for (const item of value.slice(0, MAX_FEEDBACK_EXAMPLES)) {
    let serialized;
    try {
      serialized = JSON.stringify(item);
    } catch {
      continue;
    }
    if (!serialized || size + serialized.length + (output.length ? 1 : 0) > MAX_FEEDBACK_CHARS) break;
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

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

async function readBoundedResponse(response) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw responseTooLarge();
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw responseTooLarge();
        }
        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    chunks.forEach((chunk) => {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const payload = await response.json();
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new ExtractorAdapterError("Extractor returned invalid JSON.", { code: "INVALID_RESPONSE" });
  }
  if (serialized && byteLength(serialized) > MAX_RESPONSE_BYTES) throw responseTooLarge();
  return payload;
}

export function createRemoteExtractor({
  endpoint,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  headers = {}
} = {}) {
  const url = validateEndpoint(endpoint);
  if (typeof fetchImpl !== "function") {
    throw new ExtractorAdapterError("A fetch implementation is required.", { code: "NO_FETCH" });
  }
  if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) < 100 || Number(timeoutMs) > 120000) {
    throw new ExtractorAdapterError("Extractor timeout must be between 100 ms and 120 seconds.", { code: "INVALID_TIMEOUT" });
  }
  const requestTimeoutMs = Number(timeoutMs);
  return async function extract(document, { feedback = [], signal } = {}) {
    const title = (typeof document?.title === "string" && document.title.trim() ? document.title.trim() : "Untitled document").slice(0, 200);
    const text = typeof document?.text === "string" ? document.text.trim() : "";
    const uri = normalizeSourceUri(document?.uri) || "";
    if (text.length < 40) throw new ExtractorAdapterError("Documents must contain at least 40 characters.", { code: "INVALID_DOCUMENT" });
    if (text.length > MAX_DOCUMENT_CHARS) throw new ExtractorAdapterError("Document exceeds the local extraction size limit.", { code: "DOCUMENT_TOO_LARGE" });
    if (signal?.aborted) throw new ExtractorAdapterError("Extractor request was canceled.", { code: "CANCELED" });
    const controller = new AbortController();
    const abortExternal = () => controller.abort();
    signal?.addEventListener?.("abort", abortExternal, { once: true });
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { ...headers, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          operation: "extract-graph",
          schema: GRAPH_SCHEMA,
          feedbackFormat: FEEDBACK_FORMAT,
          document: { title, text, ...(uri ? { uri } : {}) },
          feedback: boundFeedback(feedback)
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const requestId = response.headers?.get?.("x-request-id");
        throw new ExtractorAdapterError(`Extractor returned HTTP ${response.status}.${requestId ? ` Request ID: ${requestId}.` : ""}`, { code: "REMOTE_ERROR" });
      }
      const responseContentType = response.headers?.get?.("content-type");
      const responseMediaType = responseContentType?.split(";", 1)[0].trim().toLowerCase();
      if (responseMediaType && responseMediaType !== "application/json") {
        throw new ExtractorAdapterError("Extractor returned a non-JSON response.", { code: "INVALID_RESPONSE" });
      }
      let payload;
      try {
        payload = await readBoundedResponse(response);
      } catch (cause) {
        if (cause instanceof ExtractorAdapterError) throw cause;
        throw new ExtractorAdapterError("Extractor returned invalid JSON.", { code: "INVALID_RESPONSE", cause });
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
      return normalizeExtractionForDocument(extraction, { title, text, uri });
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
