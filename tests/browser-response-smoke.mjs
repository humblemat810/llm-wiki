import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const endpointStart = source.indexOf("const validateExtractorEndpoint =");
const endpointEnd = source.indexOf("\nlet storedExtractorEndpoint", endpointStart);
const declaredStart = source.indexOf("const declaredResponseBytes =");
const declaredEnd = source.indexOf("\nconst releaseController", declaredStart);
const originGuardStart = source.indexOf("const isReadableSameOriginResponse =");
const originGuardEnd = source.indexOf("\nconst releaseController", originGuardStart);
const fileHelperStart = source.indexOf("async function readBrowserFileBytes");
const fileHelperEnd = source.indexOf("\nasync function readBrowserFileText", fileHelperStart);
const helperStart = source.indexOf("async function readBoundedTextResponse");
const helperEnd = source.indexOf("\nconst textEncoder", helperStart);
assert(endpointStart >= 0 && endpointEnd > endpointStart && declaredStart >= 0 && declaredEnd > declaredStart && originGuardStart >= 0 && originGuardEnd > originGuardStart && fileHelperStart >= 0 && fileHelperEnd > fileHelperStart && helperStart >= 0 && helperEnd > helperStart, "browser boundary helpers should remain discoverable");
const endpointHelpers = vm.runInNewContext(`(() => {
  const MAX_SOURCE_URI_CHARS = 2048;
  const location = { href: "https://notes.example.test/workbench/", origin: "https://notes.example.test" };
  ${source.slice(endpointStart, endpointEnd)}
  return { validateExtractorEndpoint, absoluteExtractorEndpoint };
})()`, { URL });
assert.equal(
  endpointHelpers.absoluteExtractorEndpoint("/api/extract-graph"),
  "https://notes.example.test/api/extract-graph",
  "documented relative extractor paths should resolve against the current app origin"
);
assert.throws(
  () => endpointHelpers.absoluteExtractorEndpoint("https://other.example.test/api/extract-graph"),
  /same-origin/,
  "cross-origin extractor paths should remain rejected"
);
const helper = vm.runInNewContext(`(() => {
  ${source.slice(declaredStart, declaredEnd)}
  return ${source.slice(helperStart, helperEnd)};
})()`, { ArrayBuffer, Number, Promise, TextDecoder, Object, Uint8Array });
const originGuard = vm.runInNewContext(`(() => {
  const location = { href: "https://notes.example.test/workbench/", origin: "https://notes.example.test" };
  ${source.slice(originGuardStart, originGuardEnd)}
  return isReadableSameOriginResponse;
})()`, { URL });
assert.equal(originGuard({ type: "opaque" }), false, "opaque static responses should not be trusted by the browser workbench");
assert.equal(originGuard({ url: "https://other.example.test/notes/tokens.md" }), false, "cross-origin static redirects should not be trusted by the browser workbench");
assert.equal(originGuard({ url: "https://notes.example.test/notes/tokens.md" }), true, "same-origin static responses should remain readable");
const readBrowserFileBytes = vm.runInNewContext(`(() => {
  ${source.slice(fileHelperStart, fileHelperEnd)}
  return readBrowserFileBytes;
})()`, { ArrayBuffer, Number, Math, Uint8Array, Promise, Error });
let boundedSlice;
await assert.rejects(
  () => readBrowserFileBytes({
    slice(start, end) {
      boundedSlice = [start, end];
      return { arrayBuffer: async () => new Uint8Array(11).buffer };
    }
  }, 10, "file oversized"),
  /file oversized/,
  "browser file reads should reject a sliced payload that exceeds its byte limit"
);
assert.deepEqual(boundedSlice, [0, 11], "browser file reads should request only limit-plus-one bytes before validation");
let unboundedReadCalled = false;
await assert.rejects(
  () => readBrowserFileBytes({
    arrayBuffer: async () => {
      unboundedReadCalled = true;
      return new Uint8Array(1).buffer;
    }
  }, 10, "file boundary unavailable"),
  /file boundary unavailable|validate file size safely/,
  "browser file reads should fail closed when a bounded slice API is unavailable"
);
assert.equal(unboundedReadCalled, false, "browser file reads should not invoke an unbounded arrayBuffer fallback");

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
let htmlResponseCancelCalls = 0;
await assert.rejects(
  helper({
    headers: { get: (name) => name === "content-type" ? "text/html; charset=utf-8" : "2" },
    body: { cancel: () => { htmlResponseCancelCalls += 1; } },
    arrayBuffer: async () => new TextEncoder().encode("ok").buffer
  }, 10, "HTML response"),
  /HTML document instead of text data/,
  "browser bounded text reads should reject same-origin HTML gateway responses"
);
assert.equal(htmlResponseCancelCalls, 1, "browser bounded text reads should cancel rejected HTML response bodies");
await assert.rejects(
  helper({
    headers: { get: () => "not-a-byte-count" },
    arrayBuffer: async () => new TextEncoder().encode("ok").buffer
  }, 10, "invalid content length"),
  /Content-Length is invalid/,
  "browser bounded response reads should reject malformed Content-Length headers"
);
await assert.rejects(
  helper({
    headers: { get: () => "3" },
    arrayBuffer: async () => new TextEncoder().encode("ok").buffer
  }, 10, "length mismatch"),
  /byte length does not match Content-Length/,
  "browser non-streaming response reads should reject truncated bodies"
);
await assert.rejects(
  helper({
    headers: { get: () => "2" },
    arrayBuffer: async () => ({ byteLength: 2 })
  }, 10, "invalid bytes"),
  /byte data/,
  "browser bounded response reads should reject non-byte fallback values"
);

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
await assert.rejects(
  helper({
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: {} }),
        cancel: () => {},
        releaseLock: () => {}
      })
    }
  }, 10, "invalid chunk"),
  /invalid byte chunk/,
  "browser streamed response reads should reject chunks without a finite byte length"
);
await assert.rejects(
  helper({
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => ({ done: "false", value: new Uint8Array([0x7b]) }),
        cancel: () => {},
        releaseLock: () => {}
      })
    }
  }, 10, "invalid stream result"),
  /invalid stream result/,
  "browser streamed response reads should reject results with a non-boolean done flag"
);
await assert.rejects(
  helper({
    headers: { get: () => "3" },
    body: {
      getReader: () => {
        let delivered = false;
        return {
          read: async () => {
            if (delivered) return { done: true };
            delivered = true;
            return { done: false, value: new TextEncoder().encode("ok") };
          },
          cancel: () => {},
          releaseLock: () => {}
        };
      }
    }
  }, 10, "length mismatch"),
  /byte length does not match Content-Length/,
  "browser streamed response reads should reject truncated bodies"
);

console.log("browser response smoke ok");
