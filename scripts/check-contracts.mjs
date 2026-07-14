import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MAX_CONCEPT_LABEL_CHARS,
  MAX_AMBIGUOUS_EDGE_IDS,
  MAX_AMBIGUOUS_SOURCE_IDS,
  MAX_CONFLICTING_ITEM_IDS,
  MAX_DOCUMENT_CHARS,
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
  HEALTH_GATE_LIMITS,
  HEALTH_COUNT_LIMITS,
  HEALTH_PERCENTAGES,
  HEALTH_BOOLEANS,
  HEALTH_OBJECTS,
  MAX_TIMESTAMP_CHARS
} from "../graph-core.js";

function assertUniqueJsonObjectKeys(text, label) {
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(text[index] || "")) index += 1;
  };
  const parseString = () => {
    const start = index;
    if (text[index] !== '"') throw new Error(`${label} contains malformed JSON at offset ${index}.`);
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        const raw = text.slice(start, index + 1);
        index += 1;
        return JSON.parse(raw);
      }
      index += 1;
    }
    throw new Error(`${label} contains an unterminated JSON string.`);
  };
  const parseValue = () => {
    skipWhitespace();
    if (text[index] === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      while (index < text.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) throw new Error(`${label} contains duplicate object key "${key}".`);
        keys.add(key);
        skipWhitespace();
        if (text[index++] !== ":") throw new Error(`${label} contains malformed JSON at offset ${index}.`);
        parseValue();
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        if (text[index++] !== ",") throw new Error(`${label} contains malformed JSON at offset ${index}.`);
      }
      throw new Error(`${label} contains an unterminated JSON object.`);
    }
    if (text[index] === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      while (index < text.length) {
        parseValue();
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        if (text[index++] !== ",") throw new Error(`${label} contains malformed JSON at offset ${index}.`);
      }
      throw new Error(`${label} contains an unterminated JSON array.`);
    }
    if (text[index] === '"') {
      parseString();
      return;
    }
    const start = index;
    while (index < text.length && !/[,\]}]/.test(text[index])) index += 1;
    if (!text.slice(start, index).trim()) throw new Error(`${label} contains malformed JSON at offset ${index}.`);
  };
  parseValue();
  skipWhitespace();
  if (index !== text.length) throw new Error(`${label} contains trailing data.`);
}

const readSchema = (name) => {
  const text = fs.readFileSync(new URL(`../schema/${name}`, import.meta.url), "utf8");
  assertUniqueJsonObjectKeys(text, name);
  return JSON.parse(text);
};
const graph = readSchema("graph.schema.json");
const feedback = readSchema("feedback.schema.json");
const diff = readSchema("diff.schema.json");
const jsonLd = readSchema("jsonld.schema.json");
const health = readSchema("health.schema.json");
const extractorRequest = readSchema("extractor-request.schema.json");
const vaultManifest = readSchema("vault-manifest.schema.json");
const graphDefs = graph.$defs;
const feedbackExample = feedback.properties.examples.items;
const extractorDocument = extractorRequest.properties.document;
const extractorFeedback = extractorRequest.$defs.feedbackHint;

const at = (schema, path) => path.reduce((value, key) => value?.[key], schema);
const maxItems = (schema, path) => at(schema, path)?.maxItems;
const maxLength = (schema, path) => at(schema, path)?.maxLength;
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
  [maxItems(graphDefs.edge, ["properties", "evidence"]), MAX_EVIDENCE_RECORDS, "edge evidence records"],
  [maxItems(jsonLd, ["$defs", "evidence"]), MAX_EVIDENCE_RECORDS, "JSON-LD evidence records"],
  [maximum(diff, ["$defs", "item", "properties", "evidenceCount"]), MAX_EVIDENCE_RECORDS, "diff evidence counts"],
  [maximum(health, ["properties", "reviewQueue", "items", "properties", "evidence"]), MAX_EVIDENCE_RECORDS, "health review evidence counts"],
  [maxLength(graphDefs.evidence, ["properties", "text"]), MAX_EVIDENCE_CHARS, "evidence text"],
  [maxLength(graphDefs.document, ["properties", "id"]), MAX_ID_CHARS, "document IDs"],
  [maxLength(graphDefs.document, ["properties", "text"]), MAX_DOCUMENT_CHARS, "document text"],
  [maxLength(graphDefs.document, ["properties", "uri"]), MAX_SOURCE_URI_CHARS, "document URIs"],
  [maxLength(graphDefs.document, ["properties", "addedAt"]), MAX_TIMESTAMP_CHARS, "document timestamps"],
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
  [maximum(graph, ["properties", "integrity", "properties", "truncated", "properties", "sourceReferences"]), 4294967295, "source reference truncation diagnostics"],
  [maximum(diff, ["$defs", "diagnosticCounts", "properties", "evidenceItems"]), 4294967295, "diff evidence item truncation diagnostics"],
  [maximum(diff, ["$defs", "diagnosticCounts", "properties", "sourceReferences"]), 4294967295, "diff source reference truncation diagnostics"],
  [maxItems(extractorRequest, ["properties", "feedback"]), MAX_FEEDBACK_EXAMPLES, "extractor feedback hints"],
  [maxLength(extractorDocument, ["properties", "uri"]), MAX_SOURCE_URI_CHARS, "extractor source URIs"],
  [maxLength(extractorFeedback, ["properties", "id"]), MAX_ID_CHARS, "extractor feedback IDs"],
  [maxLength(extractorFeedback, ["properties", "label"]), MAX_FEEDBACK_LABEL_CHARS, "extractor feedback labels"],
  [maxLength(extractorFeedback, ["properties", "source"]), MAX_ID_CHARS, "extractor source IDs"],
  [maxLength(extractorFeedback, ["properties", "sourceLabel"]), MAX_FEEDBACK_LABEL_CHARS, "extractor source labels"],
  [maxLength(extractorFeedback, ["properties", "target"]), MAX_ID_CHARS, "extractor target IDs"],
  [maxLength(extractorFeedback, ["properties", "targetLabel"]), MAX_FEEDBACK_LABEL_CHARS, "extractor target labels"],
  [maxItems(extractorFeedback, ["properties", "aliases"]), 20, "extractor feedback aliases"],
  [maximum(vaultManifest, ["properties", "graphVersion"]), MAX_GRAPH_VERSION, "vault graph versions"],
  [maxLength(vaultManifest, ["properties", "generatedAt"]), MAX_TIMESTAMP_CHARS, "vault manifest timestamps"]
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

console.log(`contract check ok: ${checks.length} runtime/schema bounds`);
