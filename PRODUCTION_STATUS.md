# Production status

This project is production-ready in one clearly defined mode:

> a single-user, local-first knowledge workspace with an optional same-origin
> extraction gateway and static public learning content.

It is not yet a hosted, multi-user SaaS. The browser graph is intentionally
user-owned local state; the reference Node server does not provide accounts,
tenant isolation, cloud graph storage, billing, or hosted backup retention.

## Current readiness

| Surface | Status | Evidence |
| --- | --- | --- |
| Local graph and revision history | Ready for single-user use | `graph-core.js`, `graph-store.js`, storage/recovery smoke tests, and durable-only IndexedDB hydration/status recovery coverage |
| Obsidian projection and round-trip review | Ready | projection, ZIP, chronology, privacy, and rebuild tests |
| Optional extraction gateway | Ready for a protected single instance | pre-traffic `npm run deployment:check`, authenticated readiness, bounded requests, rate/concurrency limits, streamed provider-response ceiling enforcement (including absent `Content-Length`), provider HTTP smoke, built-in server-side OpenAI-compatible model adapter |
| Model-provider privacy boundary | Ready for protected single-instance use | provider credentials remain server-side; source URIs are opt-in; requests disable automatic redirects and intermediary caching; bounded response decoding and structured-output normalization are covered by provider smoke tests |
| Standalone server lifecycle | Ready for the reference process contract | `npm run smoke:server` covers build identity, liveness/readiness, auth success/rejection, bounded concurrent and one-second duration extraction load, and graceful drain |
| Static public wiki | Ready for publication | dedicated static-pages preflight, shared Node/Pages asset contract, required deployed asset manifest, exact manifest/digest verification, published-asset-aware HTML link and symlink checks, accessibility/performance gates, and deployment probe |
| Live default Pages deployment | Deployed; workflow verifier fix pending rerun | On July 17, 2026, the public origin served revision `8e6852e6bc4b9b6b2605980bbc67eba28c90c1b9`; the corrected local `npm run smoke:pages:deployment` passed 123 checks against it. The publication workflow for that revision failed before this verifier fix because GitHub Pages transparently gzip-decodes responses and serves `sw.js` as `application/javascript`; push the verifier fix and rerun publication before calling the workflow green |
| Container runtime | Ready for a hardened single instance | `npm run smoke:container` proves non-root, read-only filesystem, capability drop, readiness, health, auth, and drain behavior |
| Supply-chain evidence | Ready | deterministic SPDX SBOM, parsed workflow/permission checks, immutable action pins, and GitHub artifact attestations for Pages/release manifests |
| Supported Node compatibility | Verified for current worktree | On July 17, 2026, the full `npm test` suite passed on Node 24; the canonical Node 22 production gate also passes, matching the CI runtime matrix |
| Automated release checks | Ready | locked install, dependency audit, full suite, CodeQL, Scorecard, tag/container gates, ten reviewed extraction-quality cases covering technical phrases, multilingual text, ungrounded-feedback suppression, definitions, passive structure, causal structure, and relation suppression, Chromium/Firefox/WebKit release-workbench matrix, and retained Pages evidence |
| Automated browser smoke | Repository gate | `.github/workflows/browser.yml` runs the local workbench smoke across Chromium, Firefox, and WebKit, including same-origin model-mode extraction and draft-preserving failure recovery where runner interception is supported, recipient-openable redacted share links with origin-aware metadata, a bounded visual map, redacted JSON download, fragment privacy checks, and offline reopen coverage where the runner supports it, manifest, raster-icon, and installed-app metadata delivery, human review→reusable learning, Obsidian ZIP export/import, source-revision identity, and failure screenshots |
| Clean local browser certification | Verified for current worktree | On July 17, 2026, `npm run browser:smoke` passed in clean Node 22 environments for Chromium, Firefox, and WebKit, including the transient-provider failure/retry drill where runner interception is supported; this proves the local workbench contract, not the still-unpublished external origin |
| Exact-deployment browser smoke | Pages release gate | The Pages workflow runs the browser smoke across Chromium, Firefox, and WebKit against the deployed URL after publication and verifies the deployed source revision |
| Scheduled browser experience monitor | Daily operator gate | `.github/workflows/browser-monitor.yml` repeats the exact-origin browser smoke across Chromium, Firefox, and WebKit after publication against the default-branch revision |
| Repeatable deployment capacity probe | Operator gate | `.github/workflows/capacity.yml` runs a health-only bounded duration probe only after explicit target authorization and SLO inputs; the target must match the exact normalized `PUBLIC_ORIGIN` deployment base, including project-site paths |
| Local bounded extraction-duration evidence | Verified for current worktree | On July 17, 2026, `npm run smoke:server` passed its one-second authenticated extraction-duration probe; provider, proxy, and deployment-specific capacity still require the opt-in operator probe |
| Sustained-load and extended browser certification | Deployment-specific follow-up | `npm run load:server` provides bounded operator budgets; [RUNBOOK.md](RUNBOOK.md#real-browser-certification) still covers long-duration, offline, accessibility, and provider-boundary evidence; WebKit offline emulation is documented as a runner limitation |
| Hosted multi-user workspace | Not implemented | requires identity, authorization, durable server storage, tenancy, and retention policy |

## What “production-ready” means here

Before a single-user or single-instance launch, run:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run production:check
```

For a public static release, set `DEPLOYMENT_MODE=static-pages`, configure the
exact HTTPS `PUBLIC_ORIGIN`, build and verify Pages, and wait for the post-deploy
smoke probe to pass. For the reference server, use TLS at the gateway,
configure both authentication secrets, enforce gateway identity/CSRF policy,
and monitor `/livez`, `/readyz`, and authenticated `/metrics`.

GitHub Pages is now configured with the Actions source and the default origin
is serving the expected revision. The repository still requires one clean
publication workflow after the verifier compatibility fix before the public
launch can be considered fully certified. Verify the exact origin and
revision with:

```bash
PAGES_DEPLOYMENT_URL=https://humblemat810.github.io/llm-wiki/ \
PAGES_EXPECTED_REVISION="$(git rev-parse HEAD)" \
npm run smoke:pages:deployment
```

## Closure checklist

The repository engineering phase can close for the supported single-instance
contract when a release-candidate commit passes the clean Node 22
`npm run production:check` gate and the resulting artifact and evidence are
reviewed. A public launch is a separate external step:

1. Set GitHub Pages to **GitHub Actions** and run the publication workflow.
2. Run the exact-origin Pages smoke with `PAGES_DEPLOYMENT_URL` and
   `PAGES_EXPECTED_REVISION`.
3. Run the deployed Chromium, Firefox, and WebKit browser smoke.
4. Record the deployed URL, source revision, and any environment-specific
   capacity evidence in the release record.

Until those checks pass, do not call the public URL production-certified. Hosted
multi-user work remains future scope and should begin only after an explicit
identity, tenancy, storage, and retention design.

## Remaining product work

The next architectural decision is whether the project should remain
local-first or become a hosted service. A hosted version should not be added by
quietly placing a database behind the current endpoint. It needs an explicit
design for:

1. account and session identity;
2. workspace and tenant authorization;
3. graph/version conflict resolution across devices;
4. encrypted durable storage and backup/deletion retention;
5. provider cost quotas and abuse controls;
6. auditability of human review versus model inference; and
7. migration and export guarantees that preserve the current graph contract.

Until that decision is made, the current local-first boundary is the safer and
more honest production contract.

The green repository gate proves bounded correctness for the supported
single-instance contract. It does not, by itself, establish a capacity target
for a particular provider, reverse proxy, browser fleet, or multi-instance
deployment; those require environment-specific load and browser exercises.
