import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonWithUniqueKeys } from "../graph-core.js";
import { FIXED_PUBLIC_ASSETS, PUBLIC_ASSETS } from "./public-assets.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const artifactPage = await readFile(new URL("../artifacts.html", import.meta.url), "utf8");
const structuredDataMatch = artifactPage.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert(structuredDataMatch, "artifacts.html must contain structured discovery metadata.");

const structuredData = parseJsonWithUniqueKeys(structuredDataMatch[1], "Artifact structured metadata");
const itemList = structuredData.mainEntity;
assert.equal(structuredData["@type"], "CollectionPage", "artifact structured data must describe a CollectionPage.");
assert.equal(itemList?.["@type"], "ItemList", "artifact structured data must describe an ItemList.");
assert(Array.isArray(itemList?.itemListElement), "artifact structured data must contain an item list.");

const cards = [...artifactPage.matchAll(/<a class="artifact-card"(?:\s+id="[^"]+")?\s+href="([^"]+)">[\s\S]*?<h2>([\s\S]*?)<\/h2>[\s\S]*?<code>([\s\S]*?)<\/code><\/a>/g)]
  .map(([, href, title, command]) => ({
    href,
    title: title.replace(/<[^>]+>/g, "").trim(),
    command: command.replace(/<[^>]+>/g, "").trim()
  }));
assert(cards.length > 0, "artifacts.html must publish at least one artifact card.");
assert.equal(cards.length, itemList.itemListElement.length, "artifact cards and structured item count must match.");
assert.equal(itemList.numberOfItems, cards.length, "structured artifact count must match visible cards.");

const cardPaths = new Set();
for (const [index, card] of cards.entries()) {
  assert(card.href && !card.href.startsWith("/") && !card.href.includes("://"), `artifact ${index + 1} must use a relative path.`);
  assert(card.title, `artifact ${index + 1} must have a title.`);
  assert(card.command, `artifact ${index + 1} must show a runnable command.`);
  assert(!cardPaths.has(card.href), `artifact cards must not duplicate ${card.href}.`);
  cardPaths.add(card.href);
  const resolved = resolve(root, card.href);
  const relativePath = relative(root, resolved);
  assert(relativePath && !relativePath.startsWith("..") && !relativePath.includes("/../"), `artifact ${card.href} escapes the repository.`);
  const metadata = await stat(resolved);
  assert(metadata.isFile() && metadata.size > 0, `artifact target is missing or empty: ${card.href}`);
  assert(PUBLIC_ASSETS.includes(relativePath) || FIXED_PUBLIC_ASSETS.includes(relativePath), `artifact target is not in the public asset contract: ${card.href}`);

  const structuredItem = itemList.itemListElement[index];
  assert.equal(structuredItem.position, index + 1, `artifact structured position ${index + 1} is out of order.`);
  assert.equal(structuredItem.name, card.title, `artifact structured title does not match card ${card.href}.`);
  assert.equal(structuredItem.url, card.href, `artifact structured URL does not match card ${card.href}.`);
}

console.log(`artifact check ok: ${cards.length} public cards`);
