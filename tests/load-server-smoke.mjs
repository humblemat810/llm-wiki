import assert from "node:assert/strict";
import { parseLoadConfig, runLoadProbe } from "../scripts/load-server.mjs";

assert.equal(parseLoadConfig({}).mode, "healthz", "load probe should default to a safe health-only mode");
assert.equal(parseLoadConfig({ LOAD_TEST_REQUESTS: "999", LOAD_TEST_CONCURRENCY: "999" }).requests, 500);
assert.equal(parseLoadConfig({ LOAD_TEST_REQUESTS: "999", LOAD_TEST_CONCURRENCY: "999" }).concurrency, 64);
assert.throws(
  () => parseLoadConfig({ LOAD_TEST_URL: "https://example.test/api", EXTRACTOR_AUTH_TOKEN: "token" }),
  /LOAD_TEST_CONFIRM/,
  "non-loopback load probes should require explicit operator confirmation"
);
assert.throws(
  () => parseLoadConfig({ LOAD_TEST_URL: "http://127.0.0.1:8000/?secret=1" }),
  /without credentials, query, or fragment/,
  "load probe targets should reject query strings that could carry secrets"
);

let active = 0;
let peak = 0;
const result = await runLoadProbe({
  config: {
    url: new URL("http://127.0.0.1:8000"),
    requests: 7,
    concurrency: 3,
    mode: "healthz",
    token: "",
    deadlineMs: 5000
  },
  fetchImpl: async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
        ok: true,
        schema: "llm-field-notes/graph@1"
      })).buffer
    };
  }
});
assert.equal(result.failures.length, 0);
assert.equal(result.requests, 7);
assert.equal(result.concurrency, 3);
assert.equal(result.peakInFlight, 3);
assert.equal(peak, 3);
assert.equal(result.statuses["200"], 7);

const invalidHealthResult = await runLoadProbe({
  config: {
    url: new URL("http://127.0.0.1:8000"),
    requests: 1,
    concurrency: 1,
    mode: "healthz",
    token: "",
    deadlineMs: 5000
  },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode("{}").buffer
  })
});
assert.equal(invalidHealthResult.failures.length, 1, "health probes should reject an invalid health response contract");

const extractionResult = await runLoadProbe({
  config: {
    url: new URL("http://127.0.0.1:8000"),
    requests: 1,
    concurrency: 1,
    mode: "extract-graph",
    token: "load-test-token",
    deadlineMs: 5000
  },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
      schema: "llm-field-notes/graph@1",
      extraction: { nodes: [], edges: [] }
    })).buffer
  })
});
assert.equal(extractionResult.failures.length, 0, "authenticated probes should validate the graph response contract");

const invalidExtractionResult = await runLoadProbe({
  config: {
    url: new URL("http://127.0.0.1:8000"),
    requests: 1,
    concurrency: 1,
    mode: "extract-graph",
    token: "load-test-token",
    deadlineMs: 5000
  },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode("{}").buffer
  })
});
assert.equal(invalidExtractionResult.failures.length, 1, "authenticated probes should reject an invalid graph response contract");

console.log("load server smoke ok");
