import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateExtraction } from "../evaluation.js";
import { extractGraph, parseJsonWithUniqueKeys, parseTimestamp } from "../graph-core.js";

const sampleGraph = parseJsonWithUniqueKeys(
  await readFile(new URL("../examples/sample-graph.json", import.meta.url), "utf8"),
  "Sample graph benchmark"
);
const feedback = parseJsonWithUniqueKeys(
  await readFile(new URL("../benchmarks/sample-feedback.json", import.meta.url), "utf8"),
  "Sample feedback benchmark"
);
const localFeedback = parseJsonWithUniqueKeys(
  await readFile(new URL("../benchmarks/local-extraction-feedback.json", import.meta.url), "utf8"),
  "Local extraction benchmark"
);
const extractionCases = parseJsonWithUniqueKeys(
  await readFile(new URL("../benchmarks/extraction-cases.json", import.meta.url), "utf8"),
  "Extraction quality cases"
);
// These fixtures are deterministic regression inputs, not the live reviewed
// corpus. Their explicit review dates are evaluated against a reference time
// one day after the newest fixture review, while evaluator and promotion tests
// continue to enforce real review freshness for live artifacts.
const allFixtureExamples = [
  ...feedback.examples,
  ...localFeedback.examples,
  ...extractionCases.cases.flatMap((testCase) => testCase.feedback)
];
const fixtureReviewTimes = allFixtureExamples
  .map((example) => parseTimestamp(example.lastReviewedAt))
  .filter(Number.isFinite);
if (!fixtureReviewTimes.length || fixtureReviewTimes.length !== allFixtureExamples.length) {
  throw new Error("Every deterministic benchmark example must carry an explicit review timestamp.");
}
const benchmarkNow = Math.max(...fixtureReviewTimes) + 86400000;
const sampleFeedbackExamples = feedback.examples;
const localFeedbackExamples = localFeedback.examples;

const source = sampleGraph.documents[0];
const report = evaluateExtraction({
  source: {
    id: source.id,
    title: source.title,
    text: source.text,
    fingerprint: source.fingerprint
  },
  nodes: sampleGraph.nodes,
  edges: sampleGraph.edges
}, sampleFeedbackExamples, { now: benchmarkNow });
assert.equal(report.feedback.examples, 8, "benchmark reviewed-example count changed unexpectedly");
assert.equal(report.feedback.conflicts, 0, "benchmark contains contradictory review decisions");
assert.equal(report.feedback.untrustedExamples, 0, "benchmark contains stale or undated review decisions");
assert(report.overall.accepted.recall >= 0.8, "sample graph accepted recall regressed below 0.8");
assert(report.overall.accepted.reviewedPrecision >= 0.9, "sample graph reviewed precision regressed below 0.9");
assert(report.overall.accepted.evidenceCoverage >= 0.8, "sample graph evidence coverage regressed below 0.8");
assert(report.overall.rejected.suppressionRate >= 0.9, "sample graph rejected suppression regressed below 0.9");

const localExtraction = extractGraph(
  "Attention sample",
  "Attention mixes information across tokens. Queries, keys, and values create a weighted lookup over context. Positional encoding gives the sequence an order.",
  { feedback: localFeedbackExamples }
);
const localReport = evaluateExtraction(localExtraction, localFeedbackExamples, { now: benchmarkNow });
assert.equal(localReport.feedback.examples, 8, "local extraction benchmark reviewed-example count changed unexpectedly");
assert.equal(localReport.feedback.conflicts, 0, "local extraction benchmark contains contradictory review decisions");
assert.equal(localReport.feedback.untrustedExamples, 0, "local extraction benchmark contains stale or undated review decisions");
assert(localReport.overall.accepted.recall >= 0.99, "local extraction accepted recall regressed");
assert(localReport.overall.accepted.reviewedPrecision >= 0.99, "local extraction reviewed precision regressed");
assert(localReport.overall.accepted.evidenceCoverage >= 0.99, "local extraction evidence coverage regressed");
assert(localReport.overall.rejected.suppressionRate >= 0.99, "local extraction rejected-fragment suppression regressed");

if (extractionCases.format !== "llm-field-notes/extraction-cases@1"
  || !Array.isArray(extractionCases.cases)
  || extractionCases.cases.length < 4) {
  throw new Error("Extraction quality cases must contain at least four representative reviewed inputs.");
}
const requiredCaseIds = new Set(["technical-phrases", "sparse-title", "non-latin", "tool-safety"]);
const caseIds = extractionCases.cases.map((testCase) => testCase?.id);
if (new Set(caseIds).size !== caseIds.length) {
  throw new Error("Extraction quality cases must not contain duplicate IDs.");
}
const availableCaseIds = new Set(caseIds);
for (const requiredCaseId of requiredCaseIds) {
  if (!availableCaseIds.has(requiredCaseId)) {
    throw new Error(`Extraction quality cases are missing required representative input: ${requiredCaseId}`);
  }
}
const caseReports = extractionCases.cases.map((testCase, index) => {
  if (!testCase || typeof testCase !== "object" || !testCase.id || typeof testCase.title !== "string"
    || typeof testCase.text !== "string" || !Array.isArray(testCase.feedback)
    || !testCase.minimum || typeof testCase.minimum !== "object") {
    throw new Error(`Extraction quality case ${index} is malformed.`);
  }
  const examples = testCase.feedback;
  const extraction = extractGraph(testCase.title, testCase.text, { feedback: examples });
  const result = evaluateExtraction(extraction, examples, { now: benchmarkNow });
  for (const [metric, threshold] of Object.entries(testCase.minimum)) {
    const actual = metric === "acceptedRecall"
      ? result.overall.accepted.recall
      : metric === "reviewedPrecision"
        ? result.overall.accepted.reviewedPrecision
        : metric === "evidenceCoverage"
          ? result.overall.accepted.evidenceCoverage
          : metric === "rejectedSuppressionRate"
            ? result.overall.rejected.suppressionRate
            : undefined;
    if (actual === undefined || !Number.isFinite(threshold) || actual < threshold) {
      throw new Error(`Extraction quality case ${testCase.id} failed ${metric}: ${actual} < ${threshold}`);
    }
  }
  return {
    id: testCase.id,
    concepts: result.extraction.concepts,
    relations: result.extraction.relations,
    acceptedRecall: result.overall.accepted.recall,
    reviewedPrecision: result.overall.accepted.reviewedPrecision,
    evidenceCoverage: result.overall.accepted.evidenceCoverage,
    rejectedSuppressionRate: result.overall.rejected.suppressionRate
  };
});

console.log(JSON.stringify({
  checked: true,
  format: report.schema,
  examples: report.feedback.examples,
  untrustedExamples: report.feedback.untrustedExamples,
  acceptedRecall: report.overall.accepted.recall,
  reviewedPrecision: report.overall.accepted.reviewedPrecision,
  evidenceCoverage: report.overall.accepted.evidenceCoverage,
  rejectedSuppressionRate: report.overall.rejected.suppressionRate,
  representativeCaseCount: caseReports.length,
  requiredRepresentativeCases: [...requiredCaseIds],
  localExtraction: {
    examples: localReport.feedback.examples,
    concepts: localReport.extraction.concepts,
    relations: localReport.extraction.relations,
    acceptedRecall: localReport.overall.accepted.recall,
    rejectedSuppressionRate: localReport.overall.rejected.suppressionRate
  },
  representativeCases: caseReports
}, null, 2));
