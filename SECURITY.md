# Security

## Data boundary

The default application is local-first:

- Documents and graph state stay in the browser's local storage.
- No document text is sent to a server by the static app.
- The service worker only caches same-origin application assets.
- The app does not accept API keys or credentials.

Treat downloaded graph JSON, backups, and Obsidian vaults as sensitive if the
source documents are sensitive. They contain source text and derived evidence.

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
