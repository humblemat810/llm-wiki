import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { crossEntropy, softmax, trainBigram } from "../experiments/tiny-training.mjs";

const probabilities = softmax([0, 1, 2]);
assert(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
assert(crossEntropy(probabilities, 2) < crossEntropy(probabilities, 0), "higher target probability should have lower loss");

const corpus = "hello world\nhello model\n";
const model = trainBigram(corpus, { steps: 1200, learningRate: 0.6 });
assert(model.finalLoss < model.lossHistory[0], "training should reduce average loss");
assert.equal(model.generate("h", 20).length, 21, "generation should include the starting character");
assert(model.vocabulary.includes(" "), "the vocabulary should preserve whitespace tokens");
assert.deepEqual(
  trainBigram(corpus, { steps: 1200, learningRate: 0.6 }).lossHistory,
  model.lossHistory,
  "training should be deterministic"
);
const cliOutput = execFileSync(process.execPath, ["experiments/tiny-training.mjs"], { encoding: "utf8" });
assert(cliOutput.includes("loss:") && cliOutput.includes("sample:"), "the training experiment CLI should run successfully");
console.log("training smoke ok");
