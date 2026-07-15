const CACHE = "llm-field-notes-v0.1.0";
const CACHE_PREFIX = "llm-field-notes-";
const NETWORK_TIMEOUT_MS = 3000;
const CACHE_OPERATION_TIMEOUT_MS = 3000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const PRECACHE_CONCURRENCY = 4;
const APP_SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./curriculum.js", "./graph-core.js", "./graph-store.js", "./extractor-adapter.js", "./rebuild-adapter.js", "./projection-adapter.js", "./jsonld-projection.js", "./storage-adapter.js", "./evaluation.js", "./manifest.webmanifest", "./icon.svg", "./social-card.svg", "./LICENSE", "./README.md", "./ARCHITECTURE.md", "./CHANGELOG.md", "./llms.txt", "./SECURITY.md", "./CONTRIBUTING.md", "./ARTIFACTS.md", "./ARTIFACT_SUBMISSION.md", "./artifacts.html", "./examples/sample-graph.json", "./CODE_OF_CONDUCT.md", "./version.json", "./experiments/README.md", "./experiments/bounded-file.mjs", "./experiments/compare-evaluations.mjs", "./experiments/diff-graphs.mjs", "./experiments/evaluate-feedback.mjs", "./experiments/graph-input.mjs", "./experiments/inspect-graph.mjs", "./experiments/learning-loop.mjs", "./experiments/tiny-bpe.mjs", "./experiments/tiny-attention.mjs", "./experiments/tiny-training.mjs", "./experiments/tiny-transformer.mjs", "./experiments/project-jsonld.mjs", "./experiments/verify-jsonld.mjs", "./experiments/verify-graph.mjs", "./experiments/verify-diff.mjs", "./schema/graph.schema.json", "./schema/feedback.schema.json", "./schema/backup.schema.json", "./schema/diff.schema.json", "./schema/extractor-request.schema.json", "./schema/evaluation.schema.json", "./schema/evaluation-comparison.schema.json", "./schema/health.schema.json", "./schema/jsonld.schema.json", "./schema/learning-loop.schema.json", "./schema/vault-manifest.schema.json", "./notes/README.md", "./notes/tokens.md", "./notes/embeddings.md", "./notes/attention.md", "./notes/training.md", "./notes/transformers.md", "./notes/scaling.md", "./notes/inference.md", "./notes/evaluation.md", "./notes/rag.md", "./notes/finetuning.md", "./notes/agents.md", "./notes/production.md", "./notes/knowledge-graphs.md"];
const SHELL_PATHS = new Set(APP_SHELL.map((asset) => new URL(asset, self.location).pathname));

function isShellRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && (request.mode === "navigate" || SHELL_PATHS.has(url.pathname));
}

function isCacheableShellRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && SHELL_PATHS.has(url.pathname);
}

function shellCacheKey(request) {
  const url = new URL(request.url);
  return new URL(url.pathname, self.location).toString();
}

function isHtmlShellPath(request) {
  const pathname = new URL(request.url).pathname;
  return pathname.endsWith("/") || pathname.endsWith(".html");
}

function withCacheTimeout(operation) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Cache operation timed out.")), CACHE_OPERATION_TIMEOUT_MS);
  });
  return Promise.race([
    Promise.resolve().then(operation),
    timeoutPromise
  ]).finally(() => clearTimeout(timeout));
}

async function matchShellCache(request) {
  try {
    const cache = await withCacheTimeout(() => caches.open(CACHE));
    return await withCacheTimeout(() => cache.match(shellCacheKey(request)));
  } catch {
    // Cache API failures must not turn an otherwise recoverable fetch into a
    // rejected service-worker response.
    return null;
  }
}

async function fetchFresh(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(request, { cache: "no-cache", signal: controller.signal });
    if (response.type === "opaque" || response.type === "opaqueredirect") {
      throw new Error("Opaque shell responses are not cacheable.");
    }
    if (response.url) {
      let responseOrigin;
      try {
        responseOrigin = new URL(response.url).origin;
      } catch {
        throw new Error("Network response URL is invalid.");
      }
      if (responseOrigin !== self.location.origin) {
        throw new Error("Network response crossed the shell origin boundary.");
      }
    }
    const contentType = response.headers?.get?.("content-type") || "";
    if (!isHtmlShellPath(request) && /^text\/html(?:\s*;|$)/i.test(contentType)) {
      throw new Error("HTML response received for a non-HTML shell asset.");
    }
    const declaredHeader = response.headers?.get?.("content-length");
    const normalizedDeclaredHeader = typeof declaredHeader === "string" ? declaredHeader.trim() : "";
    const declaredLength = /^\d+$/.test(normalizedDeclaredHeader) ? Number(normalizedDeclaredHeader) : Number.NaN;
    if (normalizedDeclaredHeader && !Number.isSafeInteger(declaredLength)) {
      throw new Error("Network response Content-Length is invalid.");
    }
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("Network response body exceeded the safety limit.");
    }
    if ((!response.body || typeof response.body.getReader !== "function")
      && !(response.status >= 400 && response.status < 500)) {
      throw new Error("Network response body is unavailable for bounded validation.");
    }
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.clone().body.getReader();
      let totalBytes = 0;
      let bodyReadComplete = false;
      try {
        while (true) {
          let readTimeout;
          let result;
          try {
            result = await Promise.race([
              reader.read(),
              new Promise((_, reject) => {
                readTimeout = setTimeout(() => reject(new Error("Network response body timed out.")), NETWORK_TIMEOUT_MS);
              })
            ]);
          } finally {
            if (readTimeout) clearTimeout(readTimeout);
          }
          if (!result || typeof result !== "object" || typeof result.done !== "boolean") {
            throw new Error("Network response body returned an invalid read result.");
          }
          if (result.done && result.value !== undefined) {
            throw new Error("Network response body returned an invalid completed read result.");
          }
          if (result.done) {
            bodyReadComplete = true;
            if (Number.isFinite(declaredLength) && totalBytes !== declaredLength) {
              throw new Error("Network response body length does not match Content-Length.");
            }
            break;
          }
          if (!ArrayBuffer.isView(result.value)
            || !Number.isSafeInteger(result.value.byteLength)
            || result.value.byteLength < 0) {
            throw new Error("Network response body returned an invalid byte chunk.");
          }
          totalBytes += result.value.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            throw new Error("Network response body exceeded the safety limit.");
          }
        }
      } catch (error) {
        controller.abort();
        try {
          Promise.resolve(reader.cancel()).catch(() => {});
        } catch {
          // A non-conforming reader must not suppress the bounded fallback.
        }
        throw error;
      } finally {
        if (bodyReadComplete) reader.releaseLock?.();
      }
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function precacheShell(cache) {
  for (let offset = 0; offset < APP_SHELL.length; offset += PRECACHE_CONCURRENCY) {
    const assets = APP_SHELL.slice(offset, offset + PRECACHE_CONCURRENCY);
    await Promise.all(assets.map(async (asset) => {
      const request = new Request(new URL(asset, self.location), { cache: "no-cache" });
      const response = await fetchFresh(request);
      if (!response.ok) throw new Error(`Shell asset returned HTTP ${response.status}.`);
      await withCacheTimeout(() => cache.put(shellCacheKey(request), response.clone()));
    }));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(withCacheTimeout(() => caches.open(CACHE)).then((cache) => precacheShell(cache)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    let keys = [];
    try {
      keys = await withCacheTimeout(() => caches.keys());
    } catch {
      // A cache inventory failure must not strand an otherwise valid worker.
    }
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map((key) => withCacheTimeout(() => caches.delete(key)).catch(() => {})));
    try {
      await withCacheTimeout(() => self.clients.claim());
    } catch {
      // Claiming is an enhancement; the browser can claim clients on a later
      // activation without invalidating the new worker.
    }
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !isShellRequest(event.request)) return;
  event.respondWith((async () => {
    let networkResponse = null;
    try {
      networkResponse = await fetchFresh(event.request);
      if (networkResponse.ok) {
        if (!new URL(event.request.url).search && isCacheableShellRequest(event.request)) {
          try {
            const cache = await withCacheTimeout(() => caches.open(CACHE));
            await withCacheTimeout(() => cache.put(shellCacheKey(event.request), networkResponse.clone()));
          } catch {
            // A full or unavailable cache must not hide a fresh network response.
          }
        }
        return networkResponse;
      }
    } catch {
      // A transport failure should use the cached shell when available.
    }
    const cached = await matchShellCache(event.request);
    if (cached) return cached;
    if (networkResponse && networkResponse.status >= 400 && networkResponse.status < 500) {
      return networkResponse;
    }
    if (event.request.mode === "navigate") {
      const offlineShell = await matchShellCache({ url: new URL("./index.html", self.location).toString() });
      if (offlineShell) return offlineShell;
    }
    if (networkResponse) return networkResponse;
    return Response.error();
  })());
});
