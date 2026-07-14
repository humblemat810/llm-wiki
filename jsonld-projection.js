import { canonicalizeGraphForExport, fingerprintBackup } from "./graph-core.js";

export const JSONLD_FORMAT = "llm-field-notes/jsonld@1";
export const MAX_JSONLD_CANONICAL_DEPTH = 64;
const INTEGRITY_ID_LIMIT = 100;
const INTEGRITY_COUNT_MAX = 0xffffffff;

function canonicalize(value, depth = 0) {
  if (depth > MAX_JSONLD_CANONICAL_DEPTH) throw new Error("JSON-LD projection nesting exceeds the safety limit.");
  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalize(item, depth + 1))
      .sort((left, right) => {
        const leftSerialized = JSON.stringify(left);
        const rightSerialized = JSON.stringify(right);
        return leftSerialized < rightSerialized ? -1 : leftSerialized > rightSerialized ? 1 : 0;
      });
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key], depth + 1)]));
}

export function buildJsonLd(graph) {
  const normalizedGraph = canonicalizeGraphForExport(graph);
  const graphFingerprint = fingerprintBackup(normalizedGraph);
  const graphId = `urn:llm-field-notes:graph:${graphFingerprint}`;
  const safeIdPart = (value) => String(value).replace(/[^a-zA-Z0-9._~-]/g, (character) => `%u${character.codePointAt(0).toString(16).padStart(4, "0")}`);
  const entityId = (kind, id) => `${graphId}/${kind}/${safeIdPart(id)}`;
  const boundedIds = (value) => Array.isArray(value)
    ? [...new Set(value.filter((id) => typeof id === "string"))].sort().slice(0, INTEGRITY_ID_LIMIT)
    : [];
  const boundedCounts = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const counts = Object.fromEntries(Object.entries(value)
      .filter(([, count]) => Number.isSafeInteger(count) && count >= 0)
      .map(([key, count]) => [key, Math.min(INTEGRITY_COUNT_MAX, count)]));
    return Object.keys(counts).length ? counts : undefined;
  };
  const integrity = {
    ambiguousSourceIds: boundedIds(normalizedGraph.integrity?.ambiguousSourceIds),
    ambiguousEdgeIds: boundedIds(normalizedGraph.integrity?.ambiguousEdgeIds),
    ...(normalizedGraph.integrity?.conflictingNodeIds?.length ? { conflictingNodeIds: boundedIds(normalizedGraph.integrity.conflictingNodeIds) } : {}),
    ...(normalizedGraph.integrity?.conflictingEdgeIds?.length ? { conflictingEdgeIds: boundedIds(normalizedGraph.integrity.conflictingEdgeIds) } : {}),
    ...(boundedCounts(normalizedGraph.integrity?.truncated) ? { truncated: boundedCounts(normalizedGraph.integrity.truncated) } : {}),
    ...(boundedCounts(normalizedGraph.integrity?.dropped) ? { dropped: boundedCounts(normalizedGraph.integrity.dropped) } : {})
  };
  const sourceRef = (id) => entityId("source", id);
  const conceptRef = (id) => entityId("concept", id);
  const evidence = (items) => (items || []).map((item) => ({
    "@type": "lfn:Evidence",
    text: item.text,
    source: (item.sources || []).map(sourceRef)
  }));
  return {
    "@context": {
      "schema": "https://schema.org/",
      "lfn": "https://llm-field-notes.local/vocab#",
      "name": "schema:name",
      "description": "schema:description",
      "text": "schema:text",
      "url": "schema:url",
      "source": { "@id": "lfn:source", "@type": "@id" },
      "sources": { "@id": "lfn:sources", "@type": "@id" },
      "target": { "@id": "lfn:target", "@type": "@id" },
      "confidence": "lfn:confidence",
      "type": "lfn:type",
      "mentions": "lfn:mentions",
      "feedback": "lfn:feedback",
      "addedAt": "lfn:addedAt",
      "createdAt": "lfn:createdAt",
      "updatedAt": "lfn:updatedAt",
      "lastReviewedAt": "lfn:lastReviewedAt",
      "sourceFingerprint": "lfn:sourceFingerprint",
      "kind": "lfn:kind",
      "concept": { "@id": "lfn:concept", "@type": "@id" },
      "aliases": "schema:alternateName",
      "sourceConcept": { "@id": "lfn:sourceConcept", "@type": "@id" },
      "targetConcept": { "@id": "lfn:targetConcept", "@type": "@id" },
      "sourceLabel": "lfn:sourceLabel",
      "targetLabel": "lfn:targetLabel",
      "relation": "lfn:relation",
      "status": "lfn:status",
      "evidence": "lfn:evidence",
      "fingerprint": "lfn:fingerprint",
      "graphVersion": "lfn:graphVersion",
      "graphUpdatedAt": "lfn:graphUpdatedAt",
      "revisionCount": "lfn:revisionCount",
      "learningExampleCount": "lfn:learningExampleCount",
      "redacted": "lfn:redacted",
      "integrity": "lfn:integrity",
      "format": "lfn:format",
      "graphSchema": "lfn:graphSchema"
    },
    format: JSONLD_FORMAT,
    graphSchema: "llm-field-notes/graph@1",
    "@id": graphId,
    "@type": "schema:Dataset",
    "name": "LLM Field Notes knowledge graph",
    "description": "An inspectable document-to-knowledge-graph projection.",
    graphVersion: normalizedGraph.version,
    graphUpdatedAt: normalizedGraph.updatedAt,
    revisionCount: normalizedGraph.revisions.length,
    learningExampleCount: normalizedGraph.learning.examples.length,
    fingerprint: graphFingerprint,
    redacted: normalizedGraph.redacted === true,
    integrity,
    "@graph": [
      ...normalizedGraph.documents.map((document) => ({
        "@id": sourceRef(document.id),
        "@type": "schema:CreativeWork",
        name: document.title,
        ...(document.uri ? { url: document.uri } : {}),
        ...(!normalizedGraph.redacted && document.text ? { text: document.text } : {}),
        "lfn:quality": document.quality,
        "lfn:sourceFingerprint": document.fingerprint,
        "lfn:addedAt": document.addedAt,
        "lfn:lastReviewedAt": document.lastReviewedAt || null
      })),
      ...normalizedGraph.nodes.map((node) => ({
        "@id": conceptRef(node.id),
        "@type": ["schema:DefinedTerm", "lfn:Concept"],
        name: node.label,
        ...(node.aliases?.length ? { "schema:alternateName": node.aliases } : {}),
        "lfn:type": node.type,
        "lfn:status": node.status,
        confidence: node.confidence,
        "lfn:mentions": node.mentions,
        "lfn:feedback": node.feedback,
        "lfn:createdAt": node.createdAt,
        "lfn:updatedAt": node.updatedAt,
        "lfn:lastReviewedAt": node.lastReviewedAt || null,
        source: node.sources.map(sourceRef),
        "lfn:sources": node.sources.map(sourceRef),
        evidence: normalizedGraph.redacted ? [] : evidence(node.evidence)
      })),
      ...normalizedGraph.edges.map((edge) => ({
        "@id": entityId("relation", edge.id),
        "@type": "lfn:Relation",
        name: edge.label,
        source: conceptRef(edge.source),
        target: conceptRef(edge.target),
        "lfn:status": edge.status,
        confidence: edge.confidence,
        "lfn:feedback": edge.feedback,
        "lfn:lastReviewedAt": edge.lastReviewedAt || null,
        "lfn:sources": edge.sources.map(sourceRef),
        evidence: normalizedGraph.redacted ? [] : evidence(edge.evidence)
      })),
      ...normalizedGraph.learning.examples.map((example) => ({
        "@id": entityId("learning", `${example.kind}-${example.id}`),
        "@type": "lfn:LearningExample",
        name: example.label,
        "lfn:kind": example.kind,
        "lfn:status": example.status,
        ...(example.kind === "concept"
          ? { "lfn:concept": conceptRef(example.id), "lfn:aliases": example.aliases || [] }
          : {
            "lfn:sourceConcept": conceptRef(example.source),
            "lfn:targetConcept": conceptRef(example.target),
            "lfn:sourceLabel": example.sourceLabel,
            "lfn:targetLabel": example.targetLabel,
            "lfn:relation": example.label
          }),
        "lfn:lastReviewedAt": example.lastReviewedAt || null
      }))
    ]
  };
}

export function matchesJsonLdProjection(graph, projection) {
  if (!projection || typeof projection !== "object") return false;
  try {
    return JSON.stringify(canonicalize(buildJsonLd(graph))) === JSON.stringify(canonicalize(projection));
  } catch {
    return false;
  }
}
