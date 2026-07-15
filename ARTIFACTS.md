# Community artifacts

An artifact is a small, inspectable thing someone can run, fork, compare, or
learn from. The best submissions are narrow enough to understand in one
sitting and honest enough to show what failed.

## Start here

- [Tiny BPE tokenizer](experiments/tiny-bpe.mjs) — build a byte-pair tokenizer
  and inspect the vocabulary trade-offs.
- [Tiny attention experiment](experiments/tiny-attention.mjs) — make the
  weighted lookup behind attention concrete.
- [Tiny transformer](experiments/tiny-transformer.mjs) — connect tokens,
  positions, attention, and a next-token prediction loop.
- [Feedback evaluation](experiments/evaluate-feedback.mjs) — measure whether
  reviewed graph decisions improve a later extraction.
- [Learning loop](experiments/learning-loop.mjs) — compare unguided and guided
  follow-up extraction after human review in one deterministic walkthrough.
- [JSON-LD projection](experiments/project-jsonld.mjs) — turn the internal
  representation into a portable linked-data artifact.
- [Graph diff](experiments/diff-graphs.mjs) — inspect exactly how a revision
  changed the representation.
- [Diff verifier](experiments/verify-diff.mjs) — verify a diff against its
  before/after graph fingerprints.
- [Graph verifier](experiments/verify-graph.mjs) — verify a graph export or
  full backup before sharing or consuming it.
- [Sample graph export](examples/sample-graph.json) — start with a small,
  evidence-backed graph for health, diff, and projection tooling.

Run an experiment from the repository root with Node 18 or newer. The
experiments are intentionally dependency-free.

## Quality and tooling

- [Feedback promotion gate](experiments/compare-evaluations.mjs) — compare
  baseline and candidate evaluation reports before promoting a change.
- [Graph health inspector](experiments/inspect-graph.mjs) — turn provenance,
  review freshness, truncation, and grounding into automation gates.
- [Graph input boundary](experiments/graph-input.mjs) — reuse the bounded,
  fingerprint-verified graph reader in scripts and CI.
- [Bounded file reader](experiments/bounded-file.mjs) — inspect the shared
  fail-closed text and byte reader used at external file boundaries.
- [JSON-LD verifier](experiments/verify-jsonld.mjs) — verify a semantic-web
  projection against its source graph.
- [Tiny training loop](experiments/tiny-training.mjs) — watch a deterministic
  character-level model learn before reaching for a larger architecture.

## Submit one

Have a useful graph, experiment, benchmark, visualization, note, or failed
attempt? Follow the [artifact contribution guide](CONTRIBUTING.md#share-a-reusable-artifact).

Please include:

- the question or claim the artifact investigates;
- the smallest command or link needed to try it;
- what it demonstrates and what it does not demonstrate;
- measurements, limitations, and version/date context;
- links to the source note, graph export, or pull request.

Submissions are curated for clarity and reproducibility. A small, honest
artifact is more valuable than a large claim with no handle.
