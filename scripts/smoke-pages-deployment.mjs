import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseJsonWithUniqueKeys } from "../graph-core.js";
import { computeServiceWorkerCacheRevision, readServiceWorkerCacheName, stripDeploymentCacheRevision } from "./service-worker-cache.mjs";
import { verifyCanvasProjection } from "./verify-canvas.mjs";

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_ATTEMPTS = 12;
const DEFAULT_RETRY_DELAY_MS = 1000;
const MANIFEST_FETCH_CONCURRENCY = 4;
const MAX_SAME_ORIGIN_REDIRECTS = 3;
const APP_VERSION = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;

function boundedPositiveInteger(name, value, fallback, maximum) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return Math.min(parsed, maximum);
}

export function parsePagesSmokeConfig(environment = process.env) {
  return {
    attempts: boundedPositiveInteger("PAGES_SMOKE_ATTEMPTS", environment.PAGES_SMOKE_ATTEMPTS, DEFAULT_ATTEMPTS, 60),
    retryDelayMs: boundedPositiveInteger("PAGES_SMOKE_RETRY_DELAY_MS", environment.PAGES_SMOKE_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS, 10000),
    expectedRevision: environment.PAGES_EXPECTED_REVISION || null
  };
}

function normalizeDeploymentOrigin(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("A deployed Pages URL is required.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("The deployed Pages URL must be an absolute HTTP(S) URL without credentials, query, or fragment.");
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("A non-local deployed Pages URL must use HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url;
}

export async function readBoundedBody(response, signal = null) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
    throw new Error(`response is larger than the ${MAX_RESPONSE_BYTES}-byte smoke-test limit`);
  }
  const contentEncoding = (response.headers.get("content-encoding") || "").trim().toLowerCase();
  const expectedLength = declaredLength === null || (contentEncoding && contentEncoding !== "identity")
    ? null
    : Number(declaredLength);
  if (!response.body) return new Uint8Array();
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
    abortReject?.(Object.assign(new Error("Pages deployment response reading was aborted."), { name: "AbortError" }));
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
      if (!value || !Number.isSafeInteger(value.byteLength)) throw new Error("response body returned an invalid byte chunk");
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error(`response is larger than the ${MAX_RESPONSE_BYTES}-byte smoke-test limit`);
      chunks.push(value);
    }
  } finally {
    if (!completed) await Promise.resolve(reader.cancel?.()).catch(() => {});
    reader.releaseLock();
    signal?.removeEventListener?.("abort", abortReader);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (expectedLength !== null && total !== expectedLength) {
    throw new Error(`response body length does not match Content-Length: ${total} !== ${expectedLength}`);
  }
  return body;
}

function contentTypeMatches(response, expected) {
  const actual = (response.headers.get("content-type") || "").toLowerCase();
  return (Array.isArray(expected) ? expected : [expected]).some((candidate) => actual.startsWith(candidate));
}

function isWithinDeployment(url, base) {
  const candidate = new URL(url);
  return candidate.origin === base.origin && candidate.pathname.startsWith(base.pathname);
}

async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // Response cleanup is best-effort and must not mask the probe failure.
  }
}

async function fetchWithinDeployment(fetchImpl, expectedUrl, base, signal) {
  let currentUrl = new URL(expectedUrl);
  for (let redirectCount = 0; redirectCount <= MAX_SAME_ORIGIN_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, { redirect: "manual", signal });
    const status = Number(response?.status);
    if (![301, 302, 303, 307, 308].includes(status)) return response;
    const location = response.headers?.get?.("location");
    await cancelResponseBody(response);
    if (!location) throw new Error(`${currentUrl.pathname} returned a redirect without a location`);
    const redirectedUrl = new URL(location, currentUrl);
    if (redirectedUrl.username || redirectedUrl.password || !isWithinDeployment(redirectedUrl, base)) {
      throw new Error(`${currentUrl.pathname} redirected outside the deployment origin`);
    }
    if (redirectCount === MAX_SAME_ORIGIN_REDIRECTS) {
      throw new Error(`${currentUrl.pathname} exceeded the bounded same-origin redirect limit`);
    }
    currentUrl = redirectedUrl;
  }
  throw new Error("Pages deployment redirect handling failed closed.");
}

function validManifestPath(path) {
  return typeof path === "string"
    && path.length > 0
    && path.length <= 512
    && !path.startsWith("/")
    && !path.includes("\\")
    && !path.split("/").some((part) => !part || part === "." || part === "..");
}

function parseDeployedManifest(body) {
  const manifest = parseJsonWithUniqueKeys(body, "deployed Pages asset manifest");
  if (manifest.format !== "llm-field-notes/assets@1"
    || manifest.version !== APP_VERSION
    || !Array.isArray(manifest.files)
    || !manifest.files.length) {
    throw new Error("deployed Pages asset manifest has the wrong release identity or file collection");
  }
  const paths = manifest.files.map((entry) => entry?.path);
  if (new Set(paths).size !== paths.length
    || paths.some((path) => !validManifestPath(path))
    || JSON.stringify([...paths].sort()) !== JSON.stringify(paths)) {
    throw new Error("deployed Pages asset manifest contains unsafe, duplicate, or unsorted paths");
  }
  if (manifest.files.some((entry) => !Number.isSafeInteger(entry?.bytes)
    || entry.bytes < 0
    || entry.bytes > MAX_RESPONSE_BYTES
    || !/^[0-9a-f]{64}$/.test(entry.sha256))) {
    throw new Error("deployed Pages asset manifest contains invalid byte or SHA-256 metadata");
  }
  if (!manifest.files.some((entry) => entry.path === "index.html")
    || !manifest.files.some((entry) => entry.path === "sw.js")) {
    throw new Error("deployed Pages asset manifest is missing critical shell assets");
  }
  return manifest;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

export async function smokePagesDeployment(deploymentUrl, {
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  expectedRevision = null,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("This smoke test requires fetch.");
  if (expectedRevision !== null && !/^(?:unknown|[0-9a-f]{7,64})$/i.test(String(expectedRevision))) {
    throw new Error("expectedRevision must be unknown or a 7–64 character hexadecimal source revision.");
  }
  const base = normalizeDeploymentOrigin(deploymentUrl);
  const timeoutMs = Number.isSafeInteger(requestTimeoutMs) && requestTimeoutMs >= 1
    ? Math.min(REQUEST_TIMEOUT_MS, requestTimeoutMs)
    : REQUEST_TIMEOUT_MS;
  const checks = [
    {
      path: "",
      contentType: "text/html",
      validate: (body) => body.includes("LLM Field Notes")
        && body.includes('http-equiv="Content-Security-Policy"')
        && body.includes(`href="${base.href}"`)
        && /href="https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/fork"/.test(body)
        && /href="https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/new\?template=(?:graph_correction|learning_note|artifact)\.yml"/.test(body)
    },
    {
      path: "robots.txt",
      contentType: "text/plain",
      validate: (body) => body === `User-agent: *\nAllow: /\nSitemap: ${base.href}sitemap.xml\n`
    },
    {
      path: ".well-known/security.txt",
      contentType: "text/plain",
      validate: (body) => /Contact: https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/security\/advisories\/new/.test(body)
        && /Policy: https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/blob\/main\/SECURITY\.md/.test(body)
        && /Canonical: https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/blob\/main\/\.well-known\/security\.txt/.test(body)
    },
    {
      path: "sitemap.xml",
      contentType: "application/xml",
      validate: (body) => body.includes(`${base.href}artifacts.html`) && body.includes(`${base.href}notes/tokens.html`)
    },
    {
      path: "asset-manifest.json",
      contentType: "application/json",
      validate: (body) => Boolean(parseDeployedManifest(body))
    },
    {
      path: "version.json",
      contentType: "application/json",
      validate: (body) => {
        const release = parseJsonWithUniqueKeys(body, "deployed Pages release metadata");
        return release.version === APP_VERSION
          && ["stable", "unreleased"].includes(release.channel)
          && /^(?:unknown|[0-9a-f]{7,64})$/i.test(String(release.revision || ""))
          && (expectedRevision === null || release.revision === String(expectedRevision).toLowerCase());
      }
    },
    {
      path: "sw.js",
      contentType: ["text/javascript", "application/javascript"],
      validate: (body) => body.includes("./asset-manifest.json") && body.includes('const CACHE = "llm-field-notes-v')
    },
    {
      path: "404.html",
      contentType: "text/html",
      validate: (body) => body.includes("Page not found")
        && body.includes("Browse artifacts")
        && body.includes("script-src 'none'")
    },
    {
      path: "manifest.webmanifest",
      contentType: "application/manifest+json",
      validate: (body) => {
        const manifest = parseJsonWithUniqueKeys(body, "deployed Pages web manifest");
        return manifest.name === "LLM Field Notes"
          && manifest.start_url === "./#workbench"
          && manifest.display === "standalone"
          && manifest.icons?.some((icon) => icon?.src === "icon-192.png")
          && manifest.icons?.some((icon) => icon?.src === "icon-512.png");
      }
    },
    {
      path: "sample-graph.html",
      contentType: "text/html",
      validate: (body) => body.includes("A document,")
        && body.includes("CONCEPTS WITH EVIDENCE")
        && body.includes("RELATIONS WITH GROUNDS")
        && body.includes("fnv64-")
        && body.includes("script-src 'none'")
    },
    {
      path: "examples/sample-graph.canvas",
      contentType: ["application/json", "application/octet-stream"],
      validate: (body) => {
        const canvas = parseJsonWithUniqueKeys(body, "deployed sample Graph.canvas");
        verifyCanvasProjection(canvas, "deployed sample Graph.canvas");
        return canvas.nodes.length > 0
          && canvas.edges.length > 0
          && canvas.nodes.every((node) => node.type === "text" && typeof node.text === "string");
      }
    },
    {
      path: "artifacts.html",
      contentType: "text/html",
      validate: (body) => body.includes("Community artifacts")
        && /href="https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/fork"/.test(body)
        && /href="https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/new\?template=(?:graph_correction|artifact)\.yml"/.test(body)
    },
    {
      path: "share.html",
      contentType: "text/html",
      validate: (body) => body.includes("Shared knowledge graph")
        && body.includes(`content="${base.href}share.html"`)
        && body.includes(`rel="canonical" href="${base.href}share.html"`)
        && body.includes('id="copy-correction-context"')
        && body.includes('id="download-share"')
        && /href="https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/new\?template=graph_correction\.yml"/.test(body)
    },
    {
      path: "notes/tokens.html",
      contentType: "text/html",
      validate: (body) => body.includes("Tokens are the interface") && body.includes("script-src 'none'")
    }
  ];
  let lastError = null;
  for (let attempt = 1; attempt <= Math.max(1, Math.floor(attempts)); attempt += 1) {
    try {
      let deployedManifest = null;
      let deployedServiceWorker = null;
      for (const check of checks) {
        const expectedUrl = new URL(check.path, base);
        const controller = new AbortController();
        let timedOut = false;
        let timeoutReject;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutReject = reject;
        });
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          timeoutReject?.(Object.assign(new Error("Pages deployment request timed out."), { name: "AbortError" }));
          void cancelResponseBody(response);
        }, timeoutMs);
        let response;
        let bodyConsumed = false;
        try {
          const fetchPromise = Promise.resolve().then(() => fetchWithinDeployment(fetchImpl, expectedUrl, base, controller.signal));
          fetchPromise.then((lateResponse) => {
            if (timedOut) void cancelResponseBody(lateResponse);
          }, () => {});
          response = await Promise.race([fetchPromise, timeoutPromise]);
          if (!response.ok) {
            if (!check.path && response.status === 404) {
              throw new Error("deployed Pages root returned HTTP 404; enable GitHub Pages with the Actions source and run the publication workflow");
            }
            throw new Error(`${check.path || "/"} returned HTTP ${response.status}`);
          }
          if (!isWithinDeployment(response.url, base)) throw new Error(`${check.path || "/"} redirected outside the deployment origin`);
          if (!contentTypeMatches(response, check.contentType)) {
            throw new Error(`${check.path || "/"} returned ${response.headers.get("content-type") || "no content type"} instead of ${check.contentType}`);
          }
          const body = new TextDecoder("utf-8", { fatal: true }).decode(await Promise.race([
            readBoundedBody(response, controller.signal),
            timeoutPromise
          ]));
          bodyConsumed = true;
          if (check.path === "asset-manifest.json") deployedManifest = parseDeployedManifest(body);
          if (check.path === "sw.js") deployedServiceWorker = body;
          if (!check.validate(body)) throw new Error(`${check.path || "/"} failed its deployed-content assertion`);
        } finally {
          clearTimeout(timeout);
          if (!bodyConsumed) await cancelResponseBody(response);
        }
      }
      const verifiedAssets = await mapWithConcurrency(deployedManifest.files, MANIFEST_FETCH_CONCURRENCY, async (entry) => {
        const expectedUrl = new URL(entry.path, base);
        const controller = new AbortController();
        let timedOut = false;
        let timeoutReject;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutReject = reject;
        });
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          timeoutReject?.(Object.assign(new Error("Pages deployment asset request timed out."), { name: "AbortError" }));
          void cancelResponseBody(response);
        }, timeoutMs);
        let response;
        let bodyConsumed = false;
        try {
          const fetchPromise = Promise.resolve().then(() => fetchWithinDeployment(fetchImpl, expectedUrl, base, controller.signal));
          fetchPromise.then((lateResponse) => {
            if (timedOut) void cancelResponseBody(lateResponse);
          }, () => {});
          response = await Promise.race([fetchPromise, timeoutPromise]);
          if (!response.ok) throw new Error(`${entry.path} returned HTTP ${response.status}`);
          if (!isWithinDeployment(response.url, base)) throw new Error(`${entry.path} redirected outside the deployment origin`);
          const body = await Promise.race([readBoundedBody(response, controller.signal), timeoutPromise]);
          bodyConsumed = true;
          const digest = createHash("sha256").update(body).digest("hex");
          if (body.byteLength !== entry.bytes || digest !== entry.sha256) {
            throw new Error(`${entry.path} did not match its deployed manifest digest`);
          }
          return { entry, content: body };
        } finally {
          clearTimeout(timeout);
          if (!bodyConsumed) await cancelResponseBody(response);
        }
      });
      const expectedCacheRevision = computeServiceWorkerCacheRevision(
        stripDeploymentCacheRevision(deployedServiceWorker),
        verifiedAssets.map(({ entry, content }) => ({ path: entry.path, content }))
      );
      if (!readServiceWorkerCacheName(deployedServiceWorker).endsWith(`-${expectedCacheRevision}`)) {
        throw new Error(`deployed service-worker cache revision does not match the live asset manifest: expected ${expectedCacheRevision}`);
      }
      return {
        ok: true,
        checked: checks.length + verifiedAssets.length,
        endpointChecks: checks.length,
        manifestFiles: verifiedAssets.length,
        origin: base.href
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(10000, retryDelayMs * 2 ** (attempt - 1))));
      }
    }
  }
  throw new Error(`Deployed Pages smoke test failed after ${Math.max(1, Math.floor(attempts))} attempt(s): ${lastError?.message || "unknown failure"}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await smokePagesDeployment(process.argv[2] || process.env.PAGES_DEPLOYMENT_URL, parsePagesSmokeConfig());
  console.log(`Pages deployment smoke ok: ${result.checked} checks (${result.origin})`);
}
