import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_DOCUMENT_TITLE_CHARS, parseJsonWithUniqueKeys } from "../graph-core.js";
import { MAX_LEARNING_NOTE_ASSETS, MAX_PUBLIC_ASSET_BYTES, MAX_STATIC_ASSET_BYTES, PUBLIC_ASSETS, PUBLIC_SITEMAP_ASSETS } from "./public-assets.mjs";
import { requirePublicOrigin } from "./public-origin.mjs";
import { DEFAULT_PUBLIC_REPOSITORY, requirePublicRepository } from "./public-repository.mjs";
import { buildLearningNotePage, MAX_NOTE_SUMMARY_CHARS, sliceTextAtCodePointBoundary } from "./note-page.mjs";
import { buildSampleGraphPage } from "./sample-graph-page.mjs";
import { computeServiceWorkerCacheRevision, renderDeploymentServiceWorker } from "./service-worker-cache.mjs";
await import("./check-artifacts.mjs");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, process.argv[2] || "dist");
const MAX_CRAWLER_RESPONSE_BYTES = 2 * 1024 * 1024;
const outputRelativePath = relative(root, output);
if (!outputRelativePath || outputRelativePath.startsWith("..") || outputRelativePath.includes("/../")) {
  throw new Error("Pages output must be a child directory of the repository root");
}

const PUBLIC_FILES = PUBLIC_ASSETS;
const ASSET_MANIFEST = "asset-manifest.json";
const learningNoteAssetCount = PUBLIC_FILES.filter((asset) => asset.startsWith("notes/") && asset.endsWith(".md")).length;
if (learningNoteAssetCount > MAX_LEARNING_NOTE_ASSETS) throw new Error(`The Pages manifest contains more than ${MAX_LEARNING_NOTE_ASSETS} learning notes.`);
const MAX_BUILD_CONCURRENCY = 16;
const lexicalCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const READ_ONLY_NOFOLLOW_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);

const rootRealPath = await realpath(root);
const publicOrigin = requirePublicOrigin(process.env.PUBLIC_ORIGIN, { requireSecure: true });
const publicRepository = requirePublicRepository(process.env.PUBLIC_REPOSITORY_URL);
const rawBuildRevision = typeof process.env.BUILD_REVISION === "string" && process.env.BUILD_REVISION.trim()
  ? process.env.BUILD_REVISION.trim().toLowerCase()
  : "unknown";
if (!/^(?:unknown|[0-9a-f]{7,64})$/.test(rawBuildRevision)) {
  throw new Error("BUILD_REVISION must be unknown or a 7–64 character hexadecimal source revision.");
}
const buildRevision = rawBuildRevision;

async function readBoundedUtf8(filePath, maxBytes) {
  const byteLimit = Math.max(1, Math.floor(maxBytes));
  const handle = await open(filePath, READ_ONLY_NOFOLLOW_FLAGS);
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

async function copyBoundedFile(sourcePath, destinationPath, maxBytes) {
  const sourceHandle = await open(sourcePath, READ_ONLY_NOFOLLOW_FLAGS);
  let destinationHandle = null;
  let total = 0;
  try {
    destinationHandle = await open(
      destinationPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC,
      0o644
    );
    while (total <= maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - total + 1));
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, total);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error(`file exceeds the ${maxBytes} byte safety limit`);
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(buffer, written, bytesRead - written);
        if (!result.bytesWritten) throw new Error("Pages asset copy made no progress.");
        written += result.bytesWritten;
      }
    }
  } finally {
    await Promise.allSettled([
      sourceHandle.close(),
      destinationHandle?.close()
    ]);
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
const buildOutput = await mkdtemp(resolve(root, ".llm-field-notes-pages-build-"));

function isContained(candidate) {
  const relativePath = relative(rootRealPath, candidate);
  return relativePath && !relativePath.startsWith("..") && !relativePath.includes("/../");
}

async function copyPublicFile(asset) {
  const source = resolve(root, asset);
  if ((await lstat(source)).isSymbolicLink()) throw new Error(`public asset must not be a symbolic link: ${asset}`);
  const sourceRealPath = await realpath(source);
  if (!isContained(sourceRealPath)) throw new Error(`public asset escapes repository root: ${asset}`);
  const metadata = await stat(sourceRealPath);
  if (!metadata.isFile() || metadata.size === 0) throw new Error(`public asset is missing or empty: ${asset}`);
  if (metadata.size > MAX_STATIC_ASSET_BYTES) throw new Error(`public asset exceeds the ${MAX_STATIC_ASSET_BYTES / (1024 * 1024)} MB safety limit: ${asset}`);
  const destination = resolve(buildOutput, asset);
  await mkdir(dirname(destination), { recursive: true });
  await copyBoundedFile(sourceRealPath, destination, MAX_STATIC_ASSET_BYTES);
}

async function preflightPublicAssetBudget() {
  let totalBytes = 0;
  for (const asset of PUBLIC_FILES) {
    const source = resolve(root, asset);
    if ((await lstat(source)).isSymbolicLink()) throw new Error(`public asset must not be a symbolic link: ${asset}`);
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

function renderOriginAwareIndex(content, origin, repository = DEFAULT_PUBLIC_REPOSITORY) {
  if (!origin && repository === DEFAULT_PUBLIC_REPOSITORY) return content;
  if (!origin) return content.replaceAll(DEFAULT_PUBLIC_REPOSITORY, repository);
  const rootUrl = `${origin}/`;
  const rendered = content
    .replace('href="./" />', () => `href="${rootUrl}" />`)
    .replace('href="feed.xml"', () => `href="${origin}/feed.xml"`)
    .replace('content="./" />', () => `content="${rootUrl}" />`)
    .replace('"url": "./"', () => `"url": "${rootUrl}"`)
    .replace(/content="social-card\.png"/g, () => `content="${origin}/social-card.png"`)
    .replaceAll(DEFAULT_PUBLIC_REPOSITORY, repository);
  const structuredDataMatch = rendered.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!structuredDataMatch) return rendered;
  const structuredDataCsp = `'sha256-${createHash("sha256").update(structuredDataMatch[1]).digest("base64")}'`;
  return rendered.replace(/'sha256-[^']+'/g, structuredDataCsp);
}

function renderOriginAwareArtifactPage(content, origin, repository = DEFAULT_PUBLIC_REPOSITORY) {
  if (!origin && repository === DEFAULT_PUBLIC_REPOSITORY) return content;
  if (!origin) return content.replaceAll(DEFAULT_PUBLIC_REPOSITORY, repository);
  return content
    .replace('href="./"', () => `href="${origin}/"`)
    .replace('content="./artifacts.html"', () => `content="${origin}/artifacts.html"`)
    .replace('content="social-card.png"', () => `content="${origin}/social-card.png"`)
    .replace('href="./artifacts.html"', () => `href="${origin}/artifacts.html"`)
    .replace('"@id":"./artifacts.html"', () => `"@id":"${origin}/artifacts.html"`)
    .replace('"url":"./artifacts.html"', () => `"url":"${origin}/artifacts.html"`)
    .replace(/"url":"(experiments\/[^"]+)"/g, (_, asset) => `"url":"${origin}/${asset}"`)
    .replaceAll(DEFAULT_PUBLIC_REPOSITORY, repository);
}

function renderOriginAwareSharePage(content, origin, repository = DEFAULT_PUBLIC_REPOSITORY) {
  if (!origin && repository === DEFAULT_PUBLIC_REPOSITORY) return content;
  const rendered = origin
    ? content
      .replace('href="./"', () => `href="${origin}/"`)
      .replace('content="./share.html"', () => `content="${origin}/share.html"`)
      .replace('content="social-card.png"', () => `content="${origin}/social-card.png"`)
      .replace('href="./share.html"', () => `href="${origin}/share.html"`)
    : content;
  return rendered
    .replaceAll(DEFAULT_PUBLIC_REPOSITORY, repository);
}

function renderRepositoryAwareSecurityTxt(content, repository = DEFAULT_PUBLIC_REPOSITORY) {
  return content.toString("utf8").replaceAll(DEFAULT_PUBLIC_REPOSITORY, repository);
}

function renderNotFoundPage(content, origin = "") {
  const base = origin ? `${origin}/` : "/";
  return content.toString("utf8")
    .replaceAll('href="./styles.css"', `href="${base}styles.css"`)
    .replaceAll('href="./"', `href="${base}"`)
    .replaceAll('href="./artifacts.html"', `href="${base}artifacts.html"`);
}

function fallbackNoteTitle(asset) {
  return asset.slice("notes/".length, -".md".length).replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function deriveNoteSummary(content, title) {
  const boundedContent = sliceTextAtCodePointBoundary(content, MAX_NOTE_SUMMARY_CHARS);
  const question = boundedContent.match(/^>\s*(.+)$/m)?.[1]?.trim() || "";
  const withoutFrontmatter = boundedContent.replace(/^---[\s\S]*?---\s*/m, "");
  const paragraphs = withoutFrontmatter.replace(/^#+\s+.+$/gm, "").split(/\n\s*\n/).map((paragraph) => paragraph
    .replace(/^>\s?/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim())
    .filter((paragraph) => paragraph && paragraph !== title && paragraph !== question);
  return sliceTextAtCodePointBoundary([question, paragraphs[0] || title].filter(Boolean).join(" "), 280);
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
      title: sliceTextAtCodePointBoundary(title, MAX_DOCUMENT_TITLE_CHARS),
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

async function buildStaticFeed(origin = "") {
  const release = parseJsonWithUniqueKeys(await readFile(resolve(root, "version.json"), "utf8"), "version.json");
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
    ...PUBLIC_SITEMAP_ASSETS.map((asset) => new URL(`./${asset}`, base).toString()),
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

async function buildPages() {
  await preflightPublicAssetBudget();
  await mkdir(buildOutput, { recursive: true });
  await mapWithConcurrency(PUBLIC_FILES, copyPublicFile);
  const releasePath = resolve(buildOutput, "version.json");
  const releaseMetadata = parseJsonWithUniqueKeys(await readFile(releasePath, "utf8"), "version.json");
  await writeFile(releasePath, `${JSON.stringify({ ...releaseMetadata, revision: buildRevision }, null, 2)}\n`, "utf8");
  const learningNotes = await readLearningNotes();
  const generatedNotePages = learningNotes.map((note) => `notes/${note.id}.html`);
  const sampleGraph = parseJsonWithUniqueKeys(await readBoundedUtf8(resolve(buildOutput, "examples/sample-graph.json"), MAX_STATIC_ASSET_BYTES), "sample graph");
  const sampleGraphPage = buildSampleGraphPage(sampleGraph, publicOrigin);
  if (Buffer.byteLength(sampleGraphPage) > MAX_STATIC_ASSET_BYTES) {
    throw new Error(`Generated sample graph page exceeds the ${MAX_STATIC_ASSET_BYTES / (1024 * 1024)} MB safety limit.`);
  }
  await writeFile(resolve(buildOutput, "sample-graph.html"), sampleGraphPage, "utf8");
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
      resolve(buildOutput, `notes/${note.id}.html`),
      page,
      "utf8"
    );
  });
  const serviceWorkerPath = resolve(buildOutput, "sw.js");
  let serviceWorker = await readFile(serviceWorkerPath, "utf8");
  const generatedShellAssets = [`./${ASSET_MANIFEST}`, "./sample-graph.html", ...generatedNotePages.map((asset) => `./${asset}`)];
  if (generatedShellAssets.length) {
    const generatedShellLiteral = generatedShellAssets.map((asset) => JSON.stringify(asset)).join(", ");
    const shellMarker = "const APP_SHELL = [";
    if (!serviceWorker.includes(shellMarker)) throw new Error("Pages service worker is missing its APP_SHELL declaration.");
    serviceWorker = serviceWorker.replace(shellMarker, `${shellMarker}${generatedShellLiteral}, `);
    if (!serviceWorker.includes(generatedShellLiteral)) throw new Error("Pages note pages could not be added to the service-worker shell.");
  }
  const cacheMarker = "const CACHE = \"llm-field-notes-v";
  if (!serviceWorker.includes(cacheMarker)) throw new Error("Pages service worker is missing its release cache marker.");
  await writeFile(resolve(buildOutput, ".nojekyll"), "", "utf8");
  if (publicOrigin) {
    const indexPath = resolve(buildOutput, "index.html");
    const index = await readFile(indexPath, "utf8");
    const renderedIndex = renderOriginAwareIndex(index, publicOrigin, publicRepository);
    if (Buffer.byteLength(renderedIndex) > MAX_STATIC_ASSET_BYTES) {
      throw new Error(`origin-aware index exceeds the ${MAX_STATIC_ASSET_BYTES / (1024 * 1024)} MB safety limit`);
    }
    await writeFile(indexPath, renderedIndex, "utf8");
    const artifactPath = resolve(buildOutput, "artifacts.html");
    const artifact = await readFile(artifactPath, "utf8");
    const renderedArtifact = renderOriginAwareArtifactPage(artifact, publicOrigin, publicRepository);
    if (Buffer.byteLength(renderedArtifact) > MAX_STATIC_ASSET_BYTES) {
      throw new Error(`origin-aware artifact gallery exceeds the ${MAX_STATIC_ASSET_BYTES / (1024 * 1024)} MB safety limit`);
    }
    await writeFile(artifactPath, renderedArtifact, "utf8");
    const sharePath = resolve(buildOutput, "share.html");
    const share = await readFile(sharePath, "utf8");
    const renderedShare = renderOriginAwareSharePage(share, publicOrigin, publicRepository);
    if (Buffer.byteLength(renderedShare) > MAX_STATIC_ASSET_BYTES) {
      throw new Error(`origin-aware share page exceeds the ${MAX_STATIC_ASSET_BYTES / (1024 * 1024)} MB safety limit`);
    }
    await writeFile(sharePath, renderedShare, "utf8");
  }
  const securityPath = resolve(buildOutput, ".well-known/security.txt");
  const security = await readFile(securityPath, "utf8");
  const renderedSecurity = renderRepositoryAwareSecurityTxt(security, publicRepository);
  if (Buffer.byteLength(renderedSecurity) > MAX_STATIC_ASSET_BYTES) {
    throw new Error("repository-aware security metadata exceeds the 10 MB safety limit");
  }
  await writeFile(securityPath, renderedSecurity, "utf8");
  const notFoundPath = resolve(buildOutput, "404.html");
  const notFound = await readFile(notFoundPath, "utf8");
  const renderedNotFound = renderNotFoundPage(notFound, publicOrigin);
  if (Buffer.byteLength(renderedNotFound) > MAX_STATIC_ASSET_BYTES) {
    throw new Error("origin-aware 404 page exceeds the 10 MB safety limit");
  }
  await writeFile(notFoundPath, renderedNotFound, "utf8");
  const feed = await buildStaticFeed(publicOrigin);
  if (Buffer.byteLength(feed) > MAX_CRAWLER_RESPONSE_BYTES) throw new Error("Generated feed exceeds the 2 MB crawler response limit.");
  await writeFile(resolve(buildOutput, "feed.xml"), feed, "utf8");
  if (publicOrigin) {
    const sitemap = await buildStaticSitemap(publicOrigin);
    if (Buffer.byteLength(sitemap) > MAX_CRAWLER_RESPONSE_BYTES) throw new Error("Generated sitemap exceeds the 2 MB crawler response limit.");
    await writeFile(resolve(buildOutput, "sitemap.xml"), sitemap, "utf8");
    await writeFile(resolve(buildOutput, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${publicOrigin}/sitemap.xml\n`, "utf8");
  }

  const cacheRevisionEntries = await collectFiles(buildOutput);
  const cacheRevision = computeServiceWorkerCacheRevision(
    serviceWorker,
    await Promise.all(cacheRevisionEntries.map(async (entry) => ({
      path: entry,
      content: await readFile(resolve(buildOutput, entry))
    })))
  );
  const renderedCache = renderDeploymentServiceWorker(serviceWorker, cacheRevision);
  if (renderedCache === serviceWorker) throw new Error("Pages service worker cache identity could not be deployment-scoped.");
  await writeFile(serviceWorkerPath, renderedCache, "utf8");

  const outputEntries = await collectFiles(buildOutput);
  const manifestEntries = (await mapWithConcurrency(
    outputEntries.filter((entry) => entry !== ".nojekyll" && entry !== ASSET_MANIFEST).sort(),
    async (entry) => {
      const content = await readFile(resolve(buildOutput, entry));
      return {
        path: entry,
        bytes: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex")
      };
    }
  ));
  const release = parseJsonWithUniqueKeys(await readFile(resolve(buildOutput, "version.json"), "utf8"), "version.json");
  const assetManifest = {
    format: "llm-field-notes/assets@1",
    version: release.version,
    files: manifestEntries
  };
  await writeFile(resolve(buildOutput, ASSET_MANIFEST), `${JSON.stringify(assetManifest, null, 2)}\n`, "utf8");
  const finalOutputEntries = await collectFiles(buildOutput);
  const expected = new Set([...PUBLIC_FILES, "sample-graph.html", ...generatedNotePages, ".nojekyll", "feed.xml", ASSET_MANIFEST, ...(publicOrigin ? ["sitemap.xml"] : [])]);
  const finalOutputSet = new Set(finalOutputEntries);
  for (const entry of finalOutputEntries) {
    if (!expected.has(entry)) throw new Error(`unexpected file in Pages bundle: ${entry}`);
  }
  if (finalOutputEntries.length !== expected.size || [...expected].some((entry) => !finalOutputSet.has(entry))) {
    throw new Error("Pages bundle does not contain exactly the expected published and generated files.");
  }
  const outputSizes = await mapWithConcurrency(finalOutputEntries, async (entry) => (await stat(resolve(buildOutput, entry))).size);
  const totalOutputBytes = outputSizes.reduce((total, size) => total + size, 0);
  if (totalOutputBytes > MAX_PUBLIC_ASSET_BYTES) {
    throw new Error(`Pages bundle exceeds the ${MAX_PUBLIC_ASSET_BYTES / (1024 * 1024)} MB aggregate asset limit.`);
  }
  return { generatedNotePages, fileCount: finalOutputEntries.length };
}

async function publishPages() {
  const previous = `${output}.previous-${process.pid}-${Date.now()}`;
  let movedPrevious = false;
  let published = false;
  try {
    try {
      const outputMetadata = await lstat(output);
      if (outputMetadata.isSymbolicLink()) {
        throw new Error("Pages output must not be a symbolic link.");
      }
      await stat(output);
      await rm(previous, { recursive: true, force: true });
      await rename(output, previous);
      movedPrevious = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(buildOutput, output);
    published = true;
    if (movedPrevious) await rm(previous, { recursive: true, force: true });
  } catch (error) {
    if (published) await rm(output, { recursive: true, force: true }).catch(() => {});
    if (movedPrevious) await rename(previous, output).catch(() => {});
    throw error;
  }
}

try {
  const result = await buildPages();
  await publishPages();
  console.log(`Pages bundle ready: ${output} (${result.fileCount} files)`);
} catch (error) {
  await rm(buildOutput, { recursive: true, force: true }).catch(() => {});
  throw error;
}
