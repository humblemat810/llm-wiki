import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseJsonWithUniqueKeys } from "../graph-core.js";
import { verifyServiceHealth } from "../scripts/verify-service-health.mjs";

const sample = parseJsonWithUniqueKeys(
  await readFile(new URL("../examples/sample-service-health.json", import.meta.url), "utf8"),
  "sample service health"
);

assert.deepEqual(
  verifyServiceHealth(sample, "sample service health", "readiness"),
  { kind: "readiness", ok: true, ready: true }
);
assert.deepEqual(
  verifyServiceHealth({
    ok: false,
    ready: false,
    schema: "llm-field-notes/graph@1",
    version: "0.1.0",
    revision: "unknown",
    error: "Server is draining."
  }, "draining service health", "readiness"),
  { kind: "readiness", ok: false, ready: false }
);
assert.deepEqual(
  verifyServiceHealth({
    ok: true,
    live: true,
    schema: "llm-field-notes/graph@1",
    version: "0.1.0",
    revision: "abcdef1234567890"
  }, "sample liveness", "liveness"),
  { kind: "liveness", ok: true, ready: undefined }
);
assert.throws(
  () => verifyServiceHealth({ ...sample, live: true }, "ambiguous health"),
  /exactly one liveness or readiness/,
  "health verifier should reject payloads that claim both endpoint kinds"
);
assert.throws(
  () => verifyServiceHealth({ ...sample, ok: true, ready: false, error: "not ready" }, "inconsistent health"),
  /ok must match ready/,
  "health verifier should reject inconsistent readiness state"
);
assert.throws(
  () => verifyServiceHealth({ ...sample, unexpected: true }, "unknown health"),
  /unknown field/,
  "health verifier should reject unknown response fields"
);
assert.throws(
  () => verifyServiceHealth({ ...sample, error: "contradiction" }, "ready with error"),
  /must not include an error/,
  "health verifier should reject ready responses that carry an error"
);
assert.throws(
  () => verifyServiceHealth({
    ok: false,
    live: true,
    schema: "llm-field-notes/graph@1",
    version: "0.1.0",
    revision: "unknown"
  }, "failed liveness"),
  /liveness responses must have ok true/,
  "health verifier should reject failed liveness responses"
);
assert.throws(
  () => verifyServiceHealth({ ...sample, ok: false, ready: false }, "not-ready without error"),
  /not-ready responses must include/,
  "health verifier should reject not-ready responses without an error"
);
const stdinOutput = execFileSync(
  process.execPath,
  ["scripts/verify-service-health.mjs", "-", "readiness"],
  { input: JSON.stringify(sample), cwd: process.cwd(), encoding: "utf8" }
);
assert.match(stdinOutput, /Service health verified: readiness \(ok\)/, "health verifier should accept bounded stdin for monitoring pipelines");

console.log("service health smoke ok");
