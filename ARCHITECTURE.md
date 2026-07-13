# LLM Field Notes architecture

LLM Field Notes is a local-first document-to-knowledge-graph workbench. The
important design decision is that the graph is the source of truth: the
browser UI, Obsidian vault, feedback dataset, and evaluator are projections or
consumers of the same normalized representation.

```text
document
   │
   ▼
extractor ── optional same-origin model endpoint
   │
   ▼
normalizeExtraction()
   │
   ▼
mergeExtraction() ──► graph-core.js ──► normalized graph
                             │
                 ┌───────────┼────────────┐
                 ▼           ▼            ▼
          browser store   Obsidian     feedback/eval
          + undo/recovery projection   + learning loop
```

## Module boundaries

- `graph-core.js` is the pure domain layer. It owns schemas, normalization,
  extraction heuristics, graph merging, provenance, feedback, bounded learning
  memory, review queues, and the shared endpoint-order-insensitive relation
  identity key. New extractors must pass through `normalizeExtraction()` before
  merge; network adapters should use `normalizeExtractionForDocument()` to
  preserve the submitted document's provenance envelope.
- `graph-store.js` owns graph persistence semantics: optimistic version and
  content-fingerprint checks, bounded undo history, graph and history recovery
  snapshots, and storage-failure modes. It does not know about the DOM.
- `storage-adapter.js` provides browser storage. IndexedDB is preferred;
  localStorage is migrated and retained as a fallback. Cross-tab changes are
  synchronized through storage events and `BroadcastChannel`.
- `projection-adapter.js` owns the editable Obsidian contract. Markdown notes
  are feedback inputs, not a second source of truth. ZIP imports validate paths,
  filenames, bounds, and checksums before applying updates; the browser requires
  explicit confirmation before applying metadata-bound edits from a stale graph
  projection, and conflicting duplicate edits are skipped rather than resolved
  by file order. Relation projections retain and validate both endpoints before
  an edit can reach the graph, while source projections bind metadata edits to
  the document fingerprint. The vault also includes a derived reusable-review
  ledger; it is navigational and does not become an independent learning store.
  The workbench also emits JSON-LD as a non-editable interoperability
  projection; JSON-LD consumers must treat the normalized graph and its
  fingerprint as the source of truth.
- `jsonld-projection.js` is the pure JSON-LD projection boundary. It has no DOM
  dependency and normalizes its input, so browser exports and automation can
  share one bounded representation. Vault imports also compare JSON-LD
  semantically with the authoritative embedded graph JSON, not only its
  fingerprint and version metadata; verification ignores JSON-LD object-key
  and unordered-member ordering differences.
- `experiments/graph-input.mjs` is the shared automation input boundary for
  graph JSON and full backups; `project-jsonld.mjs` and `verify-jsonld.mjs`
  use it so artifact generation and verification apply the same schema,
  size, normalization, and fingerprint rules.
- `extractor-adapter.js` is the provider-neutral HTTP client. It bounds
  documents, feedback, response bytes, timeouts, and cancellation, then
  normalizes provider output against the submitted document so provenance
  metadata remains request-authoritative.
- `evaluation.js` measures extractor output against reviewed examples. It
  reports accepted recall, reviewed-candidate precision, source-anchored
  evidence coverage, and
  rejected-example suppression, excludes explicitly rejected candidates from
  accepted recall,
  validates relation labels and endpoint pairs even when IDs match, while
  preserving the graph's endpoint-order-insensitive relation identity,
  fingerprints the reviewed dataset, and refuses to treat sparse feedback as a
  complete precision benchmark.
- `server.mjs` is a dependency-free reference host and extraction endpoint. It
  provides static allowlisting, request limits, rate limiting, security
  headers, optional bearer-token authentication, readiness, privacy-safe
  metrics, bounded latency telemetry, structured logs, and provider
  cancellation. Production
  deployments should add authentication, TLS, and a shared rate limiter at a
  trusted gateway.
- `scripts/public-assets.mjs` is the deployment asset contract. The server,
  static Pages builder, HTTP smoke test, and service-worker release check all
  consume or validate it so public delivery paths stay aligned.
- `app.js` is orchestration and presentation. It should call domain functions
  rather than reimplementing graph mutations in event handlers. Review controls
  share one conflict-safe persistence path across list and inspector surfaces.

## Data and learning loop

1. A document is extracted locally or by the configured same-origin endpoint.
2. The result is normalized into stable IDs, bounded evidence, provenance, and
   review status.
3. The merge adds new evidence without silently overriding accepted or
   rejected knowledge.
4. Human review changes the current graph and records compact accepted/rejected
  examples in `graph.learning`, including bounded review timestamps for audit
  and round-trip freshness. Concept review mutations also advance the
  concept's `updatedAt` timestamp so item history and review history stay
  consistent. Stale reusable examples are surfaced in health
   diagnostics and can be removed as an explicit, undoable cleanup action.
5. Future extraction receives only bounded labels, aliases, endpoints, and
   statuses—not source evidence.
6. `evaluate-feedback.mjs` compares a new extractor or graph against exported
   reviewed examples before a change is trusted; `compare-evaluations.mjs`
   refuses promotion when the baseline and candidate use different reviewed
   datasets.

Feedback exports carry the same deterministic 64-bit fingerprint as evaluation
reports. The evaluator verifies that an envelope's fingerprint matches its
examples before scoring, preventing stale or accidentally mixed learning data
from entering a promotion decision; legacy 32-bit fingerprints remain
readable during migration.

The review queue is an active-learning surface: it ranks inferred items by
uncertainty plus missing evidence and unresolved provenance, and also surfaces
unknown-quality or never-reviewed sources. Each candidate exposes a short
reason so a human can correct the most consequential gaps first. Reviewed
concepts, relations, and source metadata re-enter the queue after the bounded
stale-review window, keeping old decisions open to revision. `inspectGraph()`
reports the stale subset separately so automation can monitor review debt.
Health also separates historical source-review coverage from fresh coverage,
using the same stale-review window.

Source records may carry a bounded optional URI. It is provenance metadata,
not extraction evidence: it travels through normalization, remote requests,
graph exports, and Obsidian source notes while remaining excluded from the
learning hints sent to providers.

Automatically generated source fingerprints use a dual-lane deterministic
content digest. Imported custom fingerprints remain unchanged, and canonical
text comparison still catches duplicates from older graphs. The reference
heuristic extractor derives its generated source ID from the same content
digest, while explicit provider IDs remain authoritative.

When a source changes, `replaceSource()` removes only unsupported knowledge that
depended on the old source, retains accepted concepts and relations, and merges
the new extraction as one atomic revision and undoable browser-store mutation.
It preserves the source-quality classification but clears the old review date
because the content changed. It also invalidates review dates for retained
concepts, relations, and their reusable learning entries that depended on the
changed source, so the review queue can revalidate the new evidence basis. A
replacement that duplicates another source is rejected before the old
representation is touched.

`diffGraphs()` compares normalized revisions using stable identities and emits
compact summaries of documents, concepts, relations, reusable learning memory,
integrity diagnostics, and review freshness rather than copying source text or
evidence. The
browser uses it for a bounded latest-revision diff export, keeping
representation changes inspectable without making the diff a second source of
truth.

`inspectGraph()` is also available as a versioned health projection. It exposes
counts, active-item provenance coverage, ambiguity, and quality diagnostics
without source text or evidence, making graph quality reportable outside the
browser. Provenance coverage counts active concepts and relations, including
items that have no evidence records, so unsupported graph items cannot appear
healthy by omission.

Fingerprint-bearing graph exports are verified by the browser and by the
health, diff, and evaluation CLIs before they are consumed. Legacy exports
without a fingerprint remain readable for migration.

Full backups carry a deterministic fingerprint over normalized graph and undo
history. New imports verify it before restoration; legacy backups without a
fingerprint remain readable.

Sharing surfaces have explicit privacy levels: the full graph, backup, vault,
and evidence-bearing feedback exports retain source material; the redacted
graph and redacted vault remove source text, evidence, and URIs; compact
feedback retains only reviewed learning fields. New projections must declare
which level they use and must not silently downgrade to a more sensitive
export.

Markdown and Obsidian index projections also carry bounded health diagnostics
such as active-item provenance coverage, unsupported concepts/relations, and
review debt. These diagnostics contain counts only and do not expose source
text or evidence.

## Extension rules

When adding a feature:

1. Put invariant-bearing behavior in a pure module first.
2. Normalize untrusted input at the boundary.
3. Keep IDs stable and preserve provenance; prefer an explicit integrity
   diagnostic over a silent guess.
4. Bound every collection, text field, archive, request, and response.
5. Make storage mutations optimistic and undoable where practical.
6. Add a regression test for malformed input and the normal path.
7. Update the relevant JSON schema, README, and public/offline asset lists.

The test contract is intentionally dependency-free:

```bash
npm test
```

The same checks run across Node 18, 20, and 22, build the container, verify
readiness, and exercise static delivery and offline service-worker behavior.
