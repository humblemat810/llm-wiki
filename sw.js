const CACHE = "llm-field-notes-v0.1.0";
const CACHE_PREFIX = "llm-field-notes-";
const NETWORK_TIMEOUT_MS = 3000;
const CACHE_OPERATION_TIMEOUT_MS = 3000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const APP_SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./graph-core.js", "./graph-store.js", "./extractor-adapter.js", "./projection-adapter.js", "./jsonld-projection.js", "./storage-adapter.js", "./evaluation.js", "./manifest.webmanifest", "./icon.svg", "./social-card.svg", "./LICENSE", "./README.md", "./ARCHITECTURE.md", "./CHANGELOG.md", "./llms.txt", "./SECURITY.md", "./CONTRIBUTING.md", "./CODE_OF_CONDUCT.md", "./version.json", "./schema/graph.schema.json", "./schema/feedback.schema.json", "./schema/backup.schema.json", "./schema/diff.schema.json", "./schema/extractor-request.schema.json", "./schema/evaluation.schema.json", "./schema/evaluation-comparison.schema.json", "./schema/health.schema.json", "./schema/jsonld.schema.json", "./notes/README.md", "./notes/tokens.md", "./notes/embeddings.md", "./notes/attention.md", "./notes/training.md", "./notes/transformers.md", "./notes/scaling.md", "./notes/inference.md", "./notes/evaluation.md", "./notes/rag.md", "./notes/finetuning.md", "./notes/agents.md", "./notes/production.md"];
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
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.clone().body.getReader();
      let totalBytes = 0;
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
          if (result.done) break;
          totalBytes += result.value?.byteLength || 0;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            throw new Error("Network response body exceeded the safety limit.");
          }
        }
      } catch (error) {
        controller.abort();
        await reader.cancel().catch(() => {});
        throw error;
      }
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function precacheShell(cache) {
  for (const asset of APP_SHELL) {
    const request = new Request(new URL(asset, self.location), { cache: "no-cache" });
    const response = await fetchFresh(request);
    if (!response.ok) throw new Error(`Shell asset returned HTTP ${response.status}.`);
    await withCacheTimeout(() => cache.put(shellCacheKey(request), response.clone()));
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
    const keys = await withCacheTimeout(() => caches.keys());
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => withCacheTimeout(() => caches.delete(key))));
    await withCacheTimeout(() => self.clients.claim());
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
    if (event.request.mode === "navigate") {
      const offlineShell = await matchShellCache({ url: new URL("./index.html", self.location).toString() });
      if (offlineShell) return offlineShell;
    }
    if (networkResponse) return networkResponse;
    return Response.error();
  })());
});
