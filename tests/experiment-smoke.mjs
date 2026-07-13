import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultGraph } from "../graph-core.js";
import { scaledDotProductAttention, softmax } from "../experiments/tiny-attention.mjs";

const probabilities = softmax([1, 2, 3]);
assert(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
const result = scaledDotProductAttention(
  [[1, 0], [0, 1], [1, 1]],
  [[1, 0], [0, 1], [1, 1]],
  [[1, 2], [3, 4], [5, 6]],
  { causal: true }
);
assert.equal(result.length, 3);
result.forEach((row, index) => {
  assert(Math.abs(row.weightSum - 1) < 1e-9, "attention weights should normalize");
  assert(row.weights.slice(index + 1).every((weight) => weight === 0), "causal attention must not see future keys");
  assert(row.output.every(Number.isFinite), "attention outputs should be finite");
});
const cliOutput = execFileSync(process.execPath, ["experiments/tiny-attention.mjs"], { encoding: "utf8" });
assert(cliOutput.includes("row 0:"), "the attention experiment CLI should run successfully");
const diffRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-diff-"));
try {
  const beforePath = join(diffRoot, "before.json");
  const afterPath = join(diffRoot, "after.json");
  await writeFile(beforePath, JSON.stringify(defaultGraph()));
  await writeFile(afterPath, JSON.stringify({
    ...defaultGraph(),
    version: 1,
    nodes: [{ id: "attention", label: "Attention", aliases: [], type: "concept", confidence: .8, mentions: 1, feedback: 0, status: "inferred", sources: [], evidence: [] }]
  }));
  const diffOutput = execFileSync(process.execPath, ["experiments/diff-graphs.mjs", beforePath, afterPath], { encoding: "utf8" });
  const diff = JSON.parse(diffOutput);
  assert.equal(diff.format, "llm-field-notes/diff@1", "the graph diff CLI should emit the versioned diff contract");
  assert.equal(diff.nodes.added[0].id, "attention", "the graph diff CLI should report added concepts");
  const invalidPath = join(diffRoot, "invalid.json");
  await writeFile(invalidPath, JSON.stringify({ schema: "llm-field-notes/graph@999" }));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/diff-graphs.mjs", invalidPath, afterPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("must declare llm-field-notes/graph@1"),
    "the graph diff CLI should reject incompatible graph schemas"
  );
  const backupPath = join(diffRoot, "backup.json");
  await writeFile(backupPath, JSON.stringify({
    format: "llm-field-notes/backup@1",
    exportedAt: "2026-07-13T00:00:00.000Z",
    graph: JSON.parse(await readFile(afterPath, "utf8")),
    history: [],
    graphFingerprint: "fnv64-0000000000000000-1"
  }));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/diff-graphs.mjs", backupPath, afterPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("fingerprint does not match"),
    "graph diff should reject tampered backup envelopes"
  );
  const baselineEvaluationPath = join(diffRoot, "baseline-evaluation.json");
  const candidateEvaluationPath = join(diffRoot, "candidate-evaluation.json");
  const evaluation = (acceptedRecall, suppressionRate) => ({
    schema: "llm-field-notes/evaluation@1",
    graphSchema: "llm-field-notes/graph@1",
    evaluatedAt: "2026-07-13T00:00:00.000Z",
    feedback: {
      examples: 4,
      datasetFingerprint: "fnv1a-deadbeef",
      concepts: {
        accepted: { recall: acceptedRecall },
        rejected: { suppressionRate }
      },
      relations: {
        accepted: { recall: acceptedRecall },
        rejected: { suppressionRate }
      }
    },
    overall: {
      accepted: { recall: acceptedRecall },
      rejected: { suppressionRate }
    }
  });
  await writeFile(baselineEvaluationPath, JSON.stringify(evaluation(.75, .8)));
  await writeFile(candidateEvaluationPath, JSON.stringify(evaluation(.9, .95)));
  const comparisonOutput = execFileSync(process.execPath, ["experiments/compare-evaluations.mjs", baselineEvaluationPath, candidateEvaluationPath], { encoding: "utf8" });
  const comparison = JSON.parse(comparisonOutput);
  assert.equal(comparison.format, "llm-field-notes/evaluation-comparison@1");
  assert.equal(comparison.passed, true, "an improving evaluation should pass the promotion gate");
  assert.equal(comparison.regressions.length, 0);
  assert.equal(comparison.baseline.datasetFingerprint, "fnv1a-deadbeef");
  await writeFile(candidateEvaluationPath, JSON.stringify(evaluation(.74, .8)));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/compare-evaluations.mjs", baselineEvaluationPath, candidateEvaluationPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("overall.accepted.recall"),
    "a candidate regression should fail the promotion gate"
  );
  const toleratedOutput = execFileSync(process.execPath, ["experiments/compare-evaluations.mjs", baselineEvaluationPath, candidateEvaluationPath, "--max-regression", "0.02"], { encoding: "utf8" });
  assert.equal(JSON.parse(toleratedOutput).passed, true, "an explicitly tolerated regression should pass");
  await writeFile(candidateEvaluationPath, JSON.stringify({ ...evaluation(.9, .95), feedback: { ...evaluation(.9, .95).feedback, datasetFingerprint: "fnv1a-cafebabe" } }));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/compare-evaluations.mjs", baselineEvaluationPath, candidateEvaluationPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("different reviewed datasets"),
    "the promotion gate should reject reports from different reviewed datasets"
  );
  const healthPath = join(diffRoot, "health-graph.json");
  await writeFile(healthPath, JSON.stringify({
    schema: "llm-field-notes/graph@1",
    documents: [{ id: "health-source", title: "Health source", text: "health source text", fingerprint: "health-source" }],
    nodes: [{ id: "health-node", label: "Health node", status: "accepted", lastReviewedAt: "2020-01-01T00:00:00.000Z", sources: ["missing-source"], evidence: [] }]
  }));
  const healthOutput = execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath], { encoding: "utf8" });
  const health = JSON.parse(healthOutput);
  assert.equal(health.format, "llm-field-notes/health@1");
  assert.match(health.graphFingerprint, /^fnv64-[0-9a-f]{16}-\d+$/, "health reports should identify the exact normalized graph inspected");
  assert.equal(health.gate.passed, true, "health diagnostics without thresholds should pass");
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath, "--max-orphaned", "0"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("orphaned source references"),
    "health thresholds should fail when graph quality misses the requested gate"
  );
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath, "--max-review-candidates", "0"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("review candidates"),
    "health thresholds should fail when actionable review work exceeds the requested gate"
  );
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath, "--max-stale-review-candidates", "0"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("stale review candidates"),
    "health thresholds should fail when stale review debt exceeds the requested gate"
  );
} finally {
  await rm(diffRoot, { recursive: true, force: true });
}
console.log("experiment smoke ok");
