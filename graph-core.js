export const GRAPH_SCHEMA = "llm-field-notes/graph@1";
export const FEEDBACK_FORMAT = "llm-field-notes/feedback@1";
export const BACKUP_FORMAT = "llm-field-notes/backup@1";
export const DIFF_FORMAT = "llm-field-notes/diff@1";
export const HEALTH_FORMAT = "llm-field-notes/health@1";
export const VAULT_FORMAT = "llm-field-notes/vault@1";
export const LEGACY_GRAPH_SCHEMAS = new Set(["llm-field-notes/graph@0"]);
export const MAX_DOCUMENT_CHARS = 300000;
export const MAX_GRAPH_DOCUMENT_CHARS = 50000000;
export const MAX_GRAPH_DOCUMENTS = 1000;
export const MAX_GRAPH_NODES = 5000;
export const MAX_GRAPH_EDGES = 10000;
export const MAX_GRAPH_REVISIONS = 20;
export const MAX_EVIDENCE_CHARS = 12000;
export const MAX_SOURCE_REFERENCES = 200;
export const MAX_ACTIVE_FEEDBACK_CONCEPTS = 100;
export const MAX_FEEDBACK_EXAMPLES = 500;
export const REVIEW_STALE_DAYS = 180;
export const MAX_AMBIGUOUS_SOURCE_IDS = 100;
export const MAX_AMBIGUOUS_EDGE_IDS = 100;
export const MAX_ID_CHARS = 200;
export const MAX_NODE_MENTIONS = 1000000;
export const MAX_FEEDBACK_COUNT = 1000000;
export const MAX_GRAPH_VERSION = Number.MAX_SAFE_INTEGER;
export const MAX_RELATION_LABEL_CHARS = 80;
export const MAX_TIMESTAMP_CHARS = 128;
export const MAX_SOURCE_URI_CHARS = 2048;
export const SOURCE_QUALITIES = new Set(["unknown", "primary", "secondary", "tertiary"]);
const DEFAULT_GRAPH_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export function advanceGraphVersion(graph) {
  if (!graph || !Number.isSafeInteger(graph.version) || graph.version >= MAX_GRAPH_VERSION) return false;
  graph.version += 1;
  return true;
}

const canAdvanceGraphVersion = (graph) => Number.isSafeInteger(graph?.version) && graph.version < MAX_GRAPH_VERSION;

export const sampleDocument = {
  title: "Attention Is All You Need — working notes",
  text: `The Transformer is a model architecture based entirely on attention mechanisms.
Self-attention allows each token to gather information from other tokens in the sequence.
Queries, keys, and values create a weighted lookup over the context.
Multi-head attention lets the model learn different relationships at the same time.
Positional encoding gives the sequence an order because attention itself is permutation invariant.
The architecture removes recurrence and convolution, which makes training more parallelizable.
The model learns through gradient descent on a prediction loss.`
};

const stopWords = new Set("a an and are as at be because been being based between by can could creates depends entirely for from gives has have how if in into is it its learn may means more of on or other our removes requires same supports that the their them these this through to use uses using was what when which with you your".split(" "));

export const defaultGraph = () => ({
  schema: GRAPH_SCHEMA,
  version: 0,
  updatedAt: null,
  documents: [],
  nodes: [],
  edges: [],
  revisions: [],
  learning: { examples: [] },
  integrity: { ambiguousSourceIds: [], ambiguousEdgeIds: [] }
});

export const makeId = (prefix) => {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  if (globalThis.crypto?.getRandomValues) {
    const random = new Uint32Array(4);
    globalThis.crypto.getRandomValues(random);
    return `${prefix}-${[...random].map((value) => value.toString(16).padStart(8, "0")).join("")}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

export const asArray = (value) => Array.isArray(value) ? value : [];
const asBoundedArray = (value, limit) => Array.isArray(value) ? value.slice(0, limit) : [];
export const slugify = (value) => value.toLowerCase().replace(/[`'"“”()[\]{}]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const edgeKey = (source, target, label) => `${source}|${target}|${slugify(label)}`;
const asText = (value, fallback = "") => typeof value === "string" ? value : fallback;
const asLine = (value, fallback = "") => asText(value, fallback).replace(/\s+/g, " ").trim();
const identityDigest = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};
const normalizeId = (value, fallback = "") => {
  const text = asText(value, fallback).trim();
  if (text.length <= MAX_ID_CHARS) return text;
  const suffix = `-${identityDigest(text)}`;
  return `${text.slice(0, MAX_ID_CHARS - suffix.length)}${suffix}`;
};
export const makeEdgeId = (source, target, label) => normalizeId(`${source}--${target}--${slugify(label)}`) || "edge";
const appendIdSuffix = (base, suffix) => {
  const suffixText = `-${suffix}`;
  return `${base.slice(0, Math.max(1, MAX_ID_CHARS - suffixText.length))}${suffixText}`;
};
const asConfidence = (value, fallback = .5) => Number.isFinite(Number(value)) ? Math.max(.01, Math.min(.99, Number(value))) : fallback;
const asBoundedCounter = (value, fallback, minimum, maximum) => Number.isSafeInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
const asDateTime = (value, fallback = null) => {
  if (typeof value !== "string" || value.length > MAX_TIMESTAMP_CHARS || !value.trim()) return fallback;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? fallback : new Date(timestamp).toISOString();
};
const newestTimestamp = (current, incoming) => incoming && (!current || Date.parse(incoming) > Date.parse(current)) ? incoming : current;
const normalizeAliases = (value) => [...new Set(asBoundedArray(value, 20).filter((item) => typeof item === "string").map((item) => asLine(item).slice(0, 120)).filter(Boolean))].slice(0, 20);
const SAFE_SOURCE_URI_SCHEMES = new Set(["http", "https", "file", "urn", "doi"]);
export const normalizeSourceUri = (value) => {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_SOURCE_URI_CHARS);
  if (!clean) return null;
  const scheme = clean.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  return scheme && !SAFE_SOURCE_URI_SCHEMES.has(scheme) ? null : clean;
};

export function fingerprintFeedbackExamples(value) {
  const canonical = asArray(value)
    .filter((example) => example && typeof example === "object" && (example.kind === "concept" || example.kind === "relation") && ["accepted", "rejected"].includes(example.status))
    .map((example) => example.kind === "concept"
      ? {
        kind: "concept",
        id: asText(example.id),
        label: asText(example.label),
        aliases: asArray(example.aliases).filter((alias) => typeof alias === "string").map((alias) => alias.trim()).sort(),
        status: example.status
      }
      : {
        kind: "relation",
        id: asText(example.id),
        source: asText(example.source),
        sourceLabel: asText(example.sourceLabel),
        target: asText(example.target),
        targetLabel: asText(example.targetLabel),
        label: asText(example.label),
        status: example.status
      })
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const serialized = JSON.stringify(canonical);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeLearningExample(value) {
  if (!value || typeof value !== "object" || !["concept", "relation"].includes(value.kind) || !["accepted", "rejected"].includes(value.status)) return null;
  if (value.kind === "concept") {
    const label = asLine(value.label, asText(value.id)).slice(0, 120);
    const id = normalizeId(asText(value.id)) || slugify(label);
    if (!id || !label) return null;
    return {
      kind: "concept",
      id,
      label,
      aliases: normalizeAliases(value.aliases),
      status: value.status,
      lastReviewedAt: asDateTime(value.lastReviewedAt)
    };
  }
  const source = normalizeId(asText(value.source)) || slugify(asText(value.sourceLabel));
  const target = normalizeId(asText(value.target)) || slugify(asText(value.targetLabel));
  const label = asLine(value.label).slice(0, MAX_RELATION_LABEL_CHARS);
  if (!source || !target || !label) return null;
  return {
    kind: "relation",
    id: normalizeId(value.id) || makeEdgeId(source, target, label),
    source,
    sourceLabel: asLine(value.sourceLabel, source).slice(0, 120),
    target,
    targetLabel: asLine(value.targetLabel, target).slice(0, 120),
    label,
    status: value.status,
    lastReviewedAt: asDateTime(value.lastReviewedAt)
  };
}

function learningExampleKey(example) {
  return example.kind === "concept"
    ? `concept|${example.id}`
    : `relation|${example.id}`;
}

function learningExamplesEquivalent(left, right) {
  if (!left || !right || left.kind !== right.kind || left.status !== right.status) return false;
  if (left.kind === "concept") {
    return left.id === right.id
      && slugify(left.label) === slugify(right.label)
      && JSON.stringify((left.aliases || []).map(slugify).sort()) === JSON.stringify((right.aliases || []).map(slugify).sort());
  }
  return left.id === right.id
    && left.source === right.source
    && left.target === right.target
    && slugify(left.label) === slugify(right.label);
}

function normalizeLearning(value) {
  const examples = new Map();
  const boundedExamples = Array.isArray(value?.examples)
    ? value.examples.slice(-MAX_FEEDBACK_EXAMPLES)
    : [];
  boundedExamples.forEach((item) => {
    const example = normalizeLearningExample(item);
    if (example) {
      const key = learningExampleKey(example);
      examples.delete(key);
      examples.set(key, example);
    }
  });
  return { examples: [...examples.values()] };
}

function fingerprintText(text) {
  const canonical = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim();
  let primary = 2166136261;
  let secondary = 2654435761;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    primary ^= code;
    primary = Math.imul(primary, 16777619);
    secondary ^= code + ((index + 1) * 31);
    secondary = Math.imul(secondary, 2246822519);
  }
  return `fnv64-${(primary >>> 0).toString(16).padStart(8, "0")}${(secondary >>> 0).toString(16).padStart(8, "0")}-${canonical.length}`;
}

export function fingerprintBackup(graph, history = []) {
  const serialized = JSON.stringify({
    graph: normalizeGraph(graph),
    history: asArray(history).map((item) => normalizeGraph(item))
  });
  let primary = 2166136261;
  let secondary = 2654435761;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    primary ^= code;
    primary = Math.imul(primary, 16777619);
    secondary ^= code + ((index + 1) * 31);
    secondary = Math.imul(secondary, 2246822519);
  }
  return `fnv64-${(primary >>> 0).toString(16).padStart(8, "0")}${(secondary >>> 0).toString(16).padStart(8, "0")}-${serialized.length}`;
}

function normalizeEvidence(value, fallbackSources = []) {
  const boundedFallbackSources = normalizeSourceIds(fallbackSources);
  return asBoundedArray(value, 8).map((item) => {
    if (typeof item === "string") {
      const text = item.slice(0, MAX_EVIDENCE_CHARS);
      return text.trim() ? { text, sources: boundedFallbackSources } : null;
    }
    if (!item || typeof item !== "object" || !asText(item.text).trim()) return null;
    const text = asText(item.text).slice(0, MAX_EVIDENCE_CHARS);
    return {
      text,
      sources: normalizeSourceIds(item.sources)
    };
  }).filter(Boolean);
}

const normalizeSourceIds = (value, fallback = []) => [...new Set([...asBoundedArray(fallback, MAX_SOURCE_REFERENCES), ...asBoundedArray(value, MAX_SOURCE_REFERENCES)]
  .filter((item) => typeof item === "string")
  .map((item) => normalizeId(item))
  .filter(Boolean))].slice(0, MAX_SOURCE_REFERENCES);
const mergeSourceIds = (...values) => normalizeSourceIds(values.flat());

function mergeEvidence(current, incoming) {
  const merged = new Map();
  [...normalizeEvidence(current), ...normalizeEvidence(incoming)].forEach((item) => {
    const key = item.text.trim();
    const existing = merged.get(key);
    if (existing) existing.sources = mergeSourceIds(existing.sources, item.sources);
    else merged.set(key, { text: item.text, sources: [...item.sources] });
  });
  return [...merged.values()].slice(0, 8);
}

function makeUniqueEdgeIds(edges) {
  const used = new Set();
  return edges.map((edge) => {
    const base = normalizeId(edge.id) || "edge";
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = appendIdSuffix(base, suffix++);
    used.add(id);
    return id === edge.id ? edge : { ...edge, id };
  });
}

export function normalizeExtraction(value, fallbackTitle = "Untitled document", fallbackText = "") {
  const input = value && typeof value === "object" ? value : {};
  const inputSource = input.source && typeof input.source === "object" ? input.source : {};
  const sourceText = asText(inputSource.text, fallbackText).slice(0, MAX_DOCUMENT_CHARS);
  const sourceId = normalizeId(inputSource.id) || `doc-${fingerprintText(sourceText)}`;
  const source = {
    id: sourceId,
    title: asLine(inputSource.title, fallbackTitle).slice(0, 200),
    text: sourceText,
    fingerprint: normalizeId(inputSource.fingerprint) || fingerprintText(sourceText),
    uri: normalizeSourceUri(inputSource.uri),
    addedAt: asDateTime(inputSource.addedAt, new Date().toISOString()),
    quality: SOURCE_QUALITIES.has(inputSource.quality) ? inputSource.quality : "unknown",
    lastReviewedAt: asDateTime(inputSource.lastReviewedAt)
  };
  const idMap = new Map();
  const ambiguousIdMapKeys = new Set();
  const setIdMap = (key, id) => {
    if (!key || ambiguousIdMapKeys.has(key)) return;
    const previous = idMap.get(key);
    if (previous && previous !== id) {
      idMap.delete(key);
      ambiguousIdMapKeys.add(key);
      return;
    }
    idMap.set(key, id);
  };
  const normalizedNodes = asArray(input.nodes).slice(0, MAX_GRAPH_NODES).map((node) => {
    const label = asLine(node?.label, asLine(node?.name, "Unnamed concept")).slice(0, 120);
    const rawInputId = asText(node?.id).trim();
    const rawId = normalizeId(rawInputId) || slugify(label) || makeId("concept");
    const id = rawInputId ? rawId : slugify(rawId) || rawId;
    if (rawInputId) setIdMap(rawInputId, id);
    setIdMap(rawId, id);
    setIdMap(slugify(label), id);
    const sources = normalizeSourceIds(node?.sources, [sourceId]);
    return {
      id,
      label: label || id,
      aliases: normalizeAliases(node?.aliases),
      type: asLine(node?.type, "concept").slice(0, 30),
      confidence: asConfidence(node?.confidence, .55),
      mentions: asBoundedCounter(node?.mentions, 1, 1, MAX_NODE_MENTIONS),
      feedback: asBoundedCounter(node?.feedback, 0, -MAX_FEEDBACK_COUNT, MAX_FEEDBACK_COUNT),
      status: ["inferred", "accepted", "rejected"].includes(node?.status) ? node.status : "inferred",
      sources,
      evidence: normalizeEvidence(node?.evidence, sources),
      createdAt: asDateTime(node?.createdAt, new Date().toISOString()),
      updatedAt: asDateTime(node?.updatedAt, new Date().toISOString()),
      lastReviewedAt: asDateTime(node?.lastReviewedAt)
    };
  });
  const nodesById = new Map();
  normalizedNodes.forEach((node) => {
    const existing = nodesById.get(node.id);
    if (!existing) {
      nodesById.set(node.id, node);
      return;
    }
    if (existing.label !== node.label) existing.aliases = [...new Set([...existing.aliases, node.label])].slice(0, 20);
    existing.aliases = [...new Set([...existing.aliases, ...node.aliases])].slice(0, 20);
    existing.sources = mergeSourceIds(existing.sources, node.sources);
    existing.evidence = mergeEvidence(existing.evidence, node.evidence);
    existing.mentions = Math.min(MAX_NODE_MENTIONS, existing.mentions + node.mentions);
    existing.feedback = Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, existing.feedback + node.feedback));
    existing.confidence = Math.max(existing.confidence, node.confidence);
    if (existing.status !== "accepted" && node.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && node.status === "rejected") existing.status = "rejected";
    existing.lastReviewedAt = newestTimestamp(existing.lastReviewedAt, node.lastReviewedAt);
    existing.updatedAt = node.updatedAt;
  });
  const nodes = [...nodesById.values()];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const normalizedEdges = asArray(input.edges).slice(0, MAX_GRAPH_EDGES).map((edge) => {
    const rawSource = asText(edge?.source);
    const rawTarget = asText(edge?.target);
    const source = idMap.get(rawSource) || idMap.get(normalizeId(rawSource)) || idMap.get(slugify(rawSource)) || rawSource;
    const target = idMap.get(rawTarget) || idMap.get(normalizeId(rawTarget)) || idMap.get(slugify(rawTarget)) || rawTarget;
    const label = asLine(edge?.label, "related to").slice(0, MAX_RELATION_LABEL_CHARS);
    if (!nodeIds.has(source) || !nodeIds.has(target)) return null;
    const sources = normalizeSourceIds(edge?.sources, [sourceId]);
    return {
      id: normalizeId(edge?.id) || makeEdgeId(source, target, label),
      source,
      target,
      label,
      confidence: asConfidence(edge?.confidence, .55),
      feedback: asBoundedCounter(edge?.feedback, 0, -MAX_FEEDBACK_COUNT, MAX_FEEDBACK_COUNT),
      evidence: normalizeEvidence(edge?.evidence, sources),
      sources,
      status: ["inferred", "accepted", "rejected"].includes(edge?.status) ? edge.status : "inferred",
      lastReviewedAt: asDateTime(edge?.lastReviewedAt)
    };
  }).filter(Boolean);
  const edgesByKey = new Map();
  normalizedEdges.forEach((edge) => {
    const key = edgeKey(edge.source, edge.target, edge.label);
    const existing = edgesByKey.get(key);
    if (!existing) {
      edgesByKey.set(key, edge);
      return;
    }
    existing.sources = mergeSourceIds(existing.sources, edge.sources);
    existing.evidence = mergeEvidence(existing.evidence, edge.evidence);
    existing.confidence = Math.max(existing.confidence, edge.confidence);
    existing.feedback = Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, existing.feedback + edge.feedback));
    if (existing.status !== "accepted" && edge.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && edge.status === "rejected") existing.status = "rejected";
    existing.lastReviewedAt = newestTimestamp(existing.lastReviewedAt, edge.lastReviewedAt);
  });
  const edges = makeUniqueEdgeIds([...edgesByKey.values()]);
  return { source, nodes, edges };
}

export function normalizeGraph(value) {
  if (!value || typeof value !== "object" || (value.schema !== GRAPH_SCHEMA && !LEGACY_GRAPH_SCHEMAS.has(value.schema))) return defaultGraph();
  const wasMigrated = value.schema !== GRAPH_SCHEMA;
  const graph = defaultGraph();
  graph.version = Number.isSafeInteger(value.version) && value.version >= 0 ? value.version : 0;
  graph.updatedAt = asDateTime(value.updatedAt, null);
  if (value.redacted === true) graph.redacted = true;
  const graphFallbackTimestamp = graph.updatedAt || DEFAULT_GRAPH_TIMESTAMP;
  const ambiguousSourceIds = new Set(asBoundedArray(value.integrity?.ambiguousSourceIds, MAX_AMBIGUOUS_SOURCE_IDS)
    .filter((id) => typeof id === "string")
    .map((id) => normalizeId(id))
    .filter(Boolean));
  const ambiguousEdgeIds = new Set(asBoundedArray(value.integrity?.ambiguousEdgeIds, MAX_AMBIGUOUS_EDGE_IDS)
    .filter((id) => typeof id === "string")
    .map((id) => normalizeId(id))
    .filter(Boolean));
  const normalizedDocuments = asBoundedArray(value.documents, MAX_GRAPH_DOCUMENTS).filter((doc) => doc && typeof doc === "object").map((doc) => {
    const text = asText(doc.text).slice(0, MAX_DOCUMENT_CHARS);
    const fingerprint = normalizeId(doc.fingerprint) || fingerprintText(text);
    return {
      id: normalizeId(doc.id) || `doc-${fingerprintText(fingerprint)}`,
      title: asLine(doc.title, "Untitled document").slice(0, 200),
      text,
      fingerprint,
      uri: normalizeSourceUri(doc.uri),
      addedAt: asDateTime(doc.addedAt, graphFallbackTimestamp),
      quality: SOURCE_QUALITIES.has(doc.quality) ? doc.quality : "unknown",
      lastReviewedAt: asDateTime(doc.lastReviewedAt)
    };
  });
  const documentsById = new Map();
  normalizedDocuments.forEach((document) => {
    let documentId = document.id;
    let existing = documentsById.get(documentId);
    const sameContent = existing && (
      existing.fingerprint === document.fingerprint
      || (existing.text && document.text && existing.text === document.text)
    );
    if (existing && !sameContent) {
      ambiguousSourceIds.add(document.id);
      const baseId = `doc-${fingerprintText(document.text)}`;
      documentId = baseId;
      let suffix = 2;
      while (documentsById.has(documentId)) documentId = `${baseId}-${suffix++}`;
      document = { ...document, id: documentId };
      existing = documentsById.get(documentId);
    }
    if (!existing) {
      documentsById.set(documentId, document);
      return;
    }
    if (existing.title === "Untitled document" && document.title !== "Untitled document") existing.title = document.title;
    if (!existing.text && document.text) existing.text = document.text;
    if (!existing.fingerprint && document.fingerprint) existing.fingerprint = document.fingerprint;
    if (!existing.uri && document.uri) existing.uri = document.uri;
    if (existing.quality === "unknown" && document.quality !== "unknown") existing.quality = document.quality;
    if (document.lastReviewedAt && (!existing.lastReviewedAt || Date.parse(document.lastReviewedAt) > Date.parse(existing.lastReviewedAt))) {
      existing.lastReviewedAt = document.lastReviewedAt;
    }
  });
  graph.documents = [...documentsById.values()];
  graph.integrity = {
    ambiguousSourceIds: [...ambiguousSourceIds].slice(0, MAX_AMBIGUOUS_SOURCE_IDS),
    ambiguousEdgeIds: [...ambiguousEdgeIds].slice(0, MAX_AMBIGUOUS_EDGE_IDS)
  };
  const normalizedNodes = asBoundedArray(value.nodes, MAX_GRAPH_NODES).filter((node) => node && typeof node === "object" && asText(node.id).trim()).map((node) => ({
    id: normalizeId(node.id),
    label: asLine(node.label, "Unnamed concept").slice(0, 120),
    aliases: normalizeAliases(node.aliases),
    type: asLine(node.type, "concept").slice(0, 30),
    confidence: asConfidence(node.confidence),
    mentions: asBoundedCounter(node.mentions, 1, 1, MAX_NODE_MENTIONS),
    feedback: asBoundedCounter(node.feedback, 0, -MAX_FEEDBACK_COUNT, MAX_FEEDBACK_COUNT),
    status: ["inferred", "accepted", "rejected"].includes(node.status) ? node.status : "inferred",
    sources: normalizeSourceIds(node.sources),
    evidence: normalizeEvidence(node.evidence, normalizeSourceIds(node.sources)),
    createdAt: asDateTime(node.createdAt, graphFallbackTimestamp),
    updatedAt: asDateTime(node.updatedAt, graphFallbackTimestamp),
    lastReviewedAt: asDateTime(node.lastReviewedAt)
  }));
  const nodesById = new Map();
  normalizedNodes.forEach((node) => {
    const existing = nodesById.get(node.id);
    if (!existing) {
      nodesById.set(node.id, node);
      return;
    }
    if (existing.label !== node.label) existing.aliases = [...new Set([...existing.aliases, node.label])].slice(0, 20);
    existing.aliases = [...new Set([...existing.aliases, ...node.aliases])].slice(0, 20);
    existing.sources = mergeSourceIds(existing.sources, node.sources);
    existing.evidence = mergeEvidence(existing.evidence, node.evidence);
    existing.mentions = Math.min(MAX_NODE_MENTIONS, existing.mentions + node.mentions);
    existing.feedback = Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, existing.feedback + node.feedback));
    existing.confidence = Math.max(existing.confidence, node.confidence);
    if (existing.status !== "accepted" && node.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && node.status === "rejected") existing.status = "rejected";
    existing.updatedAt = node.updatedAt;
  });
  graph.nodes = [...nodesById.values()];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const normalizedEdges = asBoundedArray(value.edges, MAX_GRAPH_EDGES).filter((edge) => edge && typeof edge === "object" && nodeIds.has(normalizeId(edge.source)) && nodeIds.has(normalizeId(edge.target))).map((edge) => ({
    id: normalizeId(edge.id) || makeEdgeId(normalizeId(edge.source), normalizeId(edge.target), asText(edge.label, "related-to")),
    source: normalizeId(edge.source),
    target: normalizeId(edge.target),
    label: asLine(edge.label, "related to").slice(0, MAX_RELATION_LABEL_CHARS),
    confidence: asConfidence(edge.confidence),
    feedback: asBoundedCounter(edge.feedback, 0, -MAX_FEEDBACK_COUNT, MAX_FEEDBACK_COUNT),
    evidence: normalizeEvidence(edge.evidence, normalizeSourceIds(edge.sources)),
    sources: normalizeSourceIds(edge.sources),
    status: ["inferred", "accepted", "rejected"].includes(edge.status) ? edge.status : "inferred",
    lastReviewedAt: asDateTime(edge.lastReviewedAt)
  }));
  const edgesByKey = new Map();
  const edgeIdAliases = new Map();
  const edgeIdOwners = new Map();
  normalizedEdges.forEach((edge) => {
    const key = `${edge.source}|${edge.target}|${slugify(edge.label)}`;
    const reverseKey = `${edge.target}|${edge.source}|${slugify(edge.label)}`;
    const semanticKey = [key, reverseKey].sort()[0];
    const previousOwner = edgeIdOwners.get(edge.id);
    if (previousOwner && previousOwner !== semanticKey) ambiguousEdgeIds.add(edge.id);
    else edgeIdOwners.set(edge.id, semanticKey);
    const existing = edgesByKey.get(key) || edgesByKey.get(reverseKey);
    if (!existing) {
      edgesByKey.set(key, edge);
      return;
    }
    if (edge.id !== existing.id || edge.source !== existing.source || edge.target !== existing.target) {
      edgeIdAliases.set(edge.id, existing);
    }
    existing.sources = mergeSourceIds(existing.sources, edge.sources);
    existing.evidence = mergeEvidence(existing.evidence, edge.evidence);
    existing.feedback = Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, existing.feedback + edge.feedback));
    existing.confidence = Math.max(existing.confidence, edge.confidence);
    if (existing.status !== "accepted" && edge.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && edge.status === "rejected") existing.status = "rejected";
  });
  graph.edges = makeUniqueEdgeIds([...edgesByKey.values()]);
  graph.integrity.ambiguousEdgeIds = [...ambiguousEdgeIds].slice(0, MAX_AMBIGUOUS_EDGE_IDS);
  graph.revisions = asBoundedArray(value.revisions, MAX_GRAPH_REVISIONS).filter((revision) => revision && typeof revision === "object").map((revision, index) => ({
    id: normalizeId(revision.id) || `rev-${graph.version}-${index}`,
    version: Number.isSafeInteger(revision.version) && revision.version >= 0 ? revision.version : 0,
    timestamp: asDateTime(revision.timestamp, graphFallbackTimestamp),
    reason: asLine(revision.reason, "Updated graph").slice(0, 200),
    nodes: Number.isInteger(revision.nodes) ? Math.max(0, Math.min(MAX_GRAPH_NODES, revision.nodes)) : graph.nodes.length,
    edges: Number.isInteger(revision.edges) ? Math.max(0, Math.min(MAX_GRAPH_EDGES, revision.edges)) : graph.edges.length
  }));
  graph.learning = normalizeLearning(value.learning);
  if (edgeIdAliases.size) {
    graph.learning = normalizeLearning({
      examples: graph.learning.examples.map((example) => (
        example.kind === "relation" && edgeIdAliases.has(example.id)
          ? (() => {
            const canonical = edgeIdAliases.get(example.id);
            return {
              ...example,
              id: canonical.id,
              source: canonical.source,
              sourceLabel: graph.nodes.find((node) => node.id === canonical.source)?.label || canonical.source,
              target: canonical.target,
              targetLabel: graph.nodes.find((node) => node.id === canonical.target)?.label || canonical.target,
              label: canonical.label
            };
          })()
          : example
      ))
    });
  }
  if (wasMigrated) {
    graph.revisions.unshift({
      id: `rev-migration-${slugify(value.schema)}-${graph.version}`,
      version: graph.version,
      timestamp: graphFallbackTimestamp,
      reason: `Migrated ${value.schema} to ${GRAPH_SCHEMA}`,
      nodes: graph.nodes.length,
      edges: graph.edges.length
    });
    graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  }
  return graph;
}

const cleanPhrase = (value) => value.replace(/^#+\s*/, "").replace(/[`"'“”()[\]{}]/g, "").replace(/\s+/g, " ").trim().replace(/^(the|a|an)\s+/i, "").replace(/[.,;:!?]+$/, "");
const wordsIn = (value) => (value.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter((word) => !stopWords.has(word));

function feedbackHints(value) {
  const concepts = new Map();
  const ambiguousConceptKeys = new Set();
  const relations = [];
  const indexConcept = (key, hint) => {
    if (!key || ambiguousConceptKeys.has(key)) return;
    const previous = concepts.get(key);
    if (previous && previous.id !== hint.id) {
      concepts.delete(key);
      ambiguousConceptKeys.add(key);
      return;
    }
    concepts.set(key, hint);
  };
  asArray(value).slice(0, MAX_FEEDBACK_EXAMPLES).forEach((example) => {
    if (!example || typeof example !== "object") return;
    const status = ["accepted", "rejected"].includes(example.status) ? example.status : null;
    if (!status) return;
    if (example.kind === "concept") {
      const label = cleanPhrase(asLine(example.label)).slice(0, 120);
      const id = normalizeId(asText(example.id)) || slugify(label);
      if (!id || !label) return;
      const aliases = normalizeAliases(example.aliases);
      const keys = [...new Set([id, slugify(label), ...aliases.map((alias) => slugify(alias)).filter(Boolean)])];
      const hint = {
        id,
        label,
        aliases,
        status
      };
      keys.forEach((key) => indexConcept(key, hint));
      return;
    }
    if (example.kind === "relation") {
      const label = cleanPhrase(asLine(example.label)).slice(0, MAX_RELATION_LABEL_CHARS);
      const sourceLabel = cleanPhrase(asLine(example.sourceLabel, example.source)).slice(0, 120);
      const targetLabel = cleanPhrase(asLine(example.targetLabel, example.target)).slice(0, 120);
      const source = normalizeId(asText(example.source)) || slugify(sourceLabel);
      const target = normalizeId(asText(example.target)) || slugify(targetLabel);
      if (label && source && target) relations.push({
        source,
        sourceLabel: slugify(sourceLabel),
        target,
        targetLabel: slugify(targetLabel),
        label,
        status
      });
    }
  });
  return { concepts, ambiguousConceptKeys, relations };
}

export function extractGraph(title, text, { feedback = [], sourceUri } = {}) {
  const boundedText = asText(text).slice(0, MAX_DOCUMENT_CHARS);
  const sourceId = `doc-${fingerprintText(boundedText)}`;
  const sentences = boundedText.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter((item) => item.length > 25);
  const hints = feedbackHints(feedback);
  const rejectedConcepts = new Set([...hints.concepts.values()].filter((hint) => hint.status === "rejected").map((hint) => hint.id));
  const candidates = new Map();
  const addCandidate = (raw, kind, sentence = "") => {
    const label = cleanPhrase(raw);
    const rawId = slugify(label);
    if (!rawId || hints.ambiguousConceptKeys.has(rawId) || label.length < 3 || label.length > 64 || stopWords.has(rawId)) return;
    const hint = hints.concepts.get(rawId);
    const id = hint?.id || rawId;
    if (rejectedConcepts.has(id) || hint?.status === "rejected") return;
    const existing = candidates.get(id) || { id, label: hint?.label || label, kind, mentions: 0, evidence: [] };
    existing.mentions = Math.min(MAX_NODE_MENTIONS, existing.mentions + 1);
    if (sentence && !existing.evidence.includes(sentence)) existing.evidence.push(sentence);
    if (kind === "heading" || kind === "quoted") existing.kind = kind;
    if (hint?.status === "accepted") {
      existing.feedback = "accepted";
      existing.aliases = [...new Set([...(existing.aliases || []), ...hint.aliases, label].filter((item) => item !== existing.label))].slice(0, 20);
    }
    candidates.set(id, existing);
  };
  const searchableText = ` ${boundedText.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ")} `;
  [...hints.concepts.values()]
    .filter((hint) => hint.status === "accepted")
    .filter((hint, index, values) => values.findIndex((candidate) => candidate.id === hint.id) === index)
    .slice(0, MAX_ACTIVE_FEEDBACK_CONCEPTS)
    .forEach((hint) => {
      for (const term of [hint.label, ...hint.aliases]) {
        if (hints.ambiguousConceptKeys.has(slugify(term))) continue;
        const normalizedTerm = ` ${term.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ")} `;
        if (searchableText.includes(normalizedTerm)) {
          addCandidate(term, "feedback");
          break;
        }
      }
    });
  boundedText.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
    if (/^#{1,3}\s+/.test(line)) addCandidate(line, "heading");
    (line.match(/`([^`]+)`/g) || []).forEach((term) => addCandidate(term, "quoted"));
  });
  sentences.forEach((sentence) => {
    (sentence.match(/\b[A-Z][a-zA-Z0-9-]*(?:\s+[A-Z][a-zA-Z0-9-]*){0,3}\b/g) || []).forEach((term) => addCandidate(term, "phrase", sentence));
    wordsIn(sentence).forEach((word) => addCandidate(word, "term", sentence));
  });
  const allCandidates = [...candidates.values()];
  const meaningfulCandidates = allCandidates.filter((item) => item.kind !== "term" || item.mentions > 1 || item.label.length >= 8);
  const ranked = (meaningfulCandidates.length >= 4 ? meaningfulCandidates : allCandidates).sort((a, b) => {
    const kindScore = (item) => item.kind === "heading" ? 10 : item.kind === "quoted" ? 7 : item.label.includes(" ") ? 4 : 0;
    return (b.mentions * 3 + kindScore(b)) - (a.mentions * 3 + kindScore(a));
  }).slice(0, 18);
  const nodeIds = new Set(ranked.map((item) => item.id));
  const nodes = ranked.map((item) => ({
    id: item.id,
    label: item.label,
    type: item.kind === "heading" ? "topic" : "concept",
    aliases: item.aliases || [],
    confidence: Math.min(.96, .46 + item.mentions * .09 + (item.kind === "heading" ? .16 : 0) + (item.feedback === "accepted" ? .14 : 0)),
    mentions: item.mentions,
    feedback: 0,
    status: "inferred",
    sources: [sourceId],
    evidence: item.evidence.slice(0, 4).map((sentence) => ({ text: sentence, sources: [sourceId] })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
  const edges = [];
  const matchesHintEndpoint = (hint, item, endpoint) => {
    const labelKey = endpoint === "source" ? "sourceLabel" : "targetLabel";
    return hint[endpoint] === item.id
      || (hint[labelKey] && [item.label, ...(item.aliases || [])].some((label) => slugify(label) === hint[labelKey]));
  };
  sentences.forEach((sentence) => {
    const lowerSentence = sentence.toLowerCase();
    const present = ranked
      .filter((item) => nodeIds.has(item.id))
      .map((item) => ({ item, start: lowerSentence.indexOf(item.label.toLowerCase()) }))
      .filter((entry) => entry.start >= 0)
      .sort((a, b) => a.start - b.start)
      .filter((entry, index, entries) => index === entries.findIndex((candidate) => candidate.start === entry.start))
      .slice(0, 5)
      .map((entry) => entry.item);
    for (let index = 0; index < present.length - 1; index += 1) {
      const left = present[index];
      const right = present[index + 1];
      const leftEnd = lowerSentence.indexOf(left.label.toLowerCase()) + left.label.length;
      const rightStart = lowerSentence.indexOf(right.label.toLowerCase(), leftEnd);
      const between = rightStart >= leftEnd ? sentence.slice(leftEnd, rightStart) : "";
      const relationMatch = between.match(/\b(is|are|uses|enables|requires|contains|depends on|allows|supports|creates|gives|removes|means)\b/i);
      const relationHints = hints.relations.filter((hint) => (
        matchesHintEndpoint(hint, left, "source") && matchesHintEndpoint(hint, right, "target")
      ));
      const rejectedRelation = relationHints.find((hint) => hint.status === "rejected");
      if (rejectedRelation) continue;
      const acceptedRelation = relationHints.find((hint) => hint.status === "accepted");
      const label = acceptedRelation?.label || (relationMatch ? relationMatch[1].toLowerCase() : "co-mentioned with");
      edges.push({
        source: left.id,
        target: right.id,
        label,
        id: makeEdgeId(left.id, right.id, label),
        confidence: Math.min(.96, .52 + Math.min(.35, (left.mentions + right.mentions) * .04) + (acceptedRelation ? .14 : 0)),
        feedback: 0,
        evidence: [{ text: sentence, sources: [sourceId] }],
        sources: [sourceId],
        status: "inferred"
      });
    }
    hints.relations
      .map((hint) => ({
        hint,
        source: present.find((item) => matchesHintEndpoint(hint, item, "source")),
        target: present.find((item) => matchesHintEndpoint(hint, item, "target"))
      }))
      .filter(({ hint, source, target }) => hint.status === "accepted" && source && target && source.id !== target.id)
      .forEach(({ hint, source, target }) => {
        const key = edgeKey(source.id, target.id, hint.label);
        if (edges.some((edge) => edge.source === source.id && edge.target === target.id && edgeKey(edge.source, edge.target, edge.label) === key)) return;
        edges.push({
          source: source.id,
          target: target.id,
          label: hint.label,
          id: makeEdgeId(source.id, target.id, hint.label),
          confidence: .82,
          feedback: 0,
          evidence: [{ text: sentence, sources: [sourceId] }],
          sources: [sourceId],
          status: "inferred"
        });
      });
  });
  return normalizeExtraction({
    source: { id: sourceId, title: title || "Untitled document", text: boundedText, uri: normalizeSourceUri(sourceUri) },
    nodes,
    edges
  });
}

export function mergeExtraction(graph, extraction, { revisionReason } = {}) {
  graph = normalizeGraph(graph);
  extraction = normalizeExtraction(extraction);
  const duplicate = graph.documents.some((document) => (
    document.fingerprint && document.fingerprint === extraction.source.fingerprint
  ) || (
    document.text && extraction.source.text && fingerprintText(document.text) === fingerprintText(extraction.source.text)
  ));
  if (duplicate) return { graph, duplicate: true };
  const conflictingSource = graph.documents.find((document) => (
    document.id === extraction.source.id
    && (document.text !== extraction.source.text || document.fingerprint !== extraction.source.fingerprint)
  ));
  if (conflictingSource) {
    let repairedSourceId = normalizeExtraction({
      source: { title: extraction.source.title, text: extraction.source.text },
      nodes: [],
      edges: []
    }).source.id;
    if (graph.documents.some((document) => document.id === repairedSourceId)) repairedSourceId = makeId("doc");
    const rebindSources = (sources) => [...new Set(sources.map((sourceId) => sourceId === extraction.source.id ? repairedSourceId : sourceId))];
    extraction = {
      ...extraction,
      source: { ...extraction.source, id: repairedSourceId },
      nodes: extraction.nodes.map((node) => ({
        ...node,
        sources: rebindSources(node.sources),
        evidence: node.evidence.map((evidence) => ({ ...evidence, sources: rebindSources(evidence.sources) }))
      })),
      edges: extraction.edges.map((edge) => ({
        ...edge,
        sources: rebindSources(edge.sources),
        evidence: edge.evidence.map((evidence) => ({ ...evidence, sources: rebindSources(evidence.sources) }))
      }))
    };
  }
  if (graph.documents.length >= MAX_GRAPH_DOCUMENTS) return { graph, duplicate: false, limited: "documents" };
  const currentDocumentChars = graph.documents.reduce((total, document) => total + document.text.length, 0);
  if (currentDocumentChars + extraction.source.text.length > MAX_GRAPH_DOCUMENT_CHARS) {
    return { graph, duplicate: false, limited: "document-text" };
  }
  if (!canAdvanceGraphVersion(graph)) return { graph, duplicate: false, limited: "version" };
  const now = new Date().toISOString();
  const cloneEvidence = (evidence) => evidence.map((item) => ({ text: item.text, sources: [...item.sources] }));
  const cloneNode = (node) => ({
    ...node,
    aliases: [...(node.aliases || [])],
    sources: [...node.sources],
    evidence: cloneEvidence(node.evidence)
  });
  const cloneEdge = (edge) => ({
    ...edge,
    sources: [...edge.sources],
    evidence: cloneEvidence(edge.evidence)
  });
  // Build the candidate graph from copies. If a collection limit is reached,
  // callers receive the untouched normalized graph rather than a partially
  // mutated candidate that looks successful.
  const knownNodes = new Map(graph.nodes.map((node) => [node.id, cloneNode(node)]));
  const knownNodeAliases = new Map();
  const ambiguousNodeAliases = new Set();
  const indexNodeAlias = (label, node) => {
    const key = slugify(label);
    if (!key || ambiguousNodeAliases.has(key)) return;
    const previous = knownNodeAliases.get(key);
    if (previous && previous.id !== node.id) {
      knownNodeAliases.delete(key);
      ambiguousNodeAliases.add(key);
      return;
    }
    knownNodeAliases.set(key, node);
  };
  knownNodes.forEach((node) => {
    [node.label, ...(node.aliases || [])].forEach((label) => indexNodeAlias(label, node));
  });
  const incomingToKnown = new Map();
  extraction.nodes.forEach((incoming) => {
    const existing = knownNodes.get(incoming.id) || knownNodeAliases.get(incoming.id);
    incomingToKnown.set(incoming.id, existing?.id || incoming.id);
    if (existing) {
      existing.mentions = Math.min(MAX_NODE_MENTIONS, existing.mentions + incoming.mentions);
      existing.confidence = existing.status === "rejected"
        ? Math.max(.05, existing.confidence + Math.min(0, existing.feedback) * .02)
        : Math.min(.99, (existing.confidence + incoming.confidence) / 2 + .03 + Math.max(0, existing.feedback) * .015);
      existing.aliases = [...new Set([...(existing.aliases || []), ...(incoming.aliases || [])])].slice(0, 20);
      existing.sources = mergeSourceIds(existing.sources, incoming.sources);
      existing.evidence = mergeEvidence(existing.evidence, incoming.evidence);
      existing.lastReviewedAt = newestTimestamp(existing.lastReviewedAt, incoming.lastReviewedAt);
      existing.updatedAt = now;
      existing.aliases.forEach((alias) => indexNodeAlias(alias, existing));
    } else {
      knownNodes.set(incoming.id, incoming);
      [incoming.label, ...(incoming.aliases || [])].forEach((label) => indexNodeAlias(label, incoming));
    }
  });
  if (knownNodes.size > MAX_GRAPH_NODES) return { graph, duplicate: false, limited: "nodes" };
  const knownEdges = new Map(graph.edges.map((edge) => [edgeKey(edge.source, edge.target, edge.label), cloneEdge(edge)]));
  extraction.edges.forEach((incoming) => {
    const source = incomingToKnown.get(incoming.source) || incoming.source;
    const target = incomingToKnown.get(incoming.target) || incoming.target;
    const key = edgeKey(source, target, incoming.label);
    const reverseKey = edgeKey(target, source, incoming.label);
    const existing = knownEdges.get(key) || knownEdges.get(reverseKey);
    if (existing) {
      existing.confidence = existing.status === "rejected"
        ? Math.max(.05, existing.confidence + Math.min(0, existing.feedback) * .02)
        : Math.min(.99, existing.confidence + .04 + Math.max(0, existing.feedback) * .015);
      existing.evidence = mergeEvidence(existing.evidence, incoming.evidence);
      existing.sources = mergeSourceIds(existing.sources, incoming.sources);
      existing.lastReviewedAt = newestTimestamp(existing.lastReviewedAt, incoming.lastReviewedAt);
    } else {
      knownEdges.set(key, { ...incoming, source, target, id: makeEdgeId(source, target, incoming.label) });
    }
  });
  if (knownEdges.size > MAX_GRAPH_EDGES) return { graph, duplicate: false, limited: "edges" };
  delete graph.redacted;
  graph.documents.push(extraction.source);
  graph.nodes = [...knownNodes.values()];
  graph.edges = [...knownEdges.values()].filter((edge) => knownNodes.has(edge.source) && knownNodes.has(edge.target));
  advanceGraphVersion(graph);
  graph.updatedAt = now;
  graph.revisions.unshift({
    id: `rev-${graph.version}`,
    version: graph.version,
    timestamp: now,
    reason: revisionReason || `Ingested ${extraction.source.title}`,
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  return { graph, duplicate: false };
}

export function replaceSource(value, sourceId, extraction) {
  const graph = normalizeGraph(value);
  const source = graph.documents.find((document) => document.id === sourceId);
  if (!source) return { graph, replaced: false };
  if (!canAdvanceGraphVersion(graph)) return { graph, replaced: false, limited: "version" };
  let normalizedExtraction = normalizeExtraction(extraction);
  const duplicate = graph.documents.some((document) => document.id !== sourceId && (
    (document.fingerprint && document.fingerprint === normalizedExtraction.source.fingerprint)
    || (document.text && normalizedExtraction.source.text && fingerprintText(document.text) === fingerprintText(normalizedExtraction.source.text))
  ));
  if (duplicate) return { graph, replaced: false, duplicate: true };
  const incomingSourceId = normalizedExtraction.source.id;
  const rebindSource = (candidate) => candidate === incomingSourceId ? sourceId : candidate;
  normalizedExtraction = {
    ...normalizedExtraction,
    source: {
      ...normalizedExtraction.source,
      id: sourceId,
      addedAt: source.addedAt,
      uri: normalizedExtraction.source.uri || source.uri || null,
      quality: source.quality,
      lastReviewedAt: null
    },
    nodes: normalizedExtraction.nodes.map((node) => ({
      ...node,
      sources: node.sources.map(rebindSource),
      evidence: node.evidence.map((evidence) => ({ ...evidence, sources: evidence.sources.map(rebindSource) }))
    })),
    edges: normalizedExtraction.edges.map((edge) => ({
      ...edge,
      sources: edge.sources.map(rebindSource),
      evidence: edge.evidence.map((evidence) => ({ ...evidence, sources: evidence.sources.map(rebindSource) }))
    }))
  };
  const acceptedNodeIds = new Set(graph.nodes.filter((node) => node.status === "accepted" && node.sources.includes(sourceId)).map((node) => node.id));
  const acceptedEdgeIds = new Set(graph.edges.filter((edge) => edge.status === "accepted" && edge.sources.includes(sourceId)).map((edge) => edge.id));
  const removed = removeSource(graph, sourceId, { recordRevision: false });
  removed.graph.nodes = removed.graph.nodes.map((node) => acceptedNodeIds.has(node.id)
    ? { ...node, sources: mergeSourceIds(node.sources, [sourceId]) }
    : node);
  removed.graph.edges = removed.graph.edges.map((edge) => acceptedEdgeIds.has(edge.id)
    ? { ...edge, sources: mergeSourceIds(edge.sources, [sourceId]) }
    : edge);
  const merged = mergeExtraction(removed.graph, normalizedExtraction, {
    revisionReason: `Replaced ${source.title} with ${normalizedExtraction.source.title}`
  });
  if (merged.limited || merged.duplicate) return { graph, replaced: false, limited: merged.limited, duplicate: merged.duplicate };
  return {
    ...merged,
    replaced: true,
    replacedSourceId: sourceId,
    removedNodes: removed.removedNodes,
    removedEdges: removed.removedEdges
  };
}

function diffSummary(kind, item) {
  if (kind === "document") {
    return {
      id: item.id,
      title: item.title,
      fingerprint: item.fingerprint,
      uri: item.uri,
      quality: item.quality,
      lastReviewedAt: item.lastReviewedAt,
      addedAt: item.addedAt
    };
  }
  if (kind === "node") {
    return {
      id: item.id,
      label: item.label,
      aliases: item.aliases,
      status: item.status,
      confidence: item.confidence,
      mentions: item.mentions,
      feedback: item.feedback,
      lastReviewedAt: item.lastReviewedAt,
      sources: item.sources,
      evidenceCount: item.evidence.length
    };
  }
  if (kind === "learning") {
    return {
      id: `${item.kind}:${item.id}`,
      kind: item.kind,
      identity: item.id,
      label: item.label,
      aliases: item.aliases,
      source: item.source,
      target: item.target,
      status: item.status,
      lastReviewedAt: item.lastReviewedAt
    };
  }
  return {
    id: item.id,
    source: item.source,
    target: item.target,
    label: item.label,
    status: item.status,
    confidence: item.confidence,
    feedback: item.feedback,
    lastReviewedAt: item.lastReviewedAt,
    sources: item.sources,
    evidenceCount: item.evidence.length
  };
}

function diffCollection(beforeItems, afterItems, kind) {
  const before = new Map(beforeItems.map((item) => [item.id, diffSummary(kind, item)]));
  const after = new Map(afterItems.map((item) => [item.id, diffSummary(kind, item)]));
  const added = [];
  const removed = [];
  const changed = [];
  [...after.keys()].sort().forEach((id) => {
    if (!before.has(id)) added.push(after.get(id));
    else if (JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))) {
      changed.push({ id, before: before.get(id), after: after.get(id) });
    }
  });
  [...before.keys()].sort().forEach((id) => {
    if (!after.has(id)) removed.push(before.get(id));
  });
  return { added, removed, changed };
}

function diffStringSet(beforeValues, afterValues) {
  const before = new Set(beforeValues);
  const after = new Set(afterValues);
  return {
    added: [...after].filter((value) => !before.has(value)).sort(),
    removed: [...before].filter((value) => !after.has(value)).sort()
  };
}

export function diffGraphs(beforeValue, afterValue) {
  const before = normalizeGraph(beforeValue);
  const after = normalizeGraph(afterValue);
  const documents = diffCollection(before.documents, after.documents, "document");
  const nodes = diffCollection(before.nodes, after.nodes, "node");
  const edges = diffCollection(before.edges, after.edges, "edge");
  const learning = diffCollection(before.learning.examples, after.learning.examples, "learning");
  const integrity = {
    ambiguousSourceIds: diffStringSet(before.integrity.ambiguousSourceIds, after.integrity.ambiguousSourceIds),
    ambiguousEdgeIds: diffStringSet(before.integrity.ambiguousEdgeIds, after.integrity.ambiguousEdgeIds)
  };
  const redaction = {
    before: before.redacted === true,
    after: after.redacted === true,
    changed: (before.redacted === true) !== (after.redacted === true)
  };
  const summary = {
    added: documents.added.length + nodes.added.length + edges.added.length + learning.added.length
      + integrity.ambiguousSourceIds.added.length + integrity.ambiguousEdgeIds.added.length,
    removed: documents.removed.length + nodes.removed.length + edges.removed.length + learning.removed.length
      + integrity.ambiguousSourceIds.removed.length + integrity.ambiguousEdgeIds.removed.length,
    changed: documents.changed.length + nodes.changed.length + edges.changed.length + learning.changed.length + (redaction.changed ? 1 : 0)
  };
  return {
    format: DIFF_FORMAT,
    graphSchema: GRAPH_SCHEMA,
    fromVersion: before.version,
    toVersion: after.version,
    documents,
    nodes,
    edges,
    learning,
    integrity,
    redaction,
    summary,
    changed: summary.added > 0 || summary.removed > 0 || summary.changed > 0
  };
}

export function redactGraph(value) {
  const graph = normalizeGraph(value);
  graph.documents = graph.documents.map((document) => ({
    ...document,
    text: "",
    uri: null
  }));
  const redactEvidence = (item) => ({
    ...item,
    evidence: item.evidence.map((evidence) => ({ ...evidence, text: "[redacted]" }))
  });
  graph.nodes = graph.nodes.map(redactEvidence);
  graph.edges = graph.edges.map(redactEvidence);
  graph.redacted = true;
  return graph;
}

export function applyFeedback(value, kind, id, action) {
  const graph = normalizeGraph(value);
  const collection = kind === "node" ? graph.nodes : kind === "edge" ? graph.edges : null;
  if (!collection || !["restore", "up", "down"].includes(action)) {
    return { graph, changed: false };
  }
  const item = collection.find((candidate) => candidate.id === id);
  if (!item) return { graph, changed: false };
  if (!canAdvanceGraphVersion(graph)) return { graph, changed: false, limited: "version" };
  const subject = kind === "node" ? item.label : `relation ${item.label}`;
  const verb = action === "restore" ? "Restored" : action === "up" ? "Confirmed" : "Dismissed";
  mutateFeedbackItem(item, action);
  rememberLearningItem(graph, kind, item);
  appendRevision(graph, `${verb} ${subject}`);
  return { graph, changed: true };
}

export function mergeConcepts(value, sourceId, targetId) {
  const graph = normalizeGraph(value);
  if (typeof sourceId !== "string" || typeof targetId !== "string" || sourceId === targetId) {
    return { graph, changed: false };
  }
  const source = graph.nodes.find((node) => node.id === sourceId);
  const target = graph.nodes.find((node) => node.id === targetId);
  if (!source || !target) return { graph, changed: false };
  if (!canAdvanceGraphVersion(graph)) return { graph, changed: false, limited: "version" };

  const now = new Date().toISOString();
  const status = source.status === "accepted" || target.status === "accepted"
    ? "accepted"
    : source.status === "rejected" && target.status === "rejected"
      ? "rejected"
      : "inferred";
  target.aliases = [...new Set([
    ...(target.aliases || []),
    source.label,
    ...(source.aliases || [])
  ])].filter((alias) => slugify(alias) !== slugify(target.label)).slice(0, 20);
  target.sources = mergeSourceIds(target.sources, source.sources);
  target.evidence = mergeEvidence(target.evidence, source.evidence);
  target.mentions = Math.min(MAX_NODE_MENTIONS, target.mentions + source.mentions);
  target.feedback = Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, target.feedback + source.feedback));
  target.confidence = Math.max(target.confidence, source.confidence);
  target.status = status;
  target.updatedAt = now;
  target.lastReviewedAt = now;

  const mergedEdges = new Map();
  graph.edges.forEach((edge) => {
    const nextSource = edge.source === sourceId ? targetId : edge.source;
    const nextTarget = edge.target === sourceId ? targetId : edge.target;
    if (nextSource === nextTarget) return;
    const nextEdge = {
      ...edge,
      source: nextSource,
      target: nextTarget,
      id: makeEdgeId(nextSource, nextTarget, edge.label)
    };
    const key = edgeKey(nextSource, nextTarget, nextEdge.label);
    const reverseKey = edgeKey(nextTarget, nextSource, nextEdge.label);
    const existing = mergedEdges.get(key) || mergedEdges.get(reverseKey);
    if (!existing) {
      mergedEdges.set(key, nextEdge);
      return;
    }
    existing.evidence = mergeEvidence(existing.evidence, nextEdge.evidence);
    existing.sources = mergeSourceIds(existing.sources, nextEdge.sources);
    existing.feedback = Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, existing.feedback + nextEdge.feedback));
    existing.confidence = Math.max(existing.confidence, nextEdge.confidence);
    if (existing.status !== "accepted" && nextEdge.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && nextEdge.status === "rejected") existing.status = "rejected";
  });

  graph.nodes = graph.nodes.filter((node) => node.id !== sourceId);
  graph.edges = makeUniqueEdgeIds([...mergedEdges.values()]);
  const remappedLearning = new Map();
  graph.learning.examples.forEach((example) => {
    if (example.kind === "concept") {
      if (example.id === sourceId || example.id === targetId) return;
      remappedLearning.set(learningExampleKey(example), example);
      return;
    }
    const nextSource = example.source === sourceId ? targetId : example.source;
    const nextTarget = example.target === sourceId ? targetId : example.target;
    if (nextSource === nextTarget) return;
    const endpointChanged = nextSource !== example.source || nextTarget !== example.target;
    const matchingEdge = endpointChanged
      ? graph.edges.find((edge) => (
        (edge.source === nextSource && edge.target === nextTarget)
        || (edge.source === nextTarget && edge.target === nextSource)
      ) && slugify(edge.label) === slugify(example.label))
      : null;
    const nextExample = endpointChanged
      ? {
        ...example,
        id: matchingEdge?.id || makeEdgeId(nextSource, nextTarget, example.label),
        source: nextSource,
        sourceLabel: graph.nodes.find((node) => node.id === nextSource)?.label || nextSource,
        target: nextTarget,
        targetLabel: graph.nodes.find((node) => node.id === nextTarget)?.label || nextTarget
      }
      : example;
    remappedLearning.set(learningExampleKey(nextExample), nextExample);
  });
  graph.learning.examples = [...remappedLearning.values()].slice(-MAX_FEEDBACK_EXAMPLES);
  rememberLearningItem(graph, "node", target);
  appendRevision(graph, `Merged concept ${source.label} into ${target.label}`);
  return { graph, changed: true, mergedId: targetId };
}

function mutateFeedbackItem(item, action) {
  item.lastReviewedAt = new Date().toISOString();
  if (action === "restore") {
    item.status = "inferred";
    item.feedback += 1;
    item.confidence = Math.max(.2, item.confidence);
  } else if (action === "up") {
    item.status = "accepted";
    item.feedback += 1;
    item.confidence = Math.min(.99, item.confidence + .08);
  } else {
    item.status = "rejected";
    item.feedback -= 1;
    item.confidence = Math.max(.05, item.confidence - .12);
  }
}

function updateLearningMemory(graph, kind, item) {
  const examples = new Map(graph.learning.examples.map((example) => [learningExampleKey(example), example]));
  const example = kind === "node"
    ? {
      kind: "concept",
      id: item.id,
      label: item.label,
      aliases: item.aliases || [],
      status: item.status,
      lastReviewedAt: item.lastReviewedAt || null
    }
    : {
      kind: "relation",
      id: item.id,
      source: item.source,
      sourceLabel: graph.nodes.find((node) => node.id === item.source)?.label || item.source,
      target: item.target,
      targetLabel: graph.nodes.find((node) => node.id === item.target)?.label || item.target,
      label: item.label,
      status: item.status,
      lastReviewedAt: item.lastReviewedAt || null
    };
  if (kind === "edge") {
    [...examples.entries()].forEach(([key, existing]) => {
      if (existing.kind === "relation" && existing.id === item.id) examples.delete(key);
    });
  }
  const key = learningExampleKey(example);
  if (["accepted", "rejected"].includes(item.status)) {
    const existing = examples.get(key);
    if (!existing || !learningExamplesEquivalent(existing, example)) {
      examples.delete(key);
      examples.set(key, example);
    } else if (example.lastReviewedAt && example.lastReviewedAt !== existing.lastReviewedAt) {
      examples.set(key, { ...existing, lastReviewedAt: example.lastReviewedAt });
    }
  } else examples.delete(key);
  graph.learning.examples = [...examples.values()].slice(-MAX_FEEDBACK_EXAMPLES);
}

export function rememberLearningItem(graph, kind, item) {
  updateLearningMemory(graph, kind, item);
  return graph;
}

export function syncLearningRelationLabels(value) {
  const graph = normalizeGraph(value);
  const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  let changed = false;
  graph.learning.examples = graph.learning.examples.map((example) => {
    if (example.kind !== "relation") return example;
    const sourceLabel = labels.get(example.source) || example.sourceLabel;
    const targetLabel = labels.get(example.target) || example.targetLabel;
    if (sourceLabel === example.sourceLabel && targetLabel === example.targetLabel) return example;
    changed = true;
    return { ...example, sourceLabel, targetLabel };
  });
  return { graph, changed };
}

function appendRevision(graph, reason) {
  if (!advanceGraphVersion(graph)) return false;
  graph.updatedAt = new Date().toISOString();
  graph.revisions.unshift({
    id: `rev-${graph.version}`,
    version: graph.version,
    timestamp: graph.updatedAt,
    reason,
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  return true;
}

export function applyFeedbackDataset(value, examples) {
  let graph = normalizeGraph(value);
  if (!canAdvanceGraphVersion(graph)) {
    return { graph, updates: 0, learned: 0, skipped: 0, conflicts: 0, changed: false, limited: "version" };
  }
  let updates = 0;
  let skipped = 0;
  let learned = 0;
  const normalizedExamples = [];
  const statusesByKey = new Map();
  const conflictingKeys = new Set();
  let remembered = new Map(graph.learning.examples.map((example) => [learningExampleKey(example), example]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeByLabel = new Map();
  const ambiguousNodeLabels = new Set();
  const indexNodeLabel = (label, node) => {
    const key = slugify(label);
    if (!key || ambiguousNodeLabels.has(key)) return;
    const previous = nodeByLabel.get(key);
    if (previous && previous.id !== node.id) {
      nodeByLabel.delete(key);
      ambiguousNodeLabels.add(key);
      return;
    }
    nodeByLabel.set(key, node);
  };
  graph.nodes.forEach((node) => {
    [node.label, ...(node.aliases || [])].forEach((label) => indexNodeLabel(label, node));
  });
  const findNode = (id, label) => {
    const direct = nodeById.get(asText(id));
    if (direct) return direct;
    const key = slugify(asText(label, id));
    return ambiguousNodeLabels.has(key) ? null : nodeByLabel.get(key);
  };
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const edgeByKey = new Map(graph.edges.map((edge) => [edgeKey(edge.source, edge.target, edge.label), edge]));
  asArray(examples).slice(0, 15000).forEach((example) => {
    const normalizedExample = normalizeLearningExample(example);
    if (!normalizedExample) {
      skipped += 1;
      return;
    }
    const memoryKey = learningExampleKey(normalizedExample);
    const existingStatus = statusesByKey.get(memoryKey);
    if (existingStatus && existingStatus !== normalizedExample.status) conflictingKeys.add(memoryKey);
    statusesByKey.set(memoryKey, normalizedExample.status);
    normalizedExamples.push(normalizedExample);
  });
  normalizedExamples.forEach((normalizedExample) => {
    if (!canAdvanceGraphVersion(graph)) return;
    const kind = normalizedExample.kind === "relation" ? "edge" : "node";
    const memoryKey = learningExampleKey(normalizedExample);
    const previousLearning = remembered.get(memoryKey);
    const learnedThis = !previousLearning;
    const learningChanged = !previousLearning || !learningExamplesEquivalent(previousLearning, normalizedExample);
    if (learningChanged) {
      remembered.delete(memoryKey);
      remembered.set(memoryKey, normalizedExample);
      learned += 1;
    }
    const item = kind === "node"
      ? nodeById.get(normalizedExample.id)
        || findNode("", asText(normalizedExample.label, normalizedExample.id))
      : edgeById.get(normalizedExample.id)
        || (() => {
          const source = findNode(normalizedExample.source, normalizedExample.sourceLabel);
          const target = findNode(normalizedExample.target, normalizedExample.targetLabel);
          return source && target
            ? edgeByKey.get(edgeKey(source.id, target.id, asText(normalizedExample.label)))
            : null;
        })();
    if (!item) {
      if (!learnedThis) skipped += 1;
      return;
    }
    let itemChanged = false;
    if (item.status !== normalizedExample.status) {
      mutateFeedbackItem(item, normalizedExample.status === "accepted" ? "up" : "down");
      appendRevision(graph, `${normalizedExample.status === "accepted" ? "Confirmed" : "Dismissed"} ${kind === "node" ? item.label : `relation ${item.label}`}`);
      itemChanged = true;
    }
    if (kind === "node" && normalizedExample.aliases.length && canAdvanceGraphVersion(graph)) {
      const updatedItem = item;
      const aliases = [...new Set([...(updatedItem.aliases || []), ...normalizedExample.aliases])].slice(0, 20);
      if (JSON.stringify(aliases) !== JSON.stringify(updatedItem.aliases || [])) {
        updatedItem.aliases = aliases;
        aliases.forEach((alias) => indexNodeLabel(alias, updatedItem));
        updatedItem.updatedAt = new Date().toISOString();
        advanceGraphVersion(graph);
        graph.updatedAt = updatedItem.updatedAt;
        graph.revisions.unshift({
          id: `rev-${graph.version}`,
          version: graph.version,
          timestamp: graph.updatedAt,
          reason: `Imported aliases for ${updatedItem.label}`,
          nodes: graph.nodes.length,
          edges: graph.edges.length
        });
        graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
        itemChanged = true;
      }
    }
    rememberLearningItem(graph, kind, item);
    remembered = new Map(graph.learning.examples.map((example) => [learningExampleKey(example), example]));
    if (itemChanged) updates += 1;
  });
  if (learned) {
    graph.learning.examples = [...remembered.values()].slice(-MAX_FEEDBACK_EXAMPLES);
    if (!updates) appendRevision(graph, `Stored ${learned} reusable learning example${learned === 1 ? "" : "s"}`);
  }
  return { graph, updates, learned, skipped, conflicts: conflictingKeys.size, changed: updates > 0 || learned > 0 };
}

export function buildExtractorFeedback(value) {
  const graph = normalizeGraph(value);
  const nodeLabels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const concepts = graph.nodes
      .filter((node) => node.status === "accepted" || node.status === "rejected")
      .map((node) => ({
        kind: "concept",
        id: node.id,
        label: node.label,
        aliases: node.aliases || [],
        status: node.status
      }));
  const relations = graph.edges
      .filter((edge) => edge.status === "accepted" || edge.status === "rejected")
      .map((edge) => ({
        kind: "relation",
        id: edge.id,
        source: edge.source,
        sourceLabel: nodeLabels.get(edge.source) || edge.source,
        target: edge.target,
        targetLabel: nodeLabels.get(edge.target) || edge.target,
        label: edge.label,
        status: edge.status
      }));
  const feedback = [];
  const seen = new Set();
  const add = (example) => {
    const key = learningExampleKey(example);
    if (seen.has(key)) {
      const index = feedback.findIndex((candidate) => learningExampleKey(candidate) === key);
      if (index >= 0) feedback[index] = example;
      return;
    }
    if (feedback.length >= MAX_FEEDBACK_EXAMPLES) return;
    seen.add(key);
    feedback.push(example);
  };
  graph.learning.examples.forEach(add);
  for (let index = 0; feedback.length < MAX_FEEDBACK_EXAMPLES && (index < concepts.length || index < relations.length); index += 1) {
    if (concepts[index]) add(concepts[index]);
    if (relations[index]) add(relations[index]);
  }
  return feedback;
}

export function clearLearningMemory(value) {
  const graph = normalizeGraph(value);
  const removed = graph.learning.examples.length;
  if (!removed) return { graph, changed: false, removed: 0 };
  if (!canAdvanceGraphVersion(graph)) return { graph, changed: false, removed: 0, limited: "version" };
  graph.learning.examples = [];
  appendRevision(graph, `Forgot ${removed} reusable learning example${removed === 1 ? "" : "s"}`);
  return { graph, changed: true, removed };
}

export function removeSource(value, sourceId, { recordRevision = true } = {}) {
  const graph = normalizeGraph(value);
  const source = graph.documents.find((document) => document.id === sourceId);
  if (!source) return { graph, removed: false, removedNodes: 0, removedEdges: 0 };
  if (recordRevision && !canAdvanceGraphVersion(graph)) {
    return { graph, removed: false, removedNodes: 0, removedEdges: 0, limited: "version" };
  }
  graph.documents = graph.documents.filter((document) => document.id !== sourceId);
  const previousNodeIds = new Set(graph.nodes.map((node) => node.id));
  const previousNodeCount = graph.nodes.length;
  graph.nodes = graph.nodes.map((node) => {
    const sources = node.sources.filter((id) => id !== sourceId);
    const evidence = node.evidence.map((item) => ({
      text: item.text,
      sources: item.sources.filter((id) => id !== sourceId)
    })).filter((item) => item.sources.length > 0);
    if (!sources.length && !evidence.length && node.status !== "accepted") return null;
    return { ...node, sources, evidence, updatedAt: new Date().toISOString() };
  }).filter(Boolean);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const removedNodeIds = new Set([...previousNodeIds].filter((id) => !nodeIds.has(id)));
  const previousEdgeIds = new Set(graph.edges.map((edge) => edge.id));
  const previousEdgeCount = graph.edges.length;
  graph.edges = graph.edges.map((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return null;
    const sources = edge.sources.filter((id) => id !== sourceId);
    const evidence = edge.evidence.map((item) => ({
      text: item.text,
      sources: item.sources.filter((id) => id !== sourceId)
    })).filter((item) => item.sources.length > 0);
    if (!sources.length && !evidence.length && edge.status !== "accepted") return null;
    return { ...edge, sources, evidence };
  }).filter(Boolean);
  const retainedEdgeIds = new Set(graph.edges.map((edge) => edge.id));
  const removedEdgeIds = new Set([...previousEdgeIds].filter((id) => !retainedEdgeIds.has(id)));
  graph.learning.examples = graph.learning.examples.filter((example) => {
    if (example.kind === "concept") return !removedNodeIds.has(example.id);
    return !removedEdgeIds.has(example.id)
      && !removedNodeIds.has(example.source)
      && !removedNodeIds.has(example.target);
  });
  if (recordRevision) {
    advanceGraphVersion(graph);
    graph.updatedAt = new Date().toISOString();
    graph.revisions.unshift({
      id: `rev-${graph.version}`,
      version: graph.version,
      timestamp: graph.updatedAt,
      reason: `Removed source ${source.title}`,
      nodes: graph.nodes.length,
      edges: graph.edges.length
    });
    graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  }
  return {
    graph,
    removed: true,
    removedNodes: previousNodeCount - graph.nodes.length,
    removedEdges: previousEdgeCount - graph.edges.length
  };
}

export function inspectGraph(value) {
  const graph = normalizeGraph(value);
  const documentIds = new Set(graph.documents.map((document) => document.id));
  const ambiguousSourceIds = new Set(graph.integrity.ambiguousSourceIds);
  const ambiguousEdgeIds = new Set(graph.integrity.ambiguousEdgeIds);
  const nodeLabelOwners = new Map();
  const ambiguousNodeLabels = new Set();
  graph.nodes.forEach((node) => {
    const key = slugify(node.label);
    if (!key) return;
    const previous = nodeLabelOwners.get(key);
    if (previous && previous !== node.id) ambiguousNodeLabels.add(key);
    else nodeLabelOwners.set(key, node.id);
  });
  const sourceQuality = Object.fromEntries([...SOURCE_QUALITIES].map((quality) => [quality, graph.documents.filter((document) => document.quality === quality).length]));
  const reviewedSources = graph.documents.filter((document) => document.lastReviewedAt).length;
  const hasValidSource = (item) => item.sources.some((sourceId) => documentIds.has(sourceId) && !ambiguousSourceIds.has(sourceId));
  const evidenceHasValidSource = (item) => item.evidence.some((evidence) => evidence.sources.some((sourceId) => documentIds.has(sourceId) && !ambiguousSourceIds.has(sourceId)));
  const activeNodes = graph.nodes.filter((node) => node.status !== "rejected");
  const activeEdges = graph.edges.filter((edge) => edge.status !== "rejected");
  const reviewedNodes = graph.nodes.filter((node) => node.status !== "inferred" || node.feedback !== 0).length;
  const reviewedEdges = graph.edges.filter((edge) => edge.status !== "inferred" || edge.feedback !== 0).length;
  const reviewedItems = [...graph.nodes, ...graph.edges].filter((item) => item.status !== "inferred" || item.feedback !== 0);
  const acceptedItems = reviewedItems.filter((item) => item.status === "accepted").length;
  const rejectedItems = reviewedItems.filter((item) => item.status === "rejected").length;
  const evidenceRecords = [...graph.nodes.flatMap((node) => node.evidence), ...graph.edges.flatMap((edge) => edge.evidence)];
  const supportedNodes = activeNodes.filter((node) => hasValidSource(node) || evidenceHasValidSource(node));
  const supportedEdges = activeEdges.filter((edge) => hasValidSource(edge) || evidenceHasValidSource(edge));
  const orphanedSourceReferences = [
    ...graph.nodes.flatMap((node) => node.sources),
    ...graph.edges.flatMap((edge) => edge.sources),
    ...evidenceRecords.flatMap((evidence) => evidence.sources)
  ].filter((sourceId) => !documentIds.has(sourceId)).length;
  const ambiguousSourceReferences = [
    ...graph.nodes.flatMap((node) => node.sources),
    ...graph.edges.flatMap((edge) => edge.sources),
    ...evidenceRecords.flatMap((evidence) => evidence.sources)
  ].filter((sourceId) => ambiguousSourceIds.has(sourceId)).length;
  const reviewCandidates = buildReviewQueue(graph, 15000);
  return {
    documents: graph.documents.length,
    nodes: graph.nodes.length,
    activeNodes: activeNodes.length,
    rejectedNodes: graph.nodes.length - activeNodes.length,
    edges: graph.edges.length,
    activeEdges: activeEdges.length,
    reviewedItems: reviewedNodes + reviewedEdges,
    reviewedNodes,
    reviewedEdges,
    reviewCandidates: reviewCandidates.length,
    staleReviewCandidates: reviewCandidates.filter((candidate) => candidate.stale).length,
    learningExamples: graph.learning.examples.length,
    acceptedItems,
    rejectedItems,
    ambiguousLabels: ambiguousNodeLabels.size,
    rejectedEdges: graph.edges.length - activeEdges.length,
    evidenceRecords: evidenceRecords.length,
    supportedNodes: supportedNodes.length,
    unsupportedNodes: activeNodes.length - supportedNodes.length,
    supportedEdges: supportedEdges.length,
    unsupportedEdges: activeEdges.length - supportedEdges.length,
    sourceQuality,
    reviewedSources,
    sourceReviewCoverage: graph.documents.length ? Math.round(reviewedSources / graph.documents.length * 100) : 100,
    orphanedSourceReferences,
    ambiguousSourceIds: ambiguousSourceIds.size,
    ambiguousEdgeIds: ambiguousEdgeIds.size,
    ambiguousSourceReferences,
    redacted: graph.redacted === true,
    provenanceCoverage: evidenceRecords.length ? Math.round(evidenceRecords.filter((item) => item.sources.some((sourceId) => documentIds.has(sourceId) && !ambiguousSourceIds.has(sourceId))).length / evidenceRecords.length * 100) : 100
  };
}

function buildReviewQueue(graph, limit = 20) {
  const documentIds = new Set(graph.documents.map((document) => document.id));
  const ambiguousSourceIds = new Set(graph.integrity.ambiguousSourceIds);
  const hasValidSource = (item) => item.sources.some((sourceId) => documentIds.has(sourceId) && !ambiguousSourceIds.has(sourceId))
    || item.evidence.some((evidence) => evidence.sources.some((sourceId) => documentIds.has(sourceId) && !ambiguousSourceIds.has(sourceId)));
  const reviewAgeDays = (item) => {
    if (!item.lastReviewedAt) return null;
    const timestamp = Date.parse(item.lastReviewedAt);
    if (Number.isNaN(timestamp)) return null;
    return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  };
  const isStaleReview = (item) => item.status !== "inferred"
    && (reviewAgeDays(item) === null || reviewAgeDays(item) >= REVIEW_STALE_DAYS);
  const staleReason = (item) => {
    const age = reviewAgeDays(item);
    return age === null ? "review timestamp missing" : `review stale by ${age} day${age === 1 ? "" : "s"}`;
  };
  const isStaleSourceReview = (document) => reviewAgeDays(document) === null || reviewAgeDays(document) >= REVIEW_STALE_DAYS;
  const describePriority = ({ confidence, evidence, supported }) => {
    const reasons = [];
    if (confidence < .6) reasons.push("low confidence");
    if (!evidence) reasons.push("no evidence");
    if (!supported) reasons.push("unresolved provenance");
    return reasons.length ? reasons.join(" · ") : "routine review";
  };
  const candidates = [
    ...graph.nodes.filter((node) => node.status === "inferred").map((node) => ({
      kind: "node",
      id: node.id,
      label: node.label,
      confidence: node.confidence,
      evidence: node.evidence.length,
      supported: hasValidSource(node)
    })),
    ...graph.edges.filter((edge) => edge.status === "inferred").map((edge) => ({
      kind: "edge",
      id: edge.id,
      label: edge.label,
      confidence: edge.confidence,
      evidence: edge.evidence.length,
      supported: hasValidSource(edge)
    })),
    ...graph.nodes.filter(isStaleReview).map((node) => ({
      kind: "node",
      id: node.id,
      label: node.label,
      confidence: node.confidence,
      evidence: node.evidence.length,
      supported: hasValidSource(node),
      stale: true,
      staleReason: staleReason(node)
    })),
    ...graph.edges.filter(isStaleReview).map((edge) => ({
      kind: "edge",
      id: edge.id,
      label: edge.label,
      confidence: edge.confidence,
      evidence: edge.evidence.length,
      supported: hasValidSource(edge),
      stale: true,
      staleReason: staleReason(edge)
    })),
    ...graph.documents
      .filter((document) => document.quality === "unknown" || isStaleSourceReview(document))
      .map((document) => ({
        kind: "source",
        id: document.id,
        label: document.title,
        confidence: document.quality === "unknown" ? .4 : .7,
        evidence: document.text ? 1 : 0,
        supported: true,
        sourceQuality: document.quality,
        sourceReviewed: Boolean(document.lastReviewedAt),
        stale: isStaleSourceReview(document),
        staleReason: staleReason(document)
      }))
  ];
  return candidates
    .map((candidate) => ({
      ...candidate,
      priority: Number((candidate.kind === "source"
        ? (candidate.sourceQuality === "unknown" ? 50 : 0) + (candidate.sourceReviewed ? 0 : 35) + (candidate.sourceReviewed && candidate.stale ? 20 : 0)
        : (1 - candidate.confidence) * 100
          + (candidate.evidence ? 0 : 25)
          + (candidate.supported ? 0 : 35)
          + (candidate.stale ? 20 : 0)).toFixed(2)),
      reason: candidate.kind === "source"
        ? [
          candidate.sourceQuality === "unknown" ? "source quality unknown" : "",
          candidate.sourceReviewed ? "" : "source not reviewed",
          candidate.sourceReviewed && candidate.stale ? candidate.staleReason : ""
        ].filter(Boolean).join(" · ")
        : candidate.stale
          ? candidate.staleReason
          : describePriority(candidate)
    }))
    .sort((left, right) => right.priority - left.priority || left.confidence - right.confidence || left.evidence - right.evidence || left.label.localeCompare(right.label))
    .slice(0, Math.max(0, Math.min(Number(limit) || 0, 15000)));
}

export function reviewQueue(value, limit = 20) {
  return buildReviewQueue(normalizeGraph(value), limit);
}
