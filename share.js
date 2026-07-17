import { buildShareGraph, decodeSharePayload, encodeSharePayload } from "./share-projection.js";

const text = (element, value) => { element.textContent = String(value ?? ""); };
const svgNamespace = "http://www.w3.org/2000/svg";
const createSvgElement = (tag) => document.createElementNS(svgNamespace, tag);
const visualNodeLimit = 80;
const visualEdgeLimit = 160;
const visualLabel = (value, limit = 28) => {
  const normalized = String(value ?? "");
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
};
const listItem = (label, detail) => {
  const item = document.createElement("li");
  const strong = document.createElement("strong");
  text(strong, label);
  item.append(strong);
  const span = document.createElement("span");
  text(span, detail);
  item.append(span);
  return item;
};
const relationItem = (source, relation, target, detail) => {
  const item = document.createElement("li");
  const sourceLabel = document.createElement("strong");
  const relationLabel = document.createElement("em");
  const targetLabel = document.createElement("strong");
  text(sourceLabel, source);
  text(relationLabel, ` ${relation} `);
  text(targetLabel, target);
  const detailLabel = document.createElement("span");
  text(detailLabel, detail);
  item.append(sourceLabel, relationLabel, targetLabel, detailLabel);
  return item;
};
const renderGraphMap = (payload) => {
  const svg = document.querySelector("#graph-map");
  const nodes = payload.nodes.slice(0, visualNodeLimit);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = payload.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .slice(0, visualEdgeLimit);
  const positions = new Map();
  const columns = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(nodes.length))));
  const rows = Math.max(1, Math.ceil(nodes.length / columns));
  const horizontalStep = 900 / Math.max(1, columns - 1);
  const verticalStep = 460 / Math.max(1, rows - 1);
  nodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    positions.set(node.id, {
      x: columns === 1 ? 480 : 30 + column * horizontalStep,
      y: rows === 1 ? 280 : 50 + row * verticalStep
    });
  });
  const defs = createSvgElement("defs");
  const marker = createSvgElement("marker");
  marker.setAttribute("id", "graph-map-arrow");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "6");
  marker.setAttribute("markerHeight", "6");
  marker.setAttribute("orient", "auto-start-reverse");
  const markerPath = createSvgElement("path");
  markerPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  markerPath.setAttribute("fill", "#8a8178");
  marker.append(markerPath);
  defs.append(marker);
  svg.replaceChildren(defs);
  edges.forEach((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return;
    const line = createSvgElement("line");
    line.setAttribute("x1", source.x);
    line.setAttribute("y1", source.y);
    line.setAttribute("x2", target.x);
    line.setAttribute("y2", target.y);
    line.setAttribute("marker-end", "url(#graph-map-arrow)");
    svg.append(line);
    const relation = createSvgElement("text");
    relation.classList.add("graph-map-edge-label");
    relation.setAttribute("x", (source.x + target.x) / 2);
    relation.setAttribute("y", (source.y + target.y) / 2 - 5);
    relation.setAttribute("text-anchor", "middle");
    relation.textContent = visualLabel(edge.label, 22);
    svg.append(relation);
  });
  nodes.forEach((node) => {
    const position = positions.get(node.id);
    const group = createSvgElement("g");
    const circle = createSvgElement("circle");
    circle.setAttribute("cx", position.x);
    circle.setAttribute("cy", position.y);
    circle.setAttribute("r", "22");
    group.append(circle);
    const label = createSvgElement("text");
    label.setAttribute("x", position.x);
    label.setAttribute("y", position.y + 42);
    label.setAttribute("text-anchor", "middle");
    label.textContent = visualLabel(node.label);
    group.append(label);
    const confidenceLabel = createSvgElement("text");
    confidenceLabel.classList.add("graph-map-confidence");
    confidenceLabel.setAttribute("x", position.x);
    confidenceLabel.setAttribute("y", position.y + 4);
    confidenceLabel.setAttribute("text-anchor", "middle");
    confidenceLabel.textContent = `${Math.round(node.confidence * 100)}%`;
    group.append(confidenceLabel);
    svg.append(group);
  });
  const omittedNodes = payload.nodes.length - nodes.length;
  const payloadNodeIds = new Set(payload.nodes.map((node) => node.id));
  const omittedEdges = payload.edges.filter((edge) => payloadNodeIds.has(edge.source) && payloadNodeIds.has(edge.target)).length - edges.length;
  const limit = document.querySelector("#map-limit");
  if (omittedNodes > 0 || omittedEdges > 0) {
    limit.hidden = false;
    text(limit, `Visual map capped at ${visualNodeLimit} concepts and ${visualEdgeLimit} relations; complete lists remain below.`);
  }
};
const downloadSharePayload = (payload) => {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const blob = new Blob([content], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = "shared-knowledge-graph-redacted.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  text(document.querySelector("#share-action-status"), "Redacted JSON downloaded.");
};
const buildSafeShareUrl = () => {
  const url = new URL(location.href);
  url.username = "";
  url.password = "";
  url.search = "";
  return url.toString();
};
const copyTextValue = async (value) => {
  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Permission-denied Clipboard APIs should still receive the bounded
      // textarea fallback below.
    }
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  try {
    input.select();
    if (typeof document.execCommand !== "function" || !document.execCommand("copy")) {
      throw new Error("clipboard unavailable");
    }
  } finally {
    input.remove();
  }
};
const copyShareLink = async () => {
  try {
    await copyTextValue(buildSafeShareUrl());
    text(document.querySelector("#share-action-status"), "Share link copied.");
  } catch {
    text(document.querySelector("#share-action-status"), "The share link could not be copied; copy it from the address bar.");
  }
};
const copyCorrectionContext = async () => {
  try {
    const shareUrl = buildSafeShareUrl();
    await copyTextValue([
      "LLM Field Notes graph correction",
      "",
      `Share link: ${shareUrl}`,
      "",
      "Privacy-safe context: this shared graph contains labels and structure only.",
      "Do not add private source text, confidential evidence, credentials, or personal data.",
      "",
      "Correction type:",
      "Concept or relation:",
      "Proposed change:",
      "Public evidence or reproducible observation:"
    ].join("\n"));
    text(document.querySelector("#share-action-status"), "Correction context copied; add public evidence before submitting.");
  } catch {
    text(document.querySelector("#share-action-status"), "Correction context could not be copied; use the share link and correction form.");
  }
};
const configureWorkbenchFork = (payload) => {
  const fork = document.querySelector("#fork-share");
  if (!fork) return;
  const workbench = new URL("./", location.href);
  workbench.username = "";
  workbench.password = "";
  workbench.search = "";
  fork.href = `${workbench.toString()}#shared=${encodeSharePayload(payload)}`;
  fork.hidden = false;
};

try {
  const match = String(location.hash).match(/^#graph=([^&]+)$/u);
  if (!match) throw new Error("missing graph");
  const payload = decodeSharePayload(decodeURIComponent(match[1]));
  document.querySelector("#download-share").addEventListener("click", () => downloadSharePayload(payload));
  document.querySelector("#copy-share-link").addEventListener("click", copyShareLink);
  document.querySelector("#copy-correction-context").addEventListener("click", copyCorrectionContext);
  configureWorkbenchFork(payload);
  text(document.querySelector("#title"), payload.title);
  const stats = document.querySelector("#stats");
  for (const [label, value] of [
    ["Concepts", payload.nodes.length],
    ["Relations", payload.edges.length],
    ["Source docs", payload.documents],
    ["Reviewed", payload.reviewed]
  ]) {
    const card = document.createElement("div");
    card.className = "stat";
    const strong = document.createElement("strong");
    text(strong, value);
    const span = document.createElement("span");
    text(span, label);
    card.append(strong, span);
    stats.append(card);
  }
  renderGraphMap(payload);
  const labels = new Map(payload.nodes.map((node) => [node.id, node.label]));
  const nodes = document.querySelector("#nodes");
  payload.nodes.forEach((node) => nodes.append(listItem(node.label, `${node.type || "concept"} · ${Math.round(node.confidence * 100)}% confidence`)));
  const edges = document.querySelector("#edges");
  payload.edges.forEach((edge) => edges.append(relationItem(
    labels.get(edge.source) || "Unknown",
    edge.label,
    labels.get(edge.target) || "Unknown",
    `${edge.status || "active"} · ${Math.round(edge.confidence * 100)}% confidence`
  )));
} catch {
  document.querySelector("#error").hidden = false;
  document.querySelector("#stats").hidden = true;
  document.querySelector("#graph-map").closest("section").hidden = true;
  document.querySelector("#nodes").closest("section").hidden = true;
  document.querySelector("#edges").closest("section").hidden = true;
  document.querySelector("#download-share").disabled = true;
  document.querySelector("#copy-share-link").disabled = true;
  document.querySelector("#copy-correction-context").disabled = true;
}
