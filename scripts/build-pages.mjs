import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_ASSETS } from "./public-assets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, process.argv[2] || "dist");
const outputRelativePath = relative(root, output);
if (!outputRelativePath || outputRelativePath.startsWith("..") || outputRelativePath.includes("/../")) {
  throw new Error("Pages output must be a child directory of the repository root");
}

const PUBLIC_FILES = PUBLIC_ASSETS;

const rootRealPath = await realpath(root);

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
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fallbackNoteTitle(asset) {
  return asset.slice("notes/".length, -".md".length).replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

async function buildStaticFeed() {
  const release = JSON.parse(await readFile(resolve(root, "version.json"), "utf8"));
  const updated = /^\d{4}-\d{2}-\d{2}$/.test(release.date)
    ? `${release.date}T00:00:00.000Z`
    : "1970-01-01T00:00:00.000Z";
  const notes = await Promise.all(PUBLIC_FILES
    .filter((asset) => asset.startsWith("notes/") && asset.endsWith(".md") && asset !== "notes/README.md")
    .map(async (asset) => {
      const content = await readFile(resolve(root, asset), "utf8");
      const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallbackNoteTitle(asset);
      const description = content
        .replace(/^---[\s\S]*?---\s*/m, "")
        .replace(/^#\s+.+$/m, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280);
      return { asset, title: title.slice(0, 200), description };
    }));
  const entries = notes.sort((left, right) => left.asset.localeCompare(right.asset)).map(({ asset, title, description }) => [
    "  <entry>",
    `    <id>urn:llm-field-notes:${xmlEscape(asset)}</id>`,
    `    <title>${xmlEscape(title)}</title>`,
    `    <link href="./${xmlEscape(asset)}" />`,
    `    <updated>${updated}</updated>`,
    `    <summary>${xmlEscape(description)}</summary>`,
    "  </entry>"
  ].join("\n"));
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "  <title>LLM Field Notes learning map</title>",
    "  <id>urn:llm-field-notes:learning-map</id>",
    '  <link href="./feed.xml" rel="self" />',
    `  <updated>${updated}</updated>`,
    "  <subtitle>Runnable notes for turning documents into useful, inspectable systems.</subtitle>",
    ...entries,
    "</feed>",
    ""
  ].join("\n");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(PUBLIC_FILES.map(copyPublicFile));
await writeFile(resolve(output, ".nojekyll"), "", "utf8");
await writeFile(resolve(output, "feed.xml"), await buildStaticFeed(), "utf8");

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
const expected = new Set([...PUBLIC_FILES, ".nojekyll", "feed.xml"]);
for (const entry of outputEntries) {
  if (!expected.has(entry)) throw new Error(`unexpected file in Pages bundle: ${entry}`);
}
console.log(`Pages bundle ready: ${output} (${PUBLIC_FILES.length + 2} files)`);
