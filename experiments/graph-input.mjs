import { BACKUP_FORMAT, GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, MAX_PRODUCER_VERSION_CHARS, matchesGraphFingerprint, normalizeGraph, parseJsonWithUniqueKeys, parseTimestamp } from "../graph-core.js";
import { HISTORY_LIMIT } from "../graph-store.js";
import { readBoundedTextFile } from "./bounded-file.mjs";
import { pathToFileURL } from "node:url";

export const MAX_GRAPH_INPUT_BYTES = 10 * 1024 * 1024;

export async function readGraphInput(path, { label = "Graph input" } = {}) {
  const value = parseJsonWithUniqueKeys(await readBoundedTextFile(path, MAX_GRAPH_INPUT_BYTES, {
    label,
    tooLargeMessage: `${label} exceeds ${MAX_GRAPH_INPUT_BYTES / (1024 * 1024)} MB: ${path}`
  }), label);
  if (value?.format === BACKUP_FORMAT) {
    if (!value.graph || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(value.graph.schema)) {
      throw new Error(`Backup input must contain ${GRAPH_SCHEMA}: ${path}`);
    }
    if (typeof value.exportedAt !== "string" || Number.isNaN(parseTimestamp(value.exportedAt))) {
      throw new Error(`Backup input exportedAt must be a valid timestamp: ${path}`);
    }
    if (value.appVersion !== undefined
      && (typeof value.appVersion !== "string"
        || !value.appVersion.trim()
        || value.appVersion.length > MAX_PRODUCER_VERSION_CHARS)) {
      throw new Error(`Backup input producer metadata is invalid: ${path}`);
    }
    if (!Array.isArray(value.history) || value.history.length > HISTORY_LIMIT
      || value.history.some((item) => !item || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(item.schema))) {
      throw new Error(`Backup input history must contain at most ${HISTORY_LIMIT} compatible graph snapshots: ${path}`);
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

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url && process.argv.includes("--help")) {
  console.log("Usage: node experiments/graph-input.mjs --help");
  console.log("Library boundary: import readGraphInput(path) from this module to read a bounded graph or backup.");
}
