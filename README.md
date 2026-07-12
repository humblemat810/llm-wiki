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
- Inspecting provenance health, including unsupported concepts/relations and
  evidence coverage.
- Exporting the internal representation as JSON.
- Exporting/restoring a versioned full backup containing the graph and undo
  history.
- Exporting a complete Obsidian vault ZIP with an index, one Markdown note per
  concept, one editable note per relation, one note per source document,
  relations, and the graph JSON.
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

Run the dependency-free smoke checks with:

```bash
npm test
```

The same checks run in GitHub Actions on every push to `main` and every pull
request.

The test suite also serves the static asset graph through a local HTTP server
and verifies that the module entry points, service worker, manifest, styles,
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
- `manifest.webmanifest` / `sw.js` — installable, cacheable static deployment
- `tests/` — dependency-free graph and site smoke checks
- `schema/graph.schema.json` — versioned interchange contract for external tools
- `SECURITY.md` — data boundary and vulnerability-reporting guidance
- `.github/ISSUE_TEMPLATE/` — structured bug and feature intake
- `CONTRIBUTING.md` — how to make the wiki sharper

## Product principles

- Keep evidence attached to every inference.
- Make confidence and uncertainty visible.
- Let a person correct the representation without starting over.
- Treat projections as views over the graph, not separate copies of truth.
- Keep the graph schema stable as extractors improve.
- Remote extractor integrations must validate timeout configuration and reject
  malformed provider response shapes before normalization.

## Deployment

This is a static site: GitHub Pages, Cloudflare Pages, Netlify, or any static
file host can serve it. HTTPS is recommended so the service worker and browser
file APIs behave consistently. The app is useful without a backend; a future
server or model adapter can be added behind the same graph contract.
- The repo should be easy to fork, improve, and deploy on GitHub Pages.

## Roadmap

- Add full note pages as Markdown files.
- Add notebooks for the experiments in the 30-day path.
- Add a source-quality label and last-reviewed date to every note.
- Add a small gallery of community-built artifacts.
- Add translations without creating separate knowledge silos.

## License

The content is available under [CC BY 4.0](LICENSE).
