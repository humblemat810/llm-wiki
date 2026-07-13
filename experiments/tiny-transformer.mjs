import { pathToFileURL } from "node:url";

const assertFinite = (value, label) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
};

export function softmax(values) {
  if (!Array.isArray(values) || !values.length) throw new Error("softmax requires non-empty values.");
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => {
    assertFinite(value, "softmax input");
    return Math.exp(value - maximum);
  });
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

export function layerNorm(vector, epsilon = 1e-5) {
  if (!Array.isArray(vector) || !vector.length) throw new Error("layerNorm requires a non-empty vector.");
  const mean = vector.reduce((sum, value) => sum + value, 0) / vector.length;
  const variance = vector.reduce((sum, value) => sum + (value - mean) ** 2, 0) / vector.length;
  return vector.map((value) => (value - mean) / Math.sqrt(variance + epsilon));
}

const makeMatrix = (rows, columns, scale = .2) => Array.from(
  { length: rows },
  (_, row) => Array.from({ length: columns }, (_, column) => Math.sin((row + 1) * (column + 2) * .73) * scale)
);
const multiply = (vector, matrix) => matrix[0].map((_, column) => vector.reduce((sum, value, row) => sum + value * matrix[row][column], 0));
const add = (left, right) => left.map((value, index) => value + right[index]);
const positionalEmbedding = (position, width) => Array.from({ length: width }, (_, index) => Math.sin((position + 1) * (index + 1) * .31) * .1);
const tokenEmbedding = (token, width) => Array.from({ length: width }, (_, index) => Math.sin((token + 1) * (index + 1) * .73) * .2);

export function forwardTransformer(tokens, options = {}) {
  if (!Array.isArray(tokens) || !tokens.length || tokens.some((token) => !Number.isInteger(token) || token < 0)) {
    throw new Error("tokens must be a non-empty array of non-negative integers.");
  }
  const { vocabSize = Math.max(...tokens) + 1, width = 8, heads = 2, mlpWidth = width * 2 } = options;
  if (!Number.isInteger(vocabSize) || vocabSize < 1 || tokens.some((token) => token >= vocabSize)) throw new Error("vocabSize must cover every token.");
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(heads) || heads < 1 || width % heads !== 0) throw new Error("width must be divisible by heads.");
  if (!Number.isInteger(mlpWidth) || mlpWidth < 1) throw new Error("mlpWidth must be positive.");
  const headWidth = width / heads;
  const qMatrix = makeMatrix(width, width);
  const kMatrix = makeMatrix(width, width, .17);
  const vMatrix = makeMatrix(width, width, .13);
  const outputMatrix = makeMatrix(width, width, .11);
  const firstMlpMatrix = makeMatrix(width, mlpWidth, .16);
  const secondMlpMatrix = makeMatrix(mlpWidth, width, .14);
  const logitsMatrix = makeMatrix(width, vocabSize, .19);
  const input = tokens.map((token, position) => add(tokenEmbedding(token, width), positionalEmbedding(position, width)));
  const queries = input.map((vector) => multiply(vector, qMatrix));
  const keys = input.map((vector) => multiply(vector, kMatrix));
  const values = input.map((vector) => multiply(vector, vMatrix));
  const attention = [];
  const attentionOutput = input.map((vector, position) => {
    const headsOutput = [];
    const positionWeights = [];
    for (let head = 0; head < heads; head += 1) {
      const start = head * headWidth;
      const query = queries[position].slice(start, start + headWidth);
      const scores = keys.slice(0, position + 1).map((key) => query.reduce((sum, value, index) => sum + value * key[start + index], 0) / Math.sqrt(headWidth));
      const weights = softmax(scores);
      positionWeights.push(weights);
      for (let index = 0; index < headWidth; index += 1) {
        headsOutput.push(values.slice(0, position + 1).reduce((sum, value, keyIndex) => sum + weights[keyIndex] * value[start + index], 0));
      }
    }
    attention.push(positionWeights);
    return layerNorm(add(vector, multiply(headsOutput, outputMatrix)));
  });
  const hidden = attentionOutput.map((vector) => {
    const expanded = multiply(vector, firstMlpMatrix).map((value) => Math.tanh(value));
    return layerNorm(add(vector, multiply(expanded, secondMlpMatrix)));
  });
  const logits = hidden.map((vector) => multiply(vector, logitsMatrix));
  logits.flat().forEach((value) => assertFinite(value, "logit"));
  return { logits, hidden, attention, width, heads, vocabSize };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = forwardTransformer([0, 1, 2, 1], { vocabSize: 4, width: 8, heads: 2 });
  console.log(`logits shape: ${result.logits.length} x ${result.logits[0].length}`);
  console.log(`causal attention row lengths: ${result.attention.map((row) => row[0].length).join(",")}`);
  console.log(`finite output: ${result.logits.flat().every(Number.isFinite)}`);
}
