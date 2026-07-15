import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBackupEnvelope, sampleDocument, extractGraph } from "../graph-core.js";
import { encryptBackup } from "../backup-crypto.js";

globalThis.crypto ||= webcrypto;

const root = await mkdtemp(join(tmpdir(), "llm-field-notes-backup-verifier-"));
const password = "correct horse battery staple";
try {
  const backup = buildBackupEnvelope(extractGraph(sampleDocument.title, sampleDocument.text), [], { appVersion: "0.1.0" });
  const plaintextPath = join(root, "backup.json");
  await writeFile(plaintextPath, JSON.stringify(backup));
  const plaintextResult = JSON.parse(execFileSync(process.execPath, ["experiments/verify-backup.mjs", plaintextPath], { encoding: "utf8" }));
  assert.equal(plaintextResult.verified, true);
  assert.equal(plaintextResult.encrypted, false);
  assert.equal(plaintextResult.complete, true);
  assert.equal(plaintextResult.graphFingerprint, backup.graphFingerprint);

  const encryptedPath = join(root, "encrypted-backup.json");
  await writeFile(encryptedPath, JSON.stringify(await encryptBackup(backup, password)));
  const envelopeResult = JSON.parse(execFileSync(process.execPath, ["experiments/verify-backup.mjs", encryptedPath], { encoding: "utf8" }));
  assert.equal(envelopeResult.verified, true);
  assert.equal(envelopeResult.encrypted, true);
  assert.equal(envelopeResult.decrypted, false);
  assert(!Object.hasOwn(envelopeResult, "graphFingerprint"), "encrypted envelope verification should not expose graph metadata without a password");

  const decryptedResult = JSON.parse(execFileSync(process.execPath, ["experiments/verify-backup.mjs", encryptedPath, "--password-stdin"], {
    encoding: "utf8",
    input: `${password}\n`
  }));
  assert.equal(decryptedResult.verified, true);
  assert.equal(decryptedResult.decrypted, true);
  assert.equal(decryptedResult.graphFingerprint, backup.graphFingerprint);
  assert.throws(
    () => execFileSync(process.execPath, ["experiments/verify-backup.mjs", encryptedPath, "--password-stdin"], {
      encoding: "utf8",
      input: "wrong password that is long enough\n",
      stdio: ["pipe", "pipe", "pipe"]
    }),
    "encrypted verifier should reject an incorrect password"
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("backup verifier smoke ok");
