import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildJsonLd, matchesJsonLdProjection } from "../jsonld-projection.js";
import {
  GRAPH_SCHEMA,
  REVISION_OPERATIONS,
  REVISION_EXTRACTORS,
  DIFF_FORMAT,
  MAX_DOCUMENT_CHARS,
  MAX_GRAPH_DOCUMENT_CHARS,
  defaultGraph,
  extractGraph,
  mergeExtraction,
  replaceSource,
  diffGraphs,
  redactGraph,
  normalizeGraph,
  parseJsonWithUniqueKeys,
  parseTimestamp,
  canonicalizeGraphForExport,
  buildBackupEnvelope,
  validateBackupEnvelope,
  buildGraphExport,
  compareGraphFreshness,
  normalizeExtraction,
  normalizeSourceUri,
  relationSemanticKey,
  fingerprintFeedbackExamples,
  syncLearningRelationLabels,
  fingerprintBackup,
  preferLearningExample,
  applyFeedback,
  applyFeedbackDataset,
  markSourceReviewed,
  mergeConcepts,
  buildExtractorFeedback,
  clearLearningMemory,
  clearStaleLearningMemory,
  removeSource,
  inspectGraph,
  reviewQueue,
  reviewQueueExport,
  buildHealthReport,
  validateHealthReport,
  feedbackContextStats,
  slugify,
  makeId,
  makeEdgeId,
  MAX_GRAPH_REVISIONS,
  MAX_BACKUP_HISTORY,
  MAX_GRAPH_DOCUMENTS,
  MAX_GRAPH_NODES,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_VERSION,
  advanceGraphVersion,
  MAX_ACTIVE_FEEDBACK_CONCEPTS,
  MAX_FEEDBACK_EXAMPLES,
  MAX_FEEDBACK_EXPORT_OMITTED,
  MAX_FEEDBACK_LABEL_CHARS,
  MAX_REVIEW_QUEUE_ITEMS,
  MAX_FEEDBACK_FINGERPRINT_EXAMPLES,
  MAX_EVIDENCE_CHARS,
  MAX_EVIDENCE_INPUT_ITEMS,
  MAX_EVIDENCE_RECORDS,
  MAX_SOURCE_REFERENCES,
  MAX_SOURCE_REFERENCE_DIAGNOSTICS,
  DEFAULT_GRAPH_TIMESTAMP,
  MAX_ID_CHARS,
  MAX_CONCEPT_LABEL_CHARS,
  MAX_DOCUMENT_TITLE_CHARS,
  MAX_JSON_DEPTH,
  MAX_JSON_KEY_DIAGNOSTIC_CHARS,
  MAX_PRODUCER_VERSION_CHARS,
  MAX_NODE_MENTIONS,
  MAX_FEEDBACK_COUNT,
  MAX_EXTRACTION_UNITS,
  MAX_WORDS_PER_UNIT,
  MAX_SEGMENTER_CHARS,
  MAX_EXTRACTION_CANDIDATES,
  MAX_EXTRACTION_TERM_CANDIDATES,
  MAX_PHRASE_CANDIDATES_PER_UNIT,
  sliceTextAtCodePointBoundary,
  MAX_RELATION_LABEL_CHARS,
  REVIEW_STALE_DAYS,
  MAX_TIMESTAMP_CHARS
} from "../graph-core.js";
import { MAX_PERSISTED_JSON_CHARS, createGraphStore } from "../graph-store.js";
import { parseObsidianFeedback } from "../projection-adapter.js";

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
const backupEnvelope = buildBackupEnvelope(defaultGraph(), [defaultGraph()], { appVersion: " 0.1.0 " });
assert.equal(backupEnvelope.appVersion, "0.1.0", "backup envelopes should retain a trimmed bounded producer version");
assert.equal(backupEnvelope.format, "llm-field-notes/backup@1", "backup envelopes should carry the shared backup format");
assert.match(backupEnvelope.graphFingerprint, /^fnv64-[0-9a-f]{16}-\d+$/, "backup envelopes should fingerprint their canonical graph and history");
assert.equal(MAX_BACKUP_HISTORY, 3, "full backup history should have an explicit schema-aligned bound");
assert.doesNotThrow(() => validateBackupEnvelope(backupEnvelope), "published backups should satisfy the shared strict envelope boundary");
assert.throws(
  () => validateBackupEnvelope({ ...backupEnvelope, history: "not-an-array" }),
  /history must contain at most 3 compatible graph snapshots/,
  "backup imports should reject a malformed history instead of treating it as empty"
);
assert.throws(
  () => validateBackupEnvelope({ ...backupEnvelope, unsupported: true }),
  /unsupported fields/,
  "backup imports should reject unsupported envelope fields instead of silently discarding them"
);
assert.throws(
  () => buildBackupEnvelope(defaultGraph(), Array.from({ length: MAX_BACKUP_HISTORY + 1 }, () => defaultGraph())),
  /cannot contain more than 3 snapshots/,
  "backup construction should reject history that exceeds the published backup schema"
);

const sourceText = `# Attention
Attention is a mechanism for mixing information.
Self-attention uses queries, keys, and values to gather context.
Queries, keys, and values create a weighted lookup over the context.
The Transformer uses attention to model relationships between tokens.`;
assert.equal(slugify("Hello, World!"), "hello-world");
assert.equal(slugify("注意 机制"), "注意-机制", "slugging should preserve Unicode concept identities");
const astralGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "astral-source", title: `a${"😀".repeat(100)}`, text: "unicode source" }],
  nodes: [{ id: "astral-node", label: `a${"😀".repeat(60)}` }]
});
assert.equal(astralGraph.documents[0].title, `a${"😀".repeat(99)}`, "graph normalization should not split astral source titles at the safety boundary");
assert.equal(astralGraph.nodes[0].label, `a${"😀".repeat(59)}`, "graph normalization should not split astral concept labels at the safety boundary");
assert(!/[\uD800-\uDBFF]$/.test(astralGraph.documents[0].title), "normalized graph titles should never end with a trailing high surrogate");
const astralDocumentText = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "astral-document-text", text: `${"x".repeat(MAX_DOCUMENT_CHARS - 1)}😀` }]
});
assert.equal(astralDocumentText.documents[0].text.length, MAX_DOCUMENT_CHARS - 1, "graph normalization should remove a split astral document-text code unit at the safety boundary");
assert(!/[\uD800-\uDBFF]$/.test(astralDocumentText.documents[0].text), "normalized document text should never end with a trailing high surrogate");
assert.equal(sliceTextAtCodePointBoundary(`a${"😀".repeat(20)}`, 20), `a${"😀".repeat(9)}`, "shared UI text truncation should preserve complete astral code points");
assert(!/[\uD800-\uDBFF]$/.test(sliceTextAtCodePointBoundary(`a${"😀".repeat(20)}`, 20)), "shared UI text truncation should never end with a trailing high surrogate");
const generatedId = makeId("test");
assert.match(generatedId, /^test-[a-z0-9-]+$/, "generated graph IDs should remain projection-safe");
assert.notEqual(makeId("test"), generatedId, "generated graph IDs should remain unique across consecutive calls");
assert(!fs.readFileSync(new URL("../graph-core.js", import.meta.url), "utf8").includes("Math.random()"), "ID generation should not fall back to weak Math.random entropy");
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
assert(extracted.nodes.some((node) => node.label.toLowerCase() === "attention"), "the extractor should retain repeated core concepts");
assert(!extracted.nodes.some((node) => ["different", "weighted", "invariant"].includes(node.label.toLowerCase())), "the extractor should omit isolated generic vocabulary when stronger concepts exist");
assert(extracted.nodes.some((node) => node.label.toLowerCase() === "weighted lookup"), "the extractor should retain useful lower-case multi-word concepts");
assert(!extracted.nodes.some((node) => node.label.toLowerCase() === "attention attention"), "headings should not be concatenated into prose concepts");
assert(extracted.nodes.every((node) => node.sources.includes(extracted.source.id)), "nodes should retain source evidence");
const normalizedSource = sourceText.replace(/\n+/g, " ");
assert(extracted.edges.some((edge) => edge.label === "uses"), "explicit relation verbs should be preserved");
assert(extracted.edges.every((edge) => edge.evidence.some((quote) => normalizedSource.includes(quote.text) && quote.sources.includes(extracted.source.id))), "relations should retain source sentence evidence");
const phraseQualityExtraction = extractGraph("Phrase quality", `# Production retrieval

> Observability reveals latency regressions before users report failures.

The service needs request tracing and bounded retries.
Reranking improves answer relevance.
The tokenizer maps rare words into reusable subword tokens.`);
const phraseLabels = phraseQualityExtraction.nodes.map((node) => node.label.toLowerCase());
assert(phraseLabels.includes("request tracing") && phraseLabels.includes("bounded retries"), "phrase extraction should retain durable domain noun phrases");
assert(!phraseLabels.some((label) => ["improves answer", "tokenizer maps", "regressions before", "before users"].includes(label)), "phrase extraction should avoid common verb and preposition fragments");
assert(phraseQualityExtraction.nodes.find((node) => node.label === "Production retrieval")?.evidence.some((evidence) => evidence.text.includes("# Production retrieval")), "heading-derived concepts should retain their source-line evidence");
const quotedExtraction = extractGraph("Quoted terms", "The `scaled attention` pattern uses a bounded context representation.");
assert(quotedExtraction.nodes.find((node) => node.label === "scaled attention")?.evidence.some((evidence) => evidence.text.includes("`scaled attention`")), "quoted concepts should retain their source-line evidence");
const relationQualityExtraction = extractGraph("Relation quality", "Reranking improves answer relevance. Positional encoding preserves sequence order. Caching reduces request latency. Batching increases system throughput.");
assert(relationQualityExtraction.nodes.some((node) => node.label.toLowerCase() === "positional encoding"), "sentence-initial domain phrases should remain intact");
assert(!relationQualityExtraction.nodes.some((node) => node.label === "Positional"), "subsumed sentence-initial terms should not duplicate a stronger phrase");
assert(relationQualityExtraction.edges.some((edge) => edge.label === "improves"), "explicit improvement relations should retain their verb");
assert(relationQualityExtraction.edges.some((edge) => edge.label === "preserves"), "explicit preservation relations should retain their verb");
assert(relationQualityExtraction.edges.some((edge) => edge.label === "reduces") && relationQualityExtraction.edges.some((edge) => edge.label === "increases"), "explicit operational relations should retain their verbs");
const reviewedRelationVerb = extractGraph("Reviewed relation verb", "Connects concepts in a reviewed representation.", {
  feedback: [{ kind: "concept", id: "connects", label: "Connects", status: "accepted" }]
});
assert(reviewedRelationVerb.nodes.some((node) => node.id === "connects" && node.feedback === 0), "phrase-boundary filtering should not suppress an explicitly accepted concept");
const clauseRelationExtraction = extractGraph("Clause relations", "Evaluation catches unsupported claims and measures answer quality.");
assert(clauseRelationExtraction.edges.some((edge) => edge.source === "evaluation" && edge.target === "answer-quality" && edge.label === "measures"), "shared-subject clauses should attach the later relation to the original subject");
assert(!clauseRelationExtraction.edges.some((edge) => edge.source === "claims" && edge.target === "answer-quality" && edge.label === "measures"), "shared-subject clauses should not attach later verbs to the prior object");
assert(!clauseRelationExtraction.nodes.some((node) => ["claims", "quality"].includes(node.label.toLowerCase())), "sparse extraction should not restore isolated terms beside stronger phrases");
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
assert.equal(normalizeSourceUri(`https://example.org/${"x".repeat(2048)}`), null, "oversized source URIs should fail closed instead of being truncated");
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
assert.equal(MAX_FEEDBACK_LABEL_CHARS, 120, "extractor feedback labels should have one shared length contract");
assert.equal(MAX_CONCEPT_LABEL_CHARS, MAX_FEEDBACK_LABEL_CHARS, "concept and feedback labels should share the graph contract bound");
assert.equal(MAX_REVIEW_QUEUE_ITEMS, 15000, "review queue capacity should have an explicit shared contract");
assert.equal(MAX_FEEDBACK_FINGERPRINT_EXAMPLES, 15000, "feedback fingerprints should have an explicit evaluation-size bound");
assert.equal(MAX_GRAPH_REVISIONS, 20, "graph revisions should have an explicit bounded contract");
assert.equal(MAX_GRAPH_DOCUMENT_CHARS, 50000000, "aggregate graph document text should have an explicit bounded contract");
const boundedBackupHistory = new Array(MAX_GRAPH_REVISIONS + 1).fill(defaultGraph());
Object.defineProperty(boundedBackupHistory, 0, { get() { throw new Error("evicted backup history was read"); } });
assert.doesNotThrow(() => fingerprintBackup(defaultGraph(), boundedBackupHistory), "backup fingerprints should skip history older than the retained tail");
const oversizedFingerprintHistory = Array.from({ length: MAX_GRAPH_REVISIONS + 1 }, (_, index) => normalizeGraph({
  schema: GRAPH_SCHEMA,
  version: index,
  nodes: [{ id: `fingerprint-history-${index}`, label: `Fingerprint history ${index}` }]
}));
const retainedFingerprintHistory = oversizedFingerprintHistory.slice(-MAX_GRAPH_REVISIONS);
assert.equal(
  fingerprintBackup(defaultGraph(), oversizedFingerprintHistory),
  fingerprintBackup(defaultGraph(), retainedFingerprintHistory),
  "backup fingerprints should bind the newest bounded history window"
);
const changedRetainedFingerprintHistory = oversizedFingerprintHistory.map((item) => normalizeGraph(item));
changedRetainedFingerprintHistory.at(-1).nodes[0].label = "Changed retained history";
assert.notEqual(
  fingerprintBackup(defaultGraph(), changedRetainedFingerprintHistory),
  fingerprintBackup(defaultGraph(), oversizedFingerprintHistory),
  "backup fingerprints should change when retained history changes"
);
assert.equal(MAX_ID_CHARS, 200, "graph identity fields should have an explicit bounded contract");
assert.equal(MAX_NODE_MENTIONS, 1000000, "concept mention counts should have an explicit bounded contract");
assert.equal(MAX_FEEDBACK_COUNT, 1000000, "feedback counters should have an explicit bounded contract");
assert.equal(MAX_EXTRACTION_UNITS, 10000, "heuristic extraction units should have an explicit bound");
assert.equal(MAX_WORDS_PER_UNIT, 5000, "heuristic extraction words should have an explicit per-unit bound");
assert.equal(MAX_SEGMENTER_CHARS, 20000, "Unicode segmentation should have an explicit character bound");
assert.equal(MAX_EXTRACTION_CANDIDATES, 20000, "heuristic extraction should have an explicit global candidate bound");
assert.equal(MAX_EXTRACTION_TERM_CANDIDATES, 18000, "heuristic extraction should reserve candidate capacity for phrases and structure");
const latePhraseText = `${Array.from({ length: 4 }, (_, row) => `${Array.from({ length: 5000 }, (_, index) => `word${row}_${index}`).join(" ")}.`).join("\n")}\n${Array.from({ length: 5 }, (_, index) => `Positional encoding preserves sequence order for layer ${index}.`).join("\n")}`;
assert(extractGraph("Late phrase budget", latePhraseText).nodes.some((node) => node.label === "Positional encoding"), "candidate budgets should reserve capacity for phrases after many generic terms");
assert.equal(MAX_PHRASE_CANDIDATES_PER_UNIT, 40, "phrase extraction should have an explicit per-unit candidate budget");
assert.doesNotThrow(() => extractGraph("Unicode volume", "注意 ".repeat(150000)), "large Unicode inputs should respect the bounded word path");
const punctuationLight = extractGraph("Punctuation-light Markdown", "# Attention map\n\n- Attention organizes context for useful representations\n- Context carries the evidence through the model");
assert(punctuationLight.nodes.length > 0, "heuristic extraction should handle bullet-heavy documents without sentence punctuation");
const sparseTitleExtraction = extractGraph("Transformer architecture", "A short note.");
assert.equal(sparseTitleExtraction.nodes[0]?.label, "Transformer architecture", "sparse documents should retain a bounded title topic");
assert.equal(sparseTitleExtraction.nodes[0]?.evidence.length, 0, "title-only topics must not fabricate body evidence");
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
assert.equal(parseTimestamp("2024-02-29T00:00:00.000Z"), Date.parse("2024-02-29T00:00:00.000Z"), "timestamp parsing should accept real leap-day calendar dates");
assert(Number.isNaN(parseTimestamp("2025-02-29T00:00:00.000Z")), "timestamp parsing should reject impossible leap-day calendar dates");
assert(Number.isNaN(parseTimestamp("2026-02-31T00:00:00.000Z")), "timestamp parsing should reject parser-rollover calendar dates");
assert.deepEqual(parseJsonWithUniqueKeys('{"a":1,"nested":{"b":2}}', "JSON smoke"), { a: 1, nested: { b: 2 } }, "JSON parsing should preserve valid nested objects");
assert.throws(
  () => parseJsonWithUniqueKeys('{"a":1,"a":2}', "JSON smoke"),
  /duplicate object key/,
  "JSON parsing should reject duplicate object keys instead of silently taking the last value"
);
const deeplyNestedJson = `${"[".repeat(MAX_JSON_DEPTH + 2)}0${"]".repeat(MAX_JSON_DEPTH + 2)}`;
assert.throws(
  () => parseJsonWithUniqueKeys(deeplyNestedJson, "JSON smoke"),
  /nesting limit/,
  "JSON parsing should reject excessive nesting before recursive work exhausts the call stack"
);
const oversizedJsonKey = "k".repeat(MAX_JSON_KEY_DIAGNOSTIC_CHARS + 40);
assert.throws(
  () => parseJsonWithUniqueKeys(`{"${oversizedJsonKey}":1,"${oversizedJsonKey}":2}`, "JSON smoke"),
  (error) => error?.message.length <= MAX_JSON_KEY_DIAGNOSTIC_CHARS + 80 && error?.message.includes("…"),
  "duplicate-key diagnostics should remain bounded even when an attacker submits an oversized key"
);
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
const equalTimestampLearningA = normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: {
    examples: [
      { kind: "concept", id: "equal-timestamp", label: "Equal timestamp", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" },
      { kind: "concept", id: "equal-timestamp", label: "Equal timestamp", status: "rejected", lastReviewedAt: "2026-01-01T00:00:00.000Z" }
    ]
  }
});
const equalTimestampLearningB = normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: {
    examples: [
      { kind: "concept", id: "equal-timestamp", label: "Equal timestamp", status: "rejected", lastReviewedAt: "2026-01-01T00:00:00.000Z" },
      { kind: "concept", id: "equal-timestamp", label: "Equal timestamp", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" }
    ]
  }
});
assert.deepEqual(equalTimestampLearningA.learning, equalTimestampLearningB.learning, "equal-timestamp learning conflicts should resolve independently of input order");
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
const boundedFingerprintAliases = new Array(21).fill("alias");
Object.defineProperty(boundedFingerprintAliases, 20, { get() { throw new Error("fingerprint alias beyond the bound was read"); } });
assert.doesNotThrow(() => fingerprintFeedbackExamples([{ kind: "concept", id: "bounded", label: "Bounded", aliases: boundedFingerprintAliases, status: "accepted" }]), "feedback fingerprints should stop reading aliases after their bound");
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
const reorderedProvenanceA = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [
    { id: "source-a", title: "A", text: "a" },
    { id: "source-b", title: "B", text: "b" }
  ],
  nodes: [{
    id: "provenance-order",
    label: "Provenance order",
    sources: ["source-b", "source-a"],
    evidence: [{ text: "same evidence", sources: ["source-b", "source-a"] }]
  }]
});
const reorderedProvenanceB = normalizeGraph({
  ...reorderedProvenanceA,
  nodes: [{
    ...reorderedProvenanceA.nodes[0],
    sources: ["source-a", "source-b"],
    evidence: [{ text: "same evidence", sources: ["source-a", "source-b"] }]
  }]
});
assert.deepEqual(reorderedProvenanceA.nodes[0].sources, ["source-a", "source-b"], "node provenance references should use canonical lexical ordering");
assert.deepEqual(reorderedProvenanceA.nodes[0].evidence[0].sources, ["source-a", "source-b"], "evidence provenance references should use canonical lexical ordering");
assert.equal(fingerprintBackup(reorderedProvenanceA), fingerprintBackup(reorderedProvenanceB), "reordering provenance references should not change graph identity");
const reorderedEvidenceA = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{
    id: "evidence-order",
    label: "Evidence order",
    evidence: [{ text: "zulu evidence" }, { text: "alpha evidence" }]
  }]
});
const reorderedEvidenceB = normalizeGraph({
  ...reorderedEvidenceA,
  nodes: [{
    ...reorderedEvidenceA.nodes[0],
    evidence: [{ text: "alpha evidence" }, { text: "zulu evidence" }]
  }]
});
assert.notDeepEqual(reorderedEvidenceA.nodes[0].evidence, reorderedEvidenceB.nodes[0].evidence, "runtime evidence order should remain available for display context");
assert.equal(fingerprintBackup(reorderedEvidenceA), fingerprintBackup(reorderedEvidenceB), "reordering evidence records should not change graph identity");
assert.equal(compareGraphFreshness(
  { schema: GRAPH_SCHEMA, version: 2, updatedAt: "2026-01-01T00:00:00.000Z" },
  { schema: GRAPH_SCHEMA, version: 3, updatedAt: "2025-01-01T00:00:00.000Z" }
), -1, "graph freshness should prioritize revision version over timestamp");
assert.equal(compareGraphFreshness(
  { schema: GRAPH_SCHEMA, version: 3, updatedAt: "2026-01-01T00:00:00.000Z" },
  { schema: GRAPH_SCHEMA, version: 3, updatedAt: "2026-02-01T00:00:00.000Z" }
), -1, "same-version graph freshness should use the normalized update timestamp");
assert.equal(compareGraphFreshness(
  { schema: GRAPH_SCHEMA, version: 3, updatedAt: "2099-01-01T00:00:00.000Z" },
  { schema: GRAPH_SCHEMA, version: 3, updatedAt: "2026-02-01T00:00:00.000Z" }
), -1, "future graph timestamps must not outrank trusted same-version freshness");
assert.equal(compareGraphFreshness(
  { schema: GRAPH_SCHEMA, version: 2, committedAt: "2026-03-01T00:00:00.000Z" },
  { schema: GRAPH_SCHEMA, version: 3, committedAt: "2026-02-01T00:00:00.000Z" }
), 1, "a newer committed undo or restore should outrank the older graph version it intentionally replaced");
const reorderedExportA = canonicalizeGraphForExport({
  ...reorderedEvidenceA,
  documents: [
    { id: "source-b", title: "B", text: "b" },
    { id: "source-a", title: "A", text: "a" }
  ],
  nodes: [
    { id: "zulu", label: "Zulu" },
    { id: "alpha", label: "Alpha" }
  ],
  edges: [
    { id: "zulu-alpha", source: "zulu", target: "alpha", label: "uses" }
  ]
});
const reorderedExportB = canonicalizeGraphForExport({
  ...reorderedExportA,
  documents: [...reorderedExportA.documents].reverse(),
  nodes: [...reorderedExportA.nodes].reverse(),
  edges: [...reorderedExportA.edges].reverse()
});
assert.deepEqual(reorderedExportA, reorderedExportB, "canonical graph exports should be byte-stable across top-level collection reordering");
assert.equal(
  JSON.stringify(buildJsonLd(reorderedExportA)),
  JSON.stringify(buildJsonLd(reorderedExportB)),
  "JSON-LD exports should be byte-stable across top-level collection reordering"
);
const integrityJsonLd = buildJsonLd(normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "jsonld-source", title: "JSON-LD source", text: "source text" }],
  nodes: [{
    id: "jsonld-node",
    label: "JSON-LD node",
    sources: Array.from({ length: MAX_SOURCE_REFERENCES + 1 }, (_, index) => `jsonld-source-${index}`)
  }]
}));
assert.equal(integrityJsonLd.integrity.truncated.sourceReferences, 1, "JSON-LD should disclose omitted provenance references");
assert.equal(integrityJsonLd.integrity.ambiguousSourceIds.length, 0, "JSON-LD integrity should preserve the bounded graph diagnostic shape");
const duplicateEvidence = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{
    id: "duplicate-evidence",
    label: "Duplicate evidence",
    evidence: [
      { text: "same quote", sources: ["source-b"] },
      { text: "same quote", sources: ["source-a"] }
    ]
  }]
});
assert.equal(duplicateEvidence.nodes[0].evidence.length, 1, "duplicate evidence quotes should share one bounded evidence record");
assert.deepEqual(duplicateEvidence.nodes[0].evidence[0].sources, ["source-a", "source-b"], "duplicate evidence quotes should merge all provenance references");
const boundedInputEvidence = new Array(MAX_EVIDENCE_INPUT_ITEMS + 1).fill({ text: "bounded evidence" });
Object.defineProperty(boundedInputEvidence, MAX_EVIDENCE_INPUT_ITEMS, { get() { throw new Error("evidence beyond the input bound was read"); } });
assert.doesNotThrow(() => normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "bounded", evidence: boundedInputEvidence }]
}), "evidence normalization should stop reading after its bound");
const duplicatePrefixEvidence = Array.from({ length: 9 }, () => ({ text: "repeated quote" }));
duplicatePrefixEvidence.push({ text: "unique quote after duplicates" });
const preservedUniqueEvidence = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "unique-evidence", label: "Unique evidence", evidence: duplicatePrefixEvidence }]
});
assert.equal(preservedUniqueEvidence.nodes[0].evidence.length, 2, "bounded evidence scanning should retain unique quotes after duplicate prefixes");
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
const preciseRejectedRelation = extractGraph("Precise relation feedback", "Alpha uses Beta for a useful representation. Alpha supports Beta for a useful representation.", {
  feedback: [
    { kind: "relation", source: "alpha", target: "beta", label: "uses", status: "rejected" }
  ]
});
assert(!preciseRejectedRelation.edges.some((edge) => edge.label === "uses"), "rejected relation feedback should suppress the matching inferred relation");
assert(preciseRejectedRelation.edges.some((edge) => edge.label === "supports"), "rejected relation feedback should preserve differently labeled inferred relations");
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
const paddedNodeFeedback = applyFeedback(merged, "node", ` ${merged.nodes[0].id} `, "up");
assert.equal(paddedNodeFeedback.changed, true, "feedback mutations should normalize caller-provided item IDs");
assert.equal(paddedNodeFeedback.graph.nodes.find((node) => node.id === merged.nodes[0].id).status, "accepted", "normalized feedback should reach the intended concept");
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
const paddedMergedConcepts = mergeConcepts(mergeableConcepts, " legacy-concept ", " canonical-concept ");
assert.equal(paddedMergedConcepts.changed, true, "concept merges should normalize caller-provided concept IDs");
assert.equal(paddedMergedConcepts.mergedId, "canonical-concept", "concept merges should report the canonical target ID");
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
assert.equal(health.evidenceGroundingAvailable, true);
assert.equal(health.evidenceGroundingCoverage, 100);
assert.equal(health.unanchoredEvidenceRecords, 0);
assert.equal(health.evidenceGroundingTruncated, false);
assert(health.evidenceGroundingSourceScanChars >= 0, "health should disclose bounded grounding source scan work");
assert.equal(health.reviewedItems, 0);
const unanchoredEvidenceHealth = inspectGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0
    ? { ...node, evidence: [{ text: "A provider paraphrase not present in the source.", sources: [merged.documents[0].id] }] }
    : node)
});
assert.equal(unanchoredEvidenceHealth.evidenceGroundingAvailable, true);
assert.equal(unanchoredEvidenceHealth.unanchoredEvidenceRecords, 1, "health should disclose evidence that is not an exact source anchor");
assert(unanchoredEvidenceHealth.evidenceGroundingCoverage < 100, "unanchored evidence should not count as fully grounded");
const unanchoredEvidenceCandidate = reviewQueue({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0
    ? { ...node, evidence: [{ text: "A provider paraphrase not present in the source.", sources: [merged.documents[0].id] }] }
    : node)
}, 15000).find((candidate) => candidate.kind === "node" && candidate.id === merged.nodes[0].id);
assert.equal(unanchoredEvidenceCandidate?.unanchoredEvidence, 1, "review queue should route unanchored evidence to the affected concept");
assert(unanchoredEvidenceCandidate?.reason.includes("unanchored evidence"), "review queue should explain evidence grounding gaps");
const redactedEvidenceHealth = inspectGraph(redactGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0
    ? { ...node, evidence: [{ text: "A provider paraphrase not present in the source.", sources: [merged.documents[0].id] }] }
    : node)
}));
assert.equal(redactedEvidenceHealth.evidenceGroundingAvailable, false, "redacted graphs should disclose that evidence grounding cannot be checked");
const cappedGroundingHealth = inspectGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "grounding-source", title: "Grounding source", text: "anchor", fingerprint: "grounding-source" }],
  nodes: Array.from({ length: 251 }, (_, index) => ({
    id: `grounding-${index}`,
    label: `Grounding ${index}`,
    sources: ["grounding-source"],
    evidence: Array.from({ length: 8 }, (_, evidenceIndex) => ({ text: `not an anchor ${evidenceIndex}`, sources: ["grounding-source"] }))
  })),
  edges: []
});
assert.equal(cappedGroundingHealth.evidenceGroundingCheckedRecords, 2000, "evidence grounding should inspect only its bounded record sample");
assert.equal(cappedGroundingHealth.evidenceGroundingTruncated, true, "health should disclose when evidence grounding was sampled");
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
assert.equal(queue.truncated, true, "review queues should disclose when a requested bound omits candidates");
assert(queue.some((candidate) => candidate.kind === "source"), "review queue should include unreviewed source metadata");
assert(queue.every((candidate) => Number.isFinite(candidate.priority) && candidate.reason), "review queue should expose bounded explainable priorities");
assert(queue[0].priority >= queue[1].priority, "review queue should prioritize the highest-risk review items");
assert(queue.find((candidate) => candidate.kind === "source")?.reason.includes("source quality unknown"), "source review candidates should explain unknown quality");
const sourceReview = markSourceReviewed(merged, merged.documents[0].id);
assert.equal(sourceReview.changed, true, "source review should update an existing source");
assert(sourceReview.graph.documents[0].lastReviewedAt, "source review should record a review timestamp");
assert.equal(sourceReview.graph.revisions[0].operation, "manual", "source review should remain visible in revision history");
assert.equal(sourceReview.graph.version, merged.version + 1, "source review should advance the graph revision");
const repeatedSourceReview = markSourceReviewed(sourceReview.graph, merged.documents[0].id);
assert.equal(repeatedSourceReview.changed, false, "repeating a same-day source review should be idempotent");
assert.equal(repeatedSourceReview.alreadyReviewed, true, "repeating a same-day source review should explain that no mutation was needed");
assert.equal(repeatedSourceReview.graph.version, sourceReview.graph.version, "repeating a same-day source review should not create a revision");
const futureReviewedSource = normalizeGraph({
  ...merged,
  documents: [{ ...merged.documents[0], lastReviewedAt: `${new Date().toISOString().slice(0, 10)}T23:59:59.000Z` }]
});
const repairedFutureReview = markSourceReviewed(futureReviewedSource, futureReviewedSource.documents[0].id);
assert.equal(repairedFutureReview.changed, true, "a future-dated same-day source review should be replaceable");
assert(repairedFutureReview.graph.documents[0].lastReviewedAt <= new Date().toISOString(), "source review should repair future chronology with the current timestamp");
const paddedSourceReview = markSourceReviewed(merged, ` ${merged.documents[0].id} `);
assert.equal(paddedSourceReview.changed, true, "source review should normalize caller-provided source IDs");
const exportedQueue = reviewQueueExport(merged, 15000);
assert(exportedQueue.length <= 15000, "review queue exports should remain bounded");
assert(exportedQueue.every((candidate) => candidate.id && candidate.reason && !("evidenceText" in candidate) && !("sourceText" in candidate) && !("uri" in candidate)), "review queue exports should contain routing metadata without source material");
const sharedHealthReport = buildHealthReport(merged, { appVersion: "test-build", inspectedAt: "2026-07-13T00:00:00.000Z" });
assert.equal(validateHealthReport(sharedHealthReport), true, "generated health reports should pass their runtime contract");
assert.throws(() => validateHealthReport({
  ...sharedHealthReport,
  health: { ...sharedHealthReport.health, rejectedEdges: Number.MAX_SAFE_INTEGER }
}), /rejectedEdges must be an integer from 0 to 10000/, "health validation should bound emitted relation diagnostics");
assert.throws(() => validateHealthReport({
  ...sharedHealthReport,
  health: { ...sharedHealthReport.health, sourceQuality: { unknown: 1, unexpected: 1 } }
}), /sourceQuality\.unexpected is not a supported source quality/, "health validation should reject unknown source-quality buckets");
assert.throws(() => validateHealthReport({
  ...sharedHealthReport,
  health: { ...sharedHealthReport.health, sourceQuality: { unknown: 2, primary: 1, secondary: 0, tertiary: 0 } }
}), /sourceQuality totals cannot exceed documents/, "health validation should reject inconsistent source-quality totals");
assert.throws(() => validateHealthReport({
  ...sharedHealthReport,
  health: { ...sharedHealthReport.health, supportedNodes: 1, unsupportedNodes: 1 }
}), /supportedNodes plus unsupportedNodes must equal activeNodes/, "health validation should reject inconsistent support totals");
assert.throws(() => validateHealthReport({
  ...sharedHealthReport,
  health: { ...sharedHealthReport.health, evidenceGroundingCheckedRecords: 1, anchoredEvidenceRecords: 1, unanchoredEvidenceRecords: 1 }
}), /anchoredEvidenceRecords plus unanchoredEvidenceRecords cannot exceed/, "health validation should reject inconsistent grounding totals");
assert.equal(validateHealthReport({
  ...sharedHealthReport,
  health: {
    ...sharedHealthReport.health,
    orphanedSourceReferences: MAX_SOURCE_REFERENCE_DIAGNOSTICS,
    ambiguousSourceReferences: MAX_SOURCE_REFERENCE_DIAGNOSTICS
  }
}), true, "health validation should accept the full direct-plus-evidence provenance diagnostic bound");
assert.equal(validateHealthReport({
  ...sharedHealthReport,
  health: {
    ...sharedHealthReport.health,
    feedbackContextAvailable: MAX_FEEDBACK_FINGERPRINT_EXAMPLES + MAX_FEEDBACK_EXAMPLES,
    feedbackContextExcluded: MAX_FEEDBACK_FINGERPRINT_EXAMPLES + MAX_FEEDBACK_EXAMPLES
  }
}), true, "health validation should accept the full live-plus-reusable guidance bound");
assert.throws(() => validateHealthReport({ ...sharedHealthReport, health: { ...sharedHealthReport.health, reviewedItems: 1, reviewedNodes: 1, reviewedEdges: 1 } }), /reviewedItems must equal/, "health validation should reject inconsistent derived counts");
assert.throws(() => validateHealthReport({ ...sharedHealthReport, health: { ...sharedHealthReport.health, reviewQueueTruncated: "yes" } }), /reviewQueueTruncated must be boolean/, "health validation should reject malformed boolean diagnostics");
assert.equal(validateHealthReport({ ...sharedHealthReport, gate: { passed: true, violations: [], thresholds: {} } }), true, "health validation should accept a passing quality gate");
assert.throws(() => validateHealthReport({ ...sharedHealthReport, gate: { passed: true, violations: ["unexpected failure"], thresholds: {} } }), /cannot pass with violations/, "health validation should reject contradictory quality gates");
assert.equal(sharedHealthReport.appVersion, "test-build", "shared health reports should retain bounded build provenance");
assert.equal(sharedHealthReport.inspectedAt, "2026-07-13T00:00:00.000Z", "shared health reports should accept deterministic inspection timestamps");
assert.deepEqual(sharedHealthReport.health, inspectGraph(merged, { now: Date.parse(sharedHealthReport.inspectedAt) }), "shared health reports should reuse one inspection-time health snapshot");
assert.match(buildHealthReport(merged, { inspectedAt: "not-a-date" }).inspectedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "shared health reports should repair invalid inspection timestamps");
const boundaryInspectionTime = "2026-07-13T00:00:00.000Z";
const boundaryReviewedAt = new Date(Date.parse(boundaryInspectionTime) - REVIEW_STALE_DAYS * 86400000).toISOString();
const boundaryGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "boundary-review", label: "Boundary review", status: "accepted", lastReviewedAt: boundaryReviewedAt }]
});
const boundaryHealthReport = buildHealthReport(boundaryGraph, { inspectedAt: boundaryInspectionTime });
assert.equal(boundaryHealthReport.health.staleReviewCandidates, 1, "health reports should classify exact stale-boundary reviews using their inspection timestamp");
assert(boundaryHealthReport.reviewQueue.some((candidate) => candidate.id === "boundary-review" && candidate.stale), "health report review queues should use the same inspection timestamp as health counts");
const boundaryGuidanceGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: { examples: [{ kind: "concept", id: "boundary-guidance", label: "Boundary guidance", status: "accepted", lastReviewedAt: boundaryReviewedAt }] }
});
assert.equal(feedbackContextStats(boundaryGuidanceGraph, { includeStale: false, now: Date.parse(boundaryInspectionTime) }).retained, 0, "fresh guidance stats should exclude examples exactly at the stale boundary");
assert.equal(buildExtractorFeedback(boundaryGuidanceGraph, { includeStale: false, now: Date.parse(boundaryInspectionTime) }).length, 0, "extractor guidance should use the caller's stale-boundary timestamp");
assert.equal(buildExtractorFeedback(boundaryGuidanceGraph, { includeStale: false, now: Date.parse(boundaryInspectionTime) - 1 }).length, 1, "guidance just before the stale boundary should remain eligible");
const tiedReviewQueue = reviewQueue(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [
    { id: "z-candidate", label: "Same label", confidence: .5, sources: [], evidence: [] },
    { id: "a-candidate", label: "Same label", confidence: .5, sources: [], evidence: [] }
  ]
}), 2).filter((candidate) => candidate.kind === "node");
assert.deepEqual(tiedReviewQueue.map((candidate) => candidate.id), ["a-candidate", "z-candidate"], "review queue ties should resolve by stable identity");
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
assert.equal(inspectGraph(staleReviewedGraph).feedbackContextAvailable, 0, "graph health should exclude explicitly stale live decisions from active extractor guidance");
const staleLearningHealth = inspectGraph(normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: {
    examples: [{ kind: "concept", id: "old-memory", label: "Old memory", status: "accepted", lastReviewedAt: "2020-01-01T00:00:00.000Z" }]
  }
}));
assert.equal(staleLearningHealth.staleLearningExamples, 1, "graph health should expose stale reusable learning examples");
assert.equal(staleLearningHealth.feedbackContextAvailable, 0, "graph health should exclude stale reusable memory from active extractor guidance");
assert.equal(staleLearningHealth.feedbackContextRetained, 0, "graph health should report no retained guidance when all reusable memory is stale");
assert.equal(staleLearningHealth.feedbackContextExcluded, 1, "graph health should disclose guidance withheld pending review");
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
const futureReviewTime = "2099-01-01T00:00:00.000Z";
const futureReviewedGraph = normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0
    ? { ...node, status: "accepted", lastReviewedAt: futureReviewTime }
    : node),
  learning: {
    examples: [{ kind: "concept", id: "future-memory", label: "Future memory", status: "accepted", lastReviewedAt: futureReviewTime }]
  }
});
const futureReviewHealth = inspectGraph(futureReviewedGraph, { now: Date.parse("2026-07-14T00:00:00.000Z") });
assert.equal(futureReviewHealth.staleLearningExamples, 1, "future-dated learning reviews should be treated as stale");
assert.equal(futureReviewHealth.feedbackContextAvailable, 0, "future-dated learning should not enter active extractor guidance");
assert.equal(buildExtractorFeedback(futureReviewedGraph, { includeStale: false, now: Date.parse("2026-07-14T00:00:00.000Z") }).length, 0, "future-dated learning should be withheld from extractor guidance");
assert.equal(futureReviewHealth.freshSourceReviewCoverage, 0, "future-dated source reviews must not count as fresh health coverage");
assert.equal(feedbackContextStats(futureReviewedGraph).retained, 0, "feedback context stats should default to the fresh-only boundary");
const futureReviewCandidate = reviewQueue(futureReviewedGraph, 15000, { now: Date.parse("2026-07-14T00:00:00.000Z") })
  .find((candidate) => candidate.kind === "node" && candidate.id === merged.nodes[0].id);
assert(futureReviewCandidate?.stale, "future-dated reviewed items should re-enter the review queue");
assert.match(futureReviewCandidate.reason, /timestamp is in the future/, "future review queue entries should explain why they are stale");
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
const newEvidenceGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  version: 1,
  documents: [{
    id: "new-evidence-source",
    title: "New evidence",
    text: "New evidence source text.",
    addedAt: "2026-07-10T00:00:00.000Z",
    quality: "primary",
    lastReviewedAt: "2026-07-01T00:00:00.000Z"
  }],
  nodes: [{
    id: "new-evidence-concept",
    label: "New evidence concept",
    status: "accepted",
    sources: ["new-evidence-source"],
    evidence: [{ text: "New evidence source text.", sources: ["new-evidence-source"] }],
    lastReviewedAt: "2026-07-01T00:00:00.000Z"
  }]
});
const newEvidenceCandidate = reviewQueue(newEvidenceGraph, 15000).find((candidate) => candidate.kind === "node" && candidate.id === "new-evidence-concept");
assert(newEvidenceCandidate?.newEvidence && newEvidenceCandidate.reason.includes("new evidence since review"), "review queue should prioritize newly added evidence before the stale window");
assert.equal(newEvidenceCandidate.stale, false, "new evidence should be distinct from time-stale review debt");
assert.equal(inspectGraph(newEvidenceGraph).newEvidenceReviewCandidates, 1, "graph health should report new-evidence review candidates separately");
const evidenceOnlyNewSourceGraph = normalizeGraph({
  ...newEvidenceGraph,
  nodes: [{
    ...newEvidenceGraph.nodes[0],
    sources: [],
    evidence: [{ text: "New evidence source text.", sources: ["new-evidence-source"] }]
  }]
});
assert(reviewQueue(evidenceOnlyNewSourceGraph, 15000).some((candidate) => candidate.id === "new-evidence-concept" && candidate.newEvidence), "new-evidence review should inspect evidence-level provenance when item sources are incomplete");
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
const inferredOnlyReplacementGraph = normalizeGraph({
  ...replacementGraph,
  nodes: replacementGraph.nodes.map((node) => ({ ...node, status: "inferred" })),
  edges: replacementGraph.edges.map((edge) => ({ ...edge, status: "inferred" }))
});
const emptySourceReplacement = replaceSource(inferredOnlyReplacementGraph, extracted.source.id, {
  source: { id: "empty-replacement", title: "Empty replacement", text: "replacement text" },
  nodes: [],
  edges: []
});
assert.equal(emptySourceReplacement.empty, true, "source replacement should reject an empty representation over existing source-linked knowledge");
assert.equal(emptySourceReplacement.replaced, false, "empty source replacement should not mutate the graph");
assert.equal(emptySourceReplacement.graph.version, inferredOnlyReplacementGraph.version, "empty source replacement should return the original graph revision");
const relationDroppingReplacement = replaceSource(inferredOnlyReplacementGraph, extracted.source.id, {
  source: { id: "relation-dropping-replacement", title: "Relation dropping replacement", text: "replacement text" },
  nodes: [{ id: "replacement-concept", label: "Replacement concept", sources: ["relation-dropping-replacement"], evidence: [{ text: "replacement evidence", sources: ["relation-dropping-replacement"] }] }],
  edges: []
});
assert.equal(relationDroppingReplacement.replaced, true, "explicit source replacement should allow intentional relation pruning");
assert.equal(relationDroppingReplacement.graph.version, inferredOnlyReplacementGraph.version + 1, "explicit relation pruning should record one replacement revision");
const guardedRelationDroppingReplacement = replaceSource(inferredOnlyReplacementGraph, extracted.source.id, {
  source: { id: "guarded-relation-dropping-replacement", title: "Guarded relation dropping replacement", text: "replacement text" },
  nodes: [{ id: "guarded-replacement-concept", label: "Guarded replacement concept", sources: ["guarded-relation-dropping-replacement"], evidence: [{ text: "replacement evidence", sources: ["guarded-relation-dropping-replacement"] }] }],
  edges: []
}, { preserveSourceCategories: true });
assert.equal(guardedRelationDroppingReplacement.replaced, false, "automatic source rebuilds should reject a representation that loses every prior source-linked relation");
assert.deepEqual(guardedRelationDroppingReplacement.degraded, ["relations"], "automatic source rebuilds should identify the source-linked category lost by a provider");
assert.equal(guardedRelationDroppingReplacement.graph.version, inferredOnlyReplacementGraph.version, "guarded category-degraded replacement should return the original graph revision");
const paddedReplacement = replaceSource(replacementGraph, ` ${extracted.source.id} `, {
  source: { id: "doc-padded-replacement", title: "Padded replacement", text: "replacement text with enough context to extract a new representation", fingerprint: "padded-replacement-1", addedAt: new Date().toISOString() },
  nodes: [{ id: "padded-replacement-node", label: "Padded replacement node", sources: ["doc-padded-replacement"], evidence: [{ text: "padded replacement evidence", sources: ["doc-padded-replacement"] }] }],
  edges: []
});
assert.equal(paddedReplacement.replaced, true, "source replacement should normalize caller-provided source IDs");
assert.equal(paddedReplacement.replacedSourceId, extracted.source.id, "source replacement should report the canonical source ID");
assert.equal(paddedReplacement.graph.nodes.find((node) => node.id === "padded-replacement-node")?.sources[0], extracted.source.id, "source replacement should rebind extracted provenance to the canonical source ID");
const paddedRemoval = removeSource(merged, ` ${extracted.source.id} `);
assert.equal(paddedRemoval.removed, true, "source removal should normalize caller-provided source IDs");
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
assert.equal(graphDiff.fromFingerprint, fingerprintBackup(defaultGraph()), "graph diffs should bind the source graph fingerprint");
assert.equal(graphDiff.toFingerprint, fingerprintBackup(merged), "graph diffs should bind the target graph fingerprint");
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
const integrityOnlyDiff = diffGraphs(defaultGraph(), normalizeGraph({
  schema: GRAPH_SCHEMA,
  integrity: {
    truncated: { nodes: 3 },
    dropped: { edges: 2 }
  }
}));
assert.equal(integrityOnlyDiff.integrity.truncated.after.nodes, 3, "graph diffs should preserve truncation diagnostics");
assert.equal(integrityOnlyDiff.integrity.dropped.after.edges, 2, "graph diffs should preserve dropped-entry diagnostics");
assert.equal(integrityOnlyDiff.integrity.truncated.changed, true, "graph diffs should disclose truncation-only changes");
assert.equal(integrityOnlyDiff.integrity.dropped.changed, true, "graph diffs should disclose malformed-entry-only changes");
assert.equal(integrityOnlyDiff.changed, true, "integrity-only changes should not export as unchanged");
const diffSchema = JSON.parse(fs.readFileSync(new URL("../schema/diff.schema.json", import.meta.url), "utf8"));
assert.deepEqual(
  Object.keys(integrityOnlyDiff.integrity).sort(),
  Object.keys(diffSchema.properties.integrity.properties).sort(),
  "graph diff output and its integrity schema should stay field-complete"
);
assert.deepEqual(
  Object.keys(integrityOnlyDiff.integrity.truncated.after).sort(),
  Object.keys(diffSchema.$defs.diagnosticCounts.properties).sort(),
  "graph diff diagnostic counters and their schema should stay field-complete"
);
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
assert(redactedGraph.documents.every((document) => document.title === "Redacted source"), "redacted graph exports should remove source document titles");
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
assert.equal(typeof graphStore.read().committedAt, "string", "graph mutations should retain a bounded persistence commit timestamp");
assert.equal(
  fingerprintBackup({ ...graphStore.read(), committedAt: "2026-01-01T00:00:00.000Z" }),
  fingerprintBackup(graphStore.read()),
  "persistence commit metadata should not change the graph content fingerprint"
);
assert.equal(graphStore.canUndo(), true);
const idempotentHistoryCount = graphStore.readHistory().length;
assert.equal(graphStore.write(graphStore.read()), true, "writing an unchanged graph should remain idempotent");
assert.equal(graphStore.readHistory().length, idempotentHistoryCount, "commit metadata alone must not create an undo revision");
const legacyShape = { ...graphStore.read() };
delete legacyShape.committedAt;
assert.equal(graphStore.write(legacyShape), true, "legacy graph shapes without commit metadata should remain writable");
assert.equal(typeof graphStore.read().committedAt, "string", "idempotent legacy writes should preserve the current commit metadata");
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
assert.equal(typeof graphStore.read().committedAt, "string", "backup restores should retain a persistence commit timestamp");
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
const duplicateGraph = '{"schema":"llm-field-notes/graph@1","version":0,"version":1,"nodes":[],"edges":[],"documents":[],"revisions":[]}';
storage.set("graph", duplicateGraph);
assert.equal(graphStore.read().version, 0, "duplicate-key persisted graphs should fail closed");
assert.equal(graphStore.readRecovery(), duplicateGraph, "duplicate-key persisted graphs should remain recoverable");
graphStore.clearRecovery();
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
const partialRollbackGraph = JSON.stringify(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "partial-rollback", label: "Partial rollback graph" }]
}));
const partialRollbackHistory = JSON.stringify([defaultGraph()]);
const partialRollbackStorage = new Map([
  ["partial-rollback-graph", partialRollbackGraph],
  ["partial-rollback-history", partialRollbackHistory]
]);
let partialRollbackMode = "normal";
let partialRollbackGraphRemovals = 0;
const partialRollbackAdapter = {
  getItem: (key) => partialRollbackStorage.has(key) ? partialRollbackStorage.get(key) : null,
  setItem: (key, value) => {
    if (key === "partial-rollback-history" && partialRollbackMode === "fail-history-rollback") {
      throw new Error("history rollback failure");
    }
    partialRollbackStorage.set(key, String(value));
    if (key === "partial-rollback-history" && partialRollbackMode === "normal") {
      partialRollbackMode = "fail-history-rollback";
    }
  },
  removeItem: (key) => {
    if (key === "partial-rollback-graph" && partialRollbackMode === "fail-history-rollback" && partialRollbackGraphRemovals++ === 0) {
      throw new Error("graph clear failure");
    }
    partialRollbackStorage.delete(key);
  }
};
const partialRollbackStore = createGraphStore(partialRollbackAdapter, {
  graphKey: "partial-rollback-graph",
  historyKey: "partial-rollback-history",
  recoveryKey: "partial-rollback-recovery",
  historyRecoveryKey: "partial-rollback-history-recovery"
});
assert.equal(partialRollbackStore.clear(), true, "clear should complete its degraded fallback after a partial rollback");
assert.equal(partialRollbackStore.getLastWriteMode(), "without-history", "partial rollback clear should disclose reduced recovery");
assert.equal(partialRollbackStore.readRecovery(), partialRollbackGraph, "partial rollback should preserve the raw graph before degraded clear");
assert.equal(partialRollbackStore.readHistoryRecovery(), partialRollbackHistory, "partial rollback should preserve the raw history before degraded clear");
storage.set("graph", JSON.stringify({ schema: "llm-field-notes/graph@999", nodes: [{ id: "lost", label: "Recover me" }] }));
assert.equal(graphStore.read().nodes.length, 0, "unsupported schema should fail closed");
assert(storage.get("recovery")?.includes("graph@999"), "unsupported schema should be preserved for recovery");
graphStore.clearRecovery();
storage.delete("graph");
storage.set("history", JSON.stringify(Array.from({ length: 100 }, () => defaultGraph())));
assert.equal(graphStore.readHistory().length, 3, "history should be bounded before normalization");
assert(graphStore.readHistoryRecovery()?.includes('"schema":"llm-field-notes/graph@1"'), "over-capacity history should remain available as a recovery snapshot");
assert.equal(graphStore.clearHistoryRecovery(), true);
storage.set("history", JSON.stringify([defaultGraph(), { schema: "not-a-graph", nodes: [{ id: "fake" }] }, null]));
assert.equal(graphStore.readHistory().length, 1, "malformed history snapshots should be discarded instead of becoming empty graphs");
assert(graphStore.readHistoryRecovery()?.includes("not-a-graph"), "malformed history should be preserved for recovery");
assert.equal(graphStore.clearHistoryRecovery(), true);
assert.equal(graphStore.readHistoryRecovery(), null);
const restoreRecoveryStorage = new Map();
const restoreRecoveryStore = createGraphStore({
  getItem: (key) => restoreRecoveryStorage.has(key) ? restoreRecoveryStorage.get(key) : null,
  setItem: (key, value) => restoreRecoveryStorage.set(key, String(value)),
  removeItem: (key) => restoreRecoveryStorage.delete(key)
}, {
  graphKey: "restore-graph",
  historyKey: "restore-history",
  historyRecoveryKey: "restore-history-recovery"
});
const oversizedRestoreHistory = Array.from({ length: 5 }, (_, index) => normalizeGraph({
  schema: GRAPH_SCHEMA,
  version: index,
  nodes: [{ id: `restore-history-${index}`, label: `Restore history ${index}` }]
}));
assert.equal(restoreRecoveryStore.restore(defaultGraph(), oversizedRestoreHistory), true, "backup restore should still apply a bounded history");
assert(restoreRecoveryStore.readHistoryRecovery()?.includes("restore-history-0"), "backup restore should preserve discarded over-capacity history for recovery");
const normalizedHistoryRecoveryStorage = new Map();
const normalizedHistoryRecoveryStore = createGraphStore({
  getItem: (key) => normalizedHistoryRecoveryStorage.has(key) ? normalizedHistoryRecoveryStorage.get(key) : null,
  setItem: (key, value) => normalizedHistoryRecoveryStorage.set(key, String(value)),
  removeItem: (key) => normalizedHistoryRecoveryStorage.delete(key)
}, {
  graphKey: "normalized-history-graph",
  historyKey: "normalized-history",
  historyRecoveryKey: "normalized-history-recovery"
});
const malformedHistorySnapshot = {
  schema: GRAPH_SCHEMA,
  documents: [null],
  nodes: [],
  edges: []
};
assert.equal(normalizedHistoryRecoveryStore.restore(defaultGraph(), [malformedHistorySnapshot]), true, "backup restore should apply history snapshots after normalization");
assert(normalizedHistoryRecoveryStore.readHistoryRecovery()?.includes('"documents":[null]'), "backup restore should preserve raw history when normalization drops malformed nested entries");
const incompleteGraphRestoreStorage = new Map();
const incompleteGraphRestoreStore = createGraphStore({
  getItem: (key) => incompleteGraphRestoreStorage.has(key) ? incompleteGraphRestoreStorage.get(key) : null,
  setItem: (key, value) => incompleteGraphRestoreStorage.set(key, String(value)),
  removeItem: (key) => incompleteGraphRestoreStorage.delete(key)
}, {
  graphKey: "incomplete-restore-graph",
  historyKey: "incomplete-restore-history",
  recoveryKey: "incomplete-restore-recovery"
});
assert.equal(incompleteGraphRestoreStore.restore({ schema: GRAPH_SCHEMA, documents: [null] }), true, "backup restore should accept and persist an inspectable incomplete graph");
assert(incompleteGraphRestoreStore.readRecovery()?.includes('"documents":[null]'), "programmatic graph restores should preserve the raw incomplete graph payload");
const preserveCurrentStore = createGraphStore({
  getItem: (key) => restoreRecoveryStorage.has(key) ? restoreRecoveryStorage.get(key) : null,
  setItem: (key, value) => restoreRecoveryStorage.set(key, String(value)),
  removeItem: (key) => restoreRecoveryStorage.delete(key)
}, {
  graphKey: "preserve-current-graph",
  historyKey: "preserve-current-history",
  historyRecoveryKey: "preserve-current-history-recovery",
  historyLimit: 1
});
const existingGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  version: 99,
  nodes: [{ id: "existing-before-restore", label: "Existing before restore" }]
});
assert.equal(preserveCurrentStore.write(existingGraph), true);
const fullIncomingHistory = [normalizeGraph({
  schema: GRAPH_SCHEMA,
  version: 100,
  nodes: [{ id: "incoming-history", label: "Incoming history" }]
})];
assert.equal(preserveCurrentStore.restore(defaultGraph(), fullIncomingHistory, { preserveCurrent: true }), true);
assert(preserveCurrentStore.readHistoryRecovery()?.includes("incoming-history"), "preserving the current graph should retain evicted imported history for recovery");
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
const graphFailureStorage = new Map();
let graphFailureEnabled = false;
const graphFailureAdapter = {
  getItem: (key) => graphFailureStorage.has(key) ? graphFailureStorage.get(key) : null,
  setItem: (key, value) => {
    if (graphFailureEnabled && key === "graph-failure-graph") throw new Error("graph quota");
    graphFailureStorage.set(key, String(value));
  },
  removeItem: (key) => graphFailureStorage.delete(key)
};
const graphFailureStore = createGraphStore(graphFailureAdapter, {
  graphKey: "graph-failure-graph",
  historyKey: "graph-failure-history",
  recoveryKey: "graph-failure-recovery",
  historyRecoveryKey: "graph-failure-history-recovery"
});
assert.equal(graphFailureStore.write(merged), true);
assert.equal(graphFailureStore.write(defaultGraph()), true);
const graphFailureHistory = graphFailureStore.readHistory();
assert.equal(graphFailureHistory.length, 2, "graph failure fixture should have undo history before the forced failure");
graphFailureEnabled = true;
assert.equal(graphFailureStore.write(merged), false, "a replacement graph write failure should report failure");
assert.equal(graphFailureStore.read().version, defaultGraph().version, "a failed replacement graph write should preserve the current graph");
assert.equal(graphFailureStore.readHistory().length, graphFailureHistory.length, "a failed replacement graph write should preserve undo history");
assert(graphFailureStore.readRecovery()?.includes('"schema":"llm-field-notes/graph@1"'), "failed graph rollback should preserve the previous graph for recovery");
const silentStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};
const silentStore = createGraphStore(silentStorage, {
  graphKey: "silent-graph",
  historyKey: "silent-history",
  recoveryKey: "silent-recovery"
});
assert.equal(silentStore.write(merged), false, "graph writes should fail when storage silently drops the requested value");
assert.equal(silentStore.getLastWriteMode(), "failed", "silent storage loss should expose a failed write mode");
assert.equal(silentStore.read().version, 0, "silent storage loss should not report an unsaved graph as current");

const snapshotFailureStorage = new Map();
let snapshotReadsFail = false;
const snapshotFailureAdapter = {
  getItem: (key) => {
    if (snapshotReadsFail) throw new Error("storage read failure");
    return snapshotFailureStorage.has(key) ? snapshotFailureStorage.get(key) : null;
  },
  setItem: (key, value) => snapshotFailureStorage.set(key, String(value)),
  removeItem: (key) => snapshotFailureStorage.delete(key)
};
const snapshotFailureStore = createGraphStore(snapshotFailureAdapter, {
  graphKey: "snapshot-failure-graph",
  historyKey: "snapshot-failure-history"
});
assert.equal(snapshotFailureStore.write(merged), true);
assert.equal(snapshotFailureStore.write(defaultGraph()), true);
const snapshotFailureGraphRaw = snapshotFailureStorage.get("snapshot-failure-graph");
const snapshotFailureHistoryRaw = snapshotFailureStorage.get("snapshot-failure-history");
snapshotReadsFail = true;
assert.equal(snapshotFailureStore.write(merged), false, "writes should fail closed when the pre-mutation storage snapshot cannot be read");
assert.equal(snapshotFailureStore.undo(), false, "undo should fail closed when the pre-mutation storage snapshot cannot be read");
assert.equal(snapshotFailureStore.restore(defaultGraph(), []), false, "restores should fail closed when the pre-mutation storage snapshot cannot be read");
assert.equal(snapshotFailureStore.clear(), false, "clear should fail closed when the pre-mutation storage snapshot cannot be read");
snapshotReadsFail = false;
assert.equal(snapshotFailureStorage.get("snapshot-failure-graph"), snapshotFailureGraphRaw, "snapshot read failures must not remove or overwrite the current graph");
assert.equal(snapshotFailureStorage.get("snapshot-failure-history"), snapshotFailureHistoryRaw, "snapshot read failures must not remove or overwrite undo history");

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
assert.equal(cappedIngest.graph.documents.length, cappedGraph.documents.length, "document-cap failures should not append the source");
assert.equal(cappedIngest.graph.nodes.length, cappedGraph.nodes.length, "document-cap failures should preserve the existing concept collection");
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
assert.equal(nodeCappedIngest.graph.nodes.length, nodeCappedGraph.nodes.length, "node-cap failures should preserve the existing concept collection");
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
assert.equal(edgeCappedIngest.graph.edges.length, edgeCappedGraph.edges.length, "edge-cap failures should preserve the existing relation collection");
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
const collidingFingerprintFirst = mergeExtraction(defaultGraph(), {
  source: { id: "collision-first", title: "Collision first", text: "Distinct first content.", fingerprint: "shared-custom-fingerprint" },
  nodes: [],
  edges: []
});
const collidingFingerprintSecond = mergeExtraction(collidingFingerprintFirst.graph, {
  source: { id: "collision-second", title: "Collision second", text: "Distinct second content.", fingerprint: "shared-custom-fingerprint" },
  nodes: [],
  edges: []
});
assert.equal(collidingFingerprintSecond.duplicate, false, "custom fingerprint collisions must not classify distinct source text as duplicates");
assert.equal(collidingFingerprintSecond.graph.documents.length, 2, "distinct source text must survive a custom fingerprint collision");
const importedFingerprintCollision = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [
    { id: "same-fingerprint", title: "Imported first", text: "Imported first content.", fingerprint: "shared-custom-fingerprint" },
    { id: "same-fingerprint", title: "Imported second", text: "Imported second content.", fingerprint: "shared-custom-fingerprint" }
  ]
});
assert.equal(importedFingerprintCollision.documents.length, 2, "normalization must not merge distinct documents solely because fingerprints match");
const deterministicCollisionExtraction = {
  source: { id: "provider-source", title: "Second source", text: "Second source content for the graph.", fingerprint: "second" },
  nodes: [{ id: "second-deterministic", label: "Second deterministic", sources: ["provider-source"], evidence: [{ text: "Second source content for the graph.", sources: ["provider-source"] }] }],
  edges: []
};
const collisionRepairId = normalizeExtraction({
  source: { title: deterministicCollisionExtraction.source.title, text: deterministicCollisionExtraction.source.text },
  nodes: [],
  edges: []
}).source.id;
const occupiedCollisionGraph = normalizeGraph({
  ...sourceCollisionFirst.graph,
  documents: [...sourceCollisionFirst.graph.documents, {
    id: collisionRepairId,
    title: "Occupied repair identity",
    text: "Occupied repair identity content.",
    fingerprint: "occupied-repair"
  }]
});
const deterministicCollisionA = mergeExtraction(occupiedCollisionGraph, deterministicCollisionExtraction);
const deterministicCollisionB = mergeExtraction(occupiedCollisionGraph, deterministicCollisionExtraction);
assert.equal(
  deterministicCollisionA.graph.documents.find((document) => document.text === deterministicCollisionExtraction.source.text)?.id,
  deterministicCollisionB.graph.documents.find((document) => document.text === deterministicCollisionExtraction.source.text)?.id,
  "source-ID collision repairs should remain deterministic when the content-derived ID is already occupied"
);
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
const ambiguousSourceRemoval = removeSource(ambiguousSourceReferences, "duplicate-source");
assert.equal(ambiguousSourceRemoval.removed, false, "source removal must fail closed for ambiguous imported source IDs");
assert.equal(ambiguousSourceRemoval.ambiguous, true, "ambiguous source removal should disclose the integrity conflict");
const ambiguousSourceReplacement = replaceSource(ambiguousSourceReferences, "duplicate-source", {
  source: { id: "replacement-source", title: "Replacement", text: "replacement content", fingerprint: "replacement-content" },
  nodes: [],
  edges: []
});
assert.equal(ambiguousSourceReplacement.replaced, false, "source replacement must fail closed for ambiguous imported source IDs");
assert.equal(ambiguousSourceReplacement.ambiguous, true, "ambiguous source replacement should disclose the integrity conflict");
const ambiguousSourceHealth = inspectGraph(ambiguousSourceReferences);
assert.equal(ambiguousSourceHealth.ambiguousSourceReferences, 2, "ambiguous provenance references should be counted separately");
assert.equal(ambiguousSourceHealth.provenanceCoverage, 0, "ambiguous provenance should not count as trustworthy coverage");
assert(!reviewQueue(ambiguousSourceReferences, 20).some((candidate) => candidate.kind === "source" && candidate.id === "duplicate-source"), "review queues must not expose ambiguous source IDs as actionable candidates");
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
const providerIdGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "canonical-concept", label: "Stable concept", sources: [], evidence: [] }]
});
const providerIdMerge = mergeExtraction(providerIdGraph, {
  source: { id: "provider-document", title: "Provider document", text: "Provider document contains enough text for a graph merge.", fingerprint: "provider-document" },
  nodes: [{ id: "provider-concept-v2", label: "Stable concept", sources: ["provider-document"], evidence: [{ text: "Stable concept", sources: ["provider-document"] }] }],
  edges: []
});
assert.equal(providerIdMerge.graph.nodes.length, 1, "unambiguous canonical labels should merge provider concepts across changing IDs");
assert.equal(providerIdMerge.graph.nodes[0].id, "canonical-concept", "canonical graph identity should remain authoritative when provider IDs change");
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
assert.equal(markSourceReviewed(versionLockedGraph, versionLockedGraph.documents[0].id).limited, "version", "source review should fail closed at the graph version ceiling");
assert.equal(applyFeedbackDataset(versionLockedGraph, [{ kind: "concept", id: versionLockedGraph.nodes[0].id, label: versionLockedGraph.nodes[0].label, status: "accepted" }]).limited, "version", "feedback imports should fail closed at the graph version ceiling");
assert.equal(JSON.stringify(versionLockedGraph), versionLockedSnapshot, "version-ceiling guards should not mutate the locked graph");
const feedbackVersionBoundaryGraph = normalizeGraph({ ...merged, version: MAX_GRAPH_VERSION - 1 });
const feedbackVersionBoundarySnapshot = JSON.stringify(feedbackVersionBoundaryGraph);
const feedbackVersionBoundary = applyFeedbackDataset(feedbackVersionBoundaryGraph, [
  { kind: "concept", id: feedbackVersionBoundaryGraph.nodes[0].id, label: feedbackVersionBoundaryGraph.nodes[0].label, status: "accepted" },
  { kind: "concept", id: feedbackVersionBoundaryGraph.nodes[1].id, label: feedbackVersionBoundaryGraph.nodes[1].label, status: "accepted" }
]);
assert.equal(feedbackVersionBoundary.limited, "version", "feedback datasets should reject an import that would exceed the revision ceiling");
assert.equal(feedbackVersionBoundary.changed, false, "revision-limited feedback datasets should report no committed changes");
assert.equal(JSON.stringify(feedbackVersionBoundary.graph), feedbackVersionBoundarySnapshot, "revision-limited feedback datasets should leave the graph untouched");
const unstableImportedGraph = {
  schema: GRAPH_SCHEMA,
  documents: [{ title: "Unstable source", text: "text" }],
  nodes: [{ id: "unstable", label: "Unstable" }],
  revisions: [{ reason: "unstable revision" }]
};
assert.deepEqual(normalizeGraph(unstableImportedGraph), normalizeGraph(unstableImportedGraph), "malformed graph repairs should be deterministic across reads");
const oversizedImportedGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: Array.from({ length: MAX_GRAPH_DOCUMENTS + 2 }, (_, index) => ({ id: `oversized-doc-${index}`, title: `Document ${index}`, text: "source text" })),
  nodes: Array.from({ length: MAX_GRAPH_NODES + 2 }, (_, index) => ({ id: `oversized-node-${index}`, label: `Concept ${index}` })),
  edges: Array.from({ length: MAX_GRAPH_EDGES + 2 }, (_, index) => ({ id: `oversized-edge-${index}`, source: "oversized-node-0", target: "oversized-node-1", label: `relates-${index}` })),
  revisions: Array.from({ length: MAX_GRAPH_REVISIONS + 2 }, (_, index) => ({ id: `oversized-revision-${index}`, reason: `Revision ${index}` })),
  learning: { examples: Array.from({ length: MAX_FEEDBACK_EXAMPLES + 2 }, (_, index) => ({ kind: "concept", id: `oversized-learning-${index}`, label: `Learning ${index}`, status: "accepted" })) }
});
assert.deepEqual(oversizedImportedGraph.integrity.truncated, {
  documents: 2,
  nodes: 2,
  edges: 2,
  revisions: 2,
  learningExamples: 2
}, "oversized graph imports should retain explicit per-collection truncation diagnostics");
const oversizedHealth = inspectGraph(oversizedImportedGraph);
assert.equal(oversizedHealth.truncated, true, "graph health should disclose bounded-import truncation");
assert.equal(oversizedHealth.truncatedItems, 10, "graph health should count all omitted import items");
const oversizedDocumentImport = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: Array.from({ length: MAX_GRAPH_DOCUMENTS + 1 }, (_, index) => ({
    id: `ordered-document-${index}`,
    title: `Ordered document ${index}`,
    text: `Ordered document content ${index}`,
    addedAt: new Date(Date.UTC(2023, 0, index + 1)).toISOString()
  }))
});
assert.equal(oversizedDocumentImport.documents.length, MAX_GRAPH_DOCUMENTS, "oversized document imports should retain the bounded collection size");
assert(oversizedDocumentImport.documents.some((document) => document.id === `ordered-document-${MAX_GRAPH_DOCUMENTS}`), "oversized document imports should retain the newest source");
assert(!oversizedDocumentImport.documents.some((document) => document.id === "ordered-document-0"), "oversized document imports should evict the oldest source first");
const futureRetentionImport = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [
    ...Array.from({ length: MAX_GRAPH_DOCUMENTS }, (_, index) => ({
      id: `trusted-source-${index}`,
      title: `Trusted source ${index}`,
      text: `trusted source ${index}`,
      addedAt: new Date(Date.UTC(2023, 0, index + 1)).toISOString()
    })),
    { id: "future-source", title: "Future source", text: "future source", addedAt: "2099-01-01T00:00:00.000Z" }
  ]
});
assert.equal(futureRetentionImport.documents.length, MAX_GRAPH_DOCUMENTS, "future retention fixture should exercise the bounded document window");
assert(!futureRetentionImport.documents.some((document) => document.id === "future-source"), "future-dated source metadata must not outrank trusted retention chronology");
const oversizedTextGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "long-document", title: "Long document", text: "x".repeat(MAX_DOCUMENT_CHARS + 1) }],
  nodes: [{
    id: "long-node",
    label: "Long node",
    evidence: [{ text: "e".repeat(MAX_EVIDENCE_CHARS + 1), sources: ["long-document"] }]
  }]
});
assert.equal(oversizedTextGraph.integrity.truncated.documentText, 1, "graph imports should disclose clipped document text");
assert.equal(oversizedTextGraph.integrity.truncated.evidenceText, 1, "graph imports should disclose clipped evidence text");
const oversizedTextHealth = inspectGraph(oversizedTextGraph);
assert.equal(oversizedTextHealth.truncatedDocumentText, 1, "graph health should expose clipped document text");
assert.equal(oversizedTextHealth.truncatedEvidenceText, 1, "graph health should expose clipped evidence text");
assert.equal(oversizedTextHealth.truncatedItems, 2, "graph health should count text-level truncation diagnostics");
const oversizedTitleGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "long-title-document", title: "t".repeat(MAX_DOCUMENT_TITLE_CHARS + 1), text: "source text" }]
});
assert.equal(oversizedTitleGraph.documents[0].title.length, MAX_DOCUMENT_TITLE_CHARS, "graph imports should bound oversized document titles");
assert.equal(oversizedTitleGraph.integrity.truncated.documentTitle, 1, "graph imports should disclose clipped document titles");
assert.equal(inspectGraph(oversizedTitleGraph).truncatedDocumentTitle, 1, "graph health should expose clipped document titles");
assert.equal(
  mergeExtraction(oversizedTitleGraph, { source: { title: "new", text: "new source" }, nodes: [], edges: [] }).limited,
  "document-text",
  "graphs with clipped document metadata should reject further mutation until repaired"
);
const oversizedProvenanceGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [{ id: "provenance-source", title: "Provenance source", text: "source text" }],
  nodes: [{
    id: "provenance-node",
    label: "Provenance node",
    sources: Array.from({ length: MAX_SOURCE_REFERENCES + 2 }, (_, index) => `source-${index}`),
    evidence: Array.from({ length: MAX_EVIDENCE_INPUT_ITEMS + 2 }, (_, index) => ({
      text: `evidence ${index}`,
      sources: Array.from({ length: MAX_SOURCE_REFERENCES + 1 }, (_, sourceIndex) => `evidence-source-${index}-${sourceIndex}`)
    }))
  }]
});
assert.equal(oversizedProvenanceGraph.nodes[0].evidence.length, MAX_EVIDENCE_RECORDS, "graph imports should retain only the published evidence-record bound");
assert.equal(oversizedProvenanceGraph.integrity.truncated.evidenceItems, MAX_EVIDENCE_INPUT_ITEMS + 2 - MAX_EVIDENCE_RECORDS, "graph imports should disclose omitted evidence records");
assert.equal(oversizedProvenanceGraph.integrity.truncated.sourceReferences, 2 + MAX_EVIDENCE_INPUT_ITEMS, "graph imports should disclose omitted provenance references");
const oversizedProvenanceHealth = inspectGraph(oversizedProvenanceGraph);
assert.equal(oversizedProvenanceHealth.truncatedEvidenceItems, MAX_EVIDENCE_INPUT_ITEMS + 2 - MAX_EVIDENCE_RECORDS, "graph health should expose omitted evidence records");
assert.equal(oversizedProvenanceHealth.truncatedSourceReferences, 2 + MAX_EVIDENCE_INPUT_ITEMS, "graph health should expose omitted provenance references");
assert.equal(oversizedProvenanceHealth.truncatedItems, MAX_EVIDENCE_INPUT_ITEMS + 2 - MAX_EVIDENCE_RECORDS + 2 + MAX_EVIDENCE_INPUT_ITEMS, "graph health should count nested provenance truncation diagnostics");
assert.equal(
  mergeExtraction(oversizedProvenanceGraph, { source: { title: "New source", text: "new source" }, nodes: [], edges: [] }).limited,
  "import-truncated",
  "graphs with nested provenance truncation should refuse new source merges"
);
assert.equal(
  replaceSource(oversizedProvenanceGraph, "provenance-source", { source: { title: "Replacement", text: "replacement source" }, nodes: [], edges: [] }).limited,
  "import-truncated",
  "graphs with nested provenance truncation should refuse source replacement"
);
const aggregateText = "aggregate source text ".repeat(Math.ceil(MAX_DOCUMENT_CHARS / 22));
const aggregateTextImport = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: Array.from({ length: Math.ceil(MAX_GRAPH_DOCUMENT_CHARS / MAX_DOCUMENT_CHARS) + 2 }, (_, index) => ({
    id: `aggregate-document-${index}`,
    title: `Aggregate document ${index}`,
    text: aggregateText,
    addedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString()
  }))
});
assert(
  aggregateTextImport.documents.reduce((total, document) => total + document.text.length, 0) <= MAX_GRAPH_DOCUMENT_CHARS,
  "graph imports should enforce the aggregate source-text budget"
);
assert(aggregateTextImport.integrity.truncated.documentText > 0, "aggregate source-text omissions should be disclosed");
assert(aggregateTextImport.documents.some((document) => document.id.endsWith(`${Math.ceil(MAX_GRAPH_DOCUMENT_CHARS / MAX_DOCUMENT_CHARS) + 1}`)), "aggregate source-text retention should prefer newest documents");
assert(!aggregateTextImport.documents.some((document) => document.id === "aggregate-document-0"), "aggregate source-text retention should omit the oldest documents first");
assert.equal(
  mergeExtraction(aggregateTextImport, { source: { id: "aggregate-new", title: "Aggregate new", text: "new source" }, nodes: [], edges: [] }).limited,
  "document-text",
  "graphs with aggregate source-text truncation should refuse new source merges"
);
assert.equal(
  replaceSource(aggregateTextImport, aggregateTextImport.documents.at(-1)?.id || "missing", { source: { title: "Replacement", text: "replacement source" }, nodes: [], edges: [] }).limited,
  "document-text",
  "graphs with aggregate source-text truncation should refuse source replacement"
);
const malformedImportedGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [null],
  nodes: [{ id: "valid-node", label: "Valid node" }, null, { id: "", label: "Missing ID" }],
  edges: [{ source: "valid-node", target: "missing-node", label: "dangling" }],
  revisions: [null],
  learning: { examples: [{ invalid: true }] }
});
assert.deepEqual(malformedImportedGraph.integrity.dropped, {
  documents: 1,
  nodes: 2,
  edges: 1,
  revisions: 1,
  learningExamples: 1
}, "malformed graph imports should retain explicit dropped-entry diagnostics");
const malformedHealth = inspectGraph(malformedImportedGraph);
assert.equal(malformedHealth.dropped, true, "graph health should disclose dropped malformed import entries");
assert.equal(malformedHealth.droppedItems, 6, "graph health should count every dropped malformed import entry");
assert.equal(
  mergeExtraction(malformedImportedGraph, { source: { id: "new-source", title: "New source", text: "A new source with enough content to test incomplete import protection." }, nodes: [], edges: [] }).limited,
  "import-truncated",
  "graphs with dropped malformed entries should refuse new source merges at the domain boundary"
);
assert.equal(
  replaceSource(malformedImportedGraph, "valid-node", { source: { title: "Replacement", text: "A replacement source with enough content to test incomplete import protection." }, nodes: [], edges: [] }).limited,
  "import-truncated",
  "graphs with dropped malformed entries should refuse source replacement at the domain boundary"
);
assert.equal(applyFeedback(malformedImportedGraph, "node", "valid-node", "up").limited, "import-truncated", "incomplete graphs should refuse feedback mutations at the domain boundary");
assert.equal(mergeConcepts(malformedImportedGraph, "valid-node", "missing-node").limited, "import-truncated", "incomplete graphs should refuse concept merges at the domain boundary");
assert.equal(removeSource(malformedImportedGraph, "dropped-source").limited, "import-truncated", "incomplete graphs should refuse source removal at the domain boundary");
assert.equal(clearLearningMemory(malformedImportedGraph).limited, "import-truncated", "incomplete graphs should refuse learning-memory mutations at the domain boundary");
const malformedLearningBeforeRetainedWindow = normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: {
    examples: [
      null,
      ...Array.from({ length: MAX_FEEDBACK_EXAMPLES }, (_, index) => ({
        kind: "concept",
        id: `retained-learning-${index}`,
        label: `Retained learning ${index}`,
        status: "accepted"
      }))
    ]
  }
});
assert.equal(malformedLearningBeforeRetainedWindow.learning.examples.length, MAX_FEEDBACK_EXAMPLES, "learning normalization should retain its newest bounded window");
assert.equal(malformedLearningBeforeRetainedWindow.integrity.dropped?.learningExamples || 0, 0, "learning diagnostics should ignore malformed entries evicted before the retained window");
const malformedLearningInsideRetainedWindow = normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: {
    examples: [
      ...Array.from({ length: MAX_FEEDBACK_EXAMPLES }, (_, index) => ({
        kind: "concept",
        id: `valid-learning-${index}`,
        label: `Valid learning ${index}`,
        status: "accepted"
      })),
      null
    ]
  }
});
assert.equal(malformedLearningInsideRetainedWindow.integrity.dropped?.learningExamples, 1, "learning diagnostics should count malformed entries inside the retained window");
const contradictoryImportedGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [
    { id: "contradictory", label: "Contradictory", status: "accepted" },
    { id: "contradictory", label: "Contradictory", status: "rejected" },
    { id: "other", label: "Other" }
  ],
  edges: [
    { id: "contradictory-edge-a", source: "contradictory", target: "other", label: "uses", status: "accepted" },
    { id: "contradictory-edge-b", source: "other", target: "contradictory", label: "USES", status: "rejected" }
  ]
});
assert.deepEqual(contradictoryImportedGraph.integrity.conflictingNodeIds, ["contradictory"], "duplicate concept status conflicts should remain auditable");
assert.deepEqual(contradictoryImportedGraph.integrity.conflictingEdgeIds, ["contradictory-edge-a", "contradictory-edge-b"], "duplicate relation status conflicts should retain both source identities");
const contradictoryHealth = inspectGraph(contradictoryImportedGraph);
assert.equal(contradictoryHealth.conflictingNodeIds, 1, "graph health should count contradictory concept identities");
assert.equal(contradictoryHealth.conflictingEdgeIds, 2, "graph health should count contradictory relation identities");
assert.equal(contradictoryHealth.conflictingItems, 3, "graph health should disclose all contradictory duplicate identities");
const contradictoryDiff = diffGraphs(defaultGraph(), contradictoryImportedGraph);
assert.deepEqual(contradictoryDiff.integrity.conflictingNodeIds.added, ["contradictory"], "graph diffs should preserve contradictory concept diagnostics");
assert.deepEqual(contradictoryDiff.integrity.conflictingEdgeIds.added, ["contradictory-edge-a", "contradictory-edge-b"], "graph diffs should preserve contradictory relation diagnostics");
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
const reorderedDuplicateGraphA = {
  schema: GRAPH_SCHEMA,
  nodes: [
    { id: "reordered", label: "Zulu", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "reordered", label: "Alpha", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "other", label: "Other" }
  ],
  edges: [
    { id: "z-edge", source: "reordered", target: "other", label: "uses" },
    { id: "a-edge", source: "other", target: "reordered", label: "USES" }
  ]
};
const reorderedDuplicateGraphB = {
  ...reorderedDuplicateGraphA,
  nodes: [...reorderedDuplicateGraphA.nodes].reverse(),
  edges: [...reorderedDuplicateGraphA.edges].reverse()
};
assert.equal(
  fingerprintBackup(reorderedDuplicateGraphA),
  fingerprintBackup(reorderedDuplicateGraphB),
  "reordering duplicate imported concepts and reverse relations should not change graph identity"
);
const reorderedExtractionA = normalizeExtraction({
  source: { id: "extraction-order", title: "Order", text: "A sufficiently long source text for a graph extraction test.", addedAt: "2026-01-01T00:00:00.000Z" },
  nodes: [
    { id: "same", label: "Zulu", sources: ["extraction-order"] },
    { id: "same", label: "Alpha", sources: ["extraction-order"] },
    { id: "other", label: "Other", sources: ["extraction-order"] }
  ],
  edges: [
    { id: "z-edge", source: "same", target: "other", label: "uses", sources: ["extraction-order"] },
    { id: "a-edge", source: "other", target: "same", label: "USES", sources: ["extraction-order"] }
  ]
});
const reorderedExtractionB = normalizeExtraction({
  source: { id: "extraction-order", title: "Order", text: "A sufficiently long source text for a graph extraction test.", addedAt: "2026-01-01T00:00:00.000Z" },
  nodes: [
    { id: "same", label: "Alpha", sources: ["extraction-order"] },
    { id: "same", label: "Zulu", sources: ["extraction-order"] },
    { id: "other", label: "Other", sources: ["extraction-order"] }
  ],
  edges: [
    { id: "a-edge", source: "other", target: "same", label: "USES", sources: ["extraction-order"] },
    { id: "z-edge", source: "same", target: "other", label: "uses", sources: ["extraction-order"] }
  ]
});
assert.deepEqual(reorderedExtractionA.nodes, reorderedExtractionB.nodes, "duplicate extraction concepts should normalize deterministically");
assert.deepEqual(reorderedExtractionA.edges, reorderedExtractionB.edges, "reverse extraction relations should normalize deterministically");
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
const reorderedDuplicateEdgeIdsA = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "left", label: "Left" }, { id: "right", label: "Right" }],
  edges: [
    { id: "same-edge", source: "left", target: "right", label: "uses" },
    { id: "same-edge", source: "left", target: "right", label: "supports" }
  ]
});
const reorderedDuplicateEdgeIdsB = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "left", label: "Left" }, { id: "right", label: "Right" }],
  edges: [
    { id: "same-edge", source: "left", target: "right", label: "supports" },
    { id: "same-edge", source: "left", target: "right", label: "uses" }
  ]
});
assert.equal(fingerprintBackup(reorderedDuplicateEdgeIdsA), fingerprintBackup(reorderedDuplicateEdgeIdsB), "duplicate relation-ID repairs should remain stable when imported relations are reordered");
assert.equal(reorderedDuplicateEdgeIdsA.edges.find((edge) => edge.label === "supports")?.id, reorderedDuplicateEdgeIdsB.edges.find((edge) => edge.label === "supports")?.id, "duplicate relation-ID suffixes should follow semantic identity rather than input order");
const collidingRelationIds = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "left", label: "Left" }, { id: "right", label: "Right" }],
  edges: [
    { id: "same-edge", source: "left", target: "right", label: "uses" },
    { id: "same-edge", source: "left", target: "right", label: "supports" },
    { id: "same-edge-2", source: "right", target: "left", label: "guides" }
  ]
});
assert.equal(new Set(collidingRelationIds.edges.map((edge) => edge.id)).size, collidingRelationIds.edges.length, "relation-ID repair should avoid collisions between explicit IDs and generated suffixes");
const reorderedAliasesA = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "alias-order", label: "Alias order", aliases: ["Zulu alias", "Alpha alias"] }]
});
const reorderedAliasesB = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "alias-order", label: "Alias order", aliases: ["Alpha alias", "Zulu alias"] }]
});
assert.deepEqual(reorderedAliasesA.nodes[0].aliases, ["Alpha alias", "Zulu alias"], "imported aliases should use canonical lexical ordering");
assert.equal(fingerprintBackup(reorderedAliasesA), fingerprintBackup(reorderedAliasesB), "reordering aliases should not change graph identity");
const ambiguousRelationLearning = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "left", label: "Left" }, { id: "right", label: "Right" }, { id: "other", label: "Other" }],
  edges: [
    { id: "ambiguous-edge", source: "left", target: "right", label: "uses" },
    { id: "ambiguous-edge", source: "left", target: "other", label: "supports" }
  ],
  learning: {
    examples: [{
      kind: "relation",
      id: "ambiguous-edge",
      source: "left",
      sourceLabel: "Left",
      target: "other",
      targetLabel: "Other",
      label: "supports",
      status: "accepted"
    }]
  }
});
assert.equal(ambiguousRelationLearning.integrity.ambiguousEdgeIds[0], "ambiguous-edge", "ambiguous relation IDs should remain disclosed in integrity diagnostics");
assert.equal(
  ambiguousRelationLearning.learning.examples[0].id,
  ambiguousRelationLearning.edges.find((edge) => edge.label === "supports")?.id,
  "ambiguous relation learning should remap by semantic endpoints and label instead of trusting the ambiguous ID"
);
const ambiguousRelationFeedback = applyFeedback(ambiguousRelationLearning, "edge", "ambiguous-edge", "up");
assert.equal(ambiguousRelationFeedback.changed, false, "edge feedback must refuse ambiguous imported relation IDs");
assert.equal(ambiguousRelationFeedback.ambiguous, true, "ambiguous edge feedback should disclose the integrity conflict");
const ambiguousRelationDataset = applyFeedbackDataset(ambiguousRelationLearning, [{
  kind: "relation",
  id: "ambiguous-edge",
  source: "left",
  sourceLabel: "Left",
  target: "other",
  targetLabel: "Other",
  label: "supports",
  status: "accepted"
}]);
assert.equal(ambiguousRelationDataset.changed, false, "bulk feedback must refuse ambiguous imported relation IDs");
assert.equal(ambiguousRelationDataset.skipped, 1, "ambiguous bulk relation feedback should be disclosed as skipped");
assert(!reviewQueue(ambiguousRelationLearning, 20).some((candidate) => candidate.kind === "edge" && candidate.id === "ambiguous-edge"), "review queues must not expose ambiguous relation IDs as actionable candidates");
const ambiguousGuidance = buildExtractorFeedback(normalizeGraph({
  ...ambiguousRelationLearning,
  edges: ambiguousRelationLearning.edges.map((edge) => edge.id === "ambiguous-edge" ? { ...edge, status: "accepted" } : edge)
}), { includeStale: true });
assert(!ambiguousGuidance.some((example) => example.kind === "relation" && example.id === "ambiguous-edge"), "extractor guidance must not teach from ambiguous relation IDs");
const orderedIntegrityA = normalizeGraph({
  schema: GRAPH_SCHEMA,
  integrity: { ambiguousSourceIds: ["source-z", "source-a"], ambiguousEdgeIds: ["edge-z", "edge-a"] }
});
const orderedIntegrityB = normalizeGraph({
  schema: GRAPH_SCHEMA,
  integrity: { ambiguousSourceIds: ["source-a", "source-z"], ambiguousEdgeIds: ["edge-a", "edge-z"] }
});
assert.deepEqual(orderedIntegrityA.integrity, orderedIntegrityB.integrity, "set-like integrity diagnostics should use stable export ordering");
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
const longConceptLabelA = `${"concept ".repeat(9)}alpha`;
const longConceptLabelB = `${"concept ".repeat(9)}beta`;
const longConceptExtraction = normalizeExtraction({
  source: { title: "Long concept labels", text: "A source document with enough text to retain distinct long concept labels." },
  nodes: [{ label: longConceptLabelA }, { label: longConceptLabelB }],
  edges: []
});
assert.equal(longConceptExtraction.nodes.length, 2, "normalization should retain distinct long concept labels");
assert.equal(new Set(longConceptExtraction.nodes.map((node) => node.id)).size, 2, "long concept labels should receive distinct stable IDs");
const longConceptProviderMerge = mergeExtraction(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "long-canonical", label: longConceptLabelA, sources: [], evidence: [] }]
}), {
  source: { id: "long-provider-document", title: "Long provider document", text: "Long provider document contains enough text for a graph merge.", fingerprint: "long-provider-document" },
  nodes: [{ id: "long-provider-v2", label: longConceptLabelA, sources: ["long-provider-document"], evidence: [] }],
  edges: []
});
assert.equal(longConceptProviderMerge.graph.nodes.length, 1, "long canonical labels should remain usable for provider-ID continuity");
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
assert.deepEqual([...REVISION_OPERATIONS], ["unknown", "migration", "ingest", "rebuild", "feedback", "learning", "manual", "projection", "source-removal"], "revision operations should have a stable bounded vocabulary");
assert.deepEqual([...REVISION_EXTRACTORS], ["unknown", "local", "remote"], "revision extractor provenance should have a stable bounded vocabulary");
assert.equal(normalizeGraph({ schema: GRAPH_SCHEMA, revisions: [{ operation: "provider-secret" }] }).revisions[0].operation, "unknown", "unknown revision operations should normalize to an audit-safe fallback");
assert.equal(normalizeGraph({ schema: GRAPH_SCHEMA, revisions: [{ operation: "provider-secret", extractor: "secret-provider" }] }).revisions[0].extractor, "unknown", "unknown revision extractors should normalize to an audit-safe fallback");
assert.equal(mergeExtraction(defaultGraph(), extractGraph("Operation tag", "Attention uses context to create a graph for review.")).graph.revisions[0].operation, "ingest", "ingestion revisions should identify their operation");
assert.equal(mergeExtraction(defaultGraph(), extractGraph("Operation tag", "Attention uses context to create a graph for review."), { revisionExtractor: "local" }).graph.revisions[0].extractor, "local", "local extraction revisions should identify their extractor lane");
assert.equal(mergeExtraction(defaultGraph(), extractGraph("Operation tag", "Attention uses context to create a graph for review."), { revisionOperation: "rebuild", revisionExtractor: "remote" }).graph.revisions[0].operation, "rebuild", "callers should be able to identify rebuild revisions");
assert.equal(mergeExtraction(defaultGraph(), extractGraph("Operation tag", "Attention uses context to create a graph for review."), { revisionOperation: "rebuild", revisionExtractor: "remote" }).graph.revisions[0].extractor, "remote", "remote rebuild revisions should identify their extractor lane");
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
assert.equal(oversizedAliases.integrity.truncated.aliases, 2, "graph imports should disclose clipped node and learning aliases");
assert.equal(inspectGraph(oversizedAliases).truncatedAliases, 2, "graph health should expose clipped alias diagnostics");
const mergedAliasClip = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [
    { id: "merged-alias", label: "First label", aliases: Array.from({ length: 20 }, (_, index) => `first-${index}`) },
    { id: "merged-alias", label: "Second label", aliases: Array.from({ length: 20 }, (_, index) => `second-${index}`) }
  ]
});
assert.equal(mergedAliasClip.nodes[0].aliases.length, 20, "duplicate concept merges should retain the alias bound");
assert(mergedAliasClip.integrity.truncated.aliases > 0, "duplicate concept merges should disclose aliases clipped during canonicalization");
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
const reorderedSourceCollision = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [
    { id: "collision", title: "Second", text: "beta", fingerprint: "b" },
    { id: "collision", title: "First", text: "alpha", fingerprint: "a" }
  ]
});
const orderedSourceCollision = normalizeGraph({
  schema: GRAPH_SCHEMA,
  documents: [
    { id: "collision", title: "First", text: "alpha", fingerprint: "a" },
    { id: "collision", title: "Second", text: "beta", fingerprint: "b" }
  ]
});
assert.equal(fingerprintBackup(reorderedSourceCollision), fingerprintBackup(orderedSourceCollision), "reordering conflicting source IDs should not change graph identity");
assert.equal(reorderedSourceCollision.documents.find((document) => document.id === "collision")?.fingerprint, "a", "source collision normalization should choose the same canonical record regardless of input order");
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
  DEFAULT_GRAPH_TIMESTAMP,
  MAX_PRODUCER_VERSION_CHARS,
  VAULT_FORMAT: "llm-field-notes/vault@1",
  FEEDBACK_FORMAT: "llm-field-notes/feedback@1",
  BACKUP_FORMAT: "llm-field-notes/backup@1",
  MAX_ZIP_BYTES: 50 * 1024 * 1024,
  MAX_ZIP_FILES: 5000 + 10000 + 1000 + 100,
  MAX_EXPORT_BYTES: 50 * 1024 * 1024,
  MAX_FEEDBACK_EXAMPLES,
  MAX_FEEDBACK_EXPORT_OMITTED,
  fingerprintFeedbackExamples,
  preferLearningExample,
  fingerprintBackup,
  canonicalizeGraphForExport,
  buildGraphExport,
  normalizeSourceUri,
  sliceTextAtCodePointBoundary,
  inspectGraph,
  buildJsonLd,
  matchesJsonLdProjection,
  parseTimestamp
};
sandbox.globalThis = sandbox;
vm.runInNewContext(`const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
${app.slice(projectionStart, projectionEnd)}
globalThis.__projectionTest = { buildVaultFiles, zipStore, downloadBytes, buildMarkdown, buildFeedbackDataset, buildCompactFeedbackDataset };`, sandbox);
const { buildVaultFiles, zipStore, downloadBytes, buildMarkdown, buildFeedbackDataset, buildCompactFeedbackDataset } = sandbox.__projectionTest;
assert(buildMarkdown(oversizedImportedGraph).includes("Import truncation: 10 items omitted"), "Markdown projections should disclose bounded-import truncation");
assert(buildMarkdown(oversizedImportedGraph).includes("Visual graph omits 4850 concepts and 9700 relations"), "Markdown projections should disclose bounded Mermaid omissions");
assert(buildMarkdown(malformedImportedGraph).includes("Malformed import entries: 6 items dropped"), "Markdown projections should disclose dropped malformed import entries");
assert(buildMarkdown(contradictoryImportedGraph).includes("Contradictory duplicate review records: 3 concept/relation entries"), "Markdown projections should disclose contradictory duplicate review records");
const vaultFiles = buildVaultFiles(merged, { appVersion: " 0.1.0 " });
assert.deepEqual(buildVaultFiles(defaultGraph()), buildVaultFiles(defaultGraph()), "empty graph vault exports should be byte-stable without a wall-clock timestamp");
assert.equal(
  JSON.parse(buildVaultFiles(defaultGraph()).find((file) => file.name === "vault-manifest.json")?.content || "{}").generatedAt,
  DEFAULT_GRAPH_TIMESTAMP,
  "empty graph vault manifests should use the deterministic graph timestamp"
);
assert(vaultFiles.find((file) => file.name === "README.md")?.content.includes("Open [[_index]]"), "Obsidian vaults should include orientation and round-trip instructions");
assert(vaultFiles.find((file) => file.name === "README.md")?.content.includes("[[Graph.canvas]]"), "Obsidian vaults should include a native Canvas viewer link");
assert(vaultFiles.find((file) => file.name === "README.md")?.content.includes("[[Learning/review-ledger]]"), "Obsidian vaults should link the reusable review ledger");
assert(vaultFiles.find((file) => file.name === "Learning/review-ledger.md")?.content.includes("type: learning-ledger"), "Obsidian vaults should export a versioned reusable review ledger");
assert(buildVaultFiles(acceptedKnowledge).find((file) => file.name === "Learning/review-ledger.md")?.content.includes("concept: [[Concepts/"), "review ledger entries should link back to projected concept notes");
const reviewedGraphWithoutDetachedMemory = normalizeGraph({
  ...acceptedKnowledge,
  learning: { examples: [] }
});
assert(
  buildVaultFiles(reviewedGraphWithoutDetachedMemory)
    .find((file) => file.name === "Learning/review-ledger.md")
    ?.content.includes("concept: [[Concepts/"),
  "Obsidian review ledgers should retain live reviewed decisions even when detached learning memory is absent"
);
const vaultManifest = JSON.parse(vaultFiles.find((file) => file.name === "vault-manifest.json")?.content || "{}");
assert.equal(vaultManifest.format, "llm-field-notes/vault@1", "Obsidian vaults should declare a versioned manifest contract");
assert.equal(vaultManifest.graphVersion, merged.version);
assert.equal(vaultManifest.graphFingerprint, fingerprintBackup(merged), "vault manifests should bind exports to the normalized graph fingerprint");
assert.equal(vaultManifest.appVersion, "0.1.0", "vault manifests should retain a trimmed bounded producer version");
const canvas = JSON.parse(vaultFiles.find((file) => file.name === "Graph.canvas")?.content || "{}");
assert.equal(canvas.nodes.length, merged.nodes.length, "Obsidian Canvas should contain one file card per concept");
assert.equal(canvas.edges.length, merged.edges.length, "Obsidian Canvas should contain one edge per relation");
assert(canvas.nodes.every((node) => node.type === "file" && typeof node.file === "string" && node.file.startsWith("Concepts/")), "Obsidian Canvas concept cards should target projected concept notes");
assert(canvas.edges.every((edge) => typeof edge.fromNode === "string" && typeof edge.toNode === "string" && typeof edge.label === "string"), "Obsidian Canvas relations should retain bounded endpoints and labels");
assert.deepEqual(JSON.parse(buildVaultFiles(merged).find((file) => file.name === "Graph.canvas")?.content || "{}"), canvas, "Obsidian Canvas exports should be deterministic");
const orphanedProjection = buildVaultFiles({
  ...merged,
  edges: [...merged.edges, {
    ...merged.edges[0],
    id: "orphaned-relation",
    source: "missing-concept"
  }]
});
const orphanedCanvas = JSON.parse(orphanedProjection.find((file) => file.name === "Graph.canvas")?.content || "{}");
assert.equal(orphanedCanvas.edges.length, merged.edges.length + 1, "Obsidian Canvas should preserve relations with unresolved endpoints");
assert(orphanedCanvas.nodes.some((node) => node.type === "text" && node.text.includes("Unresolved concept endpoint")), "Obsidian Canvas should disclose unresolved relation endpoints instead of dropping edges");
const orphanedRelationNote = orphanedProjection.find((file) => file.name.includes("orphaned-relation"))?.content || "";
assert(orphanedRelationNote.includes("Unresolved concept: missing-concept") && !orphanedRelationNote.includes("[[undefined"), "Obsidian relation notes should use explicit unresolved-endpoint text instead of broken links");
assert.equal(new Set(orphanedCanvas.nodes.map((node) => node.id)).size, orphanedCanvas.nodes.length, "Obsidian Canvas node identities should be unique");
assert(orphanedCanvas.edges.every((edge) => orphanedCanvas.nodes.some((node) => node.id === edge.fromNode) && orphanedCanvas.nodes.some((node) => node.id === edge.toNode)), "Obsidian Canvas edges should reference existing node identities");
const vaultGraphJson = JSON.parse(vaultFiles.find((file) => file.name === "graph.json")?.content || "{}");
assert.equal(vaultGraphJson.graphFingerprint, fingerprintBackup(merged), "vault graph JSON should carry the same integrity fingerprint as its manifest");
assert.equal(vaultGraphJson.appVersion, "0.1.0", "vault graph JSON should retain bounded producer-version metadata");
assert.equal(vaultManifest.generatedAt, merged.updatedAt, "vault manifests should use the graph revision timestamp for reproducible exports");
assert.deepEqual(buildVaultFiles(merged), buildVaultFiles(merged), "identical graph exports should be byte-for-byte reproducible");
assert.equal(JSON.parse(vaultFiles.find((file) => file.name === "graph.jsonld")?.content || "{}").format, "llm-field-notes/jsonld@1", "Obsidian vaults should include the versioned JSON-LD projection");
const directGraphExport = buildGraphExport(merged, { appVersion: " 0.1.0 " });
assert.equal(directGraphExport.appVersion, "0.1.0", "direct graph exports should retain a trimmed producer version");
assert.equal(directGraphExport.graphFingerprint, fingerprintBackup(merged), "direct graph exports should bind their fingerprint to normalized graph contents");
assert.deepEqual(buildGraphExport(merged), buildGraphExport(merged), "direct graph exports should be deterministic");
assert(vaultFiles.some((file) => file.name === "_index.md"));
assert(vaultFiles.some((file) => file.name.startsWith("Concepts/")));
assert(vaultFiles.find((file) => file.name.startsWith("Concepts/"))?.content.includes("graph_fingerprint:"), "individual concept notes should retain projection identity");
const editableVaultNotes = vaultFiles.filter((file) => /^(?:Concepts|Relations)\/[^/]+\.md$/.test(file.name));
assert(editableVaultNotes.length > 0, "vault exports should include editable concept or relation notes");
assert.equal(editableVaultNotes.filter((file) => !parseObsidianFeedback(file.content)).length, 0, "every generated editable Obsidian note should be accepted by the importer");
assert(buildMarkdown(sourceMetadata).includes("primary quality"), "Markdown projections should expose source quality");
assert(buildMarkdown(sourceMetadata).includes("[https://example.org/reviewed-source](<https://example.org/reviewed-source>)"), "Markdown projections should make safe HTTP source URIs clickable");
assert(buildVaultFiles(sourceMetadata).find((file) => file.name.startsWith("Sources/"))?.content.includes("Source URI: [https://example.org/reviewed-source](<https://example.org/reviewed-source>)"), "Obsidian source notes should make safe HTTP source URIs clickable");
const credentialProjection = buildMarkdown({
  ...sourceMetadata,
  documents: sourceMetadata.documents.map((document) => ({ ...document, uri: "https://user:password@example.org/private" }))
});
assert(!credentialProjection.includes('href="https://user:password@example.org/private"') && !credentialProjection.includes("[https://user:password@example.org/private]("), "browser projections should not render credential-bearing source links");
assert(vaultFiles.some((file) => file.name.startsWith("Sources/")));
assert(vaultFiles.find((file) => file.name.startsWith("Sources/"))?.content.includes("fingerprint:"), "source notes should bind metadata edits to the source fingerprint");
assert(buildMarkdown(merged).includes("[[Concepts/"), "index should contain Obsidian concept links");
assert(buildMarkdown(merged).includes(`fingerprint: ${fingerprintBackup(merged)}`), "Markdown projections should bind their frontmatter to the normalized graph fingerprint");
assert(buildMarkdown(merged, { graphFingerprint: "fnv64-0000000000000000-0" }).includes("fingerprint: fnv64-0000000000000000-0"), "Markdown projections should accept a precomputed graph fingerprint");
assert(buildMarkdown(merged).includes("## Graph health") && buildMarkdown(merged).includes("Active-item provenance coverage: 100%"), "Markdown projections should expose privacy-safe graph health diagnostics");
assert(buildMarkdown(merged).includes(merged.nodes[0].evidence[0].text), "Markdown projections should preserve concept evidence");
assert(buildMarkdown(merged, { maxEvidenceChars: 1 }).includes("Evidence preview truncated"), "Markdown previews should bound evidence rendering");
assert(buildMarkdown(merged).includes("## Revision history"), "Markdown projections should preserve revision history");
const jsonLd = buildJsonLd(sourceMetadata, { appVersion: " 0.1.0 " });
assert.equal(jsonLd["@type"], "schema:Dataset", "JSON-LD projections should declare a dataset root");
assert.equal(jsonLd.format, "llm-field-notes/jsonld@1", "JSON-LD projections should declare their versioned contract");
assert.equal(jsonLd.graphSchema, GRAPH_SCHEMA);
assert.equal(jsonLd.learningExampleCount, sourceMetadata.learning.examples.length, "JSON-LD roots should disclose reusable learning memory size");
assert.equal(jsonLd.appVersion, "0.1.0", "JSON-LD roots should retain a trimmed bounded producer version");
for (const contextTerm of ["graphUpdatedAt", "revisionCount", "learningExampleCount", "kind", "concept", "sourceConcept", "targetConcept", "sourceLabel", "targetLabel", "relation"]) {
  assert(Object.hasOwn(jsonLd["@context"], contextTerm), `JSON-LD context should declare ${contextTerm}`);
}
for (const contextTerm of ["version", "timestamp", "reason", "operation", "extractor", "nodes", "edges"]) {
  assert(Object.hasOwn(jsonLd["@context"], contextTerm), `JSON-LD context should declare revision term ${contextTerm}`);
}
assert.equal(buildJsonLd({ schema: GRAPH_SCHEMA })["@graph"].length, 0, "JSON-LD projection should normalize sparse graph inputs at its boundary");
assert.equal(jsonLd.fingerprint, fingerprintBackup(sourceMetadata), "JSON-LD projections should bind to the normalized graph fingerprint");
assert.equal(matchesJsonLdProjection(sourceMetadata, jsonLd), true, "JSON-LD projections should verify against their normalized graph");
assert.equal(matchesJsonLdProjection(sourceMetadata, buildJsonLd(sourceMetadata)), true, "JSON-LD verification should preserve compatibility with older projections without producer metadata");
assert.equal(matchesJsonLdProjection(sourceMetadata, { ...jsonLd, "@graph": [...jsonLd["@graph"]].reverse() }), true, "JSON-LD verification should ignore unordered graph-member order");
const reorderedJsonLdGraph = [...jsonLd["@graph"]];
reorderedJsonLdGraph.unshift(...reorderedJsonLdGraph.splice(1));
assert.equal(matchesJsonLdProjection(sourceMetadata, { ...jsonLd, "@graph": reorderedJsonLdGraph }), true, "JSON-LD verification should use locale-independent canonical ordering");
let deeplyNestedJsonLd = {};
for (let depth = 0; depth <= 64; depth += 1) deeplyNestedJsonLd = { nested: deeplyNestedJsonLd };
assert.equal(matchesJsonLdProjection(sourceMetadata, deeplyNestedJsonLd), false, "JSON-LD verification should fail closed on excessive nesting");
assert(jsonLd["@graph"].some((item) => item["@type"] === "schema:CreativeWork" && item.text === "Reviewed source text" && item["lfn:sourceFingerprint"] === sourceMetadata.documents[0].fingerprint && item["lfn:addedAt"] === sourceMetadata.documents[0].addedAt), "full JSON-LD projections should preserve source text, identity, and chronology");
const relationJsonLd = buildJsonLd(merged);
assert(relationJsonLd["@graph"].some((item) => item["@type"] === "lfn:Relation" && item.source && item.target), "JSON-LD projections should preserve relation endpoints");
const revisionJsonLd = relationJsonLd["@graph"].find((item) => item["@type"] === "lfn:Revision");
assert(revisionJsonLd && revisionJsonLd.reason && revisionJsonLd.operation && revisionJsonLd.extractor && revisionJsonLd.timestamp, "JSON-LD projections should preserve revision audit metadata");
assert.equal(revisionJsonLd.operation, merged.revisions[0].operation, "JSON-LD revisions should preserve operation provenance");
assert.equal(revisionJsonLd.extractor, merged.revisions[0].extractor, "JSON-LD revisions should preserve extractor provenance");
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
const collidingJsonLdGraph = normalizeGraph({
  ...defaultGraph(),
  nodes: [
    { id: "same/id", label: "Slash identity" },
    { id: "same-2f-id", label: "Escaped-looking identity" }
  ]
});
const collidingJsonLdIds = buildJsonLd(collidingJsonLdGraph)["@graph"].map((item) => item["@id"]);
assert.equal(new Set(collidingJsonLdIds).size, collidingJsonLdIds.length, "JSON-LD entity IDs should remain unique when graph IDs resemble escaped values");
assert.equal(matchesJsonLdProjection(collidingJsonLdGraph, buildJsonLd(collidingJsonLdGraph)), true, "JSON-LD collision-resistant IDs should remain verifiable");
const redactedJsonLd = buildJsonLd(redactGraph(merged));
assert.equal(redactedJsonLd.redacted, true, "redacted JSON-LD projections should disclose their privacy state");
assert(redactedJsonLd["@graph"].filter((item) => item["@type"] === "schema:CreativeWork").every((item) => !Object.hasOwn(item, "text")), "redacted JSON-LD projections should remove source text");
assert(redactedJsonLd["@graph"].filter((item) => Array.isArray(item["@type"]) && item["@type"].includes("lfn:Concept")).every((item) => item.evidence.length === 0), "redacted JSON-LD projections should remove evidence quotes");
assert(buildVaultFiles(rejectedGraph).some((file) => file.content.includes("status: rejected")), "rejected concepts should remain exportable");
const redactedVaultFiles = buildVaultFiles(redactGraph(sourceMetadata));
const redactedMarkdownProjection = buildMarkdown(redactGraph(sourceMetadata));
assert(!redactedMarkdownProjection.includes("Reviewed source text") && !redactedMarkdownProjection.includes("https://example.org/reviewed-source"), "redacted Markdown projections should remove source text and URIs");
assert(redactedVaultFiles.find((file) => file.name === "README.md")?.content.includes("redacted projection"), "redacted vault instructions should disclose the projection boundary");
assert.equal(JSON.parse(redactedVaultFiles.find((file) => file.name === "vault-manifest.json")?.content || "{}").redacted, true, "redacted vault manifests should preserve the privacy boundary");
assert(redactedVaultFiles.find((file) => file.name.startsWith("Sources/"))?.content.includes('uri: ""'), "redacted vault source notes should remove source URIs");
assert(!redactedVaultFiles.find((file) => file.name.startsWith("Sources/"))?.content.includes("Reviewed source text"), "redacted vault source notes should remove source text");
assert(!redactedVaultFiles.find((file) => file.name.startsWith("Sources/"))?.content.includes("Reviewed source"), "redacted vault source notes should remove source document titles");
assert(JSON.parse(redactedVaultFiles.find((file) => file.name === "graph.json")?.content || "{}").learning.examples.every((example) => example.evidence.every((evidence) => evidence.text === "[redacted]")), "redacted vault graph JSON should remove reusable-learning evidence quotes");
assert(redactedVaultFiles.every((file) => !file.content.includes("Reviewed source text") && !file.content.includes("https://example.org/reviewed-source")), "redacted vault files should not leak source text or URIs through any projection file");
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
const reorderedPathGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  updatedAt: "2026-07-13T00:00:00.000Z",
  nodes: [
    { id: "alpha-concept", label: "Lower alpha" },
    { id: "Alpha Concept", label: "Upper alpha" }
  ]
});
const reversedPathGraph = normalizeGraph({
  ...reorderedPathGraph,
  nodes: [...reorderedPathGraph.nodes].reverse()
});
assert.deepEqual(buildVaultFiles(reorderedPathGraph), buildVaultFiles(reversedPathGraph), "Obsidian vault exports should remain byte-stable when graph collections are reordered");
assert.equal(buildMarkdown(reorderedPathGraph), buildMarkdown(reversedPathGraph), "direct Markdown exports should remain byte-stable when graph collections are reordered");
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
const reorderedFeedbackDataset = buildFeedbackDataset({
  ...acceptedKnowledge,
  nodes: [...acceptedKnowledge.nodes].reverse(),
  edges: [...acceptedKnowledge.edges].reverse()
});
assert.deepEqual(feedbackDataset.examples, reorderedFeedbackDataset.examples, "feedback exports should remain stable when graph collections are reordered");
assert.equal(feedbackDataset.datasetFingerprint, reorderedFeedbackDataset.datasetFingerprint, "feedback export fingerprints should match reordered graph collections");
const compactFeedbackDataset = buildCompactFeedbackDataset(acceptedKnowledge);
assert(compactFeedbackDataset.examples.every((example) => example.evidence.length === 0 && example.sources.length === 0), "compact feedback exports should remove source-linked material");
assert.equal(compactFeedbackDataset.examples.length, feedbackDataset.examples.length, "compact feedback exports should preserve reviewed examples");
assert.equal(compactFeedbackDataset.datasetFingerprint, fingerprintFeedbackExamples(compactFeedbackDataset.examples), "compact feedback exports should fingerprint their redacted examples");
const backupFingerprint = fingerprintBackup(merged, [defaultGraph()]);
assert.match(backupFingerprint, /^fnv64-[0-9a-f]{16}-\d+$/, "backups should have a deterministic content fingerprint");
assert.equal(backupFingerprint, fingerprintBackup(merged, [defaultGraph()]), "backup fingerprints should be deterministic");
assert.notEqual(backupFingerprint, fingerprintBackup(defaultGraph(), [defaultGraph()]), "backup fingerprints should change when graph content changes");
const reorderedFingerprintGraph = {
  ...merged,
  documents: [...merged.documents].reverse(),
  nodes: [...merged.nodes].reverse(),
  edges: [...merged.edges].reverse()
};
assert.equal(fingerprintBackup(reorderedFingerprintGraph), fingerprintBackup(merged), "graph fingerprints should ignore unordered document, concept, and relation array order");
const graphJsonFingerprint = fingerprintBackup(merged);
assert.equal(fingerprintBackup({ ...merged, graphFingerprint: graphJsonFingerprint }), graphJsonFingerprint, "graph JSON fingerprints should ignore their metadata field when verifying contents");
const staleRelationSourceId = merged.edges[0].source;
const staleRelationLearning = normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node) => node.id === staleRelationSourceId ? { ...node, label: "Renamed alpha" } : node),
  learning: {
    examples: [{
      kind: "relation",
      id: merged.edges[0].id,
      source: merged.edges[0].source,
      sourceLabel: merged.nodes.find((node) => node.id === staleRelationSourceId)?.label,
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
assert(!learningPriorityDataset.examples.some((example) => example.id === "dataset-imported-priority"), "feedback dataset export should prioritize current reviewed decisions over detached reusable memory");
assert.equal(learningPriorityDataset.truncatedExamples, 1, "feedback exports should disclose reviewed items omitted by the bounded dataset window");
assert(learningPriorityDataset.truncatedExamples <= MAX_FEEDBACK_EXPORT_OMITTED, "feedback omission diagnostics should remain bounded");
assert.equal(learningPriorityDataset.examples.filter((example) => example.id.startsWith("dataset-priority-")).length, 500, "feedback dataset export should preserve every current reviewed concept within its bound");
assert.equal(buildCompactFeedbackDataset(normalizeGraph({
  ...merged,
  nodes: Array.from({ length: 500 }, (_, index) => ({
    ...merged.nodes[0],
    id: `compact-priority-${index}`,
    label: `Compact priority ${index}`,
    status: "accepted"
  })),
  learning: { examples: [{ kind: "concept", id: "compact-memory", label: "Compact memory", status: "accepted" }] }
})).truncatedExamples, 1, "compact feedback exports should preserve omission diagnostics");
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
assert(conflictingFeedback.graph.revisions.some((revision) => revision.reason.includes("contradictory reviewed decision")), "contradictory feedback should remain visible in revision history");
const transferredFeedback = applyFeedbackDataset(merged, [{ kind: "concept", id: merged.nodes[0].id, status: "accepted", aliases: ["transferred alias"] }]);
assert.equal(transferredFeedback.updates, 1, "feedback import counts changed reviewed items once");
assert(transferredFeedback.graph.nodes.find((node) => node.id === merged.nodes[0].id).aliases.includes("transferred alias"), "feedback imports should transfer reviewed aliases");
const compactFeedback = buildExtractorFeedback(normalizeGraph({
  ...acceptedKnowledge,
  edges: acceptedKnowledge.edges.map((edge, index) => index === 0 ? { ...edge, status: "accepted" } : edge)
}), { includeStale: true });
assert(compactFeedback.length > 0, "extractor feedback should include reviewed items");
assert(!Object.hasOwn(compactFeedback[0], "evidence") && !Object.hasOwn(compactFeedback[0], "sources"), "extractor feedback should omit source evidence payloads");
assert(compactFeedback.some((example) => example.kind === "relation" && Object.hasOwn(example, "sourceLabel")), "extractor feedback should preserve relation endpoint labels");
const evidenceBearingGuidance = buildExtractorFeedback(normalizeGraph({
  schema: GRAPH_SCHEMA,
  learning: {
    examples: [{
      kind: "concept",
      id: "evidence-bearing-guidance",
      label: "Evidence-bearing guidance",
      aliases: ["bounded"],
      status: "accepted",
      evidence: [{ text: "private evidence", sources: ["private-source"] }],
      sources: ["private-source"],
      confidence: 0.99,
      feedback: 12,
      lastReviewedAt: new Date().toISOString()
    }]
  }
}));
assert.deepEqual(evidenceBearingGuidance, [{
  kind: "concept",
  id: "evidence-bearing-guidance",
  label: "Evidence-bearing guidance",
  aliases: ["bounded"],
  status: "accepted"
}], "extractor guidance should enforce the strict request projection for reusable learning memory");
const orderStableGuidanceA = buildExtractorFeedback(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [
    { id: "zulu", label: "Zulu", status: "accepted" },
    { id: "alpha", label: "Alpha", status: "accepted" },
    { id: "context", label: "Context" }
  ],
  edges: [
    { id: "zulu-context", source: "zulu", target: "context", label: "uses", status: "accepted" }
  ]
}), { includeStale: true });
const orderStableGuidanceB = buildExtractorFeedback(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [
    { id: "context", label: "Context" },
    { id: "alpha", label: "Alpha", status: "accepted" },
    { id: "zulu", label: "Zulu", status: "accepted" }
  ],
  edges: [
    { id: "zulu-context", source: "zulu", target: "context", label: "uses", status: "accepted" }
  ]
}), { includeStale: true });
assert.deepEqual(orderStableGuidanceA, orderStableGuidanceB, "live extractor guidance should remain stable when graph collections are reordered");
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
}), { includeStale: true });
assert(balancedFeedback.some((example) => example.kind === "relation"), "bounded extractor feedback should retain relation guidance when concepts are numerous");
const learningPriorityGraph = normalizeGraph({
  ...merged,
  nodes: Array.from({ length: 499 }, (_, index) => ({
    ...merged.nodes[0],
    id: `reviewed-priority-${index}`,
    label: `Reviewed priority ${index}`,
    status: "accepted",
    lastReviewedAt: new Date().toISOString()
  })),
  learning: {
    examples: [
      { kind: "concept", id: "imported-priority", label: "Imported priority", status: "accepted", lastReviewedAt: new Date().toISOString() }
    ]
  }
});
const prioritizedFeedback = buildExtractorFeedback(learningPriorityGraph);
assert(prioritizedFeedback.some((example) => example.id === "imported-priority"), "bounded extractor feedback should preserve reusable learning memory before filling the live graph budget");
const currentDecisionExport = buildFeedbackDataset(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "current-decision", label: "Current decision", status: "accepted", confidence: .9, mentions: 1, feedback: 1 }],
  edges: [],
  learning: {
    examples: Array.from({ length: MAX_FEEDBACK_EXAMPLES }, (_, index) => ({
      kind: "concept",
      id: `detached-memory-${index}`,
      label: `Detached memory ${index}`,
      status: "accepted",
      lastReviewedAt: new Date(Date.now() - index * 86400000).toISOString()
    }))
  }
}));
assert(currentDecisionExport.examples.some((example) => example.id === "current-decision"), "feedback exports should reserve capacity for a current reviewed decision");
const learningOrderGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [],
  edges: [],
  learning: {
    examples: [
      { kind: "concept", id: "older-learning", label: "Older learning", status: "accepted", lastReviewedAt: "2025-01-01T00:00:00.000Z" },
      { kind: "concept", id: "newer-learning", label: "Newer learning", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" }
    ]
  }
});
const reorderedLearningOrderGraph = normalizeGraph({
  ...learningOrderGraph,
  learning: { examples: [...learningOrderGraph.learning.examples].reverse() }
});
assert.deepEqual(
  buildFeedbackDataset(learningOrderGraph).examples,
  buildFeedbackDataset(reorderedLearningOrderGraph).examples,
  "feedback exports should canonicalize reusable learning order by review freshness"
);
const futureLearningOrder = buildExtractorFeedback(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [],
  edges: [],
  learning: {
    examples: [
      { kind: "concept", id: "trusted-learning", label: "Trusted learning", status: "accepted", lastReviewedAt: new Date().toISOString() },
      { kind: "concept", id: "future-learning", label: "Future learning", status: "accepted", lastReviewedAt: "2099-01-01T00:00:00.000Z" }
    ]
  }
}));
assert.equal(futureLearningOrder[0].id, "trusted-learning", "future-dated memory must not outrank trusted reusable guidance");
const controlledLearningOrder = buildExtractorFeedback(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [],
  edges: [],
  learning: {
    examples: [
      { kind: "concept", id: "older-controlled", label: "Older controlled", status: "accepted", lastReviewedAt: "2026-07-19T00:00:00.000Z" },
      { kind: "concept", id: "newer-controlled", label: "Newer controlled", status: "accepted", lastReviewedAt: "2026-07-20T00:00:00.000Z" }
    ]
  }
}), { now: Date.parse("2026-07-21T00:00:00.000Z") });
assert.deepEqual(
  controlledLearningOrder.slice(0, 2).map((example) => example.id),
  ["newer-controlled", "older-controlled"],
  "extractor guidance should order reviews using its caller-provided inspection timestamp"
);
const futureLearningExport = buildFeedbackDataset(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [],
  edges: [],
  learning: {
    examples: [
      { kind: "concept", id: "trusted-export", label: "Trusted export", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" },
      { kind: "concept", id: "future-export", label: "Future export", status: "accepted", lastReviewedAt: "2099-01-01T00:00:00.000Z" }
    ]
  }
})).examples;
assert.equal(futureLearningExport[0].id, "trusted-export", "future-dated memory must not outrank trusted feedback export entries");
const saturatedLearningGraph = normalizeGraph({
  ...merged,
  nodes: [{
    ...merged.nodes[0],
    id: "current-live-priority",
    label: "Current live priority",
    status: "accepted",
    lastReviewedAt: new Date().toISOString()
  }],
  edges: [],
  learning: {
    examples: Array.from({ length: MAX_FEEDBACK_EXAMPLES }, (_, index) => ({
      kind: "concept",
      id: `historical-${index}`,
      label: `Historical ${index}`,
      status: "accepted",
      lastReviewedAt: new Date(Date.now() - index * 86400000).toISOString()
    }))
  }
});
const saturatedLearningFeedback = buildExtractorFeedback(saturatedLearningGraph, { includeStale: true });
assert.equal(saturatedLearningFeedback.length, MAX_FEEDBACK_EXAMPLES, "saturated guidance should retain its bounded context size");
assert(saturatedLearningFeedback.some((example) => example.id === "current-live-priority"), "saturated guidance should reserve capacity for a current live reviewed concept");
assert(!saturatedLearningFeedback.some((example) => example.id === "historical-499"), "bounded guidance should evict the oldest reusable memory first");
assert(saturatedLearningFeedback.some((example) => example.id === "historical-0"), "bounded guidance should preserve the newest reusable memory by review timestamp");
const manyCurrentDecisionsGraph = normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: Array.from({ length: 20 }, (_, index) => ({
    id: `current-decision-${index}`,
    label: `Current decision ${index}`,
    status: "accepted"
  })),
  edges: [],
  learning: {
    examples: Array.from({ length: MAX_FEEDBACK_EXAMPLES }, (_, index) => ({
      kind: "concept",
      id: `historical-current-${index}`,
      label: `Historical current ${index}`,
      status: "accepted",
      lastReviewedAt: new Date(Date.now() - index * 86400000).toISOString()
    }))
  }
});
const manyCurrentDecisionsFeedback = buildExtractorFeedback(manyCurrentDecisionsGraph, { includeStale: true });
assert.equal(
  manyCurrentDecisionsFeedback.filter((example) => example.id.startsWith("current-decision-")).length,
  20,
  "bounded guidance should reserve capacity for every current reviewed decision, not only the first concept and relation"
);
const staleGuidanceGraph = normalizeGraph({
  ...merged,
  nodes: [
    ...merged.nodes,
    { ...merged.nodes[0], id: "stale-live-guidance", label: "Stale live guidance", status: "accepted", lastReviewedAt: "2020-01-01T00:00:00.000Z" }
  ],
  learning: {
    examples: [
      { kind: "concept", id: "stale-guidance", label: "Stale guidance", status: "accepted", lastReviewedAt: "2020-01-01T00:00:00.000Z" },
      { kind: "concept", id: "undated-guidance", label: "Undated guidance", status: "accepted" },
      { kind: "concept", id: "fresh-guidance", label: "Fresh guidance", status: "accepted", lastReviewedAt: new Date(Date.now() - 86400000).toISOString() }
    ]
  }
});
const freshGuidance = buildExtractorFeedback(staleGuidanceGraph, { includeStale: false });
assert(!freshGuidance.some((example) => example.id === "stale-guidance"), "stale reusable memory should not steer new extraction guidance");
assert(!freshGuidance.some((example) => example.id === "undated-guidance"), "undated reusable memory should not steer new extraction guidance");
assert(!freshGuidance.some((example) => example.id === "stale-live-guidance"), "stale live decisions should not steer new extraction guidance");
assert(freshGuidance.some((example) => example.id === "fresh-guidance"), "fresh reusable memory should remain available to new extraction guidance");
const defaultFreshGuidance = buildExtractorFeedback(staleGuidanceGraph);
assert.deepEqual(defaultFreshGuidance, freshGuidance, "extractor guidance should default to the fresh-only boundary");
const learningContextStats = inspectGraph(learningPriorityGraph);
assert.equal(learningContextStats.feedbackContextAvailable, 500, "health should count unique live and reusable extractor guidance items");
assert.equal(learningContextStats.feedbackContextRetained, 500, "health should expose the bounded retained guidance count");
assert.equal(learningContextStats.feedbackContextTruncated, false, "health should disclose when extractor guidance fits its bounded context");
const currentFeedbackWins = buildExtractorFeedback(normalizeGraph({
  ...merged,
  nodes: [{ ...merged.nodes[0], status: "rejected" }],
  learning: { examples: [{ kind: "concept", id: merged.nodes[0].id, label: merged.nodes[0].label, status: "accepted" }] }
}), { includeStale: true });
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
}), { includeStale: true });
assert.equal(newerLearningFeedback.find((example) => example.id === merged.nodes[0].id)?.status, "accepted", "newer reusable feedback should override an older live graph decision when building extractor guidance");
assert(!Object.hasOwn(newerLearningFeedback.find((example) => example.id === merged.nodes[0].id), "lastReviewedAt"), "extractor guidance should keep review timestamps internal to the graph contract");
const portableNodeId = merged.nodes[0].id;
const portableFeedback = applyFeedbackDataset(normalizeGraph({
  ...merged,
  nodes: merged.nodes.map((node, index) => index === 0 ? { ...node, id: "renamed-concept-id" } : node),
  edges: merged.edges.map((edge) => ({
    ...edge,
    source: edge.source === portableNodeId ? "renamed-concept-id" : edge.source,
    target: edge.target === portableNodeId ? "renamed-concept-id" : edge.target
  }))
}), [{ kind: "concept", id: portableNodeId, label: merged.nodes[0].label, status: "accepted" }]);
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
const oversizedFeedbackImport = applyFeedbackDataset(defaultGraph(), new Array(MAX_FEEDBACK_FINGERPRINT_EXAMPLES + 1));
assert.equal(oversizedFeedbackImport.limited, "feedback-examples", "feedback dataset imports should reject oversized example collections instead of silently slicing them");
assert.equal(oversizedFeedbackImport.changed, false, "oversized feedback dataset imports should not mutate the graph");
const reusableGuidance = buildExtractorFeedback(emptyLearningImport.graph, { includeStale: true });
assert(reusableGuidance.some((example) => example.kind === "concept" && example.id === "attention"), "learning memory should feed future extraction");
assert(extractGraph("Reusable feedback", "Attention uses context to organize the evidence for review.", { feedback: reusableGuidance }).nodes.some((node) => node.id === "attention"), "reusable feedback should influence a later extraction");
const emptyPortableConflict = applyFeedbackDataset(defaultGraph(), [
  { kind: "relation", id: "workspace-a-edge", source: "workspace-a-attention", sourceLabel: "Attention", target: "workspace-a-context", targetLabel: "Context", label: "uses", status: "accepted" },
  { kind: "relation", id: "workspace-b-edge", source: "workspace-b-context", sourceLabel: "Context", target: "workspace-b-attention", targetLabel: "Attention", label: "uses", status: "rejected" }
]);
assert.equal(emptyPortableConflict.conflicts, 1, "unmatched portable relations should detect contradictory endpoint-label feedback");
assert.equal(emptyPortableConflict.graph.learning.examples.length, 1, "unmatched portable relation conflicts should retain one deterministic learning decision");
assert.equal(emptyPortableConflict.graph.learning.examples[0].status, "rejected", "the later unmatched portable relation decision should win deterministically");
const correctedLearning = applyFeedbackDataset(defaultGraph(), [
  { kind: "concept", id: "attention", label: "Attention", status: "accepted" },
  { kind: "concept", id: "attention", label: "Attention", status: "rejected" }
]);
const reversedCorrectedLearning = applyFeedbackDataset(defaultGraph(), [
  { kind: "concept", id: "attention", label: "Attention", status: "rejected" },
  { kind: "concept", id: "attention", label: "Attention", status: "accepted" }
]);
assert.equal(correctedLearning.graph.learning.examples[0].status, "rejected", "untimestamped feedback conflicts should resolve with a stable decision");
assert.deepEqual(correctedLearning.graph.learning, reversedCorrectedLearning.graph.learning, "untimestamped feedback conflicts should not depend on dataset order");
const unorderedLearningImportA = applyFeedbackDataset(defaultGraph(), [
  { kind: "concept", id: "portable-zulu", label: "Portable Zulu", status: "accepted" },
  { kind: "concept", id: "portable-alpha", label: "Portable Alpha", status: "accepted" }
]);
const unorderedLearningImportB = applyFeedbackDataset(defaultGraph(), [
  { kind: "concept", id: "portable-alpha", label: "Portable Alpha", status: "accepted" },
  { kind: "concept", id: "portable-zulu", label: "Portable Zulu", status: "accepted" }
]);
assert.deepEqual(unorderedLearningImportA.graph.learning, unorderedLearningImportB.graph.learning, "distinct untimestamped learning imports should retain a stable order");
const acceptedCorrectionWithoutTimestamp = applyFeedbackDataset(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "timestamp-free-correction", label: "Timestamp-free correction", status: "rejected" }]
}), [
  { kind: "concept", id: "timestamp-free-correction", label: "Timestamp-free correction", status: "accepted" }
]);
assert.equal(acceptedCorrectionWithoutTimestamp.graph.nodes[0].status, "accepted", "a timestamp-free reviewed import should still correct a timestamp-free rejected graph item");
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
const futureDecisionImport = applyFeedbackDataset(normalizeGraph({
  schema: GRAPH_SCHEMA,
  nodes: [{ id: "future-decision", label: "Future decision", status: "accepted", lastReviewedAt: "2026-01-01T00:00:00.000Z" }]
}), [
  { kind: "concept", id: "future-decision", label: "Future decision", status: "rejected", lastReviewedAt: "2099-01-01T00:00:00.000Z" }
]);
assert.equal(futureDecisionImport.graph.nodes[0].status, "accepted", "future-dated feedback must not override a trusted current decision");
assert.equal(futureDecisionImport.changed, false, "future-dated feedback rejected by a trusted decision should not create a misleading learning revision");
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
assert.throws(() => zipStore(Array.from({ length: sandbox.MAX_ZIP_FILES + 1 }, () => ({ name: "x.md", content: "" }))), /too many files/, "vault exports should enforce the file-count limit");
assert.throws(() => zipStore([{ name: "invalid.md", content: 42 }]), /invalid file/, "vault exports should reject invalid file records");
assert.throws(() => zipStore([{ name: "x".repeat(65536), content: "" }]), /file name that is too long/, "vault exports should reject names that cannot fit ZIP headers");
assert.doesNotThrow(() => zipStore([{ name: "bounded.md", content: "x" }], Number.POSITIVE_INFINITY), "invalid archive limits should fail safe to the maximum bounded archive size");
assert.throws(() => downloadBytes("forged.zip", { byteLength: 1 }, "application/zip"), /50 MB safety limit/, "binary downloads should reject forged array-like byte lengths before Blob creation");

console.log(`smoke ok: ${merged.nodes.length} concepts, ${merged.edges.length} relations`);
