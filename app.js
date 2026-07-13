import {
  GRAPH_SCHEMA,
  FEEDBACK_FORMAT,
  BACKUP_FORMAT,
  DIFF_FORMAT,
  HEALTH_FORMAT,
  VAULT_FORMAT,
  fingerprintBackup,
  advanceGraphVersion,
  LEGACY_GRAPH_SCHEMAS,
  MAX_DOCUMENT_CHARS,
  MAX_GRAPH_DOCUMENT_CHARS,
  MAX_GRAPH_DOCUMENTS,
  MAX_GRAPH_NODES,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_REVISIONS,
  MAX_FEEDBACK_EXAMPLES,
  MAX_SOURCE_URI_CHARS,
  sampleDocument,
  defaultGraph,
  makeId,
  normalizeGraph,
  extractGraph,
  mergeExtraction,
  replaceSource,
  diffGraphs,
  redactGraph,
  applyFeedback,
  applyFeedbackDataset,
  mergeConcepts,
  buildExtractorFeedback,
  clearLearningMemory,
  rememberLearningItem,
  removeSource,
  inspectGraph,
  reviewQueue,
  fingerprintFeedbackExamples,
  syncLearningRelationLabels,
  slugify,
  makeEdgeId,
  asArray,
  normalizeSourceUri,
  SOURCE_QUALITIES
} from "./graph-core.js";
import { GRAPH_KEY, createGraphStore } from "./graph-store.js";
import { MAX_ZIP_BYTES, applyObsidianFeedback, parseObsidianFeedback, parseObsidianVault } from "./projection-adapter.js";
import { createRemoteExtractor } from "./extractor-adapter.js";
import { getBrowserStorage } from "./storage-adapter.js";

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
  training: ["Loss compresses a prediction error into a signal that can move parameters. It is useful because it is differentiable, not because it perfectly captures usefulness.", "Run `node experiments/tiny-training.mjs`, read the character-level bigram model, then change its steps and learning rate before adding architecture.", "Keep the loss falling while making the output worse. That tension is the beginning of evaluation."],
  transformers: ["A transformer repeats a simple block: mix information across positions with attention, transform each position with an MLP, and preserve a clean path with residual connections.", "Implement a character-level transformer with one block. Keep it small enough to read every tensor shape in a debugger.", "Remove one component at a time. Record which failure is graceful, catastrophic, or merely slower."],
  scaling: ["More parameters alone are not a strategy. Useful scaling balances model capacity, data, and compute so the model keeps finding structure rather than memorizing noise.", "Train three tiny models under a fixed compute budget. Log parameter count, tokens seen, wall time, and validation loss.", "Use the measurements to predict which model should win before checking the result."],
  inference: ["Generation is a loop: run the model, turn logits into a distribution, choose one token, append it, and repeat. The cache keeps old key/value computations from being repeated.", "Write a sampler with greedy, temperature, and top-k modes. Time it with and without a simple key/value cache.", "Generate the same prompt at three temperatures and describe the change without using the word “creative.”"],
  evaluation: ["Evaluation is a decision instrument. Define the user task, create representative examples, record acceptable failures, and measure changes with a repeatable harness.", "Create a 30-example eval set for one narrow task. Include adversarial and ambiguous cases, a rubric, and a baseline.", "Have two people score the same outputs. Investigate disagreement before adding more examples."],
  rag: ["Retrieval gives a model relevant context at request time instead of asking its weights to contain every fact. The quality bottleneck is often search and chunking, not the final prompt.", "Index ten documents with simple lexical search. Return the top three chunks with source labels before asking the model to answer.", "Create questions whose answer spans two chunks. See whether your retriever brings both pieces together."],
  finetuning: ["Fine-tuning changes behavior through examples. It fits repeatable format, style, or task behavior—not a magic database update.", "Write 50 high-quality input/output examples for one narrow behavior. Hold out a test set and compare prompt-only versus tuned behavior.", "Remove the weakest quarter of your examples. If performance improves, your dataset was teaching noise."],
  agents: ["An agent is a control loop around a model: decide, call a tool, observe, and decide again. Reliability comes from constrained actions and explicit checks, not a grander persona.", "Give a model exactly two tools and a maximum of five steps. Log every decision, tool input, output, and stop reason.", "Add a dry-run mode. A safe system should be inspectable before it is powerful."],
  production: ["A production system is a set of promises: response time, cost, availability, data handling, and behavior when the model is wrong or unavailable.", "Make a request log with latency, token counts, model version, outcome, and a redacted trace. Add one fallback and one human escape hatch.", "Ask a real person to use the system without your narration. Every question they ask is a missing product surface."]
};

const browserStorage = getBrowserStorage();
await browserStorage.ready;
window.addEventListener("pagehide", () => {
  void browserStorage.flush?.();
});
const RELEASE_METADATA_TIMEOUT_MS = 5000;
const releaseController = new AbortController();
const releaseTimeout = setTimeout(() => releaseController.abort(), RELEASE_METADATA_TIMEOUT_MS);
const releaseInfo = await fetch("./version.json", { cache: "no-cache", signal: releaseController.signal }).then((response) => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}).catch(() => ({ version: "unknown", channel: "unreleased", date: "" }));
clearTimeout(releaseTimeout);
const releaseVersion = document.querySelector("#release-version");
if (releaseVersion && typeof releaseInfo.version === "string") {
  releaseVersion.textContent = `v${releaseInfo.version} · ${releaseInfo.channel || "stable"}${releaseInfo.date ? ` · ${releaseInfo.date}` : ""}`;
}
const { storage: appStorage, persistent: hasPersistentStorage } = browserStorage;
let hasDurableStorage = browserStorage.durable;
let storageDurabilityFailure = browserStorage.storageFailure;
const notesGrid = document.querySelector("#notes-grid");
const emptyState = document.querySelector("#empty-state");
const searchInput = document.querySelector("#search");
const filters = document.querySelectorAll(".filter");
const progressKey = "llm-field-notes-progress";
const pathProgressKey = "llm-field-notes-path";
const MAX_PROGRESS_JSON_CHARS = 10000;
const progressStatus = document.querySelector("#progress-status");
const readStoredList = (key) => {
  try {
    const raw = appStorage.getItem(key);
    if (typeof raw !== "string" || raw.length > MAX_PROGRESS_JSON_CHARS) return [];
    const value = JSON.parse(raw || "[]");
    if (!Array.isArray(value)) return [];
    if (key === progressKey) return [...new Set(value.filter((item) => typeof item === "string" && notes.some((note) => note.id === item)))];
    if (key === pathProgressKey) return [...new Set(value.filter((item) => Number.isInteger(item) && item >= 0 && item < path.length))];
    return [];
  } catch {
    return [];
  }
};
const writeStoredList = (key, value) => {
  try {
    const bounded = key === progressKey
      ? [...new Set(value.filter((item) => typeof item === "string" && notes.some((note) => note.id === item)))]
      : key === pathProgressKey
        ? [...new Set(value.filter((item) => Number.isInteger(item) && item >= 0 && item < path.length))]
        : [];
    const serialized = JSON.stringify(bounded);
    if (serialized.length > MAX_PROGRESS_JSON_CHARS) return false;
    appStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
};
const getProgress = () => readStoredList(progressKey);
const showProgressStorageError = () => {
  progressStatus.textContent = "Progress could not be saved in this browser.";
};
const clearProgressStorageError = () => {
  progressStatus.textContent = "";
};
const dialog = document.querySelector("#note-dialog");
let lastNoteTrigger = null;

function openNote(note, { updateUrl = true } = {}) {
  if (!note || !noteDetails[note.id]) return;
  const detail = noteDetails[note.id];
  document.querySelector("#dialog-kicker").textContent = `${note.number} / ${note.tag}`;
  document.querySelector("#dialog-title").textContent = note.title;
  document.querySelector("#dialog-question").textContent = note.question;
  document.querySelector("#dialog-summary").textContent = detail[0];
  document.querySelector("#dialog-build").textContent = detail[1];
  document.querySelector("#dialog-next").textContent = detail[2];
  if (updateUrl) history.pushState({}, "", `#note=${encodeURIComponent(note.id)}`);
  if (!dialog.open) dialog.showModal();
  document.querySelector("#dialog-close").focus();
}

function openNoteFromLocation() {
  const match = location.hash.match(/^#note=([^&]+)/);
  if (!match) {
    if (dialog.open) dialog.close();
    return;
  }
  let noteId;
  try {
    noteId = decodeURIComponent(match[1]);
  } catch {
    if (dialog.open) dialog.close();
    return;
  }
  const note = notes.find((item) => item.id === noteId);
  if (!note) {
    if (dialog.open) dialog.close();
    return;
  }
  openNote(note, { updateUrl: false });
}

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
          <a class="open-note" href="#note=${encodeURIComponent(note.id)}" data-open-note="${note.id}">open note <span>↗</span></a>
          <a class="note-source" href="./notes/${encodeURIComponent(note.id)}.md" target="_blank" rel="noopener">markdown</a>
          <button class="copy-note" data-copy-note="${note.id}" aria-label="Copy link to ${note.title}">copy link</button>
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
  const done = readStoredList(pathProgressKey);
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
document.addEventListener("click", async (event) => {
  const noteButton = event.target.closest(".mark-done");
  if (noteButton) {
    const current = getProgress();
    const id = noteButton.dataset.note;
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    if (writeStoredList(progressKey, next)) clearProgressStorageError();
    else showProgressStorageError();
    renderNotes();
  }
  const dayButton = event.target.closest(".path-check");
  if (dayButton) {
    const current = readStoredList(pathProgressKey);
    const day = Number(dayButton.dataset.day);
    const next = current.includes(day) ? current.filter((item) => item !== day) : [...current, day];
    if (writeStoredList(pathProgressKey, next)) clearProgressStorageError();
    else showProgressStorageError();
    renderPath();
  }
  const openButton = event.target.closest(".open-note");
  if (openButton) {
    event.preventDefault();
    lastNoteTrigger = openButton;
    const note = notes.find((item) => item.id === openButton.dataset.openNote);
    openNote(note);
  }
  const copyButton = event.target.closest(".copy-note");
  if (copyButton) {
    const shareUrl = new URL(location.href);
    shareUrl.hash = `note=${encodeURIComponent(copyButton.dataset.copyNote)}`;
    const feedback = document.querySelector("#share-status");
    try {
      if (!navigator.clipboard) throw new Error("Copy is unavailable in this browser.");
      await navigator.clipboard.writeText(shareUrl.toString());
      feedback.textContent = "Note link copied.";
    } catch (error) {
      feedback.textContent = error instanceof Error ? error.message : "The note link could not be copied.";
    }
    setTimeout(() => { feedback.textContent = ""; }, 4000);
  }
});
document.querySelector("#dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener("close", () => {
  if (location.hash.startsWith("#note=")) history.pushState({}, "", "#map");
  if (lastNoteTrigger?.isConnected) lastNoteTrigger.focus();
  lastNoteTrigger = null;
});
window.addEventListener("hashchange", openNoteFromLocation);
window.addEventListener("popstate", openNoteFromLocation);
document.querySelector("#reset-progress").addEventListener("click", () => {
  try {
    appStorage.removeItem(progressKey);
    appStorage.removeItem(pathProgressKey);
    clearProgressStorageError();
  } catch {
    showProgressStorageError();
  }
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
document.querySelector("#share-wiki").addEventListener("click", async () => {
  const shareUrl = new URL(location.href);
  const noteHash = location.hash.match(/^#note=[^&]+/i)?.[0];
  shareUrl.hash = noteHash || "workbench";
  let sharedNote = null;
  if (noteHash) {
    try {
      sharedNote = notes.find((note) => note.id === decodeURIComponent(noteHash.slice("#note=".length))) || null;
    } catch {
      sharedNote = null;
    }
  }
  const shareData = {
    title: sharedNote ? `${sharedNote.title} · LLM Field Notes` : "LLM Field Notes",
    text: sharedNote ? sharedNote.question : "Turn documents into an inspectable, evolving knowledge graph.",
    url: shareUrl.toString()
  };
  const feedback = document.querySelector("#share-status");
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      feedback.textContent = "Share sheet opened.";
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareUrl.toString());
      feedback.textContent = "Link copied.";
    } else {
      throw new Error("Sharing is unavailable in this browser.");
    }
  } catch (error) {
    if (error?.name !== "AbortError") feedback.textContent = error instanceof Error ? error.message : "Sharing is unavailable in this browser.";
  }
  setTimeout(() => { feedback.textContent = ""; }, 5000);
});

renderNotes();
renderPath();
openNoteFromLocation();

// --- Knowledge workbench ---------------------------------------------------
// This is intentionally provider-agnostic. The local extractor gives the UI a
// useful first pass today; a future model adapter can replace extractGraph()
// without changing the graph schema, renderer, or export formats.
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_FILES = 100;
const MAX_BATCH_CHARS = 10 * 1024 * 1024;
const LEARNING_NOTE_TIMEOUT_MS = 10000;
const MAX_MARKDOWN_PREVIEW_EVIDENCE_CHARS = 250000;
const MAX_SEARCH_TEXT_CHARS = 12000;
const MAX_SEARCH_EVIDENCE_CHARS = 2000;
const MAX_RENDERED_GRAPH_NODES = 250;
const MAX_RENDERED_GRAPH_EDGES = 500;
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
const graphStore = createGraphStore(appStorage);
const extractorEndpointInput = document.querySelector("#extractor-endpoint");
const privacyNote = document.querySelector("#privacy-note");
const cancelExtractionButton = document.querySelector("#cancel-extraction");
let activeExtractionController = null;
let activeBuildController = null;
window.addEventListener("storage", (event) => {
  if (!hasPersistentStorage || (event.storageArea && event.storageArea !== appStorage)) return;
  if (event.key === progressKey || event.key === pathProgressKey) {
    renderNotes();
    renderPath();
    return;
  }
  if (event.key !== GRAPH_KEY) return;
  renderWorkbench();
  document.querySelector("#ingest-status").textContent = "Graph updated in another tab; this view was refreshed.";
});
browserStorage.subscribe((event) => {
  if (event.type === "status") {
    hasDurableStorage = event.durable;
    storageDurabilityFailure = event.storageFailure;
    progressStatus.textContent = event.storageFailure
      ? "Browser storage reported a save failure; progress may not persist."
      : "";
    updatePrivacyNote();
    renderWorkbench();
    return;
  }
  if (event.external && (event.key === progressKey || event.key === pathProgressKey)) {
    renderNotes();
    renderPath();
    return;
  }
  if (!event.external || event.key !== GRAPH_KEY) return;
  renderWorkbench();
  document.querySelector("#ingest-status").textContent = "Graph updated in another tab; this view was refreshed.";
});
function updatePrivacyNote() {
  const storageNote = storageDurabilityFailure
    ? "Durable browser storage is unavailable; export a backup before leaving this tab."
    : hasPersistentStorage
    ? hasDurableStorage
      ? "The graph remains in durable browser storage; do not configure secrets in this page."
      : "The graph remains in browser storage; do not configure secrets in this page."
    : "Browser storage is unavailable, so this graph will last only until this tab is reloaded.";
  privacyNote.textContent = extractorEndpointInput.value.trim()
    ? `Documents, optional source URI, and bounded reviewed feedback will be sent to the configured same-origin extractor endpoint. ${storageNote}`
    : `No document extraction call while the extractor endpoint is blank. ${storageNote}${hasPersistentStorage ? " The app may request persistent storage to reduce eviction risk." : ""}`;
}
extractorEndpointInput.addEventListener("input", updatePrivacyNote);
updatePrivacyNote();
async function runRemoteExtraction(extractor, document, feedback) {
  const controller = new AbortController();
  activeExtractionController = controller;
  const buildSignal = activeBuildController?.signal;
  const abortFromBuild = () => controller.abort();
  if (buildSignal) {
    if (buildSignal.aborted) controller.abort();
    else buildSignal.addEventListener("abort", abortFromBuild, { once: true });
  }
  try {
    return await extractor(document, { feedback, signal: controller.signal });
  } finally {
    buildSignal?.removeEventListener("abort", abortFromBuild);
    if (activeExtractionController === controller) activeExtractionController = null;
  }
}
cancelExtractionButton.addEventListener("click", () => {
  activeBuildController?.abort();
  activeExtractionController?.abort();
});
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
function createGraphSearchIndex(graph) {
  const documentTitleMap = new Map(graph.documents.map((document) => [document.id, document]));
  const nodeTextCache = new Map();
  const edgeTextCache = new Map();
  const evidenceText = (evidence) => evidence
    .slice(0, 8)
    .map((item) => item.text.slice(0, MAX_SEARCH_EVIDENCE_CHARS))
    .join(" ");
  const sourceTitles = (sources) => sources.map((sourceId) => {
    const document = documentTitleMap.get(sourceId);
    return document ? `${document.title || sourceId} ${document.uri || ""} ${document.quality || ""} ${document.lastReviewedAt || ""}` : sourceId;
  }).join(" ");
  const nodeText = (node) => {
    if (nodeTextCache.has(node)) return nodeTextCache.get(node);
    const text = [
      node.label,
      ...(node.aliases || []),
      node.type,
      sourceTitles(node.sources),
      evidenceText(node.evidence)
    ].join(" ").slice(0, MAX_SEARCH_TEXT_CHARS).toLowerCase();
    nodeTextCache.set(node, text);
    return text;
  };
  const edgeText = (edge, nodeName) => {
    if (edgeTextCache.has(edge)) return edgeTextCache.get(edge);
    const text = [
      nodeName(edge.source),
      edge.label,
      nodeName(edge.target),
      edge.status,
      sourceTitles(edge.sources),
      evidenceText(edge.evidence)
    ].join(" ").slice(0, MAX_SEARCH_TEXT_CHARS).toLowerCase();
    edgeTextCache.set(edge, text);
    return text;
  };
  return { documentTitleMap, nodeText, edgeText };
}
function getVisibleNodes(graph, searchIndex = createGraphSearchIndex(graph)) {
  const query = graphSearchQuery.toLowerCase().trim();
  return graph.nodes.filter((node) => {
    if (node.status === "rejected") return false;
    if (!query) return true;
    return searchIndex.nodeText(node).includes(query);
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
    const mergeTargets = graph.nodes.filter((candidate) => candidate.id !== node.id).sort((left, right) => left.label.localeCompare(right.label));
    const feedbackActions = node.status === "rejected"
      ? `<button data-inspector-feedback="restore" data-node-id="${escapeHtml(node.id)}">↺ restore</button>`
      : `<button data-inspector-feedback="up" data-node-id="${escapeHtml(node.id)}">+ confirm</button><button data-inspector-feedback="down" data-node-id="${escapeHtml(node.id)}">− dismiss</button>`;
    panel.innerHTML = `
      <div class="inspector-header"><span>CONCEPT / ${escapeHtml(node.status.toUpperCase())}</span><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.type)} · ${(node.confidence * 100).toFixed(0)}% confidence · ${node.mentions} mention${node.mentions === 1 ? "" : "s"} · ${node.feedback} feedback${node.feedback === 1 ? "" : "s"}${node.lastReviewedAt ? ` · reviewed ${escapeHtml(node.lastReviewedAt)}` : ""}${node.aliases?.length ? ` · aliases: ${node.aliases.map(escapeHtml).join(", ")}` : ""}</small></div>
      <div class="inspector-feedback"><span class="inspector-label">REVIEW DECISION</span><div>${feedbackActions}</div></div>
      <div class="inspector-edit"><label for="inspector-node-label">EDIT LABEL</label><div><input id="inspector-node-label" class="inspector-edit-input" value="${escapeHtml(node.label)}" maxlength="120" /><button data-edit-node="${escapeHtml(node.id)}">save</button></div></div>
      ${mergeTargets.length ? `<div class="inspector-merge"><label for="inspector-merge-target">MERGE INTO</label><div><select id="inspector-merge-target" class="inspector-edit-input">${mergeTargets.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.label)}</option>`).join("")}</select><button data-merge-node="${escapeHtml(node.id)}">merge</button></div><small>Keep the selected concept as the stable ID; evidence, aliases, and relations will be combined. This can be undone.</small></div>` : ""}
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
    const qualityOptions = [...SOURCE_QUALITIES].map((quality) => `<option value="${quality}"${source.quality === quality ? " selected" : ""}>${quality}</option>`).join("");
    const reviewedDate = source.lastReviewedAt ? source.lastReviewedAt.slice(0, 10) : "";
    panel.innerHTML = `
      <div class="inspector-header"><span>SOURCE DOCUMENT</span><strong>${escapeHtml(source.title)}</strong><small>${source.text.length.toLocaleString()} characters · added ${escapeHtml(source.addedAt)} · ${escapeHtml(source.quality)} quality${source.lastReviewedAt ? ` · reviewed ${escapeHtml(source.lastReviewedAt)}` : ""}${source.uri ? ` · ${/^https?:\/\//i.test(source.uri) ? `<a href="${escapeHtml(source.uri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.uri)}</a>` : escapeHtml(source.uri)}` : ""}</small></div>
      <div class="inspector-edit"><label for="inspector-source-title">EDIT SOURCE TITLE</label><div><input id="inspector-source-title" class="inspector-edit-input" value="${escapeHtml(source.title)}" maxlength="200" /></div><label for="inspector-source-uri">SOURCE URI</label><div><input id="inspector-source-uri" class="inspector-edit-input" value="${escapeHtml(source.uri || "")}" maxlength="${MAX_SOURCE_URI_CHARS}" inputmode="url" /></div><label for="inspector-source-quality">SOURCE QUALITY</label><div><select id="inspector-source-quality" class="inspector-edit-input">${qualityOptions}</select></div><label for="inspector-source-reviewed">LAST REVIEWED</label><div><input id="inspector-source-reviewed" class="inspector-edit-input" type="date" value="${escapeHtml(reviewedDate)}" /><button data-edit-source="${escapeHtml(source.id)}">save</button></div></div>
      <button class="replace-source" data-replace-source="${escapeHtml(source.id)}">Replace source with a newer file</button>
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
  const feedbackActions = edge.status === "rejected"
    ? `<button data-inspector-feedback="restore" data-edge-id="${escapeHtml(edge.id)}">↺ restore</button>`
    : `<button data-inspector-feedback="up" data-edge-id="${escapeHtml(edge.id)}">+ confirm</button><button data-inspector-feedback="down" data-edge-id="${escapeHtml(edge.id)}">− dismiss</button>`;
  panel.innerHTML = `
  <div class="inspector-header"><span>RELATION / ${escapeHtml(edge.status.toUpperCase())}</span><strong>${escapeHtml(source?.label || edge.source)} <em>${escapeHtml(edge.label)}</em> ${escapeHtml(target?.label || edge.target)}</strong><small>${(edge.confidence * 100).toFixed(0)}% confidence · ${edge.feedback} feedback${edge.feedback === 1 ? "" : "s"} · ${edge.evidence.length} evidence item${edge.evidence.length === 1 ? "" : "s"}${edge.lastReviewedAt ? ` · reviewed ${escapeHtml(edge.lastReviewedAt)}` : ""}</small></div>
    <div class="inspector-feedback"><span class="inspector-label">REVIEW DECISION</span><div>${feedbackActions}</div></div>
    <div class="inspector-edit"><label for="inspector-edge-label">EDIT RELATION</label><div><input id="inspector-edge-label" class="inspector-edit-input" value="${escapeHtml(edge.label)}" maxlength="80" /><button data-edit-edge="${escapeHtml(edge.id)}">save</button></div></div>
    <div class="inspector-evidence"><span class="inspector-label">EVIDENCE</span>${edge.evidence.length ? `<ul>${edge.evidence.map(evidenceMarkup).join("")}</ul>` : "<p class=\"inspector-muted\">No evidence captured.</p>"}</div>`;
}

function renderWorkbenchUnsafe() {
  const graph = graphStore.read();
  const searchIndex = createGraphSearchIndex(graph);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const matchingNodes = getVisibleNodes(graph, searchIndex);
  const visibleNodes = matchingNodes.slice(0, MAX_RENDERED_GRAPH_NODES);
  const positions = fitGraphPositions(graph, visibleNodes);
  const positionById = new Map(positions.map((node) => [node.id, node]));
  const canvas = document.querySelector("#graph-canvas");
  const empty = document.querySelector("#graph-empty");
  const list = document.querySelector("#node-list");
  const relationList = document.querySelector("#relation-list");
  const undoButton = document.querySelector("#undo-graph");
  document.querySelector("#graph-version").textContent = `REV ${String(graph.version).padStart(3, "0")}`;
  const activeNodeIds = new Set(positions.map((node) => node.id));
  const activeEdges = graph.edges.filter((edge) => edge.status !== "rejected" && activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target)).slice(0, MAX_RENDERED_GRAPH_EDGES);
  const activeCount = graph.nodes.filter((node) => node.status !== "rejected").length;
  const renderHiddenNodes = Math.max(0, matchingNodes.length - positions.length);
  const health = inspectGraph(graph);
  const reviews = reviewQueue(graph, 15000);
  const sourceQualitySummary = Object.entries(health.sourceQuality).filter(([, count]) => count > 0).map(([quality, count]) => `${count} ${quality}`).join(", ") || "no source quality";
  document.querySelector("#graph-summary").textContent = graph.nodes.length ? `${positions.length}${graphSearchQuery ? `/${activeCount}` : ""} visible · ${activeEdges.length} relations · ${graph.documents.length} source${graph.documents.length === 1 ? "" : "s"}${graph.nodes.length - activeCount ? ` · ${graph.nodes.length - activeCount} dismissed` : ""}${graphSearchQuery && matchingNodes.length > positions.length ? ` · ${matchingNodes.length - positions.length} filtered` : ""}${renderHiddenNodes || graph.edges.length > MAX_RENDERED_GRAPH_EDGES ? " · refine search to inspect more" : ""}` : "No concepts yet — ingest a document to begin.";
  document.querySelector("#hero-node-count").textContent = positions.length;
  document.querySelector("#hero-edge-count").textContent = activeEdges.length;
  document.querySelector("#hero-source-count").textContent = graph.documents.length;
  const recoveryAvailable = Boolean(graphStore.readRecovery());
  const storageMode = graphStore.getLastWriteMode();
  const storageWarning = [
    storageMode === "without-history" || storageMode === "without-new-history" ? "Saved with reduced undo history" : "",
    storageDurabilityFailure ? `<small class="storage-warning">Durable storage unavailable</small><button type="button" data-storage-action="backup">download backup</button>` : ""
  ].filter(Boolean).join("");
  document.querySelector("#graph-health").innerHTML = `<span>HEALTH</span><small>${health.provenanceCoverage}% provenance</small><small>${health.sourceReviewCoverage}% sources reviewed</small><small>${health.reviewedItems} feedback decision${health.reviewedItems === 1 ? "" : "s"} in memory</small><small>learning: ${health.acceptedItems} accepted · ${health.rejectedItems} rejected · ${health.learningExamples} reusable</small>${health.learningExamples ? `<button type="button" data-learning-action="clear">forget reusable memory</button>` : ""}${health.redacted ? "<small class=\"privacy-warning\">redacted source content</small>" : ""}<small>quality: ${escapeHtml(sourceQualitySummary)}</small><small>${health.unsupportedNodes} unsupported concept${health.unsupportedNodes === 1 ? "" : "s"}</small><small>${health.unsupportedEdges} unsupported relation${health.unsupportedEdges === 1 ? "" : "s"}</small>${health.ambiguousLabels ? `<small>${health.ambiguousLabels} ambiguous concept label${health.ambiguousLabels === 1 ? "" : "s"}</small>` : ""}${reviews.length ? `<small>${reviews.length} review candidate${reviews.length === 1 ? "" : "s"}${health.staleReviewCandidates ? ` · ${health.staleReviewCandidates} stale` : ""}</small><button type="button" data-review-action="next">review next</button>` : ""}${health.orphanedSourceReferences ? `<small>${health.orphanedSourceReferences} broken source reference${health.orphanedSourceReferences === 1 ? "" : "s"}</small>` : ""}${health.ambiguousSourceIds ? `<small>${health.ambiguousSourceIds} ambiguous source ID${health.ambiguousSourceIds === 1 ? "" : "s"} — inspect import</small>` : ""}${health.ambiguousEdgeIds ? `<small>${health.ambiguousEdgeIds} ambiguous edge ID${health.ambiguousEdgeIds === 1 ? "" : "s"} — inspect import</small>` : ""}${health.ambiguousSourceReferences ? `<small>${health.ambiguousSourceReferences} ambiguous provenance reference${health.ambiguousSourceReferences === 1 ? "" : "s"}</small>` : ""}${storageWarning}${recoveryAvailable ? `<small class="recovery-warning">Recovery snapshot available</small><button type="button" data-recovery-action="download">download recovery</button><button type="button" data-recovery-action="dismiss">dismiss</button>` : ""}`;
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
  const matchingGraphNodes = graph.nodes.filter((node) => {
    if (!query) return true;
    return searchIndex.nodeText(node).includes(query);
  });
  const visibleGraphNodes = matchingGraphNodes.slice(0, MAX_RENDERED_GRAPH_NODES);
  list.innerHTML = visibleGraphNodes.map((node) => `<div class="node-row ${node.status === "rejected" ? "rejected" : ""}" data-node-id="${escapeHtml(node.id)}" tabindex="0" role="group" aria-label="Inspect concept ${escapeHtml(node.label)}"><div><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.type)} · ${node.status} · ${(node.confidence * 100).toFixed(0)}% confidence · ${node.mentions} mention${node.mentions === 1 ? "" : "s"} · ${node.feedback} feedback</small></div><div class="node-feedback">${node.status === "rejected" ? `<button data-feedback="restore" data-node-id="${escapeHtml(node.id)}" aria-label="Restore ${escapeHtml(node.label)}">↺ restore</button>` : `<button data-feedback="up" data-node-id="${escapeHtml(node.id)}" aria-label="Confirm ${escapeHtml(node.label)}">+ confirm</button><button data-feedback="down" data-node-id="${escapeHtml(node.id)}" aria-label="Dismiss ${escapeHtml(node.label)}">− dismiss</button>`}</div></div>`).join("");
  const nodeName = (id) => nodeById.get(id)?.label || id;
  const matchingGraphEdges = graph.edges.filter((edge) => {
    if (!query) return true;
    return searchIndex.edgeText(edge, nodeName).includes(query);
  });
  const visibleGraphEdges = matchingGraphEdges.slice(0, MAX_RENDERED_GRAPH_EDGES);
  relationList.innerHTML = visibleGraphEdges.map((edge) => {
    const relationName = `${nodeName(edge.source)} ${edge.label} ${nodeName(edge.target)}`;
    return `<div class="relation-row ${edge.status === "rejected" ? "rejected" : ""}" data-edge-id="${escapeHtml(edge.id)}" tabindex="0" role="group" aria-label="Inspect relation ${escapeHtml(relationName)}"><div><strong>${escapeHtml(nodeName(edge.source))} <span>${escapeHtml(edge.label)}</span> ${escapeHtml(nodeName(edge.target))}</strong><small>${edge.status} · ${(edge.confidence * 100).toFixed(0)}% confidence · ${edge.feedback} feedback · ${edge.evidence.length} evidence item${edge.evidence.length === 1 ? "" : "s"}</small></div><div class="node-feedback">${edge.status === "rejected" ? `<button data-edge-feedback="restore" data-edge-id="${escapeHtml(edge.id)}" aria-label="Restore relation ${escapeHtml(relationName)}">↺ restore</button>` : `<button data-edge-feedback="up" data-edge-id="${escapeHtml(edge.id)}" aria-label="Confirm relation ${escapeHtml(relationName)}">+ confirm</button><button data-edge-feedback="down" data-edge-id="${escapeHtml(edge.id)}" aria-label="Dismiss relation ${escapeHtml(relationName)}">− dismiss</button>`}</div></div>`;
  }).join("");
  const manualNodes = graph.nodes
    .filter((node) => node.status !== "rejected" && (!query || searchIndex.nodeText(node).includes(query)))
    .slice(0, MAX_RENDERED_GRAPH_NODES);
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
  const projectionFingerprint = fingerprintBackup(graph);
  const projection = buildMarkdown(graph, { maxEvidenceChars: MAX_MARKDOWN_PREVIEW_EVIDENCE_CHARS, graphFingerprint: projectionFingerprint });
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

const safeMarkdownLabel = (value) => String(value).replace(/[\[\]\r\n]/g, " ").replace(/\s+/g, " ").trim();
const safeMarkdownUri = (value) => {
  const uri = String(value).replace(/[\r\n<>]/g, "").trim();
  if (!/^https?:\/\//i.test(uri)) return safeMarkdownLabel(uri);
  return `[${safeMarkdownLabel(uri)}](<${uri}>)`;
};
const quoteMarkdown = (value) => String(value).replace(/\r\n?/g, "\n").split("\n").map((line) => `> ${line}`).join("\n");

function buildMarkdown(graph, { maxEvidenceChars = Number.POSITIVE_INFINITY, graphFingerprint = fingerprintBackup(graph) } = {}) {
  const MAX_MARKDOWN_EXPORT_EVIDENCE_CHARS = 40 * 1024 * 1024;
  const paths = buildProjectionPaths(graph);
  const sourceById = new Map(graph.documents.map((doc) => [doc.id, doc]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const sourceLabel = (id) => safeMarkdownLabel(sourceById.get(id)?.title || id);
  const nodeLabel = (id) => safeMarkdownLabel(nodeById.get(id)?.label || id);
  const conceptLink = (id) => paths.nodes.has(id) ? `[[${paths.nodes.get(id)}|${nodeLabel(id)}]]` : `[[${nodeLabel(id)}]]`;
  const sourceLink = (id) => paths.sources.has(id) ? `[[${paths.sources.get(id)}|${sourceLabel(id)}]]` : `[[${sourceLabel(id)}]]`;
  const revisionLines = graph.revisions.length
    ? graph.revisions.map((revision) => `- v${revision.version} · ${revision.timestamp} · ${safeMarkdownLabel(revision.reason)} · ${revision.nodes} concepts · ${revision.edges} relations`)
    : ["- none"];
  const learningLines = (graph.learning?.examples || []).map((example) => example.kind === "concept"
    ? `- concept: ${safeMarkdownLabel(example.label)} (${example.status}${example.aliases?.length ? `, aliases: ${example.aliases.map(safeMarkdownLabel).join(", ")}` : ""})`
    : `- relation: ${safeMarkdownLabel(example.sourceLabel || example.source)} — ${safeMarkdownLabel(example.label)} → ${safeMarkdownLabel(example.targetLabel || example.target)} (${example.status})`);
  const reviewed = [...graph.nodes, ...graph.edges].filter((item) => item.status !== "inferred" || item.feedback !== 0);
  const accepted = [...graph.nodes.filter((node) => node.status === "accepted").map((node) => `- concept: ${conceptLink(node.id)}`), ...graph.edges.filter((edge) => edge.status === "accepted").map((edge) => `- relation: ${conceptLink(edge.source)} — ${safeMarkdownLabel(edge.label)} → ${conceptLink(edge.target)}`)];
  const rejected = [...graph.nodes.filter((node) => node.status === "rejected").map((node) => `- concept: ${conceptLink(node.id)}`), ...graph.edges.filter((edge) => edge.status === "rejected").map((edge) => `- relation: ${conceptLink(edge.source)} — ${safeMarkdownLabel(edge.label)} → ${conceptLink(edge.target)}`)];
  const mermaidNodes = graph.nodes.slice(0, 150);
  const mermaidIds = new Map(mermaidNodes.map((node, index) => [node.id, `n${index}`]));
  const mermaidText = (value) => String(value).replace(/["\\\r\n[\]<>]/g, " ").replace(/\|/g, "/").slice(0, 120);
  const mermaidLines = [
    "```mermaid",
    "graph LR",
    ...(mermaidNodes.length ? mermaidNodes.map((node) => `  ${mermaidIds.get(node.id)}["${mermaidText(node.label)}"]`) : ['  empty["No concepts"]']),
    ...graph.edges
      .filter((edge) => mermaidIds.has(edge.source) && mermaidIds.has(edge.target))
      .slice(0, 300)
      .map((edge) => `  ${mermaidIds.get(edge.source)} -->|"${mermaidText(edge.label)}"| ${mermaidIds.get(edge.target)}`),
    "```"
  ];
  const evidenceLines = [];
  const evidenceLimit = Number.isFinite(maxEvidenceChars)
    ? Math.max(0, Math.floor(maxEvidenceChars))
    : MAX_MARKDOWN_EXPORT_EVIDENCE_CHARS;
  let evidenceChars = 0;
  let evidenceTruncated = false;
  const addEvidence = (line) => {
    if (evidenceChars + line.length > evidenceLimit) {
      evidenceTruncated = true;
      return;
    }
    evidenceLines.push(line);
    evidenceChars += line.length;
  };
  graph.nodes.forEach((node) => node.evidence.forEach((quote) => addEvidence(`${quoteMarkdown(quote.text)}\n>\n> — ${conceptLink(node.id)}${quote.sources?.length ? `\n> sources: ${quote.sources.map(sourceLink).join(", ")}` : ""}`)));
  graph.edges.forEach((edge) => edge.evidence.forEach((quote) => addEvidence(`${quoteMarkdown(quote.text)}\n>\n> — ${conceptLink(edge.source)} ${safeMarkdownLabel(edge.label)} ${conceptLink(edge.target)}${quote.sources?.length ? `\n> sources: ${quote.sources.map(sourceLink).join(", ")}` : ""}`)));
  if (evidenceTruncated) evidenceLines.push(`> [Evidence preview truncated at ${evidenceLimit.toLocaleString()} characters. Download the full Markdown, vault, or graph JSON export.]`);
  const lines = [
    "---",
    "type: knowledge-graph",
    `version: ${graph.version}`,
    `fingerprint: ${graphFingerprint}`,
    `updated: ${graph.updatedAt || "not yet"}`,
    `concepts: ${graph.nodes.length}`,
    `relations: ${graph.edges.length}`,
    `reviewed: ${reviewed.length}`,
    `accepted: ${accepted.length}`,
    `rejected: ${rejected.length}`,
    `learning: ${graph.learning?.examples.length || 0}`,
    `redacted: ${graph.redacted === true}`,
    "---",
    "",
    "# Knowledge Graph",
    "",
    "> An Obsidian-ready projection of the internal representation.",
    ...(graph.redacted ? ["> **Redacted projection:** source text, evidence quotes, and source URIs were removed before export."] : []),
    "",
    "## Sources",
    ...graph.documents.map((doc) => `- ${sourceLink(doc.id)} — ${doc.addedAt} · ${doc.quality} quality${doc.lastReviewedAt ? ` · reviewed ${doc.lastReviewedAt}` : ""}${doc.uri ? ` · ${safeMarkdownUri(doc.uri)}` : ""}`),
    "",
    "## Concept index",
    ...graph.nodes.map((node) => `- ${conceptLink(node.id)} — ${safeMarkdownLabel(node.type)}, ${node.status}, confidence ${(node.confidence * 100).toFixed(0)}%${node.aliases?.length ? `, aliases: ${node.aliases.map(safeMarkdownLabel).join(", ")}` : ""}`),
    "",
    "## Relations",
    ...graph.edges.map((edge) => `- ${conceptLink(edge.source)} — ${safeMarkdownLabel(edge.label)} → ${conceptLink(edge.target)} (${edge.status}, ${(edge.confidence * 100).toFixed(0)}%)`),
    "",
    "## Visual graph",
    "The bounded view below renders in Obsidian and Mermaid-compatible Markdown viewers.",
    "",
    ...mermaidLines,
    "",
    "## Learning ledger",
    `Reviewed decisions: ${reviewed.length}`,
    `Reusable learning examples: ${graph.learning?.examples.length || 0}`,
    "",
    "### Accepted",
    ...(accepted.length ? accepted : ["- none"]),
    "",
    "### Rejected",
    ...(rejected.length ? rejected : ["- none"]),
    "",
    "### Reusable memory",
    "These compact reviewed examples guide future extraction without carrying source evidence into provider requests.",
    ...(learningLines.length ? learningLines : ["- none"]),
    "",
    "## Revision history",
    "The bounded timeline records how human review and new evidence changed this representation.",
    ...revisionLines,
    "",
    "## Evidence",
    ...(evidenceLines.length ? evidenceLines : ["- none"])
  ];
  return lines.join("\n");
}

function buildFeedbackDataset(graph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeLabel = (id) => nodeById.get(id)?.label || id;
  const examples = [];
  const seen = new Set();
  const addExample = (example) => {
    const key = example.kind === "concept"
      ? `concept|${example.id}`
      : `relation|${example.id}`;
    if (seen.has(key)) {
      const index = examples.findIndex((candidate) => (
        (candidate.kind === "concept" ? `concept|${candidate.id}` : `relation|${candidate.id}`) === key
      ));
      if (index >= 0) examples[index] = { ...examples[index], ...example };
      return;
    }
    if (examples.length >= MAX_FEEDBACK_EXAMPLES) return;
    seen.add(key);
    examples.push({
      ...example,
      confidence: Number.isFinite(example.confidence) ? example.confidence : .5,
      feedback: Number.isInteger(example.feedback) ? example.feedback : 0,
      evidence: Array.isArray(example.evidence) ? example.evidence : [],
      sources: Array.isArray(example.sources) ? example.sources : []
    });
  };
  (graph.learning?.examples || []).forEach(addExample);
  graph.nodes
    .filter((node) => node.status === "accepted" || node.status === "rejected")
    .forEach((node) => addExample({
      kind: "concept",
      id: node.id,
      label: node.label,
      aliases: node.aliases || [],
      type: node.type,
      status: node.status,
      lastReviewedAt: node.lastReviewedAt || null,
      confidence: node.confidence,
      feedback: node.feedback,
      evidence: node.evidence,
      sources: node.sources
    }));
  graph.edges
    .filter((edge) => edge.status === "accepted" || edge.status === "rejected")
    .forEach((edge) => addExample({
      kind: "relation",
      id: edge.id,
      source: edge.source,
      sourceLabel: nodeLabel(edge.source),
      target: edge.target,
      targetLabel: nodeLabel(edge.target),
      label: edge.label,
      status: edge.status,
      lastReviewedAt: edge.lastReviewedAt || null,
      confidence: edge.confidence,
      feedback: edge.feedback,
      evidence: edge.evidence,
      sources: edge.sources
    }));
  return {
    format: FEEDBACK_FORMAT,
    graphSchema: GRAPH_SCHEMA,
    exportedAt: new Date().toISOString(),
    datasetFingerprint: fingerprintFeedbackExamples(examples),
    examples
  };
}

function buildCompactFeedbackDataset(graph) {
  const dataset = buildFeedbackDataset(graph);
  const examples = dataset.examples.map((example) => ({
    ...example,
    evidence: [],
    sources: []
  }));
  return {
    ...dataset,
    datasetFingerprint: fingerprintFeedbackExamples(examples),
    examples
  };
}

function safeFileName(value, fallback) {
  const fileName = slugify(String(value)).replace(/^-+|-+$/g, "");
  return fileName || fallback;
}

function buildProjectionPaths(graph) {
  const used = new Set();
  const allocate = (directory, value, fallback) => {
    const base = safeFileName(value, fallback);
    let path = `${directory}/${base}.md`;
    if (used.has(path)) {
      let suffix = 2166136261;
      for (const character of String(value)) {
        suffix ^= character.charCodeAt(0);
        suffix = Math.imul(suffix, 16777619);
      }
      const hash = (suffix >>> 0).toString(36).padStart(7, "0");
      path = `${directory}/${base}-${hash}.md`;
      let counter = 2;
      while (used.has(path)) path = `${directory}/${base}-${hash}-${counter++}.md`;
    }
    used.add(path);
    return path;
  };
  const nodes = new Map();
  const sources = new Map();
  const relations = new Map();
  graph.nodes.forEach((node) => nodes.set(node.id, allocate("Concepts", node.id, "concept")));
  graph.documents.forEach((doc) => sources.set(doc.id, allocate("Sources", doc.id, "source")));
  graph.edges.forEach((edge) => relations.set(edge, allocate("Relations", edge.id, "relation")));
  return { nodes, sources, relations };
}

function buildVaultFiles(graph) {
  const graphFingerprint = fingerprintBackup(graph);
  const paths = buildProjectionPaths(graph);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const sourceById = new Map(graph.documents.map((doc) => [doc.id, doc]));
  const nodeDisplay = (id) => safeMarkdownLabel(nodeById.get(id)?.label || id);
  const sourceDisplay = (id) => safeMarkdownLabel(sourceById.get(id)?.title || id);
  const relatedByNode = new Map(graph.nodes.map((node) => [node.id, []]));
  graph.edges.forEach((edge) => {
    relatedByNode.get(edge.source)?.push(edge);
    if (edge.target !== edge.source) relatedByNode.get(edge.target)?.push(edge);
  });
  const files = [];
  let estimatedArchiveBytes = 22;
  const addVaultFile = (file) => {
    const nameBytes = textEncoder.encode(file.name);
    const contentBytes = textEncoder.encode(file.content);
    estimatedArchiveBytes += 30 + nameBytes.length + contentBytes.length + 46 + nameBytes.length;
    if (estimatedArchiveBytes > MAX_ZIP_BYTES) throw new Error("The vault archive exceeds the 50 MB safety limit.");
    files.push(file);
  };
  addVaultFile({
    name: "README.md",
    content: [
      "# LLM Field Notes vault",
      "",
      "Open [[_index]] to browse the projected knowledge graph.",
      "",
      `This is a ${graph.redacted === true ? "redacted" : "full"} projection of the graph. ${graph.redacted === true ? "Source text, evidence quotes, and source URIs were removed before export." : "Source notes contain the ingested text and evidence used by the representation."}`,
      "",
      "## Review workflow",
      "",
      "1. Inspect concept and relation notes under `Concepts/` and `Relations/`.",
      "2. Edit exported concept or relation frontmatter and headings when a correction is needed.",
      "3. Import the edited notes back into LLM Field Notes to apply the correction and update reusable learning memory.",
      "",
      "## Source of truth",
      "",
      "This vault is an external projection, not a second graph database. Keep the browser graph JSON or full backup when you need complete recovery, history, or a round-trip restore.",
      "",
      "## Contents",
      "",
      "- [[_index]] — graph overview, evidence, learning ledger, and revision history.",
      "- [[Relations]] — relation-oriented browse view.",
      "- `Concepts/` — one editable note per concept.",
      "- `Relations/` — one editable note per relation.",
      "- `Sources/` — source documents and provenance metadata.",
      "- `Learning/` — public curriculum notes included with the wiki.",
      "- `graph.json` — normalized internal representation.",
      ""
    ].join("\n")
  });
  addVaultFile({ name: "_index.md", content: buildMarkdown(graph, { graphFingerprint }) });
  addVaultFile({
    name: "vault-manifest.json",
    content: JSON.stringify({
      format: VAULT_FORMAT,
      graphSchema: GRAPH_SCHEMA,
      graphVersion: graph.version,
      graphFingerprint,
      redacted: graph.redacted === true,
      generatedAt: new Date().toISOString()
    }, null, 2)
  });
  addVaultFile({ name: "Relations.md", content: [
      "---",
      "type: relations",
      `graph_version: ${graph.version}`,
      "---",
      "",
      "# Relations",
      "",
      ...graph.edges.flatMap((edge) => [
        `## ${nodeDisplay(edge.source)} ${safeMarkdownLabel(edge.label)} ${nodeDisplay(edge.target)}`,
        "",
        `- From: [[${paths.nodes.get(edge.source)}|${nodeDisplay(edge.source)}]]`,
        `- To: [[${paths.nodes.get(edge.target)}|${nodeDisplay(edge.target)}]]`,
        `- Status: ${edge.status}`,
        `- Confidence: ${(edge.confidence * 100).toFixed(0)}%`,
        "",
        ...edge.evidence.map((evidence) => `${quoteMarkdown(evidence.text)}${evidence.sources?.length ? `\n>\n> sources: ${evidence.sources.map((sourceId) => sourceById.has(sourceId) ? `[[${paths.sources.get(sourceId)}|${sourceDisplay(sourceId)}]]` : safeMarkdownLabel(sourceId)).join(", ")}` : ""}`),
        ""
      ])
    ].join("\n") });
  addVaultFile({ name: "graph.json", content: JSON.stringify(graph, null, 2) });
  graph.nodes.forEach((node) => {
    const related = relatedByNode.get(node.id) || [];
    addVaultFile({
      name: paths.nodes.get(node.id),
      content: [
        "---",
        "type: concept",
        `id: ${JSON.stringify(node.id)}`,
        `label: ${JSON.stringify(node.label)}`,
        `status: ${node.status}`,
        `last_reviewed: ${node.lastReviewedAt || ""}`,
        `graph_version: ${graph.version}`,
        `graph_fingerprint: ${graphFingerprint}`,
        `aliases: ${JSON.stringify(node.aliases || [])}`,
        `confidence: ${node.confidence.toFixed(3)}`,
        `mentions: ${node.mentions}`,
        `feedback: ${node.feedback}`,
        "---",
        "",
        `# ${safeMarkdownLabel(node.label)}`,
        "",
        `Confidence: **${(node.confidence * 100).toFixed(0)}%** · ${node.mentions} mention${node.mentions === 1 ? "" : "s"}`,
        "",
        "## Sources",
        ...node.sources.map((sourceId) => `- ${sourceById.has(sourceId) ? `[[${paths.sources.get(sourceId)}|${sourceDisplay(sourceId)}]]` : safeMarkdownLabel(sourceId)}`),
        "",
        "## Evidence",
        ...node.evidence.map((evidence) => `${quoteMarkdown(evidence.text)}${evidence.sources?.length ? `\n>\n> sources: ${evidence.sources.map((sourceId) => sourceById.has(sourceId) ? `[[${paths.sources.get(sourceId)}|${sourceDisplay(sourceId)}]]` : safeMarkdownLabel(sourceId)).join(", ")}` : ""}`),
        "",
        "## Relations",
        ...related.map((edge) => {
          const otherId = edge.source === node.id ? edge.target : edge.source;
          return `- ${safeMarkdownLabel(edge.label)} → [[${paths.nodes.get(otherId)}|${nodeDisplay(otherId)}]] (${edge.status}, ${(edge.confidence * 100).toFixed(0)}%)`;
        }),
        ""
      ].join("\n")
    });
  });
  graph.edges.forEach((edge) => {
    addVaultFile({
      name: paths.relations.get(edge),
      content: [
        "---",
        "type: relation",
        `id: ${JSON.stringify(edge.id)}`,
        `label: ${JSON.stringify(edge.label)}`,
        `source: ${JSON.stringify(edge.source)}`,
        `target: ${JSON.stringify(edge.target)}`,
        `status: ${edge.status}`,
        `last_reviewed: ${edge.lastReviewedAt || ""}`,
        `graph_version: ${graph.version}`,
        `graph_fingerprint: ${graphFingerprint}`,
        `feedback: ${edge.feedback}`,
        "---",
        "",
        `# ${nodeDisplay(edge.source)} ${safeMarkdownLabel(edge.label)} ${nodeDisplay(edge.target)}`,
        "",
        `- From: [[${paths.nodes.get(edge.source)}|${nodeDisplay(edge.source)}]]`,
        `- To: [[${paths.nodes.get(edge.target)}|${nodeDisplay(edge.target)}]]`,
        ""
      ].join("\n")
    });
  });
  graph.documents.forEach((doc) => {
    addVaultFile({
      name: paths.sources.get(doc.id),
      content: ["---", "type: source", `id: ${JSON.stringify(doc.id)}`, `uri: ${JSON.stringify(doc.uri || "")}`, `added: ${doc.addedAt}`, `quality: ${doc.quality}`, `last_reviewed: ${doc.lastReviewedAt || ""}`, `graph_version: ${graph.version}`, `graph_fingerprint: ${graphFingerprint}`, `redacted: ${graph.redacted === true}`, "---", "", `# ${safeMarkdownLabel(doc.title)}`, "", ...(doc.uri ? [`Source URI: ${safeMarkdownUri(doc.uri)}`, ""] : []), ...(graph.redacted ? ["> Source content was redacted before this vault was exported."] : [doc.text]), ""].join("\n")
    });
  });
  Object.defineProperty(files, "estimatedArchiveBytes", {
    value: estimatedArchiveBytes,
    enumerable: false
  });
  return files;
}

async function buildLearningVaultFiles({ estimatedArchiveBytes = 22 } = {}) {
  const files = [];
  const failures = [];
  let totalChars = 0;
  for (const note of notes) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LEARNING_NOTE_TIMEOUT_MS);
    try {
      const response = await fetch(`./notes/${encodeURIComponent(note.id)}.md`, { cache: "no-cache", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const content = await response.text();
      if (content.length > 1_000_000) throw new Error("note exceeds the 1 MB safety limit");
      totalChars += content.length;
      if (totalChars > 10 * 1024 * 1024) throw new Error("learning notes exceed the 10 MB safety limit");
      const file = { name: `Learning/${note.id}.md`, content };
      const nameBytes = textEncoder.encode(file.name);
      const contentBytes = textEncoder.encode(file.content);
      estimatedArchiveBytes += 30 + nameBytes.length + contentBytes.length + 46 + nameBytes.length;
      if (estimatedArchiveBytes > MAX_ZIP_BYTES) {
        throw Object.assign(new Error("The vault archive exceeds the 50 MB safety limit."), { code: "VAULT_TOO_LARGE" });
      }
      files.push(file);
    } catch (error) {
      if (error?.code === "VAULT_TOO_LARGE") throw error;
      failures.push(`${note.id}: ${error?.name === "AbortError" ? "request timed out" : error instanceof Error ? error.message : "could not load"}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { files, failures };
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
function zipStore(files, maxBytes = MAX_ZIP_BYTES) {
  let estimatedArchiveBytes = 22;
  files.forEach((file) => {
    const nameBytes = textEncoder.encode(file.name);
    const contentBytes = textEncoder.encode(file.content);
    estimatedArchiveBytes += 30 + nameBytes.length + contentBytes.length + 46 + nameBytes.length;
    if (estimatedArchiveBytes > maxBytes) throw new Error("The vault archive exceeds the 50 MB safety limit.");
  });
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let centralLength = 0;
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
    const nextOffset = offset + local.length + data.length;
    const nextCentralLength = centralLength + central.length;
    if (nextOffset + nextCentralLength + 22 > maxBytes) throw new Error("The vault archive exceeds the 50 MB safety limit.");
    localParts.push(local, data);
    centralParts.push(central);
    offset = nextOffset;
    centralLength = nextCentralLength;
  });
  const centralDirectory = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  putUint32(endView, 0, 0x06054b50);
  putUint16(endView, 8, files.length);
  putUint16(endView, 10, files.length);
  putUint32(endView, 12, centralDirectory.length);
  putUint32(endView, 16, offset);
  const archiveLength = offset + centralDirectory.length + end.length;
  if (archiveLength > maxBytes) throw new Error("The vault archive exceeds the 50 MB safety limit.");
  return concatBytes([...localParts, centralDirectory, end]);
}

function downloadFile(filename, content, type) {
  if (textEncoder.encode(content).byteLength > MAX_EXPORT_BYTES) throw new Error("This export exceeds the 50 MB safety limit.");
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
function exportBackupSnapshot() {
  let graph = graphStore.read();
  const history = graphStore.readHistory();
  const backup = {
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    graph,
    history,
    graphFingerprint: fingerprintBackup(graph, history)
  };
  downloadFile("llm-field-notes-backup.json", JSON.stringify(backup, null, 2), "application/json");
  return backup;
}

document.querySelector("#load-sample").addEventListener("click", () => {
  pendingFiles = [];
  document.querySelector("#document-file").value = "";
  renderFileQueue();
  document.querySelector("#document-title").value = sampleDocument.title;
  document.querySelector("#document-uri").value = "";
  document.querySelector("#document-input").value = sampleDocument.text;
  document.querySelector("#ingest-status").textContent = "Sample loaded. Build the graph when ready.";
});
function startSampleWalkthrough() {
  loadSampleButton.click();
  document.querySelector("#workbench").scrollIntoView({ behavior: "smooth", block: "start" });
  ingestButton.click();
}
document.querySelector("#graph-health").addEventListener("click", (event) => {
  const storageAction = event.target.closest("[data-storage-action]")?.dataset.storageAction;
  if (storageAction === "backup") {
    try {
      const backup = exportBackupSnapshot();
      document.querySelector("#ingest-status").textContent = `Backup downloaded · ${backup.history.length} undo snapshot${backup.history.length === 1 ? "" : "s"}.`;
    } catch (error) {
      document.querySelector("#ingest-status").textContent = error instanceof Error ? error.message : "The backup could not be exported.";
    }
    return;
  }
  const learningAction = event.target.closest("[data-learning-action]")?.dataset.learningAction;
  if (learningAction === "clear") {
    if (!window.confirm("Forget reusable learning memory? Your documents and graph knowledge will remain.")) return;
    const currentGraph = graphStore.read();
    const result = clearLearningMemory(currentGraph);
    if (!result.changed) {
      if (result.limited === "version") document.querySelector("#ingest-status").textContent = "This graph has reached its revision limit. Export a backup before changing reusable memory.";
      return;
    }
    if (!graphStore.write(result.graph, { expectedVersion: currentGraph.version })) {
      document.querySelector("#ingest-status").textContent = graphStore.getLastWriteMode() === "conflict"
        ? "The graph changed in another tab. Reusable memory was not cleared; reload and try again."
        : "Reusable memory could not be cleared.";
      return;
    }
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = `Forgot ${result.removed} reusable learning example${result.removed === 1 ? "" : "s"}.`;
    return;
  }
  const reviewAction = event.target.closest("[data-review-action]")?.dataset.reviewAction;
  if (reviewAction === "next") {
    const candidate = reviewQueue(graphStore.read(), 1)[0];
    if (!candidate) return;
    if (candidate.kind === "node") selectGraphNode(candidate.id);
    else if (candidate.kind === "edge") selectGraphEdge(candidate.id);
    else selectSource(candidate.id);
    document.querySelector(".mini-button[data-view='list']").click();
    document.querySelector("#ingest-status").textContent = `Review next · ${candidate.reason}.`;
    return;
  }
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
  const currentGraph = graphStore.read();
  const hasSavedState = currentGraph.nodes.length
    || currentGraph.edges.length
    || currentGraph.documents.length
    || currentGraph.learning?.examples?.length;
  if (!hasSavedState || window.confirm("Clear this browser's saved graph and reusable learning memory?")) {
    if (graphStore.clear({ expectedVersion: currentGraph.version })) {
      renderWorkbench();
      status.textContent = "Local graph cleared.";
    } else {
      status.textContent = graphStore.getLastWriteMode() === "conflict"
        ? "The graph changed in another tab. It was not cleared; reload and try again."
        : "The local graph could not be cleared.";
    }
  }
});
document.querySelector("#undo-graph").addEventListener("click", () => {
  const status = document.querySelector("#ingest-status");
  const currentGraph = graphStore.read();
  if (!graphStore.undo({ expectedVersion: currentGraph.version })) {
    status.textContent = graphStore.getLastWriteMode() === "conflict"
      ? "The graph changed in another tab. Nothing was undone; reload and try again."
      : "There is no saved change to undo.";
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
    document.querySelector("#document-uri").value = "";
    if (files.length > MAX_BATCH_FILES) throw new Error(`Select no more than ${MAX_BATCH_FILES} files per batch.`);
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
        if (Number.isFinite(file.size) && file.size > MAX_IMPORT_BYTES) throw new Error("That JSON import exceeds the 10 MB safety limit.");
        const expectedVersion = graphStore.read().version;
      const text = await file.text();
      const imported = JSON.parse(text);
      if (imported.format === FEEDBACK_FORMAT) {
        if (imported.graphSchema !== GRAPH_SCHEMA || !Array.isArray(imported.examples)) throw new Error("That feedback file is not compatible with this graph.");
        if (imported.datasetFingerprint !== undefined
          && imported.datasetFingerprint !== fingerprintFeedbackExamples(imported.examples)) {
          throw new Error("That feedback file's dataset fingerprint does not match its examples.");
        }
        const result = applyFeedbackDataset(graphStore.read(), imported.examples);
        if (!result.changed && !result.conflicts) throw new Error("No matching reviewed concepts or relations were found in that feedback dataset.");
        if (!result.changed && result.conflicts) {
          status.textContent = `Feedback dataset contained ${result.conflicts} contradictory decision${result.conflicts === 1 ? "" : "s"} but made no graph changes.`;
          pendingFiles = [];
          document.querySelector("#document-file").value = "";
          renderFileQueue();
          return;
        }
        if (!graphStore.write(result.graph, { expectedVersion })) {
          throw new Error(graphStore.getLastWriteMode() === "conflict"
            ? "The graph changed in another tab while feedback was loading. The feedback was not written."
            : "The feedback dataset could not be saved in this browser.");
        }
        renderWorkbench();
        status.textContent = `Feedback dataset imported · ${result.updates} reviewed item${result.updates === 1 ? "" : "s"} applied${result.learned ? ` · ${result.learned} reusable learning example${result.learned === 1 ? "" : "s"} retained` : ""}${result.skipped ? ` · ${result.skipped} unmatched or invalid example${result.skipped === 1 ? "" : "s"} skipped` : ""}${result.conflicts ? ` · ${result.conflicts} contradictory decision${result.conflicts === 1 ? "" : "s"} detected; later decisions retained` : ""}.`;
        pendingFiles = [];
        document.querySelector("#document-file").value = "";
        renderFileQueue();
        return;
      }
      if (imported.format === BACKUP_FORMAT) {
        if (!imported.graph || (imported.graph.schema !== GRAPH_SCHEMA && !LEGACY_GRAPH_SCHEMAS.has(imported.graph.schema))) throw new Error("That backup does not contain a valid graph.");
        if (imported.graphFingerprint !== undefined
          && imported.graphFingerprint !== fingerprintBackup(imported.graph, imported.history)) {
          throw new Error("That backup's fingerprint does not match its graph and history.");
        }
        const importedGraph = normalizeGraph(imported.graph);
        const importedHistory = asArray(imported.history);
        const currentGraph = graphStore.read();
        const currentHasContent = currentGraph.nodes.length
          || currentGraph.edges.length
          || currentGraph.documents.length
          || currentGraph.learning?.examples?.length;
        if (currentHasContent && JSON.stringify(currentGraph) !== JSON.stringify(importedGraph)
          && !window.confirm("Restore this full backup and replace the current workspace? The current graph will remain available through Undo.")) {
          status.textContent = "Backup restore canceled; the current graph was kept.";
          pendingFiles = [];
          document.querySelector("#document-file").value = "";
          renderFileQueue();
          return;
        }
        if (!graphStore.restore(importedGraph, importedHistory, { expectedVersion, preserveCurrent: true })) {
          throw new Error(graphStore.getLastWriteMode() === "conflict"
            ? "The graph changed in another tab while the backup was loading. The backup was not restored."
            : "The backup could not be restored in this browser.");
        }
        const restoredHistoryCount = graphStore.readHistory().length;
        renderWorkbench();
        status.textContent = `Full backup restored · revision ${importedGraph.version} with ${restoredHistoryCount} undo snapshot${restoredHistoryCount === 1 ? "" : "s"}.`;
        pendingFiles = [];
        document.querySelector("#document-file").value = "";
        renderFileQueue();
        return;
      }
      if (imported.schema !== GRAPH_SCHEMA && !LEGACY_GRAPH_SCHEMAS.has(imported.schema)) throw new Error("That JSON file is not an LLM Field Notes graph.");
      const importedGraph = normalizeGraph(imported);
      if (importedGraph.redacted) {
        status.textContent = "This graph is redacted: source text, evidence quotes, and source URIs are unavailable.";
      }
      const currentGraph = graphStore.read();
      const currentHasContent = currentGraph.nodes.length
        || currentGraph.edges.length
        || currentGraph.documents.length
        || currentGraph.learning?.examples?.length;
      if (currentHasContent && JSON.stringify(currentGraph) !== JSON.stringify(importedGraph)
        && !window.confirm("Import this graph and replace the current workspace? The current graph will remain available through Undo.")) {
        status.textContent = "Graph import canceled; the current graph was kept.";
        pendingFiles = [];
        document.querySelector("#document-file").value = "";
        renderFileQueue();
        return;
      }
      if (!graphStore.write(importedGraph, { expectedVersion })) {
        throw new Error(graphStore.getLastWriteMode() === "conflict"
          ? "The graph changed in another tab while the import was loading. The import was not written."
          : "The graph could not be saved in this browser.");
      }
      renderWorkbench();
      status.textContent = importedGraph.redacted
        ? `Redacted graph imported · revision ${importedGraph.version} restored; source text, evidence quotes, and URIs are unavailable.`
        : `Graph imported · revision ${importedGraph.version} restored.`;
      pendingFiles = [];
      document.querySelector("#document-file").value = "";
      renderFileQueue();
      return;
    }
    pendingFiles = files;
    if (Number.isFinite(pendingFiles[0].size) && pendingFiles[0].size > MAX_DOCUMENT_CHARS) throw new Error(`That file is larger than the ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k character limit.`);
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
async function buildGraphFromInput() {
  void requestPersistentStorage();
  const buildSignal = activeBuildController?.signal;
  const ensureBuildActive = () => {
    if (buildSignal?.aborted) throw Object.assign(new Error("Build canceled."), { code: "CANCELED" });
  };
  ensureBuildActive();
  const title = document.querySelector("#document-title").value.trim() || "Untitled document";
  const sourceUri = document.querySelector("#document-uri").value.trim().slice(0, MAX_SOURCE_URI_CHARS);
  const text = document.querySelector("#document-input").value.trim();
  const status = document.querySelector("#ingest-status");
  const endpoint = extractorEndpointInput.value.trim();
  let remoteExtractor = null;
  if (pendingFiles.length) {
    const files = pendingFiles.slice();
    if (files.some((file) => file.name.toLowerCase().endsWith(".zip")) && files.length !== 1) {
      status.textContent = "Select an Obsidian vault ZIP by itself.";
      return;
    }
    if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
      try {
        if (Number.isFinite(files[0].size) && files[0].size > MAX_ZIP_BYTES) throw new Error("The vault archive is larger than the 50 MB safety limit.");
        const currentGraph = graphStore.read();
        const expectedVersion = currentGraph.version;
        const vault = parseObsidianVault(await files[0].arrayBuffer());
        if (!vault.feedbacks.length) {
          status.textContent = "That vault contains no exported concept or relation feedback notes.";
          return;
        }
        const result = applyObsidianFeedback(currentGraph, vault.feedbacks);
        if (!result.changed) {
          status.textContent = result.limited === "version"
            ? "This graph has reached its revision limit. Export a backup before importing vault feedback."
            : "No matching graph items or changes were found in that vault.";
          return;
        }
        if (!graphStore.write(result.graph, { expectedVersion })) {
          status.textContent = graphStore.getLastWriteMode() === "conflict"
            ? "The graph changed in another tab while the vault was loading. Vault feedback was not written."
            : "Obsidian vault feedback could not be saved. Your prior graph is still intact.";
          return;
        }
        pendingFiles = [];
        document.querySelector("#document-file").value = "";
        renderFileQueue();
        renderWorkbench();
        const manifestNote = vault.manifestError
          ? " Manifest metadata was invalid; feedback was still applied."
          : vault.manifest && vault.manifest.graphFingerprint !== fingerprintBackup(currentGraph)
            ? " This vault came from an earlier or different graph revision."
            : "";
        status.textContent = `Obsidian vault feedback imported · ${result.updates} update${result.updates === 1 ? "" : "s"} saved${result.skipped ? ` · ${result.skipped} conflicting label${result.skipped === 1 ? "" : "s"} skipped` : ""}.${manifestNote}`;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "That vault could not be read.";
      }
      return;
    }
    const currentGraph = graphStore.read();
    const expectedVersion = currentGraph.version;
    let fileTexts;
    try {
      const declaredFeedbackBytes = files.reduce((total, file) => total + (Number.isFinite(file.size) ? file.size : 0), 0);
      if (declaredFeedbackBytes > MAX_BATCH_CHARS) throw new Error(`This feedback selection is larger than the ${Math.round(MAX_BATCH_CHARS / 1000000)} MB aggregate limit.`);
      fileTexts = [];
      let feedbackChars = 0;
      for (const file of files) {
        const fileText = await file.text();
        feedbackChars += fileText.length;
        if (feedbackChars > MAX_BATCH_CHARS) throw new Error(`This feedback selection is larger than the ${Math.round(MAX_BATCH_CHARS / 1000000)} MB aggregate limit.`);
        fileTexts.push(fileText);
      }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "One or more selected notes could not be read.";
      return;
    }
    const feedbacks = fileTexts.map(parseObsidianFeedback).filter(Boolean);
    if (feedbacks.length) {
      if (feedbacks.length !== files.length) {
        status.textContent = "Select only exported concept or relation notes when importing Obsidian feedback.";
        return;
      }
      const projectionFingerprint = fingerprintBackup(currentGraph);
      const projectionNote = feedbacks.some((feedback) => feedback.projectionMetadataError)
        ? " Projection metadata was invalid; feedback was still applied."
        : feedbacks.some((feedback) => feedback.graphFingerprint && feedback.graphFingerprint !== projectionFingerprint)
          ? " These notes came from an earlier or different graph revision."
          : "";
      const result = applyObsidianFeedback(currentGraph, feedbacks);
      if (!result.changed) {
        status.textContent = result.limited === "version"
          ? "This graph has reached its revision limit. Export a backup before importing Obsidian feedback."
          : "No matching graph items or changes were found in those Obsidian notes.";
        return;
      }
      if (!graphStore.write(result.graph, { expectedVersion })) {
        status.textContent = graphStore.getLastWriteMode() === "conflict"
          ? "The graph changed in another tab while the notes were loading. Obsidian feedback was not written."
          : "Obsidian feedback could not be saved. Your prior graph is still intact.";
        return;
      }
      pendingFiles = [];
      document.querySelector("#document-file").value = "";
      renderFileQueue();
      renderWorkbench();
      status.textContent = `Obsidian feedback imported · ${result.updates} update${result.updates === 1 ? "" : "s"} saved${result.skipped ? ` · ${result.skipped} conflicting label${result.skipped === 1 ? "" : "s"} skipped` : ""}.${projectionNote}`;
      return;
    }
  }
  if (endpoint) {
    try {
      const endpointUrl = new URL(endpoint, location.href);
      if (endpointUrl.origin !== location.origin) throw new Error("The browser extractor endpoint must be same-origin with this app.");
      if (endpointUrl.username || endpointUrl.password) throw new Error("The browser extractor endpoint must not contain embedded credentials.");
      remoteExtractor = createRemoteExtractor({ endpoint: endpointUrl.toString() });
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "The remote extractor configuration is invalid.";
      return;
    }
  }
  if (pendingFiles.length > 1) {
    const files = pendingFiles.slice();
    const declaredBatchBytes = files.reduce((total, file) => total + (Number.isFinite(file.size) ? file.size : 0), 0);
    if (declaredBatchBytes > MAX_BATCH_CHARS) {
      status.textContent = `This batch is larger than the ${Math.round(MAX_BATCH_CHARS / 1000000)} MB aggregate limit. Select fewer or smaller files.`;
      return;
    }
    let graph = graphStore.read();
    const expectedVersion = graph.version;
    let added = 0;
    let duplicates = 0;
    let batchChars = 0;
    const failures = [];
    let canceled = false;
    let fileIndex = 0;
    for (; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      try {
        ensureBuildActive();
        if (Number.isFinite(file.size) && file.size > MAX_DOCUMENT_CHARS) {
          failures.push(`${file.name}: over ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k characters`);
          continue;
        }
        const fileText = await file.text();
        ensureBuildActive();
        if (!fileText.trim()) {
          failures.push(`${file.name}: empty`);
          continue;
        }
        if (fileText.length > MAX_DOCUMENT_CHARS) {
          failures.push(`${file.name}: over ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k characters`);
          continue;
        }
        if (batchChars + fileText.length > MAX_BATCH_CHARS) {
          failures.push(`${file.name}: aggregate batch limit reached`);
          continue;
        }
        batchChars += fileText.length;
        const extraction = remoteExtractor
          ? await runRemoteExtraction(
            remoteExtractor,
            { title: file.name.replace(/\.[^/.]+$/, ""), text: fileText.trim() },
            buildExtractorFeedback(graph)
          )
          : extractGraph(file.name.replace(/\.[^/.]+$/, ""), fileText.trim(), { feedback: buildExtractorFeedback(graph) });
        ensureBuildActive();
        const result = mergeExtraction(graph, extraction);
        if (result.duplicate) duplicates += 1;
        else if (result.limited) failures.push(`${file.name}: graph ${result.limited} limit reached`);
        else {
          graph = result.graph;
          added += 1;
        }
      } catch (error) {
        if (error?.code === "CANCELED") {
          canceled = true;
          break;
        }
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "could not extract"}`);
      }
    }
    if (added && !graphStore.write(graph, { expectedVersion })) {
      status.textContent = graphStore.getLastWriteMode() === "conflict"
        ? "The graph changed in another tab while this batch was running. Your batch was not written; reload the graph and try again."
        : "The batch could not be saved. Your browser may be out of storage.";
      return;
    }
    pendingFiles = canceled ? files.slice(fileIndex) : [];
    if (!pendingFiles.length) document.querySelector("#document-file").value = "";
    renderFileQueue();
    renderWorkbench();
    const failureSummary = failures.slice(0, 3).map((failure) => failure.slice(0, 180)).join(" · ");
    const addedSummary = `${added} document${added === 1 ? "" : "s"} added`;
    const remainingSummary = pendingFiles.length
      ? ` · ${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"} remain queued`
      : "";
    status.textContent = `${canceled ? "Build canceled · " : ""}${addedSummary}${duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped` : ""}${failures.length ? ` · ${failures.length} failed${failureSummary ? `: ${failureSummary}${failures.length > 3 ? " · …" : ""}` : ""}` : ""}${remainingSummary}.`;
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
  const currentGraph = graphStore.read();
  const expectedVersion = currentGraph.version;
  let extraction;
  try {
    ensureBuildActive();
    extraction = remoteExtractor
      ? await runRemoteExtraction(remoteExtractor, { title, text, uri: sourceUri }, buildExtractorFeedback(currentGraph))
      : extractGraph(title, text, { feedback: buildExtractorFeedback(currentGraph), sourceUri });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "The document could not be extracted.";
    return;
  }
  const result = mergeExtraction(currentGraph, extraction);
  if (result.duplicate) {
    status.textContent = "This document is already in the graph; no duplicate revision was created.";
    return;
  }
  if (result.limited) {
    const limit = result.limited === "documents"
      ? `${MAX_GRAPH_DOCUMENTS} documents`
      : result.limited === "document-text"
        ? `${Math.round(MAX_GRAPH_DOCUMENT_CHARS / 1000000)} million document characters`
        : result.limited === "nodes"
          ? `${MAX_GRAPH_NODES} concepts`
          : result.limited === "edges"
            ? `${MAX_GRAPH_EDGES} relations`
            : "revision";
    status.textContent = `The graph has reached its ${limit} limit. Remove or merge existing knowledge before adding more.`;
    return;
  }
  if (!graphStore.write(result.graph, { expectedVersion })) {
    status.textContent = graphStore.getLastWriteMode() === "conflict"
      ? "The graph changed in another tab while extraction was running. The document was not written; reload and try again."
      : "The graph could not be saved. Your browser may be out of storage.";
    return;
  }
  renderWorkbench();
  status.textContent = `Revision ${result.graph.version} saved · ${result.graph.nodes.length} concepts now in memory.`;
  pendingFiles = [];
  document.querySelector("#document-file").value = "";
  renderFileQueue();
}
const ingestButton = document.querySelector("#ingest-document");
const loadSampleButton = document.querySelector("#load-sample");
const documentFileInput = document.querySelector("#document-file");
let ingestInFlight = false;
ingestButton.addEventListener("click", async () => {
  if (ingestInFlight) return;
  ingestInFlight = true;
  ingestButton.disabled = true;
  ingestButton.setAttribute("aria-busy", "true");
  loadSampleButton.disabled = true;
  documentFileInput.disabled = true;
  activeBuildController = new AbortController();
  cancelExtractionButton.disabled = false;
  try {
    await buildGraphFromInput();
  } finally {
    if (activeBuildController) activeBuildController = null;
    cancelExtractionButton.disabled = true;
    ingestInFlight = false;
    ingestButton.disabled = false;
    ingestButton.setAttribute("aria-busy", "false");
    loadSampleButton.disabled = false;
    documentFileInput.disabled = false;
  }
});
document.querySelector("#try-sample").addEventListener("click", startSampleWalkthrough);
if (location.hash === "#sample") {
  history.replaceState({}, "", "#workbench");
  startSampleWalkthrough();
}
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
  const expectedVersion = graph.version;
  if (!advanceGraphVersion(graph)) {
    document.querySelector("#ingest-status").textContent = "This graph has reached its revision limit. Export a backup and start a fresh graph before editing it.";
    return false;
  }
  graph.updatedAt = new Date().toISOString();
  graph.revisions.unshift({ id: `rev-${graph.version}`, version: graph.version, timestamp: graph.updatedAt, reason, nodes: graph.nodes.length, edges: graph.edges.length });
  graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  if (!graphStore.write(graph, { expectedVersion })) {
    document.querySelector("#ingest-status").textContent = graphStore.getLastWriteMode() === "conflict"
      ? "The graph changed in another tab. Your manual change was not written; reload and try again."
      : "The manual change could not be saved.";
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
  const labelKey = slugify(label);
  const existing = graph.nodes.find((node) => slugify(node.label) === labelKey || node.aliases.some((alias) => slugify(alias) === labelKey));
  if (existing) {
    existing.status = "accepted";
    existing.confidence = .99;
    existing.feedback += 1;
    existing.lastReviewedAt = new Date().toISOString();
    rememberLearningItem(graph, "node", existing);
    if (commitManualGraph(graph, `Confirmed concept ${existing.label}`)) input.value = "";
    return;
  }
  if (graph.nodes.length >= MAX_GRAPH_NODES) {
    document.querySelector("#ingest-status").textContent = `The graph has reached its concept limit (${MAX_GRAPH_NODES}). Remove or merge existing knowledge before adding more.`;
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
    updatedAt: new Date().toISOString(),
    lastReviewedAt: new Date().toISOString()
  });
  rememberLearningItem(graph, "node", graph.nodes[graph.nodes.length - 1]);
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
  const edgeId = makeEdgeId(source, target, label);
  const graph = graphStore.read();
  const existing = graph.edges.find((edge) => edge.id === edgeId);
  if (existing) {
    existing.status = "accepted";
    existing.confidence = .99;
    existing.lastReviewedAt = new Date().toISOString();
    rememberLearningItem(graph, "edge", existing);
  } else {
    if (graph.edges.length >= MAX_GRAPH_EDGES) {
      document.querySelector("#ingest-status").textContent = `The graph has reached its relation limit (${MAX_GRAPH_EDGES}). Remove or merge existing knowledge before adding more.`;
      return;
    }
    graph.edges.push({ id: edgeId, source, target, label, confidence: .99, feedback: 1, evidence: [], sources: [], status: "accepted", lastReviewedAt: new Date().toISOString() });
    rememberLearningItem(graph, "edge", graph.edges[graph.edges.length - 1]);
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
function persistFeedbackDecision(kind, id, action) {
  const status = document.querySelector("#ingest-status");
  const currentGraph = graphStore.read();
  const result = applyFeedback(currentGraph, kind, id, action);
  if (!result.changed) {
    status.textContent = result.limited === "version"
      ? `This graph has reached its revision limit. Export a backup before reviewing more ${kind === "node" ? "concepts" : "relations"}.`
      : "That feedback could not be applied.";
    return false;
  }
  if (!graphStore.write(result.graph, { expectedVersion: currentGraph.version })) {
    status.textContent = graphStore.getLastWriteMode() === "conflict"
      ? "The graph changed in another tab. That feedback was not written; reload and try again."
      : "That feedback could not be saved. Your prior graph is still intact.";
    renderWorkbench();
    return false;
  }
  renderWorkbench();
  return true;
}
document.querySelector("#node-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-feedback]");
  if (!button) {
    const row = event.target.closest(".node-row");
    if (row) selectGraphNode(row.dataset.nodeId);
    return;
  }
  const action = button.dataset.feedback;
  if (!persistFeedbackDecision("node", button.dataset.nodeId, action)) return;
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
  if (!persistFeedbackDecision("edge", button.dataset.edgeId, action)) return;
  document.querySelector(".mini-button[data-view='list']").click();
});
document.querySelector("#node-list").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest("button")) return;
  const row = event.target.closest(".node-row");
  if (!row) return;
  event.preventDefault();
  selectGraphNode(row.dataset.nodeId);
});
document.querySelector("#relation-list").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest("button")) return;
  const row = event.target.closest(".relation-row");
  if (!row) return;
  event.preventDefault();
  selectGraphEdge(row.dataset.edgeId);
});
document.querySelector("#inspector-panel").addEventListener("click", (event) => {
  const feedbackButton = event.target.closest("[data-inspector-feedback]");
  if (feedbackButton) {
    const kind = feedbackButton.dataset.nodeId ? "node" : "edge";
    const id = feedbackButton.dataset.nodeId || feedbackButton.dataset.edgeId;
    if (persistFeedbackDecision(kind, id, feedbackButton.dataset.inspectorFeedback)) {
      document.querySelector("#ingest-status").textContent = "Review decision saved and added to reusable learning memory.";
    }
    return;
  }
  const edgeButton = event.target.closest("[data-select-edge]");
  if (edgeButton) selectGraphEdge(edgeButton.dataset.selectEdge);
  const sourceButton = event.target.closest("[data-select-source]");
  if (sourceButton) selectSource(sourceButton.dataset.selectSource);
  const replaceSourceButton = event.target.closest("[data-replace-source]");
  if (replaceSourceButton) {
    const sourceId = replaceSourceButton.dataset.replaceSource;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".txt,.md,text/plain,text/markdown";
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.remove();
      if (!file) return;
      const status = document.querySelector("#ingest-status");
      try {
        if (Number.isFinite(file.size) && file.size > MAX_DOCUMENT_CHARS) throw new Error(`That file is larger than the ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k character limit.`);
        const text = (await file.text()).trim();
        if (!text) throw new Error("The replacement file is empty.");
        if (text.length > MAX_DOCUMENT_CHARS) throw new Error(`That file is larger than the ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k character limit.`);
        const currentGraph = graphStore.read();
        const endpoint = extractorEndpointInput.value.trim();
        let extraction;
        if (endpoint) {
          const endpointUrl = new URL(endpoint, location.href);
          if (endpointUrl.origin !== location.origin) throw new Error("The browser extractor endpoint must be same-origin with this app.");
          if (endpointUrl.username || endpointUrl.password) throw new Error("The browser extractor endpoint must not contain embedded credentials.");
          extraction = await runRemoteExtraction(
            createRemoteExtractor({ endpoint: endpointUrl.toString() }),
            { title: file.name.replace(/\.[^/.]+$/, ""), text },
            buildExtractorFeedback(currentGraph)
          );
        } else {
          extraction = extractGraph(file.name.replace(/\.[^/.]+$/, ""), text, { feedback: buildExtractorFeedback(currentGraph) });
        }
        const result = replaceSource(currentGraph, sourceId, extraction);
        if (result.duplicate) {
          status.textContent = "That document is already represented by another source; the current source was kept.";
          return;
        }
        if (result.limited) {
          status.textContent = `The replacement could not fit within the graph ${result.limited} limit; the current source was kept.`;
          return;
        }
        if (!result.replaced || !graphStore.write(result.graph, { expectedVersion: currentGraph.version })) {
          status.textContent = graphStore.getLastWriteMode() === "conflict"
            ? "The graph changed in another tab while the replacement was running. The source was not replaced."
            : "The replacement could not be saved; the current source was kept.";
          return;
        }
        selectedGraphItem = null;
        renderWorkbench();
        status.textContent = `Source replaced · ${result.removedNodes} unsupported concept${result.removedNodes === 1 ? "" : "s"} and ${result.removedEdges} relation${result.removedEdges === 1 ? "" : "s"} pruned. Undo is available.`;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "The source could not be replaced.";
      }
    }, { once: true });
    document.body.append(fileInput);
    fileInput.click();
    return;
  }
  const removeSourceButton = event.target.closest("[data-remove-source]");
  if (removeSourceButton) {
    if (!window.confirm("Remove this source and unsupported inferred knowledge from the graph?")) return;
    const currentGraph = graphStore.read();
    const result = removeSource(currentGraph, removeSourceButton.dataset.removeSource);
    if (!result.removed) {
      document.querySelector("#ingest-status").textContent = "The source could not be removed.";
      return;
    }
    if (!graphStore.write(result.graph, { expectedVersion: currentGraph.version })) {
      document.querySelector("#ingest-status").textContent = graphStore.getLastWriteMode() === "conflict"
        ? "The graph changed in another tab. The source was not removed; reload and try again."
        : "The source could not be removed.";
      return;
    }
    selectedGraphItem = null;
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = `Source removed · ${result.removedNodes} concepts and ${result.removedEdges} relations pruned. Undo is available.`;
  }
  const nodeButton = event.target.closest("[data-select-node]");
  if (nodeButton) selectGraphNode(nodeButton.dataset.selectNode);
  const mergeButton = event.target.closest("[data-merge-node]");
  if (mergeButton) {
    const targetId = document.querySelector("#inspector-merge-target")?.value;
    if (!targetId || !window.confirm("Merge this concept into the selected concept? The combined graph change can be undone.")) return;
    const currentGraph = graphStore.read();
    const result = mergeConcepts(currentGraph, mergeButton.dataset.mergeNode, targetId);
    if (!result.changed) {
      document.querySelector("#ingest-status").textContent = result.limited === "version"
        ? "This graph has reached its revision limit. Export a backup before merging concepts."
        : "Those concepts could not be merged.";
      return;
    }
    if (!graphStore.write(result.graph, { expectedVersion: currentGraph.version })) {
      document.querySelector("#ingest-status").textContent = graphStore.getLastWriteMode() === "conflict"
        ? "The graph changed in another tab. The merge was not written; reload and try again."
        : "The concept merge could not be saved.";
      return;
    }
    selectedGraphItem = { kind: "node", id: result.mergedId };
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = "Concepts merged · evidence, aliases, and relations combined. Undo is available.";
    return;
  }
  const nodeEdit = event.target.closest("[data-edit-node]");
  const edgeEdit = event.target.closest("[data-edit-edge]");
  const sourceEdit = event.target.closest("[data-edit-source]");
  if (!nodeEdit && !edgeEdit && !sourceEdit) return;
  let graph = graphStore.read();
  const expectedVersion = graph.version;
  const input = document.querySelector(".inspector-edit-input");
  const nextLabel = input?.value.trim();
  if (!nextLabel) return;
  if (nodeEdit) {
    const node = graph.nodes.find((item) => item.id === nodeEdit.dataset.editNode);
    if (!node || node.label === nextLabel) return;
    if (graph.nodes.some((item) => item !== node && [item.label, ...(item.aliases || [])].some((label) => slugify(label) === slugify(nextLabel)))) {
      document.querySelector("#ingest-status").textContent = "That concept label already exists; use an alias or merge the concepts first.";
      return;
    }
    node.aliases = [...new Set([...(node.aliases || []), node.label])].slice(0, 20);
    node.label = nextLabel;
    node.status = "accepted";
    node.feedback += 1;
    node.confidence = Math.min(.99, node.confidence + .08);
    node.updatedAt = new Date().toISOString();
    node.lastReviewedAt = node.updatedAt;
    rememberLearningItem(graph, "node", node);
    graph = syncLearningRelationLabels(graph).graph;
  } else if (edgeEdit) {
    const edge = graph.edges.find((item) => item.id === edgeEdit.dataset.editEdge);
    if (!edge || edge.label === nextLabel) return;
    edge.label = nextLabel;
    edge.status = "accepted";
    edge.feedback += 1;
    edge.confidence = Math.min(.99, edge.confidence + .08);
    edge.lastReviewedAt = new Date().toISOString();
    rememberLearningItem(graph, "edge", edge);
  } else {
    const source = graph.documents.find((item) => item.id === sourceEdit.dataset.editSource);
    const qualityInput = document.querySelector("#inspector-source-quality");
    const reviewedInput = document.querySelector("#inspector-source-reviewed");
    const uriInput = document.querySelector("#inspector-source-uri");
    const nextQuality = qualityInput?.value || "unknown";
    const reviewedDate = reviewedInput?.value.trim() || "";
    const reviewedTimestamp = reviewedDate ? Date.parse(`${reviewedDate}T00:00:00.000Z`) : NaN;
    if (reviewedDate && Number.isNaN(reviewedTimestamp)) {
      document.querySelector("#ingest-status").textContent = "Use a valid review date.";
      return;
    }
    const nextReviewedAt = reviewedDate ? new Date(reviewedTimestamp).toISOString() : null;
    const nextUri = normalizeSourceUri(uriInput?.value.trim().slice(0, MAX_SOURCE_URI_CHARS) || null);
    if (!source || !SOURCE_QUALITIES.has(nextQuality) || (source.title === nextLabel && source.uri === nextUri && source.quality === nextQuality && source.lastReviewedAt === nextReviewedAt)) return;
    source.title = nextLabel;
    source.uri = nextUri;
    source.quality = nextQuality;
    source.lastReviewedAt = nextReviewedAt;
  }
  if (!advanceGraphVersion(graph)) {
    document.querySelector("#ingest-status").textContent = "This graph has reached its revision limit. Export a backup and start a fresh graph before editing it.";
    return;
  }
  graph.updatedAt = new Date().toISOString();
  graph.revisions.unshift({
    id: `rev-${graph.version}`,
    version: graph.version,
    timestamp: graph.updatedAt,
    reason: nodeEdit ? `Renamed concept to ${nextLabel}` : edgeEdit ? `Renamed relation to ${nextLabel}` : `Updated source ${nextLabel} metadata`,
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  if (!graphStore.write(graph, { expectedVersion })) {
    document.querySelector("#ingest-status").textContent = graphStore.getLastWriteMode() === "conflict"
      ? "The graph changed in another tab. This edit was not written; reload and try again."
      : "The edit could not be saved.";
    return;
  }
  renderWorkbench();
  document.querySelector("#ingest-status").textContent = "Graph edit saved and added to revision history.";
});
document.querySelector("#download-markdown").addEventListener("click", () => {
  try {
    const graph = graphStore.read();
    downloadFile("knowledge-graph.md", buildMarkdown(graph), "text/markdown");
    document.querySelector("#projection-status").textContent = "Markdown projection downloaded.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = error instanceof Error ? error.message : "The Markdown projection could not be exported.";
  }
});
document.querySelector("#copy-markdown").addEventListener("click", async () => {
  try {
    if (!navigator.clipboard) throw new Error("Copy is unavailable in this browser; use Download .md instead.");
    const markdown = buildMarkdown(graphStore.read());
    if (textEncoder.encode(markdown).byteLength > MAX_EXPORT_BYTES) throw new Error("This projection exceeds the 50 MB safety limit; use a bounded graph or export a redacted view.");
    await navigator.clipboard.writeText(markdown);
    document.querySelector("#projection-status").textContent = "Markdown projection copied to the clipboard.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = error instanceof Error ? error.message : "The Markdown projection could not be copied.";
  }
});
document.querySelector("#download-vault").addEventListener("click", async () => {
  try {
    const graph = graphStore.read();
    const graphFiles = buildVaultFiles(graph);
    const learning = await buildLearningVaultFiles({ estimatedArchiveBytes: graphFiles.estimatedArchiveBytes });
    const files = [...graphFiles, ...learning.files];
    downloadBytes("llm-field-notes-vault.zip", zipStore(files), "application/zip");
    document.querySelector("#projection-status").textContent = `Obsidian vault downloaded · ${files.length} files${learning.failures.length ? ` · ${learning.failures.length} learning note${learning.failures.length === 1 ? "" : "s"} unavailable` : ""}.`;
  } catch (error) {
    document.querySelector("#projection-status").textContent = error instanceof Error ? error.message : "The Obsidian vault could not be exported.";
  }
});
document.querySelector("#download-redacted-vault").addEventListener("click", async () => {
  try {
    const graphFiles = buildVaultFiles(redactGraph(graphStore.read()));
    const learning = await buildLearningVaultFiles({ estimatedArchiveBytes: graphFiles.estimatedArchiveBytes });
    const files = [...graphFiles, ...learning.files];
    downloadBytes("llm-field-notes-redacted-vault.zip", zipStore(files), "application/zip");
    document.querySelector("#projection-status").textContent = `Redacted Obsidian vault downloaded · ${files.length} files; source text, evidence, and URIs removed${learning.failures.length ? ` · ${learning.failures.length} learning note${learning.failures.length === 1 ? "" : "s"} unavailable` : ""}.`;
  } catch (error) {
    document.querySelector("#projection-status").textContent = error instanceof Error ? error.message : "The redacted Obsidian vault could not be exported.";
  }
});
document.querySelector("#download-json").addEventListener("click", () => {
  try {
    const graph = graphStore.read();
    downloadFile("knowledge-graph.json", JSON.stringify(graph, null, 2), "application/json");
    document.querySelector("#projection-status").textContent = "Internal representation exported as JSON.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = error instanceof Error ? error.message : "The graph JSON could not be exported.";
  }
});
document.querySelector("#download-health").addEventListener("click", () => {
  try {
    const graph = graphStore.read();
    const report = {
      format: HEALTH_FORMAT,
      graphSchema: GRAPH_SCHEMA,
      graphVersion: graph.version,
      graphFingerprint: fingerprintBackup(graph),
      inspectedAt: new Date().toISOString(),
      health: inspectGraph(graph)
    };
    downloadFile("llm-field-notes-health.json", JSON.stringify(report, null, 2), "application/json");
    document.querySelector("#projection-status").textContent = "Privacy-safe graph health report downloaded.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = error instanceof Error ? error.message : "The graph health report could not be exported.";
  }
});
document.querySelector("#download-redacted").addEventListener("click", () => {
  try {
    const graph = redactGraph(graphStore.read());
    downloadFile("llm-field-notes-redacted-graph.json", JSON.stringify(graph, null, 2), "application/json");
    document.querySelector("#projection-status").textContent = "Redacted graph downloaded · source text, evidence, and URIs removed.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = error instanceof Error ? error.message : "The redacted graph could not be exported.";
  }
});
document.querySelector("#download-backup").addEventListener("click", () => {
  try {
    const backup = exportBackupSnapshot();
    document.querySelector("#projection-status").textContent = `Full backup downloaded · ${backup.history.length} undo snapshot${backup.history.length === 1 ? "" : "s"}.`;
  } catch (error) {
    document.querySelector("#projection-status").textContent = error instanceof Error ? error.message : "The full backup could not be exported.";
  }
});
document.querySelector("#download-feedback").addEventListener("click", () => {
  try {
    const dataset = buildFeedbackDataset(graphStore.read());
    downloadFile("llm-field-notes-feedback.json", JSON.stringify(dataset, null, 2), "application/json");
    document.querySelector("#projection-status").textContent = `Feedback dataset downloaded · ${dataset.examples.length} reviewed example${dataset.examples.length === 1 ? "" : "s"}.`;
  } catch (error) {
    document.querySelector("#projection-status").textContent = error instanceof Error ? error.message : "The feedback dataset could not be exported.";
  }
});
document.querySelector("#download-compact-feedback").addEventListener("click", () => {
  try {
    const dataset = buildCompactFeedbackDataset(graphStore.read());
    downloadFile("llm-field-notes-compact-feedback.json", JSON.stringify(dataset, null, 2), "application/json");
    document.querySelector("#projection-status").textContent = `Compact feedback downloaded · ${dataset.examples.length} reviewed example${dataset.examples.length === 1 ? "" : "s"} with source material removed.`;
  } catch (error) {
    document.querySelector("#projection-status").textContent = error instanceof Error ? error.message : "The compact feedback dataset could not be exported.";
  }
});
document.querySelector("#download-diff").addEventListener("click", () => {
  try {
    const graph = graphStore.read();
    const history = graphStore.readHistory();
    if (!history.length) throw new Error("There is no earlier revision to compare yet.");
    const diff = { ...diffGraphs(history.at(-1), graph), format: DIFF_FORMAT, exportedAt: new Date().toISOString() };
    downloadFile("llm-field-notes-diff.json", JSON.stringify(diff, null, 2), "application/json");
    document.querySelector("#projection-status").textContent = `Revision diff downloaded · ${diff.summary.added} added, ${diff.summary.changed} changed, ${diff.summary.removed} removed.`;
  } catch (error) {
    document.querySelector("#projection-status").textContent = error instanceof Error ? error.message : "The revision diff could not be exported.";
  }
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
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch(() => {
      // Offline support is an enhancement; the app remains fully usable if it
      // cannot be registered or refreshed in a preview or embedded environment.
    });
}
