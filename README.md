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
- Loading and ingesting a batch of local text/Markdown documents in one undoable
  mutation.
- Extracting candidate concepts and evidence-backed co-occurrence relations.
- Optionally sending documents to a configured same-origin extraction endpoint
  that returns the same normalized graph contract; blank configuration keeps
  extraction fully local.
- Supplying up to 500 reviewed feedback examples with remote extraction so
  later representations can learn from earlier human corrections.
- Applying accepted concept feedback as extraction hints, suppressing rejected
  concepts, canonicalizing accepted aliases, and reusing accepted relation
  labels in the reference extractor.
- Canceling an in-flight remote extraction from the workbench without
  affecting local extraction or graph imports.
- Capping the serialized remote feedback context at 500,000 characters to keep
  provider requests predictable.
- Merging new documents into the existing graph instead of replacing it.
- Confirming or dismissing concepts to update confidence and create a revision.
- Confirming or dismissing relations with the same persistent feedback loop.
- Re-ingesting later documents without silently overriding dismissed knowledge.
- Normalizing imported graph JSON so duplicate IDs cannot create ambiguous state.
- Enforcing document-size limits inside the extractor, not only in the browser UI.
- Canonicalizing labels and titles so external text cannot break projections.
- Bounding graph collections to keep imports and model responses within a
  predictable browser resource envelope.
- Treating relation labels case-insensitively when merging repeated evidence.
- Canonicalizing line endings and trailing whitespace for duplicate-source
  detection while preserving original source text.
- Falling back to canonical source content when imported graphs contain legacy
  or custom fingerprints.
- Editing concept and relation labels without changing their stable IDs.
- Adding accepted concepts and relations manually when extraction misses an
  important idea.
- Remembering previous labels as aliases so later documents merge into the
  corrected concept instead of creating duplicates.
- Removing a bad source with provenance-aware pruning while preserving accepted
  manual knowledge and keeping the operation undoable.
- Undoing the last three local graph mutations with bounded snapshot history.
- Preserving malformed local graph data as a downloadable recovery snapshot
  instead of silently discarding it.
- Best-effort persistent browser storage requests after the user starts
  building a graph.
- Optimistic version checks for asynchronous batches, graph imports, backup
  restores, and Obsidian feedback so another browser tab cannot be silently
  overwritten.
- Preserving the latest graph when undo-history storage fills first, with a
  safe degraded write that discards only history.
- Showing a health warning when a save succeeds with reduced undo history.
- Restoring a full backup even when its history cannot fit, while preserving
  the restored graph and reporting the reduced history mode.
- Allowing users to clear local state even when a pre-clear undo snapshot cannot
  fit in storage.
- Browsing the graph as SVG or as an inspectable concept list.
- Filtering large graphs across concepts and relations without changing the
  stored representation.
- Searching graph evidence and source titles as well as concept/relation labels.
- Reusing a per-render source-title index so graph search stays responsive as
  provenance grows.
- Inspecting provenance health, including unsupported concepts/relations and
  evidence coverage.
- Surfacing a review queue that prioritizes low-confidence inferred concepts
  and relations for the next human correction.
- Exporting the internal representation as JSON.
- Exporting/restoring a versioned full backup containing the graph and undo
  history.
- Exporting a versioned feedback dataset containing reviewed concepts and
  relations, including aliases, for future extractor evaluation or
  improvement.
- Exporting a complete Obsidian vault ZIP with an index, one Markdown note per
  concept, one editable note per relation, one note per source document,
  relations, and the graph JSON.
- Sharing the public wiki entry point through the native share sheet or a
  clipboard fallback; local graph data is never placed in the shared URL.
- Importing edited concept/relation Markdown notes from an unpacked Obsidian
  vault so label, alias, and status corrections become graph revisions.

The extractor is deliberately transparent and provider-agnostic. A future
model-backed extractor can replace the heuristic while keeping the graph
schema, feedback loop, and projections stable.

Model-backed adapters should call `normalizeExtraction()` before merge; this is
the stable boundary for partial or provider-specific extraction responses.
`extractor-adapter.js` provides a small HTTP adapter with endpoint validation,
timeouts, bounded document input, and normalized responses. It is intentionally
not wired to a vendor or API key, so deployments can add a server-side provider
without putting credentials in the browser.

## Run it locally

There are no dependencies or build steps. Open `index.html` directly, or run:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

For a same-origin reference extraction endpoint, run:

```bash
npm run serve:node
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
reference endpoint requires JSON, validates the feedback format,
sets no-store response behavior, and emits baseline security headers.
It exposes `/healthz` for process liveness and `/readyz` for app readiness;
the latter verifies that the static shell is available.
Extraction responses include an `X-Request-ID` UUID for operational
correlation, and the browser adapter preserves that ID in remote errors. The
standalone server logs structured request ID, status, duration, and route
records without document content.

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
Invalid environment or embedded-server values fall back to the 60/minute
default. Declared request bodies over 2 MB are rejected before buffering.

The reference server can also run in a container:

```bash
docker build -t llm-field-notes .
docker run --rm -p 8000:8000 llm-field-notes
```

The image binds to `0.0.0.0`, includes a Docker health check, and keeps the
runtime dependency-free. It runs as the non-root `node` user; the Node server
aborts active provider calls and drains requests during SIGINT/SIGTERM shutdown.
The base image is digest-pinned for reproducible builds.
The Docker context excludes environment files, local exports, and development
tests.

Run the dependency-free smoke checks with:

```bash
npm test
```

The same checks run in GitHub Actions on every push to `main` and every pull
request across Node 18, 20, and 22.
CI also builds the Docker image to catch deployment drift.

The test suite also serves the static asset graph through a local HTTP server,
simulates service-worker install/network/offline behavior, and verifies that
the module entry points, manifest, styles,
and icon are all deliverable.

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
- `extractor-adapter.js` — provider-neutral remote extraction boundary
- `projection-adapter.js` — Obsidian feedback parser and graph update boundary
- `server.mjs` — optional same-origin static server and extraction contract example
- `manifest.webmanifest` / `sw.js` — installable, cacheable static deployment
- `tests/` — dependency-free graph and site smoke checks
- `schema/graph.schema.json` — versioned interchange contract for external tools
- `schema/feedback.schema.json` — versioned reviewed-example export contract
- `schema/backup.schema.json` — versioned full-backup restore contract
- `schema/extractor-request.schema.json` — versioned remote extraction request
  contract
- `SECURITY.md` — data boundary and vulnerability-reporting guidance
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
- Preserving valid-but-unsupported graph schema payloads for recovery instead of
  silently treating them as an empty graph.
- Normalizing duplicate source IDs so provenance links resolve to one document
  record.
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
- Remote mode explicitly discloses that bounded reviewed feedback travels with
  documents.
- Graph JSON and Obsidian feedback imports remain available even when the
  optional extractor endpoint is misconfigured.

## Deployment

This is a static site: GitHub Pages, Cloudflare Pages, Netlify, or any static
file host can serve it. HTTPS is recommended so the service worker and browser
file APIs behave consistently. The app is useful without a backend; a future
backend is optional, and the included same-origin server can be replaced with
a model-backed extraction implementation behind the same graph contract.
- The repo should be easy to fork, improve, and deploy on GitHub Pages.
- The service worker prefers fresh shell assets and only falls back to its
  cache when offline; API and non-shell requests are not cached.
- Cache quota or availability failures do not replace a successful fresh
  network response.

## Roadmap

- Add full note pages as Markdown files.
- Add notebooks for the experiments in the 30-day path.
- Add a source-quality label and last-reviewed date to every note.
- Add a small gallery of community-built artifacts.
- Add translations without creating separate knowledge silos.

## License

The content is available under [CC BY 4.0](LICENSE).
