import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { defaultGraph, inspectGraph, mergeExtraction, extractGraph, redactGraph, fingerprintBackup } from "../graph-core.js";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const shareViewerSource = fs.readFileSync(new URL("../share.js", import.meta.url), "utf8");
const shareStart = source.indexOf("async function tryShareFile(");
const shareEnd = source.indexOf("\nconst browserStorage", shareStart);
const functionStart = source.indexOf("function buildRedactedGraphVisual(graph");
const functionEnd = source.indexOf("\nfunction buildFeedbackDataset", functionStart);
assert(shareStart >= 0 && shareEnd > shareStart && functionStart >= 0 && functionEnd > functionStart && source.includes("function buildRedactedHtmlProjection()"), "share and redacted HTML helpers should remain discoverable");
const copyValueStart = shareViewerSource.indexOf("const copyTextValue = async");
const copyValueEnd = shareViewerSource.indexOf("\nconst copyShareLink", copyValueStart);
assert(copyValueStart >= 0 && copyValueEnd > copyValueStart, "recipient share clipboard helper should remain discoverable");

let fallbackCopied = "";
let fallbackExecCommands = 0;
const copyValue = vm.runInNewContext(`(() => {
  ${shareViewerSource.slice(copyValueStart, copyValueEnd)}
  return copyTextValue;
})()`, {
  navigator: { clipboard: { writeText: async () => { throw new Error("permission denied"); } } },
  document: {
    body: { append: () => {} },
    createElement: () => ({
      setAttribute: () => {},
      style: {},
      select: () => {},
      remove: () => {},
      get value() { return fallbackCopied; },
      set value(value) { fallbackCopied = value; }
    }),
    execCommand: (command) => {
      fallbackExecCommands += command === "copy" ? 1 : 0;
      return true;
    }
  }
});
await copyValue("permission-safe correction context");
assert.equal(fallbackCopied, "permission-safe correction context", "clipboard permission failures should preserve the copied correction context in the textarea fallback");
assert.equal(fallbackExecCommands, 1, "clipboard permission failures should invoke the bounded copy fallback once");

class FakeFile {
  constructor(parts, name, options) {
    this.parts = parts;
    this.name = name;
    this.type = options.type;
  }
}

const shareHelper = vm.runInNewContext(`(() => {
  ${source.slice(shareStart, shareEnd)}
  return tryShareFile;
})()`, {
  File: FakeFile,
  navigator: {
    share: async () => {},
    canShare: () => true
  }
});
const shared = await shareHelper({
  filename: "graph.html",
  content: "<p>safe</p>",
  type: "text/html",
  title: "Graph",
  text: "A graph"
});
assert.equal(shared.shared, true, "native file sharing should report a successful share");
assert.equal(shared.canceled, false, "successful native file sharing should not report cancellation");

const canceledShareHelper = vm.runInNewContext(`(() => {
  ${source.slice(shareStart, shareEnd)}
  return tryShareFile;
})()`, {
  File: FakeFile,
  navigator: {
    share: async () => {
      throw Object.assign(new Error("user canceled"), { name: "AbortError" });
    },
    canShare: () => true
  }
});
const canceled = await canceledShareHelper({
  filename: "graph.md",
  content: "safe",
  type: "text/markdown",
  title: "Graph",
  text: "A graph"
});
assert.equal(canceled.shared, false, "canceled native file sharing should not report a successful share");
assert.equal(canceled.canceled, true, "canceling native file sharing should be reported without converting it into an error");

const unsupportedShareHelper = vm.runInNewContext(`(() => {
  ${source.slice(shareStart, shareEnd)}
  return tryShareFile;
})()`, {
  File: FakeFile,
  navigator: {
    share: async () => {},
    canShare: () => false
  }
});
const unsupported = await unsupportedShareHelper({
  filename: "graph.html",
  content: "safe",
  type: "text/html",
  title: "Graph",
  text: "A graph"
});
assert.equal(unsupported.shared, false, "unsupported file sharing should return a fallback result");
assert.equal(unsupported.canceled, false, "unsupported file sharing should not report cancellation");

const nonBooleanShareHelper = vm.runInNewContext(`(() => {
  ${source.slice(shareStart, shareEnd)}
  return tryShareFile;
})()`, {
  File: FakeFile,
  navigator: {
    share: async () => {
      throw new Error("share should not be called");
    },
    canShare: () => ({ supported: true })
  }
});
const nonBoolean = await nonBooleanShareHelper({
  filename: "graph.html",
  content: "safe",
  type: "text/html",
  title: "Graph",
  text: "A graph"
});
assert.equal(nonBoolean.shared, false, "non-boolean share capability results should fail closed");
assert.equal(nonBoolean.canceled, false, "non-boolean share capability results should use the normal fallback");

const throwingFileHelper = vm.runInNewContext(`(() => {
  ${source.slice(shareStart, shareEnd)}
  return tryShareFile;
})()`, {
  File: class {
    constructor() {
      throw new Error("File construction unavailable");
    }
  },
  navigator: {
    share: async () => {
      throw new Error("share should not be called");
    },
    canShare: () => true
  }
});
const throwingFile = await throwingFileHelper({
  filename: "graph.html",
  content: "safe",
  type: "text/html",
  title: "Graph",
  text: "A graph"
});
assert.equal(throwingFile.shared, false, "file construction failures should use the normal fallback");
assert.equal(throwingFile.canceled, false, "file construction failures should not be treated as user cancellation");

let graph = defaultGraph();
graph = mergeExtraction(graph, extractGraph(
  "SECRET SOURCE TITLE",
  "Attention connects context through a useful representation for review. This sentence carries secret source material."
)).graph;
graph.documents[0].uri = "https://private.example/source";
graph.nodes[0].label = "Visible concept";
graph.nodes[1].label = '<img src=x onerror="alert(1)">';
graph.edges[0].label = "<script>alert(1)</script>";
graph.nodes[0].evidence = [{ text: "SECRET EVIDENCE", sources: [graph.documents[0].id] }];

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;"
}[character]));
const context = {
  redactGraph,
  inspectGraph,
  fingerprintBackup,
  escapeHtml,
  graphStore: { read: () => graph },
  assertGraphTextExportBudget: () => {},
  textEncoder: new TextEncoder(),
  MAX_EXPORT_BYTES: 50 * 1024 * 1024
};
const functionSource = source.slice(functionStart, functionEnd);
const html = vm.runInNewContext(`${functionSource}; buildRedactedHtmlProjection();`, context);

assert.match(html, /^<!doctype html>/i, "redacted HTML should be a complete document");
assert(html.includes("Visible concept"), "redacted HTML should retain useful graph labels");
assert(html.includes("Graph at a glance") && html.includes("role=\"img\"") && html.includes("graph-visual"), "redacted HTML should include an accessible visual graph projection");
assert(html.includes("Attention") || html.includes("Visible concept"), "redacted HTML visual should retain non-sensitive concept labels");
assert(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), "redacted HTML should escape hostile concept labels");
assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "redacted HTML should escape hostile relation labels");
assert(!html.includes('<img src=x onerror="alert(1)">'), "redacted HTML should not emit hostile concept markup");
assert(!html.includes("<script>alert(1)</script>"), "redacted HTML should not emit hostile relation markup");
assert(html.includes("Content-Security-Policy"), "redacted HTML should declare a restrictive CSP");
assert(!/<script\b/i.test(html), "redacted HTML should contain no executable scripts");
assert(!html.includes("SECRET SOURCE MATERIAL"), "redacted HTML must remove source text");
assert(!html.includes("SECRET SOURCE TITLE"), "redacted HTML must remove source document titles");
assert(!html.includes("SECRET EVIDENCE"), "redacted HTML must remove evidence quotes");
assert(!html.includes("private.example"), "redacted HTML must remove source URIs");
assert(html.includes("source text, evidence quotes, and source URIs were removed"), "redacted HTML should explain its privacy boundary");

console.log("share smoke ok");
