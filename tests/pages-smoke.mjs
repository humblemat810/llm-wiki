import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MAX_PUBLIC_ASSET_BYTES } from "../scripts/public-assets.mjs";

const root = resolve(new URL("../dist/", import.meta.url).pathname);
const sourceNotes = await readFile(new URL("../notes/tokens.md", import.meta.url), "utf8");
const pagesBuilder = await readFile(new URL("../scripts/build-pages.mjs", import.meta.url), "utf8");
assert(pagesBuilder.includes("mkdtemp") && pagesBuilder.includes("publishPages") && pagesBuilder.includes("rename(buildOutput, output)") && !pagesBuilder.includes("await rm(output, { recursive: true, force: true });"), "Pages builds must stage and swap output instead of deleting the previous bundle before generation");
async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else files.push(path);
  }
  return files;
}
assert.throws(
  () => execFileSync(process.execPath, ["scripts/build-pages.mjs", "notes"], { stdio: "pipe" }),
  /overlaps a source asset/,
  "Pages builds must reject output paths that would delete source assets"
);
assert.equal(await readFile(new URL("../notes/tokens.md", import.meta.url), "utf8"), sourceNotes, "a rejected Pages output path must leave source notes intact");
const invalidOriginOutput = resolve(root, "../dist-invalid-origin");
assert.throws(
  () => execFileSync(process.execPath, ["scripts/build-pages.mjs", invalidOriginOutput], {
    stdio: "pipe",
    env: { ...process.env, PUBLIC_ORIGIN: "javascript:alert(1)" }
  }),
  /absolute credential-free HTTP\(S\) origin/,
  "Pages builds must reject unsafe public origins before publication"
);
await rm(invalidOriginOutput, { recursive: true, force: true });
const literalOriginOutput = resolve(root, "../dist-literal-origin");
try {
  execFileSync(process.execPath, ["scripts/build-pages.mjs", literalOriginOutput], { stdio: "ignore", env: { ...process.env, PUBLIC_ORIGIN: "https://wiki.example.test/$release" } });
  const literalArtifact = await readFile(join(literalOriginOutput, "artifacts.html"), "utf8");
  assert(literalArtifact.includes('property="og:image" content="https://wiki.example.test/$release/social-card.svg"') && literalArtifact.includes('"url":"https://wiki.example.test/$release/experiments/tiny-bpe.mjs"'), "Pages origin rewrites should preserve literal dollar signs in valid deployment paths");
} finally {
  await rm(literalOriginOutput, { recursive: true, force: true });
}
const pagesBuildOutput = execFileSync(process.execPath, ["scripts/build-pages.mjs"], {
  encoding: "utf8",
  env: { ...process.env, PUBLIC_ORIGIN: "https://wiki.example.test/field-notes/" }
});
assert(pagesBuildOutput.includes("artifact check ok: 16 public cards"), "direct Pages builds should execute the artifact consistency gate");
const escapedManifestRoot = resolve(root, "../dist-escaped-manifest");
const escapedManifestTarget = resolve(root, "../pages-verifier-outside.json");
try {
  await rm(escapedManifestRoot, { recursive: true, force: true });
  await rm(escapedManifestTarget, { force: true });
  await mkdir(escapedManifestRoot, { recursive: true });
  await writeFile(escapedManifestTarget, "{}\n");
  await symlink(escapedManifestTarget, join(escapedManifestRoot, "asset-manifest.json"));
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/verify-pages.mjs", escapedManifestRoot], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => /escapes its output directory|must not be a symbolic link/.test(String(error?.stderr)),
    "Pages verification should reject an asset manifest symlink before trusting its target"
  );
} finally {
  await rm(escapedManifestRoot, { recursive: true, force: true });
  await rm(escapedManifestTarget, { force: true });
}
const outputFiles = await collectFiles(root);
const totalOutputBytes = (await Promise.all(outputFiles.map(async (file) => (await stat(file)).size))).reduce((total, size) => total + size, 0);
assert(totalOutputBytes <= MAX_PUBLIC_ASSET_BYTES, "Pages output should remain within the aggregate public-asset budget");
const assetManifestPath = join(root, "asset-manifest.json");
const assetManifestText = await readFile(assetManifestPath, "utf8");
try {
  await writeFile(assetManifestPath, `{"format":"llm-field-notes/assets@1","format":"tampered","version":"0.1.0","files":[]}`);
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/verify-pages.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("duplicate object key"),
    "Pages verification must reject ambiguous asset manifests before trusting their fields"
  );
} finally {
  await writeFile(assetManifestPath, assetManifestText);
}
const assetManifest = JSON.parse(assetManifestText);
assert.equal(assetManifest.format, "llm-field-notes/assets@1", "Pages should publish a versioned asset manifest");
assert.equal(assetManifest.version, "0.1.0", "Pages asset manifest should match the release version");
assert(Array.isArray(assetManifest.files) && assetManifest.files.length > 0, "Pages asset manifest should list generated files");
const manifestPaths = assetManifest.files.map((entry) => entry.path);
assert.equal(new Set(manifestPaths).size, manifestPaths.length, "Pages asset manifest should not duplicate file paths");
assert(!manifestPaths.includes("asset-manifest.json") && !manifestPaths.includes(".nojekyll"), "Pages asset manifest should exclude itself and the deployment marker");
const expectedManifestPaths = outputFiles.map((file) => file.slice(root.length + 1)).filter((file) => file !== "asset-manifest.json" && file !== ".nojekyll").sort();
assert.deepEqual(manifestPaths, expectedManifestPaths, "Pages asset manifest should cover exactly the published files");
for (const entry of assetManifest.files) {
  const content = await readFile(join(root, entry.path));
  assert.equal(entry.bytes, content.byteLength, `asset manifest byte length should match ${entry.path}`);
  assert.match(entry.sha256, /^[0-9a-f]{64}$/, `asset manifest digest should be valid for ${entry.path}`);
  assert.equal(entry.sha256, createHash("sha256").update(content).digest("hex"), `asset manifest digest should match ${entry.path}`);
}
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
  const artifacts = await fetch(`http://127.0.0.1:${port}/artifacts.html`);
  assert.equal(artifacts.status, 200);
  const artifactsText = await artifacts.text();
  assert(artifactsText.includes("Community artifacts") && artifactsText.includes('property="og:image" content="https://wiki.example.test/field-notes/social-card.svg"') && artifactsText.includes('property="og:url" content="https://wiki.example.test/field-notes/artifacts.html"') && artifactsText.includes('rel="canonical" href="https://wiki.example.test/field-notes/artifacts.html"') && artifactsText.includes('"@type":"ItemList"') && artifactsText.includes('"url":"https://wiki.example.test/field-notes/experiments/tiny-bpe.mjs"'), "Pages should publish the shareable artifact gallery with absolute social and structured discovery metadata");
  const notFound = await fetch(`http://127.0.0.1:${port}/404.html`);
  const notFoundText = await notFound.text();
  assert.equal(notFound.status, 200, "the preview host should expose the generated 404 document as a static asset");
  assert(notFoundText.includes('href="https://wiki.example.test/field-notes/styles.css"') && notFoundText.includes('href="https://wiki.example.test/field-notes/artifacts.html"'), "Pages 404 links should remain absolute under nested missing paths");
  const notePage = await fetch(`http://127.0.0.1:${port}/notes/tokens.html`);
  assert.equal(notePage.status, 200);
  const notePageText = await notePage.text();
  assert(notePageText.includes("Tokens are the interface") && notePageText.includes("<h2>The short version</h2>") && notePageText.includes("application/ld+json") && notePageText.includes("\"@type\":\"Article\"") && notePageText.includes("application/atom+xml") && notePageText.includes("Content-Security-Policy") && notePageText.includes("script-src 'none'") && notePageText.includes("robots\" content=\"index,follow\"") && notePageText.includes("og:type\" content=\"article\"") && notePageText.includes("article:section") && notePageText.includes("text/markdown") && notePageText.includes("https://wiki.example.test/field-notes/notes/tokens.html"), "Pages should generate safe rendered note pages with Article structured data, feed discovery, canonical metadata, and a strict CSP");
  const noteIds = (await readdir(join(root, "notes"))).filter((file) => file.endsWith(".md") && file !== "README.md").map((file) => file.slice(0, -3));
  assert(noteIds.length > 0, "the learning map should contain at least one note");
  for (const noteId of noteIds) {
    const generatedNotePage = await fetch(`http://127.0.0.1:${port}/notes/${noteId}.html`);
    assert.equal(generatedNotePage.status, 200, `${noteId} should have a generated crawler page`);
  }
  const serviceWorker = await fetch(`http://127.0.0.1:${port}/sw.js`);
  const serviceWorkerText = await serviceWorker.text();
  assert(serviceWorkerText.includes("./asset-manifest.json"), "Pages service worker should precache the release asset manifest");
  assert(noteIds.every((noteId) => serviceWorkerText.includes(`./notes/${noteId}.html`)), "Pages service worker should precache every generated note landing page");
  assert.match(serviceWorkerText, /const CACHE = "llm-field-notes-v0\.1\.0-[0-9a-f]{16}"/, "Pages service worker cache identity should include the built asset revision");
  const structuredData = indexText.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert(structuredData, "Pages HTML should retain structured discovery metadata");
  const structuredDataCsp = `'sha256-${createHash("sha256").update(structuredData).digest("base64")}'`;
  assert(indexText.includes(structuredDataCsp), "Pages HTML CSP should authorize rewritten structured metadata");
  const feed = await fetch(`http://127.0.0.1:${port}/feed.xml`);
  assert.equal(feed.status, 200);
  const feedText = await feed.text();
  assert(feedText.includes('<feed xmlns="http://www.w3.org/2005/Atom">') && feedText.includes("https://wiki.example.test/field-notes/notes/tokens.html") && feedText.includes("Why can&apos;t the model see words?"));
  const sitemap = await fetch(`http://127.0.0.1:${port}/sitemap.xml`);
  assert.equal(sitemap.status, 200);
  const sitemapText = await sitemap.text();
  assert(sitemapText.includes("https://wiki.example.test/field-notes/artifacts.html") && sitemapText.includes("https://wiki.example.test/field-notes/experiments/README.md") && sitemapText.includes("https://wiki.example.test/field-notes/notes/tokens.md"), "Pages sitemap should advertise public discovery pages and learning notes");
  const robots = await fetch(`http://127.0.0.1:${port}/robots.txt`);
  assert((await robots.text()).includes("Sitemap: https://wiki.example.test/field-notes/sitemap.xml"));
  assert.equal((await fetch(`http://127.0.0.1:${port}/server.mjs`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/tests/site-check.mjs`)).status, 404);
  console.log("Pages preview smoke ok");
} finally {
  server.close();
}
