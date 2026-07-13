import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { forwardTransformer, layerNorm, softmax } from "../experiments/tiny-transformer.mjs";

assert(Math.abs(softmax([1, 2, 3]).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
assert(Math.abs(layerNorm([1, 2, 3]).reduce((sum, value) => sum + value, 0)) < 1e-9);
assert.throws(() => forwardTransformer(), /tokens must be a non-empty array/, "invalid transformer input should fail at the public validation boundary");
const result = forwardTransformer([0, 1, 2, 1], { vocabSize: 4, width: 8, heads: 2 });
assert.equal(result.logits.length, 4);
assert.equal(result.logits[0].length, 4);
assert.equal(result.attention.length, 4);
result.attention.forEach((position, index) => {
  assert.equal(position.length, 2);
  position.forEach((weights) => {
    assert.equal(weights.length, index + 1, "causal attention must exclude future positions");
    assert(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
  });
});
assert(result.logits.flat().every(Number.isFinite), "transformer logits should be finite");
const cliOutput = execFileSync(process.execPath, ["experiments/tiny-transformer.mjs"], { encoding: "utf8" });
assert(cliOutput.includes("logits shape: 4 x 4") && cliOutput.includes("finite output: true"), "the transformer experiment CLI should run successfully");
console.log("transformer smoke ok");
