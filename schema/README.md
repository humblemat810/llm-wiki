# Graph contract

`graph.schema.json` is the portable contract for `llm-field-notes/graph@1`.

`backup.schema.json` and `feedback.schema.json` are companion contracts. The
backup schema uses a file-relative identifier and resolves the graph contract
through the same-directory `graph.schema.json` reference, so bundled offline
validators do not need network access.
New backups carry a deterministic `graphFingerprint`; older backups without it
remain readable through the browser compatibility path.

`diff.schema.json` describes the compact revision-diff export. It reports
stable identity additions, removals, and metadata changes without copying
source text or evidence. It also carries bounded provenance-ambiguity and
contradictory-review identity changes. Source records may retain bounded
canonical URIs for traceability.

`extractor-request.schema.json` describes the optional model-extraction HTTP
request envelope.

`evaluation.schema.json` describes bounded extractor metrics, including the
reviewed-dataset fingerprint and fresh/stale/undated feedback counts.
`evaluation-comparison.schema.json` describes the promotion-gate result and
refuses incomparable evaluation datasets. The evaluation CLI can additionally
gate production promotion with `--max-untrusted-feedback`.

New feedback exports carry a deterministic dataset fingerprint. The field is
optional in the `feedback@1` schema so older reviewed datasets remain
importable; new exports use a dual-lane 64-bit digest, while the browser and
CLI continue to verify legacy 32-bit fingerprints whenever they are present.
When the bounded browser export window cannot include every reviewed item,
`truncatedExamples` reports the omitted count; importing that partial dataset
requires explicit confirmation in the workbench.

`health.schema.json` describes the privacy-safe graph health report. New
reports carry a deterministic fingerprint of the normalized graph plus bounded
diagnostic counts and percentages, never source text or evidence. Health
reports include stale reusable-learning counts and bounded-import truncation
counts, and automation can gate them with `--max-stale-learning-examples`,
`--max-withheld-guidance`, `--max-unanchored-evidence`,
`--max-review-queue-truncated`, `--max-evidence-grounding-truncated`,
`--max-feedback-context-truncated`, `--max-truncated-items`, and
`--max-dropped-items`. Evidence grounding counts only exact, normalized
quotes found in their referenced source text; paraphrased evidence is retained
but disclosed as unanchored rather than silently treated as a verified quote.
Grounding work is bounded to deterministic evidence-record, source-comparison,
and aggregate source-scan budgets; a truncated diagnostic is explicitly marked
as sampled.
They also report how many extractor-guidance identities are withheld pending
review. The CLI rejects threshold values above the corresponding schema maxima.
The fingerprint remains
optional for
backward compatibility with earlier `health@1` reports. New reports also carry
a bounded `appVersion` so operators can identify the producing build, plus
a bounded `reviewQueue` containing stable IDs, labels, priorities, and reasons.
Concept/relation candidates may include an `unanchoredEvidence` count, but the
queue still excludes source text, evidence text, and source URIs.
The `reviewQueueTruncated` health flag discloses when the bounded queue omits
lower-priority candidates.
Browser and CLI reports use the same `buildHealthReport()` domain helper; the
CLI adds its optional quality gate without changing the shared envelope. Both
the builder and CLI validate bounded counts, derived relationships, and review
queue metadata before reports leave the domain layer.
All runtime health-count limits are exported from `graph-core.js` and checked
against the corresponding schema maxima, including graph cardinality,
provenance, review, learning, ambiguity, contradiction, and truncation
diagnostics. Health percentage and boolean fields are exported and checked in
the same way, so runtime type validation and the published health contract
cannot drift independently.
The emitted source-quality distribution is also a closed, bounded object; all
other emitted health counters are included in the same runtime/schema audit.
Runtime validation additionally checks derived relationships between health
fields, including graph partition counts, support totals, source-quality
totals, feedback retention, and evidence-grounding subtotals.
Source-reference diagnostic maxima account for both direct item references and
references nested in every retained evidence record, so large valid graphs do
not fail health validation merely because their provenance is richly grounded.

`vault-manifest.schema.json` describes the identity envelope included in
Obsidian vault exports. It binds the projection to a graph version and
deterministic fingerprint while preserving whether the vault is redacted.

`jsonld.schema.json` describes the versioned semantic-web projection emitted
by the browser and `project-jsonld.mjs`. It retains the graph fingerprint,
redaction marker, source fingerprints, and review metadata so downstream
consumers can validate the projection boundary without losing the learning
audit trail. Its graph-member definitions distinguish source, concept, and
relation records and bound their evidence, provenance, confidence, and review
fields. Escaped member identifiers and provenance references are bounded at
2,000 characters so Unicode graph IDs remain valid after JSON-LD-safe encoding.
Relations use explicit `lfn:sources` references because their `source` and
`target` properties are reserved for relation endpoints.
The JSON-LD root also carries bounded graph-integrity diagnostics for
truncation, dropped entries, ambiguity, and contradictory review identities.
Source and concept members also retain their creation/update timestamps so
external projections can reconstruct review chronology.
The root also reports graph update/revision counts, and bounded
`lfn:LearningExample` members preserve reusable accepted/rejected decisions so
the self-improvement loop remains inspectable outside the browser.

The browser normalizer is intentionally more forgiving than the schema: it
accepts legacy fields, repairs missing metadata, and records migrations. New
extractors and external projections should emit the schema shape directly.
Direct graph JSON exports may include an optional `graphFingerprint`; consumers
should verify it against the normalized graph when present, while accepting
older graph files that do not carry the field.

When a graph import exceeds a bounded collection, the normalizer retains the
partial graph but records the omitted counts in `integrity.truncated`; health
projections repeat those counts so operators can restore the original export
before editing.
The same diagnostic also records how many document-text and evidence-text
records were clipped to the normalized size limits, plus evidence records and
provenance references omitted by nested safety limits, so content loss cannot
hide behind an otherwise complete collection count.
If duplicate concept or relation records disagree on review status, their
canonical IDs are retained in bounded conflict diagnostics and repeated in
health output for manual inspection.

The contract is deliberately forward-compatible (`additionalProperties` is
allowed). Consumers should ignore fields they do not understand and preserve
fields when round-tripping data.
Graph items retain at most eight evidence records. The normalizer reports
additional imported evidence records through `integrity.truncated.evidenceItems`
and corresponding health diagnostics.
