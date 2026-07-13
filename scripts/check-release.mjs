import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { LEARNING_NOTE_ASSETS, MAX_LEARNING_NOTE_ASSETS, MAX_PUBLIC_ASSET_BYTES, MAX_STATIC_ASSET_BYTES, OFFLINE_SHELL_ASSETS, PUBLIC_ASSETS } from "./public-assets.mjs";

const packageManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const release = JSON.parse(await readFile(new URL("../version.json", import.meta.url), "utf8"));
const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const version = packageManifest.version;
const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
const workflowFiles = (await readdir(workflowDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(?:yaml|yml)$/i.test(entry.name))
  .map((entry) => `.github/workflows/${entry.name}`)
  .sort();

if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json version is not a stable semver triplet: ${version}`);
if (release.version !== version) throw new Error(`version.json (${release.version}) does not match package.json (${version})`);
if (!["stable", "unreleased"].includes(release.channel)) throw new Error(`version.json channel is unsupported: ${release.channel}`);
const releaseDate = /^\d{4}-\d{2}-\d{2}$/.test(release.date)
  ? new Date(`${release.date}T00:00:00.000Z`)
  : null;
if (!releaseDate || Number.isNaN(releaseDate.getTime()) || releaseDate.toISOString().slice(0, 10) !== release.date) {
  throw new Error(`version.json date is not an ISO calendar date: ${release.date}`);
}
if (!changelog.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md is missing a heading for ${version}`);
if (!serviceWorker.includes(`const CACHE = "llm-field-notes-v${version}"`)) throw new Error(`sw.js cache key is not aligned with package version ${version}`);
if (index.includes(`id="release-version">v${version}`)) throw new Error("index.html must not hardcode a release version");
const structuredDataMatch = index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (!structuredDataMatch) throw new Error("index.html is missing its structured discovery metadata");
const structuredDataHash = createHash("sha256").update(structuredDataMatch[1]).digest("base64");
const structuredDataCsp = `'sha256-${structuredDataHash}'`;
if (!index.includes(structuredDataCsp)) throw new Error("index.html CSP does not authorize its structured discovery metadata");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
if (!server.includes(structuredDataCsp)) throw new Error("server CSP does not authorize index.html structured discovery metadata");
const shellMatch = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/);
if (!shellMatch) throw new Error("sw.js is missing its APP_SHELL declaration");
const shellAssets = [...shellMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
if (new Set(shellAssets).size !== shellAssets.length) throw new Error("sw.js APP_SHELL contains duplicate assets");
if (JSON.stringify(shellAssets) !== JSON.stringify(OFFLINE_SHELL_ASSETS.map((asset) => asset.startsWith("./") ? asset : `./${asset}`))) {
  throw new Error("sw.js APP_SHELL is out of sync with scripts/public-assets.mjs");
}
for (const asset of shellAssets) {
  const relative = asset === "./" ? "index.html" : asset.replace(/^\.\/+/, "");
  try {
    const metadata = await stat(new URL(`../${relative}`, import.meta.url));
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_STATIC_ASSET_BYTES) throw new Error("missing, empty, or oversized file");
  } catch {
    throw new Error(`sw.js APP_SHELL asset is missing or empty: ${asset}`);
  }
}
let publicAssetBytes = 0;
for (const asset of PUBLIC_ASSETS) {
  try {
    const metadata = await stat(new URL(`../${asset}`, import.meta.url));
    if (!metadata.isFile() || metadata.size === 0) throw new Error("missing or empty file");
    publicAssetBytes += metadata.size;
  } catch {
    throw new Error(`public asset is missing or empty: ${asset}`);
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
for (const workflowFile of workflowFiles) {
  const workflow = await readFile(new URL(`../${workflowFile}`, import.meta.url), "utf8");
  const mutableActions = [...workflow.matchAll(/^\s*uses:\s*([^\s@]+)@([^\s#]+)/gm)]
    .filter((match) => !/^[0-9a-f]{40}$/i.test(match[2]));
  if (mutableActions.length) {
    throw new Error(`${workflowFile} contains mutable GitHub Action references: ${mutableActions.map((match) => `${match[1]}@${match[2]}`).join(", ")}`);
  }
}
console.log(`release check ok: ${version} (${release.channel})`);
