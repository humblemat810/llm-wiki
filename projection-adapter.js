import { advanceGraphVersion, GRAPH_SCHEMA, matchesGraphFingerprint, MAX_GRAPH_DOCUMENTS, MAX_GRAPH_EDGES, MAX_GRAPH_NODES, MAX_GRAPH_REVISIONS, MAX_GRAPH_VERSION, MAX_ID_CHARS, MAX_RELATION_LABEL_CHARS, MAX_SOURCE_URI_CHARS, MAX_TIMESTAMP_CHARS, normalizeGraph, normalizeSourceUri, rememberLearningItem, SOURCE_QUALITIES, slugify, syncLearningRelationLabels, VAULT_FORMAT } from "./graph-core.js";
import { JSONLD_FORMAT, matchesJsonLdProjection } from "./jsonld-projection.js";

const STATUSES = new Set(["inferred", "accepted", "rejected"]);
const GRAPH_FINGERPRINT_PATTERN = /^fnv64-[0-9a-f]{16}-[0-9]+$/;
export const MAX_ZIP_FILES = MAX_GRAPH_DOCUMENTS + MAX_GRAPH_NODES + MAX_GRAPH_EDGES + 100;
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const MAX_VAULT_MANIFEST_CHARS = 64 * 1024;
export const MAX_FEEDBACK_NOTE_CHARS = 1 * 1024 * 1024;
const MAX_DIRECT_FEEDBACK_ITEMS = MAX_ZIP_FILES;

const boundedFeedbackText = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const fitsFeedbackText = (value, limit) => value === undefined || value === null
  || (typeof value === "string" && value.length <= limit);
const boundedFeedbackAliases = (value) => Array.isArray(value)
  ? value.slice(0, 20).filter((alias) => typeof alias === "string").map((alias) => alias.replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean)
  : [];
function normalizeFeedbackTimestamp(value, present) {
  if (!present) return { valid: true, value: null };
  if (value === "") return { valid: true, value: null };
  if (typeof value !== "string" || value.length > MAX_TIMESTAMP_CHARS || Number.isNaN(Date.parse(value))) {
    return { valid: false, value: null };
  }
  return { valid: true, value: new Date(Date.parse(value)).toISOString() };
}
function boundFeedbackMutation(value) {
  if (!value || typeof value !== "object" || !["concept", "relation", "source"].includes(value.type)) return null;
  if (!fitsFeedbackText(value.id, MAX_ID_CHARS)) return null;
  if (value.type === "source" && (
    !fitsFeedbackText(value.title, 200)
    || !fitsFeedbackText(value.uri, MAX_SOURCE_URI_CHARS)
    || !fitsFeedbackText(value.fingerprint, MAX_ID_CHARS)
  )) return null;
  if (value.type !== "source" && (
    !fitsFeedbackText(value.label, value.type === "relation" ? MAX_RELATION_LABEL_CHARS : 120)
    || (value.type === "relation" && (!fitsFeedbackText(value.source, MAX_ID_CHARS) || !fitsFeedbackText(value.target, MAX_ID_CHARS)))
  )) return null;
  if (value.aliases !== undefined && (
    !Array.isArray(value.aliases)
    || value.aliases.length > 20
    || value.aliases.some((alias) => typeof alias !== "string" || alias.replace(/\s+/g, " ").trim().length > 120)
  )) return null;
  const bounded = {
    type: value.type,
    id: boundedFeedbackText(value.id, MAX_ID_CHARS)
  };
  if (!bounded.id) return null;
  if (value.type === "source") {
    const hasUri = value.hasUri === true || (value.hasUri === undefined && Object.hasOwn(value, "uri"));
    const hasLastReviewedAt = value.hasLastReviewedAt === true || (value.hasLastReviewedAt === undefined && Object.hasOwn(value, "lastReviewedAt"));
    const reviewedAt = normalizeFeedbackTimestamp(value.lastReviewedAt, hasLastReviewedAt);
    if (!reviewedAt.valid) return null;
    const rawUri = value.uri;
    const normalizedUri = typeof rawUri === "string" && rawUri.trim() ? normalizeSourceUri(rawUri) : null;
    if (hasUri && rawUri !== undefined && rawUri !== null
      && (typeof rawUri !== "string" || (rawUri.trim() && !normalizedUri))) return null;
    return {
      ...bounded,
      title: boundedFeedbackText(value.title, 200),
      uri: normalizedUri,
      fingerprint: boundedFeedbackText(value.fingerprint, MAX_ID_CHARS) || undefined,
      quality: SOURCE_QUALITIES.has(value.quality) ? value.quality : null,
      lastReviewedAt: reviewedAt.value,
      hasUri,
      hasLastReviewedAt
    };
  }
  const hasLastReviewedAt = value.hasLastReviewedAt === true || (value.hasLastReviewedAt === undefined && Object.hasOwn(value, "lastReviewedAt"));
  const reviewedAt = normalizeFeedbackTimestamp(value.lastReviewedAt, hasLastReviewedAt);
  if (!reviewedAt.valid) return null;
  return {
    ...bounded,
    label: boundedFeedbackText(value.label, 120),
    ...(value.type === "relation" && Object.hasOwn(value, "source") ? { source: boundedFeedbackText(value.source, MAX_ID_CHARS) } : {}),
    ...(value.type === "relation" && Object.hasOwn(value, "target") ? { target: boundedFeedbackText(value.target, MAX_ID_CHARS) } : {}),
    aliases: boundedFeedbackAliases(value.aliases),
    status: STATUSES.has(value.status) ? value.status : null,
    lastReviewedAt: reviewedAt.value,
    hasLastReviewedAt
  };
}

function parseValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.replace(/^["']|["']$/g, "");
  }
}

export function looksLikeObsidianFeedback(markdown) {
  if (typeof markdown !== "string") return false;
  const frontmatter = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  return Boolean(frontmatter && /(?:^|\r?\n)type\s*:\s*(?:concept|relation|source)\s*(?:\r?\n|$)/.test(frontmatter[1]));
}

export function parseObsidianFeedback(markdown) {
  if (typeof markdown !== "string" || markdown.length > MAX_FEEDBACK_NOTE_CHARS) return null;
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return null;
  const fields = Object.create(null);
  let duplicateField = false;
  match[1].split(/\r?\n/).forEach((line) => {
    const separator = line.indexOf(":");
    if (separator < 1) return;
    const key = line.slice(0, separator).trim();
    if (Object.hasOwn(fields, key)) {
      duplicateField = true;
      return;
    }
    fields[key] = parseValue(line.slice(separator + 1));
  });
  if (duplicateField) return null;
  if (!["concept", "relation", "source"].includes(fields.type) || typeof fields.id !== "string" || !fields.id.trim() || fields.id.trim().length > MAX_ID_CHARS) return null;
  if (Object.hasOwn(fields, "status") && !STATUSES.has(fields.status)) return null;
  if (Object.hasOwn(fields, "aliases") && (
    !Array.isArray(fields.aliases)
    || fields.aliases.length > 20
    || fields.aliases.some((alias) => typeof alias !== "string" || alias.replace(/\s+/g, " ").trim().length > 120)
  )) return null;
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
  if (typeof heading === "string" && heading.length > 200) return null;
  const hasReviewDate = Object.hasOwn(fields, "last_reviewed");
  if (hasReviewDate && (
    typeof fields.last_reviewed !== "string"
    || (fields.last_reviewed.trim() && (fields.last_reviewed.length > MAX_TIMESTAMP_CHARS || Number.isNaN(Date.parse(fields.last_reviewed))))
  )) return null;
  if (fields.type === "source") {
    const hasUri = Object.hasOwn(fields, "uri");
    const hasQuality = Object.hasOwn(fields, "quality");
    const hasFingerprint = Object.hasOwn(fields, "fingerprint");
    if (hasUri && (
      typeof fields.uri !== "string"
      || fields.uri.length > MAX_SOURCE_URI_CHARS
      || (fields.uri.trim() && !normalizeSourceUri(fields.uri))
    )) return null;
    if (hasQuality && !SOURCE_QUALITIES.has(fields.quality)) return null;
    if (hasFingerprint && (typeof fields.fingerprint !== "string" || !fields.fingerprint.trim() || fields.fingerprint.length > MAX_ID_CHARS)) return null;
    return {
      ...projectionMetadata,
      type: "source",
      id: fields.id.trim(),
      fingerprint: hasFingerprint ? fields.fingerprint.trim() : undefined,
      hasUri,
      title: typeof heading === "string" && heading ? heading : undefined,
      uri: normalizeSourceUri(fields.uri),
      quality: SOURCE_QUALITIES.has(fields.quality) ? fields.quality : null,
      lastReviewedAt: typeof fields.last_reviewed === "string" && fields.last_reviewed.length <= MAX_TIMESTAMP_CHARS && !Number.isNaN(Date.parse(fields.last_reviewed)) ? new Date(Date.parse(fields.last_reviewed)).toISOString() : null,
      hasLastReviewedAt: Object.hasOwn(fields, "last_reviewed")
    };
  }
  if (Object.hasOwn(fields, "label") && typeof fields.label !== "string") return null;
  const hasRelationEndpoints = Object.hasOwn(fields, "source") || Object.hasOwn(fields, "target");
  if (fields.type === "relation" && hasRelationEndpoints
    && (typeof fields.source !== "string" || !fields.source.trim() || typeof fields.target !== "string" || !fields.target.trim())) return null;
  const aliases = Array.isArray(fields.aliases)
    ? fields.aliases.map((alias) => alias.replace(/\s+/g, " ").trim()).filter(Boolean)
    : [];
  const label = fields.type === "concept"
    ? (heading || fields.label)
    : (typeof fields.label === "string" && fields.label.trim() ? fields.label.trim() : heading);
  const labelLimit = fields.type === "concept" ? 120 : MAX_RELATION_LABEL_CHARS;
  if (typeof label === "string" && label.trim().length > labelLimit) return null;
  const parsedLastReviewedAt = typeof fields.last_reviewed === "string"
    && fields.last_reviewed.length <= MAX_TIMESTAMP_CHARS
    && !Number.isNaN(Date.parse(fields.last_reviewed))
    ? new Date(Date.parse(fields.last_reviewed)).toISOString()
    : null;
  return {
    ...projectionMetadata,
    type: fields.type,
    id: fields.id.trim(),
    label: typeof label === "string" ? label.trim() : undefined,
    ...(fields.type === "relation" && hasRelationEndpoints ? { source: fields.source.trim(), target: fields.target.trim() } : {}),
    aliases,
    status: STATUSES.has(fields.status) ? fields.status : null,
    lastReviewedAt: parsedLastReviewedAt,
    hasLastReviewedAt: Object.hasOwn(fields, "last_reviewed")
  };
}

function feedbackMutationFingerprint(feedback) {
  if (feedback.type === "source") {
    const hasUri = feedback.hasUri === true
      || (feedback.hasUri === undefined && Object.hasOwn(feedback, "uri"));
    return JSON.stringify({
      type: feedback.type,
      id: boundedFeedbackText(feedback.id, MAX_ID_CHARS),
      title: boundedFeedbackText(feedback.title, 200) || null,
      hasUri,
      uri: boundedFeedbackText(feedback.uri, MAX_ID_CHARS) || null,
      fingerprint: boundedFeedbackText(feedback.fingerprint, MAX_ID_CHARS) || null,
      quality: feedback.quality || null,
      lastReviewedAt: feedback.hasLastReviewedAt ? feedback.lastReviewedAt : null
    });
  }
  return JSON.stringify({
    type: feedback.type,
    id: boundedFeedbackText(feedback.id, MAX_ID_CHARS),
    label: boundedFeedbackText(feedback.label, 120) || null,
    source: boundedFeedbackText(feedback.source, MAX_ID_CHARS) || null,
    target: boundedFeedbackText(feedback.target, MAX_ID_CHARS) || null,
    aliases: boundedFeedbackAliases(feedback.aliases).sort(),
    status: feedback.status || null,
    lastReviewedAt: feedback.hasLastReviewedAt ? feedback.lastReviewedAt : null
  });
}

export function applyObsidianFeedback(value, feedbacks) {
  let graph = normalizeGraph(value);
  if (!Number.isSafeInteger(graph.version) || graph.version >= MAX_GRAPH_VERSION) {
    return { graph, changed: false, updates: 0, skipped: 0, conflicts: 0, limited: "version" };
  }
  const rawFeedbacks = Array.isArray(feedbacks) ? feedbacks : [];
  if (rawFeedbacks.length > MAX_DIRECT_FEEDBACK_ITEMS) {
    return { graph, changed: false, updates: 0, skipped: 0, conflicts: 0, limited: "feedback-items" };
  }
  let changed = 0;
  let memoryChanged = false;
  let skipped = 0;
  const groupedFeedback = new Map();
  for (const rawFeedback of rawFeedbacks) {
    const feedback = boundFeedbackMutation(rawFeedback);
    if (!feedback) continue;
    const key = `${feedback.type}|${feedback.id}`;
    const group = groupedFeedback.get(key) || { fingerprints: new Set(), feedback: null };
    group.fingerprints.add(feedbackMutationFingerprint(feedback));
    if (!group.feedback) group.feedback = feedback;
    groupedFeedback.set(key, group);
  }
  const conflicts = [...groupedFeedback.values()].filter((group) => group.fingerprints.size > 1).length;
  for (const group of groupedFeedback.values()) {
    if (group.fingerprints.size > 1) continue;
    const feedback = group.feedback;
    if (feedback.type === "source") {
      const source = graph.documents.find((candidate) => candidate.id === feedback.id);
      if (!source) continue;
      const hasUri = feedback.hasUri === true
        || (feedback.hasUri === undefined && Object.hasOwn(feedback, "uri"));
      if (feedback.fingerprint !== undefined && feedback.fingerprint !== source.fingerprint) {
        skipped += 1;
        continue;
      }
      if (feedback.title && feedback.title !== source.title) {
        source.title = feedback.title;
        changed += 1;
      }
      if (hasUri && feedback.uri !== source.uri) {
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
    if (feedback.type === "relation"
      && (feedback.source !== undefined || feedback.target !== undefined)
      && !(
        (feedback.source === item.source && feedback.target === item.target)
        || (feedback.source === item.target && feedback.target === item.source)
      )) {
      skipped += 1;
      continue;
    }
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
    const feedbackAliases = boundedFeedbackAliases(feedback.aliases);
    if (feedback.type === "concept" && feedbackAliases.length) {
      const aliases = [...new Set([...(item.aliases || []), ...feedbackAliases])].slice(0, 20);
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
  if (!changed && !memoryChanged) return { graph, changed: false, updates: 0, skipped, conflicts };
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
  return { graph: normalizeGraph(graph), changed: true, updates: updateCount, skipped, conflicts };
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
  const feedbackCandidates = files.filter((file) => /^(?:Concepts|Relations|Sources)\/[^/]+\.md$/i.test(file.name));
  const parsedFeedbacks = feedbackCandidates.map((file) => ({ file, feedback: parseObsidianFeedback(file.text) }));
  const feedbacks = parsedFeedbacks.filter((entry) => entry.feedback).map((entry) => entry.feedback);
  const invalidFeedbackFiles = parsedFeedbacks.filter((entry) => !entry.feedback).map((entry) => entry.file.name);
  const manifestFile = files.find((file) => file.name === "vault-manifest.json");
  let manifest = null;
  let manifestError = null;
  if (manifestFile) {
    if (manifestFile.text.length > MAX_VAULT_MANIFEST_CHARS) {
      manifestError = "Vault manifest metadata exceeds the safety limit.";
    } else {
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
  }
  const graphFile = files.find((file) => file.name === "graph.json");
  let embeddedGraph = null;
  let graphError = null;
  if (graphFile) {
    try {
      embeddedGraph = JSON.parse(graphFile.text);
      const validSchema = embeddedGraph
        && (embeddedGraph.schema === GRAPH_SCHEMA || embeddedGraph.schema === "llm-field-notes/graph@0");
      if (!validSchema) {
        graphError = "Embedded graph JSON declares an incompatible graph schema.";
      } else if (embeddedGraph.graphFingerprint !== undefined
        && (typeof embeddedGraph.graphFingerprint !== "string"
          || !GRAPH_FINGERPRINT_PATTERN.test(embeddedGraph.graphFingerprint)
          || !matchesGraphFingerprint(embeddedGraph, embeddedGraph.graphFingerprint))) {
        graphError = "Embedded graph JSON fingerprint does not match its contents.";
      } else if (manifest && (
        embeddedGraph.graphFingerprint !== manifest.graphFingerprint
        || embeddedGraph.version !== manifest.graphVersion
        || (embeddedGraph.redacted === true) !== manifest.redacted
        || embeddedGraph.schema !== manifest.graphSchema
      )) {
        graphError = "Embedded graph JSON metadata does not match its vault manifest.";
      }
    } catch {
      graphError = "Embedded graph JSON could not be parsed.";
    }
  }
  const jsonLdFile = files.find((file) => file.name === "graph.jsonld");
  let jsonLdError = null;
  if (jsonLdFile) {
    try {
      const projection = JSON.parse(jsonLdFile.text);
      if (!projection
        || projection.format !== JSONLD_FORMAT
        || projection.graphSchema !== GRAPH_SCHEMA
        || !Number.isSafeInteger(projection.graphVersion)
        || projection.graphVersion < 0
        || typeof projection.fingerprint !== "string"
        || !GRAPH_FINGERPRINT_PATTERN.test(projection.fingerprint)
        || typeof projection.redacted !== "boolean"
        || (manifest && (
          projection.fingerprint !== manifest.graphFingerprint
          || projection.graphVersion !== manifest.graphVersion
          || projection.redacted !== manifest.redacted
        ))) {
        jsonLdError = "Embedded JSON-LD metadata does not match its vault manifest.";
      } else if (embeddedGraph && !graphError && !matchesJsonLdProjection(embeddedGraph, projection)) {
        jsonLdError = "Embedded JSON-LD does not match the authoritative embedded graph JSON.";
      }
    } catch {
      jsonLdError = "Embedded JSON-LD could not be parsed.";
    }
  }
  const unverifiedFeedbackFiles = parsedFeedbacks
    .filter(({ feedback }) => feedback && (
      feedback.projectionMetadataError
      || !Number.isSafeInteger(feedback.graphVersion)
      || typeof feedback.graphFingerprint !== "string"
    ))
    .map(({ file }) => file.name);
  const staleFeedbackFiles = manifest
    ? parsedFeedbacks
      .filter(({ feedback }) => feedback
        && Number.isSafeInteger(feedback.graphVersion)
        && typeof feedback.graphFingerprint === "string"
        && (
          feedback.graphVersion !== manifest.graphVersion
          || feedback.graphFingerprint !== manifest.graphFingerprint
        ))
      .map(({ file }) => file.name)
    : [];
  return {
    files,
    feedbacks,
    feedbackFileCount: feedbackCandidates.length,
    invalidFeedbackFiles,
    unverifiedFeedbackFiles,
    staleFeedbackFiles,
    manifest,
    manifestError,
    graphError,
    jsonLdError
  };
}
