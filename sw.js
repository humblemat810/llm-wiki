const CACHE = "llm-field-notes-v0.1.0";
const CACHE_PREFIX = "llm-field-notes-";
const NETWORK_TIMEOUT_MS = 3000;
const APP_SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./graph-core.js", "./graph-store.js", "./extractor-adapter.js", "./projection-adapter.js", "./storage-adapter.js", "./evaluation.js", "./manifest.webmanifest", "./icon.svg", "./social-card.svg", "./LICENSE", "./README.md", "./ARCHITECTURE.md", "./CHANGELOG.md", "./SECURITY.md", "./CONTRIBUTING.md", "./CODE_OF_CONDUCT.md", "./version.json", "./schema/graph.schema.json", "./schema/feedback.schema.json", "./schema/backup.schema.json", "./schema/diff.schema.json", "./schema/extractor-request.schema.json", "./schema/evaluation.schema.json", "./schema/evaluation-comparison.schema.json", "./schema/health.schema.json", "./notes/README.md", "./notes/tokens.md", "./notes/embeddings.md", "./notes/attention.md", "./notes/training.md", "./notes/transformers.md", "./notes/scaling.md", "./notes/inference.md", "./notes/evaluation.md", "./notes/rag.md", "./notes/finetuning.md", "./notes/agents.md", "./notes/production.md"];
const SHELL_PATHS = new Set(APP_SHELL.map((asset) => new URL(asset, self.location).pathname));

function isShellRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && (request.mode === "navigate" || SHELL_PATHS.has(url.pathname));
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
  self.skipWaiting();
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
    try {
      const response = await fetchFresh(event.request);
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, response.clone());
        } catch {
          // A full or unavailable cache must not hide a fresh network response.
        }
      }
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === "navigate") {
        return (await caches.match(new URL("./index.html", self.location).toString())) || Response.error();
      }
      return Response.error();
    }
  })());
});
