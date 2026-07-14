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
- Service-worker cache read failures are treated as misses, so an unavailable
  or damaged Cache API does not become an application-level fetch rejection
  when a network response is available.
- Static shell response bodies are bounded by the same timeout and byte ceiling
  as the worker's revalidation path, preventing a stalled or oversized asset
  from hanging the workbench.
- Cross-tab stale graph repair is conditional on the observed version and
  content fingerprint, preventing delayed browser events from overwriting a
  newer graph.
- Service-worker updates do not silently take over an active workbench tab;
  later releases require an explicit reload, reducing mixed-version behavior
  while a graph mutation is in progress.
- The app does not accept API keys or credentials.
- The optional extractor endpoint path is remembered locally only after
  same-origin and embedded-credential validation; endpoint configuration never
  stores a bearer token or provider secret.
- Remote extraction has an explicit timeout race around the fetch operation,
  including integrations that fail to honor `AbortSignal`.

Treat downloaded graph JSON, backups, and Obsidian vaults as sensitive if the
source documents are sensitive. They contain source text and derived evidence.
All source-bearing projection paths preflight the shared source/evidence byte
budget before constructing large export strings.
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
The workbench's native graph-share action sends only the redacted Markdown
projection; browsers without file sharing receive the same redacted content
through clipboard or download fallback.
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

The reference endpoint intentionally does not accept browser API keys. Keep
provider credentials in the server-side extraction implementation or proxy.
For a simple single-instance deployment, set `EXTRACTOR_AUTH_TOKEN` to require
an `Authorization: Bearer ...` header on `/api/extract-graph`; the comparison
is constant-time and the token is never included in logs. This is a useful
baseline guard, while a public multi-instance deployment should still put the
server behind TLS, stronger identity controls, and a shared gateway limiter.
Browser sessions should use a gateway-managed same-origin cookie or identity
layer; the static app does not receive or persist bearer tokens.
`PUBLIC_ORIGIN` is used only for generated crawler URLs and must be set to the
trusted externally visible origin; invalid values disable the sitemap and feed
rather than being reflected into responses.
The server also applies restrictive browser capability and cross-origin
isolation headers plus legacy clickjacking protection to reduce the impact of
accidental embedding or cross-origin data exposure.
Early extraction rejections drain request bodies before responding, preserving
keep-alive connection framing and preventing unread upload bytes from affecting
the next request.
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
The `/metrics` endpoint contains only aggregate operational counters and no
document content or credentials. Set `METRICS_AUTH_TOKEN` for a simple
single-instance guard; non-loopback command-line hosts fail metrics closed
without it. Restrict the endpoint at the gateway if traffic statistics are
considered sensitive.
The reference extraction server compacts reviewed feedback at its trust
boundary, forwarding only bounded labels, aliases, statuses, and relation
endpoints; unrecognized fields such as evidence or source text are discarded
before a provider call.
When a browser sends an `Origin` header, the reference extraction endpoint
requires it to match `PUBLIC_ORIGIN` (or the direct request origin when no
public origin is configured), providing a same-origin CSRF boundary for
deployments that place cookie-based identity at a trusted gateway. Requests
without an `Origin` header remain available for server-to-server clients;
public deployments should still enforce CSRF and identity policy at the proxy.
Provider responses are normalized against the submitted document before they
reach the browser: returned source titles, text, URIs, quality, review dates,
identities, fingerprints, concept/relation IDs, review status/timestamps, and
node/evidence source references cannot rewrite or escape the request's
provenance envelope. Provider output is inference-only; human review remains
the authority for accepted/rejected state.
Provider diagnostic codes are also allowlisted and length-bounded before they
reach structured logs.

## Production launch checklist

Before exposing the reference server to real users:

- Put it behind a TLS-terminating reverse proxy. Configure `PUBLIC_ORIGIN` to
  the exact externally visible `https://` origin so canonical links, feeds,
  sitemaps, and social metadata point to the right deployment.
- Set `EXTRACTOR_AUTH_TOKEN` for the extraction endpoint and
  `METRICS_AUTH_TOKEN` for operational metrics. Keep both values outside the
  repository and rotate them through the deployment secret manager.
- Enforce identity, CSRF policy, request logging, and a shared rate limit at
  the gateway. The built-in bearer check and in-process limiter are safety
  nets for a single instance, not a complete multi-user account system.
- Monitor `/readyz`, `/healthz`, and authenticated `/metrics`. Treat a failed
  readiness check as a deployment failure and retain request IDs when
  investigating extraction errors.
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

## Contributions

Security-sensitive changes should include a regression test and explain any
new data, network, storage, or browser-permission boundary. Never commit
credentials, private documents, generated backups, or local graph exports.
