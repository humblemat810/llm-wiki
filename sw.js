const CACHE = "llm-field-notes-v2";
const APP_SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./graph-core.js", "./graph-store.js", "./extractor-adapter.js", "./projection-adapter.js", "./manifest.webmanifest", "./icon.svg", "./schema/graph.schema.json", "./schema/feedback.schema.json", "./schema/backup.schema.json", "./schema/extractor-request.schema.json"];
const SHELL_PATHS = new Set(APP_SHELL.map((asset) => new URL(asset, self.location).pathname));

function isShellRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && (request.mode === "navigate" || SHELL_PATHS.has(url.pathname));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !isShellRequest(event.request)) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
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
        return (await caches.match(new URL("./index.html", self.location).pathname)) || Response.error();
      }
      return Response.error();
    }
  })());
});
