---
id: knowledge-graphs
title: A graph is a hypothesis
category: shipping
question: How does a document become a representation you can improve?
---

# A graph is a hypothesis

> How does a document become a representation you can improve?

## The short version

A knowledge graph is not a magical summary of a document. It is a compact,
inspectable hypothesis about which concepts matter, how they relate, and what
evidence supports each claim. That makes it useful: a person can correct the
hypothesis, preserve the correction, and use it to guide the next extraction.

The important loop is:

```text
document → candidate graph → human review → reusable guidance → new graph
```

The graph is an internal representation. Markdown, Obsidian notes, JSON, and
JSON-LD are projections of that representation, not separate sources of truth.

## Build it

Start with one document and write down three different layers:

1. **Concepts** — the entities or ideas that should remain addressable.
2. **Relations** — the claims that connect one concept to another.
3. **Grounding** — the source text and location that justify each item.

Then give every candidate a status. `inferred` means the extractor proposed it.
`accepted` and `rejected` mean a person reviewed it. Keep those states separate:
an extractor should be allowed to make a useful mistake without rewriting what a
person already decided.

Export the same graph into a viewer such as Obsidian. A good projection lets a
reader inspect evidence, edit a bounded review field, and bring the correction
back without creating a second database.

## Failure modes

- **Summary without grounding:** a polished label cannot tell you whether the
  source actually supports it.
- **IDs without identity rules:** two labels can describe the same idea, while
  one label can describe different ideas in different documents.
- **Feedback as a prompt dump:** sending arbitrary history to a model makes the
  context noisy, expensive, and hard to audit.
- **Projection drift:** editing a Markdown copy without a fingerprint or source
  identity can silently apply a stale correction to a newer graph.
- **Overconfidence:** accepted and rejected decisions should guide extraction,
  not turn an uncertain hypothesis into an unquestionable fact.

The practical response is to keep provenance, stable identities, bounded review
memory, freshness rules, and an explicit queue for unresolved candidates.

## Sources

- [RDF 1.1 Concepts and Abstract Syntax](https://www.w3.org/TR/rdf11-concepts/)
- [Obsidian Help: Internal links](https://help.obsidian.md/links)
- [A Short Introduction to Knowledge Graphs](https://www.cs.ox.ac.uk/people/michael.wooldridge/knowledge-graphs.html)

## Try it yourself

Take a paragraph you know well and build two graphs: one with only labels, and
one with evidence and review status. Ask another person to reject one candidate
and accept one missing concept. Re-run the extraction with only those compact
decisions as guidance. Compare not just the number of nodes, but which claims
became easier to inspect and which unsupported claims disappeared.
