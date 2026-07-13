import { readFile, stat } from "node:fs/promises";
import { BACKUP_FORMAT, GRAPH_SCHEMA, HEALTH_FORMAT, LEGACY_GRAPH_SCHEMAS, fingerprintBackup, inspectGraph, normalizeGraph } from "../graph-core.js";

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const [inputPath, ...argumentsList] = process.argv.slice(2);

function parseThresholds(values) {
  const thresholds = { minProvenance: null, maxOrphaned: null, maxAmbiguous: null, maxReviewCandidates: null, maxStaleReviewCandidates: null };
  for (let index = 0; index < values.length; index += 1) {
    const option = values[index];
    const key = option === "--min-provenance"
      ? "minProvenance"
      : option === "--max-orphaned"
        ? "maxOrphaned"
          : option === "--max-ambiguous"
            ? "maxAmbiguous"
            : option === "--max-review-candidates"
              ? "maxReviewCandidates"
              : option === "--max-stale-review-candidates"
                ? "maxStaleReviewCandidates"
                : null;
    if (!key || values[index + 1] === undefined) throw new Error(`Unknown or incomplete option: ${option}`);
    const number = Number(values[++index]);
    const valid = key === "minProvenance"
      ? Number.isFinite(number) && number >= 0 && number <= 100
      : Number.isSafeInteger(number) && number >= 0;
    if (!valid) throw new Error(`Invalid value for ${option}.`);
    thresholds[key] = number;
  }
  return thresholds;
}

async function readGraph(path) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`Graph health input is not a file: ${path}`);
  if (metadata.size > MAX_INPUT_BYTES) throw new Error(`Graph health input exceeds the ${MAX_INPUT_BYTES / (1024 * 1024)} MB safety limit: ${path}`);
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value?.format === BACKUP_FORMAT && value.graphFingerprint !== undefined
    && value.graphFingerprint !== fingerprintBackup(value.graph, value.history)) {
    throw new Error(`Backup input fingerprint does not match its graph and history: ${path}`);
  }
  const graph = value?.format === BACKUP_FORMAT ? value.graph : value;
  if (!graph || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(graph.schema)) {
    throw new Error(`Graph health input must declare ${GRAPH_SCHEMA}: ${path}`);
  }
  return normalizeGraph(graph);
}

function runGate(health, thresholds) {
  const violations = [];
  if (thresholds.minProvenance !== null && health.provenanceCoverage < thresholds.minProvenance) {
    violations.push(`provenance coverage ${health.provenanceCoverage}% is below ${thresholds.minProvenance}%`);
  }
  if (thresholds.maxOrphaned !== null && health.orphanedSourceReferences > thresholds.maxOrphaned) {
    violations.push(`orphaned source references ${health.orphanedSourceReferences} exceed ${thresholds.maxOrphaned}`);
  }
  const ambiguous = health.ambiguousSourceReferences + health.ambiguousSourceIds + health.ambiguousEdgeIds;
  if (thresholds.maxAmbiguous !== null && ambiguous > thresholds.maxAmbiguous) {
    violations.push(`ambiguous integrity diagnostics ${ambiguous} exceed ${thresholds.maxAmbiguous}`);
  }
  if (thresholds.maxReviewCandidates !== null && health.reviewCandidates > thresholds.maxReviewCandidates) {
    violations.push(`review candidates ${health.reviewCandidates} exceed ${thresholds.maxReviewCandidates}`);
  }
  if (thresholds.maxStaleReviewCandidates !== null && health.staleReviewCandidates > thresholds.maxStaleReviewCandidates) {
    violations.push(`stale review candidates ${health.staleReviewCandidates} exceed ${thresholds.maxStaleReviewCandidates}`);
  }
  return { passed: violations.length === 0, violations, thresholds };
}

if (!inputPath) {
  console.error("Usage: node experiments/inspect-graph.mjs <graph-or-backup.json> [--min-provenance 95] [--max-orphaned 0] [--max-ambiguous 0] [--max-review-candidates 0] [--max-stale-review-candidates 0]");
  process.exitCode = 1;
} else {
  try {
    const graph = await readGraph(inputPath);
    const health = inspectGraph(graph);
    const report = {
      format: HEALTH_FORMAT,
      graphSchema: GRAPH_SCHEMA,
      graphVersion: graph.version,
      graphFingerprint: fingerprintBackup(graph),
      inspectedAt: new Date().toISOString(),
      health,
      gate: runGate(health, parseThresholds(argumentsList))
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.gate.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Graph health inspection failed.");
    process.exitCode = 1;
  }
}
