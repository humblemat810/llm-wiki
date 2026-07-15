import {
  GRAPH_SCHEMA,
  FEEDBACK_FORMAT,
  BACKUP_FORMAT,
  DIFF_FORMAT,
  VAULT_FORMAT,
  fingerprintBackup,
  matchesGraphFingerprint,
  preferLearningExample,
  advanceGraphVersion,
  LEGACY_GRAPH_SCHEMAS,
  MAX_DOCUMENT_CHARS,
  MAX_DOCUMENT_TITLE_CHARS,
  MAX_GRAPH_DOCUMENT_CHARS,
  MAX_GRAPH_DOCUMENTS,
  MAX_GRAPH_NODES,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_REVISIONS,
  MAX_FEEDBACK_EXAMPLES,
  MAX_FEEDBACK_FINGERPRINT_EXAMPLES,
  MAX_FEEDBACK_EXPORT_OMITTED,
  MAX_REVIEW_QUEUE_ITEMS,
  MAX_SOURCE_URI_CHARS,
  MAX_PRODUCER_VERSION_CHARS,
  sampleDocument,
  makeId,
  normalizeGraph,
  canonicalizeGraphForExport,
  buildBackupEnvelope,
  buildGraphExport,
  compareGraphFreshness,
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
  clearStaleLearningMemory,
  markSourceReviewed,
  rememberLearningItem,
  removeSource,
  inspectGraph,
  reviewQueue,
  buildHealthReport,
  fingerprintFeedbackExamples,
  matchesFeedbackFingerprint,
  syncLearningRelationLabels,
  slugify,
  makeEdgeId,
  asArray,
  normalizeSourceUri,
  SOURCE_QUALITIES,
  DEFAULT_GRAPH_TIMESTAMP,
  parseJsonWithUniqueKeys,
  parseTimestamp,
  sliceTextAtCodePointBoundary
} from "./graph-core.js";
import { GRAPH_KEY, createGraphStore } from "./graph-store.js";
import { MAX_FEEDBACK_NOTE_CHARS, MAX_ZIP_BYTES, MAX_ZIP_FILES, applyObsidianFeedback, looksLikeObsidianFeedback, parseObsidianFeedback, parseObsidianVault } from "./projection-adapter.js";
import { createRemoteExtractor } from "./extractor-adapter.js";
import { rebuildSources } from "./rebuild-adapter.js";
import { getBrowserStorage, isExternalStorageRemoval } from "./storage-adapter.js";
import { buildJsonLd } from "./jsonld-projection.js";
import { notes, noteDetails } from "./curriculum.js";

const path = [
  ["01–03", "Build a tokenizer", "Make the text-to-integer boundary visible."],
  ["04–07", "Make attention click", "Implement the operation and visualize its weights."],
  ["08–14", "Train a tiny model", "Watch a small transformer overfit a tiny dataset."],
  ["15–21", "Break your model", "Probe memorization, context limits, and bad data."],
  ["22–26", "Add a retrieval loop", "Give the model a library and make it cite its sources."],
  ["27–30", "Ship a useful edge", "Put one narrow capability in front of a real person."]
];

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const MAX_OPERATION_DIAGNOSTIC_CHARS = 240;
const boundedOperationDiagnostic = (error, fallback) => {
  const detail = error instanceof Error ? error.message : fallback;
  const normalized = String(detail).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return sliceTextAtCodePointBoundary(normalized || fallback, MAX_OPERATION_DIAGNOSTIC_CHARS);
};
async function copyText(value) {
  if (typeof value !== "string") throw new TypeError("Copy text must be a string.");
  try {
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Fall through when Clipboard API permissions or secure-context policy
    // prevent the asynchronous path.
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  const previousFocus = document.activeElement;
  let copied = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    copied = typeof document.execCommand === "function" && document.execCommand("copy");
  } finally {
    textarea.remove();
    if (previousFocus && typeof previousFocus.focus === "function") {
      try {
        previousFocus.focus({ preventScroll: true });
      } catch {
        previousFocus.focus();
      }
    }
  }
  if (!copied) throw new Error("Copy is unavailable in this browser.");
}

const browserStorage = getBrowserStorage();
await browserStorage.ready;
const flushBrowserStorage = () => {
  void browserStorage.flush?.();
};
window.addEventListener("pagehide", flushBrowserStorage);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushBrowserStorage();
});
const RELEASE_METADATA_TIMEOUT_MS = 5000;
const MAX_RELEASE_METADATA_CHARS = 4096;
const declaredResponseBytes = (response) => {
  const header = response.headers?.get?.("content-length");
  const normalized = typeof header === "string" ? header.trim() : "";
  return /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
};
const isReadableSameOriginResponse = (response) => {
  if (response?.type === "opaque" || response?.type === "opaqueredirect") return false;
  if (typeof response?.url !== "string" || !response.url) return true;
  try {
    return new URL(response.url, location.href).origin === location.origin;
  } catch {
    return false;
  }
};
const releaseController = new AbortController();
const releaseTimeout = setTimeout(() => releaseController.abort(), RELEASE_METADATA_TIMEOUT_MS);
const releaseInfo = await fetch("./version.json", { cache: "no-cache", signal: releaseController.signal }).then((response) => {
  if (!isReadableSameOriginResponse(response)) throw new Error("Release metadata crossed the app origin boundary.");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declaredLength = declaredResponseBytes(response);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RELEASE_METADATA_CHARS * 4) {
    throw new Error("Release metadata is oversized.");
  }
  return readBoundedTextResponse(response, MAX_RELEASE_METADATA_CHARS, "Release metadata is oversized.", releaseController.signal).then((text) => {
    const value = parseJsonWithUniqueKeys(text, "Release metadata");
    const releaseDate = typeof value?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
      ? parseTimestamp(value.date)
      : Number.NaN;
    if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.version !== "string" || value.version.length > 64
      || (value.channel !== undefined && (typeof value.channel !== "string" || value.channel.length > 64))
      || (value.date !== undefined && (
        typeof value.date !== "string"
        || value.date.length > 64
        || Number.isNaN(releaseDate)
        || releaseDate > Date.now()
      ))) {
      throw new Error("Release metadata is invalid.");
    }
    return {
      version: value.version,
      channel: value.channel || "unreleased",
      date: value.date || ""
    };
  });
}).catch(() => ({ version: "unknown", channel: "unreleased", date: "" }));
clearTimeout(releaseTimeout);
const releaseVersion = document.querySelector("#release-version");
if (releaseVersion && typeof releaseInfo.version === "string") {
  releaseVersion.textContent = `v${releaseInfo.version} · ${releaseInfo.channel || "stable"}${releaseInfo.date ? ` · ${releaseInfo.date}` : ""}`;
}
const connectionStatus = document.querySelector("#connection-status");
const retryQueuedFilesButton = document.querySelector("#retry-queued-files");
let pendingFiles = [];
const browserIsOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const readDocumentDraftParts = () => [
  document.querySelector("#document-title")?.value || "",
  document.querySelector("#document-uri")?.value || "",
  document.querySelector("#document-input")?.value || ""
];
const readDocumentDraft = () => JSON.stringify(readDocumentDraftParts());
let committedDocumentDraft = readDocumentDraft();
const hasUnsavedDocumentDraft = () => readDocumentDraft() !== committedDocumentDraft;
const documentDraftKey = "llm-field-notes-document-draft";
const MAX_DOCUMENT_DRAFT_JSON_CHARS = MAX_DOCUMENT_CHARS + MAX_DOCUMENT_TITLE_CHARS + MAX_SOURCE_URI_CHARS + 128;
let draftSaveTimer = null;
const clearStoredDocumentDraft = () => {
  try {
    appStorage.removeItem(documentDraftKey);
  } catch {
    // Draft recovery is an enhancement; the unload warning remains active.
  }
};
const saveDocumentDraft = () => {
  const parts = readDocumentDraftParts();
  if (!parts.some((value) => value.trim())) {
    clearStoredDocumentDraft();
    return;
  }
  const serialized = JSON.stringify(parts);
  if (serialized.length > MAX_DOCUMENT_DRAFT_JSON_CHARS) return;
  try {
    appStorage.setItem(documentDraftKey, serialized);
  } catch {
    // Draft recovery is an enhancement; the unload warning remains active.
  }
};
const scheduleDocumentDraftSave = () => {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null;
    saveDocumentDraft();
  }, 250);
};
const restoreStoredDocumentDraft = () => {
  if (readDocumentDraftParts().some((value) => value.trim())) return false;
  try {
    const raw = appStorage.getItem(documentDraftKey);
    if (typeof raw !== "string" || raw.length > MAX_DOCUMENT_DRAFT_JSON_CHARS) return false;
    const parts = parseJsonWithUniqueKeys(raw, "Document draft");
    if (!Array.isArray(parts)
      || parts.length !== 3
      || typeof parts[0] !== "string"
      || typeof parts[1] !== "string"
      || typeof parts[2] !== "string"
      || parts[0].length > MAX_DOCUMENT_TITLE_CHARS
      || parts[1].length > MAX_SOURCE_URI_CHARS
      || parts[2].length > MAX_DOCUMENT_CHARS) return false;
    document.querySelector("#document-title").value = parts[0];
    document.querySelector("#document-uri").value = parts[1];
    document.querySelector("#document-input").value = parts[2];
    return parts.some((value) => value.trim());
  } catch {
    return false;
  }
};
const commitDocumentDraft = () => {
  committedDocumentDraft = readDocumentDraft();
  clearStoredDocumentDraft();
};
const updateConnectionStatus = () => {
  if (!connectionStatus) return;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const queued = pendingFiles.length > 0;
  connectionStatus.hidden = !offline && !queued;
  connectionStatus.dataset.state = offline ? "offline" : queued ? "queued" : "";
  const heading = connectionStatus.querySelector("strong");
  const message = connectionStatus.querySelector("span");
  if (!offline && queued) {
    if (heading) heading.textContent = "Queued files waiting.";
    if (message) message.textContent = "Queued files are ready; process them when the extractor is available.";
  } else if (offline) {
    if (heading) heading.textContent = "Offline mode.";
    if (message) message.textContent = "The local graph and cached wiki remain available; remote extraction will resume when you reconnect.";
  }
};
window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
updateConnectionStatus();
const { storage: appStorage, persistent: hasPersistentStorage } = browserStorage;
let hasDurableStorage = browserStorage.durable;
let storageDurabilityFailure = browserStorage.storageFailure;
const recoveredDocumentDraft = restoreStoredDocumentDraft();
if (recoveredDocumentDraft) {
  document.querySelector("#ingest-status").textContent = "Recovered an unfinished document draft. Build it or clear it when ready.";
}
["#document-title", "#document-uri", "#document-input"].forEach((selector) => {
  document.querySelector(selector)?.addEventListener("input", scheduleDocumentDraftSave);
});
const graphHasContent = (graph) => Boolean(
  graph?.documents?.length
  || graph?.nodes?.length
  || graph?.edges?.length
  || graph?.learning?.examples?.length
);
window.addEventListener("beforeunload", (event) => {
  const queuedFiles = pendingFiles.length > 0;
  const unsavedDocumentDraft = hasUnsavedDocumentDraft();
  if (!queuedFiles && !unsavedDocumentDraft && hasPersistentStorage && !storageDurabilityFailure) return;
  let graph;
  try {
    graph = graphStore.read();
  } catch {
    graph = null;
  }
  if (!queuedFiles && !unsavedDocumentDraft && !graphHasContent(graph)) return;
  event.preventDefault();
  event.returnValue = "";
});
const notesGrid = document.querySelector("#notes-grid");
const emptyState = document.querySelector("#empty-state");
const searchInput = document.querySelector("#search");
const MAX_SEARCH_QUERY_CHARS = 256;
const boundedSearchQuery = (value) => sliceTextAtCodePointBoundary(String(value || ""), MAX_SEARCH_QUERY_CHARS).trim();
const filters = document.querySelectorAll(".filter");
const progressKey = "llm-field-notes-progress";
const pathProgressKey = "llm-field-notes-path";
const extractorEndpointKey = "llm-field-notes-extractor-endpoint";
const MAX_PROGRESS_JSON_CHARS = 10000;
const progressStatus = document.querySelector("#progress-status");
const readStoredList = (key) => {
  try {
    const raw = appStorage.getItem(key);
    if (typeof raw !== "string" || raw.length > MAX_PROGRESS_JSON_CHARS) return [];
    const value = parseJsonWithUniqueKeys(raw || "[]", "Learning progress");
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
const defaultPageMetadata = {
  title: document.title,
  description: document.querySelector('meta[name="description"]')?.content || "",
  ogTitle: document.querySelector('meta[property="og:title"]')?.content || "",
  ogDescription: document.querySelector('meta[property="og:description"]')?.content || "",
  twitterTitle: document.querySelector('meta[name="twitter:title"]')?.content || "",
  twitterDescription: document.querySelector('meta[name="twitter:description"]')?.content || ""
};
const setMetadataContent = (selector, content) => {
  const element = document.querySelector(selector);
  if (element) element.setAttribute("content", content);
};
function setNoteMetadata(note) {
  const description = sliceTextAtCodePointBoundary(`${note.question} ${note.description}`.replace(/\s+/g, " ").trim(), 280);
  document.title = `${note.title} · LLM Field Notes`;
  setMetadataContent('meta[name="description"]', description);
  setMetadataContent('meta[property="og:title"]', `${note.title} · LLM Field Notes`);
  setMetadataContent('meta[property="og:description"]', description);
  setMetadataContent('meta[name="twitter:title"]', `${note.title} · LLM Field Notes`);
  setMetadataContent('meta[name="twitter:description"]', description);
}
function restorePageMetadata() {
  document.title = defaultPageMetadata.title;
  setMetadataContent('meta[name="description"]', defaultPageMetadata.description);
  setMetadataContent('meta[property="og:title"]', defaultPageMetadata.ogTitle);
  setMetadataContent('meta[property="og:description"]', defaultPageMetadata.ogDescription);
  setMetadataContent('meta[name="twitter:title"]', defaultPageMetadata.twitterTitle);
  setMetadataContent('meta[name="twitter:description"]', defaultPageMetadata.twitterDescription);
}

function openNote(note, { updateUrl = true } = {}) {
  if (!note || !noteDetails[note.id]) return;
  const detail = noteDetails[note.id];
  setNoteMetadata(note);
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
    else restorePageMetadata();
    return;
  }
  let noteId;
  try {
    noteId = decodeURIComponent(match[1]);
  } catch {
    if (dialog.open) dialog.close();
    else restorePageMetadata();
    return;
  }
  const note = notes.find((item) => item.id === noteId);
  if (!note) {
    if (dialog.open) dialog.close();
    else restorePageMetadata();
    return;
  }
  openNote(note, { updateUrl: false });
}

function renderNotes() {
  const query = boundedSearchQuery(searchInput.value).toLowerCase();
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
        <div class="note-top"><span>${escapeHtml(note.number)}</span><span class="note-tag">${escapeHtml(note.tag)}</span></div>
        <h3>${escapeHtml(note.title)}</h3>
        <p>${escapeHtml(note.description)}</p>
      </div>
      <div class="note-bottom">
        <span>${escapeHtml(note.meta)}</span>
        <div>
          <a class="open-note" href="#note=${encodeURIComponent(note.id)}" data-open-note="${escapeHtml(note.id)}">open note <span>↗</span></a>
          <a class="note-source" href="./notes/${encodeURIComponent(note.id)}.html" target="_blank" rel="noopener">viewer</a>
          <a class="note-source" href="./notes/${encodeURIComponent(note.id)}.md" target="_blank" rel="noopener">markdown</a>
          <button type="button" class="copy-note" data-copy-note="${escapeHtml(note.id)}" aria-label="Copy link to ${escapeHtml(note.title)}">copy link</button>
          <button type="button" class="mark-done" data-note="${escapeHtml(note.id)}" aria-label="Mark ${escapeHtml(note.title)} as read">
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
      <span class="path-day">DAYS ${escapeHtml(item[0])}</span>
      <div><h3>${escapeHtml(item[1])}</h3><p>${escapeHtml(item[2])}</p></div>
      <button type="button" class="path-check" data-day="${index}" aria-label="Mark ${escapeHtml(item[1])} complete">${done.includes(index) ? "✓" : "·"}</button>
    </div>
  `).join("");
}

filters.forEach((filter) => filter.addEventListener("click", () => {
  filters.forEach((item) => item.classList.remove("active"));
  filters.forEach((item) => item.setAttribute("aria-pressed", item === filter ? "true" : "false"));
  filter.classList.add("active");
  renderNotes();
}));
searchInput.addEventListener("input", (event) => {
  const bounded = boundedSearchQuery(event.target.value);
  if (event.target.value !== bounded) event.target.value = bounded;
  renderNotes();
});
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
    const shareUrl = new URL(`./notes/${encodeURIComponent(copyButton.dataset.copyNote)}.html`, location.href);
    const feedback = document.querySelector("#share-status");
    try {
      await copyText(shareUrl.toString());
      feedback.textContent = "Note link copied.";
    } catch (error) {
      feedback.textContent = boundedOperationDiagnostic(error, "The note link could not be copied.");
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
  restorePageMetadata();
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
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && ["document-title", "document-uri", "document-input"].includes(document.activeElement?.id)) {
    event.preventDefault();
    if (!ingestInFlight) ingestButton.click();
  }
  if (event.key === "Escape") searchInput.blur();
});
document.querySelector("#copy-prompt").addEventListener("click", async () => {
  const template = `# [A clear title]\n\n> The question this page answers in one sentence.\n\n## The short version\n\n## Build it\n\n## What surprised me\n\n## Failure modes\n\n## Sources\n\n## Try it yourself`;
  const feedback = document.querySelector("#copy-feedback");
  try {
    await copyText(template);
    feedback.textContent = "Template copied. Go make the next page.";
  } catch {
    feedback.textContent = "Copy blocked by your browser — use the page structure above as a starting point.";
  }
  setTimeout(() => { feedback.textContent = ""; }, 4000);
});
document.querySelector("#share-wiki").addEventListener("click", async () => {
  const shareUrl = new URL(location.href);
  shareUrl.username = "";
  shareUrl.password = "";
  const noteHash = location.hash.match(/^#note=[^&]+/i)?.[0];
  let sharedNote = null;
  if (noteHash) {
    try {
      sharedNote = notes.find((note) => note.id === decodeURIComponent(noteHash.slice("#note=".length))) || null;
    } catch {
      sharedNote = null;
    }
  }
  if (sharedNote) {
    const notePageUrl = new URL(`./notes/${encodeURIComponent(sharedNote.id)}.html`, location.href);
    shareUrl.pathname = notePageUrl.pathname;
    shareUrl.search = "";
    shareUrl.hash = "";
  } else {
    shareUrl.search = "";
    shareUrl.hash = "workbench";
  }
  const shareData = {
    title: sharedNote ? `${sharedNote.title} · LLM Field Notes` : "LLM Field Notes",
    text: sharedNote ? sharedNote.question : "Turn documents into an inspectable, evolving knowledge graph.",
    url: shareUrl.toString()
  };
  const feedback = document.querySelector("#share-status");
  try {
    if (typeof navigator.share === "function") {
      await navigator.share(shareData);
      feedback.textContent = "Share sheet opened.";
    } else {
      await copyText(shareUrl.toString());
      feedback.textContent = "Link copied.";
    }
  } catch (error) {
    if (error?.name !== "AbortError") feedback.textContent = boundedOperationDiagnostic(error, "Sharing is unavailable in this browser.");
  }
  setTimeout(() => { feedback.textContent = ""; }, 5000);
});

renderNotes();
renderPath();
openNoteFromLocation();

// --- Knowledge workbench ---------------------------------------------------
// This is intentionally provider-agnostic. The local extractor is the
// zero-configuration path; a model-backed adapter can replace extractGraph()
// without changing the graph schema, renderer, or export formats.
const lexicalCompare = (left, right) => {
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
};
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_FILES = 100;
const MAX_BATCH_CHARS = 10 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = MAX_DOCUMENT_CHARS * 4;
const MAX_BATCH_BYTES = MAX_BATCH_CHARS * 4;
const MAX_FEEDBACK_NOTE_BYTES = MAX_FEEDBACK_NOTE_CHARS * 4;
const LEARNING_NOTE_TIMEOUT_MS = 10000;
const MAX_LEARNING_NOTE_CHARS = 1_000_000;
const MAX_LEARNING_NOTES_CHARS = 10 * 1024 * 1024;
const MAX_LEARNING_VAULT_EXPORT_MS = 30000;
const MAX_MARKDOWN_PREVIEW_EVIDENCE_CHARS = 250000;
const WORKBENCH_DERIVED_CACHE_TTL_MS = 30000;
const MAX_SEARCH_TEXT_CHARS = 12000;
const MAX_SEARCH_EVIDENCE_CHARS = 2000;
const MAX_RENDERED_GRAPH_NODES = 250;
const MAX_RENDERED_GRAPH_EDGES = 500;
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
const graphStore = createGraphStore(appStorage);
const hasImportIntegrityLoss = (graph) => [
  ...Object.values(graph?.integrity?.truncated || {}),
  ...Object.values(graph?.integrity?.dropped || {})
].some((count) => Number.isSafeInteger(count) && count > 0);
const incompleteImportMessage = "This imported graph is incomplete. Restore the original export before making edits.";
const mutationLimitMessage = (result, fallback) => result?.limited === "import-truncated" ? incompleteImportMessage : fallback;
const graphWriteFailureMessage = (fallback, conflict) => {
  const mode = graphStore.getLastWriteMode();
  if (mode === "integrity") return "This graph came from an incomplete import. Restore the original export before making edits.";
  if (mode === "conflict") return conflict;
  return fallback;
};
const graphWriteSuccessMessage = (message) => {
  const mode = graphStore.getLastWriteMode();
  return mode === "without-history" || mode === "without-new-history"
    ? `${message} Undo history was reduced; export a backup before leaving this tab.`
    : message;
};
async function readBrowserFileBytes(file, maxBytes, errorMessage = `That file exceeds the ${Math.round(maxBytes / 1000000)} MB safety limit.`) {
  const byteLimit = Math.max(1, Math.floor(maxBytes));
  if (Number.isFinite(file?.size) && file.size > byteLimit) throw new Error(errorMessage);
  if (typeof file?.slice !== "function") throw new Error("This browser cannot validate file size safely.");
  const boundedFile = file.slice(0, byteLimit + 1);
  if (typeof boundedFile?.arrayBuffer === "function") {
    const rawBytes = await boundedFile.arrayBuffer();
    const bytes = rawBytes instanceof ArrayBuffer
      ? new Uint8Array(rawBytes)
      : ArrayBuffer.isView(rawBytes)
        ? new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength)
        : null;
    if (!bytes || !Number.isSafeInteger(bytes.byteLength) || bytes.byteLength < 0) {
      throw new Error("This browser cannot validate file size safely.");
    }
    if (bytes.byteLength > byteLimit) throw new Error(errorMessage);
    return bytes;
  }
  throw new Error("This browser cannot validate file size safely.");
}
async function readBrowserFileText(file, maxBytes, errorMessage = `That file exceeds the ${Math.round(maxBytes / 1000000)} MB safety limit.`) {
  try {
    const bytes = await readBrowserFileBytes(file, maxBytes, errorMessage);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("That file is not valid UTF-8.");
    }
  } catch (error) {
    if (error?.message === "This browser cannot validate file size safely.") throw error;
    throw error;
  }
}
const graphStoreOptions = (graph) => ({
  expectedVersion: graph.version,
  expectedFingerprint: fingerprintBackup(graph)
});
const extractorEndpointInput = document.querySelector("#extractor-endpoint");
const privacyNote = document.querySelector("#privacy-note");
const privacyLive = document.querySelector("#privacy-live");
const cancelExtractionButton = document.querySelector("#cancel-extraction");
const readStoredExtractorEndpoint = () => {
  try {
    const value = appStorage.getItem(extractorEndpointKey);
    return typeof value === "string" && value.length <= MAX_SOURCE_URI_CHARS ? value.trim() : "";
  } catch {
    return "";
  }
};
const validateExtractorEndpoint = (value) => {
  const endpoint = String(value || "").trim();
  if (!endpoint) return "";
  if (endpoint.length > MAX_SOURCE_URI_CHARS) throw new Error(`Extractor endpoints must be no longer than ${MAX_SOURCE_URI_CHARS} characters.`);
  const endpointUrl = new URL(endpoint, location.href);
  if (endpointUrl.origin !== location.origin) throw new Error("The browser extractor endpoint must be same-origin with this app.");
  if (endpointUrl.username || endpointUrl.password) throw new Error("The browser extractor endpoint must not contain embedded credentials.");
  if (endpointUrl.search || endpointUrl.hash) throw new Error("The browser extractor endpoint must not contain a query string or fragment.");
  return endpoint;
};
const absoluteExtractorEndpoint = (endpoint) => new URL(validateExtractorEndpoint(endpoint), location.href).toString();
let storedExtractorEndpoint = "";
try {
  storedExtractorEndpoint = validateExtractorEndpoint(readStoredExtractorEndpoint());
} catch {
  try {
    appStorage.removeItem(extractorEndpointKey);
  } catch {
    // A malformed stored configuration must not prevent the workbench from loading.
  }
}
if (storedExtractorEndpoint) extractorEndpointInput.value = storedExtractorEndpoint;
let activeExtractionController = null;
let activeBuildController = null;
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
  if (event.external && event.key === extractorEndpointKey) {
    try {
      extractorEndpointInput.value = validateExtractorEndpoint(event.newValue || "");
    } catch {
      extractorEndpointInput.value = "";
    }
    updatePrivacyNote();
    return;
  }
  if (!event.external || event.key !== GRAPH_KEY) return;
  if (isExternalStorageRemoval(event, GRAPH_KEY)) {
    lastRenderedGraphState = null;
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = "Graph cleared in another tab; this view was refreshed.";
    return;
  }
  const incomingGraph = graphStore.read();
  const incomingFingerprint = fingerprintBackup(incomingGraph);
  const renderedFingerprint = lastRenderedGraphState?.fingerprint || fingerprintBackup(lastRenderedGraphState?.graph);
  const freshness = lastRenderedGraphState
    ? compareGraphFreshness(incomingGraph, lastRenderedGraphState.graph)
    : 1;
  if (lastRenderedGraphState
    && freshness === 0
    && incomingGraph.version === lastRenderedGraphState.graph.version
    && incomingFingerprint !== renderedFingerprint) {
    document.querySelector("#ingest-status").textContent = "A divergent graph with the same revision arrived from another tab. This view was kept; reload to inspect the persisted graph.";
    return;
  }
  if (lastRenderedGraphState && freshness < 0) {
    const repaired = graphStore.write(lastRenderedGraphState.graph, {
      recordHistory: false,
      expectedVersion: incomingGraph.version,
      expectedFingerprint: fingerprintBackup(incomingGraph)
    });
    document.querySelector("#ingest-status").textContent = repaired
      ? "Ignored a stale graph update from another tab; the newer representation was preserved."
      : graphWriteFailureMessage(
        "Ignored a stale graph update from another tab; the newer representation remains visible.",
        "A newer graph update won while stale state was being repaired; this view remains current."
      );
    return;
  }
  renderWorkbench();
  document.querySelector("#ingest-status").textContent = "Graph updated in another tab; this view was refreshed.";
});
function updatePrivacyNote() {
  const endpointValue = extractorEndpointInput.value.trim();
  let extractorState = "LOCAL";
  if (endpointValue) {
    try {
      validateExtractorEndpoint(endpointValue);
      extractorState = "MODEL";
    } catch {
      extractorState = "INVALID";
    }
  }
  const usingRemoteExtractor = extractorState === "MODEL";
  const extractorMode = document.querySelector("#extractor-mode");
  if (extractorMode) {
    extractorMode.textContent = extractorState;
    extractorMode.parentElement?.setAttribute("data-mode", extractorState);
  }
  if (privacyLive && privacyLive.dataset.state !== extractorState) {
    privacyLive.dataset.state = extractorState;
    privacyLive.textContent = extractorState === "LOCAL"
      ? "Extraction mode: local."
      : extractorState === "MODEL"
        ? "Extraction mode: model endpoint enabled; documents may be sent remotely."
        : "Extraction mode: invalid endpoint; remote sending is disabled.";
  }
  const storageNote = storageDurabilityFailure
    ? "Durable browser storage is unavailable; export a backup before leaving this tab."
    : hasPersistentStorage
    ? hasDurableStorage
      ? "The graph remains in durable browser storage; do not configure secrets in this page."
      : "The graph remains in browser storage; do not configure secrets in this page."
    : "Browser storage is unavailable, so this graph will last only until this tab is reloaded.";
  privacyNote.textContent = extractorState === "INVALID"
    ? `The extractor endpoint is invalid; no document will be sent remotely until it is corrected. ${storageNote}`
    : usingRemoteExtractor
    ? `Documents, optional source URI, and bounded reviewed feedback will be sent to the configured same-origin extractor endpoint. ${storageNote}`
    : `No document extraction call while the extractor endpoint is blank. ${storageNote}${hasPersistentStorage ? " The app may request persistent storage to reduce eviction risk." : ""}`;
}
extractorEndpointInput.addEventListener("input", updatePrivacyNote);
extractorEndpointInput.addEventListener("change", () => {
  try {
    const endpoint = validateExtractorEndpoint(extractorEndpointInput.value);
    if (endpoint) appStorage.setItem(extractorEndpointKey, endpoint);
    else appStorage.removeItem(extractorEndpointKey);
    extractorEndpointInput.value = endpoint;
  } catch (error) {
    try {
      appStorage.removeItem(extractorEndpointKey);
    } catch {
      // Configuration persistence is an enhancement; extraction validation still applies.
    }
    document.querySelector("#ingest-status").textContent = boundedOperationDiagnostic(error, "The extractor endpoint configuration is invalid.");
  }
  updatePrivacyNote();
});
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
const PERSISTENCE_REQUEST_TIMEOUT_MS = 3000;
async function requestPersistentStorage() {
  const storageManager = navigator.storage;
  if (persistenceRequested || typeof storageManager?.persist !== "function") return;
  persistenceRequested = true;
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("Persistent storage request timed out.")), PERSISTENCE_REQUEST_TIMEOUT_MS);
  });
  try {
    if (typeof storageManager.persisted === "function"
      && await Promise.race([storageManager.persisted(), timeoutPromise])) return;
    await Promise.race([storageManager.persist(), timeoutPromise]);
  } catch {
    // Persistence is an enhancement; normal local storage remains usable.
  } finally {
    clearTimeout(timeout);
  }
}
let graphSearchQuery = "";
function createGraphSearchIndex(graph) {
  const documentTitleMap = new Map(graph.documents.map((document) => [document.id, document]));
  const nodeTextCache = new Map();
  const edgeTextCache = new Map();
  const sourceSearchTextCache = new Map();
  const evidenceText = (evidence) => evidence
    .slice(0, 8)
    .map((item) => sliceTextAtCodePointBoundary(item.text, MAX_SEARCH_EVIDENCE_CHARS))
    .join(" ");
  const sourceSearchText = (document) => {
    if (sourceSearchTextCache.has(document)) return sourceSearchTextCache.get(document);
    const parts = [
      document.title || document.id,
      document.uri || "",
      document.quality || "",
      document.lastReviewedAt || "",
      sliceTextAtCodePointBoundary(document.text, MAX_SEARCH_TEXT_CHARS)
    ];
    const text = sliceTextAtCodePointBoundary(parts.join(" "), MAX_SEARCH_TEXT_CHARS).toLowerCase();
    sourceSearchTextCache.set(document, text);
    return text;
  };
  const sourceTitles = (sources) => sources.map((sourceId) => {
    const document = documentTitleMap.get(sourceId);
    return document ? sourceSearchText(document) : sourceId;
  }).join(" ");
  const nodeText = (node) => {
    if (nodeTextCache.has(node)) return nodeTextCache.get(node);
    const text = sliceTextAtCodePointBoundary([
      node.label,
      ...(node.aliases || []),
      node.type,
      sourceTitles(node.sources),
      evidenceText(node.evidence)
    ].join(" "), MAX_SEARCH_TEXT_CHARS).toLowerCase();
    nodeTextCache.set(node, text);
    return text;
  };
  const edgeText = (edge, nodeName) => {
    if (edgeTextCache.has(edge)) return edgeTextCache.get(edge);
    const text = sliceTextAtCodePointBoundary([
      nodeName(edge.source),
      edge.label,
      nodeName(edge.target),
      edge.status,
      sourceTitles(edge.sources),
      evidenceText(edge.evidence)
    ].join(" "), MAX_SEARCH_TEXT_CHARS).toLowerCase();
    edgeTextCache.set(edge, text);
    return text;
  };
  return { documentTitleMap, nodeText, edgeText, sourceText: sourceSearchText };
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
let lastRenderedGraphState = null;
const workbenchDerivedCache = {
  fingerprint: null,
  expiresAt: 0,
  health: null,
  reviews: null,
  markdown: null
};
function renderInspector(graph) {
  const panel = document.querySelector("#inspector-panel");
  if (!selectedGraphItem) {
    panel.innerHTML = `<div class="inspector-empty"><span>INSPECTOR</span><p>Select a concept or relation to inspect its evidence.</p></div>`;
    return;
  }
  const evidenceMarkup = (item) => {
    const sourceLinks = item.sources?.map((sourceId) => {
      const source = graph.documents.find((doc) => doc.id === sourceId);
      return `<button type="button" class="evidence-source" data-select-source="${escapeHtml(sourceId)}">${escapeHtml(source?.title || sourceId)}</button>`;
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
    const mergeTargets = graph.nodes.filter((candidate) => candidate.id !== node.id).sort((left, right) => lexicalCompare(left.label, right.label));
    const feedbackActions = node.status === "rejected"
      ? `<button type="button" data-inspector-feedback="restore" data-node-id="${escapeHtml(node.id)}">↺ restore</button>`
      : `<button type="button" data-inspector-feedback="up" data-node-id="${escapeHtml(node.id)}">+ confirm</button><button type="button" data-inspector-feedback="down" data-node-id="${escapeHtml(node.id)}">− dismiss</button>`;
    panel.innerHTML = `
      <div class="inspector-header"><span>CONCEPT / ${escapeHtml(node.status.toUpperCase())}</span><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.type)} · ${(node.confidence * 100).toFixed(0)}% confidence · ${node.mentions} mention${node.mentions === 1 ? "" : "s"} · ${node.feedback} feedback${node.feedback === 1 ? "" : "s"}${node.lastReviewedAt ? ` · reviewed ${escapeHtml(node.lastReviewedAt)}` : ""}${node.aliases?.length ? ` · aliases: ${node.aliases.map(escapeHtml).join(", ")}` : ""}</small></div>
      <div class="inspector-feedback"><span class="inspector-label">REVIEW DECISION</span><div>${feedbackActions}</div></div>
      <div class="inspector-edit"><label for="inspector-node-label">EDIT LABEL</label><div><input id="inspector-node-label" class="inspector-edit-input" value="${escapeHtml(node.label)}" maxlength="120" /><button type="button" data-edit-node="${escapeHtml(node.id)}">save</button></div></div>
      ${mergeTargets.length ? `<div class="inspector-merge"><label for="inspector-merge-target">MERGE INTO</label><div><select id="inspector-merge-target" class="inspector-edit-input">${mergeTargets.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.label)}</option>`).join("")}</select><button type="button" data-merge-node="${escapeHtml(node.id)}">merge</button></div><small>Keep the selected concept as the stable ID; evidence, aliases, and relations will be combined. This can be undone.</small></div>` : ""}
      <div class="inspector-columns">
        <div><span class="inspector-label">EVIDENCE</span>${node.evidence.length ? `<ul>${node.evidence.map(evidenceMarkup).join("")}</ul>` : "<p class=\"inspector-muted\">No evidence captured.</p>"}</div>
        <div><span class="inspector-label">SOURCES</span>${sources.length ? `<ul>${sources.map((item) => `<li><button type="button" class="inspector-link" data-select-source="${escapeHtml(item.id)}">${escapeHtml(item.title)} ↗</button></li>`).join("")}</ul>` : "<p class=\"inspector-muted\">No source attached.</p>"}</div>
      </div>
      <div class="inspector-relations"><span class="inspector-label">NEIGHBORS</span>${relations.length ? relations.map((edge) => {
        const otherId = edge.source === node.id ? edge.target : edge.source;
        const other = graph.nodes.find((item) => item.id === otherId);
        return `<button type="button" class="inspector-link" data-select-edge="${escapeHtml(edge.id)}">${escapeHtml(edge.label)} · ${escapeHtml(other?.label || otherId)} <small>${escapeHtml(edge.status)}</small></button>`;
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
    const preview = sliceTextAtCodePointBoundary(source.text, previewLimit);
    const relatedNodes = graph.nodes.filter((node) => node.sources.includes(source.id));
    const qualityOptions = [...SOURCE_QUALITIES].map((quality) => `<option value="${escapeHtml(quality)}"${source.quality === quality ? " selected" : ""}>${escapeHtml(quality)}</option>`).join("");
    const reviewedDate = source.lastReviewedAt ? source.lastReviewedAt.slice(0, 10) : "";
    panel.innerHTML = `
      <div class="inspector-header"><span>SOURCE DOCUMENT</span><strong>${escapeHtml(source.title)}</strong><small>${source.text.length.toLocaleString()} characters · added ${escapeHtml(source.addedAt)} · ${escapeHtml(source.quality)} quality${source.lastReviewedAt ? ` · reviewed ${escapeHtml(source.lastReviewedAt)}` : ""}${source.uri ? ` · ${/^https?:\/\//i.test(source.uri) ? `<a href="${escapeHtml(source.uri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.uri)}</a>` : escapeHtml(source.uri)}` : ""}</small></div>
      <div class="inspector-edit"><label for="inspector-source-title">EDIT SOURCE TITLE</label><div><input id="inspector-source-title" class="inspector-edit-input" value="${escapeHtml(source.title)}" maxlength="${MAX_DOCUMENT_TITLE_CHARS}" /></div><label for="inspector-source-uri">SOURCE URI</label><div><input id="inspector-source-uri" class="inspector-edit-input" value="${escapeHtml(source.uri || "")}" maxlength="${MAX_SOURCE_URI_CHARS}" inputmode="url" /></div><label for="inspector-source-quality">SOURCE QUALITY</label><div><select id="inspector-source-quality" class="inspector-edit-input">${qualityOptions}</select></div><label for="inspector-source-reviewed">LAST REVIEWED</label><div><input id="inspector-source-reviewed" class="inspector-edit-input" type="date" value="${escapeHtml(reviewedDate)}" /><button type="button" data-edit-source="${escapeHtml(source.id)}">save</button></div></div>
      <button type="button" class="text-button" data-review-source="${escapeHtml(source.id)}">mark reviewed today</button>
      <button type="button" class="replace-source" data-replace-source="${escapeHtml(source.id)}">Replace source with a newer file</button>
      <button type="button" class="remove-source" data-remove-source="${escapeHtml(source.id)}">Remove source from graph</button>
      <div class="inspector-source-actions"><span class="inspector-label">CONCEPTS FOUND</span>${relatedNodes.length ? relatedNodes.map((node) => `<button type="button" class="inspector-link" data-select-node="${escapeHtml(node.id)}">${escapeHtml(node.label)} <small>${escapeHtml(node.status)}</small></button>`).join("") : "<p class=\"inspector-muted\">No concepts attached.</p>"}</div>
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
    ? `<button type="button" data-inspector-feedback="restore" data-edge-id="${escapeHtml(edge.id)}">↺ restore</button>`
    : `<button type="button" data-inspector-feedback="up" data-edge-id="${escapeHtml(edge.id)}">+ confirm</button><button type="button" data-inspector-feedback="down" data-edge-id="${escapeHtml(edge.id)}">− dismiss</button>`;
  panel.innerHTML = `
  <div class="inspector-header"><span>RELATION / ${escapeHtml(edge.status.toUpperCase())}</span><strong>${escapeHtml(source?.label || edge.source)} <em>${escapeHtml(edge.label)}</em> ${escapeHtml(target?.label || edge.target)}</strong><small>${(edge.confidence * 100).toFixed(0)}% confidence · ${edge.feedback} feedback${edge.feedback === 1 ? "" : "s"} · ${edge.evidence.length} evidence item${edge.evidence.length === 1 ? "" : "s"}${edge.lastReviewedAt ? ` · reviewed ${escapeHtml(edge.lastReviewedAt)}` : ""}</small></div>
    <div class="inspector-feedback"><span class="inspector-label">REVIEW DECISION</span><div>${feedbackActions}</div></div>
    <div class="inspector-edit"><label for="inspector-edge-label">EDIT RELATION</label><div><input id="inspector-edge-label" class="inspector-edit-input" value="${escapeHtml(edge.label)}" maxlength="80" /><button type="button" data-edit-edge="${escapeHtml(edge.id)}">save</button></div></div>
    <div class="inspector-evidence"><span class="inspector-label">EVIDENCE</span>${edge.evidence.length ? `<ul>${edge.evidence.map(evidenceMarkup).join("")}</ul>` : "<p class=\"inspector-muted\">No evidence captured.</p>"}</div>`;
}

function renderWorkbenchUnsafe() {
  const graph = graphStore.read();
  lastRenderedGraphState = {
    graph,
    fingerprint: fingerprintBackup(graph)
  };
  const graphFingerprint = lastRenderedGraphState.fingerprint;
  const inspectionTime = Date.now();
  const derivedCacheHit = workbenchDerivedCache.fingerprint === graphFingerprint
    && workbenchDerivedCache.expiresAt > inspectionTime;
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
  const sourceList = document.querySelector("#source-list");
  const undoButton = document.querySelector("#undo-graph");
  document.querySelector("#graph-version").textContent = `REV ${String(graph.version).padStart(3, "0")}`;
  const activeNodeIds = new Set(positions.map((node) => node.id));
  const renderableEdges = graph.edges.filter((edge) => edge.status !== "rejected" && activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target));
  const activeEdges = renderableEdges.slice(0, MAX_RENDERED_GRAPH_EDGES);
  const activeCount = graph.nodes.filter((node) => node.status !== "rejected").length;
  const renderHiddenNodes = Math.max(0, matchingNodes.length - positions.length);
  const renderHiddenEdges = Math.max(0, renderableEdges.length - activeEdges.length);
  const renderCapDetails = [
    renderHiddenNodes ? `${renderHiddenNodes} concept${renderHiddenNodes === 1 ? "" : "s"} not shown` : "",
    renderHiddenEdges ? `${renderHiddenEdges} relation${renderHiddenEdges === 1 ? "" : "s"} not shown` : ""
  ].filter(Boolean).join(" · ");
  const health = derivedCacheHit ? workbenchDerivedCache.health : inspectGraph(graph, { now: inspectionTime, includeReviewQueue: true });
  const reviews = derivedCacheHit ? workbenchDerivedCache.reviews : health.reviewQueue;
  const reviewQueuePanel = document.querySelector("#review-queue");
  const matchingSourceDocuments = graph.documents.filter((document) => !graphSearchQuery.trim() || searchIndex.sourceText(document).includes(graphSearchQuery.toLowerCase().trim()));
  const sourceQualitySummary = Object.entries(health.sourceQuality).filter(([, count]) => count > 0).map(([quality, count]) => `${count} ${quality}`).join(", ") || "no source quality";
  document.querySelector("#graph-summary").textContent = graph.nodes.length
    ? `${positions.length}${graphSearchQuery ? `/${activeCount}` : ""} visible · ${activeEdges.length} relations · ${graph.documents.length} source${graph.documents.length === 1 ? "" : "s"}${graph.nodes.length - activeCount ? ` · ${graph.nodes.length - activeCount} dismissed` : ""}${graphSearchQuery && matchingNodes.length > positions.length ? ` · ${matchingNodes.length - positions.length} filtered` : ""}${graphSearchQuery ? ` · ${matchingSourceDocuments.length} matching source${matchingSourceDocuments.length === 1 ? "" : "s"}` : ""}${renderCapDetails ? ` · view capped: ${renderCapDetails}; refine search to inspect more` : ""}`
    : graph.documents.length
      ? graphSearchQuery && matchingSourceDocuments.length
        ? `${matchingSourceDocuments.length} matching source${matchingSourceDocuments.length === 1 ? "" : "s"} · no matching concepts`
        : `${graph.documents.length} source${graph.documents.length === 1 ? "" : "s"} · no concepts extracted yet`
      : "No concepts yet — ingest a document to begin.";
  document.querySelector("#hero-node-count").textContent = positions.length;
  document.querySelector("#hero-edge-count").textContent = activeEdges.length;
  document.querySelector("#hero-source-count").textContent = graph.documents.length;
  const recoveryAvailable = Boolean(graphStore.readRecovery());
  const historyRecoveryAvailable = Boolean(graphStore.readHistoryRecovery());
  const recoverySuppressed = Boolean(graphStore.hasRecoverySuppression?.());
  const storageMode = graphStore.getLastWriteMode();
  const reducedHistory = storageMode === "without-history" || storageMode === "without-new-history";
  const ephemeralStorage = !hasPersistentStorage;
  const storageWarning = [
    ephemeralStorage ? "<small class=\"storage-warning\">Browser storage unavailable; changes last only this tab</small>" : "",
    reducedHistory ? "<small class=\"storage-warning\">Saved with reduced undo history</small>" : "",
    storageDurabilityFailure ? "<small class=\"storage-warning\">Durable storage unavailable</small>" : "",
    ephemeralStorage || reducedHistory || storageDurabilityFailure ? `<button type="button" data-storage-action="backup">download backup</button>` : ""
  ].filter(Boolean).join("");
  const truncationDetails = [
    health.truncatedDocumentTitle ? `${health.truncatedDocumentTitle} document title${health.truncatedDocumentTitle === 1 ? "" : "s"} clipped` : "",
    health.truncatedDocumentText ? `${health.truncatedDocumentText} document text clipped or omitted` : "",
    health.truncatedEvidenceText ? `${health.truncatedEvidenceText} evidence text clipped` : "",
    health.truncatedEvidenceItems ? `${health.truncatedEvidenceItems} evidence entr${health.truncatedEvidenceItems === 1 ? "y" : "ies"} omitted` : "",
    health.truncatedAliases ? `${health.truncatedAliases} alias entr${health.truncatedAliases === 1 ? "y" : "ies"} clipped` : "",
    health.truncatedSourceReferences ? `${health.truncatedSourceReferences} provenance reference${health.truncatedSourceReferences === 1 ? "" : "s"} omitted` : "",
    health.truncatedDocuments ? `${health.truncatedDocuments} document entr${health.truncatedDocuments === 1 ? "y" : "ies"} omitted` : "",
    health.truncatedNodes ? `${health.truncatedNodes} concept entr${health.truncatedNodes === 1 ? "y" : "ies"} omitted` : "",
    health.truncatedEdges ? `${health.truncatedEdges} relation entr${health.truncatedEdges === 1 ? "y" : "ies"} omitted` : "",
    health.truncatedRevisions ? `${health.truncatedRevisions} revision entr${health.truncatedRevisions === 1 ? "y" : "ies"} omitted` : "",
    health.truncatedLearningExamples ? `${health.truncatedLearningExamples} learning entr${health.truncatedLearningExamples === 1 ? "y" : "ies"} omitted` : ""
  ].filter(Boolean).join(" · ");
  document.querySelector("#graph-health").innerHTML = `<span>HEALTH</span><small>${health.provenanceCoverage}% provenance</small><small>${health.sourceReviewCoverage}% sources reviewed · ${health.freshSourceReviewCoverage}% fresh</small><small>${health.reviewedItems} feedback decision${health.reviewedItems === 1 ? "" : "s"} in memory</small><small>guidance: ${health.feedbackContextRetained}/${health.feedbackContextAvailable}${health.feedbackContextExcluded ? ` · ${health.feedbackContextExcluded} withheld` : ""}${health.feedbackContextTruncated ? " capped" : ""}</small><small>learning: ${health.acceptedItems} accepted · ${health.rejectedItems} rejected · ${health.learningExamples} reusable${health.staleLearningExamples ? ` · ${health.staleLearningExamples} stale` : ""}</small>${health.learningExamples ? `<button type="button" data-learning-action="clear">forget reusable memory</button>` : ""}${health.staleLearningExamples ? `<button type="button" data-learning-action="clear-stale">forget stale learning</button>` : ""}${health.learningExamples && graph.documents.length ? `<button type="button" data-learning-action="rebuild">apply learning to saved sources</button>` : ""}${health.truncated ? `<small class="privacy-warning">import truncated ${health.truncatedItems} item${health.truncatedItems === 1 ? "" : "s"}: ${escapeHtml(truncationDetails)} — restore the original export before editing</small>` : ""}${health.dropped ? `<small class="privacy-warning">import dropped ${health.droppedItems} malformed item${health.droppedItems === 1 ? "" : "s"} — inspect the original export</small>` : ""}${health.conflictingItems ? `<small class="privacy-warning">${health.conflictingItems} duplicate concept/relation record${health.conflictingItems === 1 ? "" : "s"} had contradictory review statuses — inspect the original export</small>` : ""}${health.redacted ? "<small class=\"privacy-warning\">redacted source content</small>" : ""}<small>quality: ${escapeHtml(sourceQualitySummary)}</small><small>${health.unsupportedNodes} unsupported concept${health.unsupportedNodes === 1 ? "" : "s"}</small><small>${health.unsupportedEdges} unsupported relation${health.unsupportedEdges === 1 ? "" : "s"}</small>${health.ambiguousLabels ? `<small>${health.ambiguousLabels} ambiguous concept label${health.ambiguousLabels === 1 ? "" : "s"}</small>` : ""}${reviews.length ? `<small>${reviews.length} review candidate${reviews.length === 1 ? "" : "s"}${health.staleReviewCandidates ? ` · ${health.staleReviewCandidates} stale` : ""}${health.newEvidenceReviewCandidates ? ` · ${health.newEvidenceReviewCandidates} new evidence` : ""}</small><button type="button" data-review-action="next">review next</button>` : ""}${health.orphanedSourceReferences ? `<small>${health.orphanedSourceReferences} broken source reference${health.orphanedSourceReferences === 1 ? "" : "s"} — inspect import</small>` : ""}${health.ambiguousSourceIds ? `<small>${health.ambiguousSourceIds} ambiguous source ID${health.ambiguousSourceIds === 1 ? "" : "s"} — inspect import</small>` : ""}${health.ambiguousEdgeIds ? `<small>${health.ambiguousEdgeIds} ambiguous relation ID${health.ambiguousEdgeIds === 1 ? "" : "s"} — inspect import</small>` : ""}${health.ambiguousSourceReferences ? `<small>${health.ambiguousSourceReferences} ambiguous provenance reference${health.ambiguousSourceReferences === 1 ? "" : "s"}</small>` : ""}${storageWarning}${recoveryAvailable ? `<small class="recovery-warning">Recovery snapshot available</small><button type="button" data-recovery-action="download">download recovery</button><button type="button" data-recovery-action="dismiss">dismiss</button>` : ""}${historyRecoveryAvailable ? `<small class="recovery-warning">Undo history recovery available</small><button type="button" data-recovery-action="history-download">download history recovery</button><button type="button" data-recovery-action="history-dismiss">dismiss</button>` : ""}`;
  if (health.reviewQueueTruncated) {
    const warning = document.createElement("small");
    warning.className = "privacy-warning";
    warning.textContent = "Review queue capped; some candidates are not shown.";
    document.querySelector("#graph-health").append(warning);
  }
  if (recoverySuppressed) {
    const warning = document.createElement("small");
    warning.className = "recovery-warning";
    warning.textContent = "A recovery snapshot exceeded the safety limit and was not retained.";
    const backupButton = document.createElement("button");
    backupButton.type = "button";
    backupButton.dataset.storageAction = "backup";
    backupButton.textContent = "download backup";
    document.querySelector("#graph-health").append(warning, backupButton);
  }
  if (health.evidenceGroundingAvailable) {
    const grounding = document.createElement("small");
    grounding.textContent = `${health.evidenceGroundingCoverage}% evidence anchored${health.unanchoredEvidenceRecords ? ` · ${health.unanchoredEvidenceRecords} unanchored` : ""}${health.evidenceGroundingTruncated ? " · sample capped" : ""}`;
    document.querySelector("#graph-health").append(grounding);
  }
  const reviewQueueOpen = reviewQueuePanel.querySelector("details")?.open;
  const reviewNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const reviewCandidates = reviews.slice(0, 30).map((candidate) => {
    const item = candidate.kind === "node"
      ? reviewNodeById.get(candidate.id)
      : candidate.kind === "edge"
        ? graph.edges.find((edge) => edge.id === candidate.id)
        : graph.documents.find((document) => document.id === candidate.id);
    const label = candidate.kind === "edge" && item
      ? `${reviewNodeById.get(item.source)?.label || item.source} ${item.label} ${reviewNodeById.get(item.target)?.label || item.target}`
      : candidate.label;
    return `<button type="button" class="review-candidate" data-review-queue-kind="${escapeHtml(candidate.kind)}" data-review-queue-id="${escapeHtml(candidate.id)}"><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(candidate.kind)} · priority ${candidate.priority.toFixed(2)}</small></span><em>${escapeHtml(candidate.reason || "routine review")}</em></button>`;
  }).join("");
  reviewQueuePanel.innerHTML = reviews.length
    ? `<details${reviewQueueOpen ? " open" : ""}><summary><span>REVIEW QUEUE</span><small>${reviews.length} candidate${reviews.length === 1 ? "" : "s"} · showing ${Math.min(30, reviews.length)}</small></summary><div class="review-queue-items">${reviewCandidates}</div></details>`
    : "";
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
    const nodes = positions.map((node) => {
      const selected = selectedGraphItem?.kind === "node" && selectedGraphItem.id === node.id;
      return `<g class="graph-node" data-node-id="${escapeHtml(node.id)}" tabindex="0" focusable="true" role="button" aria-current="${selected ? "true" : "false"}" aria-label="Inspect ${escapeHtml(node.label)}"><title>${escapeHtml(node.label)} — ${(node.confidence * 100).toFixed(0)}% confidence</title><circle cx="${node.x}" cy="${node.y}" r="${Math.min(29, 19 + node.mentions * 2)}"></circle><text x="${node.x}" y="${node.y + 4}">${escapeHtml(sliceTextAtCodePointBoundary(node.label, 18))}</text></g>`;
    }).join("");
    canvas.innerHTML = `<g class="graph-edges">${edges}</g><g class="graph-nodes">${nodes}</g>`;
  }
  const query = graphSearchQuery.toLowerCase().trim();
  const matchingGraphNodes = graph.nodes.filter((node) => {
    if (!query) return true;
    return searchIndex.nodeText(node).includes(query);
  });
  const visibleGraphNodes = matchingGraphNodes.slice(0, MAX_RENDERED_GRAPH_NODES);
  list.innerHTML = visibleGraphNodes.map((node) => {
    const selected = selectedGraphItem?.kind === "node" && selectedGraphItem.id === node.id;
    return `<div class="node-row ${node.status === "rejected" ? "rejected" : ""}${selected ? " selected" : ""}" data-node-id="${escapeHtml(node.id)}"><button type="button" class="row-inspect" data-select-node="${escapeHtml(node.id)}" aria-current="${selected ? "true" : "false"}" aria-label="Inspect concept ${escapeHtml(node.label)}"><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.type)} · ${escapeHtml(node.status)} · ${(node.confidence * 100).toFixed(0)}% confidence · ${node.mentions} mention${node.mentions === 1 ? "" : "s"} · ${node.feedback} feedback</small></button><div class="node-feedback">${node.status === "rejected" ? `<button type="button" data-feedback="restore" data-node-id="${escapeHtml(node.id)}" aria-label="Restore ${escapeHtml(node.label)}">↺ restore</button>` : `<button type="button" data-feedback="up" data-node-id="${escapeHtml(node.id)}" aria-label="Confirm ${escapeHtml(node.label)}">+ confirm</button><button type="button" data-feedback="down" data-node-id="${escapeHtml(node.id)}" aria-label="Dismiss ${escapeHtml(node.label)}">− dismiss</button>`}</div></div>`;
  }).join("");
  const nodeName = (id) => nodeById.get(id)?.label || id;
  const matchingGraphEdges = graph.edges.filter((edge) => {
    if (!query) return true;
    return searchIndex.edgeText(edge, nodeName).includes(query);
  });
  const visibleGraphEdges = matchingGraphEdges.slice(0, MAX_RENDERED_GRAPH_EDGES);
  relationList.innerHTML = visibleGraphEdges.map((edge) => {
    const relationName = `${nodeName(edge.source)} ${edge.label} ${nodeName(edge.target)}`;
    const selected = selectedGraphItem?.kind === "edge" && selectedGraphItem.id === edge.id;
    return `<div class="relation-row ${edge.status === "rejected" ? "rejected" : ""}${selected ? " selected" : ""}" data-edge-id="${escapeHtml(edge.id)}"><button type="button" class="row-inspect" data-select-edge="${escapeHtml(edge.id)}" aria-current="${selected ? "true" : "false"}" aria-label="Inspect relation ${escapeHtml(relationName)}"><strong>${escapeHtml(nodeName(edge.source))} <span>${escapeHtml(edge.label)}</span> ${escapeHtml(nodeName(edge.target))}</strong><small>${escapeHtml(edge.status)} · ${(edge.confidence * 100).toFixed(0)}% confidence · ${edge.feedback} feedback · ${edge.evidence.length} evidence item${edge.evidence.length === 1 ? "" : "s"}</small></button><div class="node-feedback">${edge.status === "rejected" ? `<button type="button" data-edge-feedback="restore" data-edge-id="${escapeHtml(edge.id)}" aria-label="Restore relation ${escapeHtml(relationName)}">↺ restore</button>` : `<button type="button" data-edge-feedback="up" data-edge-id="${escapeHtml(edge.id)}" aria-label="Confirm relation ${escapeHtml(relationName)}">+ confirm</button><button type="button" data-edge-feedback="down" data-edge-id="${escapeHtml(edge.id)}" aria-label="Dismiss relation ${escapeHtml(relationName)}">− dismiss</button>`}</div></div>`;
  }).join("");
  const sourceNodeCounts = new Map();
  graph.nodes.forEach((node) => node.sources.forEach((sourceId) => {
    sourceNodeCounts.set(sourceId, (sourceNodeCounts.get(sourceId) || 0) + 1);
  }));
  const visibleSources = matchingSourceDocuments.slice(0, MAX_RENDERED_GRAPH_NODES);
  sourceList.innerHTML = visibleSources.length
    ? `<div class="source-list-heading">SOURCE DOCUMENTS · ${visibleSources.length}${graph.documents.length > visibleSources.length ? `/${graph.documents.length}` : ""}</div>${visibleSources.map((document) => { const selected = selectedGraphItem?.kind === "source" && selectedGraphItem.id === document.id; return `<button type="button" class="source-row${selected ? " selected" : ""}" data-source-id="${escapeHtml(document.id)}" aria-current="${selected ? "true" : "false"}" aria-label="Inspect source ${escapeHtml(document.title)}"><span class="source-row-main"><strong>${escapeHtml(document.title)}</strong><small>${document.text.length.toLocaleString()} characters · <em>${escapeHtml(document.quality)}</em> quality${document.lastReviewedAt ? ` · reviewed ${escapeHtml(document.lastReviewedAt)}` : ""}</small></span><small>${sourceNodeCounts.get(document.id) || 0} concepts</small></button>`; }).join("")}`
    : "<div class=\"source-list-heading\">No matching source documents.</div>";
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
    ? `<details${wasRevisionOpen ? " open" : ""}><summary><span>MEMORY</span><small>${graph.revisions.length} retained revision${graph.revisions.length === 1 ? "" : "s"}</small></summary><div class="revision-items">${graph.revisions.map((revision) => `<div><b>v${revision.version}</b><span>${escapeHtml(revision.reason)}</span><small>${escapeHtml(revision.timestamp)} · ${escapeHtml(revision.operation || "unknown")}${revision.extractor && revision.extractor !== "unknown" ? ` · ${escapeHtml(revision.extractor)} extractor` : ""} · ${revision.nodes} nodes · ${revision.edges} relations</small></div>`).join("")}</div></details>`
    : "<span>MEMORY</span><small>No revisions yet.</small>";
  const revisionDiffPreview = document.querySelector("#revision-diff-preview");
  const history = graphStore.readHistory();
  if (!history.length) {
    revisionDiffPreview.innerHTML = "";
  } else {
    const diff = diffGraphs(history.at(-1), graph);
    const integrityChanges = [
      ...["conflictingNodeIds", "conflictingEdgeIds"].flatMap((kind) => [
        ...diff.integrity[kind].added.map((id) => `integrity: ${kind} added ${id}`),
        ...diff.integrity[kind].removed.map((id) => `integrity: ${kind} removed ${id}`)
      ]),
      ...["truncated", "dropped"].flatMap((kind) => Object.keys(diff.integrity[kind].after)
        .filter((key) => diff.integrity[kind].before[key] !== diff.integrity[kind].after[key])
        .map((key) => `integrity: ${kind}.${key} ${diff.integrity[kind].before[key]} → ${diff.integrity[kind].after[key]}`))
    ];
    const changes = [
      ...diff.nodes.changed.map((change) => `concept: ${change.before.label || change.after.label} → ${change.after.label || change.before.label}`),
      ...diff.edges.changed.map((change) => `relation: ${change.before.label || change.after.label} → ${change.after.label || change.before.label}`),
      ...diff.learning.added.map((example) => `learning: ${example.label || example.identity} added`),
      ...diff.learning.removed.map((example) => `learning: ${example.label || example.identity} removed`),
      ...integrityChanges
    ].slice(0, 5);
    revisionDiffPreview.innerHTML = `<details><summary><span>LAST DIFF</span><small>${diff.summary.added} added · ${diff.summary.changed} changed · ${diff.summary.removed} removed</small></summary><div class="revision-diff-items">${changes.length ? changes.map((change) => `<small>${escapeHtml(change)}</small>`).join("") : "<small>No summarized field changes.</small>"}</div></details>`;
  }
  const projectionFingerprint = graphFingerprint;
  const projection = derivedCacheHit && workbenchDerivedCache.markdown
    ? workbenchDerivedCache.markdown
    : buildMarkdown(graph, { maxEvidenceChars: MAX_MARKDOWN_PREVIEW_EVIDENCE_CHARS, graphFingerprint: projectionFingerprint, health });
  workbenchDerivedCache.fingerprint = projectionFingerprint;
  workbenchDerivedCache.health = health;
  workbenchDerivedCache.reviews = reviews;
  workbenchDerivedCache.markdown = projection;
  if (!derivedCacheHit) workbenchDerivedCache.expiresAt = inspectionTime + WORKBENCH_DERIVED_CACHE_TTL_MS;
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
    document.querySelector("#app-error-message").textContent = boundedOperationDiagnostic(error, "The saved graph was preserved, but this view could not render.");
  }
}

const safeMarkdownLabel = (value) => String(value).replace(/[\[\]|\r\n]/g, " ").replace(/\s+/g, " ").trim();
const safeMarkdownUri = (value) => {
  const uri = String(value).replace(/[\r\n<>]/g, "").trim();
  const normalized = normalizeSourceUri(uri);
  if (!normalized || !/^https?:\/\//i.test(normalized)) return safeMarkdownLabel(uri);
  return `[${safeMarkdownLabel(normalized)}](<${normalized}>)`;
};
const quoteMarkdown = (value) => String(value).replace(/\r\n?/g, "\n").split("\n").map((line) => `> ${line}`).join("\n");

function buildMarkdown(graph, { maxEvidenceChars = Number.POSITIVE_INFINITY, graphFingerprint = fingerprintBackup(graph), health = null } = {}) {
  const MAX_MARKDOWN_EXPORT_EVIDENCE_CHARS = 40 * 1024 * 1024;
  graph = canonicalizeGraphForExport(graph);
  const graphHealth = health || inspectGraph(graph);
  const guidanceContext = [
    `${graphHealth.feedbackContextRetained}/${graphHealth.feedbackContextAvailable} retained`,
    graphHealth.feedbackContextExcluded ? `${graphHealth.feedbackContextExcluded} withheld pending review` : "",
    graphHealth.feedbackContextTruncated ? "context capped" : ""
  ].filter(Boolean).join("; ");
  const paths = buildProjectionPaths(graph);
  const sourceById = new Map(graph.documents.map((doc) => [doc.id, doc]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const sourceLabel = (id) => safeMarkdownLabel(sourceById.get(id)?.title || id);
  const nodeLabel = (id) => safeMarkdownLabel(nodeById.get(id)?.label || id);
  const conceptLink = (id) => paths.nodes.has(id) ? `[[${paths.nodes.get(id)}|${nodeLabel(id)}]]` : `[[${nodeLabel(id)}]]`;
  const sourceLink = (id) => paths.sources.has(id) ? `[[${paths.sources.get(id)}|${sourceLabel(id)}]]` : `[[${sourceLabel(id)}]]`;
  const revisionLines = graph.revisions.length
    ? graph.revisions.map((revision) => `- v${revision.version} · ${revision.timestamp} · ${revision.operation || "unknown"}${revision.extractor && revision.extractor !== "unknown" ? ` · ${revision.extractor} extractor` : ""} · ${safeMarkdownLabel(revision.reason)} · ${revision.nodes} concepts · ${revision.edges} relations`)
    : ["- none"];
  const learningLines = (graph.learning?.examples || []).map((example) => {
    const reviewedAt = example.lastReviewedAt ? `, reviewed ${safeMarkdownLabel(example.lastReviewedAt)}` : "";
    return example.kind === "concept"
      ? `- concept: ${safeMarkdownLabel(example.label)} (${example.status}${reviewedAt}${example.aliases?.length ? `, aliases: ${example.aliases.map(safeMarkdownLabel).join(", ")}` : ""})`
      : `- relation: ${safeMarkdownLabel(example.sourceLabel || example.source)} — ${safeMarkdownLabel(example.label)} → ${safeMarkdownLabel(example.targetLabel || example.target)} (${example.status}${reviewedAt})`;
  });
  const reviewed = [...graph.nodes, ...graph.edges].filter((item) => item.status !== "inferred" || item.feedback !== 0);
  const accepted = [...graph.nodes.filter((node) => node.status === "accepted").map((node) => `- concept: ${conceptLink(node.id)}`), ...graph.edges.filter((edge) => edge.status === "accepted").map((edge) => `- relation: ${conceptLink(edge.source)} — ${safeMarkdownLabel(edge.label)} → ${conceptLink(edge.target)}`)];
  const rejected = [...graph.nodes.filter((node) => node.status === "rejected").map((node) => `- concept: ${conceptLink(node.id)}`), ...graph.edges.filter((edge) => edge.status === "rejected").map((edge) => `- relation: ${conceptLink(edge.source)} — ${safeMarkdownLabel(edge.label)} → ${conceptLink(edge.target)}`)];
  const mermaidNodes = graph.nodes.slice(0, 150);
  const mermaidIds = new Map(mermaidNodes.map((node, index) => [node.id, `n${index}`]));
  const mermaidText = (value) => sliceTextAtCodePointBoundary(String(value).replace(/["\\\r\n[\]<>]/g, " ").replace(/\|/g, "/"), 120);
  const mermaidCandidateEdges = graph.edges.filter((edge) => mermaidIds.has(edge.source) && mermaidIds.has(edge.target));
  const mermaidEdges = mermaidCandidateEdges.slice(0, 300);
  const omittedMermaidNodes = Math.max(0, graph.nodes.length - mermaidNodes.length);
  const omittedMermaidEdges = Math.max(0, graph.edges.length - mermaidEdges.length);
  const mermaidLines = [
    "```mermaid",
    "graph LR",
    ...(mermaidNodes.length ? mermaidNodes.map((node) => `  ${mermaidIds.get(node.id)}["${mermaidText(node.label)}"]`) : ['  empty["No concepts"]']),
    ...mermaidEdges
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
    if (evidenceTruncated) return;
    if (evidenceChars + line.length > evidenceLimit) {
      evidenceTruncated = true;
      return;
    }
    evidenceLines.push(line);
    evidenceChars += line.length;
  };
  for (const node of graph.nodes) {
    for (const quote of node.evidence) {
      addEvidence(`${quoteMarkdown(quote.text)}\n>\n> — ${conceptLink(node.id)}${quote.sources?.length ? `\n> sources: ${quote.sources.map(sourceLink).join(", ")}` : ""}`);
      if (evidenceTruncated) break;
    }
    if (evidenceTruncated) break;
  }
  if (!evidenceTruncated) {
    for (const edge of graph.edges) {
      for (const quote of edge.evidence) {
        addEvidence(`${quoteMarkdown(quote.text)}\n>\n> — ${conceptLink(edge.source)} ${safeMarkdownLabel(edge.label)} ${conceptLink(edge.target)}${quote.sources?.length ? `\n> sources: ${quote.sources.map(sourceLink).join(", ")}` : ""}`);
        if (evidenceTruncated) break;
      }
      if (evidenceTruncated) break;
    }
  }
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
    "## Graph health",
    `- Active-item provenance coverage: ${graphHealth.provenanceCoverage}%`,
    ...(graphHealth.evidenceGroundingAvailable ? [`- Evidence grounding: ${graphHealth.evidenceGroundingCoverage}% anchored${graphHealth.unanchoredEvidenceRecords ? ` · ${graphHealth.unanchoredEvidenceRecords} unanchored` : ""}${graphHealth.evidenceGroundingTruncated ? " · sample capped" : ""}`] : []),
    `- Unsupported concepts: ${graphHealth.unsupportedNodes}`,
    `- Unsupported relations: ${graphHealth.unsupportedEdges}`,
    `- Review candidates: ${graphHealth.reviewCandidates}${graphHealth.staleReviewCandidates ? ` (${graphHealth.staleReviewCandidates} stale)` : ""}${graphHealth.newEvidenceReviewCandidates ? ` (${graphHealth.newEvidenceReviewCandidates} with new evidence)` : ""}`,
    ...(graphHealth.reviewQueueTruncated ? ["- Review queue: capped at the safety limit; some candidates are not shown."] : []),
    `- Extractor guidance context: ${guidanceContext}`,
    ...(graphHealth.truncated ? [`- Import truncation: ${graphHealth.truncatedItems} item${graphHealth.truncatedItems === 1 ? "" : "s"} omitted or clipped; restore the original export before editing.`] : []),
    ...(graphHealth.dropped ? [`- Malformed import entries: ${graphHealth.droppedItems} item${graphHealth.droppedItems === 1 ? "" : "s"} dropped; inspect the original export.`] : []),
    ...(graphHealth.conflictingItems ? [`- Contradictory duplicate review records: ${graphHealth.conflictingItems} concept/relation entr${graphHealth.conflictingItems === 1 ? "y" : "ies"}; inspect the original export.`] : []),
    `- Source review coverage: ${graphHealth.sourceReviewCoverage}% historical · ${graphHealth.freshSourceReviewCoverage}% fresh`,
    "",
    "## Visual graph",
    "The bounded view below renders in Obsidian and Mermaid-compatible Markdown viewers.",
    ...(omittedMermaidNodes || omittedMermaidEdges
      ? [`- Visual graph omits ${omittedMermaidNodes} concept${omittedMermaidNodes === 1 ? "" : "s"} and ${omittedMermaidEdges} relation${omittedMermaidEdges === 1 ? "" : "s"} for safety; the concept and relation indexes above remain complete.`]
      : []),
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

function buildRedactedMarkdownProjection() {
  const graph = redactGraph(graphStore.read());
  assertGraphTextExportBudget([graph]);
  const markdown = buildMarkdown(graph);
  if (textEncoder.encode(markdown).byteLength > MAX_EXPORT_BYTES) {
    throw new Error("This redacted projection exceeds the 50 MB safety limit; use a bounded graph.");
  }
  return markdown;
}

function buildFeedbackDataset(graph) {
  const trustedFeedbackTime = (value) => {
    const timestamp = parseTimestamp(value);
    return Number.isFinite(timestamp) && timestamp <= Date.now() ? timestamp : Number.NaN;
  };
  const compare = (left, right) => {
    const leftText = String(left);
    const rightText = String(right);
    return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
  };
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeLabel = (id) => nodeById.get(id)?.label || id;
  const examples = [];
  const seen = new Set();
  let omittedExamples = 0;
  const reviewedNodes = [...graph.nodes]
    .sort((left, right) => compare(`${left.id}\u0000${slugify(left.label)}`, `${right.id}\u0000${slugify(right.label)}`))
    .filter((node) => node.status === "accepted" || node.status === "rejected");
  const reviewedEdges = [...graph.edges]
    .sort((left, right) => compare(
      `${left.source}\u0000${left.target}\u0000${slugify(left.label)}\u0000${left.id}`,
      `${right.source}\u0000${right.target}\u0000${slugify(right.label)}\u0000${right.id}`
    ))
    .filter((edge) => edge.status === "accepted" || edge.status === "rejected");
  const learningKeys = new Set((graph.learning?.examples || []).map((example) => (
    example.kind === "concept" ? `concept|${example.id}` : `relation|${example.id}`
  )));
  const currentKeys = new Set([
    ...reviewedNodes.map((node) => `concept|${node.id}`),
    ...reviewedEdges.map((edge) => `relation|${edge.id}`)
  ]);
  const reservedCurrentKeys = new Set([...currentKeys].filter((key) => !learningKeys.has(key)));
  const orderedLearningExamples = [...(graph.learning?.examples || [])].sort((left, right) => {
    const leftTime = trustedFeedbackTime(left.lastReviewedAt);
    const rightTime = trustedFeedbackTime(right.lastReviewedAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
    if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(leftTime) ? -1 : 1;
    return compare(
      `${left.kind}|${left.id}|${slugify(left.label || "")}`,
      `${right.kind}|${right.id}|${slugify(right.label || "")}`
    );
  });
  const addExample = (example) => {
    const key = example.kind === "concept"
      ? `concept|${example.id}`
      : `relation|${example.id}`;
    if (seen.has(key)) {
      const index = examples.findIndex((candidate) => (
        (candidate.kind === "concept" ? `concept|${candidate.id}` : `relation|${candidate.id}`) === key
      ));
      if (index >= 0) {
        const preferred = preferLearningExample(examples[index], example);
        examples[index] = preferred === example
          ? { ...examples[index], ...example }
          : examples[index];
      }
      return;
    }
    if (examples.length >= MAX_FEEDBACK_EXAMPLES) {
      omittedExamples += 1;
      return;
    }
    seen.add(key);
    examples.push({
      ...example,
      confidence: Number.isFinite(example.confidence) ? example.confidence : .5,
      feedback: Number.isInteger(example.feedback) ? example.feedback : 0,
      evidence: Array.isArray(example.evidence) ? example.evidence : [],
      sources: Array.isArray(example.sources) ? example.sources : []
    });
  };
  const learningBudget = Math.max(0, MAX_FEEDBACK_EXAMPLES - reservedCurrentKeys.size);
  let learningSlots = learningBudget;
  const learningCandidates = [];
  orderedLearningExamples.forEach((example) => {
    const key = example.kind === "concept" ? `concept|${example.id}` : `relation|${example.id}`;
    if (currentKeys.has(key) || learningSlots > 0) {
      learningCandidates.push(example);
      if (!currentKeys.has(key)) learningSlots -= 1;
    } else {
      omittedExamples += 1;
    }
  });
  learningCandidates.forEach(addExample);
  reviewedNodes.forEach((node) => addExample({
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
  reviewedEdges.forEach((edge) => addExample({
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
    examples,
    ...(omittedExamples ? { truncatedExamples: Math.min(MAX_FEEDBACK_EXPORT_OMITTED, omittedExamples) } : {})
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
  const compare = (left, right) => {
    const leftText = String(left);
    const rightText = String(right);
    return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
  };
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
  [...graph.nodes]
    .sort((left, right) => compare(left.id, right.id))
    .forEach((node) => nodes.set(node.id, allocate("Concepts", node.id, "concept")));
  [...graph.documents]
    .sort((left, right) => compare(left.id, right.id))
    .forEach((doc) => sources.set(doc.id, allocate("Sources", doc.id, "source")));
  [...graph.edges]
    .sort((left, right) => compare(`${left.id}\u0000${left.source}\u0000${left.target}`, `${right.id}\u0000${right.source}\u0000${right.target}`))
    .forEach((edge) => relations.set(edge, allocate("Relations", edge.id, "relation")));
  return { nodes, sources, relations };
}

function buildVaultFiles(graph, { appVersion = "unknown" } = {}) {
  assertGraphTextExportBudget([graph]);
  const graphFingerprint = fingerprintBackup(graph);
  const generatedAt = graph.updatedAt || DEFAULT_GRAPH_TIMESTAMP;
  const normalizedAppVersion = typeof appVersion === "string" && appVersion.trim()
    ? sliceTextAtCodePointBoundary(appVersion.trim(), MAX_PRODUCER_VERSION_CHARS)
    : "unknown";
  const compare = (left, right) => {
    const leftText = String(left);
    const rightText = String(right);
    return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
  };
  const projectedNodes = [...graph.nodes].sort((left, right) => compare(left.id, right.id));
  const projectedDocuments = [...graph.documents].sort((left, right) => compare(left.id, right.id));
  const projectedEdges = [...graph.edges].sort((left, right) => compare(
    `${left.id}\u0000${left.source}\u0000${left.target}`,
    `${right.id}\u0000${right.source}\u0000${right.target}`
  ));
  const projectedGraph = {
    ...graph,
    nodes: projectedNodes,
    documents: projectedDocuments,
    edges: projectedEdges
  };
  const paths = buildProjectionPaths(graph);
  const nodeById = new Map(projectedNodes.map((node) => [node.id, node]));
  const sourceById = new Map(projectedDocuments.map((doc) => [doc.id, doc]));
  const nodeDisplay = (id) => safeMarkdownLabel(nodeById.get(id)?.label || id);
  const sourceDisplay = (id) => safeMarkdownLabel(sourceById.get(id)?.title || id);
  const relatedByNode = new Map(projectedNodes.map((node) => [node.id, []]));
  projectedEdges.forEach((edge) => {
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
      `This is a ${projectedGraph.redacted === true ? "redacted" : "full"} projection of the graph. ${projectedGraph.redacted === true ? "Source text, evidence quotes, and source URIs were removed before export." : "Source notes contain the ingested text and evidence used by the representation."}`,
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
      "- [[Learning/review-ledger]] — reusable reviewed decisions that guide future extraction.",
      "- [[Relations]] — relation-oriented browse view.",
      "- `Concepts/` — one editable note per concept.",
      "- `Relations/` — one editable note per relation.",
      "- `Sources/` — source documents and provenance metadata.",
      "- `Learning/` — public curriculum notes included with the wiki.",
      "- `graph.json` — normalized internal representation.",
      "- `graph.jsonld` — versioned semantic-web projection of the graph.",
      ""
    ].join("\n")
  });
  addVaultFile({ name: "_index.md", content: buildMarkdown(projectedGraph, { graphFingerprint }) });
  const learningDecisionLines = projectedGraph.learning.examples.map((example) => {
    const reviewedAt = example.lastReviewedAt ? ` · reviewed ${safeMarkdownLabel(example.lastReviewedAt)}` : "";
    if (example.kind === "concept") {
      const path = paths.nodes.get(example.id);
      const label = safeMarkdownLabel(example.label);
      const link = path ? `[[${path}|${label}]]` : label;
      return `- concept: ${link} — ${example.status}${reviewedAt}`;
    }
    const edge = projectedEdges.find((candidate) => candidate.id === example.id);
    const path = edge ? paths.relations.get(edge) : null;
    const label = safeMarkdownLabel(example.label);
    const relation = `${safeMarkdownLabel(example.sourceLabel || example.source)} ${label} ${safeMarkdownLabel(example.targetLabel || example.target)}`;
    const link = path ? `[[${path}|${relation}]]` : relation;
    return `- relation: ${link} — ${example.status}${reviewedAt}`;
  });
  addVaultFile({
    name: "Learning/review-ledger.md",
    content: [
      "---",
      "type: learning-ledger",
      `graph_version: ${projectedGraph.version}`,
      `graph_fingerprint: ${graphFingerprint}`,
      `redacted: ${projectedGraph.redacted === true}`,
      "---",
      "",
      "# Reusable review ledger",
      "",
      "This is a derived Obsidian view of the graph's reusable human decisions.",
      "Edit the linked concept or relation note, then import that note to change",
      "the graph and learning memory.",
      "",
      ...(learningDecisionLines.length ? learningDecisionLines : ["- none"]),
      ""
    ].join("\n")
  });
  addVaultFile({
    name: "vault-manifest.json",
    content: JSON.stringify({
      format: VAULT_FORMAT,
      graphSchema: GRAPH_SCHEMA,
      graphVersion: projectedGraph.version,
      graphFingerprint,
      appVersion: normalizedAppVersion,
      redacted: projectedGraph.redacted === true,
      generatedAt
    }, null, 2)
  });
  addVaultFile({ name: "Relations.md", content: [
      "---",
      "type: relations",
      `graph_version: ${projectedGraph.version}`,
      "---",
      "",
      "# Relations",
      "",
      ...projectedEdges.flatMap((edge) => [
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
  addVaultFile({ name: "graph.json", content: JSON.stringify(buildGraphExport(projectedGraph, { appVersion: normalizedAppVersion }), null, 2) });
  addVaultFile({ name: "graph.jsonld", content: JSON.stringify(buildJsonLd(projectedGraph, { appVersion: normalizedAppVersion }), null, 2) });
  projectedNodes.forEach((node) => {
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
        `graph_version: ${projectedGraph.version}`,
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
  projectedEdges.forEach((edge) => {
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
        `graph_version: ${projectedGraph.version}`,
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
  projectedDocuments.forEach((doc) => {
    addVaultFile({
      name: paths.sources.get(doc.id),
      content: ["---", "type: source", `id: ${JSON.stringify(doc.id)}`, `fingerprint: ${JSON.stringify(doc.fingerprint)}`, `uri: ${JSON.stringify(doc.uri || "")}`, `added: ${doc.addedAt}`, `quality: ${doc.quality}`, `last_reviewed: ${doc.lastReviewedAt || ""}`, `graph_version: ${projectedGraph.version}`, `graph_fingerprint: ${graphFingerprint}`, `redacted: ${projectedGraph.redacted === true}`, "---", "", `# ${safeMarkdownLabel(doc.title)}`, "", ...(doc.uri ? [`Source URI: ${safeMarkdownUri(doc.uri)}`, ""] : []), ...(projectedGraph.redacted ? ["> Source content was redacted before this vault was exported."] : [doc.text]), ""].join("\n")
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
  const exportDeadline = Date.now() + MAX_LEARNING_VAULT_EXPORT_MS;
  for (const note of notes) {
    const remainingMs = exportDeadline - Date.now();
    if (remainingMs <= 0) {
      failures.push(`${note.id}: export timed out`);
      continue;
    }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(LEARNING_NOTE_TIMEOUT_MS, remainingMs));
      try {
        const response = await fetch(`./notes/${encodeURIComponent(note.id)}.md`, { cache: "no-cache", signal: controller.signal });
      if (!isReadableSameOriginResponse(response)) throw new Error("learning note response crossed the app origin boundary");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const content = await readBoundedTextResponse(response, MAX_LEARNING_NOTE_CHARS, "note exceeds the 1 MB safety limit", controller.signal);
      totalChars += content.length;
      if (totalChars > MAX_LEARNING_NOTES_CHARS) throw new Error("learning notes exceed the 10 MB safety limit");
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
      failures.push(`${note.id}: ${error?.name === "AbortError" ? "request timed out" : boundedOperationDiagnostic(error, "could not load")}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { files, failures };
}

let vaultExportInFlight = false;
async function withVaultExport(action) {
  if (vaultExportInFlight) return false;
  vaultExportInFlight = true;
  const vaultButtons = [
    document.querySelector("#download-vault"),
    document.querySelector("#download-redacted-vault")
  ].filter(Boolean);
  vaultButtons.forEach((button) => {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  });
  try {
    await action();
    return true;
  } finally {
    vaultExportInFlight = false;
    vaultButtons.forEach((button) => {
      button.disabled = false;
      button.setAttribute("aria-busy", "false");
    });
  }
}
const assertVaultGraphUnchanged = (fingerprint) => {
  if (fingerprintBackup(graphStore.read()) !== fingerprint) {
    throw new Error("The graph changed while the Obsidian vault was being prepared. Try the export again.");
  }
};

async function readBoundedTextResponse(response, maxChars, errorMessage = "note exceeds the 1 MB safety limit", signal) {
  const maxBytes = maxChars * 4;
  if (signal?.aborted) throw Object.assign(new Error("The response read was aborted."), { name: "AbortError" });
  const declaredLength = declaredResponseBytes(response);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(errorMessage);
  }
  if (!response.body?.getReader) {
    if (!Number.isFinite(declaredLength) || declaredLength > maxBytes) throw new Error(errorMessage);
    if (typeof response.arrayBuffer === "function") {
      let abortHandler;
      const abortPromise = signal
        ? new Promise((_, reject) => {
          abortHandler = () => {
            try {
              Promise.resolve(response.body?.cancel?.()).catch(() => {});
            } catch {
              // A non-conforming body must not suppress cancellation.
            }
            reject(Object.assign(new Error("The response read was aborted."), { name: "AbortError" }));
          };
          if (signal.aborted) abortHandler();
          else signal.addEventListener("abort", abortHandler, { once: true });
        })
        : null;
      try {
        const rawBytes = abortPromise
          ? await Promise.race([response.arrayBuffer(), abortPromise])
          : await response.arrayBuffer();
        if (!(rawBytes instanceof ArrayBuffer) && !ArrayBuffer.isView(rawBytes)) {
          throw new Error("The response does not contain byte data.");
        }
        const bytes = rawBytes instanceof ArrayBuffer
          ? new Uint8Array(rawBytes)
          : new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
        if (!Number.isSafeInteger(bytes.byteLength) || bytes.byteLength < 0) {
          throw new Error("The response contains an invalid byte length.");
        }
        if (signal?.aborted) throw Object.assign(new Error("The response read was aborted."), { name: "AbortError" });
        if (bytes.byteLength > maxBytes) throw new Error(errorMessage);
        if (Number.isFinite(declaredLength) && bytes.byteLength !== declaredLength) {
          throw new Error("The response byte length does not match Content-Length.");
        }
        const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (content.length > maxChars) throw new Error(errorMessage);
        return content;
      } finally {
        if (abortHandler) signal.removeEventListener("abort", abortHandler);
      }
    }
    throw new Error("This browser cannot validate response encoding safely.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const abortReader = () => {
    try {
      Promise.resolve(reader.cancel?.()).catch(() => {});
    } catch {
      // A non-conforming reader must not turn cancellation into an unhandled rejection.
    }
  };
  if (signal?.aborted) abortReader();
  signal?.addEventListener?.("abort", abortReader, { once: true });
  const cancelReader = () => {
    try {
      Promise.resolve(reader.cancel?.()).catch(() => {});
    } catch {
      // A non-conforming reader must not suppress the size failure.
    }
  };
  let content = "";
  let bytes = 0;
  let pendingReadSettled = true;
  try {
    const readChunk = () => {
      pendingReadSettled = false;
      const readPromise = Promise.resolve()
        .then(() => reader.read())
        .then(
          (result) => {
            pendingReadSettled = true;
            return result;
          },
          (error) => {
            pendingReadSettled = true;
            throw error;
          }
        );
      if (!signal) return readPromise;
      let readAbortHandler;
      const readAbortPromise = new Promise((_, reject) => {
        readAbortHandler = () => reject(Object.assign(new Error("The response read was aborted."), { name: "AbortError" }));
        if (signal.aborted) readAbortHandler();
        else signal.addEventListener("abort", readAbortHandler, { once: true });
      });
      return Promise.race([readPromise, readAbortPromise]).finally(() => {
        signal.removeEventListener("abort", readAbortHandler);
      });
    };
    while (true) {
      if (signal?.aborted) throw Object.assign(new Error("The response read was aborted."), { name: "AbortError" });
      const result = await readChunk();
      if (signal?.aborted) throw Object.assign(new Error("The response read was aborted."), { name: "AbortError" });
      if (!result
        || typeof result !== "object"
        || typeof result.done !== "boolean"
        || (result.done && result.value !== undefined)) {
        cancelReader();
        throw new Error("The response body contains an invalid stream result.");
      }
      if (result.done) break;
      const chunk = ArrayBuffer.isView(result.value)
        && Number.isSafeInteger(result.value.byteLength)
        && result.value.byteLength >= 0
        ? new Uint8Array(result.value.buffer, result.value.byteOffset, result.value.byteLength)
        : null;
      if (!chunk) {
        cancelReader();
        throw new Error("The response body contains an invalid byte chunk.");
      }
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        cancelReader();
        throw new Error(errorMessage);
      }
      content += decoder.decode(chunk, { stream: true });
      if (content.length > maxChars) {
        cancelReader();
        throw new Error(errorMessage);
      }
    }
    content += decoder.decode();
    if (Number.isFinite(declaredLength) && bytes !== declaredLength) {
      throw new Error("The response byte length does not match Content-Length.");
    }
    if (content.length > maxChars) throw new Error(errorMessage);
    return content;
  } finally {
    signal?.removeEventListener?.("abort", abortReader);
    if (pendingReadSettled) reader.releaseLock?.();
  }
}

const textEncoder = new TextEncoder();
function assertGraphTextExportBudget(graphs) {
  let bytes = 0;
  for (const graph of graphs) {
    for (const document of graph?.documents || []) bytes += textEncoder.encode(document.text || "").byteLength;
    for (const item of [...(graph?.nodes || []), ...(graph?.edges || [])]) {
      for (const evidence of item.evidence || []) bytes += textEncoder.encode(evidence.text || "").byteLength;
    }
    if (bytes > MAX_EXPORT_BYTES) {
      throw new Error("This export contains more than the 50 MB source/evidence safety budget.");
    }
  }
}
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
  if (!Array.isArray(files) || files.length > MAX_ZIP_FILES) {
    throw new Error("The vault export contains too many files.");
  }
  if (files.some((file) => !file || typeof file.name !== "string" || typeof file.content !== "string")) {
    throw new Error("The vault export contains an invalid file.");
  }
  const numericMaxBytes = Number(maxBytes);
  const archiveLimit = Number.isFinite(numericMaxBytes) && numericMaxBytes >= 1
    ? Math.min(MAX_ZIP_BYTES, Math.floor(numericMaxBytes))
    : MAX_ZIP_BYTES;
  let estimatedArchiveBytes = 22;
  files.forEach((file) => {
    const nameBytes = textEncoder.encode(file.name);
    if (nameBytes.length > 0xffff) throw new Error("The vault export contains a file name that is too long.");
    const contentBytes = textEncoder.encode(file.content);
    estimatedArchiveBytes += 30 + nameBytes.length + contentBytes.length + 46 + nameBytes.length;
    if (estimatedArchiveBytes > archiveLimit) throw new Error("The vault archive exceeds the 50 MB safety limit.");
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
    if (nextOffset + nextCentralLength + 22 > archiveLimit) throw new Error("The vault archive exceeds the 50 MB safety limit.");
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
  if (archiveLength > archiveLimit) throw new Error("The vault archive exceeds the 50 MB safety limit.");
  return concatBytes([...localParts, centralDirectory, end]);
}

function revokeObjectUrlLater(url) {
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // URL cleanup is best effort in restricted or test environments.
    }
  }, 1000);
}
function downloadFile(filename, content, type) {
  if (textEncoder.encode(content).byteLength > MAX_EXPORT_BYTES) throw new Error("This export exceeds the 50 MB safety limit.");
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  try {
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
  } finally {
    try {
      link.remove();
    } finally {
      revokeObjectUrlLater(objectUrl);
    }
  }
}
function downloadBytes(filename, bytes, type) {
  const byteView = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : ArrayBuffer.isView(bytes)
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : null;
  if (!byteView || !Number.isSafeInteger(byteView.byteLength) || byteView.byteLength < 0 || byteView.byteLength > MAX_EXPORT_BYTES) {
    throw new Error("This export exceeds the 50 MB safety limit.");
  }
  const blob = new Blob([byteView], { type });
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  try {
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
  } finally {
    try {
      link.remove();
    } finally {
      revokeObjectUrlLater(objectUrl);
    }
  }
}
function exportBackupSnapshot() {
  const backup = buildBackupEnvelope(graphStore.read(), graphStore.readHistory(), { appVersion: releaseInfo.version });
  assertGraphTextExportBudget([backup.graph, ...backup.history]);
  downloadFile("llm-field-notes-backup.json", JSON.stringify(backup, null, 2), "application/json");
  return backup;
}
function downloadRuntimeRecovery() {
  const rawGraphRecovery = graphStore.readRecovery();
  const rawHistoryRecovery = graphStore.readHistoryRecovery();
  if (!rawGraphRecovery && !rawHistoryRecovery) {
    exportBackupSnapshot();
    return "Recovery backup downloaded.";
  }
  if (rawGraphRecovery) downloadFile("llm-field-notes-recovery.json", rawGraphRecovery, "application/json");
  if (rawHistoryRecovery) downloadFile("llm-field-notes-history-recovery.json", rawHistoryRecovery, "application/json");
  return `Recovery snapshot${rawGraphRecovery && rawHistoryRecovery ? "s" : ""} downloaded.`;
}
globalThis.document?.querySelector("#download-error-backup")?.addEventListener("click", () => {
  const message = globalThis.document?.querySelector("#app-error-message");
  if (!message) return;
  try {
    message.textContent = downloadRuntimeRecovery();
  } catch (error) {
    message.textContent = error instanceof Error
      ? `Recovery download failed: ${boundedOperationDiagnostic(error, "the export could not be created")}`
      : "Recovery download failed; export a backup from the workbench after reloading.";
  }
});

let bypassSampleDraftConfirmation = false;
document.querySelector("#load-sample").addEventListener("click", () => {
  const title = document.querySelector("#document-title").value.trim();
  const uri = document.querySelector("#document-uri").value.trim();
  const text = document.querySelector("#document-input").value.trim();
  const hasDraft = pendingFiles.length || title || uri || text;
  if (hasDraft && !bypassSampleDraftConfirmation
    && !window.confirm("Replace the current unbuilt document with the sample? Your saved graph will remain unchanged.")) {
    document.querySelector("#ingest-status").textContent = "Sample not loaded; the current document draft was kept.";
    return;
  }
  pendingFiles = [];
  document.querySelector("#document-file").value = "";
  renderFileQueue();
  document.querySelector("#document-title").value = sampleDocument.title;
  document.querySelector("#document-uri").value = "";
  document.querySelector("#document-input").value = sampleDocument.text;
  saveDocumentDraft();
  document.querySelector("#ingest-status").textContent = "Sample loaded. Build the graph when ready.";
});
function startSampleWalkthrough() {
  if (workbenchBusy()) {
    document.querySelector("#ingest-status").textContent = "A graph build is already in progress. Cancel it before starting the sample.";
    document.querySelector("#workbench").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const currentGraph = graphStore.read();
  const hasGraphContent = currentGraph.nodes.length
    || currentGraph.edges.length
    || currentGraph.documents.length
    || currentGraph.learning?.examples?.length;
  if (hasGraphContent && !window.confirm("Add the sample document to this existing workspace? Your current graph remains undoable.")) {
    document.querySelector("#ingest-status").textContent = "Sample walkthrough canceled; the current graph was kept.";
    document.querySelector("#workbench").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  bypassSampleDraftConfirmation = true;
  try {
    loadSampleButton.click();
  } finally {
    bypassSampleDraftConfirmation = false;
  }
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
      document.querySelector("#ingest-status").textContent = boundedOperationDiagnostic(error, "The backup could not be exported.");
    }
    return;
  }
  const learningAction = event.target.closest("[data-learning-action]")?.dataset.learningAction;
  if (learningAction === "rebuild") {
    void rebuildSavedSources();
    return;
  }
  if (learningAction === "clear-stale") {
    const currentGraph = graphStore.read();
    const staleCount = inspectGraph(currentGraph).staleLearningExamples;
    if (!staleCount || !window.confirm(`Forget ${staleCount} stale reusable learning example${staleCount === 1 ? "" : "s"}? Fresh learning memory will remain.`)) return;
    const result = clearStaleLearningMemory(currentGraph);
    if (!result.changed) {
      document.querySelector("#ingest-status").textContent = mutationLimitMessage(result,
        result.limited === "version"
          ? "This graph has reached its revision limit. Export a backup before changing reusable memory."
          : "No stale reusable learning memory remains.");
      return;
    }
    if (!graphStore.write(result.graph, graphStoreOptions(currentGraph))) {
      document.querySelector("#ingest-status").textContent = graphStore.getLastWriteMode() === "conflict"
        ? "The graph changed in another tab. Stale learning memory was not cleared; reload and try again."
        : "Stale learning memory could not be cleared.";
      return;
    }
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = graphWriteSuccessMessage(`Forgot ${result.removed} stale reusable learning example${result.removed === 1 ? "" : "s"}.`);
    return;
  }
  if (learningAction === "clear") {
    if (!window.confirm("Forget reusable learning memory? Your documents and graph knowledge will remain.")) return;
    const currentGraph = graphStore.read();
    const result = clearLearningMemory(currentGraph);
    if (!result.changed) {
      if (result.limited) {
        document.querySelector("#ingest-status").textContent = mutationLimitMessage(
          result,
          "This graph has reached its revision limit. Export a backup before changing reusable memory."
        );
      }
      return;
    }
    if (!graphStore.write(result.graph, graphStoreOptions(currentGraph))) {
      document.querySelector("#ingest-status").textContent = graphStore.getLastWriteMode() === "conflict"
        ? "The graph changed in another tab. Reusable memory was not cleared; reload and try again."
        : "Reusable memory could not be cleared.";
      return;
    }
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = graphWriteSuccessMessage(`Forgot ${result.removed} reusable learning example${result.removed === 1 ? "" : "s"}.`);
    return;
  }
  const reviewAction = event.target.closest("[data-review-action]")?.dataset.reviewAction;
  if (reviewAction === "next") {
    if (graphSearchQuery) {
      graphSearchQuery = "";
      document.querySelector("#graph-search").value = "";
      renderWorkbench();
    }
    const candidate = reviewQueue(graphStore.read(), 1)[0];
    if (!candidate) return;
    document.querySelector(".mini-button[data-view='list']").click();
    if (candidate.kind === "node") selectGraphNode(candidate.id);
    else if (candidate.kind === "edge") selectGraphEdge(candidate.id);
    else selectSource(candidate.id);
    document.querySelector("#inspector-panel").focus();
    document.querySelector("#ingest-status").textContent = `Review next · ${candidate.reason}.`;
    return;
  }
  const action = event.target.closest("[data-recovery-action]")?.dataset.recoveryAction;
  if (!action) return;
  if (action === "history-dismiss") {
    graphStore.clearHistoryRecovery();
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = "Undo history recovery snapshot dismissed.";
    return;
  }
  if (action === "history-download") {
    const rawHistory = graphStore.readHistoryRecovery();
    if (!rawHistory) return;
    try {
      downloadFile("llm-field-notes-history-recovery.json", rawHistory, "application/json");
      document.querySelector("#ingest-status").textContent = "Undo history recovery downloaded. Inspect it before dismissing the warning.";
    } catch (error) {
      document.querySelector("#ingest-status").textContent = error instanceof Error
        ? error.message
        : "The undo history recovery could not be downloaded.";
    }
    return;
  }
  if (action === "dismiss") {
    graphStore.clearRecovery();
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = "Recovery snapshot dismissed.";
    return;
  }
  const raw = graphStore.readRecovery();
  if (!raw) return;
  try {
    downloadFile("llm-field-notes-recovery.json", raw, "application/json");
    document.querySelector("#ingest-status").textContent = "Recovery snapshot downloaded. Inspect it before dismissing the warning.";
  } catch (error) {
    document.querySelector("#ingest-status").textContent = error instanceof Error
      ? error.message
      : "The recovery snapshot could not be downloaded.";
  }
});
document.querySelector("#review-queue").addEventListener("click", (event) => {
  const item = event.target.closest("[data-review-queue-kind]");
  if (!item) return;
  const kind = item.dataset.reviewQueueKind;
  const id = item.dataset.reviewQueueId;
  if (graphSearchQuery) {
    graphSearchQuery = "";
    document.querySelector("#graph-search").value = "";
    renderWorkbench();
  }
  document.querySelector(".mini-button[data-view='list']").click();
  if (kind === "node") selectGraphNode(id);
  else if (kind === "edge") selectGraphEdge(id);
  else selectSource(id);
  document.querySelector("#inspector-panel").focus();
  document.querySelector("#ingest-status").textContent = "Review candidate opened.";
});
const syncRetryQueuedFilesButton = () => {
  if (retryQueuedFilesButton) retryQueuedFilesButton.hidden = pendingFiles.length === 0;
  updateConnectionStatus();
};
function renderFileQueue(message = "") {
  const queue = document.querySelector("#file-queue");
  queue.innerHTML = pendingFiles.length
    ? `<span>${pendingFiles.length} document${pendingFiles.length === 1 ? "" : "s"} queued</span>${pendingFiles.map((file) => `<small>${escapeHtml(file.name)}</small>`).join("")}`
    : message;
  syncRetryQueuedFilesButton();
}
document.querySelector("#clear-graph").addEventListener("click", () => {
  const status = document.querySelector("#ingest-status");
  const currentGraph = graphStore.read();
  const hasSavedState = currentGraph.nodes.length
    || currentGraph.edges.length
    || currentGraph.documents.length
    || currentGraph.learning?.examples?.length;
  if (!hasSavedState || window.confirm("Clear this browser's saved graph and reusable learning memory?")) {
    if (graphStore.clear(graphStoreOptions(currentGraph))) {
      renderWorkbench();
      status.textContent = graphWriteSuccessMessage("Local graph cleared.");
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
  if (!graphStore.undo(graphStoreOptions(currentGraph))) {
    status.textContent = graphStore.getLastWriteMode() === "conflict"
      ? "The graph changed in another tab. Nothing was undone; reload and try again."
      : "There is no saved change to undo.";
    return;
  }
  renderWorkbench();
  status.textContent = graphWriteSuccessMessage("Last graph change undone.");
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
        const expectedGraph = graphStore.read();
        const expectedVersion = expectedGraph.version;
        const expectedFingerprint = fingerprintBackup(expectedGraph);
      const text = await readBrowserFileText(file, MAX_IMPORT_BYTES);
      const imported = parseJsonWithUniqueKeys(text, "Imported graph");
      if (imported.format === FEEDBACK_FORMAT) {
        if (imported.graphSchema !== GRAPH_SCHEMA || !Array.isArray(imported.examples)) throw new Error("That feedback file is not compatible with this graph.");
        if (imported.truncatedExamples !== undefined
          && (!Number.isSafeInteger(imported.truncatedExamples) || imported.truncatedExamples < 0 || imported.truncatedExamples > MAX_FEEDBACK_EXPORT_OMITTED)) {
          throw new Error("That feedback file contains an invalid truncation diagnostic.");
        }
        if (imported.truncatedExamples > 0
          && !window.confirm(`This feedback export omitted ${imported.truncatedExamples.toLocaleString()} reviewed item${imported.truncatedExamples === 1 ? "" : "s"} at its safety limit. Import the partial dataset anyway?`)) {
          status.textContent = "Feedback dataset import canceled; the current graph was kept.";
          pendingFiles = [];
          document.querySelector("#document-file").value = "";
          renderFileQueue();
          return;
        }
        if (imported.datasetFingerprint !== undefined
          && !matchesFeedbackFingerprint(imported.examples, imported.datasetFingerprint)) {
          throw new Error("That feedback file's dataset fingerprint does not match its examples.");
        }
        const result = applyFeedbackDataset(graphStore.read(), imported.examples);
        if (!result.changed && result.limited === "import-truncated") throw new Error(incompleteImportMessage);
        if (!result.changed && result.limited === "version") throw new Error("This graph has reached its revision limit. Export a backup before importing more feedback.");
        if (!result.changed && result.limited === "feedback-examples") throw new Error(`That feedback dataset contains more than ${MAX_FEEDBACK_FINGERPRINT_EXAMPLES.toLocaleString()} examples.`);
        if (!result.changed && !result.conflicts && result.skipped) throw new Error("No matching reviewed concepts or relations were found in that feedback dataset.");
        if (!result.changed && result.conflicts) {
          status.textContent = `Feedback dataset contained ${result.conflicts} contradictory decision${result.conflicts === 1 ? "" : "s"} but made no graph changes.`;
          pendingFiles = [];
          document.querySelector("#document-file").value = "";
          renderFileQueue();
          return;
        }
        if (!result.changed) {
          status.textContent = "Feedback dataset is already up to date; no graph changes were needed.";
          pendingFiles = [];
          document.querySelector("#document-file").value = "";
          renderFileQueue();
          return;
        }
        if (!graphStore.write(result.graph, { expectedVersion, expectedFingerprint })) {
          throw new Error(graphStore.getLastWriteMode() === "conflict"
            ? "The graph changed in another tab while feedback was loading. The feedback was not written."
            : "The feedback dataset could not be saved in this browser.");
        }
        renderWorkbench();
        status.textContent = graphWriteSuccessMessage(`Feedback dataset imported · ${result.updates} reviewed item${result.updates === 1 ? "" : "s"} applied${result.learned ? ` · ${result.learned} reusable learning example${result.learned === 1 ? "" : "s"} retained` : ""}${result.skipped ? ` · ${result.skipped} unmatched or invalid example${result.skipped === 1 ? "" : "s"} skipped` : ""}${result.conflicts ? ` · ${result.conflicts} contradictory decision${result.conflicts === 1 ? "" : "s"} detected; freshness or deterministic tie-breaking selected a value` : ""}${imported.truncatedExamples ? ` · source export omitted ${imported.truncatedExamples} reviewed item${imported.truncatedExamples === 1 ? "" : "s"}` : ""}.`);
        pendingFiles = [];
        document.querySelector("#document-file").value = "";
        renderFileQueue();
        return;
      }
      if (imported.format === BACKUP_FORMAT) {
        if (!imported.graph || (imported.graph.schema !== GRAPH_SCHEMA && !LEGACY_GRAPH_SCHEMAS.has(imported.graph.schema))) throw new Error("That backup does not contain a valid graph.");
        if (imported.graphFingerprint !== undefined
          && !matchesGraphFingerprint(imported.graph, imported.graphFingerprint, imported.history)) {
          throw new Error("That backup's fingerprint does not match its graph and history.");
        }
        const importedGraph = normalizeGraph(imported.graph);
        const importedHistory = asArray(imported.history);
        if (hasImportIntegrityLoss(importedGraph)) graphStore.captureRecoverySnapshot(text);
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
        if (!graphStore.restore(importedGraph, importedHistory, { expectedVersion, expectedFingerprint, preserveCurrent: true })) {
          throw new Error(graphStore.getLastWriteMode() === "conflict"
            ? "The graph changed in another tab while the backup was loading. The backup was not restored."
            : "The backup could not be restored in this browser.");
        }
        const restoredHistoryCount = graphStore.readHistory().length;
        renderWorkbench();
        status.textContent = graphWriteSuccessMessage(`Full backup restored · revision ${importedGraph.version} with ${restoredHistoryCount} undo snapshot${restoredHistoryCount === 1 ? "" : "s"}.`);
        pendingFiles = [];
        document.querySelector("#document-file").value = "";
        renderFileQueue();
        return;
      }
      if (imported.schema !== GRAPH_SCHEMA && !LEGACY_GRAPH_SCHEMAS.has(imported.schema)) throw new Error("That JSON file is not an LLM Field Notes graph.");
      if (imported.graphFingerprint !== undefined
        && !matchesGraphFingerprint(imported, imported.graphFingerprint)) {
        throw new Error("That graph's fingerprint does not match its contents.");
      }
      const importedGraph = normalizeGraph(imported);
      if (hasImportIntegrityLoss(importedGraph)) graphStore.captureRecoverySnapshot(text);
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
      if (!graphStore.write(importedGraph, { expectedVersion, expectedFingerprint })) {
        throw new Error(graphStore.getLastWriteMode() === "conflict"
          ? "The graph changed in another tab while the import was loading. The import was not written."
          : "The graph could not be saved in this browser.");
      }
      renderWorkbench();
      status.textContent = graphWriteSuccessMessage(importedGraph.redacted
        ? `Redacted graph imported · revision ${importedGraph.version} restored; source text, evidence quotes, and URIs are unavailable.`
        : `Graph imported · revision ${importedGraph.version} restored.`);
      pendingFiles = [];
      document.querySelector("#document-file").value = "";
      renderFileQueue();
      return;
    }
    pendingFiles = files;
    if (Number.isFinite(pendingFiles[0].size) && pendingFiles[0].size > MAX_DOCUMENT_BYTES) throw new Error(`That file is larger than the ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k character limit.`);
    const firstText = await readBrowserFileText(pendingFiles[0], MAX_DOCUMENT_BYTES, `That file is larger than the ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k character limit.`);
    if (!firstText.trim()) throw new Error("The first file is empty.");
    if (firstText.length > MAX_DOCUMENT_CHARS) throw new Error(`That file is larger than the ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k character limit.`);
    document.querySelector("#document-title").value = pendingFiles[0].name.replace(/\.[^/.]+$/, "");
    document.querySelector("#document-input").value = firstText;
    saveDocumentDraft();
    renderFileQueue();
    status.textContent = pendingFiles.length === 1 ? `${pendingFiles[0].name} loaded. Build the graph when ready.` : `${pendingFiles.length} files loaded. Build the batch when ready.`;
  } catch (error) {
    pendingFiles = [];
    event.target.value = "";
    renderFileQueue();
      status.textContent = boundedOperationDiagnostic(error, "That file could not be loaded.");
  }
});
async function buildGraphFromInput() {
  void requestPersistentStorage();
  const buildSignal = activeBuildController?.signal;
  const ensureBuildActive = () => {
    if (buildSignal?.aborted) throw Object.assign(new Error("Build canceled."), { code: "CANCELED" });
  };
  ensureBuildActive();
  const rawTitle = document.querySelector("#document-title").value.trim();
  const title = rawTitle || "Untitled document";
  const rawSourceUri = document.querySelector("#document-uri").value.trim();
  const sourceUri = rawSourceUri ? normalizeSourceUri(rawSourceUri) : null;
  const text = document.querySelector("#document-input").value.trim();
  const status = document.querySelector("#ingest-status");
  if (rawTitle.length > MAX_DOCUMENT_TITLE_CHARS) {
    status.textContent = `Document titles must be no longer than ${MAX_DOCUMENT_TITLE_CHARS} characters.`;
    return;
  }
  if (rawSourceUri && !sourceUri) {
    status.textContent = `Use a valid source URI under ${MAX_SOURCE_URI_CHARS.toLocaleString()} characters.`;
    return;
  }
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
        const expectedFingerprint = fingerprintBackup(currentGraph);
        const vaultBytes = await readBrowserFileBytes(files[0], MAX_ZIP_BYTES, "The vault archive is larger than the 50 MB safety limit.");
        const vault = parseObsidianVault(vaultBytes);
        if (vault.invalidFeedbackFiles?.length) {
          status.textContent = `That vault contains ${vault.invalidFeedbackFiles.length} malformed concept or relation note${vault.invalidFeedbackFiles.length === 1 ? "" : "s"}; no feedback was applied. Fix or remove those notes and try again.`;
          return;
        }
        if (vault.graphError) {
          status.textContent = `${vault.graphError} No feedback was applied. Repair or remove the embedded graph and try again.`;
          return;
        }
        if (!vault.feedbacks.length) {
          status.textContent = "That vault contains no exported concept or relation feedback notes.";
          return;
        }
        const currentProjectionFingerprint = fingerprintBackup(currentGraph);
        const staleVault = Boolean(
          (vault.manifest && vault.manifest.graphFingerprint !== currentProjectionFingerprint)
          || vault.staleFeedbackFiles?.length
        );
        const unverifiedVault = Boolean(
          vault.manifestError
          || vault.jsonLdError
          || !vault.manifest
          || vault.unverifiedFeedbackFiles?.length
        );
        const manifestNote = vault.manifestError
          ? " Manifest metadata was invalid; feedback was still applied."
          : vault.jsonLdError
            ? " Embedded JSON-LD metadata was invalid; feedback was still applied."
          : vault.unverifiedFeedbackFiles?.length
            ? ` ${vault.unverifiedFeedbackFiles.length} feedback note${vault.unverifiedFeedbackFiles.length === 1 ? " has" : "s have"} missing or invalid projection identity; feedback was still applied.`
          : !vault.manifest
            ? " This vault has no projection manifest; its graph revision could not be verified."
          : vault.staleFeedbackFiles?.length
            ? ` ${vault.staleFeedbackFiles.length} feedback note${vault.staleFeedbackFiles.length === 1 ? " came" : "s came"} from a different vault revision.`
          : staleVault
            ? " This vault came from an earlier or different graph revision."
            : "";
        if ((staleVault || unverifiedVault) && !window.confirm("This Obsidian vault has stale or unverifiable projection identity. Apply its edits to the current graph anyway?")) {
          status.textContent = "Obsidian vault import canceled; the current graph was kept.";
          return;
        }
        const result = applyObsidianFeedback(currentGraph, vault.feedbacks);
        if (!result.changed) {
          status.textContent = mutationLimitMessage(result, result.limited === "version"
            ? "This graph has reached its revision limit. Export a backup before importing vault feedback."
            : result.limited === "feedback-items"
              ? "That vault contains too many feedback items to apply safely in one operation."
            : result.conflicts
              ? `The vault contains ${result.conflicts} conflicting feedback item${result.conflicts === 1 ? "" : "s"}; those edits were skipped.`
            : "No matching graph items or changes were found in that vault.");
          return;
        }
        if (!graphStore.write(result.graph, { expectedVersion, expectedFingerprint })) {
          status.textContent = graphStore.getLastWriteMode() === "conflict"
            ? "The graph changed in another tab while the vault was loading. Vault feedback was not written."
            : "Obsidian vault feedback could not be saved. Your prior graph is still intact.";
          return;
        }
        pendingFiles = [];
        document.querySelector("#document-file").value = "";
        renderFileQueue();
        renderWorkbench();
        status.textContent = graphWriteSuccessMessage(`Obsidian vault feedback imported · ${result.updates} update${result.updates === 1 ? "" : "s"} saved${result.skipped ? ` · ${result.skipped} conflicting label${result.skipped === 1 ? "" : "s"} skipped` : ""}${result.conflicts ? ` · ${result.conflicts} duplicate conflict${result.conflicts === 1 ? "" : "s"} skipped` : ""}.${manifestNote}`);
      } catch (error) {
        status.textContent = boundedOperationDiagnostic(error, "That vault could not be read.");
      }
      return;
    }
    const currentGraph = graphStore.read();
    const expectedVersion = currentGraph.version;
    const expectedFingerprint = fingerprintBackup(currentGraph);
    let fileTexts;
    try {
      const declaredFeedbackBytes = files.reduce((total, file) => total + (Number.isFinite(file.size) ? file.size : 0), 0);
      if (declaredFeedbackBytes > MAX_BATCH_BYTES) throw new Error(`This feedback selection is larger than the ${Math.round(MAX_BATCH_CHARS / 1000000)} MB aggregate limit.`);
      fileTexts = [];
      let feedbackChars = 0;
      for (const file of files) {
        const fileText = await readBrowserFileText(file, MAX_FEEDBACK_NOTE_BYTES, `Feedback notes must be no longer than ${Math.round(MAX_FEEDBACK_NOTE_CHARS / 1000)}k characters.`);
        feedbackChars += fileText.length;
        if (feedbackChars > MAX_BATCH_CHARS) throw new Error(`This feedback selection is larger than the ${Math.round(MAX_BATCH_CHARS / 1000000)} MB aggregate limit.`);
        fileTexts.push(fileText);
      }
    } catch (error) {
      status.textContent = boundedOperationDiagnostic(error, "One or more selected notes could not be read.");
      return;
    }
    const feedbacks = fileTexts.map(parseObsidianFeedback).filter(Boolean);
    if (feedbacks.length || fileTexts.some(looksLikeObsidianFeedback)) {
      if (feedbacks.length !== files.length) {
        status.textContent = "Obsidian-shaped notes must be valid exported concept, relation, or source notes before import.";
        return;
      }
      const projectionFingerprint = fingerprintBackup(currentGraph);
      const staleProjection = feedbacks.some((feedback) => feedback.graphFingerprint && feedback.graphFingerprint !== projectionFingerprint);
      const unverifiedProjection = feedbacks.some((feedback) => feedback.projectionMetadataError || !feedback.graphFingerprint);
      const projectionNote = feedbacks.some((feedback) => feedback.projectionMetadataError)
        ? " Projection metadata was invalid; feedback was still applied."
        : feedbacks.some((feedback) => !feedback.graphFingerprint)
          ? " Some notes have no projection identity; their graph revision could not be verified."
        : staleProjection
          ? " These notes came from an earlier or different graph revision."
          : "";
      if ((staleProjection || unverifiedProjection) && !window.confirm("These Obsidian notes have stale or unverifiable projection identity. Apply their edits to the current graph anyway?")) {
        status.textContent = "Obsidian feedback import canceled; the current graph was kept.";
        return;
      }
      const result = applyObsidianFeedback(currentGraph, feedbacks);
      if (!result.changed) {
        status.textContent = mutationLimitMessage(result, result.limited === "version"
          ? "This graph has reached its revision limit. Export a backup before importing Obsidian feedback."
          : result.limited === "feedback-items"
            ? "That feedback selection contains too many items to apply safely in one operation."
          : result.conflicts
            ? `The selected notes contain ${result.conflicts} conflicting feedback item${result.conflicts === 1 ? "" : "s"}; those edits were skipped.`
          : "No matching graph items or changes were found in those Obsidian notes.");
        return;
      }
      if (!graphStore.write(result.graph, { expectedVersion, expectedFingerprint })) {
        status.textContent = graphStore.getLastWriteMode() === "conflict"
          ? "The graph changed in another tab while the notes were loading. Obsidian feedback was not written."
          : "Obsidian feedback could not be saved. Your prior graph is still intact.";
        return;
      }
      pendingFiles = [];
      document.querySelector("#document-file").value = "";
      renderFileQueue();
      renderWorkbench();
      status.textContent = graphWriteSuccessMessage(`Obsidian feedback imported · ${result.updates} update${result.updates === 1 ? "" : "s"} saved${result.skipped ? ` · ${result.skipped} conflicting label${result.skipped === 1 ? "" : "s"} skipped` : ""}${result.conflicts ? ` · ${result.conflicts} duplicate conflict${result.conflicts === 1 ? "" : "s"} skipped` : ""}.${projectionNote}`);
      return;
    }
  }
  if (endpoint) {
    if (browserIsOffline()) {
      status.textContent = "Remote extraction is unavailable offline. Reconnect or clear the endpoint to use local extraction.";
      return;
    }
    try {
      remoteExtractor = createRemoteExtractor({ endpoint: absoluteExtractorEndpoint(endpoint) });
    } catch (error) {
      status.textContent = boundedOperationDiagnostic(error, "The remote extractor configuration is invalid.");
      return;
    }
  }
  if (pendingFiles.length > 1) {
    const files = pendingFiles.slice();
    const declaredBatchBytes = files.reduce((total, file) => total + (Number.isFinite(file.size) ? file.size : 0), 0);
    if (declaredBatchBytes > MAX_BATCH_BYTES) {
      status.textContent = `This batch is larger than the ${Math.round(MAX_BATCH_CHARS / 1000000)} MB aggregate limit. Select fewer or smaller files.`;
      return;
    }
    let graph = graphStore.read();
    const expectedVersion = graph.version;
    const expectedFingerprint = fingerprintBackup(graph);
    let added = 0;
    let duplicates = 0;
    let batchChars = 0;
    const failures = [];
    const retryableBatchFiles = [];
    let canceled = false;
    let fileIndex = 0;
    for (; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      try {
        ensureBuildActive();
        if (Number.isFinite(file.size) && file.size > MAX_DOCUMENT_BYTES) {
          failures.push(`${file.name}: over ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k characters`);
          continue;
        }
        const fileText = await readBrowserFileText(file, MAX_DOCUMENT_BYTES, `That file is larger than the ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k character limit.`);
        ensureBuildActive();
        if (!fileText.trim()) {
          failures.push(`${file.name}: empty`);
          continue;
        }
        if (fileText.length > MAX_DOCUMENT_CHARS) {
          failures.push(`${file.name}: over ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k characters`);
          continue;
        }
        const fileTitle = file.name.replace(/\.[^/.]+$/, "").trim() || "Untitled document";
        if (fileTitle.length > MAX_DOCUMENT_TITLE_CHARS) {
          failures.push(`${file.name}: title over ${MAX_DOCUMENT_TITLE_CHARS} characters`);
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
            { title: fileTitle, text: fileText.trim() },
            buildExtractorFeedback(graph, { includeStale: false })
          )
          : extractGraph(fileTitle, fileText.trim(), { feedback: buildExtractorFeedback(graph, { includeStale: false }) });
        ensureBuildActive();
        const result = mergeExtraction(graph, extraction, {
          revisionExtractor: remoteExtractor ? "remote" : "local"
        });
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
        failures.push(`${file.name}: ${boundedOperationDiagnostic(error, "could not extract")}`);
        if (["NETWORK_ERROR", "REMOTE_ERROR", "TIMEOUT"].includes(error?.code)) {
          retryableBatchFiles.push(file);
        }
      }
    }
    if (added && !graphStore.write(graph, { expectedVersion, expectedFingerprint })) {
      status.textContent = graphStore.getLastWriteMode() === "conflict"
        ? "The graph changed in another tab while this batch was running. Your batch was not written; reload the graph and try again."
        : "The batch could not be saved. Your browser may be out of storage.";
      return;
    }
    pendingFiles = canceled
      ? [...retryableBatchFiles, ...files.slice(fileIndex)]
      : retryableBatchFiles;
    if (!pendingFiles.length && !canceled && !failures.length) commitDocumentDraft();
    if (!pendingFiles.length) document.querySelector("#document-file").value = "";
    renderFileQueue();
    renderWorkbench();
    const failureSummary = failures.slice(0, 3).map((failure) => sliceTextAtCodePointBoundary(failure, 180)).join(" · ");
    const addedSummary = `${added} document${added === 1 ? "" : "s"} added`;
    const remainingSummary = pendingFiles.length
      ? ` · ${pendingFiles.length} file${pendingFiles.length === 1 ? "" : "s"} remain queued`
      : "";
    const retrySummary = retryableBatchFiles.length
      ? ` · ${retryableBatchFiles.length} transient failure${retryableBatchFiles.length === 1 ? "" : "s"} kept for retry`
      : "";
    status.textContent = graphWriteSuccessMessage(`${canceled ? "Build canceled · " : ""}${addedSummary}${duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped` : ""}${failures.length ? ` · ${failures.length} failed${failureSummary ? `: ${failureSummary}${failures.length > 3 ? " · …" : ""}` : ""}` : ""}${retrySummary}${remainingSummary}.`);
    return;
  }
  if (text.length < 40) {
    status.textContent = "Add at least a few sentences so the extractor has something to connect.";
    return;
  }
  if (text.length > MAX_DOCUMENT_CHARS) {
    status.textContent = `Keep documents under ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k characters for this workbench.`;
    return;
  }
  const currentGraph = graphStore.read();
  const expectedVersion = currentGraph.version;
  const expectedFingerprint = fingerprintBackup(currentGraph);
  let extraction;
  try {
    ensureBuildActive();
    extraction = remoteExtractor
      ? await runRemoteExtraction(remoteExtractor, { title, text, uri: sourceUri }, buildExtractorFeedback(currentGraph, { includeStale: false }))
      : extractGraph(title, text, { feedback: buildExtractorFeedback(currentGraph, { includeStale: false }), sourceUri });
  } catch (error) {
    status.textContent = error?.name === "AbortError" || error?.code === "CANCELED"
      ? "Build canceled; no graph changes were written."
      : boundedOperationDiagnostic(error, "The document could not be extracted.");
    return;
  }
  const result = mergeExtraction(currentGraph, extraction, {
    revisionExtractor: remoteExtractor ? "remote" : "local"
  });
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
                : result.limited === "import-truncated"
                  ? "an incomplete imported graph"
                : "revision";
    status.textContent = result.limited === "import-truncated"
      ? "This imported graph is incomplete. Restore the original export before adding more knowledge."
      : `The graph has reached its ${limit} limit. Remove or merge existing knowledge before adding more.`;
    return;
  }
  if (!graphStore.write(result.graph, { expectedVersion, expectedFingerprint })) {
    status.textContent = graphStore.getLastWriteMode() === "conflict"
      ? "The graph changed in another tab while extraction was running. The document was not written; reload and try again."
      : "The graph could not be saved. Your browser may be out of storage.";
    return;
  }
  renderWorkbench();
  status.textContent = graphWriteSuccessMessage(`Revision ${result.graph.version} saved · ${result.graph.nodes.length} concepts now in memory.`);
  commitDocumentDraft();
  pendingFiles = [];
  document.querySelector("#document-file").value = "";
  renderFileQueue();
}
const ingestButton = document.querySelector("#ingest-document");
const loadSampleButton = document.querySelector("#load-sample");
const rebuildSourcesButton = document.querySelector("#rebuild-sources");
const documentFileInput = document.querySelector("#document-file");
retryQueuedFilesButton?.addEventListener("click", () => {
  if (!ingestInFlight) ingestButton.click();
});
let ingestInFlight = false;
let sourceReplacementInFlight = false;
const workbench = document.querySelector("#workbench");
const workbenchBusy = () => ingestInFlight || sourceReplacementInFlight;
const syncWorkbenchBusy = () => workbench.setAttribute("aria-busy", workbenchBusy() ? "true" : "false");
workbench.addEventListener("click", (event) => {
  if (!workbenchBusy()) return;
  const control = event.target.closest("button, input, select, textarea");
  if (!control || control.id === "cancel-extraction") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  document.querySelector("#ingest-status").textContent = "A graph build is in progress. Cancel it before editing the graph.";
}, true);
ingestButton.addEventListener("click", async () => {
  if (ingestInFlight) return;
  ingestInFlight = true;
  syncWorkbenchBusy();
  ingestButton.disabled = true;
  ingestButton.setAttribute("aria-busy", "true");
  loadSampleButton.disabled = true;
  documentFileInput.disabled = true;
  activeBuildController = new AbortController();
  cancelExtractionButton.disabled = false;
  try {
    await buildGraphFromInput();
  } catch (error) {
    const message = boundedOperationDiagnostic(error, "The graph build failed; your saved graph was preserved.");
    document.querySelector("#ingest-status").textContent = message;
    reportRuntimeError(error);
  } finally {
    if (activeBuildController) activeBuildController = null;
    cancelExtractionButton.disabled = true;
    ingestInFlight = false;
    syncWorkbenchBusy();
    ingestButton.disabled = false;
    ingestButton.setAttribute("aria-busy", "false");
    loadSampleButton.disabled = false;
    documentFileInput.disabled = false;
  }
});
async function rebuildSavedSources() {
  if (ingestInFlight || sourceReplacementInFlight) return;
  const status = document.querySelector("#ingest-status");
  const initialGraph = graphStore.read();
  const sources = initialGraph.documents.slice();
  if (!sources.length) {
    status.textContent = "Add a source document before rebuilding saved sources.";
    return;
  }
  if (initialGraph.redacted) {
    status.textContent = "This graph is redacted: restore a full backup or original sources before rebuilding.";
    return;
  }
  const incompleteImport = [...Object.values(initialGraph.integrity?.truncated || {}), ...Object.values(initialGraph.integrity?.dropped || {})]
    .some((count) => Number.isSafeInteger(count) && count > 0);
  if (incompleteImport) {
    status.textContent = "This imported graph is incomplete. Restore the original export before rebuilding saved sources.";
    return;
  }
  if (Array.isArray(initialGraph.integrity?.ambiguousSourceIds) && initialGraph.integrity.ambiguousSourceIds.length) {
    status.textContent = "This graph contains ambiguous source IDs. Repair the original export before rebuilding saved sources.";
    return;
  }
  if (extractorEndpointInput.value.trim() && browserIsOffline()) {
    status.textContent = "Remote extraction is unavailable offline. Reconnect or clear the endpoint to use local extraction.";
    return;
  }
  if (!window.confirm(`Rebuild ${sources.length} saved source${sources.length === 1 ? "" : "s"} using the current extractor and reviewed feedback? Successful replacements will be saved together.`)) return;
  sourceReplacementInFlight = true;
  syncWorkbenchBusy();
  ingestButton.disabled = true;
  loadSampleButton.disabled = true;
  rebuildSourcesButton.disabled = true;
  rebuildSourcesButton.setAttribute("aria-busy", "true");
  documentFileInput.disabled = true;
  cancelExtractionButton.disabled = false;
  activeBuildController = new AbortController();
  const expectedVersion = initialGraph.version;
  const expectedFingerprint = fingerprintBackup(initialGraph);
  const rebuildFeedback = buildExtractorFeedback(initialGraph, { includeStale: false });
  try {
    const result = await rebuildSources(initialGraph, {
      revisionExtractor: extractorEndpointInput.value.trim() ? "remote" : "local",
      signal: activeBuildController.signal,
      onProgress: ({ sourceIndex, source, total }) => {
        status.textContent = `Rebuilding source ${sourceIndex + 1} of ${total} · ${source.title}`;
      },
      extract: (source) => {
        const endpoint = extractorEndpointInput.value.trim();
        return endpoint
          ? runRemoteExtraction(
            createRemoteExtractor({ endpoint: absoluteExtractorEndpoint(endpoint) }),
            { title: source.title, text: source.text, uri: source.uri || undefined },
            rebuildFeedback
          )
          : extractGraph(source.title, source.text, { feedback: rebuildFeedback, sourceUri: source.uri });
      }
    });
    const { graph, rebuilt, failures, canceled } = result;
    if (rebuilt && !graphStore.write(graph, { expectedVersion, expectedFingerprint })) {
      status.textContent = graphStore.getLastWriteMode() === "conflict"
        ? "The graph changed in another tab while rebuilding. No rebuilt sources were written; reload and try again."
        : "The rebuilt sources could not be saved. Your prior graph is still intact.";
      return;
    }
    if (rebuilt) renderWorkbench();
    const failureSummary = sliceTextAtCodePointBoundary(failures.slice(0, 2).join(" · "), 360);
    status.textContent = graphWriteSuccessMessage(
      `${canceled ? "Rebuild canceled · " : ""}${rebuilt} source${rebuilt === 1 ? "" : "s"} rebuilt${failures.length ? ` · ${failures.length} failed${failureSummary ? `: ${failureSummary}${failures.length > 2 ? " · …" : ""}` : ""}` : ""}.`
    );
  } catch (error) {
    status.textContent = `Rebuild failed; your saved graph was preserved. ${boundedOperationDiagnostic(error, "The rebuild could not be completed.")}`;
    reportRuntimeError(error);
  } finally {
    if (activeBuildController) activeBuildController = null;
    sourceReplacementInFlight = false;
    cancelExtractionButton.disabled = true;
    ingestButton.disabled = false;
    loadSampleButton.disabled = false;
    rebuildSourcesButton.disabled = false;
    rebuildSourcesButton.setAttribute("aria-busy", "false");
    documentFileInput.disabled = false;
    syncWorkbenchBusy();
  }
}
rebuildSourcesButton.addEventListener("click", rebuildSavedSources);
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
  document.querySelector("#source-list").hidden = !isList;
}));
let searchRenderScheduled = false;
function scheduleSearchRender() {
  if (searchRenderScheduled) return;
  searchRenderScheduled = true;
  const flush = () => {
    searchRenderScheduled = false;
    renderWorkbench();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
  else setTimeout(flush, 0);
}
document.querySelector("#graph-search").addEventListener("input", (event) => {
  graphSearchQuery = boundedSearchQuery(event.target.value);
  if (event.target.value !== graphSearchQuery) event.target.value = graphSearchQuery;
  scheduleSearchRender();
});
function commitManualGraph(graph, reason) {
  void requestPersistentStorage();
  const expectedVersion = graph.version;
  const expectedFingerprint = fingerprintBackup(graph);
  if (!advanceGraphVersion(graph)) {
    document.querySelector("#ingest-status").textContent = "This graph has reached its revision limit. Export a backup and start a fresh graph before editing it.";
    return false;
  }
  graph.updatedAt = new Date().toISOString();
  graph.revisions.unshift({ id: `rev-${graph.version}`, version: graph.version, timestamp: graph.updatedAt, reason, operation: "manual", nodes: graph.nodes.length, edges: graph.edges.length });
  graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  if (!graphStore.write(graph, { expectedVersion, expectedFingerprint })) {
    document.querySelector("#ingest-status").textContent = graphWriteFailureMessage(
      "The manual change could not be saved.",
      "The graph changed in another tab. Your manual change was not written; reload and try again."
    );
    return false;
  }
  renderWorkbench();
  document.querySelector("#ingest-status").textContent = graphWriteSuccessMessage(`${reason} · revision ${graph.version} saved.`);
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
    existing.feedback += 1;
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
  let selectedRow = null;
  document.querySelectorAll(".relation-row").forEach((row) => {
    const selected = row.dataset.edgeId === edgeId;
    row.classList.toggle("selected", selected);
    if (selected) selectedRow = row;
  });
  if (selectedRow) selectedRow.scrollIntoView({ block: "nearest" });
  renderInspector(graphStore.read());
};
const selectSource = (sourceId) => {
  selectedGraphItem = { kind: "source", id: sourceId };
  let selectedRow = null;
  document.querySelectorAll(".source-row").forEach((row) => {
    const selected = row.dataset.sourceId === sourceId;
    row.classList.toggle("selected", selected);
    if (selected) selectedRow = row;
  });
  if (selectedRow) selectedRow.scrollIntoView({ block: "nearest" });
  renderInspector(graphStore.read());
};
document.querySelector("#graph-canvas").addEventListener("click", (event) => {
  const node = event.target.closest(".graph-node");
  if (!node) return;
  selectGraphNode(node.dataset.nodeId);
  document.querySelector(".mini-button[data-view='list']").click();
  document.querySelector("#inspector-panel").focus();
});
document.querySelector("#graph-canvas").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const node = event.target.closest(".graph-node");
  if (!node) return;
  event.preventDefault();
  selectGraphNode(node.dataset.nodeId);
  document.querySelector(".mini-button[data-view='list']").click();
  document.querySelector("#inspector-panel").focus();
});
function persistFeedbackDecision(kind, id, action) {
  const status = document.querySelector("#ingest-status");
  const currentGraph = graphStore.read();
  const result = applyFeedback(currentGraph, kind, id, action);
  if (!result.changed) {
    status.textContent = mutationLimitMessage(result,
      result.limited === "version"
        ? `This graph has reached its revision limit. Export a backup before reviewing more ${kind === "node" ? "concepts" : "relations"}.`
        : "That feedback could not be applied.");
    return false;
  }
  if (!graphStore.write(result.graph, graphStoreOptions(currentGraph))) {
    status.textContent = graphWriteFailureMessage(
      "That feedback could not be saved. Your prior graph is still intact.",
      "The graph changed in another tab. That feedback was not written; reload and try again."
    );
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
    if (row) {
      selectGraphNode(row.dataset.nodeId);
      if (event.detail === 0) document.querySelector("#inspector-panel").focus();
    }
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
    if (row) {
      selectGraphEdge(row.dataset.edgeId);
      if (event.detail === 0) document.querySelector("#inspector-panel").focus();
    }
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
document.querySelector("#source-list").addEventListener("click", (event) => {
  const row = event.target.closest(".source-row");
  if (row) {
    selectSource(row.dataset.sourceId);
    if (event.detail === 0) document.querySelector("#inspector-panel").focus();
  }
});
document.querySelector("#source-list").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest("button")) return;
  const row = event.target.closest(".source-row");
  if (!row) return;
  event.preventDefault();
  selectSource(row.dataset.sourceId);
});
document.querySelector("#inspector-panel").addEventListener("click", (event) => {
  const feedbackButton = event.target.closest("[data-inspector-feedback]");
  if (feedbackButton) {
    const kind = feedbackButton.dataset.nodeId ? "node" : "edge";
    const id = feedbackButton.dataset.nodeId || feedbackButton.dataset.edgeId;
    if (persistFeedbackDecision(kind, id, feedbackButton.dataset.inspectorFeedback)) {
  document.querySelector("#ingest-status").textContent = graphWriteSuccessMessage("Review decision saved and added to reusable learning memory.");
    }
    return;
  }
  const edgeButton = event.target.closest("[data-select-edge]");
  if (edgeButton) selectGraphEdge(edgeButton.dataset.selectEdge);
  const sourceButton = event.target.closest("[data-select-source]");
  if (sourceButton) selectSource(sourceButton.dataset.selectSource);
  const reviewSourceButton = event.target.closest("[data-review-source]");
  if (reviewSourceButton) {
    const currentGraph = graphStore.read();
    const result = markSourceReviewed(currentGraph, reviewSourceButton.dataset.reviewSource);
    if (!result.changed) {
      if (result.alreadyReviewed) {
        document.querySelector("#ingest-status").textContent = "Source was already marked reviewed today.";
        return;
      }
      document.querySelector("#ingest-status").textContent = mutationLimitMessage(
        result,
        result.ambiguous
          ? "This source ID is ambiguous in the imported graph; repair the duplicate source IDs before reviewing it."
          : "This source could not be marked reviewed."
      );
      return;
    }
    if (!graphStore.write(result.graph, graphStoreOptions(currentGraph))) {
      document.querySelector("#ingest-status").textContent = graphWriteFailureMessage(
        "The source review could not be saved.",
        "The graph changed in another tab. The source review was not written; reload and try again."
      );
      return;
    }
    renderWorkbench();
    selectSource(reviewSourceButton.dataset.reviewSource);
    document.querySelector("#ingest-status").textContent = graphWriteSuccessMessage("Source marked reviewed today. Undo is available.");
    return;
  }
  const replaceSourceButton = event.target.closest("[data-replace-source]");
  if (replaceSourceButton) {
    const sourceId = replaceSourceButton.dataset.replaceSource;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".txt,.md,text/plain,text/markdown";
    let filePickerSettled = false;
    const cleanupFilePicker = () => {
      if (filePickerSettled) return;
      filePickerSettled = true;
      fileInput.remove();
      window.removeEventListener("focus", handleFilePickerFocus);
    };
    const handleFilePickerFocus = () => {
      setTimeout(() => {
        if (!fileInput.files?.length) cleanupFilePicker();
      }, 0);
    };
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      cleanupFilePicker();
      if (!file) return;
      const status = document.querySelector("#ingest-status");
      sourceReplacementInFlight = true;
      syncWorkbenchBusy();
      ingestButton.disabled = true;
      loadSampleButton.disabled = true;
      documentFileInput.disabled = true;
      try {
        if (Number.isFinite(file.size) && file.size > MAX_DOCUMENT_BYTES) throw new Error(`That file is larger than the ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k character limit.`);
        const text = (await readBrowserFileText(file, MAX_DOCUMENT_BYTES, `That file is larger than the ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k character limit.`)).trim();
        if (!text) throw new Error("The replacement file is empty.");
        if (text.length > MAX_DOCUMENT_CHARS) throw new Error(`That file is larger than the ${Math.round(MAX_DOCUMENT_CHARS / 1000)}k character limit.`);
        const fileTitle = file.name.replace(/\.[^/.]+$/, "").trim() || "Untitled document";
        if (fileTitle.length > MAX_DOCUMENT_TITLE_CHARS) throw new Error(`Replacement document titles must be no longer than ${MAX_DOCUMENT_TITLE_CHARS} characters.`);
        const currentGraph = graphStore.read();
        const endpoint = extractorEndpointInput.value.trim();
        let extraction;
        const usingRemoteExtractor = Boolean(endpoint);
        if (usingRemoteExtractor && browserIsOffline()) {
          status.textContent = "Remote extraction is unavailable offline. Reconnect or clear the endpoint to use local extraction.";
          return;
        }
        if (usingRemoteExtractor) cancelExtractionButton.disabled = false;
        try {
          if (endpoint) {
            const validatedEndpoint = absoluteExtractorEndpoint(endpoint);
            extraction = await runRemoteExtraction(
              createRemoteExtractor({ endpoint: validatedEndpoint }),
              { title: fileTitle, text },
              buildExtractorFeedback(currentGraph, { includeStale: false })
            );
          } else {
            extraction = extractGraph(fileTitle, text, { feedback: buildExtractorFeedback(currentGraph, { includeStale: false }) });
          }
        } finally {
          if (usingRemoteExtractor) cancelExtractionButton.disabled = true;
        }
        const result = replaceSource(currentGraph, sourceId, extraction, {
          revisionExtractor: usingRemoteExtractor ? "remote" : "local"
        });
        if (result.duplicate) {
          status.textContent = "That document is already represented by another source; the current source was kept.";
          return;
        }
        if (result.ambiguous) {
          status.textContent = "This source ID is ambiguous in the imported graph; repair the duplicate source IDs before replacing it.";
          return;
        }
        if (result.limited) {
          status.textContent = result.limited === "import-truncated"
            ? "This imported graph is incomplete. Restore the original export before replacing a source; the current source was kept."
            : `The replacement could not fit within the graph ${result.limited} limit; the current source was kept.`;
          return;
        }
        if (!result.replaced || !graphStore.write(result.graph, graphStoreOptions(currentGraph))) {
          status.textContent = graphStore.getLastWriteMode() === "conflict"
            ? "The graph changed in another tab while the replacement was running. The source was not replaced."
            : "The replacement could not be saved; the current source was kept.";
          return;
        }
        selectedGraphItem = null;
        renderWorkbench();
        status.textContent = graphWriteSuccessMessage(`Source replaced · ${result.removedNodes} unsupported concept${result.removedNodes === 1 ? "" : "s"} and ${result.removedEdges} relation${result.removedEdges === 1 ? "" : "s"} pruned. Undo is available.`);
      } catch (error) {
        status.textContent = error?.name === "AbortError" || error?.code === "CANCELED"
          ? "Source replacement canceled; the current source was kept."
          : boundedOperationDiagnostic(error, "The source could not be replaced.");
      } finally {
        sourceReplacementInFlight = false;
        cancelExtractionButton.disabled = true;
        if (!ingestInFlight) {
          ingestButton.disabled = false;
          loadSampleButton.disabled = false;
          documentFileInput.disabled = false;
        }
        syncWorkbenchBusy();
      }
    }, { once: true });
    window.addEventListener("focus", handleFilePickerFocus, { once: true });
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
      document.querySelector("#ingest-status").textContent = mutationLimitMessage(result,
        result.ambiguous
          ? "This source ID is ambiguous in the imported graph; repair the duplicate source IDs before removing it."
          : "The source could not be removed.");
      return;
    }
    if (!graphStore.write(result.graph, graphStoreOptions(currentGraph))) {
      document.querySelector("#ingest-status").textContent = graphWriteFailureMessage(
        "The source could not be removed.",
        "The graph changed in another tab. The source was not removed; reload and try again."
      );
      return;
    }
    selectedGraphItem = null;
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = graphWriteSuccessMessage(`Source removed · ${result.removedNodes} concepts and ${result.removedEdges} relations pruned. Undo is available.`);
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
      document.querySelector("#ingest-status").textContent = mutationLimitMessage(result,
        result.limited === "version"
          ? "This graph has reached its revision limit. Export a backup before merging concepts."
          : "Those concepts could not be merged.");
      return;
    }
    if (!graphStore.write(result.graph, graphStoreOptions(currentGraph))) {
      document.querySelector("#ingest-status").textContent = graphWriteFailureMessage(
        "The concept merge could not be saved.",
        "The graph changed in another tab. The merge was not written; reload and try again."
      );
      return;
    }
    selectedGraphItem = { kind: "node", id: result.mergedId };
    renderWorkbench();
    document.querySelector("#ingest-status").textContent = graphWriteSuccessMessage("Concepts merged · evidence, aliases, and relations combined. Undo is available.");
    return;
  }
  const nodeEdit = event.target.closest("[data-edit-node]");
  const edgeEdit = event.target.closest("[data-edit-edge]");
  const sourceEdit = event.target.closest("[data-edit-source]");
  if (!nodeEdit && !edgeEdit && !sourceEdit) return;
  let graph = graphStore.read();
  const expectedVersion = graph.version;
  const expectedFingerprint = fingerprintBackup(graph);
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
    if (graph.edges.some((item) => item !== edge
      && ((item.source === edge.source && item.target === edge.target)
        || (item.source === edge.target && item.target === edge.source))
      && slugify(item.label) === slugify(nextLabel))) {
      document.querySelector("#ingest-status").textContent = "That relation already exists for these concepts; use a different label or merge the relations first.";
      return;
    }
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
    const reviewedTimestamp = reviewedDate ? parseTimestamp(reviewedDate) : NaN;
    if (reviewedDate && Number.isNaN(reviewedTimestamp)) {
      document.querySelector("#ingest-status").textContent = "Use a valid review date.";
      return;
    }
    const nextReviewedAt = reviewedDate ? new Date(reviewedTimestamp).toISOString() : null;
    const rawUri = uriInput?.value.trim() || "";
    const nextUri = rawUri ? normalizeSourceUri(rawUri) : null;
    if (rawUri && !nextUri) {
      document.querySelector("#ingest-status").textContent = `Use a valid source URI under ${MAX_SOURCE_URI_CHARS.toLocaleString()} characters.`;
      return;
    }
    if (!source || !SOURCE_QUALITIES.has(nextQuality)) return;
    const sourceMetadataChanged = source.title !== nextLabel || source.uri !== nextUri || source.quality !== nextQuality;
    const reviewDateChanged = (source.lastReviewedAt ? source.lastReviewedAt.slice(0, 10) : "") !== reviewedDate;
    if (!sourceMetadataChanged && !reviewDateChanged) return;
    source.title = nextLabel;
    source.uri = nextUri;
    source.quality = nextQuality;
    source.lastReviewedAt = nextReviewedAt;
    if (sourceMetadataChanged && !reviewDateChanged) source.lastReviewedAt = new Date().toISOString();
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
    operation: "manual",
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  if (!graphStore.write(graph, { expectedVersion, expectedFingerprint })) {
    document.querySelector("#ingest-status").textContent = graphWriteFailureMessage(
      "The edit could not be saved.",
      "The graph changed in another tab. This edit was not written; reload and try again."
    );
    return;
  }
  renderWorkbench();
  document.querySelector("#ingest-status").textContent = graphWriteSuccessMessage("Graph edit saved and added to revision history.");
});
document.querySelector("#download-markdown").addEventListener("click", () => {
  try {
    const graph = graphStore.read();
    assertGraphTextExportBudget([graph]);
    downloadFile("knowledge-graph.md", buildMarkdown(graph), "text/markdown");
    document.querySelector("#projection-status").textContent = "Markdown projection downloaded.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The Markdown projection could not be exported.");
  }
});
document.querySelector("#download-redacted-markdown").addEventListener("click", () => {
  try {
    const markdown = buildRedactedMarkdownProjection();
    downloadFile("knowledge-graph-redacted.md", markdown, "text/markdown");
    document.querySelector("#projection-status").textContent = "Redacted Markdown projection downloaded · source text, evidence, and URIs removed.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The redacted Markdown projection could not be exported.");
  }
});
document.querySelector("#copy-markdown").addEventListener("click", async () => {
  try {
    const graph = graphStore.read();
    assertGraphTextExportBudget([graph]);
    const markdown = buildMarkdown(graph);
    if (textEncoder.encode(markdown).byteLength > MAX_EXPORT_BYTES) throw new Error("This projection exceeds the 50 MB safety limit; use a bounded graph or export a redacted view.");
    await copyText(markdown);
    document.querySelector("#projection-status").textContent = "Markdown projection copied to the clipboard.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The Markdown projection could not be copied.");
  }
});
document.querySelector("#copy-redacted-markdown").addEventListener("click", async () => {
  try {
    const markdown = buildRedactedMarkdownProjection();
    await copyText(markdown);
    document.querySelector("#projection-status").textContent = "Redacted Markdown copied; source text, evidence, and URIs were removed.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The redacted Markdown projection could not be copied.");
  }
});
document.querySelector("#share-redacted-markdown").addEventListener("click", async () => {
  try {
    const markdown = buildRedactedMarkdownProjection();
    const file = typeof File === "function"
      ? new File([markdown], "knowledge-graph-redacted.md", { type: "text/markdown" })
      : null;
    let canShareFile = Boolean(file && typeof navigator.share === "function");
    if (canShareFile && typeof navigator.canShare === "function") {
      try {
        canShareFile = navigator.canShare({ files: [file] });
      } catch {
        canShareFile = false;
      }
    }
    if (canShareFile) {
      try {
        await navigator.share({
          title: "LLM Field Notes · redacted graph",
          text: "A privacy-safe Markdown projection of an inspectable knowledge graph.",
          files: [file]
        });
        document.querySelector("#projection-status").textContent = "Redacted graph shared; source text, evidence, and URIs were removed.";
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    try {
      await copyText(markdown);
      document.querySelector("#projection-status").textContent = "File sharing is unavailable; redacted Markdown copied instead.";
      return;
    } catch {
      // Fall through to a download when copy permissions are unavailable.
    }
    downloadFile("knowledge-graph-redacted.md", markdown, "text/markdown");
    document.querySelector("#projection-status").textContent = "File sharing is unavailable; redacted Markdown downloaded instead.";
  } catch (error) {
    if (error?.name === "AbortError") return;
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The redacted graph could not be shared.");
  }
});
document.querySelector("#download-vault").addEventListener("click", async () => {
  await withVaultExport(async () => {
    try {
      const graph = graphStore.read();
      const graphFingerprint = fingerprintBackup(graph);
      const graphFiles = buildVaultFiles(graph, { appVersion: releaseInfo.version });
      const learning = await buildLearningVaultFiles({ estimatedArchiveBytes: graphFiles.estimatedArchiveBytes });
      assertVaultGraphUnchanged(graphFingerprint);
      const files = [...graphFiles, ...learning.files];
      downloadBytes("llm-field-notes-vault.zip", zipStore(files), "application/zip");
      document.querySelector("#projection-status").textContent = `Obsidian vault downloaded · ${files.length} files${learning.failures.length ? ` · ${learning.failures.length} learning note${learning.failures.length === 1 ? "" : "s"} unavailable` : ""}.`;
    } catch (error) {
      document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The Obsidian vault could not be exported.");
    }
  });
});
document.querySelector("#download-redacted-vault").addEventListener("click", async () => {
  await withVaultExport(async () => {
    try {
      const graph = graphStore.read();
      const graphFingerprint = fingerprintBackup(graph);
      const graphFiles = buildVaultFiles(redactGraph(graph), { appVersion: releaseInfo.version });
      const learning = await buildLearningVaultFiles({ estimatedArchiveBytes: graphFiles.estimatedArchiveBytes });
      assertVaultGraphUnchanged(graphFingerprint);
      const files = [...graphFiles, ...learning.files];
      downloadBytes("llm-field-notes-redacted-vault.zip", zipStore(files), "application/zip");
      document.querySelector("#projection-status").textContent = `Redacted Obsidian vault downloaded · ${files.length} files; source text, evidence, and URIs removed${learning.failures.length ? ` · ${learning.failures.length} learning note${learning.failures.length === 1 ? "" : "s"} unavailable` : ""}.`;
    } catch (error) {
      document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The redacted Obsidian vault could not be exported.");
    }
  });
});
document.querySelector("#download-json").addEventListener("click", () => {
  try {
    const graph = canonicalizeGraphForExport(graphStore.read());
    assertGraphTextExportBudget([graph]);
    downloadFile("knowledge-graph.json", JSON.stringify(buildGraphExport(graph, { appVersion: releaseInfo.version }), null, 2), "application/json");
    document.querySelector("#projection-status").textContent = "Internal representation exported as JSON.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The graph JSON could not be exported.");
  }
});
document.querySelector("#download-jsonld").addEventListener("click", () => {
  try {
    const graph = graphStore.read();
    assertGraphTextExportBudget([graph]);
    downloadFile("knowledge-graph.jsonld", JSON.stringify(buildJsonLd(graph, { appVersion: releaseInfo.version }), null, 2), "application/ld+json");
    document.querySelector("#projection-status").textContent = "Internal representation exported as JSON-LD.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The JSON-LD projection could not be exported.");
  }
});
document.querySelector("#download-redacted-jsonld").addEventListener("click", () => {
  try {
    const graph = redactGraph(graphStore.read());
    assertGraphTextExportBudget([graph]);
    downloadFile("knowledge-graph-redacted.jsonld", JSON.stringify(buildJsonLd(graph, { appVersion: releaseInfo.version }), null, 2), "application/ld+json");
    document.querySelector("#projection-status").textContent = "Redacted JSON-LD exported · source text, evidence, and URIs removed.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The redacted JSON-LD projection could not be exported.");
  }
});
document.querySelector("#download-health").addEventListener("click", () => {
  try {
    const graph = graphStore.read();
    const report = buildHealthReport(graph, { appVersion: releaseInfo.version });
    downloadFile("llm-field-notes-health.json", JSON.stringify(report, null, 2), "application/json");
    document.querySelector("#projection-status").textContent = "Privacy-safe graph health report downloaded.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The graph health report could not be exported.");
  }
});
document.querySelector("#download-redacted").addEventListener("click", () => {
  try {
    const graph = canonicalizeGraphForExport(redactGraph(graphStore.read()));
    assertGraphTextExportBudget([graph]);
    downloadFile("llm-field-notes-redacted-graph.json", JSON.stringify(buildGraphExport(graph, { appVersion: releaseInfo.version }), null, 2), "application/json");
    document.querySelector("#projection-status").textContent = "Redacted graph downloaded · source text, evidence, and URIs removed.";
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The redacted graph could not be exported.");
  }
});
document.querySelector("#download-backup").addEventListener("click", () => {
  try {
    const backup = exportBackupSnapshot();
    document.querySelector("#projection-status").textContent = `Full backup downloaded · ${backup.history.length} undo snapshot${backup.history.length === 1 ? "" : "s"}.`;
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The full backup could not be exported.");
  }
});
document.querySelector("#download-feedback").addEventListener("click", () => {
  try {
    const graph = graphStore.read();
    assertGraphTextExportBudget([graph]);
    const dataset = buildFeedbackDataset(graph);
    downloadFile("llm-field-notes-feedback.json", JSON.stringify(dataset, null, 2), "application/json");
    document.querySelector("#projection-status").textContent = `Feedback dataset downloaded · ${dataset.examples.length} reviewed example${dataset.examples.length === 1 ? "" : "s"}${dataset.truncatedExamples ? ` · ${dataset.truncatedExamples} omitted at the export limit` : ""}.`;
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The feedback dataset could not be exported.");
  }
});
document.querySelector("#download-compact-feedback").addEventListener("click", () => {
  try {
    const graph = graphStore.read();
    assertGraphTextExportBudget([graph]);
    const dataset = buildCompactFeedbackDataset(graph);
    downloadFile("llm-field-notes-compact-feedback.json", JSON.stringify(dataset, null, 2), "application/json");
    document.querySelector("#projection-status").textContent = `Compact feedback downloaded · ${dataset.examples.length} reviewed example${dataset.examples.length === 1 ? "" : "s"} with source material removed${dataset.truncatedExamples ? ` · ${dataset.truncatedExamples} omitted at the export limit` : ""}.`;
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The compact feedback dataset could not be exported.");
  }
});
document.querySelector("#download-diff").addEventListener("click", () => {
  try {
    const graph = graphStore.read();
    const history = graphStore.readHistory();
    if (!history.length) throw new Error("There is no earlier revision to compare yet.");
    assertGraphTextExportBudget([history.at(-1), graph]);
    const diff = { ...diffGraphs(history.at(-1), graph), format: DIFF_FORMAT, exportedAt: new Date().toISOString() };
    downloadFile("llm-field-notes-diff.json", JSON.stringify(diff, null, 2), "application/json");
    document.querySelector("#projection-status").textContent = `Revision diff downloaded · ${diff.summary.added} added, ${diff.summary.changed} changed, ${diff.summary.removed} removed.`;
  } catch (error) {
    document.querySelector("#projection-status").textContent = boundedOperationDiagnostic(error, "The revision diff could not be exported.");
  }
});
document.querySelector("#reload-app").addEventListener("click", () => window.location.reload());
const updatePanel = document.querySelector("#app-update");
const updateButton = document.querySelector("#reload-update");
const updateMessage = updatePanel?.querySelector("span");
const DEFAULT_UPDATE_MESSAGE = "The saved graph is safe. Reload when you are ready to use the updated workbench.";
const SERVICE_WORKER_UPDATE_TIMEOUT_MS = 5000;
let waitingServiceWorkerRegistration = null;
let serviceWorkerReloading = false;
let serviceWorkerReloadTimer = null;
const showServiceWorkerUpdate = (registration) => {
  if (!registration.waiting || !navigator.serviceWorker.controller) return;
  waitingServiceWorkerRegistration = registration;
  if (updateMessage) updateMessage.textContent = DEFAULT_UPDATE_MESSAGE;
  if (updatePanel) updatePanel.hidden = false;
};
updateButton?.addEventListener("click", () => {
  const waiting = waitingServiceWorkerRegistration?.waiting;
  if (!waiting || serviceWorkerReloading) {
    window.location.reload();
    return;
  }
  serviceWorkerReloading = true;
  updateButton.disabled = true;
  let reloadOnControllerChange;
  const clearUpdateAttempt = () => {
    if (serviceWorkerReloadTimer) clearTimeout(serviceWorkerReloadTimer);
    serviceWorkerReloadTimer = null;
    navigator.serviceWorker.removeEventListener("controllerchange", reloadOnControllerChange);
  };
  const recoverServiceWorkerUpdate = () => {
    if (!serviceWorkerReloading) return;
    clearUpdateAttempt();
    serviceWorkerReloading = false;
    updateButton.disabled = false;
    if (updateMessage) updateMessage.textContent = "The update did not activate yet. Try again when the connection is stable.";
  };
  reloadOnControllerChange = () => {
    clearUpdateAttempt();
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", reloadOnControllerChange, { once: true });
  serviceWorkerReloadTimer = setTimeout(recoverServiceWorkerUpdate, SERVICE_WORKER_UPDATE_TIMEOUT_MS);
  try {
    waiting.postMessage({ type: "SKIP_WAITING" });
  } catch {
    recoverServiceWorkerUpdate();
  }
});
const reportRuntimeError = (error) => {
  const panel = document.querySelector("#app-error");
  if (!panel) return;
  panel.hidden = false;
  document.querySelector("#app-error-message").textContent = boundedOperationDiagnostic(error, "The saved graph was preserved, but this view could not render.");
};
window.addEventListener("error", (event) => reportRuntimeError(event.error || new Error("Unexpected application error.")));
window.addEventListener("unhandledrejection", (event) => reportRuntimeError(event.reason || new Error("Unexpected asynchronous error.")));
renderWorkbench();

let serviceWorkerManager = null;
try {
  serviceWorkerManager = navigator.serviceWorker;
} catch {
  // Service-worker support is optional; a restricted getter must not break
  // the local-first workbench.
}
if (location.protocol !== "file:"
  && typeof serviceWorkerManager?.register === "function"
  && typeof serviceWorkerManager?.addEventListener === "function") {
  serviceWorkerManager.register("./sw.js", { updateViaCache: "none" })
    .then((registration) => {
      const observedWorkers = new WeakSet();
      const completedWorkers = new WeakSet();
      const handleInstallingWorker = () => {
        const worker = registration.installing;
        if (!worker || observedWorkers.has(worker)) return;
        observedWorkers.add(worker);
        const handleInstalled = () => {
          if (worker.state !== "installed") return;
          if (completedWorkers.has(worker)) return;
          completedWorkers.add(worker);
          if (!navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          } else {
            showServiceWorkerUpdate(registration);
          }
        };
        worker.addEventListener("statechange", handleInstalled);
        handleInstalled();
      };
      registration.addEventListener("updatefound", handleInstallingWorker);
      handleInstallingWorker();
      showServiceWorkerUpdate(registration);
      return registration.update();
    })
    .catch(() => {
      // Offline support is an enhancement; the app remains fully usable if it
      // cannot be registered or refreshed in a preview or embedded environment.
    });
}
