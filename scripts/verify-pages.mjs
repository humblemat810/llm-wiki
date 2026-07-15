import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parseJsonWithUniqueKeys } from "../graph-core.js";
import { MAX_PUBLIC_ASSET_BYTES, MAX_STATIC_ASSET_BYTES } from "./public-assets.mjs";
import { computeServiceWorkerCacheRevision, readServiceWorkerCacheName, stripDeploymentCacheRevision } from "./service-worker-cache.mjs";

const output = resolve(process.argv[2] || "dist");
const outputRealPath = await realpath(output);
const manifestPath = resolve(outputRealPath, "asset-manifest.json");
const packageManifest = parseJsonWithUniqueKeys(await readFile(new URL("../package.json", import.meta.url), "utf8"), "package.json");
const isContained = (candidate) => {
  const relativePath = relative(outputRealPath, candidate);
  return relativePath && !relativePath.startsWith("..") && !relativePath.includes("/../");
};
const resolveContainedFile = async (filePath, label) => {
  const linkMetadata = await lstat(filePath);
  if (linkMetadata.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`);
  const fileRealPath = await realpath(filePath);
  if (!isContained(fileRealPath)) throw new Error(`${label} escapes its output directory.`);
  const metadata = await stat(fileRealPath);
  if (!metadata.isFile()) throw new Error(`${label} is not a regular file.`);
  return { fileRealPath, metadata };
};
const manifestFile = await resolveContainedFile(manifestPath, "Pages asset manifest");
const manifest = parseJsonWithUniqueKeys(await readFile(manifestFile.fileRealPath, "utf8"), "Pages asset manifest");

if (manifest.format !== "llm-field-notes/assets@1") throw new Error("Pages asset manifest format is unsupported.");
if (manifest.version !== packageManifest.version) throw new Error(`Pages asset manifest version does not match package.json: ${manifest.version}`);
if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error("Pages asset manifest contains no files.");

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

const manifestPaths = manifest.files.map((entry) => entry?.path);
if (new Set(manifestPaths).size !== manifestPaths.length) throw new Error("Pages asset manifest contains duplicate paths.");
if (manifestPaths.includes("asset-manifest.json") || manifestPaths.includes(".nojekyll")) {
  throw new Error("Pages asset manifest must exclude itself and .nojekyll.");
}

let totalBytes = 0;
const manifestContents = [];
for (const entry of manifest.files) {
  if (!entry || typeof entry.path !== "string" || !entry.path || entry.path.includes("\\") || entry.path.startsWith("/") || entry.path.split("/").includes("..")) {
    throw new Error(`Pages asset manifest contains an unsafe path: ${entry?.path}`);
  }
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_STATIC_ASSET_BYTES) {
    throw new Error(`Pages asset manifest contains an invalid byte length: ${entry.path}`);
  }
  if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
    throw new Error(`Pages asset manifest contains an invalid SHA-256 digest: ${entry.path}`);
  }
  const filePath = resolve(outputRealPath, entry.path);
  const file = await resolveContainedFile(filePath, `Pages asset manifest entry ${entry.path}`);
  if (file.metadata.size > MAX_STATIC_ASSET_BYTES) throw new Error(`Pages asset is missing or oversized: ${entry.path}`);
  const content = await readFile(file.fileRealPath);
  if (content.byteLength !== entry.bytes) throw new Error(`Pages asset byte length does not match its manifest: ${entry.path}`);
  if (createHash("sha256").update(content).digest("hex") !== entry.sha256) throw new Error(`Pages asset digest does not match its manifest: ${entry.path}`);
  totalBytes += file.metadata.size;
  manifestContents.push({ path: entry.path, content });
}

const outputFiles = (await collectFiles(outputRealPath))
  .filter((asset) => asset !== "asset-manifest.json" && asset !== ".nojekyll")
  .sort();
const sortedManifestPaths = [...manifestPaths].sort();
if (JSON.stringify(outputFiles) !== JSON.stringify(sortedManifestPaths)) {
  throw new Error("Pages asset manifest does not cover exactly the output files.");
}
const serviceWorkerPath = resolve(outputRealPath, "sw.js");
const serviceWorker = await readFile(serviceWorkerPath, "utf8");
const cacheName = readServiceWorkerCacheName(serviceWorker);
if (!cacheName.startsWith(`llm-field-notes-v${packageManifest.version}`)) {
  throw new Error("Pages service-worker cache does not match package.json.");
}
const cacheRevision = cacheName.match(/-([0-9a-f]{16})$/)?.[1];
if (!cacheRevision) throw new Error("Pages service-worker cache is missing its 16-character deployment revision.");
const expectedCacheRevision = computeServiceWorkerCacheRevision(
  stripDeploymentCacheRevision(serviceWorker),
  manifestContents
);
if (cacheRevision !== expectedCacheRevision) {
  throw new Error(`Pages service-worker cache revision does not match the published bundle: ${cacheRevision} !== ${expectedCacheRevision}`);
}
const manifestMetadata = manifestFile.metadata;
if (manifestMetadata.size > MAX_STATIC_ASSET_BYTES) throw new Error("Pages asset manifest is oversized.");
totalBytes += manifestMetadata.size;
const noJekyllPath = resolve(outputRealPath, ".nojekyll");
const noJekyll = await resolveContainedFile(noJekyllPath, "Pages deployment marker");
totalBytes += noJekyll.metadata.size;
if (totalBytes > MAX_PUBLIC_ASSET_BYTES) throw new Error("Pages output exceeds the aggregate public-asset limit.");

console.log(`Pages asset manifest verified: ${manifest.files.length} files (${manifest.version})`);
