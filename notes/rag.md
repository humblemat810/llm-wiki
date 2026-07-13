---
id: rag
title: Give it a library
category: shipping
---

# Give it a library

> How can a model use my data?

## The short version

Retrieval gives a model relevant context at request time instead of asking its
weights to contain every fact. Search, chunking, citation, and freshness often
matter more than a clever final prompt.

## Build it

Index ten documents with simple lexical search. Return the top three chunks
with source labels before asking the model to answer. Require every claim to
point back to a retrieved span.

## Failure modes

Retrieved text can be irrelevant, stale, duplicated, or adversarial. A fluent
answer with citations is still wrong if the retriever failed to bring the
needed evidence.

## Sources

- Lewis et al., “Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks.”

## Try it yourself

Ask a question whose answer appears in exactly one of ten documents. Compare
the answer with and without retrieval, and require every claim in the
retrieval-backed answer to cite a returned span.

Create questions whose answers span two chunks. Check whether both pieces are
retrieved before changing the generator.
