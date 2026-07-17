import { validateBackupEnvelope } from "./graph-core.js";

export const ENCRYPTED_BACKUP_FORMAT = "llm-field-notes/encrypted-backup@1";
export const MIN_BACKUP_PASSWORD_CHARS = 12;
export const MAX_BACKUP_PASSWORD_CHARS = 256;
export const BACKUP_KDF_ITERATIONS = 250000;
export const MAX_ENCRYPTED_BACKUP_BYTES = Math.ceil((50 * 1024 * 1024 + 16) * 4 / 3) + 64 * 1024;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MAX_CIPHERTEXT_BYTES = 50 * 1024 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const hasOnlyKeys = (value, allowed) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => allowed.includes(key));
};

const getCrypto = () => {
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject?.subtle || typeof cryptoObject.getRandomValues !== "function") {
    throw new Error("This browser does not provide the encryption required for protected backups.");
  }
  return cryptoObject;
};

const validatePassword = (password) => {
  if (typeof password !== "string"
    || password.length < MIN_BACKUP_PASSWORD_CHARS
    || password.length > MAX_BACKUP_PASSWORD_CHARS
    || /[\u0000-\u001f\u007f]/.test(password)) {
    throw new Error(`Backup passwords must be ${MIN_BACKUP_PASSWORD_CHARS}–${MAX_BACKUP_PASSWORD_CHARS} characters without control characters.`);
  }
  return password;
};

const toBase64 = (bytes) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
};

const fromBase64 = (value, label, maxBytes) => {
  if (typeof value !== "string"
    || !value
    || value.length > Math.ceil(maxBytes * 4 / 3) + 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (binary.length < 1 || binary.length > maxBytes) throw new Error(`${label} is invalid.`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const deriveKey = async (password, salt) => {
  const cryptoObject = getCrypto();
  const material = await cryptoObject.subtle.importKey(
    "raw",
    textEncoder.encode(validatePassword(password)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return cryptoObject.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: BACKUP_KDF_ITERATIONS,
      hash: "SHA-256"
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export const isEncryptedBackup = (value) => value?.format === ENCRYPTED_BACKUP_FORMAT;

export function validateEncryptedBackupEnvelope(envelope) {
  if (!hasOnlyKeys(envelope, ["format", "version", "cipher", "kdf", "iterations", "salt", "iv", "ciphertext"])
    || envelope.format !== ENCRYPTED_BACKUP_FORMAT
    || envelope.version !== 1
    || envelope.cipher !== "AES-GCM-256"
    || envelope.kdf !== "PBKDF2-SHA-256"
    || envelope.iterations !== BACKUP_KDF_ITERATIONS) {
    throw new Error("That encrypted backup format is not supported.");
  }
  const salt = fromBase64(envelope.salt, "Backup salt", SALT_BYTES);
  const iv = fromBase64(envelope.iv, "Backup nonce", IV_BYTES);
  const ciphertext = fromBase64(envelope.ciphertext, "Backup ciphertext", MAX_CIPHERTEXT_BYTES + 16);
  if (salt.byteLength !== SALT_BYTES || iv.byteLength !== IV_BYTES) {
    throw new Error("That encrypted backup has invalid encryption parameters.");
  }
  return { salt, iv, ciphertext };
}

export async function encryptBackup(backup, password) {
  validatePassword(password);
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    throw new TypeError("A backup object is required.");
  }
  validateBackupEnvelope(backup, { label: "Backup" });
  const cryptoObject = getCrypto();
  const salt = cryptoObject.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = cryptoObject.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const plaintext = textEncoder.encode(JSON.stringify(backup));
  if (plaintext.byteLength > MAX_CIPHERTEXT_BYTES) throw new Error("That backup is too large to encrypt safely.");
  const ciphertext = new Uint8Array(await cryptoObject.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: textEncoder.encode(ENCRYPTED_BACKUP_FORMAT)
    },
    key,
    plaintext
  ));
  return {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: 1,
    cipher: "AES-GCM-256",
    kdf: "PBKDF2-SHA-256",
    iterations: BACKUP_KDF_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext)
  };
}

export async function decryptBackup(envelope, password) {
  validatePassword(password);
  const { salt, iv, ciphertext } = validateEncryptedBackupEnvelope(envelope);
  const cryptoObject = getCrypto();
  const key = await deriveKey(password, salt);
  let plaintext;
  try {
    plaintext = await cryptoObject.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: textEncoder.encode(ENCRYPTED_BACKUP_FORMAT)
      },
      key,
      ciphertext
    );
  } catch {
    throw new Error("The backup password is incorrect or the encrypted backup is damaged.");
  }
  try {
    return JSON.parse(textDecoder.decode(plaintext));
  } catch {
    throw new Error("The decrypted backup is not valid JSON.");
  }
}
