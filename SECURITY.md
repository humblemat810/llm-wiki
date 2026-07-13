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
and source URIs while preserving reviewable graph structure. The `redacted`
marker survives normalization and import so downstream tools can keep the
privacy boundary visible.
The compact feedback export is safer when only reviewed labels, aliases,
statuses, and relation endpoints need to be shared.
Ingesting a new full-text source into a redacted graph clears the marker so a
mixed graph cannot be mistaken for a fully redacted export.
Source URI metadata is scheme-filtered at the graph boundary; dangerous
schemes such as `javascript:` are discarded.

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
