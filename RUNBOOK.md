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
3. When changing a GitHub workflow, run `npm run workflows:check` first. It
   parses every workflow and validates its job, permission, dependency, and
   immutable-action contracts.
4. Run `npm run deployment:check` after changing deployment environment
   variables. It validates the complete non-loopback security and identity
   boundary before traffic or provider calls begin; loopback development
   reports warnings for intentionally open optional endpoints.
   The Pages publication workflow sets `DEPLOYMENT_MODE=static-pages`, which
   validates the static HTTPS origin and source revision without requiring
   server-only extractor and metrics secrets.
5. Run `npm run production:check`. This first verifies the supported Node
   runtime, audits dependencies, builds and independently verifies a fresh
   Pages artifact, then runs the complete test suite, security,
   self-improvement, reviewed extraction-quality, and
   `npm run verify:share -- examples/sample-share.json` and
   `npm run health:sample` graph-quality gates, then independently re-verifies
   the final Pages artifact immediately before success. Building first is
   intentional: generated HTML link-integrity, accessibility, and performance
   checks must inspect the current artifact, not a stale or accidentally
   pre-existing `dist/` directory. Each child check has a five-minute timeout,
   so a stalled audit or smoke probe fails with an operator-visible diagnostic
   instead of hanging the release gate indefinitely.
6. When changing server startup, authentication, readiness, or shutdown,
   run `npm run smoke:server`. This is the same standalone-process probe used
by the Node CI matrix; it also runs bounded concurrent health and
authenticated-extraction load probes against the live process, including a
one-second duration probe that exercises sustained local pressure.
7. When changing the Dockerfile, runtime image, or container security policy,
   run `npm run smoke:container`. It builds the local image, verifies
   non-root/revision metadata and runtime exclusions, then probes hardened
   read-only authenticated and unauthenticated paths before graceful stop.
8. When changing browser startup, storage, service-worker, or workbench
   behavior, run `npm run browser:smoke` with the required Playwright browser
   installed. The local smoke also exercises the same-origin model endpoint
   switch, draft-preserving provider failure where the runner can intercept
   the request, and return to local extraction; the pull-request workflow runs
   the same smoke across Chromium, Firefox, and WebKit. The pinned WebKit
   runner bypasses Playwright interception for service-worker-controlled
   requests, so it records that limitation while still testing successful
   model mode. Exact external-origin smoke intentionally skips that local-only
   endpoint drill.
9. For a static release, run:

   ```bash
   PUBLIC_ORIGIN=https://wiki.example.test/field-notes \
   PUBLIC_REPOSITORY_URL=https://github.com/example/forked-wiki \
   npm run build:pages
   PUBLIC_ORIGIN=https://wiki.example.test/field-notes \
   PUBLIC_REPOSITORY_URL=https://github.com/example/forked-wiki \
   npm run verify:pages -- dist
   ```

10. Confirm that `PUBLIC_ORIGIN` is the externally visible HTTPS origin. A
   wrong origin makes canonical links, sitemap entries, and crawler policy
   misleading.
   `PUBLIC_REPOSITORY_URL` controls the issue-form destination and must identify
   the repository that will receive contributions.
   To make the canonical gate verify the live publication too, provide the
   exact deployed URL and source revision:

   ```bash
   DEPLOYMENT_MODE=static-pages \
   PUBLIC_ORIGIN=https://wiki.example.test/field-notes \
   PUBLIC_REPOSITORY_URL=https://github.com/example/forked-wiki \
   BUILD_REVISION="$(git rev-parse HEAD)" \
   PAGES_DEPLOYMENT_URL=https://wiki.example.test/field-notes/ \
   PAGES_EXPECTED_REVISION="$(git rev-parse HEAD)" \
   npm run production:check
   ```

   `DEPLOYMENT_MODE=static-pages` is required for a static publication gate;
   it validates the Pages artifact without requiring the reference server's
   extractor and metrics secrets.

   Without these variables, `production:check` proves the locally generated
   artifact and reference server only; it does not claim that a public URL is
   serving that artifact. When `PUBLIC_ORIGIN` is also configured, it must
   identify the same URL as `PAGES_DEPLOYMENT_URL`; this prevents a stale or
   mistyped deployment target from passing the external smoke check.
11. For a server release, set `EXTRACTOR_AUTH_TOKEN` and `METRICS_AUTH_TOKEN`
outside the repository. Use values 16–4,096 characters long without
surrounding whitespace or control characters. `PORT` defaults to `8000`;
`EXTRACTOR_RATE_LIMIT` defaults to `60` and accepts `1`–`1,000,000`;
`EXTRACTOR_CONCURRENCY` defaults to `8` and accepts `1`–`1,024`; and
`EXTRACTOR_TIMEOUT_MS` defaults to `120000` and accepts `1`–`120000`.
Explicitly malformed or out-of-range numeric settings fail startup with an
actionable diagnostic rather than silently changing the process contract.
Public deployments also need TLS, identity/CSRF policy, and a shared gateway
rate limiter.
If a reverse proxy exposes a process bound to loopback, set the external
`PUBLIC_ORIGIN` before running the preflight; the server treats that
combination as production and requires the same authentication and revision
configuration as a non-loopback bind.

To use an actual LLM without writing a custom server wrapper, also set
`EXTRACTOR_PROVIDER_URL` to an OpenAI-compatible chat-completions endpoint and
`EXTRACTOR_PROVIDER_MODEL` to the provider model name. Set
`EXTRACTOR_PROVIDER_API_KEY` in the secret manager when the gateway requires
Bearer authentication; it is read only by the server and never sent to the
browser. The optional `EXTRACTOR_PROVIDER_TIMEOUT_MS` accepts 100–120,000
milliseconds and `EXTRACTOR_PROVIDER_JSON_MODE` accepts `required` (the
default) or `off`. The deployment preflight validates this configuration,
requires HTTPS for non-loopback providers, and leaves the deterministic local
extractor active when `EXTRACTOR_PROVIDER_URL` is unset.
Source URIs are omitted from model-provider requests by default; set
`EXTRACTOR_PROVIDER_INCLUDE_SOURCE_URI=true` only after confirming that the
provider needs provenance URLs and that the deployment's privacy policy allows
them.
Partial provider settings without `EXTRACTOR_PROVIDER_URL` fail preflight and
startup; this prevents an apparently configured deployment from silently using
the local heuristic.

If the default project URL returns GitHub's 404 page, stop the release:
enable **Settings → Pages → Source: GitHub Actions**, rerun the publication
workflow, and only then run the exact-origin smoke probe. A green local
`production:check` proves the generated artifact; it cannot activate Pages or
prove that an external URL serves it.
The Pages probe's optional retry settings must be positive integers; malformed
`PAGES_SMOKE_ATTEMPTS` or `PAGES_SMOKE_RETRY_DELAY_MS` values fail before the
probe sends requests.

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
in the script; fetches and response bodies that ignore cancellation are also
forced to settle at the probe deadline, with late response bodies canceled
best-effort. Output includes the sanitized target and deployment base, actual
attempts, throughput, failure rate, and latency percentiles; the same
sanitization applies to programmatic probe callers. To enforce an agreed
deployment-specific budget, also set
`LOAD_TEST_MAX_FAILURES` and/or `LOAD_TEST_MAX_P95_MS`; omitted thresholds
default to zero tolerated failures and no latency threshold. Explicitly
provided request, concurrency, duration, failure-budget, and p95-budget values
must be valid integers; malformed values fail before any traffic is sent. A
non-loopback target additionally requires
`LOAD_TEST_CONFIRM=I_UNDERSTAND`. Treat the result as evidence for this
deployment and provider combination, not as a universal capacity guarantee;
never aim it at a production endpoint without an agreed traffic budget.

For a repeatable operator-run probe, use the manually dispatched
`Deployment capacity probe` workflow. Enter the exact HTTPS deployment base,
`I_UNDERSTAND`, the agreed duration/concurrency, and explicit failure/p95
budgets. When the repository `PUBLIC_ORIGIN` variable is configured, the
workflow rejects targets whose origin does not match it; keep that variable
set to the externally visible deployment origin. The workflow is intentionally
health-only so a user-entered target cannot receive a repository secret. For
authenticated extraction capacity, use the protected operator shell above with the target and
`EXTRACTOR_AUTH_TOKEN` controlled together. A project-site path in the target is
preserved when the probe constructs its request. Each run retains the bounded
probe output for 14 days, including failure diagnostics, so an SLO decision can
be reviewed after the workflow completes. The script's hard limits still cap
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
the validated SPDX dependency inventory, generated Pages asset manifest, version identity, installable-app manifest,
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
workbench. Each successful Pages run also retains a 30-day publication-evidence
artifact containing the exact asset manifest, release identity, installable-app
manifest, branded 404 page, Atom feed, sitemap, generated sample-graph
explainer, crawler files, and security metadata for incident comparison and
rollback analysis.
The Pages-built service worker also treats the injected `asset-manifest.json` as
required during installation; a worker without publication-integrity metadata
must not become the offline controller.
The verifier bounds both endpoint and manifest fetches at 15 seconds by
default, including providers that ignore abort signals or leave a response
body read pending; late bodies are canceled best-effort.
Obsidian learning-note export applies the same explicit fetch settlement rule
within its aggregate 30-second deadline, so a stalled note transport cannot
hold the export indefinitely.
The same workflow generates a GitHub artifact attestation for the exact
`dist/asset-manifest.json` and associates the validated `sbom.spdx.json` with
that attestation. Tagged releases create the equivalent attestation, so
operators can verify provenance in GitHub before promoting retained evidence.
The scheduled `Monitor published Pages` workflow repeats the same probe daily
and explicitly checks out the repository's default branch before requiring the
served source revision to match that branch. This keeps manual runs from a
feature branch from producing a false stale-publication alert. Set the
repository `PUBLIC_ORIGIN` variable when a custom domain or non-default Pages
path is used. A failed monitor run indicates that the published site needs
investigation even when the last deployment was green. The workflow retains
the bounded probe output as a 14-day artifact on failure, so publication,
CDN-propagation, activation, and source-revision diagnostics remain available
after the scheduled run completes.
The scheduled `Monitor published browser experience` workflow repeats the
browser smoke matrix daily against that same exact origin and checks the
served source revision against the repository default branch. Each browser
probe gets three bounded attempts with a short delay for normal publication
propagation; the post-deploy release workflow remains strict and does not use
this monitor tolerance. Failed browser lanes retain their bounded command log
and diagnostic screenshots for seven days, which preserves the retry history
and exact failure context for incident review. It is read-only and uses the repository
`PUBLIC_ORIGIN` variable or the default GitHub Pages URL.

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

- `/livez` answers process liveness and release identity; `/healthz` remains a
  compatible liveness alias.
- `/readyz` answers whether static assets and generated note pages are usable.
- `/metrics` exposes Prometheus text and must remain authenticated outside a
  local loopback deployment. It includes aggregate HTTP latency and in-flight
  request pressure, plus extraction latency and provider capacity metrics; it
  intentionally avoids document, URI, and client-identity labels.
  `llm_field_notes_extraction_failures_by_code_total` groups extraction
  failures into a fixed set of privacy-safe reasons such as
  `AUTH_REQUIRED`, `RATE_LIMITED`, `EXTRACTOR_TIMEOUT`, and
  `EXTRACTOR_FAILURE`; use it to route alerts without parsing request logs.
  It also exposes `llm_field_notes_rate_limit_keys` and
  `llm_field_notes_rate_limit_key_capacity`; alert when occupancy approaches
  the ceiling (for example,
  `rate_limit_keys / rate_limit_key_capacity > 0.8`) because that indicates
  unusually high client cardinality or a missing upstream limiter.

Useful baseline alerts:

```promql
llm_field_notes_draining == 1
rate(llm_field_notes_extraction_failures_total[5m]) > 0
rate(llm_field_notes_extraction_failures_by_code_total{code="EXTRACTOR_TIMEOUT"}[5m]) > 0
rate(llm_field_notes_extraction_failures_by_code_total{code="AUTH_REQUIRED"}[5m]) > 0
rate(llm_field_notes_rate_limited_total[5m]) > 0
rate(llm_field_notes_readiness_timeouts_total[5m]) > 0
rate(llm_field_notes_readiness_failures_total[5m]) > 0
llm_field_notes_rate_limit_keys
  / llm_field_notes_rate_limit_key_capacity > 0.8
llm_field_notes_extractions_in_flight
  >= llm_field_notes_extractor_concurrency_limit
```

For gateway saturation, alert when `llm_field_notes_http_requests_in_flight`
remains elevated or when the HTTP latency histogram shifts above the
deployment's normal baseline. Keep alert windows long enough to avoid treating
the metrics scrape itself as sustained pressure.

Validate both status and response shape from an operator shell:

```bash
curl --fail --silent http://localhost:8000/livez \
  | node scripts/verify-service-health.mjs - liveness
curl --fail --silent http://localhost:8000/readyz \
  | node scripts/verify-service-health.mjs - readiness
```

Use `/livez` for process liveness and `/readyz` for traffic admission. A
successful `/livez` does not prove that published assets or required secrets
are usable. Treat a `503` readiness response as a deployment or static-asset incident,
not as a provider result. Treat repeated `502`/`504` extraction responses as
provider or gateway incidents. Preserve the `x-request-id` from a failed
response and correlate it with structured logs. Logs must not include source
text, evidence, credentials, or provider payloads.
The readiness validator has a five-second default deadline, capped at 30
seconds; a timeout is a fail-closed `503` and should be investigated as a
filesystem or generated-publication incident.
Alert on `llm_field_notes_readiness_timeouts_total`; it identifies readiness
checks that exceeded the validation deadline rather than merely reporting a
generic missing or malformed asset.
Alert on `llm_field_notes_readiness_failures_total` for completed checks that
found an unavailable or misconfigured application.
The service worker’s shell network request has a three-second explicit
settlement deadline, including environments that ignore abort signals; cached
offline fallback remains available after that deadline.

The authenticated `/metrics` response exposes
`llm_field_notes_extractor_mode` so operators can confirm whether the process
is using the deterministic local heuristic, the configured model provider, or
a custom injected extractor. Extraction responses expose
`RateLimit-Limit`, `RateLimit-Remaining`, and
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
   A visually empty graph can still retain Undo history after **Clear local
   graph**; keep the backup reminder until that history has been included in a
   full backup or intentionally discarded.

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
