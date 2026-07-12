import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  GRAPH_SCHEMA,
  defaultGraph,
  extractGraph,
  mergeExtraction,
  normalizeGraph,
  normalizeExtraction,
  applyFeedback,
  removeSource,
  inspectGraph,
  reviewQueue,
  slugify,
  MAX_ACTIVE_FEEDBACK_CONCEPTS
} from "../graph-core.js";
import { createGraphStore } from "../graph-store.js";

const storage = new Map();
const localStorage = {
  failWrites: false,
  getItem: (key) => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => {
    if (localStorage.failWrites) throw new Error("quota");
    storage.set(key, String(value));
  },
  removeItem: (key) => storage.delete(key)
};
const graphStore = createGraphStore(localStorage, {
  graphKey: "graph",
  historyKey: "history",
  recoveryKey: "recovery"
});

const sourceText = `# Attention
Attention is a mechanism for mixing information.
Self-attention uses queries, keys, and values to gather context.
The Transformer uses attention to model relationships between tokens.`;
assert.equal(slugify("Hello, World!"), "hello-world");
const partialExtraction = normalizeExtraction({
  source: { title: "Adapter result" },
  nodes: [{ label: "A" }, { label: "B" }],
  edges: [{ source: "A", target: "B", label: "supports" }]
}, "Fallback", "Adapter source text");
assert.equal(partialExtraction.source.title, "Adapter result");
assert.equal(partialExtraction.source.text, "Adapter source text");
assert.equal(partialExtraction.nodes[0].id, "a");
assert.equal(partialExtraction.edges[0].source, "a");
assert.equal(partialExtraction.edges[0].sources[0], partialExtraction.source.id);
const duplicateExtraction = normalizeExtraction({
  source: { title: "Duplicate model output" },
  nodes: [
    { id: "same", label: "Same", confidence: .6, mentions: 1 },
    { id: "same", label: "Same", confidence: .9, mentions: 2, aliases: ["Repeated"] }
  ],
  edges: [
    { source: "same", target: "same", label: "loops", confidence: .4 },
    { source: "same", target: "same", label: "loops", confidence: .8 }
  ]
}, "Fallback", "Duplicate output text");
assert.equal(duplicateExtraction.nodes.length, 1, "duplicate model concepts should collapse");
assert.equal(duplicateExtraction.nodes[0].mentions, 3, "duplicate concept mentions should accumulate");
assert.equal(duplicateExtraction.nodes[0].confidence, .9, "duplicate concept confidence should retain the strongest signal");
assert.equal(duplicateExtraction.edges.length, 1, "duplicate model relations should collapse");
assert.equal(duplicateExtraction.edges[0].confidence, .8, "duplicate relation confidence should retain the strongest signal");
const extracted = extractGraph("Attention notes", sourceText);
assert.equal(extracted.source.title, "Attention notes");
assert(extracted.nodes.length >= 3, "the extractor should find multiple concepts");
assert(extracted.edges.length >= 1, "the extractor should find at least one relation");
assert(extracted.nodes.every((node) => node.sources.includes(extracted.source.id)), "nodes should retain source evidence");
const normalizedSource = sourceText.replace(/\n+/g, " ");
assert(extracted.edges.some((edge) => edge.label === "uses"), "explicit relation verbs should be preserved");
assert(extracted.edges.every((edge) => edge.evidence.some((quote) => normalizedSource.includes(quote.text) && quote.sources.includes(extracted.source.id))), "relations should retain source sentence evidence");
const adapted = extractGraph("Feedback notes", "The bridge representation organizes signals for review.", {
  feedback: [
    { kind: "concept", id: "latent-bridge", label: "Latent Bridge", status: "accepted", aliases: ["bridge representation"] },
    { kind: "concept", id: "signals", label: "signals", status: "rejected" }
  ]
});
assert(adapted.nodes.some((node) => node.id === "latent-bridge" && node.aliases.includes("bridge representation")), "accepted concept feedback should seed and enrich matching concepts");
assert(!adapted.nodes.some((node) => node.id === "bridge-representation"), "accepted aliases should not create duplicate concept IDs");
assert.equal(MAX_ACTIVE_FEEDBACK_CONCEPTS, 100, "adaptive extraction should bound active concept feedback hints");
assert(!adapted.nodes.some((node) => node.id === "signals"), "rejected concept feedback should suppress matching concepts");
const adaptedRelation = extractGraph("Relation feedback", "Alpha guides Beta through a useful representation for review.", {
  feedback: [
    { kind: "relation", source: "alpha", target: "beta", label: "guides", status: "accepted" }
  ]
});
assert(adaptedRelation.edges.some((edge) => edge.source === "alpha" && edge.target === "beta" && edge.label === "guides"), "accepted relation feedback should guide matching relation labels");
const boundedExtraction = extractGraph(null,  `${sourceText}${" extra".repeat(100000)}`);
assert.equal(boundedExtraction.source.text.length, 300000, "the pure extractor should enforce the document size limit");
assert.doesNotThrow(() => extractGraph("Non-string input", null));

const mergeResult = mergeExtraction(defaultGraph(), extracted);
const merged = mergeResult.graph;
assert.equal(mergeResult.duplicate, false);
assert.equal(merged.schema, GRAPH_SCHEMA);
assert.equal(merged.version, 1);
assert.equal(merged.documents.length, 1);
assert.equal(merged.nodes.length, extracted.nodes.length);
assert(merged.nodes.every((node) => node.status === "inferred"));
assert(merged.edges.every((edge) => edge.status === "inferred"));
assert.equal(merged.edges[0].feedback, 0);
const acceptedNodeFeedback = applyFeedback(merged, "node", merged.nodes[0].id, "up");
assert.equal(acceptedNodeFeedback.changed, true);
assert.equal(acceptedNodeFeedback.graph.nodes.find((node) => node.id === merged.nodes[0].id).status, "accepted");
assert.equal(acceptedNodeFeedback.graph.nodes.find((node) => node.id === merged.nodes[0].id).feedback, 1);
const dismissedEdgeFeedback = applyFeedback(merged, "edge", merged.edges[0].id, "down");
assert.equal(dismissedEdgeFeedback.graph.edges.find((edge) => edge.id === merged.edges[0].id).status, "rejected");
assert.equal(dismissedEdgeFeedback.graph.edges.find((edge) => edge.id === merged.edges[0].id).feedback, -1);
const dismissedConfidence = dismissedEdgeFeedback.graph.edges.find((edge) => edge.id === merged.edges[0].id).confidence;
const reingestedDismissed = mergeExtraction(dismissedEdgeFeedback.graph, {
  source: { id: "doc-follow-up", title: "Follow-up", text: "follow-up", fingerprint: "follow-up-1", addedAt: new Date().toISOString() },
  nodes: extracted.nodes.map((node) => ({ ...node, sources: ["doc-follow-up"], evidence: [] })),
  edges: extracted.edges.map((edge) => ({ ...edge, sources: ["doc-follow-up"], evidence: [] }))
});
const reingestedEdge = reingestedDismissed.graph.edges.find((edge) => edge.id === dismissedEdgeFeedback.graph.edges[0].id);
assert.equal(reingestedEdge.status, "rejected", "re-ingestion must not silently restore dismissed relations");
assert(reingestedEdge.confidence <= dismissedConfidence, "dismissed relation confidence must not rise on re-ingestion");
assert.equal(applyFeedback(merged, "unknown", "missing", "up").changed, false);
const health = inspectGraph(merged);
assert.equal(health.documents, 1);
assert.equal(health.provenanceCoverage, 100);
assert.equal(health.unsupportedNodes, 0);
const queue = reviewQueue(merged, 2);
assert.equal(queue.length, 2);
assert(queue.every((candidate) => ["node", "edge"].includes(candidate.kind)));
assert(queue[0].confidence <= queue[1].confidence, "review queue should prioritize low confidence items");
const brokenProvenance = inspectGraph({
  ...merged,
  nodes: merged.nodes.map((node) => ({ ...node, sources: ["missing-document"], evidence: [{ text: "broken", sources: ["missing-document"] }] })),
  edges: merged.edges.map((edge) => ({ ...edge, sources: ["missing-document"], evidence: [{ text: "broken", sources: ["missing-document"] }] }))
});
assert.equal(brokenProvenance.provenanceCoverage, 0, "provenance coverage should resolve source IDs");
assert(brokenProvenance.orphanedSourceReferences > 0, "broken source references should be visible in graph health");
const removedSource = removeSource(merged, extracted.source.id);
assert.equal(removedSource.removed, true);
assert.equal(removedSource.graph.documents.length, 0);
assert.equal(removedSource.graph.nodes.length, 0, "unsupported inferred concepts should be pruned");
assert.equal(removedSource.graph.edges.length, 0, "unsupported inferred relations should be pruned");
const acceptedKnowledge = normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0 ? { ...node, status: "accepted" } : node)
});
const acceptedAfterRemoval = removeSource(acceptedKnowledge, extracted.source.id);
assert(acceptedAfterRemoval.graph.nodes.some((node) => node.status === "accepted"), "accepted manual knowledge should survive source removal");
const multiRelation = mergeExtraction(defaultGraph(), {
  source: { id: "doc-relations", title: "Relations", text: "text", fingerprint: "relations-4", addedAt: new Date().toISOString() },
  nodes: [
    { id: "alpha", label: "Alpha", aliases: [], type: "concept", confidence: .7, mentions: 1, feedback: 0, status: "inferred", sources: ["doc-relations"], evidence: [] },
    { id: "beta", label: "Beta", aliases: [], type: "concept", confidence: .7, mentions: 1, feedback: 0, status: "inferred", sources: ["doc-relations"], evidence: [] }
  ],
  edges: [
    { id: "old-1", source: "alpha", target: "beta", label: "uses", confidence: .7, evidence: [], sources: ["doc-relations"], status: "inferred" },
    { id: "old-2", source: "alpha", target: "beta", label: "supports", confidence: .7, evidence: [], sources: ["doc-relations"], status: "inferred" }
  ]
});
assert.equal(new Set(multiRelation.graph.edges.map((edge) => edge.id)).size, 2, "relation IDs should remain unique by label");
const caseFoldedFirst = mergeExtraction(defaultGraph(), {
  source: { id: "doc-case-1", title: "Case one", text: "case one", fingerprint: "case-1", addedAt: new Date().toISOString() },
  nodes: [
    { id: "alpha", label: "Alpha", sources: ["doc-case-1"], evidence: [] },
    { id: "beta", label: "Beta", sources: ["doc-case-1"], evidence: [] }
  ],
  edges: [{ source: "alpha", target: "beta", label: "uses", sources: ["doc-case-1"], evidence: [] }]
}).graph;
const caseFoldedSecond = mergeExtraction(caseFoldedFirst, {
  source: { id: "doc-case-2", title: "Case two", text: "case two", fingerprint: "case-2", addedAt: new Date().toISOString() },
  nodes: [
    { id: "alpha", label: "Alpha", sources: ["doc-case-2"], evidence: [] },
    { id: "beta", label: "Beta", sources: ["doc-case-2"], evidence: [] }
  ],
  edges: [{ source: "alpha", target: "beta", label: "USES", sources: ["doc-case-2"], evidence: [] }]
}).graph;
assert.equal(caseFoldedSecond.edges.length, 1, "relation merge keys should be case-insensitive");

assert.equal(graphStore.write(merged), true);
assert.equal(graphStore.canUndo(), true);
assert.equal(graphStore.undo(), true);
assert.equal(graphStore.read().version, 0);
assert.equal(graphStore.restore(merged, [defaultGraph()]), true);
assert.equal(graphStore.read().version, merged.version);
assert.equal(graphStore.readHistory().length, 1);
assert.equal(graphStore.undo(), true);
assert.equal(graphStore.read().version, 0);
storage.set("graph", JSON.stringify({ ...merged, version: merged.version + 1 }));
assert.equal(graphStore.write(defaultGraph(), { expectedVersion: 0 }), false, "stale batch writes should fail safely");
assert.equal(graphStore.getLastWriteMode(), "conflict");
assert.equal(graphStore.read().version, merged.version + 1, "conflicting writes must preserve the newer graph");
assert.equal(graphStore.restore(defaultGraph(), [], { expectedVersion: 0 }), false, "stale backup restores should fail safely");
assert.equal(graphStore.getLastWriteMode(), "conflict");
storage.delete("graph");
localStorage.failWrites = true;
assert.equal(graphStore.write(merged), false, "storage failure should be reported");
localStorage.failWrites = false;
assert.equal(graphStore.read().version, 0, "failed write should leave the prior graph intact");
storage.set("graph", "{not valid json");
assert.equal(graphStore.read().version, 0, "corrupt saved state should fail closed");
assert.equal(graphStore.readRecovery(), "{not valid json", "corrupt saved state should be preserved for recovery");
assert.equal(graphStore.clearRecovery(), true);
assert.equal(graphStore.readRecovery(), null);
storage.set("graph", JSON.stringify({ schema: "llm-field-notes/graph@999", nodes: [{ id: "lost", label: "Recover me" }] }));
assert.equal(graphStore.read().nodes.length, 0, "unsupported schema should fail closed");
assert(storage.get("recovery")?.includes("graph@999"), "unsupported schema should be preserved for recovery");
graphStore.clearRecovery();
storage.delete("graph");
storage.set("history", JSON.stringify(Array.from({ length: 100 }, () => defaultGraph())));
assert.equal(graphStore.readHistory().length, 3, "history should be bounded before normalization");
storage.delete("history");
const historyQuotaStorage = new Map();
const historyQuotaAdapter = {
  getItem: (key) => historyQuotaStorage.has(key) ? historyQuotaStorage.get(key) : null,
  setItem: (key, value) => {
    if (key === "quota-history") throw new Error("history quota");
    historyQuotaStorage.set(key, String(value));
  },
  removeItem: (key) => historyQuotaStorage.delete(key)
};
const quotaStore = createGraphStore(historyQuotaAdapter, {
  graphKey: "quota-graph",
  historyKey: "quota-history",
  recoveryKey: "quota-recovery"
});
assert.equal(quotaStore.write(merged), true, "graph writes should survive history-only quota failures");
assert.equal(quotaStore.read().version, merged.version);
assert.equal(quotaStore.getLastWriteMode(), "without-new-history");
assert.equal(quotaStore.restore(merged, [defaultGraph()]), true, "backup restore should survive history-only quota failures");
assert.equal(quotaStore.read().version, merged.version);
assert.equal(quotaStore.getLastWriteMode(), "without-history");
assert.equal(quotaStore.clear(), true, "clear should survive history-only quota failures");
assert.equal(quotaStore.read().version, 0);
assert.equal(quotaStore.getLastWriteMode(), "without-history");

const duplicateResult = mergeExtraction(merged, extractGraph("Same notes", sourceText));
assert.equal(duplicateResult.duplicate, true, "the same document should not create a second source");
assert.equal(duplicateResult.graph.documents.length, 1);
const lineEndingGraph = mergeExtraction(defaultGraph(), extractGraph("Line endings", "Alpha uses context.\nBeta supports learning."));
const lineEndingDuplicate = mergeExtraction(lineEndingGraph.graph, extractGraph("Line endings copy", "Alpha uses context.\r\nBeta supports learning.  "));
assert.equal(lineEndingDuplicate.duplicate, true, "equivalent line endings and trailing whitespace should not duplicate a source");
const legacyFingerprintGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "legacy-doc", title: "Legacy", text: sourceText, fingerprint: "old-custom-fingerprint" }],
  nodes: [],
  edges: []
});
assert.equal(mergeExtraction(legacyFingerprintGraph, extractGraph("Legacy copy", sourceText)).duplicate, true, "canonical content should catch legacy fingerprint duplicates");

const aliasGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  version: 1,
  documents: [],
  nodes: [{ id: "renamed-id", label: "Human label", aliases: ["Attention"], confidence: .7, mentions: 1, sources: [], evidence: [] }],
  edges: []
});
const aliasResult = mergeExtraction(aliasGraph, extractGraph("Follow-up", "Attention uses context to mix information."));
assert(aliasResult.graph.nodes.some((node) => node.id === "renamed-id" && node.label === "Human label" && node.mentions > 1), "renamed concepts should absorb their old labels");

const rejectedGraph = normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0 ? { ...node, status: "rejected" } : node),
  edges: merged.edges.map((edge, index) => index === 0 ? { ...edge, status: "rejected" } : edge)
});
assert.equal(rejectedGraph.nodes[0].status, "rejected");
assert.equal(rejectedGraph.edges[0].status, "rejected");

const roundTrip = normalizeGraph(JSON.parse(JSON.stringify(merged)));
assert.equal(JSON.stringify(roundTrip.nodes.map((node) => node.id)), JSON.stringify(merged.nodes.map((node) => node.id)));
assert.equal(JSON.stringify(roundTrip.edges.map((edge) => edge.id)), JSON.stringify(merged.edges.map((edge) => edge.id)));

const malformed = normalizeGraph({ schema: GRAPH_SCHEMA, nodes: [{ id: "x", label: "<unsafe>", confidence: 9 }] });
assert.equal(malformed.nodes[0].confidence, 0.99);
assert.equal(malformed.edges.length, 0);
const multiline = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "doc-line", title: "A\nsource\t document", text: "text" }],
  nodes: [{ id: "line", label: "A\nmultiline\tconcept", type: "topic\nkind", sources: ["doc-line"], evidence: [] }],
  edges: [{ source: "line", target: "line", label: "relates\nacross", sources: ["doc-line"], evidence: [] }]
});
assert.equal(multiline.documents[0].title, "A source document");
assert.equal(multiline.nodes[0].label, "A multiline concept");
assert.equal(multiline.nodes[0].type, "topic kind");
assert.equal(multiline.edges[0].label, "relates across");
const oversized = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: Array.from({ length: 5005 }, (_, index) => ({ id: `node-${index}`, label: `Node ${index}` }))
});
assert.equal(oversized.nodes.length, 5000, "imported node collections should be bounded");
const oversizedExtraction = normalizeExtraction({
  source: { title: "Large extraction" },
  nodes: Array.from({ length: 5005 }, (_, index) => ({ id: `concept-${index}`, label: `Concept ${index}` }))
});
assert.equal(oversizedExtraction.nodes.length, 5000, "model extraction collections should be bounded");
const duplicateImported = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [
    { id: "same", label: "Same", confidence: .4, mentions: 1, feedback: 1, sources: [], evidence: [] },
    { id: "same", label: "Same", confidence: .8, mentions: 2, feedback: -1, status: "accepted", sources: [], evidence: [] },
    { id: "other", label: "Other", sources: [], evidence: [] }
  ],
  edges: [
    { id: "first", source: "same", target: "other", label: "relates", confidence: .4, feedback: 1, sources: [], evidence: [] },
    { id: "second", source: "same", target: "other", label: "relates", confidence: .8, feedback: -1, status: "accepted", sources: [], evidence: [] }
  ]
});
assert.equal(duplicateImported.nodes.length, 2, "imported duplicate node IDs should collapse");
assert.equal(duplicateImported.nodes.find((node) => node.id === "same").mentions, 3);
assert.equal(duplicateImported.nodes.find((node) => node.id === "same").status, "accepted");
assert.equal(duplicateImported.edges.length, 1, "imported duplicate relations should collapse");
assert.equal(duplicateImported.edges[0].confidence, .8);
assert.equal(duplicateImported.edges[0].feedback, 0);
const duplicateDocuments = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [
    { id: "doc-same", title: "Untitled document", text: "", fingerprint: "doc-same", addedAt: new Date().toISOString() },
    { id: "doc-same", title: "Useful source", text: "source text", fingerprint: "doc-same", addedAt: new Date().toISOString() },
    { title: "Generated ID", text: "another source" }
  ]
});
assert.equal(duplicateDocuments.documents.length, 2, "duplicate source IDs should collapse");
assert.equal(duplicateDocuments.documents[0].title, "Useful source");
assert(duplicateDocuments.documents[0].text, "duplicate source text should be retained");
assert(duplicateDocuments.documents[1].id, "empty source IDs should be repaired");
assert.equal(
  normalizeGraph(duplicateDocuments).documents[1].id,
  duplicateDocuments.documents[1].id,
  "repaired source IDs should remain stable across normalization"
);
const unsafeFingerprint = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ fingerprint: "External Fingerprint\nwith spaces", text: "safe source" }]
});
assert(!/[\s\n]/.test(unsafeFingerprint.documents[0].id), "repaired source IDs should be safe for projections");
const distinctFingerprints = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ fingerprint: "a b", text: "one" }, { fingerprint: "a-b", text: "two" }]
});
assert.notEqual(distinctFingerprints.documents[0].id, distinctFingerprints.documents[1].id, "repaired source IDs should preserve fingerprint uniqueness");
const legacyEvidence = normalizeGraph({ schema: "llm-field-notes/graph@0", documents: [{ id: "doc-legacy", title: "Legacy", text: "text" }], nodes: [{ id: "legacy", label: "Legacy", sources: ["doc-legacy"], evidence: ["legacy quote"] }] });
assert.equal(legacyEvidence.nodes[0].evidence[0].text, "legacy quote");
assert.equal(JSON.stringify([...legacyEvidence.nodes[0].evidence[0].sources]), JSON.stringify(["doc-legacy"]));
const migrated = normalizeGraph({ schema: "llm-field-notes/graph@0", version: 2, nodes: [{ id: "legacy", label: "Legacy concept" }] });
assert.equal(migrated.schema, GRAPH_SCHEMA);
assert.equal(migrated.nodes[0].status, "inferred");
assert(migrated.revisions.some((revision) => revision.reason.includes("Migrated")));

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const projectionStart = app.indexOf("function buildMarkdown");
const projectionEnd = app.indexOf('document.querySelector("#load-sample")');
assert(projectionStart >= 0 && projectionEnd > projectionStart, "projection boundaries should exist");
const sandbox = { console, Date, Math, Set, Map, JSON, TextEncoder, Uint8Array, DataView, GRAPH_SCHEMA };
sandbox.globalThis = sandbox;
vm.runInNewContext(`const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
${app.slice(projectionStart, projectionEnd)}
globalThis.__projectionTest = { buildVaultFiles, zipStore, buildMarkdown, buildFeedbackDataset };`, sandbox);
const { buildVaultFiles, zipStore, buildMarkdown, buildFeedbackDataset } = sandbox.__projectionTest;
const vaultFiles = buildVaultFiles(merged);
assert(vaultFiles.some((file) => file.name === "_index.md"));
assert(vaultFiles.some((file) => file.name.startsWith("Concepts/")));
assert(vaultFiles.some((file) => file.name.startsWith("Sources/")));
assert(buildMarkdown(merged).includes("[[Concepts/"), "index should contain Obsidian concept links");
assert(buildVaultFiles(rejectedGraph).some((file) => file.content.includes("status: rejected")), "rejected concepts should remain exportable");
const renamed = normalizeGraph({ ...merged, nodes: merged.nodes.map((node, index) => index === 0 ? { ...node, label: "Renamed concept" } : node) });
assert.equal(buildVaultFiles(renamed).find((file) => file.name.startsWith("Concepts/"))?.name, vaultFiles.find((file) => file.name.startsWith("Concepts/"))?.name, "concept paths should remain stable when labels change");
const retitled = normalizeGraph({ ...merged, documents: merged.documents.map((document) => ({ ...document, title: "Retitled source" })) });
assert.equal(buildVaultFiles(retitled).find((file) => file.name.startsWith("Sources/"))?.name, vaultFiles.find((file) => file.name.startsWith("Sources/"))?.name, "source paths should remain stable when titles change");
const imperfectProjectionGraph = { ...merged, edges: merged.edges.map((edge) => ({ ...edge, evidence: [{ text: "orphan evidence", sources: ["missing-source"] }] })) };
assert(!buildMarkdown(imperfectProjectionGraph).includes("undefined"), "projections should not emit undefined links");
const feedbackDataset = buildFeedbackDataset(acceptedKnowledge);
assert.equal(feedbackDataset.format, "llm-field-notes/feedback@1");
assert(feedbackDataset.examples.some((example) => example.kind === "concept" && example.status === "accepted"), "feedback export should include reviewed concepts");
const aliasFeedbackGraph = normalizeGraph({
  ...acceptedKnowledge,
  nodes: acceptedKnowledge.nodes.map((node, index) => index === 0 ? { ...node, aliases: ["human alias"] } : node)
});
const aliasFeedbackDataset = buildFeedbackDataset(aliasFeedbackGraph);
assert(aliasFeedbackDataset.examples.find((example) => example.kind === "concept")?.aliases.includes("human alias"), "feedback export should preserve reviewed aliases");
const zip = zipStore(vaultFiles);
assert.equal(zip[0], 0x50);
assert.equal(zip[1], 0x4b);
assert(zip.length > 100, "vault archive should contain file data");

console.log(`smoke ok: ${merged.nodes.length} concepts, ${merged.edges.length} relations`);
