import assert from "node:assert/strict";
import { decodeBpe, encodeBpe, trainBpe } from "../experiments/tiny-bpe.mjs";

const text = "attention attention context context context";
const merges = trainBpe(text, { maxMerges: 8 });
assert(merges.length > 0, "repeated text should produce at least one merge");
const tokens = encodeBpe(text, merges);
assert(tokens.length < Array.from(text).length, "BPE should compress repeated character pairs");
assert.equal(decodeBpe(tokens), text, "BPE encoding should round-trip through decoding");
assert.deepEqual(trainBpe(text, { maxMerges: 8 }), merges, "BPE training should be deterministic");
console.log("BPE smoke ok");
