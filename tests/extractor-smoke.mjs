import assert from "node:assert/strict";
import { createRemoteExtractor, ExtractorAdapterError, MAX_FEEDBACK_CHARS, MAX_RESPONSE_BYTES } from "../extractor-adapter.js";

const calls = [];
const extractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/v1/graph",
  timeoutMs: 1000,
  headers: { "content-type": "text/plain", accept: "text/plain", "x-trace-id": "adapter-test" },
  fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        source: {
          title: "Provider-controlled title",
          text: "provider-controlled source text",
          fingerprint: "provider-controlled-fingerprint",
          uri: "https://provider.example.test/private"
        },
        nodes: [{ label: "Attention", sources: ["provider-private-source"], evidence: [{ text: "provider evidence", sources: ["provider-private-source"] }] }, { label: "Context" }],
        edges: [{ source: "Attention", target: "Context", label: "uses", sources: ["provider-private-source"], evidence: [{ text: "provider relation evidence", sources: ["provider-private-source"] }] }]
      })
    };
  }
});
const result = await extractor(
  { title: "Adapter test", uri: "https://example.org/adapter-test", text: "Attention uses context to make a useful knowledge representation." },
  { feedback: Array.from({ length: 600 }, (_, index) => ({ id: `feedback-${index}` })) }
);
assert.equal(result.source.title, "Adapter test");
assert.equal(result.source.text, "Attention uses context to make a useful knowledge representation.", "remote extraction must preserve the submitted document text");
assert.equal(result.source.uri, "https://example.org/adapter-test");
assert.notEqual(result.source.fingerprint, "provider-controlled-fingerprint", "remote extraction must derive source fingerprints from submitted text");
assert.deepEqual(result.nodes[0].sources, [result.source.id], "remote extraction must bind node provenance to the submitted source");
assert.deepEqual(result.nodes[0].evidence[0].sources, [result.source.id], "remote extraction must bind concept evidence to the submitted source");
assert.deepEqual(result.edges[0].sources, [result.source.id], "remote extraction must bind relation provenance to the submitted source");
assert.equal(result.nodes[0].id, "attention");
assert.equal(result.edges[0].source, "attention");
const longTitle = "T".repeat(240);
await extractor({ title: longTitle, text: "Attention uses context to make a useful knowledge representation." });
assert.equal(JSON.parse(calls.at(-1).options.body).document.title.length, 200, "remote titles should match the request contract bound");
assert.equal(JSON.parse(calls[0].options.body).document.uri, "https://example.org/adapter-test", "remote source URIs should travel through the request contract");
assert.equal(calls[0].options.method, "POST");
assert.equal(calls[0].options.credentials, "same-origin", "browser extraction should carry same-origin gateway sessions without exposing tokens to the page");
assert.equal(calls[0].options.headers["content-type"], "application/json", "remote requests must preserve the JSON content type");
assert.equal(calls[0].options.headers.accept, "application/json", "remote requests must preserve the JSON accept header");
assert.equal(calls[0].options.headers["x-trace-id"], "adapter-test", "custom tracing headers should remain supported");
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
assert.equal(MAX_FEEDBACK_CHARS, 500000, "feedback request bounds should have one explicit shared contract");

assert.throws(
  () => createRemoteExtractor({ endpoint: "file:///tmp/extractor" }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_ENDPOINT"
);
assert.throws(
  () => createRemoteExtractor({ endpoint: "https://user:password@extractor.example.test" }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_ENDPOINT" && error.message.includes("embedded credentials")
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
const incompatibleFeedbackExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/feedback-format",
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ feedbackFormat: "llm-field-notes/feedback@999", extraction: { nodes: [], edges: [] } }) })
});
await assert.rejects(
  () => incompatibleFeedbackExtractor({ title: "Feedback format", text: "This document is long enough to exercise feedback format validation." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RESPONSE"
);
const mislabeledResponseExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/mislabeled",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "text/html; charset=utf-8" : null },
    json: async () => ({ nodes: [], edges: [] })
  })
});
await assert.rejects(
  () => mislabeledResponseExtractor({ title: "Mislabeled", text: "This document is long enough to exercise content type validation." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RESPONSE"
);
const jsonpResponseExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/jsonp",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "application/jsonp" : null },
    json: async () => ({ nodes: [], edges: [] })
  })
});
await assert.rejects(
  () => jsonpResponseExtractor({ title: "JSONP", text: "This document is long enough to exercise JSONP media type rejection." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RESPONSE"
);
const oversizedResponseExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/oversized",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-length" ? String(MAX_RESPONSE_BYTES + 1) : null },
    json: async () => ({ nodes: [], edges: [] })
  })
});
await assert.rejects(
  () => oversizedResponseExtractor({ title: "Oversized", text: "This document is long enough to exercise response size handling." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "RESPONSE_TOO_LARGE"
);
const unicodeOversizedResponseExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/unicode-oversized",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ nodes: [], edges: [], notes: "😀".repeat(3_000_000) })
  })
});
await assert.rejects(
  () => unicodeOversizedResponseExtractor({ title: "Unicode oversized", text: "This document is long enough to exercise byte-accurate response size handling." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "RESPONSE_TOO_LARGE"
);
const streamedOversizedResponseExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/streamed-oversized",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1));
        controller.close();
      }
    })
  })
});
await assert.rejects(
  () => streamedOversizedResponseExtractor({ title: "Streamed oversized", text: "This document is long enough to exercise streamed response size handling." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "RESPONSE_TOO_LARGE"
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
