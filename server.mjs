import { createServer } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { open, realpath, stat } from "node:fs/promises";
import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { FEEDBACK_FORMAT, GRAPH_SCHEMA, MAX_DOCUMENT_CHARS, MAX_FEEDBACK_EXAMPLES, MAX_FEEDBACK_LABEL_CHARS, MAX_ID_CHARS, MAX_SOURCE_URI_CHARS, extractGraph, normalizeExtractionForDocument, normalizeSourceUri } from "./graph-core.js";
import { MAX_FEEDBACK_CHARS, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } from "./extractor-adapter.js";
import { FIXED_PUBLIC_ASSETS, MAX_LEARNING_NOTE_ASSETS, MAX_PUBLIC_ASSET_BYTES, MAX_STATIC_ASSET_BYTES } from "./scripts/public-assets.mjs";
import { normalizePublicOrigin } from "./scripts/public-origin.mjs";
import { buildLearningNotePage, MAX_NOTE_SUMMARY_CHARS } from "./scripts/note-page.mjs";

const require = createRequire(import.meta.url);
const APP_VERSION = require("./package.json").version;
const RELEASE_DATE = require("./version.json").date;
const FEED_UPDATED_AT = /^\d{4}-\d{2}-\d{2}$/.test(RELEASE_DATE)
  ? `${RELEASE_DATE}T00:00:00.000Z`
  : "1970-01-01T00:00:00.000Z";
const MAX_BODY_BYTES = MAX_REQUEST_BYTES;
const MAX_RATE_LIMIT_KEYS = 10000;
export const DEFAULT_MAX_CONCURRENT_EXTRACTORS = 8;
const MAX_CONCURRENT_EXTRACTORS = 1024;
const REQUEST_TIMEOUT_MS = 120000;
const HEADERS_TIMEOUT_MS = 15000;
const KEEP_ALIVE_TIMEOUT_MS = 5000;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_CRAWLER_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RUNTIME_TEXT_CHARS = Math.floor(MAX_STATIC_ASSET_BYTES / 4);
const DEFAULT_IDLE_WAIT_TIMEOUT_MS = 5000;
const READINESS_CACHE_TTL_MS = 5000;
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
const decodeUtf8 = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

function discoverLearningNoteAssets(staticRoot) {
  try {
    const assets = readdirSync(resolve(staticRoot, "notes"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
      .map((entry) => `notes/${entry.name}`)
      .sort();
    if (assets.length > MAX_LEARNING_NOTE_ASSETS) throw new Error(`The deployment contains more than ${MAX_LEARNING_NOTE_ASSETS} learning notes.`);
    return assets;
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) return [];
    throw error;
  }
}

function fallbackLearningNoteTitle(asset) {
  return asset.slice("notes/".length, -".md".length).replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function readBoundedUtf8(filePath, maxChars) {
  const numericLimit = Number(maxChars);
  if (!Number.isFinite(numericLimit) || numericLimit < 1 || numericLimit > MAX_RUNTIME_TEXT_CHARS) {
    throw new RangeError(`A finite character limit from 1 to ${MAX_RUNTIME_TEXT_CHARS} is required.`);
  }
  const characterLimit = Math.floor(numericLimit);
  const byteLimit = characterLimit * 4 + 4;
  const file = openSync(filePath, "r");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let content = "";
  let offset = 0;
  try {
    while (offset < byteLimit) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, byteLimit - offset));
      const bytesRead = readSync(file, buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      offset += bytesRead;
      content += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      if (content.length >= characterLimit) return content.slice(0, characterLimit);
    }
    return `${content}${decoder.decode()}`.slice(0, characterLimit);
  } finally {
    closeSync(file);
  }
}

export async function readBoundedFile(filePath, maxBytes) {
  const numericLimit = Number(maxBytes);
  if (!Number.isFinite(numericLimit) || numericLimit < 1 || numericLimit > MAX_STATIC_ASSET_BYTES) {
    throw new RangeError(`A finite file-size limit from 1 to ${MAX_STATIC_ASSET_BYTES} is required.`);
  }
  const byteLimit = Math.floor(numericLimit);
  const handle = await open(filePath, "r");
  const chunks = [];
  let total = 0;
  try {
    const chunkSize = Math.min(64 * 1024, byteLimit + 1);
    while (total <= byteLimit) {
      const buffer = Buffer.allocUnsafe(chunkSize);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > byteLimit) {
        throw Object.assign(new Error("Static asset exceeds the configured size limit."), { code: "FILE_TOO_LARGE" });
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function deriveLearningNoteTitle(staticRoot, asset) {
  try {
    const resolvedRoot = realpathSync(staticRoot);
    const resolvedFile = realpathSync(resolve(resolvedRoot, asset));
    if (resolvedFile === resolvedRoot || !resolvedFile.startsWith(`${resolvedRoot}/`) || !statSync(resolvedFile).isFile()) {
      return fallbackLearningNoteTitle(asset);
    }
    const content = readBoundedUtf8(resolvedFile, MAX_NOTE_SUMMARY_CHARS);
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading.slice(0, 200);
  } catch {
    // Readiness and static serving report missing note files separately.
  }
  return fallbackLearningNoteTitle(asset);
}

function deriveLearningNoteSummary(content, title) {
  const boundedContent = content.slice(0, MAX_NOTE_SUMMARY_CHARS);
  const question = boundedContent.match(/^>\s*(.+)$/m)?.[1]?.trim() || "";
  const withoutFrontmatter = boundedContent.replace(/^---[\s\S]*?---\s*/m, "");
  const paragraphs = withoutFrontmatter.replace(/^#+\s+.+$/gm, "").split(/\n\s*\n/).map((paragraph) => paragraph
    .replace(/^>\s?/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim())
    .filter((paragraph) => paragraph && paragraph !== title && paragraph !== question);
  return ([question, paragraphs[0] || title].filter(Boolean).join(" ")).slice(0, 280);
}

function deriveLearningNoteMetadata(staticRoot, asset) {
  try {
    const resolvedRoot = realpathSync(staticRoot);
    const resolvedFile = realpathSync(resolve(resolvedRoot, asset));
    if (resolvedFile === resolvedRoot || !resolvedFile.startsWith(`${resolvedRoot}/`) || !statSync(resolvedFile).isFile()) {
      return { title: fallbackLearningNoteTitle(asset), description: "" };
    }
    const content = readBoundedUtf8(resolvedFile, MAX_NOTE_SUMMARY_CHARS);
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim()?.slice(0, 200) || fallbackLearningNoteTitle(asset);
    return { title, description: deriveLearningNoteSummary(content, title) };
  } catch {
    return { title: fallbackLearningNoteTitle(asset), description: "" };
  }
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
const learningNotePageCsp = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; worker-src 'none'; manifest-src 'none'";

function sendJson(response, status, payload, extraHeaders = {}, head = false) {
  if (response.destroyed || response.writableEnded) return false;
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
    ...(response.securityHeaders || securityHeaders),
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
    ...(response.securityHeaders || securityHeaders),
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
    ...(response.securityHeaders || securityHeaders),
    ...extraHeaders
  });
  response.end(head ? undefined : body);
  return true;
}

function sendHtml(response, status, body, extraHeaders = {}, head = false) {
  if (response.destroyed || response.writableEnded) return false;
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "public, max-age=3600",
    ...(response.securityHeaders || securityHeaders),
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
    ...(response.securityHeaders || securityHeaders),
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
    ...(response.securityHeaders || securityHeaders),
    ...extraHeaders
  });
  response.end(head ? undefined : body);
  return true;
}

function sendNotModified(response, etag, cacheControl, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) return false;
  response.writeHead(304, {
    etag,
    "cache-control": cacheControl,
    ...(response.securityHeaders || securityHeaders),
    ...extraHeaders
  });
  response.end();
  return true;
}

function renderOriginAwareIndex(content, origin) {
  if (!origin) return content;
  const rootUrl = `${origin}/`;
  const rendered = content.toString("utf8")
    .replace('href="./" />', `href="${rootUrl}" />`)
    .replace('href="feed.xml"', `href="${origin}/feed.xml"`)
    .replace('content="./" />', `content="${rootUrl}" />`)
    .replace('"url": "./"', `"url": "${rootUrl}"`)
    .replace(/content="social-card\.svg"/g, `content="${origin}/social-card.svg"`);
  const structuredDataMatch = rendered.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!structuredDataMatch) return Buffer.from(rendered, "utf8");
  const structuredDataCsp = `'sha256-${createHash("sha256").update(structuredDataMatch[1]).digest("base64")}'`;
  return Buffer.from(rendered.replace(/'sha256-[^']+'/g, structuredDataCsp), "utf8");
}

function securityHeadersForIndex(content) {
  const structuredDataMatch = content.toString("utf8").match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!structuredDataMatch) return securityHeaders;
  const structuredDataCsp = `'sha256-${createHash("sha256").update(structuredDataMatch[1]).digest("base64")}'`;
  return {
    ...securityHeaders,
    "content-security-policy": securityHeaders["content-security-policy"].replace(/'sha256-[^']+'/g, structuredDataCsp)
  };
}

function xmlEscape(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>"']/g, (character) => ({
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

function hasAllowedRequestOrigin(request, publicOrigin) {
  const fetchSite = request.headers["sec-fetch-site"];
  if (typeof fetchSite === "string" && fetchSite.trim().toLowerCase() === "cross-site") return false;
  const requestOrigin = request.headers.origin;
  if (requestOrigin === undefined) return true;
  if (typeof requestOrigin !== "string" || !requestOrigin.trim()) return false;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(requestOrigin);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) {
    return false;
  }
  let expectedOrigin;
  try {
    expectedOrigin = publicOrigin
      ? new URL(publicOrigin).origin
      : `${request.socket.encrypted ? "https" : "http"}://${request.headers.host}`;
  } catch {
    return false;
  }
  return parsedOrigin.origin === expectedOrigin;
}

function safeDiagnosticCode(value, fallback = "EXTRACTOR_FAILURE") {
  if (typeof value !== "string") return fallback;
  const code = value.trim().slice(0, 80);
  return /^[A-Z][A-Z0-9_:-]*$/.test(code) ? code : fallback;
}

const hasOnlyKeys = (value, allowedKeys) => (
  value
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.keys(value).every((key) => allowedKeys.has(key))
);
const EXTRACTOR_REQUEST_KEYS = new Set(["operation", "schema", "feedbackFormat", "document", "feedback"]);
const EXTRACTOR_DOCUMENT_KEYS = new Set(["title", "uri", "text"]);
const EXTRACTOR_FEEDBACK_KEYS = new Set([
  "kind",
  "id",
  "label",
  "aliases",
  "source",
  "sourceLabel",
  "target",
  "targetLabel",
  "status"
]);

function isFeedbackHint(value) {
  if (!hasOnlyKeys(value, EXTRACTOR_FEEDBACK_KEYS)) return false;
  if (!["concept", "relation"].includes(value.kind) || !["accepted", "rejected"].includes(value.status)) return false;
  if (typeof value.id !== "string" || !value.id.trim() || value.id.length > MAX_ID_CHARS) return false;
  for (const key of ["label", "sourceLabel", "targetLabel"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > MAX_FEEDBACK_LABEL_CHARS)) return false;
  }
  for (const key of ["source", "target"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > MAX_ID_CHARS)) return false;
  }
  if (value.aliases !== undefined && (
    !Array.isArray(value.aliases)
    || value.aliases.length > 20
    || new Set(value.aliases).size !== value.aliases.length
    || value.aliases.some((alias) => typeof alias !== "string" || alias.length > MAX_FEEDBACK_LABEL_CHARS)
  )) return false;
  return true;
}

function compactFeedbackHint(value) {
  if (!isFeedbackHint(value)) return null;
  const compact = {
    kind: value.kind,
    id: value.id,
    status: value.status
  };
  for (const key of ["label", "source", "sourceLabel", "target", "targetLabel"]) {
    if (typeof value[key] === "string") compact[key] = value[key];
  }
  if (Array.isArray(value.aliases)) compact.aliases = [...value.aliases];
  return compact;
}

function discardRequestBody(request, response) {
  if (request.readableEnded || request.destroyed) return;
  let discardedBytes = 0;
  let terminated = false;
  const discardError = () => {};
  const cleanup = () => {
    request.removeListener("data", onData);
    request.removeListener("end", cleanup);
    request.removeListener("error", discardError);
    request.removeListener("close", cleanup);
  };
  const terminate = () => {
    if (terminated || request.destroyed) return;
    terminated = true;
    cleanup();
    const destroy = () => {
      if (!request.destroyed) request.destroy();
    };
    if (response && !response.writableFinished) response.once("finish", destroy);
    else setImmediate(destroy);
  };
  const onData = (chunk) => {
    discardedBytes += chunk.length;
    if (discardedBytes > MAX_BODY_BYTES) terminate();
  };
  request.on("data", onData);
  request.once("end", cleanup);
  request.once("close", cleanup);
  request.on("error", discardError);
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    terminate();
    return;
  }
  request.resume();
}

export function readBody(request, response) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    let settled = false;
    const cleanup = () => {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("aborted", onAborted);
      request.removeListener("close", onClose);
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
        discardRequestBody(request, response);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (tooLarge) {
        settle(reject, Object.assign(new Error("Request body exceeds the 2 MB limit."), { statusCode: 413 }));
        return;
      }
      try {
        settle(resolveBody, new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        settle(reject, Object.assign(new Error("Request body is not valid UTF-8."), { statusCode: 400 }));
      }
    };
    const onAborted = () => settle(reject, Object.assign(new Error("Request was aborted."), { code: "REQUEST_ABORTED" }));
    const onClose = () => {
      if (!request.readableEnded && !request.complete) {
        settle(reject, Object.assign(new Error("Request was aborted."), { code: "REQUEST_ABORTED" }));
      }
    };
    const onError = (error) => settle(reject, error);
    if (request.aborted) {
      settle(reject, Object.assign(new Error("Request was aborted."), { code: "REQUEST_ABORTED" }));
      return;
    }
    const declaredLength = Number(request.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      settle(reject, Object.assign(new Error("Request body exceeds the 2 MB limit."), { statusCode: 413 }));
      discardRequestBody(request, response);
      return;
    }
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("close", onClose);
    request.once("error", onError);
  });
}

export function createAppServer({
  staticRoot = root,
  maxRequestsPerMinute = 60,
  maxConcurrentExtractors = DEFAULT_MAX_CONCURRENT_EXTRACTORS,
  logger = null,
  extractor = ({ title, text, feedback }) => extractGraph(title, text, { feedback }),
  extractorTimeoutMs = 120000,
  extractorAuthToken = process.env.EXTRACTOR_AUTH_TOKEN || "",
  metricsAuthToken = process.env.METRICS_AUTH_TOKEN || "",
  publicOrigin = process.env.PUBLIC_ORIGIN || "",
  requireExtractorAuth = false,
  requireMetricsAuth = false
} = {}) {
  const safeRoot = resolve(staticRoot);
  const learningNoteAssets = discoverLearningNoteAssets(safeRoot);
  const learningMapAssets = learningNoteAssets.filter((asset) => asset !== "notes/README.md");
  const learningNoteTitles = new Map(learningNoteAssets.map((asset) => [asset, deriveLearningNoteTitle(safeRoot, asset)]));
  const learningNoteSummaries = new Map(learningMapAssets.map((asset) => [asset, deriveLearningNoteMetadata(safeRoot, asset).description]));
  const publicAssets = new Set([...fixedPublicAssets, ...learningNoteAssets]);
  const numericRateLimit = Number(maxRequestsPerMinute);
  const requestLimit = Number.isFinite(numericRateLimit) && numericRateLimit >= 0
    ? Math.floor(numericRateLimit)
    : 60;
  const numericConcurrencyLimit = Number(maxConcurrentExtractors);
  const concurrencyLimit = Number.isSafeInteger(numericConcurrencyLimit)
    && numericConcurrencyLimit >= 1
    && numericConcurrencyLimit <= MAX_CONCURRENT_EXTRACTORS
    ? numericConcurrencyLimit
    : DEFAULT_MAX_CONCURRENT_EXTRACTORS;
  if (typeof extractor !== "function") throw new TypeError("The extractor must be a function.");
  const numericExtractorTimeout = Number(extractorTimeoutMs);
  const extractorTimeout = Number.isFinite(numericExtractorTimeout) && numericExtractorTimeout >= 1
    ? Math.min(120000, Math.floor(numericExtractorTimeout))
    : 120000;
  const authToken = typeof extractorAuthToken === "string" ? extractorAuthToken : "";
  const extractorAuthRequired = requireExtractorAuth === true || Boolean(authToken);
  const metricsToken = typeof metricsAuthToken === "string" ? metricsAuthToken : "";
  const metricsAuthRequired = requireMetricsAuth === true || Boolean(metricsToken);
  const origin = normalizePublicOrigin(publicOrigin);
  const transportSecurityHeaders = origin.startsWith("https://")
    ? { "strict-transport-security": "max-age=31536000; includeSubDomains" }
    : {};
  const rateLimits = new Map();
  const activeExtractors = new Set();
  const idleWaiters = new Set();
  const markExtractorSettled = (controller) => {
    activeExtractors.delete(controller);
    if (!activeExtractors.size) {
      for (const waiter of idleWaiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(true);
      }
      idleWaiters.clear();
    }
  };
  const waitForIdle = ({ timeoutMs = DEFAULT_IDLE_WAIT_TIMEOUT_MS } = {}) => {
    if (!activeExtractors.size) return Promise.resolve(true);
    const numericTimeout = Number(timeoutMs);
    const boundedTimeout = Number.isFinite(numericTimeout) && numericTimeout >= 0
      ? Math.min(120000, Math.floor(numericTimeout))
      : DEFAULT_IDLE_WAIT_TIMEOUT_MS;
    return new Promise((resolve) => {
      const waiter = {
        timer: setTimeout(() => {
          idleWaiters.delete(waiter);
          resolve(false);
        }, boundedTimeout),
        resolve
      };
      idleWaiters.add(waiter);
    });
  };
  const processStartedAt = Date.now();
  const metrics = {
    requests: 0,
    extractionRequests: 0,
    extractionSuccesses: 0,
    extractionFailures: 0,
    authenticationFailures: 0,
    rateLimited: 0,
    concurrencyLimited: 0,
    extractionLatencyBuckets: Array(EXTRACTION_LATENCY_BUCKETS_MS.length).fill(0),
    extractionLatencySumMs: 0,
    extractionLatencyCount: 0,
    responsesByStatus: new Map()
  };
  let readinessCache = null;
  let readinessCheck = null;
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
  const inspectReadiness = async () => {
    try {
      const realRoot = await realpath(safeRoot);
      const readinessAssets = new Set([...fixedPublicAssets, ...learningNoteAssets]);
      let readinessBytes = 0;
      for (const asset of readinessAssets) {
        const shellPath = await realpath(resolve(realRoot, asset));
        if (shellPath !== resolve(realRoot, asset) && !shellPath.startsWith(`${realRoot}/`)) throw new Error("Static shell escapes root.");
        const metadata = await stat(shellPath);
        if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_STATIC_ASSET_BYTES) throw new Error("Static shell asset is missing, empty, or oversized.");
        readinessBytes += metadata.size;
        if (readinessBytes > MAX_PUBLIC_ASSET_BYTES) throw new Error("Static public assets exceed the aggregate asset limit.");
      }
      for (const asset of learningMapAssets) {
        const notePath = await realpath(resolve(realRoot, asset));
        const content = decodeUtf8(await readBoundedFile(notePath, MAX_STATIC_ASSET_BYTES));
        const noteId = asset.slice("notes/".length, -".md".length);
        const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim()?.slice(0, 200) || fallbackLearningNoteTitle(asset);
        const page = buildLearningNotePage({
          id: noteId,
          title,
          description: deriveLearningNoteSummary(content, title),
          content,
          origin
        });
        const pageBytes = Buffer.byteLength(page);
        if (pageBytes > MAX_STATIC_ASSET_BYTES) throw new Error("Generated learning note page is oversized.");
        readinessBytes += pageBytes;
        if (readinessBytes > MAX_PUBLIC_ASSET_BYTES) throw new Error("Generated public assets exceed the aggregate asset limit.");
      }
      return { status: 200, payload: { ok: true, schema: GRAPH_SCHEMA, version: APP_VERSION, ready: true } };
    } catch {
      return { status: 503, payload: { ok: false, schema: GRAPH_SCHEMA, version: APP_VERSION, ready: false, error: "Static app shell is unavailable." } };
    }
  };
  const server = createServer({
    maxHeaderSize: MAX_HEADER_BYTES,
    requestTimeout: REQUEST_TIMEOUT_MS,
    headersTimeout: HEADERS_TIMEOUT_MS,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS
  }, async (request, response) => {
    try {
      response.securityHeaders = { ...securityHeaders, ...transportSecurityHeaders };
      const requestId = randomUUID();
      response.setHeader("x-request-id", requestId);
      metrics.requests += 1;
      response.once("finish", () => {
        const status = String(response.statusCode || 0);
        metrics.responsesByStatus.set(status, (metrics.responsesByStatus.get(status) || 0) + 1);
      });
      let requestPath;
      try {
        requestPath = new URL(request.url || "/", "http://localhost").pathname;
      } catch {
        sendEmpty(response, 400);
        return;
      }
      if (["GET", "HEAD"].includes(request.method) && requestPath === "/healthz") {
        sendJson(response, 200, { ok: true, schema: GRAPH_SCHEMA, version: APP_VERSION }, {}, request.method === "HEAD");
        return;
      }
      if (["GET", "HEAD"].includes(request.method) && requestPath === "/feed.xml") {
        if (!origin) {
          sendEmpty(response, 404);
          return;
        }
        const base = `${origin}/`;
        const noteEntries = learningMapAssets.map((asset) => {
          const noteId = asset.slice("notes/".length, -".md".length);
          const url = new URL(`./notes/${encodeURIComponent(noteId)}.html`, base).toString();
          const title = learningNoteTitles.get(asset) || deriveLearningNoteTitle(safeRoot, asset);
          const description = learningNoteSummaries.get(asset) || `LLM Field Notes learning note: ${title}.`;
          return [
            "  <entry>",
            `    <id>${xmlEscape(url)}</id>`,
            `    <title>${xmlEscape(title)}</title>`,
            `    <updated>${FEED_UPDATED_AT}</updated>`,
            `    <link href="${xmlEscape(url)}" />`,
            `    <summary type="text">${xmlEscape(description)}</summary>`,
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
        if (Buffer.byteLength(body) > MAX_CRAWLER_RESPONSE_BYTES) {
          sendEmpty(response, 503, { "retry-after": "60" });
          return;
        }
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
          ...learningMapAssets.flatMap((asset) => {
            const noteId = asset.slice("notes/".length, -".md".length);
            return [
              new URL(`./${asset}`, base).toString(),
              new URL(`./notes/${encodeURIComponent(noteId)}.html`, base).toString()
            ];
          })
        ];
        const body = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`),
          "</urlset>",
          ""
        ].join("\n");
        if (Buffer.byteLength(body) > MAX_CRAWLER_RESPONSE_BYTES) {
          sendEmpty(response, 503, { "retry-after": "60" });
          return;
        }
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
      const notePageMatch = requestPath.match(/^\/notes\/([^/]+)\.html$/);
      if (["GET", "HEAD"].includes(request.method) && notePageMatch) {
        let noteId;
        try {
          noteId = decodeURIComponent(notePageMatch[1]);
        } catch {
          sendEmpty(response, 400);
          return;
        }
        const noteAsset = `notes/${noteId}.md`;
        if (!learningNoteAssets.includes(noteAsset) || noteId === "README") {
          sendEmpty(response, 404);
          return;
        }
        try {
          const realRoot = await realpath(safeRoot);
          const resolvedNote = await realpath(resolve(realRoot, noteAsset));
          if (resolvedNote !== realRoot && !resolvedNote.startsWith(`${realRoot}/`)) {
            sendEmpty(response, 404);
            return;
          }
          const noteMetadata = await stat(resolvedNote);
          if (!noteMetadata.isFile()) {
            sendEmpty(response, 404);
            return;
          }
          if (noteMetadata.size > MAX_STATIC_ASSET_BYTES) {
            sendEmpty(response, 413);
            return;
          }
          const content = decodeUtf8(await readBoundedFile(resolvedNote, MAX_STATIC_ASSET_BYTES));
          const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim()?.slice(0, 200) || fallbackLearningNoteTitle(noteAsset);
          const body = buildLearningNotePage({
            id: noteId,
            title,
            description: deriveLearningNoteSummary(content, title),
            content,
            origin
          });
          if (Buffer.byteLength(body) > MAX_STATIC_ASSET_BYTES) {
            sendEmpty(response, 413);
            return;
          }
          const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
          const cacheControl = "public, max-age=3600";
          if (matchesEtag(request.headers["if-none-match"], etag)) {
            sendNotModified(response, etag, cacheControl, { "content-security-policy": learningNotePageCsp });
            return;
          }
          sendHtml(response, 200, body, {
            etag,
            "cache-control": cacheControl,
            "content-security-policy": learningNotePageCsp
          }, request.method === "HEAD");
        } catch (error) {
          const notFound = ["ENOENT", "ELOOP", "ENOTDIR"].includes(error?.code);
          const tooLarge = error?.code === "FILE_TOO_LARGE";
          if (!notFound && !tooLarge) safeLog({ status: 500, route: "note-page", error: error?.code || "NOTE_PAGE_FAILURE" });
          sendEmpty(response, notFound ? 404 : tooLarge ? 413 : 500);
        }
        return;
      }
      if (["GET", "HEAD"].includes(request.method) && requestPath === "/metrics") {
        if (metricsAuthRequired && !metricsToken) {
          sendJson(response, 503, { error: "Metrics authentication is not configured." }, { "retry-after": "60" }, request.method === "HEAD");
          return;
        }
        if (metricsAuthRequired && !hasValidBearerToken(request, metricsToken)) {
          sendJson(response, 401, { error: "Authentication is required for metrics." }, { "www-authenticate": "Bearer" }, request.method === "HEAD");
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
          "# HELP llm_field_notes_concurrency_limited_total Extraction requests rejected because provider capacity is full.",
          "# TYPE llm_field_notes_concurrency_limited_total counter",
          `llm_field_notes_concurrency_limited_total ${metrics.concurrencyLimited}`,
          "# HELP llm_field_notes_extraction_duration_ms Extraction request latency distribution in milliseconds.",
          "# TYPE llm_field_notes_extraction_duration_ms histogram",
          ...EXTRACTION_LATENCY_BUCKETS_MS.map((bucket, index) => `llm_field_notes_extraction_duration_ms_bucket{le="${bucket}"} ${metrics.extractionLatencyBuckets[index]}`),
          `llm_field_notes_extraction_duration_ms_bucket{le="+Inf"} ${metrics.extractionLatencyCount}`,
          `llm_field_notes_extraction_duration_ms_sum ${metrics.extractionLatencySumMs}`,
          `llm_field_notes_extraction_duration_ms_count ${metrics.extractionLatencyCount}`,
          "# HELP llm_field_notes_extractions_in_flight Current provider extraction operations.",
          "# TYPE llm_field_notes_extractions_in_flight gauge",
          `llm_field_notes_extractions_in_flight ${activeExtractors.size}`,
          "# HELP llm_field_notes_extractor_concurrency_limit Configured maximum provider extraction operations.",
          "# TYPE llm_field_notes_extractor_concurrency_limit gauge",
          `llm_field_notes_extractor_concurrency_limit ${concurrencyLimit}`,
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
      if (["GET", "HEAD"].includes(request.method) && requestPath === "/readyz") {
        if (server.isDraining) {
          sendJson(response, 503, { ok: false, schema: GRAPH_SCHEMA, version: APP_VERSION, ready: false, error: "Server is draining." }, { "retry-after": "5" }, request.method === "HEAD");
          return;
        }
        const now = Date.now();
        if (!readinessCache || readinessCache.expiresAt <= now) {
          if (!readinessCheck) readinessCheck = inspectReadiness().finally(() => {
            readinessCheck = null;
          });
          const result = await readinessCheck;
          readinessCache = { ...result, expiresAt: Date.now() + READINESS_CACHE_TTL_MS };
        }
        sendJson(
          response,
          readinessCache.status,
          readinessCache.payload,
          readinessCache.status === 503 ? { "retry-after": "5" } : {},
          request.method === "HEAD"
        );
        return;
      }
      if (requestPath === "/api/extract-graph" && request.method !== "POST") {
        sendEmpty(response, 405, { allow: "POST" });
        return;
      }
      if (request.method === "POST" && requestPath === "/api/extract-graph") {
      if (server.isDraining) {
          discardRequestBody(request, response);
          sendJson(response, 503, { error: "Server is draining." }, { "retry-after": "5" });
          return;
        }
        metrics.extractionRequests += 1;
        const startedAt = Date.now();
        const respondJson = (status, payload, extraHeaders = {}, logFields = {}) => {
          const durationMs = Date.now() - startedAt;
          observeExtractionLatency(durationMs);
          if (status === 200) metrics.extractionSuccesses += 1;
          else metrics.extractionFailures += 1;
          sendJson(response, status, payload, { "x-request-id": requestId, ...extraHeaders });
          safeLog({ requestId, status, durationMs, route: "extract-graph", ...logFields });
        };
        const rejectForCapacity = () => {
          metrics.concurrencyLimited += 1;
          respondJson(
            503,
            { error: "Extractor capacity is temporarily full. Try again shortly." },
            { "retry-after": "1" },
            { error: "EXTRACTOR_CAPACITY" }
          );
        };
        if (!hasAllowedRequestOrigin(request, origin)) {
          discardRequestBody(request, response);
          respondJson(403, { error: "The extraction endpoint only accepts same-origin browser requests." }, {}, { error: "ORIGIN_REJECTED" });
          return;
        }
        const clientKey = request.socket.remoteAddress || "unknown";
        const now = Date.now();
        for (const [key, entry] of rateLimits) {
          if (now - entry.startedAt >= 60000) rateLimits.delete(key);
        }
        if (!rateLimits.has(clientKey) && rateLimits.size >= MAX_RATE_LIMIT_KEYS) {
          discardRequestBody(request, response);
          respondJson(503, { error: "Rate limiter capacity is temporarily exhausted." }, { "retry-after": "60" });
          return;
        }
        const current = rateLimits.get(clientKey);
        const windowStart = current && now - current.startedAt < 60000 ? current.startedAt : now;
        const count = current && windowStart === current.startedAt ? current.count + 1 : 1;
        rateLimits.set(clientKey, { startedAt: windowStart, count });
        if (count > requestLimit) {
          discardRequestBody(request, response);
          metrics.rateLimited += 1;
          const retryAfter = Math.max(1, Math.ceil((windowStart + 60000 - now) / 1000));
          respondJson(429, { error: "Extraction rate limit exceeded." }, { "retry-after": String(retryAfter) });
          return;
        }
        if (extractorAuthRequired && !authToken) {
          discardRequestBody(request, response);
          respondJson(503, { error: "Extraction authentication is not configured." }, { "retry-after": "60" }, { error: "AUTH_NOT_CONFIGURED" });
          return;
        }
        if (extractorAuthRequired && !hasValidBearerToken(request, authToken)) {
          discardRequestBody(request, response);
          metrics.authenticationFailures += 1;
          respondJson(401, { error: "Authentication is required for extraction." }, { "www-authenticate": "Bearer" }, { error: "AUTH_REQUIRED" });
          return;
        }
        const requestContentType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
        if (requestContentType !== "application/json") {
          discardRequestBody(request, response);
          respondJson(415, { error: "The extraction endpoint requires application/json." });
          return;
        }
        if (activeExtractors.size >= concurrencyLimit) {
          discardRequestBody(request, response);
          rejectForCapacity();
          return;
        }
        let body;
        try {
          body = JSON.parse(await readBody(request, response));
        } catch (error) {
          if ((request.aborted || response.destroyed || error?.code === "REQUEST_ABORTED") && error?.statusCode !== 413) return;
          respondJson(error?.statusCode || 400, { error: error instanceof Error ? error.message : "Invalid JSON." });
          return;
        }
        const document = body?.document;
        const rawFeedback = Array.isArray(body?.feedback) ? body.feedback : null;
        const feedbackWithinCount = Array.isArray(rawFeedback) && rawFeedback.length <= MAX_FEEDBACK_EXAMPLES;
        const compactFeedback = feedbackWithinCount ? rawFeedback.map(compactFeedbackHint) : null;
        const feedbackSerialized = feedbackWithinCount ? JSON.stringify(rawFeedback) : null;
        const rawDocumentUri = document?.uri;
        const normalizedDocumentUri = typeof rawDocumentUri === "string" && rawDocumentUri.trim() ? normalizeSourceUri(rawDocumentUri) : null;
        const invalidDocumentUri = rawDocumentUri !== undefined && rawDocumentUri !== null
          && (typeof rawDocumentUri !== "string" || (rawDocumentUri.trim() && !normalizedDocumentUri));
        const validFeedback = feedbackWithinCount
          && compactFeedback.every(Boolean)
          && typeof feedbackSerialized === "string"
          && feedbackSerialized.length <= MAX_FEEDBACK_CHARS;
        if (!hasOnlyKeys(body, EXTRACTOR_REQUEST_KEYS) || !hasOnlyKeys(document, EXTRACTOR_DOCUMENT_KEYS) || body?.operation !== "extract-graph" || body?.schema !== GRAPH_SCHEMA || body?.feedbackFormat !== FEEDBACK_FORMAT || !validFeedback || !document || typeof document.title !== "string" || document.title.length > 200 || (document.uri !== undefined && (typeof document.uri !== "string" || document.uri.length > MAX_SOURCE_URI_CHARS)) || invalidDocumentUri || typeof document.text !== "string") {
          const status = Array.isArray(rawFeedback) && typeof feedbackSerialized === "string" && feedbackSerialized.length > MAX_FEEDBACK_CHARS ? 413 : 400;
          respondJson(status, { error: status === 413 ? "Reviewed feedback exceeds the 500,000 character limit." : "Expected the llm-field-notes extract-graph request contract." });
          return;
        }
        if (document.text.trim().length < 40 || document.text.length > MAX_DOCUMENT_CHARS) {
          respondJson(400, { error: "Document text must be between 40 and 300,000 characters." });
          return;
        }
        if (activeExtractors.size >= concurrencyLimit) {
          rejectForCapacity();
          return;
        }
        let timeoutHandle;
        let requestAbortHandler;
        let responseCloseHandler;
        let controller;
        let extractionSettled = false;
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
          const extractionPromise = Promise.resolve()
            .then(() => extractor({
              document: { title: document.title, text: document.text, ...(normalizedDocumentUri ? { uri: normalizedDocumentUri } : {}) },
              title: document.title,
              text: document.text,
              feedback: compactFeedback,
              requestId,
              signal: controller.signal
            }))
            .then(
              (value) => {
                extractionSettled = true;
                markExtractorSettled(controller);
                return value;
              },
              (error) => {
                extractionSettled = true;
                markExtractorSettled(controller);
                throw error;
              }
            );
          const rawExtraction = await Promise.race([
            extractionPromise,
            new Promise((_, reject) => {
              timeoutHandle = setTimeout(() => {
                controller.abort();
                reject(Object.assign(new Error("Extractor timed out."), { code: "EXTRACTOR_TIMEOUT" }));
              }, extractorTimeout);
            })
          ]);
          if (!rawExtraction || typeof rawExtraction !== "object" || Array.isArray(rawExtraction)) {
            throw Object.assign(new Error("The configured extractor returned an invalid extraction shape."), { code: "EXTRACTOR_INVALID_RESPONSE" });
          }
          if (rawExtraction.schema !== undefined && rawExtraction.schema !== GRAPH_SCHEMA) {
            throw Object.assign(new Error("The configured extractor returned an incompatible graph schema."), { code: "EXTRACTOR_INVALID_RESPONSE" });
          }
          const extraction = normalizeExtractionForDocument(
            rawExtraction,
            { title: document.title, text: document.text, uri: normalizedDocumentUri }
          );
          const responsePayload = {
              schema: GRAPH_SCHEMA,
              extraction,
              feedbackFormat: FEEDBACK_FORMAT,
              feedbackReceived: compactFeedback.length
          };
          if (Buffer.byteLength(JSON.stringify(responsePayload)) > MAX_RESPONSE_BYTES) {
            throw Object.assign(new Error("Extractor response exceeds the 10 MB safety limit."), { code: "EXTRACTOR_RESPONSE_TOO_LARGE" });
          }
          if (!request.aborted && !response.destroyed && !response.writableEnded) {
            respondJson(200, responsePayload, {}, { documentChars: document.text.length, feedbackCount: compactFeedback.length });
          }
        } catch (error) {
          if (request.aborted || response.destroyed) return;
          const timedOut = error?.code === "EXTRACTOR_TIMEOUT";
          const responseTooLarge = error?.code === "EXTRACTOR_RESPONSE_TOO_LARGE";
          const diagnosticCode = safeDiagnosticCode(error?.code, timedOut
            ? "EXTRACTOR_TIMEOUT"
            : responseTooLarge
              ? "EXTRACTOR_RESPONSE_TOO_LARGE"
              : "EXTRACTOR_FAILURE");
          respondJson(
            timedOut ? 504 : 502,
            { error: timedOut ? "The configured extractor timed out. Try again or increase the provider capacity." : responseTooLarge ? "The extractor response exceeded the 10 MB safety limit." : "The configured extractor failed. Try again or inspect the provider logs." },
            {},
            { error: diagnosticCode, documentChars: document.text.length, feedbackCount: compactFeedback.length }
          );
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (requestAbortHandler) request.removeListener("aborted", requestAbortHandler);
          if (responseCloseHandler) response.removeListener("close", responseCloseHandler);
          if (controller && extractionSettled) markExtractorSettled(controller);
        }
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendEmpty(response, 405, { allow: "GET, HEAD, POST" });
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(requestPath);
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
      let content;
      try {
        content = await readBoundedFile(resolvedFilePath, MAX_STATIC_ASSET_BYTES);
      } catch (error) {
        if (error?.code === "FILE_TOO_LARGE") {
          sendEmpty(response, 413);
          return;
        }
        throw error;
      }
      const responseContent = relative === "index.html" ? renderOriginAwareIndex(content, origin) : content;
      const responseSecurityHeaders = {
        ...(relative === "index.html" ? securityHeadersForIndex(responseContent) : securityHeaders),
        ...transportSecurityHeaders
      };
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
          ...responseSecurityHeaders
        });
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": relative === "LICENSE" ? "text/plain; charset=utf-8" : types[extname(resolvedFilePath)] || "application/octet-stream",
        "cache-control": cacheControl,
        "content-length": responseContent.byteLength,
        etag,
        ...responseSecurityHeaders
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
    extractorConcurrencyLimit: concurrencyLimit,
    responsesByStatus: Object.fromEntries(metrics.responsesByStatus),
    extractionLatencyBuckets: [...metrics.extractionLatencyBuckets],
    extractionsInFlight: activeExtractors.size,
    uptimeSeconds: Math.max(0, (Date.now() - processStartedAt) / 1000)
  });
  server.abortActiveExtractors = () => {
    for (const controller of activeExtractors) controller.abort();
  };
  server.waitForIdle = waitForIdle;
  server.beginDrain = () => {
    if (server.isDraining) return false;
    server.isDraining = true;
    server.abortActiveExtractors();
    server.closeIdleConnections?.();
    return true;
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
  const configuredConcurrency = Number(process.env.EXTRACTOR_CONCURRENCY);
  const maxConcurrentExtractors = Number.isSafeInteger(configuredConcurrency) && configuredConcurrency >= 1
    ? Math.min(MAX_CONCURRENT_EXTRACTORS, configuredConcurrency)
    : DEFAULT_MAX_CONCURRENT_EXTRACTORS;
  const loopbackHost = new Set(["127.0.0.1", "::1", "localhost"]).has(host.toLowerCase());
  const server = createAppServer({
    maxRequestsPerMinute,
    maxConcurrentExtractors,
    extractorTimeoutMs,
    extractorAuthToken: process.env.EXTRACTOR_AUTH_TOKEN || "",
    metricsAuthToken: process.env.METRICS_AUTH_TOKEN || "",
    publicOrigin: process.env.PUBLIC_ORIGIN || "",
    requireExtractorAuth: !loopbackHost,
    requireMetricsAuth: !loopbackHost,
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
    console.log(`Received ${signal}; draining active requests.`);
    server.beginDrain?.();
    const forceExit = setTimeout(() => process.exit(1), 5000);
    forceExit.unref();
    const closePromise = new Promise((resolve) => server.close(resolve));
    Promise.all([closePromise, server.waitForIdle?.() || Promise.resolve(true)]).then(([, idle]) => {
      clearTimeout(forceExit);
      process.exit(idle ? 0 : 1);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
