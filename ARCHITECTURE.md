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
  identity key. The local extractor prefers repeated or structurally explicit
  concepts over isolated lowercase vocabulary when enough stronger candidates
  exist, with a bounded adjacent-phrase pass for multi-word ideas. New
  extractors must keep Markdown structure separate from prose units, filter
  common verb/preposition fragments from adjacent phrases, preserve explicit
  relation verbs and shared-subject clauses, keep sparse documents on the
  noise-filtered ranking path while retaining accepted feedback endpoints,
  removing only evidence-subsumed one-word duplicates, and passing through
  bounded candidate and evidence collection with reserved phrase capacity
  before `normalizeExtraction()`.
  merge; network adapters should use `normalizeExtractionForDocument()` to
  preserve the submitted document's provenance envelope. That boundary rejects
  provider node and edge collections above graph limits before scanning or
  copying them, so provider overproduction cannot bypass resource limits or
  silently discard part of a model response.
- Browser file imports read bounded `arrayBuffer()` data with fatal UTF-8
  decoding before JSON or document parsing, so malformed local bytes cannot
  silently become altered graph content. Browsers that do not expose byte
  access fail closed instead of falling back to replacement-decoded text.
  Document and feedback character limits use a four-byte UTF-8 envelope for
  pre-read checks, then enforce the exact decoded character limit, so valid
  multilingual text is not rejected by a byte/character mismatch.
  Bounded note reads also cancel their response reader when the fetch timeout
  fires, and their non-streaming `arrayBuffer()` fallback races the same
  signal. Stream reads race the signal too, so a stalled body cannot outlive
  its request even when cancellation is ignored.
- `graph-store.js` owns graph persistence semantics: optimistic version and
  content-fingerprint checks, bounded undo history, graph and history recovery
  snapshots—including raw over-capacity history before trimming—and
  storage-failure modes. Both caller-configured history capacity and persisted
  JSON character and UTF-8 byte size are capped by module safety ceilings,
  while smaller limits remain supported. Recovery captures also have a
  conservative UTF-8-safe ceiling so malformed state cannot be duplicated
  without bound. Backup restores preserve discarded or malformed history in
  that recovery channel before applying the local bound. It does not hide a
  suppressed recovery capture: failed graph/history rollbacks also retain the
  previous raw inputs when storage permits, and the workbench exposes the
  condition and offers a full backup action. Every graph mutation first
  captures both raw storage keys; if either read fails, the operation stops
  before changing graph or history state. Non-destructive mutations commit the
  primary graph key before the undo-history key, so an abrupt tab termination
  preserves the newest graph. Destructive clears record the undo snapshot
  before removing the graph, prioritizing recoverability over a transient
  duplicate history entry. The existing rollback and recovery paths still
  handle ordinary storage failures. If the undo snapshot cannot fit, the
  clear operation falls back explicitly to a reduced-history clear and reports
  that degraded mode to the workbench.
  Empty graph projections use the same deterministic epoch timestamp as graph
  normalization, so an untouched workspace can be exported reproducibly.
- `storage-adapter.js` provides browser storage. IndexedDB is preferred;
  localStorage is migrated and retained as a fallback. Cross-tab changes are
  synchronized through storage events and `BroadcastChannel`. A bounded
  localStorage write-ahead marker protects synchronous mirror writes until
  their IndexedDB commits complete, so reloads cannot silently resurrect an
  older graph revision; marker generations include a storage-instance identity
  so same-key writes from separate tabs cannot acknowledge one another.
  Cross-tab broadcasts ignore that internal marker key, keeping recovery
  bookkeeping out of the graph value stream. They also accept only bounded key
  names and string values across hydration, storage events, and broadcasts, so
  a malformed same-origin value cannot expand memory before the persistence
  safety limit is applied; durable writes enforce the same boundary before
  reaching either storage backend. The workbench consumes this adapter’s
  external-change stream as the single synchronization path, so freshness
  repair runs before a stale graph can be rendered.
  The workbench compares external graph revision
  freshness before rendering and repairs delayed older graph events from its
  newer in-memory representation. Namespace clearing removes only LLM Field
  Notes keys, preserving unrelated localStorage data owned by the same origin,
  and includes keys awaiting durable commit. IndexedDB write and delete
  transactions have their own bounded timeout; stalled operations abort when
  possible, demote the adapter to its synchronous fallback, and emit the
  existing durability warning.
- `projection-adapter.js` owns the editable Obsidian contract. Markdown notes
  are feedback inputs, not a second source of truth. ZIP imports validate paths,
  filenames, bounds, and checksums before applying updates; the browser requires
  explicit confirmation before applying metadata-bound edits from a stale graph
  projection, and conflicting duplicate edits are skipped rather than resolved
  by file order. Relation projections retain and validate both endpoints before
  an edit can reach the graph, while source projections bind metadata edits to
  the document fingerprint. The vault also includes a derived reusable-review
  ledger; it is navigational and does not become an independent learning store.
  Vault parsing also checks each editable feedback note against the manifest
  identity so one stale note cannot hide behind a current archive manifest.
  Obsidian feedback frontmatter is a closed, type-specific allowlist matching
  the exporter; unknown keys and malformed read-only metadata are rejected
  instead of being silently ignored, so a typo or unsupported edit remains
  visible as an invalid feedback note.
  Editable note fields that exceed graph bounds are rejected rather than
  silently truncated before mutation. Direct feedback batches above the
  published file/item bound, or with over-limit correction fields, are
  rejected rather than partially applied or prefix-truncated.
  Feedback dataset imports above the larger fingerprint/evaluation bound are
  rejected before matching, so a successful import always represents the
  complete human decision set supplied by the user.
  Feedback exports disclose reviewed items omitted by their bounded 500-item
  projection; importing such a partial dataset requires explicit confirmation.
  Alias feedback is canonicalized as a set while retaining established
  aliases, so reordering aliases in an external note is idempotent.
  The workbench also emits JSON-LD as a non-editable interoperability
  projection; JSON-LD consumers must treat the normalized graph and its
  fingerprint as the source of truth.
- `jsonld-projection.js` is the pure JSON-LD projection boundary. It has no DOM
  dependency and normalizes its input, so browser exports and automation can
  share one bounded representation. Entity IDs use a reserved unambiguous
  escape form so graph IDs cannot collide with escaped punctuation. Vault
  imports also compare JSON-LD semantically with the authoritative embedded
  graph JSON, not only its fingerprint and version metadata; verification
  ignores JSON-LD object-key and unordered-member ordering differences.
- `experiments/graph-input.mjs` is the shared automation input boundary for
  graph JSON and full backups; `project-jsonld.mjs` and `verify-jsonld.mjs`
  use it so artifact generation and verification apply the same schema,
  size, normalization, and fingerprint rules.
- `extractor-adapter.js` is the provider-neutral HTTP client. It bounds
  documents, feedback, response bytes, timeouts, and cancellation, then
  normalizes provider output against the submitted document so provenance
  metadata remains request-authoritative. External JSON text is decoded as
  fatal UTF-8 so malformed bytes cannot silently alter a graph. Browser note
  responses without byte access fail closed for the same reason. Response
  readers and raw-byte fallbacks are also canceled or rejected
  when the caller aborts or the request timeout fires, so a resolved stream
  cannot continue consuming model output after the UI has stopped waiting.
  Stream `read()` calls themselves race the signal, covering adapters that
  ignore `reader.cancel()`.
  The fetch attempt itself races the same abort signal, so an integration that
  ignores cancellation cannot leave a request pending indefinitely. The
  non-streaming `arrayBuffer()` fallback races the same signal as well, so a
  provider adapter cannot turn a stalled body read into an unbounded wait.
  Retryable response cleanup is best-effort and non-blocking, so a provider
  that never settles `body.cancel()` cannot suppress the next bounded attempt.
  Oversized streamed responses use the same non-blocking cleanup rule, so
  rejecting an over-limit body cannot itself hang.
- `evaluation.js` measures extractor output against reviewed examples. It
  reports accepted recall, reviewed-candidate precision, source-anchored
  evidence coverage, and
  rejected-example suppression, excludes explicitly rejected candidates from
  accepted recall,
  validates relation labels and endpoint pairs even when IDs match, while
  preserving the graph's endpoint-order-insensitive relation identity,
  fingerprints the reviewed dataset, and refuses to treat sparse feedback as a
  complete precision benchmark. One-to-one matching prioritizes the most
  constrained reviewed identities before overlapping aliases, keeping metrics
  stable and fair when concepts share labels. Matching finds a maximum
  one-to-one assignment and has an explicit comparison budget, failing closed
  before an oversized evaluation can exhaust memory or CPU. Its shared report
  validator checks bounded counts, freshness arithmetic, category/overall
  consistency, and impossible metric combinations before promotion code trusts
  an evaluation artifact. It also recomputes rounded recall, suppression, and
  evidence-coverage ratios from their counts.
  Evaluation timestamps are also bounded and parsed before an artifact enters
  the promotion path. Unknown fields are rejected at each report layer to
  match the closed versioned schema.
  Date-only timestamps are rejected; reports require full RFC3339-style
  date-time provenance.
  Oversized reviewed datasets fail before matching, so benchmark fingerprints
  cannot describe a larger set than the metrics actually score.
  Candidate concept and relation collections also fail before normalization
  when they exceed graph limits.
  Every benchmark example must be a reviewed concept or relation, preventing
  malformed feedback from disappearing during scoring.
- `server.mjs` is a dependency-free reference host and extraction endpoint. It
  provides static allowlisting, request limits, rate limiting, security
  headers, optional bearer-token authentication, readiness, privacy-safe
  metrics, bounded latency telemetry, structured logs, and provider
  cancellation. Runtime learning-note rendering uses incremental fatal UTF-8
  decoding, matching Pages publication without rejecting a valid multibyte
  character split across a bounded read; both byte and character read helpers
  reject non-finite and over-ceiling limits so a bad caller cannot silently
  request an unbounded asset read. Production
  deployments should add authentication, TLS, and a shared rate limiter at a
  trusted gateway. The CLI additionally fails extraction closed on non-loopback
  hosts until a bearer token is configured, while loopback development remains
  convenient; operational metrics follow the same non-loopback authentication
  default. The extraction boundary checks feedback cardinality before
  mapping or serializing provider hints, preventing oversized arrays from
  creating avoidable intermediate allocations. The server enforces the
  extractor-request schema's closed root, document, and feedback shapes, so
  unknown fields fail before they can be silently discarded. It also rejects
  duplicate aliases at the gateway, matching the browser adapter's canonical
  feedback contract.
- `scripts/public-assets.mjs` is the deployment asset contract. The server,
  static Pages builder, HTTP smoke test, and service-worker release check all
  consume or validate it so public delivery paths stay aligned. Both runtime
  and build-time publication reject empty or oversized public assets using its
  shared 10 MB per-asset and 100 MB aggregate limits, including the release
  consistency check. They cap the learning-note collection at 1,000 items,
  preflight the aggregate source budget before
  loading note contents, recheck learning-note reads with a bounded byte
  reader to close the preflight/read race, and Node and Pages sitemap generation publish the
  same Markdown and canonical HTML note URLs. Release checks and the builder
  both resolve public assets and reject symlink escapes. Custom output paths
  are rejected when they overlap a published source asset, preventing a failed
  build from deleting its own inputs.
- `scripts/check-contracts.mjs` keeps the public JSON schemas coupled to the
  runtime safety constants, including the extractor request and Obsidian
  manifest boundaries. It is dependency-free and runs in CI, so changing an
  ingestion or projection bound requires updating the published contract in
  the same change.
- `scripts/note-page.mjs` is the shared crawler-readable learning-note page
  renderer used by the Node host and generated Pages artifacts; it keeps
  note-specific metadata, Article JSON-LD, feed discovery, the interactive
  workbench link, and the no-script content-security policy consistent. Feed
  entries use the same note-derived summaries in Node and Pages deployments.
- `app.js` is orchestration and presentation. It should call domain functions
  rather than reimplementing graph mutations in event handlers. Review controls
  share one conflict-safe persistence path across list and inspector surfaces.
  Graph, backup, and JSON-LD exports preflight their source/evidence byte budget
  before JSON serialization, avoiding a second large in-memory copy when a
  payload is already beyond the export safety ceiling.
  Markdown projections canonicalize set-like graph collections before rendering
  so direct downloads are byte-stable across equivalent array orderings.
  Markdown, Obsidian, feedback, and revision-diff exports use the same
  preflight before constructing their projection strings.
  The Obsidian ZIP writer also bounds file count and validates archive-limit
  configuration before allocating local and central directory parts.
  Service-worker upgrades are user-coordinated: the first install can activate
  immediately, while later releases wait for an explicit reload so an active
  workbench is not mixed with assets from two versions. Shell cache entries use
  pathname-only keys so cache-busting query strings cannot create unbounded
  duplicate copies of the same asset; query-bearing responses are never allowed
  to overwrite the canonical cache entry. Unknown same-origin navigations can
  still fall back to the cached index while offline, but are not added to the
  bounded shell cache. The same navigation fallback applies when the network
  responds with a transient non-OK status. Cache API read failures are treated
  as cache misses so they cannot reject a recoverable network response, and
  both response headers and body reads have the same bounded timeout.
  Install-time shell precaching uses that same bounded fetch path instead of
  raw `cache.addAll`, so a stalled or oversized deployment asset cannot hang
  first install. Cache open, match, put, delete, and client-claim operations
  also have bounded waits, so cache pressure cannot hold a fresh response or
  activation indefinitely.
  Cross-tab stale graph repair also uses optimistic version and fingerprint
  preconditions, so a newer concurrent commit cannot be overwritten.

## Data and learning loop

1. A document is extracted locally or by the configured same-origin endpoint.
2. The result is normalized into stable IDs, bounded evidence, provenance, and
   review status. Provider responses that exceed nested evidence, evidence-text,
   or provenance-reference bounds are rejected before normalization rather than
   silently losing grounding.
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
   `inspectGraph()` reports the unique guidance items available versus the
   bounded provider-context count, including whether truncation is occurring.
   If the compact provider request would exceed either the reviewed-item or
   serialized feedback bound, the browser rejects the extraction rather than
   sending a partial learning context.
   Feedback imported before its target graph exists is canonicalized by
   portable concept labels or relation endpoint labels, so workspace-specific
   IDs cannot preserve contradictory learning hints as separate examples.
6. `evaluate-feedback.mjs` compares a new extractor or graph against exported
   reviewed examples before a change is trusted; `compare-evaluations.mjs`
   refuses promotion when the baseline and candidate use different reviewed
   datasets.

Feedback exports carry the same deterministic 64-bit fingerprint as evaluation
reports. The evaluator verifies that an envelope's fingerprint matches its
examples before scoring, preventing stale or accidentally mixed learning data
from entering a promotion decision; legacy 32-bit fingerprints remain
readable during migration.
The evaluation CLI also refuses feedback envelopes marked as partial by the
bounded export diagnostic, so promotion metrics cannot be mistaken for a
complete human benchmark.

When a feedback import contains contradictory decisions, the selected
freshness/tie-break result is retained as learning state and the resolution is
recorded in the bounded revision timeline, so the learning loop remains
auditable after the import completes.

The review queue is an active-learning surface: it ranks inferred items by
uncertainty plus missing evidence and unresolved provenance, and also surfaces
unknown-quality or never-reviewed sources. Each candidate exposes a short
reason so a human can correct the most consequential gaps first. Reviewed
concepts, relations, and source metadata re-enter the queue after the bounded
stale-review window, keeping old decisions open to revision. Reviewed concepts
and relations also re-enter immediately when a newer source is attached after
their last review. `inspectGraph()` reports the stale and new-evidence subsets
separately so automation can monitor review debt.
The queue also records when its safety cap omits lower-priority candidates;
health, Markdown, and the workbench disclose that the visible queue is
incomplete rather than presenting the retained prefix as the full workload.
The live SVG and list views use separate rendering caps; the workbench summary
reports the number of concepts and relations not shown so a bounded viewport
cannot be mistaken for a bounded graph.
Each graph item retains at most eight evidence records, matching the graph,
JSON-LD, and vault schemas; provider responses above that bound are rejected,
while imported graph omissions are recorded in integrity and health diagnostics.
Health artifact validation also checks the types of bounded boolean diagnostics,
so a malformed external report cannot masquerade as a trustworthy inspection.

Source mutations fail closed when normalization reports an ambiguous source ID.
Conflicting imported documents are retained with repaired IDs for inspection,
but removal and replacement refuse to guess which document the caller intended.
Health also separates historical source-review coverage from fresh coverage,
using the same stale-review window.

Exact evidence-grounding checks are also routed back to the affected concept or
relation: a candidate carries a bounded unanchored-evidence count and explains
that gap without exporting the quote or source URI. This lets a reviewer repair
paraphrased or weakly grounded extraction at the point of use, while the same
bounded grounding budget is shared by health and queue construction.

Stale reusable learning examples remain in the graph for auditability and
explicit cleanup, but the workbench excludes them from new extractor guidance.
Reviewing the underlying concept or relation refreshes the example and makes
it eligible to guide later extraction again.
Obsidian imports follow the same rule: a substantive label, alias, or decision
change refreshes the item's review timestamp even when the exported note still
contains the old timestamp, preventing a valid correction from being withheld
as stale memory. Non-substantive imports apply review timestamps
monotonically, so an older projection cannot undo a newer review; explicit
clearing remains available.
Source title, URI, and quality edits use the same rule in both the workbench and
Obsidian projections, so source-review coverage cannot become stale merely
because the exported date was left unchanged.

Health guidance counts use the same fresh-only filter as extraction requests;
stale retained memory is reported separately as review debt.
Feedback dataset imports are transactional at the graph-version ceiling: if
any entry would exceed the bounded revision history, the entire dataset is
rejected and the normalized pre-import graph is returned unchanged.
Obsidian feedback applies its complete batch as one revision and has the same
fail-closed final version guard.
The filter also covers accepted or rejected graph items whose review timestamp
has gone stale, so a live status cannot bypass the learning-memory boundary.
When the bounded guidance budget is saturated, the builder reserves slots for
the first current reviewed concept and relation before filling the remaining
capacity with the freshest reusable historical memory by review timestamp, so
newly reviewed live state cannot be completely crowded out by older portable
examples.
Items with missing or malformed review timestamps are treated as stale for
guidance purposes and must be reviewed before they become active again.
Health and Markdown projections expose the count of guidance identities
withheld by this rule.

Source records may carry a bounded optional URI. It is provenance metadata,
not extraction evidence: it travels through normalization, remote requests,
graph exports, and Obsidian source notes while remaining excluded from the
learning hints sent to providers.

Automatically generated source fingerprints use a dual-lane deterministic
content digest. Imported custom fingerprints remain unchanged, and canonical
text comparison remains authoritative for duplicate and collision decisions, so
custom fingerprint collisions cannot merge distinct source text. The reference
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
integrity diagnostics—including provenance ambiguity, contradictory review
identities, truncation, and malformed-entry count changes—and review freshness
rather than copying source text or evidence. The
browser uses it for a bounded latest-revision diff export, keeping
representation changes inspectable without making the diff a second source of
truth.

`inspectGraph()` is also available as a versioned health projection. It exposes
counts, active-item provenance coverage, ambiguity, and quality diagnostics
without source text or evidence, making graph quality reportable outside the
browser. Provenance coverage counts active concepts and relations, including
items that have no evidence records, so unsupported graph items cannot appear
healthy by omission. If an imported payload exceeded a bounded collection
limit, normalization preserves per-collection truncation counts in
`integrity.truncated` and health reports them; this includes collection
overflow plus clipped or omitted document text, clipped evidence text, omitted
evidence records, and omitted provenance references. The
browser warns the
operator to restore the original export before making edits instead of
silently treating the partial graph as complete. Invalid entries that cannot
be normalized are counted in `integrity.dropped` with the same health and
automation visibility, using the same retained learning window that
normalization actually stores. Duplicate concept and relation records with
contradictory review statuses are retained under deterministic canonicalization
but identified in bounded conflict diagnostics so an import cannot masquerade
as an unambiguous review history.
Oversized document imports retain the newest deterministic source window by
`addedAt` and source identity using a bounded selection heap, so newly ingested
knowledge is not evicted in favor of older documents without allocating an
unbounded intermediate sort. Timestamp, identity, and text inputs used for
selection are clipped to the graph contract and precomputed once per candidate
before comparison.
Source merges and replacements refuse to mutate a graph carrying any import
truncation diagnostics, so an incomplete import cannot be made to look
complete through later edits.
The persistence layer applies the same rule to every UI mutation path: a
truncated graph can only be replaced by a clean graph without truncation,
which keeps manual edits, feedback, and source operations from normalizing a
partial import into a misleading revision.
Health reports derive stale-review counts and their exported review queue from
one normalized inspection timestamp, so a review exactly at the freshness
boundary cannot produce internally inconsistent diagnostics.
The same timestamp is threaded through fresh guidance counts and extractor
feedback construction, preventing a boundary-time health/guidance mismatch.
They also report evidence grounding separately from source-ID provenance:
exact normalized evidence quotes found in their referenced source text count as
anchored, while paraphrases remain in the graph and are disclosed as
unanchored. Redacted graphs mark grounding as unavailable rather than
misclassifying redacted evidence.
The workbench uses the same snapshot rule per render for its health strip and
review queue. Its fingerprinted health, review, and Markdown cache also expires
after a bounded 30-second interval measured from computation, so repeated
renders cannot keep time-sensitive stale-review diagnostics alive indefinitely.
Health and review candidates are produced from one inspection pass per render;
the internal queue can be reused by the browser without duplicating bounded
evidence-grounding scans, while exported health JSON keeps its existing shape.
Dynamic workbench renderings escape enum-derived statuses and source-quality
labels alongside user-authored labels, evidence, titles, and URIs, keeping
future contract expansion inside the same HTML safety boundary.
The automation gate accepts one bounded violation for each supported threshold
so simultaneous quality failures remain valid health reports rather than being
silently dropped.

Fingerprint-bearing graph exports are verified by the browser and by the
health, diff, and evaluation CLIs before they are consumed. Fingerprints
canonicalize the unordered document, concept, relation, and integrity
collections, so an Obsidian or JSON round-trip that only reorders those arrays
does not look like a content change; revision history and learning-example
order remain chronological. Legacy exports without a fingerprint remain
readable for migration, and fingerprints from the pre-canonical ordering
implementation remain accepted during import.

Direct graph JSON, full backups, and JSON-LD also pass through the shared
canonical export boundary. This makes the serialized artifacts reproducible
without reordering revision history or reusable-learning chronology.

Full backups carry a deterministic fingerprint over the normalized graph and
newest bounded undo-history window. New imports verify it before restoration;
legacy backups without a fingerprint remain readable.

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
Their Mermaid visual is intentionally bounded separately from the complete
concept and relation indexes, and the projection reports the omitted visual
counts so viewers cannot mistake the safety-capped drawing for the whole graph.
JSON-LD carries the same bounded graph-integrity diagnostics as root metadata,
so downstream consumers cannot mistake a fingerprinted but truncated or
conflicted graph for a clean representation.

## Extension rules

When adding a feature:

1. Put invariant-bearing behavior in a pure module first.
2. Normalize untrusted input at the boundary.
3. Keep IDs stable and preserve provenance; prefer an explicit integrity
  diagnostic over a silent guess.
4. Collapse duplicate imported records deterministically so collection order
   cannot change graph fingerprints or learning-memory identity; conflicting
   source IDs retain an explicit ambiguity diagnostic while choosing stable
   canonical provenance.
   Apply the same rule to normalized extractor responses, preferring stronger
   directional relation evidence before using canonical tie-breaking.
5. Bound every collection, text field, archive, request, and response.
6. Make storage mutations optimistic and undoable where practical.
7. Add a regression test for malformed input and the normal path.
8. Update the relevant JSON schema, README, and public/offline asset lists.

The test contract is intentionally dependency-free:

```bash
npm test
```

The same checks run across Node 18, 20, 22, and 24, build the container, verify
readiness, and exercise static delivery and offline service-worker behavior.
