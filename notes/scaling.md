---
id: scaling
title: Scale changes the game
category: systems
---

# Scale changes the game

> Why does scale work?

## The short version

More parameters alone are not a strategy. Useful scaling balances model
capacity, data, and compute so the model keeps finding structure instead of
memorizing noise.

## Build it

Train three tiny models under a fixed compute budget. Log parameter count,
tokens seen, wall time, and validation loss. Predict the winner before checking.

## Failure modes

Benchmark gains can hide higher cost, brittle distribution shifts, or a
measurement that does not represent the user task. Extrapolation is an
empirical claim, not a law of nature.

## Sources

- Kaplan et al., “Scaling Laws for Neural Language Models.”
- Hoffmann et al., “Training Compute-Optimal Large Language Models.”

## Try it yourself

Predict validation loss for three model sizes before training them. Keep the
data and compute budget visible, then compare your prediction with measured
loss per parameter and wall-clock cost.

Hold compute constant while changing the data/model allocation. Compare the
result with a model trained longer.
