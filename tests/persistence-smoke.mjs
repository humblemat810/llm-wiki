import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("let persistenceRequested =");
const end = source.indexOf("\nlet graphSearchQuery", start);
assert(start >= 0 && end > start, "browser persistence request should remain discoverable");

const state = { persistCalls: 0, grantPersistence: false };
const helpers = vm.runInNewContext(`(() => {
  ${source.slice(start, end)}
  return { requestPersistentStorage };
})()`, {
  Error,
  Promise,
  clearTimeout,
  navigator: {
    storage: {
      persisted: async () => false,
      persist: async () => {
        state.persistCalls += 1;
        return state.grantPersistence;
      }
    }
  },
  state,
  setTimeout,
});

await helpers.requestPersistentStorage();
assert.equal(state.persistCalls, 1, "persistence should attempt the browser request");
state.grantPersistence = true;
await helpers.requestPersistentStorage();
assert.equal(state.persistCalls, 2, "a denied persistence request should be retryable");

console.log("persistence smoke ok");
