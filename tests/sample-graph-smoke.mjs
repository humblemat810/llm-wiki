import assert from "node:assert/strict";
import fs from "node:fs";
import {
  GRAPH_SCHEMA,
  fingerprintBackup,
  inspectGraph,
  matchesGraphFingerprint,
  normalizeGraph
} from "../graph-core.js";
import { buildSampleGraphCanvas } from "../scripts/sample-graph-canvas.mjs";
import { verifyCanvasProjection } from "../scripts/verify-canvas.mjs";

const path = new URL("../examples/sample-graph.json", import.meta.url);
const raw = JSON.parse(fs.readFileSync(path, "utf8"));
const canvasText = fs.readFileSync(new URL("../examples/sample-graph.canvas", import.meta.url), "utf8");
assert.equal(raw.schema, GRAPH_SCHEMA, "the published sample graph should declare the current graph schema");
assert.match(raw.graphFingerprint, /^fnv64-[0-9a-f]{16}-[0-9]+$/, "the published sample graph should carry a bounded fingerprint");
assert(matchesGraphFingerprint(raw, raw.graphFingerprint), "the published sample graph fingerprint should match its contents");

const graph = normalizeGraph(raw);
const health = inspectGraph(graph);
assert.equal(graph.documents.length, 1, "the published sample graph should contain one source document");
assert.equal(graph.nodes.length, 3, "the published sample graph should contain three concepts");
assert.equal(graph.edges.length, 2, "the published sample graph should contain two relations");
assert.equal(health.provenanceCoverage, 100, "the published sample graph should retain complete provenance");
assert.equal(health.evidenceGroundingCoverage, 100, "the published sample graph should retain complete evidence grounding");
assert.equal(health.truncated, false, "the published sample graph should not be truncated");
assert.equal(health.dropped, false, "the published sample graph should not drop malformed records");
assert.equal(fingerprintBackup(graph), raw.graphFingerprint, "normalization should preserve the published sample graph fingerprint");
assert.equal(canvasText, buildSampleGraphCanvas(raw), "the published Graph.canvas should be generated from the sample graph");
const canvas = JSON.parse(canvasText);
verifyCanvasProjection(canvas, "published sample Graph.canvas");
assert.equal(canvas.nodes.length, 4, "the published Graph.canvas should contain one provenance card and one text card per public concept");
assert.equal(canvas.edges.length, 2, "the published Graph.canvas should contain one edge per public relation");
assert(canvas.nodes.find((node) => node.id === "projection-provenance")?.text.includes(raw.graphFingerprint), "the published Graph.canvas should carry the sample graph fingerprint");
assert(canvas.edges.every((edge) => canvas.nodes.some((node) => node.id === edge.fromNode) && canvas.nodes.some((node) => node.id === edge.toNode)), "the published Graph.canvas edges should resolve to native node IDs");
assert.throws(
  () => verifyCanvasProjection({ nodes: [{ ...canvas.nodes[1], id: "duplicate" }, { ...canvas.nodes[2], id: "duplicate" }], edges: [] }, "duplicate Canvas"),
  /duplicates duplicate/,
  "Canvas verification should reject duplicate node identities"
);
assert.throws(
  () => verifyCanvasProjection({ nodes: [canvas.nodes[1]], edges: [{ ...canvas.edges[0], fromNode: "missing" }] }, "dangling Canvas"),
  /endpoint does not resolve/,
  "Canvas verification should reject dangling edge endpoints"
);

console.log("sample graph smoke ok");
