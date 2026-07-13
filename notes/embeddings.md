---
id: embeddings
title: Meaning in a vector
category: foundations
---

# Meaning in a vector

> How does a model store meaning?

## The short version

An embedding is a learned coordinate system. Similar uses often land near one
another, but dimensions are not a hand-labeled dictionary. The geometry is
shaped by training data and the objective that created it.

## Build it

Load a small embedding model, project 30 words with PCA, and inspect nearest
neighbors for an ambiguous word. Label clusters before looking at the answer.

## Failure modes

Similarity is not truth, causality, or fairness. A neighborhood can reflect
useful regularities and inherited corpus bias at the same time.

## Sources

- Mikolov et al., “Distributed Representations of Words and Phrases and their Compositionality.”

## Try it yourself

Choose one ambiguous word with two meanings. List five neighbors from your
embedding model, label which sense each neighbor suggests, and repeat with a
different corpus to see which relationships survive.

Find one useful neighborhood and one misleading neighborhood. Ask what the
corpus taught the geometry.
