import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSampleGraphPage } from "../scripts/sample-graph-page.mjs";
import { parseJsonWithUniqueKeys } from "../graph-core.js";

const graph = parseJsonWithUniqueKeys(
  await readFile(new URL("../examples/sample-graph.json", import.meta.url), "utf8"),
  "sample graph"
);
const page = buildSampleGraphPage(graph, "https://wiki.example.test/field-notes");

assert.match(page, /^<!doctype html>/i, "sample graph page should be a complete document");
assert(page.includes("A document,"), "sample graph page should explain the document-to-graph transition");
assert(page.includes("THE GRAPH AT A GLANCE") && page.includes("sample-graph-visual"), "sample graph page should include a visual graph projection");
assert(page.includes("sample-graph-visual-description") && page.includes("Attention uses Weighted lookup"), "sample graph visual should expose an accessible relation summary");
assert(page.includes("Graph.canvas") && page.includes("Obsidian vault"), "sample graph page should explain the native Obsidian projection path");
assert(page.includes("<tspan") && page.includes("sample-graph-node-confidence"), "sample graph nodes should wrap long labels inside their visual cards");
assert(page.includes("CONCEPTS WITH EVIDENCE") && page.includes("RELATIONS WITH GROUNDS"), "sample graph page should expose both graph collections");
assert(page.includes("fnv64-4d8c362569fbcce7-2627"), "sample graph page should expose the authoritative graph fingerprint");
assert(page.includes("https://wiki.example.test/field-notes/#sample"), "sample graph page should preserve the configured workbench origin");
assert(page.includes("script-src 'none'") && !/<script\b[^>]*src=/i.test(page), "sample graph page should remain script-free and CSP-compatible");
assert(!page.includes("SECRET"), "sample graph fixture should not contain private source markers");

const hostileGraph = {
  ...graph,
  documents: [{ ...graph.documents[0], title: "<secret>", text: "<script>alert(1)</script>" }],
  nodes: [{ ...graph.nodes[0], label: "<img src=x>", evidence: [{ text: "<b>unsafe</b>", sources: [graph.documents[0].id] }] }],
  edges: []
};
const hostilePage = buildSampleGraphPage(hostileGraph);
assert(hostilePage.includes("&lt;secret&gt;") && hostilePage.includes("&lt;img src=x&gt;"), "sample graph page should escape source and concept content");
assert(!hostilePage.includes("<img src=x>") && !hostilePage.includes("<script>alert(1)</script>"), "sample graph page should not emit hostile source markup");
assert(!hostilePage.includes("<script>alert(1)</script>") && hostilePage.includes("role=\"img\""), "sample graph visual should remain safe and accessible for hostile content");

console.log("sample graph page smoke ok");
