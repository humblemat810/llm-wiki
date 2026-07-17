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
`normalizeExtraction()` before merging. HTTP adapters and the reference server
should use `normalizeExtractionForDocument()` when the submitted document's
title, text, URI, and provenance must remain authoritative. Extractors may
return labels, endpoint names, and partial confidence/evidence; the normalizer
supplies stable IDs, source provenance, defaults, and schema-safe fields.

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

Every pull request runs the dependency-free verification matrix across Node 22
and 24, plus the Node and Docker runtime smoke checks. Keep changes
bounded enough to complete within the repository’s 20-minute CI job limit.
The release check also rejects mutable GitHub Action references; CodeQL and
OpenSSF Scorecard run as separate repository-security workflows, so review
their findings before merging changes that affect runtime or deployment
boundaries.
The repository's `CODEOWNERS` file identifies the owner for workflow, runtime,
security, Docker, schema, and persistence-boundary changes. Enable branch
protection with required CODEOWNERS review when operating a production fork;
the file is a review signal, not a substitute for the protected-branch setting.

On pull requests opened from a public fork, CodeQL may report a non-fatal
`Resource not accessible by integration` message while collecting optional
workflow-run telemetry. That does not replace the scan result: confirm that
JavaScript analysis completed and distinguish a telemetry warning from a
failed scan or SARIF upload. Do not “fix” this by granting `write-all`
permissions or changing the workflow to `pull_request_target`.

For a new learning page, use the Learning note issue template first. It keeps
the question, build, failure modes, sources, and reproducible exercise visible
before prose or code is added.

## Correct a graph representation

If the workbench produces a missing concept, misleading relation, or
unsupported evidence, use the **Correct a graph representation** issue form.
The inspector's **report correction** link opens the same form without
serializing source text, evidence, URIs, or local graph state. Include the
smallest public source or redacted graph fragment that lets someone reproduce
the problem, then describe the proposed change and why it is better.

Do not post private documents, confidential evidence, credentials, or personal
data. A correction is most useful when it names the item, cites public
evidence, and distinguishes an observed fact from an interpretation. Recipient
share pages provide a **copy correction context** action that supplies the
sanitized share link and privacy-safe prompts; add public evidence manually
before submitting the issue.

## Share a reusable artifact

The fastest way to help a stranger is to leave them something they can run or
inspect. Browse the [community artifact index](ARTIFACTS.md), then use the
[artifact submission template](ARTIFACT_SUBMISSION.md) for a new experiment,
graph export, benchmark, visualization, learning note, or failed attempt. On
GitHub, the `Share an artifact` issue form pre-populates the same questions.

Keep the submission small and include the question, the exact way to try it,
the observed result, and the limitations. A result that disproves your first
idea is welcome; an unsupported claim is not.

Participation follows the project’s [Code of Conduct](CODE_OF_CONDUCT.md).
