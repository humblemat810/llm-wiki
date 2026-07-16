import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseJsonWithUniqueKeys } from "../graph-core.js";

export const MAX_SERVICE_HEALTH_FILE_BYTES = 1024 * 1024;
const GRAPH_SCHEMA = "llm-field-notes/graph@1";
const REVISION_PATTERN = /^(?:unknown|[0-9a-f]{7,64})$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function fail(label, message) {
  throw new Error(`${label}: ${message}`);
}

function assertKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail(label, `unknown field(s): ${unknown.join(", ")}`);
}

function verifyIdentity(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label, "must be an object");
  if (typeof value.ok !== "boolean") fail(`${label}.ok`, "must be boolean");
  if (value.schema !== GRAPH_SCHEMA) fail(`${label}.schema`, `must equal ${GRAPH_SCHEMA}`);
  if (typeof value.version !== "string" || !VERSION_PATTERN.test(value.version) || value.version.length > 64) {
    fail(`${label}.version`, "must be a bounded semantic version");
  }
  if (typeof value.revision !== "string" || !REVISION_PATTERN.test(value.revision)) {
    fail(`${label}.revision`, "must be unknown or 7–64 lowercase hexadecimal characters");
  }
}

export function verifyServiceHealth(value, label = "service health response", expectedKind = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label, "must be an object");
  const isLive = value.live === true;
  const isReady = typeof value.ready === "boolean";
  if (isLive === isReady) fail(label, "must be exactly one liveness or readiness response");
  const kind = isLive ? "liveness" : "readiness";
  if (expectedKind !== null && expectedKind !== kind) fail(label, `expected ${expectedKind} response, received ${kind}`);
  verifyIdentity(value, label);
  if (isLive) {
    assertKeys(value, new Set(["ok", "live", "schema", "version", "revision"]), label);
    if (value.ok !== true) fail(label, "liveness responses must have ok true");
  } else {
    assertKeys(value, new Set(["ok", "ready", "schema", "version", "revision", "error"]), label);
    if (value.ready && value.error !== undefined) fail(label, "ready responses must not include an error");
    if (!value.ready && (typeof value.error !== "string" || value.error.length === 0 || value.error.length > 256)) {
      fail(`${label}.error`, "not-ready responses must include a bounded non-empty error");
    }
    if (value.ok !== value.ready) fail(label, "ok must match ready");
  }
  return { kind, ok: value.ok, ready: isReady ? value.ready : undefined };
}

export async function verifyServiceHealthFile(path, expectedKind = null) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_SERVICE_HEALTH_FILE_BYTES) {
    throw new Error(`${path}: health response must be a regular file no larger than ${MAX_SERVICE_HEALTH_FILE_BYTES} bytes`);
  }
  const source = await readFile(path, "utf8");
  return verifyServiceHealth(parseJsonWithUniqueKeys(source, path), path, expectedKind);
}

export async function verifyServiceHealthStdin(expectedKind = null) {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_SERVICE_HEALTH_FILE_BYTES) {
      throw new Error(`stdin: health response exceeds the ${MAX_SERVICE_HEALTH_FILE_BYTES}-byte limit`);
    }
    chunks.push(bytes);
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  return verifyServiceHealth(parseJsonWithUniqueKeys(source, "stdin"), "stdin", expectedKind);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: node scripts/verify-service-health.mjs <file> [liveness|readiness]");
  const expectedKind = process.argv[3] || null;
  if (expectedKind !== null && !["liveness", "readiness"].includes(expectedKind)) {
    throw new Error("expected kind must be liveness or readiness");
  }
  const result = path === "-"
    ? await verifyServiceHealthStdin(expectedKind)
    : await verifyServiceHealthFile(path, expectedKind);
  console.log(`Service health verified: ${result.kind} (${result.ok ? "ok" : "not ready"})`);
}
