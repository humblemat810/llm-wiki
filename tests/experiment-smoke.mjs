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
  const fingerprintedGraphPath = join(diffRoot, "fingerprinted-graph.json");
  await writeFile(fingerprintedGraphPath, JSON.stringify({
    ...JSON.parse(await readFile(afterPath, "utf8")),
    graphFingerprint: "fnv64-0000000000000000-1"
  }));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/diff-graphs.mjs", fingerprintedGraphPath, afterPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("Graph input fingerprint does not match"),
    "graph diff should reject tampered direct graph exports"
  );
  const legacyGraphPath = join(diffRoot, "legacy-graph.json");
  await writeFile(legacyGraphPath, JSON.stringify({
    ...JSON.parse(await readFile(afterPath, "utf8")),
    schema: "llm-field-notes/graph@0"
  }));
  const legacyDiffOutput = execFileSync(process.execPath, ["experiments/diff-graphs.mjs", legacyGraphPath, afterPath], { encoding: "utf8" });
  assert.equal(JSON.parse(legacyDiffOutput).format, "llm-field-notes/diff@1", "graph diff should accept supported legacy graph exports");
  const baselineEvaluationPath = join(diffRoot, "baseline-evaluation.json");
  const candidateEvaluationPath = join(diffRoot, "candidate-evaluation.json");
  const evaluation = (acceptedRecall, suppressionRate) => ({
    schema: "llm-field-notes/evaluation@1",
    graphSchema: "llm-field-notes/graph@1",
    evaluatedAt: "2026-07-13T00:00:00.000Z",
    feedback: {
      examples: 4,
      datasetFingerprint: "fnv1a-deadbeef",
      freshExamples: 4,
      staleExamples: 0,
      undatedExamples: 0,
      untrustedExamples: 0,
      conflicts: 0,
      concepts: {
        accepted: { recall: acceptedRecall, reviewedPrecision: acceptedRecall, evidenceCoverage: acceptedRecall },
        rejected: { suppressionRate }
      },
      relations: {
        accepted: { recall: acceptedRecall, reviewedPrecision: acceptedRecall, evidenceCoverage: acceptedRecall },
        rejected: { suppressionRate }
      }
    },
    overall: {
      accepted: { recall: acceptedRecall, reviewedPrecision: acceptedRecall, evidenceCoverage: acceptedRecall },
      rejected: { suppressionRate }
    }
  });
  await writeFile(baselineEvaluationPath, JSON.stringify(evaluation(.75, .8)));
  await writeFile(candidateEvaluationPath, JSON.stringify(evaluation(.9, .95)));
  const comparisonOutput = execFileSync(process.execPath, ["experiments/compare-evaluations.mjs", baselineEvaluationPath, candidateEvaluationPath], { encoding: "utf8" });
  const comparison = JSON.parse(comparisonOutput);
  assert.equal(comparison.format, "llm-field-notes/evaluation-comparison@1");
  assert.equal(comparison.passed, true, "an improving evaluation should pass the promotion gate");
  assert(comparison.metrics.some((metric) => metric.name === "overall.accepted.evidenceCoverage"), "promotion comparisons should include evidence coverage when both reports provide it");
  assert(comparison.metrics.some((metric) => metric.name === "overall.accepted.reviewedPrecision"), "promotion comparisons should include reviewed precision when both reports provide it");
  assert.equal(comparison.regressions.length, 0);
  assert.equal(comparison.baseline.datasetFingerprint, "fnv1a-deadbeef");
  await writeFile(candidateEvaluationPath, JSON.stringify({
    ...evaluation(.9, .95),
    feedback: { ...evaluation(.9, .95).feedback, conflicts: 1 }
  }));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/compare-evaluations.mjs", baselineEvaluationPath, candidateEvaluationPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("contradictory reviewed decisions"),
    "the promotion gate should reject contradictory reviewed datasets"
  );
  await writeFile(candidateEvaluationPath, JSON.stringify({
    ...evaluation(.9, .95),
    feedback: { ...evaluation(.9, .95).feedback, examples: 0 }
  }));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/compare-evaluations.mjs", baselineEvaluationPath, candidateEvaluationPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("at least one reviewed example"),
    "the promotion gate should reject empty reviewed benchmarks"
  );
  await writeFile(candidateEvaluationPath, JSON.stringify(evaluation(.74, .8)));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/compare-evaluations.mjs", baselineEvaluationPath, candidateEvaluationPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("overall.accepted.recall"),
    "a candidate regression should fail the promotion gate"
  );
  const toleratedOutput = execFileSync(process.execPath, ["experiments/compare-evaluations.mjs", baselineEvaluationPath, candidateEvaluationPath, "--max-regression", "0.02"], { encoding: "utf8" });
  assert.equal(JSON.parse(toleratedOutput).passed, true, "an explicitly tolerated regression should pass");
  await writeFile(candidateEvaluationPath, JSON.stringify(evaluation(.9, .95)));
  const freshnessOutput = execFileSync(process.execPath, [
    "experiments/compare-evaluations.mjs",
    baselineEvaluationPath,
    candidateEvaluationPath,
    "--max-untrusted-feedback",
    "0"
  ], { encoding: "utf8" });
  const freshnessComparison = JSON.parse(freshnessOutput);
  assert.equal(freshnessComparison.passed, true, "fresh evaluation reports should pass the untrusted-feedback promotion gate");
  assert.deepEqual(freshnessComparison.feedbackTrust, {
    maxUntrustedFeedback: 0,
    baselineUntrustedExamples: 0,
    candidateUntrustedExamples: 0
  }, "promotion artifacts should record the freshness gate and evaluated counts");
  await writeFile(candidateEvaluationPath, JSON.stringify({
    ...evaluation(.9, .95),
    feedback: { ...evaluation(.9, .95).feedback, freshExamples: 3, staleExamples: 1, untrustedExamples: 1 }
  }));
  assert.throws(
    () => execFileSync(process.execPath, [
      "experiments/compare-evaluations.mjs",
      baselineEvaluationPath,
      candidateEvaluationPath,
      "--max-untrusted-feedback",
      "0"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("untrusted feedback examples 1 exceed 0"),
    "the promotion gate should reject stale or undated feedback when requested"
  );
  await writeFile(candidateEvaluationPath, JSON.stringify({
    ...evaluation(.9, .95),
    feedback: Object.fromEntries(Object.entries(evaluation(.9, .95).feedback)
      .filter(([key]) => !["freshExamples", "staleExamples", "undatedExamples", "untrustedExamples"].includes(key)))
  }));
  assert.throws(
    () => execFileSync(process.execPath, [
      "experiments/compare-evaluations.mjs",
      baselineEvaluationPath,
      candidateEvaluationPath,
      "--max-untrusted-feedback",
      "0"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("must include freshness diagnostics"),
    "the promotion gate should fail closed on legacy reports when freshness is required"
  );
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
    nodes: [{ id: "health-node", label: "Health node", status: "accepted", lastReviewedAt: "2020-01-01T00:00:00.000Z", sources: ["missing-source"], evidence: [] }],
    learning: { examples: [{ kind: "concept", id: "old-learning", label: "Old learning", status: "accepted", lastReviewedAt: "2020-01-01T00:00:00.000Z" }] },
    integrity: { truncated: { documents: 2 }, dropped: { nodes: 1 } }
  }));
  const healthOutput = execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath], { encoding: "utf8" });
  const health = JSON.parse(healthOutput);
  assert.equal(health.format, "llm-field-notes/health@1");
  assert.equal(health.appVersion, "0.1.0", "health diagnostics should identify the producing application version");
  assert.match(health.graphFingerprint, /^fnv64-[0-9a-f]{16}-\d+$/, "health reports should identify the exact normalized graph inspected");
  assert.equal(health.gate.passed, true, "health diagnostics without thresholds should pass");
  assert.equal(health.health.staleLearningExamples, 1, "health diagnostics should report stale reusable learning examples");
  assert.equal(health.health.feedbackContextExcluded, 2, "health diagnostics should report guidance withheld pending review");
  assert.equal(health.health.truncatedItems, 2, "health diagnostics should report omitted import items");
  assert.equal(health.health.droppedItems, 1, "health diagnostics should report dropped malformed import items");
  assert(Array.isArray(health.reviewQueue), "health diagnostics should export the bounded review queue");
  assert(health.reviewQueue.every((candidate) => candidate.id && candidate.reason && !("sourceText" in candidate) && !("uri" in candidate)), "health review queue should exclude source material");
  const legacyHealthPath = join(diffRoot, "legacy-health-graph.json");
  await writeFile(legacyHealthPath, JSON.stringify({
    ...JSON.parse(await readFile(healthPath, "utf8")),
    schema: "llm-field-notes/graph@0"
  }));
  const legacyHealthOutput = execFileSync(process.execPath, ["experiments/inspect-graph.mjs", legacyHealthPath], { encoding: "utf8" });
  assert.equal(JSON.parse(legacyHealthOutput).format, "llm-field-notes/health@1", "health inspection should accept supported legacy graph exports");
  const jsonLdOutput = execFileSync(process.execPath, ["experiments/project-jsonld.mjs", healthPath], { encoding: "utf8" });
  const jsonLd = JSON.parse(jsonLdOutput);
  assert.equal(jsonLd["@type"], "schema:Dataset", "JSON-LD CLI should emit the shared dataset projection");
  assert.equal(jsonLd.format, "llm-field-notes/jsonld@1");
  assert.equal(jsonLd.redacted, false);
  const jsonLdPath = join(diffRoot, "health-graph.jsonld");
  await writeFile(jsonLdPath, jsonLdOutput);
  const verificationOutput = execFileSync(process.execPath, ["experiments/verify-jsonld.mjs", healthPath, jsonLdPath], { encoding: "utf8" });
  assert.equal(JSON.parse(verificationOutput).verified, true, "JSON-LD verification CLI should accept a matching projection");
  const semanticallyTamperedJsonLdPath = join(diffRoot, "tampered-health-graph.jsonld");
  await writeFile(semanticallyTamperedJsonLdPath, JSON.stringify({ ...jsonLd, name: "Tampered dataset" }));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/verify-jsonld.mjs", healthPath, semanticallyTamperedJsonLdPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("does not match the normalized graph"),
    "JSON-LD verification CLI should reject semantic projection tampering"
  );
  const redactedJsonLdOutput = execFileSync(process.execPath, ["experiments/project-jsonld.mjs", healthPath, "--redacted"], { encoding: "utf8" });
  const redactedJsonLd = JSON.parse(redactedJsonLdOutput);
  assert.equal(redactedJsonLd.redacted, true, "JSON-LD CLI should support redacted projections");
  assert(redactedJsonLd["@graph"].filter((item) => item["@type"] === "schema:CreativeWork").every((item) => !Object.hasOwn(item, "text")), "redacted JSON-LD CLI output should remove source text");
  const tamperedHealthPath = join(diffRoot, "tampered-health-graph.json");
  await writeFile(tamperedHealthPath, JSON.stringify({
    ...JSON.parse(await readFile(healthPath, "utf8")),
    graphFingerprint: "fnv64-0000000000000000-1"
  }));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", tamperedHealthPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("Graph input fingerprint does not match"),
    "graph health should reject tampered direct graph exports"
  );
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/project-jsonld.mjs", tamperedHealthPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("Graph input fingerprint does not match"),
    "JSON-LD projection should reject tampered direct graph exports"
  );
  const feedbackInputPath = join(diffRoot, "feedback.json");
  await writeFile(feedbackInputPath, JSON.stringify({
    format: "llm-field-notes/feedback@1",
    examples: [{ kind: "concept", id: "attention", label: "Attention", status: "accepted" }]
  }));
  const tamperedExtractionPath = join(diffRoot, "tampered-extraction.json");
  await writeFile(tamperedExtractionPath, JSON.stringify({
    ...JSON.parse(await readFile(afterPath, "utf8")),
    graphFingerprint: "fnv64-0000000000000000-1"
  }));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/evaluate-feedback.mjs", feedbackInputPath, tamperedExtractionPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("Extraction graph fingerprint does not match"),
    "evaluation should reject tampered direct graph exports"
  );
  const wrappedTamperedExtractionPath = join(diffRoot, "wrapped-tampered-extraction.json");
  await writeFile(wrappedTamperedExtractionPath, JSON.stringify({
    schema: "llm-field-notes/graph@1",
    extraction: JSON.parse(await readFile(tamperedExtractionPath, "utf8"))
  }));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/evaluate-feedback.mjs", feedbackInputPath, wrappedTamperedExtractionPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("Extraction graph fingerprint does not match"),
    "evaluation should reject tampered graph fingerprints inside response envelopes"
  );
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath, "--max-orphaned", "0"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("orphaned source references"),
    "health thresholds should fail when graph quality misses the requested gate"
  );
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath, "--max-unsupported-nodes", "0"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("unsupported concepts"),
    "health thresholds should fail when unsupported concepts exceed the requested gate"
  );
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath, "--min-fresh-source-review", "1"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("fresh source-review coverage"),
    "health thresholds should fail when fresh source-review coverage misses the requested gate"
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
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath, "--max-stale-learning-examples", "0"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("stale learning examples"),
    "health thresholds should fail when reusable learning memory is stale"
  );
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath, "--max-withheld-guidance", "0"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("withheld extractor guidance"),
    "health thresholds should fail when guidance is withheld pending review"
  );
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath, "--max-withheld-guidance", "15501"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("Invalid value for --max-withheld-guidance"),
    "health thresholds should reject values outside the published withheld-guidance bound"
  );
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath, "--max-truncated-items", "0"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("truncated import items"),
    "health thresholds should fail when a graph import was truncated"
  );
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", healthPath, "--max-dropped-items", "0"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("dropped malformed import items"),
    "health thresholds should fail when malformed graph entries were dropped"
  );
  assert.throws(
    () => execFileSync(process.execPath, [
      "experiments/inspect-graph.mjs",
      healthPath,
      "--min-provenance", "100",
      "--min-fresh-source-review", "100",
      "--max-orphaned", "0",
      "--max-ambiguous", "0",
      "--max-unsupported-nodes", "0",
      "--max-unsupported-edges", "0",
      "--max-review-candidates", "0",
      "--max-stale-review-candidates", "0",
      "--max-stale-learning-examples", "0",
      "--max-withheld-guidance", "0",
      "--max-truncated-items", "0",
      "--max-dropped-items", "0"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => {
      const report = JSON.parse(String(error?.stdout));
      return report.gate.violations.length <= 12 && report.gate.violations.length >= 1;
    },
    "health gates should keep simultaneous threshold violations within the schema bound"
  );
  const ambiguousHealthPath = join(diffRoot, "ambiguous-health-graph.json");
  await writeFile(ambiguousHealthPath, JSON.stringify({
    schema: "llm-field-notes/graph@1",
    nodes: [
      { id: "ambiguous-a", label: "Same concept" },
      { id: "ambiguous-b", label: "Same concept" }
    ]
  }));
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/inspect-graph.mjs", ambiguousHealthPath, "--max-ambiguous", "0"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stdout).includes('"passed": false') && String(error?.stdout).includes("ambiguous integrity and label diagnostics"),
    "health thresholds should include ambiguous canonical concept labels"
  );
} finally {
  await rm(diffRoot, { recursive: true, force: true });
}
console.log("experiment smoke ok");
