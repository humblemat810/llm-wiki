import { pathToFileURL } from "node:url";

const assertFinite = (value, label) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
};

export function softmax(logits) {
  if (!Array.isArray(logits) || !logits.length) throw new Error("softmax requires non-empty logits.");
  logits.forEach((value) => assertFinite(value, "logit"));
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

export function crossEntropy(probabilities, target) {
  if (!Array.isArray(probabilities) || !probabilities.length) throw new Error("crossEntropy requires probabilities.");
  if (!Number.isInteger(target) || target < 0 || target >= probabilities.length) throw new Error("target must index probabilities.");
  const probability = probabilities[target];
  if (!(probability > 0) || !Number.isFinite(probability)) throw new Error("target probability must be positive and finite.");
  return -Math.log(probability);
}

const sortedVocabulary = (text) => [...new Set(Array.from(text))].sort((left, right) => left.codePointAt(0) - right.codePointAt(0));

function examplesFor(text, vocabulary) {
  const indexByCharacter = new Map(vocabulary.map((character, index) => [character, index]));
  return Array.from(text).slice(0, -1).map((character, index) => ({
    context: indexByCharacter.get(character),
    target: indexByCharacter.get(Array.from(text)[index + 1])
  }));
}

function averageLoss(logits, examples) {
  return examples.reduce((sum, example) => sum + crossEntropy(softmax(logits[example.context]), example.target), 0) / examples.length;
}

export function trainBigram(text, { steps = 1000, learningRate = 0.5 } = {}) {
  if (typeof text !== "string" || text.length < 2) throw new Error("training requires at least two characters.");
  if (!Number.isInteger(steps) || steps < 1) throw new Error("steps must be a positive integer.");
  if (!Number.isFinite(learningRate) || learningRate <= 0) throw new Error("learningRate must be positive and finite.");
  const vocabulary = sortedVocabulary(text);
  const examples = examplesFor(text, vocabulary);
  const logits = vocabulary.map(() => vocabulary.map(() => 0));
  const lossHistory = [averageLoss(logits, examples)];

  for (let step = 0; step < steps; step += 1) {
    const example = examples[step % examples.length];
    const probabilities = softmax(logits[example.context]);
    for (let candidate = 0; candidate < probabilities.length; candidate += 1) {
      const gradient = probabilities[candidate] - (candidate === example.target ? 1 : 0);
      logits[example.context][candidate] -= learningRate * gradient;
    }
    if ((step + 1) % Math.max(1, Math.floor(steps / 20)) === 0 || step === steps - 1) {
      lossHistory.push(averageLoss(logits, examples));
    }
  }

  const indexByCharacter = new Map(vocabulary.map((character, index) => [character, index]));
  const predict = (context) => {
    if (typeof context !== "string" || !context.length) throw new Error("predict requires a context character.");
    const contextIndex = indexByCharacter.get(Array.from(context).at(-1));
    if (contextIndex === undefined) throw new Error(`unknown context character: ${context}`);
    const probabilities = softmax(logits[contextIndex]);
    const nextIndex = probabilities.reduce((best, probability, index) => probability > probabilities[best] ? index : best, 0);
    return { character: vocabulary[nextIndex], probabilities };
  };
  const generate = (start, length = 40) => {
    if (typeof start !== "string" || !start.length) throw new Error("generate requires a starting character.");
    if (!Number.isInteger(length) || length < 0) throw new Error("length must be a non-negative integer.");
    let output = Array.from(start).at(-1);
    if (!indexByCharacter.has(output)) throw new Error(`unknown start character: ${output}`);
    for (let index = 0; index < length; index += 1) output += predict(output).character;
    return output;
  };
  return {
    vocabulary,
    steps,
    learningRate,
    lossHistory,
    finalLoss: lossHistory.at(-1),
    evaluateLoss: () => averageLoss(logits, examples),
    predict,
    generate
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const model = trainBigram("hello world\nhello model\n", { steps: 1200, learningRate: 0.6 });
  console.log(`vocabulary: ${JSON.stringify(model.vocabulary)}`);
  console.log(`loss: ${model.lossHistory[0].toFixed(3)} -> ${model.finalLoss.toFixed(3)}`);
  console.log(`sample: ${JSON.stringify(model.generate("h", 32))}`);
}
