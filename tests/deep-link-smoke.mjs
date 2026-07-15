import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const helperStart = source.indexOf("const GRAPH_ITEM_HASH_PATTERN");
const helperEnd = source.indexOf("\nlet lastRenderedGraphState", helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, "graph item deep-link helpers should remain discoverable");

const helpers = vm.runInNewContext(`(() => {
  const location = new URL("https://notes.example.test/wiki/?private=discarded#workbench");
  ${source.slice(helperStart, helperEnd)}
  return { parseGraphItemHash, buildGraphItemHash, buildGraphItemUrl, buildGraphItemShareData, shareGraphItem };
})()`, { URL, navigator: {}, copyText: async () => {} });

const hash = helpers.buildGraphItemHash("node", "concept:attention");
assert.equal(hash, "#item=node%3Aconcept%3Aattention", "graph item hashes should encode kind and IDs without exposing graph content");
const parsed = helpers.parseGraphItemHash(hash);
assert.equal(parsed?.kind, "node", "graph item hashes should preserve item kind");
assert.equal(parsed?.id, "concept:attention", "graph item hashes should round-trip IDs containing separators");
assert.equal(helpers.parseGraphItemHash("#item=invalid"), null, "malformed graph item hashes should fail closed");
assert.equal(helpers.parseGraphItemHash("#note=attention"), null, "learning-note hashes should remain separate from graph item hashes");
assert.equal(
  helpers.buildGraphItemUrl("edge", "attention--context--uses"),
  "https://notes.example.test/wiki/#item=edge%3Aattention--context--uses",
  "copied graph item links should strip query parameters and retain only the local item identity"
);
const shareData = helpers.buildGraphItemShareData("source", "doc-private-title");
assert.equal(shareData.title, "LLM Field Notes local graph item");
assert.equal(shareData.text, "Inspect this local graph item in LLM Field Notes.");
assert.equal(shareData.url, "https://notes.example.test/wiki/#item=source%3Adoc-private-title");
assert.equal(Object.keys(shareData).length, 3, "shared graph item links should carry privacy-safe generic metadata instead of source text or titles");

let nativeShareData = null;
let copiedUrl = null;
const nativeHelpers = vm.runInNewContext(`(() => {
  const location = new URL("https://notes.example.test/wiki/");
  ${source.slice(helperStart, helperEnd)}
  return { shareGraphItem };
})()`, {
  URL,
  navigator: { share: async (value) => { nativeShareData = value; } },
  copyText: async (value) => { copiedUrl = value; }
});
const nativeResult = await nativeHelpers.shareGraphItem("node", "attention");
assert.equal(nativeResult.mode, "shared", "graph item sharing should use the native share sheet when available");
assert.equal(nativeShareData?.url, "https://notes.example.test/wiki/#item=node%3Aattention");
assert.equal(copiedUrl, null, "native graph item sharing should not invoke the clipboard fallback");

let canceledShare = false;
const canceledHelpers = vm.runInNewContext(`(() => {
  const location = new URL("https://notes.example.test/wiki/");
  ${source.slice(helperStart, helperEnd)}
  return { shareGraphItem };
})()`, {
  URL,
  navigator: { share: async () => { throw Object.assign(new Error("cancel"), { name: "AbortError" }); } },
  copyText: async () => { canceledShare = true; }
});
assert.equal((await canceledHelpers.shareGraphItem("edge", "attention--context--uses")).mode, "canceled", "canceling the native share sheet should be a normal result");
assert.equal(canceledShare, false, "canceling native sharing should not fall through to the clipboard");

let fallbackUrl = null;
const fallbackHelpers = vm.runInNewContext(`(() => {
  const location = new URL("https://notes.example.test/wiki/");
  ${source.slice(helperStart, helperEnd)}
  return { shareGraphItem };
})()`, {
  URL,
  navigator: {},
  copyText: async (value) => { fallbackUrl = value; }
});
assert.equal((await fallbackHelpers.shareGraphItem("source", "doc-source")).mode, "copied", "graph item sharing should use the clipboard when native sharing is unavailable");
assert.equal(fallbackUrl, "https://notes.example.test/wiki/#item=source%3Adoc-source");

console.log("deep-link smoke ok");
