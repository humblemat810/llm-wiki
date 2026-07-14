import { GRAPH_SCHEMA } from "../graph-core.js";
import { EVALUATION_SCHEMA, MAX_EVALUATION_EXAMPLES, validateEvaluationReport } from "../evaluation.js";
import { readBoundedTextFile } from "./bounded-file.mjs";
import { pathToFileURL } from "node:url";

export const EVALUATION_COMPARISON_FORMAT = "llm-field-notes/evaluation-comparison@1";
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const METRICS = [
  ["overall.accepted.recall", (value) => value?.overall?.accepted?.recall],
  ["overall.rejected.suppressionRate", (value) => value?.overall?.rejected?.suppressionRate],
  ["concepts.accepted.recall", (value) => value?.feedback?.concepts?.accepted?.recall],
  ["concepts.rejected.suppressionRate", (value) => value?.feedback?.concepts?.rejected?.suppressionRate],
  ["relations.accepted.recall", (value) => value?.feedback?.relations?.accepted?.recall],
  ["relations.rejected.suppressionRate", (value) => value?.feedback?.relations?.rejected?.suppressionRate]
];
const OPTIONAL_METRICS = [
  ["overall.accepted.reviewedPrecision", (value) => value?.overall?.accepted?.reviewedPrecision],
  ["concepts.accepted.reviewedPrecision", (value) => value?.feedback?.concepts?.accepted?.reviewedPrecision],
  ["relations.accepted.reviewedPrecision", (value) => value?.feedback?.relations?.accepted?.reviewedPrecision],
  ["overall.accepted.evidenceCoverage", (value) => value?.overall?.accepted?.evidenceCoverage],
  ["concepts.accepted.evidenceCoverage", (value) => value?.feedback?.concepts?.accepted?.evidenceCoverage],
  ["relations.accepted.evidenceCoverage", (value) => value?.feedback?.relations?.accepted?.evidenceCoverage]
];

async function readEvaluation(path) {
  const value = JSON.parse(await readBoundedTextFile(path, MAX_INPUT_BYTES, {
    label: "Evaluation input",
    tooLargeMessage: `Evaluation input exceeds the ${MAX_INPUT_BYTES / (1024 * 1024)} MB safety limit: ${path}`
  }));
  validateEvaluationReport(value, { label: `Evaluation input ${path}` });
  if (value.feedback.conflicts > 0) throw new Error(`Evaluation input contains ${value.feedback.conflicts} contradictory reviewed decisions: ${path}`);
  return value;
}

function parseTolerance(value) {
  if (value === undefined) return 0;
  const tolerance = Number(value);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
    throw new Error("Regression tolerance must be a number between 0 and 1.");
  }
  return tolerance;
}

function parseMaxUntrustedFeedback(value) {
  if (value === undefined || value === null) return null;
  const maximum = Number(value);
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > MAX_EVALUATION_EXAMPLES) {
    throw new Error(`Untrusted-feedback threshold must be an integer from 0 to ${MAX_EVALUATION_EXAMPLES}.`);
  }
  return maximum;
}

function enforceFeedbackFreshness(evaluation, path, maximum) {
  if (maximum === null) return;
  const count = evaluation.feedback?.untrustedExamples;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Evaluation input must include freshness diagnostics when --max-untrusted-feedback is used: ${path}`);
  }
  if (count > maximum) {
    throw new Error(`untrusted feedback examples ${count} exceed ${maximum}: ${path}`);
  }
}

function readMetric(evaluation, name, getter) {
  const value = Number(getter(evaluation));
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Evaluation metric ${name} must be a finite number between 0 and 1.`);
  }
  return value;
}

export function compareEvaluations(baseline, candidate, { tolerance = 0, maxUntrustedFeedback = null } = {}) {
  validateEvaluationReport(baseline, { label: "Baseline evaluation" });
  validateEvaluationReport(candidate, { label: "Candidate evaluation" });
  const normalizedTolerance = parseTolerance(tolerance);
  const normalizedMaxUntrustedFeedback = parseMaxUntrustedFeedback(maxUntrustedFeedback);
  enforceFeedbackFreshness(baseline, "baseline", normalizedMaxUntrustedFeedback);
  enforceFeedbackFreshness(candidate, "candidate", normalizedMaxUntrustedFeedback);
  const baselineFingerprint = baseline.feedback.datasetFingerprint;
  const candidateFingerprint = candidate.feedback.datasetFingerprint;
  if (baselineFingerprint !== candidateFingerprint) {
    throw new Error(`Evaluation reports use different reviewed datasets (${baselineFingerprint} versus ${candidateFingerprint}).`);
  }
  const metrics = [
    ...METRICS,
    ...OPTIONAL_METRICS.filter(([, getter]) => getter(baseline) !== undefined && getter(candidate) !== undefined)
  ].map(([name, getter]) => {
    const baselineValue = readMetric(baseline, name, getter);
    const candidateValue = readMetric(candidate, name, getter);
    const delta = Number((candidateValue - baselineValue).toFixed(4));
    return {
      name,
      baseline: baselineValue,
      candidate: candidateValue,
      delta,
      regression: delta < -normalizedTolerance
    };
  });
  const regressions = metrics.filter((metric) => metric.regression).map((metric) => metric.name);
  return {
    format: EVALUATION_COMPARISON_FORMAT,
    evaluationSchema: EVALUATION_SCHEMA,
    graphSchema: GRAPH_SCHEMA,
    tolerance: normalizedTolerance,
    baseline: {
      evaluatedAt: baseline.evaluatedAt || null,
      examples: baseline.feedback?.examples ?? null,
      datasetFingerprint: baselineFingerprint
    },
    candidate: {
      evaluatedAt: candidate.evaluatedAt || null,
      examples: candidate.feedback?.examples ?? null,
      datasetFingerprint: candidateFingerprint
    },
    ...(normalizedMaxUntrustedFeedback === null ? {} : {
      feedbackTrust: {
        maxUntrustedFeedback: normalizedMaxUntrustedFeedback,
        baselineUntrustedExamples: baseline.feedback.untrustedExamples,
        candidateUntrustedExamples: candidate.feedback.untrustedExamples
      }
    }),
    metrics,
    passed: regressions.length === 0,
    regressions
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [baselinePath, candidatePath, ...options] = process.argv.slice(2);
  if (!baselinePath || !candidatePath) {
    console.error("Usage: node experiments/compare-evaluations.mjs <baseline.json> <candidate.json> [--max-regression <0..1>] [--max-untrusted-feedback <integer>]");
    process.exitCode = 1;
  } else {
    try {
      let tolerance = 0;
      let maxUntrustedFeedback = null;
      for (let index = 0; index < options.length; index += 1) {
        const option = options[index];
        const value = options[++index];
        if (option === "--max-regression") {
          if (value === undefined) throw new Error("--max-regression requires a value.");
          tolerance = value;
        } else if (option === "--max-untrusted-feedback") {
          if (value === undefined) throw new Error("--max-untrusted-feedback requires a value.");
          maxUntrustedFeedback = value;
        } else {
          throw new Error(`Unknown option: ${option}`);
        }
      }
      const result = compareEvaluations(
        await readEvaluation(baselinePath),
        await readEvaluation(candidatePath),
        { tolerance, maxUntrustedFeedback }
      );
      console.log(JSON.stringify(result, null, 2));
      if (!result.passed) process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Evaluation comparison failed.");
      process.exitCode = 1;
    }
  }
}
