import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_HTML_BYTES = 10 * 1024 * 1024;

const getAttribute = (attributes, name) => {
  const match = String(attributes).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1] ?? null;
};

const hasAttribute = (attributes, name) => new RegExp(`\\b${name}(?:\\s*=|\\s|$)`, "i").test(String(attributes));
const visibleText = (value) => String(value)
  .replace(/<script\b[\s\S]*?<\/script>/gi, "")
  .replace(/<style\b[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]*>/g, " ")
  .replace(/&(?:nbsp|#160);/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

async function collectHtmlFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const asset = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectHtmlFiles(path, asset));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push({ asset, path });
  }
  return files.sort((left, right) => left.asset.localeCompare(right.asset));
}

export function auditHtmlDocument(content, asset = "document.html") {
  const html = String(content);
  const errors = [];
  const fail = (message) => errors.push(`${asset}: ${message}`);
  const htmlTag = html.match(/<html\b([^>]*)>/i);
  if (!htmlTag || !getAttribute(htmlTag[1], "lang")?.trim()) fail("the document must declare a non-empty html lang attribute");
  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map((match) => visibleText(match[1]));
  if (titles.length !== 1 || !titles[0]) fail("the document must contain exactly one non-empty title");
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => visibleText(match[1]));
  if (h1s.length !== 1 || !h1s[0]) fail("the document must contain exactly one non-empty h1");
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((match) => Number(match[1]));
  for (let index = 1; index < headings.length; index += 1) {
    if (headings[index] > headings[index - 1] + 1) {
      fail(`heading level h${headings[index]} follows h${headings[index - 1]} without an intermediate level`);
    }
  }

  const ids = new Set();
  for (const match of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
    if (ids.has(match[1])) fail(`duplicate id "${match[1]}"`);
    ids.add(match[1]);
  }
  const labelFor = new Set([...html.matchAll(/<label\b([^>]*)>/gi)]
    .map((match) => getAttribute(match[1], "for"))
    .filter(Boolean));

  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    if (!hasAttribute(match[1], "alt")) fail("every img element must declare alt text, including an explicit empty alt");
  }
  for (const match of html.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
    const [, tag, attributes] = match;
    if (tag.toLowerCase() === "input" && getAttribute(attributes, "type")?.toLowerCase() === "hidden") continue;
    const id = getAttribute(attributes, "id");
    const labeled = Boolean(
      getAttribute(attributes, "aria-label")?.trim()
      || getAttribute(attributes, "aria-labelledby")?.trim()
      || (id && labelFor.has(id))
    );
    if (!labeled) fail(`${tag} controls must have a label, aria-label, or aria-labelledby`);
  }
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const [, attributes, body] = match;
    if (!getAttribute(attributes, "aria-label")?.trim()
      && !getAttribute(attributes, "aria-labelledby")?.trim()
      && !visibleText(body)) {
      fail("buttons must have accessible text, aria-label, or aria-labelledby");
    }
  }
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const [, attributes, body] = match;
    if (!getAttribute(attributes, "href")?.trim()) fail("links must have a non-empty href");
    if (!getAttribute(attributes, "aria-label")?.trim()
      && !getAttribute(attributes, "aria-labelledby")?.trim()
      && !visibleText(body)) {
      fail("links must have accessible text, aria-label, or aria-labelledby");
    }
  }
  for (const match of html.matchAll(/\brole\s*=\s*["']img["'][^>]*>/gi)) {
    if (!getAttribute(match[0], "aria-label")?.trim() && !getAttribute(match[0], "aria-labelledby")?.trim()) {
      fail("role=img elements must have aria-label or aria-labelledby");
    }
  }
  return errors;
}

export async function auditHtmlDirectory(directory) {
  const root = resolve(directory);
  const files = await collectHtmlFiles(root);
  if (!files.length) throw new Error(`No HTML files found under ${root}.`);
  const errors = [];
  for (const file of files) {
    const metadata = await stat(file.path);
    if (!metadata.isFile() || metadata.size > MAX_HTML_BYTES) {
      errors.push(`${file.asset}: HTML file is missing, not regular, or oversized`);
      continue;
    }
    errors.push(...auditHtmlDocument(await readFile(file.path, "utf8"), file.asset));
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return { files: files.length };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await auditHtmlDirectory(process.argv[2] || "dist");
  console.log(`accessibility check ok: ${result.files} HTML files`);
}
