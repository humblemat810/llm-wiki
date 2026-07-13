import { BACKUP_FORMAT, GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, matchesGraphFingerprint, normalizeGraph } from "../graph-core.js";
import { readBoundedTextFile } from "./bounded-file.mjs";

export const MAX_GRAPH_INPUT_BYTES = 10 * 1024 * 1024;

export async function readGraphInput(path, { label = "Graph input" } = {}) {
  const value = JSON.parse(await readBoundedTextFile(path, MAX_GRAPH_INPUT_BYTES, {
    label,
    tooLargeMessage: `${label} exceeds ${MAX_GRAPH_INPUT_BYTES / (1024 * 1024)} MB: ${path}`
  }));
  if (value?.format === BACKUP_FORMAT) {
    if (!value.graph || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(value.graph.schema)) {
      throw new Error(`Backup input must contain ${GRAPH_SCHEMA}: ${path}`);
    }
    if (!matchesGraphFingerprint(value.graph, value.graphFingerprint, value.history)) {
      throw new Error(`Backup input fingerprint does not match its graph and history: ${path}`);
    }
    return normalizeGraph(value.graph);
  }
  if (!value || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(value.schema)) {
    throw new Error(`${label} must declare ${GRAPH_SCHEMA}: ${path}`);
  }
  if (!matchesGraphFingerprint(value, value.graphFingerprint)) {
    throw new Error(`Graph input fingerprint does not match its contents: ${path}`);
  }
  return normalizeGraph(value);
}
