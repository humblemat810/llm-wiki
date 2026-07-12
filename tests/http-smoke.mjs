import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const assets = ["index.html", "styles.css", "app.js", "graph-core.js", "graph-store.js", "extractor-adapter.js", "projection-adapter.js", "manifest.webmanifest", "sw.js", "icon.svg", "schema/graph.schema.json", "schema/feedback.schema.json", "schema/backup.schema.json", "schema/extractor-request.schema.json"];
const server = createServer(async (request, response) => {
  const requested = request.url === "/" ? "index.html" : request.url.slice(1);
  if (!assets.includes(requested)) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const body = await readFile(join(root, normalize(requested)));
    response.writeHead(200);
    response.end(body);
  } catch {
    response.writeHead(500);
    response.end();
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
try {
  for (const asset of ["/", ...assets.map((item) => `/${item}`)]) {
    const response = await fetch(`http://127.0.0.1:${port}${asset}`);
    assert.equal(response.status, 200, `${asset} should be served`);
    assert((await response.arrayBuffer()).byteLength > 0, `${asset} should not be empty`);
  }
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert(html.includes('type="module"'), "the app should be delivered as an ES module");
  console.log(`http smoke ok: ${assets.length} assets`);
} finally {
  server.close();
}
