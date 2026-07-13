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
importable; evaluators verify it whenever it is present.

`health.schema.json` describes the privacy-safe graph health report. New
reports carry a deterministic fingerprint of the normalized graph plus bounded
diagnostic counts and percentages, never source text or evidence. The
fingerprint remains optional for backward compatibility with earlier
`health@1` reports.

`vault-manifest.schema.json` describes the identity envelope included in
Obsidian vault exports. It binds the projection to a graph version and
deterministic fingerprint while preserving whether the vault is redacted.

The browser normalizer is intentionally more forgiving than the schema: it
accepts legacy fields, repairs missing metadata, and records migrations. New
extractors and external projections should emit the schema shape directly.

The contract is deliberately forward-compatible (`additionalProperties` is
allowed). Consumers should ignore fields they do not understand and preserve
fields when round-tripping data.
