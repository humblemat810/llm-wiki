import { pathToFileURL } from "node:url";

const assertFinite = (value, label) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
};

export function softmax(values) {
  if (!Array.isArray(values) || !values.length) throw new Error("softmax requires a non-empty array.");
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => {
    assertFinite(value, "softmax input");
    return Math.exp(value - maximum);
  });
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

const dot = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);

export function scaledDotProductAttention(queries, keys, values, { causal = false } = {}) {
  if (!Array.isArray(queries) || !Array.isArray(keys) || !Array.isArray(values) || !queries.length || keys.length !== values.length) {
    throw new Error("attention requires non-empty queries, matching keys, and values.");
  }
  const width = queries[0].length;
  const valueWidth = values[0].length;
  if (!width || !valueWidth || keys.some((key) => key.length !== width) || queries.some((query) => query.length !== width) || values.some((value) => value.length !== valueWidth)) {
    throw new Error("attention vectors must have a consistent width.");
  }
  return queries.map((query, queryIndex) => {
    const scores = keys.map((key, keyIndex) => causal && keyIndex > queryIndex ? -Infinity : dot(query, key) / Math.sqrt(width));
    const finiteScores = scores.map((score) => score === -Infinity ? -1e9 : score);
    const weights = softmax(finiteScores).map((weight, keyIndex) => causal && keyIndex > queryIndex ? 0 : weight);
    const normalization = weights.reduce((sum, weight) => sum + weight, 0);
    return {
      weights,
      output: values[0].map((_, valueIndex) => values.reduce((sum, value, keyIndex) => sum + weights[keyIndex] * value[valueIndex], 0)),
      weightSum: normalization
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = scaledDotProductAttention(
    [[1, 0], [0, 1], [1, 1]],
    [[1, 0], [0, 1], [1, 1]],
    [[1, 2], [3, 4], [5, 6]],
    { causal: true }
  );
  result.forEach((row, index) => console.log(`row ${index}: weights=${row.weights.map((value) => value.toFixed(3)).join(",")} output=${row.output.map((value) => value.toFixed(3)).join(",")}`));
}
