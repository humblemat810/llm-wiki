# Graph contract

`graph.schema.json` is the portable contract for `llm-field-notes/graph@1`.

`backup.schema.json` and `feedback.schema.json` are companion contracts. The
backup schema resolves the graph contract through the same-directory
`graph.schema.json` reference so offline validators do not need network access.

`extractor-request.schema.json` describes the optional model-extraction HTTP
request envelope.

The browser normalizer is intentionally more forgiving than the schema: it
accepts legacy fields, repairs missing metadata, and records migrations. New
extractors and external projections should emit the schema shape directly.

The contract is deliberately forward-compatible (`additionalProperties` is
allowed). Consumers should ignore fields they do not understand and preserve
fields when round-tripping data.
