export const GRAPH_SCHEMA = "llm-field-notes/graph@1";
export const LEGACY_GRAPH_SCHEMAS = new Set(["llm-field-notes/graph@0"]);
export const MAX_DOCUMENT_CHARS = 300000;
export const MAX_GRAPH_DOCUMENTS = 1000;
export const MAX_GRAPH_NODES = 5000;
export const MAX_GRAPH_EDGES = 10000;
export const MAX_ACTIVE_FEEDBACK_CONCEPTS = 100;

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
  revisions: []
});

export const makeId = (prefix) => {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

export const asArray = (value) => Array.isArray(value) ? value : [];
export const slugify = (value) => value.toLowerCase().replace(/[`'"“”()[\]{}]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const edgeKey = (source, target, label) => `${source}|${target}|${slugify(label)}`;
const asText = (value, fallback = "") => typeof value === "string" ? value : fallback;
const asLine = (value, fallback = "") => asText(value, fallback).replace(/\s+/g, " ").trim();
const asConfidence = (value, fallback = .5) => Number.isFinite(Number(value)) ? Math.max(.01, Math.min(.99, Number(value))) : fallback;

function fingerprintText(text) {
  const canonical = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim();
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16)}-${canonical.length}`;
}

function normalizeEvidence(value, fallbackSources = []) {
  return asArray(value).map((item) => {
    if (typeof item === "string") return { text: item, sources: [...fallbackSources] };
    if (!item || typeof item !== "object" || !asText(item.text).trim()) return null;
    return {
      text: asText(item.text),
      sources: [...new Set(asArray(item.sources).filter((source) => typeof source === "string"))]
    };
  }).filter(Boolean).slice(0, 8);
}

function mergeEvidence(current, incoming) {
  const merged = new Map();
  [...normalizeEvidence(current), ...normalizeEvidence(incoming)].forEach((item) => {
    const key = item.text.trim();
    const existing = merged.get(key);
    if (existing) existing.sources = [...new Set([...existing.sources, ...item.sources])];
    else merged.set(key, { text: item.text, sources: [...item.sources] });
  });
  return [...merged.values()].slice(0, 8);
}

export function normalizeExtraction(value, fallbackTitle = "Untitled document", fallbackText = "") {
  const input = value && typeof value === "object" ? value : {};
  const inputSource = input.source && typeof input.source === "object" ? input.source : {};
  const sourceText = asText(inputSource.text, fallbackText).slice(0, MAX_DOCUMENT_CHARS);
  const sourceId = asText(inputSource.id, makeId("doc"));
  const source = {
    id: sourceId,
    title: asLine(inputSource.title, fallbackTitle).slice(0, 200),
    text: sourceText,
    fingerprint: asText(inputSource.fingerprint, fingerprintText(sourceText)),
    addedAt: asText(inputSource.addedAt, new Date().toISOString())
  };
  const idMap = new Map();
  const normalizedNodes = asArray(input.nodes).slice(0, MAX_GRAPH_NODES).map((node) => {
    const label = asLine(node?.label, asLine(node?.name, "Unnamed concept")).slice(0, 120);
    const rawId = asText(node?.id, slugify(label) || makeId("concept"));
    const id = slugify(rawId) || rawId;
    idMap.set(rawId, id);
    idMap.set(slugify(label), id);
    const sources = [...new Set([sourceId, ...asArray(node?.sources).filter((item) => typeof item === "string")])];
    return {
      id,
      label: label || id,
      aliases: asArray(node?.aliases).filter((item) => typeof item === "string").map((item) => asLine(item)).filter(Boolean).slice(0, 20),
      type: asLine(node?.type, "concept").slice(0, 30),
      confidence: asConfidence(node?.confidence, .55),
      mentions: Number.isInteger(node?.mentions) && node.mentions > 0 ? node.mentions : 1,
      feedback: Number.isInteger(node?.feedback) ? node.feedback : 0,
      status: ["inferred", "accepted", "rejected"].includes(node?.status) ? node.status : "inferred",
      sources,
      evidence: normalizeEvidence(node?.evidence, sources),
      createdAt: asText(node?.createdAt, new Date().toISOString()),
      updatedAt: asText(node?.updatedAt, new Date().toISOString())
    };
  });
  const nodesById = new Map();
  normalizedNodes.forEach((node) => {
    const existing = nodesById.get(node.id);
    if (!existing) {
      nodesById.set(node.id, node);
      return;
    }
    existing.aliases = [...new Set([...existing.aliases, ...node.aliases])].slice(0, 20);
    existing.sources = [...new Set([...existing.sources, ...node.sources])];
    existing.evidence = mergeEvidence(existing.evidence, node.evidence);
    existing.mentions += node.mentions;
    existing.feedback += node.feedback;
    existing.confidence = Math.max(existing.confidence, node.confidence);
    if (existing.status !== "accepted" && node.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && node.status === "rejected") existing.status = "rejected";
    existing.updatedAt = node.updatedAt;
  });
  const nodes = [...nodesById.values()];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const normalizedEdges = asArray(input.edges).slice(0, MAX_GRAPH_EDGES).map((edge) => {
    const rawSource = asText(edge?.source);
    const rawTarget = asText(edge?.target);
    const source = idMap.get(rawSource) || idMap.get(slugify(rawSource)) || rawSource;
    const target = idMap.get(rawTarget) || idMap.get(slugify(rawTarget)) || rawTarget;
    const label = asLine(edge?.label, "related to").slice(0, 80);
    if (!nodeIds.has(source) || !nodeIds.has(target)) return null;
    const sources = [...new Set([sourceId, ...asArray(edge?.sources).filter((item) => typeof item === "string")])];
    return {
      id: asText(edge?.id, `${source}--${target}--${slugify(label)}`),
      source,
      target,
      label,
      confidence: asConfidence(edge?.confidence, .55),
      feedback: Number.isInteger(edge?.feedback) ? edge.feedback : 0,
      evidence: normalizeEvidence(edge?.evidence, sources),
      sources,
      status: ["inferred", "accepted", "rejected"].includes(edge?.status) ? edge.status : "inferred"
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
    existing.sources = [...new Set([...existing.sources, ...edge.sources])];
    existing.evidence = mergeEvidence(existing.evidence, edge.evidence);
    existing.confidence = Math.max(existing.confidence, edge.confidence);
    existing.feedback += edge.feedback;
    if (existing.status !== "accepted" && edge.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && edge.status === "rejected") existing.status = "rejected";
  });
  const edges = [...edgesByKey.values()];
  return { source, nodes, edges };
}

export function normalizeGraph(value) {
  if (!value || typeof value !== "object" || (value.schema !== GRAPH_SCHEMA && !LEGACY_GRAPH_SCHEMAS.has(value.schema))) return defaultGraph();
  const wasMigrated = value.schema !== GRAPH_SCHEMA;
  const graph = defaultGraph();
  graph.version = Number.isInteger(value.version) && value.version >= 0 ? value.version : 0;
  graph.updatedAt = asText(value.updatedAt, null);
  const normalizedDocuments = asArray(value.documents).filter((doc) => doc && typeof doc === "object").slice(0, MAX_GRAPH_DOCUMENTS).map((doc) => {
    const text = asText(doc.text).slice(0, MAX_DOCUMENT_CHARS);
    const fingerprint = asText(doc.fingerprint).trim() || fingerprintText(text);
    return {
      id: asText(doc.id).trim() || `doc-${fingerprintText(fingerprint)}`,
      title: asLine(doc.title, "Untitled document").slice(0, 200),
      text,
      fingerprint,
      addedAt: asText(doc.addedAt, new Date().toISOString())
    };
  });
  const documentsById = new Map();
  normalizedDocuments.forEach((document) => {
    const existing = documentsById.get(document.id);
    if (!existing) {
      documentsById.set(document.id, document);
      return;
    }
    if (existing.title === "Untitled document" && document.title !== "Untitled document") existing.title = document.title;
    if (!existing.text && document.text) existing.text = document.text;
    if (!existing.fingerprint && document.fingerprint) existing.fingerprint = document.fingerprint;
  });
  graph.documents = [...documentsById.values()];
  const normalizedNodes = asArray(value.nodes).filter((node) => node && typeof node === "object" && asText(node.id)).slice(0, MAX_GRAPH_NODES).map((node) => ({
    id: asText(node.id),
    label: asLine(node.label, "Unnamed concept").slice(0, 120),
    aliases: asArray(node.aliases).filter((item) => typeof item === "string").map((item) => asLine(item)).filter(Boolean).slice(0, 20),
    type: asLine(node.type, "concept").slice(0, 30),
    confidence: asConfidence(node.confidence),
    mentions: Number.isInteger(node.mentions) && node.mentions > 0 ? node.mentions : 1,
    feedback: Number.isInteger(node.feedback) ? node.feedback : 0,
    status: ["inferred", "accepted", "rejected"].includes(node.status) ? node.status : "inferred",
    sources: asArray(node.sources).filter((item) => typeof item === "string"),
    evidence: normalizeEvidence(node.evidence, asArray(node.sources).filter((item) => typeof item === "string")),
    createdAt: asText(node.createdAt, new Date().toISOString()),
    updatedAt: asText(node.updatedAt, new Date().toISOString())
  }));
  const nodesById = new Map();
  normalizedNodes.forEach((node) => {
    const existing = nodesById.get(node.id);
    if (!existing) {
      nodesById.set(node.id, node);
      return;
    }
    existing.aliases = [...new Set([...existing.aliases, ...node.aliases])].slice(0, 20);
    existing.sources = [...new Set([...existing.sources, ...node.sources])];
    existing.evidence = mergeEvidence(existing.evidence, node.evidence);
    existing.mentions += node.mentions;
    existing.feedback += node.feedback;
    existing.confidence = Math.max(existing.confidence, node.confidence);
    if (existing.status !== "accepted" && node.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && node.status === "rejected") existing.status = "rejected";
    existing.updatedAt = node.updatedAt;
  });
  graph.nodes = [...nodesById.values()];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const normalizedEdges = asArray(value.edges).filter((edge) => edge && typeof edge === "object" && nodeIds.has(edge.source) && nodeIds.has(edge.target)).slice(0, MAX_GRAPH_EDGES).map((edge) => ({
    id: asText(edge.id, `${edge.source}--${edge.target}--${slugify(asText(edge.label, "related-to"))}`),
    source: edge.source,
    target: edge.target,
    label: asLine(edge.label, "related to").slice(0, 80),
    confidence: asConfidence(edge.confidence),
    feedback: Number.isInteger(edge.feedback) ? edge.feedback : 0,
    evidence: normalizeEvidence(edge.evidence, asArray(edge.sources).filter((item) => typeof item === "string")),
    sources: asArray(edge.sources).filter((item) => typeof item === "string"),
    status: ["inferred", "accepted", "rejected"].includes(edge.status) ? edge.status : "inferred"
  }));
  const edgesByKey = new Map();
  normalizedEdges.forEach((edge) => {
    const key = `${edge.source}|${edge.target}|${slugify(edge.label)}`;
    const existing = edgesByKey.get(key);
    if (!existing) {
      edgesByKey.set(key, edge);
      return;
    }
    existing.sources = [...new Set([...existing.sources, ...edge.sources])];
    existing.evidence = mergeEvidence(existing.evidence, edge.evidence);
    existing.feedback += edge.feedback;
    existing.confidence = Math.max(existing.confidence, edge.confidence);
    if (existing.status !== "accepted" && edge.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && edge.status === "rejected") existing.status = "rejected";
  });
  graph.edges = [...edgesByKey.values()];
  graph.revisions = asArray(value.revisions).filter((revision) => revision && typeof revision === "object").slice(0, 20).map((revision) => ({
    id: asText(revision.id, makeId("rev")),
    version: Number.isInteger(revision.version) ? revision.version : 0,
    timestamp: asText(revision.timestamp, new Date().toISOString()),
    reason: asLine(revision.reason, "Updated graph").slice(0, 200),
    nodes: Number.isInteger(revision.nodes) ? revision.nodes : graph.nodes.length,
    edges: Number.isInteger(revision.edges) ? revision.edges : graph.edges.length
  }));
  if (wasMigrated) {
    graph.revisions.unshift({
      id: makeId("rev"),
      version: graph.version,
      timestamp: new Date().toISOString(),
      reason: `Migrated ${value.schema} to ${GRAPH_SCHEMA}`,
      nodes: graph.nodes.length,
      edges: graph.edges.length
    });
    graph.revisions = graph.revisions.slice(0, 20);
  }
  return graph;
}

const cleanPhrase = (value) => value.replace(/^#+\s*/, "").replace(/[`"'“”()[\]{}]/g, "").replace(/\s+/g, " ").trim().replace(/^(the|a|an)\s+/i, "").replace(/[.,;:!?]+$/, "");
const wordsIn = (value) => (value.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter((word) => !stopWords.has(word));

function feedbackHints(value) {
  const concepts = new Map();
  const relations = [];
  asArray(value).slice(0, 500).forEach((example) => {
    if (!example || typeof example !== "object") return;
    const status = ["accepted", "rejected"].includes(example.status) ? example.status : null;
    if (!status) return;
    if (example.kind === "concept") {
      const label = cleanPhrase(asLine(example.label));
      const id = slugify(asText(example.id, label));
      if (!id || !label) return;
      const keys = [...new Set([id, slugify(label), ...asArray(example.aliases).map((alias) => slugify(asLine(alias))).filter(Boolean)])];
      keys.forEach((key) => concepts.set(key, {
        id,
        label,
        aliases: asArray(example.aliases).map((alias) => asLine(alias)).filter(Boolean).slice(0, 20),
        status
      }));
      return;
    }
    if (example.kind === "relation") {
      const label = cleanPhrase(asLine(example.label));
      const source = slugify(asText(example.source, example.sourceLabel));
      const target = slugify(asText(example.target, example.targetLabel));
      if (label && source && target) relations.push({ source, target, label, status });
    }
  });
  return { concepts, relations };
}

export function extractGraph(title, text, { feedback = [] } = {}) {
  const boundedText = asText(text).slice(0, MAX_DOCUMENT_CHARS);
  const sourceId = makeId("doc");
  const sentences = boundedText.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter((item) => item.length > 25);
  const hints = feedbackHints(feedback);
  const rejectedConcepts = new Set([...hints.concepts.values()].filter((hint) => hint.status === "rejected").map((hint) => hint.id));
  const candidates = new Map();
  const addCandidate = (raw, kind, sentence = "") => {
    const label = cleanPhrase(raw);
    const rawId = slugify(label);
    if (!rawId || label.length < 3 || label.length > 64 || stopWords.has(rawId)) return;
    const hint = hints.concepts.get(rawId);
    const id = hint?.id || rawId;
    if (rejectedConcepts.has(id) || hint?.status === "rejected") return;
    const existing = candidates.get(id) || { id, label: hint?.label || label, kind, mentions: 0, evidence: [] };
    existing.mentions += 1;
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
        hint.source === left.id && hint.target === right.id
      ));
      const rejectedRelation = relationHints.find((hint) => hint.status === "rejected");
      if (rejectedRelation) continue;
      const acceptedRelation = relationHints.find((hint) => hint.status === "accepted");
      const label = acceptedRelation?.label || (relationMatch ? relationMatch[1].toLowerCase() : "co-mentioned with");
      edges.push({
        source: left.id,
        target: right.id,
        label,
        id: `${left.id}--${right.id}--${slugify(label)}`,
        confidence: Math.min(.96, .52 + Math.min(.35, (left.mentions + right.mentions) * .04) + (acceptedRelation ? .14 : 0)),
        feedback: 0,
        evidence: [{ text: sentence, sources: [sourceId] }],
        sources: [sourceId],
        status: "inferred"
      });
    }
    const presentIds = new Set(present.map((item) => item.id));
    hints.relations
      .filter((hint) => hint.status === "accepted" && presentIds.has(hint.source) && presentIds.has(hint.target) && hint.source !== hint.target)
      .forEach((hint) => {
        const key = edgeKey(hint.source, hint.target, hint.label);
        if (edges.some((edge) => edge.source === hint.source && edge.target === hint.target && edgeKey(edge.source, edge.target, edge.label) === key)) return;
        edges.push({
          source: hint.source,
          target: hint.target,
          label: hint.label,
          id: `${hint.source}--${hint.target}--${slugify(hint.label)}`,
          confidence: .82,
          feedback: 0,
          evidence: [{ text: sentence, sources: [sourceId] }],
          sources: [sourceId],
          status: "inferred"
        });
      });
  });
  return normalizeExtraction({
    source: { id: sourceId, title: title || "Untitled document", text: boundedText },
    nodes,
    edges
  });
}

export function mergeExtraction(graph, extraction) {
  graph = normalizeGraph(graph);
  extraction = normalizeExtraction(extraction);
  const duplicate = graph.documents.some((document) => (
    document.fingerprint && document.fingerprint === extraction.source.fingerprint
  ) || (
    document.text && extraction.source.text && fingerprintText(document.text) === fingerprintText(extraction.source.text)
  ));
  if (duplicate) return { graph, duplicate: true };
  const now = new Date().toISOString();
  const knownNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incomingToKnown = new Map();
  extraction.nodes.forEach((incoming) => {
    const existing = knownNodes.get(incoming.id) || [...knownNodes.values()].find((node) => [node.label, ...node.aliases].some((alias) => slugify(alias) === incoming.id));
    incomingToKnown.set(incoming.id, existing?.id || incoming.id);
    if (existing) {
      existing.mentions += incoming.mentions;
      existing.confidence = existing.status === "rejected"
        ? Math.max(.05, existing.confidence + Math.min(0, existing.feedback) * .02)
        : Math.min(.99, (existing.confidence + incoming.confidence) / 2 + .03 + Math.max(0, existing.feedback) * .015);
      existing.aliases = [...new Set([...(existing.aliases || []), ...(incoming.aliases || [])])].slice(0, 20);
      existing.sources = [...new Set([...existing.sources, ...incoming.sources])];
      existing.evidence = mergeEvidence(existing.evidence, incoming.evidence);
      existing.updatedAt = now;
    } else {
      knownNodes.set(incoming.id, incoming);
    }
  });
  const knownEdges = new Map(graph.edges.map((edge) => [edgeKey(edge.source, edge.target, edge.label), edge]));
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
      existing.sources = [...new Set([...existing.sources, ...incoming.sources])];
    } else {
      knownEdges.set(key, { ...incoming, source, target, id: `${source}--${target}--${slugify(incoming.label)}` });
    }
  });
  graph.documents.push(extraction.source);
  graph.nodes = [...knownNodes.values()];
  graph.edges = [...knownEdges.values()].filter((edge) => knownNodes.has(edge.source) && knownNodes.has(edge.target));
  graph.version += 1;
  graph.updatedAt = now;
  graph.revisions.unshift({
    id: `rev-${graph.version}`,
    version: graph.version,
    timestamp: now,
    reason: `Ingested ${extraction.source.title}`,
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, 20);
  return { graph, duplicate: false };
}

export function applyFeedback(value, kind, id, action) {
  const graph = normalizeGraph(value);
  const collection = kind === "node" ? graph.nodes : kind === "edge" ? graph.edges : null;
  if (!collection || !["restore", "up", "down"].includes(action)) {
    return { graph, changed: false };
  }
  const item = collection.find((candidate) => candidate.id === id);
  if (!item) return { graph, changed: false };
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
  graph.version += 1;
  graph.updatedAt = new Date().toISOString();
  const subject = kind === "node" ? item.label : `relation ${item.label}`;
  const verb = action === "restore" ? "Restored" : action === "up" ? "Confirmed" : "Dismissed";
  graph.revisions.unshift({
    id: `rev-${graph.version}`,
    version: graph.version,
    timestamp: graph.updatedAt,
    reason: `${verb} ${subject}`,
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, 20);
  return { graph, changed: true };
}

export function removeSource(value, sourceId) {
  const graph = normalizeGraph(value);
  const source = graph.documents.find((document) => document.id === sourceId);
  if (!source) return { graph, removed: false, removedNodes: 0, removedEdges: 0 };
  graph.documents = graph.documents.filter((document) => document.id !== sourceId);
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
  graph.version += 1;
  graph.updatedAt = new Date().toISOString();
  graph.revisions.unshift({
    id: `rev-${graph.version}`,
    version: graph.version,
    timestamp: graph.updatedAt,
    reason: `Removed source ${source.title}`,
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, 20);
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
  const hasValidSource = (item) => item.sources.some((sourceId) => documentIds.has(sourceId));
  const evidenceHasValidSource = (item) => item.evidence.some((evidence) => evidence.sources.some((sourceId) => documentIds.has(sourceId)));
  const activeNodes = graph.nodes.filter((node) => node.status !== "rejected");
  const activeEdges = graph.edges.filter((edge) => edge.status !== "rejected");
  const evidenceRecords = [...graph.nodes.flatMap((node) => node.evidence), ...graph.edges.flatMap((edge) => edge.evidence)];
  const supportedNodes = activeNodes.filter((node) => hasValidSource(node) || evidenceHasValidSource(node));
  const supportedEdges = activeEdges.filter((edge) => hasValidSource(edge) || evidenceHasValidSource(edge));
  const orphanedSourceReferences = [
    ...graph.nodes.flatMap((node) => node.sources),
    ...graph.edges.flatMap((edge) => edge.sources),
    ...evidenceRecords.flatMap((evidence) => evidence.sources)
  ].filter((sourceId) => !documentIds.has(sourceId)).length;
  return {
    documents: graph.documents.length,
    nodes: graph.nodes.length,
    activeNodes: activeNodes.length,
    rejectedNodes: graph.nodes.length - activeNodes.length,
    edges: graph.edges.length,
    activeEdges: activeEdges.length,
    rejectedEdges: graph.edges.length - activeEdges.length,
    evidenceRecords: evidenceRecords.length,
    supportedNodes: supportedNodes.length,
    unsupportedNodes: activeNodes.length - supportedNodes.length,
    supportedEdges: supportedEdges.length,
    unsupportedEdges: activeEdges.length - supportedEdges.length,
    orphanedSourceReferences,
    provenanceCoverage: evidenceRecords.length ? Math.round(evidenceRecords.filter((item) => item.sources.some((sourceId) => documentIds.has(sourceId))).length / evidenceRecords.length * 100) : 100
  };
}

export function reviewQueue(value, limit = 20) {
  const graph = normalizeGraph(value);
  const candidates = [
    ...graph.nodes.filter((node) => node.status === "inferred").map((node) => ({
      kind: "node",
      id: node.id,
      label: node.label,
      confidence: node.confidence,
      evidence: node.evidence.length
    })),
    ...graph.edges.filter((edge) => edge.status === "inferred").map((edge) => ({
      kind: "edge",
      id: edge.id,
      label: edge.label,
      confidence: edge.confidence,
      evidence: edge.evidence.length
    }))
  ];
  return candidates
    .sort((left, right) => left.confidence - right.confidence || left.evidence - right.evidence || left.label.localeCompare(right.label))
    .slice(0, Math.max(0, Math.min(Number(limit) || 0, 15000)));
}
