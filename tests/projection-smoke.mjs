import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { defaultGraph, fingerprintBackup, GRAPH_SCHEMA, MAX_DOCUMENT_TITLE_CHARS, MAX_GRAPH_VERSION, normalizeGraph, VAULT_FORMAT } from "../graph-core.js";
import { buildJsonLd } from "../jsonld-projection.js";
import { MAX_FEEDBACK_NOTE_CHARS, MAX_VAULT_MANIFEST_CHARS, MAX_ZIP_FILES, applyObsidianFeedback, looksLikeObsidianFeedback, parseObsidianFeedback, parseObsidianVault, readStoredZip } from "../projection-adapter.js";
import { MAX_GRAPH_DOCUMENTS, MAX_GRAPH_EDGES, MAX_GRAPH_NODES } from "../graph-core.js";

const appSource = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const projectionPathsStart = appSource.indexOf("function safeFileName(");
const projectionPathsEnd = appSource.indexOf("\nfunction buildVaultFiles", projectionPathsStart);
assert(projectionPathsStart >= 0 && projectionPathsEnd > projectionPathsStart, "projection path helpers should remain discoverable");
const buildProjectionPaths = vm.runInNewContext(`(() => {
  const slugify = ${String((value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-"))};
  ${appSource.slice(projectionPathsStart, projectionPathsEnd)}
  return buildProjectionPaths;
})()`);
const clonedEdgePath = buildProjectionPaths({
  nodes: [{ id: "attention" }],
  documents: [],
  edges: [{ id: "attention--context--uses", source: "attention", target: "context" }]
}).relations.get("attention--context--uses");
assert.equal(clonedEdgePath, "Relations/attention-context-uses.md", "relation projection paths should remain addressable by stable relation ID");

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
last_reviewed: 2025-02-02T00:00:00.000Z
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
const source = parseObsidianFeedback(`---
type: source
id: doc-source
uri: "https://example.org/reviewed-source"
quality: primary
last_reviewed: 2025-02-01T00:00:00.000Z
---

# Reviewed source`);
assert.equal(concept.type, "concept");
assert.deepEqual(concept.aliases, ["attention", "lookup"]);
assert.equal(concept.lastReviewedAt, "2025-02-02T00:00:00.000Z");
assert.equal(relation.type, "relation");
assert.equal(relation.status, "rejected");
assert.equal(relation.source, "attention");
assert.equal(relation.target, "context");
assert.equal(source.type, "source");
assert.equal(source.uri, "https://example.org/reviewed-source");
assert.equal(source.hasUri, true);
assert.equal(parseObsidianFeedback(`---\ntype: source\nid: doc-source\nfingerprint: source-fingerprint\n---\n\n# Source`).fingerprint, "source-fingerprint");
const partialSource = parseObsidianFeedback(`---
type: source
id: doc-source
quality: primary
---

# Reviewed source`);
assert.equal(partialSource.hasUri, false, "source feedback should preserve whether URI metadata was explicitly supplied");
const existingUriGraph = normalizeGraph({
  ...defaultGraph(),
  documents: [{ id: "doc-source", title: "Reviewed source", text: "text", uri: "https://example.org/existing" }]
});
assert.equal(applyObsidianFeedback(existingUriGraph, [partialSource]).graph.documents[0].uri, "https://example.org/existing", "omitted source URI metadata should not erase an existing URI");
const clearedUri = parseObsidianFeedback(`---
type: source
id: doc-source
uri: ""
---

# Reviewed source`);
assert.equal(applyObsidianFeedback(existingUriGraph, [clearedUri]).graph.documents[0].uri, null, "an explicitly empty source URI should clear the URI");
const sourceUriGraph = normalizeGraph({ ...defaultGraph(), documents: [{ id: "doc-source", title: "Reviewed source", text: "text" }] });
assert.equal(applyObsidianFeedback(sourceUriGraph, [source]).graph.documents[0].uri, "https://example.org/reviewed-source", "Obsidian source feedback should preserve source URIs");
const staleSourceMetadata = applyObsidianFeedback(normalizeGraph({
  ...defaultGraph(),
  documents: [{
    id: "doc-source",
    title: "Old source title",
    text: "source text",
    quality: "unknown",
    lastReviewedAt: "2020-01-01T00:00:00.000Z"
  }]
}), [{
  type: "source",
  id: "doc-source",
  title: "Reviewed source",
  quality: "primary",
  lastReviewedAt: "2020-01-01T00:00:00.000Z"
}]);
assert(Date.parse(staleSourceMetadata.graph.documents[0].lastReviewedAt) > Date.now() - 5000, "substantive Obsidian source metadata edits should refresh review time instead of preserving stale exported metadata");
const directUnsafeUri = applyObsidianFeedback(existingUriGraph, [{ type: "source", id: "doc-source", uri: "javascript:alert(1)", hasUri: true }]);
assert.equal(directUnsafeUri.changed, false, "direct source feedback should reject unsafe URIs instead of clearing provenance");
assert.equal(directUnsafeUri.graph.documents[0].uri, "https://example.org/existing", "rejected direct URI feedback should preserve existing provenance");
const mismatchedSource = applyObsidianFeedback(sourceUriGraph, [{
  ...source,
  fingerprint: "different-source-fingerprint"
}]);
assert.equal(mismatchedSource.changed, false, "source feedback with a mismatched fingerprint should not mutate a colliding document ID");
assert.equal(mismatchedSource.skipped, 1, "mismatched source fingerprints should be reported as skipped");
assert.equal(source.quality, "primary");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: ${"x".repeat(201)}\nstatus: accepted\n---\n\n# Too long`), null, "oversized Obsidian feedback IDs should be rejected at the projection boundary");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: attention\naliases: ["${"a".repeat(500)}"]\nstatus: accepted\n---\n\n# Attention`), null, "oversized Obsidian aliases should fail closed at the projection boundary");
assert.equal(parseObsidianFeedback(`---\ntype: relation\nid: attention--context--uses\nlabel: "${"r".repeat(120)}"\nstatus: accepted\n---\n\n# Relation`), null, "oversized Obsidian relation labels should fail closed at the projection boundary");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: attention\nstatus: accepted\n---\n\n# ${"c".repeat(121)}`), null, "oversized Obsidian concept headings should fail closed at the projection boundary");
assert.equal(parseObsidianFeedback(`---\ntype: source\nid: doc-source\n---\n\n# ${"s".repeat(MAX_DOCUMENT_TITLE_CHARS + 1)}`), null, "oversized Obsidian source headings should fail closed at the document-title boundary");
assert.equal(parseObsidianFeedback(`---\ntype: source\nid: doc-source\nuri: "${"https://example.org/".padEnd(2049, "x")}"\n---\n\n# Source`), null, "oversized Obsidian source URIs should fail closed at the projection boundary");
assert.equal(parseObsidianFeedback(`---\ntype: source\nid: doc-source\nlast_reviewed: ${"2".repeat(129)}\n---\n\n# Source`), null, "oversized Obsidian timestamps should be rejected before parsing");
assert.equal(parseObsidianFeedback("---\ntype: source\nid: doc-source\nlast_reviewed: 2026-02-31\n---\n\n# Source"), null, "impossible Obsidian calendar dates should be rejected before parser rollover");
assert.equal(parseObsidianFeedback(conceptMarkdown.replace("# Attention mechanism", "# Attention / lookup")).label, "Attention / lookup");
assert.equal(parseObsidianFeedback(`${conceptMarkdown}\n`).projectionMetadataError, null);
assert.equal(parseObsidianFeedback(conceptMarkdown.replace("id: attention", "id: attention\ngraph_version: 3\ngraph_fingerprint: fnv64-0123456789abcdef-42")).graphVersion, 3, "individual Obsidian notes should retain projection identity");
assert.equal(parseObsidianFeedback(conceptMarkdown.replace("id: attention", "id: attention\ngraph_version: invalid")).projectionMetadataError, "Projection metadata is invalid.", "invalid individual projection identity should be surfaced");
assert.equal(parseObsidianFeedback(conceptMarkdown.replace("id: attention", "id: attention\ngraph_version: -1\ngraph_fingerprint: fnv64-0123456789abcdef-42")).projectionMetadataError, "Projection metadata is invalid.", "negative projection versions should be rejected");
assert.equal(parseObsidianFeedback("# ordinary note"), null);
assert.equal(looksLikeObsidianFeedback(conceptMarkdown), true, "Obsidian frontmatter should be recognizable before parsing");
assert.equal(looksLikeObsidianFeedback("---\ntype: concept\n---\n\n# malformed"), true, "malformed Obsidian-shaped notes should still be identified for fail-closed handling");
assert.equal(looksLikeObsidianFeedback("# ordinary note"), false, "ordinary Markdown should not be treated as an Obsidian feedback note");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: __proto__\nstatus: accepted\n---\n\n# Safe fields`).id, "__proto__", "feedback fields should not inherit object prototype behavior");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: attention\nstatus: accepted\nstatus: rejected\n---\n\n# Duplicate status`), null, "duplicate frontmatter keys should be rejected instead of silently taking the last value");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: attention\nstatus: unknown\n---\n\n# Invalid status`), null, "invalid statuses should be rejected at the projection boundary");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: attention\nlabel: "unterminated\n---\n\n# Malformed label`), null, "malformed JSON-shaped frontmatter values should fail closed instead of becoming plain strings");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: attention\nlabel: 'unterminated\n---\n\n# Malformed single-quoted label`), null, "malformed single-quoted frontmatter values should fail closed instead of becoming plain strings");
assert.equal(parseObsidianFeedback(`---\ntype: source\nid: doc-source\nquality: invalid\n---\n\n# Invalid quality`), null, "invalid source qualities should be rejected at the projection boundary");
assert.equal(parseObsidianFeedback(`---\ntype: source\nid: doc-source\nlast_reviewed: not-a-date\n---\n\n# Invalid review date`), null, "invalid review dates should be rejected at the projection boundary");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: attention\nstatus: accepted\nunsupported_field: ignored\n---\n\n# Unknown field`), null, "unknown Obsidian frontmatter fields should fail closed instead of being silently ignored");
assert.equal(parseObsidianFeedback(`---\ntype: relation\nid: attention--context--uses\naliases: ["wrong type"]\n---\n\n# Wrong type field`), null, "type-incompatible Obsidian frontmatter should fail closed");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: attention\naliases: ["lookup", "lookup"]\n---\n\n# Duplicate aliases`), null, "duplicate Obsidian aliases should fail closed instead of being silently canonicalized");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: attention\naliases: ["lookup", " lookup "]\n---\n\n# Whitespace duplicate aliases`), null, "whitespace-equivalent Obsidian aliases should fail closed");
assert.equal(parseObsidianFeedback(`---\ntype: concept\nid: attention\nconfidence: not-a-number\n---\n\n# Invalid confidence`), null, "invalid read-only Obsidian confidence metadata should fail closed");
assert.equal(parseObsidianFeedback(`---\ntype: source\nid: doc-source\nredacted: yes\n---\n\n# Invalid redaction marker`), null, "invalid source redaction metadata should fail closed");
assert.equal(parseObsidianFeedback(conceptMarkdown.replace("last_reviewed: 2025-02-02T00:00:00.000Z", "last_reviewed: not-a-date")), null, "invalid concept review dates should be rejected at the projection boundary");
assert.equal(parseObsidianFeedback(relationMarkdown.replace("---\n\n# Attention uses Context", "last_reviewed: not-a-date\n---\n\n# Attention uses Context")), null, "invalid relation review dates should be rejected at the projection boundary");
assert.equal(parseObsidianFeedback(`---\ntype: source\nid: doc-source\nuri: javascript:alert(1)\n---\n\n# Unsafe URI`), null, "unsafe source URIs should be rejected at the projection boundary");
assert.equal(parseObsidianFeedback("x".repeat(MAX_FEEDBACK_NOTE_CHARS + 1)), null, "oversized feedback notes should be rejected before parsing");
const boundedDirectFeedbackAliases = new Array(21).fill("alias");
Object.defineProperty(boundedDirectFeedbackAliases, 20, { get() { throw new Error("direct feedback alias beyond the bound was read"); } });
const boundedDirectFeedbackGraph = normalizeGraph({
  ...defaultGraph(),
  nodes: [{ id: "attention", label: "Attention", status: "inferred" }]
});
const boundedDirectFeedback = applyObsidianFeedback(boundedDirectFeedbackGraph, [{
  type: "concept",
  id: "attention",
  label: "x".repeat(1000000),
  aliases: boundedDirectFeedbackAliases,
  status: "accepted"
}]);
assert.equal(boundedDirectFeedback.changed, false, "direct Obsidian feedback with too many aliases should fail closed");
assert.equal(boundedDirectFeedback.graph.nodes[0].label, "Attention", "rejected direct feedback should not mutate the graph");
const oversizedDirectFeedback = applyObsidianFeedback(defaultGraph(), Array.from({ length: MAX_ZIP_FILES + 1 }, (_, index) => ({
  type: "concept",
  id: `missing-${index}`,
  status: "accepted"
})));
assert.equal(oversizedDirectFeedback.changed, false, "oversized direct Obsidian feedback should not be partially applied");
assert.equal(oversizedDirectFeedback.limited, "feedback-items", "oversized direct Obsidian feedback should disclose its bound");
const invalidDirectReviewDate = applyObsidianFeedback(normalizeGraph({
  ...defaultGraph(),
  nodes: [{ id: "attention", label: "Attention", status: "inferred" }]
}), [{
  type: "concept",
  id: "attention",
  lastReviewedAt: "not-a-date",
  status: "accepted"
}]);
assert.equal(invalidDirectReviewDate.changed, false, "direct Obsidian feedback should reject invalid review timestamps");
const futureReviewProjection = applyObsidianFeedback(normalizeGraph({
  ...defaultGraph(),
  nodes: [{ id: "attention", label: "Attention", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" }]
}), [{
  type: "concept",
  id: "attention",
  status: "accepted",
  lastReviewedAt: "2099-01-01T00:00:00.000Z"
}]);
assert.equal(futureReviewProjection.graph.nodes[0].lastReviewedAt, "2026-01-01T00:00:00.000Z", "future Obsidian timestamps must not overwrite trusted current review metadata");
const futureInitialReviewProjection = applyObsidianFeedback(normalizeGraph({
  ...defaultGraph(),
  nodes: [{ id: "attention", label: "Attention", status: "inferred" }]
}), [{
  type: "concept",
  id: "attention",
  lastReviewedAt: "2099-01-01T00:00:00.000Z"
}]);
assert.equal(futureInitialReviewProjection.graph.nodes[0].lastReviewedAt, null, "future Obsidian timestamps must not create review history for an unreviewed concept");
const clearedReviewProjection = applyObsidianFeedback(normalizeGraph({
  ...defaultGraph(),
  nodes: [{ id: "attention", label: "Attention", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" }]
}), [{
  type: "concept",
  id: "attention",
  status: "accepted",
  hasLastReviewedAt: true,
  lastReviewedAt: null
}]);
assert.equal(clearedReviewProjection.graph.nodes[0].lastReviewedAt, "2026-01-01T00:00:00.000Z", "empty Obsidian review timestamps must not erase a newer trusted review");
const futureInitialSourceProjection = applyObsidianFeedback(normalizeGraph({
  ...defaultGraph(),
  documents: [{ id: "doc-source", title: "Source", text: "text", quality: "unknown" }]
}), [{
  type: "source",
  id: "doc-source",
  lastReviewedAt: "2099-01-01T00:00:00.000Z",
  hasLastReviewedAt: true
}]);
assert.equal(futureInitialSourceProjection.graph.documents[0].lastReviewedAt, null, "future Obsidian timestamps must not create review history for an unreviewed source");
const correctedFutureSourceProjection = applyObsidianFeedback(normalizeGraph({
  ...defaultGraph(),
  documents: [{ id: "doc-source", title: "Source", text: "text", quality: "unknown" }]
}), [{
  type: "source",
  id: "doc-source",
  quality: "primary",
  lastReviewedAt: "2099-01-01T00:00:00.000Z",
  hasLastReviewedAt: true
}]);
assert.equal(correctedFutureSourceProjection.graph.documents[0].quality, "primary");
assert(Date.parse(correctedFutureSourceProjection.graph.documents[0].lastReviewedAt) > Date.now() - 5000, "substantive source edits should receive a fresh review timestamp when an imported timestamp is untrusted");
const invalidDirectFeedback = applyObsidianFeedback(normalizeGraph({
  ...defaultGraph(),
  nodes: [{ id: "attention", label: "Attention", status: "inferred" }]
}), [
  { type: "concept", id: "attention", status: "accepted" },
  { type: "concept", id: "attention", aliases: "not-an-array" }
]);
assert.equal(invalidDirectFeedback.changed, true, "valid direct feedback should still apply when another item is malformed");
assert.equal(invalidDirectFeedback.skipped, 1, "direct Obsidian feedback should disclose malformed items instead of silently dropping them");
assert.equal(invalidDirectFeedback.graph.nodes[0].status, "accepted", "malformed direct feedback should not prevent safe feedback from applying");
const astralFeedback = applyObsidianFeedback(normalizeGraph({
  ...defaultGraph(),
  nodes: [{ id: "astral", label: "Original", status: "inferred" }]
}), [{
  type: "concept",
  id: "astral",
  label: `a${"😀".repeat(59)}`
}]);
assert.equal(astralFeedback.graph.nodes[0].label, `a${"😀".repeat(59)}`, "Obsidian feedback labels should preserve astral characters at graph bounds");
const staleCorrectionGraph = normalizeGraph({
  ...defaultGraph(),
  nodes: [{ id: "attention", label: "Old attention label", status: "accepted", lastReviewedAt: "2020-01-01T00:00:00.000Z" }]
});
const staleCorrection = applyObsidianFeedback(staleCorrectionGraph, [{
  type: "concept",
  id: "attention",
  label: "Corrected attention label",
  status: "accepted",
  lastReviewedAt: "2020-01-01T00:00:00.000Z"
}]);
const correctedNode = staleCorrection.graph.nodes[0];
assert.equal(correctedNode.label, "Corrected attention label", "Obsidian label corrections should update the graph");
assert(Date.parse(correctedNode.lastReviewedAt) > Date.now() - 5000, "a substantive Obsidian correction should refresh review time instead of preserving an old exported timestamp");
assert(Date.parse(staleCorrection.graph.learning.examples[0].lastReviewedAt) > Date.now() - 5000, "refreshed Obsidian corrections should keep reusable learning memory fresh");
const vault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: 1, graphFingerprint: "fnv64-0123456789abcdef-42", appVersion: "0.1.0", redacted: false, generatedAt: "2025-01-01T00:00:00.000Z", learning: { requested: 1, included: 1, unavailable: [], complete: true } }) },
  { name: "Concepts/attention.md", text: conceptMarkdown },
  { name: "Relations/attention--context--uses.md", text: relationMarkdown },
  { name: "Sources/doc-source.md", text: `---\ntype: source\nid: doc-source\nquality: primary\n---\n\n# Reviewed source` },
  { name: "Learning/tokens.md", text: "# Tokens" },
  { name: "_index.md", text: "# Knowledge Graph" }
]));
assert.equal(vault.files.length, 6);
assert.equal(vault.feedbacks.length, 3);
assert.equal(vault.feedbackFileCount, 3);
assert.deepEqual(vault.invalidFeedbackFiles, []);
assert.equal(vault.manifest.graphVersion, 1, "vault imports should expose valid manifest identity");
assert.equal(vault.manifest.appVersion, "0.1.0", "vault imports should expose optional producer-version metadata");
assert.deepEqual(vault.manifest.learning, { requested: 1, included: 1, unavailable: [], complete: true }, "vault imports should expose complete learning-projection status");
assert.equal(vault.manifestError, null);
assert.equal(vault.graphError, null);
const embeddedGraph = defaultGraph();
const embeddedGraphFingerprint = fingerprintBackup(embeddedGraph);
const validEmbeddedVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version, graphFingerprint: embeddedGraphFingerprint, redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "graph.json", text: JSON.stringify({ ...embeddedGraph, graphFingerprint: embeddedGraphFingerprint }) },
  { name: "graph.jsonld", text: JSON.stringify(buildJsonLd(embeddedGraph)) }
]));
assert.equal(validEmbeddedVault.graphError, null, "vault parsing should verify a matching embedded graph and manifest");
assert.equal(validEmbeddedVault.jsonLdError, null, "vault parsing should verify a matching JSON-LD projection and manifest");
const unanchoredJsonLdVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version, graphFingerprint: embeddedGraphFingerprint, redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "graph.jsonld", text: JSON.stringify(buildJsonLd(embeddedGraph)) }
]));
assert.equal(unanchoredJsonLdVault.jsonLdError, "Embedded graph JSON is missing; JSON-LD cannot be verified against the authoritative graph.", "vault imports should disclose JSON-LD projections without an authoritative embedded graph");
const currentConceptMarkdown = conceptMarkdown.replace(
  "id: attention",
  `id: attention\ngraph_version: ${embeddedGraph.version}\ngraph_fingerprint: ${embeddedGraphFingerprint}`
);
const staleConceptMarkdown = conceptMarkdown.replace(
  "id: attention",
  "id: attention\ngraph_version: 1\ngraph_fingerprint: fnv64-0123456789abcdef-99"
);
const noteIdentityVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version, graphFingerprint: embeddedGraphFingerprint, redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "Concepts/current.md", text: currentConceptMarkdown },
  { name: "Relations/unverified.md", text: relationMarkdown }
]));
assert.deepEqual(noteIdentityVault.staleFeedbackFiles, [], "vault notes matching the manifest should not be marked stale");
assert.deepEqual(noteIdentityVault.unverifiedFeedbackFiles, ["Relations/unverified.md"], "vault imports should surface notes without projection identity");
const staleNoteIdentityVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version, graphFingerprint: embeddedGraphFingerprint, redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "Concepts/stale.md", text: staleConceptMarkdown }
]));
assert.deepEqual(staleNoteIdentityVault.staleFeedbackFiles, ["Concepts/stale.md"], "vault imports should surface individual notes from a different revision");
const invalidEmbeddedVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version, graphFingerprint: embeddedGraphFingerprint, redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "graph.json", text: JSON.stringify({ ...embeddedGraph, graphFingerprint: "fnv64-0000000000000000-0" }) }
]));
assert.match(invalidEmbeddedVault.graphError || "", /fingerprint/, "vault parsing should reject a tampered embedded graph");
const invalidEmbeddedGraphVersionVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version, graphFingerprint: embeddedGraphFingerprint, appVersion: "0.1.0", redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "graph.json", text: JSON.stringify({ ...embeddedGraph, graphFingerprint: embeddedGraphFingerprint, appVersion: "0.1.1" }) }
]));
assert.match(invalidEmbeddedGraphVersionVault.graphError || "", /metadata/, "vault parsing should reject graph and manifest producer-version mismatches");
const invalidEmbeddedGraphAppVersionVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version, graphFingerprint: embeddedGraphFingerprint, redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "graph.json", text: JSON.stringify({ ...embeddedGraph, graphFingerprint: embeddedGraphFingerprint, appVersion: "x".repeat(65) }) }
]));
assert.match(invalidEmbeddedGraphAppVersionVault.graphError || "", /producer metadata/, "vault parsing should reject oversized graph producer metadata");
const mismatchedManifestVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version + 1, graphFingerprint: embeddedGraphFingerprint, redacted: true, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "graph.json", text: JSON.stringify({ ...embeddedGraph, graphFingerprint: embeddedGraphFingerprint }) }
]));
assert.match(mismatchedManifestVault.graphError || "", /metadata/, "vault parsing should reject manifest version or redaction mismatches");
const invalidJsonLdVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version, graphFingerprint: embeddedGraphFingerprint, redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "graph.jsonld", text: JSON.stringify({ ...buildJsonLd(embeddedGraph), fingerprint: "fnv64-0000000000000000-0" }) }
]));
assert.match(invalidJsonLdVault.jsonLdError || "", /JSON-LD/, "vault parsing should reject a tampered JSON-LD projection");
const invalidJsonLdAppVersionVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version, graphFingerprint: embeddedGraphFingerprint, redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "graph.jsonld", text: JSON.stringify({ ...buildJsonLd(embeddedGraph), appVersion: "x".repeat(65) }) }
]));
assert.match(invalidJsonLdAppVersionVault.jsonLdError || "", /JSON-LD/, "vault parsing should reject oversized JSON-LD producer metadata");
const mismatchedJsonLdAppVersionVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version, graphFingerprint: embeddedGraphFingerprint, appVersion: "0.1.0", redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "graph.jsonld", text: JSON.stringify({ ...buildJsonLd(embeddedGraph), appVersion: "0.1.1" }) }
]));
assert.match(mismatchedJsonLdAppVersionVault.jsonLdError || "", /JSON-LD/, "vault parsing should reject JSON-LD and manifest producer-version mismatches");
const semanticallyTamperedJsonLd = buildJsonLd(embeddedGraph);
semanticallyTamperedJsonLd.name = "A different dataset";
const semanticJsonLdVault = parseObsidianVault(storedZip([
  { name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: embeddedGraph.version, graphFingerprint: embeddedGraphFingerprint, redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) },
  { name: "graph.json", text: JSON.stringify({ ...embeddedGraph, graphFingerprint: embeddedGraphFingerprint }) },
  { name: "graph.jsonld", text: JSON.stringify(semanticallyTamperedJsonLd) }
]));
assert.match(semanticJsonLdVault.jsonLdError || "", /JSON-LD/, "vault parsing should reject semantically tampered JSON-LD with otherwise valid metadata");
const invalidFeedbackVault = parseObsidianVault(storedZip([
  { name: "Concepts/valid.md", text: conceptMarkdown },
  { name: "Relations/broken.md", text: "# missing frontmatter" },
  { name: "Sources/valid-source.md", text: `---\ntype: source\nid: doc-source\nquality: primary\n---\n\n# Source` }
]));
assert.equal(invalidFeedbackVault.feedbacks.length, 2);
assert.deepEqual(invalidFeedbackVault.invalidFeedbackFiles, ["Relations/broken.md"], "malformed exported feedback notes should be surfaced instead of silently skipped");
const invalidManifestVault = parseObsidianVault(storedZip([{ name: "vault-manifest.json", text: "{}" }]));
assert.equal(invalidManifestVault.manifest, null);
assert.equal(invalidManifestVault.manifestError, "Vault manifest metadata is invalid.", "invalid vault identity should be surfaced without blocking parsing");
const unknownManifestFieldVault = parseObsidianVault(storedZip([{
  name: "vault-manifest.json",
  text: JSON.stringify({
    format: VAULT_FORMAT,
    graphSchema: GRAPH_SCHEMA,
    graphVersion: 0,
    graphFingerprint: "fnv64-0123456789abcdef-42",
    redacted: false,
    generatedAt: "2025-01-01T00:00:00.000Z",
    unsupported: "must be rejected"
  })
}]));
assert.equal(unknownManifestFieldVault.manifestError, "Vault manifest metadata is invalid.", "vault imports should reject manifest fields outside the closed schema");
const unknownLearningFieldVault = parseObsidianVault(storedZip([{
  name: "vault-manifest.json",
  text: JSON.stringify({
    format: VAULT_FORMAT,
    graphSchema: GRAPH_SCHEMA,
    graphVersion: 0,
    graphFingerprint: "fnv64-0123456789abcdef-42",
    redacted: false,
    generatedAt: "2025-01-01T00:00:00.000Z",
    learning: { requested: 0, included: 0, unavailable: [], complete: true, unsupported: true }
  })
}]));
assert.equal(unknownLearningFieldVault.manifestError, "Vault manifest metadata is invalid.", "vault imports should reject unsupported nested learning metadata");
const incompleteLearningManifestVault = parseObsidianVault(storedZip([{
  name: "vault-manifest.json",
  text: JSON.stringify({
    format: VAULT_FORMAT,
    graphSchema: GRAPH_SCHEMA,
    graphVersion: 0,
    graphFingerprint: "fnv64-0123456789abcdef-42",
    redacted: false,
    generatedAt: "2025-01-01T00:00:00.000Z",
    learning: { requested: 1, included: 0, unavailable: ["tokens"], complete: false }
  })
}]));
assert.equal(incompleteLearningManifestVault.manifestError, null, "vault imports should accept and expose bounded incomplete learning status");
const mismatchedLearningManifestVault = parseObsidianVault(storedZip([{
  name: "vault-manifest.json",
  text: JSON.stringify({
    format: VAULT_FORMAT,
    graphSchema: GRAPH_SCHEMA,
    graphVersion: 0,
    graphFingerprint: "fnv64-0123456789abcdef-42",
    redacted: false,
    generatedAt: "2025-01-01T00:00:00.000Z",
    learning: { requested: 1, included: 1, unavailable: [], complete: true }
  })
}]));
assert.equal(mismatchedLearningManifestVault.manifestError, "Vault learning-projection status does not match its files.", "vault imports should reject learning completeness claims that do not match archive contents");
const contradictoryLearningManifestVault = parseObsidianVault(storedZip([{
  name: "vault-manifest.json",
  text: JSON.stringify({
    format: VAULT_FORMAT,
    graphSchema: GRAPH_SCHEMA,
    graphVersion: 0,
    graphFingerprint: "fnv64-0123456789abcdef-42",
    redacted: false,
    generatedAt: "2025-01-01T00:00:00.000Z",
    learning: { requested: 13, included: 13, unavailable: ["tokens"], complete: true }
  })
}]));
assert.equal(contradictoryLearningManifestVault.manifestError, "Vault manifest metadata is invalid.", "vault imports should reject contradictory learning completeness metadata");
const negativeManifestVault = parseObsidianVault(storedZip([{ name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: -1, graphFingerprint: "fnv64-0123456789abcdef-42", redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) }]));
assert.equal(negativeManifestVault.manifestError, "Vault manifest metadata is invalid.", "negative vault versions should be rejected");
const oversizedManifestVault = parseObsidianVault(storedZip([{ name: "vault-manifest.json", text: "x".repeat(MAX_VAULT_MANIFEST_CHARS + 1) }]));
assert.equal(oversizedManifestVault.manifestError, "Vault manifest metadata exceeds the safety limit.", "vault manifests should be bounded before JSON parsing");
const oversizedAppVersionVault = parseObsidianVault(storedZip([{ name: "vault-manifest.json", text: JSON.stringify({ format: VAULT_FORMAT, graphSchema: GRAPH_SCHEMA, graphVersion: 0, graphFingerprint: "fnv64-0123456789abcdef-42", appVersion: "x".repeat(65), redacted: false, generatedAt: "2025-01-01T00:00:00.000Z" }) }]));
assert.equal(oversizedAppVersionVault.manifestError, "Vault manifest metadata is invalid.", "vault manifests should reject oversized producer-version metadata");
assert.throws(() => readStoredZip(storedZip([
  { name: "one.md", text: "x".repeat(1_000_000) },
  { name: "two.md", text: "y".repeat(1_000_000) }
]), { maxUncompressedBytes: 1_500_000 }), /too much uncompressed data/, "ZIP imports should bound cumulative decoded content");
assert.throws(
  () => readStoredZip({ length: MAX_ZIP_FILES + 1, 0: 0 }),
  /provided as byte data/,
  "ZIP imports should reject array-like input before coercion can allocate unbounded memory"
);
assert.throws(() => readStoredZip(new Uint8Array([1, 2, 3])), /no readable directory/);
assert(MAX_ZIP_FILES >= MAX_GRAPH_DOCUMENTS + MAX_GRAPH_NODES + MAX_GRAPH_EDGES, "vault imports should support the maximum graph projection file count");
assert.throws(() => readStoredZip(storedZip([
  { name: "duplicate.md", content: "one" },
  { name: "duplicate.md", content: "two" }
])), /unsafe or duplicate file path/);
assert.throws(() => readStoredZip(storedZip([
  { name: "..\\outside.md", content: "unsafe" }
])), /unsafe or duplicate file path/);
assert.throws(() => readStoredZip(storedZip([
  { name: "bad\u0000.md", content: "unsafe" }
])), /unsafe or duplicate file path/);
const overlappingZip = storedZip([{ name: "overlap.md", text: "x" }]);
const overlappingView = new DataView(overlappingZip.buffer);
const overlappingEnd = overlappingZip.length - 22;
const overlappingCentralOffset = overlappingView.getUint32(overlappingEnd + 16, true);
const overlappingNameLength = overlappingView.getUint16(26, true);
const overlappingDataStart = 30 + overlappingNameLength;
const overlappingSize = overlappingCentralOffset - overlappingDataStart + 1;
overlappingView.setUint32(overlappingCentralOffset + 20, overlappingSize, true);
overlappingView.setUint32(overlappingCentralOffset + 24, overlappingSize, true);
assert.throws(() => readStoredZip(overlappingZip), /overlapping its central directory/, "ZIP imports should reject file data ranges that overlap the central directory");
const aliasedZip = storedZip([
  { name: "first.md", text: "a" },
  { name: "second.md", text: "b" }
]);
const aliasedView = new DataView(aliasedZip.buffer);
const aliasedEnd = aliasedZip.length - 22;
const aliasedCentralOffset = aliasedView.getUint32(aliasedEnd + 16, true);
const firstCentralOffset = aliasedCentralOffset;
const secondCentralOffset = firstCentralOffset + 46 + new TextEncoder().encode("first.md").length;
const firstDataStart = 30 + new TextEncoder().encode("first.md").length;
const secondLocalOffset = aliasedView.getUint32(secondCentralOffset + 42, true);
const secondDataStart = secondLocalOffset + 30 + new TextEncoder().encode("second.md").length;
const aliasedSize = secondDataStart + 1 - firstDataStart;
const aliasedBytes = aliasedZip.slice(firstDataStart, secondDataStart + 1);
aliasedView.setUint32(firstCentralOffset + 16, crc32(aliasedBytes), true);
aliasedView.setUint32(firstCentralOffset + 20, aliasedSize, true);
aliasedView.setUint32(firstCentralOffset + 24, aliasedSize, true);
assert.throws(() => readStoredZip(aliasedZip), /file data overlapping/, "ZIP imports should reject aliased file data ranges");

const graph = {
  ...defaultGraph(),
  version: 1,
  documents: [{ id: "doc-1", title: "Source", text: "text", fingerprint: "source-1", uri: "https://example.org/source", addedAt: new Date().toISOString() }],
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
assert.equal(result.updates, 5);
assert.equal(result.graph.nodes[0].label, "Attention mechanism");
assert.equal(result.graph.nodes[0].status, "accepted");
assert(Date.parse(result.graph.nodes[0].lastReviewedAt) > Date.now() - 5000, "substantive Obsidian edits should refresh the review timestamp");
const reversedRelationFeedback = parseObsidianFeedback(relationMarkdown
  .replace("status: rejected", "status: accepted")
  .replace("source: attention", "source: context")
  .replace("target: context", "target: attention"));
const reversedRelationResult = applyObsidianFeedback(graph, [reversedRelationFeedback]);
assert.equal(reversedRelationResult.skipped, 0, "Obsidian relation feedback should accept reversed endpoint order for the same semantic relation");
assert.equal(reversedRelationResult.graph.edges[0].status, "accepted", "reversed Obsidian relation feedback should update the canonical edge");
const mismatchedRelationResult = applyObsidianFeedback(graph, [parseObsidianFeedback(relationMarkdown
  .replace("source: attention", "source: unrelated")
  .replace("target: context", "target: concept"))]);
assert.equal(mismatchedRelationResult.skipped, 1, "Obsidian relation feedback should still reject unrelated endpoint pairs");
const ambiguousProjectionGraph = normalizeGraph({
  ...graph,
  edges: [
    { ...graph.edges[0], id: "ambiguous-edge", label: "uses" },
    { ...graph.edges[0], id: "ambiguous-edge", target: "attention", label: "supports" }
  ]
});
const ambiguousProjectionFeedback = applyObsidianFeedback(ambiguousProjectionGraph, [{
  type: "relation",
  id: "ambiguous-edge",
  source: "attention",
  target: "context",
  label: "uses",
  status: "accepted"
}]);
assert.equal(ambiguousProjectionFeedback.changed, false, "Obsidian feedback must refuse ambiguous imported relation IDs");
assert.equal(ambiguousProjectionFeedback.skipped, 1, "ambiguous Obsidian relation feedback should be disclosed as skipped");
assert(result.graph.nodes[0].aliases.includes("Attention"));
assert.equal(result.graph.edges[0].status, "rejected");
assert.equal(result.graph.edges[0].feedback, -1);
assert(result.graph.learning.examples.some((example) => example.kind === "relation" && example.status === "rejected"), "Obsidian relation feedback should become reusable learning memory");
assert.match(result.graph.learning.examples.find((example) => example.kind === "relation").lastReviewedAt, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(result.graph.learning.examples.find((example) => example.kind === "relation")?.sourceLabel, "Attention mechanism", "Obsidian concept renames should refresh relation endpoint learning labels");
assert.equal(applyObsidianFeedback(result.graph, [concept, relation]).changed, false);
const mismatchedRelation = applyObsidianFeedback(graph, [{ ...relation, source: "different-source" }]);
assert.equal(mismatchedRelation.changed, false, "relation feedback with mismatched endpoints should not mutate a colliding edge ID");
assert.equal(mismatchedRelation.skipped, 1, "mismatched relation endpoints should be reported as skipped");
const conflictingObsidianFeedback = applyObsidianFeedback(graph, [
  { type: "concept", id: "attention", label: "Renamed once", aliases: [], status: "accepted", hasLastReviewedAt: false, lastReviewedAt: null },
  { type: "concept", id: "attention", label: "Renamed twice", aliases: [], status: "accepted", hasLastReviewedAt: false, lastReviewedAt: null }
]);
assert.equal(conflictingObsidianFeedback.conflicts, 1, "conflicting Obsidian edits for one identity should be disclosed");
assert.equal(conflictingObsidianFeedback.changed, false, "conflicting Obsidian edits should not apply an order-dependent winner");
const duplicateObsidianFeedback = applyObsidianFeedback(graph, [
  { type: "concept", id: "attention", label: "Attention mechanism", aliases: ["Attention"], status: "accepted", hasLastReviewedAt: true, lastReviewedAt: "2025-02-02T00:00:00.000Z" },
  { type: "concept", id: "attention", label: "Attention mechanism", aliases: ["Attention"], status: "accepted", hasLastReviewedAt: true, lastReviewedAt: "2025-02-02T00:00:00.000Z" }
]);
assert.equal(duplicateObsidianFeedback.conflicts, 0, "identical duplicate Obsidian edits should collapse safely");
const versionLockedProjection = normalizeGraph({ ...graph, version: MAX_GRAPH_VERSION });
assert.equal(applyObsidianFeedback(versionLockedProjection, [concept]).limited, "version", "Obsidian feedback should fail closed at the graph version ceiling");
const memoryRepair = applyObsidianFeedback(normalizeGraph({
  ...graph,
  nodes: graph.nodes.map((node) => ({ ...node, status: node.id === "attention" ? "accepted" : node.status })),
  learning: { examples: [] }
}), [concept]);
assert.equal(memoryRepair.changed, true, "unchanged Obsidian notes should repair missing reusable learning memory");
assert(memoryRepair.graph.learning.examples.some((example) => example.kind === "concept" && example.status === "accepted"), "Obsidian memory repair should retain the accepted concept");
assert.equal(applyObsidianFeedback(memoryRepair.graph, [concept]).changed, false, "repaired Obsidian feedback should remain idempotent");
const aliasOrderGraph = normalizeGraph({
  ...graph,
  version: 4,
  nodes: graph.nodes.map((node) => node.id === "attention"
    ? { ...node, aliases: ["lookup", "attention"], status: "accepted", lastReviewedAt: "2025-02-02T00:00:00.000Z" }
    : node),
  learning: {
    examples: [{
      kind: "concept",
      id: "attention",
      label: "Attention",
      aliases: ["attention", "lookup"],
      status: "accepted",
      lastReviewedAt: "2025-02-02T00:00:00.000Z"
    }]
  }
});
const reorderedAliases = applyObsidianFeedback(aliasOrderGraph, [{
  type: "concept",
  id: "attention",
  label: "Attention",
  aliases: ["attention", "lookup"],
  status: "accepted",
  hasLastReviewedAt: true,
  lastReviewedAt: "2025-02-02T00:00:00.000Z"
}]);
assert.equal(reorderedAliases.changed, false, "reordering set-like Obsidian aliases should remain idempotent");
const sourceResult = applyObsidianFeedback(normalizeGraph({
  ...graph,
  documents: [{ id: "doc-source", title: "Original", text: "text", quality: "unknown" }]
}), [source]);
assert.equal(sourceResult.graph.documents[0].quality, "primary");
assert.equal(sourceResult.graph.documents[0].lastReviewedAt, "2025-02-01T00:00:00.000Z");
const invalidSourceResult = applyObsidianFeedback(normalizeGraph({
  ...graph,
  documents: [{ id: "doc-source", title: "Original", text: "text", quality: "unknown" }]
}), [{ type: "source", id: "doc-source", quality: "invalid", lastReviewedAt: "invalid", hasLastReviewedAt: true }]);
assert.equal(invalidSourceResult.graph.documents[0].quality, "unknown");
assert.equal(invalidSourceResult.graph.documents[0].lastReviewedAt, null);
const oversizedDirectSourceDate = applyObsidianFeedback(normalizeGraph({
  ...graph,
  documents: [{ id: "doc-source", title: "Original", text: "text", quality: "unknown" }]
}), [{ type: "source", id: "doc-source", quality: "unknown", lastReviewedAt: "2".repeat(129), hasLastReviewedAt: true }]);
assert.equal(oversizedDirectSourceDate.graph.documents[0].lastReviewedAt, null, "direct source metadata should reject oversized timestamps");
const correctedInferred = applyObsidianFeedback(normalizeGraph({
  ...graph,
  nodes: graph.nodes.map((node) => ({ ...node, status: "inferred", feedback: 0 }))
}), [{ type: "concept", id: "attention", label: "Corrected attention", aliases: [], status: "inferred" }]);
assert.equal(correctedInferred.graph.nodes.find((node) => node.id === "attention").status, "accepted", "human label corrections should become reusable accepted knowledge");
const collisionResult = applyObsidianFeedback(graph, [{ type: "concept", id: "attention", label: "Context", aliases: [], status: null }]);
assert.equal(collisionResult.changed, false, "conflicting concept labels should not be applied");
assert.equal(collisionResult.skipped, 1, "conflicting concept labels should be reported as skipped");
assert.equal(collisionResult.graph.nodes.find((node) => node.id === "attention").label, "Attention", "conflicting corrections should preserve the original label");
const atomicCollisionResult = applyObsidianFeedback(normalizeGraph({
  ...graph,
  nodes: graph.nodes.map((node) => node.id === "attention" ? { ...node, status: "inferred", aliases: [] } : node)
}), [{
  type: "concept",
  id: "attention",
  label: "Context",
  aliases: ["manual correction"],
  status: "accepted"
}]);
assert.equal(atomicCollisionResult.changed, false, "conflicting concept edits should be rejected atomically");
assert.equal(atomicCollisionResult.graph.nodes.find((node) => node.id === "attention").status, "inferred", "atomic collision rejection should preserve status");
assert.deepEqual(atomicCollisionResult.graph.nodes.find((node) => node.id === "attention").aliases, [], "atomic collision rejection should preserve aliases");
const aliasCollisionResult = applyObsidianFeedback(normalizeGraph({
  ...graph,
  nodes: graph.nodes.map((node) => node.id === "context" ? { ...node, aliases: ["lookup"] } : node)
}), [{ type: "concept", id: "attention", label: "lookup", aliases: [], status: null }]);
assert.equal(aliasCollisionResult.changed, false, "concept corrections should not collide with another concept alias");
assert.equal(aliasCollisionResult.skipped, 1, "alias collisions should be reported as skipped");
const repeatedRelationLabel = applyObsidianFeedback(graph, [{ type: "relation", id: "attention--context--uses", label: "supports", aliases: [], status: null }]);
assert.equal(repeatedRelationLabel.changed, true, "relation labels should remain reusable across different relations");
assert.equal(repeatedRelationLabel.graph.edges[0].label, "supports");
const relationLabelCollisionGraph = normalizeGraph({
  ...graph,
  edges: [
    ...graph.edges,
    { id: "attention--context--supports", source: "attention", target: "context", label: "supports", confidence: .7, evidence: [], sources: ["doc-1"], status: "inferred" }
  ]
});
const relationLabelCollision = applyObsidianFeedback(relationLabelCollisionGraph, [{
  type: "relation",
  id: "attention--context--uses",
  source: "attention",
  target: "context",
  label: "supports",
  aliases: [],
  status: null
}]);
assert.equal(relationLabelCollision.changed, false, "relation corrections should not silently collapse an existing semantic relation");
assert.equal(relationLabelCollision.skipped, 1, "relation label collisions should be reported as skipped");
assert.equal(relationLabelCollision.graph.edges.some((edge) => edge.id === "attention--context--uses" && edge.label === "uses"), true, "relation label collisions should preserve the original relation");
const directOversizedFeedback = applyObsidianFeedback(graph, [{
  type: "concept",
  id: "attention",
  label: "x".repeat(500),
  aliases: ["y".repeat(500)],
  status: "accepted"
}]);
assert.equal(directOversizedFeedback.changed, false, "direct oversized Obsidian corrections should fail closed");
assert.equal(directOversizedFeedback.graph.nodes[0].label, "Attention", "rejected oversized corrections should not mutate the graph");
console.log("projection adapter smoke ok");
