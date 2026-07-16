import { GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, MAX_DOCUMENT_TITLE_CHARS, MAX_GRAPH_DOCUMENT_CHARS, MAX_GRAPH_DOCUMENTS, MAX_GRAPH_EDGES, MAX_GRAPH_NODES, MAX_ID_CHARS, normalizeGraph, replaceSource } from "./graph-core.js";

export const MAX_REBUILD_FAILURE_CHARS = 240;

const boundedFailure = (source, error) => {
  const detail = error instanceof Error ? error.message : "could not extract";
  const normalized = String(detail).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return `${source.title}: ${(normalized || "could not extract").slice(0, MAX_REBUILD_FAILURE_CHARS)}`;
};

const isCompatibleGraph = (value) => value
  && typeof value === "object"
  && !Array.isArray(value)
  && (value.schema === GRAPH_SCHEMA || LEGACY_GRAPH_SCHEMAS.has(value.schema));

const hasValidGraphCollections = (value, expectedSourceIds = null) => {
  if (!isCompatibleGraph(value)
    || !Array.isArray(value.documents)
    || !Array.isArray(value.nodes)
    || !Array.isArray(value.edges)
    || value.documents.length > MAX_GRAPH_DOCUMENTS
    || value.nodes.length > MAX_GRAPH_NODES
    || value.edges.length > MAX_GRAPH_EDGES) {
    return false;
  }
  const sourceIds = new Set();
  for (const source of value.documents) {
    if (!source
      || typeof source.id !== "string"
      || !source.id.trim()
      || source.id.length > MAX_ID_CHARS
      || sourceIds.has(source.id)
      || typeof source.title !== "string"
      || !source.title.trim()
      || source.title.length > MAX_DOCUMENT_TITLE_CHARS
      || typeof source.text !== "string"
      || source.text.length > MAX_GRAPH_DOCUMENT_CHARS) {
      return false;
    }
    sourceIds.add(source.id);
  }
  return !expectedSourceIds
    || sourceIds.size === expectedSourceIds.size
    && [...expectedSourceIds].every((sourceId) => sourceIds.has(sourceId));
};

const hasPositiveDiagnostic = (value) => value
  && typeof value === "object"
  && Object.values(value).some((count) => Number.isSafeInteger(count) && count > 0);

const hasIntegrityAmbiguity = (graph) => (
  graph?.integrity?.ambiguousSourceIds?.length
  || graph?.integrity?.ambiguousEdgeIds?.length
  || graph?.integrity?.conflictingNodeIds?.length
  || graph?.integrity?.conflictingEdgeIds?.length
);

const sourceRecordComparable = (source) => {
  const record = {
    id: source.id,
    title: source.title,
    text: source.text,
    fingerprint: source.fingerprint,
    addedAt: source.addedAt,
    uri: source.uri,
    quality: source.quality
  };
  record.lastReviewedAt = source.lastReviewedAt;
  return JSON.stringify(record);
};

const sourceContentComparable = (source) => JSON.stringify({
  id: source.id,
  title: source.title,
  text: source.text,
  fingerprint: source.fingerprint,
  addedAt: source.addedAt,
  uri: source.uri,
  quality: source.quality
});

const replacedSourceContentPreserved = (before, after, replacedSourceId) => {
  const original = before.find((source) => source.id === replacedSourceId);
  const replacement = after.find((source) => source.id === replacedSourceId);
  return Boolean(original && replacement)
    && sourceContentComparable(original) === sourceContentComparable(replacement);
};

const savedSourceRecordsPreserved = (before, after, replacedSourceId) => before
  .filter((source) => source.id !== replacedSourceId)
  .every((source) => {
  const replacement = after.find((candidate) => candidate.id === source.id);
  if (!replacement) return false;
  return sourceRecordComparable(source) === sourceRecordComparable(replacement);
});

const sourceContributionCounts = (graph, sourceId) => ({
  nodes: graph.nodes.filter((node) => Array.isArray(node?.sources) && node.sources.includes(sourceId)).length,
  edges: graph.edges.filter((edge) => Array.isArray(edge?.sources) && edge.sources.includes(sourceId)).length
});

const reviewedDecisions = (graph) => new Map([
  ...(Array.isArray(graph?.nodes) ? graph.nodes : [])
    .filter((node) => node?.status === "accepted" || node?.status === "rejected")
    .map((node) => [`node|${node.id}`, node.status]),
  ...(Array.isArray(graph?.edges) ? graph.edges : [])
    .filter((edge) => edge?.status === "accepted" || edge?.status === "rejected")
    .map((edge) => [`edge|${edge.id}`, edge.status])
]);

const reviewedDecisionsPreserved = (before, after, suppressedRejectedDecisions = new Set()) => {
  const replacementDecisions = reviewedDecisions(after);
  return [...reviewedDecisions(before)].every(([identity, status]) => (
    replacementDecisions.get(identity) === status
    || (status === "rejected" && suppressedRejectedDecisions.has(identity))
  ));
};

const abortableExtract = (extract, source, graph, signal) => {
  if (!signal) return Promise.resolve().then(() => extract(source, graph, signal));
  if (signal.aborted) {
    return Promise.reject(Object.assign(new Error("Rebuild extraction canceled."), { name: "AbortError", code: "CANCELED" }));
  }
  let abortHandler;
  const abortPromise = new Promise((_, reject) => {
    abortHandler = () => reject(Object.assign(new Error("Rebuild extraction canceled."), { name: "AbortError", code: "CANCELED" }));
    signal.addEventListener("abort", abortHandler, { once: true });
    if (signal.aborted) abortHandler();
  });
  const extractionPromise = Promise.resolve().then(() => extract(source, graph, signal));
  return Promise.race([extractionPromise, abortPromise]).finally(() => {
    signal.removeEventListener("abort", abortHandler);
  });
};

export async function rebuildSources(
  initialGraph,
  {
    extract,
    replace = replaceSource,
    revisionExtractor = "unknown",
    signal,
    onProgress,
    suppressedRejectedDecisions = new Set()
  } = {}
) {
  if (!initialGraph || typeof initialGraph !== "object" || !Array.isArray(initialGraph.documents)) {
    throw new TypeError("A normalized graph with source documents is required.");
  }
  if (typeof extract !== "function") throw new TypeError("A source extractor is required.");
  if (typeof replace !== "function") throw new TypeError("A source replacement function is required.");
  if (initialGraph.redacted === true) {
    throw new TypeError("A redacted graph cannot be rebuilt without its original source content.");
  }
  if (hasPositiveDiagnostic(initialGraph.integrity?.truncated)
    || hasPositiveDiagnostic(initialGraph.integrity?.dropped)
    || initialGraph.integrity?.ambiguousSourceIds?.length
    || initialGraph.integrity?.ambiguousEdgeIds?.length) {
    throw new TypeError("An incomplete or ambiguous graph cannot be rebuilt safely.");
  }
  const sources = initialGraph.documents.slice();
  if (sources.length > MAX_GRAPH_DOCUMENTS) {
    throw new RangeError(`Saved source count exceeds the ${MAX_GRAPH_DOCUMENTS} document safety limit.`);
  }
  if (!hasValidGraphCollections(initialGraph)) {
    throw new TypeError(sources.some((source) => (
      !source
      || typeof source.id !== "string"
      || !source.id.trim()
      || source.id.length > MAX_ID_CHARS
      || typeof source.title !== "string"
      || !source.title.trim()
      || source.title.length > MAX_DOCUMENT_TITLE_CHARS
      || typeof source.text !== "string"
      || source.text.length > MAX_GRAPH_DOCUMENT_CHARS
    ))
      ? "Saved source records must contain bounded IDs, titles, and text."
      : "A normalized graph with source documents is required.");
  }
  const sourceIds = new Set(sources.map((source) => source.id));
  let graph = initialGraph;
  let rebuilt = 0;
  let canceled = false;
  const failures = [];
  const rebuildDetails = [];
  for (const [sourceIndex, source] of sources.entries()) {
    if (signal?.aborted) {
      canceled = true;
      break;
    }
    try {
      onProgress?.({ source, sourceIndex, total: sources.length });
    } catch {
      // Progress reporting is an observability enhancement; it must not
      // change extraction or persistence behavior.
    }
    if (signal?.aborted) {
      canceled = true;
      break;
    }
    try {
      const previousContributionCounts = sourceContributionCounts(graph, source.id);
      const extraction = await abortableExtract(extract, source, normalizeGraph(graph), signal);
      if (signal?.aborted) {
        canceled = true;
        break;
      }
      // Replacement implementations are extension points. Give each one a
      // normalized snapshot so an invalid or throwing implementation cannot
      // mutate the committed graph before its result is validated.
      const replacementInput = normalizeGraph(graph);
      const result = replace(replacementInput, source.id, extraction, {
        revisionExtractor,
        preserveSourceCategories: true,
        preserveSourceContent: true,
        preservedLearningDecisionKeys: suppressedRejectedDecisions
      });
      if (result?.replaced) {
        const normalizedReplacement = normalizeGraph(result.graph);
        if (!hasValidGraphCollections(normalizedReplacement, sourceIds)
          || hasPositiveDiagnostic(normalizedReplacement.integrity?.truncated)
          || hasPositiveDiagnostic(normalizedReplacement.integrity?.dropped)) {
          failures.push(`${source.title}: replacement returned an invalid graph`);
          continue;
        }
        if (hasIntegrityAmbiguity(normalizedReplacement)) {
          failures.push(`${source.title}: replacement returned an ambiguous graph`);
          continue;
        }
        if (!savedSourceRecordsPreserved(graph.documents, normalizedReplacement.documents, source.id)) {
          failures.push(`${source.title}: replacement changed saved source records`);
          continue;
        }
        if (!replacedSourceContentPreserved(graph.documents, normalizedReplacement.documents, source.id)) {
          failures.push(`${source.title}: replacement changed saved source content`);
          continue;
        }
        if (!reviewedDecisionsPreserved(graph, normalizedReplacement, suppressedRejectedDecisions)) {
          failures.push(`${source.title}: replacement removed or changed a reviewed decision`);
          continue;
        }
        const replacementContributionCounts = sourceContributionCounts(normalizedReplacement, source.id);
        const degradedCategories = [
          previousContributionCounts.nodes > 0 && replacementContributionCounts.nodes === 0 ? "concepts" : null,
          previousContributionCounts.edges > 0 && replacementContributionCounts.edges === 0 ? "relations" : null
        ].filter(Boolean);
        if (degradedCategories.length) {
          const categories = degradedCategories.length === 2
            ? "source-linked knowledge"
            : degradedCategories[0] === "relations"
              ? "source-linked relations"
              : "source-linked concepts";
          failures.push(`${source.title}: replacement removed all ${categories}`);
          continue;
        }
        graph = normalizedReplacement;
        rebuilt += 1;
        rebuildDetails.push({
          sourceId: source.id,
          title: source.title,
          beforeNodes: previousContributionCounts.nodes,
          afterNodes: replacementContributionCounts.nodes,
          beforeEdges: previousContributionCounts.edges,
          afterEdges: replacementContributionCounts.edges,
          removedNodes: Number.isSafeInteger(result.removedNodes) ? result.removedNodes : 0,
          removedEdges: Number.isSafeInteger(result.removedEdges) ? result.removedEdges : 0
        });
      } else if (result?.limited) {
        failures.push(`${source.title}: graph ${result.limited} limit reached`);
      } else if (result?.ambiguous) {
        failures.push(`${source.title}: source ID is ambiguous`);
      } else if (result?.duplicate) {
        failures.push(`${source.title}: duplicate source content`);
      } else if (result?.empty || result?.degraded?.length) {
        const categories = result.degraded?.length === 2
          ? "source-linked knowledge"
          : result.degraded?.[0] === "relations"
            ? "source-linked relations"
            : "source-linked concepts";
        failures.push(`${source.title}: replacement removed all ${categories}`);
      } else {
        failures.push(`${source.title}: source could not be replaced`);
      }
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "CANCELED") {
        canceled = true;
        break;
      }
      failures.push(boundedFailure(source, error));
    }
  }
  return { graph, rebuilt, rebuildDetails, failures, canceled };
}
