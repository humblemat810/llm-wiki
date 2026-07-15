import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { smokePagesDeployment } from "../scripts/smoke-pages-deployment.mjs";

const fixtureRoot = resolve(new URL("../.deployment-smoke-dist/", import.meta.url).pathname);
let root = fixtureRoot;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
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

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const { port } = server.address();
try {
  execFileSync(process.execPath, ["scripts/build-pages.mjs", fixtureRoot], {
    stdio: "ignore",
    env: { ...process.env, PUBLIC_ORIGIN: `http://127.0.0.1:${port}/field-notes` }
  });
  const result = await smokePagesDeployment(`http://127.0.0.1:${port}/field-notes/`, { attempts: 1 });
  assert.equal(result.checked, 6);
  console.log("Pages deployment smoke fixture ok");
} finally {
  server.close();
  await rm(fixtureRoot, { recursive: true, force: true });
}
