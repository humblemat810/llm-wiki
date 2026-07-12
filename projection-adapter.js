import { normalizeGraph } from "./graph-core.js";

const STATUSES = new Set(["inferred", "accepted", "rejected"]);
const MAX_ZIP_FILES = 500;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

function parseValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.replace(/^["']|["']$/g, "");
  }
}

export function parseObsidianFeedback(markdown) {
  if (typeof markdown !== "string") return null;
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return null;
  const fields = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(":");
    if (separator < 1) return;
    fields[line.slice(0, separator).trim()] = parseValue(line.slice(separator + 1));
  });
  if (!["concept", "relation"].includes(fields.type) || typeof fields.id !== "string" || !fields.id.trim()) return null;
  const heading = markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  const aliases = Array.isArray(fields.aliases)
    ? fields.aliases.filter((alias) => typeof alias === "string").map((alias) => alias.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 20)
    : [];
  const label = fields.type === "concept"
    ? (heading || fields.label)
    : (typeof fields.label === "string" && fields.label.trim() ? fields.label.trim().slice(0, 120) : heading);
  return {
    type: fields.type,
    id: fields.id.trim(),
    label: typeof label === "string" ? label.trim().slice(0, 120) : undefined,
    aliases,
    status: STATUSES.has(fields.status) ? fields.status : null
  };
}

export function applyObsidianFeedback(value, feedbacks) {
  const graph = normalizeGraph(value);
  let changed = 0;
  for (const feedback of Array.isArray(feedbacks) ? feedbacks : []) {
    if (!feedback || !["concept", "relation"].includes(feedback.type)) continue;
    const collection = feedback.type === "concept" ? graph.nodes : graph.edges;
    const item = collection.find((candidate) => candidate.id === feedback.id);
    if (!item) continue;
    if (feedback.label && feedback.label !== item.label) {
      if (feedback.type === "concept") {
        item.aliases = [...new Set([...(item.aliases || []), item.label])].slice(0, 20);
        item.label = feedback.label;
        item.updatedAt = new Date().toISOString();
      } else {
        item.label = feedback.label;
      }
      changed += 1;
    }
    if (feedback.type === "concept" && feedback.aliases.length) {
      const aliases = [...new Set([...(item.aliases || []), ...feedback.aliases])].slice(0, 20);
      if (aliases.length !== (item.aliases || []).length || aliases.some((alias, index) => alias !== item.aliases[index])) {
        item.aliases = aliases;
        changed += 1;
      }
    }
    if (feedback.status && feedback.status !== item.status) {
      item.status = feedback.status;
      item.feedback += feedback.status === "rejected" ? -1 : 1;
      item.confidence = feedback.status === "accepted"
        ? Math.min(.99, item.confidence + .08)
        : feedback.status === "rejected"
          ? Math.max(.05, item.confidence - .12)
          : Math.max(.2, item.confidence);
      changed += 1;
    }
  }
  if (!changed) return { graph, changed: false, updates: 0 };
  graph.version += 1;
  graph.updatedAt = new Date().toISOString();
  graph.revisions.unshift({
    id: `rev-${graph.version}`,
    version: graph.version,
    timestamp: graph.updatedAt,
    reason: `Imported ${changed} Obsidian feedback update${changed === 1 ? "" : "s"}`,
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, 20);
  return { graph, changed: true, updates: changed };
}

function readU16(view, offset) {
  return view.getUint16(offset, true);
}

function readU32(view, offset) {
  return view.getUint32(offset, true);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function readStoredZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_ZIP_BYTES) throw new Error("The vault archive is larger than the 50 MB safety limit.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (readU32(view, offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("The selected ZIP archive has no readable directory.");
  const fileCount = readU16(view, endOffset + 10);
  const centralSize = readU32(view, endOffset + 12);
  const centralOffset = readU32(view, endOffset + 16);
  if (fileCount > MAX_ZIP_FILES || centralOffset + centralSize > bytes.length) {
    throw new Error("The vault archive has an invalid or oversized directory.");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files = [];
  let cursor = centralOffset;
  for (let index = 0; index < fileCount; index += 1) {
    if (cursor + 46 > bytes.length || readU32(view, cursor) !== 0x02014b50) throw new Error("The vault archive has a malformed directory entry.");
    const flags = readU16(view, cursor + 8);
    const method = readU16(view, cursor + 10);
    const compressedSize = readU32(view, cursor + 20);
    const uncompressedSize = readU32(view, cursor + 24);
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    const localOffset = readU32(view, cursor + 42);
    if (flags & 0x08 || method !== 0 || compressedSize !== uncompressedSize) {
      throw new Error("This vault uses an unsupported ZIP feature. Import the ZIP generated by LLM Field Notes.");
    }
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    const name = decoder.decode(bytes.slice(nameStart, nameEnd));
    if (!name || name.startsWith("/") || name.split("/").includes("..")) throw new Error("The vault archive contains an unsafe file path.");
    if (localOffset + 30 > bytes.length || readU32(view, localOffset) !== 0x04034b50) throw new Error("The vault archive has a malformed file entry.");
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + uncompressedSize;
    if (dataEnd > bytes.length) throw new Error("The vault archive contains truncated file data.");
    const content = bytes.slice(dataStart, dataEnd);
    if (crc32(content) !== readU32(view, cursor + 16)) throw new Error(`The vault file "${name}" failed its integrity check.`);
    files.push({ name, bytes: content, text: decoder.decode(content) });
    cursor = nameEnd + extraLength + commentLength;
  }
  return files;
}

export function parseObsidianVault(input) {
  const files = readStoredZip(input);
  const feedbacks = files
    .filter((file) => file.name.endsWith(".md"))
    .map((file) => parseObsidianFeedback(file.text))
    .filter(Boolean);
  return { files, feedbacks };
}
