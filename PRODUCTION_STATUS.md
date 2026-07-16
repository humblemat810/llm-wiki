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
| Local graph and revision history | Ready for single-user use | `graph-core.js`, `graph-store.js`, storage/recovery smoke tests |
| Obsidian projection and round-trip review | Ready | projection, ZIP, chronology, privacy, and rebuild tests |
| Optional extraction gateway | Ready for a protected single instance | authenticated readiness, bounded requests, rate/concurrency limits, provider HTTP smoke |
| Standalone server lifecycle | Ready for the reference process contract | `npm run smoke:server` covers build identity, auth success/rejection, bounded concurrency, readiness, and graceful drain |
| Static public wiki | Ready for publication | shared Node/Pages asset contract, exact manifest/digest verification, accessibility/performance gates, and deployment probe |
| Live default Pages deployment | Not currently verified | The repository contains the publication workflow, but the default `https://humblemat810.github.io/llm-wiki/` returned HTTP 404 on July 16, 2026; enable GitHub Pages with the Actions source and run the workflow before calling the public URL production |
| Container runtime | Ready for a hardened single instance | `npm run smoke:container` proves non-root, read-only filesystem, capability drop, readiness, health, auth, and drain behavior |
| Automated release checks | Ready | locked install, dependency audit, full suite, CodeQL, Scorecard, tag/container gates, Chromium/Firefox/WebKit release-workbench matrix, and retained Pages evidence |
| Automated browser smoke | Repository gate | `.github/workflows/browser.yml` runs the local workbench smoke across Chromium, Firefox, and WebKit, including manifest, raster-icon, and installed-app metadata delivery, human review→reusable learning, Obsidian ZIP export/import, source-revision identity, and failure screenshots |
| Exact-deployment browser smoke | Pages release gate | The Pages workflow runs the browser smoke across Chromium, Firefox, and WebKit against the deployed URL after publication and verifies the deployed source revision |
| Scheduled browser experience monitor | Daily operator gate | `.github/workflows/browser-monitor.yml` repeats the exact-origin browser smoke across Chromium, Firefox, and WebKit after publication against the default-branch revision |
| Repeatable deployment capacity probe | Operator gate | `.github/workflows/capacity.yml` runs a health-only bounded duration probe only after explicit target authorization and SLO inputs |
| Sustained-load and extended browser certification | Deployment-specific follow-up | `npm run load:server` provides bounded operator budgets; [RUNBOOK.md](RUNBOOK.md#real-browser-certification) still covers long-duration, offline, accessibility, and provider-boundary evidence; WebKit offline emulation is documented as a runner limitation |
| Hosted multi-user workspace | Not implemented | requires identity, authorization, durable server storage, tenancy, and retention policy |

## What “production-ready” means here

Before a single-user or single-instance launch, run:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run production:check
```

For a public static release, also configure the exact HTTPS `PUBLIC_ORIGIN`,
build and verify Pages, and wait for the post-deploy smoke probe to pass. For
the reference server, use TLS at the gateway, configure both authentication
secrets, enforce gateway identity/CSRF policy, and monitor `/healthz`,
`/readyz`, and authenticated `/metrics`.

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
