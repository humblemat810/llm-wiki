import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_ATTEMPTS = 12;
const DEFAULT_RETRY_DELAY_MS = 1000;

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

async function readBoundedBody(response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
    throw new Error(`response is larger than the ${MAX_RESPONSE_BYTES}-byte smoke-test limit`);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
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
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function contentTypeMatches(response, expected) {
  return (response.headers.get("content-type") || "").toLowerCase().startsWith(expected);
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

export async function smokePagesDeployment(deploymentUrl, {
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("This smoke test requires fetch.");
  const base = normalizeDeploymentOrigin(deploymentUrl);
  const checks = [
    {
      path: "",
      contentType: "text/html",
      validate: (body) => body.includes("LLM Field Notes") && body.includes('http-equiv="Content-Security-Policy"') && body.includes(`href="${base.href}"`)
    },
    {
      path: "robots.txt",
      contentType: "text/plain",
      validate: (body) => body === `User-agent: *\nAllow: /\nSitemap: ${base.href}sitemap.xml\n`
    },
    {
      path: "sitemap.xml",
      contentType: "application/xml",
      validate: (body) => body.includes(`${base.href}artifacts.html`) && body.includes(`${base.href}notes/tokens.html`)
    },
    {
      path: "sw.js",
      contentType: "text/javascript",
      validate: (body) => body.includes("./asset-manifest.json") && body.includes('const CACHE = "llm-field-notes-v')
    },
    {
      path: "artifacts.html",
      contentType: "text/html",
      validate: (body) => body.includes("Community artifacts")
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
      for (const check of checks) {
        const expectedUrl = new URL(check.path, base);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response;
        let bodyConsumed = false;
        try {
          response = await fetchImpl(expectedUrl, { redirect: "follow", signal: controller.signal });
          if (!response.ok) throw new Error(`${check.path || "/"} returned HTTP ${response.status}`);
          if (!isWithinDeployment(response.url, base)) throw new Error(`${check.path || "/"} redirected outside the deployment origin`);
          if (!contentTypeMatches(response, check.contentType)) {
            throw new Error(`${check.path || "/"} returned ${response.headers.get("content-type") || "no content type"} instead of ${check.contentType}`);
          }
          const body = new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(response));
          bodyConsumed = true;
          if (!check.validate(body)) throw new Error(`${check.path || "/"} failed its deployed-content assertion`);
        } finally {
          clearTimeout(timeout);
          if (!bodyConsumed) await cancelResponseBody(response);
        }
      }
      return { ok: true, checked: checks.length, origin: base.href };
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
  const result = await smokePagesDeployment(process.argv[2] || process.env.PAGES_DEPLOYMENT_URL);
  console.log(`Pages deployment smoke ok: ${result.checked} checks (${result.origin})`);
}
