import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const helperStart = source.indexOf("async function copyText");
const helperEnd = source.indexOf("\n\nconst browserStorage", helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, "the browser copy helper should remain discoverable");

let asyncValue = "";
const asyncHelper = vm.runInNewContext(`(() => {
  ${source.slice(helperStart, helperEnd)}
  return copyText;
})()`, {
  navigator: { clipboard: { writeText: async (value) => { asyncValue = value; } } },
  document: {}
});
await asyncHelper("clipboard path");
assert.equal(asyncValue, "clipboard path", "copy should prefer the asynchronous Clipboard API");

let appended = 0;
let removed = 0;
let copied = 0;
let restoredFocus = 0;
const previousFocus = { focus: () => { restoredFocus += 1; } };
const fallbackDocument = {
  activeElement: previousFocus,
  body: {
    appendChild: () => { appended += 1; }
  },
  createElement: () => ({
    style: {},
    setAttribute: () => {},
    focus: () => {},
    select: () => {},
    setSelectionRange: () => {},
    remove: () => { removed += 1; }
  }),
  execCommand: (command) => {
    if (command === "copy") copied += 1;
    return command === "copy";
  }
};
const fallbackHelper = vm.runInNewContext(`(() => {
  ${source.slice(helperStart, helperEnd)}
  return copyText;
})()`, {
  navigator: { clipboard: { writeText: async () => { throw new Error("permission denied"); } } },
  document: fallbackDocument
});
await fallbackHelper("fallback path");
assert.equal(appended, 1, "copy fallback should attach one hidden textarea");
assert.equal(removed, 1, "copy fallback should remove its temporary textarea");
assert.equal(copied, 1, "copy fallback should use the browser copy command once");
assert.equal(restoredFocus, 1, "copy fallback should restore focus to the activating control");

console.log("copy smoke ok");
