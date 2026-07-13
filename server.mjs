import { createServer } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, realpath, stat } from "node:fs/promises";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { FEEDBACK_FORMAT, GRAPH_SCHEMA, MAX_DOCUMENT_CHARS, MAX_FEEDBACK_EXAMPLES, MAX_ID_CHARS, MAX_SOURCE_URI_CHARS, extractGraph, normalizeExtraction, normalizeSourceUri } from "./graph-core.js";
import { MAX_FEEDBACK_CHARS, MAX_RESPONSE_BYTES } from "./extractor-adapter.js";
import { FIXED_PUBLIC_ASSETS } from "./scripts/public-assets.mjs";

const require = createRequire(import.meta.url);
const APP_VERSION = require("./package.json").version;
const RELEASE_DATE = require("./version.json").date;
const FEED_UPDATED_AT = /^\d{4}-\d{2}-\d{2}$/.test(RELEASE_DATE)
  ? `${RELEASE_DATE}T00:00:00.000Z`
  : "1970-01-01T00:00:00.000Z";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RATE_LIMIT_KEYS = 10000;
const REQUEST_TIMEOUT_MS = 120000;
const HEADERS_TIMEOUT_MS = 15000;
const KEEP_ALIVE_TIMEOUT_MS = 5000;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_STATIC_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_FEEDBACK_LABEL_CHARS = 120;
const EXTRACTION_LATENCY_BUCKETS_MS = [100, 500, 1000, 5000, 30000, 120000];
const root = fileURLToPath(new URL("./", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};
const fixedPublicAssets = FIXED_PUBLIC_ASSETS;

function discoverLearningNoteAssets(staticRoot) {
  try {
    return readdirSync(resolve(staticRoot, "notes"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
      .map((entry) => `notes/${entry.name}`)
      .sort();
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) return [];
    throw error;
  }
}

function fallbackLearningNoteTitle(asset) {
  return asset.slice("notes/".length, -".md".length).replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function deriveLearningNoteTitle(staticRoot, asset) {
  try {
    const resolvedRoot = realpathSync(staticRoot);
    const resolvedFile = realpathSync(resolve(resolvedRoot, asset));
    if (resolvedFile === resolvedRoot || !resolvedFile.startsWith(`${resolvedRoot}/`) || !statSync(resolvedFile).isFile()) {
      return fallbackLearningNoteTitle(asset);
    }
    const content = readFileSync(resolvedFile, "utf8").slice(0, 20000);
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading.slice(0, 200);
  } catch {
    // Readiness and static serving report missing note files separately.
  }
  return fallbackLearningNoteTitle(asset);
}

const securityHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'sha256-efybT6wtRaWZshwoqZ3HWV1NybxKXj9GmB5ie+Pw5iM='; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'"
};

function sendJson(response, status, payload, extraHeaders = {}, head = false) {
  if (response.destroyed || response.writableEnded) return false;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
    ...securityHeaders,
    "referrer-policy": "no-referrer",
    ...extraHeaders
  });
  response.end(head ? undefined : body);
  return true;
}

function sendEmpty(response, status, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) return false;
  response.writeHead(status, {
    "content-length": "0",
    "cache-control": "no-store",
    ...securityHeaders,
    ...extraHeaders
  });
  response.end();
  return true;
}

function sendText(response, status, body, extraHeaders = {}, head = false) {
  if (response.destroyed || response.writableEnded) return false;
  response.writeHead(status, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
    ...securityHeaders,
    ...extraHeaders
  });
  response.end(head ? undefined : body);
  return true;
}

function sendPlainText(response, status, body, extraHeaders = {}, head = false) {
  if (response.destroyed || response.writableEnded) return false;
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...securityHeaders,
    ...extraHeaders
  });
  response.end(head ? undefined : body);
  return true;
}

function sendXml(response, status, body, extraHeaders = {}, head = false) {
  if (response.destroyed || response.writableEnded) return false;
  response.writeHead(status, {
    "content-type": "application/xml; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "public, max-age=3600",
    ...securityHeaders,
    ...extraHeaders
  });
  response.end(head ? undefined : body);
  return true;
}

function sendNotModified(response, etag, cacheControl) {
  if (response.destroyed || response.writableEnded) return false;
  response.writeHead(304, {
    etag,
    "cache-control": cacheControl,
    ...securityHeaders
  });
  response.end();
  return true;
}

function normalizePublicOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function renderOriginAwareIndex(content, origin) {
  if (!origin) return content;
  const rootUrl = `${origin}/`;
  return Buffer.from(content.toString("utf8")
    .replace('href="./" />', `href="${rootUrl}" />`)
    .replace('href="feed.xml"', `href="${origin}/feed.xml"`)
    .replace('content="./" />', `content="${rootUrl}" />`)
    .replace(/content="social-card\.svg"/g, `content="${origin}/social-card.svg"`), "utf8");
}

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;"
  }[character]));
}

function matchesEtag(header, etag) {
  return typeof header === "string" && header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value === etag || value.replace(/^W\//, "") === etag;
  });
}

function hasValidBearerToken(request, expectedToken) {
  if (!expectedToken) return true;
  const header = request.headers.authorization;
  const match = typeof header === "string" ? header.match(/^Bearer[ \t]+(.+)$/i) : null;
  if (!match) return false;
  const provided = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function isFeedbackHint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!["concept", "relation"].includes(value.kind) || !["accepted", "rejected"].includes(value.status)) return false;
  if (typeof value.id !== "string" || !value.id.trim() || value.id.length > MAX_ID_CHARS) return false;
  for (const key of ["label", "sourceLabel", "targetLabel"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > MAX_FEEDBACK_LABEL_CHARS)) return false;
  }
  for (const key of ["source", "target"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > MAX_ID_CHARS)) return false;
  }
  if (value.aliases !== undefined && (!Array.isArray(value.aliases) || value.aliases.length > 20 || value.aliases.some((alias) => typeof alias !== "string" || alias.length > MAX_FEEDBACK_LABEL_CHARS))) return false;
  return true;
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    let settled = false;
    const cleanup = () => {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("aborted", onAborted);
      request.removeListener("error", onError);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        settle(reject, Object.assign(new Error("Request body exceeds the 2 MB limit."), { statusCode: 413 }));
        drainRequest();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (tooLarge) settle(reject, Object.assign(new Error("Request body exceeds the 2 MB limit."), { statusCode: 413 }));
      else settle(resolveBody, Buffer.concat(chunks).toString("utf8"));
    };
    const onAborted = () => settle(reject, Object.assign(new Error("Request was aborted."), { code: "REQUEST_ABORTED" }));
    const onError = (error) => settle(reject, error);
    const drainRequest = () => {
      const drainError = () => {};
      request.on("error", drainError);
      request.once("close", () => request.removeListener("error", drainError));
      request.resume();
    };
    if (request.aborted) {
      settle(reject, Object.assign(new Error("Request was aborted."), { code: "REQUEST_ABORTED" }));
      return;
    }
    const declaredLength = Number(request.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      settle(reject, Object.assign(new Error("Request body exceeds the 2 MB limit."), { statusCode: 413 }));
      drainRequest();
      return;
    }
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
  });
}

export function createAppServer({
  staticRoot = root,
  maxRequestsPerMinute = 60,
  logger = null,
  extractor = ({ title, text, feedback }) => extractGraph(title, text, { feedback }),
  extractorTimeoutMs = 120000,
  extractorAuthToken = process.env.EXTRACTOR_AUTH_TOKEN || "",
  metricsAuthToken = process.env.METRICS_AUTH_TOKEN || "",
  publicOrigin = process.env.PUBLIC_ORIGIN || ""
} = {}) {
  const safeRoot = resolve(staticRoot);
  const learningNoteAssets = discoverLearningNoteAssets(safeRoot);
  const learningNoteTitles = new Map(learningNoteAssets.map((asset) => [asset, deriveLearningNoteTitle(safeRoot, asset)]));
  const publicAssets = new Set([...fixedPublicAssets, ...learningNoteAssets]);
  const numericRateLimit = Number(maxRequestsPerMinute);
  const requestLimit = Number.isFinite(numericRateLimit) && numericRateLimit >= 0
    ? Math.floor(numericRateLimit)
    : 60;
  if (typeof extractor !== "function") throw new TypeError("The extractor must be a function.");
  const numericExtractorTimeout = Number(extractorTimeoutMs);
  const extractorTimeout = Number.isFinite(numericExtractorTimeout) && numericExtractorTimeout >= 1
    ? Math.min(120000, Math.floor(numericExtractorTimeout))
    : 120000;
  const authToken = typeof extractorAuthToken === "string" ? extractorAuthToken : "";
  const metricsToken = typeof metricsAuthToken === "string" ? metricsAuthToken : "";
  const origin = normalizePublicOrigin(publicOrigin);
  const rateLimits = new Map();
  const activeExtractors = new Set();
  const processStartedAt = Date.now();
  const metrics = {
    requests: 0,
    extractionRequests: 0,
    extractionSuccesses: 0,
    extractionFailures: 0,
    authenticationFailures: 0,
    rateLimited: 0,
    extractionLatencyBuckets: Array(EXTRACTION_LATENCY_BUCKETS_MS.length).fill(0),
    extractionLatencySumMs: 0,
    extractionLatencyCount: 0,
    responsesByStatus: new Map()
  };
  const observeExtractionLatency = (durationMs) => {
    const boundedDuration = Math.max(0, Math.floor(Number(durationMs) || 0));
    metrics.extractionLatencySumMs += boundedDuration;
    metrics.extractionLatencyCount += 1;
    EXTRACTION_LATENCY_BUCKETS_MS.forEach((bucket, index) => {
      if (boundedDuration <= bucket) metrics.extractionLatencyBuckets[index] += 1;
    });
  };
  const safeLog = (entry) => {
    if (typeof logger !== "function") return;
    try {
      const result = logger(entry);
      result?.catch?.(() => {});
    } catch {
      // Logging must not change request behavior.
    }
  };
  const server = createServer({
    maxHeaderSize: MAX_HEADER_BYTES,
    requestTimeout: REQUEST_TIMEOUT_MS,
    headersTimeout: HEADERS_TIMEOUT_MS,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS
  }, async (request, response) => {
    try {
      metrics.requests += 1;
      response.once("finish", () => {
        const status = String(response.statusCode || 0);
        metrics.responsesByStatus.set(status, (metrics.responsesByStatus.get(status) || 0) + 1);
      });
      if (["GET", "HEAD"].includes(request.method) && new URL(request.url, "http://localhost").pathname === "/healthz") {
        sendJson(response, 200, { ok: true, schema: GRAPH_SCHEMA, version: APP_VERSION }, {}, request.method === "HEAD");
        return;
      }
      const requestPath = new URL(request.url, "http://localhost").pathname;
      if (["GET", "HEAD"].includes(request.method) && requestPath === "/feed.xml") {
        if (!origin) {
          sendEmpty(response, 404);
          return;
        }
        const base = `${origin}/`;
        const noteEntries = learningNoteAssets.map((asset) => {
          const url = new URL(`./${asset}`, base).toString();
          const title = learningNoteTitles.get(asset) || deriveLearningNoteTitle(safeRoot, asset);
          return [
            "  <entry>",
            `    <id>${xmlEscape(url)}</id>`,
            `    <title>${xmlEscape(title)}</title>`,
            `    <updated>${FEED_UPDATED_AT}</updated>`,
            `    <link href="${xmlEscape(url)}" />`,
            `    <summary type="text">${xmlEscape(`LLM Field Notes learning note: ${title}.`)}</summary>`,
            "  </entry>"
          ].join("\n");
        });
        const body = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<feed xmlns="http://www.w3.org/2005/Atom">',
          `  <id>${xmlEscape(new URL("./feed.xml", base).toString())}</id>`,
          "  <title>LLM Field Notes</title>",
          `  <updated>${FEED_UPDATED_AT}</updated>`,
          `  <link href="${xmlEscape(new URL("./feed.xml", base).toString())}" rel="self" />`,
          `  <link href="${xmlEscape(new URL("./", base).toString())}" />`,
          ...noteEntries,
          "</feed>",
          ""
        ].join("\n");
        const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
        const cacheControl = "public, max-age=3600";
        if (matchesEtag(request.headers["if-none-match"], etag)) {
          sendNotModified(response, etag, cacheControl);
          return;
        }
        sendXml(response, 200, body, { "content-type": "application/atom+xml; charset=utf-8", "cache-control": cacheControl, etag }, request.method === "HEAD");
        return;
      }
      if (["GET", "HEAD"].includes(request.method) && requestPath === "/sitemap.xml") {
        if (!origin) {
          sendEmpty(response, 404);
          return;
        }
        const base = `${origin}/`;
        const urls = [
          new URL("./", base).toString(),
          ...learningNoteAssets.map((asset) => new URL(`./${asset}`, base).toString())
        ];
        const body = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`),
          "</urlset>",
          ""
        ].join("\n");
        const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
        const cacheControl = "public, max-age=3600";
        if (matchesEtag(request.headers["if-none-match"], etag)) {
          sendNotModified(response, etag, cacheControl);
          return;
        }
        sendXml(response, 200, body, { etag }, request.method === "HEAD");
        return;
      }
      if (["GET", "HEAD"].includes(request.method) && requestPath === "/robots.txt" && origin) {
        const body = `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
        const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
        const cacheControl = "public, max-age=3600";
        if (matchesEtag(request.headers["if-none-match"], etag)) {
          sendNotModified(response, etag, cacheControl);
          return;
        }
        sendPlainText(response, 200, body, { "cache-control": cacheControl, etag }, request.method === "HEAD");
        return;
      }
      if (["GET", "HEAD"].includes(request.method) && new URL(request.url, "http://localhost").pathname === "/metrics") {
        if (!hasValidBearerToken(request, metricsToken)) {
          sendJson(response, 401, { error: "Authentication is required for metrics." }, { "www-authenticate": "Bearer" });
          return;
        }
        const body = [
          "# HELP llm_field_notes_http_requests_total Total HTTP requests handled by the reference server.",
          "# TYPE llm_field_notes_http_requests_total counter",
          `llm_field_notes_http_requests_total ${metrics.requests}`,
          "# HELP llm_field_notes_http_responses_total HTTP responses grouped by status code.",
          "# TYPE llm_field_notes_http_responses_total counter",
          ...[...metrics.responsesByStatus.entries()]
            .sort(([left], [right]) => Number(left) - Number(right))
            .map(([status, count]) => `llm_field_notes_http_responses_total{status="${status}"} ${count}`),
          "# HELP llm_field_notes_extraction_requests_total Extraction requests received.",
          "# TYPE llm_field_notes_extraction_requests_total counter",
          `llm_field_notes_extraction_requests_total ${metrics.extractionRequests}`,
          "# HELP llm_field_notes_extraction_successes_total Extraction requests that returned HTTP 200.",
          "# TYPE llm_field_notes_extraction_successes_total counter",
          `llm_field_notes_extraction_successes_total ${metrics.extractionSuccesses}`,
          "# HELP llm_field_notes_extraction_failures_total Extraction requests that did not return HTTP 200.",
          "# TYPE llm_field_notes_extraction_failures_total counter",
          `llm_field_notes_extraction_failures_total ${metrics.extractionFailures}`,
          "# HELP llm_field_notes_authentication_failures_total Extraction requests rejected by bearer authentication.",
          "# TYPE llm_field_notes_authentication_failures_total counter",
          `llm_field_notes_authentication_failures_total ${metrics.authenticationFailures}`,
          "# HELP llm_field_notes_rate_limited_total Extraction requests rejected by the in-process limiter.",
          "# TYPE llm_field_notes_rate_limited_total counter",
          `llm_field_notes_rate_limited_total ${metrics.rateLimited}`,
          "# HELP llm_field_notes_extraction_duration_ms Extraction request latency distribution in milliseconds.",
          "# TYPE llm_field_notes_extraction_duration_ms histogram",
          ...EXTRACTION_LATENCY_BUCKETS_MS.map((bucket, index) => `llm_field_notes_extraction_duration_ms_bucket{le="${bucket}"} ${metrics.extractionLatencyBuckets[index]}`),
          `llm_field_notes_extraction_duration_ms_bucket{le="+Inf"} ${metrics.extractionLatencyCount}`,
          `llm_field_notes_extraction_duration_ms_sum ${metrics.extractionLatencySumMs}`,
          `llm_field_notes_extraction_duration_ms_count ${metrics.extractionLatencyCount}`,
          "# HELP llm_field_notes_extractions_in_flight Current provider extraction operations.",
          "# TYPE llm_field_notes_extractions_in_flight gauge",
          `llm_field_notes_extractions_in_flight ${activeExtractors.size}`,
          "# HELP llm_field_notes_build_info Build metadata for the running application.",
          "# TYPE llm_field_notes_build_info gauge",
          `llm_field_notes_build_info{version="${APP_VERSION}"} 1`,
          "# HELP llm_field_notes_process_uptime_seconds Process uptime in seconds.",
          "# TYPE llm_field_notes_process_uptime_seconds gauge",
          `llm_field_notes_process_uptime_seconds ${Math.max(0, (Date.now() - processStartedAt) / 1000)}`,
          ""
        ].join("\n");
        sendText(response, 200, body, {}, request.method === "HEAD");
        return;
      }
      if (["GET", "HEAD"].includes(request.method) && new URL(request.url, "http://localhost").pathname === "/readyz") {
        if (server.isDraining) {
          sendJson(response, 503, { ok: false, schema: GRAPH_SCHEMA, version: APP_VERSION, ready: false, error: "Server is draining." }, { "retry-after": "5" }, request.method === "HEAD");
          return;
        }
        try {
          const realRoot = await realpath(safeRoot);
          const readinessAssets = new Set([...fixedPublicAssets, ...learningNoteAssets]);
          for (const asset of readinessAssets) {
            const shellPath = await realpath(resolve(realRoot, asset));
            if (shellPath !== resolve(realRoot, asset) && !shellPath.startsWith(`${realRoot}/`)) throw new Error("Static shell escapes root.");
            const metadata = await stat(shellPath);
            if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_STATIC_ASSET_BYTES) throw new Error("Static shell asset is missing, empty, or oversized.");
          }
          sendJson(response, 200, { ok: true, schema: GRAPH_SCHEMA, version: APP_VERSION, ready: true }, {}, request.method === "HEAD");
        } catch {
          sendJson(response, 503, { ok: false, schema: GRAPH_SCHEMA, version: APP_VERSION, ready: false, error: "Static app shell is unavailable." }, {}, request.method === "HEAD");
        }
        return;
      }
      if (new URL(request.url, "http://localhost").pathname === "/api/extract-graph" && request.method !== "POST") {
        sendEmpty(response, 405, { allow: "POST" });
        return;
      }
      if (request.method === "POST" && new URL(request.url, "http://localhost").pathname === "/api/extract-graph") {
        if (server.isDraining) {
          sendJson(response, 503, { error: "Server is draining." }, { "retry-after": "5" });
          return;
        }
        metrics.extractionRequests += 1;
        const requestId = randomUUID();
        const startedAt = Date.now();
        const respondJson = (status, payload, extraHeaders = {}, logFields = {}) => {
          const durationMs = Date.now() - startedAt;
          observeExtractionLatency(durationMs);
          if (status === 200) metrics.extractionSuccesses += 1;
          else metrics.extractionFailures += 1;
          sendJson(response, status, payload, { "x-request-id": requestId, ...extraHeaders });
          safeLog({ requestId, status, durationMs, route: "extract-graph", ...logFields });
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
          metrics.rateLimited += 1;
          const retryAfter = Math.max(1, Math.ceil((windowStart + 60000 - now) / 1000));
          respondJson(429, { error: "Extraction rate limit exceeded." }, { "retry-after": String(retryAfter) });
          return;
        }
        if (!hasValidBearerToken(request, authToken)) {
          metrics.authenticationFailures += 1;
          respondJson(401, { error: "Authentication is required for extraction." }, { "www-authenticate": "Bearer" }, { error: "AUTH_REQUIRED" });
          return;
        }
        const requestContentType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
        if (requestContentType !== "application/json") {
          respondJson(415, { error: "The extraction endpoint requires application/json." });
          return;
        }
        let body;
        try {
          body = JSON.parse(await readBody(request));
        } catch (error) {
          if (request.aborted || response.destroyed || error?.code === "REQUEST_ABORTED") return;
          respondJson(error?.statusCode || 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
          return;
        }
        const document = body?.document;
        const feedbackSerialized = Array.isArray(body?.feedback) ? JSON.stringify(body.feedback) : null;
        const validFeedback = Array.isArray(body?.feedback)
          && body.feedback.length <= MAX_FEEDBACK_EXAMPLES
          && body.feedback.every(isFeedbackHint)
          && typeof feedbackSerialized === "string"
          && feedbackSerialized.length <= MAX_FEEDBACK_CHARS;
        if (body?.operation !== "extract-graph" || body?.schema !== GRAPH_SCHEMA || body?.feedbackFormat !== FEEDBACK_FORMAT || !validFeedback || !document || typeof document.title !== "string" || document.title.length > 200 || (document.uri !== undefined && (typeof document.uri !== "string" || document.uri.length > MAX_SOURCE_URI_CHARS)) || typeof document.text !== "string") {
          const status = Array.isArray(body?.feedback) && typeof feedbackSerialized === "string" && feedbackSerialized.length > MAX_FEEDBACK_CHARS ? 413 : 400;
          respondJson(status, { error: status === 413 ? "Reviewed feedback exceeds the 500,000 character limit." : "Expected the llm-field-notes extract-graph request contract." });
          return;
        }
        if (document.text.trim().length < 40 || document.text.length > MAX_DOCUMENT_CHARS) {
          respondJson(400, { error: "Document text must be between 40 and 300,000 characters." });
          return;
        }
        const normalizedDocumentUri = normalizeSourceUri(document.uri);
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
            document: { title: document.title, text: document.text, ...(normalizedDocumentUri ? { uri: normalizedDocumentUri } : {}) },
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
          if (normalizedDocumentUri && !extraction.source.uri) extraction.source.uri = normalizedDocumentUri;
          const responsePayload = {
              schema: GRAPH_SCHEMA,
              extraction,
              feedbackFormat: FEEDBACK_FORMAT,
              feedbackReceived: body.feedback.length
          };
          if (Buffer.byteLength(JSON.stringify(responsePayload)) > MAX_RESPONSE_BYTES) {
            throw Object.assign(new Error("Extractor response exceeds the 10 MB safety limit."), { code: "EXTRACTOR_RESPONSE_TOO_LARGE" });
          }
          if (!request.aborted && !response.destroyed && !response.writableEnded) {
            respondJson(200, responsePayload, {}, { documentChars: document.text.length, feedbackCount: body.feedback.length });
          }
        } catch (error) {
          if (request.aborted || response.destroyed) return;
          const timedOut = error?.code === "EXTRACTOR_TIMEOUT";
          const responseTooLarge = error?.code === "EXTRACTOR_RESPONSE_TOO_LARGE";
          respondJson(
            timedOut ? 504 : 502,
            { error: timedOut ? "The configured extractor timed out. Try again or increase the provider capacity." : responseTooLarge ? "The extractor response exceeded the 10 MB safety limit." : "The configured extractor failed. Try again or inspect the provider logs." },
            {},
            { error: error?.code || "EXTRACTOR_FAILURE", documentChars: document.text.length, feedbackCount: body.feedback.length }
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
        sendEmpty(response, 405, { allow: "GET, HEAD, POST" });
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      } catch {
        sendEmpty(response, 400);
        return;
      }
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      if (!publicAssets.has(relative)) {
        sendEmpty(response, 404);
        return;
      }
      const realRoot = await realpath(safeRoot);
      const filePath = resolve(realRoot, relative);
      if (filePath !== realRoot && !filePath.startsWith(`${realRoot}/`)) {
        sendEmpty(response, 404);
        return;
      }
      const resolvedFilePath = await realpath(filePath);
      if (resolvedFilePath !== realRoot && !resolvedFilePath.startsWith(`${realRoot}/`)) {
        sendEmpty(response, 404);
        return;
      }
      const metadata = await stat(resolvedFilePath);
      if (!metadata.isFile()) {
        sendEmpty(response, 404);
        return;
      }
      if (metadata.size > MAX_STATIC_ASSET_BYTES) {
        sendEmpty(response, 413);
        return;
      }
      const content = await readFile(resolvedFilePath);
      const responseContent = relative === "index.html" ? renderOriginAwareIndex(content, origin) : content;
      if (responseContent.byteLength > MAX_STATIC_ASSET_BYTES) {
        sendEmpty(response, 413);
        return;
      }
      const etag = `"${createHash("sha256").update(responseContent).digest("hex")}"`;
      const cacheControl = resolvedFilePath.endsWith("index.html") || resolvedFilePath.endsWith("sw.js") || resolvedFilePath.endsWith("version.json")
        ? "no-cache"
        : "public, max-age=3600";
      if (matchesEtag(request.headers["if-none-match"], etag)) {
        response.writeHead(304, {
          etag,
          "cache-control": cacheControl,
          ...securityHeaders
        });
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": relative === "LICENSE" ? "text/plain; charset=utf-8" : types[extname(resolvedFilePath)] || "application/octet-stream",
        "cache-control": cacheControl,
        "content-length": responseContent.byteLength,
        etag,
        ...securityHeaders
      });
      if (request.method === "HEAD") response.end();
      else response.end(responseContent);
    } catch (error) {
      const notFound = ["ENOENT", "ELOOP", "ENOTDIR"].includes(error?.code);
      const status = notFound ? 404 : 500;
      if (status === 500) safeLog({ status, route: "static", error: error?.code || "STATIC_FAILURE" });
      sendEmpty(response, status);
    }
  });
  server.isDraining = false;
  server.getMetrics = () => ({
    ...metrics,
    responsesByStatus: Object.fromEntries(metrics.responsesByStatus),
    extractionLatencyBuckets: [...metrics.extractionLatencyBuckets],
    extractionsInFlight: activeExtractors.size,
    uptimeSeconds: Math.max(0, (Date.now() - processStartedAt) / 1000)
  });
  server.abortActiveExtractors = () => {
    for (const controller of activeExtractors) controller.abort();
  };
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configuredPort = Number(process.env.PORT);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535 ? configuredPort : 8000;
  const host = typeof process.env.HOST === "string" && process.env.HOST.trim() ? process.env.HOST.trim() : "127.0.0.1";
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
    extractorAuthToken: process.env.EXTRACTOR_AUTH_TOKEN || "",
    metricsAuthToken: process.env.METRICS_AUTH_TOKEN || "",
    publicOrigin: process.env.PUBLIC_ORIGIN || "",
    logger: (entry) => console.log(JSON.stringify(entry))
  });
  server.once("error", (error) => {
    console.error(`LLM Field Notes server failed to listen: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = address && typeof address === "object" ? address.port : port;
    console.log(`LLM Field Notes server listening on http://${host}:${actualPort}`);
  });
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.isDraining = true;
    console.log(`Received ${signal}; draining active requests.`);
    server.abortActiveExtractors?.();
    server.closeIdleConnections?.();
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
