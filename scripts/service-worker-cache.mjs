import { createHash } from "node:crypto";

const CACHE_PATTERN = /const CACHE = "(llm-field-notes-v[^"]+)"/;
const DEPLOYED_CACHE_PATTERN = /^(llm-field-notes-v[^"]+)-([0-9a-f]{16})$/;
const SHELL_PATTERN = /const APP_SHELL = \[([\s\S]*?)\];/;

export function readServiceWorkerCacheName(serviceWorker) {
  const match = String(serviceWorker).match(CACHE_PATTERN);
  if (!match) throw new Error("Service worker is missing its release cache declaration.");
  return match[1];
}

export function readServiceWorkerShellAssets(serviceWorker) {
  const match = String(serviceWorker).match(SHELL_PATTERN);
  if (!match) throw new Error("Service worker is missing its APP_SHELL declaration.");
  let assets;
  try {
    assets = JSON.parse(`[${match[1]}]`);
  } catch {
    throw new Error("Service worker APP_SHELL must be a valid JSON string array.");
  }
  if (!Array.isArray(assets) || assets.some((asset) => typeof asset !== "string")) {
    throw new Error("Service worker APP_SHELL must be a valid JSON string array.");
  }
  return assets;
}

export function stripDeploymentCacheRevision(serviceWorker) {
  const source = String(serviceWorker);
  const cacheName = readServiceWorkerCacheName(source);
  const deployed = cacheName.match(DEPLOYED_CACHE_PATTERN);
  if (!deployed) return source;
  return source.replace(CACHE_PATTERN, `const CACHE = "${deployed[1]}"`);
}

export function computeServiceWorkerCacheRevision(serviceWorker, entries) {
  const hash = createHash("sha256");
  hash.update(String(serviceWorker));
  for (const entry of [...entries]
    .filter((item) => item?.path !== "sw.js" && item?.path !== "asset-manifest.json" && item?.path !== ".nojekyll")
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
    hash.update(`\n${entry.path}\n`);
    hash.update(entry.content);
  }
  return hash.digest("hex").slice(0, 16);
}

export function renderDeploymentServiceWorker(serviceWorker, revision) {
  const source = String(serviceWorker);
  const cacheName = readServiceWorkerCacheName(source);
  if (!/^[0-9a-f]{16}$/.test(String(revision))) {
    throw new Error("Service-worker deployment revisions must be 16 lowercase hexadecimal characters.");
  }
  if (cacheName.endsWith(`-${revision}`)) return source;
  return source.replace(CACHE_PATTERN, `const CACHE = "${cacheName}-${revision}"`);
}
