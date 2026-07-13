import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_ASSETS } from "./public-assets.mjs";
import { normalizePublicOrigin } from "./public-origin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, process.argv[2] || "dist");
const MAX_CRAWLER_RESPONSE_BYTES = 2 * 1024 * 1024;
const outputRelativePath = relative(root, output);
if (!outputRelativePath || outputRelativePath.startsWith("..") || outputRelativePath.includes("/../")) {
  throw new Error("Pages output must be a child directory of the repository root");
}

const PUBLIC_FILES = PUBLIC_ASSETS;
const lexicalCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const rootRealPath = await realpath(root);
const publicOrigin = normalizePublicOrigin(process.env.PUBLIC_ORIGIN);

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
  const destination = resolve(output, asset);
  await mkdir(dirname(destination), { recursive: true });
  await cp(sourceRealPath, destination);
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
  const question = content.match(/^>\s*(.+)$/m)?.[1]?.trim() || "";
  const withoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/m, "");
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
  return Promise.all(PUBLIC_FILES
    .filter((asset) => asset.startsWith("notes/") && asset.endsWith(".md") && asset !== "notes/README.md")
    .map(async (asset) => {
      const content = await readFile(resolve(root, asset), "utf8");
      const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallbackNoteTitle(asset);
      return { asset, title: title.slice(0, 200), description: deriveNoteSummary(content, title) };
    }));
}

async function buildStaticFeed(origin = "") {
  const release = JSON.parse(await readFile(resolve(root, "version.json"), "utf8"));
  const updated = /^\d{4}-\d{2}-\d{2}$/.test(release.date)
    ? `${release.date}T00:00:00.000Z`
    : "1970-01-01T00:00:00.000Z";
  const notes = await readLearningNotes();
  const base = origin ? `${origin}/` : "./";
  const entries = notes.sort((left, right) => lexicalCompare(left.asset, right.asset)).map(({ asset, title, description }) => [
    "  <entry>",
    `    <id>${xmlEscape(origin ? new URL(`./${asset}`, base).toString() : `urn:llm-field-notes:${asset}`)}</id>`,
    `    <title>${xmlEscape(title)}</title>`,
    `    <link href="${xmlEscape(origin ? new URL(`./${asset}`, base).toString() : `./${asset}`)}" />`,
    `    <updated>${updated}</updated>`,
    `    <summary>${xmlEscape(description)}</summary>`,
    "  </entry>"
  ].join("\n"));
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
  const urls = [new URL("./", base).toString(), ...notes.map(({ asset }) => new URL(`./${asset}`, base).toString())];
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`),
    "</urlset>",
    ""
  ].join("\n");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(PUBLIC_FILES.map(copyPublicFile));
await writeFile(resolve(output, ".nojekyll"), "", "utf8");
if (publicOrigin) {
  const indexPath = resolve(output, "index.html");
  const index = await readFile(indexPath, "utf8");
  await writeFile(indexPath, renderOriginAwareIndex(index, publicOrigin), "utf8");
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
const expected = new Set([...PUBLIC_FILES, ".nojekyll", "feed.xml", ...(publicOrigin ? ["sitemap.xml"] : [])]);
for (const entry of outputEntries) {
  if (!expected.has(entry)) throw new Error(`unexpected file in Pages bundle: ${entry}`);
}
console.log(`Pages bundle ready: ${output} (${PUBLIC_FILES.length + 2 + (publicOrigin ? 1 : 0)} files)`);
