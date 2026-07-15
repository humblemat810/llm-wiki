import { webcrypto } from "node:crypto";
import {
  BACKUP_FORMAT,
  GRAPH_SCHEMA,
  LEGACY_GRAPH_SCHEMAS,
  fingerprintBackup,
  normalizeGraph,
  parseJsonWithUniqueKeys,
  validateBackupEnvelope
} from "../graph-core.js";
import {
  ENCRYPTED_BACKUP_FORMAT,
  MAX_ENCRYPTED_BACKUP_BYTES,
  decryptBackup,
  validateEncryptedBackupEnvelope
} from "../backup-crypto.js";
import { validateProducerVersion } from "./graph-input.mjs";
import { readBoundedTextFile } from "./bounded-file.mjs";

globalThis.crypto ||= webcrypto;

const [inputPath, ...options] = process.argv.slice(2);
const usage = "Usage: node experiments/verify-backup.mjs <backup.json> [--password-stdin]";
const integrityCounts = (graph) => {
  const truncation = graph?.integrity?.truncated || {};
  const dropped = graph?.integrity?.dropped || {};
  const count = (values) => values.reduce((total, value) => total + (Number.isSafeInteger(value) && value > 0 ? value : 0), 0);
  return {
    truncatedItems: count([
      truncation.documents, truncation.nodes, truncation.edges, truncation.revisions,
      truncation.learningExamples, truncation.documentTitle, truncation.documentText,
      truncation.evidenceText, truncation.evidenceItems, truncation.sourceReferences, truncation.aliases
    ]),
    droppedItems: count([dropped.documents, dropped.nodes, dropped.edges, dropped.revisions, dropped.learningExamples])
  };
};

const readPasswordFromStdin = async () => {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > 1024) throw new Error("Backup password input is too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
};

const verifyBackup = (value, inputPath) => {
  validateBackupEnvelope(value, { label: "Backup input" });
  validateProducerVersion(value.appVersion, "Backup", inputPath);
  value.history.forEach((snapshot) => validateProducerVersion(snapshot.appVersion, "History graph", inputPath));
  if (!value.graph || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(value.graph.schema)) {
    throw new Error(`Backup graph must declare ${GRAPH_SCHEMA}: ${inputPath}`);
  }
  const normalized = normalizeGraph(value.graph);
  const history = value.history.map((snapshot) => normalizeGraph(snapshot));
  const integrity = [normalized, ...history]
    .map(integrityCounts)
    .reduce((total, current) => ({
      truncatedItems: total.truncatedItems + current.truncatedItems,
      droppedItems: total.droppedItems + current.droppedItems
    }), { truncatedItems: 0, droppedItems: 0 });
  const recomputedFingerprint = fingerprintBackup(value.graph, value.history);
  if (value.graphFingerprint && value.graphFingerprint !== recomputedFingerprint) {
    throw new Error("Backup graph fingerprint does not match its normalized graph and history.");
  }
  return {
    verified: true,
    encrypted: false,
    decrypted: true,
    format: BACKUP_FORMAT,
    graphSchema: normalized.schema,
    graphVersion: normalized.version,
    graphFingerprint: value.graphFingerprint || recomputedFingerprint,
    recomputedFingerprint,
    appVersion: value.appVersion || "unknown",
    documents: normalized.documents.length,
    concepts: normalized.nodes.length,
    relations: normalized.edges.length,
    history: history.length,
    complete: integrity.truncatedItems === 0 && integrity.droppedItems === 0,
    integrity
  };
};

if (process.argv.includes("--help")) {
  console.log(usage);
} else if (!inputPath || options.some((option) => option !== "--password-stdin")) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const value = parseJsonWithUniqueKeys(await readBoundedTextFile(inputPath, MAX_ENCRYPTED_BACKUP_BYTES, {
      label: "Backup input",
      tooLargeMessage: `Backup input exceeds ${Math.ceil(MAX_ENCRYPTED_BACKUP_BYTES / (1024 * 1024))} MB: ${inputPath}`
    }), "Backup input");
    if (value?.format === ENCRYPTED_BACKUP_FORMAT) {
      const { ciphertext } = validateEncryptedBackupEnvelope(value);
      if (!options.includes("--password-stdin")) {
        console.log(JSON.stringify({
          verified: true,
          encrypted: true,
          decrypted: false,
          format: ENCRYPTED_BACKUP_FORMAT,
          cipher: value.cipher,
          kdf: value.kdf,
          iterations: value.iterations,
          ciphertextBytes: ciphertext.byteLength
        }, null, 2));
      } else {
        const password = await readPasswordFromStdin();
        console.log(JSON.stringify(verifyBackup(await decryptBackup(value, password), inputPath), null, 2));
      }
    } else {
      console.log(JSON.stringify(verifyBackup(value, inputPath), null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Backup verification failed.");
    process.exitCode = 1;
  }
}
