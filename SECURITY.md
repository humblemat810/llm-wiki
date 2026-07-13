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
- The app does not accept API keys or credentials.

Treat downloaded graph JSON, backups, and Obsidian vaults as sensitive if the
source documents are sensitive. They contain source text and derived evidence.
Use the redacted graph or redacted Obsidian vault export for public issue
reports, examples, or shared review; they remove source text, evidence quotes,
and source URIs—including evidence retained in reusable learning memory—while
preserving reviewable graph structure. The `redacted`
marker survives normalization and import so downstream tools can keep the
privacy boundary visible; normalization also enforces the marker by scrubbing
source text, URIs, and evidence if a marked payload was tampered with.
The compact feedback export is safer when only reviewed labels, aliases,
statuses, and relation endpoints need to be shared.
Ingesting a new full-text source into a redacted graph clears the marker so a
mixed graph cannot be mistaken for a fully redacted export.
Source URI metadata is scheme-filtered at the graph boundary; dangerous
schemes such as `javascript:` are discarded, ambiguous HTTP forms are rejected,
embedded whitespace and HTTP(S)/file credentials are never retained in source
metadata. The graph, diff, and extractor-request schemas enforce the same URI
shape for external validators.

## Reference server deployment

The optional Node server binds to `127.0.0.1` by default. Container
deployments set `HOST=0.0.0.0` for connectivity, so public deployments should
place authentication, TLS, and a shared rate limiter in a trusted reverse
proxy. The built-in `EXTRACTOR_RATE_LIMIT` is an in-process safety net, not a
replacement for multi-instance gateway controls.

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
The `/metrics` endpoint contains only aggregate operational counters and no
document content or credentials. Set `METRICS_AUTH_TOKEN` for a simple
single-instance guard, and restrict it at the gateway if traffic statistics
are considered sensitive.
The reference extraction server compacts reviewed feedback at its trust
boundary, forwarding only bounded labels, aliases, statuses, and relation
endpoints; unrecognized fields such as evidence or source text are discarded
before a provider call.
Provider responses are normalized against the submitted document before they
reach the browser: returned source titles, text, URIs, quality, review dates,
fingerprints, and node/evidence source references cannot rewrite or escape the
request's provenance envelope.
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
- Export and verify graph backups before browser storage is cleared, a device
  is replaced, or an Obsidian vault is shared. Use redacted graph, vault, or
  JSON-LD exports for public examples and issue reports.
- Run `npm test` in CI and perform one real Obsidian export/import review before
  upgrading the application or changing graph or projection schemas.
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
