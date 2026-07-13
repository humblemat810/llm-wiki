---
id: tokens
title: Tokens are the interface
category: foundations
---

# Tokens are the interface

> Why can't the model see words?

## The short version

A language model receives a sequence of token IDs, not words. A tokenizer turns
bytes or characters into a vocabulary of reusable pieces. That boundary
controls context length, cost, spelling behavior, and how much information can
fit into a request.

## Build it

Write a tiny byte-pair tokenizer for a small text file. Print the token IDs,
decoded text, and compression ratio for a name, an emoji, source code, and a
sentence in another language. This repository includes a dependency-free
character-level starting point: `node experiments/tiny-bpe.mjs`.

## Failure modes

Tokenization is not semantic understanding. A rare name may become many pieces,
while a common word may be one piece. A tokenizer can also preserve decoding
round trips while making human-intuitive units invisible.

## Sources

- Sennrich, Haddow, and Birch, “Neural Machine Translation of Rare Words with Subword Units.”

## Try it yourself

Take the same sentence, a URL, an emoji, and a short code snippet. Tokenize
each one, record token count and decoded text, then explain which example
changes most when the tokenizer vocabulary changes.

Change one character at a time and record how the token sequence changes.
