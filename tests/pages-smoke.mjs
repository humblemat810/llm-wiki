import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("../dist/", import.meta.url).pathname);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const asset = pathname === "/" ? "index.html" : pathname.slice(1);
  if (asset.includes("..") || asset.startsWith("/") || asset === "server.mjs" || asset.startsWith("tests/")) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const body = await readFile(resolve(root, asset));
    response.writeHead(200);
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const { port } = server.address();
try {
  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(index.status, 200);
  assert((await index.text()).includes("LLM Field Notes"));
  const feed = await fetch(`http://127.0.0.1:${port}/feed.xml`);
  assert.equal(feed.status, 200);
  const feedText = await feed.text();
  assert(feedText.includes('<feed xmlns="http://www.w3.org/2005/Atom">') && feedText.includes("notes/tokens.md"));
  assert.equal((await fetch(`http://127.0.0.1:${port}/server.mjs`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/tests/site-check.mjs`)).status, 404);
  console.log("Pages preview smoke ok");
} finally {
  server.close();
}
