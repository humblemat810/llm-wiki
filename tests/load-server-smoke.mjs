import assert from "node:assert/strict";
import { buildLoadProbeUrl, enforceLoadBudget, parseLoadConfig, runLoadProbe } from "../scripts/load-server.mjs";

assert.equal(parseLoadConfig({}).mode, "healthz", "load probe should default to a safe health-only mode");
assert.equal(parseLoadConfig({ LOAD_TEST_REQUESTS: "999", LOAD_TEST_CONCURRENCY: "999" }).requests, 500);
assert.equal(parseLoadConfig({ LOAD_TEST_REQUESTS: "999", LOAD_TEST_CONCURRENCY: "999" }).concurrency, 64);
assert.equal(parseLoadConfig({ LOAD_TEST_MAX_FAILURES: "4", LOAD_TEST_MAX_P95_MS: "2500" }).maxFailures, 4);
assert.equal(parseLoadConfig({ LOAD_TEST_MAX_FAILURES: "4", LOAD_TEST_MAX_P95_MS: "2500" }).maxP95Ms, 2500);
assert.throws(
  () => parseLoadConfig({ LOAD_TEST_MAX_FAILURES: "-1" }),
  /LOAD_TEST_MAX_FAILURES must be a non-negative integer/,
  "malformed failure budgets should fail closed instead of disabling the budget"
);
assert.throws(
  () => parseLoadConfig({ LOAD_TEST_MAX_P95_MS: "nope" }),
  /LOAD_TEST_MAX_P95_MS must be a non-negative integer/,
  "malformed latency budgets should fail closed instead of disabling the budget"
);
assert.throws(
  () => parseLoadConfig({ LOAD_TEST_REQUESTS: "oops" }),
  /LOAD_TEST_REQUESTS must be a positive integer/,
  "malformed request counts should fail closed instead of using a default load"
);
assert.throws(
  () => parseLoadConfig({ LOAD_TEST_DURATION_MS: "oops" }),
  /LOAD_TEST_DURATION_MS must be a non-negative integer/,
  "malformed duration settings should fail closed instead of switching probe mode"
);
assert.equal(parseLoadConfig({ LOAD_TEST_DURATION_MS: "30000" }).durationMs, 30000);
assert.equal(parseLoadConfig({ LOAD_TEST_DURATION_MS: "30000" }).requests, 10000);
assert.equal(parseLoadConfig({ LOAD_TEST_DURATION_MS: "999999" }).durationMs, 30000);
assert.equal(parseLoadConfig({ LOAD_TEST_DURATION_MS: "0" }).durationMs, null);
assert.throws(
  () => parseLoadConfig({ LOAD_TEST_URL: "https://example.test/api", EXTRACTOR_AUTH_TOKEN: "token" }),
  /LOAD_TEST_CONFIRM/,
  "non-loopback load probes should require explicit operator confirmation"
);
assert.throws(
  () => parseLoadConfig({ LOAD_TEST_URL: "http://example.test", LOAD_TEST_CONFIRM: "I_UNDERSTAND" }),
  /must use HTTPS/,
  "non-loopback load probes should reject plaintext HTTP even with explicit confirmation"
);
assert.throws(
  () => parseLoadConfig({ LOAD_TEST_URL: "http://127.0.0.1:8000/?secret=1" }),
  /without credentials, query, or fragment/,
  "load probe targets should reject query strings that could carry secrets"
);
assert.equal(
  parseLoadConfig({
    LOAD_TEST_URL: "https://wiki.example.test/field-notes",
    LOAD_TEST_ALLOWED_ORIGIN: "https://wiki.example.test",
    LOAD_TEST_CONFIRM: "I_UNDERSTAND"
  }).allowedOrigin,
  "https://wiki.example.test",
  "load probes should accept a target under the explicitly allowed deployment origin"
);
assert.throws(
  () => parseLoadConfig({
    LOAD_TEST_URL: "https://other.example.test",
    LOAD_TEST_ALLOWED_ORIGIN: "https://wiki.example.test",
    LOAD_TEST_CONFIRM: "I_UNDERSTAND"
  }),
  /does not match LOAD_TEST_ALLOWED_ORIGIN/,
  "load probes should reject targets outside the declared deployment origin"
);
assert.throws(
  () => parseLoadConfig({
    LOAD_TEST_URL: "https://wiki.example.test",
    LOAD_TEST_ALLOWED_ORIGIN: "https://wiki.example.test/field-notes?token=1",
    LOAD_TEST_CONFIRM: "I_UNDERSTAND"
  }),
  /without credentials, query, or fragment/,
  "load probe allowlists should reject query strings that could carry secrets"
);
assert.equal(
  parseLoadConfig({
    LOAD_TEST_URL: "https://wiki.example.test/field-notes",
    LOAD_TEST_ALLOWED_ORIGIN: "https://wiki.example.test/field-notes",
    LOAD_TEST_CONFIRM: "I_UNDERSTAND"
  }).allowedOrigin,
  "https://wiki.example.test",
  "load probe allowlists should normalize Pages subpaths to their origin"
);
assert.equal(
  buildLoadProbeUrl(new URL("https://wiki.example.test/field-notes"), "healthz").toString(),
  "https://wiki.example.test/field-notes/healthz",
  "load probes should preserve a deployment base path when building health URLs"
);
assert.equal(
  buildLoadProbeUrl(new URL("https://wiki.example.test/field-notes/"), "/api/extract-graph").toString(),
  "https://wiki.example.test/field-notes/api/extract-graph",
  "load probes should preserve a deployment base path when building extraction URLs"
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
assert.equal(result.failedRequests, 0, "successful load probes should report zero failed requests");
assert.equal(result.failureRate, 0, "successful load probes should report zero failure rate");
assert(result.throughputRps > 0, "load probes should report positive throughput");
assert.equal(result.maxFailures, 0, "load probes should default to zero tolerated failures");
assert.equal(result.maxP95Ms, null, "load probes should leave latency thresholds unset unless operators provide one");
assert.equal(result.targetDurationMs, null, "fixed-count load probes should not report a duration target");
const withinBudget = { ...result, failures: [], maxFailures: 0, maxP95Ms: 1000 };
assert.equal(enforceLoadBudget(withinBudget), withinBudget, "load budgets should accept results within configured limits");
assert.throws(
  () => enforceLoadBudget({ ...result, failures: ["one"], failedRequests: 1, maxFailures: 0, maxP95Ms: null }),
  /maximum allowed is 0/,
  "load budgets should reject failures above the configured limit"
);
assert.throws(
  () => enforceLoadBudget({ ...result, failures: [], p95Ms: 2, maxFailures: 0, maxP95Ms: 1 }),
  /p95 latency was .* maximum allowed is 1/,
  "load budgets should reject p95 latency above the configured limit"
);
let failedClock = 0;
const failedLoadResult = await runLoadProbe({
  config: {
    url: new URL("http://127.0.0.1:8000"),
    requests: 1,
    concurrency: 1,
    mode: "healthz",
    token: "",
    deadlineMs: 5000,
    durationMs: null
  },
  now: () => {
    failedClock += 5;
    return failedClock;
  },
  fetchImpl: async () => {
    throw new Error("synthetic failure");
  }
});
assert.equal(failedLoadResult.failures.length, 1, "failed load attempts should remain visible as failures");
assert.equal(failedLoadResult.failedRequests, 1, "multiple diagnostics must still count as one failed request");
assert.equal(failedLoadResult.failureRate, 1, "failed load attempts should report a complete failure rate");
assert.equal(failedLoadResult.p95Ms, 10, "failed load attempts should contribute to latency percentiles");
let durationClock = 0;
const durationLoadResult = await runLoadProbe({
  config: {
    url: new URL("http://127.0.0.1:8000"),
    requests: 100,
    concurrency: 2,
    mode: "healthz",
    token: "",
    deadlineMs: 5000,
    durationMs: 10
  },
  now: () => {
    durationClock += 5;
    return durationClock;
  },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
      ok: true,
      schema: "llm-field-notes/graph@1"
    })).buffer
  })
});
assert(durationLoadResult.requests < 100, "duration load probes should stop at the time budget before the request ceiling");
assert.equal(durationLoadResult.statuses["200"], durationLoadResult.requests, "duration load probes should report the actual completed attempt count");
assert.equal(durationLoadResult.targetDurationMs, 10, "duration load probes should report their configured time budget");

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

const truncatedHealthResult = await runLoadProbe({
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
    headers: { get: () => "3" },
    arrayBuffer: async () => new TextEncoder().encode("{}").buffer
  })
});
assert(truncatedHealthResult.failures.includes("request 1: invalid JSON response"), "health probes should reject declared-length mismatches before accepting the payload");

let oversizedErrorCancelled = false;
const oversizedErrorResult = await runLoadProbe({
  config: {
    url: new URL("http://127.0.0.1:8000"),
    requests: 1,
    concurrency: 1,
    mode: "healthz",
    token: "",
    deadlineMs: 5000
  },
  fetchImpl: async () => ({
    ok: false,
    status: 502,
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array(10 * 1024 * 1024 + 1) }),
        cancel: async () => {
          oversizedErrorCancelled = true;
        },
        releaseLock: () => {}
      })
    }
  })
});
assert(oversizedErrorResult.failures.includes("request 1: HTTP 502"), "error responses should retain their HTTP failure status");
assert(oversizedErrorResult.failures.includes("request 1: network failure"), "error responses should be bounded by the load probe");
assert.equal(oversizedErrorCancelled, true, "oversized error response streams should be cancelled");

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

let lateFetchCanceled = false;
let releaseLateFetch;
const lateFetchResponse = new Promise((resolve) => {
  releaseLateFetch = resolve;
});
const lateFetchProbe = await runLoadProbe({
  config: {
    url: new URL("http://127.0.0.1:8000"),
    requests: 1,
    concurrency: 1,
    mode: "healthz",
    token: "",
    deadlineMs: 5
  },
  fetchImpl: async () => lateFetchResponse
});
assert(lateFetchProbe.failures.includes("request 1: timeout"), "load probes should settle when fetch ignores AbortSignal");
releaseLateFetch({
  ok: true,
  status: 200,
  body: { cancel: async () => { lateFetchCanceled = true; } },
  arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ ok: true, schema: "llm-field-notes/graph@1" })).buffer
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(lateFetchCanceled, true, "late fetch responses should have their bodies canceled after probe timeout");

let hangingReaderCanceled = false;
const hangingBodyProbe = await runLoadProbe({
  config: {
    url: new URL("http://127.0.0.1:8000"),
    requests: 1,
    concurrency: 1,
    mode: "healthz",
    token: "",
    deadlineMs: 5
  },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () => new Promise(() => {}),
        cancel: async () => { hangingReaderCanceled = true; },
        releaseLock: () => {}
      }),
      cancel: async () => {}
    }
  })
});
assert(hangingBodyProbe.failures.includes("request 1: timeout"), "load probes should classify a response body hang as a timeout");
assert.equal(hangingReaderCanceled, true, "timed-out response readers should receive best-effort cancellation");

console.log("load server smoke ok");
