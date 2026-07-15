import assert from "node:assert/strict";
import fs from "node:fs";
import {
  GRAPH_SCHEMA,
  fingerprintBackup,
  inspectGraph,
  matchesGraphFingerprint,
  normalizeGraph
} from "../graph-core.js";

const path = new URL("../examples/sample-graph.json", import.meta.url);
const raw = JSON.parse(fs.readFileSync(path, "utf8"));
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

console.log("sample graph smoke ok");
