import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const functionStart = source.indexOf("function startSampleWalkthrough()");
const functionEnd = source.indexOf('\ndocument.querySelector("#graph-health")', functionStart);
assert(functionStart >= 0 && functionEnd > functionStart, "sample walkthrough function should remain discoverable");
const functionSource = source.slice(functionStart, functionEnd);

function makeHarness({ busy = false, graph = {}, confirm = true } = {}) {
  const status = { textContent: "" };
  const workbench = { scrolls: 0, scrollIntoView: () => { workbench.scrolls += 1; } };
  const loadSample = { clicks: 0, click: () => { loadSample.clicks += 1; } };
  const ingest = { clicks: 0, click: () => { ingest.clicks += 1; } };
  let confirmCalls = 0;
  const context = {
    workbenchBusy: () => busy,
    graphStore: { read: () => graph },
    window: {
      confirm: () => {
        confirmCalls += 1;
        return confirm;
      }
    },
    document: {
      querySelector: (selector) => selector === "#ingest-status"
        ? status
        : selector === "#workbench"
          ? workbench
          : null
    },
    loadSampleButton: loadSample,
    ingestButton: ingest,
    bypassSampleDraftConfirmation: false
  };
  vm.runInNewContext(`${functionSource}; startSampleWalkthrough();`, context);
  return { status, workbench, loadSample, ingest, confirmCalls };
}

const busy = makeHarness({ busy: true });
assert.equal(busy.loadSample.clicks, 0, "a busy workbench must not start a second sample build");
assert.match(busy.status.textContent, /already in progress/);

const canceled = makeHarness({
  graph: { nodes: [{ id: "existing" }], edges: [], documents: [], learning: { examples: [] } },
  confirm: false
});
assert.equal(canceled.confirmCalls, 1, "a non-empty workspace should require confirmation before the sample walkthrough");
assert.equal(canceled.loadSample.clicks, 0, "canceling the sample confirmation must preserve the current workspace");
assert.match(canceled.status.textContent, /canceled/);

const firstRun = makeHarness({
  graph: { nodes: [], edges: [], documents: [], learning: { examples: [] } }
});
assert.equal(firstRun.confirmCalls, 0, "an empty workspace should keep sample onboarding one-click");
assert.equal(firstRun.loadSample.clicks, 1, "first-run sample onboarding should load the sample");
assert.equal(firstRun.ingest.clicks, 1, "first-run sample onboarding should start one build");
assert.equal(firstRun.workbench.scrolls, 1, "sample onboarding should reveal the workbench");

console.log("onboarding smoke ok");
