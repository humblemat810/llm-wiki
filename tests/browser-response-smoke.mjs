import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const declaredStart = source.indexOf("const declaredResponseBytes =");
const declaredEnd = source.indexOf("\nconst releaseController", declaredStart);
const helperStart = source.indexOf("async function readBoundedTextResponse");
const helperEnd = source.indexOf("\nconst textEncoder", helperStart);
assert(declaredStart >= 0 && declaredEnd > declaredStart && helperStart >= 0 && helperEnd > helperStart, "browser response helper source should remain discoverable");
const helper = vm.runInNewContext(`(() => {
  ${source.slice(declaredStart, declaredEnd)}
  return ${source.slice(helperStart, helperEnd)};
})()`, { Number, Promise, TextDecoder, Object });

const controller = new AbortController();
const response = {
  headers: { get: (name) => name === "content-length" ? "2" : null },
  arrayBuffer: () => new Promise(() => {}),
  body: { cancel: async () => {} }
};
const pendingRead = helper(response, 10, "oversized", controller.signal);
setTimeout(() => controller.abort(), 10);
await assert.rejects(
  pendingRead,
  (error) => error?.name === "AbortError",
  "browser non-streaming response reads should settle when their signal aborts"
);

const valid = await helper({
  headers: { get: () => "2" },
  arrayBuffer: async () => new TextEncoder().encode("ok").buffer
}, 10);
assert.equal(valid, "ok", "browser bounded response reads should preserve valid fallback data");

const streamController = new AbortController();
let streamCancelCalls = 0;
let streamReleaseCalls = 0;
const streamRead = helper({
  headers: { get: () => null },
  body: {
    getReader: () => ({
      read: () => new Promise(() => {}),
      cancel: () => {
        streamCancelCalls += 1;
        throw new Error("ignored cancellation");
      },
      releaseLock: () => {
        streamReleaseCalls += 1;
      }
    })
  }
}, 10, "oversized", streamController.signal);
setTimeout(() => streamController.abort(), 10);
await assert.rejects(
  streamRead,
  (error) => error?.name === "AbortError",
  "browser streamed response reads should settle when their signal aborts"
);
assert.equal(streamCancelCalls, 1, "browser stalled streams should request cancellation");
assert.equal(streamReleaseCalls, 0, "browser pending non-conforming reads should not release their lock unsafely");
const oversized = await assert.rejects(
  helper({
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array(41) }),
        cancel: () => new Promise(() => {}),
        releaseLock: () => {}
      })
    }
  }, 10, "oversized"),
  /oversized/
);
assert.equal(oversized, undefined, "browser oversized streams should fail without waiting for reader cleanup");

console.log("browser response smoke ok");
