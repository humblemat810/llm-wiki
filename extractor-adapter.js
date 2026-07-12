import { MAX_DOCUMENT_CHARS, normalizeExtraction } from "./graph-core.js";

export class ExtractorAdapterError extends Error {
  constructor(message, { code = "EXTRACTOR_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "ExtractorAdapterError";
    this.code = code;
  }
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
  return url.toString();
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
  return async function extract(document) {
    const title = typeof document?.title === "string" && document.title.trim() ? document.title.trim() : "Untitled document";
    const text = typeof document?.text === "string" ? document.text.trim() : "";
    if (text.length < 40) throw new ExtractorAdapterError("Documents must contain at least 40 characters.", { code: "INVALID_DOCUMENT" });
    if (text.length > MAX_DOCUMENT_CHARS) throw new ExtractorAdapterError("Document exceeds the local extraction size limit.", { code: "DOCUMENT_TOO_LARGE" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...headers },
        body: JSON.stringify({
          operation: "extract-graph",
          schema: "llm-field-notes/graph@1",
          document: { title, text }
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new ExtractorAdapterError(`Extractor returned HTTP ${response.status}.`, { code: "REMOTE_ERROR" });
      let payload;
      try {
        payload = await response.json();
      } catch (cause) {
        throw new ExtractorAdapterError("Extractor returned invalid JSON.", { code: "INVALID_RESPONSE", cause });
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new ExtractorAdapterError("Extractor returned an invalid response shape.", { code: "INVALID_RESPONSE" });
      }
      const extraction = payload.extraction === undefined ? payload : payload.extraction;
      if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) {
        throw new ExtractorAdapterError("Extractor returned an invalid extraction shape.", { code: "INVALID_RESPONSE" });
      }
      return normalizeExtraction(extraction, title, text);
    } catch (error) {
      if (error instanceof ExtractorAdapterError) throw error;
      if (error?.name === "AbortError") throw new ExtractorAdapterError("Extractor request timed out.", { code: "TIMEOUT", cause: error });
      throw new ExtractorAdapterError("Extractor request failed.", { code: "NETWORK_ERROR", cause: error });
    } finally {
      clearTimeout(timeout);
    }
  };
}
