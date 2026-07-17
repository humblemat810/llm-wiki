import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rm, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { parsePagesSmokeConfig, smokePagesDeployment } from "../scripts/smoke-pages-deployment.mjs";

assert.deepEqual(parsePagesSmokeConfig({}), {
  attempts: 12,
  retryDelayMs: 1000,
  expectedRevision: null
}, "Pages deployment smoke should retain bounded defaults when retry settings are absent");
assert.deepEqual(parsePagesSmokeConfig({
  PAGES_SMOKE_ATTEMPTS: "30",
  PAGES_SMOKE_RETRY_DELAY_MS: "2000",
  PAGES_EXPECTED_REVISION: "abcdef1234567890"
}), {
  attempts: 30,
  retryDelayMs: 2000,
  expectedRevision: "abcdef1234567890"
}, "Pages deployment smoke should preserve valid bounded retry settings");
assert.throws(
  () => parsePagesSmokeConfig({ PAGES_SMOKE_ATTEMPTS: "oops" }),
  /PAGES_SMOKE_ATTEMPTS must be a positive integer/,
  "malformed Pages retry counts should fail closed"
);
assert.throws(
  () => parsePagesSmokeConfig({ PAGES_SMOKE_RETRY_DELAY_MS: "0" }),
  /PAGES_SMOKE_RETRY_DELAY_MS must be a positive integer/,
  "zero Pages retry delays should fail closed"
);

const fixtureRoot = resolve(new URL("../.deployment-smoke-dist/", import.meta.url).pathname);
let root = fixtureRoot;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".canvas": "application/octet-stream",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};
const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", "http://localhost");
  const prefix = "/field-notes/";
  if (!requestUrl.pathname.startsWith(prefix)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const relativePath = requestUrl.pathname.slice(prefix.length) || "index.html";
  if (relativePath.includes("..") || relativePath.startsWith("/")) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const body = await readFile(resolve(root, relativePath));
    response.writeHead(200, { "content-type": types[extname(relativePath)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

let canceledEarlyResponse = false;
await assert.rejects(
  () => smokePagesDeployment("https://wiki.example.test/field-notes/", {
    attempts: 1,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: "https://wiki.example.test/field-notes/",
      headers: { get: () => "text/plain" },
      body: { cancel: async () => { canceledEarlyResponse = true; } }
    })
  }),
  /instead of text\/html/,
  "Pages deployment smoke should reject unexpected content types"
);
assert.equal(canceledEarlyResponse, true, "Pages deployment smoke should cancel unread bodies after early validation failures");

let redirectRequests = [];
await assert.rejects(
  () => smokePagesDeployment("https://wiki.example.test/field-notes/", {
    attempts: 1,
    fetchImpl: async (url, options) => {
      redirectRequests.push({ url: String(url), options });
      return {
        ok: false,
        status: 302,
        url: String(url),
        headers: {
          get: (name) => name === "location" ? "https://outside.example.test/field-notes/" : null
        },
        body: { cancel: async () => {} }
      };
    }
  }),
  /redirected outside the deployment origin/,
  "Pages deployment smoke should reject redirects outside the configured origin"
);
assert.equal(redirectRequests.length, 1, "external redirects should not be followed");
assert.equal(redirectRequests[0].options.redirect, "manual", "Pages deployment requests should disable automatic redirects");

await assert.rejects(
  () => smokePagesDeployment("https://wiki.example.test/field-notes/", {
    attempts: 1,
    fetchImpl: async () => ({
      ok: false,
      status: 302,
      url: "https://wiki.example.test/field-notes/",
      headers: {
        get: (name) => name === "location" ? "https://user:secret@wiki.example.test/field-notes/" : null
      },
      body: { cancel: async () => {} }
    })
  }),
  /redirected outside the deployment origin/,
  "Pages deployment smoke should reject credential-bearing same-origin redirects"
);

await assert.rejects(
  () => smokePagesDeployment("https://wiki.example.test/field-notes/", {
    attempts: 1,
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      url: "https://wiki.example.test/field-notes/",
      headers: { get: () => "text/html" },
      body: { cancel: async () => {} }
    })
  }),
  /enable GitHub Pages with the Actions source/,
  "Pages deployment smoke should explain how to recover an unactivated root deployment"
);

let canceledTruncatedResponse = false;
await assert.rejects(
  () => smokePagesDeployment("https://wiki.example.test/field-notes/", {
    attempts: 1,
    fetchImpl: async () => {
      let read = false;
      return {
        ok: true,
        status: 200,
        url: "https://wiki.example.test/field-notes/",
        headers: { get: (name) => name === "content-type" ? "text/html" : "2" },
        body: {
          getReader: () => ({
            read: async () => {
              if (read) return { done: true };
              read = true;
              return { done: false, value: new TextEncoder().encode("x") };
            },
            cancel: async () => { canceledTruncatedResponse = true; },
            releaseLock: () => {}
          }),
          cancel: async () => { canceledTruncatedResponse = true; }
        }
      };
    }
  }),
  /does not match Content-Length/,
  "Pages deployment smoke should reject truncated declared response bodies"
);
assert.equal(canceledTruncatedResponse, true, "Pages deployment smoke should cancel truncated response bodies");

await assert.rejects(
  () => smokePagesDeployment("https://wiki.example.test/field-notes/", {
    attempts: 1,
    requestTimeoutMs: 5,
    fetchImpl: async () => new Promise(() => {})
  }),
  /timed out/,
  "Pages deployment smoke should settle when a target fetch ignores cancellation"
);

let canceledHangingResponse = false;
await assert.rejects(
  () => smokePagesDeployment("https://wiki.example.test/field-notes/", {
    attempts: 1,
    requestTimeoutMs: 5,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: "https://wiki.example.test/field-notes/",
      headers: { get: (name) => name === "content-type" ? "text/html" : null },
      body: {
        getReader: () => ({
          read: async () => new Promise(() => {}),
          cancel: async () => { canceledHangingResponse = true; },
          releaseLock: () => {}
        })
      }
    })
  }),
  /timed out/,
  "Pages deployment smoke should settle when a streamed response body ignores cancellation"
);
assert.equal(canceledHangingResponse, true, "Pages deployment smoke should cancel a timed-out streamed response reader");

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const { port } = server.address();
try {
  execFileSync(process.execPath, ["scripts/build-pages.mjs", fixtureRoot], {
    stdio: "ignore",
    env: { ...process.env, BUILD_REVISION: "abcdef1234567890", PUBLIC_ORIGIN: `http://127.0.0.1:${port}/field-notes` }
  });
  const result = await smokePagesDeployment(`http://127.0.0.1:${port}/field-notes/`, { attempts: 1, expectedRevision: "abcdef1234567890" });
  assert.equal(result.manifestFiles > 0, true);
  assert.equal(result.endpointChecks >= 14, true, "Pages deployment smoke should retain its critical endpoint checks");
  assert.equal(result.checked, result.manifestFiles + result.endpointChecks);
  await assert.rejects(
    () => smokePagesDeployment(`http://127.0.0.1:${port}/field-notes/`, { attempts: 1, expectedRevision: "deadbeef" }),
    /failed its deployed-content assertion/,
    "Pages deployment smoke should reject a structurally valid but stale source revision"
  );
  const tamperedAssetPath = resolve(fixtureRoot, "styles.css");
  const originalAsset = await readFile(tamperedAssetPath);
  try {
    await writeFile(tamperedAssetPath, Buffer.concat([originalAsset, Buffer.from("\n/* tampered */\n")]));
    await assert.rejects(
      () => smokePagesDeployment(`http://127.0.0.1:${port}/field-notes/`, { attempts: 1 }),
      /did not match its deployed manifest digest/,
      "Pages deployment smoke should reject a served asset whose bytes differ from its manifest"
    );
  } finally {
    await writeFile(tamperedAssetPath, originalAsset);
  }
  const tamperedServiceWorkerPath = resolve(fixtureRoot, "sw.js");
  const tamperedManifestPath = resolve(fixtureRoot, "asset-manifest.json");
  const originalServiceWorker = await readFile(tamperedServiceWorkerPath, "utf8");
  const originalManifest = await readFile(tamperedManifestPath, "utf8");
  try {
    const tamperedServiceWorker = originalServiceWorker.replace(
      /const CACHE = "(llm-field-notes-v[^"]+)-[0-9a-f]{16}"/,
      'const CACHE = "$1-0000000000000000"'
    );
    assert.notEqual(tamperedServiceWorker, originalServiceWorker, "the fixture service worker should contain a deployment cache revision");
    const manifest = JSON.parse(originalManifest);
    const serviceWorkerEntry = manifest.files.find((entry) => entry.path === "sw.js");
    serviceWorkerEntry.bytes = Buffer.byteLength(tamperedServiceWorker);
    serviceWorkerEntry.sha256 = createHash("sha256").update(tamperedServiceWorker).digest("hex");
    await writeFile(tamperedServiceWorkerPath, tamperedServiceWorker);
    await writeFile(tamperedManifestPath, JSON.stringify(manifest, null, 2));
    await assert.rejects(
      () => smokePagesDeployment(`http://127.0.0.1:${port}/field-notes/`, { attempts: 1 }),
      /service-worker cache revision does not match/,
      "Pages deployment smoke should reject a service worker with a mismatched cache revision even when its manifest digest is updated"
    );
  } finally {
    await writeFile(tamperedServiceWorkerPath, originalServiceWorker);
    await writeFile(tamperedManifestPath, originalManifest);
  }
  console.log("Pages deployment smoke fixture ok");
} finally {
  server.close();
  await rm(fixtureRoot, { recursive: true, force: true });
}
