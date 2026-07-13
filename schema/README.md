# Graph contract

`graph.schema.json` is the portable contract for `llm-field-notes/graph@1`.

`backup.schema.json` and `feedback.schema.json` are companion contracts. The
backup schema resolves the graph contract through the same-directory
`graph.schema.json` reference so offline validators do not need network access.
New backups carry a deterministic `graphFingerprint`; older backups without it
remain readable through the browser compatibility path.

`diff.schema.json` describes the compact revision-diff export. It reports
stable identity additions, removals, and metadata changes without copying
source text or evidence. Source records may retain bounded canonical URIs for
traceability.

`extractor-request.schema.json` describes the optional model-extraction HTTP
request envelope.

`evaluation.schema.json` describes bounded extractor metrics, including the
reviewed-dataset fingerprint. `evaluation-comparison.schema.json` describes the
promotion-gate result and refuses incomparable evaluation datasets.

New feedback exports carry a deterministic dataset fingerprint. The field is
optional in the `feedback@1` schema so older reviewed datasets remain
importable; new exports use a dual-lane 64-bit digest, while the browser and
CLI continue to verify legacy 32-bit fingerprints whenever they are present.

`health.schema.json` describes the privacy-safe graph health report. New
reports carry a deterministic fingerprint of the normalized graph plus bounded
diagnostic counts and percentages, never source text or evidence. Health
reports include stale reusable-learning counts, and automation can gate them
with `--max-stale-learning-examples`. The fingerprint remains optional for
backward compatibility with earlier `health@1` reports.

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

The contract is deliberately forward-compatible (`additionalProperties` is
allowed). Consumers should ignore fields they do not understand and preserve
fields when round-tripping data.
