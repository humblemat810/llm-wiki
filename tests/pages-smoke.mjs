import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("../dist/", import.meta.url).pathname);
execFileSync(process.execPath, ["scripts/build-pages.mjs"], { stdio: "ignore", env: { ...process.env, PUBLIC_ORIGIN: "https://wiki.example.test/field-notes/" } });
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
  const indexText = await index.text();
  assert(indexText.includes("LLM Field Notes"));
  assert(indexText.includes('href="https://wiki.example.test/field-notes/"'), "Pages HTML should declare the deployed canonical origin");
  assert(indexText.includes('href="https://wiki.example.test/field-notes/feed.xml"'), "Pages HTML should advertise the deployed feed URL");
  assert(indexText.includes('content="https://wiki.example.test/field-notes/social-card.svg"'), "Pages social metadata should use the deployed asset origin");
  assert(indexText.includes('"url": "https://wiki.example.test/field-notes/"'), "Pages structured metadata should use the deployed origin");
  const structuredData = indexText.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert(structuredData, "Pages HTML should retain structured discovery metadata");
  const structuredDataCsp = `'sha256-${createHash("sha256").update(structuredData).digest("base64")}'`;
  assert(indexText.includes(structuredDataCsp), "Pages HTML CSP should authorize rewritten structured metadata");
  const feed = await fetch(`http://127.0.0.1:${port}/feed.xml`);
  assert.equal(feed.status, 200);
  const feedText = await feed.text();
  assert(feedText.includes('<feed xmlns="http://www.w3.org/2005/Atom">') && feedText.includes("https://wiki.example.test/field-notes/notes/tokens.md"));
  const sitemap = await fetch(`http://127.0.0.1:${port}/sitemap.xml`);
  assert.equal(sitemap.status, 200);
  assert((await sitemap.text()).includes("https://wiki.example.test/field-notes/notes/tokens.md"));
  const robots = await fetch(`http://127.0.0.1:${port}/robots.txt`);
  assert((await robots.text()).includes("Sitemap: https://wiki.example.test/field-notes/sitemap.xml"));
  assert.equal((await fetch(`http://127.0.0.1:${port}/server.mjs`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/tests/site-check.mjs`)).status, 404);
  console.log("Pages preview smoke ok");
} finally {
  server.close();
}
