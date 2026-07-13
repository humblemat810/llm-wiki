import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildJsonLd, matchesJsonLdProjection } from "../jsonld-projection.js";
import {
  GRAPH_SCHEMA,
  DIFF_FORMAT,
  MAX_GRAPH_DOCUMENT_CHARS,
  defaultGraph,
  extractGraph,
  mergeExtraction,
  replaceSource,
  diffGraphs,
  redactGraph,
  normalizeGraph,
  normalizeExtraction,
  normalizeSourceUri,
  relationSemanticKey,
  fingerprintFeedbackExamples,
  syncLearningRelationLabels,
  fingerprintBackup,
  preferLearningExample,
  applyFeedback,
  applyFeedbackDataset,
  mergeConcepts,
  buildExtractorFeedback,
  clearLearningMemory,
  clearStaleLearningMemory,
  removeSource,
  inspectGraph,
  reviewQueue,
  slugify,
  makeId,
  makeEdgeId,
  MAX_GRAPH_REVISIONS,
  MAX_GRAPH_VERSION,
  advanceGraphVersion,
  MAX_ACTIVE_FEEDBACK_CONCEPTS,
  MAX_FEEDBACK_EXAMPLES,
  MAX_EVIDENCE_CHARS,
  MAX_SOURCE_REFERENCES,
  MAX_ID_CHARS,
  MAX_NODE_MENTIONS,
  MAX_FEEDBACK_COUNT,
  MAX_EXTRACTION_UNITS,
  MAX_WORDS_PER_UNIT,
  MAX_SEGMENTER_CHARS,
  MAX_RELATION_LABEL_CHARS,
  REVIEW_STALE_DAYS,
  MAX_TIMESTAMP_CHARS
} from "../graph-core.js";
import { MAX_PERSISTED_JSON_CHARS, createGraphStore } from "../graph-store.js";

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
assert.equal(MAX_PERSISTED_JSON_CHARS, 50 * 1024 * 1024, "persisted JSON should have an explicit safety bound");

const sourceText = `# Attention
Attention is a mechanism for mixing information.
Self-attention uses queries, keys, and values to gather context.
The Transformer uses attention to model relationships between tokens.`;
assert.equal(slugify("Hello, World!"), "hello-world");
assert.equal(slugify("注意 机制"), "注意-机制", "slugging should preserve Unicode concept identities");
const generatedId = makeId("test");
assert.match(generatedId, /^test-[a-z0-9-]+$/, "generated graph IDs should remain projection-safe");
const partialExtraction = normalizeExtraction({
  source: { id: "", fingerprint: "", title: "Adapter result" },
  nodes: [{ id: "", label: "A" }, { label: "B" }],
  edges: [{ id: "", source: "A", target: "B", label: "supports" }]
}, "Fallback", "Adapter source text");
assert.equal(partialExtraction.source.title, "Adapter result");
assert.equal(partialExtraction.source.text, "Adapter source text");
assert(partialExtraction.source.id, "extraction normalization should repair an empty source ID");
assert(partialExtraction.source.fingerprint, "extraction normalization should repair an empty source fingerprint");
assert.match(partialExtraction.source.fingerprint, /^fnv64-[0-9a-f]{16}-\d+$/, "generated source fingerprints should use the dual-lane digest");
assert.equal(
  normalizeExtraction({ source: { title: "Adapter result", text: "Adapter source text" } }).source.id,
  normalizeExtraction({ source: { title: "Adapter result", text: "Adapter source text" } }).source.id,
  "missing extraction source IDs should be deterministic"
);
assert.equal(partialExtraction.nodes[0].id, "a");
assert(partialExtraction.nodes.every((node) => node.id), "extraction normalization should repair empty concept IDs");
assert.equal(partialExtraction.edges[0].source, "a");
assert(partialExtraction.edges[0].id, "extraction normalization should repair empty relation IDs");
assert.equal(partialExtraction.edges[0].sources[0], partialExtraction.source.id);
const duplicateExtraction = normalizeExtraction({
  source: { title: "Duplicate model output" },
  nodes: [
    { id: "same", label: "Same", confidence: .6, mentions: 1 },
    { id: "same", label: "Same other", confidence: .9, mentions: 2, aliases: ["Repeated"] }
  ],
  edges: [
    { source: "same", target: "same", label: "loops", confidence: .4 },
    { source: "same", target: "same", label: "loops", confidence: .8 }
  ]
}, "Fallback", "Duplicate output text");
assert.equal(duplicateExtraction.nodes.length, 1, "duplicate model concepts should collapse");
assert.equal(duplicateExtraction.nodes[0].mentions, 3, "duplicate concept mentions should accumulate");
assert.equal(duplicateExtraction.nodes[0].confidence, .9, "duplicate concept confidence should retain the strongest signal");
assert(duplicateExtraction.nodes[0].aliases.includes("Same other"), "duplicate concept labels should be preserved as aliases");
assert.equal(duplicateExtraction.edges.length, 1, "duplicate model relations should collapse");
assert.equal(duplicateExtraction.edges[0].confidence, .8, "duplicate relation confidence should retain the strongest signal");
const ambiguousExtractionEndpoints = normalizeExtraction({
  source: { title: "Ambiguous endpoints", text: "ambiguous endpoint source" },
  nodes: [{ id: "first", label: "Shared concept" }, { id: "second", label: "Shared concept" }],
  edges: [{ source: "Shared concept", target: "first", label: "uses" }]
});
assert.equal(ambiguousExtractionEndpoints.edges.length, 0, "ambiguous extraction labels must not bind relations to an arbitrary concept");
const emptyEndpointExtraction = normalizeExtraction({
  source: { title: "Malformed relation", text: sourceText },
  nodes: [{ id: "attention", label: "Attention" }, { id: "context", label: "Context" }],
  edges: [{ source: "", target: "context", label: "uses" }]
});
assert.equal(emptyEndpointExtraction.edges.length, 0, "empty relation endpoints must not resolve through an empty concept ID alias");
const extracted = extractGraph("Attention notes", sourceText);
assert.equal(extracted.source.title, "Attention notes");
assert.equal(extracted.source.id, extractGraph("Attention notes copy", sourceText).source.id, "heuristic extraction source IDs should be deterministic from content");
assert(extracted.nodes.length >= 3, "the extractor should find multiple concepts");
assert(extracted.edges.length >= 1, "the extractor should find at least one relation");
assert(extracted.nodes.every((node) => node.sources.includes(extracted.source.id)), "nodes should retain source evidence");
const normalizedSource = sourceText.replace(/\n+/g, " ");
assert(extracted.edges.some((edge) => edge.label === "uses"), "explicit relation verbs should be preserved");
assert(extracted.edges.every((edge) => edge.evidence.some((quote) => normalizedSource.includes(quote.text) && quote.sources.includes(extracted.source.id))), "relations should retain source sentence evidence");
const attributedExtraction = extractGraph("Attributed notes", sourceText, { sourceUri: "https://example.org/notes" });
assert.equal(attributedExtraction.source.uri, "https://example.org/notes", "extraction should retain an optional source URI");
assert.equal(normalizeSourceUri("javascript:alert(1)"), null, "unsafe source URI schemes should be rejected");
assert.equal(normalizeSourceUri("https:example.org/notes"), null, "ambiguous HTTP source URIs should be rejected");
assert.equal(normalizeSourceUri("https://user:password@example.org/notes"), null, "HTTP source URIs with embedded credentials should be rejected");
assert.equal(normalizeSourceUri("https://example.org/notes with spaces"), null, "source URIs with embedded whitespace should be rejected");
assert.equal(normalizeSourceUri("file://user:password@localhost/private"), null, "file source URIs with embedded credentials should be rejected");
assert.equal(normalizeSourceUri("file:///tmp/notes.md"), "file:///tmp/notes.md", "credential-free file source URIs should remain supported");
assert.equal(normalizeSourceUri("file:relative/notes.md"), null, "ambiguous file source URIs should be rejected");
assert.equal(normalizeSourceUri("doi:10.1234/example"), "doi:10.1234/example", "safe scholarly URI schemes should be retained");
const adapted = extractGraph("Feedback notes", "The bridge representation organizes signals for review.", {
  feedback: [
    { kind: "concept", id: "latent-bridge", label: "Latent Bridge", status: "accepted", aliases: ["bridge representation"] },
    { kind: "concept", id: "signals", label: "signals", status: "rejected" }
  ]
});
assert(adapted.nodes.some((node) => node.id === "latent-bridge" && node.aliases.includes("bridge representation")), "accepted concept feedback should seed and enrich matching concepts");
assert(!adapted.nodes.some((node) => node.id === "bridge-representation"), "accepted aliases should not create duplicate concept IDs");
assert.equal(MAX_ACTIVE_FEEDBACK_CONCEPTS, 100, "adaptive extraction should bound active concept feedback hints");
assert.equal(MAX_FEEDBACK_EXAMPLES, 500, "extractor feedback should have one shared example-count contract");
assert.equal(MAX_GRAPH_REVISIONS, 20, "graph revisions should have an explicit bounded contract");
assert.equal(MAX_GRAPH_DOCUMENT_CHARS, 50000000, "aggregate graph document text should have an explicit bounded contract");
assert.equal(MAX_ID_CHARS, 200, "graph identity fields should have an explicit bounded contract");
assert.equal(MAX_NODE_MENTIONS, 1000000, "concept mention counts should have an explicit bounded contract");
assert.equal(MAX_FEEDBACK_COUNT, 1000000, "feedback counters should have an explicit bounded contract");
assert.equal(MAX_EXTRACTION_UNITS, 10000, "heuristic extraction units should have an explicit bound");
assert.equal(MAX_WORDS_PER_UNIT, 5000, "heuristic extraction words should have an explicit per-unit bound");
assert.equal(MAX_SEGMENTER_CHARS, 20000, "Unicode segmentation should have an explicit character bound");
assert.doesNotThrow(() => extractGraph("Unicode volume", "注意 ".repeat(150000)), "large Unicode inputs should respect the bounded word path");
const punctuationLight = extractGraph("Punctuation-light Markdown", "# Attention map\n\n- Attention organizes context for useful representations\n- Context carries the evidence through the model");
assert(punctuationLight.nodes.length > 0, "heuristic extraction should handle bullet-heavy documents without sentence punctuation");
const multilingualExtraction = extractGraph("Multilingual notes", "注意 机制 保留 上下文 信息，并且 注意 机制 使用 上下文。");
assert(multilingualExtraction.nodes.some((node) => /[^\x00-\x7F]/.test(node.label)), "local extraction should retain non-Latin concept labels");
assert(multilingualExtraction.edges.some((edge) => /[^\x00-\x7F]/.test(edge.source) || /[^\x00-\x7F]/.test(edge.target)), "local extraction should connect non-Latin concepts when they co-occur");
const multilingualFeedback = extractGraph("Multilingual feedback", "注意 机制 使用 上下文 信息，并且 注意 机制 保留 上下文。", {
  feedback: [{ kind: "concept", id: "reviewed-attention", label: "注意 机制", status: "accepted" }]
});
assert(multilingualFeedback.nodes.some((node) => node.id === "reviewed-attention" && node.confidence > .6), "accepted non-Latin feedback should guide local extraction");
assert(!extractGraph("Numeric text", "12345 67890 12345 67890.").nodes.some((node) => /^\d+$/.test(node.label)), "numeric-only tokens should not become concepts");
const mixedMarkdown = extractGraph("Mixed Markdown", "This introduction explains how a knowledge graph organizes evidence for review.\n\n- Sparse retrieval preserves provenance across evolving representations\n- Human feedback improves confidence and relation quality");
assert(mixedMarkdown.nodes.some((node) => node.evidence.some((evidence) => evidence.text === "Sparse retrieval preserves provenance across evolving representations")), "heuristic extraction should retain useful Markdown bullets alongside punctuated prose");
const separateBullets = extractGraph("Separate bullets", "- Alpha concept preserves evidence for review\n- Beta concept improves representation quality");
const separateBulletIds = new Set(separateBullets.nodes.filter((node) => ["alpha", "beta"].includes(node.id)).map((node) => node.id));
assert(!separateBullets.edges.some((edge) => separateBulletIds.has(edge.source) && separateBulletIds.has(edge.target)), "heuristic extraction should not create relations across separate Markdown bullets");
assert.equal(MAX_RELATION_LABEL_CHARS, 80, "relation labels should have an explicit bounded contract");
assert.equal(MAX_TIMESTAMP_CHARS, 128, "timestamps should have an explicit bounded contract");
const longWorkspaceId = `workspace-${"x".repeat(190)}`;
const longIdExtraction = normalizeExtraction({
  source: { title: "Long IDs", text: "long identity source" },
  nodes: [{ id: longWorkspaceId, label: "Long identity" }]
});
assert.equal(longIdExtraction.nodes[0].id, longWorkspaceId.slice(0, MAX_ID_CHARS), "explicit extraction IDs should preserve the 200-character identity contract");
const longLearningGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: { examples: [{ kind: "concept", id: longWorkspaceId, label: "Long identity", status: "accepted" }] }
});
assert.equal(longLearningGraph.learning.examples[0].id, longWorkspaceId.slice(0, MAX_ID_CHARS), "learning memory should preserve explicit IDs under the graph identity bound");
const recencyBoundedLearning = normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: {
    examples: Array.from({ length: MAX_FEEDBACK_EXAMPLES + 1 }, (_, index) => ({
      kind: "concept",
      id: `recency-${index}`,
      label: `Recency ${index}`,
      status: "accepted"
    }))
  }
});
assert.equal(recencyBoundedLearning.learning.examples.length, MAX_FEEDBACK_EXAMPLES, "normalized learning memory should remain bounded");
assert(!recencyBoundedLearning.learning.examples.some((example) => example.id === "recency-0"), "learning normalization should evict the oldest example");
assert(recencyBoundedLearning.learning.examples.some((example) => example.id === `recency-${MAX_FEEDBACK_EXAMPLES}`), "learning normalization should retain the newest correction");
const timestampedLearningCollision = normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: {
    examples: [
      { kind: "concept", id: "timestamped", label: "Timestamped", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" },
      { kind: "concept", id: "timestamped", label: "Timestamped", status: "rejected", lastReviewedAt: "2025-01-01T00:00:00.000Z" }
    ]
  }
});
assert.equal(timestampedLearningCollision.learning.examples[0].status, "accepted", "learning normalization should preserve the newest reviewed decision");
assert.equal(timestampedLearningCollision.learning.examples[0].lastReviewedAt, "2026-01-01T00:00:00.000Z", "learning normalization should preserve the newest review timestamp");
const boundedHintExtraction = extractGraph("Bounded hints", "Attention uses context to create a useful graph representation for review.", {
  feedback: [
    { kind: "concept", id: "attention", label: "a".repeat(500), status: "accepted" },
    { kind: "relation", source: "attention", target: "context", label: "r".repeat(500), status: "accepted" }
  ]
});
assert(boundedHintExtraction.nodes.every((node) => node.label.length <= 120), "direct extraction feedback concept labels should be bounded");
assert(boundedHintExtraction.edges.every((edge) => edge.label.length <= MAX_RELATION_LABEL_CHARS), "direct extraction feedback relation labels should be bounded");
assert(makeEdgeId("a".repeat(MAX_ID_CHARS), "b".repeat(MAX_ID_CHARS), "supports").length <= MAX_ID_CHARS, "relation ID helper should enforce the identity bound");
assert(!adapted.nodes.some((node) => node.id === "signals"), "rejected concept feedback should suppress matching concepts");
const ambiguousFeedback = extractGraph("Ambiguous feedback", "Shared concept organizes the evidence for review.", {
  feedback: [
    { kind: "concept", id: "concept-one", label: "Concept One", status: "accepted", aliases: ["Shared concept"] },
    { kind: "concept", id: "concept-two", label: "Concept Two", status: "accepted", aliases: ["Shared concept"] }
  ]
});
assert(!ambiguousFeedback.nodes.some((node) => node.id === "concept-one" || node.id === "concept-two"), "ambiguous feedback aliases should not canonicalize to an arbitrary concept");
const boundedFeedbackAliases = new Array(21).fill("alias");
Object.defineProperty(boundedFeedbackAliases, 20, { get() { throw new Error("feedback alias beyond the bound was read"); } });
assert.doesNotThrow(() => extractGraph("Bounded feedback", "The bridge representation organizes signals for review.", {
  feedback: [{ kind: "concept", id: "latent-bridge", label: "Latent Bridge", status: "accepted", aliases: boundedFeedbackAliases }]
}), "feedback aliases should stop reading after their bound");
const boundedProvenance = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "bounded-source", title: "Bounded", text: "text" }],
  nodes: [{
    id: "bounded-node",
    label: "Bounded",
    sources: Array.from({ length: MAX_SOURCE_REFERENCES + 10 }, (_, index) => `source-${index}`),
    evidence: [{
      text: "e".repeat(MAX_EVIDENCE_CHARS + 100),
      sources: Array.from({ length: MAX_SOURCE_REFERENCES + 10 }, (_, index) => `evidence-source-${index}`)
    }]
  }]
});
assert.equal(boundedProvenance.nodes[0].sources.length, MAX_SOURCE_REFERENCES, "node provenance references should be bounded");
assert.equal(boundedProvenance.nodes[0].evidence[0].text.length, MAX_EVIDENCE_CHARS, "evidence text should be bounded");
assert.equal(boundedProvenance.nodes[0].evidence[0].sources.length, MAX_SOURCE_REFERENCES, "evidence provenance references should be bounded");
const boundedInputEvidence = new Array(9).fill({ text: "bounded evidence" });
Object.defineProperty(boundedInputEvidence, 8, { get() { throw new Error("evidence beyond the bound was read"); } });
assert.doesNotThrow(() => normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "bounded", evidence: boundedInputEvidence }]
}), "evidence normalization should stop reading after its bound");
const mergedBoundedProvenance = mergeExtraction(
  normalizeGraph({
    schema: GRAPH_SCHEMA,
    documents: [{ id: "old-source", title: "Old", text: "old" }],
    nodes: [{ id: "shared", label: "Shared", sources: Array.from({ length: 150 }, (_, index) => `old-${index}`) }]
  }),
  normalizeExtraction({
    source: { id: "new-source", title: "New", text: "new" },
    nodes: [{ id: "shared", label: "Shared", sources: Array.from({ length: 150 }, (_, index) => `new-${index}`) }]
  })
);
assert.equal(mergedBoundedProvenance.graph.nodes[0].sources.length, MAX_SOURCE_REFERENCES, "graph merges should preserve the provenance reference bound");
const adaptedRelation = extractGraph("Relation feedback", "Alpha guides Beta through a useful representation for review.", {
  feedback: [
    { kind: "relation", source: "alpha", target: "beta", label: "guides", status: "accepted" }
  ]
});
assert(adaptedRelation.edges.some((edge) => edge.source === "alpha" && edge.target === "beta" && edge.label === "guides"), "accepted relation feedback should guide matching relation labels");
const portableRelation = extractGraph("Portable relation feedback", "Alpha guides Beta through a useful representation for review.", {
  feedback: [
    { kind: "relation", id: "external-edge", source: "workspace-alpha", sourceLabel: "Alpha", target: "workspace-beta", targetLabel: "Beta", label: "guides", status: "accepted" }
  ]
});
assert(portableRelation.edges.some((edge) => edge.source === "alpha" && edge.target === "beta" && edge.label === "guides"), "relation feedback should resolve endpoint labels when stable IDs differ between workspaces");
const aliasedRelation = extractGraph("Aliased relation feedback", "Former Alpha guides Beta through a useful representation for review.", {
  feedback: [
    { kind: "concept", id: "canonical-alpha", label: "Alpha", aliases: ["Former Alpha"], status: "accepted" },
    { kind: "relation", source: "workspace-alpha", sourceLabel: "Former Alpha", target: "workspace-beta", targetLabel: "Beta", label: "guides", status: "accepted" }
  ]
});
assert(aliasedRelation.edges.some((edge) => edge.source === "canonical-alpha" && edge.target === "beta" && edge.label === "guides"), "relation feedback should resolve endpoint aliases from reviewed concept memory");
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
assert.match(acceptedNodeFeedback.graph.nodes.find((node) => node.id === merged.nodes[0].id).lastReviewedAt, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(acceptedNodeFeedback.graph.nodes.find((node) => node.id === merged.nodes[0].id).updatedAt, acceptedNodeFeedback.graph.nodes.find((node) => node.id === merged.nodes[0].id).lastReviewedAt, "concept feedback should advance the item update timestamp with its review");
const dismissedEdgeFeedback = applyFeedback(merged, "edge", merged.edges[0].id, "down");
assert.equal(dismissedEdgeFeedback.graph.edges.find((edge) => edge.id === merged.edges[0].id).status, "rejected");
assert.equal(dismissedEdgeFeedback.graph.edges.find((edge) => edge.id === merged.edges[0].id).feedback, -1);
assert.match(dismissedEdgeFeedback.graph.edges.find((edge) => edge.id === merged.edges[0].id).lastReviewedAt, /^\d{4}-\d{2}-\d{2}T/);
assert(dismissedEdgeFeedback.graph.learning.examples.some((example) => example.kind === "relation" && example.status === "rejected"), "direct relation feedback should become reusable learning memory");
assert.match(dismissedEdgeFeedback.graph.learning.examples.find((example) => example.kind === "relation").lastReviewedAt, /^\d{4}-\d{2}-\d{2}T/);
const renamedRelationMemory = applyFeedback({ ...dismissedEdgeFeedback.graph, edges: dismissedEdgeFeedback.graph.edges.map((edge) => ({ ...edge, label: "supports" })) }, "edge", dismissedEdgeFeedback.graph.edges[0].id, "up");
assert(!renamedRelationMemory.graph.learning.examples.some((example) => example.kind === "relation" && example.label === dismissedEdgeFeedback.graph.edges[0].label), "relation corrections should replace stale relation learning memory");
const relationMemoryTarget = normalizeGraph({
  ...renamedRelationMemory.graph,
  edges: renamedRelationMemory.graph.edges.map((edge) => ({ ...edge, label: "enables" })),
  learning: { examples: [{ kind: "relation", id: renamedRelationMemory.graph.edges[0].id, source: renamedRelationMemory.graph.edges[0].source, target: renamedRelationMemory.graph.edges[0].target, label: "supports", status: "accepted" }] }
});
const importedRelationCorrection = applyFeedbackDataset(relationMemoryTarget, [{
  kind: "relation",
  id: relationMemoryTarget.edges[0].id,
  source: relationMemoryTarget.edges[0].source,
  target: relationMemoryTarget.edges[0].target,
  label: "enables",
  status: "accepted"
}]);
assert(!importedRelationCorrection.graph.learning.examples.some((example) => example.kind === "relation" && example.id === relationMemoryTarget.edges[0].id && example.label === "supports"), "feedback imports should remove stale relation labels by stable ID");
const restoredNodeFeedback = applyFeedback(acceptedNodeFeedback.graph, "node", merged.nodes[0].id, "restore");
assert(!restoredNodeFeedback.graph.learning.examples.some((example) => example.kind === "concept" && example.id === merged.nodes[0].id), "restoring feedback should remove neutralized learning guidance");
const mergeableConcepts = normalizeGraph({
  schema: GRAPH_SCHEMA,
  version: 0,
  documents: [{ id: "merge-source", title: "Merge source", text: "merge source", fingerprint: "merge-source-1" }],
  nodes: [
    { id: "legacy-concept", label: "Legacy Attention", status: "accepted", mentions: 2, sources: ["merge-source"], evidence: [{ text: "legacy evidence", sources: ["merge-source"] }] },
    { id: "canonical-concept", label: "Attention", status: "inferred", mentions: 1, sources: ["merge-source"], evidence: [{ text: "canonical evidence", sources: ["merge-source"] }] },
    { id: "context", label: "Context", status: "inferred", mentions: 1, sources: ["merge-source"], evidence: [] }
  ],
  edges: [
    { id: "legacy-relation", source: "legacy-concept", target: "context", label: "uses", sources: ["merge-source"], evidence: [{ text: "legacy relation", sources: ["merge-source"] }], lastReviewedAt: "2025-01-01T00:00:00.000Z" },
    { id: "canonical-relation", source: "canonical-concept", target: "context", label: "uses", sources: ["merge-source"], evidence: [{ text: "canonical relation", sources: ["merge-source"] }], lastReviewedAt: "2026-01-01T00:00:00.000Z" }
  ],
  learning: {
    examples: [
      { kind: "concept", id: "legacy-concept", label: "Legacy Attention", status: "accepted" },
      { kind: "concept", id: "canonical-concept", label: "Attention", status: "accepted" },
      { kind: "relation", id: "legacy-relation", source: "legacy-concept", sourceLabel: "Legacy Attention", target: "context", targetLabel: "Context", label: "uses", status: "accepted", lastReviewedAt: "2025-01-01T00:00:00.000Z" },
      { kind: "relation", id: "canonical-relation", source: "canonical-concept", sourceLabel: "Attention", target: "context", targetLabel: "Context", label: "uses", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" }
    ]
  }
});
const mergedConcepts = mergeConcepts(mergeableConcepts, "legacy-concept", "canonical-concept");
assert.equal(mergedConcepts.changed, true, "concept merges should produce a graph revision");
assert(!mergedConcepts.graph.nodes.some((node) => node.id === "legacy-concept"), "merged concept should be removed");
const canonicalConcept = mergedConcepts.graph.nodes.find((node) => node.id === "canonical-concept");
assert.equal(canonicalConcept.mentions, 3, "concept merges should preserve mention counts");
assert(canonicalConcept.aliases.includes("Legacy Attention"), "concept merges should preserve the old label as an alias");
assert.equal(mergedConcepts.graph.edges.filter((edge) => edge.source === "canonical-concept" && edge.target === "context").length, 1, "parallel relations should collapse after a concept merge");
assert(mergedConcepts.graph.edges[0].evidence.length >= 2, "relation merges should preserve evidence from both concepts");
assert.equal(mergedConcepts.graph.edges[0].lastReviewedAt, "2026-01-01T00:00:00.000Z", "relation merges should preserve the newest review timestamp");
assert(mergedConcepts.graph.learning.examples.every((example) => example.id !== "legacy-concept"), "concept merges should remove stale learning identity");
const remappedRelationMemory = mergedConcepts.graph.learning.examples.find((example) => example.kind === "relation" && example.label === "uses");
assert(remappedRelationMemory, "concept merges should preserve relation learning memory");
assert.equal(remappedRelationMemory.source, "canonical-concept", "relation learning memory should follow merged concept identities");
assert.equal(remappedRelationMemory.id, mergedConcepts.graph.edges[0].id, "relation learning memory should follow the canonical merged edge ID");
assert.equal(remappedRelationMemory.lastReviewedAt, "2026-01-01T00:00:00.000Z", "relation learning merges should preserve the newest review timestamp");
assert(mergedConcepts.graph.revisions[0].reason.includes("Merged concept"), "concept merges should be recorded in revision history");
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
assert.equal(health.sourceReviewCoverage, 0);
assert.equal(health.freshSourceReviewCoverage, 0);
assert.equal(health.staleLearningExamples, 0);
assert(health.reviewCandidates > 0, "graph health should expose actionable review candidates");
assert.equal(health.sourceQuality.unknown, 1);
assert.equal(health.unsupportedNodes, 0);
assert.equal(health.reviewedItems, 0);
const reviewedHealth = inspectGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0 ? { ...node, status: "accepted" } : node),
  edges: merged.edges.map((edge, index) => index === 0 ? { ...edge, status: "rejected", feedback: -1 } : edge)
});
assert.equal(reviewedHealth.reviewedItems, 2, "graph health should count reusable human feedback decisions");
assert.equal(reviewedHealth.acceptedItems, 1, "graph health should count accepted learning decisions");
assert.equal(reviewedHealth.rejectedItems, 1, "graph health should count rejected learning decisions");
const queue = reviewQueue(merged, 2);
assert.equal(queue.length, 2);
assert(queue.some((candidate) => candidate.kind === "source"), "review queue should include unreviewed source metadata");
assert(queue.every((candidate) => Number.isFinite(candidate.priority) && candidate.reason), "review queue should expose bounded explainable priorities");
assert(queue[0].priority >= queue[1].priority, "review queue should prioritize the highest-risk review items");
assert(queue.find((candidate) => candidate.kind === "source")?.reason.includes("source quality unknown"), "source review candidates should explain unknown quality");
assert.equal(REVIEW_STALE_DAYS, 180, "stale review threshold should remain explicit");
const staleReviewedGraph = normalizeGraph({
  ...merged,
  documents: merged.documents.map((document) => ({ ...document, lastReviewedAt: new Date().toISOString() })),
  nodes: merged.nodes.map((node, index) => index === 0
    ? { ...node, status: "accepted", lastReviewedAt: "2020-01-01T00:00:00.000Z" }
    : node),
  edges: merged.edges.map((edge) => ({ ...edge, lastReviewedAt: new Date().toISOString() }))
});
const staleCandidate = reviewQueue(staleReviewedGraph, 15000).find((candidate) => candidate.kind === "node" && candidate.id === merged.nodes[0].id);
assert(staleCandidate?.reason.includes("review stale"), "review queue should revisit decisions that have gone stale");
assert.equal(inspectGraph(staleReviewedGraph).staleReviewCandidates, 1, "graph health should count stale review candidates");
assert.equal(inspectGraph(staleReviewedGraph).freshSourceReviewCoverage, 100, "graph health should distinguish fresh source reviews");
const staleLearningHealth = inspectGraph(normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: {
    examples: [{ kind: "concept", id: "old-memory", label: "Old memory", status: "accepted", lastReviewedAt: "2020-01-01T00:00:00.000Z" }]
  }
}));
assert.equal(staleLearningHealth.staleLearningExamples, 1, "graph health should expose stale reusable learning examples");
const staleLearningCleanup = clearStaleLearningMemory(normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: {
    examples: [
      { kind: "concept", id: "old-memory", label: "Old memory", status: "accepted", lastReviewedAt: "2020-01-01T00:00:00.000Z" },
      { kind: "concept", id: "fresh-memory", label: "Fresh memory", status: "accepted", lastReviewedAt: new Date().toISOString() }
    ]
  }
}));
assert.equal(staleLearningCleanup.removed, 1, "stale learning cleanup should remove only stale examples");
assert.equal(staleLearningCleanup.graph.learning.examples[0].id, "fresh-memory", "stale learning cleanup should preserve fresh examples");
const staleSourceGraph = normalizeGraph({
  ...staleReviewedGraph,
  documents: staleReviewedGraph.documents.map((document) => ({ ...document, quality: "primary", lastReviewedAt: "2020-01-01T00:00:00.000Z" }))
});
assert(reviewQueue(staleSourceGraph, 15000).find((candidate) => candidate.kind === "source")?.reason.includes("review stale"), "review queue should revisit stale source metadata");
const freshReviewedGraph = normalizeGraph({
  ...staleReviewedGraph,
  nodes: staleReviewedGraph.nodes.map((node, index) => index === 0 ? { ...node, lastReviewedAt: new Date().toISOString() } : node)
});
assert(!reviewQueue(freshReviewedGraph, 15000).some((candidate) => candidate.kind === "node" && candidate.id === merged.nodes[0].id), "freshly reviewed decisions should leave the stale queue");
assert.equal(inspectGraph(freshReviewedGraph).staleReviewCandidates, 0, "graph health should clear stale candidates after review");
const unsupportedQueue = reviewQueue({
  ...merged,
  nodes: merged.nodes.map((node) => ({ ...node, sources: [], evidence: [] }))
}, 1);
assert.equal(unsupportedQueue[0].reason, "low confidence · no evidence · unresolved provenance", "review queue should explain unsupported evidence gaps");
const brokenProvenance = inspectGraph({
  ...merged,
  nodes: merged.nodes.map((node) => ({ ...node, sources: ["missing-document"], evidence: [{ text: "broken", sources: ["missing-document"] }] })),
  edges: merged.edges.map((edge) => ({ ...edge, sources: ["missing-document"], evidence: [{ text: "broken", sources: ["missing-document"] }] }))
});
assert.equal(brokenProvenance.provenanceCoverage, 0, "provenance coverage should resolve source IDs");
assert(brokenProvenance.orphanedSourceReferences > 0, "broken source references should be visible in graph health");
const evidenceFreeProvenance = inspectGraph({
  ...merged,
  nodes: merged.nodes.map((node) => ({ ...node, sources: [], evidence: [] })),
  edges: merged.edges.map((edge) => ({ ...edge, sources: [], evidence: [] }))
});
assert.equal(evidenceFreeProvenance.provenanceCoverage, 0, "provenance coverage should include unsupported graph items even when they have no evidence records");
const removedSource = removeSource(merged, extracted.source.id);
assert.equal(removedSource.removed, true);
assert.equal(removedSource.graph.documents.length, 0);
assert.equal(removedSource.graph.nodes.length, 0, "unsupported inferred concepts should be pruned");
assert.equal(removedSource.graph.edges.length, 0, "unsupported inferred relations should be pruned");
const removedFeedbackSource = removeSource(dismissedEdgeFeedback.graph, dismissedEdgeFeedback.graph.documents[0].id);
assert(!removedFeedbackSource.graph.learning.examples.some((example) => example.kind === "relation"), "source removal should not retain feedback for pruned relations");
const acceptedKnowledge = normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => ({ ...node, status: "accepted", ...(index === 0 ? { lastReviewedAt: "2025-01-01T00:00:00.000Z" } : {}) })),
  edges: merged.edges.map((edge, index) => index === 0 ? { ...edge, status: "accepted", lastReviewedAt: "2025-01-01T00:00:00.000Z" } : edge),
  learning: {
    examples: [
      { kind: "concept", id: merged.nodes[0].id, label: merged.nodes[0].label, status: "accepted", lastReviewedAt: "2025-01-01T00:00:00.000Z" },
      { kind: "relation", id: merged.edges[0].id, source: merged.edges[0].source, sourceLabel: merged.nodes[0].label, target: merged.edges[0].target, targetLabel: merged.nodes[1].label, label: merged.edges[0].label, status: "accepted", lastReviewedAt: "2025-01-01T00:00:00.000Z" }
    ]
  }
});
const acceptedAfterRemoval = removeSource(acceptedKnowledge, extracted.source.id);
assert(acceptedAfterRemoval.graph.nodes.some((node) => node.status === "accepted"), "accepted manual knowledge should survive source removal");
assert.equal(acceptedAfterRemoval.graph.nodes.find((node) => node.id === merged.nodes[0].id).lastReviewedAt, null, "source removal should invalidate review dates for affected concepts");
assert.equal(acceptedAfterRemoval.graph.edges.find((edge) => edge.id === merged.edges[0].id).lastReviewedAt, null, "source removal should invalidate review dates for affected relations");
assert(acceptedAfterRemoval.graph.learning.examples.every((example) => example.lastReviewedAt === null), "source removal should invalidate affected reusable learning review dates");
const replacementGraph = normalizeGraph({
  ...merged,
  documents: merged.documents.map((document) => ({ ...document, quality: "primary", lastReviewedAt: "2024-01-01T00:00:00.000Z" })),
  nodes: [
    ...merged.nodes.map((node, index) => index === 0 ? { ...node, status: "accepted" } : node),
    { id: "stale-only", label: "Stale only", aliases: [], type: "concept", confidence: .6, mentions: 1, feedback: 0, status: "inferred", sources: [extracted.source.id], evidence: [{ text: "stale", sources: [extracted.source.id] }] }
  ]
});
const replacement = replaceSource(replacementGraph, extracted.source.id, {
  source: { id: "doc-replacement", title: "Replacement", text: "replacement text with enough context to extract a new representation", fingerprint: "replacement-1", addedAt: new Date().toISOString() },
  nodes: [{ id: "replacement-node", label: "Replacement node", sources: ["doc-replacement"], evidence: [{ text: "replacement evidence", sources: ["doc-replacement"] }] }],
  edges: []
});
assert.equal(replacement.replaced, true, "source replacement should produce a new graph");
assert.equal(replacement.graph.documents.filter((document) => document.id === extracted.source.id).length, 1, "source replacement should retain the original source identity");
assert(!replacement.graph.documents.some((document) => document.id === "doc-replacement"), "source replacement should not invent a new provenance identity");
assert(!replacement.graph.nodes.some((node) => node.id === "stale-only"), "source replacement should prune unsupported inferred knowledge");
assert(replacement.graph.nodes.some((node) => node.id === merged.nodes[0].id && node.status === "accepted"), "source replacement should preserve accepted knowledge");
assert(replacement.graph.nodes.find((node) => node.id === merged.nodes[0].id)?.sources.includes(extracted.source.id), "source replacement should preserve accepted concept provenance on the retained source identity");
assert(replacement.graph.nodes.some((node) => node.id === "replacement-node"), "source replacement should merge the new extraction");
assert.equal(replacement.graph.version, replacementGraph.version + 1, "source replacement should record one atomic graph revision");
assert.match(replacement.graph.revisions[0].reason, /^Replaced /, "source replacement should be explicit in revision history");
assert.equal(replacement.graph.documents.find((document) => document.id === extracted.source.id).quality, "primary", "source replacement should preserve source quality");
assert.equal(replacement.graph.documents.find((document) => document.id === extracted.source.id).lastReviewedAt, null, "source replacement should clear the old review date");
const replacementWithDuplicate = mergeExtraction(replacement.graph, {
  source: { id: "another-source", title: "Another", text: "another source contains enough distinct text to be represented separately", fingerprint: "another-source-1", addedAt: new Date().toISOString() },
  nodes: [],
  edges: []
}).graph;
const duplicateReplacement = replaceSource(replacementWithDuplicate, extracted.source.id, {
  source: { id: "replacement-again", title: "Another copy", text: "another source contains enough distinct text to be represented separately", fingerprint: "another-source-1", addedAt: new Date().toISOString() },
  nodes: [],
  edges: []
});
assert.equal(duplicateReplacement.duplicate, true, "source replacement should refuse content already represented by another source");
const graphDiff = diffGraphs(defaultGraph(), merged);
assert.equal(graphDiff.format, DIFF_FORMAT, "graph diffs should use a versioned contract");
assert.equal(graphDiff.fromVersion, 0, "graph diffs should retain the source revision");
assert.equal(graphDiff.toVersion, merged.version, "graph diffs should retain the target revision");
assert(graphDiff.documents.added.some((document) => document.id === extracted.source.id), "graph diffs should report added source documents");
assert(graphDiff.nodes.added.length > 0 && graphDiff.edges.added.length > 0, "graph diffs should report added concepts and relations");
const changedGraphDiff = diffGraphs(merged, applyFeedback(merged, "node", merged.nodes[0].id, "up").graph);
assert(changedGraphDiff.nodes.changed.some((change) => change.id === merged.nodes[0].id), "graph diffs should report reviewed concept changes");
assert.match(changedGraphDiff.nodes.changed.find((change) => change.id === merged.nodes[0].id).after.lastReviewedAt, /^\d{4}-\d{2}-\d{2}T/, "graph diffs should report review freshness");
const diffLearningGraph = applyFeedbackDataset(defaultGraph(), [
  { kind: "concept", id: "future-guidance", label: "Future guidance", status: "accepted" }
]).graph;
const learningOnlyDiff = diffGraphs(defaultGraph(), diffLearningGraph);
assert(learningOnlyDiff.learning.added.some((example) => example.identity === "future-guidance"), "graph diffs should report learning-only changes");
assert.equal(learningOnlyDiff.changed, true, "learning-only changes should not export as unchanged");
const redactionFixture = normalizeGraph({
  ...merged,
  documents: merged.documents.map((document) => ({ ...document, uri: "https://private.example/source", text: "private source text" })),
  nodes: merged.nodes.map((node) => ({ ...node, evidence: [{ text: "private evidence", sources: node.sources }] })),
  edges: merged.edges.map((edge) => ({ ...edge, evidence: [{ text: "private relation evidence", sources: edge.sources }] }))
});
const redactedGraph = redactGraph(redactionFixture);
assert.equal(redactedGraph.redacted, true, "redacted graph exports should carry an explicit privacy marker");
assert.equal(normalizeGraph(redactedGraph).redacted, true, "redaction markers should survive graph normalization");
assert.equal(inspectGraph(redactedGraph).redacted, true, "graph health should expose redacted state");
assert(redactedGraph.documents.every((document) => document.text === "" && document.uri === null), "redacted graph exports should remove source text and URIs");
assert(redactedGraph.nodes.concat(redactedGraph.edges).every((item) => item.evidence.every((evidence) => evidence.text === "[redacted]")), "redacted graph exports should remove evidence quotes");
assert(redactedGraph.learning.examples.every((example) => !example.evidence || example.evidence.every((evidence) => evidence.text === "[redacted]")), "redacted graph exports should remove reusable-learning evidence quotes");
const lyingRedactedGraph = normalizeGraph({
  ...redactionFixture,
  redacted: true,
  documents: redactionFixture.documents.map((document) => ({ ...document, text: "secret source text", uri: "https://private.example/source" })),
  nodes: redactionFixture.nodes.map((node) => ({ ...node, evidence: [{ text: "secret concept evidence", sources: node.sources }] })),
  learning: { examples: [{ kind: "concept", id: redactionFixture.nodes[0].id, label: redactionFixture.nodes[0].label, status: "accepted", evidence: [{ text: "secret learning evidence", sources: redactionFixture.nodes[0].sources }] }] }
});
assert(lyingRedactedGraph.documents.every((document) => document.text === "" && document.uri === null), "redacted markers should enforce document scrubbing during normalization");
assert(lyingRedactedGraph.nodes.every((node) => node.evidence.every((evidence) => evidence.text === "[redacted]")), "redacted markers should enforce node evidence scrubbing during normalization");
assert(!JSON.stringify(lyingRedactedGraph).includes("secret"), "redacted markers should enforce learning evidence scrubbing during normalization");
assert.equal(redactedGraph.nodes.length, merged.nodes.length, "redacted graph exports should preserve concepts");
assert.equal(redactedGraph.edges.length, merged.edges.length, "redacted graph exports should preserve relations");
const redactionDiff = diffGraphs(merged, redactedGraph);
assert.equal(redactionDiff.redaction.before, false, "graph diffs should report the source graph privacy state");
assert.equal(redactionDiff.redaction.after, true, "graph diffs should report the target graph privacy state");
assert.equal(redactionDiff.redaction.changed, true, "graph diffs should report privacy-state changes");
const enrichedRedactedGraph = mergeExtraction(redactedGraph, {
  source: { title: "New unredacted source", text: "This newly ingested source contains enough context to create a graph.", uri: "https://example.org/new-source" },
  nodes: [{ id: "new-source-concept", label: "New source concept", sources: [], evidence: [] }],
  edges: []
});
assert.equal(enrichedRedactedGraph.graph.redacted, undefined, "unredacted ingestion should clear stale redaction markers");
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
assert.equal(graphStore.getLastWriteMode(), "normal", "successful undo should report a normal write mode");
assert.equal(graphStore.read().version, 0);
assert.equal(graphStore.restore(merged, [defaultGraph()]), true);
assert.equal(graphStore.read().version, merged.version);
assert.equal(graphStore.readHistory().length, 1);
assert.equal(graphStore.undo(), true);
assert.equal(graphStore.read().version, 0);
assert.equal(graphStore.write(merged), true);
assert.equal(graphStore.restore(defaultGraph(), [], { preserveCurrent: true }), true, "backup restore should preserve the current graph as an undo snapshot");
assert.equal(graphStore.read().version, 0);
assert.equal(graphStore.readHistory().at(-1).version, merged.version, "preserved backup undo snapshot should contain the pre-restore graph");
assert.equal(graphStore.undo(), true);
assert.equal(graphStore.read().version, merged.version, "undo should recover the graph replaced by a backup restore");
storage.set("graph", JSON.stringify({ ...merged, version: merged.version + 1 }));
assert.equal(graphStore.undo({ expectedVersion: merged.version }), false, "stale undo operations should fail safely");
assert.equal(graphStore.getLastWriteMode(), "conflict");
assert.equal(graphStore.clear({ expectedVersion: merged.version }), false, "stale clear operations should fail safely");
assert.equal(graphStore.getLastWriteMode(), "conflict");
assert.equal(graphStore.undo({ expectedVersion: merged.version + 1 }), false, "undo without history should remain a no-op");
assert.equal(graphStore.getLastWriteMode(), "none", "a no-op undo should clear a stale conflict status");
assert.equal(graphStore.write(defaultGraph(), { expectedVersion: 0 }), false, "stale batch writes should fail safely");
assert.equal(graphStore.getLastWriteMode(), "conflict");
assert.equal(graphStore.read().version, merged.version + 1, "conflicting writes must preserve the newer graph");
assert.equal(graphStore.restore(defaultGraph(), [], { expectedVersion: 0 }), false, "stale backup restores should fail safely");
assert.equal(graphStore.getLastWriteMode(), "conflict");
const sameVersionGraphA = normalizeGraph({
  schema: GRAPH_SCHEMA,
  version: 4,
  nodes: [{ id: "same-version-a", label: "Graph A" }]
});
const sameVersionGraphB = normalizeGraph({
  schema: GRAPH_SCHEMA,
  version: 4,
  nodes: [{ id: "same-version-b", label: "Graph B" }]
});
storage.set("graph", JSON.stringify(sameVersionGraphB));
assert.equal(
  graphStore.write(sameVersionGraphA, {
    expectedVersion: sameVersionGraphA.version,
    expectedFingerprint: fingerprintBackup(sameVersionGraphA)
  }),
  false,
  "same-version divergent graphs should fail the fingerprint precondition"
);
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
const repairableGraph = JSON.stringify({
  schema: GRAPH_SCHEMA,
  version: "not-a-safe-integer",
  nodes: [{ id: "repairable", label: "Repairable", confidence: 2 }]
});
storage.set("graph", repairableGraph);
assert.equal(graphStore.read().version, 0, "recognized malformed graphs should be normalized safely");
assert.equal(graphStore.read().nodes[0].confidence, 0.99, "recognized malformed graph fields should be repaired");
assert.equal(graphStore.readRecovery(), repairableGraph, "recognized malformed graphs should remain recoverable before repair");
graphStore.clearRecovery();
const oversizedPersistedStore = createGraphStore(localStorage, {
  graphKey: "oversized-graph",
  historyKey: "oversized-history",
  recoveryKey: "oversized-recovery",
  maxPersistedJsonChars: 32
});
const oversizedPersistedRaw = JSON.stringify({ schema: GRAPH_SCHEMA, nodes: [{ id: "oversized", label: "x".repeat(200) }] });
storage.set("oversized-graph", oversizedPersistedRaw);
assert.equal(oversizedPersistedStore.read().nodes.length, 0, "oversized persisted graphs should fail closed before parsing");
assert.equal(oversizedPersistedStore.readRecovery(), oversizedPersistedRaw, "oversized persisted graphs should remain recoverable");
storage.set("oversized-history", `[${"x".repeat(100)}]`);
assert.equal(oversizedPersistedStore.readHistory().length, 0, "oversized persisted history should be ignored before parsing");
assert.equal(oversizedPersistedStore.readHistoryRecovery(), `[${"x".repeat(100)}]`, "oversized persisted history should remain recoverable");
oversizedPersistedStore.clearHistoryRecovery();
assert.equal(oversizedPersistedStore.write({ schema: GRAPH_SCHEMA, nodes: [{ id: "too-large", label: "x".repeat(200) }] }), false, "oversized graph writes should fail before storage mutation");
assert.equal(storage.get("oversized-graph"), oversizedPersistedRaw, "failed oversized writes should preserve prior persisted state");
const clearSafetyStorage = new Map([
  ["clear-safety-graph", JSON.stringify(normalizeGraph({ schema: GRAPH_SCHEMA, learning: { examples: [{ kind: "concept", id: "a", label: "a", status: "accepted" }] } }))],
  ["clear-safety-history", JSON.stringify([defaultGraph()])]
]);
const clearSafetyStore = createGraphStore({
  getItem: (key) => clearSafetyStorage.has(key) ? clearSafetyStorage.get(key) : null,
  setItem: (key, value) => clearSafetyStorage.set(key, String(value)),
  removeItem: (key) => clearSafetyStorage.delete(key)
}, {
  graphKey: "clear-safety-graph",
  historyKey: "clear-safety-history",
  maxPersistedJsonChars: 300
});
assert.equal(clearSafetyStore.clear(), true, "clear should retain its safe fallback when history preflight fails");
assert.equal(clearSafetyStore.getLastWriteMode(), "without-history", "clear should report reduced history after an oversized preflight");
assert.equal(clearSafetyStorage.has("clear-safety-graph"), false, "clear should still remove the graph after oversized history preflight");
assert.equal(clearSafetyStorage.has("clear-safety-history"), false, "clear should discard only history when its preflight cannot fit");
storage.set("graph", JSON.stringify({ schema: "llm-field-notes/graph@999", nodes: [{ id: "lost", label: "Recover me" }] }));
assert.equal(graphStore.read().nodes.length, 0, "unsupported schema should fail closed");
assert(storage.get("recovery")?.includes("graph@999"), "unsupported schema should be preserved for recovery");
graphStore.clearRecovery();
storage.delete("graph");
storage.set("history", JSON.stringify(Array.from({ length: 100 }, () => defaultGraph())));
assert.equal(graphStore.readHistory().length, 3, "history should be bounded before normalization");
storage.set("history", JSON.stringify([defaultGraph(), { schema: "not-a-graph", nodes: [{ id: "fake" }] }, null]));
assert.equal(graphStore.readHistory().length, 1, "malformed history snapshots should be discarded instead of becoming empty graphs");
assert(graphStore.readHistoryRecovery()?.includes("not-a-graph"), "malformed history should be preserved for recovery");
assert.equal(graphStore.clearHistoryRecovery(), true);
assert.equal(graphStore.readHistoryRecovery(), null);
storage.set("history", JSON.stringify([{ schema: "not-a-graph" }, defaultGraph(), defaultGraph(), defaultGraph()]));
assert.equal(graphStore.readHistory().length, 3, "invalid history entries should not consume the valid history capacity");
storage.delete("history");
const noHistoryStore = createGraphStore(localStorage, { graphKey: "no-history-graph", historyKey: "no-history", historyLimit: 0 });
assert.equal(noHistoryStore.write(merged), true);
assert.equal(noHistoryStore.readHistory().length, 0, "zero history capacity should retain no snapshots");
const invalidHistoryStore = createGraphStore(localStorage, { graphKey: "invalid-history-graph", historyKey: "invalid-history", historyLimit: "not-a-number" });
assert.equal(invalidHistoryStore.write(merged), true);
assert.equal(invalidHistoryStore.readHistory().length, 1, "invalid history capacity should use a bounded default");
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

const learningOnlyStore = createGraphStore(localStorage, {
  graphKey: "learning-only-graph",
  historyKey: "learning-only-history",
  recoveryKey: "learning-only-recovery"
});
const learningOnlyGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: {
    examples: [{ kind: "concept", id: "attention", label: "Attention", status: "accepted" }]
  }
});
assert.equal(learningOnlyStore.write(learningOnlyGraph), true);
assert.equal(learningOnlyStore.clear(), true, "clearing learning-only state should remain undoable");
assert.equal(learningOnlyStore.read().learning.examples.length, 0);
assert.equal(learningOnlyStore.undo(), true, "learning-only state should be recoverable through undo");
assert.equal(learningOnlyStore.read().learning.examples.length, 1, "undo should restore reusable learning memory");

const duplicateResult = mergeExtraction(merged, extractGraph("Same notes", sourceText));
assert.equal(duplicateResult.duplicate, true, "the same document should not create a second source");
assert.equal(duplicateResult.graph.documents.length, 1);
const lineEndingGraph = mergeExtraction(defaultGraph(), extractGraph("Line endings", "Alpha uses context.\nBeta supports learning."));
const lineEndingDuplicate = mergeExtraction(lineEndingGraph.graph, extractGraph("Line endings copy", "Alpha uses context.\r\nBeta supports learning.  "));
assert.equal(lineEndingDuplicate.duplicate, true, "equivalent line endings and trailing whitespace should not duplicate a source");
const cappedGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: Array.from({ length: 1000 }, (_, index) => ({ id: `doc-${index}`, title: `Document ${index}`, text: "source", fingerprint: `fingerprint-${index}` })),
  nodes: [{ id: "known", label: "Known" }]
});
const cappedIngest = mergeExtraction(cappedGraph, {
  source: { id: "new-doc", title: "New document", text: "new source", fingerprint: "new-source" },
  nodes: [{ id: "new-node", label: "New node" }],
  edges: []
});
assert.equal(cappedIngest.limited, "documents", "document caps should refuse new sources explicitly");
const textCappedGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: Array.from({ length: 167 }, (_, index) => ({
    id: `text-doc-${index}`,
    title: `Text document ${index}`,
    text: "x".repeat(300000),
    fingerprint: `text-fingerprint-${index}`
  }))
});
const textCappedIngest = mergeExtraction(textCappedGraph, {
  source: { id: "text-limit-source", title: "Text limit", text: "new source", fingerprint: "text-limit-source" },
  nodes: [],
  edges: []
});
assert.equal(textCappedIngest.limited, "document-text", "aggregate document text caps should refuse oversized graph growth");
const nodeCappedGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: Array.from({ length: 5000 }, (_, index) => ({ id: `node-${index}`, label: `Node ${index}` }))
});
const nodeCappedIngest = mergeExtraction(nodeCappedGraph, {
  source: { id: "new-doc", title: "New document", text: "new source", fingerprint: "new-source" },
  nodes: [
    { id: "node-0", label: "Node 0", mentions: 2, sources: ["new-source"], evidence: [{ text: "new source", sources: ["new-source"] }] },
    { id: "new-node", label: "New node" }
  ],
  edges: []
});
assert.equal(nodeCappedIngest.limited, "nodes", "node caps should refuse new concepts explicitly");
assert.equal(nodeCappedIngest.graph.documents.length, nodeCappedGraph.documents.length, "a limited merge should not append its source");
assert.equal(nodeCappedIngest.graph.nodes.find((node) => node.id === "node-0").mentions, nodeCappedGraph.nodes.find((node) => node.id === "node-0").mentions, "a limited merge should not mutate existing concept mentions");
assert.equal(nodeCappedIngest.graph.nodes.find((node) => node.id === "node-0").sources.length, nodeCappedGraph.nodes.find((node) => node.id === "node-0").sources.length, "a limited merge should not mutate existing provenance");
const edgeCappedGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "edge-source", label: "Edge source" }, { id: "edge-target", label: "Edge target" }],
  edges: Array.from({ length: 10000 }, (_, index) => ({
    id: `edge-${index}`,
    source: "edge-source",
    target: "edge-target",
    label: `relation-${index}`,
    confidence: .4,
    evidence: [],
    sources: []
  }))
});
const edgeCappedIngest = mergeExtraction(edgeCappedGraph, {
  source: { id: "edge-limit-source", title: "Edge limit", text: "edge limit source", fingerprint: "edge-limit-source" },
  nodes: [{ id: "edge-source", label: "Edge source" }, { id: "edge-target", label: "Edge target" }],
  edges: [
    { source: "edge-source", target: "edge-target", label: "relation-0", confidence: .9, evidence: [], sources: ["edge-limit-source"] },
    { source: "edge-source", target: "edge-target", label: "new relation", confidence: .9, evidence: [], sources: ["edge-limit-source"] }
  ]
});
assert.equal(edgeCappedIngest.limited, "edges", "edge caps should refuse new relations explicitly");
assert.equal(edgeCappedIngest.graph.documents.length, edgeCappedGraph.documents.length, "an edge-limited merge should not append its source");
assert.equal(edgeCappedIngest.graph.edges.find((edge) => edge.label === "relation-0").confidence, edgeCappedGraph.edges.find((edge) => edge.label === "relation-0").confidence, "an edge-limited merge should not mutate existing relation confidence");
const sourceCollisionFirst = mergeExtraction(defaultGraph(), {
  source: { id: "provider-source", title: "First source", text: "First source content for the graph.", fingerprint: "first" },
  nodes: [{ id: "first", label: "First", sources: ["provider-source"], evidence: [{ text: "First source content for the graph.", sources: ["provider-source"] }] }],
  edges: []
});
const sourceCollisionSecond = mergeExtraction(sourceCollisionFirst.graph, {
  source: { id: "provider-source", title: "Second source", text: "Second source content for the graph.", fingerprint: "second" },
  nodes: [{ id: "second", label: "Second", sources: ["provider-source"], evidence: [{ text: "Second source content for the graph.", sources: ["provider-source"] }] }],
  edges: []
});
assert.equal(sourceCollisionSecond.graph.documents.length, 2, "conflicting provider source IDs should not collapse distinct documents");
assert.notEqual(sourceCollisionSecond.graph.documents[0].id, sourceCollisionSecond.graph.documents[1].id, "source collision repair should create a distinct source ID");
assert.equal(sourceCollisionSecond.graph.nodes.find((node) => node.id === "second").sources[0], sourceCollisionSecond.graph.documents[1].id, "repaired source IDs should propagate to node provenance");
assert.equal(sourceCollisionSecond.graph.nodes.find((node) => node.id === "second").evidence[0].sources[0], sourceCollisionSecond.graph.documents[1].id, "repaired source IDs should propagate to evidence provenance");
const importedSourceCollision = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [
    { id: "duplicate-source", title: "Imported first", text: "Imported first content." },
    { id: "duplicate-source", title: "Imported second", text: "Imported second content." }
  ]
});
assert.equal(importedSourceCollision.documents.length, 2, "conflicting duplicate source IDs in imports should be preserved");
assert.notEqual(importedSourceCollision.documents[0].id, importedSourceCollision.documents[1].id, "import normalization should repair conflicting duplicate source IDs");
assert.deepEqual(inspectGraph(importedSourceCollision).ambiguousSourceIds, 1, "conflicting source IDs should be visible in graph health");
const ambiguousSourceReferences = normalizeGraph({
  ...importedSourceCollision,
  nodes: [{ id: "source-bound", label: "Source bound", sources: ["duplicate-source"], evidence: [{ text: "ambiguous", sources: ["duplicate-source"] }] }]
});
const ambiguousSourceHealth = inspectGraph(ambiguousSourceReferences);
assert.equal(ambiguousSourceHealth.ambiguousSourceReferences, 2, "ambiguous provenance references should be counted separately");
assert.equal(ambiguousSourceHealth.provenanceCoverage, 0, "ambiguous provenance should not count as trustworthy coverage");
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
const ambiguousGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [
    { id: "first-shared", label: "Shared concept", sources: [], evidence: [] },
    { id: "second-shared", label: "Shared concept", sources: [], evidence: [] }
  ]
});
assert.equal(inspectGraph(ambiguousGraph).ambiguousLabels, 1, "graph health should report duplicate canonical concept labels");
const ambiguousMerge = mergeExtraction(ambiguousGraph, {
  source: { id: "ambiguous-follow-up", title: "Ambiguous follow-up", text: "ambiguous follow-up", fingerprint: "ambiguous-follow-up" },
  nodes: [{ id: "shared-concept", label: "Shared concept", sources: ["ambiguous-follow-up"], evidence: [] }],
  edges: []
});
assert.equal(ambiguousMerge.graph.nodes.length, 3, "ambiguous labels should not silently attach new evidence to the first concept");

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
assert.deepEqual(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "aliases", label: "Aliases", aliases: ["one", "one", " two "] }]
}).nodes[0].aliases, ["one", "two"], "graph normalization should deduplicate and trim aliases");
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
const sourceMetadata = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "quality-source", title: "Reviewed source", text: "Reviewed source text", uri: "https://example.org/reviewed-source", quality: "primary", lastReviewedAt: "2025-01-01T00:00:00.000Z" }]
});
assert.equal(sourceMetadata.documents[0].quality, "primary");
assert.equal(sourceMetadata.documents[0].lastReviewedAt, "2025-01-01T00:00:00.000Z");
assert.equal(normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "invalid-date", title: "Invalid date", text: "text", lastReviewedAt: "not-a-date" }]
}).documents[0].lastReviewedAt, null, "invalid review dates should be discarded");
const normalizedTimestamps = normalizeGraph({
  schema: GRAPH_SCHEMA,
  updatedAt: "not-a-date",
  documents: [{ id: "timestamp-source", title: "Timestamp source", text: "text", addedAt: "not-a-date" }],
  nodes: [{ id: "timestamp-node", label: "Timestamp node", createdAt: "not-a-date", updatedAt: "" }],
  revisions: [{ id: "timestamp-revision", timestamp: "not-a-date", reason: "test" }]
});
assert.equal(normalizedTimestamps.updatedAt, null, "invalid graph timestamps should be discarded");
assert.equal(normalizeGraph({
  schema: GRAPH_SCHEMA,
  updatedAt: "2".repeat(MAX_TIMESTAMP_CHARS + 1)
}).updatedAt, null, "oversized graph timestamps should be rejected before parsing");
assert(!Number.isNaN(Date.parse(normalizedTimestamps.documents[0].addedAt)), "document timestamps should be normalized");
assert(!Number.isNaN(Date.parse(normalizedTimestamps.nodes[0].createdAt)), "node timestamps should be normalized");
assert(!Number.isNaN(Date.parse(normalizedTimestamps.revisions[0].timestamp)), "revision timestamps should be normalized");
assert.equal(normalizeGraph({ schema: GRAPH_SCHEMA, version: Number.MAX_SAFE_INTEGER + 1 }).version, 0, "unsafe graph versions should be repaired");
assert.equal(normalizeGraph({ schema: GRAPH_SCHEMA, revisions: [{ version: Number.MAX_SAFE_INTEGER + 1 }] }).revisions[0].version, 0, "unsafe revision versions should be repaired");
const versionLockedGraph = normalizeGraph({ ...merged, version: MAX_GRAPH_VERSION });
const versionLockedSnapshot = JSON.stringify(versionLockedGraph);
assert.equal(advanceGraphVersion(versionLockedGraph), false, "graph versions at the safe-integer ceiling should not overflow");
assert.equal(versionLockedGraph.version, MAX_GRAPH_VERSION);
assert.equal(mergeExtraction(versionLockedGraph, extractGraph("Version locked", "A version locked document connects concepts for review.")).limited, "version", "ingestion should fail closed at the graph version ceiling");
assert.equal(applyFeedback(versionLockedGraph, "node", versionLockedGraph.nodes[0].id, "up").limited, "version", "feedback should fail closed at the graph version ceiling");
assert.equal(mergeConcepts(versionLockedGraph, versionLockedGraph.nodes[0].id, versionLockedGraph.nodes[1].id).limited, "version", "concept merges should fail closed at the graph version ceiling");
assert.equal(removeSource(versionLockedGraph, versionLockedGraph.documents[0].id).limited, "version", "source removal should fail closed at the graph version ceiling");
assert.equal(applyFeedbackDataset(versionLockedGraph, [{ kind: "concept", id: versionLockedGraph.nodes[0].id, label: versionLockedGraph.nodes[0].label, status: "accepted" }]).limited, "version", "feedback imports should fail closed at the graph version ceiling");
assert.equal(JSON.stringify(versionLockedGraph), versionLockedSnapshot, "version-ceiling guards should not mutate the locked graph");
const unstableImportedGraph = {
  schema: GRAPH_SCHEMA,
  documents: [{ title: "Unstable source", text: "text" }],
  nodes: [{ id: "unstable", label: "Unstable" }],
  revisions: [{ reason: "unstable revision" }]
};
assert.deepEqual(normalizeGraph(unstableImportedGraph), normalizeGraph(unstableImportedGraph), "malformed graph repairs should be deterministic across reads");
const repairedGraphIds = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "  ", label: "Dropped whitespace ID" }, { id: "node", label: "Node" }],
  edges: [{ id: "", source: "node", target: "node", label: "loops" }],
  revisions: [{ id: "", reason: "empty ID" }]
});
assert.equal(repairedGraphIds.nodes.length, 1, "whitespace-only graph node IDs should be discarded");
assert(repairedGraphIds.edges[0].id, "empty graph relation IDs should be repaired");
const duplicateGraphLabels = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [
    { id: "duplicate", label: "First label" },
    { id: "duplicate", label: "Second label" }
  ]
});
assert(duplicateGraphLabels.nodes[0].aliases.includes("Second label"), "duplicate imported concept labels should be preserved as aliases");
const duplicateReviewDates = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [
    { id: "reviewed", label: "Reviewed", updatedAt: "2026-01-01T00:00:00.000Z", lastReviewedAt: "2025-01-01T00:00:00.000Z" },
    { id: "reviewed", label: "Reviewed", updatedAt: "2025-01-01T00:00:00.000Z", lastReviewedAt: "2026-01-01T00:00:00.000Z" },
    { id: "target", label: "Target" }
  ],
  edges: [
    { id: "reviewed-target-supports", source: "reviewed", target: "target", label: "supports", lastReviewedAt: "2025-02-01T00:00:00.000Z" },
    { id: "reviewed-target-supports-copy", source: "reviewed", target: "target", label: "supports", lastReviewedAt: "2026-02-01T00:00:00.000Z" }
  ]
});
assert.equal(duplicateReviewDates.nodes.find((node) => node.id === "reviewed").lastReviewedAt, "2026-01-01T00:00:00.000Z", "duplicate imported concept review dates should retain the newest value");
assert.equal(duplicateReviewDates.nodes.find((node) => node.id === "reviewed").updatedAt, "2026-01-01T00:00:00.000Z", "duplicate imported concept update dates should retain the newest value");
assert.equal(duplicateReviewDates.edges[0].lastReviewedAt, "2026-02-01T00:00:00.000Z", "duplicate imported relation review dates should retain the newest value");
const duplicateEdgeIds = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "left", label: "Left" }, { id: "right", label: "Right" }],
  edges: [
    { id: "same-edge", source: "left", target: "right", label: "uses" },
    { id: "same-edge", source: "left", target: "right", label: "supports" }
  ]
});
assert.equal(new Set(duplicateEdgeIds.edges.map((edge) => edge.id)).size, 2, "distinct imported relations should not retain duplicate IDs");
assert.deepEqual(duplicateEdgeIds.integrity.ambiguousEdgeIds, ["same-edge"], "duplicate imported edge IDs should be visible in integrity diagnostics");
assert.equal(
  relationSemanticKey("left", "right", "uses"),
  relationSemanticKey("right", "left", "USES"),
  "relation semantic identity should be stable across endpoint order and label case"
);
assert.notEqual(
  relationSemanticKey("left", "right", "uses"),
  relationSemanticKey("left", "right", "supports"),
  "relation semantic identity should distinguish labels"
);
assert.notEqual(
  relationSemanticKey("left|right", "target", "uses"),
  relationSemanticKey("left", "right|target", "uses"),
  "relation semantic identity should not collide when endpoint IDs contain delimiters"
);
const longRelationLabelA = `${"r".repeat(70)}alpha`;
const longRelationLabelB = `${"r".repeat(70)}beta`;
assert.notEqual(
  relationSemanticKey("left", "right", longRelationLabelA),
  relationSemanticKey("left", "right", longRelationLabelB),
  "relation semantic identity should distinguish labels beyond the human-readable slug bound"
);
const longRelationExtraction = normalizeExtraction({
  source: { title: "Long relation labels", text: "A source document with enough text to retain distinct long relation labels." },
  nodes: [{ id: "left", label: "Left" }, { id: "right", label: "Right" }],
  edges: [
    { source: "left", target: "right", label: longRelationLabelA },
    { source: "left", target: "right", label: longRelationLabelB }
  ]
});
assert.equal(longRelationExtraction.edges.length, 2, "normalization should retain distinct long relation labels");
assert.equal(new Set(longRelationExtraction.edges.map((edge) => edge.id)).size, 2, "long relation labels should receive distinct deterministic edge IDs");
const longRelationMerged = mergeExtraction(defaultGraph(), longRelationExtraction);
assert.equal(new Set(longRelationMerged.graph.edges.map((edge) => edge.id)).size, 2, "graph merges should preserve unique IDs for distinct long relation labels");
const duplicateReverseEdges = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "left", label: "Left" }, { id: "right", label: "Right" }],
  edges: [
    { id: "forward", source: "left", target: "right", label: "uses", status: "inferred" },
    { id: "reverse", source: "right", target: "left", label: "USES", status: "accepted" }
  ],
  learning: {
    examples: [{ kind: "relation", id: "reverse", source: "right", target: "left", label: "uses", status: "accepted" }]
  }
});
assert.equal(duplicateReverseEdges.edges.length, 1, "normalization should collapse reverse relations with the same label");
assert.equal(duplicateReverseEdges.edges[0].status, "accepted", "reverse relation collapse should preserve the strongest reviewed status");
assert.equal(duplicateReverseEdges.learning.examples[0].id, "forward", "reverse relation learning memory should follow the retained edge identity");
assert.equal(duplicateReverseEdges.learning.examples[0].source, "left", "reverse relation learning memory should follow the retained source endpoint");
assert.equal(duplicateReverseEdges.learning.examples[0].target, "right", "reverse relation learning memory should follow the retained target endpoint");
const sameIdReverseEdges = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "left", label: "Left" }, { id: "right", label: "Right" }],
  edges: [
    { id: "shared-edge", source: "left", target: "right", label: "uses" },
    { id: "shared-edge", source: "right", target: "left", label: "USES" }
  ],
  learning: {
    examples: [{ kind: "relation", id: "shared-edge", source: "right", target: "left", label: "USES", status: "accepted" }]
  }
});
assert.equal(sameIdReverseEdges.edges.length, 1, "same-ID reverse relations should still collapse");
assert.equal(sameIdReverseEdges.learning.examples[0].source, "left", "same-ID reverse learning memory should be rebound to canonical endpoints");
assert(repairedGraphIds.revisions[0].id, "empty graph revision IDs should be repaired");
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
const oversizedIdentity = "identity-".repeat(MAX_ID_CHARS);
const boundedIdentityGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: oversizedIdentity, fingerprint: oversizedIdentity, title: "Long identity", text: "text" }],
  nodes: [{
    id: oversizedIdentity,
    label: "Long identity",
    sources: [oversizedIdentity],
    evidence: [{ text: "evidence", sources: [oversizedIdentity] }]
  }],
  edges: [{
    id: oversizedIdentity,
    source: oversizedIdentity,
    target: oversizedIdentity,
    label: "loops",
    sources: [oversizedIdentity],
    evidence: [{ text: "relation evidence", sources: [oversizedIdentity] }]
  }],
  revisions: [{ id: oversizedIdentity, reason: "long identity" }],
  integrity: { ambiguousSourceIds: [oversizedIdentity] }
});
assert(boundedIdentityGraph.documents.every((document) => document.id.length <= MAX_ID_CHARS && document.fingerprint.length <= MAX_ID_CHARS), "document identity fields should be bounded");
assert(boundedIdentityGraph.nodes.every((node) => node.id.length <= MAX_ID_CHARS && node.sources.every((source) => source.length <= MAX_ID_CHARS)), "node identity fields should be bounded");
assert(boundedIdentityGraph.edges.every((edge) => edge.id.length <= MAX_ID_CHARS && edge.source.length <= MAX_ID_CHARS && edge.target.length <= MAX_ID_CHARS), "relation identity fields should be bounded");
assert(boundedIdentityGraph.edges.every((edge) => edge.evidence.every((evidence) => evidence.sources.every((source) => source.length <= MAX_ID_CHARS))), "relation evidence source IDs should be bounded");
assert(boundedIdentityGraph.revisions.every((revision) => revision.id.length <= MAX_ID_CHARS), "revision identity fields should be bounded");
assert(boundedIdentityGraph.integrity.ambiguousSourceIds.every((source) => source.length <= MAX_ID_CHARS), "integrity source IDs should be bounded");
const boundedRevisionMetadata = normalizeGraph({
  schema: GRAPH_SCHEMA,
  revisions: [{
    reason: "r".repeat(500),
    nodes: Number.MAX_SAFE_INTEGER,
    edges: -10
  }]
});
assert.equal(boundedRevisionMetadata.revisions[0].reason.length, 200, "revision reasons should be bounded");
assert.equal(boundedRevisionMetadata.revisions[0].nodes, 5000, "revision node counts should be bounded");
assert.equal(boundedRevisionMetadata.revisions[0].edges, 0, "revision edge counts should be non-negative");
const boundedCounters = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "counter-node", label: "Counter node", mentions: Number.MAX_SAFE_INTEGER, feedback: Number.MAX_SAFE_INTEGER }],
  edges: [{ id: "counter-edge", source: "counter-node", target: "counter-node", label: "loops", feedback: -Number.MAX_SAFE_INTEGER }]
});
assert.equal(boundedCounters.nodes[0].mentions, MAX_NODE_MENTIONS, "node mention counts should be bounded");
assert.equal(boundedCounters.nodes[0].feedback, MAX_FEEDBACK_COUNT, "node feedback counts should be bounded");
assert.equal(boundedCounters.edges[0].feedback, -MAX_FEEDBACK_COUNT, "relation feedback counts should be bounded");
const oversizedAliases = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "alias-node", label: "Alias node", aliases: ["a".repeat(500)] }],
  learning: { examples: [{ kind: "concept", id: "alias-node", label: "Alias node", aliases: ["b".repeat(500)], status: "accepted" }] }
});
assert.equal(oversizedAliases.nodes[0].aliases[0].length, 120, "graph aliases should be bounded");
assert.equal(oversizedAliases.learning.examples[0].aliases[0].length, 120, "learning aliases should be bounded");
const oversizedRelationEndpoints = "endpoint-".repeat(40);
const boundedGeneratedEdges = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: oversizedRelationEndpoints, label: "Long source" }, { id: `${oversizedRelationEndpoints}-target`, label: "Long target" }],
  edges: [
    { source: oversizedRelationEndpoints, target: `${oversizedRelationEndpoints}-target`, label: "supports" },
    { source: oversizedRelationEndpoints, target: `${oversizedRelationEndpoints}-target`, label: "supports another" }
  ]
});
assert.equal(boundedGeneratedEdges.nodes.length, 2, "distinct long concept IDs should not collapse after bounding");
assert.notEqual(boundedGeneratedEdges.nodes[0].id, boundedGeneratedEdges.nodes[1].id, "bounded long concept IDs should retain deterministic uniqueness");
assert(boundedGeneratedEdges.edges.every((edge) => edge.id.length <= MAX_ID_CHARS), "generated relation IDs should be bounded");
assert.equal(new Set(boundedGeneratedEdges.edges.map((edge) => edge.id)).size, boundedGeneratedEdges.edges.length, "bounded generated relation IDs should remain unique");
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
const emptySourceCollision = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [
    { id: "empty-source", title: "Empty first", text: "", fingerprint: "empty-first" },
    { id: "empty-source", title: "Empty second", text: "", fingerprint: "empty-second" }
  ]
});
assert.equal(emptySourceCollision.documents.length, 2, "empty sources with different fingerprints should remain distinct");
const mergedSourceMetadata = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [
    { id: "metadata-source", title: "Source", text: "text", quality: "unknown", lastReviewedAt: null },
    { id: "metadata-source", title: "Source", text: "text", quality: "primary", lastReviewedAt: "2025-02-01T00:00:00.000Z" }
  ]
});
assert.equal(mergedSourceMetadata.documents[0].quality, "primary");
assert.equal(mergedSourceMetadata.documents[0].lastReviewedAt, "2025-02-01T00:00:00.000Z");
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
const projectionStart = app.indexOf("const safeMarkdownLabel");
const projectionEnd = app.indexOf('document.querySelector("#load-sample")');
assert(projectionStart >= 0 && projectionEnd > projectionStart, "projection boundaries should exist");
const sandbox = {
  console,
  Date,
  Math,
  Set,
  Map,
  JSON,
  TextEncoder,
  Uint8Array,
  DataView,
  GRAPH_SCHEMA,
  VAULT_FORMAT: "llm-field-notes/vault@1",
  FEEDBACK_FORMAT: "llm-field-notes/feedback@1",
  BACKUP_FORMAT: "llm-field-notes/backup@1",
  MAX_ZIP_BYTES: 50 * 1024 * 1024,
  MAX_FEEDBACK_EXAMPLES,
  fingerprintFeedbackExamples,
  preferLearningExample,
  fingerprintBackup,
  inspectGraph,
  buildJsonLd,
  matchesJsonLdProjection
};
sandbox.globalThis = sandbox;
vm.runInNewContext(`const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
${app.slice(projectionStart, projectionEnd)}
globalThis.__projectionTest = { buildVaultFiles, zipStore, buildMarkdown, buildFeedbackDataset, buildCompactFeedbackDataset };`, sandbox);
const { buildVaultFiles, zipStore, buildMarkdown, buildFeedbackDataset, buildCompactFeedbackDataset } = sandbox.__projectionTest;
const vaultFiles = buildVaultFiles(merged);
assert(vaultFiles.find((file) => file.name === "README.md")?.content.includes("Open [[_index]]"), "Obsidian vaults should include orientation and round-trip instructions");
assert(vaultFiles.find((file) => file.name === "README.md")?.content.includes("[[Learning/review-ledger]]"), "Obsidian vaults should link the reusable review ledger");
assert(vaultFiles.find((file) => file.name === "Learning/review-ledger.md")?.content.includes("type: learning-ledger"), "Obsidian vaults should export a versioned reusable review ledger");
assert(buildVaultFiles(acceptedKnowledge).find((file) => file.name === "Learning/review-ledger.md")?.content.includes("concept: [[Concepts/"), "review ledger entries should link back to projected concept notes");
const vaultManifest = JSON.parse(vaultFiles.find((file) => file.name === "vault-manifest.json")?.content || "{}");
assert.equal(vaultManifest.format, "llm-field-notes/vault@1", "Obsidian vaults should declare a versioned manifest contract");
assert.equal(vaultManifest.graphVersion, merged.version);
assert.equal(vaultManifest.graphFingerprint, fingerprintBackup(merged), "vault manifests should bind exports to the normalized graph fingerprint");
assert.equal(JSON.parse(vaultFiles.find((file) => file.name === "graph.json")?.content || "{}").graphFingerprint, fingerprintBackup(merged), "vault graph JSON should carry the same integrity fingerprint as its manifest");
assert.equal(JSON.parse(vaultFiles.find((file) => file.name === "graph.jsonld")?.content || "{}").format, "llm-field-notes/jsonld@1", "Obsidian vaults should include the versioned JSON-LD projection");
assert(vaultFiles.some((file) => file.name === "_index.md"));
assert(vaultFiles.some((file) => file.name.startsWith("Concepts/")));
assert(vaultFiles.find((file) => file.name.startsWith("Concepts/"))?.content.includes("graph_fingerprint:"), "individual concept notes should retain projection identity");
assert(buildMarkdown(sourceMetadata).includes("primary quality"), "Markdown projections should expose source quality");
assert(buildMarkdown(sourceMetadata).includes("[https://example.org/reviewed-source](<https://example.org/reviewed-source>)"), "Markdown projections should make safe HTTP source URIs clickable");
assert(buildVaultFiles(sourceMetadata).find((file) => file.name.startsWith("Sources/"))?.content.includes("Source URI: [https://example.org/reviewed-source](<https://example.org/reviewed-source>)"), "Obsidian source notes should make safe HTTP source URIs clickable");
assert(vaultFiles.some((file) => file.name.startsWith("Sources/")));
assert(vaultFiles.find((file) => file.name.startsWith("Sources/"))?.content.includes("fingerprint:"), "source notes should bind metadata edits to the source fingerprint");
assert(buildMarkdown(merged).includes("[[Concepts/"), "index should contain Obsidian concept links");
assert(buildMarkdown(merged).includes(`fingerprint: ${fingerprintBackup(merged)}`), "Markdown projections should bind their frontmatter to the normalized graph fingerprint");
assert(buildMarkdown(merged, { graphFingerprint: "fnv64-0000000000000000-0" }).includes("fingerprint: fnv64-0000000000000000-0"), "Markdown projections should accept a precomputed graph fingerprint");
assert(buildMarkdown(merged).includes("## Graph health") && buildMarkdown(merged).includes("Active-item provenance coverage: 100%"), "Markdown projections should expose privacy-safe graph health diagnostics");
assert(buildMarkdown(merged).includes(merged.nodes[0].evidence[0].text), "Markdown projections should preserve concept evidence");
assert(buildMarkdown(merged, { maxEvidenceChars: 1 }).includes("Evidence preview truncated"), "Markdown previews should bound evidence rendering");
assert(buildMarkdown(merged).includes("## Revision history"), "Markdown projections should preserve revision history");
const jsonLd = buildJsonLd(sourceMetadata);
assert.equal(jsonLd["@type"], "schema:Dataset", "JSON-LD projections should declare a dataset root");
assert.equal(jsonLd.format, "llm-field-notes/jsonld@1", "JSON-LD projections should declare their versioned contract");
assert.equal(jsonLd.graphSchema, GRAPH_SCHEMA);
assert.equal(jsonLd.learningExampleCount, sourceMetadata.learning.examples.length, "JSON-LD roots should disclose reusable learning memory size");
for (const contextTerm of ["graphUpdatedAt", "revisionCount", "learningExampleCount", "kind", "concept", "sourceConcept", "targetConcept", "sourceLabel", "targetLabel", "relation"]) {
  assert(Object.hasOwn(jsonLd["@context"], contextTerm), `JSON-LD context should declare ${contextTerm}`);
}
assert.equal(buildJsonLd({ schema: GRAPH_SCHEMA })["@graph"].length, 0, "JSON-LD projection should normalize sparse graph inputs at its boundary");
assert.equal(jsonLd.fingerprint, fingerprintBackup(sourceMetadata), "JSON-LD projections should bind to the normalized graph fingerprint");
assert.equal(matchesJsonLdProjection(sourceMetadata, jsonLd), true, "JSON-LD projections should verify against their normalized graph");
assert.equal(matchesJsonLdProjection(sourceMetadata, { ...jsonLd, "@graph": [...jsonLd["@graph"]].reverse() }), true, "JSON-LD verification should ignore unordered graph-member order");
const reorderedJsonLdGraph = [...jsonLd["@graph"]];
reorderedJsonLdGraph.unshift(...reorderedJsonLdGraph.splice(1));
assert.equal(matchesJsonLdProjection(sourceMetadata, { ...jsonLd, "@graph": reorderedJsonLdGraph }), true, "JSON-LD verification should use locale-independent canonical ordering");
assert(jsonLd["@graph"].some((item) => item["@type"] === "schema:CreativeWork" && item.text === "Reviewed source text" && item["lfn:sourceFingerprint"] === sourceMetadata.documents[0].fingerprint && item["lfn:addedAt"] === sourceMetadata.documents[0].addedAt), "full JSON-LD projections should preserve source text, identity, and chronology");
const relationJsonLd = buildJsonLd(merged);
assert(relationJsonLd["@graph"].some((item) => item["@type"] === "lfn:Relation" && item.source && item.target), "JSON-LD projections should preserve relation endpoints");
const jsonLdConcept = relationJsonLd["@graph"].find((item) => Array.isArray(item["@type"]) && item["@type"].includes("lfn:Concept"));
const jsonLdRelation = relationJsonLd["@graph"].find((item) => item["@type"] === "lfn:Relation");
assert(jsonLdConcept && Object.hasOwn(jsonLdConcept, "lfn:type") && Object.hasOwn(jsonLdConcept, "lfn:feedback") && Object.hasOwn(jsonLdConcept, "lfn:createdAt") && Object.hasOwn(jsonLdConcept, "lfn:updatedAt") && Object.hasOwn(jsonLdConcept, "lfn:lastReviewedAt") && Object.hasOwn(jsonLdConcept, "lfn:sources"), "JSON-LD concepts should preserve type, provenance, review, and chronology metadata");
assert(jsonLdRelation && Object.hasOwn(jsonLdRelation, "lfn:feedback") && Object.hasOwn(jsonLdRelation, "lfn:lastReviewedAt") && Object.hasOwn(jsonLdRelation, "lfn:sources"), "JSON-LD relations should preserve provenance and review metadata");
assert(buildJsonLd(acceptedKnowledge)["@graph"].some((item) => item["@type"] === "lfn:LearningExample" && item["lfn:kind"] === "concept"), "JSON-LD projections should preserve reusable concept learning examples");
assert(buildJsonLd(acceptedKnowledge)["@graph"].filter((item) => item["@type"] === "lfn:LearningExample" && item["lfn:kind"] === "relation").every((item) => item["lfn:sourceLabel"] && item["lfn:targetLabel"]), "JSON-LD relation learning examples should preserve portable endpoint labels");
const unicodeIdentityGraph = normalizeGraph({
  ...defaultGraph(),
  nodes: [{ id: "概念".repeat(100), label: "Unicode concept" }]
});
const unicodeJsonLd = buildJsonLd(unicodeIdentityGraph);
assert(unicodeJsonLd["@graph"].every((item) => item["@id"].length <= 2000), "JSON-LD member identifiers should remain within the published bound for Unicode graph IDs");
const redactedJsonLd = buildJsonLd(redactGraph(merged));
assert.equal(redactedJsonLd.redacted, true, "redacted JSON-LD projections should disclose their privacy state");
assert(redactedJsonLd["@graph"].filter((item) => item["@type"] === "schema:CreativeWork").every((item) => !Object.hasOwn(item, "text")), "redacted JSON-LD projections should remove source text");
assert(redactedJsonLd["@graph"].filter((item) => Array.isArray(item["@type"]) && item["@type"].includes("lfn:Concept")).every((item) => item.evidence.length === 0), "redacted JSON-LD projections should remove evidence quotes");
assert(buildVaultFiles(rejectedGraph).some((file) => file.content.includes("status: rejected")), "rejected concepts should remain exportable");
const redactedVaultFiles = buildVaultFiles(redactGraph(sourceMetadata));
assert(redactedVaultFiles.find((file) => file.name === "README.md")?.content.includes("redacted projection"), "redacted vault instructions should disclose the projection boundary");
assert.equal(JSON.parse(redactedVaultFiles.find((file) => file.name === "vault-manifest.json")?.content || "{}").redacted, true, "redacted vault manifests should preserve the privacy boundary");
assert(redactedVaultFiles.find((file) => file.name.startsWith("Sources/"))?.content.includes('uri: ""'), "redacted vault source notes should remove source URIs");
assert(!redactedVaultFiles.find((file) => file.name.startsWith("Sources/"))?.content.includes("Reviewed source text"), "redacted vault source notes should remove source text");
assert(JSON.parse(redactedVaultFiles.find((file) => file.name === "graph.json")?.content || "{}").learning.examples.every((example) => example.evidence.every((evidence) => evidence.text === "[redacted]")), "redacted vault graph JSON should remove reusable-learning evidence quotes");
assert(redactedVaultFiles.find((file) => file.name === "_index.md")?.content.includes("Redacted projection"), "redacted vault index should disclose its privacy boundary");
assert(redactedVaultFiles.find((file) => file.name.startsWith("Sources/"))?.content.includes("redacted: true"), "redacted vault source notes should retain an explicit redaction marker");
const renamed = normalizeGraph({ ...merged, nodes: merged.nodes.map((node, index) => index === 0 ? { ...node, label: "Renamed concept" } : node) });
assert.equal(buildVaultFiles(renamed).find((file) => file.name.startsWith("Concepts/"))?.name, vaultFiles.find((file) => file.name.startsWith("Concepts/"))?.name, "concept paths should remain stable when labels change");
const retitled = normalizeGraph({ ...merged, documents: merged.documents.map((document) => ({ ...document, title: "Retitled source" })) });
assert.equal(buildVaultFiles(retitled).find((file) => file.name.startsWith("Sources/"))?.name, vaultFiles.find((file) => file.name.startsWith("Sources/"))?.name, "source paths should remain stable when titles change");
const collidingProjectionGraph = {
  ...merged,
  nodes: [
    { ...merged.nodes[0], id: "same/id" },
    { ...merged.nodes[0], id: "same-id" }
  ],
  edges: []
};
const collidingProjectionFiles = buildVaultFiles(collidingProjectionGraph);
assert.equal(new Set(collidingProjectionFiles.map((file) => file.name)).size, collidingProjectionFiles.length, "projection paths should remain unique when IDs slugify to the same name");
const imperfectProjectionGraph = { ...merged, edges: merged.edges.map((edge) => ({ ...edge, evidence: [{ text: "orphan evidence", sources: ["missing-source"] }] })) };
assert(!buildMarkdown(imperfectProjectionGraph).includes("undefined"), "projections should not emit undefined links");
const unsafeProjectionGraph = normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0 ? { ...node, label: "Unsafe ] concept [" } : node),
  edges: merged.edges.map((edge, index) => index === 0 ? { ...edge, label: "supports ]", evidence: [{ text: "first line\nsecond line", sources: [] }] } : edge)
});
const unsafeMarkdown = buildMarkdown(unsafeProjectionGraph);
assert(!unsafeMarkdown.includes("|Unsafe ] concept ["), "projection labels should not break Obsidian wiki links");
assert(unsafeMarkdown.includes("> first line\n> second line"), "multiline evidence should remain inside a Markdown quote");
assert(!unsafeMarkdown.includes('["Unsafe ] concept ["]'), "projection labels should not break Mermaid node declarations");
const pipeProjectionGraph = normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0 ? { ...node, label: "Pipe | concept" } : node),
  documents: merged.documents.map((document) => ({ ...document, title: "Pipe | source" }))
});
const pipeMarkdown = buildMarkdown(pipeProjectionGraph);
const pipeVaultFiles = buildVaultFiles(pipeProjectionGraph);
assert(pipeMarkdown.includes("Pipe concept"), "projection labels should preserve readable text after pipe sanitization");
assert(!pipeMarkdown.includes("|Pipe | concept"), "pipe characters should not break Obsidian wiki-link labels");
assert(!pipeVaultFiles.some((file) => file.content.includes("|Pipe | concept")), "pipe characters should not break Obsidian vault wiki-link labels");
const feedbackDataset = buildFeedbackDataset(acceptedKnowledge);
assert.equal(feedbackDataset.format, "llm-field-notes/feedback@1");
assert.match(feedbackDataset.datasetFingerprint, /^fnv1a-[0-9a-f]{16}$/);
assert(feedbackDataset.examples.some((example) => example.kind === "concept" && example.status === "accepted"), "feedback export should include reviewed concepts");
const compactFeedbackDataset = buildCompactFeedbackDataset(acceptedKnowledge);
assert(compactFeedbackDataset.examples.every((example) => example.evidence.length === 0 && example.sources.length === 0), "compact feedback exports should remove source-linked material");
assert.equal(compactFeedbackDataset.examples.length, feedbackDataset.examples.length, "compact feedback exports should preserve reviewed examples");
assert.equal(compactFeedbackDataset.datasetFingerprint, fingerprintFeedbackExamples(compactFeedbackDataset.examples), "compact feedback exports should fingerprint their redacted examples");
const backupFingerprint = fingerprintBackup(merged, [defaultGraph()]);
assert.match(backupFingerprint, /^fnv64-[0-9a-f]{16}-\d+$/, "backups should have a deterministic content fingerprint");
assert.equal(backupFingerprint, fingerprintBackup(merged, [defaultGraph()]), "backup fingerprints should be deterministic");
assert.notEqual(backupFingerprint, fingerprintBackup(defaultGraph(), [defaultGraph()]), "backup fingerprints should change when graph content changes");
const graphJsonFingerprint = fingerprintBackup(merged);
assert.equal(fingerprintBackup({ ...merged, graphFingerprint: graphJsonFingerprint }), graphJsonFingerprint, "graph JSON fingerprints should ignore their metadata field when verifying contents");
const staleRelationLearning = normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0 ? { ...node, label: "Renamed alpha" } : node),
  learning: {
    examples: [{
      kind: "relation",
      id: merged.edges[0].id,
      source: merged.edges[0].source,
      sourceLabel: merged.nodes[0].label,
      target: merged.edges[0].target,
      targetLabel: merged.nodes[1].label,
      label: merged.edges[0].label,
      status: "accepted"
    }]
  }
});
const synchronizedLearning = syncLearningRelationLabels(staleRelationLearning);
assert.equal(synchronizedLearning.graph.learning.examples[0].sourceLabel, "Renamed alpha", "relation learning labels should follow renamed concepts");
assert.equal(synchronizedLearning.changed, true);
const healthReportGraph = inspectGraph(sourceMetadata);
assert.equal(healthReportGraph.redacted, false, "health diagnostics should remain privacy-safe for normal graphs");
assert.equal(healthReportGraph.orphanedSourceReferences, 0, "health diagnostics should report valid source references");
const aliasFeedbackGraph = normalizeGraph({
  ...acceptedKnowledge,
  nodes: acceptedKnowledge.nodes.map((node, index) => index === 0 ? { ...node, aliases: ["human alias"] } : node)
});
const aliasFeedbackDataset = buildFeedbackDataset(aliasFeedbackGraph);
assert(aliasFeedbackDataset.examples.find((example) => example.kind === "concept")?.aliases.includes("human alias"), "feedback export should preserve reviewed aliases");
const learningPriorityDataset = buildFeedbackDataset(normalizeGraph({
  ...merged,
  nodes: Array.from({ length: 500 }, (_, index) => ({
    ...merged.nodes[0],
    id: `dataset-priority-${index}`,
    label: `Dataset priority ${index}`,
    status: "accepted"
  })),
  learning: {
    examples: [
      { kind: "concept", id: "dataset-imported-priority", label: "Dataset imported priority", status: "accepted" }
    ]
  }
}));
assert(learningPriorityDataset.examples.some((example) => example.id === "dataset-imported-priority"), "feedback dataset export should preserve reusable memory before filling its bounded budget");
const importedFeedback = applyFeedbackDataset(merged, [{ kind: "concept", id: merged.nodes[0].id, status: "accepted" }]);
assert.equal(importedFeedback.changed, true, "feedback datasets should apply reviewed graph updates");
assert.equal(importedFeedback.graph.nodes.find((node) => node.id === merged.nodes[0].id).status, "accepted");
assert.equal(applyFeedbackDataset(importedFeedback.graph, [{ kind: "concept", id: merged.nodes[0].id, status: "accepted" }]).changed, false, "feedback dataset imports should be idempotent");
const conflictingFeedback = applyFeedbackDataset(merged, [
  { kind: "concept", id: merged.nodes[0].id, status: "accepted" },
  { kind: "concept", id: merged.nodes[0].id, status: "rejected" }
]);
assert.equal(conflictingFeedback.conflicts, 1, "contradictory feedback identities should be reported");
assert.equal(conflictingFeedback.changed, true, "contradictory feedback should preserve the existing correction workflow");
const transferredFeedback = applyFeedbackDataset(merged, [{ kind: "concept", id: merged.nodes[0].id, status: "accepted", aliases: ["transferred alias"] }]);
assert.equal(transferredFeedback.updates, 1, "feedback import counts changed reviewed items once");
assert(transferredFeedback.graph.nodes.find((node) => node.id === merged.nodes[0].id).aliases.includes("transferred alias"), "feedback imports should transfer reviewed aliases");
const compactFeedback = buildExtractorFeedback(normalizeGraph({
  ...acceptedKnowledge,
  edges: acceptedKnowledge.edges.map((edge, index) => index === 0 ? { ...edge, status: "accepted" } : edge)
}));
assert(compactFeedback.length > 0, "extractor feedback should include reviewed items");
assert(!Object.hasOwn(compactFeedback[0], "evidence") && !Object.hasOwn(compactFeedback[0], "sources"), "extractor feedback should omit source evidence payloads");
assert(compactFeedback.some((example) => example.kind === "relation" && Object.hasOwn(example, "sourceLabel")), "extractor feedback should preserve relation endpoint labels");
assert(!buildExtractorFeedback(normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node) => ({ ...node, status: "inferred", feedback: 1 })),
  edges: merged.edges.map((edge) => ({ ...edge, status: "inferred", feedback: 1 }))
})).length, "neutral inferred feedback should not be sent as extractor guidance");
assert.equal(buildFeedbackDataset(normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node) => ({ ...node, status: "inferred", feedback: 1 })),
  edges: merged.edges.map((edge) => ({ ...edge, status: "inferred", feedback: 1 }))
})).examples.length, 0, "neutral inferred items should not be exported as actionable feedback");
const balancedFeedback = buildExtractorFeedback(normalizeGraph({
  ...merged,
  nodes: [
    ...merged.nodes,
    ...Array.from({ length: 500 }, (_, index) => ({ ...merged.nodes[0], id: `reviewed-${index}`, label: `Reviewed ${index}`, status: "accepted" }))
  ],
  edges: [{ ...merged.edges[0], status: "accepted" }]
}));
assert(balancedFeedback.some((example) => example.kind === "relation"), "bounded extractor feedback should retain relation guidance when concepts are numerous");
const learningPriorityGraph = normalizeGraph({
  ...merged,
  nodes: Array.from({ length: 500 }, (_, index) => ({
    ...merged.nodes[0],
    id: `reviewed-priority-${index}`,
    label: `Reviewed priority ${index}`,
    status: "accepted"
  })),
  learning: {
    examples: [
      { kind: "concept", id: "imported-priority", label: "Imported priority", status: "accepted" }
    ]
  }
});
const prioritizedFeedback = buildExtractorFeedback(learningPriorityGraph);
assert(prioritizedFeedback.some((example) => example.id === "imported-priority"), "bounded extractor feedback should preserve reusable learning memory before filling the live graph budget");
const currentFeedbackWins = buildExtractorFeedback(normalizeGraph({
  ...merged,
  nodes: [{ ...merged.nodes[0], status: "rejected" }],
  learning: { examples: [{ kind: "concept", id: merged.nodes[0].id, label: merged.nodes[0].label, status: "accepted" }] }
}));
assert.equal(currentFeedbackWins.find((example) => example.id === merged.nodes[0].id)?.status, "rejected", "current reviewed graph state should override stale duplicate learning memory");
const freshDatasetDecision = buildFeedbackDataset(normalizeGraph({
  ...merged,
  nodes: [{ ...merged.nodes[0], status: "rejected", lastReviewedAt: "2025-01-01T00:00:00.000Z" }],
  learning: {
    examples: [{
      kind: "concept",
      id: merged.nodes[0].id,
      label: merged.nodes[0].label,
      status: "accepted",
      lastReviewedAt: "2026-01-01T00:00:00.000Z"
    }]
  }
}));
assert.equal(freshDatasetDecision.examples.find((example) => example.id === merged.nodes[0].id)?.status, "accepted", "feedback exports should preserve the newest reviewed decision across live and reusable memory");
const newerLearningFeedback = buildExtractorFeedback(normalizeGraph({
  ...merged,
  nodes: [{ ...merged.nodes[0], status: "rejected", lastReviewedAt: "2025-01-01T00:00:00.000Z" }],
  learning: {
    examples: [{
      kind: "concept",
      id: merged.nodes[0].id,
      label: merged.nodes[0].label,
      status: "accepted",
      lastReviewedAt: "2026-01-01T00:00:00.000Z"
    }]
  }
}));
assert.equal(newerLearningFeedback.find((example) => example.id === merged.nodes[0].id)?.status, "accepted", "newer reusable feedback should override an older live graph decision when building extractor guidance");
assert(!Object.hasOwn(newerLearningFeedback.find((example) => example.id === merged.nodes[0].id), "lastReviewedAt"), "extractor guidance should keep review timestamps internal to the graph contract");
const portableFeedback = applyFeedbackDataset(normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0 ? { ...node, id: "renamed-concept-id" } : node)
}), [{ kind: "concept", id: merged.nodes[0].id, label: merged.nodes[0].label, status: "accepted" }]);
assert.equal(portableFeedback.graph.nodes.find((node) => node.id === "renamed-concept-id").status, "accepted", "feedback imports should fall back to canonical labels when IDs differ");
const reversedRelationFeedback = applyFeedbackDataset(merged, [{
  kind: "relation",
  id: "missing-relation-id",
  source: merged.edges[0].target,
  sourceLabel: merged.nodes.find((node) => node.id === merged.edges[0].target).label,
  target: merged.edges[0].source,
  targetLabel: merged.nodes.find((node) => node.id === merged.edges[0].source).label,
  label: merged.edges[0].label,
  status: "accepted"
}]);
assert.equal(reversedRelationFeedback.updates, 1, "relation feedback should match normalized relations when endpoint order is reversed");
assert.equal(reversedRelationFeedback.graph.edges.find((edge) => edge.id === merged.edges[0].id).status, "accepted", "reversed relation feedback should update the canonical edge");
const conflictingPortableRelations = applyFeedbackDataset(merged, [
  { kind: "relation", id: "workspace-a-relation", source: merged.edges[0].source, target: merged.edges[0].target, label: merged.edges[0].label, status: "accepted" },
  { kind: "relation", id: "workspace-b-relation", source: merged.edges[0].source, target: merged.edges[0].target, label: merged.edges[0].label, status: "rejected" }
]);
assert.equal(conflictingPortableRelations.conflicts, 1, "portable relation conflicts should canonicalize workspace-specific edge IDs");
const collidingFeedbackIds = applyFeedbackDataset(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [
    { id: "shared-concept-id", label: "Local concept" },
    { id: "imported-concept", label: "Imported concept" }
  ]
}), [{
  kind: "concept",
  id: "shared-concept-id",
  label: "Imported concept",
  status: "accepted"
}]);
assert.equal(collidingFeedbackIds.graph.nodes.find((node) => node.id === "imported-concept").status, "inferred", "mismatched concept IDs should not fall through to another local identity");
assert.equal(collidingFeedbackIds.graph.nodes.find((node) => node.id === "shared-concept-id").status, "inferred", "mismatched concept IDs should not apply feedback to the colliding local identity");
const reversedRelationGuidance = extractGraph("Reversed relation guidance", "Attention uses context to organize the evidence for review.", {
  feedback: [{
    kind: "relation",
    id: "portable-relation",
    source: "context",
    sourceLabel: "Context",
    target: "attention",
    targetLabel: "Attention",
    label: "supports",
    status: "accepted"
  }]
});
assert(reversedRelationGuidance.edges.some((edge) => edge.label === "supports"), "reversed relation feedback should guide later extraction");
const ambiguousPortableFeedback = applyFeedbackDataset(normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node) => ({ ...node, id: `renamed-${node.id}`, label: "Shared concept", aliases: [] }))
}), [{ kind: "concept", id: "missing-id", label: "Shared concept", status: "accepted" }]);
assert.equal(ambiguousPortableFeedback.updates, 0, "ambiguous label feedback should not update an arbitrary concept");
assert(ambiguousPortableFeedback.graph.nodes.every((node) => node.status === "inferred"), "ambiguous label feedback should leave graph state unchanged");
const partialFeedback = applyFeedbackDataset(merged, [
  { kind: "concept", id: "missing", status: "accepted" },
  { kind: "invalid", id: "bad", status: "accepted" }
]);
assert.equal(partialFeedback.learned, 1, "feedback imports should retain unmatched reviewed examples as reusable learning memory");
assert.equal(partialFeedback.skipped, 1, "feedback imports should report invalid examples");
const emptyLearningImport = applyFeedbackDataset(defaultGraph(), [
  { kind: "concept", id: "attention", label: "Attention", aliases: ["self attention"], status: "accepted" },
  { kind: "relation", id: "attention--context--uses", source: "attention", sourceLabel: "Attention", target: "context", targetLabel: "Context", label: "uses", status: "accepted" }
]);
assert.equal(emptyLearningImport.changed, true, "feedback should be importable before matching graph items exist");
assert.equal(emptyLearningImport.graph.learning.examples.length, 2, "unmatched reviewed examples should be retained in bounded learning memory");
const reusableGuidance = buildExtractorFeedback(emptyLearningImport.graph);
assert(reusableGuidance.some((example) => example.kind === "concept" && example.id === "attention"), "learning memory should feed future extraction");
assert(extractGraph("Reusable feedback", "Attention uses context to organize the evidence for review.", { feedback: reusableGuidance }).nodes.some((node) => node.id === "attention"), "reusable feedback should influence a later extraction");
const correctedLearning = applyFeedbackDataset(defaultGraph(), [
  { kind: "concept", id: "attention", label: "Attention", status: "accepted" },
  { kind: "concept", id: "attention", label: "Attention", status: "rejected" }
]);
assert.equal(correctedLearning.graph.learning.examples[0].status, "rejected", "later feedback should replace stale learning decisions");
const timestampedDatasetLearning = applyFeedbackDataset(defaultGraph(), [
  { kind: "concept", id: "timestamped-dataset", label: "Timestamped dataset", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" },
  { kind: "concept", id: "timestamped-dataset", label: "Timestamped dataset", status: "accepted", lastReviewedAt: "2025-01-01T00:00:00.000Z" }
]);
assert.equal(timestampedDatasetLearning.graph.learning.examples[0].lastReviewedAt, "2026-01-01T00:00:00.000Z", "feedback dataset imports should preserve the newest learning review timestamp");
const timestampedGraphLearning = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "timestamped-graph", label: "Timestamped graph" }]
});
const newerAcceptanceAfterOlderRejection = applyFeedbackDataset(timestampedGraphLearning, [
  { kind: "concept", id: "timestamped-graph", label: "Timestamped graph", status: "rejected", lastReviewedAt: "2025-01-01T00:00:00.000Z" },
  { kind: "concept", id: "timestamped-graph", label: "Timestamped graph", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" }
]);
assert.equal(newerAcceptanceAfterOlderRejection.graph.nodes[0].status, "accepted", "newer feedback should win when an imported dataset orders it after an older contradiction");
const olderRejectionAfterNewerAcceptance = applyFeedbackDataset(timestampedGraphLearning, [
  { kind: "concept", id: "timestamped-graph", label: "Timestamped graph", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" },
  { kind: "concept", id: "timestamped-graph", label: "Timestamped graph", status: "rejected", lastReviewedAt: "2025-01-01T00:00:00.000Z" }
]);
assert.equal(olderRejectionAfterNewerAcceptance.graph.nodes[0].status, "accepted", "older feedback should not override a newer decision when imported later");
const staleDecisionImport = applyFeedbackDataset(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "already-reviewed", label: "Already reviewed", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" }]
}), [
  { kind: "concept", id: "already-reviewed", label: "Already reviewed", aliases: ["stale alias"], status: "rejected", lastReviewedAt: "2025-01-01T00:00:00.000Z" }
]);
assert.equal(staleDecisionImport.graph.nodes[0].status, "accepted", "stale imported feedback should not override a newer decision already in the graph");
assert(!staleDecisionImport.graph.nodes[0].aliases.includes("stale alias"), "stale imported feedback should not add aliases to a newer graph decision");
assert.equal(staleDecisionImport.changed, false, "stale feedback rejected by a newer graph decision should not create a misleading learning revision");
const correctedRelationLearning = applyFeedbackDataset(defaultGraph(), [
  { kind: "relation", id: "attention--context--relation", source: "attention", target: "context", label: "uses", status: "accepted" },
  { kind: "relation", id: "attention--context--relation", source: "attention", target: "context", label: "supports", status: "rejected" }
]);
assert.equal(correctedRelationLearning.graph.learning.examples.length, 1, "stable relation IDs should prevent contradictory duplicate memory");
assert.equal(correctedRelationLearning.graph.learning.examples[0].status, "rejected", "later relation feedback should replace stale guidance");
const fullLearningMemory = applyFeedbackDataset(defaultGraph(), Array.from({ length: MAX_FEEDBACK_EXAMPLES }, (_, index) => ({
  kind: "concept",
  id: `bounded-${index}`,
  label: `Bounded ${index}`,
  status: "accepted"
})));
const refreshedLearningMemory = applyFeedbackDataset(fullLearningMemory.graph, [
  { kind: "concept", id: "bounded-0", label: "Bounded 0", status: "rejected" },
  { kind: "concept", id: "bounded-new", label: "Bounded new", status: "accepted" }
]);
assert(refreshedLearningMemory.graph.learning.examples.some((example) => example.id === "bounded-0" && example.status === "rejected"), "corrected learning decisions should remain in a full memory window");
assert(refreshedLearningMemory.graph.learning.examples.some((example) => example.id === "bounded-new"), "new learning decisions should be retained");
assert.equal(refreshedLearningMemory.graph.learning.examples.length, MAX_FEEDBACK_EXAMPLES, "learning memory should remain bounded after recency refresh");
const learningDataset = buildFeedbackDataset(emptyLearningImport.graph);
assert.equal(learningDataset.examples.length, 2, "feedback exports should preserve reusable learning memory");
assert(learningDataset.examples.every((example) => Number.isFinite(example.confidence) && Number.isInteger(example.feedback) && Array.isArray(example.evidence) && Array.isArray(example.sources)), "feedback exports should remain schema-compatible for learning-only examples");
assert(buildMarkdown(emptyLearningImport.graph).includes("### Reusable memory"), "Markdown projections should expose reusable learning memory");
const clearedLearning = clearLearningMemory(emptyLearningImport.graph);
assert.equal(clearedLearning.removed, 2, "learning memory clearing should report removed examples");
assert.equal(clearedLearning.graph.learning.examples.length, 0, "learning memory clearing should preserve the graph while removing guidance");
assert.equal(clearLearningMemory(clearedLearning.graph).changed, false, "clearing empty learning memory should be idempotent");
const zip = zipStore(vaultFiles);
assert.equal(zip[0], 0x50);
assert.equal(zip[1], 0x4b);
assert(zip.length > 100, "vault archive should contain file data");
assert.throws(() => zipStore([{ name: "large.md", content: "x".repeat(100) }], 10), /exceeds the 50 MB safety limit/, "vault exports should enforce the archive size limit");

console.log(`smoke ok: ${merged.nodes.length} concepts, ${merged.edges.length} relations`);
