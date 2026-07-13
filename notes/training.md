---
id: training
title: Loss is a compass
category: foundations
---

# Loss is a compass

> What does “learning” mean here?

## The short version

Loss compresses prediction error into a signal that can move parameters. It is
useful because it is differentiable, not because it perfectly captures what a
person values.

## Build it

Run the dependency-free character-level language model:

```bash
node experiments/tiny-training.mjs
```

Read `experiments/tiny-training.mjs` from top to bottom. It builds a
character vocabulary, scores the next-character prediction with softmax
cross-entropy, applies one gradient update at a time, records loss, and
generates a greedy sample. Change the learning rate and steps before adding
more architecture.

## Failure modes

A falling training loss can coexist with memorization, data leakage, or worse
real-world behavior. Optimization can be correct while the objective is wrong.

## Sources

- Rumelhart, Hinton, and Williams, “Learning representations by back-propagating errors.”

## Try it yourself

Keep the loss falling while making the output worse. Describe the mismatch
without using the word “bug.”
