import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createAppServer } from "../server.mjs";
import { extractGraph } from "../graph-core.js";

const logs = [];
const server = createAppServer({ logger: (entry) => logs.push(entry) });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
try {
  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(index.status, 200);
  assert((await index.text()).includes("LLM Field Notes"));
  assert(index.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, schema: "llm-field-notes/graph@1" });
  assert.equal(health.headers.get("cache-control"), "no-store");
  const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ok: true, schema: "llm-field-notes/graph@1", ready: true });
  const unavailableServer = createAppServer({ staticRoot: "/tmp/llm-field-notes-missing-root" });
  await new Promise((resolve) => unavailableServer.listen(0, "127.0.0.1", resolve));
  const unavailablePort = unavailableServer.address().port;
  try {
    const unavailable = await fetch(`http://127.0.0.1:${unavailablePort}/readyz`);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).ready, false);
  } finally {
    unavailableServer.close();
  }
  const extraction = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: Array.from({ length: 500 }, (_, index) => ({ id: String(index) })),
      document: { title: "Server test", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(extraction.status, 200);
  const payload = await extraction.json();
  assert.equal(payload.schema, "llm-field-notes/graph@1");
  assert.equal(payload.feedbackFormat, "llm-field-notes/feedback@1");
  assert(payload.extraction.nodes.length > 0);
  assert.equal(payload.feedbackReceived, 500);
  assert.equal(extraction.headers.get("cache-control"), "no-store");
  assert.equal(extraction.headers.get("x-content-type-options"), "nosniff");
  assert.match(extraction.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/);
  assert(logs.some((entry) => entry.route === "extract-graph" && entry.status === 200 && Number.isInteger(entry.durationMs)));
  assert(!JSON.stringify(logs).includes("Attention uses context"), "structured logs must not contain document text");
  const providerCalls = [];
  const providerServer = createAppServer({
    extractor: async ({ document, feedback, requestId }) => {
      providerCalls.push({ document, feedbackCount: feedback.length, requestId });
      return extractGraph(document.title, document.text, { feedback });
    }
  });
  await new Promise((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
  const providerPort = providerServer.address().port;
  try {
    const providerResponse = await fetch(`http://127.0.0.1:${providerPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [{ kind: "concept", id: "attention", label: "Attention", status: "accepted" }],
        document: { title: "Provider test", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(providerResponse.status, 200);
    assert.equal((await providerResponse.json()).schema, "llm-field-notes/graph@1");
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].feedbackCount, 1);
    assert.match(providerCalls[0].requestId, /^[0-9a-f-]{36}$/);
  } finally {
    providerServer.close();
  }
  const failingServer = createAppServer({
    extractor: async () => {
      throw Object.assign(new Error("provider unavailable"), { code: "UPSTREAM_DOWN" });
    }
  });
  await new Promise((resolve) => failingServer.listen(0, "127.0.0.1", resolve));
  const failingPort = failingServer.address().port;
  try {
    const failureResponse = await fetch(`http://127.0.0.1:${failingPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Provider failure", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(failureResponse.status, 502);
    assert.match(await failureResponse.text(), /configured extractor failed/);
  } finally {
    failingServer.close();
  }
  const timeoutLogs = [];
  const timeoutServer = createAppServer({
    extractorTimeoutMs: 10,
    logger: (entry) => timeoutLogs.push(entry),
    extractor: ({ signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("aborted"), { code: "ABORTED_BY_TIMEOUT" }));
      }, { once: true });
    })
  });
  await new Promise((resolve) => timeoutServer.listen(0, "127.0.0.1", resolve));
  const timeoutPort = timeoutServer.address().port;
  try {
    const timeoutResponse = await fetch(`http://127.0.0.1:${timeoutPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Provider timeout", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(timeoutResponse.status, 504);
    assert.match(await timeoutResponse.text(), /extractor timed out/);
    assert(timeoutLogs.some((entry) => entry.status === 504 && entry.error === "EXTRACTOR_TIMEOUT"));
  } finally {
    timeoutServer.close();
  }
  let providerStarted = false;
  let abortObserved = false;
  let providerStartedResolve;
  let abortObservedResolve;
  const providerStartedPromise = new Promise((resolve) => {
    providerStartedResolve = resolve;
  });
  const abortObservedPromise = new Promise((resolve) => {
    abortObservedResolve = resolve;
  });
  const disconnectServer = createAppServer({
    extractor: ({ signal }) => new Promise((resolve, reject) => {
      providerStarted = true;
      providerStartedResolve();
      signal.addEventListener("abort", () => {
        abortObserved = true;
        abortObservedResolve();
        reject(Object.assign(new Error("client disconnected"), { code: "CLIENT_ABORTED" }));
      }, { once: true });
    })
  });
  await new Promise((resolve) => disconnectServer.listen(0, "127.0.0.1", resolve));
  const disconnectPort = disconnectServer.address().port;
  try {
    const disconnectController = new AbortController();
    const requestPromise = fetch(`http://127.0.0.1:${disconnectPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: disconnectController.signal,
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Client disconnect", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    await providerStartedPromise;
    disconnectController.abort();
    await assert.rejects(requestPromise);
    await Promise.race([abortObservedPromise, new Promise((resolve) => setTimeout(resolve, 100))]);
    assert(providerStarted && abortObserved, "client disconnects should abort provider work");
  } finally {
    disconnectServer.close();
  }
  let drainStartedResolve;
  let drainAborted = false;
  const drainStarted = new Promise((resolve) => {
    drainStartedResolve = resolve;
  });
  const drainServer = createAppServer({
    extractor: ({ signal }) => new Promise((resolve, reject) => {
      drainStartedResolve();
      signal.addEventListener("abort", () => {
        drainAborted = true;
        reject(Object.assign(new Error("shutdown"), { code: "SERVER_SHUTDOWN" }));
      }, { once: true });
    })
  });
  await new Promise((resolve) => drainServer.listen(0, "127.0.0.1", resolve));
  const drainPort = drainServer.address().port;
  try {
    const drainRequest = fetch(`http://127.0.0.1:${drainPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Shutdown", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    await drainStarted;
    drainServer.abortActiveExtractors();
    const drainResponse = await drainRequest;
    assert.equal(drainResponse.status, 502);
    assert(drainAborted, "shutdown should abort active provider work");
  } finally {
    drainServer.close();
  }
  const adapted = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [{ kind: "concept", id: "latent-bridge", label: "Latent Bridge", status: "accepted" }],
      document: { title: "Adaptive extraction", text: "The latent bridge organizes signals for review." }
    })
  });
  assert.equal(adapted.status, 200);
  const adaptedPayload = await adapted.json();
  assert(adaptedPayload.extraction.nodes.some((node) => node.id === "latent-bridge"), "reference endpoint should apply reviewed feedback to extraction");
  const invalid = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "wrong" })
  });
  assert.equal(invalid.status, 400);
  const tooMuchFeedback = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: Array.from({ length: 501 }, () => ({})),
      document: { title: "Overflow", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(tooMuchFeedback.status, 400);
  const oversizedFeedback = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [{ kind: "concept", label: "Oversized", evidence: [{ text: "x".repeat(500000) }] }],
      document: { title: "Feedback overflow", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(oversizedFeedback.status, 413);
  const malformedFeedback = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [null],
      document: { title: "Malformed feedback", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(malformedFeedback.status, 400);
  const wrongFeedbackFormat = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "wrong",
      document: { title: "Format test", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(wrongFeedbackFormat.status, 400);
  const unsupportedType = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}"
  });
  assert.equal(unsupportedType.status, 415);
  const traversal = await fetch(`http://127.0.0.1:${port}/%2e%2e/%2e%2e/etc/passwd`);
  assert.equal(traversal.status, 404);
  const privateAsset = await fetch(`http://127.0.0.1:${port}/package.json`);
  assert.equal(privateAsset.status, 404);
  const sourceAsset = await fetch(`http://127.0.0.1:${port}/server.mjs`);
  assert.equal(sourceAsset.status, 404);
  const oversized = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "extract-graph", schema: "llm-field-notes/graph@1", feedbackFormat: "llm-field-notes/feedback@1", feedback: [], document: { title: "Large", text: "x".repeat(2 * 1024 * 1024) } })
  });
  assert.equal(oversized.status, 413);
  const declaredOversized = await new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${port}/api/extract-graph`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(3 * 1024 * 1024)
      }
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(declaredOversized, 413, "declared oversized bodies should be rejected before buffering");
  const limitedServer = createAppServer({ maxRequestsPerMinute: 0 });
  await new Promise((resolve) => limitedServer.listen(0, "127.0.0.1", resolve));
  const limitedPort = limitedServer.address().port;
  try {
    const limited = await fetch(`http://127.0.0.1:${limitedPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        document: { title: "Limited", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
  } finally {
    limitedServer.close();
  }
  const invalidConfigServer = createAppServer({ maxRequestsPerMinute: Number.NaN });
  await new Promise((resolve) => invalidConfigServer.listen(0, "127.0.0.1", resolve));
  const invalidConfigPort = invalidConfigServer.address().port;
  try {
    const safeDefault = await fetch(`http://127.0.0.1:${invalidConfigPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Config test", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.notEqual(safeDefault.status, 500, "invalid embedded rate-limit configuration must not break the server");
    assert.equal(safeDefault.status, 200, "invalid embedded rate-limit configuration should fail safe to the default");
  } finally {
    invalidConfigServer.close();
  }
  console.log("server smoke ok");
} finally {
  server.close();
}
