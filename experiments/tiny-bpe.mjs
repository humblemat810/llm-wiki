const pairKey = (left, right) => JSON.stringify([left, right]);
const lexicalCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function applyMerge(tokens, merge) {
  const output = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === merge[0] && tokens[index + 1] === merge[1]) {
      output.push(`${merge[0]}${merge[1]}`);
      index += 1;
    } else {
      output.push(tokens[index]);
    }
  }
  return output;
}

export function trainBpe(text, { maxMerges = 20, minFrequency = 2 } = {}) {
  if (typeof text !== "string" || !text.length) throw new Error("BPE training requires non-empty text.");
  if (!Number.isInteger(maxMerges) || maxMerges < 0) throw new Error("maxMerges must be a non-negative integer.");
  if (!Number.isInteger(minFrequency) || minFrequency < 2) throw new Error("minFrequency must be at least 2.");
  let tokens = Array.from(text);
  const merges = [];
  for (let iteration = 0; iteration < maxMerges; iteration += 1) {
    const counts = new Map();
    for (let index = 0; index < tokens.length - 1; index += 1) {
      const key = pairKey(tokens[index], tokens[index + 1]);
      const current = counts.get(key) || { left: tokens[index], right: tokens[index + 1], count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
    const best = [...counts.values()]
      .filter((pair) => pair.count >= minFrequency)
      .sort((left, right) => right.count - left.count || lexicalCompare(left.left, right.left) || lexicalCompare(left.right, right.right))[0];
    if (!best) break;
    const merge = [best.left, best.right];
    merges.push(merge);
    tokens = applyMerge(tokens, merge);
  }
  return merges;
}

export function encodeBpe(text, merges) {
  if (typeof text !== "string") throw new Error("BPE encoding requires text.");
  if (!Array.isArray(merges)) throw new Error("BPE encoding requires trained merges.");
  return merges.reduce((tokens, merge) => applyMerge(tokens, merge), Array.from(text));
}

export const decodeBpe = (tokens) => {
  if (!Array.isArray(tokens)) throw new Error("BPE decoding requires an array of tokens.");
  return tokens.join("");
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sample = "attention attention context context context";
  const merges = trainBpe(sample, { maxMerges: 8 });
  const tokens = encodeBpe(sample, merges);
  console.log(`merges: ${JSON.stringify(merges)}`);
  console.log(`tokens: ${JSON.stringify(tokens)}`);
  console.log(`round trip: ${decodeBpe(tokens) === sample}`);
}
import { pathToFileURL } from "node:url";
