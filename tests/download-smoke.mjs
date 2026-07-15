import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const helperStart = source.indexOf("const activeObjectUrls = new Set()");
const helperEnd = source.indexOf("\nfunction exportBackupSnapshot", helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, "download helpers should remain discoverable");

const createdUrls = [];
const revokedUrls = [];
let clickCount = 0;
let removeCount = 0;
const links = [];
const context = {
  Blob,
  ArrayBuffer,
  Uint8Array,
  Number,
  Set,
  URL: {
    createObjectURL: () => {
      const url = `blob:test-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    },
    revokeObjectURL: (url) => revokedUrls.push(url)
  },
  document: {
    body: { appendChild: (link) => links.push(link) },
    createElement: () => {
      const link = {
        style: {},
        remove: () => { removeCount += 1; },
        click: () => {
          clickCount += 1;
          if (link.shouldThrow) throw new Error("download blocked");
        }
      };
      links.push(link);
      return link;
    }
  },
  setTimeout: (callback) => {
    callback();
    return 1;
  },
  textEncoder: new TextEncoder(),
  MAX_EXPORT_BYTES: 1024,
  MAX_ENCRYPTED_BACKUP_BYTES: 2048
};
const helpers = vm.runInNewContext(`(() => {
  ${source.slice(helperStart, helperEnd)}
  return { downloadFile, downloadBytes, revokeAllObjectUrls };
})()`, context);

helpers.downloadFile("graph.json", "{}", "application/json");
helpers.downloadBytes("graph.bin", new Uint8Array([1, 2, 3]), "application/octet-stream");
helpers.downloadFile("encrypted-backup.json", "x".repeat(1200), "application/json", 2048);
assert.equal(createdUrls.length, 3, "downloads should create one object URL per artifact");
assert.deepEqual(revokedUrls, createdUrls, "successful downloads should revoke object URLs after activation");
assert.equal(removeCount, 3, "download links should always be removed after activation");

const failingLink = links.at(-1);
failingLink.shouldThrow = true;
assert.throws(() => {
  const originalCreateElement = context.document.createElement;
  context.document.createElement = () => {
    const link = originalCreateElement();
    link.shouldThrow = true;
    return link;
  };
  helpers.downloadFile("blocked.json", "{}", "application/json");
}, /download blocked/, "download activation failures should remain visible to the caller");
assert.equal(revokedUrls.length, createdUrls.length, "download activation failures should still revoke their object URL");
helpers.revokeAllObjectUrls();
assert.equal(revokedUrls.length, createdUrls.length, "pagehide-style cleanup should be idempotent after scheduled revocation");

console.log("download smoke ok");
