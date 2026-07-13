import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateExtraction, EVALUATION_SCHEMA, MAX_EVALUATION_EXAMPLES } from "../evaluation.js";
import { fingerprintFeedbackExamples } from "../graph-core.js";

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
assert.match(report.feedback.datasetFingerprint, /^fnv1a-[0-9a-f]{8}$/);
assert.equal(report.extraction.concepts, 3);
assert.equal(report.extraction.relations, 1);
assert.equal(report.feedback.conflicts, 0);
assert.equal(report.feedback.concepts.accepted.found, 1);
assert.equal(report.feedback.concepts.accepted.missed, 1);
assert.equal(report.feedback.concepts.rejected.present, 1);
assert.equal(report.feedback.concepts.rejected.suppressionRate, 0);
assert.equal(report.feedback.relations.accepted.found, 1);
assert.equal(report.feedback.relations.rejected.suppressed, 1);
assert.equal(report.overall.accepted.recall, .6667);
assert.equal(report.overall.rejected.suppressionRate, .5);

const empty = evaluateExtraction({ nodes: [], edges: [] }, []);
assert.equal(empty.overall.accepted.recall, 1);
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
const conflicting = evaluateExtraction({ nodes: [{ id: "attention", label: "Attention" }], edges: [] }, [
  { kind: "concept", id: "attention", label: "Attention", status: "accepted" },
  { kind: "concept", id: "attention", label: "Attention", status: "rejected" }
]);
assert.equal(conflicting.feedback.conflicts, 1, "evaluation should disclose contradictory reviewed decisions");

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
  assert.equal(cliReport.feedback.datasetFingerprint, fingerprintFeedbackExamples([{ kind: "concept", id: "attention", label: "Attention", status: "accepted" }]));
  assert.equal(JSON.parse(await readFile(extractionPath, "utf8")).nodes.length, 3);
  const legacyFeedbackPath = join(temporaryDirectory, "legacy-feedback.json");
  await writeFile(legacyFeedbackPath, JSON.stringify({
    format: "llm-field-notes/feedback@1",
    examples: [{ kind: "concept", id: "attention", label: "Attention", status: "accepted" }]
  }));
  const legacyOutput = await execFileAsync(process.execPath, [
    "experiments/evaluate-feedback.mjs",
    legacyFeedbackPath,
    extractionPath
  ], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8" });
  assert.equal(JSON.parse(legacyOutput.stdout).feedback.examples, 1, "legacy feedback without a fingerprint should remain evaluable");
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
