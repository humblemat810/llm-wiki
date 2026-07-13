import assert from "node:assert/strict";
import { DIFF_FORMAT, GRAPH_SCHEMA, diffGraphs, normalizeExtraction, normalizeGraph } from "../graph-core.js";

let state = 0x12345678;
const nextRandom = () => {
  state = Math.imul(state ^ (state >>> 13), 0x5bd1e995);
  state = Math.imul(state ^ (state >>> 15), 0x27d4eb2d);
  return (state >>> 0) / 0x100000000;
};
const atoms = [null, true, false, 0, 1, -1, "", "text", [], {}];
function randomValue(depth = 0) {
  if (depth > 3 || nextRandom() < .55) return atoms[Math.floor(nextRandom() * atoms.length)];
  if (nextRandom() < .5) return Array.from({ length: Math.floor(nextRandom() * 8) }, () => randomValue(depth + 1));
  const object = {};
  for (let index = 0; index < Math.floor(nextRandom() * 8); index += 1) object[String.fromCharCode(97 + index)] = randomValue(depth + 1);
  return object;
}

for (let index = 0; index < 5000; index += 1) {
  const value = randomValue();
  const graphInput = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  assert.doesNotThrow(() => normalizeGraph({ schema: GRAPH_SCHEMA, ...graphInput }), `graph normalization failed at case ${index}`);
  assert.doesNotThrow(() => normalizeExtraction(value), `extraction normalization failed at case ${index}`);
  assert.doesNotThrow(() => diffGraphs(graphInput, value), `graph diff failed at case ${index}`);
  assert.equal(diffGraphs(graphInput, value).format, DIFF_FORMAT, `graph diff contract failed at case ${index}`);
}
console.log("normalization fuzz smoke ok: 5000 deterministic malformed cases");
