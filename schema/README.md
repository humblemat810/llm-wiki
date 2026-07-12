# Graph contract

`graph.schema.json` is the portable contract for `llm-field-notes/graph@1`.

The browser normalizer is intentionally more forgiving than the schema: it
accepts legacy fields, repairs missing metadata, and records migrations. New
extractors and external projections should emit the schema shape directly.

The contract is deliberately forward-compatible (`additionalProperties` is
allowed). Consumers should ignore fields they do not understand and preserve
fields when round-tripping data.
