import { readFile, stat } from "node:fs/promises";
import { BACKUP_FORMAT, GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, matchesGraphFingerprint, normalizeGraph } from "../graph-core.js";

export const MAX_GRAPH_INPUT_BYTES = 10 * 1024 * 1024;

export async function readGraphInput(path, { label = "Graph input" } = {}) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`${label} is not a file: ${path}`);
  if (metadata.size > MAX_GRAPH_INPUT_BYTES) throw new Error(`${label} exceeds ${MAX_GRAPH_INPUT_BYTES / (1024 * 1024)} MB: ${path}`);
  const value = JSON.parse(await readFile(path, "utf8"));
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
