---
id: production
title: Ship the boring parts
category: shipping
---

# Ship the boring parts

> What survives contact with users?

## The short version

A production system is a set of promises: response time, cost, availability,
data handling, and behavior when the model is wrong or unavailable. The
fallbacks and observability are part of the product.

## Build it

Create a redacted request log with latency, token counts, model version,
outcome, and trace ID. Add one fallback and one human escape hatch. Test
timeouts, retries, and partial failure deliberately.

## Failure modes

Retries can multiply cost, logs can become a data leak, and a fallback can
silently change the user contract. “Works on my prompt” is not an SLO.

## Sources

- Sculley et al., “Hidden Technical Debt in Machine Learning Systems.”

## Try it yourself

Define a small SLO for a real workflow, then run it through a timeout, a
provider failure, and a redacted-log path. Check that each outcome has a
request ID, latency, safe error, and human escape hatch.

Ask a real person to use the system without narration. Every question they ask
is a missing product surface.

For the reference server, monitor
`llm_field_notes_extraction_client_aborts_total` alongside provider failures.
A spike can indicate browser navigation, gateway timeouts, or client
cancellation pressure rather than a model outage.
