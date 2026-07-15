import assert from "node:assert/strict";

process.env.BUILD_REVISION = "abcdef1234567890";
const { createAppServer } = await import("../server.mjs");

const server = createAppServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

try {
  const serviceWorkerResponse = await fetch(`http://127.0.0.1:${port}/sw.js`);
  assert.equal(serviceWorkerResponse.status, 200);
  const serviceWorker = await serviceWorkerResponse.text();
  assert.match(serviceWorker, /const CACHE = "llm-field-notes-v0\.1\.0-abcdef1234567890"/, "Node deployments should scope service-worker caches to the source revision");

  const healthResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    schema: "llm-field-notes/graph@1",
    version: "0.1.0",
    revision: "abcdef1234567890"
  }, "health metadata should expose the same sanitized deployment revision");
} finally {
  server.close();
}

console.log("build revision smoke ok");

process.env.BUILD_REVISION = "not-a-valid-source-revision";
const invalidRevisionServerModule = await import(`../server.mjs?invalid-build-revision=${Date.now()}`);
const invalidRevisionServer = invalidRevisionServerModule.createAppServer();
await new Promise((resolve) => invalidRevisionServer.listen(0, "127.0.0.1", resolve));
const invalidRevisionPort = invalidRevisionServer.address().port;

try {
  const invalidHealthResponse = await fetch(`http://127.0.0.1:${invalidRevisionPort}/healthz`);
  assert.equal(invalidHealthResponse.status, 200);
  assert.equal((await invalidHealthResponse.json()).revision, "unknown", "malformed deployment revisions should fail closed in health metadata");

  const invalidServiceWorkerResponse = await fetch(`http://127.0.0.1:${invalidRevisionPort}/sw.js`);
  assert.equal(invalidServiceWorkerResponse.status, 200);
  assert.match(await invalidServiceWorkerResponse.text(), /const CACHE = "llm-field-notes-v0\.1\.0"/, "malformed deployment revisions should not alter the checked-in cache identity");
} finally {
  invalidRevisionServer.close();
}

console.log("build revision validation smoke ok");
