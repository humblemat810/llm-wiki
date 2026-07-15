import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("const readDocumentDraftParts =");
const end = source.indexOf("\nconst updateConnectionStatus", start);
assert(start >= 0 && end > start, "document draft tracking should remain discoverable");

const fields = {
  "#document-title": { value: "" },
  "#document-uri": { value: "" },
  "#document-input": { value: "" }
};
const stored = new Map();
const scheduledTimers = new Map();
const clearedTimers = [];
let nextTimerId = 0;
const helpers = vm.runInNewContext(`(() => {
  const appStorage = {
    getItem: (key) => stored.has(key) ? stored.get(key) : null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key)
  };
  let storageFlushes = 0;
  const flushBrowserStorage = () => { storageFlushes += 1; };
  ${source.slice(start, end)}
  return { hasUnsavedDocumentDraft, commitDocumentDraft, saveDocumentDraft, restoreStoredDocumentDraft, scheduleDocumentDraftSave, flushDocumentDraft, getStorageFlushes: () => storageFlushes };
})()`, {
  JSON,
  MAX_DOCUMENT_CHARS: 300000,
  MAX_DOCUMENT_TITLE_CHARS: 200,
  MAX_SOURCE_URI_CHARS: 2048,
  parseJsonWithUniqueKeys: (value) => JSON.parse(value),
  stored,
  setTimeout: (callback) => {
    const id = ++nextTimerId;
    scheduledTimers.set(id, callback);
    return id;
  },
  clearTimeout: (id) => {
    clearedTimers.push(id);
    scheduledTimers.delete(id);
  },
  document: { querySelector: (selector) => fields[selector] || null }
});

assert.equal(helpers.hasUnsavedDocumentDraft(), false, "an empty editor should not be treated as an unsaved draft");
fields["#document-input"].value = "A document waiting to become a graph.";
assert.equal(helpers.hasUnsavedDocumentDraft(), true, "unbuilt document text should be treated as an unsaved draft");
helpers.saveDocumentDraft();
assert(stored.has("llm-field-notes-document-draft"), "editor drafts should be saved in the application storage namespace");
fields["#document-input"].value = "";
assert.equal(helpers.restoreStoredDocumentDraft(), true, "a stored draft should restore into an empty editor");
helpers.scheduleDocumentDraftSave();
const pendingDraftTimer = [...scheduledTimers.keys()].at(-1);
helpers.commitDocumentDraft();
assert.equal(helpers.hasUnsavedDocumentDraft(), false, "a successfully committed draft should clear the dirty state");
assert.equal(stored.has("llm-field-notes-document-draft"), false, "committing a draft should remove its recovery copy");
assert(clearedTimers.includes(pendingDraftTimer), "committing a draft should cancel its pending delayed save");
assert.equal(scheduledTimers.has(pendingDraftTimer), false, "a canceled draft save should not remain scheduled");
fields["#document-title"].value = "Renamed draft";
assert.equal(helpers.hasUnsavedDocumentDraft(), true, "editing title metadata after a build should restore the dirty state");
helpers.scheduleDocumentDraftSave();
const lifecycleDraftTimer = [...scheduledTimers.keys()].at(-1);
helpers.flushDocumentDraft();
assert(clearedTimers.includes(lifecycleDraftTimer), "lifecycle draft flushes should cancel the delayed autosave timer");
assert(stored.has("llm-field-notes-document-draft"), "lifecycle draft flushes should persist the current editor state immediately");
assert.equal(helpers.getStorageFlushes(), 1, "lifecycle draft flushes should flush browser storage after saving the draft");
helpers.commitDocumentDraft();
helpers.flushDocumentDraft();
assert.equal(stored.has("llm-field-notes-document-draft"), false, "lifecycle flushes should not recreate recovery drafts for already committed editor content");

console.log("draft smoke ok");
