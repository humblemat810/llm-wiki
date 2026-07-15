import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import { buildBackupEnvelope, sampleDocument, extractGraph } from "../graph-core.js";
import {
  BACKUP_KDF_ITERATIONS,
  ENCRYPTED_BACKUP_FORMAT,
  MAX_ENCRYPTED_BACKUP_BYTES,
  MIN_BACKUP_PASSWORD_CHARS,
  decryptBackup,
  encryptBackup,
  isEncryptedBackup
} from "../backup-crypto.js";

globalThis.crypto ||= webcrypto;
const password = "correct horse battery staple";
const schema = JSON.parse(fs.readFileSync(new URL("../schema/encrypted-backup.schema.json", import.meta.url), "utf8"));
assert.equal(schema.properties.format.const, ENCRYPTED_BACKUP_FORMAT, "the published encrypted-backup schema should use the runtime format identifier");
assert.equal(schema.properties.iterations.const, BACKUP_KDF_ITERATIONS, "the published encrypted-backup schema should use the runtime KDF cost");
assert.equal(schema.properties.ciphertext.maxLength, Math.ceil((50 * 1024 * 1024 + 16) * 4 / 3), "the published encrypted-backup schema should use the runtime ciphertext bound");
const graph = extractGraph(sampleDocument.title, sampleDocument.text);
const backup = buildBackupEnvelope(graph, [], { appVersion: "0.1.0" });
const encrypted = await encryptBackup(backup, password);

assert.equal(encrypted.format, ENCRYPTED_BACKUP_FORMAT);
assert.equal(encrypted.iterations, BACKUP_KDF_ITERATIONS);
assert(MAX_ENCRYPTED_BACKUP_BYTES > 50 * 1024 * 1024, "encrypted backup import bounds should include authenticated base64 envelope overhead");
assert.equal(isEncryptedBackup(encrypted), true);
assert.deepEqual(await decryptBackup(encrypted, password), backup, "encrypted backups should round-trip without changing the internal representation");
await assert.rejects(
  () => decryptBackup(encrypted, "wrong password that is long enough"),
  /password is incorrect|damaged/i,
  "encrypted backups should fail closed for an incorrect password"
);

const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` };
await assert.rejects(
  () => decryptBackup(tampered, password),
  /password is incorrect|damaged|invalid/i,
  "encrypted backup tampering should not produce plaintext"
);
await assert.rejects(
  () => encryptBackup(backup, "too-short"),
  /12|password/i,
  "weak backup passwords should be rejected before encryption"
);
await assert.rejects(
  () => decryptBackup({ ...encrypted, unexpected: true }, password),
  /supported/i,
  "encrypted backup envelopes should reject unknown fields"
);

console.log("backup crypto smoke ok");
