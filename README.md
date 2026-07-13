# LLM Field Notes

**Understand the machine. Build the thing.**

LLM Field Notes is an open, practical knowledge workspace for turning documents
into an inspectable, evolving knowledge graph. It is organized around a simple
loop:

> ingest → infer → inspect → improve → project

The goal is not to hide behind a generated summary. It is to preserve the
concepts, relations, confidence, source evidence, and revision history so a
curious person can challenge the representation and improve it over time.

## Current workbench

The browser prototype supports:

- Pasting a document or loading a local `.txt` / `.md` file.
- Trying a one-click local sample graph from the landing page so the full
  ingest, inspect, and projection loop is visible immediately.
- Launching that sample walkthrough directly from an installed app shortcut.
- Loading and ingesting a batch of local text/Markdown documents in one undoable
  mutation.
- Showing a bounded summary of per-file batch failures so partial imports are
  recoverable without overwhelming the workbench.
- Extracting candidate concepts and evidence-backed co-occurrence relations.
- Optionally sending documents to a configured same-origin extraction endpoint
  that returns the same normalized graph contract; blank configuration keeps
  extraction fully local.
- Supporting an optional server-side `EXTRACTOR_AUTH_TOKEN` bearer guard for
  single-instance deployments without putting credentials in the browser.
- Supplying up to 500 reviewed feedback examples with remote extraction so
  later representations can learn from earlier human corrections.
- Sending only compact reviewed labels, aliases, statuses, and relation
  endpoints to extractors; source evidence remains in the local/exported graph.
- Applying accepted concept feedback as extraction hints, suppressing rejected
  concepts, canonicalizing accepted aliases, and reusing accepted relation
  labels in the reference extractor.
- Canceling an in-flight remote extraction from the workbench without
  affecting local extraction or graph imports.
- Locking competing build, sample, and file-selection actions while a build is
  in flight, preventing duplicate extraction and stale queue replacement.
- Canceling a multi-file build between extraction requests while preserving
  unprocessed files in the queue and committing any completed partial batch.
- Capping the serialized remote feedback context at 500,000 characters to keep
  provider requests predictable.
- Rejecting oversized browser document files before reading them, with a 10 MB
  JSON import safety limit and a 50 MB Obsidian ZIP limit.
- Bounding batch ingestion to 100 files and 10 MB of aggregate text so a
  selection cannot overwhelm browser memory.
- Merging new documents into the existing graph instead of replacing it.
- Confirming or dismissing concepts to update confidence and create a revision.
- Confirming or dismissing relations with the same persistent feedback loop.
- Re-ingesting later documents without silently overriding dismissed knowledge.
- Normalizing imported graph JSON so duplicate IDs cannot create ambiguous state.
- Enforcing document-size limits inside the extractor, not only in the browser UI.
- Canonicalizing labels and titles so external text cannot break projections.
- Bounding graph collections to keep imports and model responses within a
  predictable browser resource envelope.
- Bounding aggregate source text across repeated ingestion so a long-lived
  local graph cannot grow without limit even when each document is individually
  valid.
- Bounding evidence text and provenance-reference arrays at the same
  normalization boundary.
- Retaining a bounded revision timeline so backups and browser state remain
  predictable.
- Treating relation labels case-insensitively when merging repeated evidence.
- Canonicalizing line endings and trailing whitespace for duplicate-source
  detection while preserving original source text.
- Falling back to canonical source content when imported graphs contain legacy
  or custom fingerprints.
- Using a dual-lane deterministic content digest for newly generated source
  fingerprints so accidental identity collisions remain extremely unlikely.
- Editing concept and relation labels without changing their stable IDs.
- Merging duplicate concepts into a canonical concept while preserving aliases,
  evidence, provenance, feedback memory, and relations; the merge is recorded
  as an undoable graph revision.
- Treating explicit concept and relation label corrections as accepted feedback
  so later extraction can reuse the improved representation.
- Adding accepted concepts and relations manually when extraction misses an
  important idea.
- Remembering previous labels as aliases so later documents merge into the
  corrected concept instead of creating duplicates.
- Refreshing relation learning endpoint labels when a concept is renamed, so
  portable feedback remains useful across workspaces.
- Removing a bad source with provenance-aware pruning while preserving accepted
  manual knowledge and keeping the operation undoable.
- Replacing an updated source file in place, pruning stale unsupported
  inferences while preserving accepted knowledge and making the whole refresh
  undoable.
- Undoing the last three local graph mutations with bounded snapshot history.
- Preserving malformed local graph data as a downloadable recovery snapshot
  instead of silently discarding it.
- Best-effort persistent browser storage requests after the user starts
  building a graph.
- Hydrating graph state from IndexedDB when available, migrating existing
  `localStorage` state automatically, and retaining a synchronous fallback when
  IndexedDB is unavailable.
- Flushing queued durable writes when the page is being discarded, reducing the
  chance that the newest local revision is lost during navigation or tab
  closure.
- Surfacing asynchronous durable-storage failures in the privacy note and graph
  health strip so users know when to export a backup, with a direct backup
  action available from the warning.
- Optimistic version checks for asynchronous batches, graph imports, backup
  restores, and Obsidian feedback so another browser tab cannot be silently
  overwritten.
- The same conflict protection covers single-document extraction, manual
  concept and relation edits, source removal, and feedback clicks.
- Undo and clear also refuse to overwrite a graph that changed in another tab.
- Undo history configuration is sanitized so zero or invalid capacities cannot
  accidentally disable the storage bound.
- Refreshing the workbench when another tab changes the saved graph, with a
  visible synchronization notice.
- Preserving the latest graph when undo-history storage fills first, with a
  safe degraded write that discards only history.
- Showing a health warning when a save succeeds with reduced undo history.
- Restoring a full backup even when its history cannot fit, while preserving
  the restored graph and reporting the reduced history mode; browser backup
  restores also retain the pre-restore graph as the newest undo snapshot.
- Allowing users to clear local state even when a pre-clear undo snapshot cannot
  fit in storage.
- Browsing the graph as SVG or as an inspectable concept list.
- Filtering large graphs across concepts and relations without changing the
  stored representation.
- Searching graph evidence and source titles as well as concept/relation labels.
- Searching source quality and review metadata through the same graph index.
- Retaining optional bounded source URIs through graph JSON, remote extraction,
  and Obsidian source notes.
- Rendering safe HTTP(S) source URIs as clickable links in the Markdown
  projection while keeping other allowed URI schemes as escaped text.
- Reusing a per-render source-title index so graph search stays responsive as
  provenance grows.
- Bounding per-item search text and evidence previews so large imported graphs
  cannot force unbounded search-index allocations.
- Inspecting provenance health, including unsupported concepts/relations and
  evidence coverage, source review coverage, and quality distribution.
- Showing how many reviewed feedback decisions are retained for future
  extraction guidance.
- Revisiting stale human decisions after a bounded freshness window, so
  accepted or rejected knowledge and source metadata can be challenged as new
  evidence arrives.
- Reporting stale-review pressure in graph health exports and the workbench,
  making representation drift visible to operators and quality gates.
- Recording the latest human review time on concepts, relations, and reusable
  learning examples so the representation's audit trail survives JSON and
  Obsidian round-trips.
- Showing accepted versus rejected learning outcomes in graph health so
  representation changes remain inspectable.
- Retaining up to 500 compact reviewed examples as reusable learning memory,
  so feedback can seed extraction in a fresh workspace before matching nodes
  exist.
- Keeping the newest reviewed corrections when the bounded learning-memory
  window is full, so stale imports cannot displace recent human decisions.
- Allowing users to forget reusable learning memory without deleting source
  documents or the current knowledge graph.
- Marking each source as unknown, primary, secondary, or tertiary quality and
  recording its last-reviewed date in the graph and Obsidian projection.
- Normalizing review dates to ISO timestamps and discarding malformed dates at
  import boundaries.
- Normalizing graph, source, node, and revision timestamps to the same
  date-time contract.
- Repairing malformed imported graph metadata deterministically so repeated
  reads do not create phantom changes.
- Restricting graph and revision versions to JavaScript-safe integers so
  optimistic concurrency remains reliable.
- Importing those source metadata edits back from Obsidian source notes.
- Surfacing an explainable review queue that prioritizes low-confidence,
  evidence-free, or unresolved-provenance inferred concepts and relations,
  plus unknown-quality or never-reviewed sources, for the next human
  correction, with confirm/dismiss actions available directly in the
  inspector.
- Exporting the internal representation as JSON.
- Binding Markdown projections to the normalized graph fingerprint so copied
  notes can be traced back to the exact representation that produced them.
- Copying the current Markdown projection directly to the clipboard for quick
  sharing into Obsidian, issues, or chat.
- Exporting a redacted graph that preserves structure and review state while
  removing source text, evidence quotes, and source URIs for safer sharing.
- Exporting a redacted Obsidian vault with the same privacy boundary, so
  shareable Markdown projections do not require exposing source material; the
  exported notes visibly mark the redaction state.
- Exporting a bounded structured diff for the latest graph revision, so
  representation changes, learning memory, integrity diagnostics, and privacy
  state can be reviewed or shared independently.
- Exporting a versioned privacy-safe graph health report with provenance,
  review, actionable-candidate, ambiguity, and support diagnostics for issue
  reports or automation.
- Exporting/restoring a versioned full backup containing the graph and undo
  history, with a deterministic fingerprint that detects accidental edits or
  truncation before restore.
- Exporting a versioned feedback dataset containing reviewed concepts and
  relations, including aliases, for future extractor evaluation or
  improvement.
- Stamping feedback exports with a deterministic reviewed-dataset fingerprint
  so evaluation runs can prove they used the intended examples.
- Exporting compact feedback without evidence or source IDs for safer sharing
  of reviewed learning decisions.
- Evaluating an extractor or graph against that feedback dataset with a
  dependency-free CLI, reporting accepted recall and rejected-example
  suppression so improvements can be compared rather than guessed.
- Comparing baseline and candidate evaluation reports with a dependency-free
  regression gate that fails promotion when accepted recall or rejected-example
  suppression worsens beyond an explicit tolerance, while rejecting reports
  generated from different reviewed datasets.
- Importing that feedback dataset into another graph workspace idempotently,
including reviewed aliases, so decisions can travel between projects without
double-counting. When IDs differ, concept feedback falls back to canonical
labels and aliases; import counts refer to reviewed items rather than individual
field changes, unmatched or invalid examples are reported as skipped, and
contradictory decisions for one identity are disclosed while the later decision
retains the existing correction semantics.
- Resetting completed file imports so selecting the same source again reliably
  starts a new import.
- Saving learning-map progress through the same browser storage boundary as
  the graph, surfacing failures instead of silently losing checkmarks, and
  synchronizing progress across open tabs.
- Exporting a complete Obsidian vault ZIP with an index, one Markdown note per
  concept, one editable note per relation, one note per source document,
  relations, the bounded revision history, the graph JSON, and an orientation
  README describing the round-trip review workflow, plus a fingerprinted vault
  manifest for projection identity.
- Preflighting each generated vault and learning-note file against the ZIP
  size limit before retaining more projection content in browser memory, and
  failing clearly rather than silently omitting notes when the limit is hit.
- Maintaining the public learning map as versioned Markdown pages under
  `notes/`, so the curriculum is forkable, linkable, and usable in Obsidian.
- Including a bounded Mermaid graph view in Markdown projections for visual
  inspection in Obsidian-compatible viewers.
- Bounding evidence retained in full Markdown projections so large graphs
  produce a useful, explicitly marked export instead of an unbounded string.
- Including those learning pages in Obsidian vault exports and precaching them
  for offline reading.
- Sharing the public wiki entry point through the native share sheet or a
  clipboard fallback; local graph data is never placed in the shared URL.
- Copying a direct deep link for each learning note from its map card.
- Publishing a dedicated 1200×630 share card for richer link previews on social
  platforms and team chat.
- Publishing machine-readable JSON-LD metadata so search engines can identify
  the project as a free educational knowledge-workbench.
- Keeping that inline metadata covered by a narrowly scoped CSP hash rather
  than weakening the page with `unsafe-inline`.
- Opening learning notes through shareable `#note=...` deep links that survive
  reloads and browser back/forward navigation.
- Importing edited concept/relation Markdown notes from an unpacked Obsidian
  vault so label, alias, and status corrections become graph revisions; vault
  imports surface invalid or stale manifest metadata without silently hiding it,
  and individual exported notes retain the same projection identity.
- Confirming destructive graph and full-backup replacement imports while
  retaining the previous graph through the undo path.
- Rejecting oversized Obsidian feedback notes before frontmatter parsing.

The extractor is deliberately transparent and provider-agnostic. A future
model-backed extractor can replace the heuristic while keeping the graph
schema, feedback loop, and projections stable.

The implementation boundaries and extension rules are documented in
[ARCHITECTURE.md](ARCHITECTURE.md).

To compare an extractor revision against reviewed examples:

```bash
node experiments/evaluate-feedback.mjs feedback.json extraction.json
```

The evaluator emits the versioned `llm-field-notes/evaluation@1` contract. It
measures coverage of accepted concepts and relations and whether rejected
examples stay out of the representation; it does not pretend a sparse human
feedback set is a complete precision benchmark.

To compare two graph exports or full backups outside the browser:

```bash
node experiments/diff-graphs.mjs before.json after.json
```

The same comparison is available as `npm run diff -- before.json after.json`;
graph and backup inputs must declare compatible versioned contracts.
Fingerprint-protected backups are verified before either graph tool consumes
them.

To gate an extractor or representation improvement:

```bash
node experiments/compare-evaluations.mjs baseline-evaluation.json candidate-evaluation.json
```

The command exits non-zero when any accepted-recall or rejected-suppression
metric regresses. Pass `--max-regression 0.02` to allow a documented two-point
tradeoff.

To inspect graph quality in automation:

```bash
npm run health -- graph.json --min-provenance 95 --max-orphaned 0 --max-review-candidates 25 --max-stale-review-candidates 10
```

This emits the privacy-safe health contract and exits non-zero when the
requested quality thresholds are missed.
The report and gate reuse the same normalized diagnostic pass, so large graphs
are not scanned twice.

Before publishing a release, run `npm run release:check` to verify that the
package version, public release manifest, changelog heading, and every
service-worker shell asset agree and are non-empty.

Model-backed adapters should call `normalizeExtraction()` before merge; this is
the stable boundary for partial or provider-specific extraction responses.
`extractor-adapter.js` provides a small HTTP adapter with endpoint validation,
timeouts, bounded document input and response size, and normalized responses. It is intentionally
not wired to a vendor or API key, so deployments can add a server-side provider
without putting credentials in the browser.

## Run it locally

There are no dependencies or build steps. Serve the repository over HTTP so
browser modules, service workers, and durable storage work consistently:

```bash
npm run serve
```

Then visit `http://localhost:8000`.

If Node is unavailable, `python3 -m http.server 8000` provides the same local
static origin.

For a same-origin reference extraction endpoint, run:

```bash
npm start
```

This dependency-free server uses the local heuristic extractor to demonstrate
the request contract. Replace its extraction branch with a model provider in a
deployment by passing an async `extractor({ document, feedback, requestId })`
function to `createAppServer`; keep the same schema, input limits, and
server-side credential boundary. Provider output is normalized before it
reaches the browser, provider failures return HTTP 502, and provider timeouts
return HTTP 504 with a correlated request ID. The default provider timeout is
120 seconds and is configurable with `EXTRACTOR_TIMEOUT_MS` (capped at 120
seconds); disconnected clients also abort in-flight provider work. The
normalized extractor response is capped at 10 MB before transmission. The
An invalid or absent `PORT` falls back to `8000`; an empty or absent `HOST`
falls back to `127.0.0.1`, while a non-empty host is passed to Node for
normal hostname validation. The
reference endpoint requires JSON, validates the feedback format,
sets no-store response behavior, and emits baseline security headers.
Set `EXTRACTOR_AUTH_TOKEN` to require a bearer token for extraction requests;
leave it unset for the local development default. The token is compared
constant-time and is never logged. Public deployments should still use TLS,
gateway authentication, and a shared rate limiter. Browser deployments that
use a gateway session can rely on same-origin cookies; the app never stores or
exposes provider credentials.
Set `METRICS_AUTH_TOKEN` independently when `/metrics` should require a bearer
token; keeping metrics behind a gateway is recommended even when the endpoint
contains no document content.
Set `PUBLIC_ORIGIN` to the externally visible HTTPS origin to enable
`/sitemap.xml` and a deployment-aware `robots.txt` with crawlable learning-note
URLs, plus `/feed.xml` as an Atom subscription feed for the learning map.
When configured, the server also emits absolute canonical, feed, and social
image URLs in the HTML shell so shared links remain previewable outside the
deployment origin.
Feed entries use the learning-note headings rather than opaque filenames, while
enforcing the same static-root containment boundary as public file serving.
These dynamic distribution assets use ETags and conditional `304` responses;
they also serve standards-compliant `HEAD` responses. The feature remains
disabled when no trusted public origin is configured.
It exposes `/healthz` for process liveness and `/readyz` for app readiness
(both support `GET` and bodyless `HEAD` probes);
the latter verifies that the static shell is available and returns 503 while
the process is draining after shutdown begins, so orchestrators stop routing
new traffic before the server exits. Both health endpoints report the package
version, and `/metrics` exposes a version-labelled build-info gauge alongside
privacy-safe Prometheus text counters for total requests, extraction outcomes,
authentication failures, rate-limited requests, and in-flight provider work
plus HTTP response status counters and a bounded extraction latency histogram; it never includes document
content or credentials. Metrics also support bodyless `HEAD` probes and expose
a process-uptime gauge for restart correlation. Operational JSON and metrics
responses explicitly opt out of search indexing. Public static assets, including learning notes, are
bounded to 10 MB so readiness and serving cannot buffer an unexpectedly large
deployment file.
Extraction responses include an `X-Request-ID` UUID for operational
correlation, and the browser adapter preserves that ID in remote errors. The
standalone server logs structured request ID, status, duration, route,
document character count, and feedback count without document content.

Quick contract smoke test:

```bash
curl --fail http://localhost:8000/healthz
curl --fail http://localhost:8000/readyz
curl --fail \
  -H 'content-type: application/json' \
  -d '{"operation":"extract-graph","schema":"llm-field-notes/graph@1","feedbackFormat":"llm-field-notes/feedback@1","feedback":[],"document":{"title":"Quick test","text":"Attention uses context to create a useful graph representation for review."}}' \
  http://localhost:8000/api/extract-graph
```
Static delivery uses an explicit allowlist and does not expose
repository metadata or server source files. Extraction requests have a
configurable in-process rate limit (`EXTRACTOR_RATE_LIMIT`, default 60/minute),
at most 500 feedback objects, and a 500,000-character serialized feedback
context limit; stale client windows are removed and the limiter has a
10,000-key cap. Use a shared proxy limiter for multi-instance deployments.
Static assets include ETags and return conditional `304` responses when
unchanged.
Invalid environment or embedded-server values fall back to the 60/minute
default. Declared request bodies over 2 MB are rejected before buffering.
The HTTP server also bounds header, request, and keep-alive lifetimes, and
stops buffering immediately when an uploading client disconnects.
Obsidian vault imports validate ZIP paths, duplicate entries, local/central
filename agreement, and file checksums before applying feedback.

The reference server can also run in a container:

```bash
docker build -t llm-field-notes .
docker run --rm -p 8000:8000 llm-field-notes
```

Generic Node hosts can use `npm start`; the server honors `PORT`, `HOST`,
`EXTRACTOR_RATE_LIMIT`, and `EXTRACTOR_TIMEOUT_MS`. The container intentionally
execs Node directly so orchestrator signals reach graceful shutdown handling
without an npm intermediary.

The image binds to `0.0.0.0`, includes a Docker health check, and keeps the
runtime dependency-free. It runs as the non-root `node` user; the Node server
aborts active provider calls, closes idle keep-alive sockets, and drains
requests during SIGINT/SIGTERM shutdown.
The base image is digest-pinned for reproducible builds.
The Docker context excludes environment files, local exports, and development
tests, common backup/database artifacts, and private-key material.

Run the dependency-free smoke checks with:

```bash
npm test
```

The same checks run in GitHub Actions on every push to `main` and every pull
request across Node 18, 20, and 22.
CI also builds the Docker image to catch deployment drift.
CI starts that image, probes `/readyz`, and waits for Docker’s health status to
become `healthy` so the runtime and its own health check agree.

The test suite also serves the static asset graph through a local HTTP server,
simulates service-worker install/network/offline behavior, and verifies that
the module entry points, manifest, styles,
icon, security guidance, and indexing policy are all deliverable.
The Node host derives its fixed asset allowlist from the same manifest used by
readiness checks, while learning notes are discovered dynamically.

To bring corrections back from Obsidian, edit the concept headings or relation
frontmatter, then select either the exported vault ZIP or the edited
concept/relation notes in the workbench and press `Build graph`. The app treats
those files as feedback updates rather than new source documents.

## Project shape

- `index.html` — the public-facing wiki and knowledge workbench
- `styles.css` — responsive visual system and graph workspace
- `app.js` — browser UI, selection, feedback loop, search, filters, and exports
- `graph-core.js` — pure graph schema, extraction, migration, merge, and provenance logic
- `graph-store.js` — transactional local persistence, history, undo, and restore
- `CHANGELOG.md` — user-visible release history and production hardening notes
- `extractor-adapter.js` — provider-neutral remote extraction boundary
- `projection-adapter.js` — Obsidian feedback parser and graph update boundary
- `storage-adapter.js` — durable IndexedDB/localStorage boundary with an in-memory fallback
- `notes/` — versioned Markdown learning pages and curriculum index
- `experiments/` — small dependency-free runnable learning artifacts (see [experiments/README.md](experiments/README.md))
- `server.mjs` — optional same-origin static server and extraction contract example
- `manifest.webmanifest` / `sw.js` — installable, cacheable static deployment
- `version.json` — public release metadata shared by the browser and static
  deployment checks
- `tests/` — dependency-free graph and site smoke checks
- `schema/graph.schema.json` — versioned interchange contract for external tools
- `schema/feedback.schema.json` — versioned reviewed-example export contract
- `schema/backup.schema.json` — versioned full-backup restore contract
- `schema/diff.schema.json` — versioned graph revision-diff contract
- `schema/extractor-request.schema.json` — versioned remote extraction request
  contract
- `schema/evaluation.schema.json` — versioned extractor evaluation report
- `schema/evaluation-comparison.schema.json` — versioned evaluation promotion
  gate result
- `schema/health.schema.json` — versioned privacy-safe graph health report
- `schema/vault-manifest.schema.json` — versioned Obsidian projection identity
- `SECURITY.md` — data boundary and vulnerability-reporting guidance
- `CODE_OF_CONDUCT.md` — community participation expectations
- `LICENSE` — reuse and attribution terms
- `.github/ISSUE_TEMPLATE/` — structured bug and feature intake
- `CONTRIBUTING.md` — how to make the wiki sharper

## Product principles

- Keep evidence attached to every inference.
- Make confidence and uncertainty visible.
- Let a person correct the representation without starting over.
- Treat projections as views over the graph, not separate copies of truth.
- Keep the graph schema stable as extractors improve.
- Bound undo-history parsing before normalization so oversized imports cannot
  consume unbounded memory.
- Preserve valid-but-unsupported graph schema payloads for recovery instead of
  silently treating them as an empty graph.
- Normalizing duplicate source IDs so provenance links resolve to one document
  record.
- Repairing provider source-ID collisions when the same ID is reused for
  different document content, while rebinding node and evidence provenance.
- Preserving conflicting duplicate source records during graph import instead
  of silently collapsing distinct documents.
- Repairing missing source IDs deterministically from document fingerprints.
- Sanitizing repaired source IDs so external fingerprint text cannot create
  unsafe projection paths or links.
- Deriving repaired source IDs from hashes rather than lossy slugs to avoid
  fingerprint collisions.
- Remote extractor integrations must validate timeout configuration and reject
  malformed provider response shapes before normalization.
- Extractors should treat reviewed feedback as bounded guidance: accepted
  concepts may be promoted when they occur in new text, accepted aliases should
  resolve to the reviewed canonical ID, rejected concepts may be suppressed,
  and accepted relation labels may be reused only when both endpoints are
  observed together.
- Adaptive extraction activates at most 100 reviewed concept hints per
  document and uses normalized text matching to keep large documents
  predictable.
- Browser remote extraction must remain same-origin with the static app so its
  CSP and credential boundary stay explicit.
- Remote endpoints receive `operation: "extract-graph"`, the graph schema
  version, and `feedbackFormat: "llm-field-notes/feedback@1"` so server
  implementations can negotiate these contracts explicitly.
- The remote adapter accepts an external `AbortSignal` and distinguishes caller
  cancellation from request timeout.
- If a provider includes response schema metadata, the adapter rejects
  incompatible graph schema versions before merging.
- The workbench updates its privacy disclosure when remote extraction is
  configured, making the document data boundary visible before ingestion.
- Remote mode explicitly discloses that optional source URI metadata and bounded
  reviewed feedback travel with documents.
- Graph JSON and Obsidian feedback imports remain available even when the
  optional extractor endpoint is misconfigured.

## Deployment

This is a static site: GitHub Pages, Cloudflare Pages, Netlify, or any static
file host can serve it. HTTPS is recommended so the service worker and browser
file APIs behave consistently. The app is useful without a backend; a future
backend is optional, and the included same-origin server can be replaced with
a model-backed extraction implementation behind the same graph contract.
- GitHub Pages deployment is ready through `.github/workflows/pages.yml`. It
  publishes the generated `dist/` bundle rather than the repository root, so
  server code, tests, container files, and local project metadata stay out of
  the public artifact.
- To inspect the exact Pages artifact locally, run `npm run build:pages` and
  serve `dist/` over HTTP.
- Or run `npm run serve:pages` to rebuild and serve that exact artifact on
  `http://localhost:8000`.
- The Pages artifact also generates `feed.xml` from the published learning
  notes; the Node server provides the richer origin-aware feed when
  `PUBLIC_ORIGIN` is configured.
- Public asset delivery is defined once in `scripts/public-assets.mjs` and
  checked against the offline service-worker shell during release validation.
- The repo should be easy to fork, improve, and deploy on GitHub Pages.
- The service worker prefers fresh shell assets and only falls back to its
  cache when offline or when the network stalls for three seconds; API and
  non-shell requests are not cached.
- Service-worker activation removes only older `llm-field-notes-*` caches, so
  deploying beside another app on the same origin does not erase its cache.
- Shell requests explicitly revalidate the browser HTTP cache so deployments
  do not remain stale for the static asset max-age window.
- The service-worker script itself is served `no-cache` so worker updates are
  discovered promptly.
- Cache quota or availability failures do not replace a successful fresh
  network response.

## Roadmap

- Add notebooks for the experiments in the 30-day path.
- Add a small gallery of community-built artifacts.
- Add translations without creating separate knowledge silos.

## License

The content is available under [CC BY 4.0](LICENSE).
