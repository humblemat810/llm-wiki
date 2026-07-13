# Changelog

All notable changes to LLM Field Notes are documented here.

## [Unreleased]

### Added

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
