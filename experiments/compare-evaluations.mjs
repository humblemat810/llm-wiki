import { readFile, stat } from "node:fs/promises";
import { GRAPH_SCHEMA } from "../graph-core.js";
import { EVALUATION_SCHEMA } from "../evaluation.js";

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

async function readEvaluation(path) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`Evaluation input is not a file: ${path}`);
  if (metadata.size > MAX_INPUT_BYTES) throw new Error(`Evaluation input exceeds the ${MAX_INPUT_BYTES / (1024 * 1024)} MB safety limit: ${path}`);
  const value = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Evaluation input is not an object: ${path}`);
  if (value.schema !== EVALUATION_SCHEMA) throw new Error(`Evaluation input must declare ${EVALUATION_SCHEMA}: ${path}`);
  if (value.graphSchema !== GRAPH_SCHEMA) throw new Error(`Evaluation input must declare ${GRAPH_SCHEMA}: ${path}`);
  if (!/^fnv1a-[0-9a-f]{8}$/.test(value.feedback?.datasetFingerprint || "")) {
    throw new Error(`Evaluation input must include a valid reviewed-dataset fingerprint: ${path}`);
  }
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

function readMetric(evaluation, name, getter) {
  const value = Number(getter(evaluation));
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Evaluation metric ${name} must be a finite number between 0 and 1.`);
  }
  return value;
}

export function compareEvaluations(baseline, candidate, { tolerance = 0 } = {}) {
  const normalizedTolerance = parseTolerance(tolerance);
  const baselineFingerprint = baseline.feedback.datasetFingerprint;
  const candidateFingerprint = candidate.feedback.datasetFingerprint;
  if (baselineFingerprint !== candidateFingerprint) {
    throw new Error(`Evaluation reports use different reviewed datasets (${baselineFingerprint} versus ${candidateFingerprint}).`);
  }
  const metrics = METRICS.map(([name, getter]) => {
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
    metrics,
    passed: regressions.length === 0,
    regressions
  };
}

const [baselinePath, candidatePath, ...options] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  console.error("Usage: node experiments/compare-evaluations.mjs <baseline.json> <candidate.json> [--max-regression <0..1>]");
  process.exitCode = 1;
} else {
  try {
    const toleranceIndex = options.indexOf("--max-regression");
    const tolerance = toleranceIndex < 0 ? 0 : options[toleranceIndex + 1];
    if (toleranceIndex >= 0 && tolerance === undefined) throw new Error("--max-regression requires a value.");
    const result = compareEvaluations(
      await readEvaluation(baselinePath),
      await readEvaluation(candidatePath),
      { tolerance }
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Evaluation comparison failed.");
    process.exitCode = 1;
  }
}
