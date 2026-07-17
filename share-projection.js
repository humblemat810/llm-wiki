import { parseJsonWithUniqueKeys } from "./graph-core.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export const MAX_SHARE_PAYLOAD_BYTES = 48 * 1024;
export const SHARE_FORMAT = "llm-field-notes/share@1";
export const SHARE_IMPORT_FORMAT = "llm-field-notes/share-import@1";
export const MAX_SHARE_NODES = 1200;
export const MAX_SHARE_EDGES = 2400;
export const MAX_SHARE_DOCUMENTS = 1000;

const boundedText = (value, limit = 160) => String(value ?? "").slice(0, limit);
const confidence = (value) => Number.isFinite(Number(value))
  ? Math.max(0, Math.min(1, Number(value)))
  : 0;
const SHARE_NODE_KEYS = new Set(["id", "label", "type", "status", "confidence"]);
const SHARE_EDGE_KEYS = new Set(["source", "target", "label", "status", "confidence"]);
const SHARE_KEYS = new Set(["format", "title", "nodes", "edges", "documents", "reviewed"]);
const SHARE_STATUSES = new Set(["inferred", "accepted", "rejected"]);
const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));
const validText = (value, limit) => typeof value === "string" && value.length > 0 && value.length <= limit;
const validConfidence = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export function validateSharePayload(payload) {
  if (!isPlainObject(payload) || !hasOnlyKeys(payload, SHARE_KEYS)
    || payload.format !== SHARE_FORMAT
    || !validText(payload.title, 160)
    || !Array.isArray(payload.nodes)
    || !Array.isArray(payload.edges)
    || !Number.isSafeInteger(payload.documents) || payload.documents < 0 || payload.documents > MAX_SHARE_DOCUMENTS
    || !Number.isSafeInteger(payload.reviewed) || payload.reviewed < 0
    || payload.reviewed > MAX_SHARE_NODES + MAX_SHARE_EDGES) {
    throw new Error("The share link payload is not a supported graph.");
  }
  if (payload.nodes.length > MAX_SHARE_NODES || payload.edges.length > MAX_SHARE_EDGES) {
    throw new Error("The share link graph exceeds the display limit.");
  }
  const nodeIds = new Set();
  payload.nodes.forEach((node) => {
    if (!isPlainObject(node)
      || !hasOnlyKeys(node, SHARE_NODE_KEYS)
      || !validText(node.id, 80) || !node.id
      || nodeIds.has(node.id)
      || !validText(node.label, 160)
      || !validText(node.type, 80)
      || !SHARE_STATUSES.has(node.status)
      || !validConfidence(node.confidence)) {
      throw new Error("The share link contains an invalid concept.");
    }
    nodeIds.add(node.id);
  });
  payload.edges.forEach((edge) => {
    if (!isPlainObject(edge)
      || !hasOnlyKeys(edge, SHARE_EDGE_KEYS)
      || !validText(edge.source, 80) || !nodeIds.has(edge.source)
      || !validText(edge.target, 80) || !nodeIds.has(edge.target)
      || !validText(edge.label, 120)
      || !SHARE_STATUSES.has(edge.status)
      || !validConfidence(edge.confidence)) {
      throw new Error("The share link contains an invalid relation.");
    }
  });
  return payload;
}

export function buildSharePayload(graph) {
  const nodes = (Array.isArray(graph?.nodes) ? graph.nodes : [])
    .filter((node) => node?.status !== "rejected")
    .map((node, index) => ({
      id: `n${index}`,
      label: boundedText(node.label),
      type: boundedText(node.type, 80),
      status: boundedText(node.status, 32),
      confidence: confidence(node.confidence)
    }));
  const nodeIds = new Map(nodes.map((node, index) => [
    (Array.isArray(graph?.nodes) ? graph.nodes : []).filter((node) => node?.status !== "rejected")[index]?.id,
    node.id
  ]));
  const edges = (Array.isArray(graph?.edges) ? graph.edges : [])
    .filter((edge) => edge?.status !== "rejected" && nodeIds.has(edge?.source) && nodeIds.has(edge?.target))
    .map((edge) => ({
      source: nodeIds.get(edge.source),
      target: nodeIds.get(edge.target),
      label: boundedText(edge.label, 120),
      status: boundedText(edge.status, 32),
      confidence: confidence(edge.confidence)
    }));
  const reviewed = [...nodes, ...edges].filter((item) => item.status === "accepted" || item.status === "reviewed").length;
  return {
    format: SHARE_FORMAT,
    title: "Redacted knowledge graph",
    nodes,
    edges,
    documents: Array.isArray(graph?.documents) ? graph.documents.length : 0,
    reviewed
  };
}

export function buildShareGraph(payload) {
  validateSharePayload(payload);
  const nodes = payload.nodes.map((node, index) => ({
    id: `shared-${index}`,
    label: boundedText(node?.label),
    type: boundedText(node?.type, 80) || "concept",
    status: ["inferred", "accepted", "rejected"].includes(node?.status) ? node.status : "inferred",
    confidence: confidence(node?.confidence),
    mentions: 1,
    feedback: 0,
    sources: [],
    evidence: []
  }));
  const nodeIds = new Map(payload.nodes.map((node, index) => [node?.id, nodes[index].id]));
  const edges = payload.edges
    .filter((edge) => nodeIds.has(edge?.source) && nodeIds.has(edge?.target))
    .map((edge, index) => ({
      id: `shared-edge-${index}`,
      source: nodeIds.get(edge.source),
      target: nodeIds.get(edge.target),
      label: boundedText(edge?.label, 120) || "related to",
      status: ["inferred", "accepted", "rejected"].includes(edge?.status) ? edge.status : "inferred",
      confidence: confidence(edge?.confidence),
      feedback: 0,
      sources: [],
      evidence: []
    }));
  return {
    schema: "llm-field-notes/graph@1",
    version: 0,
    updatedAt: null,
    redacted: true,
    documents: [],
    nodes,
    edges,
    revisions: [],
    learning: { examples: [] },
    integrity: { ambiguousSourceIds: [], ambiguousEdgeIds: [] },
    shareImport: SHARE_IMPORT_FORMAT
  };
}

const toBase64Url = (bytes) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const fromBase64Url = (value) => {
  const normalized = String(value).replaceAll("-", "+").replaceAll("_", "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized) || normalized.length % 4 === 1) {
    throw new Error("The share link payload is invalid.");
  }
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export function encodeSharePayload(payload) {
  const value = JSON.stringify(payload);
  const bytes = textEncoder.encode(value);
  if (bytes.byteLength > MAX_SHARE_PAYLOAD_BYTES) {
    throw new Error("This graph is too large for a share link; use the redacted HTML export instead.");
  }
  return toBase64Url(bytes);
}

export function decodeSharePayload(encoded) {
  const bytes = fromBase64Url(encoded);
  if (bytes.byteLength > MAX_SHARE_PAYLOAD_BYTES) throw new Error("The share link payload exceeds the safety limit.");
  return validateSharePayload(parseJsonWithUniqueKeys(textDecoder.decode(bytes), "Share link payload"));
}

export function buildShareUrl(locationLike, graph) {
  const url = new URL(locationLike.href || locationLike);
  url.pathname = `${url.pathname.replace(/\/[^/]*$/u, "/")}share.html`;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = `graph=${encodeSharePayload(buildSharePayload(graph))}`;
  return url.toString();
}
