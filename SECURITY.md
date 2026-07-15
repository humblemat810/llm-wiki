# Security

## Data boundary

The default application is local-first:

- Documents and graph state stay in browser storage. IndexedDB is preferred when
  available; existing localStorage state is migrated locally and no document
  data is uploaded by the static app.
- With the extractor endpoint left blank, no document text is sent to a
  server. If a same-origin extractor endpoint is configured, the current
  document, optional source URI, and bounded reviewed feedback are sent to that
  endpoint; deployers must protect and document that service separately.
- The service worker only caches same-origin application assets.
- The workbench visibly reports offline mode: local graph state and cached
  public assets remain available, while configured remote extraction requires
  connectivity.
- Remote extraction operations fail fast when the browser reports no network,
  avoiding unnecessary retries and making the local-versus-remote boundary
  explicit to the user.
- Browser batch, vault, and rebuild failure summaries normalize and bound
  exception diagnostics before displaying them.
- All browser-facing operation, export, recovery, and runtime-error surfaces
  use the same bounded diagnostic normalizer, removing control characters and
  limiting displayed exception text.
- A populated graph that is tab-scoped or has degraded storage durability
  triggers the browser's unload warning before navigation or tab closure.
- Queued batch files also trigger the unload warning because browser `File`
  objects are intentionally retained only in memory until processing.
- Batch files remain in a bounded, explicit queue during processing and after
  transient failures rather than being silently discarded.
- Published service-worker caches are deployment-scoped, preventing a same-version
  asset update from reusing a previous deployment's shell cache.
- Service-worker cache read failures are treated as misses, so an unavailable
  or damaged Cache API does not become an application-level fetch rejection
  when a network response is available.
- Service-worker activation treats stale-cache deletion and client claiming
  as best-effort, so one unavailable Cache API operation cannot strand an
  otherwise valid application update.
- Service-worker response-reader cancellation is also best-effort and
  non-blocking, so a provider or browser stream that ignores cancellation
  cannot extend the worker's bounded network fallback.
- Service-worker installation precaches shell assets with bounded
  parallelism, limiting simultaneous network and cache work while avoiding a
  slow serial install.
- The service worker rejects opaque responses and final network responses
  whose URL crosses the application origin, preventing redirects from
  reaching or poisoning the offline shell cache.
- The service worker also rejects `206 Partial Content` and other incomplete
  successful responses before caching them, so a range response cannot replace
  a complete JavaScript, CSS, or HTML shell asset.
- The service worker rejects an HTML response for a non-HTML shell asset,
  preventing a gateway login or error page returned with HTTP 200 from being
  cached as executable or structured application content.
- Online 4xx navigation responses, including the branded 404 route, pass
  through instead of being replaced by the cached workbench shell; offline and
  transient server failures retain the bounded application fallback.
- Successful and transient shell responses are required to expose a readable
  body and, when declared, an exact `Content-Length`; mismatched or unreadable
  responses are rejected before they can replace a complete offline cache
  entry. Empty-body online 4xx responses pass through as client errors and are
  never cached.
- Static shell response bodies are bounded by the same timeout and byte ceiling
  as the worker's revalidation path, preventing a stalled or oversized asset
  from hanging the workbench.
- Network response bodies discarded in favor of cached or offline shell
  fallbacks are canceled, preventing repeated transient failures from retaining
  unread network streams.
- The service worker requires actual byte views for streamed shell chunks, so a
  malformed body cannot satisfy the byte budget with a forged `byteLength`.
- Malformed HTTP parser input receives a bounded generic `400` response;
  parser details are not reflected to clients or written to structured logs.
- HTTP error fallbacks refuse to write after response headers have already been
  sent, preventing a late failure from becoming a secondary header-state error.
- Cross-tab stale graph repair is conditional on the observed version and
  content fingerprint, preventing delayed browser events from overwriting a
  newer graph.
- Browser persistence is restricted to the `llm-field-notes-` namespace and
  bounded key names; unrelated same-origin storage keys are not read or
  written by the adapter.
- Browser storage values are bounded by both character count and UTF-8 byte
  size during hydration, writes, and cross-tab synchronization, so
  Unicode-heavy values cannot bypass the persistence memory ceiling.
- A user-initiated durable clear removes every application-namespaced
  localStorage and IndexedDB entry, including malformed or oversized remnants,
  and remains ordered correctly when requested before IndexedDB hydration.
- Pending durable writes are flushed when the workbench is hidden or unloaded;
  the synchronous mirror and recovery markers remain the fallback if the
  browser suspends the page before IndexedDB settles.
- The Page Lifecycle `freeze` event also requests a flush, covering mobile or
  background suspension paths that may not provide a normal unload window.
- Mutations that survive only by reducing undo history disclose that degraded
  recovery state immediately and direct the user to export a backup.
- If browser storage is unavailable entirely, the graph remains explicitly
  tab-scoped and the health strip offers the same direct backup action before
  navigation or tab closure.
- If only the synchronous browser mirror is available, the workbench marks
  storage as degraded, offers backup guidance, and warns before unload when
  graph content could otherwise be evicted.
- Service-worker updates do not silently take over an active workbench tab;
  later releases require an explicit reload, reducing mixed-version behavior
  while a graph mutation is in progress.
- The app does not accept API keys or credentials.
- The optional extractor endpoint path is remembered locally only after
  same-origin and embedded-credential validation; endpoint configuration never
  stores a bearer token or provider secret.
- The production Docker build context excludes local Codex artifacts, so agent
  workspace files are not copied into the published container image.
  Application files are copied with ownership assigned to the non-root `node`
  runtime user, keeping filesystem permissions aligned before read-only
  container policy is applied.
- The Docker and Git ignore boundaries also exclude Pages staging and rollback
  directories, so interrupted publication work cannot enter the runtime image
  or be mistaken for a source change.
- Browser extractor endpoints also reject query strings and fragments, keeping
  credentials and request metadata out of URL configuration and avoiding
  misleading fragment-only endpoint values.
- Remote extraction has an explicit timeout race around the fetch operation,
  including integrations that fail to honor `AbortSignal`.

Treat downloaded graph JSON, backups, and Obsidian vaults as sensitive if the
source documents are sensitive. They contain source text and derived evidence.
All source-bearing projection paths preflight the shared source/evidence byte
budget before constructing large export strings.
The workbench also offers an optional encrypted full-backup export. It uses
browser Web Crypto AES-GCM with a password-derived PBKDF2-SHA-256 key; the
password never enters graph storage, the server, or the exported envelope.
Users must keep that password separately because a lost password cannot be
recovered by the application. Plain full backups remain available for
interoperability and require the same sensitive-data handling.
Obsidian archive generation validates file records and enforces the same
bounded file-count and byte limits as vault import.
Evaluation reports are not trusted from their displayed ratios alone; runtime
validation recomputes ratio/count consistency before promotion decisions.
Their timestamps are bounded and parseable before they are used as provenance.
Date-only values are rejected so evaluation chronology remains unambiguous.
Unknown report fields are rejected at every layer, preventing unsupported
metadata from silently entering promotion artifacts.
Reviewed datasets above the matching bound are rejected rather than truncated,
preventing a partial benchmark from masquerading as the full fingerprinted set.
Shared graph-input tools reject malformed producer-version metadata before
normalization, so an invalid field cannot disappear while the graph fingerprint
continues to validate.
Backup, diff, and evaluation artifact timestamps are rejected when they are
future-dated, preventing fabricated chronology from influencing audit or
promotion decisions.
Persisted graph imports disclose clipped aliases in integrity and health
diagnostics, so field loss cannot masquerade as a complete representation.
Candidate graph collections above the published concept or relation limits are
also rejected before evaluation normalization.
Malformed or unreviewed benchmark examples are rejected rather than silently
removed from the scored dataset.
Reviewed-example identities, aliases, evidence, and provenance arrays are
bounded before evaluation matching or fingerprinting, preventing a small
example count from hiding oversized nested input.
Persistence operations fail closed if their pre-mutation graph/history snapshot
cannot be read, avoiding destructive rollback from an unknown prior state.
Use the redacted graph or redacted Obsidian vault export for public issue
reports, examples, or shared review; they remove source text, evidence quotes,
and source URIs—including evidence retained in reusable learning memory—while
preserving reviewable graph structure. The `redacted`
marker survives normalization and import so downstream tools can keep the
privacy boundary visible; normalization also enforces the marker by scrubbing
source text, URIs, and evidence if a marked payload was tampered with.
The redacted graph boundary replaces source document titles with a generic
label; the HTML snapshot further presents them as numbered sources, preventing
identifying titles from escaping any redacted projection.
The workbench's native graph-share action sends only the redacted Markdown
projection; browsers without file sharing receive the same redacted content
through clipboard or download fallback.
Public wiki share links also remove URL credentials and query parameters before
copying or opening the workbench, so embedded credentials, deployment metadata,
or session data in the current URL is not carried into a shared link.
Source-bearing export controls are associated with a persistent visible and
accessible warning before users choose a full Markdown, vault, JSON, backup,
or feedback export.
The release smoke suite also scans complete redacted Markdown and vault
payloads for the original source text and URI, guarding against leakage through
non-source projection files.
The compact feedback export is safer when only reviewed labels, aliases,
statuses, and relation endpoints need to be shared.
Ingesting a new full-text source into a redacted graph clears the marker so a
mixed graph cannot be mistaken for a fully redacted export.
Source URI metadata is scheme-filtered at the graph boundary; dangerous
schemes such as `javascript:` are discarded, ambiguous HTTP forms are rejected,
embedded whitespace and HTTP(S)/file credentials are never retained in source
metadata. The graph, diff, and extractor-request schemas enforce the same URI
shape for external validators. Browser Markdown and Obsidian projections reuse
that canonical URI validator before making source links clickable.
Generated graph IDs use guarded browser cryptography where available and a
collision-resistant monotonic process-local fallback when a restricted runtime
cannot provide it; they never rely on `Math.random()`.
All graph, evaluation, and Obsidian review chronology uses the shared timestamp
boundary, which rejects impossible calendar dates instead of accepting
JavaScript parser rollover.
The graph, backup, and diff verification CLIs use that same boundary before
trusting exported artifact timestamps.
JSON boundaries also reject duplicate object keys, preventing one parser or
proxy from observing a different effective value than the application.
They cap JSON nesting depth before recursive validation, limiting stack
consumption from adversarial but byte-bounded payloads.
Duplicate-key diagnostics are also length-bounded, preventing oversized
malicious keys from being reflected as amplified API errors.
Remote extractor responses use the same boundary, so provider output cannot
reintroduce parser ambiguity after the request has passed gateway validation.
The IndexedDB pending-write markers use it as well, preventing ambiguous
same-origin synchronization metadata from selecting a stale durable value;
per-key markers prevent concurrent tabs from overwriting one another's
recovery metadata, while malformed markers preserve the synchronous mirror
and disclose degraded durability while the durable copy is repaired.
Malformed marker entries, including invalid tokens or unknown keys, are treated
the same way rather than being silently filtered.
Browser graph and curriculum search queries are also capped before filtering,
limiting client-side work from oversized pasted input.
Local file imports slice to their bounded byte ceiling before calling
`arrayBuffer()`, including Obsidian ZIPs, so input size is enforced before
large browser allocations. The ZIP parser also rejects array-like values and
accepts only actual byte buffers or views, so callers cannot bypass that
boundary through coercion.
Vault export also rejects UTF-8 filenames longer than the ZIP format's 16-bit
header field, preventing generated archives from becoming unreadable when
future identifiers grow.
Binary browser downloads also require an actual `ArrayBuffer` or typed byte
view before applying the export limit, so a forged `byteLength` property cannot
turn a malformed value into an apparently bounded ZIP download.
Browser and remote extractor stream readers reject malformed result shapes and
chunks without a finite safe byte length before updating their response
budget; non-streaming fallbacks likewise require actual byte data.
Pending browser stream reads request idempotent final cancellation on abort or
malformed-body exit, so a provider that ignores cancellation cannot leave the
reader cleanup path unattempted.
When a response declares `Content-Length`, both browser learning-note/release
reads and remote extractor reads compare that byte count with the received
body before decoding or parsing, so a truncated JSON or Markdown prefix cannot
be accepted as a complete projection.
Asynchronous Obsidian vault exports recheck the graph fingerprint before
download, preventing a ZIP from combining graph data from one revision with
learning content collected during another.
They also enforce an aggregate 30-second learning-note collection deadline, so
degraded note delivery cannot multiply per-note timeouts into an unbounded
wait.
Browser release/note readers and remote extractor response readers reject
malformed or non-safe `Content-Length` headers instead of treating them as
missing declarations.
Node bounded asset readers also request `O_NOFOLLOW` where the platform
supports it, reinforcing the runtime symlink and static-root trust boundary.
The Pages builder uses the same no-follow mode for bounded source-note reads
and staged asset copies, so a source replacement between preflight and
publication cannot redirect published content through a final symlink.
Browser bounded text readers reject same-origin HTML or XHTML responses before
they can be treated as Markdown or release text, covering gateway login/error
pages returned with an incorrect successful status.
The remote extractor also cancels unread provider bodies before rejecting
malformed or oversized declared lengths, so early response validation does not
retain a provider stream.
Browser release and learning-note readers apply the same cancellation rule to
early HTML, malformed-metadata, and declared-size failures.
The service worker also cancels unread bodies before rejecting early origin,
media-type, length, or body-availability violations, preventing failed shell
responses from retaining network streams.
Successful document commits cancel pending draft persistence before clearing
the recovery marker, so a stale editor snapshot cannot reappear as unfinished
work after reload.
Recovery-download failures use the shared bounded diagnostic normalizer, so
oversized or control-character-filled filesystem/provider messages cannot flood
the workbench status surface.
The browser uses it for release metadata, source-review edits, and feedback
export ordering as well, so UI-visible chronology cannot diverge from the
validated graph representation.

## Reference server deployment

The optional Node server binds to `127.0.0.1` by default. Container
deployments set `HOST=0.0.0.0` for connectivity, so public deployments should
place authentication, TLS, and a shared rate limiter in a trusted reverse
proxy. The built-in `EXTRACTOR_RATE_LIMIT` is an in-process safety net, not a
replacement for multi-instance gateway controls.
The command-line server also fails extraction closed on non-loopback hosts when
`EXTRACTOR_AUTH_TOKEN` is absent; local loopback development remains available
without a token.
Provider concurrency is also capped at 8 in-flight extractions by default;
configure `EXTRACTOR_CONCURRENCY` between 1 and 1,024 to match provider
capacity. Requests above the ceiling receive a short-lived 503 response, and
the limit is process-local.
Graceful shutdown aborts active extraction requests with a retryable 503 and
bounds `Retry-After: 5` responses instead of presenting deployment drain as a
provider failure. Requests that are still parsing are rejected if the drain
begins before provider work starts. Readiness re-checks the drain state after
asynchronous asset validation, so an in-flight probe cannot report a healthy
instance after shutdown has started. The privacy-safe metrics endpoint also
exposes a bounded draining gauge so operators can correlate readiness
transitions with shutdown events without logging document content.
The bounded client-key rate limiter expires stale windows on a short periodic
sweep rather than scanning every tracked client on every request; the map
capacity remains bounded, and a shared gateway limiter is still required for
multi-instance deployments.

The CodeQL workflow still analyzes pull requests from forks, but disables SARIF
publication for those runs because fork-provided workflow tokens are read-only.
The Scorecard workflow applies the same boundary to signed result publication
and SARIF upload. Trusted branch and same-repository pull-request runs retain
security-analysis publication.
On fork pull requests, CodeQL may also report that the GitHub Actions
workflow-run endpoint is not accessible while gathering optional telemetry.
That message is expected token scoping: the JavaScript analysis and local SARIF
generation still run, while only the optional status/telemetry enrichment is
skipped. Treat a failed scan or SARIF upload as an incident; do not grant
write-all permissions or switch these workflows to `pull_request_target` to
silence a telemetry warning.

The reference endpoint intentionally does not accept browser API keys. Keep
provider credentials in the server-side extraction implementation or proxy.
For a simple single-instance deployment, set `EXTRACTOR_AUTH_TOKEN` to require
an `Authorization: Bearer ...` header on `/api/extract-graph`; the comparison
is constant-time and the token is never included in logs. This is a useful
baseline guard, while a public multi-instance deployment should still put the
server behind TLS, stronger identity controls, and a shared gateway limiter.
Browser sessions should use a gateway-managed same-origin cookie or identity
layer; the static app does not receive or persist bearer tokens.
`PUBLIC_ORIGIN` is used for generated crawler URLs, canonical metadata, and the
same-origin extraction boundary. If set, it must be the trusted externally
visible origin; invalid values fail server startup or the Pages build rather
than silently disabling sitemap and feed projections.
Non-loopback server hosts additionally fail readiness without a trusted HTTPS
origin; HTTP is accepted only for loopback development and local smoke tests.
The server also applies restrictive browser capability and cross-origin
isolation headers plus legacy clickjacking protection to reduce the impact of
accidental embedding or cross-origin data exposure.
Readiness validates the bounded UTF-8 encoding of every published shell asset,
so a corrupted text asset fails deployment health instead of being advertised
as a usable workbench.
Runtime readiness and static serving also reject symlinked published assets,
including links whose targets remain inside the deployment root; this keeps a
mutable host aligned with the release and Pages source-asset policy.
It also rejects malformed, impossible-calendar, future-dated, or
package-version-mismatched `version.json` metadata before reporting readiness.
Early extraction rejections drain request bodies before responding, preserving
keep-alive connection framing and preventing unread upload bytes from affecting
the next request.
The same body-drain boundary applies to wrong-method extraction requests,
including body-bearing `GET` or `HEAD` probes, so method errors cannot poison a
reused connection.
Unsupported methods on other routes follow the same drain-before-`405` rule,
including body-bearing `PUT`, `PATCH`, and `DELETE` requests.
All non-POST requests begin the same bounded drain at the server boundary, so
body-bearing `GET`, `HEAD`, and unknown-path probes cannot leave unread bytes on
a reusable connection.
The request reader also rejects invalid or mismatched `Content-Length` values,
including a stream that emits `end` before its declared byte count, so a
truncated body cannot be interpreted as a complete JSON request.
The server gives request bodies a separate 30-second receive timeout; this is
shorter than the 120-second provider execution timeout and limits slow-client
connection retention without cutting off a valid provider response after the
request has been received.
Client-facing extraction body errors use a bounded allowlist of safe diagnostics;
duplicate-key parser details and unexpected stream errors are not reflected back
to callers, while the server retains only sanitized operational codes in logs.
The extraction root envelope, document metadata, and feedback hints are also
closed against unknown fields, matching `schema/extractor-request.schema.json`;
unrecognized metadata fails validation instead of being silently discarded.
Obsidian feedback frontmatter uses the same fail-closed rule: keys outside the
exported type-specific concept, relation, and source contracts, or malformed
read-only metadata, are rejected rather than silently ignored.
When `PUBLIC_ORIGIN` is an HTTPS origin, the reference server also emits HSTS
(`max-age=31536000; includeSubDomains`); local HTTP development does not receive
that browser-persistent policy.
Crawler-readable learning-note pages additionally enforce a response-level
`script-src 'none'` policy and disable connections, workers, and manifests;
the interactive workbench is a separate link rather than an executable part of
the public note surface. Markdown links in those pages are independently
restricted to HTTP(S) URLs without embedded credentials before rendering.
The public artifact gallery is also script-free and receives a matching
response-level script prohibition in the Node host, so its runnable source
links cannot become an executable application surface.
The `/healthz` and `/readyz` responses include only the package version and a
sanitized source revision alongside their status fields. The `/metrics` endpoint
contains only aggregate operational counters and no
document content or credentials. Set `METRICS_AUTH_TOKEN` for a simple
single-instance guard; non-loopback command-line hosts fail metrics closed
without it. Restrict the endpoint at the gateway if traffic statistics are
considered sensitive.
Client-aborted extraction requests are recorded as bounded `499` operational
events with request ID and latency, plus an aggregate counter; document text,
source URIs, and credentials are never logged.
The reference extraction server compacts reviewed feedback at its trust
boundary, forwarding only bounded labels, aliases, statuses, and relation
endpoints; unrecognized fields such as evidence or source text are discarded
before a provider call.
When a browser sends an `Origin` header, the reference extraction endpoint
requires it to match `PUBLIC_ORIGIN` (or the direct request origin when no
public origin is configured), providing a same-origin CSRF boundary for
deployments that place cookie-based identity at a trusted gateway. Browser
Fetch Metadata values of `same-site` and `cross-site` are rejected as well, so
a sibling subdomain cannot use a missing `Origin` header to cross that
boundary. Requests without browser origin metadata remain available for
server-to-server clients;
public deployments should still enforce CSRF and identity policy at the proxy.
Provider responses are normalized against the submitted document before they
reach the browser: returned source titles, text, URIs, quality, review dates,
identities, fingerprints, concept/relation IDs, review status/timestamps, and
node/evidence source references cannot rewrite or escape the request's
provenance envelope. Provider output is inference-only; human review remains
the authority for accepted/rejected state.
Provider diagnostic codes are also allowlisted and length-bounded before they
reach structured logs.
Standalone lifecycle logs include only the release version, sanitized source
revision, bound host and port, signal, and drain outcome; they do not include
document content or provider credentials. Prometheus build metadata exposes the
same bounded revision identity for deployment correlation.

## Production launch checklist

Before exposing the reference server to real users:

- Keep the [production runbook](RUNBOOK.md) with the deployment/operator
  documentation and rehearse its backup, drain, incident, and rollback steps
  before the first public launch.
- Put it behind a TLS-terminating reverse proxy. Configure `PUBLIC_ORIGIN` to
  the exact externally visible `https://` origin so canonical links, feeds,
  sitemaps, and social metadata point to the right deployment.
- Set `EXTRACTOR_AUTH_TOKEN` for the extraction endpoint and
  `METRICS_AUTH_TOKEN` for operational metrics. Keep both values outside the
  repository and rotate them through the deployment secret manager.
  The reference server rejects values shorter than 16 characters, longer than
  4,096 characters, or containing control characters or surrounding
  whitespace; invalid secret configuration fails readiness closed.
- Enforce identity, CSRF policy, request logging, and a shared rate limit at
  the gateway. The built-in bearer check and in-process limiter are safety
  nets for a single instance, not a complete multi-user account system.
- Monitor `/readyz`, `/healthz`, and authenticated `/metrics`. Treat a failed
  readiness check as a deployment failure and retain request IDs when
  investigating extraction errors.
- `/readyz` also fails closed when a non-loopback deployment requires
  `EXTRACTOR_AUTH_TOKEN` or `METRICS_AUTH_TOKEN` but either secret is missing;
  a container with an unusable authentication boundary must not enter service.
- Non-loopback readiness also requires the sanitized `BUILD_REVISION` source
  identity used by the release workflow. A deployment built without a
  traceable revision remains unready instead of entering service with
  ambiguous incident metadata.
- Readiness validation is coalesced and cached briefly to prevent repeated
  unauthenticated probes from repeatedly rendering the entire learning-note
  publication.
- Keep the published asset footprint within the shared 100 MB aggregate budget
  and the 10 MB per-asset limit; these checks protect both Pages publication
  and runtime readiness from unbounded learning-note collections.
- Run the container with a read-only root filesystem and a bounded `/tmp`
  filesystem, no Linux capabilities, and `no-new-privileges`
  (`--read-only --tmpfs /tmp --cap-drop=ALL
  --security-opt=no-new-privileges`) because the reference server does not
  require writable application state or elevated privileges.
- Export and verify graph backups before browser storage is cleared, a device
  is replaced, or an Obsidian vault is shared. Use redacted graph, vault, or
  JSON-LD exports for public examples and issue reports.
- Run `npm test` in CI and perform one real Obsidian export/import review before
  upgrading the application or changing graph or projection schemas.
- Keep the generated HTML accessibility gate green; unlabeled controls,
  nameless links, missing alternative text, duplicate IDs, and broken heading
  progression are release regressions, not merely visual polish issues.
- Keep the critical browser-shell performance budget green; unbounded client
  growth increases memory pressure and time-to-interactive for the local-first
  workbench, especially on mobile devices.
- Treat the post-deploy Pages smoke probe as a publication gate: it verifies
  the final served origin, crawler policy, service worker, artifact gallery,
  and generated note page after CDN propagation rather than relying only on
  the pre-upload bundle verifier.
- Keep the scheduled Pages monitor enabled. It is read-only and fork-safe, and
  catches later CDN or publication drift that a one-time deploy probe cannot.
- Keep the CodeQL workflow enabled for JavaScript/TypeScript and review its
  security-extended findings before promoting changes to a public deployment.
- Keep the Scorecard workflow enabled and review its supply-chain findings,
  especially workflow permissions, dependency pinning, and repository controls.
- Keep every workflow under the release gate's least-privilege contract:
  explicit permissions, concurrency limits, pinned action revisions, disabled
  checkout credentials, and no `pull_request_target` execution for untrusted
  changes.
- Publish only through the tag workflow after `package.json`, `version.json`,
  and `CHANGELOG.md` agree. The tag gate prevents a container or static bundle
  from being labeled with a version different from the source commit.
- Backup producers must keep history at or below the published three-snapshot
  interchange limit; oversized history is rejected before serialization so
  automation cannot create an apparently valid but schema-invalid recovery
  artifact.
- Keep the real localhost gateway/provider integration smoke test green when
  changing request headers, response parsing, retry behavior, or provenance
  normalization; mock-only adapter tests cannot prove the socket-level
  contract.
- Keep CI checkout credentials disabled (`persist-credentials: false`) so
  repository test and build tooling cannot reuse a GitHub token from `.git/config`.
- For production graph promotion, run the health CLI with
  `--max-review-queue-truncated 0 --max-evidence-grounding-truncated 0
  --max-feedback-context-truncated 0 --max-truncated-items 0
  --max-dropped-items 0` so sampled review, grounding, or learning context
  cannot pass as complete.
- Treat browser storage, downloaded backups, and full vaults as user data.
  Define retention and deletion procedures for each deployment that collects
  documents or model-provider requests.

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability. Contact the
repository maintainers privately with:

- a concise description of the issue;
- affected files or behavior;
- reproduction steps;
- impact and a suggested mitigation, if known.

Until a private security contact is configured for the deployed repository,
use the hosting provider's private security reporting mechanism.
Public deployments also publish `.well-known/security.txt`, which points
reporters to the repository's private advisory intake and this policy.

## Contributions

Security-sensitive changes should include a regression test and explain any
new data, network, storage, or browser-permission boundary. Never commit
credentials, private documents, generated backups, or local graph exports.
