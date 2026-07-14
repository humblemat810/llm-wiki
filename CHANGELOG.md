# Changelog

All notable changes to LLM Field Notes are documented here.

## [Unreleased]

### Added

- Made release verification enforce the digest-pinned Node 22 container
  baseline, keeping deployment runtime drift visible before publication.
- Added package-synchronized OCI version metadata to production container
  images for registry and incident-response traceability.
- Made container CI pass and verify the repository version label explicitly,
  catching image metadata drift before deployment.
- Added one-click native sharing for the privacy-safe Markdown graph projection,
  with clipboard and download fallbacks for browsers without file sharing.
- Added a guarded `Ctrl/Cmd+Enter` document-editor shortcut for the main ingest
  action.
- Added a visible keyboard hint beside the graph-build action so the shortcut
  is discoverable without opening documentation.
- Made the ingest action row wrap on narrow screens so the keyboard hint and
  cancellation controls remain usable on mobile.
- Declared the published CC BY 4.0 license in package metadata and release
  validation for machine-readable distribution tooling.
- Extended the CI compatibility matrix through Node 24 while retaining the
  Node 18, 20, and 22 lanes.
- Made oversized-upload smoke checks portable across Node runtime versions
  whose clients surface the server's deliberate early connection close as
  `ECONNRESET`.
- Made container CI run the production image read-only with a bounded temporary
  filesystem, catching accidental runtime writes before deployment.
- Documented the read-only container invocation in deployment and security
  guidance for operators.
- Added least-privilege container smoke coverage with all Linux capabilities
  dropped and `no-new-privileges` enabled.
- Added weekly Dependabot coverage for the digest-pinned Docker base image,
  alongside workflow-action and npm metadata updates.
- Updated the digest-pinned production container baseline from Node 20 to
  Node 22 while retaining the existing Node 18/20/22 compatibility matrix.
- Added a type-specific, fail-closed Obsidian frontmatter contract that
  rejects unknown keys, incompatible fields, and malformed read-only metadata
  before projection edits can reach the graph.
- Added crash-consistent graph-store write ordering: ordinary mutations commit
  the newest graph before undo history, while destructive clears preserve the
  undo snapshot before removing graph state.
- Added static DOM and ARIA contract checks for unique IDs and resolvable
  accessibility references in the public workbench.
- Fixed health validation bounds for the complete 15,500-item live-plus-
  reusable extractor-guidance inventory, keeping runtime validation aligned
  with the published health schema.
- Made every runtime health-count limit part of the exported contract audit
  and declared the previously implicit graph, provenance, review, learning,
  and integrity counts in `health.schema.json`.
- Extended exhaustive health-contract parity to percentage and boolean
  diagnostics, including provenance, source-review, evidence-grounding, and
  redaction fields.
- Added schema-integrity validation that rejects duplicate JSON object keys
  before published contracts are parsed by the runtime audit.
- Corrected health maxima for orphaned and ambiguous provenance references to
  include direct references plus all retained evidence records.
- Closed health validation gaps for emitted grounding, dropped-item, review,
  ambiguity, and source-quality diagnostics.
- Added cross-field health invariants for graph partitions, support totals,
  source-quality counts, feedback retention, and evidence grounding.
- Bounded reviewed-example fields before evaluation matching and fingerprinting,
  including identities, aliases, evidence, and provenance references.
- Reserved bounded feedback-export capacity for current reviewed decisions so
  detached learning memory cannot hide a newer human correction.
- Made bounded feedback exports deterministic by review freshness, preventing
  arbitrary learning-memory array order from evicting newer corrections.
- Made empty Obsidian vault exports byte-stable by using the graph domain's
  deterministic epoch timestamp instead of the wall clock.
- Made direct Markdown projections canonicalize set-like graph collections,
  keeping downloads byte-stable when equivalent graph arrays are reordered.
- Added a dependency-free runtime/schema contract audit that fails when
  public graph, feedback, diff, JSON-LD, extractor-request, or vault-manifest
  bounds drift from `graph-core.js`.
- Made the extraction server enforce the closed extractor-request root,
  document, and feedback shapes instead of silently discarding unknown fields.
- Added omission diagnostics to bounded feedback exports and an explicit
  confirmation before importing a partial feedback dataset.
- Added a `reviewQueueTruncated` health diagnostic so large graphs disclose
  when lower-priority review candidates are outside the bounded queue.
- Tightened health-report validation to reject malformed boolean diagnostics
  before reports reach automation or promotion gates.
- Made the evaluation CLI reject feedback exports marked as partial, preventing
  incomplete review datasets from being scored as complete benchmarks.
- Added graph, health, diff, and UI diagnostics for evidence records and
  provenance references omitted by nested safety limits, and made source
  merges/replacements refuse any truncated import until the original export is
  restored.
- Added bounded graph-integrity diagnostics to JSON-LD projections so external
  consumers can see truncation, dropped-entry, ambiguity, and contradiction
  state alongside the verified graph fingerprint.
- Made browser and server extractor boundaries reject oversized nested evidence,
  evidence text, and provenance-reference collections before normalization,
  preventing provider output from silently losing grounding.
- Made the browser extractor reject oversized reviewed-guidance collections or
  serialized feedback before making a request, preventing partial learning
  context from reaching a provider.
- Added a centralized graph-store integrity guard that rejects mutations to
  truncated imports while allowing a clean original-export restore.
- Added actionable workbench messaging for integrity-blocked writes, directing
  users to restore the original export instead of retrying a guaranteed failure.
- Added explicit omission counts to bounded Mermaid Markdown views so external
  Obsidian projections distinguish the visual safety cap from complete indexes.
- Aligned graph normalization and provider responses with the published
  eight-record evidence bound, disclosing imported evidence records omitted
  beyond that retained representation.
- Quantified live graph-rendering omissions in the workbench summary so
  viewport safety caps are distinguishable from missing graph data.
- Extended the runtime/schema contract audit to cover JSON-LD evidence
  cardinality, keeping semantic projections tied to the retained graph bound.
- Extended evidence-bound contract checks to diff and health projections,
  preventing downstream artifact drift.
- Added a health CLI gate for bounded review-queue truncation, allowing
  production automation to fail when actionable review work is incomplete.
- Added a health CLI gate for sampled evidence grounding, allowing production
  automation to reject coverage metrics derived from incomplete inspection.
- Added a health CLI gate for truncated extractor guidance, allowing learning
  evaluations to require the complete retained review context.
- Promoted health-gate bounds into the shared runtime/schema contract audit so
  automation thresholds cannot drift from their published schema limits.
- Made the health CLI consume the same exported runtime gate limits, removing a
  second independently maintained threshold table.
- Added the new completeness gates to the production security checklist so
  deployments can reject sampled review, grounding, and learning diagnostics.
- Made the contract checker iterate every exported health-gate limit, so new
  automation thresholds cannot be added without a matching schema bound.
- Fixed bounded server note reads to decode UTF-8 incrementally, so valid
  multibyte text at a read boundary is retained without weakening malformed
  encoding rejection.
- Required runtime UTF-8 character windows to be finite and positive, closing
  an unbounded-read fallback if a caller supplies an invalid limit.
- Added a pre-serialization source/evidence budget for graph, backup, and
  JSON-LD exports so oversized payloads fail before duplicating large text in a
  second in-memory string.
- Made the command-line server fail extraction closed on non-loopback hosts
  without `EXTRACTOR_AUTH_TOKEN`, while keeping unauthenticated loopback
  development convenient.
- Enforced the aggregate source-text budget during graph imports, retaining
  the newest deterministic documents and reporting older source records
  omitted by the bound.
- Prevented new source merges and replacements from mutating a graph whose
  imported source text was already truncated, requiring restoration of the
  original export first.
- Extended container CI smoke coverage to verify that non-loopback extraction
  is unavailable without configured authentication.
- Applied the same non-loopback fail-closed default to operational metrics
  when `METRICS_AUTH_TOKEN` is absent.
- Bounded localStorage and IndexedDB hydration, native storage events, and
  durable writes with the same cross-tab value ceiling.
- Preserved failed graph and history rollback inputs in recovery snapshots when
  storage errors prevent atomic restoration.
- Routed browser cross-tab updates through the storage adapter alone, removing
  the duplicate raw listener that could render stale graph state before the
  freshness check.
- Made offline navigations fall back to the cached app shell after transient
  non-OK network responses, not only after transport failures.
- Treated service-worker cache read failures as cache misses so an unavailable
  Cache API cannot reject a recoverable network response.
- Bounded service-worker static response bodies as well as response headers, so
  stalled or oversized assets fall back to the cached shell.
- Made stale cross-tab graph repair use optimistic version and fingerprint
  preconditions so concurrent newer commits cannot be overwritten.
- Extended source/evidence export preflights to Markdown, Obsidian, feedback,
  and revision-diff projections before their large strings are serialized.
- Hardened the Obsidian ZIP writer with file-count, file-shape, and archive-limit
  validation before allocating archive parts.
- Added an explicit abort race around remote extractor fetches so ignored
  cancellation signals cannot leave requests pending beyond the configured
  timeout.
- Extended the remote extractor timeout race through non-streaming
  `arrayBuffer()` response reads, preventing a stalled provider body from
  outliving the request timeout.
- Applied the same timeout race to browser learning-note and release-metadata
  `arrayBuffer()` reads, with a focused smoke test for permanently pending
  response bodies.
- Made browser and remote streamed response reads race cancellation signals,
  so adapters that ignore `reader.cancel()` cannot leave requests pending.
- Routed service-worker install precaching through the bounded fetch and
  response-body checks, preventing stalled or oversized shell assets from
  hanging first install.
- Capped exported server reader arguments at the shared per-asset ceiling,
  closing the finite-but-enormous limit bypass as well as the infinite case.
- Made retryable remote response cleanup non-blocking, preventing a hanging
  provider `body.cancel()` promise from suppressing bounded retries.
- Made oversized browser and remote stream cleanup non-blocking, preventing
  a hanging `reader.cancel()` from masking the response-size rejection.
- Added bounded IndexedDB write/delete transaction timeouts so stalled durable
  operations fall back visibly instead of leaving `flush()` pending forever.
- Added bounded service-worker Cache API operations so cache pressure cannot
  hold fresh responses, installation, or activation indefinitely.
- Fixed repeated manual confirmation of an existing relation so its feedback
  history increments consistently with concept review and new relation edits.
- Made oversized feedback-file imports fail closed instead of silently
  slicing human decisions beyond the published dataset bound.
- Made evaluation validation recompute recall, suppression, and evidence
  coverage from counts, rejecting fabricated promotion metrics.
- Required bounded, parseable evaluation timestamps so promotion artifacts retain
  machine-readable provenance.
- Required full RFC3339-style evaluation date-times instead of accepting
  ambiguous date-only provenance.
- Aligned runtime evaluation validation with the closed schema by rejecting
  unknown fields at every report layer.
- Made oversized reviewed datasets fail closed before evaluation matching,
  preventing silent benchmark truncation under a full dataset fingerprint.
- Made oversized candidate concept and relation collections fail closed before
  evaluation normalization instead of scoring silently truncated output.
- Made evaluation reject malformed or unreviewed benchmark examples instead of
  silently filtering them from the scored dataset.
- Made graph writes, undo, restore, and clear fail closed when their raw
  pre-mutation storage snapshot cannot be read, preventing destructive rollback
  from unknown state.
- Added runtime validation for privacy-safe health reports so malformed counts,
  derived relationships, timestamps, and review metadata fail closed before
  CLI automation consumes them.
- Extended health validation to cover CLI quality-gate thresholds and
  pass/fail consistency.
- Capped oversized graph-store configuration values so custom undo-history and
  persisted-state limits cannot bypass the module’s memory and storage bounds.
- Added UTF-8 byte accounting to persisted graph limits so Unicode-heavy state
  cannot bypass the safety budget through a character-count mismatch.
- Bounded Pages learning-note reads after preflight so a file-size race cannot
  turn a valid deployment asset into an unbounded build-memory read.
- Made release asset checks resolve real paths and reject public symlinks that
  escape the repository, matching runtime and Pages containment guarantees.
- Rejected malformed UTF-8 at CLI, HTTP, browser note, and remote-extractor
  text boundaries instead of silently replacing bytes.
- Applied the same fatal decoding rule to non-streaming `arrayBuffer()`
  fallbacks used by browser and remote extraction clients.
- Routed browser document and graph-file imports through bounded fatal UTF-8
  decoding before parsing.
- Made browser file and learning-note response fallbacks fail closed when byte
  access is unavailable, avoiding replacement-decoded text.
- Made remote extractor responses without raw byte access fail closed instead
  of using replacement-decoded `response.json()` fallbacks.
- Made browser document and feedback imports use Unicode-safe byte envelopes
  before applying their exact decoded character limits.
- Connected browser learning-note timeouts to their active response readers so
  stalled bodies are canceled instead of remaining live after a request abort.
- Rejected oversized extractor feedback arrays before mapping or serializing
  their entries, reducing input-amplification pressure at the HTTP boundary.
- Aligned gateway feedback validation with the browser adapter by rejecting
  duplicate aliases before provider requests.
- Aligned feedback, diff, and JSON-LD schemas with runtime alias
  canonicalization by requiring unique alias arrays.
- Applied the same canonical uniqueness rule to exported provenance source
  references.
- Isolated the durable storage pending-write marker from BroadcastChannel
  synchronization so internal recovery bookkeeping cannot enter graph state.
- Bounded and type-checked cross-tab BroadcastChannel values before they enter
  browser storage or subscriber notifications.
- Added a bounded key-name check to cross-tab storage messages before they reach
  the browser storage map.
- Made fallback storage clearing namespace-safe so it cannot delete unrelated
  localStorage data from the hosting origin.
- Made durable storage clearing include keys still represented only by the
  pending-write recovery marker.
- Aligned Node learning-note rendering and readiness with the same fatal
  UTF-8 contract used by Pages publication.
- Capped recovery snapshots so oversized malformed state cannot be duplicated
  into a second unsafe storage payload.
- Surfaced suppressed recovery captures in the workbench with a direct backup
  action instead of hiding the safety refusal.
- Preflighted the aggregate Pages source-asset budget before loading learning-note contents, preventing large valid note collections from exhausting build memory before the final artifact check.
- Increased the container readiness probe window to 10 seconds so bounded static startup validation does not flap unhealthy on slower hosts.
- Canonicalized service-worker shell cache keys to pathnames, and excluded query-bearing responses from writes, so arbitrary variants cannot create or overwrite duplicate cached assets.
- Kept unknown same-origin navigations eligible for offline index fallback without caching arbitrary successful paths, preventing service-worker cache growth from unbounded routes.
- Aligned backup fingerprints with the newest retained undo-history window so oversized imports cannot authenticate discarded history as if it were restored.
- Refused Pages output paths that overlap published source assets, preventing an invalid custom destination from deleting notes before the build fails.
- Made release validation enforce the same 10 MB per-asset publication limit as Node serving and Pages builds.
- Escaped enum-derived status and source-quality labels in workbench HTML alongside user-authored graph text.
- Retained the newest deterministic source window when normalizing oversized document imports, preventing old sources from crowding out newly ingested knowledge.
- Implemented newest-source retention with bounded intermediate memory, preserving import safety for unusually large document arrays.
- Bounded document identity inputs used by newest-source selection before timestamp and tie-break comparison.
- Precomputed bounded document retention keys once per candidate, avoiding repeated large-text hashing during import selection.
- Made feedback dataset imports atomic at the graph revision ceiling, preventing early decisions from being committed when later entries cannot fit.
- Added a final fail-closed revision guard to Obsidian feedback batches so a future version-boundary failure cannot report a successful partial mutation.
- Made JSON-LD entity-ID escaping unambiguous so literal IDs cannot collide with IDs containing encoded punctuation.
- Added shared runtime validation for evaluation artifacts, rejecting impossible counts, inconsistent aggregate metrics, incomplete freshness diagnostics, and oversized promotion reports before comparison.
- Align malformed-learning diagnostics with the same newest retained window used by normalization, preventing integrity reports from describing evicted entries.
- Preserve the freshest reusable learning examples by review timestamp when bounded extractor guidance must reserve capacity for current reviewed graph items.
- Added integrity and health diagnostics for clipped document and evidence
  text during graph normalization, making content loss visible and gateable
  alongside collection truncation.
- Explained collection and text-level import truncation in the live health
  strip so users can distinguish omitted records from clipped source material.
- Added bounded diagnostics for contradictory review statuses found while
  duplicate concept or relation records are normalized, including health and
  live-workbench warnings.
- Included contradictory-review diagnostics in Markdown/Obsidian projections
  and revision-diff previews so external views retain the same audit trail.
- Updated the revision-diff schema and tests to accept contradictory-review
  identity changes emitted by the normalized graph diff.
- Added clipped document/evidence text counters to the revision-diff schema so
  integrity-only diffs remain valid for standard JSON Schema validators.
- Expanded the evaluation-comparison bounds to cover all emitted quality
  metrics and regression names, keeping promotion reports schema-valid.
- Made the evaluation comparison CLI import-safe so tests and automation can
  reuse its promotion function without triggering command-line usage failures.
- Restricted extractor guidance to the declared request fields, preventing
  evidence-bearing reusable memory from leaking into or invalidating provider
  requests.
- Added the same strict feedback compaction at the remote adapter boundary, so
  direct callers cannot send malformed or evidence-bearing hints upstream.
- Added a serialized UTF-8 request-size guard so Unicode-heavy extraction
  requests fail locally before crossing the server’s 2 MB body boundary.
- Made the backup schema identifier file-relative so standard validators can
  resolve its bundled graph reference without attempting a network fetch.
- Shared the extractor adapter’s 2 MB request-byte limit with the server so
  client and gateway bounds cannot drift independently.
- Centralized the extractor feedback-label length bound in the graph contract,
  keeping adapter and server validation aligned.
- Reused that same graph constant for normalized concept, alias, and relation
  endpoint labels, eliminating duplicated domain truncation literals.
- Applied the shared concept-label bound to Obsidian alias parsing as well,
  keeping external corrections consistent with graph normalization.
- Abort incomplete extraction uploads immediately when the client closes the
  request stream, avoiding timeout-sized resource retention for truncated
  bodies.
- Surface cross-tab localStorage and BroadcastChannel changes through the
  fallback storage adapter when IndexedDB is unavailable, keeping the
  workbench synchronized in degraded persistence environments.
- Keep undo history intact when a quota fallback cannot write the replacement
  graph, and restore graph/history keys independently during rollback.
- Make remote response-stream cancellation fail closed even when a provider
  reader ignores or throws during cancellation.
- Bound simultaneous server-side provider extractions and expose capacity
  rejections through metrics, preventing long-running requests from exhausting
  provider resources.
- Bound the GitHub Pages deployment job to 20 minutes so stalled publication
  cannot consume CI capacity indefinitely.
- Reserve bounded extractor-guidance capacity for current reviewed graph items
  so a full historical learning ledger cannot completely crowd out new live
  representation decisions.
- Reject extraction requests early when provider capacity is already full,
  before buffering their request bodies, while retaining a race-safe final
  capacity check after validation.
- Expose the configured extractor concurrency ceiling in operational metrics,
  making capacity incidents diagnosable without process inspection.
- Add accessible names and live-region semantics to graph health diagnostics
  and the dynamic review queue.
- Give the live review queue an explicit region role so its accessible name is
  exposed consistently across assistive technologies.
- Map remote source-replacement cancellation errors to the explicit
  source-preserved message instead of exposing a generic extractor failure.
- Make single-document cancellation explicitly disclose that no graph changes
  were written.
- Rejected relation label edits that would collide with an existing
  same-endpoint relation instead of silently collapsing semantic edges.
- Projection feedback imports now report malformed direct feedback items as
  skipped, keeping the shared Obsidian mutation boundary auditable when a batch
  contains both valid and invalid entries.
- Routed bounded evidence-grounding failures into the affected concept or
  relation's review-queue candidate, making paraphrased evidence actionable
  without exposing source text or evidence quotes in health exports.
- Made programmatic server idle waits time-bounded when a provider ignores
  cancellation, while keeping in-flight metrics truthful until the provider
  promise actually settles.
- Made standalone shutdown return a non-zero exit when its bounded provider
  drain expires instead of reporting a clean stop.
- Refreshed review timestamps for substantive Obsidian corrections so exported
  stale frontmatter cannot suppress newly imported learning, while older
  projections cannot roll newer review time backward.
- Reused one bounded graph inspection for the live health strip and review queue,
  avoiding duplicate evidence-grounding scans during a workbench render.
- Preserved malformed or over-capacity undo history supplied by backup restores
  before applying the local history bound.
- Preserved imported history evicted when backup restore also retains the
  current graph as an undo snapshot.
- Refreshed source review time for substantive title, URI, and quality metadata
  edits when no replacement review date was explicitly supplied.
- Reused the emitted health report as the gate input in the health CLI, avoiding
  a second full normalization and grounding pass on large graphs.
- Made pending IndexedDB-write generations instance-unique so rapid same-key
  writes from separate tabs cannot clear one another's recovery marker.
- Equal-timestamp learning conflicts now use a stable canonical tie-break instead
  of depending on import order.
- Canonicalized live reviewed-concept and relation ordering in extractor
  guidance so graph round-trips cannot change bounded feedback payloads.
- Made untimestamped contradictory feedback resolve deterministically, matching
  the order-independent dataset fingerprint contract.
- Made source replacement reject over-limit filename-derived titles consistently
  for local and remote extraction.
- Replaced random source-ID collision repairs with deterministic bounded IDs, so
  equivalent provider imports preserve provenance identity.
- Made duplicate relation-ID suffixes follow stable semantic ordering instead of
  imported array order.
- Made relation-ID repair avoid collisions between explicit IDs and generated
  suffixes such as `edge` and `edge-2`.
- Remapped ambiguous relation learning references by verified endpoints and
  labels, avoiding unsafe ID-only attachment after malformed imports.
- Canonicalized concept alias ordering across imports, merges, and concept
  consolidation so alias reordering cannot drift graph identity.
- Canonicalized node and evidence provenance-reference ordering while preserving
  the order of evidence records themselves.
- Canonicalized evidence record ordering only for graph fingerprints, preserving
  display context while preventing equivalent imports from changing identity.
- Deduplicated identical evidence quotes during normalization while retaining
  the union of their bounded provenance references.
- Added a separate bounded evidence-input scan budget so duplicate quote prefixes
  cannot hide later unique evidence while normalization remains resource-limited.
- Canonicalized Obsidian projection path allocation so sanitized filename
  collisions cannot swap identities after graph collection reordering.
- Made complete Obsidian vault graph/Markdown artifacts byte-stable across
  equivalent document, concept, and relation collection orderings.
- Reused one canonical graph-export boundary for direct JSON, backups, and
  JSON-LD so top-level collection order cannot change external artifacts.
- Made evaluation matching prioritize constrained reviewed identities before
  overlapping aliases, preventing feedback order from distorting recall.
- Added cross-tab graph freshness checks so delayed older revisions cannot
  replace a newer in-memory representation.
- Bound streaming provider-response reads to the extractor abort signal so
  canceled model requests stop consuming response data promptly.
- Added a bounded evaluator matching budget so oversized reviewed datasets fail
  closed before allocating an unsafe pairwise match matrix.
- Made Obsidian alias feedback order-independent so equivalent edits do not
  create spurious graph revisions.
- Extended graph diffs to expose truncation and malformed-entry diagnostic
  changes, so data-loss warnings cannot disappear between revisions.
- Surfaced those integrity-only diff changes in the live workbench revision
  preview, not only in the downloaded diff JSON.
- Clarified contradictory-feedback messaging so users can distinguish
  timestamp freshness from deterministic tie-breaking.
- Recorded contradictory-feedback resolution in graph revision history so
  deterministic learning choices remain auditable after import.
- Upgraded evaluation matching to find maximum one-to-one assignments across
  overlapping aliases instead of allowing greedy matches to lower recall.
- Made health reports use one inspection timestamp for stale-review counts and
  their exported review queue, avoiding boundary-time inconsistencies.
- Applied the same shared freshness snapshot to the live workbench health strip
  and review queue.
- Added a non-sliding 30-second expiry to the live workbench’s graph-derived
  health, review, and Markdown cache so stale-review status refreshes even when
  the graph itself is unchanged.
- Kept timed-out or disconnected provider operations in the in-flight metric
  until their promises settle, so capacity and graceful-drain telemetry cannot
  report idle while work is still executing.
- Preserved over-capacity undo-history payloads in the history recovery
  snapshot before trimming them to the configured local bound.
- Made canonical source text authoritative for duplicate detection so custom
  fingerprint collisions cannot discard distinct documents.
- Bounded verification CI with a 20-minute job timeout and cancellation of
  superseded runs to protect shared CI capacity.
- Added a reduced-motion browser mode that disables persistent animation and
  shortens transitions for accessibility.
- Added direct clipboard export for redacted Markdown, making privacy-safe
  graph sharing easier in issues, chat, and Obsidian.
- Added non-destructive evidence-grounding diagnostics and an optional
  `--max-unanchored-evidence` health gate; paraphrases remain available but
  are no longer indistinguishable from exact source quotes.
- Made graceful shutdown wait for active provider promises after aborting them,
  while retaining a bounded five-second force-exit fallback.
- Threaded one explicit freshness timestamp through health guidance counts and
  extractor feedback so stale-boundary decisions remain internally consistent.
- Canonicalized ambiguous source and edge diagnostic ordering so health and
  recovery exports are stable across equivalent imports.
- Canonicalized live reviewed-item ordering in feedback exports so graph
  round-trips cannot change bounded training data behind one dataset fingerprint.
- Made feedback imports apply distinct learning examples in stable recency order
  before the bounded memory window is retained.
- Preserved timestamp-free human corrections when they intentionally replace an
  equally undated rejected or accepted graph decision.
- Added freshness diagnostics to extractor evaluation reports, separating fresh,
  stale, and undated reviewed examples, plus an opt-in
  `--max-untrusted-feedback` promotion gate.
- Extended the evaluation comparison promotion gate with
  `--max-untrusted-feedback`, failing closed on stale, undated, or legacy
  reports without freshness diagnostics.
- Recorded applied feedback-trust thresholds and evaluated counts in gated
  comparison artifacts for auditable promotion decisions.
- Made oversized editable Obsidian aliases, labels, source titles, and URIs
  fail closed instead of silently changing the imported correction.
- Rejected oversized direct Obsidian feedback batches instead of partially
  applying only their bounded prefix.
- Rejected oversized direct Obsidian correction identities and fields instead
  of truncating them into potentially different graph targets.
- Added a specific browser message for feedback batches rejected by the
  projection safety bound.
- Short-circuited Markdown evidence rendering after its bounded preview budget
  is exhausted, reducing avoidable work on large graphs.
- Made canonical source-URI normalization reject over-limit values instead of
  truncating provenance metadata into a potentially different URI.
- Updated browser ingestion and source editing to reject invalid or oversized
  source URIs before extraction or persistence instead of truncating them.
- Made direct Obsidian source-feedback mutations reject unsafe URI values
  instead of silently clearing existing provenance metadata.
- Made browser-side and reference-server extraction requests reject unsafe
  source URI metadata before provider work instead of silently dropping it.
- Made remote extraction reject over-limit document titles before sending a
  provider request, matching the reference-server contract.
- Made local browser ingestion reject over-limit document titles too, keeping
  local and remote provenance behavior identical.
- Made multi-file ingestion reject over-limit filename-derived titles instead
  of allowing local and remote batch modes to diverge.
- Made non-streaming remote extractor responses fail closed before JSON parsing
  when they do not declare a bounded response size.
- Made remote extractor responses require an explicit `application/json` media
  type before consuming provider output.
- Made response-size guards reject malformed `Content-Length` metadata instead
  of treating negative or fractional values as trusted bounds.
- Rejected provider node and edge collections above graph limits before
  normalization, preventing overproductive responses from silently losing
  model output or bypassing resource limits.
- Made revised-graph Obsidian vault exports reproducible by deriving manifest
  generation time from the graph revision timestamp.
- Kept stale reusable learning memory available for audit and export while
  excluding it from new extraction guidance until it is reviewed again.
- Aligned health guidance counts with the fresh-only extractor context so stale
  learning is not reported as active guidance.
- Applied the same stale-review boundary to accepted or rejected live concepts
  and relations before they re-enter extractor guidance.
- Required valid review timestamps before stale or undated memory can re-enter
  extractor guidance.
- Exposed the count of guidance identities withheld pending review in health
  and Markdown projections.
- Added a `--max-withheld-guidance` CI gate so stale or undated learning cannot
  silently accumulate in an automated extraction pipeline.
- Made health CLI thresholds reject values above their published schema bounds,
  preventing invalid gate artifacts from entering CI.
- Hardened public learning-note link rendering to allow only credential-free
  HTTP(S) URLs.
- Reused canonical source-URI validation in browser Markdown and Obsidian link
  projections, preventing credential-bearing graph metadata from becoming
  clickable links.
- Normalized Markdown guidance diagnostics so capped and withheld context
  statuses remain readable when both conditions occur.
- Made remote extraction source IDs deterministic from submitted content,
  preventing provider metadata from changing graph provenance identity.
- Canonicalized remote concept and relation IDs from labels and endpoints,
  keeping standalone provider extraction payloads reproducible.
- Made duplicate provider endpoint IDs fail closed instead of choosing an
  arbitrary concept during relation normalization.
- Made remote extraction responses inference-only so providers cannot fabricate
  human-approved status, feedback counts, or review timestamps.
- Made duplicate graph normalization order-independent: canonical labels,
  relation orientation, representative IDs, metadata, and learning aliases
  now remain stable when imported records are reordered.
- Made conflicting duplicate source-ID repairs order-independent, preserving
  stable canonical provenance while retaining the ambiguity diagnostic.
- Applied the same deterministic duplicate collapse at the extractor boundary,
  while preserving the strongest directional relation evidence.
- Canonicalized unmatched cross-workspace feedback by concept labels or
  relation endpoints before storing learning memory, preventing contradictory
  portable hints from teaching the extractor both sides of one decision.
- Discarded request bodies for early extraction rejections so keep-alive
  connections cannot carry unread POST bytes into a subsequent request.
- Added request IDs to every HTTP response and preserved them through remote
  extraction failures, making support traces correlate cleanly across logs.
- Added bounded runtime file reads so assets that grow after an initial stat
  check cannot bypass the per-file memory and response safety limit.
- Bounded early rejection draining for oversized uploads, preserving keep-alive
  reuse for normal requests while terminating untrusted excess bodies safely.
- Closed the non-streaming browser response fallback so note and release
  metadata reads require a declared size before using `response.text()`.
- Added a same-origin `Origin` check to the reference extractor endpoint,
  reducing CSRF risk for cookie-authenticated gateway deployments while
  preserving server-to-server requests without an `Origin` header.
- Also reject explicit `Sec-Fetch-Site: cross-site` metadata, covering modern
  browser requests whose `Origin` header is absent.
- Fixed oversized JSON request handling to return the documented `413` response
  for both declared and chunked bodies without invoking an undefined drain path.
- Removed dead browser and learning-feedback code paths identified by the
  runtime lint audit, keeping the extraction contract and audits exact.
- Required a declared response size for non-streaming remote extractor
  fallbacks, preventing `response.json()` from bypassing the 10 MB bound.
- Fixed missing `Content-Length` handling so absent headers are not coerced to
  zero and cannot bypass browser or remote response-size guards.
- Coalesced and briefly cached readiness validation so repeated health probes
  cannot repeatedly reread and render the full public learning-note set.
- Added `Retry-After: 5` to cached readiness failures so orchestrators avoid
  retry storms while a deployment is unavailable.
- Added a dedicated pre-parse size limit for Obsidian vault manifests, keeping
  deployment metadata validation independent from larger graph export limits.
- Added race-resistant bounded file reads to graph inspection, evaluation,
  comparison, and JSON-LD verification CLIs.
- Made bounded readers fail closed on invalid or infinite size limits instead
  of silently degrading into unbounded reads.
- Bounded Pages build file concurrency and made learning-note metadata reads
  deterministic, preventing large publications from exhausting descriptors.
- Unified Obsidian timestamp validation across parsed notes and direct feedback
  mutations, preventing malformed review dates from entering learning memory.
- Added bounded transient retries with `Retry-After` support to the remote
  extractor, while keeping permanent failures and cancellation fail-fast.
- Added release-metadata validation and bounded streaming at browser startup,
  preventing malformed or oversized deployment metadata from blocking boot.
- Added a shared binary export size guard so every download surface enforces
  the same 50 MB safety limit.
- Added a workbench mutation lock covering source replacement and graph builds,
  preventing overlapping operations from corrupting cancellation state.
- Centralized browser and CLI health-report construction so graph fingerprints,
  build provenance, review queues, and privacy bounds cannot drift between
  export surfaces.
- Added user-approved service-worker upgrades so open workbench tabs are not
  silently taken over by mixed-version assets during a graph mutation.
- Added application build provenance to health reports so shared diagnostics
  identify the release that produced them.
- Enforced the 10 MB public-asset budget during Pages builds, including
  origin-rewritten shell output, and aligned Node sitemaps with Pages by
  publishing canonical HTML landing pages alongside source Markdown.
- Enforced the strict no-script CSP for Node-served note pages at the HTTP
  response boundary and made the no-JavaScript curriculum links use canonical
  crawler-readable note landing pages.
- Extended Node readiness checks to validate rendered learning-note pages, so
  an oversized crawler projection cannot pass health checks merely because its
  source Markdown is within the raw asset budget.
- Added a bounded browser pending-write journal so an interrupted IndexedDB
  commit preserves the newest synchronous graph mirror across reload.
- Escaped curriculum metadata at browser `innerHTML` boundaries so future
  note-catalog edits cannot turn presentation data into executable markup.
- Aligned Node Atom feed summaries with the note-derived Pages feed summaries,
  keeping crawler and subscription projections consistent across deployments.
- Preserved the strict note-page CSP on conditional `304` responses as well as
  normal and `HEAD` responses.
- Centralized the 10 MB public-asset limit in the deployment manifest so
  runtime serving, Pages builds, readiness, and release checks share one bound.
- Bounded note-summary extraction to 20,000 characters in both Node and Pages
  feeds with a true bounded runtime file read, so deployment metadata cannot
  require loading an entire large note.
- Added a shared 1,000-note publication ceiling so runtime discovery, Pages
  builds, and release validation cannot scale learning-note work indefinitely.
- Fixed browser startup ordering so curriculum escaping is initialized before
  the first note render.
- Bounded feedback fingerprint canonicalization before alias sorting and
  serialization, preventing oversized evaluation inputs from forcing unbounded
  intermediate allocations.
- Bounded backup fingerprint history before normalizing imported snapshots,
  keeping malformed restore artifacts within the revision contract.
- Bounded evaluator feedback aliases and identity fields before comparison,
  keeping extractor promotion inputs within their schema limits.
- Added a depth guard to JSON-LD canonical verification so malformed nested
  projections fail closed instead of risking recursive stack exhaustion.
- Removed the final duplicated note metadata window so runtime title and
  summary extraction share one bounded configuration.
- Corrected dynamic note-route error handling so missing assets return `404`
  while unexpected rendering failures are logged and return `500`.
- Bounded direct Obsidian feedback mutation inputs before fingerprinting and
  alias merging, matching the vault parser’s safety limits.
- Normalized direct Obsidian feedback mutation fields before graph updates, so
  callers outside the ZIP parser receive the same bounded label, endpoint,
  source-metadata, and review-date contract.
- Added a shared 100 MB aggregate public-asset budget across release checks,
  Pages bundles, and runtime readiness so many individually valid learning
  notes cannot create an unbounded deployment footprint.
- Prioritized accepted or rejected concepts and relations when newer source
  evidence arrives after their last review, making representation drift visible
  before the time-based stale window.
- Exposed extractor-guidance context capacity and truncation in health,
  Markdown, and the workbench so bounded self-learning remains inspectable.
- Stream-bounded learning-note fetches during Obsidian vault export so an
  oversized public note cannot be fully buffered before the browser rejects it.
- Added direct canonical viewer links beside raw Markdown links on learning-map
  cards, improving shared reading without removing the forkable source path.
- Replaced raw `<pre>` note landing pages with dependency-free escaped Markdown
  rendering for headings, lists, quotes, paragraphs, and code blocks.
- Made HTTP(S) links in public learning notes clickable while leaving unsafe
  URL schemes as inert escaped text.
- Canonicalized graph fingerprints across unordered document, concept, relation,
  and integrity collections so Obsidian and JSON round-trips remain stable when
  external tools reorder arrays.
- Added explicit truncation diagnostics for oversized graph imports, surfaced
  in health exports, Markdown projections, and the workbench warning.
- Added `--max-truncated-items` to the graph health CLI so CI and release
  checks can reject partial graph imports instead of merely reporting them.
- Added malformed-entry drop diagnostics and `--max-dropped-items`, covering
  invalid nodes, dangling relations, malformed revisions, and invalid learning
  examples at the graph and health boundaries.
- Aligned the health schema with the CLI's bounded eleven-threshold gate so
  simultaneous quality violations remain representable in automation reports.
- Added a dependency-free JSON-LD verification CLI for CI and artifact
  pipelines, sharing the graph-input and deterministic projection boundaries
  used by the exporter and browser.
- Extended JSON-LD projections with source fingerprints, concept types, review
  timestamps, feedback counts, and other audit metadata needed to preserve the
  self-improvement loop outside the browser.
- Tightened the public JSON-LD schema to validate typed source, concept, and
  relation members instead of validating only the projection envelope.
- Aligned JSON-LD IRI bounds with escaped Unicode graph identities so valid
  non-ASCII IDs cannot fail their own published schema contract.
- Preserved explicit relation and concept source provenance in JSON-LD through
  `lfn:sources`, avoiding ambiguity with relation endpoints.
- Kept concept `updatedAt` synchronized with human feedback timestamps so
  item-history and review-history metadata cannot drift.
- Preserved source and concept creation/update timestamps in JSON-LD so
  external projections retain representation chronology.
- Added bounded JSON-LD learning-example members and graph evolution counts so
  external consumers can inspect the self-improvement loop.
- Preserved human-readable endpoint labels in JSON-LD relation-learning
  examples so portable feedback remains useful without the original graph.
- Made JSON-LD canonical verification locale-independent for reproducible
  artifact checks across deployment environments.
- Tightened JSON-LD learning-example validation so concept and relation members
  must carry their kind-specific references and labels.
- Declared chronology and learning fields explicitly in the JSON-LD context for
  consistent expansion by generic semantic-web tooling.
- Hardened server request parsing so malformed request targets return HTTP 400
  instead of being misclassified as internal HTTP 500 failures.
- Fixed partial Obsidian source-note imports so an omitted URI field preserves
  existing provenance while an explicitly empty URI still clears it.
- Added an operator-facing production launch checklist covering TLS, secrets,
  gateway controls, monitoring, backups, and projection round-trip checks.
- Clarified the contributor and deployment documentation around the
  provenance-preserving extraction normalization boundary.
- Added reviewed-candidate precision to evaluation reports and promotion
  comparisons, while keeping its sparse-feedback limitation explicit.
- Corrected evaluation matching so accepted and rejected examples are compared
  to the candidate item being scored instead of an unrelated item in the
  extraction.
- Made evaluation conflict detection use portable relation endpoint labels and
  endpoint-order-insensitive identity when workspace-specific edge IDs differ.
- Prevented relation labels beyond the slug bound from collapsing into one
  semantic edge or sharing a merged edge ID.
- Encoded relation semantic keys structurally so delimiter characters in
  imported endpoint IDs cannot create identity collisions.
- Made feedback dataset fingerprints use locale-independent canonical ordering,
  keeping Unicode learning exports reproducible across deployment environments.
- Made review-queue and BPE tie-breaking locale-independent so browser review
  order and runnable experiment outputs remain reproducible across hosts.
- Made Pages feed ordering and browser merge-target ordering locale-independent
  to avoid host-specific public artifacts and review controls.
- Made Unicode word segmentation use an explicit locale-neutral segmenter so
  multilingual extraction does not inherit the host's default locale.
- Made extraction merges fall back to unambiguous canonical concept labels when
  provider IDs change, while still refusing ambiguous label matches.
- Prevented long concept labels from collapsing into one generated identity by
  adding deterministic digest suffixes beyond the label slug bound.
- Extended graph search to index bounded source document text, making the
  underlying evidence corpus discoverable even when extracted evidence is
  sparse.
- Added a bounded source-document list so every ingested document remains
  inspectable even when extraction produces no concepts.
- Made remote source replacement cancellable, with cancellation preserving the
  existing graph representation.
- Added an inspectable prioritized review-queue panel with bounded candidate
  reasons and direct navigation into the relevant inspector item.
- Coalesced graph search rendering per animation frame to keep large-workspace
  filtering responsive.
- Cached fingerprinted graph diagnostics, review candidates, and Markdown
  previews across search-only rerenders.
- Added crawler-readable note landing pages with note-specific canonical and
  social metadata for more reliable shared links.
- Added safe schema.org Article JSON-LD to public learning-note pages so search
  and sharing systems can understand each note without enabling page scripts.
- Added Atom feed alternate links to every public learning-note page, making
  the curriculum discoverable from any shared note.
- Reduced local extraction noise by preferring repeated or structurally
  explicit concepts over isolated generic vocabulary when ranking candidates.
- Added bounded adjacent-phrase extraction for lower-case multi-word concepts,
  improving coverage of ideas such as weighted lookup and positional encoding.
- Kept Markdown headings out of prose extraction units to prevent duplicated
  heading artifacts from entering the graph.
- Filtered common verb fragments from adjacent phrase extraction so inferred
  relations favor durable noun phrases over sentence mechanics and common
  preposition fragments.
- Persisted the validated same-origin extractor path locally across reloads
  without allowing embedded credentials or cross-origin endpoints.
- Added per-note projection identity checks for Obsidian vault imports so stale
  or unverifiable individual edits are disclosed before application.
- Preserved common explicit relation verbs and sentence-initial domain phrases
  in the heuristic extractor instead of degrading them to generic co-occurrence.
- Bound multi-clause relation verbs to their shared subject when a sentence
  uses the common `X verb Y and verb Z` construction.
- Kept sparse documents on the noise-filtered candidate ranking path so
  one-off terms do not return as incidental graph nodes.
- Preserved one-off endpoints named by accepted relation feedback so the
  learning loop remains effective on short follow-up documents.
- Removed evidence-subsumed one-word duplicates such as `Positional` beside
  `Positional encoding` while preserving repeated and reviewed concepts.
- Added global candidate and per-candidate evidence budgets to cap extractor
  pre-normalization memory and phrase-ranking work on large inputs.
- Reserved candidate capacity for structural and multi-word phrases so large
  generic vocabularies cannot crowd out higher-value concepts.
- Added conditional HSTS for HTTPS public origins without changing local HTTP
  development behavior.
- Added generated note landing pages to the Pages service-worker shell for
  offline shared-note access.
- Made the local extractor Unicode-aware so non-Latin concept labels, IDs, and
  feedback matching survive normalization and multilingual documents produce
  useful candidate graphs.
- Added an explicit per-unit multilingual word bound to keep Unicode
  segmentation resource usage predictable.
- Enforced the multilingual word bound while matching, preventing the
  fallback tokenizer from allocating an unbounded intermediate match list.
- Added an explicit Unicode segmentation character budget and filtered
  numeric-only tokens from local concept candidates.
- Made learning-note deep links update browser and share metadata, improving
  clarity when notes are shared or opened in separate tabs.
- Made service-worker shell fallback normalize cache-busting query strings so
  offline versioned asset requests reuse the precached pathname.
- Strengthened Obsidian vault integrity checks so embedded JSON-LD must match
  the authoritative embedded graph projection semantically, not merely repeat
  a valid fingerprint, version, and redaction marker.
- Made JSON-LD artifact verification tolerant of object-key and unordered
  member ordering changes while retaining content and privacy-boundary checks.

- Corrected accepted-recall evaluation so explicitly rejected candidate items
  cannot be counted as successful extraction.
- Added source-anchored evidence coverage to extractor evaluation reports and
  optional promotion metrics, separating “found” concepts/relations from
  supported ones.
- Corrected evaluation matching so reused relation IDs cannot hide changed
  labels or mismatched endpoint pairs during extractor promotion checks, while
  preserving the graph's endpoint-order-insensitive relation identity.
- Centralized endpoint-order-insensitive relation identity across graph
  normalization, extraction merging, concept merging, and feedback resolution.
- Extended graph fingerprint verification to health, diff, and evaluation CLI
  inputs so tampered external projections cannot silently become reports or
  promotion inputs.
- Aligned Obsidian relation feedback with graph identity so reversed endpoint
  order updates the same semantic relation while unrelated pairs still fail
  closed.
- Bound embedded Obsidian graph version, schema, redaction state, and
  fingerprint to the vault manifest so inconsistent projection metadata fails
  closed before feedback can be applied.
- Added full and redacted JSON-LD exports so the normalized representation can
  move into semantic-web and graph tooling without making a projection a
  second source of truth.
- Extracted JSON-LD generation into a reusable pure module and added it to the
  Pages and offline asset contracts.
- Added a versioned JSON-LD schema so external consumers can validate the
  interoperability projection before ingestion.
- Included the JSON-LD projection inside Obsidian vault exports and validated
  its metadata against the vault manifest during import.
- Aligned Node `PUBLIC_ORIGIN` handling with the Pages builder so GitHub Pages
  project subpaths produce correct canonical URLs, feeds, and sitemaps.
- Centralized public-origin normalization so Node and Pages deployments cannot
  drift on canonical URL or crawler metadata behavior.
- Reused the workbench's existing graph-health snapshot when rendering the
  live Markdown preview, avoiding a duplicate large-graph diagnostic scan.
- Aligned graph, diff, and extractor-request URI schemas with runtime source
  URI validation, including rejection of ambiguous, whitespace-containing, and
  credential-bearing HTTP(S)/file forms.
- Added privacy-safe graph health diagnostics to Markdown and Obsidian index
  projections, keeping provenance gaps and review debt visible outside the
  browser.
- Added a fingerprinted `Learning/review-ledger.md` to Obsidian vaults, making
  reusable human decisions navigable and linked to their concept/relation
  projections without creating a second source of truth.
- Corrected graph provenance coverage to measure active concepts and relations,
  including evidence-free items, so missing provenance cannot look healthy
  merely because no evidence records were present.
- Hardened source URI normalization by rejecting ambiguous HTTP forms and
  embedded HTTP(S) credentials before metadata reaches storage or projections.
- Made browser and server extraction preserve the submitted document's
  provenance envelope, preventing provider responses from rewriting source text,
  URI, quality, review metadata, content fingerprints, or node/evidence source
  references.
- Added optional origin-aware `sitemap.xml` and `robots.txt` generation to
  the GitHub Pages artifact, improving crawler discovery when `PUBLIC_ORIGIN`
  is configured.
- Made the Pages workflow automatically pass its configured deployment base
  URL into the static build, so crawler metadata works without manual setup.
- Made Pages rewrite canonical, feed, and social-card metadata to the configured
  deployment origin, including GitHub Pages project subpaths.
- Aligned structured JSON-LD application URLs with the same deployment origin,
  preventing conflicting identity metadata in static and server-rendered shells.
- Recomputed CSP hashes after origin-aware JSON-LD rewrites, keeping generated
  Pages artifacts and server-rendered HTML valid under the strict script policy.
- Strengthened reviewed feedback-dataset fingerprints to a dual-lane 64-bit
  digest, while continuing to accept legacy 32-bit fingerprints during import
  and evaluation migration.
- Corrected unauthenticated metrics `HEAD` responses so operational probes
  receive headers and status without an invalid response body.
- Compacted reviewed feedback at the server trust boundary so unrecognized
  fields cannot forward source evidence or other private payloads to providers.
- Made duplicate Obsidian feedback deterministic: identical notes collapse,
  while conflicting edits are skipped and reported instead of silently using
  the last file's values.
- Fixed redacted graph and vault exports to scrub evidence quotes retained in
  reusable learning memory, closing a source-text privacy leak.
- Preserved and validated relation endpoints in Obsidian imports so colliding
  relation IDs cannot redirect edits to a different local edge.
- Bound Obsidian source metadata edits to each document fingerprint so source
  ID collisions cannot redirect edits to another document.
- Made the redacted marker enforceable during graph normalization, scrubbing
  tampered source text, URIs, and evidence instead of trusting the label alone.
- Aligned Node crawler feeds and sitemaps with Pages by excluding the learning
  map's `notes/README.md` index while continuing to serve it directly.
- Bounded provider diagnostic codes before structured logging so custom extractor
  failures cannot inject arbitrary document text into operational logs.
- Added optional deterministic fingerprints to direct graph JSON exports and
  verified them on import, while preserving compatibility with legacy graphs.
- Sanitized invalid XML control characters from generated feeds and sitemaps,
  keeping crawler artifacts valid when forked learning notes contain controls.
- Added the graph fingerprint to the embedded Obsidian `graph.json`, keeping
  extracted vault representations verifiable alongside their manifest.
- Made vault imports verify embedded graph JSON against its own fingerprint and
  manifest before applying any Obsidian feedback.
- Bounded generated feed and sitemap responses to 2 MB in both Pages builds and
  the Node server, preventing oversized forked curricula from overwhelming crawlers.
- Improved the local heuristic extractor for punctuation-light and mixed
  Markdown by supplementing prose with bounded paragraph, bullet, numbered-list,
  and quote-line units without merging separate list items into false
  cross-item relations.
- Pinned CI and Pages GitHub Actions to immutable commit references and added
  a release gate against mutable workflow tags.
- Made the workflow pin gate discover every YAML workflow, so new automation
  cannot silently bypass the reproducibility check.
- Reduced the Docker runtime context by excluding experiment modules and
  build/release-only scripts while retaining the server's public asset map.
- Preserved the newest relation review timestamp when concept merges collapse
  parallel edges, keeping review freshness stable through consolidation.
- Invalidated review dates for retained concepts, relations, and reusable
  learning entries when source removal changes their evidence basis.
- Preserved the newest review timestamp when concept merges collapse duplicate
  relation learning examples onto one canonical edge.
- Preserved the newest update timestamp when duplicate concepts are normalized,
  preventing imported revision metadata from moving backward.
- Made duplicate learning decisions resolve by review freshness when timestamps
  exist, preventing an older correction from replacing newer reusable guidance.
- Applied the same review-freshness rule to feedback-dataset imports and live
  learning-memory updates, keeping every learning write path consistent.
- Applied review freshness before mutating graph items during feedback imports,
  so an older contradictory decision cannot override a newer human correction
  merely because it appears later in a dataset.
- Applied review freshness when combining live graph decisions with reusable
  memory for extractor guidance, while keeping internal review timestamps out
  of provider request payloads.
- Prevented stale feedback aliases from entering the live representation when
  their associated decision is older than the graph's current review.
- Made portable relation feedback resolve reversed endpoint order, matching
  the graph merge identity and preventing valid corrections from being skipped.
- Made extraction guidance resolve reversed reviewed relation endpoints too, so
  portable corrections continue influencing later representations.
- Made full feedback exports preserve the freshest decision when live graph
  state and reusable memory contain the same reviewed identity.
- Made valid repeated feedback imports idempotent in the workbench, reporting
  that the dataset is already current instead of showing a misleading error.
- Kept revision-limit failures ahead of idempotent feedback success messages,
  so a full graph still tells users to export a backup before further imports.
- Added stale reusable-learning diagnostics to graph health, the workbench, and
  the CLI gate so aging unmatched feedback cannot silently guide extraction.
- Added a confirmation-based workbench action to forget only stale reusable
  learning memory while preserving fresh reviewed guidance and undo history.
- Corrected feedback-import change accounting so stale decisions rejected by
  newer graph state do not create phantom learning revisions.
- Made review-next relation navigation scroll the selected relation into view,
  matching concept navigation on large graph lists.
- Made review-next clear transient graph filters before navigation, ensuring
  queued candidates are visible even when search was active.
- Made review-next move keyboard focus to the inspector so selected evidence is
  immediately reachable after navigation.
- Ordered review-next list activation before candidate selection so scrolling
  works even when the graph view was active.
- Canonicalized portable feedback to matched graph identities before conflict
  resolution, preventing workspace-specific relation IDs from hiding conflicts.
- Hardened feedback identity matching so a colliding local ID fails closed
  instead of silently applying feedback to another local identity.
- Rejected malformed concept and relation review dates at the Obsidian parser
  boundary instead of silently clearing valid review metadata.
- Prevented malformed Obsidian-shaped notes from falling through as ordinary
  source documents during unpacked-note imports.
- Added one-click redacted Markdown export so users can share graph structure
  without copying source text, evidence quotes, or URIs.
- Sanitized pipe characters in Markdown and Obsidian wiki-link labels so
  imported concept and source names cannot corrupt projection navigation.
- Declared explicit button types on dynamically rendered graph and inspector
  controls, keeping review interactions safe when the workbench is embedded
  in a form or reused by another host page.
- Preserved the newest review timestamp when normalization merges duplicate
  concepts or relations, keeping stale-review detection accurate after imports.
- Added bounded review timestamps to concepts, relations, and reusable
  learning examples, preserving human-audit freshness through graph JSON and
  Obsidian projections.
- Included review freshness in graph diff projections so representation audits
  show when a human decision changed, not only its resulting status.
- Added bounded stale-review candidates so old accepted or rejected decisions
  can be revisited as the graph accumulates new evidence.
- Added stale-review counts to graph health reports and the workbench health
  strip for operational review-debt monitoring.
- Extended stale-review monitoring to source quality and provenance metadata,
  not only concepts and relations.
- Included reusable learning review dates in the Markdown projection so
  human-readable audits retain decision freshness.
- Added fresh source-review coverage to health reports so historical reviews
  cannot be mistaken for current provenance confidence.
- Added an optional `--min-fresh-source-review` health gate for enforcing
  current provenance confidence in automation.
- Excluded generated Pages output from Docker build context so runtime images
  contain only the Node deployment surface.
- Made heuristic extractor source IDs deterministic from document content,
  improving reproducibility for standalone extraction and cross-workspace
  comparisons.
- Strengthened `release:check` to validate every shared public asset, not only
  the offline service-worker shell.
- Added a release parity check for dynamically discovered learning notes, so
  Node and Pages deployments cannot silently publish different curricula.
- Cleaned generated Atom feed summaries so public learning-note previews do not
  expose raw Markdown formatting.
- Made the Pages smoke test self-contained so it builds its artifact before
  testing static delivery on a clean checkout.
- Added a title fallback so sparse learning notes cannot create empty feed
  summaries.
- Added a bounded inline latest-diff preview to the workbench so users can
  inspect representation changes without exporting first.
- Preserved schema-recognized but malformed persisted graphs as recovery
  snapshots before normalization, making repairable local-state corruption
  inspectable instead of silent.
- Made the service worker fall back to cached shell assets for transient
  non-OK network responses, not only transport failures.
- Added content-fingerprint preconditions to graph mutations so same-version
  imports or restores cannot silently overwrite a divergent tab state.
- Exposed an idempotent `beginDrain()` lifecycle primitive for programmatic
  server hosts, keeping readiness, provider cancellation, and idle-connection
  cleanup consistent with CLI shutdown.
- Added a separate undo-history recovery snapshot and workbench download action
  so malformed prior revisions remain inspectable instead of being discarded.
- Made stale Obsidian vault and note imports require explicit confirmation
  before applying edits to a newer graph revision.
- Extended that confirmation to notes and vaults with missing or invalid
  projection identity metadata.
- Made ZIP imports fail closed when exported concept or relation notes are
  malformed, preventing partial feedback application from hiding edits.
- Restored source-note metadata to the validated ZIP round-trip so Obsidian
  source quality, URI, and review edits are not silently ignored.
- Rejected duplicate Obsidian frontmatter keys so ambiguous manual edits cannot
  silently select the last value.
- Rejected invalid Obsidian status, source-quality, review-date, alias, and URI
  fields before any projection edit can be applied.
- Made the evaluation promotion gate reject empty reviewed benchmarks so
  apparently perfect metrics cannot promote an untested extractor.
- Made the evaluation promotion gate reject contradictory reviewed decisions
  so conflicting human labels cannot produce a misleading improvement signal.
- Extended the graph health ambiguity gate to include duplicate canonical
  concept labels, matching the ambiguity diagnostics shown in the workbench.
- Added explicit health gates for unsupported concepts and relations, so
  automation can require every active item to retain valid provenance or
  evidence.
- Added a bounded `llms.txt` project map linking the workbench, curriculum,
  contracts, principles, and contribution paths for machine-readable discovery.
- Added a GitHub Pages deployment workflow backed by a clean, explicit static
  bundle, keeping server, container, test, and repository metadata out of the
  public artifact.
- Added a generated Atom learning-map feed to the static Pages bundle so the
  public Markdown curriculum remains discoverable without the Node server.
- Centralized the public asset contract across the Node server, Pages bundle,
  HTTP checks, and service-worker release gate so deployment surfaces cannot
  silently drift apart.
- Added `npm run serve:pages` for a one-command local preview of the exact
  artifact published by GitHub Pages.
- Added standards-correct plain-text delivery and validator-backed caching for
  deployment-aware `robots.txt` and `sitemap.xml` responses, including
  crawler-compatible `HEAD` handling.
- Added bodyless `HEAD` support for liveness, readiness, and metrics endpoints
  so load balancers and probes can inspect them without downloading payloads.
- Added the public security guide to the offline service-worker shell so
  installed deployments retain their security guidance without a network.
- Added a durable-storage flush hook on page disposal so queued IndexedDB
  writes have a best-effort chance to settle before navigation or tab closure.
- Locked competing build and source-selection actions while extraction is
  running, preventing duplicate remote work and stale pending-file replacement.
- Made batch cancellation stop between remote extraction requests, preserve
  unprocessed files for retry, and retain completed partial work safely.
- Expanded Docker context exclusions to cover common backup, database, archive,
  and private-key artifacts before image layers are created.
- Added privacy-safe Prometheus HTTP response-status counters so deployment
  operators can distinguish successful, client-error, and server-error traffic.
- Added an opt-in, ETagged Atom feed for subscribing to the public learning map
  when `PUBLIC_ORIGIN` is configured.
- Made configured deployments emit absolute canonical, feed, and social-card
  URLs in the HTML shell for reliable previews in chat and search results.
- Made graph mutations fail closed at the JavaScript safe-integer revision
  ceiling instead of overflowing optimistic-concurrency versions.
- Added a one-click sample walkthrough from the landing page so new users can
  reach a populated graph and Obsidian projection without setup friction.
- Added an installable-app “Try sample” shortcut that opens the same local
  walkthrough directly from a PWA launcher.
- Added an orientation README to every Obsidian vault export, documenting the
  graph source of truth, review round-trip, contents, and redaction boundary.
- Added one-click copying of the current Markdown projection for quick sharing
  into Obsidian, issues, and chat.
- Added a versioned `vault-manifest.json` to Obsidian exports so external
  viewers can identify graph version, deterministic fingerprint, and redaction
  state before accepting a projection.
- Made vault feedback imports validate and disclose manifest metadata, including
  malformed identity and projections generated from another graph revision,
  while preserving legitimate editable feedback.
- Added graph version and fingerprint metadata to individual exported concept,
  relation, and source notes, with stale-note warnings during note-only imports.
- Centralized browser feedback persistence across list and inspector controls so
  conflict and revision-limit handling cannot drift between review surfaces.
- Tightened vault and note projection metadata validation to reject negative
  graph versions and oversized fingerprints before feedback application.
- Added the deterministic graph fingerprint to Markdown projection frontmatter
  so standalone copied notes remain traceable outside the vault.
- Reused one fingerprint computation across each live or vault Markdown
  projection, keeping large-graph rendering from serializing the same graph
  repeatedly.
- Added direct confirm, dismiss, and restore controls to the graph inspector,
  shortening the active-learning review loop after “review next” navigation.
- Made Atom entries use bounded Markdown H1 titles, with safe filename fallbacks
  for malformed or incomplete notes.
- Applied static-root symlink containment before reading note headings for Atom
  metadata, preventing feed-based disclosure from custom deployment roots.
- Added one-click copy links to individual learning-note cards for easier
  sharing in chat, issues, and study groups.
- Scoped service-worker cache cleanup to the `llm-field-notes-*` namespace so
  shared origins do not lose unrelated application caches.
- Fixed learning-memory normalization to retain the newest reviewed corrections
  when an imported graph exceeds the 500-example bound.
- Strengthened the release gate to verify that the declared offline shell has
  unique, non-empty files before publication.
- Added a dedicated 1200×630 social share card so public links communicate the
  wiki’s purpose in previews instead of showing only the app icon.
- Configured social metadata to request the large-card presentation supported
  by that share asset.
- Added an explicit no-index boundary for operational JSON and metrics
  responses while leaving public learning pages crawlable.
- Added structured JSON-LD metadata describing the wiki’s educational purpose,
  free access, and human-guided representation improvement loop.
- Covered the structured metadata with a release-checked CSP hash instead of
  weakening the browser policy with inline-script exceptions.
- Avoided running the bounded graph-health diagnostic twice when emitting and
  gating a CLI report.
- Optional bearer-token authentication for the reference extraction endpoint,
  with constant-time comparison and a regression-tested `401` boundary.
- Added a standard `npm start` production entry point for Node hosts.
- Kept the container on a direct Node exec path and added CI coverage for
  graceful SIGTERM shutdown.

### Fixed

- Counted failed bearer authentication attempts against the extraction rate
  limit to bound credential probing.
- Rejected malformed or schema-incompatible provider extraction responses with
  controlled `502` errors instead of silently normalizing invalid data.
- Scoped service-worker fallback reads to the application cache, preventing
  unrelated same-origin caches from supplying stale or foreign assets.
- Preserved accessible graph-node keyboard navigation by exposing SVG nodes as
  interactive controls within the graph group.
- Added a privacy-safe Prometheus counter for bearer authentication failures.
- Explicitly carries same-origin browser credentials so gateway-managed
  sessions can protect remote extraction without exposing provider tokens.
- Returns an explicit `405 Allow: POST` response for unsupported extraction
  methods instead of a misleading static `404`.
- Preserved source IDs, creation dates, and accepted provenance when replacing
  a document, so updated content remains attached to the same source identity.
- Added a 10 MB static-asset budget for readiness and public serving to bound
  memory use from unexpectedly large learning notes or deployment files.
- Bound health reports to a deterministic normalized-graph fingerprint so
  diagnostics can be correlated to the exact representation inspected.
- Kept the new health fingerprint optional at the schema boundary so older
  `health@1` diagnostic reports remain readable.
- Kept backup fingerprints optional at the schema boundary so older
  `backup@1` files remain valid while new exports are integrity-protected.
- Kept feedback dataset fingerprints optional at the schema boundary so older
  `feedback@1` exports remain importable while new datasets are verified.
- Added a privacy-safe process-uptime gauge to Prometheus metrics for restart
  and liveness correlation.
- Added an independent optional bearer guard for `/metrics` via
  `METRICS_AUTH_TOKEN`, keeping operational telemetry behind a separate
  credential boundary.
- Added an opt-in deployment-aware sitemap and robots projection via
  `PUBLIC_ORIGIN` to improve discovery of the learning map without hardcoding
  a domain.
- Rejected new extraction requests during graceful drain so keep-alive clients
  cannot start work after readiness has flipped to `503`.
- Added `Retry-After` guidance to draining readiness responses for orchestrator
  retry behavior.
- Bounded release-metadata loading during browser startup so a stalled
  deployment cannot block the workbench indefinitely.
- Added a three-second service-worker network timeout so stalled connections
  fall back to the cached shell promptly.
- Mirrored process uptime in the programmatic server metrics API so embedders
  can correlate restarts without parsing Prometheus output.
- Extended the active-learning review queue to include source-quality and
  source-review gaps, not only inferred concepts and relations.
- Added actionable review-candidate counts to privacy-safe graph health
  reports for CI and convergence monitoring.
- Added an optional `--max-review-candidates` health gate so automation can
  require the self-improvement queue to fall below a defined threshold.
- Added an optional `--max-stale-review-candidates` health gate so automation
  can bound review debt separately from newly inferred work.
- Validated source review dates and normalized source URIs before browser
  metadata edits are committed.
- Added bounded integrity diagnostics for imported edge IDs that collide across
  different relation semantics.
- Added undoable source replacement so changed documents can refresh stale
  inferred knowledge without duplicating the old source.
- Made source replacement a single explicit revision, preserving quality
  metadata while invalidating the previous content review date.
- Added a versioned bounded graph-diff export for inspecting the latest
  representation change without exporting source evidence.
- Included learning-memory and integrity-diagnostic changes in graph diffs so
  feedback-only improvements remain auditable.
- Added a dependency-free `diff-graphs.mjs` CLI for CI and local review of
  graph or backup changes.
- Added strict input validation and an `npm run diff` shortcut for the graph
  comparison workflow.
- Added package-version reporting to health, readiness, and Prometheus
  build-info telemetry for release correlation.
- Added a shared public release manifest so the browser footer and static
  deployment checks cannot silently drift from `package.json`.
- Tightened release date validation to reject impossible calendar dates instead
  of accepting JavaScript-normalized values.
- Added bounded source URI provenance across graph records, remote extraction,
  source editing, and Obsidian projections.
- Added a redacted graph export for safer sharing of concepts, relations, and
  review state without source text, evidence quotes, or URIs.
- Added compact feedback export with evidence and source references removed.
- Prevented redacted graphs from retaining a misleading privacy marker after
  new full-text ingestion.
- Added a shared source-URI scheme allowlist to reject dangerous metadata at
  graph, extractor, server, and Obsidian boundaries.
- Mirrored the source-URI safety allowlist in graph, extractor-request, and
  diff JSON schemas for independent validator parity.
- Kept redaction status visible in graph health after import and reload.
- Included redaction-state transitions in graph diffs for complete privacy
  auditability.
- Added explicit privacy tooltips to evidence-bearing and compact feedback
  exports.
- Strengthened redaction regression coverage to include private source text,
  evidence, and URI fixtures.
- Preserved the redaction marker through normalization and import, with an
  explicit warning when redacted graphs are loaded.
- Made release metadata revalidate on every deployment check instead of using
  the normal static-asset cache window.
- Added `npm run release:check` to prevent package, manifest, and changelog
  version drift before publishing.
- Added a privacy-safe `/metrics` endpoint for deployment request, extraction,
  rate-limit, and in-flight-provider observability.
- Prevented malformed empty relation endpoints from resolving through an empty
  concept-ID alias.
- Made imported graph normalization collapse reverse relations with the same
  label, matching ingestion and preventing duplicate projections.
- Remapped learning examples when normalization discards a duplicate reverse
  edge, preserving canonical relation IDs, endpoints, and labels after import
  or restore.
- Kept relation learning memory aligned when concepts are merged, including
  canonical edge IDs and endpoint labels.
- Made feedback imports refuse ambiguous label fallbacks instead of mutating an
  arbitrary concept.
- Let relation feedback resolve endpoint IDs, canonical labels, or reviewed
  aliases when workspaces differ, preserving portable learning across graph
  exports.
- Removed learning entries for graph identities pruned during source removal.
- Prioritized reusable learning memory when bounded extractor and feedback
  exports reach their 500-example limit.
- Ensured newer reviewed graph state overrides stale duplicate learning memory
  when feedback is sent to a future extractor.
- Centralized graph, feedback, and backup contract identifiers across browser,
  extractor, server, and export paths.
- Rejected remote extractor responses that advertise an incompatible feedback
  contract before they can enter the graph.
- Preserved explicit extraction and learning IDs up to the shared 200-character
  identity limit instead of truncating them to label-slug length.
- Prevented ambiguous model labels from silently binding relation endpoints to
  the last concept with that label.
- Updated evaluator identity matching to honor the full 200-character graph ID
  contract instead of comparing truncated slugs.
- Separated the offline evaluator’s 15,000-example dataset bound from the
  smaller 500-example remote extractor context bound.
- Made the evaluator CLI reject incompatible declared feedback or graph schema
  metadata before scoring examples.
- Prevented malformed overlong evaluation IDs from colliding by shared prefixes.
- Added a versioned evaluation-comparison CLI and regression gate so extractor
  improvements can be promoted with explicit accepted-recall and rejection-
  suppression evidence.
- Made the active-learning review queue prioritize and explain evidence-free
  and unresolved-provenance claims alongside low-confidence claims.
- Bound evaluation promotion to a deterministic reviewed-dataset fingerprint,
  preventing incomparable feedback sets from masquerading as improvements.
- Added the same fingerprint to feedback exports and verified it at the
  evaluator boundary before scoring.
- Verified feedback fingerprints during browser import so tampered learning
  envelopes cannot be applied silently.
- Added bounded Prometheus extraction-latency histogram telemetry alongside
  privacy-safe request and outcome counters.
- Upgraded generated source fingerprints from one 32-bit lane to a dual-lane
  64-bit digest while preserving legacy and custom fingerprint compatibility.
- Fixed compact feedback exports to recompute their dataset fingerprint after
  removing evidence and source references.
- Prevented sample and file switches from retaining stale source URI metadata.
- Made safe HTTP(S) source URIs clickable in Markdown projections without
  turning other URI schemes into links.
- Added a redacted Obsidian vault export that preserves graph structure and
  review state without source text, evidence quotes, or URIs.
- Updated security guidance to include the redacted vault as a safe sharing
  surface.
- Added a versioned privacy-safe graph health report export for diagnostics,
  issue reports, and automation.
- Added explicit redaction markers to exported Markdown indexes and source
  notes so stripped content cannot be mistaken for corruption.
- Added safe HTTP(S) source links to readable Obsidian source notes.
- Added deterministic backup fingerprints and pre-restore verification, while
  retaining compatibility with older backups.
- Tied the service-worker cache key to the package release version and added a
  release consistency check to prevent stale deployment assets.
- Removed the hardcoded release version from the static footer so failed
  metadata fetches cannot advertise an old build.
- Unified static serving and readiness asset allowlists to prevent deployment
  drift when public contracts are added.
- Synchronized relation learning endpoint labels after concept renames in the
  browser and Obsidian feedback paths.
- Extended backup fingerprint verification to graph diff and health automation
  tools.

## [0.1.0] — 2026-07-12

### Added

- Local-first document-to-knowledge-graph workbench with evidence, provenance,
  revisions, review status, and reusable learning memory.
- Same-origin extractor contract with bounded requests, cancellation,
  timeouts, request IDs, and provider-neutral normalization.
- Obsidian Markdown projection, editable feedback import, vault export/import,
  feedback datasets, and a dependency-free evaluator.
- Durable IndexedDB storage with localStorage fallback, cross-tab
  synchronization, optimistic writes, undo, recovery snapshots, and safe
  backup restore.
- Concept merging that preserves aliases, evidence, provenance, relations, and
  learning decisions.
- Public learning map, runnable experiments, offline service worker, PWA
  manifest, contribution guidance, security guidance, and production Docker
  deployment.

### Production hardening

- Bounded graph, document, evidence, archive, request, response, search, and
  persistence sizes.
- Defensive ZIP parsing, path validation, checksums, archive overlap checks,
  and cumulative uncompressed-size limits.
- Static asset allowlisting, readiness checks, security headers, ETags,
  graceful shutdown, rate limiting, and structured extraction logs.
- Made remote-extraction privacy disclosures explicitly include optional source
  URI metadata alongside document text and bounded reviewed feedback.
- Full smoke, fuzz, storage, projection, evaluator, service-worker, and
  container verification across Node 18, 20, and 22.
## Unreleased

- Refuse source removal and replacement when imported duplicate source IDs are marked ambiguous, preventing destructive edits against the wrong document.
