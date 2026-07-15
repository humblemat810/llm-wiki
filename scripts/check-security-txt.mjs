import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = new URL("../.well-known/security.txt", import.meta.url);
const content = await readFile(path, "utf8");
const fields = new Map();
const allowedFields = new Set(["Contact", "Policy", "Preferred-Languages", "Canonical", "Expires"]);

for (const rawLine of content.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf(":");
  assert(separator > 0, "security.txt contains a malformed field.");
  const name = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  assert(allowedFields.has(name), `security.txt contains an unsupported field: ${name}`);
  assert(value, `security.txt field is empty: ${name}`);
  if (name !== "Contact" && fields.has(name)) throw new Error(`security.txt contains a duplicate field: ${name}`);
  fields.set(name, name === "Contact" ? [...(fields.get(name) || []), value] : value);
}

const parseHttpsUrl = (value, label) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  assert.equal(parsed.protocol, "https:", `${label} must use HTTPS.`);
  assert(!parsed.username && !parsed.password, `${label} must not contain credentials.`);
  return parsed;
};

const contacts = fields.get("Contact") || [];
assert(contacts.length > 0, "security.txt must publish at least one Contact.");
contacts.forEach((contact) => parseHttpsUrl(contact, "Contact"));
parseHttpsUrl(fields.get("Policy"), "Policy");
parseHttpsUrl(fields.get("Canonical"), "Canonical");

const expires = fields.get("Expires");
const expiresAt = Date.parse(expires);
assert(Number.isFinite(expiresAt), "security.txt Expires must be a valid RFC 3339 timestamp.");
assert(expires.endsWith("Z"), "security.txt Expires must use UTC.");
assert(expiresAt > Date.now() + 30 * 24 * 60 * 60 * 1000, "security.txt Expires must remain more than 30 days in the future.");

console.log(`security.txt check ok: expires ${expires}`);
