import { createServer } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { closeSync, constants as fsConstants, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { FEEDBACK_FORMAT, GRAPH_SCHEMA, MAX_DOCUMENT_CHARS, MAX_DOCUMENT_TITLE_CHARS, MAX_FEEDBACK_EXAMPLES, MAX_FEEDBACK_LABEL_CHARS, MAX_ID_CHARS, MAX_SOURCE_URI_CHARS, extractGraph, normalizeExtractionForDocument, normalizeSourceUri, parseJsonWithUniqueKeys, relationSemanticKey, slugify } from "./graph-core.js";
import { MAX_FEEDBACK_CHARS, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } from "./extractor-adapter.js";
import { createConfiguredProviderExtractor } from "./provider-adapter.js";
import { FIXED_PUBLIC_ASSETS, MAX_LEARNING_NOTE_ASSETS, MAX_PUBLIC_ASSET_BYTES, MAX_STATIC_ASSET_BYTES, PUBLIC_SITEMAP_ASSETS } from "./scripts/public-assets.mjs";
import { requirePublicOrigin } from "./scripts/public-origin.mjs";
import { DEFAULT_PUBLIC_REPOSITORY, requirePublicRepository } from "./scripts/public-repository.mjs";
import { buildLearningNotePage, MAX_NOTE_SUMMARY_CHARS, sliceTextAtCodePointBoundary } from "./scripts/note-page.mjs";
import { buildSampleGraphPage } from "./scripts/sample-graph-page.mjs";

const require = createRequire(import.meta.url);
const APP_VERSION = require("./package.json").version;
const rawBuildRevision = typeof process.env.BUILD_REVISION === "string" ? process.env.BUILD_REVISION.trim() : "";
const BUILD_REVISION = /^(?:unknown|[0-9a-f]{7,64})$/i.test(rawBuildRevision)
  ? rawBuildRevision.toLowerCase()
  : "unknown";
const RELEASE_DATE = require("./version.json").date;
const FEED_UPDATED_AT = /^\d{4}-\d{2}-\d{2}$/.test(RELEASE_DATE)
  ? `${RELEASE_DATE}T00:00:00.000Z`
  : "1970-01-01T00:00:00.000Z";
const MAX_BODY_BYTES = MAX_REQUEST_BYTES;
const MAX_RATE_LIMIT_KEYS = 10000;
const RATE_LIMIT_SWEEP_INTERVAL_MS = 1000;
const MAX_TRUSTED_PROXY_HOPS = 8;
export const DEFAULT_MAX_CONCURRENT_EXTRACTORS = 8;
const MAX_CONCURRENT_EXTRACTORS = 1024;
const REQUEST_TIMEOUT_MS = 30000;
const HEADERS_TIMEOUT_MS = 15000;
const KEEP_ALIVE_TIMEOUT_MS = 5000;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_CRAWLER_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RUNTIME_TEXT_CHARS = Math.floor(MAX_STATIC_ASSET_BYTES / 4);
const TEXT_ASSET_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".svg", ".txt", ".webmanifest", ".xml"]);
const NO_CACHE_STATIC_ASSETS = new Set([
  "index.html",
  "artifacts.html",
  "404.html",
  "manifest.webmanifest",
  "sw.js",
  "version.json"
]);
export const MIN_AUTH_TOKEN_CHARS = 16;
const MAX_AUTH_TOKEN_CHARS = 4096;
const READ_ONLY_NOFOLLOW_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
const DEFAULT_IDLE_WAIT_TIMEOUT_MS = 5000;
const READINESS_CACHE_TTL_MS = 5000;
const DEFAULT_READINESS_TIMEOUT_MS = 5000;
const MAX_READINESS_TIMEOUT_MS = 30000;
const HTTP_LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1000, 5000, 30000];
const EXTRACTION_LATENCY_BUCKETS_MS = [100, 500, 1000, 5000, 30000, 120000];
const root = fileURLToPath(new URL("./", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".canvas": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};
const fixedPublicAssets = FIXED_PUBLIC_ASSETS;
const decodeUtf8 = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const SERVICE_WORKER_CACHE_MARKER = `const CACHE = "llm-field-notes-v${APP_VERSION}"`;
const SAMPLE_GRAPH_PAGE = "sample-graph.html";

export function parseTrustedProxyHops(value) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { value: 0, valid: true, configured: false };
  }
  const normalized = typeof value === "string" ? value.trim() : value;
  if (typeof normalized === "string" && !/^\d+$/.test(normalized)) {
    return { value: 0, valid: false, configured: true };
  }
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > MAX_TRUSTED_PROXY_HOPS) {
    return { value: 0, valid: false, configured: true };
  }
  return { value: numeric, valid: true, configured: true };
}

export function parseConfiguredBoundedInteger(name, value, {
  defaultValue,
  min = 1,
  max = Number.MAX_SAFE_INTEGER
} = {}) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { value: defaultValue, configured: false, valid: true };
  }
  const normalized = typeof value === "string" ? value.trim() : value;
  if ((typeof normalized === "string" && !/^\d+$/.test(normalized))
    || (typeof normalized !== "string" && !Number.isSafeInteger(normalized))) {
    return { value: defaultValue, configured: true, valid: false };
  }
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
    return { value: defaultValue, configured: true, valid: false };
  }
  return { value: numeric, configured: true, valid: true };
}

function validateRuntimeReleaseMetadata(content) {
  let release;
  try {
    release = parseJsonWithUniqueKeys(content, "Release metadata");
  } catch {
    throw new Error("Release metadata is invalid.");
  }
  const releaseDate = /^\d{4}-\d{2}-\d{2}$/.test(release?.date)
    ? new Date(`${release.date}T00:00:00.000Z`)
    : null;
  if (!release
    || typeof release !== "object"
    || Array.isArray(release)
    || release.version !== APP_VERSION
    || !["stable", "unreleased"].includes(release.channel)
    || !/^\d{4}-\d{2}-\d{2}$/.test(release.date)
    || !releaseDate
    || Number.isNaN(releaseDate.getTime())
    || releaseDate.toISOString().slice(0, 10) !== release.date
    || releaseDate.getTime() > Date.now()) {
    throw new Error("Release metadata is invalid.");
  }
}

function renderServiceWorker(content) {
  const source = content.toString("utf8");
  if (BUILD_REVISION === "unknown" || !source.includes(SERVICE_WORKER_CACHE_MARKER)) return content;
  const cacheKey = `${SERVICE_WORKER_CACHE_MARKER.slice(0, -1)}-${BUILD_REVISION.slice(0, 16)}"`;
  return Buffer.from(source.replace(SERVICE_WORKER_CACHE_MARKER, cacheKey), "utf8");
}

function renderRuntimeReleaseMetadata(content) {
  const release = parseJsonWithUniqueKeys(content.toString("utf8"), "Release metadata");
  return Buffer.from(`${JSON.stringify({ ...release, revision: BUILD_REVISION }, null, 2)}\n`, "utf8");
}

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
  const file = openSync(filePath, READ_ONLY_NOFOLLOW_FLAGS);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const textChunks = [];
  let textLength = 0;
  let offset = 0;
  try {
    while (offset < byteLimit) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, byteLimit - offset));
      const bytesRead = readSync(file, buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      offset += bytesRead;
      const decoded = decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      if (decoded) {
        textChunks.push(decoded);
        textLength += decoded.length;
        if (textLength >= characterLimit) {
          return sliceTextAtCodePointBoundary(textChunks.join(""), characterLimit);
        }
      }
    }
    const tail = decoder.decode();
    if (tail) textChunks.push(tail);
    const content = textChunks.join("");
    return sliceTextAtCodePointBoundary(content, characterLimit);
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
  const handle = await open(filePath, READ_ONLY_NOFOLLOW_FLAGS);
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
    if (heading) return sliceTextAtCodePointBoundary(heading, MAX_DOCUMENT_TITLE_CHARS);
  } catch {
    // Readiness and static serving report missing note files separately.
  }
  return fallbackLearningNoteTitle(asset);
}

function deriveLearningNoteSummary(content, title) {
  const boundedContent = sliceTextAtCodePointBoundary(content, MAX_NOTE_SUMMARY_CHARS);
  const question = boundedContent.match(/^>\s*(.+)$/m)?.[1]?.trim() || "";
  const withoutFrontmatter = boundedContent.replace(/^---[\s\S]*?---\s*/m, "");
  const paragraphs = withoutFrontmatter.replace(/^#+\s+.+$/gm, "").split(/\n\s*\n/).map((paragraph) => paragraph
    .replace(/^>\s?/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim())
    .filter((paragraph) => paragraph && paragraph !== title && paragraph !== question);
  return sliceTextAtCodePointBoundary([question, paragraphs[0] || title].filter(Boolean).join(" "), 280);
}

function deriveLearningNoteMetadata(staticRoot, asset) {
  try {
    const resolvedRoot = realpathSync(staticRoot);
    const resolvedFile = realpathSync(resolve(resolvedRoot, asset));
    if (resolvedFile === resolvedRoot || !resolvedFile.startsWith(`${resolvedRoot}/`) || !statSync(resolvedFile).isFile()) {
      return { title: fallbackLearningNoteTitle(asset), description: "" };
    }
    const content = readBoundedUtf8(resolvedFile, MAX_NOTE_SUMMARY_CHARS);
    const title = sliceTextAtCodePointBoundary(content.match(/^#\s+(.+)$/m)?.[1]?.trim() || "", MAX_DOCUMENT_TITLE_CHARS) || fallbackLearningNoteTitle(asset);
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
const artifactPageCsp = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; worker-src 'none'; manifest-src 'none'";

export function canWriteResponse(response) {
  return !(response?.destroyed || response?.headersSent || response?.writableEnded);
}

function sendJson(response, status, payload, extraHeaders = {}, head = false) {
  if (!canWriteResponse(response)) return false;
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
  if (!canWriteResponse(response)) return false;
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
  if (!canWriteResponse(response)) return false;
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
  if (!canWriteResponse(response)) return false;
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
  if (!canWriteResponse(response)) return false;
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
  if (!canWriteResponse(response)) return false;
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
  if (!canWriteResponse(response)) return false;
  response.writeHead(304, {
    etag,
    "cache-control": cacheControl,
    ...(response.securityHeaders || securityHeaders),
    ...extraHeaders
  });
  response.end();
  return true;
}

function renderOriginAwareIndex(content, origin, repository = DEFAULT_PUBLIC_REPOSITORY) {
  const source = content.toString("utf8").replaceAll(DEFAULT_PUBLIC_REPOSITORY, repository);
  if (!origin) return Buffer.from(source, "utf8");
  const rootUrl = `${origin}/`;
  const rendered = source
    .replace('href="./" />', () => `href="${rootUrl}" />`)
    .replace('href="feed.xml"', () => `href="${origin}/feed.xml"`)
    .replace('content="./" />', () => `content="${rootUrl}" />`)
    .replace('"url": "./"', () => `"url": "${rootUrl}"`)
    .replace(/content="social-card\.png"/g, () => `content="${origin}/social-card.png"`);
  const structuredDataMatch = rendered.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!structuredDataMatch) return Buffer.from(rendered, "utf8");
  const structuredDataCsp = `'sha256-${createHash("sha256").update(structuredDataMatch[1]).digest("base64")}'`;
  return Buffer.from(rendered.replace(/'sha256-[^']+'/g, structuredDataCsp), "utf8");
}

function renderOriginAwareArtifactPage(content, origin, repository = DEFAULT_PUBLIC_REPOSITORY) {
  const source = content.toString("utf8").replaceAll(DEFAULT_PUBLIC_REPOSITORY, repository);
  if (!origin) return Buffer.from(source, "utf8");
  return Buffer.from(source
    .replace('href="./"', () => `href="${origin}/"`)
    .replace('content="./artifacts.html"', () => `content="${origin}/artifacts.html"`)
    .replace('content="social-card.png"', () => `content="${origin}/social-card.png"`)
    .replace('href="./artifacts.html"', () => `href="${origin}/artifacts.html"`)
    .replace('"@id":"./artifacts.html"', () => `"@id":"${origin}/artifacts.html"`)
    .replace('"url":"./artifacts.html"', () => `"url":"${origin}/artifacts.html"`)
    .replace(/"url":"(experiments\/[^"]+)"/g, (_, asset) => `"url":"${origin}/${asset}"`), "utf8");
}

function renderRepositoryAwareSecurityTxt(content, repository = DEFAULT_PUBLIC_REPOSITORY) {
  return Buffer.from(content.toString("utf8").replaceAll(DEFAULT_PUBLIC_REPOSITORY, repository), "utf8");
}

function renderNotFoundPage(content, origin = "") {
  const base = origin ? `${origin}/` : "/";
  return Buffer.from(content.toString("utf8")
    .replaceAll('href="./styles.css"', `href="${base}styles.css"`)
    .replaceAll('href="./"', `href="${base}"`)
    .replaceAll('href="./artifacts.html"', `href="${base}artifacts.html"`), "utf8");
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

function rateLimitHeaders(limit, count, windowStart, now = Date.now()) {
  const boundedLimit = Math.max(0, Math.floor(Number(limit) || 0));
  const boundedCount = Math.max(0, Math.floor(Number(count) || 0));
  const boundedWindowStart = Number.isFinite(Number(windowStart)) ? Number(windowStart) : now;
  return {
    "ratelimit-limit": String(boundedLimit),
    "ratelimit-remaining": String(Math.max(0, boundedLimit - boundedCount)),
    "ratelimit-reset": String(Math.max(1, Math.ceil((boundedWindowStart + 60000 - now) / 1000)))
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

export function isUsableAuthToken(value) {
  return typeof value === "string"
    && value.length >= MIN_AUTH_TOKEN_CHARS
    && value.length <= MAX_AUTH_TOKEN_CHARS
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isLoopbackPublicOrigin(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    return new Set(["127.0.0.1", "::1", "localhost"]).has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function hasAllowedRequestOrigin(request, publicOrigin) {
  const fetchSite = request.headers["sec-fetch-site"];
  if (typeof fetchSite === "string" && ["cross-site", "same-site"].includes(fetchSite.trim().toLowerCase())) return false;
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

export function resolveRateLimitClientKey(request, trustedProxyHops = 0) {
  const socketAddress = typeof request?.socket?.remoteAddress === "string" && request.socket.remoteAddress
    ? request.socket.remoteAddress
    : "unknown";
  const numericHops = Number(trustedProxyHops);
  if (!Number.isSafeInteger(numericHops) || numericHops < 1 || numericHops > MAX_TRUSTED_PROXY_HOPS) {
    return socketAddress;
  }
  const forwarded = request?.headers?.["x-forwarded-for"];
  if (typeof forwarded !== "string" || forwarded.length > 4096) return socketAddress;
  const addresses = forwarded.split(",").map((value) => value.trim());
  if (!addresses.length || addresses.some((value) => isIP(value) === 0)) return socketAddress;
  return addresses[Math.max(0, addresses.length - numericHops - 1)] || socketAddress;
}

export function safeDiagnosticCode(value, fallback = "EXTRACTOR_FAILURE") {
  if (typeof value !== "string") return fallback;
  const code = value.trim().slice(0, 80);
  return /^[A-Z][A-Z0-9_:-]*$/.test(code) ? code : fallback;
}

const LOG_ENTRY_KEYS = new Set([
  "version",
  "revision",
  "host",
  "port",
  "extractor",
  "event",
  "signal",
  "drained",
  "status",
  "durationMs",
  "route",
  "requestId",
  "error",
  "documentChars",
  "feedbackCount"
]);

export function sanitizeLogEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return {};
  const sanitized = {};
  for (const [key, value] of Object.entries(entry).slice(0, 24)) {
    if (!LOG_ENTRY_KEYS.has(key)) continue;
    if (key === "error") {
      sanitized.error = safeDiagnosticCode(value, "SERVER_FAILURE");
    } else if (typeof value === "string") {
      sanitized[key] = value.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 256);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)));
    } else if (typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return sanitized;
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

const BODY_DISCARD_STARTED = Symbol("bodyDiscardStarted");

function feedbackConflictKeys(value) {
  if (value.kind === "concept") return [`concept|${value.id}`];
  return [
    `relation-id|${value.id}`,
    `relation-semantic|${relationSemanticKey(
      slugify(value.sourceLabel || value.source),
      slugify(value.targetLabel || value.target),
      value.label
    )}`
  ];
}

function hasContradictoryFeedback(values) {
  const statuses = new Map();
  for (const value of values) {
    for (const key of feedbackConflictKeys(value)) {
      const previous = statuses.get(key);
      if (previous && previous !== value.status) return true;
      statuses.set(key, value.status);
    }
  }
  return false;
}

function discardRequestBody(request, response) {
  if (request[BODY_DISCARD_STARTED]) return;
  request[BODY_DISCARD_STARTED] = true;
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
  const declaredLength = parseDeclaredContentLength(request);
  if (declaredLength === null || (Number.isSafeInteger(declaredLength) && declaredLength <= MAX_BODY_BYTES)) {
    request.resume();
    return;
  }
  if (declaredLength > MAX_BODY_BYTES || Number.isNaN(declaredLength)) {
    terminate();
    return;
  }
  terminate();
}

function parseDeclaredContentLength(request) {
  const header = request.headers?.["content-length"];
  if (header === undefined) return null;
  if (typeof header !== "string" || !/^\d+$/.test(header)) return Number.NaN;
  const value = Number(header);
  return Number.isSafeInteger(value) ? value : Number.NaN;
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
      if (declaredLength !== null && size !== declaredLength) {
        settle(reject, Object.assign(new Error("Request body length does not match Content-Length."), { statusCode: 400, code: "REQUEST_LENGTH_MISMATCH" }));
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
    const declaredLength = parseDeclaredContentLength(request);
    if (Number.isNaN(declaredLength)) {
      settle(reject, Object.assign(new Error("Content-Length header is invalid."), { statusCode: 400, code: "INVALID_CONTENT_LENGTH" }));
      discardRequestBody(request, response);
      return;
    }
    if (declaredLength !== null && declaredLength > MAX_BODY_BYTES) {
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
  publicRepository = process.env.PUBLIC_REPOSITORY_URL || "",
  requireExtractorAuth = false,
  requireMetricsAuth = false,
  requireSecurePublicOrigin = false,
  requireBuildRevision = false,
  readinessTimeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
  trustedProxyHops = 0
} = {}) {
  const safeRoot = resolve(staticRoot);
  const learningNoteAssets = discoverLearningNoteAssets(safeRoot);
  const learningMapAssets = learningNoteAssets.filter((asset) => asset !== "notes/README.md");
  const learningNoteTitles = new Map(learningNoteAssets.map((asset) => [asset, deriveLearningNoteTitle(safeRoot, asset)]));
  const learningNoteSummaries = new Map(learningMapAssets.map((asset) => [asset, deriveLearningNoteMetadata(safeRoot, asset).description]));
  const publicAssets = new Set([...fixedPublicAssets, ...learningNoteAssets]);
  const resolveRuntimeAsset = async (realRoot, asset, label = "Static asset") => {
    const filePath = resolve(realRoot, asset);
    const linkMetadata = await lstat(filePath);
    if (linkMetadata.isSymbolicLink()) {
      throw Object.assign(new Error(`${label} must not be a symbolic link.`), { code: "SYMLINK_ASSET" });
    }
    const resolvedFilePath = await realpath(filePath);
    if (resolvedFilePath !== realRoot && !resolvedFilePath.startsWith(`${realRoot}/`)) {
      throw Object.assign(new Error(`${label} escapes its static root.`), { code: "ASSET_ESCAPE" });
    }
    const metadata = await stat(resolvedFilePath);
    return { resolvedFilePath, metadata };
  };
  const staticEtagCache = new Map();
  const getStaticEtag = (asset, signature, content) => {
    const cached = staticEtagCache.get(asset);
    if (cached?.signature === signature) return cached.etag;
    const etag = `"${createHash("sha256").update(content).digest("hex")}"`;
    staticEtagCache.set(asset, { signature, etag });
    while (staticEtagCache.size > publicAssets.size) {
      const oldestAsset = staticEtagCache.keys().next().value;
      if (oldestAsset === undefined) break;
      staticEtagCache.delete(oldestAsset);
    }
    return etag;
  };
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
  const numericReadinessTimeout = Number(readinessTimeoutMs);
  const readinessTimeout = Number.isFinite(numericReadinessTimeout) && numericReadinessTimeout >= 1
    ? Math.min(MAX_READINESS_TIMEOUT_MS, Math.floor(numericReadinessTimeout))
    : DEFAULT_READINESS_TIMEOUT_MS;
  const proxyHops = parseTrustedProxyHops(trustedProxyHops).value;
  const authToken = typeof extractorAuthToken === "string" ? extractorAuthToken : "";
  const extractorAuthRequired = requireExtractorAuth === true || Boolean(authToken);
  const extractorAuthConfigured = isUsableAuthToken(authToken);
  const metricsToken = typeof metricsAuthToken === "string" ? metricsAuthToken : "";
  const metricsAuthRequired = requireMetricsAuth === true || Boolean(metricsToken);
  const metricsAuthConfigured = isUsableAuthToken(metricsToken);
  const origin = requirePublicOrigin(publicOrigin, {
    requireSecure: requireSecurePublicOrigin,
    allowLoopbackHttp: !requireSecurePublicOrigin
  });
  const repository = requirePublicRepository(publicRepository);
  const securePublicOriginConfigured = origin.startsWith("https://")
    || (!requireSecurePublicOrigin && isLoopbackPublicOrigin(origin));
  const transportSecurityHeaders = origin.startsWith("https://")
    ? { "strict-transport-security": "max-age=31536000; includeSubDomains" }
    : {};
  const rateLimits = new Map();
  let nextRateLimitSweepAt = 0;
  const activeExtractors = new Set();
  const activeExtractorDrainRejectors = new Set();
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
    httpRequestsInFlight: 0,
    httpLatencyBuckets: Array(HTTP_LATENCY_BUCKETS_MS.length).fill(0),
    httpLatencySumMs: 0,
    httpLatencyCount: 0,
    extractionRequests: 0,
    extractionSuccesses: 0,
    extractionFailures: 0,
    extractionClientAborts: 0,
    readinessFailures: 0,
    readinessTimeouts: 0,
    authenticationFailures: 0,
    rateLimited: 0,
    concurrencyLimited: 0,
    extractionLatencyBuckets: Array(EXTRACTION_LATENCY_BUCKETS_MS.length).fill(0),
    extractionLatencySumMs: 0,
    extractionLatencyCount: 0,
    trustedProxyHops: proxyHops,
    buildRevision: BUILD_REVISION,
    responsesByStatus: new Map()
  };
  let readinessCache = null;
  let readinessCheck = null;
  const observeHttpLatency = (durationMs) => {
    const boundedDuration = Math.max(0, Math.floor(Number(durationMs) || 0));
    metrics.httpLatencySumMs += boundedDuration;
    metrics.httpLatencyCount += 1;
    HTTP_LATENCY_BUCKETS_MS.forEach((bucket, index) => {
      if (boundedDuration <= bucket) metrics.httpLatencyBuckets[index] += 1;
    });
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
      const result = logger(sanitizeLogEntry(entry));
      result?.catch?.(() => {});
    } catch {
      // Logging must not change request behavior.
    }
  };
  const inspectReadiness = async () => {
    if (requireBuildRevision === true && BUILD_REVISION === "unknown") {
      return {
        status: 503,
        payload: {
          ok: false,
          schema: GRAPH_SCHEMA,
          version: APP_VERSION,
          revision: BUILD_REVISION,
          ready: false,
          error: "A trusted source build revision is not configured."
        }
      };
    }
    if (requireSecurePublicOrigin === true && !securePublicOriginConfigured) {
      return {
        status: 503,
        payload: {
          ok: false,
          schema: GRAPH_SCHEMA,
          version: APP_VERSION,
          revision: BUILD_REVISION,
          ready: false,
          error: "A trusted HTTPS public origin is not configured."
        }
      };
    }
    if (extractorAuthRequired && !extractorAuthConfigured) {
      return {
        status: 503,
        payload: {
          ok: false,
          schema: GRAPH_SCHEMA,
          version: APP_VERSION,
          revision: BUILD_REVISION,
          ready: false,
          error: "Extraction authentication is not configured."
        }
      };
    }
    if (metricsAuthRequired && !metricsAuthConfigured) {
      return {
        status: 503,
        payload: {
          ok: false,
          schema: GRAPH_SCHEMA,
          version: APP_VERSION,
          revision: BUILD_REVISION,
          ready: false,
          error: "Metrics authentication is not configured."
        }
      };
    }
    try {
      const realRoot = await realpath(safeRoot);
      const readinessAssets = new Set([...fixedPublicAssets, ...learningNoteAssets]);
      let readinessBytes = 0;
      for (const asset of readinessAssets) {
        const { resolvedFilePath: shellPath, metadata } = await resolveRuntimeAsset(realRoot, asset, "Static shell asset");
        if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_STATIC_ASSET_BYTES) throw new Error("Static shell asset is missing, empty, or oversized.");
        if (TEXT_ASSET_EXTENSIONS.has(extname(asset).toLowerCase())) {
          const shellContent = decodeUtf8(await readBoundedFile(shellPath, MAX_STATIC_ASSET_BYTES));
          if (asset === "version.json") validateRuntimeReleaseMetadata(shellContent);
        }
        readinessBytes += metadata.size;
        if (readinessBytes > MAX_PUBLIC_ASSET_BYTES) throw new Error("Static public assets exceed the aggregate asset limit.");
      }
      for (const asset of learningMapAssets) {
        const { resolvedFilePath: notePath } = await resolveRuntimeAsset(realRoot, asset, "Learning note");
        const content = decodeUtf8(await readBoundedFile(notePath, MAX_STATIC_ASSET_BYTES));
        const noteId = asset.slice("notes/".length, -".md".length);
        const title = sliceTextAtCodePointBoundary(content.match(/^#\s+(.+)$/m)?.[1]?.trim() || "", MAX_DOCUMENT_TITLE_CHARS) || fallbackLearningNoteTitle(asset);
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
      const sampleGraphAsset = await resolveRuntimeAsset(realRoot, "examples/sample-graph.json", "Sample graph");
      const sampleGraph = parseJsonWithUniqueKeys(
        decodeUtf8(await readBoundedFile(sampleGraphAsset.resolvedFilePath, MAX_STATIC_ASSET_BYTES)),
        "Sample graph"
      );
      const sampleGraphPage = buildSampleGraphPage(sampleGraph, origin);
      if (Buffer.byteLength(sampleGraphPage) > MAX_STATIC_ASSET_BYTES) throw new Error("Generated sample graph page is oversized.");
      readinessBytes += Buffer.byteLength(sampleGraphPage);
      if (readinessBytes > MAX_PUBLIC_ASSET_BYTES) throw new Error("Generated public assets exceed the aggregate asset limit.");
      return { status: 200, payload: { ok: true, schema: GRAPH_SCHEMA, version: APP_VERSION, revision: BUILD_REVISION, ready: true } };
    } catch {
      return { status: 503, payload: { ok: false, schema: GRAPH_SCHEMA, version: APP_VERSION, revision: BUILD_REVISION, ready: false, error: "Static app shell is unavailable." } };
    }
  };
  const server = createServer({
    maxHeaderSize: MAX_HEADER_BYTES,
    requestTimeout: REQUEST_TIMEOUT_MS,
    headersTimeout: HEADERS_TIMEOUT_MS,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS
  }, async (request, response) => {
    const requestId = randomUUID();
    try {
      response.securityHeaders = { ...securityHeaders, ...transportSecurityHeaders };
      response.setHeader("x-request-id", requestId);
      if (request.method !== "POST") discardRequestBody(request, response);
      metrics.requests += 1;
      metrics.httpRequestsInFlight += 1;
      const requestStartedAt = Date.now();
      let requestMetricsSettled = false;
      const observeRequestCompletion = () => {
        if (requestMetricsSettled) return;
        requestMetricsSettled = true;
        metrics.httpRequestsInFlight = Math.max(0, metrics.httpRequestsInFlight - 1);
        observeHttpLatency(Date.now() - requestStartedAt);
      };
      response.once("finish", () => {
        const status = String(response.statusCode || 0);
        metrics.responsesByStatus.set(status, (metrics.responsesByStatus.get(status) || 0) + 1);
        observeRequestCompletion();
      });
      response.once("close", observeRequestCompletion);
      let requestPath;
      try {
        requestPath = new URL(request.url || "/", "http://localhost").pathname;
      } catch {
        sendEmpty(response, 400);
        return;
      }
      if (["GET", "HEAD"].includes(request.method) && ["/healthz", "/livez"].includes(requestPath)) {
        sendJson(response, 200, { ok: true, live: true, schema: GRAPH_SCHEMA, version: APP_VERSION, revision: BUILD_REVISION }, {}, request.method === "HEAD");
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
        const cacheControl = "no-cache";
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
          ...PUBLIC_SITEMAP_ASSETS.map((asset) => new URL(`./${asset}`, base).toString()),
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
        const cacheControl = "no-cache";
        if (matchesEtag(request.headers["if-none-match"], etag)) {
          sendNotModified(response, etag, cacheControl);
          return;
        }
        sendXml(response, 200, body, { "cache-control": cacheControl, etag }, request.method === "HEAD");
        return;
      }
      if (["GET", "HEAD"].includes(request.method) && requestPath === "/robots.txt" && origin) {
        const body = `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
        const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
        const cacheControl = "no-cache";
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
          const { resolvedFilePath: resolvedNote, metadata: noteMetadata } = await resolveRuntimeAsset(realRoot, noteAsset, "Learning note");
          if (!noteMetadata.isFile()) {
            sendEmpty(response, 404);
            return;
          }
          if (noteMetadata.size > MAX_STATIC_ASSET_BYTES) {
            sendEmpty(response, 413);
            return;
          }
          const content = decodeUtf8(await readBoundedFile(resolvedNote, MAX_STATIC_ASSET_BYTES));
          const title = sliceTextAtCodePointBoundary(content.match(/^#\s+(.+)$/m)?.[1]?.trim() || "", MAX_DOCUMENT_TITLE_CHARS) || fallbackLearningNoteTitle(noteAsset);
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
          const cacheControl = "no-cache";
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
          const notFound = ["ENOENT", "ELOOP", "ENOTDIR", "SYMLINK_ASSET", "ASSET_ESCAPE"].includes(error?.code);
          const tooLarge = error?.code === "FILE_TOO_LARGE";
          if (!notFound && !tooLarge) safeLog({ status: 500, route: "note-page", error: error?.code || "NOTE_PAGE_FAILURE" });
          sendEmpty(response, notFound ? 404 : tooLarge ? 413 : 500);
        }
        return;
      }
      if (["GET", "HEAD"].includes(request.method) && requestPath === "/metrics") {
        if (metricsAuthRequired && !metricsAuthConfigured) {
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
          "# HELP llm_field_notes_http_requests_in_flight Current HTTP requests that have not completed.",
          "# TYPE llm_field_notes_http_requests_in_flight gauge",
          `llm_field_notes_http_requests_in_flight ${metrics.httpRequestsInFlight}`,
          "# HELP llm_field_notes_http_duration_ms HTTP request latency distribution in milliseconds.",
          "# TYPE llm_field_notes_http_duration_ms histogram",
          ...HTTP_LATENCY_BUCKETS_MS.map((bucket, index) => `llm_field_notes_http_duration_ms_bucket{le="${bucket}"} ${metrics.httpLatencyBuckets[index]}`),
          `llm_field_notes_http_duration_ms_bucket{le="+Inf"} ${metrics.httpLatencyCount}`,
          `llm_field_notes_http_duration_ms_sum ${metrics.httpLatencySumMs}`,
          `llm_field_notes_http_duration_ms_count ${metrics.httpLatencyCount}`,
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
          "# HELP llm_field_notes_extraction_client_aborts_total Extraction requests abandoned by the client before a response could be delivered.",
          "# TYPE llm_field_notes_extraction_client_aborts_total counter",
          `llm_field_notes_extraction_client_aborts_total ${metrics.extractionClientAborts}`,
          "# HELP llm_field_notes_readiness_timeouts_total Readiness validation checks that exceeded their bounded deadline.",
          "# TYPE llm_field_notes_readiness_timeouts_total counter",
          `llm_field_notes_readiness_timeouts_total ${metrics.readinessTimeouts}`,
          "# HELP llm_field_notes_readiness_failures_total Readiness validation checks that completed but reported an unavailable application.",
          "# TYPE llm_field_notes_readiness_failures_total counter",
          `llm_field_notes_readiness_failures_total ${metrics.readinessFailures}`,
          "# HELP llm_field_notes_authentication_failures_total Extraction requests rejected by bearer authentication.",
          "# TYPE llm_field_notes_authentication_failures_total counter",
          `llm_field_notes_authentication_failures_total ${metrics.authenticationFailures}`,
          "# HELP llm_field_notes_rate_limited_total Extraction requests rejected by the in-process limiter.",
          "# TYPE llm_field_notes_rate_limited_total counter",
          `llm_field_notes_rate_limited_total ${metrics.rateLimited}`,
          "# HELP llm_field_notes_rate_limit_keys Current client windows retained by the in-process limiter.",
          "# TYPE llm_field_notes_rate_limit_keys gauge",
          `llm_field_notes_rate_limit_keys ${rateLimits.size}`,
          "# HELP llm_field_notes_rate_limit_key_capacity Maximum client windows retained by the in-process limiter.",
          "# TYPE llm_field_notes_rate_limit_key_capacity gauge",
          `llm_field_notes_rate_limit_key_capacity ${MAX_RATE_LIMIT_KEYS}`,
          "# HELP llm_field_notes_trusted_proxy_hops Number of explicitly trusted reverse-proxy hops used for rate-limit identity.",
          "# TYPE llm_field_notes_trusted_proxy_hops gauge",
          `llm_field_notes_trusted_proxy_hops ${metrics.trustedProxyHops}`,
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
          "# HELP llm_field_notes_build_revision_info Source revision metadata for the running application.",
          "# TYPE llm_field_notes_build_revision_info gauge",
          `llm_field_notes_build_revision_info{revision="${BUILD_REVISION}"} 1`,
          "# HELP llm_field_notes_process_uptime_seconds Process uptime in seconds.",
          "# TYPE llm_field_notes_process_uptime_seconds gauge",
          `llm_field_notes_process_uptime_seconds ${Math.max(0, (Date.now() - processStartedAt) / 1000)}`,
          "# HELP llm_field_notes_draining Whether the server is refusing new extraction work during graceful shutdown.",
          "# TYPE llm_field_notes_draining gauge",
          `llm_field_notes_draining ${server.isDraining ? 1 : 0}`,
          ""
        ].join("\n");
        sendText(response, 200, body, {}, request.method === "HEAD");
        return;
      }
      if (["GET", "HEAD"].includes(request.method) && requestPath === "/readyz") {
        if (server.isDraining) {
          sendJson(response, 503, { ok: false, schema: GRAPH_SCHEMA, version: APP_VERSION, revision: BUILD_REVISION, ready: false, error: "Server is draining." }, { "retry-after": "5" }, request.method === "HEAD");
          return;
        }
        const now = Date.now();
        if (!readinessCache || readinessCache.expiresAt <= now) {
          if (!readinessCheck) readinessCheck = inspectReadiness().finally(() => {
            readinessCheck = null;
          });
          let readinessTimer;
          const timedOut = Symbol("readinessTimedOut");
          const result = await Promise.race([
            readinessCheck,
            new Promise((resolve) => {
              readinessTimer = setTimeout(() => resolve(timedOut), readinessTimeout);
              readinessTimer.unref?.();
            })
          ]);
          clearTimeout(readinessTimer);
          if (result === timedOut) {
            metrics.readinessTimeouts += 1;
            safeLog({ requestId, status: 503, route: "readyz", error: "READINESS_TIMEOUT" });
            sendJson(
              response,
              503,
              { ok: false, schema: GRAPH_SCHEMA, version: APP_VERSION, revision: BUILD_REVISION, ready: false, error: "Readiness check timed out." },
              { "retry-after": "5" },
              request.method === "HEAD"
            );
            return;
          }
          if (result.status !== 200) {
            metrics.readinessFailures += 1;
            safeLog({ requestId, status: result.status, route: "readyz", error: "READINESS_FAILED" });
          }
          if (server.isDraining) {
            sendJson(response, 503, { ok: false, schema: GRAPH_SCHEMA, version: APP_VERSION, revision: BUILD_REVISION, ready: false, error: "Server is draining." }, { "retry-after": "5" }, request.method === "HEAD");
            return;
          }
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
        discardRequestBody(request, response);
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
        let extractionOutcomeLogged = false;
        let extractionRateLimitHeaders = {};
        const respondJson = (status, payload, extraHeaders = {}, logFields = {}) => {
          const durationMs = Date.now() - startedAt;
          observeExtractionLatency(durationMs);
          if (status === 200) metrics.extractionSuccesses += 1;
          else metrics.extractionFailures += 1;
          extractionOutcomeLogged = true;
          sendJson(response, status, payload, { "x-request-id": requestId, ...extractionRateLimitHeaders, ...extraHeaders });
          safeLog({ requestId, status, durationMs, route: "extract-graph", ...logFields });
        };
        const recordClientAbort = (logFields = {}) => {
          if (extractionOutcomeLogged) return;
          extractionOutcomeLogged = true;
          const durationMs = Date.now() - startedAt;
          observeExtractionLatency(durationMs);
          metrics.extractionFailures += 1;
          metrics.extractionClientAborts += 1;
          safeLog({ requestId, status: 499, durationMs, route: "extract-graph", error: "REQUEST_ABORTED", ...logFields });
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
        const clientKey = resolveRateLimitClientKey(request, proxyHops);
        const now = Date.now();
        if (now >= nextRateLimitSweepAt) {
          for (const [key, entry] of rateLimits) {
            if (now - entry.startedAt >= 60000) rateLimits.delete(key);
          }
          nextRateLimitSweepAt = now + RATE_LIMIT_SWEEP_INTERVAL_MS;
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
        extractionRateLimitHeaders = rateLimitHeaders(requestLimit, count, windowStart, now);
        if (count > requestLimit) {
          discardRequestBody(request, response);
          metrics.rateLimited += 1;
          const retryAfter = Math.max(1, Math.ceil((windowStart + 60000 - now) / 1000));
          respondJson(429, { error: "Extraction rate limit exceeded." }, { "retry-after": String(retryAfter) });
          return;
        }
        if (extractorAuthRequired && !extractorAuthConfigured) {
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
          body = parseJsonWithUniqueKeys(await readBody(request, response), "Extraction request");
        } catch (error) {
          if ((request.aborted || response.destroyed || error?.code === "REQUEST_ABORTED") && error?.statusCode !== 413) {
            recordClientAbort();
            return;
          }
          const bodyError = error?.statusCode === 413
            ? "Request body exceeds the 2 MB limit."
            : error?.code === "REQUEST_LENGTH_MISMATCH"
              ? "Request body length does not match Content-Length."
              : error?.code === "INVALID_CONTENT_LENGTH"
                ? "Content-Length header is invalid."
                : error?.message === "Request body is not valid UTF-8."
                  ? error.message
                  : "Invalid extraction request body.";
          respondJson(error?.statusCode || 400, { error: bodyError });
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
        const contradictoryFeedback = validFeedback && hasContradictoryFeedback(compactFeedback);
        if (!hasOnlyKeys(body, EXTRACTOR_REQUEST_KEYS) || !hasOnlyKeys(document, EXTRACTOR_DOCUMENT_KEYS) || body?.operation !== "extract-graph" || body?.schema !== GRAPH_SCHEMA || body?.feedbackFormat !== FEEDBACK_FORMAT || !validFeedback || contradictoryFeedback || !document || typeof document.title !== "string" || document.title.length > MAX_DOCUMENT_TITLE_CHARS || (document.uri !== undefined && (typeof document.uri !== "string" || document.uri.length > MAX_SOURCE_URI_CHARS)) || invalidDocumentUri || typeof document.text !== "string") {
          const status = Array.isArray(rawFeedback) && typeof feedbackSerialized === "string" && feedbackSerialized.length > MAX_FEEDBACK_CHARS ? 413 : 400;
          const error = status === 413
            ? "Reviewed feedback exceeds the 500,000 character limit."
            : contradictoryFeedback
              ? "Reviewed feedback contains contradictory decisions for the same concept or relation."
              : "Expected the llm-field-notes extract-graph request contract.";
          respondJson(status, { error });
          return;
        }
        if (document.text.trim().length < 40 || document.text.length > MAX_DOCUMENT_CHARS) {
          respondJson(400, { error: "Document text must be between 40 and 300,000 characters." });
          return;
        }
        if (server.isDraining) {
          discardRequestBody(request, response);
          respondJson(503, { error: "Server is draining." }, { "retry-after": "5" }, { error: "SERVER_DRAINING" });
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
        let rejectClientAbort;
        let clientAbortPromise;
        let rejectServerDrain;
        let serverDrainPromise;
        let clientAborted = false;
        let extractionSettled = false;
        try {
          controller = new AbortController();
          activeExtractors.add(controller);
          clientAbortPromise = new Promise((_, reject) => {
            rejectClientAbort = reject;
          });
          serverDrainPromise = new Promise((_, reject) => {
            rejectServerDrain = reject;
          });
          activeExtractorDrainRejectors.add(rejectServerDrain);
          const abortClient = () => {
            if (clientAborted) return;
            clientAborted = true;
            controller.abort();
            rejectClientAbort?.(Object.assign(new Error("Request was aborted."), { code: "REQUEST_ABORTED" }));
          };
          requestAbortHandler = abortClient;
          responseCloseHandler = () => {
            if (!response.writableEnded) abortClient();
          };
          request.once("aborted", requestAbortHandler);
          response.once("close", responseCloseHandler);
          if (request.aborted || response.destroyed) abortClient();
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
            clientAbortPromise,
            serverDrainPromise,
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
            { title: document.title, text: document.text, uri: normalizedDocumentUri, feedback: compactFeedback }
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
          if (request.aborted || response.destroyed) {
            recordClientAbort({
              documentChars: typeof document?.text === "string" ? document.text.length : undefined,
              feedbackCount: compactFeedback?.length || 0
            });
            return;
          }
          if (server.isDraining || error?.code === "SERVER_SHUTDOWN") {
            respondJson(
              503,
              { error: "Server is draining." },
              { "retry-after": "5" },
              { error: "SERVER_DRAINING" }
            );
            return;
          }
          const timedOut = error?.code === "EXTRACTOR_TIMEOUT";
          const responseTooLarge = error?.code === "EXTRACTOR_RESPONSE_TOO_LARGE";
          const diagnosticCode = safeDiagnosticCode(error?.code, timedOut
            ? "EXTRACTOR_TIMEOUT"
            : responseTooLarge
              ? "EXTRACTOR_RESPONSE_TOO_LARGE"
              : "EXTRACTOR_FAILURE");
          const errorCode = typeof error?.code === "string" ? error.code : "";
          const retryableFailure = timedOut
            || (!responseTooLarge
              && !errorCode.startsWith("EXTRACTOR_")
              && !errorCode.startsWith("EXTRACTION_"));
          const retryHeaders = retryableFailure
            ? { "retry-after": timedOut ? "5" : "1" }
            : {};
          respondJson(
            timedOut ? 504 : 502,
            { error: timedOut ? "The configured extractor timed out. Try again or increase the provider capacity." : responseTooLarge ? "The extractor response exceeded the 10 MB safety limit." : "The configured extractor failed. Try again or inspect the provider logs." },
            retryHeaders,
            { error: diagnosticCode, documentChars: document.text.length, feedbackCount: compactFeedback.length }
          );
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (requestAbortHandler) request.removeListener("aborted", requestAbortHandler);
          if (responseCloseHandler) response.removeListener("close", responseCloseHandler);
          if (rejectServerDrain) activeExtractorDrainRejectors.delete(rejectServerDrain);
          if (controller && extractionSettled) markExtractorSettled(controller);
        }
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        discardRequestBody(request, response);
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
      if (/[\u0000-\u001F\u007F]/.test(pathname)) {
        sendEmpty(response, 400);
        return;
      }
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      const generatedSampleGraphPage = relative === SAMPLE_GRAPH_PAGE;
      if (!publicAssets.has(relative) && !generatedSampleGraphPage) {
        if (["GET", "HEAD"].includes(request.method) && publicAssets.has("404.html")) {
          try {
            const realRoot = await realpath(safeRoot);
            const notFoundPath = await realpath(resolve(realRoot, "404.html"));
            if (notFoundPath !== realRoot && notFoundPath.startsWith(`${realRoot}/`)) {
              const body = renderNotFoundPage(await readBoundedFile(notFoundPath, MAX_STATIC_ASSET_BYTES), origin);
              sendHtml(response, 404, body, {
                "cache-control": "no-store",
                "content-security-policy": learningNotePageCsp
              }, request.method === "HEAD");
              return;
            }
          } catch {
            // Fall through to the empty 404 when the branded page is unavailable.
          }
        }
        sendEmpty(response, 404);
        return;
      }
      const realRoot = await realpath(safeRoot);
      let resolvedFilePath;
      let metadata;
      if (generatedSampleGraphPage) {
        ({ resolvedFilePath, metadata } = await resolveRuntimeAsset(realRoot, "examples/sample-graph.json", "Sample graph"));
      } else {
        const filePath = resolve(realRoot, relative);
        if (filePath !== realRoot && !filePath.startsWith(`${realRoot}/`)) {
          sendEmpty(response, 404);
          return;
        }
        ({ resolvedFilePath, metadata } = await resolveRuntimeAsset(realRoot, relative));
        if (!metadata.isFile()) {
          sendEmpty(response, 404);
          return;
        }
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
      const responseContent = generatedSampleGraphPage
        ? Buffer.from(buildSampleGraphPage(parseJsonWithUniqueKeys(decodeUtf8(content), "Sample graph"), origin), "utf8")
        : relative === "index.html"
        ? renderOriginAwareIndex(content, origin, repository)
        : relative === "artifacts.html"
          ? renderOriginAwareArtifactPage(content, origin, repository)
          : relative === "sw.js"
            ? renderServiceWorker(content)
          : relative === "version.json"
            ? renderRuntimeReleaseMetadata(content)
          : relative === ".well-known/security.txt"
            ? renderRepositoryAwareSecurityTxt(content, repository)
          : content;
      const responseSecurityHeaders = {
        ...(relative === "index.html"
          ? securityHeadersForIndex(responseContent)
          : relative === "artifacts.html"
            ? { ...securityHeaders, "content-security-policy": artifactPageCsp }
            : generatedSampleGraphPage
              ? { ...securityHeaders, "content-security-policy": learningNotePageCsp }
            : securityHeaders),
        ...transportSecurityHeaders
      };
      if (responseContent.byteLength > MAX_STATIC_ASSET_BYTES) {
        sendEmpty(response, 413);
        return;
      }
      const etagSignature = [
        resolvedFilePath,
        metadata.size,
        metadata.mtimeMs,
        metadata.ctimeMs,
        responseContent.byteLength,
        origin,
        BUILD_REVISION
      ].join("\u0000");
      const etag = getStaticEtag(relative, etagSignature, responseContent);
      const cacheControl = NO_CACHE_STATIC_ASSETS.has(relative) || resolvedFilePath.endsWith("sw.js") || resolvedFilePath.endsWith("version.json")
        ? "no-cache"
        : generatedSampleGraphPage
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
        "content-type": generatedSampleGraphPage
          ? "text/html; charset=utf-8"
          : relative === "LICENSE"
            ? "text/plain; charset=utf-8"
            : types[extname(resolvedFilePath)] || "application/octet-stream",
        "cache-control": cacheControl,
        "content-length": responseContent.byteLength,
        etag,
        ...responseSecurityHeaders
      });
      if (request.method === "HEAD") response.end();
      else response.end(responseContent);
    } catch (error) {
      const notFound = ["ENOENT", "ELOOP", "ENOTDIR", "SYMLINK_ASSET", "ASSET_ESCAPE"].includes(error?.code);
      const status = notFound ? 404 : 500;
      if (status === 500) safeLog({ requestId, status, route: "static", error: error?.code || "STATIC_FAILURE" });
      sendEmpty(response, status);
    }
  });
  server.on("checkContinue", (request, response) => {
    const declaredLength = parseDeclaredContentLength(request);
    if (Number.isNaN(declaredLength)) {
      discardRequestBody(request, response);
      sendEmpty(response, 400);
      return;
    }
    if (declaredLength !== null && declaredLength > MAX_BODY_BYTES) {
      discardRequestBody(request, response);
      sendEmpty(response, 413);
      return;
    }
    response.writeContinue();
    server.emit("request", request, response);
  });
  server.on("clientError", (error, socket) => {
    safeLog({ status: 400, route: "client", error: "CLIENT_PROTOCOL_ERROR" });
    if (socket.destroyed) return;
    socket.end([
      "HTTP/1.1 400 Bad Request",
      "Connection: close",
      "Content-Length: 0",
      "Cache-Control: no-store",
      "X-Content-Type-Options: nosniff",
      "",
      ""
    ].join("\r\n"));
  });
  server.isDraining = false;
  server.getMetrics = () => ({
    ...metrics,
    extractorConcurrencyLimit: concurrencyLimit,
    responsesByStatus: Object.fromEntries(metrics.responsesByStatus),
    httpLatencyBuckets: [...metrics.httpLatencyBuckets],
    extractionLatencyBuckets: [...metrics.extractionLatencyBuckets],
    httpRequestsInFlight: metrics.httpRequestsInFlight,
    extractionsInFlight: activeExtractors.size,
    rateLimitKeys: rateLimits.size,
    rateLimitKeyCapacity: MAX_RATE_LIMIT_KEYS,
    draining: server.isDraining,
    uptimeSeconds: Math.max(0, (Date.now() - processStartedAt) / 1000)
  });
  server.abortActiveExtractors = () => {
    for (const controller of activeExtractors) controller.abort();
    for (const rejectServerDrain of activeExtractorDrainRejectors) {
      rejectServerDrain(Object.assign(new Error("Server is draining."), { code: "SERVER_SHUTDOWN" }));
    }
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
  const portSetting = parseConfiguredBoundedInteger("PORT", process.env.PORT, { defaultValue: 8000, max: 65535 });
  const rateLimitSetting = parseConfiguredBoundedInteger("EXTRACTOR_RATE_LIMIT", process.env.EXTRACTOR_RATE_LIMIT, { defaultValue: 60, max: 1000000 });
  const extractorTimeoutSetting = parseConfiguredBoundedInteger("EXTRACTOR_TIMEOUT_MS", process.env.EXTRACTOR_TIMEOUT_MS, { defaultValue: 120000, max: 120000 });
  const concurrencySetting = parseConfiguredBoundedInteger("EXTRACTOR_CONCURRENCY", process.env.EXTRACTOR_CONCURRENCY, { defaultValue: DEFAULT_MAX_CONCURRENT_EXTRACTORS, max: MAX_CONCURRENT_EXTRACTORS });
  const settings = [
    ["PORT", portSetting, "1 to 65535"],
    ["EXTRACTOR_RATE_LIMIT", rateLimitSetting, "1 to 1000000"],
    ["EXTRACTOR_TIMEOUT_MS", extractorTimeoutSetting, "1 to 120000"],
    ["EXTRACTOR_CONCURRENCY", concurrencySetting, `1 to ${MAX_CONCURRENT_EXTRACTORS}`]
  ];
  const invalidSetting = settings.find(([, setting]) => !setting.valid);
  if (invalidSetting) {
    console.error(`${invalidSetting[0]} must be an integer from ${invalidSetting[2]} when configured.`);
    process.exit(1);
  }
  const port = portSetting.value;
  const host = typeof process.env.HOST === "string" && process.env.HOST.trim() ? process.env.HOST.trim() : "127.0.0.1";
  const maxRequestsPerMinute = rateLimitSetting.value;
  const extractorTimeoutMs = extractorTimeoutSetting.value;
  const maxConcurrentExtractors = concurrencySetting.value;
  const trustedProxyConfiguration = parseTrustedProxyHops(process.env.TRUST_PROXY_HOPS);
  if (!trustedProxyConfiguration.valid) {
    console.error("TRUST_PROXY_HOPS must be an integer from 0 to 8 when configured.");
    process.exit(1);
  }
  const trustedProxyHops = trustedProxyConfiguration.value;
  const loopbackHost = new Set(["127.0.0.1", "::1", "localhost"]).has(host.toLowerCase());
  const publicOriginIsExternal = Boolean(process.env.PUBLIC_ORIGIN)
    && !isLoopbackPublicOrigin(process.env.PUBLIC_ORIGIN.trim());
  const productionMode = !loopbackHost || publicOriginIsExternal;
  let configuredProvider;
  try {
    configuredProvider = createConfiguredProviderExtractor(process.env, { requireSecure: productionMode });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Model provider configuration is invalid.");
    process.exit(1);
  }
  const server = createAppServer({
    maxRequestsPerMinute,
    maxConcurrentExtractors,
    extractorTimeoutMs,
    extractorAuthToken: process.env.EXTRACTOR_AUTH_TOKEN || "",
    metricsAuthToken: process.env.METRICS_AUTH_TOKEN || "",
    publicOrigin: process.env.PUBLIC_ORIGIN || "",
    publicRepository: process.env.PUBLIC_REPOSITORY_URL || "",
    requireExtractorAuth: productionMode,
    requireMetricsAuth: productionMode,
    requireSecurePublicOrigin: productionMode,
    requireBuildRevision: productionMode,
    trustedProxyHops,
    extractor: configuredProvider.extractor || undefined,
    logger: (entry) => console.log(JSON.stringify(entry))
  });
  let actualPort = port;
  const safeHost = sanitizeLogEntry({ host }).host || "unknown";
  const logLifecycle = (entry) => console.log(JSON.stringify(sanitizeLogEntry({
    version: APP_VERSION,
    revision: BUILD_REVISION,
    host: safeHost,
    port: actualPort,
    ...entry
  })));
  process.on("uncaughtExceptionMonitor", (error) => {
    logLifecycle({ event: "uncaught-exception", error: safeDiagnosticCode(error?.code, "UNCAUGHT_EXCEPTION") });
  });
  server.once("error", (error) => {
    console.error("LLM Field Notes server failed to listen.");
    logLifecycle({ event: "server-error", error: safeDiagnosticCode(error?.code, "LISTEN_FAILURE") });
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const address = server.address();
    actualPort = address && typeof address === "object" ? address.port : port;
    console.log(`LLM Field Notes server listening on http://${safeHost}:${actualPort}`);
    logLifecycle({ event: "server-ready", extractor: configuredProvider.configuration.configured ? "model-provider" : "local-heuristic" });
  });
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; draining active requests.`);
    logLifecycle({ event: "server-draining", signal });
    server.beginDrain?.();
    const forceExit = setTimeout(() => {
      logLifecycle({ event: "server-stop-timeout", signal, drained: false });
      process.exit(1);
    }, 5000);
    forceExit.unref();
    const closePromise = new Promise((resolve) => server.close(resolve));
    Promise.all([closePromise, server.waitForIdle?.() || Promise.resolve(true)]).then(([, idle]) => {
      clearTimeout(forceExit);
      logLifecycle({ event: "server-stopped", signal, drained: idle });
      process.exit(idle ? 0 : 1);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logLifecycle({ event: "unhandled-rejection", error: safeDiagnosticCode(reason?.code, "UNHANDLED_REJECTION") });
    shutdown("unhandled-rejection");
  });
}
