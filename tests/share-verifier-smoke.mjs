import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSharePayload } from "../share-projection.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = buildSharePayload({
  documents: [{ id: "doc", title: "private", text: "secret" }],
  nodes: [
    { id: "a", label: "Retrieval", type: "concept", status: "accepted", confidence: .9 },
    { id: "b", label: "Answer", type: "concept", status: "inferred", confidence: .8 }
  ],
  edges: [{ source: "a", target: "b", label: "supports", status: "accepted", confidence: .85 }]
});
const directory = await mkdtemp(join(tmpdir(), "llm-field-notes-share-verifier-"));
try {
  const validPath = join(directory, "share.json");
  await writeFile(validPath, `${JSON.stringify(fixture, null, 2)}\n`);
  const valid = spawnSync(process.execPath, ["scripts/verify-share.mjs", validPath], { cwd: root, encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /share verifier ok: 2 concepts, 1 relations/);

  const duplicatePath = join(directory, "duplicate.json");
  await writeFile(duplicatePath, `{"format":"llm-field-notes/share@1","format":"llm-field-notes/share@1"}`);
  const duplicate = spawnSync(process.execPath, ["scripts/verify-share.mjs", duplicatePath], { cwd: root, encoding: "utf8" });
  assert.notEqual(duplicate.status, 0, "duplicate-key share JSON should fail closed");

  const oversizedPath = join(directory, "oversized.json");
  await writeFile(oversizedPath, Buffer.alloc(1024 * 1024 + 1, 0x20));
  const oversized = spawnSync(process.execPath, ["scripts/verify-share.mjs", oversizedPath], { cwd: root, encoding: "utf8" });
  assert.notEqual(oversized.status, 0, "oversized share JSON should fail before unbounded parsing");
  assert.match(`${oversized.stdout}${oversized.stderr}`, /verifier limit/);
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log("share verifier smoke ok");
