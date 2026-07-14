import { createHash } from "node:crypto";
import { cp, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_LEARNING_NOTE_ASSETS, MAX_PUBLIC_ASSET_BYTES, MAX_STATIC_ASSET_BYTES, PUBLIC_ASSETS } from "./public-assets.mjs";
import { normalizePublicOrigin } from "./public-origin.mjs";
import { buildLearningNotePage, MAX_NOTE_SUMMARY_CHARS } from "./note-page.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, process.argv[2] || "dist");
const MAX_CRAWLER_RESPONSE_BYTES = 2 * 1024 * 1024;
const outputRelativePath = relative(root, output);
if (!outputRelativePath || outputRelativePath.startsWith("..") || outputRelativePath.includes("/../")) {
  throw new Error("Pages output must be a child directory of the repository root");
}

const PUBLIC_FILES = PUBLIC_ASSETS;
const learningNoteAssetCount = PUBLIC_FILES.filter((asset) => asset.startsWith("notes/") && asset.endsWith(".md")).length;
if (learningNoteAssetCount > MAX_LEARNING_NOTE_ASSETS) throw new Error(`The Pages manifest contains more than ${MAX_LEARNING_NOTE_ASSETS} learning notes.`);
const MAX_BUILD_CONCURRENCY = 16;
const lexicalCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const rootRealPath = await realpath(root);
const publicOrigin = normalizePublicOrigin(process.env.PUBLIC_ORIGIN);

async function readBoundedUtf8(filePath, maxBytes) {
  const byteLimit = Math.max(1, Math.floor(maxBytes));
  const handle = await open(filePath, "r");
  const chunks = [];
  let total = 0;
  try {
    const chunkSize = Math.min(64 * 1024, byteLimit + 1);
    while (total <= byteLimit) {
      const buffer = Buffer.allocUnsafe(chunkSize);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > byteLimit) throw new Error(`file exceeds the ${byteLimit} byte safety limit`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } finally {
    await handle.close();
  }
}
const overlappingAsset = PUBLIC_FILES.find((asset) => {
  const sourcePath = resolve(root, asset);
  const relativeSource = relative(output, sourcePath);
  return relativeSource === "" || (!relativeSource.startsWith("..") && !isAbsolute(relativeSource));
});
if (overlappingAsset) {
  throw new Error(`Pages output overlaps a source asset and cannot be removed: ${overlappingAsset}`);
}

function isContained(candidate) {
  const relativePath = relative(rootRealPath, candidate);
  return relativePath && !relativePath.startsWith("..") && !relativePath.includes("/../");
}

async function copyPublicFile(asset) {
  const source = resolve(root, asset);
  const sourceRealPath = await realpath(source);
  if (!isContained(sourceRealPath)) throw new Error(`public asset escapes repository root: ${asset}`);
  const metadata = await stat(sourceRealPath);
  if (!metadata.isFile() || metadata.size === 0) throw new Error(`public asset is missing or empty: ${asset}`);
  if (metadata.size > MAX_STATIC_ASSET_BYTES) throw new Error(`public asset exceeds the ${MAX_STATIC_ASSET_BYTES / (1024 * 1024)} MB safety limit: ${asset}`);
  const destination = resolve(output, asset);
  await mkdir(dirname(destination), { recursive: true });
  await cp(sourceRealPath, destination);
}

async function preflightPublicAssetBudget() {
  let totalBytes = 0;
  for (const asset of PUBLIC_FILES) {
    const source = resolve(root, asset);
    const sourceRealPath = await realpath(source);
    if (!isContained(sourceRealPath)) throw new Error(`public asset escapes repository root: ${asset}`);
    const metadata = await stat(sourceRealPath);
    if (!metadata.isFile() || metadata.size === 0) throw new Error(`public asset is missing or empty: ${asset}`);
    if (metadata.size > MAX_STATIC_ASSET_BYTES) throw new Error(`public asset exceeds the ${MAX_STATIC_ASSET_BYTES / (1024 * 1024)} MB safety limit: ${asset}`);
    totalBytes += metadata.size;
    if (totalBytes > MAX_PUBLIC_ASSET_BYTES) {
      throw new Error(`source public assets exceed the ${MAX_PUBLIC_ASSET_BYTES / (1024 * 1024)} MB aggregate limit`);
    }
  }
  return totalBytes;
}

function xmlEscape(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderOriginAwareIndex(content, origin) {
  if (!origin) return content;
  const rootUrl = `${origin}/`;
  const rendered = content
    .replace('href="./" />', `href="${rootUrl}" />`)
    .replace('href="feed.xml"', `href="${origin}/feed.xml"`)
    .replace('content="./" />', `content="${rootUrl}" />`)
    .replace('"url": "./"', `"url": "${rootUrl}"`)
    .replace(/content="social-card\.svg"/g, `content="${origin}/social-card.svg"`);
  const structuredDataMatch = rendered.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!structuredDataMatch) return rendered;
  const structuredDataCsp = `'sha256-${createHash("sha256").update(structuredDataMatch[1]).digest("base64")}'`;
  return rendered.replace(/'sha256-[^']+'/g, structuredDataCsp);
}

function fallbackNoteTitle(asset) {
  return asset.slice("notes/".length, -".md".length).replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function deriveNoteSummary(content, title) {
  const boundedContent = content.slice(0, MAX_NOTE_SUMMARY_CHARS);
  const question = boundedContent.match(/^>\s*(.+)$/m)?.[1]?.trim() || "";
  const withoutFrontmatter = boundedContent.replace(/^---[\s\S]*?---\s*/m, "");
  const paragraphs = withoutFrontmatter.replace(/^#+\s+.+$/gm, "").split(/\n\s*\n/).map((paragraph) => paragraph
    .replace(/^>\s?/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim())
    .filter((paragraph) => paragraph && paragraph !== title && paragraph !== question);
  return ([question, paragraphs[0] || title].filter(Boolean).join(" ")).slice(0, 280);
}

async function readLearningNotes() {
  const notes = [];
  const assets = PUBLIC_FILES
    .filter((asset) => asset.startsWith("notes/") && asset.endsWith(".md") && asset !== "notes/README.md")
    .sort();
  for (const asset of assets) {
    const content = await readBoundedUtf8(resolve(root, asset), MAX_STATIC_ASSET_BYTES);
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallbackNoteTitle(asset);
    notes.push({
      asset,
      id: asset.slice("notes/".length, -".md".length),
      title: title.slice(0, 200),
      description: deriveNoteSummary(content, title),
      content
    });
  }
  return notes;
}

async function mapWithConcurrency(items, worker, limit = MAX_BUILD_CONCURRENCY) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, limit));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

async function buildStaticFeed(origin = "") {
  const release = JSON.parse(await readFile(resolve(root, "version.json"), "utf8"));
  const updated = /^\d{4}-\d{2}-\d{2}$/.test(release.date)
    ? `${release.date}T00:00:00.000Z`
    : "1970-01-01T00:00:00.000Z";
  const notes = await readLearningNotes();
  const base = origin ? `${origin}/` : "./";
  const entries = notes.sort((left, right) => lexicalCompare(left.asset, right.asset)).map(({ id, title, description }) => {
    const pageUrl = origin ? new URL(`./notes/${encodeURIComponent(id)}.html`, base).toString() : `./notes/${encodeURIComponent(id)}.html`;
    return [
    "  <entry>",
    `    <id>${xmlEscape(origin ? pageUrl : `urn:llm-field-notes:notes/${id}.html`)}</id>`,
    `    <title>${xmlEscape(title)}</title>`,
    `    <link href="${xmlEscape(pageUrl)}" />`,
    `    <updated>${updated}</updated>`,
    `    <summary>${xmlEscape(description)}</summary>`,
    "  </entry>"
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "  <title>LLM Field Notes learning map</title>",
    `  <id>${xmlEscape(origin ? new URL("./feed.xml", base).toString() : "urn:llm-field-notes:learning-map")}</id>`,
    `  <link href="${xmlEscape(origin ? new URL("./feed.xml", base).toString() : "./feed.xml")}" rel="self" />`,
    `  <updated>${updated}</updated>`,
    "  <subtitle>Runnable notes for turning documents into useful, inspectable systems.</subtitle>",
    ...entries,
    "</feed>",
    ""
  ].join("\n");
}

async function buildStaticSitemap(origin) {
  const notes = await readLearningNotes();
  const base = `${origin}/`;
  const urls = [
    new URL("./", base).toString(),
    ...notes.flatMap(({ asset, id }) => [
      new URL(`./${asset}`, base).toString(),
      new URL(`./notes/${encodeURIComponent(id)}.html`, base).toString()
    ])
  ];
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`),
    "</urlset>",
    ""
  ].join("\n");
}

await preflightPublicAssetBudget();
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mapWithConcurrency(PUBLIC_FILES, copyPublicFile);
const learningNotes = await readLearningNotes();
const generatedNotePages = learningNotes.map((note) => `notes/${note.id}.html`);
await mapWithConcurrency(learningNotes, async (note) => {
  const page = buildLearningNotePage({
    id: note.id,
    title: note.title,
    description: note.description,
    content: note.content,
    origin: publicOrigin
  });
  if (Buffer.byteLength(page) > MAX_STATIC_ASSET_BYTES) {
    throw new Error(`Generated learning note page exceeds the ${MAX_STATIC_ASSET_BYTES / (1024 * 1024)} MB safety limit: ${note.id}`);
  }
  await writeFile(
    resolve(output, `notes/${note.id}.html`),
    page,
    "utf8"
  );
});
const serviceWorkerPath = resolve(output, "sw.js");
const serviceWorker = await readFile(serviceWorkerPath, "utf8");
const generatedShellAssets = generatedNotePages.map((asset) => `./${asset}`);
if (generatedShellAssets.length) {
  const generatedShellLiteral = generatedShellAssets.map((asset) => JSON.stringify(asset)).join(", ");
  const shellMarker = "const APP_SHELL = [";
  if (!serviceWorker.includes(shellMarker)) throw new Error("Pages service worker is missing its APP_SHELL declaration.");
  const renderedServiceWorker = serviceWorker.replace(shellMarker, `${shellMarker}${generatedShellLiteral}, `);
  if (renderedServiceWorker === serviceWorker) throw new Error("Pages note pages could not be added to the service-worker shell.");
  await writeFile(serviceWorkerPath, renderedServiceWorker, "utf8");
}
await writeFile(resolve(output, ".nojekyll"), "", "utf8");
if (publicOrigin) {
  const indexPath = resolve(output, "index.html");
  const index = await readFile(indexPath, "utf8");
  const renderedIndex = renderOriginAwareIndex(index, publicOrigin);
  if (Buffer.byteLength(renderedIndex) > MAX_STATIC_ASSET_BYTES) {
    throw new Error(`origin-aware index exceeds the ${MAX_STATIC_ASSET_BYTES / (1024 * 1024)} MB safety limit`);
  }
  await writeFile(indexPath, renderedIndex, "utf8");
}
const feed = await buildStaticFeed(publicOrigin);
if (Buffer.byteLength(feed) > MAX_CRAWLER_RESPONSE_BYTES) throw new Error("Generated feed exceeds the 2 MB crawler response limit.");
await writeFile(resolve(output, "feed.xml"), feed, "utf8");
if (publicOrigin) {
  const sitemap = await buildStaticSitemap(publicOrigin);
  if (Buffer.byteLength(sitemap) > MAX_CRAWLER_RESPONSE_BYTES) throw new Error("Generated sitemap exceeds the 2 MB crawler response limit.");
  await writeFile(resolve(output, "sitemap.xml"), sitemap, "utf8");
  await writeFile(resolve(output, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${publicOrigin}/sitemap.xml\n`, "utf8");
}

async function collectFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const asset = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await collectFiles(resolve(directory, entry.name), asset));
    else files.push(asset);
  }
  return files;
}

const outputEntries = await collectFiles(output);
const expected = new Set([...PUBLIC_FILES, ...generatedNotePages, ".nojekyll", "feed.xml", ...(publicOrigin ? ["sitemap.xml"] : [])]);
for (const entry of outputEntries) {
  if (!expected.has(entry)) throw new Error(`unexpected file in Pages bundle: ${entry}`);
}
const outputSizes = await mapWithConcurrency(outputEntries, async (entry) => (await stat(resolve(output, entry))).size);
const totalOutputBytes = outputSizes.reduce((total, size) => total + size, 0);
if (totalOutputBytes > MAX_PUBLIC_ASSET_BYTES) {
  throw new Error(`Pages bundle exceeds the ${MAX_PUBLIC_ASSET_BYTES / (1024 * 1024)} MB aggregate asset limit.`);
}
console.log(`Pages bundle ready: ${output} (${PUBLIC_FILES.length + generatedNotePages.length + 2 + (publicOrigin ? 1 : 0)} files)`);
