import assert from "node:assert/strict";
import { boundDiagnosticLog } from "../scripts/smoke-container.mjs";

const tail = "diagnostic-tail";
const bounded = boundDiagnosticLog(`${"x".repeat(100000)}${tail}`);
assert(bounded.endsWith(tail), "bounded diagnostics should retain the newest log tail");
assert(Buffer.byteLength(bounded, "utf8") <= 64 * 1024, "bounded diagnostics should enforce a byte ceiling");

const unicode = boundDiagnosticLog(`${"🙂".repeat(50000)}${tail}`);
assert(unicode.endsWith(tail), "Unicode diagnostics should retain the newest log tail");
assert(Buffer.byteLength(unicode, "utf8") <= 64 * 1024, "Unicode diagnostics should enforce the same byte ceiling");

assert.equal(boundDiagnosticLog(""), "");
console.log("container diagnostics smoke ok");
