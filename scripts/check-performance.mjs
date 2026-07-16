import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_SHELL_ASSETS } from "./public-assets.mjs";

export const MAX_CRITICAL_HTML_BYTES = 100 * 1024;
export const MAX_CRITICAL_STYLE_BYTES = 128 * 1024;
export const MAX_CRITICAL_SCRIPT_BYTES = 768 * 1024;
export const MAX_CRITICAL_SHELL_BYTES = 1024 * 1024;

const criticalScripts = CORE_SHELL_ASSETS.filter((asset) => /\.(?:js|mjs)$/.test(asset) && asset !== "sw.js" && asset !== "version.json");
const criticalStyles = ["styles.css"];
const criticalMarkup = ["index.html"];
const criticalOther = ["manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "social-card.svg", "social-card.png"];

async function boundedAssetBytes(root, asset) {
  const path = resolve(root, asset);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`Critical asset is not a regular file: ${asset}`);
  return metadata.size;
}

export async function checkPerformanceBudget(directory) {
  const root = resolve(directory);
  const groups = [
    ["HTML", criticalMarkup, MAX_CRITICAL_HTML_BYTES],
    ["CSS", criticalStyles, MAX_CRITICAL_STYLE_BYTES],
    ["JavaScript", criticalScripts, MAX_CRITICAL_SCRIPT_BYTES],
    ["other shell", criticalOther, Number.POSITIVE_INFINITY]
  ];
  const sizes = new Map();
  for (const [, assets] of groups) {
    for (const asset of assets) sizes.set(asset, await boundedAssetBytes(root, asset));
  }
  const errors = [];
  for (const [label, assets, limit] of groups) {
    const total = assets.reduce((sum, asset) => sum + (sizes.get(asset) || 0), 0);
    if (total > limit) errors.push(`${label} critical bundle is ${total} bytes, above its ${limit} byte budget`);
  }
  const shellBytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  if (shellBytes > MAX_CRITICAL_SHELL_BYTES) {
    errors.push(`critical browser shell is ${shellBytes} bytes, above its ${MAX_CRITICAL_SHELL_BYTES} byte budget`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    files: sizes.size,
    htmlBytes: criticalMarkup.reduce((sum, asset) => sum + sizes.get(asset), 0),
    styleBytes: criticalStyles.reduce((sum, asset) => sum + sizes.get(asset), 0),
    scriptBytes: criticalScripts.reduce((sum, asset) => sum + sizes.get(asset), 0),
    shellBytes
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await checkPerformanceBudget(process.argv[2] || "dist");
  console.log(`performance budget ok: ${result.shellBytes} critical bytes across ${result.files} assets`);
}
