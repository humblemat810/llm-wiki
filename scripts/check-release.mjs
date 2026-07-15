import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { relative } from "node:path";
import { parseJsonWithUniqueKeys } from "../graph-core.js";
import { LEARNING_NOTE_ASSETS, MAX_LEARNING_NOTE_ASSETS, MAX_PUBLIC_ASSET_BYTES, MAX_STATIC_ASSET_BYTES, OFFLINE_SHELL_ASSETS, PUBLIC_ASSETS, PUBLIC_SITEMAP_ASSETS } from "./public-assets.mjs";
import { readServiceWorkerShellAssets } from "./service-worker-cache.mjs";

const packageManifest = parseJsonWithUniqueKeys(await readFile(new URL("../package.json", import.meta.url), "utf8"), "package.json");
const packageLock = parseJsonWithUniqueKeys(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"), "package-lock.json");
const release = parseJsonWithUniqueKeys(await readFile(new URL("../version.json", import.meta.url), "utf8"), "version.json");
const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const notesIndex = await readFile(new URL("../notes/README.md", import.meta.url), "utf8");
const { notes: browserNotes } = await import(new URL("../curriculum.js", import.meta.url));
const llms = await readFile(new URL("../llms.txt", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const dockerignore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");
const version = packageManifest.version;
const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
const rootRealPath = await realpath(new URL("../", import.meta.url));
const isContained = (candidate) => {
  const relativePath = relative(rootRealPath, candidate);
  return relativePath && !relativePath.startsWith("..") && !relativePath.includes("/../");
};
const checkPublicAsset = async (asset) => {
  const source = new URL(`../${asset}`, import.meta.url);
  if ((await lstat(source)).isSymbolicLink()) throw new Error(`public asset must not be a symbolic link: ${asset}`);
  const resolved = await realpath(source);
  if (!isContained(resolved)) throw new Error(`public asset escapes repository root: ${asset}`);
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_STATIC_ASSET_BYTES) {
    throw new Error("missing, empty, or oversized file");
  }
  return metadata.size;
};
const localLlmsLinks = [...llms.matchAll(/\]\(([^)]+)\)/g)]
  .map((match) => match[1].trim())
  .filter((target) => target.startsWith("./"));
for (const target of localLlmsLinks) {
  const pathWithoutFragment = target.split("#", 1)[0].split("?", 1)[0];
  const asset = pathWithoutFragment === "./" ? "index.html" : pathWithoutFragment.slice(2);
  if (!asset || asset.startsWith("/") || asset.includes("..") || asset.includes("\\")) {
    throw new Error(`llms.txt contains an unsafe local link: ${target}`);
  }
  try {
    await checkPublicAsset(asset);
  } catch {
    throw new Error(`llms.txt links to a missing or unpublished asset: ${target}`);
  }
}
const workflowFiles = (await readdir(workflowDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(?:yaml|yml)$/i.test(entry.name))
  .map((entry) => `.github/workflows/${entry.name}`)
  .sort();
for (const [label, assets] of [["public assets", PUBLIC_ASSETS], ["offline shell assets", OFFLINE_SHELL_ASSETS], ["sitemap assets", PUBLIC_SITEMAP_ASSETS]]) {
  const duplicates = assets.filter((asset, index) => assets.indexOf(asset) !== index);
  if (duplicates.length) throw new Error(`${label} contain duplicate entries: ${[...new Set(duplicates)].join(", ")}`);
}
const unpublishedSitemapAssets = PUBLIC_SITEMAP_ASSETS.filter((asset) => !PUBLIC_ASSETS.includes(asset));
if (unpublishedSitemapAssets.length) throw new Error(`sitemap assets are not published assets: ${unpublishedSitemapAssets.join(", ")}`);

if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json version is not a stable semver triplet: ${version}`);
if (packageManifest.license !== "CC-BY-4.0") throw new Error(`package.json license must declare CC-BY-4.0: ${packageManifest.license}`);
const lockedRoot = packageLock?.packages?.[""];
if (packageLock.lockfileVersion !== 3
  || !lockedRoot
  || lockedRoot.name !== packageManifest.name
  || lockedRoot.version !== packageManifest.version
  || lockedRoot.license !== packageManifest.license
  || JSON.stringify(lockedRoot.engines) !== JSON.stringify(packageManifest.engines)) {
  throw new Error("package-lock.json root metadata is out of sync with package.json");
}
if (release.version !== version) throw new Error(`version.json (${release.version}) does not match package.json (${version})`);
if (!["stable", "unreleased"].includes(release.channel)) throw new Error(`version.json channel is unsupported: ${release.channel}`);
const releaseDate = /^\d{4}-\d{2}-\d{2}$/.test(release.date)
  ? new Date(`${release.date}T00:00:00.000Z`)
  : null;
if (!releaseDate || Number.isNaN(releaseDate.getTime()) || releaseDate.toISOString().slice(0, 10) !== release.date) {
  throw new Error(`version.json date is not an ISO calendar date: ${release.date}`);
}
const todayUtc = new Date();
todayUtc.setUTCHours(0, 0, 0, 0);
if (releaseDate.getTime() > todayUtc.getTime()) {
  throw new Error(`version.json date cannot be in the future: ${release.date}`);
}
const unreleasedHeadings = changelog.match(/^## \[Unreleased\]$/gm) || [];
if (unreleasedHeadings.length !== 1) throw new Error("CHANGELOG.md must contain exactly one ## [Unreleased] heading.");
if (/^## Unreleased$/m.test(changelog)) throw new Error("CHANGELOG.md must use the bracketed [Unreleased] heading.");
const versionHeadings = changelog.match(new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "gm")) || [];
if (versionHeadings.length !== 1) throw new Error(`CHANGELOG.md must contain exactly one heading for ${version}.`);
if (!serviceWorker.includes(`const CACHE = "llm-field-notes-v${version}"`)) throw new Error(`sw.js cache key is not aligned with package version ${version}`);
if (!/^FROM node:22-alpine@sha256:[0-9a-f]{64}$/m.test(dockerfile)) {
  throw new Error("Dockerfile must use the digest-pinned Node 22 Alpine production baseline");
}
if (!dockerignore.split(/\r?\n/).some((entry) => entry.trim() === ".codex")) {
  throw new Error(".dockerignore must exclude .codex");
}
const dockerVersion = dockerfile.match(/^ARG APP_VERSION=(\d+\.\d+\.\d+)$/m)?.[1];
const dockerRevision = dockerfile.match(/^ARG VCS_REF=([^\s]+)$/m)?.[1];
if (dockerVersion !== version
  || dockerRevision !== "unknown"
  || !dockerfile.includes('org.opencontainers.image.version="$APP_VERSION"')
  || !dockerfile.includes('org.opencontainers.image.revision="$VCS_REF"')
  || !dockerfile.includes('org.opencontainers.image.source="https://github.com/humblemat810/llm-wiki"')
  || !dockerfile.includes('org.opencontainers.image.documentation="https://github.com/humblemat810/llm-wiki/blob/main/RUNBOOK.md"')
  || !dockerfile.includes("ENV BUILD_REVISION=$VCS_REF")
  || !dockerfile.includes('org.opencontainers.image.description=')
  || !dockerfile.includes('org.opencontainers.image.licenses="CC-BY-4.0"')) {
  throw new Error(`Docker image metadata must identify release ${version}`);
}
if (index.includes(`id="release-version">v${version}`)) throw new Error("index.html must not hardcode a release version");
const structuredDataMatch = index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (!structuredDataMatch) throw new Error("index.html is missing its structured discovery metadata");
const structuredDataHash = createHash("sha256").update(structuredDataMatch[1]).digest("base64");
const structuredDataCsp = `'sha256-${structuredDataHash}'`;
if (!index.includes(structuredDataCsp)) throw new Error("index.html CSP does not authorize its structured discovery metadata");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
if (!server.includes(structuredDataCsp)) throw new Error("server CSP does not authorize index.html structured discovery metadata");
const shellAssets = readServiceWorkerShellAssets(serviceWorker);
if (new Set(shellAssets).size !== shellAssets.length) throw new Error("sw.js APP_SHELL contains duplicate assets");
if (JSON.stringify(shellAssets) !== JSON.stringify(OFFLINE_SHELL_ASSETS.map((asset) => asset.startsWith("./") ? asset : `./${asset}`))) {
  throw new Error("sw.js APP_SHELL is out of sync with scripts/public-assets.mjs");
}
for (const asset of shellAssets) {
  const relative = asset === "./" ? "index.html" : asset.replace(/^\.\/+/, "");
  try {
    await checkPublicAsset(relative);
  } catch {
    throw new Error(`sw.js APP_SHELL asset is missing or empty: ${asset}`);
  }
}
let publicAssetBytes = 0;
for (const asset of PUBLIC_ASSETS) {
  try {
    publicAssetBytes += await checkPublicAsset(asset);
  } catch {
    throw new Error(`public asset is missing, empty, or oversized: ${asset}`);
  }
}
if (publicAssetBytes > MAX_PUBLIC_ASSET_BYTES) {
  throw new Error(`public assets exceed the ${MAX_PUBLIC_ASSET_BYTES / (1024 * 1024)} MB aggregate asset limit`);
}
const discoveredLearningNotes = (await readdir(new URL("../notes/", import.meta.url), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => `notes/${entry.name}`)
  .sort();
if (JSON.stringify(discoveredLearningNotes) !== JSON.stringify([...LEARNING_NOTE_ASSETS].sort())) {
  throw new Error("learning-note assets are out of sync with scripts/public-assets.mjs");
}
if (discoveredLearningNotes.length > MAX_LEARNING_NOTE_ASSETS) throw new Error(`learning-note assets exceed the ${MAX_LEARNING_NOTE_ASSETS} asset limit`);
const browserNoteIds = browserNotes.map((note) => note.id).sort();
const browserNoteTitles = new Map(browserNotes.map((note) => [note.id, note.title]));
const browserNoteQuestions = new Map(browserNotes.map((note) => [note.id, note.question]));
const decodeHtml = (value) => String(value)
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&#039;", "'");
const expectedCurriculumCounts = new Map([
  ["all", browserNotes.length],
  ...[...new Set(browserNotes.map((note) => note.category))].map((category) => [
    category,
    browserNotes.filter((note) => note.category === category).length
  ])
]);
const publishedCurriculumCounts = new Map([...index.matchAll(/<button[^>]*data-filter="([^"]+)"[^>]*>[\s\S]*?<span>(\d+)<\/span><\/button>/g)]
  .map((match) => [match[1], Number(match[2])]));
for (const [category, count] of expectedCurriculumCounts) {
  if (publishedCurriculumCounts.get(category) !== count) {
    throw new Error(`curriculum filter count is out of sync for ${category}`);
  }
}
const publishedNoteIds = LEARNING_NOTE_ASSETS
  .filter((asset) => asset !== "notes/README.md")
  .map((asset) => asset.slice("notes/".length, -".md".length))
  .sort();
if (JSON.stringify(browserNoteIds) !== JSON.stringify(publishedNoteIds)) {
  throw new Error("browser curriculum notes are out of sync with published learning notes");
}
const noScriptNoteIds = [...index.matchAll(/href="\.\/notes\/([^"]+)\.html"/g)].map((match) => match[1]).sort();
const noScriptNoteTitles = new Map([...index.matchAll(/href="\.\/notes\/([^"]+)\.html"><strong>([^<]+)<\/strong>/g)]
  .map((match) => [match[1], match[2]]));
if (JSON.stringify(noScriptNoteIds) !== JSON.stringify(publishedNoteIds)) {
  throw new Error("no-script curriculum links are out of sync with published learning notes");
}
for (const noteId of publishedNoteIds) {
  if (!notesIndex.includes(`(${noteId}.md)`)) throw new Error(`notes/README.md is missing learning note ${noteId}`);
  if (decodeHtml(noScriptNoteTitles.get(noteId) || "") !== browserNoteTitles.get(noteId)) {
    throw new Error(`no-script curriculum title is out of sync for learning note ${noteId}`);
  }
  const noteContent = await readFile(new URL(`../notes/${noteId}.md`, import.meta.url), "utf8");
  const noteTitle = noteContent.match(/^title:\s*(.+)$/m)?.[1]?.trim();
  if (!noteTitle || browserNoteTitles.get(noteId) !== noteTitle) {
    throw new Error(`curriculum title is out of sync for learning note ${noteId}`);
  }
  const noteQuestion = noteContent.match(/^>\s*(.+)$/m)?.[1]?.trim();
  if (!noteQuestion || browserNoteQuestions.get(noteId) !== noteQuestion) {
    throw new Error(`curriculum question is out of sync for learning note ${noteId}`);
  }
}
for (const workflowFile of workflowFiles) {
  const workflow = await readFile(new URL(`../${workflowFile}`, import.meta.url), "utf8");
  if (!/^\s*permissions:\s*$/m.test(workflow)) {
    throw new Error(`${workflowFile} must declare an explicit top-level permissions policy`);
  }
  if (/\bpermissions:\s*write-all\b|\bwrite-all\b/.test(workflow)) {
    throw new Error(`${workflowFile} must not grant write-all permissions`);
  }
  if (/^\s*pull_request_target\s*:/m.test(workflow)) {
    throw new Error(`${workflowFile} must not execute untrusted pull requests with pull_request_target`);
  }
  if (!/^\s*concurrency:\s*$/m.test(workflow)) {
    throw new Error(`${workflowFile} must declare concurrency controls`);
  }
  const mutableActions = [...workflow.matchAll(/^\s*uses:\s*([^\s@]+)@([^\s#]+)/gm)]
    .filter((match) => !/^[0-9a-f]{40}$/i.test(match[2]));
  if (mutableActions.length) {
    throw new Error(`${workflowFile} contains mutable GitHub Action references: ${mutableActions.map((match) => `${match[1]}@${match[2]}`).join(", ")}`);
  }
  const checkoutCount = [...workflow.matchAll(/^\s*uses:\s*actions\/checkout@[^\s#]+/gm)].length;
  const disabledCheckoutCredentialCount = [...workflow.matchAll(/^\s*persist-credentials:\s*false\s*$/gm)].length;
  if (disabledCheckoutCredentialCount < checkoutCount) {
    throw new Error(`${workflowFile} must disable persisted checkout credentials`);
  }
}
await import("./check-artifacts.mjs");
console.log(`release check ok: ${version} (${release.channel})`);
