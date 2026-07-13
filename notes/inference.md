---
id: inference
title: One token at a time
category: systems
---

# One token at a time

> What happens at inference?

## The short version

Generation is a loop: run the model, turn logits into a distribution, choose a
token, append it, and repeat. A key/value cache avoids recomputing old context.

## Build it

Write a sampler with greedy, temperature, and top-k modes. Time it with and
without a simple key/value cache, and report first-token latency separately
from steady-state token latency.

## Failure modes

Temperature does not create knowledge. Sampling can hide regressions, and a
cache can improve speed while consuming memory that changes the deployment
limit.

## Sources

- Vaswani et al., “Attention Is All You Need.”
- Pope et al., “Efficiently Scaling Transformer Inference.”

## Try it yourself

Generate the same prompt at three temperatures and describe the difference
without using the word “creative.”
