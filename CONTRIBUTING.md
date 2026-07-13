# Contributing to LLM Field Notes

The wiki gets better when people add the thing they wish they had found
earlier. A correction, a clearer diagram, a benchmark, a failed experiment,
and a well-contextualized source are all first-class contributions.

The central product is a document-to-graph loop. New extractors, graph schema
improvements, projection formats, and feedback mechanisms are just as welcome
as new learning notes.

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing a boundary; it explains
which module owns normalization, persistence, projections, and evaluation.

Keep pure graph behavior in `graph-core.js` and browser/storage behavior in
their respective modules. This makes extraction and persistence testable
without requiring a browser DOM.

External or model-backed extractors should pass their result through
`normalizeExtraction()` before merging. They may return labels, endpoint names,
and partial confidence/evidence; the normalizer supplies stable IDs, source
provenance, defaults, and schema-safe fields.

Persistence code should fail closed: malformed local state must remain
recoverable, and user-facing mutations must report storage failures instead of
claiming success.

## Graph contract

Keep the internal representation inspectable and portable:

- Nodes have a stable `id`, human-readable `label`, `aliases`, `type`, `confidence`,
  `mentions`, `status`, optional `lastReviewedAt`, source IDs, and evidence.
  Status is one of `inferred`, `accepted`, or `rejected`.
- Edges have stable endpoints, a relation label, confidence, feedback count,
  optional `lastReviewedAt`, source IDs, and evidence, plus the same
  `inferred`, `accepted`, or `rejected` status.
- Evidence is stored as `{ text, sources }` records. Legacy string evidence is
  normalized with the surrounding node or edge source IDs.
- A revision records what changed and why.
- A projection should be reproducible from the graph; do not make Obsidian or
  another viewer a second source of truth.
- Obsidian exports should preserve stable paths and links so a vault can be
  opened, edited, and compared across revisions.

If you replace the heuristic extractor with a model-backed one, preserve this
contract and make uncertainty visible.

## What makes a good note?

Every note should answer a real question and leave the reader with a handle:

```md
# [A clear title]

> The question this page answers in one sentence.

## The short version

## Build it

## What surprised me

## Failure modes

## Sources

## Try it yourself
```

Prefer a small runnable example over a large abstraction. Say what you
measured. Include version/date context when a detail can change. If you are
not sure, label the uncertainty.

## Small contributions are welcome

- Fix a confusing sentence or broken link.
- Add a counterexample or a “why this fails” section.
- Turn a concept into a five-minute experiment.
- Add a source with one paragraph explaining why it matters.
- Translate a note or improve its accessibility.

Open an issue or pull request with the smallest coherent change. The project
maintains a friendly bar: clarity, reproducibility, and intellectual honesty
matter more than polish.

Participation follows the project’s [Code of Conduct](CODE_OF_CONDUCT.md).
