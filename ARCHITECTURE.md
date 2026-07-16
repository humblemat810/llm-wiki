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
  identity key, plus shared limits such as `MAX_DOCUMENT_TITLE_CHARS`. Its
  duplicate-key-safe JSON boundary rejects ambiguous object payloads before
  request, persistence, or projection fields can be interpreted, and bounds
  nesting depth before recursive validation can exhaust the call stack. Its
  duplicate-key diagnostics are bounded before they can amplify an API error
  response.
  shared timestamp parser rejects impossible calendar dates before any
  chronology, freshness, or review decision can be derived from a
  parser-rollover value.
  bounded human-text normalizer avoids returning a lone surrogate when a
  Unicode astral character lands exactly on a graph field limit; the same
  boundary protects normalized document text, slug output, and bounded
  identity/fingerprint inputs. The local
  extractor prefers repeated or structurally explicit
  concepts over isolated lowercase vocabulary when enough stronger candidates
  exist, with a bounded adjacent-phrase pass for multi-word ideas. New
  extractors must keep Markdown structure separate from prose units, filter
  common verb/preposition fragments from adjacent phrases, preserve explicit
  relation verbs and shared-subject clauses, keep sparse documents on the
  noise-filtered ranking path, reject ordinary inflected verb fragments such
  as `policy blocks` or `retriever queries` without suppressing explicit
  graph relations, while retaining accepted feedback endpoints,
  attach source-line evidence to heading and quoted-term candidates, and
  removing only evidence-subsumed one-word duplicates, and passing through
  bounded candidate and evidence collection with reserved phrase capacity
  before `normalizeExtraction()`. A genuinely sparse document may contribute
  its bounded title as an inferred topic, but that metadata-only candidate
  carries no fabricated body evidence.
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
- The Playwright browser smoke runs the workbench in a reduced-motion,
  narrow-viewport context, verifies visible controls have accessible names,
  confirms keyboard focus reaches the primary sample action, and still checks
  service-worker activation, persistence, Obsidian vault ZIP export/import
  round trips, and offline reopening where the runner supports offline
  service-worker emulation. Failure-only screenshots are written to an
  operator-supplied artifact directory so CI can retain visual triage evidence
  without adding successful-run payloads.
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
  handle ordinary storage failures, and every graph/history write reads its
  value back before reporting success so silent storage adapters cannot claim
  persistence they did not perform. If the undo snapshot cannot fit, the
  clear operation falls back explicitly to a reduced-history clear and reports
  that degraded mode to the workbench. If rollback restores only one storage
  key, both raw pre-mutation keys are retained before any degraded fallback
  continues, so a partial storage failure cannot discard the graph merely
  because its history key was the one that failed.
  Graphs imported with truncation or dropped-entry diagnostics remain readable
  for inspection, but mutations that preserve those data-loss markers are
  rejected until a clean restore is written. The browser also captures the
  original imported JSON before normalization, so recovery downloads retain
  the source artifact rather than only its lossy normalized projection.
  The same integrity guard runs in graph-domain merges, source replacement,
  feedback, concept merging, source removal, and learning-memory cleanup, so
  callers receive an explicit incomplete-import limit before persistence can
  fail generically.
- `buildBackupEnvelope()` applies the separate three-snapshot backup
  interchange ceiling before canonicalization, so automation cannot emit a
  backup that exceeds `backup.schema.json`; oversized input fails closed rather
  than being silently truncated.
  `validateBackupEnvelope()` is the shared strict import boundary for the
  browser, graph-input library, and verification CLI; it checks required
  envelope fields, compatible history, trusted export time, producer metadata,
  and the closed top-level key set before normalization.
  Empty graph projections use the same deterministic epoch timestamp as graph
  normalization, so an untouched workspace can be exported reproducibly.
  Full backups also carry bounded producer-version metadata alongside their
  graph/history fingerprint, so long-lived archives can be traced to the
  application release that created them without trusting that metadata for
  restore authorization.
- `backup-crypto.js` optionally wraps a complete backup in an authenticated
  AES-GCM envelope using a PBKDF2-SHA-256 password-derived key. Encryption is
  browser-local, bounded, and never persists or transmits the password;
  plaintext backups remain a deliberate interoperability option. The browser
  download path applies the larger bounded envelope ceiling to encrypted
  backups, while ordinary text and binary projections retain the 50 MB export
  ceiling.
- The reference Node host applies the same published-asset trust boundary at
  runtime as the release and Pages builders: every static shell, learning note,
  and generated note source is checked with `lstat` before resolution, so a
  mutable deployment root cannot introduce a symlinked asset after startup.
  Its response helpers also stop when a response has already sent headers, so a
  late filesystem or rendering failure cannot trigger a second header write and
  hide the original failure.
- The reference server's metrics expose a privacy-safe draining gauge alongside
  aggregate HTTP and extraction latency, in-flight request pressure, and
  extraction capacity, so graceful shutdown and gateway saturation are
  distinguishable from provider failure while `/readyz` transitions to 503.
  These metrics do not add document, URI, or client-identity labels.
- The production Docker context excludes local Codex artifacts in
  `.dockerignore`; agent workspace files, tests, and release-only benchmark
  fixtures are not part of the runtime image.
  It also excludes Pages staging and rollback directories, which may remain
  briefly after an interrupted atomic publication.
- `storage-adapter.js` provides browser storage. IndexedDB is preferred;
  localStorage is migrated and retained as a fallback. Cross-tab changes are
  synchronized through storage events and `BroadcastChannel`. Bounded
  per-key localStorage write-ahead markers protect synchronous mirror writes
  until their IndexedDB commits complete, so concurrent tabs cannot overwrite
  one another's recovery metadata and reloads cannot silently resurrect an
  older graph revision; marker generations include a storage-instance identity
  so same-key writes from separate tabs cannot acknowledge one another. A
  bounded aggregate marker remains for compatibility with older state.
  Cross-tab broadcasts ignore that internal marker key, keeping recovery
  bookkeeping out of the graph value stream. They also accept only bounded key
  names and string values across hydration, storage events, and broadcasts, so
  a malformed same-origin value cannot expand memory before the persistence
  safety limit is applied. Both character and UTF-8 byte ceilings are checked
  before hydration or notification; durable writes enforce the same boundary, including
  a namespaced key-name check, before reaching either storage backend. The
  adapter does not read or write unrelated same-origin storage keys. The workbench consumes this adapter’s
  external-change stream as the single synchronization path, so freshness
  repair runs before a stale graph can be rendered. Graph-store commits stamp
  bounded `committedAt` metadata, including undo and restore, so freshness
  comparison can recognize an intentional rollback instead of allowing a
  delayed pre-rollback event to resurrect the newer version.
  The workbench compares external graph revision
  freshness before rendering and repairs delayed older graph events from its
  newer in-memory representation. If two tabs expose divergent content at the
  same revision and timestamp, it preserves the visible workspace and reports a
  same-revision conflict instead of silently choosing one graph. Namespace clearing removes only LLM Field
  Notes keys, preserving unrelated localStorage data owned by the same origin,
  and includes keys awaiting durable commit. During hydration, the adapter
  compares bounded graph `committedAt` metadata: if a
  synchronous local mirror is newer than the durable copy after an out-of-order
  cross-tab transaction, the local graph and history are selected and queued
  for durable repair before the workspace becomes ready. IndexedDB write and
  delete transactions have their own bounded timeout; stalled operations abort when
  possible, demote the adapter to its synchronous fallback, and emit the
  existing durability warning. An explicit cross-tab graph removal event is
  treated as an intentional clear rather than stale state, so the newer tab
  cannot silently resurrect the cleared graph; the storage adapter exposes that
  event classification as a tested boundary. Its pending-write marker uses the
  shared duplicate-key/depth-safe JSON boundary before it influences hydration,
  so ambiguous synchronization metadata preserves the synchronous mirror,
  discloses degraded durability, and is repaired through a fresh bounded
  durable write. The workbench listens for both the graph and history keys:
  because those keys are committed separately, a history notification that
  arrives after the graph notification still refreshes the visible undo
  timeline instead of leaving it stale until reload. Reusable hosts can await
  the adapter's `dispose()` method to
  remove native storage listeners, close BroadcastChannel and IndexedDB
  resources, and wait for queued durable writes to settle during a remount.
- Workbench graph selections use `#item=` deep links containing only a bounded
  item kind and stable ID. Reloads and browser back/forward restore local
  selection when that graph exists in the current browser, while copied links
  never serialize source text, evidence, URIs, or local graph state.
  Inspector share actions use the same URL contract, native sharing when
  available, and generic share metadata so source titles and graph content
  cannot escape through the share sheet.
- `projection-adapter.js` owns the editable Obsidian contract. Markdown notes
  are feedback inputs, not a second source of truth. ZIP imports validate paths,
  filenames, bounds, and checksums before applying updates; the browser requires
  explicit confirmation before applying metadata-bound edits from a stale graph
  projection, and conflicting duplicate edits are skipped rather than resolved
  by file order. Relation projections retain and validate both endpoints before
  an edit can reach the graph, while source projections bind metadata edits to
  the document fingerprint. The vault also includes a derived reusable-review
  ledger built from both live reviewed graph items and detached learning memory;
  it is navigational and does not become an independent learning store.
  Vault parsing also checks each editable feedback note against the manifest
  identity so one stale note cannot hide behind a current archive manifest.
  Vault manifests also retain bounded producer-version metadata, while older
  manifests without that optional field remain importable.
  Vault exports also record bounded learning-note completeness in the manifest,
  so a transient note-fetch failure remains machine-readable instead of being
  mistaken for a complete Obsidian projection. Imports cross-check those counts
  against the archive's actual `Learning/` files before trusting the status.
  Manifest keys are closed against the published schema so unsupported
  metadata cannot hide behind a valid graph fingerprint. A vault containing
  JSON-LD without the authoritative embedded graph JSON is marked unverified
  instead of treating matching metadata as semantic verification.
  Obsidian feedback frontmatter is a closed, type-specific allowlist matching
  the exporter; unknown keys and malformed read-only metadata are rejected
  instead of being silently ignored, so a typo or unsupported edit remains
  visible as an invalid feedback note.
  Projection path allocation keys relation notes by stable relation ID rather
  than object identity, so cloned normalized edges retain the same vault path.
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
  Obsidian vault exports also include a deterministic `Graph.canvas` file with
  one file-backed card per concept and one labeled edge per relation. Orphaned
  endpoints become explicit text cards instead of silently dropping an edge or
  creating a broken note link. It is a native visual browsing projection, not
  an additional graph store: linked Markdown notes and authoritative
  `graph.json` remain the recovery and round-trip sources of truth. The export
  validates Canvas identities, endpoint references, and concept-note paths
  before packaging the archive.
- `jsonld-projection.js` is the pure JSON-LD projection boundary. It has no DOM
  dependency and normalizes its input, so browser exports and automation can
  share one bounded representation. Entity IDs use a reserved unambiguous
  escape form so graph IDs cannot collide with escaped punctuation. Vault
  imports also compare JSON-LD semantically with the authoritative embedded
  graph JSON, not only its fingerprint and version metadata; verification
  ignores JSON-LD object-key and unordered-member ordering differences.
  JSON-LD exports may include bounded producer-version metadata; verification
  treats that field as optional so older projection files remain valid.
- The browser also provides a self-contained redacted HTML projection for
  human sharing. It contains only bounded graph labels, statuses, counts,
  health, and the graph fingerprint; source text, evidence quotes, source
  URIs, and source document titles are removed before rendering. The generated
  file includes an accessible bounded SVG graph preview plus complete
  list-based collections, has no scripts,
  uses a restrictive document CSP, escapes every graph-derived value, and
  remains behind the shared export byte limit. Large graphs disclose when the
  visual preview is capped; no concepts or relations are removed from the
  complete lists.
  The same projection can use the shared browser file-share boundary when
  available and falls back to downloading the exact same bounded bytes; a
  canceled share does not create a second artifact. Markdown sharing uses that
  boundary too, then adds its clipboard fallback.
- `buildGraphExport()` is the shared raw graph JSON projection boundary. It
  canonicalizes collection ordering, adds the normalized graph fingerprint,
  and records bounded producer-version metadata without making that metadata
  part of graph identity or restore authorization.
- Pages publication verifies the generated `robots.txt` policy against the
  configured public origin, requiring the matching sitemap when origin-aware
  discovery is enabled and rejecting origin-aware sitemap output otherwise.
- The Pages workflow also runs `scripts/smoke-pages-deployment.mjs` against the
  URL returned by the deployment action. It retries propagation with bounded
  timeouts, checks that redirects remain inside the deployed origin, and probes
  the served HTML, crawler files, artifact gallery, service worker, and a
  generated learning-note page, plus the served asset manifest and release
  metadata. It verifies the live artifact's version identity and every
  manifest-listed byte count and SHA-256 digest, then recomputes the deployed
  service-worker cache revision from those served bytes rather than treating a
  successful upload as proof of a healthy publication. A mixed CDN response
  cannot therefore pass as a coherent offline release.
- `.github/workflows/pages-monitor.yml` repeats that same bounded probe daily
  using the configured public origin or the repository's default Pages URL.
  Its read-only permissions and immutable action references make ongoing
  publication monitoring safe to run on forks and manual dispatches.
- `.github/workflows/browser-monitor.yml` repeats the exact-origin browser
  smoke daily across Chromium, Firefox, and WebKit, so a release that was
  healthy at publication cannot silently regress later through CDN,
  service-worker, or browser-facing drift.
- `.github/workflows/release.yml` is the versioned-release boundary. It accepts
  only a tag matching the stable package version, reruns the full suite,
  verifies a fresh Pages bundle, builds the container with the same semantic
  version and source revision, and smoke-tests that exact image under the
  read-only non-root runtime contract before the release job succeeds.
- `experiments/graph-input.mjs` is the shared automation input boundary for
  graph JSON and full backups; `project-jsonld.mjs` and `verify-jsonld.mjs`
  use it so artifact generation and verification apply the same schema, bounded
  timestamp, size, normalization, and fingerprint rules. Diff and graph
  verifiers use the same timestamp and duplicate-key boundaries for their
  exported artifacts; producer-version metadata, including backup-history
  metadata, is rejected before normalization can silently discard it. Backup,
  diff, and evaluation timestamps must also be trusted past timestamps before
  they can enter chronology or promotion workflows. JSON-LD and evaluation
  verifiers use the same JSON boundary.
- `extractor-adapter.js` is the provider-neutral HTTP client. It bounds
  documents, feedback, response bytes, timeouts, and cancellation, then
  normalizes provider output against the submitted document so provenance
  metadata remains request-authoritative. The shared normalization boundary
  also restores accepted reviewed concepts and relations that a provider omits
  only when their labels and endpoints are present in the submitted source,
  attaching exact bounded source evidence rather than fabricating unsupported
  fallback records. External JSON text is decoded as
  fatal UTF-8 and parsed through the shared duplicate-key/depth-safe JSON
  boundary, so malformed or ambiguous provider bytes cannot silently alter a
  graph. Browser note
  responses without byte access fail closed for the same reason. Response
  readers and raw-byte fallbacks are also canceled or rejected
  when the caller aborts or the request timeout fires, so a resolved stream
  cannot continue consuming model output after the UI has stopped waiting.
  Browser and provider response readers also compare received bytes with a
  finite declared `Content-Length` before decoding, rejecting truncated
  release metadata, learning notes, or extractor JSON.
  Stream `read()` calls themselves race the signal, covering adapters that
  ignore `reader.cancel()`.
  The fetch attempt itself races an explicit caller-abort promise as well as
  the timeout, so an integration that ignores cancellation cannot leave a
  request pending indefinitely. A late response from an aborted fetch is
  canceled best-effort before it can retain its body.
  non-streaming `arrayBuffer()` fallback races the same signal as well, so a
  provider adapter cannot turn a stalled body read into an unbounded wait.
  Retryable response cleanup is best-effort and non-blocking, so a provider
  that never settles `body.cancel()` cannot suppress the next bounded attempt.
  Malformed, unknown-field, null, non-array, or contradictory reviewed feedback
  also fails before a provider request rather than being silently dropped or
  interpreted by input order.
  Document payloads use the same closed-field validation as the gateway, so
  caller metadata cannot be silently discarded before extraction.
  Non-conforming fetch results are converted into bounded adapter errors and
  are not retried as transient provider failures.
  Thrown provider/network failures receive bounded retries and are surfaced as
  stable `NETWORK_ERROR` adapter errors with their original cause attached.
  The reference gateway adds bounded `Retry-After` guidance to transient
  extractor failures (`1` second for provider failures and `5` seconds for
  timeouts), while malformed or oversized provider output receives no retry
  hint because repeating a deterministic contract violation is not useful.
  The browser adapter uses bounded exponential fallback backoff across
  multiple retries and honors provider `Retry-After` values when supplied.
  Terminal non-JSON and non-2xx responses receive the same best-effort body
  cancellation before their error is surfaced, preventing failed provider
  responses from retaining unread streams.
  The browser orchestration layer resolves documented relative same-origin
  paths such as `/api/extract-graph` to absolute URLs before handing them to
  this adapter, while the adapter itself continues to reject ambiguous
  non-HTTP provider URLs.
- `tests/provider-http-smoke.mjs` exercises the gateway and adapter against a
  real localhost provider socket, including the serialized request envelope, a
  retryable HTTP failure, streamed response decoding, and rebinding provider
  evidence to the submitted source. Mock-only tests remain useful for malformed
  readers, but this integration check proves the network boundary itself.
  Oversized streamed responses use the same non-blocking cleanup rule, so
  rejecting an over-limit body cannot itself hang.
- `rebuild-adapter.js` owns the pure sequential saved-source rebuild loop.
  It validates the source collection and each bounded source record before
  work, reports bounded progress, retains successful replacements when a later
  source fails, stops before work when canceled, and preserves stable source
  identities through the injected graph replacement function. Browser code
  supplies the local or remote extractor and performs one final optimistic
  graph-store commit. Replacement results are normalized and rejected when
  normalization would drop or truncate graph data, so a custom provider or
  test double cannot report a partial rebuild as successful. Failure
  diagnostics are normalized and bounded before they reach the browser status
  surface. Extraction is raced against the rebuild abort signal, so an
  extractor that ignores cancellation cannot hold the orchestration loop open.
  Replacement graphs carrying ambiguous source/relation IDs or contradictory
  duplicate-identity diagnostics are rejected before they can be counted or
  persisted.
  Each replacement also preserves every unrelated saved source record
  byte-for-byte at the normalized field level; only the target source may be
  replaced by the rebuild operation.
  A rebuild also rejects a structurally valid empty replacement when
  the source previously grounded concepts or relations, preserving the prior
  representation through transient provider/model failures. Successful bounded
  detail records retain before/after source-linked concept and relation counts,
  allowing the workbench to report how a learning pass changed the
  representation instead of hiding the delta behind a source total.
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
  date-time provenance. Future-dated review timestamps are treated as
  undated/untrusted rather than allowing clock-skewed metadata to bypass a
  freshness gate.
  Oversized reviewed datasets fail before matching, so benchmark fingerprints
  cannot describe a larger set than the metrics actually score.
  Candidate concept and relation collections also fail before normalization
  when they exceed graph limits.
  Every benchmark example must be a reviewed concept or relation, preventing
  malformed feedback from disappearing during scoring. The required
  representative set includes a relation-quality case with accepted and
  rejected edges, so edge precision and suppression remain promotion gates.
- `server.mjs` is a dependency-free reference host and extraction endpoint. It
  provides static allowlisting, request limits, rate limiting, security
  headers, optional bearer-token authentication, readiness, privacy-safe
  metrics, bounded latency telemetry, structured logs, and provider
  cancellation. Client disconnects also race the request handler itself, so a
  non-conforming provider cannot keep a dead HTTP request open until the full
  provider timeout; its still-running promise remains counted for capacity and
  graceful drain. When graceful shutdown aborts active extraction, the gateway
  returns a retryable `503` with bounded `Retry-After` guidance rather than
  misclassifying deployment drain as a provider `502`. Runtime learning-note rendering uses incremental fatal UTF-8
  decoding, matching Pages publication without rejecting a valid multibyte
  character split across a bounded read; the shared note-page boundary helper
  also avoids returning a lone surrogate when an astral character lands on a
  title or summary limit. Both byte and character read helpers
  reject non-finite and over-ceiling limits so a bad caller cannot silently
  request an unbounded asset read. Production
  deployments should add authentication, TLS, and a shared rate limiter at a
  trusted gateway. The CLI additionally fails extraction closed on non-loopback
  hosts until a bearer token is configured, while loopback development remains
  convenient; operational metrics follow the same non-loopback authentication
  default. Readiness also fails closed when either required bearer secret is
  missing, so an externally bound container cannot enter service while its
  extraction or observability boundary is unusable. The extraction boundary
  checks feedback cardinality before
  mapping or serializing provider hints, preventing oversized arrays from
  creating avoidable intermediate allocations. The server enforces the
  process-local extraction budget with bounded `RateLimit-Limit`,
  `RateLimit-Remaining`, and `RateLimit-Reset` response headers; a trusted
  gateway remains authoritative for multi-instance deployments. It also
  enforces the extractor-request schema's closed root, document, and feedback
  shapes, so
  unknown fields fail before they can be silently discarded. It also rejects
  duplicate aliases and contradictory decisions for the same concept or
  relation at the gateway, matching the browser adapter's canonical feedback
  contract and preventing provider behavior from depending on feedback order.
  Every application response receives a request ID, and
  structured application-error logs retain that correlation ID without
  recording request content.
  The request reader validates numeric, safe `Content-Length` values and
  compares them with the received byte count before JSON parsing, so
  truncated keep-alive requests cannot become valid extraction envelopes.
  Wrong-method extraction requests drain any supplied body before returning
  `405`, preserving framing when clients reuse the connection.
  The generic unsupported-method fallback applies the same drain rule to
  non-extraction routes.
  All non-POST requests begin that bounded drain at the server boundary, so
  unknown-path and body-bearing read-only probes preserve connection framing
  too.
  Readiness also performs bounded fatal-UTF-8 decoding of every published
  shell asset, so a corrupted text asset cannot make the server report ready
  while the browser workbench is unable to execute or render.
  Static ETags are cached per allowed asset using file metadata, rendered byte
  length, origin, and build revision as the invalidation signature; the cache
  is bounded by the public asset set so repeated requests do not rehash every
  response indefinitely.
  Client-aborted extraction requests are counted separately from provider
  failures and logged as bounded `499` events with request ID and latency, so
  cancellation pressure is observable without recording document content.
  It also validates that `version.json` is well-formed, uses a real calendar
  date rather than a parser-rollover value, is non-future, and matches the
  running package version before advertising the deployment as ready.
  Non-loopback startup also fails readiness when the sanitized source build
  revision is unknown, keeping externally served health metadata traceable to a
  release artifact; loopback development remains revision-agnostic.
  The bounded in-process client-window limiter expires stale entries on a
  short periodic sweep instead of scanning the full key map for every
  extraction request, keeping abuse protection from adding avoidable
  per-request CPU work under load.
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
  build from deleting its own inputs. Pages builds also run the artifact gallery
  consistency gate before copying or rewriting the public bundle, so direct
  publication commands cannot bypass the release contract. The builder writes
  into a private staging directory and swaps it into the requested output only
  after generation, cache revision, manifest, and aggregate-size checks pass;
  a failed commit restores the previous output. Bounded source-note reads and
  staged asset copies use `O_NOFOLLOW` where supported, closing the
  validation-to-publication symlink race.
- `scripts/check-contracts.mjs` keeps the public JSON schemas coupled to the
  runtime safety constants, including the extractor request and Obsidian
  manifest boundaries. It is dependency-free and runs in CI, so changing an
  ingestion or projection bound requires updating the published contract in
  the same change. Release, Pages, artifact, and health command metadata also
  use the shared duplicate-key-safe JSON parser, so standalone gates cannot
  silently accept a different object interpretation from the runtime.
- `curriculum.js` is the shared browser and release-time curriculum catalog.
  `scripts/check-release.mjs` consumes it directly and keeps the learning
  curriculum coupled across browser metadata, static filter counts, no-script HTML links and titles, the Markdown note index, and the
  published note asset set, including browser-to-note title and question
  parity, preventing a new lesson from becoming discoverable or mislabeled in
  only one surface.
- `scripts/check-artifacts.mjs` keeps the public community-artifact gallery
  honest. It compares visible cards with their JSON-LD `ItemList`, checks
  ordering, titles, commands, relative path containment, non-empty targets,
  and publication in the shared asset contract. `check-release.mjs` runs it
  so a broken or undiscoverable runnable artifact blocks release verification.
  `tests/artifacts-smoke.mjs` executes every advertised card command, so
  argument-requiring tools expose a working `--help` entry point instead of
  leaving a copy-paste failure on the public page.
- The GitHub workflow layer adds two independent production gates: CodeQL
  analyzes the JavaScript/TypeScript surface with the extended security query
  set, while OpenSSF Scorecard publishes repository supply-chain posture
  findings. Both workflows use immutable action commits, bounded execution,
  credential-free checkout, and explicit permissions; `check-release.mjs`
  rejects any future workflow that reintroduces mutable action references.
- `RUNBOOK.md` turns release, health, graceful-drain, browser-backup, incident,
  and rollback contracts into repeatable operator procedures. It intentionally
  keeps secrets and user graph payloads out of commands and observability
  examples.
- `scripts/check-accessibility.mjs` audits the generated HTML release surface
  without a third-party parser. It checks document language and titles,
  heading progression, duplicate IDs, named controls/links/buttons, image
  alternative text, and accessible image roles; its tamper fixture runs in the
  standard smoke suite.
- `scripts/check-performance.mjs` keeps the uncompressed critical browser shell
  below a 1 MB budget, with a separate 768 KB JavaScript budget and smaller
  HTML/CSS limits. The budget is intentionally measured over the browser's
  bounded source assets, not an optimistic compressed-size estimate.
- `scripts/public-origin.mjs` centralizes optional deployment-origin
  normalization and fail-closed validation. A non-empty invalid origin stops
  both Node startup and Pages publication instead of silently dropping
  canonical, feed, sitemap, or same-origin request policy.
- `scripts/service-worker-cache.mjs` is the deployment-artifact integrity
  boundary. Pages builds derive the service-worker cache revision from the
  complete final bundle, and `verify-pages.mjs` recomputes that revision before
  publication so generated assets cannot be deployed under a stale shell-cache
  identity.
- The install manifest publishes explicit 192×192 and 512×512 PNG icons in
  addition to the vector fallback. Release checks validate their PNG signatures
  and dimensions, and the same files are served and precached as shell assets.
- The branded `404.html` is rewritten with the configured public origin during
  Pages builds and at the Node response boundary, so nested missing URLs do not
  resolve its recovery links beneath the missing path.
- `scripts/note-page.mjs` is the shared crawler-readable learning-note page
  renderer used by the Node host and generated Pages artifacts; it keeps
  note-specific metadata, Article JSON-LD, feed discovery, the interactive
  workbench link, and the no-script content-security policy consistent. Feed
  entries use the same note-derived summaries in Node and Pages deployments.
  Social metadata points to the generated 1200×630 PNG card for broad crawler
  compatibility; the original SVG remains available as a crisp local asset.
- `app.js` is orchestration and presentation. It should call domain functions
  rather than reimplementing graph mutations in event handlers. Review controls
  share one conflict-safe persistence path across list and inspector surfaces.
  Browser release metadata, source-review edits, and feedback export ordering
  use the shared timestamp parser, keeping visible and exported chronology
  aligned with the graph domain boundary.
  The workbench also surfaces browser offline state so local graph work remains
  distinguishable from remote extractor availability.
  It tracks the editor draft independently from graph durability, warning
  before a populated title, URI, or document is discarded and clearing the
  warning only after a successful build commits that draft.
  The same three fields have a bounded, duplicate-key-safe local recovery
  record for reload or browser eviction; recovery never overwrites a non-empty
  editor and successful ingestion removes the copy.
  All copy and share surfaces use one bounded helper that prefers the
  asynchronous Clipboard API and falls back to a temporary textarea when
  browser permissions or secure-context policy prevent it.
  The runtime error panel can download raw graph/history recovery snapshots
  before reload, or a full backup when no raw recovery payload exists.
  Search indexes, source previews, metadata summaries, graph labels, and
  Mermaid labels use the shared code-point-safe text boundary as well, so a
  long Unicode value cannot render a split surrogate in the workbench.
  Startup release metadata and learning-note export fetches reject opaque or
  cross-origin final responses before reading them, keeping same-origin static
  asset trust explicit even before service-worker control is established.
  Graph, backup, and JSON-LD exports preflight their source/evidence byte budget
  before JSON serialization, avoiding a second large in-memory copy when a
  payload is already beyond the export safety ceiling.
  Markdown projections canonicalize set-like graph collections before rendering
  so direct downloads are byte-stable across equivalent array orderings.
  Markdown, Obsidian, feedback, and revision-diff exports use the same
  preflight before constructing their projection strings.
  The Obsidian ZIP writer also bounds file count and validates archive-limit
  configuration before allocating local and central directory parts.
  Binary download helpers require actual byte buffers or views before creating
  a Blob, keeping generated ZIP exports on the same byte-data contract as ZIP
  imports and response readers.
  Service-worker upgrades are user-coordinated: the first install can activate
  immediately, while later releases wait for an explicit reload so an active
  workbench is not mixed with assets from two versions. Published service-worker
  cache names are scoped to the deployment revision (the Pages build derives a
  bounded digest from the published asset set, while Node deployments use
  `BUILD_REVISION`); the checked-in source keeps the release-version fallback.
  Shell cache entries use
  pathname-only keys so cache-busting query strings cannot create unbounded
  duplicate copies of the same asset; query-bearing responses are never allowed
  to overwrite the canonical cache entry. Unknown same-origin navigations can
  still fall back to the cached index while offline, but are not added to the
  bounded shell cache. The same navigation fallback applies when the network
  responds with a transient non-OK status, while online 4xx responses pass
  through so deployed not-found pages remain visible. Cache API read failures are treated
  as cache misses so they cannot reject a recoverable network response.
  Opaque responses and final network responses that cross the application
  origin are rejected before they can reach or poison the shell cache, and
  HTML responses are also rejected for non-HTML shell paths so a gateway login
  or error page cannot be cached as JavaScript, CSS, JSON, or SVG.
  both response headers and body reads have the same bounded timeout.
  Install-time shell precaching uses that same bounded fetch path instead of
  raw `cache.addAll`, so a stalled or oversized deployment asset cannot hang
  first install. Cache open, match, put, delete, and client-claim operations
  also have bounded waits, so cache pressure cannot hold a fresh response or
  activation indefinitely.
  Activation cleanup treats stale-cache deletion and client claiming as
  best-effort, preventing one broken Cache API operation from stranding a
  valid worker update.
  Shell stream readers validate result shapes and safe chunk byte lengths
  before caching, so malformed network bodies fail closed instead of becoming
  an unbounded read or bypassing the response budget.
  Response-reader cancellation is non-blocking as well, so an ignored stream
  cancel cannot extend the worker's bounded network fallback.
  Responses discarded in favor of a cached shell or offline index are canceled
  before the fallback is returned, so transient failures do not retain unread
  network bodies.
  Shell installation uses bounded parallel precaching rather than an
  unbounded fan-out or unnecessarily slow serial asset fetch.
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
5. Future extraction receives only bounded fresh labels, aliases, endpoints,
   and statuses—not source evidence. Callers must explicitly opt into stale
   historical memory for audit or migration workflows.
   The shared extraction boundary also removes provider-returned concepts and
   relations that match a current rejected decision, including their dependent
   relations. Relation suppression matches the canonical endpoint pair and
   relation label, so rejecting one semantic edge cannot erase a differently
   labeled relation between the same concepts. This prevents a remote provider
   that ignores guidance from silently reintroducing rejected knowledge;
   accepted feedback remains
   advisory and does not auto-approve provider output.
   `inspectGraph()` reports the unique guidance items available versus the
   bounded provider-context count, including whether truncation is occurring.
   If the compact provider request would exceed either the reviewed-item or
   serialized feedback bound, the browser rejects the extraction rather than
   sending a partial learning context.
   Feedback imported before its target graph exists is canonicalized by
   portable concept labels or relation endpoint labels, so workspace-specific
   IDs cannot preserve contradictory learning hints as separate examples.
   Source metadata review has a one-click browser path that records the current
   review timestamp as an undoable manual revision; repeated same-day reviews
   are idempotent, and future-dated imported timestamps are repaired rather
   than trusted. Source quality remains an explicit human choice rather than
   being inferred from that timestamp.
   The source inspector also rejects future review dates at the interactive
   edit boundary, preventing ordinary users from creating chronology that the
   health and learning gates would later distrust.
   The workbench can re-run every saved source through the current extractor
   and fresh reviewed guidance; successful source replacements accumulate in
   memory and commit once against the initial graph version and fingerprint,
   while cancellation, provider failures, and cross-tab conflicts preserve
   the last saved graph.
   Batch document ingestion preserves files that fail with bounded transient
   remote errors in the visible queue for an explicit retry, while
   deterministic validation failures do not create an endless retry loop.
   The deterministic learning-loop artifact uses this same fresh-only guidance
   boundary, so its runnable proof matches production behavior for both
   accepted/rejected concepts and accepted/rejected relations. Its comparison
   reports the relation delta separately, preventing a concept-only learning
   proof from being mistaken for complete graph improvement.
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
monotonically, so an older projection cannot undo a newer review; an empty
imported timestamp also cannot erase trusted chronology. Explicit clearing
remains available through the in-app review controls.
Source title, URI, and quality edits use the same rule in both the workbench and
Obsidian projections, so source-review coverage cannot become stale merely
because the exported date was left unchanged.

Health guidance counts use the same fresh-only filter as extraction requests;
stale retained memory is reported separately as review debt.
Bounded extractor-feedback, context statistics, and feedback-dataset ordering
also use trusted review timestamps, so future-dated memory cannot crowd out current guidance
when the projection budget is saturated.
The same trusted-past rule governs same-version graph freshness and bounded
source retention, so fabricated future chronology cannot displace current graph
state or source documents. Health coverage and Obsidian timestamp merges apply
the same rule, while preserving future values for audit rather than treating
them as fresh evidence.
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
Items with missing, malformed, or future-dated review timestamps are treated
as stale for guidance purposes and must be reviewed before they become active
again. The future timestamp is retained for audit, but it cannot establish
freshness or outrank a trusted current decision during feedback conflict
resolution.
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
representation is touched. If a replacement has no source-linked concepts or
relations while the old source did, the domain operation returns the original
graph unchanged; intentionally clearing a source remains an explicit
remove-source action rather than an extractor failure. Automatic saved-source
rebuilds additionally preserve each previously represented category: a provider
cannot erase every grounded concept or every grounded relation while retaining
only the other category. Explicit interactive replacement remains able to prune
a category when the user intentionally supplies a materially different source.
The orchestration adapter repeats the category check after normalization, so an
alternate replacement implementation cannot bypass the automatic rebuild
invariant. Successful rebuilds also return bounded source identity and pruning
counts so the workbench can explain semantic change without exporting source
content.

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
evidence records, omitted provenance references, and clipped aliases. The
browser warns the
operator to restore the original export before making edits instead of
silently treating the partial graph as complete. Alias clipping is retained as
`integrity.truncated.aliases` and repeated in health, diff, and JSON-LD
projections. Invalid entries that cannot
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

`scripts/run-tests.mjs` first builds and independently verifies a fresh Pages
artifact, then discovers JavaScript source files for syntax checks and executes
every `tests/*.mjs` regression test in an isolated child process. Generated
bundles and dependency directories are excluded from discovery; new source and
test files are included automatically, so this command is a clean-checkout
behavioral gate rather than a syntax-only check.

The same test command runs `scripts/check-release.mjs` on each supported
runtime, so Node-version differences cannot bypass deployment-contract checks.

The canonical `production:check` also runs `release:check` and
`smoke:server`, coupling the behavioral suite to package-lock, release
metadata, workflow permissions and pinning, public/offline asset parity, OCI
provenance, and the real standalone server lifecycle. It verifies the Pages
artifact before artifact-dependent tests and again after all checks, so a test
that rebuilds or mutates `dist/` cannot leave an unverified final publication.

The same checks run across Node 22 and 24, build the container, verify
readiness, and exercise static delivery and offline service-worker behavior.
`npm run smoke:server` separately exercises the real standalone Node process,
including its authenticated readiness boundary and SIGTERM lifecycle; the
verification workflow calls this same command rather than maintaining a
second shell-only implementation.

Pages builds add a bounded source revision to the generated `version.json`.
The publication workflow supplies `GITHUB_SHA`, and its post-deploy probe
requires the served revision to match that commit. Local builds use `unknown`
unless `BUILD_REVISION` is supplied, so development artifacts remain usable
without pretending to have release provenance.
