import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  MAX_CONCEPT_LABEL_CHARS,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  MAX_ID_CHARS,
  MAX_RELATION_LABEL_CHARS,
  parseJsonWithUniqueKeys
} from "../graph-core.js";

export const MAX_CANVAS_NODES = MAX_GRAPH_NODES + 1;
export const MAX_CANVAS_EDGES = MAX_GRAPH_EDGES;
export const MAX_CANVAS_TEXT_CHARS = 20000;
export const MAX_CANVAS_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_CANVAS_FILE_CHARS = 512;
export const MAX_CANVAS_COORDINATE = 1_000_000_000;
export const MAX_CANVAS_DIMENSION = 1_000_000;
const SIDES = new Set(["top", "right", "bottom", "left"]);
const ownKeys = (value) => Object.keys(value);

function fail(label, message) {
  throw new Error(`${label}: ${message}`);
}

function boundedString(value, max, label, { empty = false } = {}) {
  if (typeof value !== "string" || (!empty && value.length === 0) || value.length > max) {
    fail(label, `expected a ${empty ? "" : "non-empty "}string of at most ${max} characters`);
  }
}

function finiteNumber(value, label, maximum, { positive = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)
    || (positive ? value <= 0 : value < -maximum || value > maximum)) {
    fail(label, `expected a finite ${positive ? "positive " : ""}number within the Canvas bounds`);
  }
}

function checkKeys(value, allowed, label) {
  const unknown = ownKeys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail(label, `unknown field(s): ${unknown.join(", ")}`);
}

function verifyNode(node, index) {
  const label = `Canvas node ${index}`;
  if (!node || typeof node !== "object" || Array.isArray(node)) fail(label, "must be an object");
  checkKeys(node, new Set(["id", "type", "file", "text", "x", "y", "width", "height", "color"]), label);
  boundedString(node.id, MAX_ID_CHARS, `${label}.id`);
  if (!["file", "text"].includes(node.type)) fail(`${label}.type`, "must be file or text");
  finiteNumber(node.x, `${label}.x`, MAX_CANVAS_COORDINATE);
  finiteNumber(node.y, `${label}.y`, MAX_CANVAS_COORDINATE);
  finiteNumber(node.width, `${label}.width`, MAX_CANVAS_DIMENSION, { positive: true });
  finiteNumber(node.height, `${label}.height`, MAX_CANVAS_DIMENSION, { positive: true });
  if (node.color !== undefined) boundedString(node.color, 16, `${label}.color`);
  if (node.type === "file") {
    boundedString(node.file, MAX_CANVAS_FILE_CHARS, `${label}.file`);
    if (node.text !== undefined) fail(label, "file nodes must not carry text");
  } else {
    if (node.file !== undefined) fail(label, "text nodes must not carry file");
    boundedString(node.text, MAX_CANVAS_TEXT_CHARS, `${label}.text`, { empty: true });
  }
}

function verifyEdge(edge, index, nodeIds) {
  const label = `Canvas edge ${index}`;
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) fail(label, "must be an object");
  checkKeys(edge, new Set(["id", "fromNode", "toNode", "fromSide", "toSide", "label"]), label);
  boundedString(edge.id, MAX_ID_CHARS, `${label}.id`);
  boundedString(edge.fromNode, MAX_ID_CHARS, `${label}.fromNode`);
  boundedString(edge.toNode, MAX_ID_CHARS, `${label}.toNode`);
  boundedString(edge.label, MAX_RELATION_LABEL_CHARS, `${label}.label`, { empty: true });
  if (!nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) fail(label, "endpoint does not resolve to a Canvas node");
  if (edge.fromSide !== undefined && !SIDES.has(edge.fromSide)) fail(`${label}.fromSide`, "is not a valid Canvas side");
  if (edge.toSide !== undefined && !SIDES.has(edge.toSide)) fail(`${label}.toSide`, "is not a valid Canvas side");
}

export function verifyCanvasProjection(value, label = "Canvas projection") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label, "must be an object");
  checkKeys(value, new Set(["nodes", "edges"]), label);
  if (!Array.isArray(value.nodes) || value.nodes.length > MAX_CANVAS_NODES) {
    fail(`${label}.nodes`, `must contain at most ${MAX_CANVAS_NODES} nodes`);
  }
  if (!Array.isArray(value.edges) || value.edges.length > MAX_CANVAS_EDGES) {
    fail(`${label}.edges`, `must contain at most ${MAX_CANVAS_EDGES} edges`);
  }
  const nodeIds = new Set();
  value.nodes.forEach((node, index) => {
    verifyNode(node, index);
    if (nodeIds.has(node.id)) fail(`Canvas node ${index}.id`, `duplicates ${node.id}`);
    nodeIds.add(node.id);
  });
  const edgeIds = new Set();
  value.edges.forEach((edge, index) => {
    verifyEdge(edge, index, nodeIds);
    if (edgeIds.has(edge.id)) fail(`Canvas edge ${index}.id`, `duplicates ${edge.id}`);
    edgeIds.add(edge.id);
  });
  return { nodes: value.nodes.length, edges: value.edges.length };
}

export async function verifyCanvasFile(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_CANVAS_FILE_BYTES) {
    throw new Error(`${path}: Canvas file must be a regular file no larger than ${MAX_CANVAS_FILE_BYTES} bytes`);
  }
  const source = await readFile(path, "utf8");
  return verifyCanvasProjection(parseJsonWithUniqueKeys(source, path), path);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: node scripts/verify-canvas.mjs <file>");
  const counts = await verifyCanvasFile(path);
  console.log(`Canvas verified: ${counts.nodes} nodes, ${counts.edges} edges`);
}
