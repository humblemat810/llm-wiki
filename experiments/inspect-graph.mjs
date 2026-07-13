import { readFile, stat } from "node:fs/promises";
import { BACKUP_FORMAT, GRAPH_SCHEMA, HEALTH_FORMAT, LEGACY_GRAPH_SCHEMAS, fingerprintBackup, inspectGraph, matchesGraphFingerprint, normalizeGraph } from "../graph-core.js";

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const [inputPath, ...argumentsList] = process.argv.slice(2);

function parseThresholds(values) {
  const thresholds = { minProvenance: null, minFreshSourceReview: null, maxOrphaned: null, maxAmbiguous: null, maxUnsupportedNodes: null, maxUnsupportedEdges: null, maxReviewCandidates: null, maxStaleReviewCandidates: null, maxStaleLearningExamples: null };
  for (let index = 0; index < values.length; index += 1) {
    const option = values[index];
    const key = option === "--min-provenance"
      ? "minProvenance"
      : option === "--min-fresh-source-review"
        ? "minFreshSourceReview"
      : option === "--max-orphaned"
        ? "maxOrphaned"
          : option === "--max-ambiguous"
            ? "maxAmbiguous"
              : option === "--max-unsupported-nodes"
                ? "maxUnsupportedNodes"
                : option === "--max-unsupported-edges"
                  ? "maxUnsupportedEdges"
                  : option === "--max-review-candidates"
                    ? "maxReviewCandidates"
                      : option === "--max-stale-review-candidates"
                      ? "maxStaleReviewCandidates"
                      : option === "--max-stale-learning-examples"
                        ? "maxStaleLearningExamples"
                        : null;
    if (!key || values[index + 1] === undefined) throw new Error(`Unknown or incomplete option: ${option}`);
    const number = Number(values[++index]);
    const valid = key === "minProvenance" || key === "minFreshSourceReview"
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
    && !matchesGraphFingerprint(value.graph, value.graphFingerprint, value.history)) {
    throw new Error(`Backup input fingerprint does not match its graph and history: ${path}`);
  }
  const graph = value?.format === BACKUP_FORMAT ? value.graph : value;
  if (!graph || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(graph.schema)) {
    throw new Error(`Graph health input must declare ${GRAPH_SCHEMA}: ${path}`);
  }
  if (graph.graphFingerprint !== undefined && !matchesGraphFingerprint(graph, graph.graphFingerprint)) {
    throw new Error(`Graph input fingerprint does not match its contents: ${path}`);
  }
  return normalizeGraph(graph);
}

function runGate(health, thresholds) {
  const violations = [];
  if (thresholds.minProvenance !== null && health.provenanceCoverage < thresholds.minProvenance) {
    violations.push(`provenance coverage ${health.provenanceCoverage}% is below ${thresholds.minProvenance}%`);
  }
  if (thresholds.minFreshSourceReview !== null && health.freshSourceReviewCoverage < thresholds.minFreshSourceReview) {
    violations.push(`fresh source-review coverage ${health.freshSourceReviewCoverage}% is below ${thresholds.minFreshSourceReview}%`);
  }
  if (thresholds.maxOrphaned !== null && health.orphanedSourceReferences > thresholds.maxOrphaned) {
    violations.push(`orphaned source references ${health.orphanedSourceReferences} exceed ${thresholds.maxOrphaned}`);
  }
  const ambiguous = health.ambiguousLabels + health.ambiguousSourceReferences + health.ambiguousSourceIds + health.ambiguousEdgeIds;
  if (thresholds.maxAmbiguous !== null && ambiguous > thresholds.maxAmbiguous) {
    violations.push(`ambiguous integrity and label diagnostics ${ambiguous} exceed ${thresholds.maxAmbiguous}`);
  }
  if (thresholds.maxUnsupportedNodes !== null && health.unsupportedNodes > thresholds.maxUnsupportedNodes) {
    violations.push(`unsupported concepts ${health.unsupportedNodes} exceed ${thresholds.maxUnsupportedNodes}`);
  }
  if (thresholds.maxUnsupportedEdges !== null && health.unsupportedEdges > thresholds.maxUnsupportedEdges) {
    violations.push(`unsupported relations ${health.unsupportedEdges} exceed ${thresholds.maxUnsupportedEdges}`);
  }
  if (thresholds.maxReviewCandidates !== null && health.reviewCandidates > thresholds.maxReviewCandidates) {
    violations.push(`review candidates ${health.reviewCandidates} exceed ${thresholds.maxReviewCandidates}`);
  }
  if (thresholds.maxStaleReviewCandidates !== null && health.staleReviewCandidates > thresholds.maxStaleReviewCandidates) {
    violations.push(`stale review candidates ${health.staleReviewCandidates} exceed ${thresholds.maxStaleReviewCandidates}`);
  }
  if (thresholds.maxStaleLearningExamples !== null && health.staleLearningExamples > thresholds.maxStaleLearningExamples) {
    violations.push(`stale learning examples ${health.staleLearningExamples} exceed ${thresholds.maxStaleLearningExamples}`);
  }
  return { passed: violations.length === 0, violations, thresholds };
}

if (!inputPath) {
  console.error("Usage: node experiments/inspect-graph.mjs <graph-or-backup.json> [--min-provenance 95] [--min-fresh-source-review 90] [--max-orphaned 0] [--max-ambiguous 0] [--max-unsupported-nodes 0] [--max-unsupported-edges 0] [--max-review-candidates 0] [--max-stale-review-candidates 0] [--max-stale-learning-examples 0]");
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
