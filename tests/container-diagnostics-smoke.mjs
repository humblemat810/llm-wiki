import assert from "node:assert/strict";
import { boundDiagnosticLog, formatReadinessFailure, readBoundedResponseBody } from "../scripts/smoke-container.mjs";

const tail = "diagnostic-tail";
const bounded = boundDiagnosticLog(`${"x".repeat(100000)}${tail}`);
assert(bounded.endsWith(tail), "bounded diagnostics should retain the newest log tail");
assert(Buffer.byteLength(bounded, "utf8") <= 64 * 1024, "bounded diagnostics should enforce a byte ceiling");

const unicode = boundDiagnosticLog(`${"🙂".repeat(50000)}${tail}`);
assert(unicode.endsWith(tail), "Unicode diagnostics should retain the newest log tail");
assert(Buffer.byteLength(unicode, "utf8") <= 64 * 1024, "Unicode diagnostics should enforce the same byte ceiling");

assert.equal(boundDiagnosticLog(""), "");
assert.equal(
  formatReadinessFailure(503, JSON.stringify({ error: "Static app shell is unavailable." })),
  "HTTP 503: Static app shell is unavailable."
);
assert.equal(
  formatReadinessFailure(503, "not-json"),
  "HTTP 503",
  "non-JSON readiness responses should retain a safe status-only diagnostic"
);
assert(
  formatReadinessFailure(503, JSON.stringify({ error: "x".repeat(1000) })).length <= 266,
  "readiness diagnostics should bound the exposed error detail"
);
const boundedResponse = new Response(`${"x".repeat(100000)}tail`);
const boundedBody = await readBoundedResponseBody(boundedResponse, 1024);
assert(Buffer.byteLength(boundedBody, "utf8") <= 1024, "readiness response bodies should be bounded while being read");
console.log("container diagnostics smoke ok");
