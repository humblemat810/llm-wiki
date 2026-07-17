import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runLoadProbe } from "./load-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portProbe = createServer();
await new Promise((resolveProbe, rejectProbe) => {
  portProbe.once("error", rejectProbe);
  portProbe.listen(0, "127.0.0.1", resolveProbe);
});
const port = portProbe.address().port;
await new Promise((resolveClose) => portProbe.close(resolveClose));

const revision = "abcdef1234567890";
const extractorToken = "smoke-extractor-token";
const metricsToken = "smoke-metrics-token";
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    BUILD_REVISION: revision,
    PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    EXTRACTOR_AUTH_TOKEN: extractorToken,
    METRICS_AUTH_TOKEN: metricsToken,
    EXTRACTOR_RATE_LIMIT: "10000"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
let lifecycleOutput = "";
const appendOutput = (chunk) => {
  const text = String(chunk);
  output = `${output}${text}`.slice(-64 * 1024);
  if (text.includes('"event":"server-ready"')
    || text.includes('"event":"server-draining"')
    || text.includes('"event":"server-stopped"')) {
    lifecycleOutput = `${lifecycleOutput}${text}`.slice(-8 * 1024);
  }
};
child.stdout.on("data", appendOutput);
child.stderr.on("data", appendOutput);

const waitForExit = async (timeoutMs = 5000) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return [child.exitCode, child.signalCode];
  }
  let timer;
  try {
    return await Promise.race([
      once(child, "exit"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("standalone server did not exit within the shutdown timeout")), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const fetchWithTimeout = async (path, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const waitForReady = async () => {
  let lastError = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`standalone server exited before readiness: ${output || "no process output"}`);
    }
    try {
      const response = await fetchWithTimeout("/readyz");
      if (response.ok) return response;
      lastError = new Error(`readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`standalone server did not become ready: ${lastError?.message || "unknown error"}`);
};

try {
  const readiness = await waitForReady();
  const readinessPayload = await readiness.json();
  assert.equal(readinessPayload.revision, revision, "standalone readiness should expose the configured build revision");

  const health = await fetchWithTimeout("/healthz");
  assert.equal(health.status, 200, "standalone health should be live");
  const liveness = await fetchWithTimeout("/livez");
  assert.equal(liveness.status, 200, "standalone liveness should be live");
  assert.equal((await liveness.json()).live, true, "standalone liveness should expose the liveness contract");

  const healthLoad = await runLoadProbe({
    config: {
      url: new URL(`http://127.0.0.1:${port}`),
      requests: 8,
      concurrency: 4,
      mode: "healthz",
      token: "",
      deadlineMs: 10000
    }
  });
  assert.equal(healthLoad.failures.length, 0, "standalone health should survive a bounded concurrent load probe");
  assert.equal(healthLoad.statuses["200"], 8, "standalone health load should return HTTP 200 for every request");
  assert.equal(healthLoad.peakInFlight, 4, "standalone health load should reach the configured concurrency");

  const unauthenticatedExtraction = await fetchWithTimeout("/api/extract-graph", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [],
      document: { title: "Smoke", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(unauthenticatedExtraction.status, 401, "standalone extraction should require authentication");

  const authenticatedExtraction = await fetchWithTimeout("/api/extract-graph", {
    method: "POST",
    headers: {
      authorization: `Bearer ${extractorToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [],
      document: { title: "Authenticated smoke", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(authenticatedExtraction.status, 200, "standalone extraction should accept the configured bearer token");
  const authenticatedPayload = await authenticatedExtraction.json();
  assert.equal(authenticatedPayload.schema, "llm-field-notes/graph@1", "standalone extraction should return the graph contract");

  const extractionLoad = await runLoadProbe({
    config: {
      url: new URL(`http://127.0.0.1:${port}`),
      requests: 8,
      concurrency: 4,
      mode: "extract-graph",
      token: extractorToken,
      deadlineMs: 10000
    }
  });
  assert.equal(extractionLoad.failures.length, 0, "standalone extraction should survive a bounded authenticated load probe");
  assert.equal(extractionLoad.statuses["200"], 8, "standalone extraction load should return HTTP 200 for every request");
  assert.equal(extractionLoad.peakInFlight, 4, "standalone extraction load should reach the configured concurrency");

  const sustainedExtractionLoad = await runLoadProbe({
    config: {
      url: new URL(`http://127.0.0.1:${port}`),
      requests: 10000,
      concurrency: 4,
      mode: "extract-graph",
      token: extractorToken,
      durationMs: 1000,
      deadlineMs: 10000
    }
  });
  assert.equal(sustainedExtractionLoad.failures.length, 0, "standalone extraction should survive a bounded duration load probe");
  assert(sustainedExtractionLoad.requests > 0, "duration load probes should complete at least one extraction");
  assert.equal(sustainedExtractionLoad.targetDurationMs, 1000, "standalone extraction duration probes should preserve their bounded target");
  assert.equal(sustainedExtractionLoad.failureRate, 0, "standalone extraction duration probes should report no failures");

  const concurrentExtractions = await Promise.all(
    Array.from({ length: 4 }, (_, index) => fetchWithTimeout("/api/extract-graph", {
      method: "POST",
      headers: {
        authorization: `Bearer ${extractorToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: {
          title: `Concurrent smoke ${index + 1}`,
          text: "Attention uses context to create a useful graph representation for review."
        }
      })
    }))
  );
  assert(concurrentExtractions.every((response) => response.status === 200), "standalone extraction should handle a bounded concurrent batch");
  await Promise.all(concurrentExtractions.map((response) => response.arrayBuffer()));

  const unauthenticatedMetrics = await fetchWithTimeout("/metrics");
  assert.equal(unauthenticatedMetrics.status, 401, "standalone metrics should require authentication");

  const authenticatedMetrics = await fetchWithTimeout("/metrics", {
    headers: { authorization: `Bearer ${metricsToken}` }
  });
  assert.equal(authenticatedMetrics.status, 200, "standalone metrics should accept the configured bearer token");
  assert.match(await authenticatedMetrics.text(), /llm_field_notes_http_requests_total/, "standalone metrics should expose the Prometheus contract");

  child.kill("SIGTERM");
  const [exitCode, signal] = await waitForExit();
  assert.equal(signal, null, "standalone server should exit by signal only after graceful shutdown");
  assert.equal(exitCode, 0, "standalone server should exit successfully after SIGTERM");
  assert.match(lifecycleOutput, /"event":"server-ready"/, "standalone server should log readiness");
  assert.match(lifecycleOutput, /"event":"server-draining"/, "standalone server should log drain start");
  assert.match(lifecycleOutput, /"event":"server-stopped"/, "standalone server should log graceful stop");
  console.log("standalone server smoke ok");
} catch (error) {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  try {
    await waitForExit();
  } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await waitForExit(1000).catch(() => {});
  }
  console.error(output);
  throw error;
}
