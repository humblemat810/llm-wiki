# LLM Field Notes production runbook

This runbook covers the reference Node server and the static GitHub Pages
publication. It assumes that the deployment owner has access to the repository,
runtime logs, and the secret manager used by the extraction gateway.
For the product boundary and hosted-service gaps, see
[PRODUCTION_STATUS.md](PRODUCTION_STATUS.md).

## Before deployment

1. Use Node 22 or newer. If you use a version manager, run `nvm install` and
   `nvm use`; the repository's `.nvmrc` and `.node-version` both select Node
   22.
2. Run `npm ci --ignore-scripts --no-audit --no-fund`.
3. Run `npm run production:check`. This first verifies the supported Node
   runtime, audits dependencies, builds and independently verifies a fresh
   Pages artifact, then runs the complete test suite, security,
   self-improvement, reviewed extraction-quality, and
   `npm run health:sample` graph-quality gates, then independently re-verifies
   the final Pages artifact immediately before success. Building first is
   intentional: accessibility and performance checks must inspect the current
   artifact, not a stale or accidentally pre-existing `dist/` directory.
4. When changing server startup, authentication, readiness, or shutdown,
   run `npm run smoke:server`. This is the same standalone-process probe used
   by the Node CI matrix; it also runs bounded concurrent health and
   authenticated-extraction load probes against the live process.
5. When changing the Dockerfile, runtime image, or container security policy,
   run `npm run smoke:container`. It builds the local image, verifies
   non-root/revision metadata and runtime exclusions, then probes hardened
   read-only authenticated and unauthenticated paths before graceful stop.
6. When changing browser startup, storage, service-worker, or workbench
   behavior, run `npm run browser:smoke` with the required Playwright browser
   installed. The pull-request workflow runs the same smoke across Chromium,
   Firefox, and WebKit.
7. For a static release, run:

   ```bash
   PUBLIC_ORIGIN=https://wiki.example.test/field-notes \
   PUBLIC_REPOSITORY_URL=https://github.com/example/forked-wiki \
   npm run build:pages
   PUBLIC_ORIGIN=https://wiki.example.test/field-notes \
   PUBLIC_REPOSITORY_URL=https://github.com/example/forked-wiki \
   npm run verify:pages -- dist
   ```

8. Confirm that `PUBLIC_ORIGIN` is the externally visible HTTPS origin. A
   wrong origin makes canonical links, sitemap entries, and crawler policy
   misleading.
   `PUBLIC_REPOSITORY_URL` controls the issue-form destination and must identify
   the repository that will receive contributions.
9. For a server release, set `EXTRACTOR_AUTH_TOKEN` and `METRICS_AUTH_TOKEN`
   outside the repository. Use values 16–4,096 characters long without
   surrounding whitespace or control characters. Public deployments also need
   TLS, identity/CSRF policy, and a shared gateway rate limiter.

For deployment-specific capacity evidence, run the bounded opt-in probe after
the service is healthy:

```bash
LOAD_TEST_URL=http://127.0.0.1:8000 npm run load:server
LOAD_TEST_URL=http://127.0.0.1:8000 \
  EXTRACTOR_AUTH_TOKEN="$EXTRACTOR_AUTH_TOKEN" \
  LOAD_TEST_REQUESTS=100 LOAD_TEST_CONCURRENCY=8 \
  npm run load:server

LOAD_TEST_URL=http://127.0.0.1:8000 \
  LOAD_TEST_DURATION_MS=30000 LOAD_TEST_CONCURRENCY=8 \
  npm run load:server
```

The default probe exercises `/healthz`; setting `EXTRACTOR_AUTH_TOKEN` instead
exercises authenticated extraction. Set `LOAD_TEST_DURATION_MS` for a bounded
time-based run; otherwise the probe uses a fixed request count. Requests,
concurrency, duration, response body reads, and latency reporting are bounded
in the script; output includes actual attempts, throughput, failure rate, and
latency percentiles. To enforce an agreed deployment-specific budget, also set
`LOAD_TEST_MAX_FAILURES` and/or `LOAD_TEST_MAX_P95_MS`; omitted thresholds
default to zero tolerated failures and no latency threshold. A non-loopback target additionally requires
`LOAD_TEST_CONFIRM=I_UNDERSTAND`. Treat the result as evidence for this
deployment and provider combination, not as a universal capacity guarantee;
never aim it at a production endpoint without an agreed traffic budget.

For a repeatable operator-run probe, use the manually dispatched
`Deployment capacity probe` workflow. Enter the exact HTTPS target,
`I_UNDERSTAND`, the agreed duration/concurrency, and explicit failure/p95
budgets. The workflow is intentionally health-only so a user-entered target
cannot receive a repository secret. For authenticated extraction capacity,
use the protected operator shell above with the target and
`EXTRACTOR_AUTH_TOKEN` controlled together. The script's hard limits still cap
traffic at 30 seconds, 64 concurrent requests, and 10,000 attempts.

For a versioned release, update `package.json`, `version.json`, and the
changelog together, set `version.json.channel` to `stable`, commit them, and
push the matching tag:

```bash
npm run release:check
git tag vX.Y.Z
git push origin vX.Y.Z
```

The release workflow accepts only `vX.Y.Z` tags matching the package version.
It reruns the complete suite, independently verifies the Pages bundle, and
builds and smoke-tests the production container with the same version and
commit revision, including read-only readiness, authenticated extraction and
metrics success/failure, and graceful shutdown. It then certifies the local
release workbench across Chromium, Firefox, and WebKit with the same browser
smoke contract used by the public Pages deployment; browser failure screenshots
are retained as workflow artifacts for seven days. The release job also retains
the generated Pages asset manifest, version identity, installable-app manifest,
branded 404 page, crawler files, and security metadata for 90 days, so an
incident can compare the published contract with the exact tagged build.

The GitHub Pages workflow verifies the bundle before upload, then probes the
configured `PUBLIC_ORIGIN` after publication (or the URL returned by the
deployment action when no override is configured). It also runs the
Chromium, Firefox, and WebKit browser smoke matrix against that exact deployed
origin (or the configured `PUBLIC_ORIGIN`) and verifies the published
`version.json` source revision against the workflow commit. Those post-deploy
checks are the authoritative evidence that the served artifact has the expected origin,
crawler files, service worker, artifact gallery, note page, and usable
workbench.
The scheduled `Monitor published Pages` workflow repeats the same probe daily
and explicitly checks out the repository's default branch before requiring the
served source revision to match that branch. This keeps manual runs from a
feature branch from producing a false stale-publication alert. Set the
repository `PUBLIC_ORIGIN` variable when a custom domain or non-default Pages
path is used. A failed monitor run indicates that the published site needs
investigation even when the last deployment was green.
The scheduled `Monitor published browser experience` workflow repeats the
browser smoke matrix daily against that same exact origin and checks the
served source revision against the repository default branch. It is read-only
and uses the repository `PUBLIC_ORIGIN` variable or the default GitHub Pages
URL.

## Real-browser certification

Before a public browser release, retain the Pages workflow's exact-origin
matrix evidence and certify the remaining user-agent behaviors in at least one
Chromium-based browser, one Firefox-based browser, and one WebKit/Safari
environment. Record the browser version, operating system, deployment
revision, and date with the release evidence. For each environment, verify:

1. a fresh load reaches the workbench and the release footer shows the expected
   version;
2. the local sample builds, survives reload, and remains usable offline after
   service-worker installation; the automated Chromium/Firefox smoke covers
   this navigation, while the pinned Playwright WebKit runner certifies
   service-worker activation and records its offline-emulation limitation. The
   pinned Playwright Firefox runner does not reliably dispatch the page's
   offline event; visible offline-state messaging is therefore asserted where
   the runner exposes that lifecycle signal, while Firefox offline reopening
   remains covered;
3. a document import, graph mutation, Undo, backup download, and backup restore
   complete without console errors;
4. an Obsidian export/re-import round trip preserves the graph fingerprint;
5. configured remote extraction shows the correct LOCAL/MODEL/OFFLINE state,
   rejects an invalid endpoint, and does not expose credentials in storage or
   URLs;
6. keyboard-only navigation reaches the editor, graph controls, inspector,
   dialogs, download actions, and update prompt; and
7. narrow viewport, reduced-motion, screen-reader name, and browser storage
   degradation paths remain understandable.

Treat any failure as a release blocker until it is reproduced, documented, and
either fixed or explicitly excluded from the supported browser matrix. The
repository gates prove contracts and bounded behavior; this checklist supplies
the user-agent evidence they cannot provide.

CodeQL may log a non-fatal `Resource not accessible by integration` message
when a fork pull request cannot read workflow-run metadata. Confirm that the
scan still reports JavaScript files analyzed and that no SARIF upload failure
occurred. Do not broaden the token to `write-all` or use
`pull_request_target`; the workflow intentionally disables publication for
fork-provided tokens.

## Health and monitoring

Monitor these endpoints through the trusted gateway:

- `/healthz` answers process health and release identity.
- `/readyz` answers whether static assets and generated note pages are usable.
- `/metrics` exposes Prometheus text and must remain authenticated outside a
  local loopback deployment. It includes aggregate HTTP latency and in-flight
  request pressure, plus extraction latency and provider capacity metrics; it
  intentionally avoids document, URI, and client-identity labels.

Useful baseline alerts:

```promql
llm_field_notes_draining == 1
rate(llm_field_notes_extraction_failures_total[5m]) > 0
rate(llm_field_notes_rate_limited_total[5m]) > 0
llm_field_notes_extractions_in_flight
  >= llm_field_notes_extractor_concurrency_limit
```

For gateway saturation, alert when `llm_field_notes_http_requests_in_flight`
remains elevated or when the HTTP latency histogram shifts above the
deployment's normal baseline. Keep alert windows long enough to avoid treating
the metrics scrape itself as sustained pressure.

Treat a `503` readiness response as a deployment or static-asset incident,
not as a provider result. Treat repeated `502`/`504` extraction responses as
provider or gateway incidents. Preserve the `x-request-id` from a failed
response and correlate it with structured logs. Logs must not include source
text, evidence, credentials, or provider payloads.

Extraction responses expose `RateLimit-Limit`, `RateLimit-Remaining`, and
`RateLimit-Reset` for the process-local budget, plus `Retry-After` when a
request is rejected. A reverse proxy should still enforce the authoritative
shared limit for a multi-instance deployment; use these headers to make client
backoff and gateway diagnostics less wasteful.

## Graceful deployment and shutdown

1. Stop routing new traffic at the gateway or send `SIGTERM` to the process.
2. Confirm `/readyz` changes to `503` (including probes already waiting on
   asynchronous asset validation) and the draining metric becomes `1`.
3. Wait for active extraction work to settle. The server aborts provider calls
   during drain and returns retryable `503` responses to new extraction work.
4. If the process does not stop within the orchestrator deadline, investigate
   provider cancellation and the `server-stop-timeout` lifecycle event.
5. Start the replacement and wait for `/readyz` to return `200` before traffic
   is restored.

Do not use `kill -9` as the normal deployment path: it can abandon in-flight
provider work and remove the correlation between readiness and shutdown.

## Browser backup and restore

The browser graph is local state. Before clearing storage, replacing a device,
or importing a large external projection:

1. Use **Download backup** from the workbench.
2. Keep the original backup private when it contains source text, evidence, or
   URIs; use redacted exports for public issues.
   For backups stored in shared drives or sent through untrusted channels, use
   **Download encrypted backup** and retain its password in a separate secret
   manager. The application cannot recover a forgotten password.
3. Verify the backup before automation consumes it:

   ```bash
   node experiments/verify-graph.mjs llm-field-notes-backup.json
   ```

   For an encrypted backup, verify the envelope without decrypting:

   ```bash
   node experiments/verify-backup.mjs llm-field-notes-encrypted-backup.json
   ```

   To verify its graph fingerprint, pass the password through a protected
   stdin pipeline; do not put it in command arguments or logs:

   ```bash
   printf '%s\n' "$BACKUP_PASSWORD" | node experiments/verify-backup.mjs llm-field-notes-encrypted-backup.json --password-stdin
   ```

4. Restore by loading the backup JSON in the workbench and confirming the
   replacement prompt. The current graph remains available through Undo when
   capacity permits.
5. If the UI reports a recovery snapshot or reduced history, download that
   recovery file before dismissing the warning. A recovery capture is evidence
   of a storage or import integrity problem, not a normal backup.

After restore, inspect graph health, provenance coverage, review state, and the
revision timeline. A backup fingerprint proves graph/history identity; it does
not prove that source material is correct or provider output is human-reviewed.

## Incident response

1. Record the UTC time, deployment revision, release version, endpoint status,
   request IDs, and last known healthy revision.
2. If logs contain `uncaught-exception` or `unhandled-rejection`, preserve the surrounding lifecycle
   records and restart from the last known-good release; the monitor is
   intentionally fail-fast for unknown process faults, while allowing the
   existing bounded drain to finish first.
3. If extraction is failing, disable or isolate the provider route at the
   gateway while keeping local/static graph use available.
4. If readiness is failing, compare the runtime asset set and `version.json`
   with the release commit. Do not bypass readiness validation.
5. If data integrity is suspected, stop imports and exports, preserve the
   original backup/recovery payload, and run the graph verifier before edits.
6. Rotate exposed credentials through the secret manager. Never put provider
   keys in browser configuration, issues, backups, or logs.
7. Publish a short incident note with impact, affected revision, mitigation,
   and follow-up test coverage.

## Rollback

For GitHub Pages, redeploy the last known-good commit through the Pages
workflow, then wait for its post-deploy smoke probe to pass. For containers,
roll back to the image whose OCI revision and version match the last known-good
release, run readiness and container smoke checks, and restore traffic only
after health is green.

After rollback, retain the failed artifact and logs long enough to investigate
the cause. Do not delete a recovery backup or overwrite the only copy of a
user-provided graph while repairing the deployment.
