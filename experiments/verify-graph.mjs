import { BACKUP_FORMAT, GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, fingerprintBackup, matchesGraphFingerprint, normalizeGraph, parseJsonWithUniqueKeys, validateBackupEnvelope } from "../graph-core.js";
import { MAX_GRAPH_INPUT_BYTES, validateProducerVersion } from "./graph-input.mjs";
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
    if (value?.format === BACKUP_FORMAT) validateBackupEnvelope(value, { label: "Backup input" });
    if (!graph || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(graph.schema)) {
      throw new Error(`Graph input must declare ${GRAPH_SCHEMA}: ${inputPath}`);
    }
    if (value?.format === BACKUP_FORMAT) validateProducerVersion(value.appVersion, "Backup");
    validateProducerVersion(graph.appVersion, "Graph");
    history.forEach((snapshot) => validateProducerVersion(snapshot.appVersion, "History graph"));
    if (typeof fingerprint !== "string") {
      throw new Error(`Graph input must include a graphFingerprint: ${inputPath}`);
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
