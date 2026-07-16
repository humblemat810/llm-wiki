import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rm, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { smokePagesDeployment } from "../scripts/smoke-pages-deployment.mjs";

const fixtureRoot = resolve(new URL("../.deployment-smoke-dist/", import.meta.url).pathname);
let root = fixtureRoot;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const { port } = server.address();
try {
  execFileSync(process.execPath, ["scripts/build-pages.mjs", fixtureRoot], {
    stdio: "ignore",
    env: { ...process.env, BUILD_REVISION: "abcdef1234567890", PUBLIC_ORIGIN: `http://127.0.0.1:${port}/field-notes` }
  });
  const result = await smokePagesDeployment(`http://127.0.0.1:${port}/field-notes/`, { attempts: 1, expectedRevision: "abcdef1234567890" });
  assert.equal(result.manifestFiles > 0, true);
  assert.equal(result.checked, result.manifestFiles + 12);
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
