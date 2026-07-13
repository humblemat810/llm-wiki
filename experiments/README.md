# Runnable experiments

These small Node programs have no dependencies and are intended to be read,
changed, and run:

```bash
node experiments/tiny-bpe.mjs
node experiments/tiny-attention.mjs
node experiments/tiny-training.mjs
node experiments/tiny-transformer.mjs
node experiments/evaluate-feedback.mjs feedback.json extraction.json
node experiments/compare-evaluations.mjs baseline-evaluation.json candidate-evaluation.json
node experiments/inspect-graph.mjs graph.json --min-provenance 95 --min-fresh-source-review 90 --max-orphaned 0 --max-ambiguous 0 --max-unsupported-nodes 0 --max-unsupported-edges 0 --max-review-candidates 25 --max-stale-review-candidates 10 --max-stale-learning-examples 25
node experiments/diff-graphs.mjs before.json after.json
node experiments/project-jsonld.mjs graph.json --redacted
node experiments/verify-jsonld.mjs graph.json graph.jsonld
```

The training artifact is a deterministic character-level bigram language
model. It performs real softmax cross-entropy updates, records loss, and
generates a greedy sample. It is intentionally small enough to modify in one
sitting before moving on to a transformer.

The transformer artifact is a deterministic one-block forward pass with
multi-head causal attention, residual connections, layer normalization, an
MLP, and logits. It is intentionally untrained: inspect the tensor flow
before adding optimization.

The smoke tests run the implemented artifacts as part of `npm test`.

`evaluate-feedback.mjs` compares an extraction or graph JSON file against a
feedback dataset exported by the workbench. It reports accepted-concept and
relation recall, reviewed-candidate precision, and suppression of rejected
examples, making extractor changes measurable without a vendor or evaluation
dependency. Reviewed precision covers only candidates matched to reviewed
examples; it is not a complete precision estimate when feedback is sparse. The
command rejects input files larger than 10 MB before parsing them.

`compare-evaluations.mjs` is a promotion gate for that loop. Evaluation reports
carry a deterministic reviewed-dataset fingerprint; the command refuses to
compare reports with different fingerprints, an empty reviewed benchmark, or
contradictory reviewed decisions. It compares the overall, concept,
and relation accepted-recall, reviewed-precision, and rejected-suppression
metrics and exits non-zero when any candidate metric regresses. Use
`--max-regression 0.02` when a small, explicit tradeoff is acceptable. The
comparison output is versioned and bounded so it can be retained in CI
artifacts.

`inspect-graph.mjs` emits the same privacy-safe health contract as the browser
and can fail CI when provenance, integrity, label-ambiguity, unsupported
knowledge, or actionable-review thresholds are missed. The thresholds are
optional; without them it is a diagnostic report only.

`diff-graphs.mjs` compares two graph exports or full backups and emits the same
bounded revision-diff contract used by the browser, including learning-memory
and integrity changes. It rejects incompatible graph/backup schemas and input
files larger than 10 MB; fingerprinted backups are verified before comparison.

`inspect-graph.mjs` applies the same backup-fingerprint verification before
emitting health diagnostics or evaluating quality thresholds.

`project-jsonld.mjs` emits the same full or redacted JSON-LD projection as the
browser. It verifies graph and backup fingerprints and rejects inputs larger
than 10 MB before parsing. The output declares the versioned
`llm-field-notes/jsonld@1` contract.

`verify-jsonld.mjs` verifies an existing JSON-LD artifact against a graph or
full backup, using the same deterministic projection code as the browser and
the exporter. It is suitable for CI or release-artifact checks and rejects
semantic, fingerprint, and redaction mismatches.
