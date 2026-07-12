import assert from "node:assert/strict";
import { defaultGraph } from "../graph-core.js";
import { applyObsidianFeedback, parseObsidianFeedback, parseObsidianVault, readStoredZip } from "../projection-adapter.js";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    localParts.push(local, data);
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const central = new Uint8Array(centralParts.reduce((total, part) => total + part.length, 0));
  let centralCursor = 0;
  centralParts.forEach((part) => {
    central.set(part, centralCursor);
    centralCursor += part.length;
  });
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, offset, true);
  const all = [...localParts, central, end];
  const output = new Uint8Array(all.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  all.forEach((part) => {
    output.set(part, cursor);
    cursor += part.length;
  });
  return output;
}

const conceptMarkdown = `---
type: concept
id: attention
label: "Attention mechanism"
status: accepted
aliases: ["attention", "lookup"]
---

# Attention mechanism
`;
const relationMarkdown = `---
type: relation
id: attention--context--uses
label: "uses"
status: rejected
source: attention
target: context
---

# Attention uses Context
`;
const concept = parseObsidianFeedback(conceptMarkdown);
const relation = parseObsidianFeedback(relationMarkdown);
assert.equal(concept.type, "concept");
assert.deepEqual(concept.aliases, ["attention", "lookup"]);
assert.equal(relation.type, "relation");
assert.equal(relation.status, "rejected");
assert.equal(parseObsidianFeedback(conceptMarkdown.replace("# Attention mechanism", "# Attention / lookup")).label, "Attention / lookup");
assert.equal(parseObsidianFeedback("# ordinary note"), null);
const vault = parseObsidianVault(storedZip([
  { name: "Concepts/attention.md", text: conceptMarkdown },
  { name: "Relations/attention--context--uses.md", text: relationMarkdown },
  { name: "_index.md", text: "# Knowledge Graph" }
]));
assert.equal(vault.files.length, 3);
assert.equal(vault.feedbacks.length, 2);
assert.throws(() => readStoredZip(new Uint8Array([1, 2, 3])), /no readable directory/);

const graph = {
  ...defaultGraph(),
  version: 1,
  documents: [{ id: "doc-1", title: "Source", text: "text", fingerprint: "source-1", addedAt: new Date().toISOString() }],
  nodes: [{
    id: "attention",
    label: "Attention",
    aliases: [],
    type: "concept",
    confidence: .6,
    mentions: 1,
    feedback: 0,
    status: "inferred",
    sources: ["doc-1"],
    evidence: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, {
    id: "context",
    label: "Context",
    aliases: [],
    type: "concept",
    confidence: .6,
    mentions: 1,
    feedback: 0,
    status: "inferred",
    sources: ["doc-1"],
    evidence: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }],
  edges: [{
    id: "attention--context--uses",
    source: "attention",
    target: "context",
    label: "uses",
    confidence: .6,
    feedback: 0,
    evidence: [],
    sources: ["doc-1"],
    status: "inferred"
  }]
};
const result = applyObsidianFeedback(graph, [concept, relation]);
assert.equal(result.changed, true);
assert.equal(result.updates, 4);
assert.equal(result.graph.nodes[0].label, "Attention mechanism");
assert.equal(result.graph.nodes[0].status, "accepted");
assert(result.graph.nodes[0].aliases.includes("Attention"));
assert.equal(result.graph.edges[0].status, "rejected");
assert.equal(result.graph.edges[0].feedback, -1);
assert.equal(applyObsidianFeedback(result.graph, [concept, relation]).changed, false);
console.log("projection adapter smoke ok");
