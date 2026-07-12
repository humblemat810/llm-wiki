import {
  GRAPH_SCHEMA,
  LEGACY_GRAPH_SCHEMAS,
  MAX_DOCUMENT_CHARS,
  sampleDocument,
  defaultGraph,
  makeId,
  normalizeGraph,
  extractGraph,
  mergeExtraction,
  applyFeedback,
  removeSource,
  inspectGraph,
  slugify,
  asArray
} from "./graph-core.js";
import { createGraphStore } from "./graph-store.js";
import { applyObsidianFeedback, parseObsidianFeedback, parseObsidianVault } from "./projection-adapter.js";

const notes = [
  { id: "tokens", category: "foundations", number: "01", tag: "FOUNDATIONS", title: "Tokens are the interface", description: "What a model actually sees, why text becomes integers, and where the seams show.", meta: "12 min read", question: "Why can't the model see words?" },
  { id: "embeddings", category: "foundations", number: "02", tag: "FOUNDATIONS", title: "Meaning in a vector", description: "A geometric intuition for embeddings, similarity, and the strange power of coordinates.", meta: "18 min read", question: "How does a model store meaning?" },
  { id: "attention", category: "foundations", number: "03", tag: "FOUNDATIONS", title: "Attention is a lookup", description: "Build the core operation by hand. Queries, keys, values—and why context has a cost.", meta: "24 min read", question: "How does context enter the computation?" },
  { id: "training", category: "foundations", number: "04", tag: "FOUNDATIONS", title: "Loss is a compass", description: "The training loop as a measurement instrument, not a ritual. Follow the gradient.", meta: "21 min read", question: "What does 'learning' mean here?" },
  { id: "transformers", category: "systems", number: "05", tag: "SYSTEMS", title: "The transformer stack", description: "The smallest complete map of the architecture: blocks, residuals, norms, and logits.", meta: "31 min read", question: "What is the machine made of?" },
  { id: "scaling", category: "systems", number: "06", tag: "SYSTEMS", title: "Scale changes the game", description: "Parameters, data, compute, and the empirical laws that make bigger surprisingly useful.", meta: "16 min read", question: "Why does scale work?" },
  { id: "inference", category: "systems", number: "07", tag: "SYSTEMS", title: "One token at a time", description: "Sampling, temperature, KV caches, and the time-sensitive path from prompt to response.", meta: "19 min read", question: "What happens at inference?" },
  { id: "evaluation", category: "systems", number: "08", tag: "SYSTEMS", title: "Measure the thing", description: "A practical evaluation loop for when benchmark scores are not enough—or even relevant.", meta: "22 min read", question: "How do I know if it works?" },
  { id: "rag", category: "shipping", number: "09", tag: "SHIPPING", title: "Give it a library", description: "Retrieval augmented generation without the hand-waving: chunk, search, cite, inspect.", meta: "27 min read", question: "How can a model use my data?" },
  { id: "finetuning", category: "shipping", number: "10", tag: "SHIPPING", title: "Teach, don't just prompt", description: "When to use fine-tuning, what the dataset is really doing, and how to avoid cargo culting.", meta: "25 min read", question: "When should I change the weights?" },
  { id: "agents", category: "shipping", number: "11", tag: "SHIPPING", title: "Tools make a system", description: "The useful unit is often a model surrounded by tools, state, checks, and a clear stop condition.", meta: "23 min read", question: "How does a model take action?" },
  { id: "production", category: "shipping", number: "12", tag: "SHIPPING", title: "Ship the boring parts", description: "Latency, cost, observability, fallbacks, and the path from demo to something people trust.", meta: "29 min read", question: "What survives contact with users?" }
];

const path = [
  ["01–03", "Build a tokenizer", "Make the text-to-integer boundary visible."],
  ["04–07", "Make attention click", "Implement the operation and visualize its weights."],
  ["08–14", "Train a tiny model", "Watch a small transformer overfit a tiny dataset."],
  ["15–21", "Break your model", "Probe memorization, context limits, and bad data."],
  ["22–26", "Add a retrieval loop", "Give the model a library and make it cite its sources."],
  ["27–30", "Ship a useful edge", "Put one narrow capability in front of a real person."]
];

const noteDetails = {
  tokens: ["A language model never receives words. It receives a sequence of token IDs produced by a tokenizer. That boundary explains spelling weirdness, context limits, cost, and why changing one character can change the whole computation.", "Write a byte-pair tokenizer for a small text file. Print token IDs, decoded text, and compression ratio for five surprising strings.", "Compare how your tokenizer splits a name, an emoji, code, and a sentence in another language."],
  embeddings: ["An embedding is a learned coordinate system. Similar uses tend to land near one another, but the dimensions are not a hand-labeled dictionary—they are shaped by the task and the data.", "Load a small embedding model and plot 30 words with PCA. Label clusters, then inspect the nearest neighbors of an ambiguous word.", "Find one useful neighborhood and one misleading one. Ask what the corpus taught the geometry."],
  attention: ["Attention lets every position make a weighted lookup over other positions. Queries ask what is needed, keys advertise what is available, and values carry the information back.", "Implement scaled dot-product attention in a few lines of array code. Print the attention matrix for a sentence and explain one row.", "Mask future positions and watch the matrix become causal—the small detail that turns a lookup into language modeling."],
  training: ["Loss compresses a prediction error into a signal that can move parameters. It is useful because it is differentiable, not because it perfectly captures usefulness.", "Fit a one-parameter model to a tiny dataset. Plot the loss and parameter value after every update, then intentionally make the learning rate too large.", "Keep the loss falling while making the output worse. That tension is the beginning of evaluation."],
  transformers: ["A transformer repeats a simple block: mix information across positions with attention, transform each position with an MLP, and preserve a clean path with residual connections.", "Implement a character-level transformer with one block. Keep it small enough to read every tensor shape in a debugger.", "Remove one component at a time. Record which failure is graceful, catastrophic, or merely slower."],
  scaling: ["More parameters alone are not a strategy. Useful scaling balances model capacity, data, and compute so the model keeps finding structure rather than memorizing noise.", "Train three tiny models under a fixed compute budget. Log parameter count, tokens seen, wall time, and validation loss.", "Use the measurements to predict which model should win before checking the result."],
  inference: ["Generation is a loop: run the model, turn logits into a distribution, choose one token, append it, and repeat. The cache keeps old key/value computations from being repeated.", "Write a sampler with greedy, temperature, and top-k modes. Time it with and without a simple key/value cache.", "Generate the same prompt at three temperatures and describe the change without using the word “creative.”"],
  evaluation: ["Evaluation is a decision instrument. Define the user task, create representative examples, record acceptable failures, and measure changes with a repeatable harness.", "Create a 30-example eval set for one narrow task. Include adversarial and ambiguous cases, a rubric, and a baseline.", "Have two people score the same outputs. Investigate disagreement before adding more examples."],
  rag: ["Retrieval gives a model relevant context at request time instead of asking its weights to contain every fact. The quality bottleneck is often search and chunking, not the final prompt.", "Index ten documents with simple lexical search. Return the top three chunks with source labels before asking the model to answer.", "Create questions whose answer spans two chunks. See whether your retriever brings both pieces together."],
  finetuning: ["Fine-tuning changes behavior through examples. It fits repeatable format, style, or task behavior—not a magic database update.", "Write 50 high-quality input/output examples for one narrow behavior. Hold out a test set and compare prompt-only versus tuned behavior.", "Remove the weakest quarter of your examples. If performance improves, your dataset was teaching noise."],
  agents: ["An agent is a control loop around a model: decide, call a tool, observe, and decide again. Reliability comes from constrained actions and explicit checks, not a grander persona.", "Give a model exactly two tools and a maximum of five steps. Log every decision, tool input, output, and stop reason.", "Add a dry-run mode. A safe system should be inspectable before it is powerful."],
  production: ["A production system is a set of promises: response time, cost, availability, data handling, and behavior when the model is wrong or unavailable.", "Make a request log with latency, token counts, model version, outcome, and a redacted trace. Add one fallback and one human escape hatch.", "Ask a real person to use the system without your narration. Every question they ask is a missing product surface."]
};

const notesGrid = document.querySelector("#notes-grid");
const emptyState = document.querySelector("#empty-state");
const searchInput = document.querySelector("#search");
const filters = document.querySelectorAll(".filter");
const progressKey = "llm-field-notes-progress";
const readStoredList = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};
const writeStoredList = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};
const getProgress = () => readStoredList(progressKey);
const dialog = document.querySelector("#note-dialog");

function renderNotes() {
  const query = searchInput.value.toLowerCase().trim();
  const activeFilter = document.querySelector(".filter.active").dataset.filter;
  const done = getProgress();
  const visible = notes.filter((note) => {
    const inCategory = activeFilter === "all" || note.category === activeFilter;
    const text = `${note.title} ${note.description} ${note.question} ${note.tag}`.toLowerCase();
    return inCategory && (!query || text.includes(query));
  });

  notesGrid.innerHTML = visible.map((note) => `
    <article class="note-card ${done.includes(note.id) ? "completed" : ""}">
      <div>
        <div class="note-top"><span>${note.number}</span><span class="note-tag">${note.tag}</span></div>
        <h3>${note.title}</h3>
        <p>${note.description}</p>
      </div>
      <div class="note-bottom">
        <span>${note.meta}</span>
        <div>
          <button class="open-note" data-open-note="${note.id}">open note <span>↗</span></button>
          <button class="mark-done" data-note="${note.id}" aria-label="Mark ${note.title} as read">
            ${done.includes(note.id) ? "✓ read" : "mark read"}
          </button>
        </div>
      </div>
    </article>
  `).join("");
  emptyState.hidden = visible.length > 0;
}

function renderPath() {
  const done = readStoredList("llm-field-notes-path");
  document.querySelector("#path-list").innerHTML = path.map((item, index) => `
    <div class="path-item ${done.includes(index) ? "done" : ""}">
      <span class="path-day">DAYS ${item[0]}</span>
      <div><h3>${item[1]}</h3><p>${item[2]}</p></div>
      <button class="path-check" data-day="${index}" aria-label="Mark ${item[1]} complete">${done.includes(index) ? "✓" : "·"}</button>
    </div>
  `).join("");
}

filters.forEach((filter) => filter.addEventListener("click", () => {
  filters.forEach((item) => item.classList.remove("active"));
  filters.forEach((item) => item.setAttribute("aria-pressed", item === filter ? "true" : "false"));
  filter.classList.add("active");
  renderNotes();
}));
searchInput.addEventListener("input", renderNotes);
document.addEventListener("click", (event) => {
  const noteButton = event.target.closest(".mark-done");
  if (noteButton) {
    const current = getProgress();
    const id = noteButton.dataset.note;
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    writeStoredList(progressKey, next);
    renderNotes();
  }
  const dayButton = event.target.closest(".path-check");
  if (dayButton) {
    const current = readStoredList("llm-field-notes-path");
    const day = Number(dayButton.dataset.day);
    const next = current.includes(day) ? current.filter((item) => item !== day) : [...current, day];
    writeStoredList("llm-field-notes-path", next);
    renderPath();
  }
  const openButton = event.target.closest(".open-note");
  if (openButton) {
    const note = notes.find((item) => item.id === openButton.dataset.openNote);
    const detail = noteDetails[note.id];
    document.querySelector("#dialog-kicker").textContent = `${note.number} / ${note.tag}`;
    document.querySelector("#dialog-title").textContent = note.title;
    document.querySelector("#dialog-question").textContent = note.question;
    document.querySelector("#dialog-summary").textContent = detail[0];
    document.querySelector("#dialog-build").textContent = detail[1];
    document.querySelector("#dialog-next").textContent = detail[2];
    dialog.showModal();
  }
});
document.querySelector("#dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
document.querySelector("#reset-progress").addEventListener("click", () => {
  localStorage.removeItem(progressKey);
  localStorage.removeItem("llm-field-notes-path");
  renderNotes();
  renderPath();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== searchInput) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape") searchInput.blur();
});
document.querySelector("#copy-prompt").addEventListener("click", async () => {
  const template = `# [A clear title]\n\n> The question this page answers in one sentence.\n\n## The short version\n\n## Build it\n\n## What surprised me\n\n## Failure modes\n\n## Sources\n\n## Try it yourself`;
  const feedback = document.querySelector("#copy-feedback");
  try {
    await navigator.clipboard.writeText(template);
    feedback.textContent = "Template copied. Go make the next page.";
  } catch {
    feedback.textContent = "Copy blocked by your browser — use the page structure above as a starting point.";
  }
  setTimeout(() => { feedback.textContent = ""; }, 4000);
});

renderNotes();
renderPath();

// --- Knowledge workbench ---------------------------------------------------
// This is intentionally provider-agnostic. The local extractor gives the UI a
// useful first pass today; a future model adapter can replace extractGraph()
// without changing the graph schema, renderer, or export formats.
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const graphStore = createGraphStore(localStorage);
let persistenceRequested = false;
async function requestPersistentStorage() {
  if (persistenceRequested || !navigator.storage?.persist) return;
  persistenceRequested = true;
  try {
    if (navigator.storage.persisted && await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch {
    // Persistence is an enhancement; normal local storage remains usable.
  }
}
let graphSearchQuery = "";
function getVisibleNodes(graph) {
  const query = graphSearchQuery.toLowerCase().trim();
  return graph.nodes.filter((node) => {
    if (node.status === "rejected") return false;
    if (!query) return true;
    return `${node.label} ${(node.aliases || []).join(" ")} ${node.type}`.toLowerCase().includes(query);
  });
}
function fitGraphPositions(graph, visibleNodes = getVisibleNodes(graph)) {
  const centerX = 360;
  const centerY = 215;
  const radiusX = Math.min(270, 100 + visibleNodes.length * 10);
  const radiusY = Math.min(150, 65 + visibleNodes.length * 6);
  return visibleNodes.map((node, index) => ({
    ...node,
    x: centerX + Math.cos((index / Math.max(visibleNodes.length, 1)) * Math.PI * 2 - Math.PI / 2) * radiusX,
    y: centerY + Math.sin((index / Math.max(visibleNodes.length, 1)) * Math.PI * 2 - Math.PI / 2) * radiusY
  }));
}

let selectedGraphItem = null;
function renderInspector(graph) {
  const panel = document.querySelector("#inspector-panel");
  if (!selectedGraphItem) {
    panel.innerHTML = `<div class="inspector-empty"><span>INSPECTOR</span><p>Select a concept or relation to inspect its evidence.</p></div>`;
    return;
  }
  const evidenceMarkup = (item) => {
    const sourceLinks = item.sources?.map((sourceId) => {
      const source = graph.documents.find((doc) => doc.id === sourceId);
      return `<button class="evidence-source" data-select-source="${escapeHtml(sourceId)}">${escapeHtml(source?.title || sourceId)}</button>`;
    }).join(", ");
    return `<li>${escapeHtml(item.text)}${sourceLinks ? `<small class="evidence-source-list">source: ${sourceLinks}</small>` : ""}</li>`;
  };
  if (selectedGraphItem.kind === "node") {
    const node = graph.nodes.find((item) => item.id === selectedGraphItem.id);
    if (!node) {
      selectedGraphItem = null;
      renderInspector(graph);
      return;
    }
    const sources = node.sources.map((sourceId) => ({ id: sourceId, title: graph.documents.find((doc) => doc.id === sourceId)?.title || sourceId }));
    const relations = graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
    panel.innerHTML = `
      <div class="inspector-header"><span>CONCEPT / ${escapeHtml(node.status.toUpperCase())}</span><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.type)} · ${(node.confidence * 100).toFixed(0)}% confidence · ${node.mentions} mention${node.mentions === 1 ? "" : "s"} · ${node.feedback} feedback${node.feedback === 1 ? "" : "s"}${node.aliases?.length ? ` · aliases: ${node.aliases.map(escapeHtml).join(", ")}` : ""}</small></div>
      <div class="inspector-edit"><label for="inspector-node-label">EDIT LABEL</label><div><input id="inspector-node-label" class="inspector-edit-input" value="${escapeHtml(node.label)}" maxlength="120" /><button data-edit-node="${escapeHtml(node.id)}">save</button></div></div>
      <div class="inspector-columns">
        <div><span class="inspector-label">EVIDENCE</span>${node.evidence.length ? `<ul>${node.evidence.map(evidenceMarkup).join("")}</ul>` : "<p class=\"inspector-muted\">No evidence captured.</p>"}</div>
        <div><span class="inspector-label">SOURCES</span>${sources.length ? `<ul>${sources.map((item) => `<li><button class="inspector-link" data-select-source="${escapeHtml(item.id)}">${escapeHtml(item.title)} ↗</button></li>`).join("")}</ul>` : "<p class=\"inspector-muted\">No source attached.</p>"}</div>
      </div>
      <div class="inspector-relations"><span class="inspector-label">NEIGHBORS</span>${relations.length ? relations.map((edge) => {
        const otherId = edge.source === node.id ? edge.target : edge.source;
        const other = graph.nodes.find((item) => item.id === otherId);
        return `<button class="inspector-link" data-select-edge="${escapeHtml(edge.id)}">${escapeHtml(edge.label)} · ${escapeHtml(other?.label || otherId)} <small>${edge.status}</small></button>`;
      }).join("") : "<p class=\"inspector-muted\">No relations attached.</p>"}</div>`;
    return;
  }
  if (selectedGraphItem.kind === "source") {
    const source = graph.documents.find((doc) => doc.id === selectedGraphItem.id);
    if (!source) {
      selectedGraphItem = null;
      renderInspector(graph);
      return;
    }
    const previewLimit = 12000;
    const preview = source.text.slice(0, previewLimit);
    const relatedNodes = graph.nodes.filter((node) => node.sources.includes(source.id));
    panel.innerHTML = `
      <div class="inspector-header"><span>SOURCE DOCUMENT</span><strong>${escapeHtml(source.title)}</strong><small>${source.text.length.toLocaleString()} characters · added ${escapeHtml(source.addedAt)}</small></div>
      <div class="inspector-edit"><label for="inspector-source-title">EDIT SOURCE TITLE</label><div><input id="inspector-source-title" class="inspector-edit-input" value="${escapeHtml(source.title)}" maxlength="200" /><button data-edit-source="${escapeHtml(source.id)}">save</button></div></div>
      <button class="remove-source" data-remove-source="${escapeHtml(source.id)}">Remove source from graph</button>
      <div class="inspector-source-actions"><span class="inspector-label">CONCEPTS FOUND</span>${relatedNodes.length ? relatedNodes.map((node) => `<button class="inspector-link" data-select-node="${escapeHtml(node.id)}">${escapeHtml(node.label)} <small>${node.status}</small></button>`).join("") : "<p class=\"inspector-muted\">No concepts attached.</p>"}</div>
      <div class="inspector-evidence"><span class="inspector-label">DOCUMENT PREVIEW</span><pre class="source-preview">${escapeHtml(preview)}${source.text.length > previewLimit ? "\n\n[… preview truncated …]" : ""}</pre></div>`;
    return;
  }
  const edge = graph.edges.find((item) => item.id === selectedGraphItem.id);
  if (!edge) {
    selectedGraphItem = null;
    renderInspector(graph);
    return;
  }
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  panel.innerHTML = `
  <div class="inspector-header"><span>RELATION / ${escapeHtml(edge.status.toUpperCase())}</span><strong>${escapeHtml(source?.label || edge.source)} <em>${escapeHtml(edge.label)}</em> ${escapeHtml(target?.label || edge.target)}</strong><small>${(edge.confidence * 100).toFixed(0)}% confidence · ${edge.feedback} feedback${edge.feedback === 1 ? "" : "s"} · ${edge.evidence.length} evidence item${edge.evidence.length === 1 ? "" : "s"}</small></div>
    <div class="inspector-edit"><label for="inspector-edge-label">EDIT RELATION</label><div><input id="inspector-edge-label" class="inspector-edit-input" value="${escapeHtml(edge.label)}" maxlength="80" /><button data-edit-edge="${escapeHtml(edge.id)}">save</button></div></div>
    <div class="inspector-evidence"><span class="inspector-label">EVIDENCE</span>${edge.evidence.length ? `<ul>${edge.evidence.map(evidenceMarkup).join("")}</ul>` : "<p class=\"inspector-muted\">No evidence captured.</p>"}</div>`;
}

function renderWorkbenchUnsafe() {
  const graph = graphStore.read();
  const visibleNodes = getVisibleNodes(graph);
  const positions = fitGraphPositions(graph, visibleNodes);
  const positionById = new Map(positions.map((node) => [node.id, node]));
  const canvas = document.querySelector("#graph-canvas");
  const empty = document.querySelector("#graph-empty");
  const list = document.querySelector("#node-list");
  const relationList = document.querySelector("#relation-list");
  const undoButton = document.querySelector("#undo-graph");
  document.querySelector("#graph-version").textContent = `REV ${String(graph.version).padStart(3, "0")}`;
  const activeNodeIds = new Set(positions.map((node) => node.id));
  const activeEdges = graph.edges.filter((edge) => edge.status !== "rejected" && activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target));
  const activeCount = graph.nodes.filter((node) => node.status !== "rejected").length;
  const filteredCount = activeCount - positions.length;
  const health = inspectGraph(graph);
  document.querySelector("#graph-summary").textContent = graph.nodes.length ? `${positions.length}${graphSearchQuery ? `/${activeCount}` : ""} visible · ${activeEdges.length} relations · ${graph.documents.length} source${graph.documents.length === 1 ? "" : "s"}${graph.nodes.length - activeCount ? ` · ${graph.nodes.length - activeCount} dismissed` : ""}${filteredCount && graphSearchQuery ? ` · ${filteredCount} filtered` : ""}` : "No concepts yet — ingest a document to begin.";
  document.querySelector("#hero-node-count").textContent = positions.length;
  document.querySelector("#hero-edge-count").textContent = activeEdges.length;
  document.querySelector("#hero-source-count").textContent = graph.documents.length;
  const recoveryAvailable = Boolean(graphStore.readRecovery());
  const storageMode = graphStore.getLastWriteMode();
  const storageWarning = storageMode === "without-history" || storageMode === "without-new-history"
    ? "<small class=\"storage-warning\">Saved with reduced undo history</small>"
    : "";
  document.querySelector("#graph-health").innerHTML = `<span>HEALTH</span><small>${health.provenanceCoverage}% provenance</small><small>${health.unsupportedNodes} unsupported concept${health.unsupportedNodes === 1 ? "" : "s"}</small><small>${health.unsupportedEdges} unsupported relation${health.unsupportedEdges === 1 ? "" : "s"}</small>${health.orphanedSourceReferences ? `<small>${health.orphanedSourceReferences} broken source reference${health.orphanedSourceReferences === 1 ? "" : "s"}</small>` : ""}${storageWarning}${recoveryAvailable ? `<small class="recovery-warning">Recovery snapshot available</small><button type="button" data-recovery-action="download">download recovery</button><button type="button" data-recovery-action="dismiss">dismiss</button>` : ""}`;
  undoButton.disabled = !graphStore.canUndo();
  empty.hidden = positions.length > 0;
  document.querySelector("#graph-empty p").textContent = graph.nodes.length && !positions.length ? "All concepts are dismissed." : "Your graph will appear here.";
  canvas.innerHTML = "";
  if (graph.nodes.length) {
    const edges = activeEdges.map((edge) => {
      const source = positionById.get(edge.source);
      const target = positionById.get(edge.target);
      if (!source || !target) return "";
      return `<line class="graph-edge" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" /><text class="edge-label" x="${(source.x + target.x) / 2}" y="${(source.y + target.y) / 2 - 5}">${escapeHtml(edge.label)}</text>`;
    }).join("");
    const nodes = positions.map((node) => `<g class="graph-node" data-node-id="${escapeHtml(node.id)}" tabindex="0" role="button" aria-label="Inspect ${escapeHtml(node.label)}"><title>${escapeHtml(node.label)} — ${(node.confidence * 100).toFixed(0)}% confidence</title><circle cx="${node.x}" cy="${node.y}" r="${Math.min(29, 19 + node.mentions * 2)}"></circle><text x="${node.x}" y="${node.y + 4}">${escapeHtml(node.label.slice(0, 18))}</text></g>`).join("");
    canvas.innerHTML = `<g class="graph-edges">${edges}</g><g class="graph-nodes">${nodes}</g>`;
  }
  const query = graphSearchQuery.toLowerCase().trim();
  const visibleGraphNodes = graph.nodes.filter((node) => !query || `${node.label} ${(node.aliases || []).join(" ")} ${node.type}`.toLowerCase().includes(query));
  list.innerHTML = visibleGraphNodes.map((node) => `<div class="node-row ${node.status === "rejected" ? "rejected" : ""}" data-node-id="${escapeHtml(node.id)}"><div><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.type)} · ${node.status} · ${(node.confidence * 100).toFixed(0)}% confidence · ${node.mentions} mention${node.mentions === 1 ? "" : "s"} · ${node.feedback} feedback</small></div><div class="node-feedback">${node.status === "rejected" ? `<button data-feedback="restore" data-node-id="${escapeHtml(node.id)}" aria-label="Restore ${escapeHtml(node.label)}">↺ restore</button>` : `<button data-feedback="up" data-node-id="${escapeHtml(node.id)}" aria-label="Confirm ${escapeHtml(node.label)}">+ confirm</button><button data-feedback="down" data-node-id="${escapeHtml(node.id)}" aria-label="Dismiss ${escapeHtml(node.label)}">− dismiss</button>`}</div></div>`).join("");
  const nodeName = (id) => graph.nodes.find((node) => node.id === id)?.label || id;
  const visibleGraphEdges = graph.edges.filter((edge) => {
    if (!query) return true;
    return `${nodeName(edge.source)} ${edge.label} ${nodeName(edge.target)} ${edge.status}`.toLowerCase().includes(query);
  });
  relationList.innerHTML = visibleGraphEdges.map((edge) => `<div class="relation-row ${edge.status === "rejected" ? "rejected" : ""}" data-edge-id="${escapeHtml(edge.id)}"><div><strong>${escapeHtml(nodeName(edge.source))} <span>${escapeHtml(edge.label)}</span> ${escapeHtml(nodeName(edge.target))}</strong><small>${edge.status} · ${(edge.confidence * 100).toFixed(0)}% confidence · ${edge.feedback} feedback · ${edge.evidence.length} evidence item${edge.evidence.length === 1 ? "" : "s"}</small></div><div class="node-feedback">${edge.status === "rejected" ? `<button data-edge-feedback="restore" data-edge-id="${escapeHtml(edge.id)}">↺ restore</button>` : `<button data-edge-feedback="up" data-edge-id="${escapeHtml(edge.id)}">+ confirm</button><button data-edge-feedback="down" data-edge-id="${escapeHtml(edge.id)}">− dismiss</button>`}</div></div>`).join("");
  const manualNodes = graph.nodes.filter((node) => node.status !== "rejected");
  const options = manualNodes.length ? manualNodes.map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.label)}</option>`).join("") : `<option value="">Add a concept first</option>`;
  const sourceSelect = document.querySelector("#manual-edge-source");
  const targetSelect = document.querySelector("#manual-edge-target");
  const previousSource = sourceSelect.value;
  const previousTarget = targetSelect.value;
  sourceSelect.innerHTML = options;
  targetSelect.innerHTML = options;
  if (manualNodes.some((node) => node.id === previousSource)) sourceSelect.value = previousSource;
  if (manualNodes.some((node) => node.id === previousTarget)) targetSelect.value = previousTarget;
  sourceSelect.disabled = manualNodes.length < 2;
  targetSelect.disabled = manualNodes.length < 2;
  document.querySelector("#add-manual-edge").disabled = manualNodes.length < 2;
  const revisionLog = document.querySelector("#revision-log");
  const wasRevisionOpen = revisionLog.querySelector("details")?.open;
  revisionLog.innerHTML = graph.revisions.length
    ? `<details${wasRevisionOpen ? " open" : ""}><summary><span>MEMORY</span><small>${graph.revisions.length} retained revision${graph.revisions.length === 1 ? "" : "s"}</small></summary><div class="revision-items">${graph.revisions.map((revision) => `<div><b>v${revision.version}</b><span>${escapeHtml(revision.reason)}</span><small>${escapeHtml(revision.timestamp)} · ${revision.nodes} nodes · ${revision.edges} relations</small></div>`).join("")}</div></details>`
    : "<span>MEMORY</span><small>No revisions yet.</small>";
  const projection = buildMarkdown(graph);
  document.querySelector("#markdown-preview code").textContent = projection;
  renderInspector(graph);
}

function renderWorkbench() {
  const errorPanel = document.querySelector("#app-error");
  try {
    renderWorkbenchUnsafe();
    errorPanel.hidden = true;
  } catch (error) {
    errorPanel.hidden = false;
    document.querySelector("#app-error-message").textContent = error instanceof Error ? error.message : "The saved graph was preserved, but this view could not render.";
  }
}

function buildMarkdown(graph) {
  const paths = buildProjectionPaths(graph);
  const sourceLabel = (id) => graph.documents.find((doc) => doc.id === id)?.title || id;
  const nodeLabel = (id) => graph.nodes.find((node) => node.id === id)?.label || id;
  const conceptLink = (id) => paths.nodes.has(id) ? `[[${paths.nodes.get(id)}|${nodeLabel(id)}]]` : `[[${nodeLabel(id)}]]`;
  const sourceLink = (id) => paths.sources.has(id) ? `[[${paths.sources.get(id)}|${sourceLabel(id)}]]` : `[[${sourceLabel(id)}]]`;
  const lines = [
    "---",
    "type: knowledge-graph",
    `version: ${graph.version}`,
    `updated: ${graph.updatedAt || "not yet"}`,
    `concepts: ${graph.nodes.length}`,
    `relations: ${graph.edges.length}`,
    "---",
    "",
    "# Knowledge Graph",
    "",
    "> An Obsidian-ready projection of the internal representation.",
    "",
    "## Sources",
    ...graph.documents.map((doc) => `- ${sourceLink(doc.id)} — ${doc.addedAt}`),
    "",
    "## Concept index",
    ...graph.nodes.map((node) => `- ${conceptLink(node.id)} — ${node.type}, ${node.status}, confidence ${(node.confidence * 100).toFixed(0)}%${node.aliases?.length ? `, aliases: ${node.aliases.join(", ")}` : ""}`),
    "",
    "## Relations",
    ...graph.edges.map((edge) => `- ${conceptLink(edge.source)} — ${edge.label} → ${conceptLink(edge.target)} (${edge.status}, ${(edge.confidence * 100).toFixed(0)}%)`),
    "",
    "## Evidence",
    ...graph.edges.flatMap((edge) => edge.evidence.map((quote) => `> ${quote.text}\n>\n> — ${conceptLink(edge.source)} ${edge.label} ${conceptLink(edge.target)}${quote.sources?.length ? `\n> sources: ${quote.sources.map(sourceLink).join(", ")}` : ""}`))
  ];
  return lines.join("\n");
}

function safeFileName(value, fallback) {
  const fileName = slugify(String(value)).replace(/^-+|-+$/g, "");
  return fileName || fallback;
}

function buildProjectionPaths(graph) {
  const nodes = new Map();
  const sources = new Map();
  graph.nodes.forEach((node) => nodes.set(node.id, `Concepts/${safeFileName(node.id, "concept")}.md`));
  graph.documents.forEach((doc) => sources.set(doc.id, `Sources/${safeFileName(doc.id, "source")}.md`));
  return { nodes, sources };
}

function buildVaultFiles(graph) {
  const paths = buildProjectionPaths(graph);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const sourceById = new Map(graph.documents.map((doc) => [doc.id, doc]));
  const files = [
    { name: "_index.md", content: buildMarkdown(graph) },
    { name: "Relations.md", content: [
      "---",
      "type: relations",
      `graph_version: ${graph.version}`,
      "---",
      "",
      "# Relations",
      "",
      ...graph.edges.flatMap((edge) => [
        `## ${nodeById.get(edge.source)?.label || edge.source} ${edge.label} ${nodeById.get(edge.target)?.label || edge.target}`,
        "",
        `- From: [[${paths.nodes.get(edge.source)}|${nodeById.get(edge.source)?.label || edge.source}]]`,
        `- To: [[${paths.nodes.get(edge.target)}|${nodeById.get(edge.target)?.label || edge.target}]]`,
        `- Status: ${edge.status}`,
        `- Confidence: ${(edge.confidence * 100).toFixed(0)}%`,
        "",
        ...edge.evidence.map((evidence) => `> ${evidence.text}${evidence.sources?.length ? `\n>\n> sources: ${evidence.sources.map((sourceId) => sourceById.has(sourceId) ? `[[${paths.sources.get(sourceId)}|${sourceById.get(sourceId).title}]]` : sourceId).join(", ")}` : ""}`),
        ""
      ])
    ].join("\n") },
    { name: "graph.json", content: JSON.stringify(graph, null, 2) }
  ];
  graph.nodes.forEach((node) => {
    const related = graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
    files.push({
      name: paths.nodes.get(node.id),
      content: [
        "---",
        "type: concept",
        `id: ${JSON.stringify(node.id)}`,
        `label: ${JSON.stringify(node.label)}`,
        `status: ${node.status}`,
        `aliases: ${JSON.stringify(node.aliases || [])}`,
        `confidence: ${node.confidence.toFixed(3)}`,
        `mentions: ${node.mentions}`,
        `feedback: ${node.feedback}`,
        "---",
        "",
        `# ${node.label}`,
        "",
        `Confidence: **${(node.confidence * 100).toFixed(0)}%** · ${node.mentions} mention${node.mentions === 1 ? "" : "s"}`,
        "",
        "## Sources",
        ...node.sources.map((sourceId) => `- ${sourceById.has(sourceId) ? `[[${paths.sources.get(sourceId)}|${sourceById.get(sourceId).title}]]` : sourceId}`),
        "",
        "## Evidence",
        ...node.evidence.map((evidence) => `> ${evidence.text}${evidence.sources?.length ? `\n>\n> sources: ${evidence.sources.map((sourceId) => sourceById.has(sourceId) ? `[[${paths.sources.get(sourceId)}|${sourceById.get(sourceId).title}]]` : sourceId).join(", ")}` : ""}`),
        "",
        "## Relations",
        ...related.map((edge) => {
          const otherId = edge.source === node.id ? edge.target : edge.source;
          return `- ${edge.label} → [[${paths.nodes.get(otherId)}|${nodeById.get(otherId)?.label || otherId}]] (${edge.status}, ${(edge.confidence * 100).toFixed(0)}%)`;
        }),
        ""
      ].join("\n")
    });
  });
  graph.edges.forEach((edge) => {
    files.push({
      name: `Relations/${safeFileName(edge.id, "relation")}.md`,
      content: [
        "---",
        "type: relation",
        `id: ${JSON.stringify(edge.id)}`,
        `label: ${JSON.stringify(edge.label)}`,
        `source: ${JSON.stringify(edge.source)}`,
        `target: ${JSON.stringify(edge.target)}`,
        `status: ${edge.status}`,
        `feedback: ${edge.feedback}`,
        "---",
        "",
        `# ${nodeById.get(edge.source)?.label || edge.source} ${edge.label} ${nodeById.get(edge.target)?.label || edge.target}`,
        "",
        `- From: [[${paths.nodes.get(edge.source)}|${nodeById.get(edge.source)?.label || edge.source}]]`,
        `- To: [[${paths.nodes.get(edge.target)}|${nodeById.get(edge.target)?.label || edge.target}]]`,
        ""
      ].join("\n")
    });
  });
  graph.documents.forEach((doc) => {
    files.push({
      name: paths.sources.get(doc.id),
      content: ["---", "type: source", `id: ${JSON.stringify(doc.id)}`, `added: ${doc.addedAt}`, "---", "", `# ${doc.title}`, "", doc.text, ""].join("\n")
    });
  });
  return files;
}

const textEncoder = new TextEncoder();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function putUint16(view, offset, value) { view.setUint16(offset, value, true); }
function putUint32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => { output.set(part, offset); offset += part.length; });
  return output;
}
function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  files.forEach((file) => {
    const name = textEncoder.encode(file.name);
    const data = textEncoder.encode(file.content);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    putUint32(localView, 0, 0x04034b50);
    putUint16(localView, 4, 20);
    putUint16(localView, 6, 0x800);
    putUint16(localView, 8, 0);
    putUint32(localView, 14, checksum);
    putUint32(localView, 18, data.length);
    putUint32(localView, 22, data.length);
    putUint16(localView, 26, name.length);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    putUint32(centralView, 0, 0x02014b50);
    putUint16(centralView, 4, 20);
    putUint16(centralView, 6, 20);
    putUint16(centralView, 8, 0x800);
    putUint16(centralView, 10, 0);
    putUint32(centralView, 16, checksum);
    putUint32(centralView, 20, data.length);
    putUint32(centralView, 24, data.length);
    putUint16(centralView, 28, name.length);
    putUint32(centralView, 42, offset);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  });
  const centralDirectory = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  putUint32(endView, 0, 0x06054b50);
  putUint16(endView, 8, files.length);
  putUint16(endView, 10, files.length);
  putUint32(endView, 12, centralDirectory.length);
  putUint32(endView, 16, offset);
  return concatBytes([...localParts, centralDirectory, end]);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function downloadBytes(filename, bytes, type) {
  const blob = new Blob([bytes], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

document.querySelector("#load-sample").addEventListener("click", () => {
  pendingFiles = [];
  document.querySelector("#document-file").value = "";
  renderFileQueue();
  document.querySelector("#document-title").value = sampleDocument.title;
  document.querySelector("#document-input").value = sampleDocument.text;
  document.querySelector("#ingest-status").textContent = "Sample loaded. Build the graph when ready.";
});
document.querySelector("#graph-health").addEventListener("click", (event) => {
  const action = event.target.closest("[data-recovery-action]")?.dataset.recoveryAction;
  if (!action) return;
  if (action === "dismiss") {
    graphStore.clearRecovery();
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = "Recovery snapshot dismissed.";
    return;
  }
  const raw = graphStore.readRecovery();
  if (!raw) return;
  downloadFile("llm-field-notes-recovery.json", raw, "application/json");
  document.querySelector("#ingest-status").textContent = "Recovery snapshot downloaded. Inspect it before dismissing the warning.";
});
let pendingFiles = [];
function renderFileQueue(message = "") {
  const queue = document.querySelector("#file-queue");
  queue.innerHTML = pendingFiles.length
    ? `<span>${pendingFiles.length} document${pendingFiles.length === 1 ? "" : "s"} queued</span>${pendingFiles.map((file) => `<small>${escapeHtml(file.name)}</small>`).join("")}`
    : message;
}
document.querySelector("#clear-graph").addEventListener("click", () => {
  const status = document.querySelector("#ingest-status");
  if (!graphStore.read().nodes.length || window.confirm("Clear this browser's saved graph?")) {
    if (graphStore.clear()) {
      renderWorkbench();
      status.textContent = "Local graph cleared.";
    } else {
      status.textContent = "The local graph could not be cleared.";
    }
  }
});
document.querySelector("#undo-graph").addEventListener("click", () => {
  const status = document.querySelector("#ingest-status");
  if (!graphStore.undo()) {
    status.textContent = "There is no saved change to undo.";
    return;
  }
  renderWorkbench();
  status.textContent = "Last graph change undone.";
});
document.querySelector("#document-file").addEventListener("change", async (event) => {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  const status = document.querySelector("#ingest-status");
  try {
    if (files.some((file) => file.name.toLowerCase().endsWith(".zip")) && files.length !== 1) {
      throw new Error("Select an Obsidian vault ZIP by itself.");
    }
    if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
      pendingFiles = files;
      renderFileQueue();
      status.textContent = "Obsidian vault loaded. Build the graph to import its feedback notes.";
      return;
    }
    if (files.some((file) => file.name.toLowerCase().endsWith(".json"))) {
      if (files.length !== 1) throw new Error("Import one graph JSON at a time.");
      const file = files[0];
      const text = await file.text();
      const imported = JSON.parse(text);
      if (imported.format === "llm-field-notes/backup@1") {
        if (!imported.graph || (imported.graph.schema !== GRAPH_SCHEMA && !LEGACY_GRAPH_SCHEMAS.has(imported.graph.schema))) throw new Error("That backup does not contain a valid graph.");
        const importedGraph = normalizeGraph(imported.graph);
        const importedHistory = asArray(imported.history).map(normalizeGraph);
        if (!graphStore.restore(importedGraph, importedHistory)) throw new Error("The backup could not be restored in this browser.");
        renderWorkbench();
        status.textContent = `Full backup restored · revision ${importedGraph.version} with ${importedHistory.length} undo snapshot${importedHistory.length === 1 ? "" : "s"}.`;
        pendingFiles = [];
        renderFileQueue();
        return;
      }
      if (imported.schema !== GRAPH_SCHEMA && !LEGACY_GRAPH_SCHEMAS.has(imported.schema)) throw new Error("That JSON file is not an LLM Field Notes graph.");
      const importedGraph = normalizeGraph(imported);
      if (!graphStore.write(importedGraph)) throw new Error("The graph could not be saved in this browser.");
      renderWorkbench();
      status.textContent = `Graph imported · revision ${importedGraph.version} restored.`;
      pendingFiles = [];
      renderFileQueue();
      return;
    }
    pendingFiles = files;
    const firstText = await pendingFiles[0].text();
    if (!firstText.trim()) throw new Error("The first file is empty.");
    if (firstText.length > MAX_DOCUMENT_CHARS) throw new Error(`That file is larger than the ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k character limit.`);
    document.querySelector("#document-title").value = pendingFiles[0].name.replace(/\.[^/.]+$/, "");
    document.querySelector("#document-input").value = firstText;
    renderFileQueue();
    status.textContent = pendingFiles.length === 1 ? `${pendingFiles[0].name} loaded. Build the graph when ready.` : `${pendingFiles.length} files loaded. Build the batch when ready.`;
  } catch (error) {
    pendingFiles = [];
    renderFileQueue();
    status.textContent = error instanceof Error ? error.message : "That file could not be loaded.";
  }
});
document.querySelector("#ingest-document").addEventListener("click", async () => {
  void requestPersistentStorage();
  const title = document.querySelector("#document-title").value.trim() || "Untitled document";
  const text = document.querySelector("#document-input").value.trim();
  const status = document.querySelector("#ingest-status");
  if (pendingFiles.length) {
    const files = pendingFiles.slice();
    if (files.some((file) => file.name.toLowerCase().endsWith(".zip")) && files.length !== 1) {
      status.textContent = "Select an Obsidian vault ZIP by itself.";
      return;
    }
    if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
      try {
        const vault = parseObsidianVault(await files[0].arrayBuffer());
        if (!vault.feedbacks.length) {
          status.textContent = "That vault contains no exported concept or relation feedback notes.";
          return;
        }
        const result = applyObsidianFeedback(graphStore.read(), vault.feedbacks);
        if (!result.changed) {
          status.textContent = "No matching graph items or changes were found in that vault.";
          return;
        }
        if (!graphStore.write(result.graph)) {
          status.textContent = "Obsidian vault feedback could not be saved. Your prior graph is still intact.";
          return;
        }
        pendingFiles = [];
        document.querySelector("#document-file").value = "";
        renderFileQueue();
        renderWorkbench();
        status.textContent = `Obsidian vault feedback imported · ${result.updates} update${result.updates === 1 ? "" : "s"} saved.`;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "That vault could not be read.";
      }
      return;
    }
    let fileTexts;
    try {
      fileTexts = await Promise.all(files.map((file) => file.text()));
    } catch {
      status.textContent = "One or more selected notes could not be read.";
      return;
    }
    const feedbacks = fileTexts.map(parseObsidianFeedback).filter(Boolean);
    if (feedbacks.length) {
      if (feedbacks.length !== files.length) {
        status.textContent = "Select only exported concept or relation notes when importing Obsidian feedback.";
        return;
      }
      const result = applyObsidianFeedback(graphStore.read(), feedbacks);
      if (!result.changed) {
        status.textContent = "No matching graph items or changes were found in those Obsidian notes.";
        return;
      }
      if (!graphStore.write(result.graph)) {
        status.textContent = "Obsidian feedback could not be saved. Your prior graph is still intact.";
        return;
      }
      pendingFiles = [];
      document.querySelector("#document-file").value = "";
      renderFileQueue();
      renderWorkbench();
      status.textContent = `Obsidian feedback imported · ${result.updates} update${result.updates === 1 ? "" : "s"} saved.`;
      return;
    }
  }
  if (pendingFiles.length > 1) {
    const files = pendingFiles.slice();
    let graph = graphStore.read();
    let added = 0;
    let duplicates = 0;
    const failures = [];
    for (const file of files) {
      try {
        const fileText = await file.text();
        if (!fileText.trim()) {
          failures.push(`${file.name}: empty`);
          continue;
        }
        if (fileText.length > MAX_DOCUMENT_CHARS) {
          failures.push(`${file.name}: over ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k characters`);
          continue;
        }
        const result = mergeExtraction(graph, extractGraph(file.name.replace(/\.[^/.]+$/, ""), fileText.trim()));
        if (result.duplicate) duplicates += 1;
        else {
          graph = result.graph;
          added += 1;
        }
      } catch {
        failures.push(`${file.name}: could not read`);
      }
    }
    if (added && !graphStore.write(graph)) {
      status.textContent = "The batch could not be saved. Your browser may be out of storage.";
      return;
    }
    pendingFiles = [];
    document.querySelector("#document-file").value = "";
    renderFileQueue();
    renderWorkbench();
    status.textContent = `${added} document${added === 1 ? "" : "s"} added${duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped` : ""}${failures.length ? ` · ${failures.length} failed` : ""}.`;
    return;
  }
  if (text.length < 40) {
    status.textContent = "Add at least a few sentences so the extractor has something to connect.";
    return;
  }
  if (text.length > MAX_DOCUMENT_CHARS) {
    status.textContent = `Keep documents under ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k characters for this local prototype.`;
    return;
  }
  const result = mergeExtraction(graphStore.read(), extractGraph(title, text));
  if (result.duplicate) {
    status.textContent = "This document is already in the graph; no duplicate revision was created.";
    return;
  }
  if (!graphStore.write(result.graph)) {
    status.textContent = "The graph could not be saved. Your browser may be out of storage.";
    return;
  }
  renderWorkbench();
  status.textContent = `Revision ${result.graph.version} saved · ${result.graph.nodes.length} concepts now in memory.`;
  pendingFiles = [];
  document.querySelector("#document-file").value = "";
  renderFileQueue();
});
document.querySelectorAll(".mini-button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".mini-button").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll(".mini-button").forEach((item) => item.setAttribute("aria-pressed", item === button ? "true" : "false"));
  button.classList.add("active");
  const isList = button.dataset.view === "list";
  document.querySelector("#graph-canvas-wrap").hidden = isList;
  document.querySelector("#node-list").hidden = !isList;
  document.querySelector("#relation-list").hidden = !isList;
}));
document.querySelector("#graph-search").addEventListener("input", (event) => {
  graphSearchQuery = event.target.value;
  renderWorkbench();
});
function commitManualGraph(graph, reason) {
  void requestPersistentStorage();
  graph.version += 1;
  graph.updatedAt = new Date().toISOString();
  graph.revisions.unshift({ id: `rev-${graph.version}`, version: graph.version, timestamp: graph.updatedAt, reason, nodes: graph.nodes.length, edges: graph.edges.length });
  graph.revisions = graph.revisions.slice(0, 20);
  if (!graphStore.write(graph)) {
    document.querySelector("#ingest-status").textContent = "The manual change could not be saved.";
    return false;
  }
  renderWorkbench();
  document.querySelector("#ingest-status").textContent = `${reason} · revision ${graph.version} saved.`;
  return true;
}
document.querySelector("#add-manual-node").addEventListener("click", () => {
  const input = document.querySelector("#manual-node-label");
  const label = input.value.trim();
  if (label.length < 2) {
    document.querySelector("#ingest-status").textContent = "Give the manual concept a label first.";
    return;
  }
  const graph = graphStore.read();
  const existing = graph.nodes.find((node) => node.id === slugify(label) || node.aliases.includes(label));
  if (existing) {
    existing.status = "accepted";
    existing.confidence = .99;
    existing.feedback += 1;
    if (commitManualGraph(graph, `Confirmed concept ${existing.label}`)) input.value = "";
    return;
  }
  graph.nodes.push({
    id: makeId("manual"),
    label,
    aliases: [],
    type: "manual",
    confidence: .99,
    mentions: 1,
    feedback: 1,
    status: "accepted",
    sources: [],
    evidence: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  if (commitManualGraph(graph, `Added concept ${label}`)) input.value = "";
});
document.querySelector("#add-manual-edge").addEventListener("click", () => {
  const source = document.querySelector("#manual-edge-source").value;
  const target = document.querySelector("#manual-edge-target").value;
  const label = document.querySelector("#manual-edge-label").value.trim();
  if (!source || !target || source === target || label.length < 2) {
    document.querySelector("#ingest-status").textContent = "Choose two different concepts and a relation label.";
    return;
  }
  const graph = graphStore.read();
  const edgeId = `${source}--${target}--${slugify(label)}`;
  const existing = graph.edges.find((edge) => edge.id === edgeId);
  if (existing) {
    existing.status = "accepted";
    existing.confidence = .99;
  } else {
    graph.edges.push({ id: edgeId, source, target, label, confidence: .99, feedback: 1, evidence: [], sources: [], status: "accepted" });
  }
  if (commitManualGraph(graph, `Added relation ${label}`)) document.querySelector("#manual-edge-label").value = "";
});
const selectGraphNode = (nodeId) => {
  selectedGraphItem = { kind: "node", id: nodeId };
  let selectedRow = null;
  document.querySelectorAll(".node-row").forEach((row) => {
    const selected = row.dataset.nodeId === nodeId;
    row.classList.toggle("selected", selected);
    if (selected) selectedRow = row;
  });
  const row = selectedRow;
  if (row) row.scrollIntoView({ block: "nearest" });
  renderInspector(graphStore.read());
};
const selectGraphEdge = (edgeId) => {
  selectedGraphItem = { kind: "edge", id: edgeId };
  document.querySelectorAll(".relation-row").forEach((row) => row.classList.toggle("selected", row.dataset.edgeId === edgeId));
  renderInspector(graphStore.read());
};
const selectSource = (sourceId) => {
  selectedGraphItem = { kind: "source", id: sourceId };
  renderInspector(graphStore.read());
};
document.querySelector("#graph-canvas").addEventListener("click", (event) => {
  const node = event.target.closest(".graph-node");
  if (!node) return;
  selectGraphNode(node.dataset.nodeId);
  document.querySelector(".mini-button[data-view='list']").click();
});
document.querySelector("#graph-canvas").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const node = event.target.closest(".graph-node");
  if (!node) return;
  event.preventDefault();
  selectGraphNode(node.dataset.nodeId);
  document.querySelector(".mini-button[data-view='list']").click();
});
document.querySelector("#node-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-feedback]");
  if (!button) {
    const row = event.target.closest(".node-row");
    if (row) selectGraphNode(row.dataset.nodeId);
    return;
  }
  const action = button.dataset.feedback;
  const result = applyFeedback(graphStore.read(), "node", button.dataset.nodeId, action);
  if (!result.changed) return;
  if (!graphStore.write(result.graph)) {
    document.querySelector("#ingest-status").textContent = "That feedback could not be saved. Your prior graph is still intact.";
    renderWorkbench();
    return;
  }
  renderWorkbench();
  document.querySelector(".mini-button[data-view='list']").click();
});
document.querySelector("#relation-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edge-feedback]");
  if (!button) {
    const row = event.target.closest(".relation-row");
    if (row) selectGraphEdge(row.dataset.edgeId);
    return;
  }
  const action = button.dataset.edgeFeedback;
  const result = applyFeedback(graphStore.read(), "edge", button.dataset.edgeId, action);
  if (!result.changed) return;
  if (!graphStore.write(result.graph)) {
    document.querySelector("#ingest-status").textContent = "That feedback could not be saved. Your prior graph is still intact.";
    renderWorkbench();
    return;
  }
  renderWorkbench();
  document.querySelector(".mini-button[data-view='list']").click();
});
document.querySelector("#inspector-panel").addEventListener("click", (event) => {
  const edgeButton = event.target.closest("[data-select-edge]");
  if (edgeButton) selectGraphEdge(edgeButton.dataset.selectEdge);
  const sourceButton = event.target.closest("[data-select-source]");
  if (sourceButton) selectSource(sourceButton.dataset.selectSource);
  const removeSourceButton = event.target.closest("[data-remove-source]");
  if (removeSourceButton) {
    if (!window.confirm("Remove this source and unsupported inferred knowledge from the graph?")) return;
    const result = removeSource(graphStore.read(), removeSourceButton.dataset.removeSource);
    if (!result.removed || !graphStore.write(result.graph)) {
      document.querySelector("#ingest-status").textContent = "The source could not be removed.";
      return;
    }
    selectedGraphItem = null;
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = `Source removed · ${result.removedNodes} concepts and ${result.removedEdges} relations pruned. Undo is available.`;
  }
  const nodeButton = event.target.closest("[data-select-node]");
  if (nodeButton) selectGraphNode(nodeButton.dataset.selectNode);
  const nodeEdit = event.target.closest("[data-edit-node]");
  const edgeEdit = event.target.closest("[data-edit-edge]");
  const sourceEdit = event.target.closest("[data-edit-source]");
  if (!nodeEdit && !edgeEdit && !sourceEdit) return;
  const graph = graphStore.read();
  const input = document.querySelector(".inspector-edit-input");
  const nextLabel = input?.value.trim();
  if (!nextLabel) return;
  if (nodeEdit) {
    const node = graph.nodes.find((item) => item.id === nodeEdit.dataset.editNode);
    if (!node || node.label === nextLabel) return;
    node.aliases = [...new Set([...(node.aliases || []), node.label])].slice(0, 20);
    node.label = nextLabel;
    node.updatedAt = new Date().toISOString();
  } else if (edgeEdit) {
    const edge = graph.edges.find((item) => item.id === edgeEdit.dataset.editEdge);
    if (!edge || edge.label === nextLabel) return;
    edge.label = nextLabel;
  } else {
    const source = graph.documents.find((item) => item.id === sourceEdit.dataset.editSource);
    if (!source || source.title === nextLabel) return;
    source.title = nextLabel;
  }
  graph.version += 1;
  graph.updatedAt = new Date().toISOString();
  graph.revisions.unshift({
    id: `rev-${graph.version}`,
    version: graph.version,
    timestamp: graph.updatedAt,
    reason: `${nodeEdit ? "Renamed concept" : edgeEdit ? "Renamed relation" : "Renamed source"} to ${nextLabel}`,
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, 20);
  if (!graphStore.write(graph)) {
    document.querySelector("#ingest-status").textContent = "The edit could not be saved.";
    return;
  }
  renderWorkbench();
  document.querySelector("#ingest-status").textContent = "Graph edit saved and added to revision history.";
});
document.querySelector("#download-markdown").addEventListener("click", () => {
  const graph = graphStore.read();
  downloadFile("knowledge-graph.md", buildMarkdown(graph), "text/markdown");
  document.querySelector("#projection-status").textContent = "Markdown projection downloaded.";
});
document.querySelector("#download-vault").addEventListener("click", () => {
  const graph = graphStore.read();
  const files = buildVaultFiles(graph);
  downloadBytes("llm-field-notes-vault.zip", zipStore(files), "application/zip");
  document.querySelector("#projection-status").textContent = `Obsidian vault downloaded · ${files.length} files.`;
});
document.querySelector("#download-json").addEventListener("click", () => {
  const graph = graphStore.read();
  downloadFile("knowledge-graph.json", JSON.stringify(graph, null, 2), "application/json");
  document.querySelector("#projection-status").textContent = "Internal representation exported as JSON.";
});
document.querySelector("#download-backup").addEventListener("click", () => {
  const backup = {
    format: "llm-field-notes/backup@1",
    exportedAt: new Date().toISOString(),
    graph: graphStore.read(),
    history: graphStore.readHistory()
  };
  downloadFile("llm-field-notes-backup.json", JSON.stringify(backup, null, 2), "application/json");
  document.querySelector("#projection-status").textContent = `Full backup downloaded · ${backup.history.length} undo snapshot${backup.history.length === 1 ? "" : "s"}.`;
});
document.querySelector("#reload-app").addEventListener("click", () => window.location.reload());
const reportRuntimeError = (error) => {
  const panel = document.querySelector("#app-error");
  if (!panel) return;
  panel.hidden = false;
  document.querySelector("#app-error-message").textContent = error instanceof Error ? error.message : "The saved graph was preserved, but this view could not render.";
};
window.addEventListener("error", (event) => reportRuntimeError(event.error || new Error("Unexpected application error.")));
window.addEventListener("unhandledrejection", (event) => reportRuntimeError(event.reason || new Error("Unexpected asynchronous error.")));
renderWorkbench();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // Offline support is an enhancement; the app remains fully usable if it
    // cannot be registered in a preview or embedded environment.
  });
}
