import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRemoteExtractor } from "../extractor-adapter.js";
import { FEEDBACK_FORMAT, GRAPH_SCHEMA, extractGraph } from "../graph-core.js";
import { createAppServer } from "../server.mjs";

const requests = [];
let calls = 0;
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  requests.push({
    method: request.method,
    path: request.url,
    contentType: request.headers["content-type"],
    body: Buffer.concat(chunks).toString("utf8")
  });
  calls += 1;
  if (calls === 1) {
    response.writeHead(503, { "retry-after": "0", "content-length": "0" });
    response.end();
    return;
  }
  const payload = JSON.stringify({
    schema: GRAPH_SCHEMA,
    feedbackFormat: FEEDBACK_FORMAT,
    extraction: {
      nodes: [{ id: "provider-attention", label: "Attention", evidence: [{ text: "provider evidence" }] }],
      edges: []
    }
  });
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    "x-request-id": "provider-http-smoke"
  });
  response.end(payload);
});

await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
try {
  const endpoint = `http://127.0.0.1:${provider.address().port}/extract`;
  const extractor = createRemoteExtractor({
    endpoint,
    timeoutMs: 1000,
    maxRetries: 1,
    retryDelayMs: 0
  });
  const document = {
    title: "HTTP provider integration",
    uri: "https://example.org/provider-source",
    text: "Attention uses context to create a useful graph representation for review."
  };
  const result = await extractor(document, {
    feedback: [{ kind: "concept", id: "attention", label: "Attention", status: "accepted" }]
  });
  assert.equal(calls, 2, "the real HTTP provider should receive one bounded retry after a transient 503");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].path, "/extract");
  assert.equal(requests[0].contentType, "application/json");
  assert.deepEqual(JSON.parse(requests[0].body), JSON.parse(requests[1].body), "retry requests should serialize the same contract body");
  const requestBody = JSON.parse(requests[1].body);
  assert.deepEqual(requestBody.document, document, "the HTTP adapter should send the authoritative document envelope");
  assert.equal(requestBody.schema, GRAPH_SCHEMA);
  assert.equal(requestBody.feedbackFormat, FEEDBACK_FORMAT);
  assert.equal(requestBody.feedback[0].status, "accepted");
  const source = extractGraph(document.title, document.text, { uri: document.uri }).source;
  assert.equal(result.source.id, source.id, "real HTTP responses should receive the submitted source identity");
  assert.equal(result.source.text, document.text);
  assert.equal(result.source.uri, document.uri);
  assert.deepEqual(result.nodes[0].sources, [source.id], "real HTTP provider provenance should be rebound to the submitted source");
  assert.deepEqual(result.nodes[0].evidence[0].sources, [source.id], "real HTTP evidence provenance should be rebound to the submitted source");
  const gateway = createAppServer({
    extractor: ({ document: submittedDocument, feedback, signal }) => extractor(submittedDocument, { feedback, signal }),
    extractorTimeoutMs: 1000,
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  try {
    const gatewayResponse = await fetch(`http://127.0.0.1:${gateway.address().port}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: GRAPH_SCHEMA,
        feedbackFormat: FEEDBACK_FORMAT,
        feedback: [],
        document
      })
    });
    const gatewayBody = await gatewayResponse.text();
    assert.equal(gatewayResponse.status, 200, `the HTTP gateway should complete a real provider round trip: ${gatewayBody}`);
    const gatewayPayload = JSON.parse(gatewayBody);
    assert.equal(gatewayPayload.extraction.source.id, source.id, "gateway normalization should preserve submitted source identity");
    assert.deepEqual(gatewayPayload.extraction.nodes[0].sources, [source.id], "gateway normalization should preserve rebound provenance");
    assert.equal(calls, 3, "the gateway should add exactly one provider request after the adapter integration calls");
  } finally {
    gateway.close();
  }
  console.log("provider HTTP smoke ok");
} finally {
  provider.close();
}
