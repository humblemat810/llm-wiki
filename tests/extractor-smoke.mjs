import assert from "node:assert/strict";
import { createRemoteExtractor, ExtractorAdapterError } from "../extractor-adapter.js";

const calls = [];
const extractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/v1/graph",
  timeoutMs: 1000,
  fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        nodes: [{ label: "Attention" }, { label: "Context" }],
        edges: [{ source: "Attention", target: "Context", label: "uses" }]
      })
    };
  }
});
const result = await extractor(
  { title: "Adapter test", text: "Attention uses context to make a useful knowledge representation." },
  { feedback: Array.from({ length: 600 }, (_, index) => ({ id: `feedback-${index}` })) }
);
assert.equal(result.source.title, "Adapter test");
assert.equal(result.nodes[0].id, "attention");
assert.equal(result.edges[0].source, "attention");
assert.equal(calls[0].options.method, "POST");
assert.equal(JSON.parse(calls[0].options.body).operation, "extract-graph");
assert.equal(JSON.parse(calls[0].options.body).feedbackFormat, "llm-field-notes/feedback@1");
assert.equal(JSON.parse(calls[0].options.body).feedback.length, 500, "remote feedback context should be bounded");
const hugeFeedbackExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/huge-feedback",
  fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ nodes: [], edges: [] })
    };
  }
});
await hugeFeedbackExtractor(
  { title: "Bounded feedback", text: "This document is long enough to exercise feedback payload bounds." },
  { feedback: [{ evidence: [{ text: "x".repeat(600000) }] }, { id: "small" }] }
);
const hugeBody = JSON.parse(calls.at(-1).options.body);
assert(hugeBody.feedback.length <= 1, "oversized feedback payloads should be bounded by serialized size");

assert.throws(
  () => createRemoteExtractor({ endpoint: "file:///tmp/extractor" }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_ENDPOINT"
);
assert.throws(
  () => createRemoteExtractor({ endpoint: "https://extractor.example.test", timeoutMs: 99 }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_TIMEOUT"
);
await assert.rejects(
  () => extractor({ title: "Too short", text: "short" }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_DOCUMENT"
);
const malformedResponseExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/malformed",
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] })
});
await assert.rejects(
  () => malformedResponseExtractor({ title: "Malformed", text: "This document is long enough to exercise response validation." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RESPONSE"
);
const incompatibleSchemaExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/schema",
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ schema: "llm-field-notes/graph@999" }) })
});
await assert.rejects(
  () => incompatibleSchemaExtractor({ title: "Schema", text: "This document is long enough to exercise schema validation." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RESPONSE"
);
const timeoutExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/timeout",
  fetchImpl: async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }
});
await assert.rejects(
  () => timeoutExtractor({ title: "Timeout", text: "This document is long enough to exercise timeout handling." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "TIMEOUT"
);
const remoteErrorExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/error",
  fetchImpl: async () => ({
    ok: false,
    status: 503,
    headers: { get: (name) => name === "x-request-id" ? "request-123" : null }
  })
});
await assert.rejects(
  () => remoteErrorExtractor({ title: "Remote error", text: "This document is long enough to exercise request diagnostics." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "REMOTE_ERROR" && error.message.includes("request-123")
);
const canceledController = new AbortController();
canceledController.abort();
await assert.rejects(
  () => extractor({ title: "Canceled", text: "This document is long enough to exercise cancellation handling." }, { signal: canceledController.signal }),
  (error) => error instanceof ExtractorAdapterError && error.code === "CANCELED"
);
const inFlightExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/in-flight",
  fetchImpl: async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  })
});
const inFlightController = new AbortController();
const inFlightRequest = inFlightExtractor(
  { title: "In flight", text: "This document is long enough to exercise in-flight cancellation." },
  { signal: inFlightController.signal }
);
inFlightController.abort();
await assert.rejects(
  () => inFlightRequest,
  (error) => error instanceof ExtractorAdapterError && error.code === "CANCELED"
);

console.log("extractor adapter smoke ok");
