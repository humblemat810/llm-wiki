import { advanceGraphVersion, GRAPH_SCHEMA, MAX_GRAPH_DOCUMENTS, MAX_GRAPH_EDGES, MAX_GRAPH_NODES, MAX_GRAPH_REVISIONS, MAX_GRAPH_VERSION, MAX_ID_CHARS, MAX_RELATION_LABEL_CHARS, MAX_TIMESTAMP_CHARS, normalizeGraph, normalizeSourceUri, rememberLearningItem, SOURCE_QUALITIES, slugify, syncLearningRelationLabels, VAULT_FORMAT } from "./graph-core.js";

const STATUSES = new Set(["inferred", "accepted", "rejected"]);
const GRAPH_FINGERPRINT_PATTERN = /^fnv64-[0-9a-f]{16}-[0-9]+$/;
export const MAX_ZIP_FILES = MAX_GRAPH_DOCUMENTS + MAX_GRAPH_NODES + MAX_GRAPH_EDGES + 100;
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const MAX_FEEDBACK_NOTE_CHARS = 1 * 1024 * 1024;

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
  if (typeof markdown !== "string" || markdown.length > MAX_FEEDBACK_NOTE_CHARS) return null;
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return null;
  const fields = Object.create(null);
  match[1].split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(":");
    if (separator < 1) return;
    fields[line.slice(0, separator).trim()] = parseValue(line.slice(separator + 1));
  });
  if (!["concept", "relation", "source"].includes(fields.type) || typeof fields.id !== "string" || !fields.id.trim() || fields.id.trim().length > MAX_ID_CHARS) return null;
  const hasProjectionMetadata = Object.hasOwn(fields, "graph_version") || Object.hasOwn(fields, "graph_fingerprint");
  const projectionMetadataValid = !hasProjectionMetadata || (
    Number.isSafeInteger(fields.graph_version)
    && fields.graph_version >= 0
    && typeof fields.graph_fingerprint === "string"
    && fields.graph_fingerprint.length <= 128
    && GRAPH_FINGERPRINT_PATTERN.test(fields.graph_fingerprint)
  );
  const projectionMetadata = {
    graphVersion: hasProjectionMetadata && Number.isSafeInteger(fields.graph_version) && fields.graph_version >= 0 ? fields.graph_version : null,
    graphFingerprint: hasProjectionMetadata && typeof fields.graph_fingerprint === "string" && fields.graph_fingerprint.length <= 128 && GRAPH_FINGERPRINT_PATTERN.test(fields.graph_fingerprint) ? fields.graph_fingerprint : null,
    projectionMetadataError: projectionMetadataValid ? null : "Projection metadata is invalid."
  };
  const heading = markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (fields.type === "source") {
    return {
      ...projectionMetadata,
      type: "source",
      id: fields.id.trim(),
      title: typeof heading === "string" && heading ? heading.slice(0, 200) : undefined,
      uri: normalizeSourceUri(fields.uri),
      quality: SOURCE_QUALITIES.has(fields.quality) ? fields.quality : null,
      lastReviewedAt: typeof fields.last_reviewed === "string" && fields.last_reviewed.length <= MAX_TIMESTAMP_CHARS && !Number.isNaN(Date.parse(fields.last_reviewed)) ? new Date(Date.parse(fields.last_reviewed)).toISOString() : null,
      hasLastReviewedAt: Object.hasOwn(fields, "last_reviewed")
    };
  }
  const aliases = Array.isArray(fields.aliases)
    ? fields.aliases.filter((alias) => typeof alias === "string").map((alias) => alias.replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean).slice(0, 20)
    : [];
  const label = fields.type === "concept"
    ? (heading || fields.label)
    : (typeof fields.label === "string" && fields.label.trim() ? fields.label.trim().slice(0, MAX_RELATION_LABEL_CHARS) : heading?.slice(0, MAX_RELATION_LABEL_CHARS));
  const parsedLastReviewedAt = typeof fields.last_reviewed === "string"
    && fields.last_reviewed.length <= MAX_TIMESTAMP_CHARS
    && !Number.isNaN(Date.parse(fields.last_reviewed))
    ? new Date(Date.parse(fields.last_reviewed)).toISOString()
    : null;
  return {
    ...projectionMetadata,
    type: fields.type,
    id: fields.id.trim(),
    label: typeof label === "string" ? label.trim().slice(0, 120) : undefined,
    aliases,
    status: STATUSES.has(fields.status) ? fields.status : null,
    lastReviewedAt: parsedLastReviewedAt,
    hasLastReviewedAt: Object.hasOwn(fields, "last_reviewed")
  };
}

export function applyObsidianFeedback(value, feedbacks) {
  let graph = normalizeGraph(value);
  if (!Number.isSafeInteger(graph.version) || graph.version >= MAX_GRAPH_VERSION) {
    return { graph, changed: false, updates: 0, skipped: 0, limited: "version" };
  }
  let changed = 0;
  let memoryChanged = false;
  let skipped = 0;
  for (const feedback of Array.isArray(feedbacks) ? feedbacks : []) {
    if (!feedback || !["concept", "relation", "source"].includes(feedback.type)) continue;
    if (feedback.type === "source") {
      const source = graph.documents.find((candidate) => candidate.id === feedback.id);
      if (!source) continue;
      if (feedback.title && feedback.title !== source.title) {
        source.title = feedback.title;
        changed += 1;
      }
      if (feedback.uri !== source.uri) {
        source.uri = feedback.uri || null;
        changed += 1;
      }
      if (SOURCE_QUALITIES.has(feedback.quality) && feedback.quality !== source.quality) {
        source.quality = feedback.quality;
        changed += 1;
      }
      const normalizedReviewedAt = typeof feedback.lastReviewedAt === "string" && feedback.lastReviewedAt.length <= MAX_TIMESTAMP_CHARS && !Number.isNaN(Date.parse(feedback.lastReviewedAt))
        ? new Date(Date.parse(feedback.lastReviewedAt)).toISOString()
        : null;
      if (feedback.hasLastReviewedAt && normalizedReviewedAt !== source.lastReviewedAt) {
        source.lastReviewedAt = normalizedReviewedAt;
        changed += 1;
      }
      continue;
    }
    const collection = feedback.type === "concept" ? graph.nodes : graph.edges;
    const item = collection.find((candidate) => candidate.id === feedback.id);
    if (!item) continue;
    const originalStatus = item.status;
    let humanCorrection = false;
    if (feedback.label && feedback.label !== item.label) {
      const labelKey = slugify(feedback.label);
      const collision = feedback.type === "concept"
        && collection.some((candidate) => candidate !== item
          && [candidate.label, ...(candidate.aliases || [])].some((label) => slugify(label) === labelKey));
      if (collision) {
        skipped += 1;
      } else if (feedback.type === "concept") {
        item.aliases = [...new Set([...(item.aliases || []), item.label])].slice(0, 20);
        item.label = feedback.label;
        item.updatedAt = new Date().toISOString();
      } else {
        item.label = feedback.label.slice(0, MAX_RELATION_LABEL_CHARS);
      }
      if (!collision) {
        changed += 1;
        humanCorrection = true;
      }
    }
    if (feedback.type === "concept" && feedback.aliases.length) {
      const aliases = [...new Set([...(item.aliases || []), ...feedback.aliases])].slice(0, 20);
      if (aliases.length !== (item.aliases || []).length || aliases.some((alias, index) => alias !== item.aliases[index])) {
        item.aliases = aliases;
        changed += 1;
        humanCorrection = true;
      }
    }
    if (feedback.hasLastReviewedAt && feedback.lastReviewedAt !== item.lastReviewedAt) {
      item.lastReviewedAt = feedback.lastReviewedAt;
      changed += 1;
    }
    if (feedback.status && feedback.status !== originalStatus) {
      item.status = feedback.status;
      item.feedback += feedback.status === "rejected" ? -1 : 1;
      item.confidence = feedback.status === "accepted"
        ? Math.min(.99, item.confidence + .08)
        : feedback.status === "rejected"
          ? Math.max(.05, item.confidence - .12)
          : Math.max(.2, item.confidence);
      changed += 1;
    } else if (humanCorrection && item.status !== "accepted" && (!feedback.status || feedback.status === originalStatus)) {
      item.status = "accepted";
      item.feedback += 1;
      item.confidence = Math.min(.99, item.confidence + .08);
      changed += 1;
    }
    if ((humanCorrection || (feedback.status && feedback.status !== originalStatus)) && !feedback.hasLastReviewedAt) {
      item.lastReviewedAt = new Date().toISOString();
    }
    const learningBefore = JSON.stringify(graph.learning.examples);
    rememberLearningItem(graph, feedback.type === "concept" ? "node" : "edge", item);
    if (learningBefore !== JSON.stringify(graph.learning.examples)) memoryChanged = true;
  }
  const synchronized = syncLearningRelationLabels(graph);
  graph = synchronized.graph;
  if (synchronized.changed) memoryChanged = true;
  if (!changed && !memoryChanged) return { graph, changed: false, updates: 0, skipped };
  const updateCount = changed || (memoryChanged ? 1 : 0);
  advanceGraphVersion(graph);
  graph.updatedAt = new Date().toISOString();
  graph.revisions.unshift({
    id: `rev-${graph.version}`,
    version: graph.version,
    timestamp: graph.updatedAt,
    reason: `${changed ? `Imported ${changed} Obsidian feedback update${changed === 1 ? "" : "s"}` : "Repaired reusable learning memory from Obsidian feedback"}`,
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  return { graph: normalizeGraph(graph), changed: true, updates: updateCount, skipped };
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

export function readStoredZip(input, { maxUncompressedBytes = MAX_ZIP_BYTES } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_ZIP_BYTES) throw new Error("The vault archive is larger than the 50 MB safety limit.");
  const uncompressedLimit = Number.isFinite(Number(maxUncompressedBytes)) && Number(maxUncompressedBytes) >= 0
    ? Math.min(MAX_ZIP_BYTES, Math.floor(Number(maxUncompressedBytes)))
    : MAX_ZIP_BYTES;
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
  if (fileCount > MAX_ZIP_FILES || centralOffset > bytes.length || centralSize > bytes.length - centralOffset) {
    throw new Error("The vault archive has an invalid or oversized directory.");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files = [];
  const names = new Set();
  let totalUncompressedBytes = 0;
  const centralEnd = centralOffset + centralSize;
  let cursor = centralOffset;
  for (let index = 0; index < fileCount; index += 1) {
    if (cursor > centralEnd || centralEnd - cursor < 46 || readU32(view, cursor) !== 0x02014b50) throw new Error("The vault archive has a malformed directory entry.");
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
    if (nameEnd > centralEnd || extraLength > centralEnd - nameEnd || commentLength > centralEnd - nameEnd - extraLength) {
      throw new Error("The vault archive has a malformed directory entry.");
    }
    const name = decoder.decode(bytes.slice(nameStart, nameEnd));
    if (!name || /[\u0000-\u001f\u007f]/.test(name) || names.has(name) || name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === ".." || part === ".")) throw new Error("The vault archive contains an unsafe or duplicate file path.");
    names.add(name);
    if (localOffset + 30 > bytes.length || readU32(view, localOffset) !== 0x04034b50) throw new Error("The vault archive has a malformed file entry.");
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    if (localNameEnd > bytes.length || localNameLength !== nameLength || decoder.decode(bytes.slice(localNameStart, localNameEnd)) !== name) {
      throw new Error("The vault archive has mismatched central and local filenames.");
    }
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart > bytes.length || uncompressedSize > bytes.length - dataStart) throw new Error("The vault archive contains truncated file data.");
    if (dataStart > centralOffset || uncompressedSize > centralOffset - dataStart) throw new Error("The vault archive contains file data overlapping its central directory.");
    if (uncompressedSize > uncompressedLimit - totalUncompressedBytes) throw new Error("The vault archive contains too much uncompressed data.");
    const dataEnd = dataStart + uncompressedSize;
    const content = bytes.slice(dataStart, dataEnd);
    if (crc32(content) !== readU32(view, cursor + 16)) throw new Error(`The vault file "${name}" failed its integrity check.`);
    totalUncompressedBytes += uncompressedSize;
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
  const manifestFile = files.find((file) => file.name === "vault-manifest.json");
  let manifest = null;
  let manifestError = null;
  if (manifestFile) {
    try {
      const candidate = JSON.parse(manifestFile.text);
      const valid = candidate
        && candidate.format === VAULT_FORMAT
        && candidate.graphSchema === GRAPH_SCHEMA
        && Number.isSafeInteger(candidate.graphVersion)
        && candidate.graphVersion >= 0
        && typeof candidate.graphFingerprint === "string"
        && candidate.graphFingerprint.length <= 128
        && /^fnv64-[0-9a-f]{16}-[0-9]+$/.test(candidate.graphFingerprint)
        && typeof candidate.redacted === "boolean"
        && typeof candidate.generatedAt === "string"
        && candidate.generatedAt.length <= MAX_TIMESTAMP_CHARS
        && !Number.isNaN(Date.parse(candidate.generatedAt));
      if (valid) manifest = candidate;
      else manifestError = "Vault manifest metadata is invalid.";
    } catch {
      manifestError = "Vault manifest JSON could not be parsed.";
    }
  }
  return { files, feedbacks, manifest, manifestError };
}
