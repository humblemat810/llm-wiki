---
id: agents
title: Tools make a system
category: shipping
---

# Tools make a system

> How does a model take action?

## The short version

An agent is a control loop around a model: decide, call a tool, observe, and
decide again. Reliability comes from constrained actions, state, checks, and a
clear stop condition.

## Build it

Give a model exactly two tools and a maximum of five steps. Log every decision,
tool input, output, and stop reason. Add a dry-run mode before enabling writes.

## Failure modes

Tool outputs are untrusted input. A loop can amplify a small mistake, spend
unbounded resources, or perform an irreversible action that looked harmless in
the prompt.

## Sources

- Yao et al., “ReAct: Synergizing Reasoning and Acting in Language Models.”

## Try it yourself

Ask a person to approve the plan before the first side effect. Record which
approval details were missing.
