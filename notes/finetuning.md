---
id: finetuning
title: Teach, don't just prompt
category: shipping
---

# Teach, don't just prompt

> When should I change the weights?

## The short version

Fine-tuning changes behavior through examples. It is useful for repeatable
format, style, or task behavior; it is not a magic database update.

## Build it

Write 50 high-quality examples for one narrow behavior. Hold out a test set and
compare prompt-only behavior with the tuned model. Keep the data versioned.

## Failure modes

Weak examples teach noise, narrow data can erase useful behavior, and a tuned
model can pass familiar tests while failing on simple variations.

## Sources

- Ouyang et al., “Training language models to follow instructions with human feedback.”

## Try it yourself

Hold out twenty percent of your examples before tuning. Compare prompt-only
and tuned behavior on both splits, then write down one example where tuning
memorized a pattern instead of learning the intended behavior.

Remove the weakest quarter of the examples. If performance improves, the
dataset was teaching noise.
