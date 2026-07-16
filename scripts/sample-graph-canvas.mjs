import { fingerprintBackup, normalizeGraph } from "../graph-core.js";

const compare = (left, right) => {
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
};

const boundedText = (value, limit = 280) => String(value || "").trim().slice(0, limit);

export function buildSampleGraphCanvas(graph) {
  const normalized = normalizeGraph(graph);
  const nodes = normalized.nodes
    .filter((node) => node.status !== "rejected")
    .sort((left, right) => compare(left.id, right.id));
  const nodeIds = new Map(nodes.map((node, index) => [node.id, `sample-concept-${index}`]));
  const canvasNodes = [{
    id: "projection-provenance",
    type: "text",
    text: `# LLM Field Notes\n\nStandalone knowledge-graph projection\n\nGraph fingerprint: ${fingerprintBackup(normalized)}`,
    x: 0,
    y: -260,
    width: 660,
    height: 150,
    color: "6"
  }, ...nodes.map((node, index) => ({
    id: nodeIds.get(node.id),
    type: "text",
    text: `# ${boundedText(node.label, 120)}\n\n${Math.round(Number(node.confidence || 0) * 100)}% confidence · ${node.status}\n\n${boundedText(node.evidence?.[0]?.text || "No evidence excerpt recorded.")}`,
    x: (index % 3) * 360,
    y: Math.floor(index / 3) * 260,
    width: 300,
    height: 200,
    color: "5"
  }))];
  const canvasEdges = normalized.edges
    .filter((edge) => edge.status !== "rejected" && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .sort((left, right) => compare(`${left.id}\u0000${left.source}\u0000${left.target}`, `${right.id}\u0000${right.source}\u0000${right.target}`))
    .map((edge, index) => ({
      id: `sample-relation-${index}`,
      fromNode: nodeIds.get(edge.source),
      toNode: nodeIds.get(edge.target),
      fromSide: "right",
      toSide: "left",
      label: boundedText(edge.label, 120)
    }));
  return `${JSON.stringify({ nodes: canvasNodes, edges: canvasEdges }, null, 2)}\n`;
}
