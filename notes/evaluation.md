---
id: evaluation
title: Measure the thing
category: systems
---

# Measure the thing

> How do I know if it works?

## The short version

Evaluation is a decision instrument. Define the user task, collect
representative examples, record acceptable failures, and measure changes with a
repeatable harness.

## Build it

Create a 30-example evaluation set for one narrow task. Include ambiguous and
adversarial cases, a rubric, a baseline, and a held-out slice. Have two people
score the same outputs.

## Failure modes

A single aggregate score can hide catastrophic cases. Test contamination,
grader drift, and optimizing to the rubric can all make a system look better
without making it more useful.

## Sources

- Ribeiro, Singh, and Guestrin, “Why Should I Trust You?”

## Try it yourself

Investigate scorer disagreement before adding more examples.
