import { fingerprintBackup, normalizeGraph } from "../graph-core.js";
import { requirePublicOrigin } from "./public-origin.mjs";

const escapeHtml = (value) => String(value)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const absoluteOrRelative = (origin, path) => origin ? `${origin}/${path}` : `./${path}`;

const truncateLabel = (value, limit = 28) => {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
};

const wrapNodeLabel = (value) => {
  const words = truncateLabel(value, 24).split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [words[0] || "Unnamed"];
  const lines = [];
  let current = "";
  for (const word of words) {
    if (current && `${current} ${word}`.length > 13) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
};

function buildGraphVisual(nodes, edges, nodeLabels) {
  const width = 920;
  const height = 360;
  const centerX = width / 2;
  const centerY = height / 2;
  const radiusX = Math.min(330, Math.max(150, 105 * Math.max(1, nodes.length - 1)));
  const radiusY = 105;
  const positions = new Map();
  nodes.forEach((node, index) => {
    const angle = nodes.length === 1
      ? -Math.PI / 2
      : -Math.PI / 2 + (index * Math.PI * 2) / nodes.length;
    positions.set(node.id, {
      x: Math.round(centerX + Math.cos(angle) * radiusX),
      y: Math.round(centerY + Math.sin(angle) * radiusY)
    });
  });
  const edgeMarkup = edges.map((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return "";
    const label = truncateLabel(edge.label, 22);
    const labelX = Math.round((source.x + target.x) / 2);
    const labelY = Math.round((source.y + target.y) / 2 - 10);
    return `
          <line class="sample-graph-edge" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" marker-end="url(#sample-arrow)" aria-hidden="true"></line>
          <text class="sample-graph-edge-label" x="${labelX}" y="${labelY}" text-anchor="middle">${escapeHtml(label)}</text>`;
  }).join("");
  const nodeMarkup = nodes.map((node) => {
    const position = positions.get(node.id);
    const labelLines = wrapNodeLabel(node.label);
    const confidence = Math.round(Number(node.confidence || 0) * 100);
    return `
          <g class="sample-graph-node" transform="translate(${position.x} ${position.y})" aria-label="${escapeHtml(node.label)} — ${confidence}% confidence">
            <circle r="42" aria-hidden="true"></circle>
            <text class="sample-graph-node-label" text-anchor="middle" y="${labelLines.length > 1 ? "-10" : "-2"}">${labelLines.map((line, index) => `<tspan x="0" dy="${index ? "15" : "0"}">${escapeHtml(line)}</tspan>`).join("")}</text>
            <text class="sample-graph-node-confidence" text-anchor="middle" y="${labelLines.length > 1 ? "27" : "14"}">${confidence}% confidence</text>
          </g>`;
  }).join("");
  const accessibleSummary = `${nodes.length} concepts connected by ${edges.length} evidence-backed relations: ${edges
    .map((edge) => `${nodeLabels.get(edge.source) || edge.source} ${edge.label} ${nodeLabels.get(edge.target) || edge.target}`)
    .join("; ")}.`;
  return `
      <figure class="sample-graph-visual">
        <div class="section-label"><span class="section-number">01</span><span>THE GRAPH AT A GLANCE</span></div>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Sample knowledge graph visualization" aria-describedby="sample-graph-visual-description">
          <desc id="sample-graph-visual-description">${escapeHtml(accessibleSummary)}</desc>
          <defs>
            <marker id="sample-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,4 L0,8 z"></path>
            </marker>
          </defs>
          ${edgeMarkup}
          ${nodeMarkup}
        </svg>
        <figcaption>Each node is a concept; each line is a claimed relation grounded in source evidence.</figcaption>
      </figure>`;
}

export function buildSampleGraphPage(graph, origin = "") {
  const safeOrigin = requirePublicOrigin(origin);
  const normalized = normalizeGraph(graph);
  const source = normalized.documents[0];
  const nodes = normalized.nodes.filter((node) => node.status !== "rejected");
  const edges = normalized.edges.filter((edge) => edge.status !== "rejected");
  const nodeLabels = new Map(normalized.nodes.map((node) => [node.id, node.label]));
  const graphFingerprint = fingerprintBackup(normalized);
  const stylesheet = safeOrigin ? `${safeOrigin}/styles.css` : "./styles.css";
  const home = safeOrigin ? `${safeOrigin}/` : "./";
  const workbench = safeOrigin ? `${safeOrigin}/#sample` : "./#sample";
  const graphJson = absoluteOrRelative(safeOrigin, "examples/sample-graph.json");
  const graphCanvas = absoluteOrRelative(safeOrigin, "examples/sample-graph.canvas");
  const graphNote = absoluteOrRelative(safeOrigin, "notes/knowledge-graphs.html");
  const graphVisual = buildGraphVisual(nodes, edges, nodeLabels);
  const conceptCards = nodes.map((node) => `
        <article class="sample-graph-card">
          <span class="sample-graph-kicker">${escapeHtml(node.type)} · ${Math.round(node.confidence * 100)}% confidence</span>
          <h3>${escapeHtml(node.label)}</h3>
          <p>${escapeHtml(node.evidence[0]?.text || "No evidence excerpt recorded.")}</p>
          <small>${node.mentions} mention${node.mentions === 1 ? "" : "s"} · ${node.status} · ${node.sources.length} source</small>
        </article>`).join("");
  const relationRows = edges.map((edge) => `
        <li><strong>${escapeHtml(nodeLabels.get(edge.source) || edge.source)}</strong> <em>${escapeHtml(edge.label)}</em> <strong>${escapeHtml(nodeLabels.get(edge.target) || edge.target)}</strong><small>${escapeHtml(edge.evidence[0]?.text || "No evidence excerpt recorded.")}</small></li>`).join("");
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Sample knowledge graph · LLM Field Notes",
    description: "A small evidence-backed example of the internal representation produced from a document.",
    url: safeOrigin ? `${safeOrigin}/sample-graph.html` : "./sample-graph.html",
    image: safeOrigin ? `${safeOrigin}/social-card.png` : "./social-card.png",
    keywords: ["knowledge graph", "document extraction", "human feedback", "Obsidian"],
    about: {
      "@type": "Thing",
      name: "Inspectable document-to-knowledge-graph representation",
      identifier: graphFingerprint
    },
    isPartOf: { "@type": "WebSite", name: "LLM Field Notes", url: home }
  }).replace(/[<>&]/g, (character) => `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; worker-src 'none'; manifest-src 'none'" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <meta name="robots" content="index,follow" />
    <meta name="description" content="A small evidence-backed example of the internal representation produced from a document." />
    <meta property="og:title" content="Sample knowledge graph · LLM Field Notes" />
    <meta property="og:description" content="See a document become concepts, relations, evidence, and a fingerprinted internal representation." />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="LLM Field Notes" />
    <meta property="og:url" content="${escapeHtml(safeOrigin ? `${safeOrigin}/sample-graph.html` : "./sample-graph.html")}" />
    <meta property="og:image" content="${escapeHtml(safeOrigin ? `${safeOrigin}/social-card.png` : "./social-card.png")}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="LLM Field Notes: documents into a living map" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Sample knowledge graph · LLM Field Notes" />
    <meta name="twitter:description" content="See a document become concepts, relations, evidence, and a fingerprinted internal representation." />
    <meta name="twitter:image" content="${escapeHtml(safeOrigin ? `${safeOrigin}/social-card.png` : "./social-card.png")}" />
    <link rel="canonical" href="${escapeHtml(safeOrigin ? `${safeOrigin}/sample-graph.html` : "./sample-graph.html")}" />
    <link rel="stylesheet" href="${escapeHtml(stylesheet)}" />
    <script type="application/ld+json">${structuredData}</script>
    <title>Sample knowledge graph · LLM Field Notes</title>
  </head>
  <body class="sample-graph-page">
    <main class="section-shell sample-graph-shell">
      <header class="sample-graph-header">
        <a class="brand" href="${escapeHtml(home)}" aria-label="LLM Field Notes home"><span class="brand-mark">⌁</span><span><strong>LLM FIELD NOTES</strong><small>an open learning map</small></span></a>
        <a class="text-link" href="${escapeHtml(workbench)}">Open the workbench ↗</a>
      </header>
      <p class="eyebrow"><span class="pulse"></span> PUBLIC SAMPLE / INTERNAL REPRESENTATION</p>
      <h1>A document,<br /><em>made inspectable.</em></h1>
      <p class="sample-graph-lede">This is the small graph behind the “try a sample” walkthrough: concepts and relations are hypotheses, evidence keeps them honest, and a fingerprint makes the projection verifiable.</p>
      <div class="sample-graph-actions"><a class="button button-primary" href="${escapeHtml(workbench)}">Try it in the wiki <span>↗</span></a><a class="button button-quiet" href="${escapeHtml(graphJson)}">Download graph JSON <span>↓</span></a><a class="button button-quiet" href="${escapeHtml(graphCanvas)}">Open in Obsidian <span>↓</span></a><a class="button button-quiet" href="${escapeHtml(graphNote)}">Read the graph note <span>→</span></a></div>
      <section class="sample-graph-stats" aria-label="Sample graph summary">
        <div><strong>${nodes.length}</strong><span>concepts</span></div>
        <div><strong>${edges.length}</strong><span>relations</span></div>
        <div><strong>${normalized.documents.length}</strong><span>source document</span></div>
        <div><strong>${escapeHtml(graphFingerprint)}</strong><span>graph fingerprint</span></div>
      </section>
      <section class="sample-graph-source">
        <span class="sample-graph-kicker">SOURCE DOCUMENT</span>
        <h2>${escapeHtml(source?.title || "Sample document")}</h2>
        <p>${escapeHtml(source?.text || "No source text recorded.")}</p>
      </section>
      ${graphVisual}
      <section>
        <div class="section-label"><span class="section-number">02</span><span>CONCEPTS WITH EVIDENCE</span></div>
        <div class="sample-graph-grid">${conceptCards}</div>
      </section>
      <section class="sample-graph-relations">
        <div class="section-label"><span class="section-number">03</span><span>RELATIONS WITH GROUNDS</span></div>
        <ul>${relationRows}</ul>
      </section>
      <section class="sample-graph-next">
        <h2>Now change the representation.</h2>
        <p>Open the workbench, accept or reject a candidate, download the Obsidian vault, open its native <code>Graph.canvas</code> view, and bring corrections back as reusable guidance.</p>
        <a class="button button-light" href="${escapeHtml(workbench)}">Inspect, review, project <span>↗</span></a>
      </section>
      <footer><a href="${escapeHtml(home)}">← Back to LLM Field Notes</a><span>public sample · source and evidence are intentionally non-private</span></footer>
    </main>
  </body>
</html>
`;
}
