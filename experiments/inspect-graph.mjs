import { readFile } from "node:fs/promises";
import { buildHealthReport, HEALTH_GATE_LIMITS, parseJsonWithUniqueKeys, validateHealthReport } from "../graph-core.js";
import { readGraphInput } from "./graph-input.mjs";

const APP_VERSION = parseJsonWithUniqueKeys(await readFile(new URL("../package.json", import.meta.url), "utf8"), "package.json").version;
const [inputPath, ...argumentsList] = process.argv.slice(2);
const thresholdMaximums = HEALTH_GATE_LIMITS;
const usage = "Usage: node experiments/inspect-graph.mjs <graph-or-backup.json> [--min-provenance 95] [--min-fresh-source-review 90] [--max-orphaned 0] [--max-ambiguous 0] [--max-conflicting-items 0] [--max-unsupported-nodes 0] [--max-unsupported-edges 0] [--max-review-candidates 0] [--max-review-queue-truncated 0] [--max-evidence-grounding-truncated 0] [--max-feedback-context-truncated 0] [--max-stale-review-candidates 0] [--max-stale-learning-examples 0] [--max-withheld-guidance 0] [--max-unanchored-evidence 0] [--max-truncated-items 0] [--max-dropped-items 0]";

function parseThresholds(values) {
  const thresholds = { minProvenance: null, minFreshSourceReview: null, maxOrphaned: null, maxAmbiguous: null, maxUnsupportedNodes: null, maxUnsupportedEdges: null, maxReviewCandidates: null, maxReviewQueueTruncated: null, maxEvidenceGroundingTruncated: null, maxFeedbackContextTruncated: null, maxStaleReviewCandidates: null, maxStaleLearningExamples: null, maxWithheldGuidance: null, maxUnanchoredEvidence: null, maxConflictingItems: null, maxTruncatedItems: null, maxDroppedItems: null };
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
                      : option === "--max-review-queue-truncated"
                        ? "maxReviewQueueTruncated"
                      : option === "--max-evidence-grounding-truncated"
                        ? "maxEvidenceGroundingTruncated"
                      : option === "--max-feedback-context-truncated"
                        ? "maxFeedbackContextTruncated"
                      : option === "--max-stale-review-candidates"
                      ? "maxStaleReviewCandidates"
                      : option === "--max-stale-learning-examples"
                        ? "maxStaleLearningExamples"
                        : option === "--max-withheld-guidance"
                          ? "maxWithheldGuidance"
                        : option === "--max-unanchored-evidence"
                          ? "maxUnanchoredEvidence"
                        : option === "--max-conflicting-items"
                          ? "maxConflictingItems"
                        : option === "--max-truncated-items"
                          ? "maxTruncatedItems"
                          : option === "--max-dropped-items"
                            ? "maxDroppedItems"
                          : null;
    if (!key || values[index + 1] === undefined) throw new Error(`Unknown or incomplete option: ${option}`);
    const number = Number(values[++index]);
    const maximum = thresholdMaximums[key];
    const valid = key === "minProvenance" || key === "minFreshSourceReview"
      ? Number.isFinite(number) && number >= 0 && number <= 100
      : Number.isSafeInteger(number) && number >= 0 && (maximum === undefined || number <= maximum);
    if (!valid) throw new Error(`Invalid value for ${option}.`);
    thresholds[key] = number;
  }
  return thresholds;
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
  if (thresholds.maxReviewQueueTruncated !== null && (health.reviewQueueTruncated ? 1 : 0) > thresholds.maxReviewQueueTruncated) {
    violations.push(`review queue is truncated and exceeds ${thresholds.maxReviewQueueTruncated}`);
  }
  if (thresholds.maxEvidenceGroundingTruncated !== null && (health.evidenceGroundingTruncated ? 1 : 0) > thresholds.maxEvidenceGroundingTruncated) {
    violations.push(`evidence grounding is truncated and exceeds ${thresholds.maxEvidenceGroundingTruncated}`);
  }
  if (thresholds.maxFeedbackContextTruncated !== null && (health.feedbackContextTruncated ? 1 : 0) > thresholds.maxFeedbackContextTruncated) {
    violations.push(`extractor guidance context is truncated and exceeds ${thresholds.maxFeedbackContextTruncated}`);
  }
  if (thresholds.maxStaleReviewCandidates !== null && health.staleReviewCandidates > thresholds.maxStaleReviewCandidates) {
    violations.push(`stale review candidates ${health.staleReviewCandidates} exceed ${thresholds.maxStaleReviewCandidates}`);
  }
  if (thresholds.maxStaleLearningExamples !== null && health.staleLearningExamples > thresholds.maxStaleLearningExamples) {
    violations.push(`stale learning examples ${health.staleLearningExamples} exceed ${thresholds.maxStaleLearningExamples}`);
  }
  if (thresholds.maxWithheldGuidance !== null && health.feedbackContextExcluded > thresholds.maxWithheldGuidance) {
    violations.push(`withheld extractor guidance ${health.feedbackContextExcluded} exceed ${thresholds.maxWithheldGuidance}`);
  }
  if (thresholds.maxUnanchoredEvidence !== null && health.unanchoredEvidenceRecords > thresholds.maxUnanchoredEvidence) {
    violations.push(`unanchored evidence records ${health.unanchoredEvidenceRecords} exceed ${thresholds.maxUnanchoredEvidence}`);
  }
  if (thresholds.maxConflictingItems !== null && health.conflictingItems > thresholds.maxConflictingItems) {
    violations.push(`contradictory duplicate review records ${health.conflictingItems} exceed ${thresholds.maxConflictingItems}`);
  }
  if (thresholds.maxTruncatedItems !== null && health.truncatedItems > thresholds.maxTruncatedItems) {
    violations.push(`truncated import items ${health.truncatedItems} exceed ${thresholds.maxTruncatedItems}`);
  }
  if (thresholds.maxDroppedItems !== null && health.droppedItems > thresholds.maxDroppedItems) {
    violations.push(`dropped malformed import items ${health.droppedItems} exceed ${thresholds.maxDroppedItems}`);
  }
  return { passed: violations.length === 0, violations, thresholds };
}

if (process.argv.includes("--help")) {
  console.log(usage);
} else if (!inputPath) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const graph = await readGraphInput(inputPath, { label: "Graph health input" });
    const report = buildHealthReport(graph, { appVersion: APP_VERSION });
    report.gate = runGate(report.health, parseThresholds(argumentsList));
    validateHealthReport(report, { label: "Graph health report" });
    console.log(JSON.stringify(report, null, 2));
    if (!report.gate.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Graph health inspection failed.");
    process.exitCode = 1;
  }
}
