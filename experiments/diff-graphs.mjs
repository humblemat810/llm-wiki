import { readFile, stat } from "node:fs/promises";
import { BACKUP_FORMAT, DIFF_FORMAT, GRAPH_SCHEMA, diffGraphs, matchesGraphFingerprint } from "../graph-core.js";

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const [beforePath, afterPath] = process.argv.slice(2);

async function readGraph(path) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`Graph diff input is not a file: ${path}`);
  if (metadata.size > MAX_INPUT_BYTES) throw new Error(`Graph diff input exceeds the ${MAX_INPUT_BYTES / (1024 * 1024)} MB safety limit: ${path}`);
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value?.format === BACKUP_FORMAT) {
    if (!value.graph || value.graph.schema !== GRAPH_SCHEMA) throw new Error(`Backup input must contain ${GRAPH_SCHEMA}: ${path}`);
    if (value.graphFingerprint !== undefined && !matchesGraphFingerprint(value.graph, value.graphFingerprint, value.history)) {
      throw new Error(`Backup input fingerprint does not match its graph and history: ${path}`);
    }
    return value.graph;
  }
  if (value?.schema !== GRAPH_SCHEMA) throw new Error(`Graph diff input must declare ${GRAPH_SCHEMA}: ${path}`);
  if (value.graphFingerprint !== undefined && !matchesGraphFingerprint(value, value.graphFingerprint)) {
    throw new Error(`Graph input fingerprint does not match its contents: ${path}`);
  }
  return value;
}

if (!beforePath || !afterPath) {
  console.error("Usage: node experiments/diff-graphs.mjs <before-graph-or-backup.json> <after-graph-or-backup.json>");
  process.exitCode = 1;
} else {
  try {
    const before = await readGraph(beforePath);
    const after = await readGraph(afterPath);
    console.log(JSON.stringify({ ...diffGraphs(before, after), exportedAt: new Date().toISOString(), format: DIFF_FORMAT }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Graph diff failed.");
    process.exitCode = 1;
  }
}
