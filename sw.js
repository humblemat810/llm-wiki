const CACHE = "llm-field-notes-v0.1.0";
const CACHE_PREFIX = "llm-field-notes-";
const NETWORK_TIMEOUT_MS = 3000;
const APP_SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./graph-core.js", "./graph-store.js", "./extractor-adapter.js", "./projection-adapter.js", "./jsonld-projection.js", "./storage-adapter.js", "./evaluation.js", "./manifest.webmanifest", "./icon.svg", "./social-card.svg", "./LICENSE", "./README.md", "./ARCHITECTURE.md", "./CHANGELOG.md", "./llms.txt", "./SECURITY.md", "./CONTRIBUTING.md", "./CODE_OF_CONDUCT.md", "./version.json", "./schema/graph.schema.json", "./schema/feedback.schema.json", "./schema/backup.schema.json", "./schema/diff.schema.json", "./schema/extractor-request.schema.json", "./schema/evaluation.schema.json", "./schema/evaluation-comparison.schema.json", "./schema/health.schema.json", "./schema/jsonld.schema.json", "./notes/README.md", "./notes/tokens.md", "./notes/embeddings.md", "./notes/attention.md", "./notes/training.md", "./notes/transformers.md", "./notes/scaling.md", "./notes/inference.md", "./notes/evaluation.md", "./notes/rag.md", "./notes/finetuning.md", "./notes/agents.md", "./notes/production.md"];
const SHELL_PATHS = new Set(APP_SHELL.map((asset) => new URL(asset, self.location).pathname));

function isShellRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && (request.mode === "navigate" || SHELL_PATHS.has(url.pathname));
}

async function matchShellCache(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const url = new URL(request.url);
  if (!url.search) return null;
  return cache.match(new URL(url.pathname, self.location).toString());
}

async function fetchFresh(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(request, { cache: "no-cache", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !isShellRequest(event.request)) return;
  event.respondWith((async () => {
    let networkResponse = null;
    try {
      networkResponse = await fetchFresh(event.request);
      if (networkResponse.ok) {
        try {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, networkResponse.clone());
        } catch {
          // A full or unavailable cache must not hide a fresh network response.
        }
        return networkResponse;
      }
    } catch {
      // A transport failure should use the cached shell when available.
    }
    const cached = await matchShellCache(event.request);
    if (cached) return cached;
    if (networkResponse) return networkResponse;
    if (event.request.mode === "navigate") {
      const cache = await caches.open(CACHE);
      return (await cache.match(new URL("./index.html", self.location).toString())) || Response.error();
    }
    return Response.error();
  })());
});
