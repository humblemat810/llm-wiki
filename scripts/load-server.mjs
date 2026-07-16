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

const boundedInteger = (name, value, fallback, maximum) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`${name} must be a positive integer.`);
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric) || numeric < 1) throw new Error(`${name} must be a positive integer.`);
  return Math.min(maximum, numeric);
};

const optionalBoundedInteger = (name, value, maximum) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`${name} must be a non-negative integer.`);
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric)) throw new Error(`${name} must be a non-negative integer.`);
  return Math.min(maximum, numeric);
};

const optionalPositiveBoundedInteger = (name, value, maximum) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`${name} must be a non-negative integer.`);
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error(`${name} must be a non-negative integer.`);
  return numeric === 0 ? null : Math.min(maximum, numeric);
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
  const allowedOrigin = typeof environment.LOAD_TEST_ALLOWED_ORIGIN === "string"
    ? environment.LOAD_TEST_ALLOWED_ORIGIN.trim()
    : "";
  if (allowedOrigin) {
    let parsedAllowedOrigin;
    try {
      parsedAllowedOrigin = new URL(allowedOrigin);
    } catch {
      throw new Error("LOAD_TEST_ALLOWED_ORIGIN must be a valid HTTP(S) origin.");
    }
    if (!["http:", "https:"].includes(parsedAllowedOrigin.protocol)
      || parsedAllowedOrigin.username
      || parsedAllowedOrigin.password
      || parsedAllowedOrigin.search
      || parsedAllowedOrigin.hash) {
      throw new Error("LOAD_TEST_ALLOWED_ORIGIN must be an HTTP(S) origin or deployment URL without credentials, query, or fragment.");
    }
    if (url.origin !== parsedAllowedOrigin.origin) {
      throw new Error("LOAD_TEST_URL does not match LOAD_TEST_ALLOWED_ORIGIN.");
    }
  }
  const isLoopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname.toLowerCase());
  if (!isLoopback && url.protocol !== "https:") {
    throw new Error("Non-loopback load probes must use HTTPS.");
  }
  if (!isLoopback && environment.LOAD_TEST_CONFIRM !== "I_UNDERSTAND") {
    throw new Error("Non-loopback load probes require LOAD_TEST_CONFIRM=I_UNDERSTAND.");
  }
  const token = typeof environment.EXTRACTOR_AUTH_TOKEN === "string"
    ? environment.EXTRACTOR_AUTH_TOKEN
    : "";
  const durationMs = optionalPositiveBoundedInteger("LOAD_TEST_DURATION_MS", environment.LOAD_TEST_DURATION_MS, MAX_DURATION_MS);
  const requestMaximum = durationMs === null ? MAX_REQUESTS : MAX_DURATION_REQUESTS;
  return {
    url,
    requests: boundedInteger("LOAD_TEST_REQUESTS", environment.LOAD_TEST_REQUESTS, durationMs === null ? DEFAULT_REQUESTS : MAX_DURATION_REQUESTS, requestMaximum),
    concurrency: boundedInteger("LOAD_TEST_CONCURRENCY", environment.LOAD_TEST_CONCURRENCY, DEFAULT_CONCURRENCY, MAX_CONCURRENCY),
    mode: token ? "extract-graph" : "healthz",
    token,
    durationMs,
    maxFailures: optionalBoundedInteger("LOAD_TEST_MAX_FAILURES", environment.LOAD_TEST_MAX_FAILURES, MAX_REQUESTS),
    maxP95Ms: optionalBoundedInteger("LOAD_TEST_MAX_P95_MS", environment.LOAD_TEST_MAX_P95_MS, MAX_DURATION_MS),
    allowedOrigin: allowedOrigin
      ? new URL(allowedOrigin).origin
      : null,
    deadlineMs: MAX_DURATION_MS
  };
}

export function buildLoadProbeUrl(baseUrl, route) {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  base.pathname = `${basePath}/`;
  base.search = "";
  base.hash = "";
  return new URL(String(route).replace(/^\/+/, ""), base);
}

const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
};

const readBoundedResponse = async (response, signal = null) => {
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
    let abortReject;
    let abortSettled = false;
    const abortPromise = signal
      ? new Promise((_, reject) => {
        abortReject = reject;
      })
      : null;
    const abortReader = () => {
      if (abortSettled) return;
      abortSettled = true;
      try {
        Promise.resolve(reader.cancel?.()).catch(() => {});
      } catch {
        // Reader cleanup is best-effort; the abort promise still bounds the read.
      }
      abortReject?.(Object.assign(new Error("Load probe response reading was aborted."), { name: "AbortError" }));
    };
    signal?.addEventListener?.("abort", abortReader, { once: true });
    if (signal?.aborted) abortReader();
    try {
      while (true) {
        const { done, value } = await (abortPromise ? Promise.race([reader.read(), abortPromise]) : reader.read());
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
      signal?.removeEventListener?.("abort", abortReader);
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

const cancelResponseBody = (response) => {
  try {
    Promise.resolve(response?.body?.cancel?.()).catch(() => {});
  } catch {
    // Response cleanup is best-effort and must not mask the bounded probe result.
  }
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
    const deadlineMs = Number.isFinite(Number(config.deadlineMs)) && Number(config.deadlineMs) >= 1
      ? Math.floor(Number(config.deadlineMs))
      : MAX_DURATION_MS;
    const timeoutMs = Math.max(1, deadlineMs - (now() - startedAt));
    let timedOut = false;
    let response = null;
    let timeoutReject;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutReject = reject;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      timeoutReject?.(Object.assign(new Error("Load probe request timed out."), { name: "AbortError" }));
      cancelResponseBody(response);
    }, timeoutMs);
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
      const fetchPromise = Promise.resolve().then(() => fetchImpl(buildLoadProbeUrl(
        config.url,
        config.mode === "extract-graph" ? "api/extract-graph" : "healthz"
      ), {
        ...options,
        signal: controller.signal
      }));
      fetchPromise.then((lateResponse) => {
        if (timedOut) cancelResponseBody(lateResponse);
      }, () => {});
      response = await Promise.race([fetchPromise, timeoutPromise]);
      statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
      if (!response.ok) recordFailure(`request ${requestIndex + 1}: HTTP ${response.status}`);
      if (config.mode === "extract-graph" && response.ok) {
        let payload;
        try {
          payload = JSON.parse(await Promise.race([readBoundedResponse(response, controller.signal), timeoutPromise]));
        } catch (error) {
          if (timedOut || error?.name === "AbortError") throw error;
          recordFailure(`request ${requestIndex + 1}: invalid JSON response`);
        }
        if (payload?.schema !== "llm-field-notes/graph@1" || !payload?.extraction || typeof payload.extraction !== "object") {
          recordFailure(`request ${requestIndex + 1}: invalid graph response contract`);
        }
      } else if (config.mode === "healthz" && response.ok) {
        let payload;
        try {
          payload = JSON.parse(await Promise.race([readBoundedResponse(response, controller.signal), timeoutPromise]));
        } catch (error) {
          if (timedOut || error?.name === "AbortError") throw error;
          recordFailure(`request ${requestIndex + 1}: invalid JSON response`);
        }
        if (payload?.ok !== true || payload?.schema !== "llm-field-notes/graph@1" || payload?.ready !== undefined) {
          recordFailure(`request ${requestIndex + 1}: invalid health response contract`);
        }
      } else {
        await Promise.race([readBoundedResponse(response, controller.signal), timeoutPromise]);
      }
    } catch (error) {
      recordFailure(`request ${requestIndex + 1}: ${error?.name === "AbortError" || timedOut ? "timeout" : "network failure"}`);
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
