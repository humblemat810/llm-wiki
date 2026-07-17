import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LEARNING_NOTE_ASSETS } from "./public-assets.mjs";

export const PUBLIC_HTML_SOURCES = [
  "index.html",
  "artifacts.html",
  "share.html",
  "404.html"
];

export const GENERATED_HTML_TARGETS = new Set([
  "sample-graph.html",
  "feed.xml",
  "sitemap.xml",
  "robots.txt",
  ...LEARNING_NOTE_ASSETS
    .filter((asset) => asset !== "notes/README.md")
    .map((asset) => asset.replace(/\.md$/, ".html"))
]);

function isContained(root, candidate) {
  const path = relative(root, candidate);
  return path && !path.startsWith("..") && !path.includes("/../") && !path.includes("\\");
}

function localTargetFromUrl(value) {
  const target = String(value || "").trim();
  if (!target || target.startsWith("#")) return null;
  if (/^(?:[a-z][a-z\d+\-.]*:|\/\/)/i.test(target)) return null;
  const path = target.split("#", 1)[0].split("?", 1)[0];
  return path || null;
}

export function extractLocalHtmlReferences(html) {
  const references = [];
  const attributePattern = /\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of html.matchAll(attributePattern)) {
    const target = localTargetFromUrl(match[2]);
    if (target) references.push(target);
  }
  return references;
}

export async function discoverHtmlSources(root) {
  const sources = [];
  const visit = async (directory, prefix = "") => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        sources.push(relativePath);
      }
    }
  };
  await visit(resolve(root));
  return sources.sort();
}

export async function checkPublicLinks({
  root = fileURLToPath(new URL("../", import.meta.url)),
  sources = null,
  publishedTargets = null
} = {}) {
  const resolvedRoot = resolve(root);
  const publishedTargetSet = publishedTargets
    ? new Set([...publishedTargets].map((target) => String(target).replace(/^\.\/+/, "")))
    : null;
  const sourceList = sources || PUBLIC_HTML_SOURCES;
  const failures = [];
  for (const source of sourceList) {
    const sourcePath = resolve(resolvedRoot, source);
    if (!isContained(resolvedRoot, sourcePath)) {
      failures.push(`${source}: source escapes repository`);
      continue;
    }
    let html;
    try {
      html = await readFile(sourcePath, "utf8");
    } catch {
      failures.push(`${source}: source is missing`);
      continue;
    }
    const sourceDirectory = source.includes("/")
      ? source.slice(0, source.lastIndexOf("/") + 1)
      : "";
    for (const reference of extractLocalHtmlReferences(html)) {
      const referencePath = reference.startsWith("/") ? reference.slice(1) : reference;
      const normalizedPath = posix.normalize(posix.join(sourceDirectory, referencePath));
      if (normalizedPath === ".." || normalizedPath.startsWith("../")) {
        failures.push(`${source} -> ${reference}: target escapes the published root`);
        continue;
      }
      const target = normalizedPath === "." || normalizedPath === "./"
        ? "index.html"
        : normalizedPath.replace(/^\.\/+/, "");
      if (GENERATED_HTML_TARGETS.has(target)) {
        if (!publishedTargetSet || publishedTargetSet.has(target)) continue;
        failures.push(`${source} -> ${reference}: generated target is not in the published asset allowlist`);
        continue;
      }
      if (publishedTargetSet && !publishedTargetSet.has(target)) {
        failures.push(`${source} -> ${reference}: target is not in the published asset allowlist`);
        continue;
      }
      const targetPath = resolve(resolvedRoot, target);
      if (!isContained(resolvedRoot, targetPath)) {
        failures.push(`${source} -> ${reference}: target escapes the repository`);
        continue;
      }
      try {
        const linkMetadata = await lstat(targetPath);
        if (linkMetadata.isSymbolicLink()) {
          failures.push(`${source} -> ${reference}: target must not be a symbolic link`);
          continue;
        }
        const targetRealPath = await realpath(targetPath);
        if (!isContained(resolvedRoot, targetRealPath)) {
          failures.push(`${source} -> ${reference}: target escapes the published root`);
          continue;
        }
        const metadata = await stat(targetRealPath);
        if (!metadata.isFile() || metadata.size === 0) {
          failures.push(`${source} -> ${reference}: target is missing or empty`);
        }
      } catch {
        failures.push(`${source} -> ${reference}: target is missing`);
      }
    }
  }
  if (failures.length) {
    throw new Error(`public HTML link check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  return { sources: sourceList.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../", import.meta.url));
  const sources = process.argv[2] ? await discoverHtmlSources(target) : PUBLIC_HTML_SOURCES;
  const result = await checkPublicLinks({ root: target, sources });
  console.log(`public HTML link check ok: ${result.sources} pages`);
}
