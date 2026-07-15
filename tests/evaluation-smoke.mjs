import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateExtraction, EVALUATION_SCHEMA, MAX_EVALUATION_EXAMPLES, MAX_EVALUATION_MATCH_COMPARISONS, validateEvaluationReport } from "../evaluation.js";
import { compareEvaluations } from "../experiments/compare-evaluations.mjs";
import { fingerprintFeedbackExamples, matchesFeedbackFingerprint } from "../graph-core.js";

const execFileAsync = promisify(execFile);

const extraction = {
  source: { title: "Evaluation", text: "Attention uses context." },
  nodes: [
    { id: "attention", label: "Attention", aliases: ["lookup"] },
    { id: "context", label: "Context" },
    { id: "noise", label: "Noise" }
  ],
  edges: [
    { id: "attention--context--uses", source: "attention", target: "context", label: "uses" }
  ]
};

const report = evaluateExtraction(extraction, [
  { kind: "concept", id: "attention", label: "Attention", aliases: ["lookup"], status: "accepted" },
  { kind: "concept", id: "missing", label: "Missing concept", status: "accepted" },
  { kind: "concept", id: "noise", label: "Noise", status: "rejected" },
  { kind: "relation", id: "attention--context--uses", source: "attention", target: "context", label: "uses", status: "accepted" },
  { kind: "relation", source: "attention", target: "context", label: "causes", status: "rejected" },
  { kind: "concept", id: "attention", label: "Attention", status: "accepted" }
]);

assert.equal(report.schema, EVALUATION_SCHEMA);
assert.match(report.feedback.datasetFingerprint, /^fnv1a-[0-9a-f]{16}$/);
assert.equal(report.feedback.examples, 5);
assert.equal(report.feedback.freshExamples, 0);
assert.equal(report.feedback.staleExamples, 0);
assert.equal(report.feedback.undatedExamples, 5);
assert.equal(report.feedback.untrustedExamples, 5);
const singleFeedback = [{ kind: "concept", id: "attention", label: "Attention", status: "accepted" }];
assert(matchesFeedbackFingerprint(singleFeedback, fingerprintFeedbackExamples(singleFeedback)));
assert(matchesFeedbackFingerprint(singleFeedback, "fnv1a-7ebe5ec3"), "legacy 32-bit feedback fingerprints should remain importable");
const unicodeFeedback = [
  { kind: "concept", id: "angstrom", label: "Ångström", status: "accepted" },
  { kind: "concept", id: "注意", label: "注意 机制", status: "rejected" }
];
assert.equal(
  fingerprintFeedbackExamples(unicodeFeedback),
  fingerprintFeedbackExamples([...unicodeFeedback].reverse()),
  "feedback fingerprints should use locale-independent canonical ordering"
);
assert.equal(report.extraction.concepts, 3);
assert.equal(report.extraction.relations, 1);
assert.equal(report.feedback.conflicts, 0);
assert.equal(report.feedback.concepts.accepted.found, 1);
assert.equal(report.feedback.concepts.accepted.missed, 1);
assert.equal(report.feedback.concepts.rejected.present, 1);
assert.equal(report.feedback.concepts.rejected.suppressionRate, 0);
assert.equal(report.feedback.relations.accepted.found, 1);
assert.equal(report.feedback.relations.rejected.suppressed, 1);
assert.equal(report.feedback.concepts.accepted.evidenceBacked, 0);
assert.equal(report.feedback.concepts.accepted.evidenceCoverage, 0);
assert.equal(report.feedback.concepts.accepted.reviewedPrecision, .5, "evaluation should expose reviewed candidate precision");
assert.equal(report.feedback.relations.accepted.evidenceCoverage, 0);
assert.equal(report.feedback.relations.accepted.reviewedPrecision, 1);
assert.equal(report.overall.accepted.recall, .6667);
assert.equal(report.overall.accepted.evidenceCoverage, 0);
assert.equal(report.overall.accepted.reviewedPrecision, .6667);
const selfComparison = compareEvaluations(report, report);
assert.equal(selfComparison.metrics.length, 12, "evaluation comparisons should emit every supported metric");
assert.equal(selfComparison.regressions.length, 0, "identical evaluation reports should not regress");
assert.doesNotThrow(() => validateEvaluationReport(report), "valid evaluation reports should pass the runtime contract");
assert.throws(
  () => validateEvaluationReport({ ...report, evaluatedAt: "not-a-timestamp" }),
  /evaluatedAt must be a valid bounded date-time/,
  "evaluation validation should reject non-date provenance timestamps"
);
assert.throws(
  () => validateEvaluationReport({ ...report, evaluatedAt: "2026-07-14" }),
  /evaluatedAt must be a valid bounded date-time/,
  "evaluation validation should require a full date-time rather than a date-only value"
);
assert.throws(
  () => validateEvaluationReport({ ...report, evaluatedAt: "2026-02-31T00:00:00.000Z" }),
  /evaluatedAt must be a valid bounded date-time/,
  "evaluation validation should reject impossible calendar dates"
);
assert.throws(
  () => validateEvaluationReport({ ...report, evaluatedAt: "x".repeat(129) }),
  /evaluatedAt must be a valid bounded date-time/,
  "evaluation validation should bound provenance timestamp strings"
);
assert.throws(
  () => validateEvaluationReport({ ...report, unexpected: true }),
  /evaluation\.unexpected is not allowed/,
  "evaluation validation should reject unknown root fields"
);
assert.throws(
  () => validateEvaluationReport({ ...report, feedback: { ...report.feedback, unexpected: true } }),
  /evaluation\.feedback\.unexpected is not allowed/,
  "evaluation validation should reject unknown nested fields"
);
assert.throws(
  () => compareEvaluations({ ...report, feedback: { ...report.feedback, examples: MAX_EVALUATION_EXAMPLES + 1 } }, report),
  /feedback\.examples/,
  "programmatic promotion comparisons should reject oversized reviewed-example counts"
);
assert.throws(
  () => compareEvaluations({ ...report, overall: { ...report.overall, accepted: { ...report.overall.accepted, found: report.overall.accepted.found + 1 } } }, report),
  /inconsistent expected, found, and missed counts/,
  "programmatic promotion comparisons should reject inconsistent metric counts"
);
assert.throws(
  () => validateEvaluationReport({ ...report, overall: { ...report.overall, accepted: { ...report.overall.accepted, recall: 1 } } }),
  /recall is inconsistent with its counts/,
  "evaluation validation should reject fabricated recall ratios"
);
assert.throws(
  () => validateEvaluationReport({ ...report, overall: { ...report.overall, rejected: { ...report.overall.rejected, suppressionRate: 1 } } }),
  /suppressionRate is inconsistent with its counts/,
  "evaluation validation should reject fabricated suppression ratios"
);
assert.throws(
  () => validateEvaluationReport({ ...report, feedback: { ...report.feedback, concepts: { ...report.feedback.concepts, accepted: { ...report.feedback.concepts.accepted, evidenceCoverage: 1 } } } }),
  /evidenceCoverage is inconsistent with its counts/,
  "evaluation validation should reject fabricated evidence coverage ratios"
);
assert.throws(
  () => validateEvaluationReport({
    ...report,
    feedback: {
      ...report.feedback,
      concepts: {
        ...report.feedback.concepts,
        accepted: {
          ...report.feedback.concepts.accepted,
          expected: report.feedback.concepts.accepted.expected + 1,
          missed: report.feedback.concepts.accepted.missed + 1,
          recall: 0.3333
        }
      }
    },
    overall: {
      ...report.overall,
      accepted: {
        ...report.overall.accepted,
        expected: report.overall.accepted.expected + 1,
        missed: report.overall.accepted.missed + 1,
        recall: 0.5
      }
    }
  }),
  /category counts do not match the reviewed-example count/,
  "evaluation validation should reject reports whose category denominators do not cover the declared reviewed dataset"
);
assert.throws(
  () => validateEvaluationReport({
    ...report,
    extraction: { concepts: 0, relations: report.extraction.relations }
  }),
  /reports more matched candidates than the extraction contains/,
  "evaluation validation should reject reports claiming matches that exceed candidate output"
);
const unmatchedReviewedExamples = evaluateExtraction({
  nodes: [{ id: "attention", label: "Attention" }],
  edges: []
}, [
  { kind: "concept", id: "missing", label: "Missing", status: "accepted" },
  { kind: "concept", id: "noise", label: "Noise", status: "rejected" }
]);
assert.equal(unmatchedReviewedExamples.feedback.concepts.accepted.found, 0, "evaluation must not count an unrelated candidate for an accepted example");
assert.equal(unmatchedReviewedExamples.feedback.concepts.rejected.present, 0, "evaluation must not count an unrelated candidate for a rejected example");
assert.equal(unmatchedReviewedExamples.feedback.concepts.rejected.suppressionRate, 1);
assert.equal(report.overall.rejected.suppressionRate, .5);
const reversedRelation = evaluateExtraction({
  nodes: [{ id: "attention", label: "Attention" }, { id: "context", label: "Context" }],
  edges: [{ id: "attention--context--uses", source: "context", target: "attention", label: "uses" }]
}, [{
  kind: "relation",
  id: "attention--context--uses",
  source: "attention",
  target: "context",
  label: "uses",
  status: "accepted"
}]);
assert.equal(reversedRelation.feedback.relations.accepted.found, 1, "evaluation should preserve graph relation identity when endpoint order is reversed");
const wrongLabelSameId = evaluateExtraction({
  nodes: [{ id: "attention", label: "Attention" }, { id: "context", label: "Context" }],
  edges: [{ id: "attention--context--uses", source: "attention", target: "context", label: "supports" }]
}, [{
  kind: "relation",
  id: "attention--context--uses",
  source: "attention",
  target: "context",
  label: "uses",
  status: "accepted"
}]);
assert.equal(wrongLabelSameId.feedback.relations.accepted.found, 0, "evaluation should reject a reused relation ID when its label changes");
const rejectedAcceptedCandidate = evaluateExtraction({
  nodes: [{ id: "attention", label: "Attention", status: "rejected" }],
  edges: []
}, [{
  kind: "concept",
  id: "attention",
  label: "Attention",
  status: "accepted"
}]);
assert.equal(rejectedAcceptedCandidate.feedback.concepts.accepted.found, 0, "evaluation should not count a rejected candidate as accepted recall");
const unanchoredEvidence = evaluateExtraction({
  source: { id: "doc-evidence", text: "Evaluation source text" },
  nodes: [{ id: "attention", label: "Attention", evidence: [{ text: "unanchored", sources: ["other-document"] }] }],
  edges: []
}, [{
  kind: "concept",
  id: "attention",
  label: "Attention",
  status: "accepted"
}]);
assert.equal(unanchoredEvidence.feedback.concepts.accepted.evidenceCoverage, 0, "evaluation evidence coverage should require a reference to the evaluated source");
const anchoredEvidence = evaluateExtraction({
  source: { id: "doc-evidence", text: "Evaluation source text" },
  nodes: [{ id: "attention", label: "Attention", evidence: [{ text: "anchored", sources: ["doc-evidence"] }] }],
  edges: []
}, [{
  kind: "concept",
  id: "attention",
  label: "Attention",
  status: "accepted"
}]);
assert.equal(anchoredEvidence.feedback.concepts.accepted.evidenceCoverage, 1, "evaluation should count source-anchored evidence");

const empty = evaluateExtraction({ nodes: [], edges: [] }, []);
assert.equal(empty.overall.accepted.recall, 1);
assert.equal(empty.overall.accepted.evidenceCoverage, 1);
assert.equal(empty.overall.rejected.suppressionRate, 1);
const longIdentity = `workspace-${"x".repeat(190)}`;
const longIdentityReport = evaluateExtraction(
  { nodes: [{ id: longIdentity, label: "Long identity" }], edges: [] },
  [{ kind: "concept", id: longIdentity, label: "Long identity", status: "accepted" }]
);
assert.equal(longIdentityReport.feedback.concepts.accepted.found, 1, "evaluation should compare long graph IDs without slug truncation");
const overlongIdentityA = `${"a".repeat(201)}-one`;
const overlongIdentityB = `${"a".repeat(201)}-two`;
const overlongIdentityReport = evaluateExtraction(
  { nodes: [{ id: overlongIdentityA, label: "First" }], edges: [] },
  [
    { kind: "concept", id: overlongIdentityA, label: "First", status: "accepted" },
    { kind: "concept", id: overlongIdentityB, label: "Second", status: "accepted" }
  ]
);
assert.equal(overlongIdentityReport.feedback.concepts.accepted.found, 1, "evaluation should not collide malformed overlong identities by prefix");
assert.equal(MAX_EVALUATION_EXAMPLES, 15000);
assert.equal(MAX_EVALUATION_MATCH_COMPARISONS, 2000000);
assert.throws(
  () => evaluateExtraction({ nodes: [], edges: [] }, Array.from({ length: MAX_EVALUATION_EXAMPLES + 1 }, () => ({ kind: "concept", id: "too-many", status: "accepted" }))),
  /feedback exceeds the 15,000 example safety limit/,
  "evaluation should reject oversized reviewed datasets instead of silently truncating the benchmark"
);
assert.throws(
  () => evaluateExtraction({ nodes: Array.from({ length: 5001 }, () => ({ id: "too-many", label: "Too many" })), edges: [] }, []),
  /extraction exceeds the 5,000 concept safety limit/,
  "evaluation should reject oversized candidate concept output instead of silently truncating it"
);
assert.throws(
  () => evaluateExtraction({ nodes: [], edges: Array.from({ length: 10001 }, () => ({ source: "a", target: "b", label: "related" })) }, []),
  /extraction exceeds the 10,000 relation safety limit/,
  "evaluation should reject oversized candidate relation output instead of silently truncating it"
);
assert.throws(
  () => evaluateExtraction({ nodes: [], edges: [] }, [{ kind: "concept", id: "unreviewed", status: "inferred" }]),
  /feedback example 0 is not a reviewed concept or relation/,
  "evaluation should reject malformed or unreviewed benchmark examples instead of silently filtering them"
);
assert.throws(
  () => evaluateExtraction({ nodes: [], edges: [] }, [{ kind: "concept", id: "x".repeat(4097), label: "bounded", status: "accepted" }]),
  /example 0\.id must be a string no longer than 4096/,
  "evaluation should reject oversized reviewed identities before matching"
);
assert.throws(
  () => evaluateExtraction({ nodes: [], edges: [] }, [{
    kind: "concept",
    id: "oversized-evidence",
    label: "bounded",
    status: "accepted",
    evidence: [{ text: "x".repeat(12001), sources: [] }]
  }]),
  /example 0\.evidence exceeds the bounded evidence contract/,
  "evaluation should reject oversized reviewed evidence before matching"
);
assert.throws(
  () => evaluateExtraction(
    { nodes: Array.from({ length: 1500 }, (_, index) => ({ id: `candidate-${index}`, label: `Candidate ${index}` })), edges: [] },
    Array.from({ length: 1500 }, (_, index) => ({ kind: "concept", id: `example-${index}`, label: `Example ${index}`, status: "accepted" }))
  ),
  /comparison safety limit/,
  "evaluation matching should fail closed before an adversarial pairwise matrix becomes unbounded"
);
const boundedEvaluationAliases = new Array(21).fill("alias");
Object.defineProperty(boundedEvaluationAliases, 20, { get() { throw new Error("evaluation alias beyond the bound was read"); } });
assert.throws(() => evaluateExtraction(
  { source: { title: "Bounded evaluation", text: "Attention uses context to create a useful graph representation for review." }, nodes: [{ id: "attention", label: "Attention" }] },
  [{ kind: "concept", id: "attention", label: "Attention", aliases: boundedEvaluationAliases, status: "accepted" }]
), /aliases exceeds the bounded unique alias contract/, "evaluation should reject aliases beyond the graph contract before matching");
assert.throws(() => evaluateExtraction(
  { nodes: [], edges: [] },
  [{ kind: "concept", id: "duplicate-aliases", label: "Bounded", aliases: ["same", "same"], status: "accepted" }]
), /aliases exceeds the bounded unique alias contract/, "evaluation should reject duplicate reviewed aliases instead of silently canonicalizing them");
const largeEvaluation = evaluateExtraction(
  { nodes: [], edges: [] },
  Array.from({ length: 501 }, (_, index) => ({ kind: "concept", id: `evaluation-${index}`, label: `Evaluation ${index}`, status: "accepted" }))
);
assert.equal(largeEvaluation.feedback.examples, 501, "offline evaluation should not use the smaller remote-feedback budget");

const ambiguous = evaluateExtraction(
  { nodes: [{ id: "shared", label: "Shared" }], edges: [] },
  [
    { kind: "concept", id: "first", label: "Shared", status: "accepted" },
    { kind: "concept", id: "second", label: "Shared", status: "accepted" }
  ]
);
assert.equal(ambiguous.feedback.concepts.accepted.found, 1, "one prediction must not satisfy two reviewed concepts");
assert.equal(ambiguous.feedback.concepts.accepted.missed, 1);
const overlappingAliasMatches = evaluateExtraction(
  {
    nodes: [
      { id: "specific", label: "Specific", aliases: ["Shared"] },
      { id: "shared", label: "Shared" }
    ],
    edges: []
  },
  [
    { kind: "concept", id: "generic", label: "Shared", status: "accepted" },
    { kind: "concept", id: "specific", label: "Specific", status: "accepted" }
  ]
);
assert.equal(overlappingAliasMatches.feedback.concepts.accepted.found, 2, "evaluation should match constrained reviewed concepts before overlapping alias matches");
const maximumAliasMatches = evaluateExtraction(
  {
    nodes: [
      { id: "first", label: "First", aliases: ["a", "b"] },
      { id: "second", label: "Second", aliases: ["a"] },
      { id: "third", label: "Third", aliases: ["b", "c"] }
    ],
    edges: []
  },
  [
    { kind: "concept", id: "a-example", label: "a", status: "accepted" },
    { kind: "concept", id: "b-example", label: "b", status: "accepted" },
    { kind: "concept", id: "c-example", label: "c", status: "accepted" }
  ]
);
assert.equal(maximumAliasMatches.feedback.concepts.accepted.found, 3, "evaluation should find a maximum one-to-one assignment across overlapping aliases");
const conflicting = evaluateExtraction({ nodes: [{ id: "attention", label: "Attention" }], edges: [] }, [
  { kind: "concept", id: "attention", label: "Attention", status: "accepted" },
  { kind: "concept", id: "attention", label: "Attention", status: "rejected" }
]);
assert.equal(conflicting.feedback.conflicts, 1, "evaluation should disclose contradictory reviewed decisions");
const conflictingPortableRelation = evaluateExtraction({
  nodes: [{ id: "attention", label: "Attention" }, { id: "context", label: "Context" }],
  edges: [{ id: "local-edge", source: "attention", target: "context", label: "uses" }]
}, [
  { kind: "relation", id: "workspace-a-edge", source: "workspace-a-attention", sourceLabel: "Attention", target: "workspace-a-context", targetLabel: "Context", label: "uses", status: "accepted" },
  { kind: "relation", id: "workspace-b-edge", source: "workspace-b-context", sourceLabel: "Context", target: "workspace-b-attention", targetLabel: "Attention", label: "uses", status: "rejected" }
]);
assert.equal(conflictingPortableRelation.feedback.conflicts, 1, "evaluation should detect portable relation conflicts across workspace IDs and endpoint order");
const freshnessReport = evaluateExtraction({ nodes: [], edges: [] }, [
  { kind: "concept", id: "fresh", label: "Fresh", status: "accepted", lastReviewedAt: new Date().toISOString() },
  { kind: "concept", id: "stale", label: "Stale", status: "accepted", lastReviewedAt: "2020-01-01T00:00:00.000Z" },
  { kind: "concept", id: "undated", label: "Undated", status: "accepted" }
]);
assert.equal(freshnessReport.feedback.freshExamples, 1);
assert.equal(freshnessReport.feedback.staleExamples, 1);
assert.equal(freshnessReport.feedback.undatedExamples, 1);
assert.equal(freshnessReport.feedback.untrustedExamples, 2);
const futureDatedReport = evaluateExtraction({ nodes: [], edges: [] }, [
  { kind: "concept", id: "future", label: "Future", status: "accepted", lastReviewedAt: "2099-01-01T00:00:00.000Z" }
]);
assert.equal(futureDatedReport.feedback.freshExamples, 0, "future-dated reviews must not be treated as trusted freshness");
assert.equal(futureDatedReport.feedback.undatedExamples, 1, "future-dated reviews should fall into the conservative untrusted bucket");
assert.equal(futureDatedReport.feedback.untrustedExamples, 1);

const temporaryDirectory = await mkdtemp(join("/tmp", "llm-field-notes-evaluation-"));
try {
  const feedbackPath = join(temporaryDirectory, "feedback.json");
  const extractionPath = join(temporaryDirectory, "extraction.json");
  await writeFile(feedbackPath, JSON.stringify({
    format: "llm-field-notes/feedback@1",
    datasetFingerprint: fingerprintFeedbackExamples([{ kind: "concept", id: "attention", label: "Attention", status: "accepted" }]),
    examples: [{ kind: "concept", id: "attention", label: "Attention", status: "accepted" }]
  }));
  await writeFile(extractionPath, JSON.stringify(extraction));
  const { stdout } = await execFileAsync(process.execPath, [
    "experiments/evaluate-feedback.mjs",
    feedbackPath,
    extractionPath
  ], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8" });
  const cliReport = JSON.parse(stdout);
  assert.equal(cliReport.schema, EVALUATION_SCHEMA);
  assert.equal(cliReport.feedback.examples, 1);
  assert.equal(cliReport.feedback.undatedExamples, 1);
  assert.equal(cliReport.feedback.untrustedExamples, 1);
  assert.equal(cliReport.feedback.datasetFingerprint, fingerprintFeedbackExamples([{ kind: "concept", id: "attention", label: "Attention", status: "accepted" }]));
  assert.equal(JSON.parse(await readFile(extractionPath, "utf8")).nodes.length, 3);
  const legacyFeedbackPath = join(temporaryDirectory, "legacy-feedback.json");
  await writeFile(legacyFeedbackPath, JSON.stringify({
    format: "llm-field-notes/feedback@1",
    datasetFingerprint: "fnv1a-7ebe5ec3",
    examples: [{ kind: "concept", id: "attention", label: "Attention", status: "accepted" }]
  }));
  const legacyOutput = await execFileAsync(process.execPath, [
    "experiments/evaluate-feedback.mjs",
    legacyFeedbackPath,
    extractionPath
  ], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8" });
  assert.equal(JSON.parse(legacyOutput.stdout).feedback.examples, 1, "legacy feedback without a fingerprint should remain evaluable");
  const gateError = await execFileAsync(process.execPath, [
    "experiments/evaluate-feedback.mjs",
    feedbackPath,
    extractionPath,
    "--max-untrusted-feedback",
    "0"
  ], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8"
  }).then(() => null, (error) => error);
  assert(gateError, "the untrusted-feedback gate should fail when undated examples exceed the threshold");
  assert.match(`${gateError.stderr || ""}${gateError.message || ""}`, /untrusted feedback examples 1 exceed 0/);
  const invalidGateError = await execFileAsync(process.execPath, [
    "experiments/evaluate-feedback.mjs",
    feedbackPath,
    extractionPath,
    "--max-untrusted-feedback",
    String(MAX_EVALUATION_EXAMPLES + 1)
  ], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8"
  }).then(() => null, (error) => error);
  assert(invalidGateError, "the untrusted-feedback gate should reject thresholds above the report bound");
  assert.match(`${invalidGateError.stderr || ""}${invalidGateError.message || ""}`, /must be an integer/);
  const incompatibleFeedbackPath = join(temporaryDirectory, "incompatible-feedback.json");
  await writeFile(incompatibleFeedbackPath, JSON.stringify({ format: "llm-field-notes/feedback@999", examples: [] }));
  const incompatibleFeedbackError = await execFileAsync(process.execPath, [
    "experiments/evaluate-feedback.mjs",
    incompatibleFeedbackPath,
    extractionPath
  ], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8" }).then(() => null, (error) => error);
  assert(incompatibleFeedbackError, "incompatible feedback metadata should fail evaluation");
  assert.match(`${incompatibleFeedbackError.stderr || ""}${incompatibleFeedbackError.message || ""}`, /incompatible feedback format/);
  const oversizedPath = join(temporaryDirectory, "oversized.json");
  await writeFile(oversizedPath, "");
  await truncate(oversizedPath, 10 * 1024 * 1024 + 1);
  const oversizedError = await execFileAsync(process.execPath, ["experiments/evaluate-feedback.mjs", oversizedPath, extractionPath], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8"
  }).then(() => null, (error) => error);
  assert(oversizedError, "oversized evaluation inputs should fail");
  assert.match(`${oversizedError.stderr || ""}${oversizedError.message || ""}`, /safety limit/);
  const mismatchedFeedbackPath = join(temporaryDirectory, "mismatched-feedback.json");
  await writeFile(mismatchedFeedbackPath, JSON.stringify({
    format: "llm-field-notes/feedback@1",
    datasetFingerprint: "fnv1a-deadbeef",
    examples: [{ kind: "concept", id: "different", label: "Different", status: "accepted" }]
  }));
  const mismatchedFeedbackError = await execFileAsync(process.execPath, [
    "experiments/evaluate-feedback.mjs",
    mismatchedFeedbackPath,
    extractionPath
  ], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8"
  }).then(() => null, (error) => error);
  assert(mismatchedFeedbackError, "mismatched feedback fingerprints should fail evaluation");
  assert.match(`${mismatchedFeedbackError.stderr || ""}${mismatchedFeedbackError.message || ""}`, /dataset fingerprint does not match/);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("evaluation smoke ok");
