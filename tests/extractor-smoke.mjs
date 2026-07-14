import assert from "node:assert/strict";
import { createRemoteExtractor, DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY_MS, ExtractorAdapterError, MAX_FEEDBACK_CHARS, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } from "../extractor-adapter.js";
import { extractGraph, MAX_EVIDENCE_CHARS, MAX_EVIDENCE_RECORDS, MAX_GRAPH_EDGES, MAX_GRAPH_NODES, MAX_SOURCE_REFERENCES, normalizeExtractionForDocument } from "../graph-core.js";

const boundedJsonHeaders = { get: (name) => name === "content-type" ? "application/json" : name === "content-length" ? "64" : null };
const jsonResponse = (payload, headers = boundedJsonHeaders) => {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return {
    ok: true,
    status: 200,
    headers,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
};
const calls = [];
const extractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/v1/graph",
  timeoutMs: 1000,
  headers: { "content-type": "text/plain", accept: "text/plain", "x-trace-id": "adapter-test" },
  fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
        source: {
          title: "Provider-controlled title",
          text: "provider-controlled source text",
          fingerprint: "provider-controlled-fingerprint",
          uri: "https://provider.example.test/private"
        },
        nodes: [{ id: "provider-attention-v9", label: "Attention", status: "accepted", feedback: 99, lastReviewedAt: "2020-01-01T00:00:00.000Z", sources: ["provider-private-source"], evidence: [{ text: "provider evidence", sources: ["provider-private-source"] }] }, { id: "provider-context-v9", label: "Context" }],
        edges: [{ id: "provider-edge-v9", source: "provider-attention-v9", target: "provider-context-v9", label: "uses", status: "rejected", feedback: -99, lastReviewedAt: "2020-01-01T00:00:00.000Z", sources: ["provider-private-source"], evidence: [{ text: "provider relation evidence", sources: ["provider-private-source"] }] }]
      });
  }
});
const result = await extractor(
  { title: "Adapter test", uri: "https://example.org/adapter-test", text: "Attention uses context to make a useful knowledge representation." },
  { feedback: Array.from({ length: 500 }, (_, index) => ({ kind: "concept", id: `feedback-${index}`, label: `Feedback ${index}`, status: "accepted", evidence: [{ text: "private" }] })) }
);
assert.equal(result.source.title, "Adapter test");
assert.equal(result.source.text, "Attention uses context to make a useful knowledge representation.", "remote extraction must preserve the submitted document text");
assert.equal(result.source.uri, "https://example.org/adapter-test");
assert.notEqual(result.source.fingerprint, "provider-controlled-fingerprint", "remote extraction must derive source fingerprints from submitted text");
assert.equal(result.source.id, extractGraph("Adapter test", "Attention uses context to make a useful knowledge representation.").source.id, "remote extraction must derive source IDs from submitted content");
assert.deepEqual(result.nodes[0].sources, [result.source.id], "remote extraction must bind node provenance to the submitted source");
assert.deepEqual(result.nodes[0].evidence[0].sources, [result.source.id], "remote extraction must bind concept evidence to the submitted source");
assert.deepEqual(result.edges[0].sources, [result.source.id], "remote extraction must bind relation provenance to the submitted source");
assert.equal(result.nodes[0].id, "attention");
assert.equal(result.nodes[0].status, "inferred", "remote providers must not create human-approved concept state");
assert.equal(result.nodes[0].feedback, 0, "remote providers must not create human feedback counts");
assert.equal(result.nodes[0].lastReviewedAt, null, "remote providers must not create human review timestamps");
assert.equal(result.edges[0].source, "attention");
assert.equal(result.edges[0].id, "attention--context--uses", "remote extraction must canonicalize provider relation IDs from endpoints and labels");
assert.equal(result.edges[0].status, "inferred", "remote providers must not create human-rejected relation state");
assert.equal(result.edges[0].feedback, 0, "remote providers must not create relation feedback counts");
const ambiguousProviderExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/ambiguous",
  fetchImpl: async () => jsonResponse({
      nodes: [{ id: "duplicate", label: "Attention" }, { id: "duplicate", label: "Context" }],
      edges: [{ source: "duplicate", target: "duplicate", label: "uses" }]
    })
});
const ambiguousProviderResult = await ambiguousProviderExtractor({ title: "Ambiguous provider", text: "Attention uses context to make a useful knowledge representation." });
assert.equal(ambiguousProviderResult.edges.length, 0, "ambiguous provider endpoint IDs should fail closed rather than attach relations arbitrarily");
const boundedNodes = Array.from({ length: MAX_GRAPH_NODES + 1 }, (_, index) => ({
  id: `node-${index}`,
  label: `Node ${index}`
}));
Object.defineProperty(boundedNodes, MAX_GRAPH_NODES, {
  get() {
    throw new Error("provider node beyond the graph bound was read");
  }
});
const boundedEdges = Array.from({ length: MAX_GRAPH_EDGES + 1 }, (_, index) => ({
  source: `node-${index % MAX_GRAPH_NODES}`,
  target: `node-${(index + 1) % MAX_GRAPH_NODES}`,
  label: "connects"
}));
Object.defineProperty(boundedEdges, MAX_GRAPH_EDGES, {
  get() {
    throw new Error("provider edge beyond the graph bound was read");
  }
});
assert.throws(() => normalizeExtractionForDocument({
  nodes: boundedNodes,
  edges: boundedEdges
}, {
  title: "Bounded provider output",
  text: "A bounded provider output still contains enough text to be normalized safely."
}), /concept limit/, "provider normalization should fail closed instead of silently truncating concepts");
const boundedEdgeOnlyNodes = boundedNodes.slice(0, MAX_GRAPH_NODES);
const oversizedEdges = Array.from({ length: MAX_GRAPH_EDGES + 1 }, (_, index) => ({
  source: `node-${index % MAX_GRAPH_NODES}`,
  target: `node-${(index + 1) % MAX_GRAPH_NODES}`,
  label: "connects"
}));
assert.throws(() => normalizeExtractionForDocument({
  nodes: boundedEdgeOnlyNodes,
  edges: oversizedEdges
}, {
  title: "Bounded provider edge output",
  text: "A bounded provider edge output still contains enough text to be normalized safely."
}), /relation limit/, "provider normalization should fail closed instead of silently truncating relations");
assert.throws(() => normalizeExtractionForDocument({
  nodes: [{
    id: "nested-evidence",
    label: "Nested evidence",
    evidence: Array.from({ length: MAX_EVIDENCE_RECORDS + 1 }, () => ({ text: "bounded evidence" }))
  }]
}, {
  title: "Bounded provider evidence",
  text: "A bounded provider evidence response still contains enough text to be normalized safely."
}), /evidence-record limit/, "provider normalization should fail closed instead of silently truncating evidence records");
assert.throws(() => normalizeExtractionForDocument({
  nodes: [{
    id: "nested-sources",
    label: "Nested sources",
    sources: Array.from({ length: MAX_SOURCE_REFERENCES + 1 }, (_, index) => `source-${index}`)
  }]
}, {
  title: "Bounded provider sources",
  text: "A bounded provider provenance response still contains enough text to be normalized safely."
}), /provenance-reference limit/, "provider normalization should fail closed instead of silently truncating item provenance");
assert.throws(() => normalizeExtractionForDocument({
  nodes: [{
    id: "nested-evidence-sources",
    label: "Nested evidence sources",
    evidence: [{ text: "bounded evidence", sources: Array.from({ length: MAX_SOURCE_REFERENCES + 1 }, (_, index) => `source-${index}`) }]
  }]
}, {
  title: "Bounded provider evidence sources",
  text: "A bounded provider evidence provenance response still contains enough text to be normalized safely."
}), /provenance-reference limit/, "provider normalization should fail closed instead of silently truncating evidence provenance");
assert.throws(() => normalizeExtractionForDocument({
  nodes: [{ id: "long-evidence", label: "Long evidence", evidence: [{ text: "e".repeat(MAX_EVIDENCE_CHARS + 1) }] }]
}, {
  title: "Bounded provider evidence text",
  text: "A bounded provider evidence text response still contains enough text to be normalized safely."
}), /evidence-text limit/, "provider normalization should fail closed instead of silently clipping evidence text");
const longTitle = "T".repeat(240);
const callsBeforeLongTitle = calls.length;
await assert.rejects(
  () => extractor({ title: longTitle, text: "Attention uses context to make a useful knowledge representation." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_DOCUMENT"
);
assert.equal(calls.length, callsBeforeLongTitle, "invalid remote titles should be rejected before a provider request");
assert.equal(JSON.parse(calls[0].options.body).document.uri, "https://example.org/adapter-test", "remote source URIs should travel through the request contract");
assert.equal(calls[0].options.method, "POST");
assert.equal(calls[0].options.credentials, "same-origin", "browser extraction should carry same-origin gateway sessions without exposing tokens to the page");
assert.equal(calls[0].options.headers["content-type"], "application/json", "remote requests must preserve the JSON content type");
assert.equal(calls[0].options.headers.accept, "application/json", "remote requests must preserve the JSON accept header");
assert.equal(calls[0].options.headers["x-trace-id"], "adapter-test", "custom tracing headers should remain supported");
assert.equal(JSON.parse(calls[0].options.body).operation, "extract-graph");
assert.equal(JSON.parse(calls[0].options.body).feedbackFormat, "llm-field-notes/feedback@1");
assert.equal(JSON.parse(calls[0].options.body).feedback.length, 500, "remote feedback context should be bounded");
assert(JSON.parse(calls[0].options.body).feedback.every((item) => !Object.hasOwn(item, "evidence") && item.status === "accepted"), "remote feedback context should be compacted to the strict request contract");
const hugeFeedbackExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/huge-feedback",
  fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ nodes: [], edges: [] });
  }
});
const oversizedFeedback = Array.from({ length: 500 }, (_, index) => ({
  kind: "concept",
  id: `oversized-feedback-${index}`,
  label: `Oversized feedback ${index}`,
  aliases: Array.from({ length: 20 }, (__, aliasIndex) => `alias-${index}-${aliasIndex}-${"x".repeat(100)}`),
  status: "accepted"
}));
const callsBeforeOversizedFeedback = calls.length;
await assert.rejects(
  () => hugeFeedbackExtractor(
    { title: "Bounded feedback", text: "This document is long enough to exercise feedback payload bounds." },
    { feedback: oversizedFeedback }
  ),
  (error) => error instanceof ExtractorAdapterError && error.code === "FEEDBACK_TOO_LARGE",
  "oversized serialized feedback should fail closed instead of silently sending a partial context"
);
assert.equal(calls.length, callsBeforeOversizedFeedback, "oversized feedback should be rejected before a provider request");
await assert.rejects(
  () => hugeFeedbackExtractor(
    { title: "Too many feedback items", text: "This document is long enough to exercise feedback item bounds." },
    { feedback: Array.from({ length: 501 }, (_, index) => ({ kind: "concept", id: `too-many-${index}`, label: `Too many ${index}`, status: "accepted" })) }
  ),
  (error) => error instanceof ExtractorAdapterError && error.code === "FEEDBACK_TOO_LARGE",
  "feedback collections above the contract bound should fail closed"
);
assert.equal(MAX_FEEDBACK_CHARS, 500000, "feedback request bounds should have one explicit shared contract");
assert.equal(MAX_REQUEST_BYTES, 2 * 1024 * 1024);
assert.equal(DEFAULT_MAX_RETRIES, 1);
assert.equal(DEFAULT_RETRY_DELAY_MS, 250);
let transientAttempts = 0;
const transientExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/transient",
  retryDelayMs: 0,
  fetchImpl: async () => {
    transientAttempts += 1;
    if (transientAttempts === 1) return { ok: false, status: 503, headers: { get: () => null }, body: { cancel: async () => {} } };
    return jsonResponse({ nodes: [], edges: [] });
  }
});
await transientExtractor({ title: "Transient", text: "This document is long enough to exercise transient retry handling." });
assert.equal(transientAttempts, 2, "transient HTTP failures should receive one bounded retry");
let dateRetryAttempts = 0;
const dateRetryExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/date-retry",
  retryDelayMs: 1000,
  fetchImpl: async () => {
    dateRetryAttempts += 1;
    if (dateRetryAttempts === 1) {
      return {
        ok: false,
        status: 503,
        headers: { get: (name) => name === "retry-after" ? new Date(Date.now() - 1000).toUTCString() : null },
        body: { cancel: async () => {} }
      };
    }
    return jsonResponse({ nodes: [], edges: [] });
  }
});
await dateRetryExtractor({ title: "Date retry", text: "This document is long enough to exercise HTTP-date retry handling." });
assert.equal(dateRetryAttempts, 2, "HTTP-date Retry-After values should remain retryable without an unnecessary delay");
let cleanupFailureAttempts = 0;
const cleanupFailureExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/cleanup-failure",
  retryDelayMs: 0,
  fetchImpl: async () => {
    cleanupFailureAttempts += 1;
    if (cleanupFailureAttempts === 1) {
      return {
        ok: false,
        status: 503,
        headers: { get: () => null },
        body: { cancel: () => { throw new Error("cleanup failed"); } }
      };
    }
    return jsonResponse({ nodes: [], edges: [] });
  }
});
await cleanupFailureExtractor({ title: "Cleanup failure", text: "This document is long enough to exercise response cleanup handling." });
assert.equal(cleanupFailureAttempts, 2, "response cleanup failures should not suppress transient retries");
let hangingCleanupAttempts = 0;
const hangingCleanupExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/hanging-cleanup",
  timeoutMs: 1000,
  retryDelayMs: 0,
  fetchImpl: async () => {
    hangingCleanupAttempts += 1;
    if (hangingCleanupAttempts === 1) {
      return {
        ok: false,
        status: 503,
        headers: { get: () => null },
        body: { cancel: () => new Promise(() => {}) }
      };
    }
    return jsonResponse({ nodes: [], edges: [] });
  }
});
await hangingCleanupExtractor({ title: "Hanging cleanup", text: "This document is long enough to exercise a retry body cleanup that never settles." });
assert.equal(hangingCleanupAttempts, 2, "retryable response cleanup must not block the next bounded attempt");
const retryAbortController = new AbortController();
const retryAbortExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/retry-abort",
  retryDelayMs: 1000,
  fetchImpl: async () => ({ ok: false, status: 503, headers: { get: () => null }, body: { cancel: async () => {} } })
});
const retryAbortRequest = retryAbortExtractor(
  { title: "Retry abort", text: "This document is long enough to exercise cancellation during retry backoff." },
  { signal: retryAbortController.signal }
);
setTimeout(() => retryAbortController.abort(), 10);
await assert.rejects(
  () => retryAbortRequest,
  (error) => error instanceof ExtractorAdapterError && error.code === "CANCELED"
);
const stubbornController = new AbortController();
const stubbornExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/stubborn",
  fetchImpl: async () => jsonResponse({ nodes: [], edges: [] })
});
const stubbornRequest = stubbornExtractor(
  { title: "Stubborn fetch", text: "This document is long enough to exercise ignored abort handling." },
  { signal: stubbornController.signal }
);
stubbornController.abort();
await assert.rejects(
  () => stubbornRequest,
  (error) => error instanceof ExtractorAdapterError && error.code === "CANCELED"
);
const ignoredTimeoutExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/ignored-timeout",
  timeoutMs: 100,
  fetchImpl: async () => new Promise(() => {})
});
await assert.rejects(
  () => ignoredTimeoutExtractor({ title: "Ignored timeout", text: "This document is long enough to exercise a fetch that ignores abort signals." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "TIMEOUT",
  "the adapter timeout must settle even when fetch ignores its AbortSignal"
);
const ignoredBodyTimeoutExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/ignored-body-timeout",
  timeoutMs: 100,
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "application/json" : name === "content-length" ? "2" : null },
    arrayBuffer: () => new Promise(() => {})
  })
});
await assert.rejects(
  () => ignoredBodyTimeoutExtractor({ title: "Ignored body timeout", text: "This document is long enough to exercise a response body that ignores cancellation." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "TIMEOUT",
  "the adapter timeout must settle even when a non-streaming response body ignores cancellation"
);
const streamAbortController = new AbortController();
let streamReadCalls = 0;
let streamCancelCalls = 0;
let resolveStubbornRead;
const streamAbortExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/stream-abort",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: boundedJsonHeaders,
    body: {
      getReader: () => ({
        read: () => {
          streamReadCalls += 1;
          return new Promise((resolve) => {
            resolveStubbornRead = resolve;
          });
        },
        cancel: () => {
          streamCancelCalls += 1;
          throw new Error("reader cancellation failed");
        },
        releaseLock: () => {}
      })
    }
  })
});
const streamAbortRequest = streamAbortExtractor(
  { title: "Stream abort", text: "This document is long enough to exercise stubborn stream cancellation." },
  { signal: streamAbortController.signal }
);
await new Promise((resolve) => setTimeout(resolve, 0));
streamAbortController.abort();
resolveStubbornRead?.({ done: false, value: new Uint8Array([0x7b]) });
await assert.rejects(
  () => streamAbortRequest,
  (error) => error instanceof ExtractorAdapterError && error.code === "CANCELED"
);
assert.equal(streamReadCalls, 1, "aborted response streams should stop reading after the in-flight read settles");
assert.equal(streamCancelCalls, 1, "aborted response streams should request reader cancellation even when cancel throws");
const ignoredStreamController = new AbortController();
let ignoredStreamCancelCalls = 0;
let ignoredStreamReleaseCalls = 0;
const ignoredStreamExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/ignored-stream",
  timeoutMs: 100,
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: boundedJsonHeaders,
    body: {
      getReader: () => ({
        read: () => new Promise(() => {}),
        cancel: () => {
          ignoredStreamCancelCalls += 1;
          throw new Error("ignored cancellation");
        },
        releaseLock: () => {
          ignoredStreamReleaseCalls += 1;
        }
      })
    }
  })
});
const ignoredStreamRequest = ignoredStreamExtractor(
  { title: "Ignored stream", text: "This document is long enough to exercise a stream reader that ignores cancellation." },
  { signal: ignoredStreamController.signal }
);
setTimeout(() => ignoredStreamController.abort(), 10);
await assert.rejects(
  () => ignoredStreamRequest,
  (error) => error instanceof ExtractorAdapterError && error.code === "CANCELED",
  "stream reads should settle when cancellation is ignored by the reader"
);
assert.equal(ignoredStreamCancelCalls, 1, "ignored stream reads should still request body cancellation");
assert.equal(ignoredStreamReleaseCalls, 0, "a pending non-conforming read should not trigger an unsafe lock release");
let permanentAttempts = 0;
const permanentExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/permanent",
  retryDelayMs: 0,
  fetchImpl: async () => {
    permanentAttempts += 1;
    return { ok: false, status: 401, headers: { get: () => null } };
  }
});
await assert.rejects(
  () => permanentExtractor({ title: "Permanent", text: "This document is long enough to avoid retrying permanent errors." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "REMOTE_ERROR"
);
assert.equal(permanentAttempts, 1, "permanent HTTP failures should not be retried");
assert.throws(
  () => createRemoteExtractor({ endpoint: "https://extractor.example.test", maxRetries: 4 }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RETRIES"
);

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
await assert.rejects(
  () => extractor({ title: "Unsafe URI", uri: "javascript:alert(1)", text: "This document is long enough to exercise URI validation." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_DOCUMENT"
);
const malformedResponseExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/malformed",
  fetchImpl: async () => jsonResponse([])
});
await assert.rejects(
  () => malformedResponseExtractor({ title: "Malformed", text: "This document is long enough to exercise response validation." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RESPONSE"
);
const incompatibleSchemaExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/schema",
  fetchImpl: async () => jsonResponse({ schema: "llm-field-notes/graph@999" })
});
await assert.rejects(
  () => incompatibleSchemaExtractor({ title: "Schema", text: "This document is long enough to exercise schema validation." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RESPONSE"
);
const incompatibleFeedbackExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/feedback-format",
  fetchImpl: async () => jsonResponse({ feedbackFormat: "llm-field-notes/feedback@999", extraction: { nodes: [], edges: [] } })
});
await assert.rejects(
  () => incompatibleFeedbackExtractor({ title: "Feedback format", text: "This document is long enough to exercise feedback format validation." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RESPONSE"
);
const nestedIncompatibleSchemaExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/nested-schema",
  fetchImpl: async () => jsonResponse({ extraction: { schema: "llm-field-notes/graph@999", nodes: [], edges: [] } })
});
await assert.rejects(
  () => nestedIncompatibleSchemaExtractor({ title: "Nested schema", text: "This document is long enough to exercise nested schema validation." }),
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
    headers: { get: (name) => name === "content-type" ? "application/json" : name === "content-length" ? String(MAX_RESPONSE_BYTES + 1) : null },
    json: async () => ({ nodes: [], edges: [] })
  })
});
await assert.rejects(
  () => oversizedResponseExtractor({ title: "Oversized", text: "This document is long enough to exercise response size handling." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "RESPONSE_TOO_LARGE"
);
const unboundedFallbackExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/unbounded-fallback",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "application/json" : null },
    json: async () => ({ nodes: [], edges: [] })
  })
});
await assert.rejects(
  () => unboundedFallbackExtractor({ title: "Unbounded fallback", text: "This document is long enough to exercise the non-streaming response bound." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "RESPONSE_TOO_LARGE"
);
let unboundedHeadersJsonCalled = false;
const missingHeadersFallbackExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/missing-headers",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => {
      unboundedHeadersJsonCalled = true;
      return { nodes: [], edges: [] };
    }
  })
});
await assert.rejects(
  () => missingHeadersFallbackExtractor({ title: "Missing headers", text: "This document is long enough to exercise the missing header response bound." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RESPONSE"
);
assert.equal(unboundedHeadersJsonCalled, false, "non-streaming responses without declared size should be rejected before JSON parsing");
let malformedLengthJsonCalled = false;
const malformedLengthExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/malformed-length",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "application/json" : name === "content-length" ? "-1" : null },
    json: async () => {
      malformedLengthJsonCalled = true;
      return { nodes: [], edges: [] };
    }
  })
});
await assert.rejects(
  () => malformedLengthExtractor({ title: "Malformed length", text: "This document is long enough to exercise malformed size metadata." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "RESPONSE_TOO_LARGE"
);
assert.equal(malformedLengthJsonCalled, false, "malformed response sizes should be rejected before JSON parsing");
const unicodeOversizedResponseExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/unicode-oversized",
  fetchImpl: async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ nodes: [], edges: [], notes: "😀".repeat(3_000_000) }));
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name === "content-type" ? "application/json" : name === "content-length" ? String(bytes.byteLength) : null },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    };
  }
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
    headers: { get: (name) => name === "content-type" ? "application/json" : null },
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
const hangingOversizedCleanupExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/hanging-oversized-cleanup",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "application/json" : null },
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array(MAX_RESPONSE_BYTES + 1) }),
        cancel: () => new Promise(() => {}),
        releaseLock: () => {}
      })
    }
  })
});
await assert.rejects(
  () => hangingOversizedCleanupExtractor({ title: "Hanging oversized cleanup", text: "This document is long enough to exercise oversized response cleanup." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "RESPONSE_TOO_LARGE",
  "oversized remote streams should fail without waiting for a hanging reader cancellation"
);
const missingContentTypeExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/missing-content-type",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-length" ? "64" : null },
    json: async () => ({ nodes: [], edges: [] })
  })
});
await assert.rejects(
  () => missingContentTypeExtractor({ title: "Missing content type", text: "This document is long enough to exercise media type validation." }),
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
let streamedCancelCalled = false;
let streamedBodyRead = false;
const cancelableStreamExtractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/stream-cancel",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: boundedJsonHeaders,
    body: new ReadableStream({
      pull(controller) {
        streamedBodyRead = true;
        controller.enqueue(new TextEncoder().encode("{"));
      },
      cancel() {
        streamedCancelCalled = true;
      }
    })
  })
});
const streamedCancelController = new AbortController();
const streamedCancelRequest = cancelableStreamExtractor(
  { title: "Stream cancel", text: "This document is long enough to exercise streaming cancellation handling." },
  { signal: streamedCancelController.signal }
);
for (let attempt = 0; attempt < 20 && !streamedBodyRead; attempt += 1) await Promise.resolve();
assert.equal(streamedBodyRead, true, "streaming response parsing should begin before cancellation is exercised");
streamedCancelController.abort();
await assert.rejects(
  () => streamedCancelRequest,
  (error) => error instanceof ExtractorAdapterError && error.code === "CANCELED"
);
const invalidUtf8Extractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/invalid-utf8",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "application/json" : name === "content-length" ? "1" : null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff]));
        controller.close();
      }
    })
  })
});
await assert.rejects(
  () => invalidUtf8Extractor({ title: "Invalid UTF-8", text: "This document is long enough to exercise invalid UTF-8 handling." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RESPONSE",
  "remote extractor responses should reject invalid UTF-8 instead of silently replacing bytes"
);
const invalidFallbackUtf8Extractor = createRemoteExtractor({
  endpoint: "https://extractor.example.test/invalid-fallback-utf8",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "application/json" : name === "content-length" ? "1" : null },
    arrayBuffer: async () => Uint8Array.from([0xff]).buffer
  })
});
await assert.rejects(
  () => invalidFallbackUtf8Extractor({ title: "Invalid fallback UTF-8", text: "This document is long enough to exercise fallback invalid UTF-8 handling." }),
  (error) => error instanceof ExtractorAdapterError && error.code === "INVALID_RESPONSE",
  "remote extractor arrayBuffer fallbacks should reject invalid UTF-8"
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(streamedCancelCalled, true, "canceling a remote request should cancel an already-resolved streaming response reader");

console.log("extractor adapter smoke ok");
