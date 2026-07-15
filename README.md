# LLM Field Notes

**Understand the machine. Build the thing.**

LLM Field Notes is an open, practical knowledge workspace for turning documents
into an inspectable, evolving knowledge graph. It is organized around a simple
loop:

> ingest → infer → inspect → improve → project

The goal is not to hide behind a generated summary. It is to preserve the
concepts, relations, confidence, source evidence, and revision history so a
curious person can challenge the representation and improve it over time.

Browse the [community artifacts](artifacts.html) for runnable starting points,
or submit a small experiment, graph, benchmark, or failed attempt using the
[artifact template](ARTIFACT_SUBMISSION.md).
Each public artifact card includes a copy-paste command to try or inspect it
from the repository root.
The [sample graph export](examples/sample-graph.json) is a small, deterministic
internal representation with a whole-graph integrity fingerprint; inspect,
diff, health-check, or project it into JSON-LD without opening the browser
first. The release smoke suite verifies its fingerprint, provenance, evidence
grounding, and no-loss health gate before publication.

The self-improvement walkthrough is also available as `npm run learning:loop`.
The [knowledge-graph note](notes/knowledge-graphs.md) explains the same loop
from document to reviewed, reusable representation.

## Try it in 60 seconds

The fastest path to the useful loop is:

```bash
npm run serve:pages
```

Open `http://localhost:8000`, choose **Try a sample graph**, then inspect the
concepts, evidence, review queue, and Obsidian projection. After that, paste a
paper or transcript into the workbench and choose **Build graph**. The default
path stays local in the browser; no provider or API key is required.

## Current workbench

The browser workbench supports:

- Pasting a document or loading a local `.txt` / `.md` file.
- Building the graph from the document editor with `Ctrl+Enter` or
  `Cmd+Enter`.
- Trying a one-click local sample graph from the landing page so the full
  ingest, inspect, and projection loop is visible immediately.
- Asking before adding that sample to a non-empty workspace, while keeping
  first-run onboarding one-click and the existing graph undoable.
- Asking before the in-workbench sample control replaces an unbuilt document
  draft or queued files, so exploratory notes are not silently discarded.
- Launching that sample walkthrough directly from an installed app shortcut.
- Loading and ingesting a batch of local text/Markdown documents in one undoable
  mutation.
- Showing a bounded summary of per-file batch failures so partial imports are
  recoverable without overwhelming the workbench.
- Extracting candidate concepts and evidence-backed co-occurrence relations.
- Preferring repeated concepts, explicit phrases, headings, quoted terms, and
  reviewed feedback over isolated generic vocabulary in the local extractor.
- Capturing a bounded set of adjacent content-word phrases such as “weighted
  lookup” and “positional encoding” so important lower-case concepts remain
  legible, while filtering common verb and preposition fragments that create
  misleading graph edges.
- Keeping Markdown headings separate from prose units so heading text does not
  become duplicated or synthetic concepts during extraction.
- Handling punctuation-light and mixed Markdown by supplementing prose with
  bounded paragraph, bullet, numbered-list, and quote-line units, while keeping
  separate list items from becoming false cross-item relations.
- Retaining Unicode concept labels and extracting multilingual tokens instead
  of silently reducing local extraction to ASCII-only documents.
- Bounding extracted words per text unit as well as total extraction units, so
  multilingual segmentation cannot turn a large document into unbounded work.
- Bounding the total heuristic candidate set and per-candidate evidence before
  ranking, so adversarial documents cannot force unbounded pre-normalization
  memory or quadratic phrase analysis, while reserving capacity for phrases and
  structural candidates after generic terms.
- Disclosing when the bounded feedback export window omits reviewed items, with
  an explicit confirmation before a partial feedback dataset is imported.
- Keeping Unicode segmentation itself behind an explicit character budget and
  ignoring numeric-only tokens to reduce low-value graph noise.
- Making offline shell fallback query-tolerant so cache-busted static assets
  still resolve to the installed application shell.
- Preserving online 4xx navigation responses so a deployed branded 404 page is
  not replaced by the cached workbench shell.
- Rejecting truncated or unreadable service-worker shell responses before they
  can poison the offline cache.
- Showing an explicit offline status so users know the local graph and cached
  wiki remain usable while configured remote extraction is unavailable.
- Exposing accessible semantics for the visual and interactive workbench
  surfaces, so the learning map remains useful with assistive technology.
- Failing configured remote extraction fast while offline, so users can
  reconnect or clear the endpoint for the local extractor instead of waiting
  through network retries.
- Bounding browser operation diagnostics before they reach batch, vault, or
  rebuild failure summaries.
- Bounding diagnostics across export, recovery, and global runtime-error
  surfaces so an unusually large provider or parser exception cannot flood
  the workbench UI.
- Warning before closing a tab when a populated graph is only tab-scoped or
  storage durability has degraded, while leaving durable workspaces quiet.
- Warning before closing a tab when a document title, source URI, or document
  draft has not been successfully built yet, while clearing that warning after
  the draft is committed.
- Recovering a bounded unfinished editor draft from app-local storage after a
  reload or browser eviction, restoring it only into an empty editor and
  clearing the recovery copy after a successful build.
- Warning before closing a tab when selected batch files remain queued in
  memory, since browser `File` objects cannot be restored after reload.
- Exposing an explicit process/retry action for batch files retained in the
  in-memory queue.
- Rejecting opaque or cross-origin final responses after shell fetch
  redirects, so a service-worker cache cannot be poisoned by an external
  redirect.
- Coordinating service-worker upgrades with an explicit reload action so an
  open workbench is not mixed with assets from two application releases.
- Optionally sending documents to a configured same-origin extraction endpoint
  that returns the same normalized graph contract; blank configuration keeps
  extraction fully local.
- Remembering a validated same-origin extractor path locally across reloads,
  without accepting embedded credentials or cross-origin endpoints.
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
- Recording client-aborted server extraction requests as privacy-safe
  cancellation telemetry, so disconnects can be distinguished from provider
  failures during operations.
- Locking competing build, sample, and file-selection actions while a build is
  in flight, preventing duplicate extraction and stale queue replacement.
- Canceling a multi-file build between extraction requests while preserving
  unprocessed files in the queue and committing any completed partial batch.
- Capping the serialized remote feedback context at 500,000 characters to keep
  provider requests predictable.
- Rejecting remote extraction when reviewed guidance would exceed that
  serialized bound, so providers never receive an undisclosed partial context.
- Rejecting oversized browser document files before reading them, with a 10 MB
  JSON import safety limit and a 50 MB Obsidian ZIP limit.
- Requiring Obsidian ZIP parsers to receive actual byte buffers or views before
  applying archive limits, preventing array-like coercion from allocating first.
- Requiring binary browser downloads to receive actual byte buffers or views
  before applying export limits.
- Rejecting generated ZIP filenames that cannot fit the archive format's
  16-bit filename header instead of emitting a corrupt vault.
- Bounding batch ingestion to 100 files and 10 MB of aggregate text so a
  selection cannot overwhelm browser memory.
- Merging new documents into the existing graph instead of replacing it.
- Confirming or dismissing concepts to update confidence and create a revision.
- Confirming or dismissing relations with the same persistent feedback loop.
- Re-confirming an existing manual relation increments its feedback history,
  keeping relation learning counts consistent with concept review.
- Rejecting feedback imports above the published example bound instead of
  silently dropping the tail of a human decision dataset.
- Re-ingesting later documents without silently overriding dismissed knowledge.
- Rebuilding all saved sources through the current extractor and reviewed
  feedback in one cancelable, conflict-checked operation, so new learning can
  improve the existing representation instead of only future documents; the
  action refuses redacted, incomplete, or ambiguous-source graphs before
  sending source text to an extractor and snapshots fresh reviewed guidance
  before replacing any source. Provider failure diagnostics are bounded and
  normalized before they reach the status surface.
- Surfacing an **apply learning to saved sources** action directly in graph
  health whenever reusable feedback and saved documents coexist, so the
  self-improvement loop does not depend on discovering a separate control.
- Letting source review candidates be marked reviewed today from the source
  inspector in one guarded, undoable revision, while leaving source quality
  selection explicit; repeating the action on the same UTC day is idempotent.
- Canceling a remote source replacement before it can mutate the graph, while
  preserving the existing source if extraction is interrupted.
- Normalizing imported graph JSON so duplicate IDs cannot create ambiguous state.
- Rejecting duplicate JSON object keys and excessively nested JSON before
  request, persistence, browser-import, projection, or verification code
  interprets the payload.
- Applying that same duplicate-key and nesting policy to remote extractor
  responses, so provider output cannot use parser ambiguity to change the
  normalized graph.
- Applying the same policy to durable pending-write metadata, so IndexedDB
  hydration cannot interpret ambiguous local synchronization markers or
  silently replace a newer synchronous mirror with stale durable state;
  malformed marker entries also fail closed.
- Capping graph and curriculum search queries before repeated browser scans,
  keeping large pasted queries from turning normal filtering into avoidable
  work.
- Slicing local text, JSON, and Obsidian files to their bounded byte limit
  before reading, so malformed file-like inputs cannot allocate oversized
  browser buffers before validation.
- Rejecting malformed streamed response results and array-buffer values before
  they can bypass browser or remote extractor response limits, with the same
  byte-data contract enforced in both readers.
- Rejecting truncated browser and remote response bodies when their received
  bytes do not match a declared `Content-Length`.
- Rejecting malformed service-worker shell stream results before a broken
  response can bypass its byte budget or stall offline-cache fallback, including
  forged byte-length objects that are not actual byte views.
- Building the static Pages bundle in a private staging directory and
  publishing it with a final swap, so a late build or manifest failure cannot
  leave `dist/` half-written.
- Applying duplicate-key-safe JSON parsing to release, Pages, artifact, and
  graph-health command boundaries, keeping standalone verification consistent
  with the browser and server contracts.
- Rejecting opaque or cross-origin redirect responses for release metadata and
  learning-note exports, so a static asset gateway cannot inject remote content
  into the workbench or an Obsidian projection.
- Checking the graph fingerprint again after asynchronous learning-note
  collection, so Obsidian vault downloads cannot mix revisions.
- Bounding total learning-note collection time for vault exports, while
  retaining per-note failure diagnostics for partial but explicit results.
- Collapsing duplicate imported and extractor records deterministically so
  reordering equivalent payloads cannot change graph fingerprints or learning
  identity.
- Preserving bounded-import truncation diagnostics so an oversized or partial
  graph cannot look complete without an explicit warning.
- Applying the aggregate source-text budget during graph imports as well as
  live ingestion, retaining the newest deterministic source window and
  disclosing older source records omitted by that bound.
- Reporting document-text and evidence-text clipping separately from
  collection overflow, so bounded imports cannot hide lost source material.
- Reporting clipped document titles separately, so malformed graph metadata
  cannot be mistaken for an untouched source projection.
- Disclosing contradictory review statuses when duplicate imported concept or
  relation records are merged, instead of presenting the result as a clean
  duplicate.
- Carrying those contradiction diagnostics into Markdown/Obsidian projections
  and revision previews, keeping external views as auditable as the browser.
- Explaining text-level import clipping directly in the live health strip so
  recovery actions are understandable without opening a health export.
- Enforcing document-size limits inside the extractor, not only in the browser UI.
- Rejecting malformed or truncated HTTP extraction bodies when their declared
  `Content-Length` does not match the bytes received.
- Canonicalizing labels and titles so external text cannot break projections.
- Bounding graph collections to keep imports and model responses within a
  predictable browser resource envelope.
- Bounding aggregate source text across repeated ingestion so a long-lived
  local graph cannot grow without limit even when each document is individually
  valid.
- Bounding evidence text and provenance-reference arrays at the same
  normalization boundary.
- Reporting omitted nested evidence records and provenance references
  separately, so bounded imports cannot hide incomplete grounding.
- Retaining a bounded revision timeline so backups and browser state remain
  predictable.
- Treating relation labels case-insensitively when merging repeated evidence.
- Canonicalizing line endings and trailing whitespace for duplicate-source
  detection while preserving original source text.
- Falling back to canonical source content when imported graphs contain legacy
  or custom fingerprints.
- Treating custom fingerprint collisions as identity ambiguity rather than
  silently merging distinct source text.
- Using a dual-lane deterministic content digest for newly generated source
  fingerprints so accidental identity collisions remain extremely unlikely.
- Deriving heuristic source IDs from normalized content as well as fingerprints,
  making repeated standalone extraction results reproducible.
- Editing concept and relation labels without changing their stable IDs.
- Rejecting relation label edits that would silently merge an existing
  same-endpoint relation, preserving both semantic edges for an explicit merge.
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
- Offering recovery downloads directly from the runtime error panel, so a
  rendering failure can be backed up before the user reloads the workbench.
- Preserving malformed undo-history data as a separate downloadable recovery
  snapshot instead of silently losing prior revisions.
- Preserving over-capacity undo-history data in that recovery snapshot before
  applying the configured history bound.
- Preserving discarded or malformed history supplied by a backup restore in
  the same recovery snapshot before applying the local undo-history bound.
- Preserving imported history evicted when a restore also keeps the current
  graph as an undo snapshot.
- Failing graph writes, undo, restore, and clear closed before mutation when
  their pre-mutation storage snapshot cannot be read.
- Best-effort persistent browser storage requests after the user starts
  building a graph.
- Hydrating graph state from IndexedDB when available, migrating existing
  `localStorage` state automatically, and retaining a synchronous fallback when
  IndexedDB is unavailable.
- Flushing queued durable writes when the page is being discarded, reducing the
  chance that the newest local revision is lost during navigation or tab
  closure.
- Recording a bounded pending-write marker beside the synchronous mirror so an
  interrupted IndexedDB commit cannot make the next hydration prefer stale
  graph state.
- Giving pending-write generations a storage-instance identity so rapid
  same-key writes from multiple tabs cannot clear one another's recovery marker.
- Surfacing asynchronous durable-storage failures in the privacy note and graph
  health strip so users know when to export a backup, with a direct backup
  action available from the warning.
- Providing the same direct backup action when browser storage is entirely
  unavailable and the graph exists only for the current tab.
- Optimistic version and content-fingerprint checks for asynchronous batches,
  graph imports, backup restores, and Obsidian feedback so another browser tab
  cannot silently overwrite a divergent same-version graph.
- The same conflict protection covers single-document extraction, manual
  concept and relation edits, source removal, and feedback clicks.
- Undo and clear also refuse to overwrite a graph that changed in another tab.
- Undo history configuration is sanitized so zero or invalid capacities cannot
  accidentally disable the storage bound.
- Persisted graph JSON is bounded by both character count and UTF-8 byte size,
  so Unicode-heavy state cannot bypass the storage safety budget.
- The browser storage adapter applies the same UTF-8 byte ceiling during
  IndexedDB/localStorage hydration and cross-tab synchronization, before a
  large Unicode value can enter the in-memory mirror.
- Refreshing the workbench when another tab changes the saved graph, with a
  visible synchronization notice.
- Repairing stale cross-tab graph events through the same version and content
  fingerprint preconditions as user mutations, so a newer concurrent update
  cannot be overwritten during repair.
- Preserving the latest graph when undo-history storage fills first, with a
  safe degraded write that discards only history.
- Showing a health warning when a save succeeds with reduced undo history.
- Including the reduced-undo-history warning in the immediate mutation status,
  so a successful graph write cannot look fully recoverable until the next
  health-strip render.
- Providing the same direct backup action for reduced undo history that is
  available for durable-storage failures.
- Restoring a full backup even when its history cannot fit, while preserving
  the restored graph and reporting the reduced history mode; browser backup
  restores also retain the pre-restore graph as the newest undo snapshot.
- Allowing users to clear local state even when a pre-clear undo snapshot cannot
  fit in storage.
- Browsing the graph as SVG or as an inspectable concept list.
- Browsing every ingested source document in the List view, including sources
  whose extraction produced no concepts.
- Filtering large graphs across concepts and relations without changing the
  stored representation.
- Preserving explicit relation verbs such as “improves,” “preserves,” “reduces,”
  and “increases” instead of collapsing them into generic co-occurrence edges,
  including shared-subject multi-clause sentences.
- Keeping sparse documents on the same noise-filtered ranking path, so a
  short input does not reintroduce isolated terms beside stronger phrases.
- Retaining one-off endpoints explicitly named by accepted relation feedback,
  so reviewed learning can still guide a short follow-up document.
- Removing weaker one-word candidates when their evidence is fully subsumed by
  a stronger multi-word phrase, without hiding repeated or reviewed concepts.
- Coalescing expensive search renders per animation frame so filtering remains
  responsive as the graph grows.
- Reusing fingerprinted health, review-queue, and Markdown projection work
  while search changes, avoiding repeated full-graph scans, with a non-sliding
  30-second expiry so time-sensitive review status cannot remain cached
  forever.
- Building the live health strip and review queue from one bounded graph
  inspection pass, so evidence-grounding work is not repeated for the same
  render.
- Searching graph evidence and bounded source text as well as concept/relation labels.
- Searching source quality and review metadata through the same graph index.
- Honoring `prefers-reduced-motion` by disabling the ticker and shortening
  interface transitions for readers who request less animation.
- Retaining optional bounded source URIs through graph JSON, remote extraction,
  and Obsidian source notes.
- Rendering safe HTTP(S) source URIs as clickable links in the Markdown
  projection while keeping other allowed URI schemes as escaped text.
- Rejecting ambiguous HTTP forms and embedded HTTP(S) credentials before source
  URI metadata reaches graph storage or projections, with matching graph, diff,
  and extractor-request schema constraints.
- Reusing a per-render source-title index so graph search stays responsive as
  provenance grows.
- Bounding per-item search text and evidence previews so large imported graphs
  cannot force unbounded search-index allocations.
- Inspecting provenance health, including unsupported concepts/relations and
  active-item provenance coverage, source review coverage, and quality
  distribution.
- Showing how many reviewed feedback decisions are retained for future
  extraction guidance.
- Showing how many unique reviewed decisions are available versus retained in
  the bounded extractor guidance context, so learning-memory truncation is
  visible rather than silent.
- Revisiting stale human decisions after a bounded freshness window, so
  accepted or rejected knowledge and source metadata can be challenged as new
  evidence arrives.
- Prioritizing reviewed concepts and relations immediately when a newly added
  source contributes evidence after their last human review, rather than
  waiting for the time-based stale window.
- Reporting stale-review pressure in graph health exports and the workbench,
  making representation drift visible to operators and quality gates.
- Reporting evidence-grounding coverage separately from source-ID provenance:
  exact normalized quotes are counted as anchored, while useful paraphrases
  remain visible as unanchored evidence for review.
- Using one explicit inspection timestamp for stale-review health, guidance
  counts, and extractor feedback at the freshness boundary.
- Separating historical source-review coverage from fresh source-review
  coverage, so old metadata is not counted as current trust.
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
- Allowing users to forget only stale reusable learning memory while preserving
  fresh reviewed guidance and an undoable revision.
- Keeping stale reusable learning memory in the audit trail while excluding it
  from new extraction guidance until a human reviews it again.
- Reporting active extractor guidance counts separately from stale learning
  memory, so health metrics describe what the next extraction can actually use.
- Applying the same fresh-only guidance and context-stats rule by default to stale accepted or rejected
  concepts and relations, not only to detached learning examples.
- Requiring a valid review timestamp before any reusable memory or reviewed
  graph item can steer new extraction.
- Reporting guidance withheld pending review so stale-memory suppression is
  visible rather than silent.
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
- Refreshing review time when an Obsidian concept or relation is substantively
  corrected, so unchanged exported frontmatter cannot make new human learning
  immediately stale, while older projections cannot roll a newer review back.
- Refreshing source review time when source title, URI, or quality metadata is
  substantively edited without an explicit replacement review date.
- Verifying projection identity on every feedback note inside a vault, not
  only on the vault manifest, so stale individual edits are disclosed before
  import.
- Surfacing an explainable review queue that prioritizes low-confidence,
  evidence-free, or unresolved-provenance inferred concepts and relations,
  plus unknown-quality or never-reviewed sources, for the next human
  correction, with confirm/dismiss actions available directly in the
  inspector.
- Showing the bounded prioritized review queue itself, including each
  candidate's reason and priority, so the self-improvement loop remains
  inspectable rather than hidden behind a single “review next” action.
- Disclosing when the review queue safety cap hides lower-priority candidates,
  so the visible queue is not mistaken for the complete review workload.
- Routing exact evidence-grounding failures back to the affected concept or
  relation with a bounded unanchored-evidence count, without exporting source
  text, evidence quotes, or source URIs.
- Exporting the internal representation as JSON.
- Including an optional deterministic graph fingerprint in JSON exports so
  imports can detect accidental edits or truncation without treating harmless
  document/concept/relation reordering as a change, while legacy graphs remain
  readable.
- Binding Markdown projections to the normalized graph fingerprint so copied
  notes can be traced back to the exact representation that produced them.
- Copying the current Markdown projection directly to the clipboard for quick
  sharing into Obsidian, issues, or chat.
- Copying a redacted Markdown projection directly to the clipboard, removing
  source text, evidence quotes, and URIs before sharing.
- Sharing the redacted Markdown projection through the native file-share
  surface when available, with clipboard and download fallbacks.
- Exporting a redacted graph that preserves structure and review state while
  removing source text, evidence quotes, and source URIs for safer sharing.
- Bounding Obsidian archive file count and validating every generated file
  record before allocating ZIP parts.
- Preflighting source and evidence bytes before building large Markdown,
  Obsidian, feedback, and revision-diff projections, so oversized exports fail
  before expensive serialization.
- Exporting a redacted Markdown projection for quick, privacy-safe sharing in
  issues, chat, and Obsidian-compatible viewers.
- Exporting a redacted Obsidian vault with the same privacy boundary, so
  shareable Markdown projections do not require exposing source material; the
  exported notes visibly mark the redaction state.
- Regression-checking complete redacted Markdown and vault payloads for
  source-text and URI leakage, not only their individual source files.
- Exporting a bounded structured diff for the latest graph revision, so
  representation changes, learning memory, integrity diagnostics, and privacy
  state can be reviewed or shared independently.
- Exporting a versioned privacy-safe graph health report with provenance,
  review, actionable-candidate, ambiguity, and support diagnostics for issue
  reports or automation, including a bounded metadata-only review queue without
  source text, evidence text, or source URIs, and identifying the producing app
  version for reproducible diagnostics.
- Exporting/restoring a versioned full backup containing the graph and undo
  history, with a deterministic fingerprint that detects accidental edits or
  truncation before restore.
- Exporting a versioned feedback dataset containing reviewed concepts and
  relations, including aliases, for future extractor evaluation or
  improvement.
- Reserving feedback-export capacity for current reviewed graph decisions so
  detached reusable memory cannot hide the newest human correction.
- Ordering reusable learning examples by review freshness before bounded
  export selection, so import order cannot evict newer corrections.
- Stamping feedback exports with a deterministic reviewed-dataset fingerprint
  so evaluation runs can prove they used the intended examples; new exports
  use a dual-lane 64-bit digest while legacy fingerprints remain importable.
- Exporting compact feedback without evidence or source IDs for safer sharing
  of reviewed learning decisions.
- Evaluating an extractor or graph against that feedback dataset with a
  dependency-free CLI, reporting accepted recall and rejected-example
  suppression so improvements can be compared rather than guessed.
- Comparing baseline and candidate evaluation reports with a dependency-free
  regression gate that fails promotion when accepted recall or rejected-example
  suppression worsens beyond an explicit tolerance, while rejecting reports
  generated from different reviewed datasets, empty reviewed benchmarks, or
  contradictory reviewed decisions.
- Validating that recall, suppression, and evidence-coverage ratios agree with
  their counts before a promotion comparison trusts them.
- Requiring bounded, parseable evaluation timestamps so promotion artifacts
  retain machine-readable provenance.
- Requiring full RFC3339-style date-time values rather than ambiguous date-only
  provenance.
- Rejecting unknown evaluation fields so runtime validation and the closed
  published schema cannot silently drift.
- Rejecting reviewed datasets above the evaluation bound instead of silently
  truncating a benchmark while retaining its original fingerprint.
- Rejecting candidate concept or relation collections above graph limits before
  normalization, so evaluation never scores a silently truncated extraction.
- Rejecting malformed or unreviewed benchmark examples instead of silently
  filtering them out of evaluation metrics.
- Rejecting oversized reviewed-example identities, aliases, evidence, and
  provenance arrays before evaluation matching or fingerprint work.
- Validating relation labels and endpoint pairs during evaluation even when a
  candidate reuses the reviewed relation ID, while treating reversed endpoint
  order as the same graph relation.
- Reporting evidence-backed coverage separately from recall, so a candidate
  cannot appear complete merely by naming the right concepts or relations;
  evidence must point back to the evaluated source.
- Excluding explicitly rejected candidate items from accepted-recall scores,
  so suppression cannot be mistaken for successful extraction.
- Importing that feedback dataset into another graph workspace idempotently,
including reviewed aliases, so decisions can travel between projects without
double-counting. When IDs differ, concept feedback falls back to canonical
labels and aliases; import counts refer to reviewed items rather than individual
field changes, unmatched or invalid examples are reported as skipped, and
contradictory decisions for one identity are disclosed while the newest
timestamp wins; equally undated decisions use a stable deterministic
tie-break rather than file or dataset order.
- Resetting completed file imports so selecting the same source again reliably
  starts a new import.
- Saving learning-map progress through the same browser storage boundary as
  the graph, surfacing failures instead of silently losing checkmarks, and
  synchronizing progress across open tabs.
- Giving note deep links note-specific browser and share metadata while
  restoring the wiki-level metadata when the dialog closes.
- Linking each learning-map card directly to both its crawler-readable HTML
  viewer and its raw Markdown source, so shared reading and Obsidian forking
  are equally close at hand.
- Exporting a complete Obsidian vault ZIP with an index, one Markdown note per
  concept, one editable note per relation, one note per source document,
  relations, a navigable reusable-review ledger, the bounded revision history,
  the graph JSON, and an orientation
  README describing the round-trip review workflow, plus a fingerprinted vault
  manifest and fingerprinted graph JSON for projection identity.
  The vault also carries the versioned JSON-LD projection for machine-readable
  graph tooling.
- Exporting the same normalized representation as interoperable JSON-LD, with
  source fingerprints, explicit concept/relation provenance, and review
  metadata preserved, plus a redacted variant that removes source text,
  evidence quotes, and source URIs. It also carries bounded reusable learning
  examples, portable relation endpoint labels, and graph revision counts for
  external audit.
- Preflighting each generated vault and learning-note file against the ZIP
  size limit, streaming learning-note responses under a 1 MB per-note memory
  bound, and failing clearly rather than silently omitting notes when a limit
  is hit.
- Maintaining the public learning map as versioned Markdown pages under
  `notes/`, so the curriculum is forkable, linkable, and usable in Obsidian.
- Rendering those same Markdown notes as escaped, crawler-readable HTML
  learning pages, while preserving the raw Markdown alternate for copying and
  Obsidian and allowing only safe HTTP(S) source links to become clickable.
- Including a bounded Mermaid graph view in Markdown projections for visual
  inspection in Obsidian-compatible viewers.
- Including privacy-safe graph health diagnostics in the Markdown projection,
  so provenance gaps, review debt, and bounded-import or malformed-import loss
  remain visible outside the browser.
- Bounding evidence retained in full Markdown projections so large graphs
  produce a useful, explicitly marked export instead of an unbounded string.
- Including those learning pages in Obsidian vault exports and precaching them
  for offline reading.
- Sharing the public wiki entry point through the native share sheet or a
  clipboard fallback; local graph data is never placed in the shared URL.
- Keeping note links, Markdown projections, and contribution templates
  copyable when Clipboard API permissions are unavailable by using a bounded
  temporary-textarea fallback.
- Keeping source-bearing export controls associated with a persistent privacy
  warning, while redacted actions remain the recommended public-sharing path.
- Copying a direct deep link for each learning note from its map card.
- Publishing a dedicated 1200×630 share card for richer link previews on social
  platforms and team chat.
- Publishing machine-readable JSON-LD metadata so search engines can identify
  the project as a free educational knowledge-workbench.
- Keeping that inline metadata covered by a narrowly scoped CSP hash rather
  than weakening the page with `unsafe-inline`.
- Opening learning notes through shareable `#note=...` deep links that survive
  reloads and browser back/forward navigation.
- Publishing crawler-readable note landing pages with note-specific canonical,
  Article JSON-LD, feed discovery, and social metadata while retaining the
  interactive modal workflow.
- Enforcing a no-script content-security policy on note landing pages so the
  public reading surface stays separate from the interactive workbench.
- Precaching generated note landing pages in the Pages service-worker shell so
  shared curriculum links remain available offline after first install.
- Importing edited concept/relation Markdown notes from an unpacked Obsidian
  vault so label, alias, and status corrections become graph revisions; vault
  imports surface invalid or stale manifest metadata, require explicit
  confirmation before applying edits from an older or unverifiable graph
  revision, reject conflicting duplicate edits instead of choosing a file-order
  winner, validate relation endpoints before applying edits, and
  bind source metadata edits to the source document fingerprint,
  verify embedded graph JSON against the vault manifest before applying edits,
  individual exported notes retain the same projection identity. Concept,
  relation, and source metadata notes round-trip through ZIP imports; malformed
  exported notes fail the import closed rather than being silently skipped.
- Smoke tests parse generated editable concept and relation notes through the
  same importer used for user feedback, keeping projection and import contracts
  coupled.
- Confirming destructive graph and full-backup replacement imports while
  retaining the previous graph through the undo path.
- Rejecting oversized Obsidian feedback notes before frontmatter parsing.

The extractor is deliberately transparent and provider-agnostic. A
model-backed extractor can replace the heuristic while keeping the graph
schema, feedback loop, and projections stable.

The implementation boundaries and extension rules are documented in
[ARCHITECTURE.md](ARCHITECTURE.md).

To compare an extractor revision against reviewed examples:

```bash
node experiments/evaluate-feedback.mjs feedback.json extraction.json --max-untrusted-feedback 0
```

The evaluator emits the versioned `llm-field-notes/evaluation@1` contract. It
measures accepted recall, reviewed-candidate precision, and whether rejected
examples stay out of the representation; reviewed precision is limited to
candidates that match reviewed examples and does not pretend a sparse human
feedback set is a complete precision benchmark. The report also separates fresh,
stale, and undated reviewed examples. Use `--max-untrusted-feedback 0` to make
production promotion fail closed on stale or undated feedback while preserving
historical evaluation for analysis.

To compare two graph exports or full backups outside the browser:

```bash
node experiments/verify-graph.mjs graph.json
node experiments/diff-graphs.mjs before.json after.json
node experiments/verify-diff.mjs before.json after.json diff.json
```

The verifier checks the normalized graph fingerprint before downstream tools
consume an export. The same comparison is available as
`npm run diff -- before.json after.json`; graph and backup inputs must declare
compatible versioned contracts.
Fingerprint-protected backups are verified before either graph tool consumes
them.

To gate an extractor or representation improvement:

```bash
node experiments/compare-evaluations.mjs baseline-evaluation.json candidate-evaluation.json --max-untrusted-feedback 0
```

The command exits non-zero when any accepted-recall, reviewed-precision, or
rejected-suppression metric regresses. Pass `--max-regression 0.02` to allow a
documented two-point tradeoff. Pass `--max-untrusted-feedback 0` to make the
promotion gate reject stale or undated reviewed examples; legacy reports
without freshness diagnostics fail closed when this option is used. Gated
comparison artifacts record the threshold and the baseline/candidate untrusted
example counts.

To inspect graph quality in automation:

```bash
npm run health -- graph.json --min-provenance 95 --min-fresh-source-review 90 --max-orphaned 0 --max-ambiguous 0 --max-conflicting-items 0 --max-unsupported-nodes 0 --max-unsupported-edges 0 --max-review-candidates 25 --max-review-queue-truncated 0 --max-evidence-grounding-truncated 0 --max-feedback-context-truncated 0 --max-stale-review-candidates 10 --max-stale-learning-examples 25 --max-withheld-guidance 25 --max-unanchored-evidence 0 --max-truncated-items 0 --max-dropped-items 0
```

This emits the privacy-safe health contract and exits non-zero when the
requested quality thresholds are missed.
Use `--max-review-queue-truncated 0` when automation must fail if the bounded
review queue omits lower-priority candidates, and
`--max-evidence-grounding-truncated 0` when grounding coverage must be based on
a complete inspection rather than a bounded sample. Use
`--max-feedback-context-truncated 0` when extraction guidance must include the
complete retained learning context.
The report and gate reuse the same normalized diagnostic pass, so large graphs
are not scanned twice; `--max-ambiguous` includes duplicate canonical concept
labels as well as provenance and identifier ambiguity. `--max-conflicting-items
0` rejects duplicate concept or relation records whose review statuses disagree.
The unsupported-node
and unsupported-edge gates require every active item to retain valid evidence
or provenance. Use `--max-truncated-items 0 --max-dropped-items 0` when partial
or malformed imports must fail the gate rather than remain diagnostic-only.

To project a graph or backup into JSON-LD from automation:

```bash
npm run project:jsonld -- graph.json > graph.jsonld
npm run project:jsonld -- graph.json --redacted > graph-redacted.jsonld
npm run verify:jsonld -- graph.json graph.jsonld
```

The CLI verifies graph or backup fingerprints before projection and uses the
same pure projection module as the browser export. `verify:jsonld` checks an
existing artifact against the normalized graph and exits non-zero if its
content, fingerprint, or redaction state diverges.

Before publishing a release, run `npm run release:check` to verify that the
package version, non-future public release date, changelog heading, every
shared public/offline asset, and the public artifact gallery agree and are
non-empty. The shorter `npm run artifacts:check` command validates only the
gallery cards, structured discovery metadata, and downloadable targets.
`npm run build:pages` runs the same artifact gate before generating a
publishable static bundle.

Model-backed adapters should call `normalizeExtraction()` before merge; this is
the stable boundary for partial or provider-specific extraction responses.
HTTP adapters should use `normalizeExtractionForDocument()` when the submitted
document's title, text, URI, and provenance must remain authoritative.
`extractor-adapter.js` provides a small HTTP adapter with endpoint validation,
timeouts, one bounded retry for transient network/HTTP failures, bounded
document input and response size, and normalized responses. It is intentionally
not wired to a vendor or API key, so deployments can add a server-side provider
without putting credentials in the browser.
The timeout races the underlying fetch as well as aborting its signal, so a
non-conforming provider client cannot leave extraction pending forever.
Remote extraction treats the submitted title, text, URI, and content fingerprint
as authoritative source metadata; a provider can contribute graph nodes and
relations but cannot rewrite the document provenance envelope or attach
node/evidence provenance to an unrelated source.

## Run it locally

There are no runtime dependencies. Serve the repository over HTTP so browser
modules, service workers, and durable storage work consistently:

```bash
npm run serve
```

For the exact GitHub Pages artifact, use:

```bash
npm run serve:pages
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
provider response also fails closed when it exceeds the graph's concept or
relation collection limits rather than silently dropping model output. The
invalid or absent `PORT` falls back to `8000`; an empty or absent `HOST`
falls back to `127.0.0.1`, while a non-empty host is passed to Node for
normal hostname validation. The reference endpoint requires JSON, validates
the feedback format,
sets no-store response behavior, and emits baseline security headers.
Batch ingestion keeps files that fail with transient remote network, upstream,
or timeout errors in the queue so they can be retried after the provider or
connection recovers; deterministic validation failures are reported without
being retried indefinitely.
Provider concurrency is bounded to 8 in-flight extractions by default; configure
`EXTRACTOR_CONCURRENCY` to a value from 1 to 1,024 when provider capacity
requires a different ceiling. Excess work receives HTTP 503 with
`Retry-After: 1`.
Transient provider failures return HTTP 502 with `Retry-After: 1`, while
provider timeouts return HTTP 504 with `Retry-After: 5`. Malformed, oversized,
or schema-incompatible provider output fails closed without a retry hint;
repeating a deterministic contract violation will not repair it.
Set `EXTRACTOR_AUTH_TOKEN` to require a bearer token for extraction requests.
Loopback development keeps extraction open when it is unset; non-loopback
server hosts fail extraction closed with HTTP 503 until a token is configured.
The token is compared constant-time and is never logged. Public deployments
should still use TLS, gateway authentication, and a shared rate limiter.
The browser endpoint setting accepts a same-origin path or URL without
credentials, query strings, or fragments; keep authentication in the server
boundary rather than in the endpoint URL.
Browser deployments that use a gateway session can rely on same-origin cookies;
the app never stores or exposes provider credentials.
Set `METRICS_AUTH_TOKEN` independently when `/metrics` should require a bearer
token. Loopback development keeps metrics open when it is unset; non-loopback
server hosts fail metrics closed with HTTP 503 until a token is configured.
Keeping metrics behind a gateway remains recommended even though the endpoint
contains no document content.
Set `PUBLIC_ORIGIN` to the externally visible HTTPS origin to enable
`/sitemap.xml` and a deployment-aware `robots.txt` with crawlable learning-note
URLs, plus `/feed.xml` as an Atom subscription feed for the learning map.
The same HTTPS setting enables conditional HSTS for deployed responses; local
HTTP development remains free of browser-persistent HSTS state.
When configured, the server also emits absolute canonical, feed, and social
image URLs in the HTML shell so shared links remain previewable outside the
deployment origin.
Every application response carries a bounded request ID, and structured
application-error logs reuse that ID without recording document text, evidence,
or credentials, making deployment incidents correlatable without leaking graph
content.
Feed entries use the learning-note headings rather than opaque filenames, while
enforcing the same static-root containment boundary as public file serving.
These dynamic distribution assets use ETags and conditional `304` responses;
they also serve standards-compliant `HEAD` responses. The feature remains
disabled when no trusted public origin is configured.
If `PUBLIC_ORIGIN` is set, it must be an absolute credential-free `http://` or
`https://` origin with no query string or fragment. The Node server and Pages
builder fail closed on invalid values instead of silently publishing incomplete
canonical or crawler metadata.
It exposes `/healthz` for process liveness and `/readyz` for app readiness;
both include the package version and sanitized source revision
(both support `GET` and bodyless `HEAD` probes);
the latter verifies that the static shell is available and returns 503 while
the process is draining after shutdown begins, so orchestrators stop routing
new traffic before the server exits. Both health endpoints report the package
version, and `/metrics` exposes version- and revision-labelled build-info gauges alongside
privacy-safe Prometheus text counters for total requests, extraction outcomes,
authentication failures, rate-limited and concurrency-limited requests, and
in-flight provider work, and the configured extractor concurrency ceiling
plus HTTP response status counters and a bounded extraction latency histogram; it never includes document
content or credentials. Metrics also support bodyless `HEAD` probes and expose
a process-uptime gauge for restart correlation. Operational JSON and metrics
responses explicitly opt out of search indexing. Public static assets, including learning notes, are
bounded to 10 MB so readiness and serving cannot buffer an unexpectedly large
deployment file.
After a timeout or client disconnect, the in-flight extraction gauge remains
set until the provider promise actually settles; this keeps capacity and
graceful-drain signals accurate even when a provider ignores the abort signal.
Standalone shutdown waits for both HTTP connections and active provider
promises to drain, with a bounded five-second force-exit fallback.
Programmatic `server.waitForIdle({ timeoutMs })` calls are also bounded and
resolve `false` when a provider ignores cancellation, while in-flight metrics
remain set until the provider promise actually settles.
Standalone shutdown treats that timed-out drain as an unsuccessful exit so
orchestrators can distinguish a clean stop from forced provider abandonment.
Every server response includes an `X-Request-ID` UUID for operational
correlation; the browser adapter preserves extraction IDs in remote errors.
The standalone server logs a structured startup event with the serving version
and port, plus structured extraction request ID, status, duration, route,
document character count, and feedback count without document content. Shutdown
also emits structured draining, stopped, and forced-stop-timeout events so
orchestrators can distinguish a clean provider drain from an abandoned one.

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
unchanged; the Node server caches those hashes per allowed asset using file
metadata and transformation inputs, with a bounded cache that invalidates on
deployment or asset changes.
Invalid environment or embedded-server values fall back to the 60/minute
default. Declared request bodies over 2 MB are rejected before buffering.
The HTTP server also bounds header, request, and keep-alive lifetimes, stops
buffering immediately when an uploading client disconnects, and answers
malformed HTTP parser input with a bounded generic `400 Bad Request` response
while logging only a sanitized protocol diagnostic.
Obsidian vault imports validate ZIP paths, duplicate entries, local/central
filename agreement, and file checksums before applying feedback.

The reference server can also run in a container:

```bash
docker build --build-arg VCS_REF="$(git rev-parse HEAD)" -t llm-field-notes .
docker run --rm --read-only --tmpfs /tmp --cap-drop=ALL \
  --security-opt=no-new-privileges -p 8000:8000 llm-field-notes
```

Generic Node hosts can use `npm start`; the server honors `PORT`, `HOST`,
`EXTRACTOR_RATE_LIMIT`, `EXTRACTOR_CONCURRENCY`, and `EXTRACTOR_TIMEOUT_MS`. The container intentionally
execs Node directly so orchestrator signals reach graceful shutdown handling
without an npm intermediary.
Before a public deployment, follow the [production launch checklist](SECURITY.md#production-launch-checklist)
for TLS, secret management, gateway controls, monitoring, backups, and
projection round-trip verification.

The image binds to `0.0.0.0`, includes a Docker health check with a 10-second
startup/probe window for bounded readiness rendering, and keeps the runtime
dependency-free. It runs as the non-root `node` user; the Node server
aborts active provider calls, closes idle keep-alive sockets, and drains
requests during SIGINT/SIGTERM shutdown. Programmatic hosts can call the
idempotent `server.beginDrain()` before `server.close()` and await
`server.waitForIdle()` (or pass a bounded `timeoutMs`) to use the same
lifecycle behavior.
The base image is digest-pinned for reproducible builds, and the image carries
standard OCI title, description, version, source-revision, and license labels
for registry and incident-response tooling. CI passes its exact commit SHA as
the source revision, and the runtime exposes the same sanitized identity in
startup logs and Prometheus build metadata.
The server does not require a writable application filesystem, so production
containers should use a read-only root filesystem, a bounded temporary
filesystem, dropped Linux capabilities, and `no-new-privileges` as shown above.
The Docker context excludes environment files, local exports, development
tests, build/release-only scripts, common backup/database artifacts, and
private-key material; it retains the dependency-free experiment sources that
are part of the runtime public-asset contract.

Run the dependency-free smoke checks with:

```bash
npm test
```

The same checks run in GitHub Actions on every push to `main` and every pull
request across Node 18, 20, 22, and 24.
CI also builds the Docker image to catch deployment drift.
CI starts that image, probes `/readyz`, and waits for Docker’s health status to
become `healthy` so the runtime and its own health check agree. Superseded
verification runs are canceled and each matrix job has a 20-minute timeout, so
stalled builds cannot consume CI capacity indefinitely. The standalone startup
smoke also asserts the structured ready, draining, and stopped lifecycle events.
GitHub Actions in the verification and Pages workflows are pinned to immutable
commit references; Dependabot tracks workflow, npm, and Docker base-image
updates without making releases
depend on mutable tags.

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
- `curriculum.js` — shared lesson metadata and note detail prompts
- `graph-core.js` — pure graph schema, extraction, migration, merge, and provenance logic
- `graph-store.js` — transactional local persistence, history, undo, and restore
- `CHANGELOG.md` — user-visible release history and production hardening notes
- `extractor-adapter.js` — provider-neutral remote extraction boundary
- `rebuild-adapter.js` — bounded, cancelable saved-source rebuild orchestration
- `projection-adapter.js` — Obsidian feedback parser and graph update boundary
- `storage-adapter.js` — durable IndexedDB/localStorage boundary with an in-memory fallback
- `notes/` — versioned Markdown learning pages and curriculum index
- `experiments/` — small dependency-free runnable learning artifacts (see [experiments/README.md](experiments/README.md))
- `server.mjs` — optional same-origin static server and extraction contract example
- `scripts/note-page.mjs` — shared crawler-readable learning-note page renderer
- `manifest.webmanifest` / `sw.js` — installable, cacheable static deployment
- `version.json` — public release metadata shared by the browser and static
  deployment checks
- `llms.txt` — bounded machine-readable project map for discovery and
  assistant tooling
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
- `schema/jsonld.schema.json` — versioned JSON-LD projection contract
- `schema/learning-loop.schema.json` — versioned learning-loop artifact output
- `jsonld-projection.js` — reusable full and redacted JSON-LD projection
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
file APIs behave consistently. The app is useful without a backend; a backend
is optional, and the included same-origin server can be replaced with
a model-backed extraction implementation behind the same graph contract.
- GitHub Pages deployment is ready through `.github/workflows/pages.yml`. It
  publishes the generated `dist/` bundle rather than the repository root, so
  server code, tests, container files, and local project metadata stay out of
  the public artifact.
- The published bundle includes a script-free branded `404.html` recovery page
  so stale shared links lead back to the workbench and artifact gallery; when
  `PUBLIC_ORIGIN` is configured, its links are rewritten for nested project
  Pages paths.
- To inspect the exact Pages artifact locally, run `npm run build:pages` and
  serve `dist/` over HTTP.
- Or run `npm run serve:pages` to rebuild and serve that exact artifact on
  `http://localhost:8000`.
- Every Pages build includes `asset-manifest.json`, a versioned inventory of
  published files with byte lengths and SHA-256 digests for mirrors and release
  checks.
- Verify an existing bundle independently with `npm run verify:pages -- dist`;
  verification also proves that the service-worker cache revision matches the
  complete published bundle, including generated feeds and note pages.
- The Pages artifact also generates `feed.xml` from the published learning
  notes. Set the build environment variable `PUBLIC_ORIGIN` to the final
  HTTPS origin to additionally generate absolute `sitemap.xml` URLs and a
  deployment-aware `robots.txt`; the GitHub Pages workflow automatically uses
  the configured Pages base URL, while the optional repository variable can
  override it for custom build environments. Generated XML removes invalid
  control characters from forked note headings and summaries. The Node server
  provides the same origin-aware crawler assets at runtime, with a 2 MB
  generated feed/sitemap safety bound.
- Public asset delivery is defined once in `scripts/public-assets.mjs`, bounded
  to 10 MB per asset and 100 MB in aggregate across Node serving, Pages builds,
  and release checks, with a 1,000-note publication ceiling, and checked
  against the offline service-worker shell during release validation. Node and
  Pages sitemaps publish the same source-note and canonical HTML landing URLs.
- The repo should be easy to fork, improve, and deploy on GitHub Pages.
- The service worker prefers fresh shell assets and only falls back to its
  cache when offline, when the network or response body stalls for three
  seconds, or when a transient non-OK shell response arrives; API and
  non-shell requests are not cached.
- Service-worker activation removes only older `llm-field-notes-*` caches, so
  deploying beside another app on the same origin does not erase its cache.
- Later service-worker releases wait for user approval before taking over an
  active tab; the first install activates automatically and the update banner
  reloads only after the user chooses to apply it.
- Shell requests explicitly revalidate the browser HTTP cache so deployments
  do not remain stale for the static asset max-age window.
- The service-worker script itself is served `no-cache` so worker updates are
  discovered promptly.
- Cache quota or availability failures do not replace a successful fresh
  network response, and cache read failures degrade to the network response or
  the browser's normal failed-fetch behavior.

## Roadmap

- Add notebooks for the experiments in the 30-day path.
- Add translations without creating separate knowledge silos.

## License

The content is available under [CC BY 4.0](LICENSE).
