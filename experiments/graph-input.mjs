import { BACKUP_FORMAT, GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, MAX_PRODUCER_VERSION_CHARS, matchesGraphFingerprint, normalizeGraph, parseJsonWithUniqueKeys, validateBackupEnvelope } from "../graph-core.js";
import { readBoundedTextFile } from "./bounded-file.mjs";
import { pathToFileURL } from "node:url";

export const MAX_GRAPH_INPUT_BYTES = 10 * 1024 * 1024;

export function validateProducerVersion(value, label, path = "") {
  if (value !== undefined
    && (typeof value !== "string"
      || !value.trim()
      || value.length > MAX_PRODUCER_VERSION_CHARS)) {
    throw new Error(`${label} producer metadata is invalid${path ? `: ${path}` : "."}`);
  }
}

export async function readGraphInput(path, { label = "Graph input" } = {}) {
  const value = parseJsonWithUniqueKeys(await readBoundedTextFile(path, MAX_GRAPH_INPUT_BYTES, {
    label,
    tooLargeMessage: `${label} exceeds ${MAX_GRAPH_INPUT_BYTES / (1024 * 1024)} MB: ${path}`
  }), label);
  if (value?.format === BACKUP_FORMAT) {
    try {
      validateBackupEnvelope(value, { label: "Backup input" });
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : "Backup input is invalid."}: ${path}`);
    }
    validateProducerVersion(value.graph.appVersion, "Graph input", path);
    value.history.forEach((item) => validateProducerVersion(item.appVersion, "History graph input", path));
    return normalizeGraph(value.graph);
  }
  if (!value || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(value.schema)) {
    throw new Error(`${label} must declare ${GRAPH_SCHEMA}: ${path}`);
  }
  validateProducerVersion(value.appVersion, label, path);
  if (!matchesGraphFingerprint(value, value.graphFingerprint)) {
    throw new Error(`Graph input fingerprint does not match its contents: ${path}`);
  }
  return normalizeGraph(value);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url && process.argv.includes("--help")) {
  console.log("Usage: node experiments/graph-input.mjs --help");
  console.log("Library boundary: import readGraphInput(path) from this module to read a bounded graph or backup.");
}
