import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MAX_REQUESTS = 500;
const MAX_DURATION_REQUESTS = 10000;
const MAX_CONCURRENCY = 64;
const MAX_DURATION_MS = 30000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_REQUESTS = 32;
const DEFAULT_CONCURRENCY = 8;
const EXTRACTION_TEXT = "Attention uses context to create a useful graph representation for review.";

const boundedInteger = (value, fallback, maximum) => {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 1
    ? Math.min(maximum, numeric)
    : fallback;
};

const optionalBoundedInteger = (value, maximum) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0
    ? Math.min(maximum, numeric)
    : null;
};

const optionalPositiveBoundedInteger = (value, maximum) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 1
    ? Math.min(maximum, numeric)
    : null;
};

export function parseLoadConfig(environment = process.env) {
  const target = typeof environment.LOAD_TEST_URL === "string" && environment.LOAD_TEST_URL.trim()
    ? environment.LOAD_TEST_URL.trim()
    : "http://127.0.0.1:8000";
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error("LOAD_TEST_URL must be a valid HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("LOAD_TEST_URL must be an HTTP(S) URL without credentials, query, or fragment.");
  }
  const isLoopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname.toLowerCase());
  if (!isLoopback && environment.LOAD_TEST_CONFIRM !== "I_UNDERSTAND") {
    throw new Error("Non-loopback load probes require LOAD_TEST_CONFIRM=I_UNDERSTAND.");
  }
  const token = typeof environment.EXTRACTOR_AUTH_TOKEN === "string"
    ? environment.EXTRACTOR_AUTH_TOKEN
    : "";
  const durationMs = optionalPositiveBoundedInteger(environment.LOAD_TEST_DURATION_MS, MAX_DURATION_MS);
  const requestMaximum = durationMs === null ? MAX_REQUESTS : MAX_DURATION_REQUESTS;
  return {
    url,
    requests: boundedInteger(environment.LOAD_TEST_REQUESTS, durationMs === null ? DEFAULT_REQUESTS : MAX_DURATION_REQUESTS, requestMaximum),
    concurrency: boundedInteger(environment.LOAD_TEST_CONCURRENCY, DEFAULT_CONCURRENCY, MAX_CONCURRENCY),
    mode: token ? "extract-graph" : "healthz",
    token,
    durationMs,
    maxFailures: optionalBoundedInteger(environment.LOAD_TEST_MAX_FAILURES, MAX_REQUESTS),
    maxP95Ms: optionalBoundedInteger(environment.LOAD_TEST_MAX_P95_MS, MAX_DURATION_MS),
    deadlineMs: MAX_DURATION_MS
  };
}

const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
};

const readBoundedResponse = async (response) => {
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== undefined && declaredLength !== null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
    throw new Error("response body declared an invalid or oversized length");
  }
  let bytes;
  if (typeof response.body?.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    let completed = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          completed = true;
          break;
        }
        if (!value || !Number.isSafeInteger(value.byteLength)) {
          throw new Error("response body returned an invalid byte chunk");
        }
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) throw new Error("response body exceeded the safety limit");
        chunks.push(new Uint8Array(value));
      }
    } finally {
      if (!completed) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    if (typeof response.arrayBuffer !== "function") throw new Error("response body is unavailable");
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("response body exceeded the safety limit");
  if (declaredLength !== undefined && declaredLength !== null && bytes.byteLength !== Number(declaredLength)) {
    throw new Error("response body length did not match Content-Length");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

export async function runLoadProbe({
  config = parseLoadConfig(),
  fetchImpl = globalThis.fetch,
  now = () => Date.now()
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const requestCount = config.requests;
  const workerCount = Math.min(config.concurrency, requestCount);
  const latencies = [];
  const statuses = new Map();
  const failures = [];
  let failedRequests = 0;
  let cursor = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  const startedAt = now();
  const request = async () => {
    const requestIndex = cursor;
    cursor += 1;
    const requestStartedAt = now();
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, config.deadlineMs - (now() - startedAt)));
    let requestFailed = false;
    const recordFailure = (message) => {
      requestFailed = true;
      failures.push(message);
    };
    try {
      const options = config.mode === "extract-graph"
        ? {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            operation: "extract-graph",
            schema: "llm-field-notes/graph@1",
            feedbackFormat: "llm-field-notes/feedback@1",
            feedback: [],
            document: { title: `Load probe ${requestIndex + 1}`, text: EXTRACTION_TEXT }
          })
        }
        : {};
      const response = await fetchImpl(new URL(config.mode === "extract-graph" ? "/api/extract-graph" : "/healthz", config.url), {
        ...options,
        signal: controller.signal
      });
      statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
      if (!response.ok) recordFailure(`request ${requestIndex + 1}: HTTP ${response.status}`);
      if (config.mode === "extract-graph" && response.ok) {
        let payload;
        try {
          payload = JSON.parse(await readBoundedResponse(response));
        } catch {
          recordFailure(`request ${requestIndex + 1}: invalid JSON response`);
        }
        if (payload?.schema !== "llm-field-notes/graph@1" || !payload?.extraction || typeof payload.extraction !== "object") {
          recordFailure(`request ${requestIndex + 1}: invalid graph response contract`);
        }
      } else if (config.mode === "healthz" && response.ok) {
        let payload;
        try {
          payload = JSON.parse(await readBoundedResponse(response));
        } catch {
          recordFailure(`request ${requestIndex + 1}: invalid JSON response`);
        }
        if (payload?.ok !== true || payload?.schema !== "llm-field-notes/graph@1" || payload?.ready !== undefined) {
          recordFailure(`request ${requestIndex + 1}: invalid health response contract`);
        }
      } else {
        await readBoundedResponse(response);
      }
    } catch (error) {
      recordFailure(`request ${requestIndex + 1}: ${error?.name === "AbortError" ? "timeout" : "network failure"}`);
    } finally {
      if (requestFailed) failedRequests += 1;
      latencies.push(Math.max(0, now() - requestStartedAt));
      clearTimeout(timer);
      inFlight -= 1;
    }
  };
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < requestCount && (config.durationMs === null || config.durationMs === undefined || now() - startedAt < config.durationMs)) {
      await request();
    }
  });
  await Promise.all(workers);
  return {
    mode: config.mode,
    requests: cursor,
    concurrency: workerCount,
    peakInFlight,
    failures,
    failedRequests,
    maxFailures: config.maxFailures ?? 0,
    maxP95Ms: config.maxP95Ms ?? null,
    targetDurationMs: config.durationMs ?? null,
    statuses: Object.fromEntries(statuses),
    durationMs: Math.max(0, now() - startedAt),
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxMs: latencies.length ? Math.max(...latencies) : 0,
    throughputRps: latencies.length ? cursor / (Math.max(1, now() - startedAt) / 1000) : 0,
    failureRate: cursor ? failedRequests / cursor : 0
  };
}

export function enforceLoadBudget(result) {
  const maxFailures = Number.isSafeInteger(result?.maxFailures) ? result.maxFailures : 0;
  const failedRequests = Number.isSafeInteger(result?.failedRequests) ? result.failedRequests : result.failures.length;
  if (failedRequests > maxFailures) {
    throw new Error(`load probe observed ${failedRequests} failed request(s); maximum allowed is ${maxFailures}`);
  }
  if (Number.isSafeInteger(result.maxP95Ms) && result.p95Ms > result.maxP95Ms) {
    throw new Error(`load probe p95 latency was ${result.p95Ms} ms; maximum allowed is ${result.maxP95Ms} ms`);
  }
  return result;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = await runLoadProbe();
    enforceLoadBudget(result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`load probe failed: ${error.message}`);
    process.exitCode = 1;
  }
}
