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
const helpers = vm.runInNewContext(`(() => {
  const appStorage = {
    getItem: (key) => stored.has(key) ? stored.get(key) : null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key)
  };
  ${source.slice(start, end)}
  return { hasUnsavedDocumentDraft, commitDocumentDraft, saveDocumentDraft, restoreStoredDocumentDraft };
})()`, {
  JSON,
  MAX_DOCUMENT_CHARS: 300000,
  MAX_DOCUMENT_TITLE_CHARS: 200,
  MAX_SOURCE_URI_CHARS: 2048,
  parseJsonWithUniqueKeys: (value) => JSON.parse(value),
  stored,
  document: { querySelector: (selector) => fields[selector] || null }
});

assert.equal(helpers.hasUnsavedDocumentDraft(), false, "an empty editor should not be treated as an unsaved draft");
fields["#document-input"].value = "A document waiting to become a graph.";
assert.equal(helpers.hasUnsavedDocumentDraft(), true, "unbuilt document text should be treated as an unsaved draft");
helpers.saveDocumentDraft();
assert(stored.has("llm-field-notes-document-draft"), "editor drafts should be saved in the application storage namespace");
fields["#document-input"].value = "";
assert.equal(helpers.restoreStoredDocumentDraft(), true, "a stored draft should restore into an empty editor");
helpers.commitDocumentDraft();
assert.equal(helpers.hasUnsavedDocumentDraft(), false, "a successfully committed draft should clear the dirty state");
assert.equal(stored.has("llm-field-notes-document-draft"), false, "committing a draft should remove its recovery copy");
fields["#document-title"].value = "Renamed draft";
assert.equal(helpers.hasUnsavedDocumentDraft(), true, "editing title metadata after a build should restore the dirty state");

console.log("draft smoke ok");
