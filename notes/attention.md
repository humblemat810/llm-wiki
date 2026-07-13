---
id: attention
title: Attention is a lookup
category: foundations
---

# Attention is a lookup

> How does context enter the computation?

## The short version

Queries ask what a position needs, keys advertise what is available, and values
carry information back. Scaled dot products turn those matches into weights
over the context.

## Build it

Implement scaled dot-product attention with a small array library. Print the
attention matrix for a sentence and explain one row in plain language. Then
apply a causal mask and observe which entries become impossible.

This repository includes a dependency-free starting point:
`node experiments/tiny-attention.mjs`.

## Failure modes

An attention weight is not automatically an explanation. Multiple heads can
divide work in unintuitive ways, and a high weight does not prove a causal
relationship.

## Sources

- Vaswani et al., “Attention Is All You Need.”

## Try it yourself

Remove the scale factor, then increase sequence length. Measure both numerical
behavior and runtime.
