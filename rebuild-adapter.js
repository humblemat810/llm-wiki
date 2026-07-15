import { GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, MAX_DOCUMENT_TITLE_CHARS, MAX_GRAPH_DOCUMENT_CHARS, MAX_GRAPH_DOCUMENTS, MAX_GRAPH_EDGES, MAX_GRAPH_NODES, MAX_ID_CHARS, replaceSource } from "./graph-core.js";

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

export async function rebuildSources(
  initialGraph,
  {
    extract,
    replace = replaceSource,
    revisionExtractor = "unknown",
    signal,
    onProgress
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
      const extraction = await extract(source, graph, signal);
      if (signal?.aborted) {
        canceled = true;
        break;
      }
      const result = replace(graph, source.id, extraction, { revisionExtractor });
      if (result?.replaced) {
        if (!hasValidGraphCollections(result.graph, sourceIds)) {
          failures.push(`${source.title}: replacement returned an invalid graph`);
          continue;
        }
        graph = result.graph;
        rebuilt += 1;
      } else if (result?.limited) {
        failures.push(`${source.title}: graph ${result.limited} limit reached`);
      } else if (result?.ambiguous) {
        failures.push(`${source.title}: source ID is ambiguous`);
      } else if (result?.duplicate) {
        failures.push(`${source.title}: duplicate source content`);
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
  return { graph, rebuilt, failures, canceled };
}
