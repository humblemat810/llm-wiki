import { BACKUP_FORMAT, GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, MAX_PRODUCER_VERSION_CHARS, fingerprintBackup, matchesGraphFingerprint, normalizeGraph, parseJsonWithUniqueKeys, parseTimestamp } from "../graph-core.js";
import { HISTORY_LIMIT } from "../graph-store.js";
import { MAX_GRAPH_INPUT_BYTES } from "./graph-input.mjs";
import { readBoundedTextFile } from "./bounded-file.mjs";

const [inputPath, ...options] = process.argv.slice(2);
const usage = "Usage: node experiments/verify-graph.mjs <graph-or-backup.json>";
const integrityCounts = (graph) => {
  const truncation = graph?.integrity?.truncated || {};
  const dropped = graph?.integrity?.dropped || {};
  const truncatedItems = [
    truncation.documents,
    truncation.nodes,
    truncation.edges,
    truncation.revisions,
    truncation.learningExamples,
    truncation.documentTitle,
    truncation.documentText,
    truncation.evidenceText,
    truncation.evidenceItems,
    truncation.sourceReferences,
    truncation.aliases
  ].reduce((total, count) => total + (Number.isSafeInteger(count) && count > 0 ? count : 0), 0);
  const droppedItems = [
    dropped.documents,
    dropped.nodes,
    dropped.edges,
    dropped.revisions,
    dropped.learningExamples
  ].reduce((total, count) => total + (Number.isSafeInteger(count) && count > 0 ? count : 0), 0);
  return { truncatedItems, droppedItems };
};

if (process.argv.includes("--help")) {
  console.log(usage);
} else if (!inputPath || options.length) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const value = parseJsonWithUniqueKeys(await readBoundedTextFile(inputPath, MAX_GRAPH_INPUT_BYTES, {
      label: "Graph input",
      tooLargeMessage: `Graph input exceeds ${MAX_GRAPH_INPUT_BYTES / (1024 * 1024)} MB: ${inputPath}`
    }), "Graph input");
    const graph = value?.format === BACKUP_FORMAT ? value.graph : value;
    const history = value?.format === BACKUP_FORMAT ? value.history : [];
    const fingerprint = value?.graphFingerprint;
    if (!graph || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(graph.schema)) {
      throw new Error(`Graph input must declare ${GRAPH_SCHEMA}: ${inputPath}`);
    }
    if (value?.format === BACKUP_FORMAT
      && (typeof value.exportedAt !== "string"
        || Number.isNaN(parseTimestamp(value.exportedAt))
        || !Array.isArray(history)
        || history.length > HISTORY_LIMIT
        || history.some((item) => !item || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(item.schema)))) {
      throw new Error(`Backup input must contain a valid timestamp and at most ${HISTORY_LIMIT} compatible graph snapshots.`);
    }
    if (value?.format === BACKUP_FORMAT
      && value.appVersion !== undefined
      && (typeof value.appVersion !== "string"
        || !value.appVersion.trim()
        || value.appVersion.length > MAX_PRODUCER_VERSION_CHARS)) {
      throw new Error("Backup producer metadata is invalid.");
    }
    if (typeof fingerprint !== "string") {
      throw new Error(`Graph input must include a graphFingerprint: ${inputPath}`);
    }
    if (graph.appVersion !== undefined
      && (typeof graph.appVersion !== "string"
        || !graph.appVersion.trim()
        || graph.appVersion.length > MAX_PRODUCER_VERSION_CHARS)) {
      throw new Error("Graph producer metadata is invalid.");
    }
    if (value?.format === BACKUP_FORMAT && (!Array.isArray(history) || !matchesGraphFingerprint(graph, fingerprint, history))) {
      throw new Error("Backup graphFingerprint does not match its graph and history.");
    }
    if (value?.format !== BACKUP_FORMAT && !matchesGraphFingerprint(graph, fingerprint)) {
      throw new Error("Graph fingerprint does not match its normalized contents.");
    }
    const normalized = normalizeGraph(graph);
    const currentIntegrity = integrityCounts(normalized);
    const historyIntegrity = history
      .map((snapshot) => integrityCounts(normalizeGraph(snapshot)))
      .reduce((total, counts) => ({
        truncatedItems: total.truncatedItems + counts.truncatedItems,
        droppedItems: total.droppedItems + counts.droppedItems
      }), { truncatedItems: 0, droppedItems: 0 });
    const integrity = {
      truncatedItems: currentIntegrity.truncatedItems + historyIntegrity.truncatedItems,
      droppedItems: currentIntegrity.droppedItems + historyIntegrity.droppedItems
    };
    console.log(JSON.stringify({
      verified: true,
      complete: integrity.truncatedItems === 0 && integrity.droppedItems === 0,
      format: value?.format === BACKUP_FORMAT ? BACKUP_FORMAT : GRAPH_SCHEMA,
      graphSchema: normalized.schema,
      graphVersion: normalized.version,
      graphFingerprint: fingerprint,
      appVersion: graph.appVersion || value?.appVersion || "unknown",
      documents: normalized.documents.length,
      concepts: normalized.nodes.length,
      relations: normalized.edges.length,
      history: Array.isArray(history) ? history.length : 0,
      integrity,
      recomputedFingerprint: fingerprintBackup(graph, history)
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Graph verification failed.");
    process.exitCode = 1;
  }
}
