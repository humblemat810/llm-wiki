import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { cp, mkdir, readdir, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MAX_PUBLIC_ASSET_BYTES } from "../scripts/public-assets.mjs";

const root = resolve(new URL("../dist-pages-smoke/", import.meta.url).pathname);
process.once("exit", () => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup for assertion failures before the async finally block.
  }
});
const sourceNotes = await readFile(new URL("../notes/tokens.md", import.meta.url), "utf8");
const pagesBuilder = await readFile(new URL("../scripts/build-pages.mjs", import.meta.url), "utf8");
assert(pagesBuilder.includes("mkdtemp") && pagesBuilder.includes("publishPages") && pagesBuilder.includes("outputMetadata.isSymbolicLink()") && pagesBuilder.includes("rename(buildOutput, output)") && !pagesBuilder.includes("await rm(output, { recursive: true, force: true });"), "Pages builds must stage and swap output, reject symlinked roots, and avoid deleting the previous bundle before generation");
await rm(root, { recursive: true, force: true });
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
const insecureOriginOutput = resolve(root, "../dist-insecure-origin");
assert.throws(
  () => execFileSync(process.execPath, ["scripts/build-pages.mjs", insecureOriginOutput], {
    stdio: "pipe",
    env: { ...process.env, PUBLIC_ORIGIN: "http://wiki.example.test/field-notes" }
  }),
  /must use HTTPS outside loopback/,
  "Pages builds must reject non-loopback HTTP origins before publishing insecure crawler metadata"
);
await rm(insecureOriginOutput, { recursive: true, force: true });
const symlinkedOutput = resolve(root, "../dist-symlinked-output");
const symlinkedOutputTarget = resolve(root, "../dist-symlinked-output-target");
try {
  await rm(symlinkedOutput, { recursive: true, force: true });
  await rm(symlinkedOutputTarget, { recursive: true, force: true });
  await mkdir(symlinkedOutputTarget, { recursive: true });
  await symlink(symlinkedOutputTarget, symlinkedOutput);
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/build-pages.mjs", symlinkedOutput], { stdio: "pipe" }),
    /Pages output must not be a symbolic link/,
    "Pages builds must reject a symlinked output root before swapping artifacts"
  );
} finally {
  await rm(symlinkedOutput, { recursive: true, force: true });
  await rm(symlinkedOutputTarget, { recursive: true, force: true });
}
const invalidRepositoryOutput = resolve(root, "../dist-invalid-repository");
assert.throws(
  () => execFileSync(process.execPath, ["scripts/build-pages.mjs", invalidRepositoryOutput], {
    stdio: "pipe",
    env: { ...process.env, PUBLIC_REPOSITORY_URL: "https://github.com/example/forked-wiki?invalid=1" }
  }),
  /credential-free GitHub HTTPS repository URL/,
  "Pages builds must reject repository URLs with query data before publication"
);
await rm(invalidRepositoryOutput, { recursive: true, force: true });
const literalOriginOutput = resolve(root, "../dist-literal-origin");
try {
  execFileSync(process.execPath, ["scripts/build-pages.mjs", literalOriginOutput], { stdio: "ignore", env: { ...process.env, PUBLIC_ORIGIN: "https://wiki.example.test/$release" } });
  const literalArtifact = await readFile(join(literalOriginOutput, "artifacts.html"), "utf8");
  assert(literalArtifact.includes('property="og:image" content="https://wiki.example.test/$release/social-card.png"') && literalArtifact.includes('"url":"https://wiki.example.test/$release/experiments/tiny-bpe.mjs"'), "Pages origin rewrites should preserve literal dollar signs in valid deployment paths");
} finally {
  await rm(literalOriginOutput, { recursive: true, force: true });
}
const pagesBuildOutput = execFileSync(process.execPath, ["scripts/build-pages.mjs", root], {
  encoding: "utf8",
  env: {
    ...process.env,
    BUILD_REVISION: "abcdef1234567890",
    PUBLIC_ORIGIN: "https://wiki.example.test/field-notes/",
    PUBLIC_REPOSITORY_URL: "https://github.com/example/forked-wiki"
  }
});
assert(pagesBuildOutput.includes("artifact check ok: 20 public cards"), "direct Pages builds should execute the artifact consistency gate");
execFileSync(process.execPath, ["scripts/verify-pages.mjs", root], {
  stdio: "ignore",
  env: { ...process.env, BUILD_REVISION: "abcdef1234567890", PUBLIC_ORIGIN: "https://wiki.example.test/field-notes" }
});
const symlinkedVerifyOutput = resolve(root, "../dist-symlinked-verify-output");
try {
  await unlink(symlinkedVerifyOutput).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  await symlink(root, symlinkedVerifyOutput);
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/verify-pages.mjs", symlinkedVerifyOutput], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("Pages output must not be a symbolic link"),
    "Pages verification must reject a symlinked output root before reading the manifest"
  );
} finally {
  await unlink(symlinkedVerifyOutput).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}
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
    () => execFileSync(process.execPath, ["scripts/verify-pages.mjs", root], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PUBLIC_ORIGIN: "https://wiki.example.test/field-notes" }
    }),
    (error) => String(error?.stderr).includes("duplicate object key"),
    "Pages verification must reject ambiguous asset manifests before trusting their fields"
  );
} finally {
  await writeFile(assetManifestPath, assetManifestText);
}
const assetManifest = JSON.parse(assetManifestText);
assert.equal(assetManifest.format, "llm-field-notes/assets@1", "Pages should publish a versioned asset manifest");
assert.equal(assetManifest.version, "0.1.0", "Pages asset manifest should match the release version");
const releaseMetadata = JSON.parse(await readFile(join(root, "version.json"), "utf8"));
assert.equal(releaseMetadata.revision, "abcdef1234567890", "Pages release metadata should expose the bounded source revision");
assert(Array.isArray(assetManifest.files) && assetManifest.files.length > 0, "Pages asset manifest should list generated files");
const manifestPaths = assetManifest.files.map((entry) => entry.path);
assert.equal(new Set(manifestPaths).size, manifestPaths.length, "Pages asset manifest should not duplicate file paths");
assert(!manifestPaths.includes("asset-manifest.json") && !manifestPaths.includes(".nojekyll"), "Pages asset manifest should exclude itself and the deployment marker");
const expectedManifestPaths = outputFiles.map((file) => file.slice(root.length + 1)).filter((file) => file !== "asset-manifest.json" && file !== ".nojekyll").sort();
assert.deepEqual(manifestPaths, expectedManifestPaths, "Pages asset manifest should cover exactly the published files");
const robotsText = await readFile(join(root, "robots.txt"), "utf8");
assert.equal(
  robotsText,
  "User-agent: *\nAllow: /\nSitemap: https://wiki.example.test/field-notes/sitemap.xml\n",
  "Pages should publish a robots policy bound to the configured public origin"
);
const securityText = await readFile(join(root, ".well-known/security.txt"), "utf8");
assert(securityText.includes("Contact: https://github.com/example/forked-wiki/security/advisories/new")
  && securityText.includes("Policy: https://github.com/example/forked-wiki/blob/main/SECURITY.md")
  && securityText.includes("Canonical: https://github.com/example/forked-wiki/blob/main/.well-known/security.txt"), "Pages security metadata should target the configured fork repository");
const tamperedRobotsRoot = resolve(root, "../dist-tampered-robots");
try {
  await rm(tamperedRobotsRoot, { recursive: true, force: true });
  await cp(root, tamperedRobotsRoot, { recursive: true });
  const tamperedRobotsPath = join(tamperedRobotsRoot, "robots.txt");
  await writeFile(tamperedRobotsPath, "User-agent: *\nAllow: /\nSitemap: https://wrong.example.test/sitemap.xml\n", "utf8");
  const tamperedRobotsManifestPath = join(tamperedRobotsRoot, "asset-manifest.json");
  const tamperedRobotsManifest = JSON.parse(await readFile(tamperedRobotsManifestPath, "utf8"));
  const tamperedRobotsBytes = await readFile(tamperedRobotsPath);
  const tamperedRobotsEntry = tamperedRobotsManifest.files.find((entry) => entry.path === "robots.txt");
  tamperedRobotsEntry.sha256 = createHash("sha256").update(tamperedRobotsBytes).digest("hex");
  tamperedRobotsEntry.bytes = tamperedRobotsBytes.byteLength;
  await writeFile(tamperedRobotsManifestPath, JSON.stringify(tamperedRobotsManifest), "utf8");
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/verify-pages.mjs", tamperedRobotsRoot], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PUBLIC_ORIGIN: "https://wiki.example.test/field-notes" }
    }),
    (error) => String(error?.stderr).includes("robots policy does not match"),
    "Pages verification should reject a crawler policy that points at a different deployment origin"
  );
} finally {
  await rm(tamperedRobotsRoot, { recursive: true, force: true });
}
const tamperedShellRoot = resolve(root, "../dist-tampered-shell");
try {
  await rm(tamperedShellRoot, { recursive: true, force: true });
  await cp(root, tamperedShellRoot, { recursive: true });
  const generatedNoteAsset = manifestPaths.find((asset) => /^notes\/.+\.html$/.test(asset));
  assert(generatedNoteAsset, "Pages output should contain a generated note page for shell tamper coverage");
  const tamperedServiceWorkerPath = join(tamperedShellRoot, "sw.js");
  const tamperedServiceWorker = await readFile(tamperedServiceWorkerPath, "utf8");
  const generatedNoteLiteral = `"./${generatedNoteAsset}"`;
  const generatedNoteWithSeparator = `, ${generatedNoteLiteral}`;
  await writeFile(
    tamperedServiceWorkerPath,
    tamperedServiceWorker.replace(generatedNoteWithSeparator, " ".repeat(generatedNoteWithSeparator.length)),
    "utf8"
  );
  const tamperedManifestPath = join(tamperedShellRoot, "asset-manifest.json");
  const tamperedManifest = JSON.parse(await readFile(tamperedManifestPath, "utf8"));
  const tamperedWorkerBytes = await readFile(tamperedServiceWorkerPath);
  const tamperedWorkerEntry = tamperedManifest.files.find((entry) => entry.path === "sw.js");
  tamperedWorkerEntry.sha256 = createHash("sha256").update(tamperedWorkerBytes).digest("hex");
  await writeFile(tamperedManifestPath, JSON.stringify(tamperedManifest), "utf8");
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/verify-pages.mjs", tamperedShellRoot], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PUBLIC_ORIGIN: "https://wiki.example.test/field-notes" }
    }),
    (error) => String(error?.stderr).includes("APP_SHELL is missing generated note page"),
    "Pages verification must reject a service worker that omits a published generated note page"
  );
} finally {
  await rm(tamperedShellRoot, { recursive: true, force: true });
}
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
  const productionStatus = await fetch(`http://127.0.0.1:${port}/PRODUCTION_STATUS.md`);
  assert.equal(productionStatus.status, 200, "Pages should publish the production status contract linked from README");
  assert((await productionStatus.text()).includes("Hosted multi-user workspace"), "the published production status should disclose the hosted product boundary");
  assert(indexText.includes('href="https://wiki.example.test/field-notes/"') && indexText.includes('<meta name="repository-url" content="https://github.com/example/forked-wiki"'), "Pages HTML should declare the deployed origin and fork repository");
  assert(indexText.includes('href="https://wiki.example.test/field-notes/feed.xml"'), "Pages HTML should advertise the deployed feed URL");
  assert(indexText.includes('content="https://wiki.example.test/field-notes/social-card.png"'), "Pages social metadata should use the deployed asset origin");
  assert(indexText.includes('"url": "https://wiki.example.test/field-notes/"'), "Pages structured metadata should use the deployed origin");
  assert(indexText.includes('href="https://github.com/example/forked-wiki/fork"') && indexText.includes('href="https://github.com/example/forked-wiki/issues/new?template=graph_correction.yml"') && indexText.includes('href="https://github.com/example/forked-wiki/issues/new?template=learning_note.yml"') && indexText.includes('href="https://github.com/example/forked-wiki/issues/new?template=artifact.yml"'), "Pages builds should point fork and contribution links at the configured repository");
  const artifacts = await fetch(`http://127.0.0.1:${port}/artifacts.html`);
  assert.equal(artifacts.status, 200);
  const artifactsText = await artifacts.text();
  assert(artifactsText.includes("Community artifacts") && artifactsText.includes('property="og:image" content="https://wiki.example.test/field-notes/social-card.png"') && artifactsText.includes('property="og:url" content="https://wiki.example.test/field-notes/artifacts.html"') && artifactsText.includes('rel="canonical" href="https://wiki.example.test/field-notes/artifacts.html"') && artifactsText.includes('"@type":"ItemList"') && artifactsText.includes('"url":"https://wiki.example.test/field-notes/experiments/tiny-bpe.mjs"'), "Pages should publish the shareable artifact gallery with absolute raster social and structured discovery metadata");
  assert(artifactsText.includes('href="https://github.com/example/forked-wiki/fork"') && artifactsText.includes('href="https://github.com/example/forked-wiki/issues/new?template=graph_correction.yml"') && artifactsText.includes('href="https://github.com/example/forked-wiki/issues/new?template=artifact.yml"'), "the published artifact gallery should point fork and contribution links at the configured repository");
  const notFound = await fetch(`http://127.0.0.1:${port}/404.html`);
  const notFoundText = await notFound.text();
  assert.equal(notFound.status, 200, "the preview host should expose the generated 404 document as a static asset");
  assert(notFoundText.includes('href="https://wiki.example.test/field-notes/styles.css"') && notFoundText.includes('href="https://wiki.example.test/field-notes/artifacts.html"'), "Pages 404 links should remain absolute under nested missing paths");
  const notePage = await fetch(`http://127.0.0.1:${port}/notes/tokens.html`);
  assert.equal(notePage.status, 200);
  const notePageText = await notePage.text();
  assert(notePageText.includes("Tokens are the interface") && notePageText.includes("<h2>The short version</h2>") && notePageText.includes("application/ld+json") && notePageText.includes("\"@type\":\"Article\"") && notePageText.includes("application/atom+xml") && notePageText.includes("Content-Security-Policy") && notePageText.includes("script-src 'none'") && notePageText.includes("robots\" content=\"index,follow\"") && notePageText.includes("og:type\" content=\"article\"") && notePageText.includes("article:section") && notePageText.includes("text/markdown") && notePageText.includes("https://wiki.example.test/field-notes/notes/tokens.html"), "Pages should generate safe rendered note pages with Article structured data, feed discovery, canonical metadata, and a strict CSP");
  const sampleGraphPage = await fetch(`http://127.0.0.1:${port}/sample-graph.html`);
  assert.equal(sampleGraphPage.status, 200);
  const sampleGraphPageText = await sampleGraphPage.text();
  assert(sampleGraphPageText.includes("A document,") && sampleGraphPageText.includes("CONCEPTS WITH EVIDENCE") && sampleGraphPageText.includes("RELATIONS WITH GROUNDS") && sampleGraphPageText.includes("fnv64-") && sampleGraphPageText.includes("script-src 'none'") && sampleGraphPageText.includes("https://wiki.example.test/field-notes/#sample") && sampleGraphPageText.includes("https://wiki.example.test/field-notes/examples/sample-graph.canvas"), "Pages should publish a script-free, origin-aware sample graph explainer with evidence, relations, fingerprint, workbench entry point, and direct Canvas projection");
  const sampleGraphCanvas = await fetch(`http://127.0.0.1:${port}/examples/sample-graph.canvas`);
  assert.equal(sampleGraphCanvas.status, 200, "Pages should publish the sample Graph.canvas projection");
  const sampleGraphCanvasText = await sampleGraphCanvas.text();
  assert(sampleGraphCanvasText.includes('"type": "text"') && (await fetch(`http://127.0.0.1:${port}/examples/sample-graph.json`)).status === 200, "Pages should serve the native Canvas and source graph exports together");
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
  assert(sitemapText.includes("https://wiki.example.test/field-notes/artifacts.html") && sitemapText.includes("https://wiki.example.test/field-notes/sample-graph.html") && sitemapText.includes("https://wiki.example.test/field-notes/experiments/README.md") && sitemapText.includes("https://wiki.example.test/field-notes/notes/tokens.md"), "Pages sitemap should advertise the sample graph explainer, public discovery pages, and learning notes");
  const robots = await fetch(`http://127.0.0.1:${port}/robots.txt`);
  assert((await robots.text()).includes("Sitemap: https://wiki.example.test/field-notes/sitemap.xml"));
  assert.equal((await fetch(`http://127.0.0.1:${port}/server.mjs`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/tests/site-check.mjs`)).status, 404);
  console.log("Pages preview smoke ok");
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
}
