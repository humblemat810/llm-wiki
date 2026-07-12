import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { GRAPH_SCHEMA, MAX_DOCUMENT_CHARS, extractGraph, normalizeExtraction } from "./graph-core.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_FEEDBACK_CHARS = 500000;
const MAX_RATE_LIMIT_KEYS = 10000;
const FEEDBACK_FORMAT = "llm-field-notes/feedback@1";
const root = fileURLToPath(new URL("./", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};
const publicAssets = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "graph-core.js",
  "graph-store.js",
  "extractor-adapter.js",
  "projection-adapter.js",
  "manifest.webmanifest",
  "icon.svg",
  "sw.js",
  "schema/graph.schema.json",
  "schema/feedback.schema.json",
  "schema/backup.schema.json",
  "schema/extractor-request.schema.json"
]);
const securityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'"
};

function sendJson(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...securityHeaders,
    "referrer-policy": "no-referrer",
    ...extraHeaders
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const declaredLength = Number(request.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      request.resume();
      reject(Object.assign(new Error("Request body exceeds the 2 MB limit."), { statusCode: 413 }));
      return;
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) reject(Object.assign(new Error("Request body exceeds the 2 MB limit."), { statusCode: 413 }));
      else resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

export function createAppServer({
  staticRoot = root,
  maxRequestsPerMinute = 60,
  logger = null,
  extractor = ({ title, text, feedback }) => extractGraph(title, text, { feedback }),
  extractorTimeoutMs = 120000
} = {}) {
  const safeRoot = resolve(staticRoot);
  const numericRateLimit = Number(maxRequestsPerMinute);
  const requestLimit = Number.isFinite(numericRateLimit) && numericRateLimit >= 0
    ? Math.floor(numericRateLimit)
    : 60;
  if (typeof extractor !== "function") throw new TypeError("The extractor must be a function.");
  const numericExtractorTimeout = Number(extractorTimeoutMs);
  const extractorTimeout = Number.isFinite(numericExtractorTimeout) && numericExtractorTimeout >= 1
    ? Math.min(120000, Math.floor(numericExtractorTimeout))
    : 120000;
  const rateLimits = new Map();
  const activeExtractors = new Set();
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && new URL(request.url, "http://localhost").pathname === "/healthz") {
        sendJson(response, 200, { ok: true, schema: GRAPH_SCHEMA });
        return;
      }
      if (request.method === "GET" && new URL(request.url, "http://localhost").pathname === "/readyz") {
        try {
          await readFile(resolve(safeRoot, "index.html"));
          sendJson(response, 200, { ok: true, schema: GRAPH_SCHEMA, ready: true });
        } catch {
          sendJson(response, 503, { ok: false, schema: GRAPH_SCHEMA, ready: false, error: "Static app shell is unavailable." });
        }
        return;
      }
      if (request.method === "POST" && new URL(request.url, "http://localhost").pathname === "/api/extract-graph") {
        const requestId = randomUUID();
        const startedAt = Date.now();
        const respondJson = (status, payload, extraHeaders = {}, logFields = {}) => {
          sendJson(response, status, payload, { "x-request-id": requestId, ...extraHeaders });
          if (typeof logger === "function") logger({ requestId, status, durationMs: Date.now() - startedAt, route: "extract-graph", ...logFields });
        };
        const clientKey = request.socket.remoteAddress || "unknown";
        const now = Date.now();
        for (const [key, entry] of rateLimits) {
          if (now - entry.startedAt >= 60000) rateLimits.delete(key);
        }
        if (!rateLimits.has(clientKey) && rateLimits.size >= MAX_RATE_LIMIT_KEYS) {
          respondJson(503, { error: "Rate limiter capacity is temporarily exhausted." }, { "retry-after": "60" });
          return;
        }
        const current = rateLimits.get(clientKey);
        const windowStart = current && now - current.startedAt < 60000 ? current.startedAt : now;
        const count = current && windowStart === current.startedAt ? current.count + 1 : 1;
        rateLimits.set(clientKey, { startedAt: windowStart, count });
        if (count > requestLimit) {
          const retryAfter = Math.max(1, Math.ceil((windowStart + 60000 - now) / 1000));
          respondJson(429, { error: "Extraction rate limit exceeded." }, { "retry-after": String(retryAfter) });
          return;
        }
        if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
          respondJson(415, { error: "The extraction endpoint requires application/json." });
          return;
        }
        let body;
        try {
          body = JSON.parse(await readBody(request));
        } catch (error) {
          respondJson(error?.statusCode || 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
          return;
        }
        const document = body?.document;
        const feedbackSerialized = Array.isArray(body?.feedback) ? JSON.stringify(body.feedback) : null;
        const validFeedback = Array.isArray(body?.feedback)
          && body.feedback.length <= 500
          && body.feedback.every((item) => item && typeof item === "object" && !Array.isArray(item))
          && typeof feedbackSerialized === "string"
          && feedbackSerialized.length <= MAX_FEEDBACK_CHARS;
        if (body?.operation !== "extract-graph" || body?.schema !== GRAPH_SCHEMA || body?.feedbackFormat !== FEEDBACK_FORMAT || !validFeedback || !document || typeof document.title !== "string" || document.title.length > 200 || typeof document.text !== "string") {
          const status = Array.isArray(body?.feedback) && typeof feedbackSerialized === "string" && feedbackSerialized.length > MAX_FEEDBACK_CHARS ? 413 : 400;
          respondJson(status, { error: status === 413 ? "Reviewed feedback exceeds the 500,000 character limit." : "Expected the llm-field-notes extract-graph request contract." });
          return;
        }
        if (document.text.trim().length < 40 || document.text.length > MAX_DOCUMENT_CHARS) {
          respondJson(400, { error: "Document text must be between 40 and 300,000 characters." });
          return;
        }
        let timeoutHandle;
        let requestAbortHandler;
        let responseCloseHandler;
        let controller;
        try {
          controller = new AbortController();
          activeExtractors.add(controller);
          requestAbortHandler = () => controller.abort();
          responseCloseHandler = () => {
            if (!response.writableEnded) controller.abort();
          };
          request.once("aborted", requestAbortHandler);
          response.once("close", responseCloseHandler);
          if (request.aborted || response.destroyed) controller.abort();
          const extractionPromise = Promise.resolve().then(() => extractor({
            document: { title: document.title, text: document.text },
            title: document.title,
            text: document.text,
            feedback: body.feedback,
            requestId,
            signal: controller.signal
          }));
          const extraction = normalizeExtraction(
            await Promise.race([
              extractionPromise,
              new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => {
                  controller.abort();
                  reject(Object.assign(new Error("Extractor timed out."), { code: "EXTRACTOR_TIMEOUT" }));
                }, extractorTimeout);
              })
            ]),
            document.title,
            document.text
          );
          respondJson(200, {
            schema: GRAPH_SCHEMA,
            extraction,
            feedbackFormat: FEEDBACK_FORMAT,
            feedbackReceived: body.feedback.length
          });
        } catch (error) {
          if (request.aborted || response.destroyed) return;
          const timedOut = error?.code === "EXTRACTOR_TIMEOUT";
          respondJson(
            timedOut ? 504 : 502,
            { error: timedOut ? "The configured extractor timed out. Try again or increase the provider capacity." : "The configured extractor failed. Try again or inspect the provider logs." },
            {},
            { error: error?.code || "EXTRACTOR_FAILURE" }
          );
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (requestAbortHandler) request.removeListener("aborted", requestAbortHandler);
          if (responseCloseHandler) response.removeListener("close", responseCloseHandler);
          if (controller) activeExtractors.delete(controller);
        }
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD, POST" });
        response.end();
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      } catch {
        response.writeHead(400);
        response.end();
        return;
      }
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      if (!publicAssets.has(relative)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const filePath = resolve(safeRoot, relative);
      if (filePath !== safeRoot && !filePath.startsWith(`${safeRoot}/`)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const content = await readFile(filePath);
      response.writeHead(200, {
        "content-type": types[extname(filePath)] || "application/octet-stream",
        "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
        ...securityHeaders
      });
      if (request.method === "HEAD") response.end();
      else response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  server.abortActiveExtractors = () => {
    for (const controller of activeExtractors) controller.abort();
  };
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8000);
  const host = process.env.HOST || "127.0.0.1";
  const configuredRateLimit = Number(process.env.EXTRACTOR_RATE_LIMIT);
  const maxRequestsPerMinute = Number.isFinite(configuredRateLimit) && configuredRateLimit >= 1
    ? Math.floor(configuredRateLimit)
    : 60;
  const configuredExtractorTimeout = Number(process.env.EXTRACTOR_TIMEOUT_MS);
  const extractorTimeoutMs = Number.isFinite(configuredExtractorTimeout) && configuredExtractorTimeout >= 1
    ? Math.min(120000, Math.floor(configuredExtractorTimeout))
    : 120000;
  const server = createAppServer({
    maxRequestsPerMinute,
    extractorTimeoutMs,
    logger: (entry) => console.log(JSON.stringify(entry))
  });
  server.listen(port, host, () => {
    console.log(`LLM Field Notes server listening on http://${host}:${port}`);
  });
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; draining active requests.`);
    server.abortActiveExtractors?.();
    const forceExit = setTimeout(() => process.exit(1), 5000);
    forceExit.unref();
    server.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
