---
id: transformers
title: The transformer stack
category: systems
---

# The transformer stack

> What is the machine made of?

## The short version

A transformer repeats a compact block: mix information across positions with
attention, transform each position with an MLP, and preserve a clean path with
residual connections and normalization.

## Build it

Run the dependency-free one-block forward pass:

```bash
node experiments/tiny-transformer.mjs
```

Then inspect the residual stream, causal attention rows, MLP output, and logits
in `experiments/tiny-transformer.mjs`. Keep the tensor shapes visible before
adding training.

## Failure modes

Removing a component can produce a system that still trains while losing
capacity, stability, or interpretability. A plausible loss curve is not proof
that every block is doing useful work.

## Sources

- Vaswani et al., “Attention Is All You Need.”
- Elhage et al., “A Mathematical Framework for Transformer Circuits.”

## Try it yourself

Remove one component at a time from the tiny transformer—causal masking,
residual connections, normalization, or the MLP. Keep the input fixed and
write down which tensor shapes or outputs change.

Remove one component at a time and record which failure is graceful,
catastrophic, or merely slower.
