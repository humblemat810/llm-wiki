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
node experiments/inspect-graph.mjs graph.json --min-provenance 95 --max-orphaned 0 --max-review-candidates 25
node experiments/diff-graphs.mjs before.json after.json
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
relation recall plus suppression of rejected examples, making extractor
changes measurable without a vendor or evaluation dependency. It rejects input
files larger than 10 MB before parsing them.

`compare-evaluations.mjs` is a promotion gate for that loop. Evaluation reports
carry a deterministic reviewed-dataset fingerprint; the command refuses to
compare reports with different fingerprints. It compares the overall, concept,
and relation accepted-recall and rejected-suppression metrics and exits
non-zero when any candidate metric regresses. Use
`--max-regression 0.02` when a small, explicit tradeoff is acceptable. The
comparison output is versioned and bounded so it can be retained in CI
artifacts.

`inspect-graph.mjs` emits the same privacy-safe health contract as the browser
and can fail CI when provenance, integrity, or actionable-review thresholds are
missed. The thresholds are optional; without them it is a diagnostic report
only.

`diff-graphs.mjs` compares two graph exports or full backups and emits the same
bounded revision-diff contract used by the browser, including learning-memory
and integrity changes. It rejects incompatible graph/backup schemas and input
files larger than 10 MB; fingerprinted backups are verified before comparison.

`inspect-graph.mjs` applies the same backup-fingerprint verification before
emitting health diagnostics or evaluating quality thresholds.
