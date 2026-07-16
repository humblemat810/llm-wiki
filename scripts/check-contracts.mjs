import assert from "node:assert/strict";
import fs from "node:fs";
import { HISTORY_LIMIT, MAX_PERSISTED_JSON_BYTES } from "../graph-store.js";
import { MAX_BROADCAST_VALUE_BYTES } from "../storage-adapter.js";
import {
  MAX_CONCEPT_LABEL_CHARS,
  MAX_ALIASES,
  MAX_AMBIGUOUS_EDGE_IDS,
  MAX_AMBIGUOUS_SOURCE_IDS,
  MAX_CONFLICTING_ITEM_IDS,
  MAX_DOCUMENT_CHARS,
  MAX_DOCUMENT_TITLE_CHARS,
  MAX_EVIDENCE_CHARS,
  MAX_EVIDENCE_RECORDS,
  MAX_FEEDBACK_COUNT,
  MAX_FEEDBACK_EXAMPLES,
  MAX_FEEDBACK_FINGERPRINT_EXAMPLES,
  MAX_FEEDBACK_EXPORT_OMITTED,
  MAX_GRAPH_DOCUMENTS,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  MAX_GRAPH_REVISIONS,
  MAX_GRAPH_VERSION,
  MAX_ID_CHARS,
  MAX_NODE_MENTIONS,
  MAX_FEEDBACK_LABEL_CHARS,
  MAX_RELATION_LABEL_CHARS,
  MAX_REVIEW_QUEUE_ITEMS,
  MAX_SOURCE_REFERENCES,
  MAX_SOURCE_URI_CHARS,
  MAX_PRODUCER_VERSION_CHARS,
  HEALTH_GATE_LIMITS,
  HEALTH_COUNT_LIMITS,
  HEALTH_PERCENTAGES,
  HEALTH_BOOLEANS,
  HEALTH_OBJECTS,
  MAX_TIMESTAMP_CHARS,
  REVISION_OPERATIONS,
  REVISION_EXTRACTORS,
  parseJsonWithUniqueKeys
} from "../graph-core.js";

if (MAX_BROADCAST_VALUE_BYTES !== MAX_PERSISTED_JSON_BYTES) {
  throw new Error("Browser storage byte ceiling must match the graph-store persisted byte ceiling.");
}

const readSchema = (name) => {
  const text = fs.readFileSync(new URL(`../schema/${name}`, import.meta.url), "utf8");
  return parseJsonWithUniqueKeys(text, name);
};
const graph = readSchema("graph.schema.json");
const backup = readSchema("backup.schema.json");
const feedback = readSchema("feedback.schema.json");
const diff = readSchema("diff.schema.json");
const jsonLd = readSchema("jsonld.schema.json");
const health = readSchema("health.schema.json");
const extractorRequest = readSchema("extractor-request.schema.json");
const vaultManifest = readSchema("vault-manifest.schema.json");
const learningLoop = readSchema("learning-loop.schema.json");
const canvas = readSchema("canvas.schema.json");
const serviceHealth = readSchema("service-health.schema.json");
const graphDefs = graph.$defs;
const feedbackExample = feedback.properties.examples.items;
const extractorDocument = extractorRequest.properties.document;
const extractorFeedback = extractorRequest.$defs.feedbackHint;

const at = (schema, path) => path.reduce((value, key) => value?.[key], schema);
const maxItems = (schema, path) => at(schema, path)?.maxItems;
const maxLength = (schema, path) => at(schema, path)?.maxLength;
const minLength = (schema, path) => at(schema, path)?.minLength;
const maximum = (schema, path) => at(schema, path)?.maximum;

const checks = [
  [maxItems(graph, ["properties", "documents"]), MAX_GRAPH_DOCUMENTS, "graph documents"],
  [maxItems(graph, ["properties", "nodes"]), MAX_GRAPH_NODES, "graph nodes"],
  [maxItems(graph, ["properties", "edges"]), MAX_GRAPH_EDGES, "graph edges"],
  [maxItems(graph, ["properties", "revisions"]), MAX_GRAPH_REVISIONS, "graph revisions"],
  [maxItems(graph, ["properties", "learning", "properties", "examples"]), MAX_FEEDBACK_EXAMPLES, "graph learning examples"],
  [maxItems(graph, ["properties", "integrity", "properties", "ambiguousSourceIds"]), MAX_AMBIGUOUS_SOURCE_IDS, "ambiguous source diagnostics"],
  [maxItems(graph, ["properties", "integrity", "properties", "ambiguousEdgeIds"]), MAX_AMBIGUOUS_EDGE_IDS, "ambiguous edge diagnostics"],
  [maxItems(graph, ["properties", "integrity", "properties", "conflictingNodeIds"]), MAX_CONFLICTING_ITEM_IDS, "conflicting node diagnostics"],
  [maxItems(graph, ["properties", "integrity", "properties", "conflictingEdgeIds"]), MAX_CONFLICTING_ITEM_IDS, "conflicting edge diagnostics"],
  [maxItems(graphDefs.evidence, ["properties", "sources"]), MAX_SOURCE_REFERENCES, "evidence sources"],
  [maxItems(graphDefs.node, ["properties", "evidence"]), MAX_EVIDENCE_RECORDS, "node evidence records"],
  [maxItems(graphDefs.node, ["properties", "aliases"]), MAX_ALIASES, "node aliases"],
  [maxItems(graphDefs.edge, ["properties", "evidence"]), MAX_EVIDENCE_RECORDS, "edge evidence records"],
  [maxItems(jsonLd, ["$defs", "evidence"]), MAX_EVIDENCE_RECORDS, "JSON-LD evidence records"],
  [maxItems(jsonLd, ["properties", "@graph"]), MAX_GRAPH_DOCUMENTS + MAX_GRAPH_NODES + MAX_GRAPH_EDGES + MAX_FEEDBACK_EXAMPLES + MAX_GRAPH_REVISIONS, "JSON-LD graph members"],
  [maximum(diff, ["$defs", "item", "properties", "evidenceCount"]), MAX_EVIDENCE_RECORDS, "diff evidence counts"],
  [maximum(health, ["properties", "reviewQueue", "items", "properties", "evidence"]), MAX_EVIDENCE_RECORDS, "health review evidence counts"],
  [maxLength(graphDefs.evidence, ["properties", "text"]), MAX_EVIDENCE_CHARS, "evidence text"],
  [maxLength(graphDefs.document, ["properties", "id"]), MAX_ID_CHARS, "document IDs"],
  [maxLength(graphDefs.document, ["properties", "text"]), MAX_DOCUMENT_CHARS, "document text"],
  [maxLength(extractorDocument, ["properties", "title"]), MAX_DOCUMENT_TITLE_CHARS, "document titles"],
  [maxLength(graphDefs.document, ["properties", "uri"]), MAX_SOURCE_URI_CHARS, "document URIs"],
  [maxLength(graphDefs.document, ["properties", "addedAt"]), MAX_TIMESTAMP_CHARS, "document timestamps"],
  [maxLength(graph, ["properties", "appVersion"]), MAX_PRODUCER_VERSION_CHARS, "graph producer versions"],
  [maxLength(graphDefs.node, ["properties", "id"]), MAX_ID_CHARS, "node IDs"],
  [maxLength(graphDefs.node, ["properties", "label"]), MAX_CONCEPT_LABEL_CHARS, "node labels"],
  [maxItems(graphDefs.node, ["properties", "sources"]), MAX_SOURCE_REFERENCES, "node sources"],
  [maxLength(graphDefs.node, ["properties", "createdAt"]), MAX_TIMESTAMP_CHARS, "node timestamps"],
  [maximum(graphDefs.node, ["properties", "mentions"]), MAX_NODE_MENTIONS, "node mentions"],
  [maximum(graphDefs.node, ["properties", "feedback"]), MAX_FEEDBACK_COUNT, "node feedback"],
  [maxLength(graphDefs.edge, ["properties", "id"]), MAX_ID_CHARS, "edge IDs"],
  [maxLength(graphDefs.edge, ["properties", "label"]), MAX_RELATION_LABEL_CHARS, "edge labels"],
  [maxItems(graphDefs.edge, ["properties", "sources"]), MAX_SOURCE_REFERENCES, "edge sources"],
  [maxLength(graphDefs.learningExample, ["properties", "id"]), MAX_ID_CHARS, "learning IDs"],
  [maxLength(graphDefs.learningExample, ["properties", "lastReviewedAt"]), MAX_TIMESTAMP_CHARS, "learning timestamps"],
  [maxItems(feedback, ["properties", "examples"]), MAX_REVIEW_QUEUE_ITEMS, "feedback examples"],
  [maximum(feedback, ["properties", "truncatedExamples"]), MAX_FEEDBACK_EXPORT_OMITTED, "feedback export omission diagnostics"],
  [maxLength(feedbackExample, ["properties", "id"]), MAX_ID_CHARS, "feedback IDs"],
  [maxItems(feedbackExample, ["properties", "sources"]), MAX_SOURCE_REFERENCES, "feedback sources"],
  [maxItems(diff, ["$defs", "collection", "properties", "added"]), MAX_GRAPH_EDGES, "diff added items"],
  [maxItems(diff, ["$defs", "collection", "properties", "removed"]), MAX_GRAPH_EDGES, "diff removed items"],
  [maxItems(diff, ["$defs", "collection", "properties", "changed"]), MAX_GRAPH_EDGES, "diff changed items"],
  [maximum(jsonLd, ["properties", "revisionCount"]), MAX_GRAPH_REVISIONS, "JSON-LD revisions"],
  [maximum(jsonLd, ["properties", "learningExampleCount"]), MAX_FEEDBACK_EXAMPLES, "JSON-LD learning examples"],
  [maxItems(jsonLd, ["$defs", "integrityIds"]), MAX_AMBIGUOUS_SOURCE_IDS, "JSON-LD integrity IDs"],
  [maximum(jsonLd, ["$defs", "diagnosticCounts", "properties", "sourceReferences"]), 4294967295, "JSON-LD source reference diagnostics"],
  [maximum(graph, ["properties", "version"]), MAX_GRAPH_VERSION, "graph versions"],
  [maximum(graph, ["properties", "integrity", "properties", "truncated", "properties", "evidenceItems"]), 4294967295, "evidence item truncation diagnostics"],
  [maximum(graph, ["properties", "integrity", "properties", "truncated", "properties", "documentTitle"]), 4294967295, "document-title truncation diagnostics"],
  [maximum(graph, ["properties", "integrity", "properties", "truncated", "properties", "sourceReferences"]), 4294967295, "source reference truncation diagnostics"],
  [maximum(diff, ["$defs", "diagnosticCounts", "properties", "evidenceItems"]), 4294967295, "diff evidence item truncation diagnostics"],
  [maximum(diff, ["$defs", "diagnosticCounts", "properties", "documentTitle"]), 4294967295, "diff document-title truncation diagnostics"],
  [maximum(diff, ["$defs", "diagnosticCounts", "properties", "sourceReferences"]), 4294967295, "diff source reference truncation diagnostics"],
  [maximum(diff, ["$defs", "diagnosticCounts", "properties", "aliases"]), 4294967295, "diff alias truncation diagnostics"],
  [maximum(jsonLd, ["$defs", "diagnosticCounts", "properties", "documentTitle"]), 4294967295, "JSON-LD document-title truncation diagnostics"],
  [maximum(jsonLd, ["$defs", "diagnosticCounts", "properties", "aliases"]), 4294967295, "JSON-LD alias truncation diagnostics"],
  [maxItems(extractorRequest, ["properties", "feedback"]), MAX_FEEDBACK_EXAMPLES, "extractor feedback hints"],
  [maxLength(extractorDocument, ["properties", "uri"]), MAX_SOURCE_URI_CHARS, "extractor source URIs"],
  [maxLength(extractorFeedback, ["properties", "id"]), MAX_ID_CHARS, "extractor feedback IDs"],
  [maxLength(extractorFeedback, ["properties", "label"]), MAX_FEEDBACK_LABEL_CHARS, "extractor feedback labels"],
  [maxLength(extractorFeedback, ["properties", "source"]), MAX_ID_CHARS, "extractor source IDs"],
  [maxLength(extractorFeedback, ["properties", "sourceLabel"]), MAX_FEEDBACK_LABEL_CHARS, "extractor source labels"],
  [maxLength(extractorFeedback, ["properties", "target"]), MAX_ID_CHARS, "extractor target IDs"],
  [maxLength(extractorFeedback, ["properties", "targetLabel"]), MAX_FEEDBACK_LABEL_CHARS, "extractor target labels"],
  [maxItems(extractorFeedback, ["properties", "aliases"]), MAX_ALIASES, "extractor feedback aliases"],
  [maximum(vaultManifest, ["properties", "graphVersion"]), MAX_GRAPH_VERSION, "vault graph versions"],
  [maxLength(vaultManifest, ["properties", "generatedAt"]), MAX_TIMESTAMP_CHARS, "vault manifest timestamps"],
  [maxItems(backup, ["properties", "history"]), HISTORY_LIMIT, "backup history snapshots"],
  [maxLength(vaultManifest, ["properties", "appVersion"]), MAX_PRODUCER_VERSION_CHARS, "vault producer versions"],
  [maxLength(jsonLd, ["properties", "appVersion"]), MAX_PRODUCER_VERSION_CHARS, "JSON-LD producer versions"],
  [maxLength(health, ["properties", "appVersion"]), MAX_PRODUCER_VERSION_CHARS, "health producer versions"],
  [maxLength(backup, ["properties", "appVersion"]), MAX_PRODUCER_VERSION_CHARS, "backup producer versions"],
  [maxItems(learningLoop, ["$defs", "extractionStage", "properties", "labels"]), MAX_GRAPH_NODES, "learning-loop stage labels"],
  [maximum(learningLoop, ["$defs", "extractionStage", "properties", "concepts"]), MAX_GRAPH_NODES, "learning-loop stage concepts"],
  [maximum(learningLoop, ["$defs", "extractionStage", "properties", "relations"]), MAX_GRAPH_EDGES, "learning-loop stage relations"],
  [maxLength(learningLoop, ["$defs", "extractionStage", "properties", "labels", "items"]), MAX_CONCEPT_LABEL_CHARS, "learning-loop concept labels"],
  [maxLength(learningLoop, ["$defs", "reviewedItem", "properties", "id"]), MAX_ID_CHARS, "learning-loop reviewed IDs"],
  [maxLength(learningLoop, ["$defs", "reviewedItem", "properties", "label"]), MAX_CONCEPT_LABEL_CHARS, "learning-loop reviewed labels"],
  [maximum(learningLoop, ["properties", "stages", "properties", "reviewed", "properties", "guidanceExamples"]), MAX_FEEDBACK_EXAMPLES, "learning-loop guidance examples"],
  [maximum(learningLoop, ["properties", "stages", "properties", "comparison", "properties", "baselineConcepts"]), MAX_GRAPH_NODES, "learning-loop baseline concepts"],
  [maximum(learningLoop, ["properties", "stages", "properties", "comparison", "properties", "guidedConcepts"]), MAX_GRAPH_NODES, "learning-loop guided concepts"],
  [maximum(learningLoop, ["properties", "stages", "properties", "comparison", "properties", "conceptsRemovedByGuidance"]), MAX_GRAPH_NODES, "learning-loop guidance delta"],
  [maxItems(canvas, ["properties", "nodes"]), MAX_GRAPH_NODES + 1, "Canvas nodes"],
  [maxItems(canvas, ["properties", "edges"]), MAX_GRAPH_EDGES, "Canvas edges"],
  [maxLength(canvas, ["$defs", "textNode", "allOf", 1, "properties", "text"]), 20000, "Canvas text"],
  [maxLength(canvas, ["$defs", "fileNode", "allOf", 1, "properties", "file"]), 512, "Canvas file paths"],
  [maxLength(serviceHealth, ["$defs", "liveness", "properties", "version"]), 64, "liveness versions"],
  [minLength(serviceHealth, ["$defs", "readiness", "properties", "error"]), 1, "readiness errors"],
  [maxLength(serviceHealth, ["$defs", "readiness", "properties", "error"]), 256, "readiness errors"],
  [at(serviceHealth, ["$defs", "liveness", "properties", "live", "const"]), true, "liveness marker"],
  [at(serviceHealth, ["$defs", "readiness", "properties", "ready", "type"]), "boolean", "readiness marker"]
];

for (const [key, expected] of Object.entries(HEALTH_GATE_LIMITS)) {
  checks.push([
    maximum(health, ["properties", "gate", "properties", "thresholds", "properties", key]),
    expected,
    `health ${key} gate`
  ]);
}
for (const [key, expected] of Object.entries(HEALTH_COUNT_LIMITS)) {
  checks.push([
    maximum(health, ["properties", "health", "properties", key]),
    expected,
    `health ${key} count`
  ]);
}
for (const key of HEALTH_PERCENTAGES) {
  checks.push([
    maximum(health, ["properties", "health", "properties", key]),
    100,
    `health ${key} percentage`
  ]);
}
for (const key of HEALTH_BOOLEANS) {
  checks.push([
    at(health, ["properties", "health", "properties", key, "type"]),
    "boolean",
    `health ${key} boolean`
  ]);
}
for (const key of HEALTH_OBJECTS) {
  checks.push([
    at(health, ["properties", "health", "properties", key, "type"]),
    "object",
    `health ${key} object`
  ]);
}

for (const [actual, expected, label] of checks) {
  assert.equal(actual, expected, `${label} schema bound drifted: expected ${expected}, got ${actual}`);
}
assert.deepEqual(at(graphDefs.revision, ["properties", "operation", "enum"]), [...REVISION_OPERATIONS], "revision operation vocabulary drifted");
assert.deepEqual(at(graphDefs.revision, ["properties", "extractor", "enum"]), [...REVISION_EXTRACTORS], "revision extractor vocabulary drifted");

console.log(`contract check ok: ${checks.length} runtime/schema bounds`);
