export const GRAPH_SCHEMA = "llm-field-notes/graph@1";
export const FEEDBACK_FORMAT = "llm-field-notes/feedback@1";
export const BACKUP_FORMAT = "llm-field-notes/backup@1";
export const DIFF_FORMAT = "llm-field-notes/diff@1";
export const HEALTH_FORMAT = "llm-field-notes/health@1";
export const VAULT_FORMAT = "llm-field-notes/vault@1";
export const LEGACY_GRAPH_SCHEMAS = new Set(["llm-field-notes/graph@0"]);
export const MAX_DOCUMENT_CHARS = 300000;
export const MAX_DOCUMENT_TITLE_CHARS = 200;
export const MAX_GRAPH_DOCUMENT_CHARS = 50000000;
export const MAX_GRAPH_DOCUMENTS = 1000;
export const MAX_GRAPH_NODES = 5000;
export const MAX_GRAPH_EDGES = 10000;
export const MAX_GRAPH_REVISIONS = 20;
export const MAX_BACKUP_HISTORY = 3;
export const REVISION_OPERATIONS = new Set(["unknown", "migration", "ingest", "rebuild", "feedback", "learning", "manual", "projection", "source-removal"]);
export const REVISION_EXTRACTORS = new Set(["unknown", "local", "remote"]);
export const MAX_EVIDENCE_CHARS = 12000;
export const MAX_ALIASES = 20;
export const MAX_EVIDENCE_INPUT_ITEMS = 32;
export const MAX_EVIDENCE_RECORDS = 8;
export const MAX_EVIDENCE_GROUNDING_RECORDS = 2000;
export const MAX_EVIDENCE_GROUNDING_COMPARISONS = 250000;
export const MAX_EVIDENCE_GROUNDING_SOURCE_SCAN_CHARS = 50000000;
export const MAX_SOURCE_REFERENCES = 200;
export const MAX_SOURCE_REFERENCE_DIAGNOSTICS =
  (MAX_GRAPH_NODES + MAX_GRAPH_EDGES) * MAX_SOURCE_REFERENCES * (MAX_EVIDENCE_RECORDS + 1);
export const MAX_ACTIVE_FEEDBACK_CONCEPTS = 100;
export const MAX_FEEDBACK_EXAMPLES = 500;
export const MAX_FEEDBACK_FINGERPRINT_EXAMPLES = 15000;
export const MAX_FEEDBACK_EXPORT_OMITTED = MAX_FEEDBACK_EXAMPLES + MAX_GRAPH_NODES + MAX_GRAPH_EDGES;
export const MAX_REVIEW_QUEUE_ITEMS = 15000;
export const REVIEW_STALE_DAYS = 180;
export const MAX_AMBIGUOUS_SOURCE_IDS = 100;
export const MAX_AMBIGUOUS_EDGE_IDS = 100;
export const MAX_CONFLICTING_ITEM_IDS = 100;
export const MAX_ID_CHARS = 200;
export const MAX_CONCEPT_LABEL_CHARS = 120;
export const MAX_FEEDBACK_LABEL_CHARS = MAX_CONCEPT_LABEL_CHARS;
export const MAX_NODE_MENTIONS = 1000000;
export const MAX_FEEDBACK_COUNT = 1000000;
export const MAX_GRAPH_VERSION = Number.MAX_SAFE_INTEGER;
export const MAX_EXTRACTION_UNITS = 10000;
export const MAX_WORDS_PER_UNIT = 5000;
export const MAX_SEGMENTER_CHARS = 20000;
export const MAX_PHRASE_CANDIDATES_PER_UNIT = 40;
export const MAX_EXTRACTION_CANDIDATES = 20000;
export const MAX_EXTRACTION_TERM_CANDIDATES = 18000;
export const MAX_RELATION_LABEL_CHARS = 80;
export const MAX_TIMESTAMP_CHARS = 128;
export const MAX_SOURCE_URI_CHARS = 2048;
export const MAX_PRODUCER_VERSION_CHARS = 64;
export const MAX_JSON_DEPTH = 128;
export const MAX_JSON_KEY_DIAGNOSTIC_CHARS = 120;
export const SOURCE_QUALITIES = new Set(["unknown", "primary", "secondary", "tertiary"]);
export const DEFAULT_GRAPH_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const isStaleLearningExample = (example, now = Date.now()) => {
  if (!example.lastReviewedAt) return true;
  const timestamp = parseTimestamp(example.lastReviewedAt);
  return Number.isNaN(timestamp) || timestamp > now || now - timestamp >= REVIEW_STALE_DAYS * 86400000;
};
const isStaleGuidanceItem = (item, now = Date.now()) => isStaleLearningExample(item, now);
const includeGuidanceItem = (item, includeStale, now = Date.now()) => includeStale || !isStaleGuidanceItem(item, now);

export function advanceGraphVersion(graph) {
  if (!graph || !Number.isSafeInteger(graph.version) || graph.version >= MAX_GRAPH_VERSION) return false;
  graph.version += 1;
  return true;
}

export function compareGraphFreshness(candidateValue, referenceValue) {
  const candidate = normalizeGraph(candidateValue);
  const reference = normalizeGraph(referenceValue);
  const candidateTime = trustedPastTimestamp(candidate.committedAt);
  const referenceTime = trustedPastTimestamp(reference.committedAt);
  if (candidate.version !== reference.version
    && Number.isFinite(candidateTime)
    && Number.isFinite(referenceTime)
    && candidateTime !== referenceTime) {
    // Undo and restore intentionally move back to an older graph version,
    // but their storage commit is newer. A delayed event from the version
    // that was undone must not overwrite that explicit rollback.
    if (candidateTime > referenceTime && candidate.version < reference.version) return 1;
    if (candidateTime < referenceTime && candidate.version > reference.version) return -1;
    return candidate.version < reference.version ? -1 : 1;
  }
  if (candidate.version !== reference.version) return candidate.version < reference.version ? -1 : 1;
  const candidateUpdatedTime = trustedPastTimestamp(candidate.updatedAt);
  const referenceUpdatedTime = trustedPastTimestamp(reference.updatedAt);
  if (Number.isFinite(candidateUpdatedTime) && Number.isFinite(referenceUpdatedTime) && candidateUpdatedTime !== referenceUpdatedTime) {
    return candidateUpdatedTime < referenceUpdatedTime ? -1 : 1;
  }
  if (Number.isFinite(candidateUpdatedTime) !== Number.isFinite(referenceUpdatedTime)) {
    return Number.isFinite(candidateUpdatedTime) ? 1 : -1;
  }
  return 0;
}

const canAdvanceGraphVersion = (graph) => Number.isSafeInteger(graph?.version) && graph.version < MAX_GRAPH_VERSION;

export const sampleDocument = {
  title: "Attention Is All You Need — working notes",
  text: `The Transformer is a model architecture based entirely on attention mechanisms.
Self-attention allows each token to gather information from other tokens in the sequence.
Queries, keys, and values create a weighted lookup over the context.
Multi-head attention lets the model learn different relationships at the same time.
Positional encoding gives the sequence an order because attention itself is permutation invariant.
The architecture removes recurrence and convolution, which makes training more parallelizable.
The model learns through gradient descent on a prediction loss.`
};

const stopWords = new Set("a an and are as at be because been being based before between by can could catch catches caught cause causes caused create creates depends different during entirely each for from gather gathers gives has have here how if improve improves improved increases in into is it its itself lead leads learn learns lets make makes may means measure measures more need needs needed of on or other our over prevent prevents preserve preserves preserved reduce reduces report reports reported represent represents represented require requires result results same show shows showing support supports than that the their them these this then there through to trigger triggers use uses using until was what when which while with without within you your allow allows after become becomes became control controls controlled guide guides guided map maps mapped reveal reveals revealed remain remains augments combines converts decodes enriches encodes feeds filters generates limits maps mapped mitigate mitigates implies orders predicts produces ranks represents retrieves selects stores transforms augmented combined converted decoded enriched encoded fed filtered generated limited mitigated implied ordered prevented produced ranked represented resulted retrieved selected stored transformed triggered".split(" "));
const phraseBoundaryWords = new Set(["also", "connects"]);
const phraseNoiseWords = new Set([
  ...stopWords,
  "across",
  "among",
  "around",
  "connects",
  "creates",
  "gives",
  "mixes",
  "through",
  "toward",
  "using",
  "add",
  "adds",
  "carry",
  "carries",
  "combine",
  "combines",
  "connect",
  "link",
  "links",
  "keep",
  "keeps",
  "produce",
  "produces",
  "provide",
  "provides",
  "retrieve",
  "retrieves",
  "balances",
  "blocks",
  "orders",
  "queries",
  "reviews",
  "review",
  "every",
  "stores"
]);

export const defaultGraph = () => ({
  schema: GRAPH_SCHEMA,
  version: 0,
  updatedAt: null,
  documents: [],
  nodes: [],
  edges: [],
  revisions: [],
  learning: { examples: [] },
  integrity: { ambiguousSourceIds: [], ambiguousEdgeIds: [] }
});

let fallbackIdSequence = 0;
export const makeId = (prefix) => {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }
  } catch {
    // Restricted runtimes may expose crypto but reject access at call time.
  }
  try {
    if (typeof globalThis.crypto?.getRandomValues === "function") {
      const random = new Uint32Array(4);
      globalThis.crypto.getRandomValues(random);
      return `${prefix}-${[...random].map((value) => value.toString(16).padStart(8, "0")).join("")}`;
    }
  } catch {
    // Use the collision-resistant process-local fallback below.
  }
  fallbackIdSequence = (fallbackIdSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}`;
};

export const asArray = (value) => Array.isArray(value) ? value : [];
export function parseJsonWithUniqueKeys(text, label = "JSON") {
  if (typeof text !== "string") throw new TypeError(`${label} must be a string.`);
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(text[index] || "")) index += 1;
  };
  const parseString = () => {
    const start = index;
    if (text[index] !== '"') throw new Error(`${label} contains malformed JSON at offset ${index}.`);
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        const raw = text.slice(start, index + 1);
        index += 1;
        return JSON.parse(raw);
      }
      index += 1;
    }
    throw new Error(`${label} contains an unterminated JSON string.`);
  };
  const parseValue = (depth = 0) => {
    skipWhitespace();
    if (depth > MAX_JSON_DEPTH) throw new Error(`${label} exceeds the ${MAX_JSON_DEPTH}-level nesting limit.`);
    if (text[index] === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      while (index < text.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) {
          const diagnosticKey = key.length > MAX_JSON_KEY_DIAGNOSTIC_CHARS
            ? `${key.slice(0, MAX_JSON_KEY_DIAGNOSTIC_CHARS)}…`
            : key;
          throw new Error(`${label} contains duplicate object key "${diagnosticKey}".`);
        }
        keys.add(key);
        skipWhitespace();
        if (text[index++] !== ":") throw new Error(`${label} contains malformed JSON at offset ${index}.`);
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        if (text[index++] !== ",") throw new Error(`${label} contains malformed JSON at offset ${index}.`);
      }
      throw new Error(`${label} contains an unterminated JSON object.`);
    }
    if (text[index] === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      while (index < text.length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        if (text[index++] !== ",") throw new Error(`${label} contains malformed JSON at offset ${index}.`);
      }
      throw new Error(`${label} contains an unterminated JSON array.`);
    }
    if (text[index] === '"') {
      parseString();
      return;
    }
    const start = index;
    while (index < text.length && !/[,\]}]/.test(text[index])) index += 1;
    if (!text.slice(start, index).trim()) throw new Error(`${label} contains malformed JSON at offset ${index}.`);
  };
  parseValue();
  skipWhitespace();
  if (index !== text.length) throw new Error(`${label} contains trailing data.`);
  return JSON.parse(text);
}
const asBoundedArray = (value, limit) => Array.isArray(value) ? value.slice(0, limit) : [];
export const sliceTextAtCodePointBoundary = (value, limit) => {
  const bounded = String(value).slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
  const lastCodeUnit = bounded.charCodeAt(bounded.length - 1);
  return lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF
    ? bounded.slice(0, -1)
    : bounded;
};
export const parseTimestamp = (value) => {
  if (typeof value !== "string" || value.length > MAX_TIMESTAMP_CHARS || !value.trim()) return Number.NaN;
  const datePrefix = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (datePrefix) {
    const year = Number(datePrefix[1]);
    const month = Number(datePrefix[2]);
    const day = Number(datePrefix[3]);
    const calendarDate = new Date(0);
    calendarDate.setUTCFullYear(year, month - 1, day);
    calendarDate.setUTCHours(0, 0, 0, 0);
    if (calendarDate.getUTCFullYear() !== year
      || calendarDate.getUTCMonth() !== month - 1
      || calendarDate.getUTCDate() !== day) {
      return Number.NaN;
    }
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NaN : timestamp;
};
export const slugify = (value) => sliceTextAtCodePointBoundary(
  String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[`'"“”()[\]{}]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, ""),
  70
);
const asText = (value, fallback = "") => typeof value === "string" ? value : fallback;
const asLine = (value, fallback = "") => asText(value, fallback).replace(/\s+/g, " ").trim();
const lexicalCompare = (left, right) => {
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
};
const boundedDocumentTimestamp = (value) => typeof value === "string" && value.length <= MAX_TIMESTAMP_CHARS ? value : "";
const documentRetentionKey = (document) => [
  sliceTextAtCodePointBoundary(asText(document?.id), MAX_ID_CHARS),
  sliceTextAtCodePointBoundary(asText(document?.fingerprint), MAX_ID_CHARS),
  sliceTextAtCodePointBoundary(asText(document?.title), MAX_DOCUMENT_TITLE_CHARS),
  fingerprintText(sliceTextAtCodePointBoundary(asText(document?.text), MAX_DOCUMENT_CHARS))
].join("\u0000");
const makeDocumentRetentionCandidate = (document, index) => ({
  document,
  index,
  time: trustedPastTimestamp(boundedDocumentTimestamp(document?.addedAt)),
  key: documentRetentionKey(document)
});
const compareDocumentRetention = (left, right) => {
  const leftTime = left.time;
  const rightTime = right.time;
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(leftTime) ? 1 : -1;
  if (Number.isFinite(leftTime) && leftTime !== rightTime) return leftTime - rightTime;
  return lexicalCompare(left.key, right.key) || left.index - right.index;
};
const retainNewestDocuments = (documents) => {
  if (!Array.isArray(documents)) return [];
  const heap = [];
  const swap = (left, right) => {
    const temporary = heap[left];
    heap[left] = heap[right];
    heap[right] = temporary;
  };
  const siftUp = (index) => {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (compareDocumentRetention(heap[parent], heap[current]) <= 0) break;
      swap(parent, current);
      current = parent;
    }
  };
  const siftDown = (index) => {
    let current = index;
    while (true) {
      const left = current * 2 + 1;
      const right = left + 1;
      let smallest = current;
      if (left < heap.length && compareDocumentRetention(heap[left], heap[smallest]) < 0) smallest = left;
      if (right < heap.length && compareDocumentRetention(heap[right], heap[smallest]) < 0) smallest = right;
      if (smallest === current) return;
      swap(current, smallest);
      current = smallest;
    }
  };
  documents.forEach((document, index) => {
    const candidate = makeDocumentRetentionCandidate(document, index);
    if (heap.length < MAX_GRAPH_DOCUMENTS) {
      heap.push(candidate);
      siftUp(heap.length - 1);
      return;
    }
    if (compareDocumentRetention(heap[0], candidate) >= 0) return;
    heap[0] = candidate;
    siftDown(0);
  });
  return heap.sort((left, right) => left.index - right.index).map(({ document }) => document);
};
const identityDigest = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};
const relationLabelKey = (value) => String(value)
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[`'"“”()[\]{}]/g, "")
  .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
  .replace(/^-|-$/g, "");
const canonicalLabelKey = relationLabelKey;
const stableLabelId = (value) => {
  const key = canonicalLabelKey(value);
  const base = slugify(value);
  return key.length > 70 ? `${sliceTextAtCodePointBoundary(base, 61)}-${identityDigest(key)}` : base;
};
const edgeKey = (source, target, label) => JSON.stringify([
  String(source),
  String(target),
  relationLabelKey(label)
]);
export const relationSemanticKey = (source, target, label) => {
  const forward = edgeKey(source, target, label);
  const reverse = edgeKey(target, source, label);
  return forward < reverse ? forward : reverse;
};
const normalizeId = (value, fallback = "") => {
  const text = asText(value, fallback).trim();
  if (text.length <= MAX_ID_CHARS) return text;
  const suffix = `-${identityDigest(text)}`;
  return `${sliceTextAtCodePointBoundary(text, MAX_ID_CHARS - suffix.length)}${suffix}`;
};
export const makeEdgeId = (source, target, label) => {
  const labelKey = relationLabelKey(label);
  const longLabelSuffix = labelKey.length > 70
    ? `-${identityDigest(`${source}|${target}|${labelKey}`)}`
    : "";
  return normalizeId(`${source}--${target}--${slugify(label)}${longLabelSuffix}`) || "edge";
};
const appendIdSuffix = (base, suffix) => {
  const suffixText = `-${suffix}`;
  return `${sliceTextAtCodePointBoundary(base, Math.max(1, MAX_ID_CHARS - suffixText.length))}${suffixText}`;
};
const asConfidence = (value, fallback = .5) => Number.isFinite(Number(value)) ? Math.max(.01, Math.min(.99, Number(value))) : fallback;
const asBoundedCounter = (value, fallback, minimum, maximum) => Number.isSafeInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
const asTruncationCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const asDroppedCount = asTruncationCount;
const asDateTime = (value, fallback = null) => {
  if (typeof value !== "string" || value.length > MAX_TIMESTAMP_CHARS || !value.trim()) return fallback;
  const timestamp = parseTimestamp(value);
  return Number.isNaN(timestamp) ? fallback : new Date(timestamp).toISOString();
};
const newestTimestamp = (current, incoming) => incoming && (!current || parseTimestamp(incoming) > parseTimestamp(current)) ? incoming : current;
const oldestTimestamp = (current, incoming) => incoming && (!current || parseTimestamp(incoming) < parseTimestamp(current)) ? incoming : current;
const normalizeAliases = (value) => [...new Set(asBoundedArray(value, MAX_ALIASES).filter((item) => typeof item === "string").map((item) => sliceTextAtCodePointBoundary(asLine(item), MAX_CONCEPT_LABEL_CHARS)).filter(Boolean))]
  .sort(lexicalCompare)
  .slice(0, MAX_ALIASES);
const SAFE_SOURCE_URI_SCHEMES = new Set(["http", "https", "file", "urn", "doi"]);
export const normalizeSourceUri = (value) => {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!clean) return null;
  if (clean.length > MAX_SOURCE_URI_CHARS) return null;
  if (/[\s<>]/.test(clean)) return null;
  const scheme = clean.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && !SAFE_SOURCE_URI_SCHEMES.has(scheme)) return null;
  if (scheme === "http" || scheme === "https" || scheme === "file") {
    if (!new RegExp(`^${scheme}://`, "i").test(clean)) return null;
    try {
      const parsed = new URL(clean);
      if ((scheme === "http" || scheme === "https") && !parsed.hostname) return null;
      if (parsed.username || parsed.password) return null;
    } catch {
      return null;
    }
  }
  return clean;
};

function canonicalFeedbackExamples(value) {
  return asBoundedArray(value, MAX_FEEDBACK_FINGERPRINT_EXAMPLES)
    .filter((example) => example && typeof example === "object" && (example.kind === "concept" || example.kind === "relation") && ["accepted", "rejected"].includes(example.status))
    .map((example) => example.kind === "concept"
      ? {
        kind: "concept",
        id: sliceTextAtCodePointBoundary(asText(example.id), MAX_ID_CHARS),
        label: sliceTextAtCodePointBoundary(asText(example.label), MAX_CONCEPT_LABEL_CHARS),
        aliases: asBoundedArray(example.aliases, MAX_ALIASES).filter((alias) => typeof alias === "string").map((alias) => sliceTextAtCodePointBoundary(alias.trim(), MAX_CONCEPT_LABEL_CHARS)).sort(),
        status: example.status
      }
      : {
        kind: "relation",
        id: sliceTextAtCodePointBoundary(asText(example.id), MAX_ID_CHARS),
        source: sliceTextAtCodePointBoundary(asText(example.source), MAX_ID_CHARS),
        sourceLabel: sliceTextAtCodePointBoundary(asText(example.sourceLabel), MAX_CONCEPT_LABEL_CHARS),
        target: sliceTextAtCodePointBoundary(asText(example.target), MAX_ID_CHARS),
        targetLabel: sliceTextAtCodePointBoundary(asText(example.targetLabel), MAX_CONCEPT_LABEL_CHARS),
        label: sliceTextAtCodePointBoundary(asText(example.label), MAX_RELATION_LABEL_CHARS),
        status: example.status
      })
    .sort((left, right) => {
      const leftSerialized = JSON.stringify(left);
      const rightSerialized = JSON.stringify(right);
      return leftSerialized < rightSerialized ? -1 : leftSerialized > rightSerialized ? 1 : 0;
    });
}

function serializedFeedbackExamples(value) {
  return JSON.stringify(canonicalFeedbackExamples(value));
}

export function fingerprintFeedbackExamples(value) {
  const serialized = serializedFeedbackExamples(value);
  const hash = (seed) => {
    let value = seed;
    for (let index = 0; index < serialized.length; index += 1) {
      value ^= serialized.charCodeAt(index);
      value = Math.imul(value, 16777619);
    }
    return (value >>> 0).toString(16).padStart(8, "0");
  };
  return `fnv1a-${hash(2166136261)}${hash(0x9e3779b9)}`;
}

function legacyFingerprintFeedbackExamples(value) {
  const serialized = serializedFeedbackExamples(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function matchesFeedbackFingerprint(value, fingerprint) {
  return fingerprint === fingerprintFeedbackExamples(value) || fingerprint === legacyFingerprintFeedbackExamples(value);
}

function normalizeLearningExample(value) {
  if (!value || typeof value !== "object" || !["concept", "relation"].includes(value.kind) || !["accepted", "rejected"].includes(value.status)) return null;
  if (value.kind === "concept") {
    const label = sliceTextAtCodePointBoundary(asLine(value.label, asText(value.id)), MAX_CONCEPT_LABEL_CHARS);
    const id = normalizeId(asText(value.id)) || slugify(label);
    if (!id || !label) return null;
    return {
      kind: "concept",
      id,
      label,
      aliases: normalizeAliases(value.aliases),
      status: value.status,
      lastReviewedAt: asDateTime(value.lastReviewedAt)
    };
  }
  const source = normalizeId(asText(value.source)) || slugify(asText(value.sourceLabel));
  const target = normalizeId(asText(value.target)) || slugify(asText(value.targetLabel));
  const label = sliceTextAtCodePointBoundary(asLine(value.label), MAX_RELATION_LABEL_CHARS);
  if (!source || !target || !label) return null;
  return {
    kind: "relation",
    id: normalizeId(value.id) || makeEdgeId(source, target, label),
    source,
    sourceLabel: sliceTextAtCodePointBoundary(asLine(value.sourceLabel, source), MAX_CONCEPT_LABEL_CHARS),
    target,
    targetLabel: sliceTextAtCodePointBoundary(asLine(value.targetLabel, target), MAX_CONCEPT_LABEL_CHARS),
    label,
    status: value.status,
    lastReviewedAt: asDateTime(value.lastReviewedAt)
  };
}

function learningExampleKey(example) {
  return example.kind === "concept"
    ? `concept|${example.id}`
    : `relation|${example.id}`;
}

function feedbackContextStatsForGraph(graph, { includeStale = false, now = Date.now() } = {}) {
  const reusableExamples = graph.learning.examples.filter((example) => includeGuidanceItem(example, includeStale, now));
  const allKeys = new Set(graph.learning.examples.map(learningExampleKey));
  const keys = new Set(reusableExamples.map(learningExampleKey));
  graph.nodes
    .filter((node) => node.status === "accepted" || node.status === "rejected")
    .forEach((node) => {
      allKeys.add(`concept|${node.id}`);
      if (includeGuidanceItem(node, includeStale, now)) keys.add(`concept|${node.id}`);
    });
  graph.edges
    .filter((edge) => edge.status === "accepted" || edge.status === "rejected")
    .forEach((edge) => {
      allKeys.add(`relation|${edge.id}`);
      if (includeGuidanceItem(edge, includeStale, now)) keys.add(`relation|${edge.id}`);
    });
  return {
    available: keys.size,
    retained: Math.min(keys.size, MAX_FEEDBACK_EXAMPLES),
    truncated: keys.size > MAX_FEEDBACK_EXAMPLES,
    excluded: Math.max(0, allKeys.size - keys.size)
  };
}

export function feedbackContextStats(value, options) {
  return feedbackContextStatsForGraph(normalizeGraph(value), options);
}

function learningExamplesEquivalent(left, right) {
  if (!left || !right || left.kind !== right.kind || left.status !== right.status) return false;
  if (left.kind === "concept") {
    return left.id === right.id
      && slugify(left.label) === slugify(right.label)
      && JSON.stringify((left.aliases || []).map(slugify).sort()) === JSON.stringify((right.aliases || []).map(slugify).sort());
  }
  return left.id === right.id
    && left.source === right.source
    && left.target === right.target
    && slugify(left.label) === slugify(right.label);
}

function learningExampleTieBreak(example) {
  return [
    example.status === "rejected" ? "1" : example.status === "accepted" ? "0" : "2",
    example.kind,
    example.id,
    example.source || "",
    example.target || "",
    slugify(example.label),
    (example.aliases || []).map(slugify).sort().join("\u0000"),
    example.status
  ].join("\u0001");
}

export const trustedPastTimestamp = (value, now = Date.now()) => {
  const timestamp = parseTimestamp(value);
  return Number.isFinite(timestamp) && timestamp <= now ? timestamp : Number.NaN;
};
export const trustedReviewTime = (value, now = Date.now()) => trustedPastTimestamp(value, now);

export function preferLearningExample(existing, incoming) {
  if (!existing) return incoming;
  if (existing.status === "inferred" && ["accepted", "rejected"].includes(incoming.status)) return incoming;
  const existingTime = trustedReviewTime(existing.lastReviewedAt);
  const incomingTime = trustedReviewTime(incoming.lastReviewedAt);
  if (Number.isNaN(incomingTime)) {
    if (!Number.isNaN(existingTime)) return existing;
    return learningExampleTieBreak(incoming) >= learningExampleTieBreak(existing) ? incoming : existing;
  }
  if (Number.isNaN(existingTime) || incomingTime > existingTime) return incoming;
  if (incomingTime === existingTime) {
    return learningExampleTieBreak(incoming) >= learningExampleTieBreak(existing) ? incoming : existing;
  }
  return existing;
}

function preferImportedDecision(existing, incoming) {
  if (!existing) return incoming;
  const existingTime = trustedReviewTime(existing.lastReviewedAt);
  const incomingTime = trustedReviewTime(incoming.lastReviewedAt);
  if (Number.isNaN(incomingTime)) return Number.isNaN(existingTime) ? incoming : existing;
  if (Number.isNaN(existingTime) || incomingTime > existingTime) return incoming;
  if (incomingTime === existingTime) {
    return learningExampleTieBreak(incoming) >= learningExampleTieBreak(existing) ? incoming : existing;
  }
  return existing;
}

function retainNewestLearningExamples(examples) {
  if (!Array.isArray(examples) || examples.length <= MAX_FEEDBACK_EXAMPLES) return examples || [];
  const ranked = examples.map((example, index) => ({
    example,
    index,
    timestamp: trustedReviewTime(example?.lastReviewedAt)
  }));
  ranked.sort((left, right) => {
    if (Number.isFinite(left.timestamp) && Number.isFinite(right.timestamp) && left.timestamp !== right.timestamp) {
      return right.timestamp - left.timestamp;
    }
    if (Number.isFinite(left.timestamp) !== Number.isFinite(right.timestamp)) {
      return Number.isFinite(left.timestamp) ? -1 : 1;
    }
    if (Number.isFinite(left.timestamp) && Number.isFinite(right.timestamp)) {
      return lexicalCompare(learningExampleTieBreak(left.example), learningExampleTieBreak(right.example))
        || right.index - left.index;
    }
    return right.index - left.index;
  });
  return ranked
    .slice(0, MAX_FEEDBACK_EXAMPLES)
    .sort((left, right) => left.index - right.index)
    .map(({ example }) => example);
}

function normalizeLearning(value) {
  const examples = new Map();
  const boundedExamples = Array.isArray(value?.examples)
    ? value.examples.slice(-MAX_FEEDBACK_FINGERPRINT_EXAMPLES)
    : [];
  boundedExamples.forEach((item) => {
    const example = normalizeLearningExample(item);
    if (example) {
      const key = learningExampleKey(example);
      const existing = examples.get(key);
      if (!existing) {
        examples.set(key, example);
        return;
      }
      if (preferLearningExample(existing, example) === example) {
        examples.delete(key);
        examples.set(key, example);
      }
    }
  });
  return { examples: retainNewestLearningExamples([...examples.values()]) };
}

function canonicalDocumentText(text) {
  return asText(text).replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim();
}

function fingerprintText(text) {
  const canonical = canonicalDocumentText(text);
  let primary = 2166136261;
  let secondary = 2654435761;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    primary ^= code;
    primary = Math.imul(primary, 16777619);
    secondary ^= code + ((index + 1) * 31);
    secondary = Math.imul(secondary, 2246822519);
  }
  return `fnv64-${(primary >>> 0).toString(16).padStart(8, "0")}${(secondary >>> 0).toString(16).padStart(8, "0")}-${canonical.length}`;
}

function sameDocumentContent(left, right) {
  const leftText = canonicalDocumentText(left?.text);
  const rightText = canonicalDocumentText(right?.text);
  return leftText === rightText && (Boolean(leftText) || left?.fingerprint === right?.fingerprint);
}

const fingerprintDigest = (serialized) => {
  let primary = 2166136261;
  let secondary = 2654435761;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    primary ^= code;
    primary = Math.imul(primary, 16777619);
    secondary ^= code + ((index + 1) * 31);
    secondary = Math.imul(secondary, 2246822519);
  }
  return `fnv64-${(primary >>> 0).toString(16).padStart(8, "0")}${(secondary >>> 0).toString(16).padStart(8, "0")}-${serialized.length}`;
};

const boundedHistoryForFingerprint = (history) => Array.isArray(history)
  ? history.slice(-MAX_GRAPH_REVISIONS)
  : [];

const legacyFingerprintBackup = (graph, history = []) => fingerprintDigest(JSON.stringify({
  graph: normalizeGraph(graph),
  history: boundedHistoryForFingerprint(history).map((item) => normalizeGraph(item))
}));

const canonicalizeEvidenceForFingerprint = (value) => asArray(value)
  .map((evidence) => ({
    ...evidence,
    sources: [...asArray(evidence.sources)].sort(lexicalCompare)
  }))
  .sort((left, right) => lexicalCompare(
    `${left.text}\u0000${left.sources.join("\u0000")}`,
    `${right.text}\u0000${right.sources.join("\u0000")}`
  ));

const canonicalizeGraphForFingerprint = (value) => {
  const graph = normalizeGraph(value);
  const { committedAt, ...fingerprintGraph } = graph;
  return {
    ...fingerprintGraph,
    // Documents, nodes, and edges are sets from the graph's point of view.
    // Their array order can change during JSON/Obsidian round-trips without
    // changing the represented knowledge. Revision and learning order remain
    // untouched because they carry chronology and bounded recency semantics.
    documents: [...graph.documents].sort((left, right) => lexicalCompare(`${left.id}\u0000${left.fingerprint}`, `${right.id}\u0000${right.fingerprint}`)),
    nodes: [...graph.nodes].sort((left, right) => lexicalCompare(left.id, right.id)).map((node) => ({
      ...node,
      aliases: [...(node.aliases || [])].sort(lexicalCompare),
      sources: [...node.sources].sort(lexicalCompare),
      evidence: canonicalizeEvidenceForFingerprint(node.evidence)
    })),
    edges: [...graph.edges].sort((left, right) => lexicalCompare(
      `${relationSemanticKey(left.source, left.target, left.label)}\u0000${left.id}`,
      `${relationSemanticKey(right.source, right.target, right.label)}\u0000${right.id}`
    )).map((edge) => ({
      ...edge,
      sources: [...edge.sources].sort(lexicalCompare),
      evidence: canonicalizeEvidenceForFingerprint(edge.evidence)
    })),
    integrity: {
      ...graph.integrity,
      ambiguousSourceIds: [...graph.integrity.ambiguousSourceIds].sort(lexicalCompare),
      ambiguousEdgeIds: [...graph.integrity.ambiguousEdgeIds].sort(lexicalCompare)
    }
  };
};

export function fingerprintBackup(graph, history = []) {
  const serialized = JSON.stringify({
    graph: canonicalizeGraphForFingerprint(graph),
    // Undo history is ordered: the last entry is the next state to restore.
    history: boundedHistoryForFingerprint(history).map(canonicalizeGraphForFingerprint)
  });
  return fingerprintDigest(serialized);
}

export function matchesGraphFingerprint(graph, graphFingerprint, history = []) {
  return typeof graphFingerprint !== "string"
    || graphFingerprint === fingerprintBackup(graph, history)
    // Accept fingerprints emitted before canonical collection ordering was
    // introduced so existing backups and vaults remain importable.
    || graphFingerprint === legacyFingerprintBackup(graph, history);
}

export function validateBackupEnvelope(value, { label = "Backup" } = {}) {
  const allowedKeys = new Set(["format", "exportedAt", "appVersion", "graph", "history", "graphFingerprint"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error(`${label} contains unsupported fields.`);
  }
  if (value.format !== BACKUP_FORMAT) {
    throw new Error(`${label} format is unsupported.`);
  }
  if (typeof value.exportedAt !== "string"
    || Number.isNaN(parseTimestamp(value.exportedAt))
    || Number.isNaN(trustedPastTimestamp(value.exportedAt))) {
    throw new Error(`${label} exportedAt must be a valid past timestamp.`);
  }
  if (!value.graph || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(value.graph.schema)) {
    throw new Error(`${label} must contain ${GRAPH_SCHEMA}.`);
  }
  if (!Array.isArray(value.history)
    || value.history.length > MAX_BACKUP_HISTORY
    || value.history.some((snapshot) => !snapshot || ![GRAPH_SCHEMA, ...LEGACY_GRAPH_SCHEMAS].includes(snapshot.schema))) {
    throw new Error(`${label} history must contain at most ${MAX_BACKUP_HISTORY} compatible graph snapshots.`);
  }
  if (value.appVersion !== undefined
    && (typeof value.appVersion !== "string"
      || !value.appVersion.trim()
      || value.appVersion.length > MAX_PRODUCER_VERSION_CHARS)) {
    throw new Error(`${label} producer metadata is invalid.`);
  }
  if (value.graphFingerprint !== undefined
    && (typeof value.graphFingerprint !== "string"
      || !matchesGraphFingerprint(value.graph, value.graphFingerprint, value.history))) {
    throw new Error(`${label} fingerprint does not match its graph and history.`);
  }
  return true;
}

function normalizeEvidence(value, fallbackSources = []) {
  const boundedFallbackSources = normalizeSourceIds(fallbackSources);
  const normalized = asBoundedArray(value, MAX_EVIDENCE_INPUT_ITEMS).map((item) => {
    if (typeof item === "string") {
      const text = sliceTextAtCodePointBoundary(item, MAX_EVIDENCE_CHARS);
      return text.trim() ? { text, sources: boundedFallbackSources } : null;
    }
    if (!item || typeof item !== "object" || !asText(item.text).trim()) return null;
    const text = sliceTextAtCodePointBoundary(asText(item.text), MAX_EVIDENCE_CHARS);
    return {
      text,
      sources: normalizeSourceIds(item.sources)
    };
  }).filter(Boolean);
  const byText = new Map();
  normalized.forEach((item) => {
    const key = item.text.trim();
    const existing = byText.get(key);
    if (existing) existing.sources = mergeSourceIds(existing.sources, item.sources);
    else byText.set(key, { text: item.text, sources: [...item.sources] });
  });
  return [...byText.values()].slice(0, MAX_EVIDENCE_RECORDS);
}

const normalizeSourceIds = (value, fallback = []) => [...new Set([...asBoundedArray(fallback, MAX_SOURCE_REFERENCES), ...asBoundedArray(value, MAX_SOURCE_REFERENCES)]
  .filter((item) => typeof item === "string")
  .map((item) => normalizeId(item))
  .filter(Boolean))]
  .sort(lexicalCompare)
  .slice(0, MAX_SOURCE_REFERENCES);
const mergeSourceIds = (...values) => normalizeSourceIds(values.flat());

function mergeEvidence(current, incoming) {
  const merged = new Map();
  [...normalizeEvidence(current), ...normalizeEvidence(incoming)].forEach((item) => {
    const key = item.text.trim();
    const existing = merged.get(key);
    if (existing) existing.sources = mergeSourceIds(existing.sources, item.sources);
    else merged.set(key, { text: item.text, sources: [...item.sources] });
  });
  return [...merged.values()].slice(0, MAX_EVIDENCE_RECORDS);
}

const importIntegrityLimit = (graph) => {
  const truncation = graph.integrity?.truncated || {};
  if (truncation.documentText || truncation.documentTitle || truncation.evidenceText) return "document-text";
  const dropped = graph.integrity?.dropped || {};
  return [...Object.values(truncation), ...Object.values(dropped)]
    .some((count) => Number.isSafeInteger(count) && count > 0)
    ? "import-truncated"
    : null;
};

function makeUniqueEdgeIds(edges) {
  const assigned = new Map();
  const used = new Set();
  const ordered = edges.map((edge) => ({
    edge,
    base: normalizeId(edge.id) || "edge"
  })).sort((left, right) => lexicalCompare(
    `${left.base}\u0000${relationSemanticKey(left.edge.source, left.edge.target, left.edge.label)}\u0000${left.edge.source}\u0000${left.edge.target}\u0000${left.edge.label}`,
    `${right.base}\u0000${relationSemanticKey(right.edge.source, right.edge.target, right.edge.label)}\u0000${right.edge.source}\u0000${right.edge.target}\u0000${right.edge.label}`
  ));
  ordered.forEach(({ edge, base }) => {
    let id = base;
    let suffix = 2;
    while (used.has(id)) id = appendIdSuffix(base, suffix++);
    used.add(id);
    assigned.set(edge, id);
  });
  return edges.map((edge) => {
    const id = assigned.get(edge);
    return id === edge.id ? edge : { ...edge, id };
  });
}

export function normalizeExtraction(value, fallbackTitle = "Untitled document", fallbackText = "") {
  const input = value && typeof value === "object" ? value : {};
  const inputSource = input.source && typeof input.source === "object" ? input.source : {};
  // Reuse an explicit source timestamp for generated item timestamps; otherwise
  // preserve normal current-time chronology for newly extracted material.
  const normalizationTimestamp = asDateTime(inputSource.addedAt, new Date().toISOString());
  const sourceText = sliceTextAtCodePointBoundary(asText(inputSource.text, fallbackText), MAX_DOCUMENT_CHARS);
  const sourceId = normalizeId(inputSource.id) || `doc-${fingerprintText(sourceText)}`;
  const source = {
    id: sourceId,
    title: sliceTextAtCodePointBoundary(asLine(inputSource.title, fallbackTitle), MAX_DOCUMENT_TITLE_CHARS),
    text: sourceText,
    fingerprint: normalizeId(inputSource.fingerprint) || fingerprintText(sourceText),
    uri: normalizeSourceUri(inputSource.uri),
    addedAt: asDateTime(inputSource.addedAt, normalizationTimestamp),
    quality: SOURCE_QUALITIES.has(inputSource.quality) ? inputSource.quality : "unknown",
    lastReviewedAt: asDateTime(inputSource.lastReviewedAt)
  };
  const idMap = new Map();
  const ambiguousIdMapKeys = new Set();
  const setIdMap = (key, id) => {
    if (!key || ambiguousIdMapKeys.has(key)) return;
    const previous = idMap.get(key);
    if (previous && previous !== id) {
      idMap.delete(key);
      ambiguousIdMapKeys.add(key);
      return;
    }
    idMap.set(key, id);
  };
  const normalizedNodes = asArray(input.nodes).slice(0, MAX_GRAPH_NODES).map((node) => {
    const label = sliceTextAtCodePointBoundary(asLine(node?.label, asLine(node?.name, "Unnamed concept")), MAX_CONCEPT_LABEL_CHARS);
    const rawInputId = asText(node?.id).trim();
    const rawId = normalizeId(rawInputId) || stableLabelId(label) || makeId("concept");
    const id = rawInputId ? rawId : stableLabelId(label) || rawId;
    if (rawInputId) setIdMap(rawInputId, id);
    setIdMap(rawId, id);
    setIdMap(canonicalLabelKey(label), id);
    const sources = normalizeSourceIds(node?.sources, [sourceId]);
    return {
      id,
      label: label || id,
      aliases: normalizeAliases(node?.aliases),
      type: sliceTextAtCodePointBoundary(asLine(node?.type, "concept"), 30),
      confidence: asConfidence(node?.confidence, .55),
      mentions: asBoundedCounter(node?.mentions, 1, 1, MAX_NODE_MENTIONS),
      feedback: asBoundedCounter(node?.feedback, 0, -MAX_FEEDBACK_COUNT, MAX_FEEDBACK_COUNT),
      status: ["inferred", "accepted", "rejected"].includes(node?.status) ? node.status : "inferred",
      sources,
      evidence: normalizeEvidence(node?.evidence, sources),
      createdAt: asDateTime(node?.createdAt, normalizationTimestamp),
      updatedAt: asDateTime(node?.updatedAt, normalizationTimestamp),
      lastReviewedAt: asDateTime(node?.lastReviewedAt)
    };
  });
  const nodesById = new Map();
  normalizedNodes.forEach((node) => {
    const existing = nodesById.get(node.id);
    if (!existing) {
      nodesById.set(node.id, node);
      return;
    }
    const labels = [...new Set([existing.label, node.label, ...existing.aliases, ...node.aliases])];
    const existingUpdatedAt = parseTimestamp(existing.updatedAt);
    const incomingUpdatedAt = parseTimestamp(node.updatedAt);
    const incomingIsCanonical = incomingUpdatedAt > existingUpdatedAt
      || (incomingUpdatedAt === existingUpdatedAt && lexicalCompare(node.label, existing.label) < 0);
    if (incomingIsCanonical) {
      existing.label = node.label;
      existing.type = node.type;
    }
    existing.aliases = labels.filter((label) => slugify(label) !== slugify(existing.label)).sort(lexicalCompare).slice(0, MAX_ALIASES);
    existing.sources = mergeSourceIds(existing.sources, node.sources);
    existing.evidence = mergeEvidence(existing.evidence, node.evidence);
    existing.mentions = Math.min(MAX_NODE_MENTIONS, existing.mentions + node.mentions);
    existing.feedback = Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, existing.feedback + node.feedback));
    existing.confidence = Math.max(existing.confidence, node.confidence);
    if (existing.status !== "accepted" && node.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && node.status === "rejected") existing.status = "rejected";
    existing.lastReviewedAt = newestTimestamp(existing.lastReviewedAt, node.lastReviewedAt);
    existing.updatedAt = newestTimestamp(existing.updatedAt, node.updatedAt);
    existing.createdAt = oldestTimestamp(existing.createdAt, node.createdAt);
  });
  const nodes = [...nodesById.values()];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const normalizedEdges = asArray(input.edges).slice(0, MAX_GRAPH_EDGES).map((edge) => {
    const rawSource = asText(edge?.source);
    const rawTarget = asText(edge?.target);
    const source = idMap.get(rawSource) || idMap.get(normalizeId(rawSource)) || idMap.get(canonicalLabelKey(rawSource)) || rawSource;
    const target = idMap.get(rawTarget) || idMap.get(normalizeId(rawTarget)) || idMap.get(canonicalLabelKey(rawTarget)) || rawTarget;
    const label = sliceTextAtCodePointBoundary(asLine(edge?.label, "related to"), MAX_RELATION_LABEL_CHARS);
    if (!nodeIds.has(source) || !nodeIds.has(target)) return null;
    const sources = normalizeSourceIds(edge?.sources, [sourceId]);
    return {
      id: normalizeId(edge?.id) || makeEdgeId(source, target, label),
      source,
      target,
      label,
      confidence: asConfidence(edge?.confidence, .55),
      feedback: asBoundedCounter(edge?.feedback, 0, -MAX_FEEDBACK_COUNT, MAX_FEEDBACK_COUNT),
      evidence: normalizeEvidence(edge?.evidence, sources),
      sources,
      status: ["inferred", "accepted", "rejected"].includes(edge?.status) ? edge.status : "inferred",
      lastReviewedAt: asDateTime(edge?.lastReviewedAt)
    };
  }).filter(Boolean);
  const edgesByKey = new Map();
  normalizedEdges.forEach((edge) => {
    const key = relationSemanticKey(edge.source, edge.target, edge.label);
    const existing = edgesByKey.get(key);
    if (!existing) {
      edgesByKey.set(key, edge);
      return;
    }
    const directionalRepresentative = edge.confidence > existing.confidence
      ? edge
      : existing.confidence > edge.confidence
        ? existing
        : [existing.source, existing.target].sort(lexicalCompare)[0] === existing.source
          ? existing
          : edge;
    const source = directionalRepresentative.source;
    const target = directionalRepresentative.target;
    const ids = [existing.id, edge.id].sort(lexicalCompare);
    const labels = [existing.label, edge.label].sort((left, right) => lexicalCompare(left.toLowerCase(), right.toLowerCase()) || lexicalCompare(left, right));
    edgesByKey.set(key, {
      ...existing,
      id: ids[0],
      source,
      target,
      label: labels[0],
      sources: mergeSourceIds(existing.sources, edge.sources),
      evidence: mergeEvidence(existing.evidence, edge.evidence),
      confidence: Math.max(existing.confidence, edge.confidence),
      feedback: Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, existing.feedback + edge.feedback)),
      status: existing.status === "accepted" || edge.status === "accepted"
        ? "accepted"
        : existing.status === "rejected" || edge.status === "rejected"
          ? "rejected"
          : "inferred",
      lastReviewedAt: newestTimestamp(existing.lastReviewedAt, edge.lastReviewedAt)
    });
  });
  const edges = makeUniqueEdgeIds([...edgesByKey.values()]);
  return { source, nodes, edges };
}

export function normalizeExtractionForDocument(value, { title, text, uri, feedback = [] } = {}) {
  const boundedTitle = sliceTextAtCodePointBoundary(asLine(title, "Untitled document"), MAX_DOCUMENT_TITLE_CHARS);
  const boundedText = sliceTextAtCodePointBoundary(asText(text), MAX_DOCUMENT_CHARS);
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const inputSource = input.source && typeof input.source === "object" && !Array.isArray(input.source)
    ? input.source
    : {};
  if (input.nodes !== undefined && !Array.isArray(input.nodes)) {
    throw Object.assign(new Error("Extractor response contains a malformed concept collection."), { code: "EXTRACTION_NODES_SHAPE" });
  }
  if (input.edges !== undefined && !Array.isArray(input.edges)) {
    throw Object.assign(new Error("Extractor response contains a malformed relation collection."), { code: "EXTRACTION_EDGES_SHAPE" });
  }
  if (Array.isArray(input.nodes) && input.nodes.length > MAX_GRAPH_NODES) {
    throw Object.assign(new Error(`Extractor response exceeds the ${MAX_GRAPH_NODES}-concept limit.`), { code: "EXTRACTION_NODES_TOO_LARGE" });
  }
  if (Array.isArray(input.edges) && input.edges.length > MAX_GRAPH_EDGES) {
    throw Object.assign(new Error(`Extractor response exceeds the ${MAX_GRAPH_EDGES}-relation limit.`), { code: "EXTRACTION_EDGES_TOO_LARGE" });
  }
  input.nodes?.forEach((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)
      || ![node.label, node.name].some((label) => typeof label === "string" && label.trim())) {
      throw Object.assign(new Error("Extractor response contains a malformed concept record."), { code: "EXTRACTION_NODES_SHAPE" });
    }
  });
  input.edges?.forEach((edge) => {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)
      || typeof edge.source !== "string" || !edge.source.trim()
      || typeof edge.target !== "string" || !edge.target.trim()
      || typeof edge.label !== "string" || !edge.label.trim()) {
      throw Object.assign(new Error("Extractor response contains a malformed relation record."), { code: "EXTRACTION_EDGES_SHAPE" });
    }
  });
  const providerRecords = [
    ...(Array.isArray(input.nodes) ? input.nodes.slice(0, MAX_GRAPH_NODES) : []),
    ...(Array.isArray(input.edges) ? input.edges.slice(0, MAX_GRAPH_EDGES) : [])
  ];
  providerRecords.forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    if (item.aliases !== undefined && (
      !Array.isArray(item.aliases)
      || item.aliases.length > MAX_ALIASES
      || item.aliases.some((alias) => typeof alias !== "string" || alias.length > MAX_CONCEPT_LABEL_CHARS)
      || new Set(item.aliases.map((alias) => typeof alias === "string" ? alias.replace(/\s+/g, " ").trim() : alias)).size !== item.aliases.length
    )) {
      throw Object.assign(new Error(`Extractor response exceeds the ${MAX_ALIASES}-alias contract.`), { code: "EXTRACTION_ALIASES_TOO_LARGE" });
    }
    if (item.sources !== undefined && (
      !Array.isArray(item.sources)
      || item.sources.some((source) => typeof source !== "string" || source.length > MAX_ID_CHARS || !source.trim())
    )) {
      throw Object.assign(new Error(`Extractor response contains malformed provenance references.`), { code: "EXTRACTION_PROVENANCE_SHAPE" });
    }
    if (item.evidence !== undefined && (
      !Array.isArray(item.evidence)
      || item.evidence.some((evidence) => {
        if (typeof evidence === "string") return !evidence.trim();
        return !evidence
          || typeof evidence !== "object"
          || Array.isArray(evidence)
          || typeof evidence.text !== "string"
          || !evidence.text.trim()
          || (evidence.sources !== undefined && (
            !Array.isArray(evidence.sources)
            || evidence.sources.some((source) => typeof source !== "string" || source.length > MAX_ID_CHARS || !source.trim())
          ));
      })
    )) {
      throw Object.assign(new Error(`Extractor response contains malformed evidence.`), { code: "EXTRACTION_PROVENANCE_SHAPE" });
    }
    if (Array.isArray(item.evidence) && item.evidence.length > MAX_EVIDENCE_RECORDS) {
      throw Object.assign(new Error(`Extractor response exceeds the ${MAX_EVIDENCE_RECORDS}-evidence-record limit per graph item.`), { code: "EXTRACTION_EVIDENCE_TOO_LARGE" });
    }
    if (Array.isArray(item.sources) && item.sources.length > MAX_SOURCE_REFERENCES) {
      throw Object.assign(new Error(`Extractor response exceeds the ${MAX_SOURCE_REFERENCES}-provenance-reference limit per graph item.`), { code: "EXTRACTION_SOURCES_TOO_LARGE" });
    }
    (Array.isArray(item.evidence) ? item.evidence.slice(0, MAX_EVIDENCE_RECORDS) : []).forEach((evidence) => {
      const evidenceText = typeof evidence === "string" ? evidence : evidence?.text;
      if (typeof evidenceText === "string" && evidenceText.length > MAX_EVIDENCE_CHARS) {
        throw Object.assign(new Error(`Extractor response exceeds the ${MAX_EVIDENCE_CHARS}-character evidence-text limit.`), { code: "EXTRACTION_EVIDENCE_TEXT_TOO_LARGE" });
      }
      if (evidence && typeof evidence === "object" && Array.isArray(evidence.sources) && evidence.sources.length > MAX_SOURCE_REFERENCES) {
        throw Object.assign(new Error(`Extractor response exceeds the ${MAX_SOURCE_REFERENCES}-provenance-reference limit per evidence record.`), { code: "EXTRACTION_EVIDENCE_SOURCES_TOO_LARGE" });
      }
    });
  });
  const providerNodeLabels = new Map();
  const ambiguousProviderNodeIds = new Set();
  asArray(input.nodes).slice(0, MAX_GRAPH_NODES).forEach((node) => {
    const id = asText(node?.id).trim();
    const label = asLine(node?.label, asLine(node?.name, ""));
    if (!id || !label || ambiguousProviderNodeIds.has(id)) return;
    const previous = providerNodeLabels.get(id);
    if (previous && previous !== label) {
      providerNodeLabels.delete(id);
      ambiguousProviderNodeIds.add(id);
      return;
    }
    providerNodeLabels.set(id, label);
  });
  const canonicalNodes = Array.isArray(input.nodes)
    ? input.nodes.slice(0, MAX_GRAPH_NODES).map((node) => ({
      ...node,
      id: null,
      status: "inferred",
      feedback: 0,
      createdAt: null,
      updatedAt: null,
      lastReviewedAt: null
    }))
    : input.nodes;
  const canonicalEdges = Array.isArray(input.edges)
    ? input.edges.slice(0, MAX_GRAPH_EDGES).map((edge) => ({
      ...edge,
      id: null,
      status: "inferred",
      feedback: 0,
      lastReviewedAt: null,
      source: ambiguousProviderNodeIds.has(asText(edge?.source).trim()) ? "" : providerNodeLabels.get(asText(edge?.source).trim()) || edge?.source,
      target: ambiguousProviderNodeIds.has(asText(edge?.target).trim()) ? "" : providerNodeLabels.get(asText(edge?.target).trim()) || edge?.target
    }))
    : input.edges;
  const normalized = normalizeExtraction({
    ...input,
    nodes: canonicalNodes,
    edges: canonicalEdges,
    source: {
      ...inputSource,
      id: null,
      title: boundedTitle,
      text: boundedText,
      fingerprint: null,
      uri: normalizeSourceUri(uri),
      addedAt: null,
      quality: "unknown",
      lastReviewedAt: null
    }
  }, boundedTitle, boundedText);
  const sourceId = normalized.source.id;
  const searchable = (value) => String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sourceUnits = [...new Set(
    boundedText
      .split(/\r?\n+/)
      .flatMap((line) => line.split(/(?<=[.!?])\s+/))
      .map((unit) => unit.trim())
      .filter(Boolean)
  )].slice(0, MAX_EXTRACTION_UNITS);
  const evidenceForTerms = (terms, requireAll = true) => {
    const normalizedTerms = terms.map(searchable).filter(Boolean);
    return sourceUnits.find((unit) => {
      const candidate = searchable(unit);
      const contains = (term) => ` ${candidate} `.includes(` ${term} `);
      return requireAll
        ? normalizedTerms.every(contains)
        : normalizedTerms.some(contains);
    }) || null;
  };
  const acceptedHints = feedbackHints(feedback);
  const nodeMatchesHint = (node, hint, labelKey = "label") => {
    const keys = new Set([
      node.id,
      node.label,
      ...(node.aliases || [])
    ].map((value) => slugify(value)).filter(Boolean));
    return keys.has(slugify(hint.id)) || keys.has(slugify(hint[labelKey] || ""));
  };
  const acceptedConcepts = [...acceptedHints.concepts.values()]
    .filter((hint, index, values) => hint.status === "accepted"
      && values.findIndex((candidate) => candidate.id === hint.id) === index);
  acceptedConcepts.forEach((hint) => {
    if (normalized.nodes.length >= MAX_GRAPH_NODES) return;
    if (normalized.nodes.some((node) => nodeMatchesHint(node, hint))) return;
    const evidenceText = evidenceForTerms([hint.label, ...hint.aliases], false);
    if (!evidenceText) return;
    normalized.nodes.push({
      id: hint.id,
      label: hint.label,
      aliases: hint.aliases,
      type: "concept",
      confidence: .74,
      mentions: 1,
      feedback: 0,
      status: "inferred",
      sources: [sourceId],
      evidence: [{ text: evidenceText, sources: [sourceId] }],
      createdAt: normalized.source.addedAt,
      updatedAt: normalized.source.addedAt,
      lastReviewedAt: null
    });
  });
  acceptedHints.relations
    .filter((hint) => hint.status === "accepted")
    .forEach((hint) => {
      if (normalized.edges.length >= MAX_GRAPH_EDGES) return;
      const sourceNode = normalized.nodes.find((node) => node.id === hint.source
        || slugify(node.label) === hint.sourceLabel
        || (node.aliases || []).some((alias) => slugify(alias) === hint.sourceLabel));
      const targetNode = normalized.nodes.find((node) => node.id === hint.target
        || slugify(node.label) === hint.targetLabel
        || (node.aliases || []).some((alias) => slugify(alias) === hint.targetLabel));
      if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return;
      const edgeKey = relationSemanticKey(sourceNode.id, targetNode.id, hint.label);
      if (normalized.edges.some((edge) => relationSemanticKey(edge.source, edge.target, edge.label) === edgeKey)) return;
      const evidenceText = sourceUnits.find((unit) => {
        const candidate = searchable(unit);
        const contains = (term) => ` ${candidate} `.includes(` ${term} `);
        const sourceTerms = [sourceNode.label, ...(sourceNode.aliases || [])].map(searchable).filter(Boolean);
        const targetTerms = [targetNode.label, ...(targetNode.aliases || [])].map(searchable).filter(Boolean);
        return sourceTerms.some(contains) && targetTerms.some(contains);
      }) || null;
      if (!evidenceText) return;
      normalized.edges.push({
        id: makeEdgeId(sourceNode.id, targetNode.id, hint.label),
        source: sourceNode.id,
        target: targetNode.id,
        label: hint.label,
        confidence: .72,
        feedback: 0,
        evidence: [{ text: evidenceText, sources: [sourceId] }],
        sources: [sourceId],
        status: "inferred",
        lastReviewedAt: null
      });
    });
  const rebindProvenance = (item) => ({
    ...item,
    sources: [sourceId],
    evidence: item.evidence.map((evidence) => ({ ...evidence, sources: [sourceId] }))
  });
  return applyRejectedFeedback({
    ...normalized,
    nodes: normalized.nodes.map(rebindProvenance),
    edges: normalized.edges.map(rebindProvenance)
  }, feedback);
}

export function normalizeGraph(value) {
  if (!value || typeof value !== "object" || (value.schema !== GRAPH_SCHEMA && !LEGACY_GRAPH_SCHEMAS.has(value.schema))) return defaultGraph();
  const wasMigrated = value.schema !== GRAPH_SCHEMA;
  const graph = defaultGraph();
  graph.version = Number.isSafeInteger(value.version) && value.version >= 0 ? value.version : 0;
  graph.updatedAt = asDateTime(value.updatedAt, null);
  const committedAt = asDateTime(value.committedAt, null);
  if (committedAt) graph.committedAt = committedAt;
  if (value.redacted === true) graph.redacted = true;
  const graphFallbackTimestamp = graph.updatedAt || DEFAULT_GRAPH_TIMESTAMP;
  const ambiguousSourceIds = new Set(asBoundedArray(value.integrity?.ambiguousSourceIds, MAX_AMBIGUOUS_SOURCE_IDS)
    .filter((id) => typeof id === "string")
    .map((id) => normalizeId(id))
    .filter(Boolean));
  const ambiguousEdgeIds = new Set(asBoundedArray(value.integrity?.ambiguousEdgeIds, MAX_AMBIGUOUS_EDGE_IDS)
    .filter((id) => typeof id === "string")
    .map((id) => normalizeId(id))
    .filter(Boolean));
  const conflictingNodeIds = new Set(asBoundedArray(value.integrity?.conflictingNodeIds, MAX_CONFLICTING_ITEM_IDS)
    .filter((id) => typeof id === "string")
    .map((id) => normalizeId(id))
    .filter(Boolean));
  const conflictingEdgeIds = new Set(asBoundedArray(value.integrity?.conflictingEdgeIds, MAX_CONFLICTING_ITEM_IDS)
    .filter((id) => typeof id === "string")
    .map((id) => normalizeId(id))
    .filter(Boolean));
  const truncated = {
    documents: Math.max(
      asTruncationCount(value.integrity?.truncated?.documents),
      Array.isArray(value.documents) ? Math.max(0, value.documents.length - MAX_GRAPH_DOCUMENTS) : 0
    ),
    nodes: Math.max(
      asTruncationCount(value.integrity?.truncated?.nodes),
      Array.isArray(value.nodes) ? Math.max(0, value.nodes.length - MAX_GRAPH_NODES) : 0
    ),
    edges: Math.max(
      asTruncationCount(value.integrity?.truncated?.edges),
      Array.isArray(value.edges) ? Math.max(0, value.edges.length - MAX_GRAPH_EDGES) : 0
    ),
    revisions: Math.max(
      asTruncationCount(value.integrity?.truncated?.revisions),
      Array.isArray(value.revisions) ? Math.max(0, value.revisions.length - MAX_GRAPH_REVISIONS) : 0
    ),
    learningExamples: Math.max(
      asTruncationCount(value.integrity?.truncated?.learningExamples),
      Array.isArray(value.learning?.examples) ? Math.max(0, value.learning.examples.length - MAX_FEEDBACK_EXAMPLES) : 0
    ),
    documentTitle: asTruncationCount(value.integrity?.truncated?.documentTitle),
    documentText: asTruncationCount(value.integrity?.truncated?.documentText),
    evidenceText: asTruncationCount(value.integrity?.truncated?.evidenceText),
    evidenceItems: asTruncationCount(value.integrity?.truncated?.evidenceItems),
    sourceReferences: asTruncationCount(value.integrity?.truncated?.sourceReferences),
    aliases: asTruncationCount(value.integrity?.truncated?.aliases)
  };
  const boundedDocuments = retainNewestDocuments(value.documents);
  const boundedNodes = asBoundedArray(value.nodes, MAX_GRAPH_NODES);
  const boundedRevisions = asBoundedArray(value.revisions, MAX_GRAPH_REVISIONS);
  const boundedLearningExamples = Array.isArray(value.learning?.examples)
    ? value.learning.examples.slice(-MAX_FEEDBACK_EXAMPLES)
    : [];
  const countOversizedEvidence = (items) => asBoundedArray(items, MAX_GRAPH_NODES + MAX_GRAPH_EDGES)
    .reduce((total, item) => {
      const evidence = asBoundedArray(item?.evidence, MAX_EVIDENCE_INPUT_ITEMS);
      return total + evidence.filter((entry) => (
        (typeof entry === "string" && entry.length > MAX_EVIDENCE_CHARS)
        || (entry && typeof entry === "object" && typeof entry.text === "string" && entry.text.length > MAX_EVIDENCE_CHARS)
      )).length;
    }, 0);
  const countNestedTruncation = (items) => asBoundedArray(items, MAX_GRAPH_NODES + MAX_GRAPH_EDGES)
    .reduce((counts, item) => {
      const rawEvidence = Array.isArray(item?.evidence) ? item.evidence : [];
      counts.evidenceItems = Math.min(Number.MAX_SAFE_INTEGER, counts.evidenceItems + Math.max(0, rawEvidence.length - MAX_EVIDENCE_RECORDS));
      const rawSources = Array.isArray(item?.sources) ? item.sources : [];
      counts.sourceReferences = Math.min(Number.MAX_SAFE_INTEGER, counts.sourceReferences + Math.max(0, rawSources.length - MAX_SOURCE_REFERENCES));
      asBoundedArray(rawEvidence, MAX_EVIDENCE_INPUT_ITEMS).forEach((evidence) => {
        const evidenceSources = Array.isArray(evidence?.sources) ? evidence.sources : [];
        counts.sourceReferences = Math.min(Number.MAX_SAFE_INTEGER, counts.sourceReferences + Math.max(0, evidenceSources.length - MAX_SOURCE_REFERENCES));
      });
      return counts;
    }, { evidenceItems: 0, sourceReferences: 0 });
  const countAliasTruncation = (items) => asBoundedArray(items, MAX_GRAPH_NODES + MAX_GRAPH_EDGES)
    .reduce((total, item) => {
      if (!item || typeof item !== "object") return total;
      if (item.aliases === undefined) return total;
      if (!Array.isArray(item.aliases)) return total + 1;
      const retained = item.aliases.slice(0, MAX_ALIASES);
      return total
        + Math.max(0, item.aliases.length - MAX_ALIASES)
        + retained.filter((alias) => typeof alias === "string" && alias.length > MAX_CONCEPT_LABEL_CHARS).length;
    }, 0);
  const dropped = {
    documents: Math.max(
      asDroppedCount(value.integrity?.dropped?.documents),
      boundedDocuments.filter((document) => !document || typeof document !== "object").length
    ),
    nodes: Math.max(
      asDroppedCount(value.integrity?.dropped?.nodes),
      boundedNodes.filter((node) => !node || typeof node !== "object" || !asText(node.id).trim()).length
    ),
    edges: asDroppedCount(value.integrity?.dropped?.edges),
    revisions: Math.max(
      asDroppedCount(value.integrity?.dropped?.revisions),
      boundedRevisions.filter((revision) => !revision || typeof revision !== "object").length
    ),
    learningExamples: Math.max(
      asDroppedCount(value.integrity?.dropped?.learningExamples),
      boundedLearningExamples.filter((example) => !normalizeLearningExample(example)).length
    )
  };
  const normalizedDocuments = boundedDocuments.filter((doc) => doc && typeof doc === "object").map((doc) => {
    const text = sliceTextAtCodePointBoundary(asText(doc.text), MAX_DOCUMENT_CHARS);
    const fingerprint = normalizeId(doc.fingerprint) || fingerprintText(text);
    return {
      id: normalizeId(doc.id) || `doc-${fingerprintText(fingerprint)}`,
      title: sliceTextAtCodePointBoundary(asLine(doc.title, "Untitled document"), MAX_DOCUMENT_TITLE_CHARS),
      text,
      fingerprint,
      uri: normalizeSourceUri(doc.uri),
      addedAt: asDateTime(doc.addedAt, graphFallbackTimestamp),
      quality: SOURCE_QUALITIES.has(doc.quality) ? doc.quality : "unknown",
      lastReviewedAt: asDateTime(doc.lastReviewedAt)
    };
  });
  truncated.documentText = Math.max(
    truncated.documentText,
    boundedDocuments.filter((document) => document && typeof document.text === "string" && document.text.length > MAX_DOCUMENT_CHARS).length
  );
  truncated.documentTitle = Math.max(
    truncated.documentTitle,
    boundedDocuments.filter((document) => document && typeof document.title === "string" && document.title.length > MAX_DOCUMENT_TITLE_CHARS).length
  );
  truncated.evidenceText = Math.max(
    truncated.evidenceText,
    countOversizedEvidence([...boundedNodes, ...asBoundedArray(value.edges, MAX_GRAPH_EDGES)])
  );
  const nestedTruncation = countNestedTruncation([...boundedNodes, ...asBoundedArray(value.edges, MAX_GRAPH_EDGES)]);
  truncated.evidenceItems = Math.max(truncated.evidenceItems, nestedTruncation.evidenceItems);
  truncated.sourceReferences = Math.max(truncated.sourceReferences, nestedTruncation.sourceReferences);
  truncated.aliases = Math.max(
    truncated.aliases,
    countAliasTruncation([...boundedNodes, ...boundedLearningExamples])
  );
  const orderedDocuments = [];
  const seenDocumentIds = new Set();
  normalizedDocuments.forEach((document) => {
    if (seenDocumentIds.has(document.id)) return;
    seenDocumentIds.add(document.id);
    const collisionGroup = normalizedDocuments
      .filter((candidate) => candidate.id === document.id)
      .sort((left, right) => lexicalCompare(
        `${left.fingerprint}\u0000${left.text}\u0000${left.title}`,
        `${right.fingerprint}\u0000${right.text}\u0000${right.title}`
      ));
    orderedDocuments.push(...collisionGroup);
  });
  const documentsById = new Map();
  orderedDocuments.forEach((document) => {
    let documentId = document.id;
    let existing = documentsById.get(documentId);
    const sameContent = existing && (
      sameDocumentContent(existing, document)
      || (
        existing.id === document.id
        && (!canonicalDocumentText(existing.text) || !canonicalDocumentText(document.text))
        && existing.fingerprint === document.fingerprint
      )
    );
    if (existing && !sameContent) {
      ambiguousSourceIds.add(document.id);
      const baseId = `doc-${fingerprintText(document.text)}`;
      documentId = baseId;
      let suffix = 2;
      while (documentsById.has(documentId)) documentId = `${baseId}-${suffix++}`;
      document = { ...document, id: documentId };
      existing = documentsById.get(documentId);
    }
    if (!existing) {
      documentsById.set(documentId, document);
      return;
    }
    const titles = [existing.title, document.title].filter((title) => title && title !== "Untitled document");
    if (titles.length) existing.title = titles.sort(lexicalCompare)[0];
    if (!existing.text && document.text) existing.text = document.text;
    if (!existing.fingerprint && document.fingerprint) existing.fingerprint = document.fingerprint;
    const uris = [existing.uri, document.uri].filter(Boolean).sort(lexicalCompare);
    if (uris.length) existing.uri = uris[0];
    const qualityRank = (quality) => ({ primary: 4, secondary: 3, tertiary: 2, unknown: 1 }[quality] || 0);
    if (qualityRank(document.quality) > qualityRank(existing.quality)
      || (qualityRank(document.quality) === qualityRank(existing.quality) && document.quality < existing.quality)) {
      existing.quality = document.quality;
    }
    existing.addedAt = oldestTimestamp(existing.addedAt, document.addedAt);
    if (document.lastReviewedAt && (!existing.lastReviewedAt || parseTimestamp(document.lastReviewedAt) > parseTimestamp(existing.lastReviewedAt))) {
      existing.lastReviewedAt = document.lastReviewedAt;
    }
  });
  const textBudgetCandidates = [...documentsById.values()]
    .map((document, index) => makeDocumentRetentionCandidate(document, index))
    .sort((left, right) => compareDocumentRetention(right, left));
  let remainingDocumentText = MAX_GRAPH_DOCUMENT_CHARS;
  let aggregateDocumentTextTruncation = 0;
  const boundedTextDocuments = [];
  for (const candidate of textBudgetCandidates) {
    if (candidate.document.text.length > remainingDocumentText) {
      aggregateDocumentTextTruncation += 1;
      continue;
    }
    boundedTextDocuments.push(candidate);
    remainingDocumentText -= candidate.document.text.length;
  }
  truncated.documentText = Math.max(truncated.documentText, aggregateDocumentTextTruncation);
  graph.documents = boundedTextDocuments
    .sort((left, right) => left.index - right.index)
    .map(({ document }) => document);
  const normalizedTruncated = { ...truncated };
  if (!normalizedTruncated.documentText) delete normalizedTruncated.documentText;
  if (!normalizedTruncated.documentTitle) delete normalizedTruncated.documentTitle;
  if (!normalizedTruncated.evidenceText) delete normalizedTruncated.evidenceText;
  if (!normalizedTruncated.evidenceItems) delete normalizedTruncated.evidenceItems;
  if (!normalizedTruncated.sourceReferences) delete normalizedTruncated.sourceReferences;
  if (!normalizedTruncated.aliases) delete normalizedTruncated.aliases;
  graph.integrity = {
    ambiguousSourceIds: [...ambiguousSourceIds].sort(lexicalCompare).slice(0, MAX_AMBIGUOUS_SOURCE_IDS),
    ambiguousEdgeIds: [...ambiguousEdgeIds].sort(lexicalCompare).slice(0, MAX_AMBIGUOUS_EDGE_IDS),
    ...(Object.values(normalizedTruncated).some((count) => count > 0) ? { truncated: normalizedTruncated } : {}),
    ...(Object.values(dropped).some((count) => count > 0) ? { dropped } : {})
  };
  const normalizedNodes = boundedNodes.filter((node) => node && typeof node === "object" && asText(node.id).trim()).map((node) => ({
    id: normalizeId(node.id),
    label: sliceTextAtCodePointBoundary(asLine(node.label, "Unnamed concept"), MAX_CONCEPT_LABEL_CHARS),
    aliases: normalizeAliases(node.aliases),
    type: sliceTextAtCodePointBoundary(asLine(node.type, "concept"), 30),
    confidence: asConfidence(node.confidence),
    mentions: asBoundedCounter(node.mentions, 1, 1, MAX_NODE_MENTIONS),
    feedback: asBoundedCounter(node.feedback, 0, -MAX_FEEDBACK_COUNT, MAX_FEEDBACK_COUNT),
    status: ["inferred", "accepted", "rejected"].includes(node.status) ? node.status : "inferred",
    sources: normalizeSourceIds(node.sources),
    evidence: normalizeEvidence(node.evidence, normalizeSourceIds(node.sources)),
    createdAt: asDateTime(node.createdAt, graphFallbackTimestamp),
    updatedAt: asDateTime(node.updatedAt, graphFallbackTimestamp),
    lastReviewedAt: asDateTime(node.lastReviewedAt)
  }));
  const nodesById = new Map();
  let aliasMergeTruncation = 0;
  normalizedNodes.forEach((node) => {
    const existing = nodesById.get(node.id);
    if (!existing) {
      nodesById.set(node.id, node);
      return;
    }
    if (existing.status !== node.status) conflictingNodeIds.add(node.id);
    const labels = [...new Set([existing.label, node.label, ...existing.aliases, ...node.aliases])];
    const existingUpdatedAt = parseTimestamp(existing.updatedAt);
    const incomingUpdatedAt = parseTimestamp(node.updatedAt);
    const incomingIsCanonical = incomingUpdatedAt > existingUpdatedAt
      || (incomingUpdatedAt === existingUpdatedAt && lexicalCompare(node.label, existing.label) < 0);
    if (incomingIsCanonical) {
      existing.label = node.label;
      existing.type = node.type;
    }
    const mergedAliases = labels.filter((label) => slugify(label) !== slugify(existing.label)).sort(lexicalCompare);
    aliasMergeTruncation += Math.max(0, mergedAliases.length - MAX_ALIASES);
    existing.aliases = mergedAliases.slice(0, MAX_ALIASES);
    existing.sources = mergeSourceIds(existing.sources, node.sources);
    existing.evidence = mergeEvidence(existing.evidence, node.evidence);
    existing.mentions = Math.min(MAX_NODE_MENTIONS, existing.mentions + node.mentions);
    existing.feedback = Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, existing.feedback + node.feedback));
    existing.confidence = Math.max(existing.confidence, node.confidence);
    if (existing.status !== "accepted" && node.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && node.status === "rejected") existing.status = "rejected";
    existing.lastReviewedAt = newestTimestamp(existing.lastReviewedAt, node.lastReviewedAt);
    existing.updatedAt = newestTimestamp(existing.updatedAt, node.updatedAt);
    existing.createdAt = oldestTimestamp(existing.createdAt, node.createdAt);
  });
  graph.nodes = [...nodesById.values()];
  if (aliasMergeTruncation > 0) {
    graph.integrity = {
      ...graph.integrity,
      truncated: {
        ...(graph.integrity.truncated || {}),
        aliases: Math.min(
          Number.MAX_SAFE_INTEGER,
          (graph.integrity.truncated?.aliases || 0) + aliasMergeTruncation
        )
      }
    };
  }
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const boundedEdges = asBoundedArray(value.edges, MAX_GRAPH_EDGES);
  dropped.edges = Math.max(
    dropped.edges,
    boundedEdges.filter((edge) => !edge || typeof edge !== "object" || !nodeIds.has(normalizeId(edge.source)) || !nodeIds.has(normalizeId(edge.target))).length
  );
  const normalizedEdges = boundedEdges.filter((edge) => edge && typeof edge === "object" && nodeIds.has(normalizeId(edge.source)) && nodeIds.has(normalizeId(edge.target))).map((edge) => ({
    id: normalizeId(edge.id) || makeEdgeId(normalizeId(edge.source), normalizeId(edge.target), asText(edge.label, "related-to")),
    source: normalizeId(edge.source),
    target: normalizeId(edge.target),
    label: sliceTextAtCodePointBoundary(asLine(edge.label, "related to"), MAX_RELATION_LABEL_CHARS),
    confidence: asConfidence(edge.confidence),
    feedback: asBoundedCounter(edge.feedback, 0, -MAX_FEEDBACK_COUNT, MAX_FEEDBACK_COUNT),
    evidence: normalizeEvidence(edge.evidence, normalizeSourceIds(edge.sources)),
    sources: normalizeSourceIds(edge.sources),
    status: ["inferred", "accepted", "rejected"].includes(edge.status) ? edge.status : "inferred",
    lastReviewedAt: asDateTime(edge.lastReviewedAt)
  }));
  const edgesByKey = new Map();
  const edgeIdAliasKeys = new Map();
  const edgeIdOwners = new Map();
  normalizedEdges.forEach((edge) => {
    const key = relationSemanticKey(edge.source, edge.target, edge.label);
    const semanticKey = key;
    const previousOwner = edgeIdOwners.get(edge.id);
    if (previousOwner && previousOwner !== semanticKey) ambiguousEdgeIds.add(edge.id);
    else edgeIdOwners.set(edge.id, semanticKey);
    const existing = edgesByKey.get(key);
    if (!existing) {
      edgesByKey.set(key, edge);
      return;
    }
    if (existing.status !== edge.status) {
      conflictingEdgeIds.add(existing.id);
      conflictingEdgeIds.add(edge.id);
    }
    const [source, target] = [existing.source, existing.target].sort(lexicalCompare);
    const ids = [existing.id, edge.id].sort(lexicalCompare);
    const labels = [existing.label, edge.label].sort((left, right) => lexicalCompare(left.toLowerCase(), right.toLowerCase()) || lexicalCompare(left, right));
    const canonical = {
      ...existing,
      id: ids[0],
      source,
      target,
      label: labels[0],
      sources: mergeSourceIds(existing.sources, edge.sources),
      evidence: mergeEvidence(existing.evidence, edge.evidence),
      feedback: Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, existing.feedback + edge.feedback)),
      confidence: Math.max(existing.confidence, edge.confidence),
      status: existing.status === "accepted" || edge.status === "accepted"
        ? "accepted"
        : existing.status === "rejected" || edge.status === "rejected"
          ? "rejected"
          : "inferred",
      lastReviewedAt: newestTimestamp(existing.lastReviewedAt, edge.lastReviewedAt)
    };
    const aliases = edgeIdAliasKeys.get(key) || new Set();
    [existing.id, edge.id].forEach((id) => aliases.add(id));
    edgeIdAliasKeys.set(key, aliases);
    edgesByKey.set(key, canonical);
  });
  graph.edges = makeUniqueEdgeIds([...edgesByKey.values()]);
  graph.integrity.ambiguousEdgeIds = [...ambiguousEdgeIds].sort(lexicalCompare).slice(0, MAX_AMBIGUOUS_EDGE_IDS);
  if (conflictingNodeIds.size) {
    graph.integrity.conflictingNodeIds = [...conflictingNodeIds].sort(lexicalCompare).slice(0, MAX_CONFLICTING_ITEM_IDS);
  } else {
    delete graph.integrity.conflictingNodeIds;
  }
  if (conflictingEdgeIds.size) {
    graph.integrity.conflictingEdgeIds = [...conflictingEdgeIds].sort(lexicalCompare).slice(0, MAX_CONFLICTING_ITEM_IDS);
  } else {
    delete graph.integrity.conflictingEdgeIds;
  }
  if (Object.values(dropped).some((count) => count > 0)) graph.integrity.dropped = dropped;
  graph.revisions = asBoundedArray(value.revisions, MAX_GRAPH_REVISIONS).filter((revision) => revision && typeof revision === "object").map((revision, index) => ({
    id: normalizeId(revision.id) || `rev-${graph.version}-${index}`,
    version: Number.isSafeInteger(revision.version) && revision.version >= 0 ? revision.version : 0,
    timestamp: asDateTime(revision.timestamp, graphFallbackTimestamp),
    reason: sliceTextAtCodePointBoundary(asLine(revision.reason, "Updated graph"), 200),
    operation: REVISION_OPERATIONS.has(revision.operation) ? revision.operation : "unknown",
    extractor: REVISION_EXTRACTORS.has(revision.extractor) ? revision.extractor : "unknown",
    nodes: Number.isInteger(revision.nodes) ? Math.max(0, Math.min(MAX_GRAPH_NODES, revision.nodes)) : graph.nodes.length,
    edges: Number.isInteger(revision.edges) ? Math.max(0, Math.min(MAX_GRAPH_EDGES, revision.edges)) : graph.edges.length
  }));
  graph.learning = normalizeLearning(value.learning);
  const edgeIdAliases = new Map();
  const canonicalEdgesByKey = new Map(graph.edges.map((edge) => [relationSemanticKey(edge.source, edge.target, edge.label), edge]));
  edgeIdAliasKeys.forEach((ids, key) => {
    const canonical = canonicalEdgesByKey.get(key);
    if (!canonical) return;
    ids.forEach((id) => {
      edgeIdAliases.set(id, canonical);
    });
  });
  if (edgeIdAliases.size) {
    graph.learning = normalizeLearning({
      examples: graph.learning.examples.map((example) => (
        example.kind === "relation"
          ? (() => {
            const canonical = !ambiguousEdgeIds.has(example.id)
              ? edgeIdAliases.get(example.id)
              : canonicalEdgesByKey.get(relationSemanticKey(example.source, example.target, example.label));
            if (!canonical) return example;
            return {
              ...example,
              id: canonical.id,
              source: canonical.source,
              sourceLabel: graph.nodes.find((node) => node.id === canonical.source)?.label || canonical.source,
              target: canonical.target,
              targetLabel: graph.nodes.find((node) => node.id === canonical.target)?.label || canonical.target,
              label: canonical.label
            };
          })()
          : example
      ))
    });
  } else if (ambiguousEdgeIds.size) {
    graph.learning = normalizeLearning({
      examples: graph.learning.examples.map((example) => {
        if (example.kind !== "relation" || !ambiguousEdgeIds.has(example.id)) return example;
        const canonical = canonicalEdgesByKey.get(relationSemanticKey(example.source, example.target, example.label));
        if (!canonical) return example;
        return {
          ...example,
          id: canonical.id,
          source: canonical.source,
          sourceLabel: graph.nodes.find((node) => node.id === canonical.source)?.label || canonical.source,
          target: canonical.target,
          targetLabel: graph.nodes.find((node) => node.id === canonical.target)?.label || canonical.target,
          label: canonical.label
        };
      })
    });
  }
  if (wasMigrated) {
    graph.revisions.unshift({
      id: `rev-migration-${slugify(value.schema)}-${graph.version}`,
      version: graph.version,
      timestamp: graphFallbackTimestamp,
      reason: `Migrated ${value.schema} to ${GRAPH_SCHEMA}`,
      operation: "migration",
      nodes: graph.nodes.length,
      edges: graph.edges.length
    });
    graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  }
  if (graph.redacted === true) {
    graph.documents = graph.documents.map((document) => ({ ...document, text: "", uri: null }));
    const redactEvidence = (item) => ({
      ...item,
      ...(Array.isArray(item.evidence)
        ? { evidence: item.evidence.map((evidence) => ({ ...evidence, text: "[redacted]" })) }
        : {})
    });
    graph.nodes = graph.nodes.map(redactEvidence);
    graph.edges = graph.edges.map(redactEvidence);
    graph.learning.examples = graph.learning.examples.map(redactEvidence);
  }
  return graph;
}

export function canonicalizeGraphForExport(value) {
  const graph = normalizeGraph(value);
  return {
    ...graph,
    documents: [...graph.documents].sort((left, right) => lexicalCompare(
      `${left.id}\u0000${left.fingerprint}\u0000${left.title}`,
      `${right.id}\u0000${right.fingerprint}\u0000${right.title}`
    )),
    nodes: [...graph.nodes].sort((left, right) => lexicalCompare(left.id, right.id)),
    edges: [...graph.edges].sort((left, right) => lexicalCompare(
      `${relationSemanticKey(left.source, left.target, left.label)}\u0000${left.id}`,
      `${relationSemanticKey(right.source, right.target, right.label)}\u0000${right.id}`
    ))
  };
}

export function buildBackupEnvelope(value, history = [], { appVersion = "unknown" } = {}) {
  if (!Array.isArray(history)) throw new TypeError("Backup history must be an array.");
  if (history.length > MAX_BACKUP_HISTORY) {
    throw new RangeError(`Backup history cannot contain more than ${MAX_BACKUP_HISTORY} snapshots.`);
  }
  const graph = canonicalizeGraphForExport(value);
  const canonicalHistory = history.map(canonicalizeGraphForExport);
  const normalizedVersion = typeof appVersion === "string" && appVersion.trim()
    ? sliceTextAtCodePointBoundary(appVersion.trim(), MAX_PRODUCER_VERSION_CHARS)
    : "unknown";
  return {
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    appVersion: normalizedVersion,
    graph,
    history: canonicalHistory,
    graphFingerprint: fingerprintBackup(graph, canonicalHistory)
  };
}

export function buildGraphExport(value, { appVersion = "unknown" } = {}) {
  const graph = canonicalizeGraphForExport(value);
  const normalizedVersion = typeof appVersion === "string" && appVersion.trim()
    ? sliceTextAtCodePointBoundary(appVersion.trim(), MAX_PRODUCER_VERSION_CHARS)
    : "unknown";
  return {
    ...graph,
    graphFingerprint: fingerprintBackup(graph),
    appVersion: normalizedVersion
  };
}

const cleanPhrase = (value) => value.replace(/^#+\s*/, "").replace(/[`"'“”()[\]{}]/g, "").replace(/\s+/g, " ").trim().replace(/^(the|a|an)\s+/i, "").replace(/[.,;:!?]+$/, "");
const wordSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("und", { granularity: "word" })
  : null;
const wordsIn = (value) => {
  const normalized = value.normalize("NFKC");
  let words;
  if (wordSegmenter && normalized.length <= MAX_SEGMENTER_CHARS && /[^\x00-\x7F]/.test(normalized)) {
    words = [...wordSegmenter.segment(normalized)]
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment)
      .slice(0, MAX_WORDS_PER_UNIT);
  } else {
    words = [];
    const pattern = /\p{Letter}[\p{Letter}\p{Number}_-]{1,}/gu;
    let match;
    while (words.length < MAX_WORDS_PER_UNIT && (match = pattern.exec(normalized))) words.push(match[0]);
  }
  return [...new Set(words.map((word) => word.toLowerCase()).filter((word) => word.length >= 2 && /\p{Letter}/u.test(word) && !stopWords.has(word)))].slice(0, MAX_WORDS_PER_UNIT);
};

function feedbackHints(value) {
  const concepts = new Map();
  const ambiguousConceptKeys = new Set();
  const relations = [];
  const indexConcept = (key, hint) => {
    if (!key || ambiguousConceptKeys.has(key)) return;
    const previous = concepts.get(key);
    if (previous && previous.id !== hint.id) {
      concepts.delete(key);
      ambiguousConceptKeys.add(key);
      return;
    }
    concepts.set(key, hint);
  };
  asArray(value).slice(0, MAX_FEEDBACK_EXAMPLES).forEach((example) => {
    if (!example || typeof example !== "object") return;
    const status = ["accepted", "rejected"].includes(example.status) ? example.status : null;
    if (!status) return;
    if (example.kind === "concept") {
      const label = sliceTextAtCodePointBoundary(cleanPhrase(asLine(example.label)), MAX_CONCEPT_LABEL_CHARS);
      const id = normalizeId(asText(example.id)) || slugify(label);
      if (!id || !label) return;
      const aliases = normalizeAliases(example.aliases);
      const keys = [...new Set([id, slugify(label), ...aliases.map((alias) => slugify(alias)).filter(Boolean)])];
      const hint = {
        id,
        label,
        aliases,
        status
      };
      keys.forEach((key) => indexConcept(key, hint));
      return;
    }
    if (example.kind === "relation") {
      const label = sliceTextAtCodePointBoundary(cleanPhrase(asLine(example.label)), MAX_RELATION_LABEL_CHARS);
      const sourceLabel = sliceTextAtCodePointBoundary(cleanPhrase(asLine(example.sourceLabel, example.source)), MAX_CONCEPT_LABEL_CHARS);
      const targetLabel = sliceTextAtCodePointBoundary(cleanPhrase(asLine(example.targetLabel, example.target)), MAX_CONCEPT_LABEL_CHARS);
      const source = normalizeId(asText(example.source)) || slugify(sourceLabel);
      const target = normalizeId(asText(example.target)) || slugify(targetLabel);
      if (label && source && target) relations.push({
        source,
        sourceLabel: slugify(sourceLabel),
        target,
        targetLabel: slugify(targetLabel),
        label,
        status
      });
    }
  });
  return { concepts, ambiguousConceptKeys, relations };
}

function applyRejectedFeedback(extraction, feedback) {
  const hints = feedbackHints(feedback);
  const rejectedConcepts = [...hints.concepts.values()].filter((hint) => hint.status === "rejected");
  const conceptTokens = (node) => new Set([
    node.id,
    node.label,
    ...(node.aliases || [])
  ].map((value) => slugify(value)).filter(Boolean));
  const rejectedNodeIds = new Set(
    extraction.nodes
      .filter((node) => rejectedConcepts.some((hint) => {
        const hintTokens = new Set([hint.id, hint.label, ...(hint.aliases || [])]
          .map((value) => slugify(value))
          .filter(Boolean));
        return [...conceptTokens(node)].some((token) => hintTokens.has(token));
      }))
      .map((node) => node.id)
  );
  const retainedNodes = extraction.nodes.filter((node) => !rejectedNodeIds.has(node.id));
  const nodesById = new Map(retainedNodes.map((node) => [node.id, node]));
  const endpointTokens = (id) => {
    const node = nodesById.get(id);
    return new Set([
      id,
      node?.label,
      ...(node?.aliases || [])
    ].map((value) => slugify(value)).filter(Boolean));
  };
  const rejectedRelations = hints.relations.filter((hint) => hint.status === "rejected");
  const relationRejected = (edge) => rejectedRelations.some((hint) => {
    const sourceTokens = endpointTokens(edge.source);
    const targetTokens = endpointTokens(edge.target);
    const hintSource = slugify(hint.source) || slugify(hint.sourceLabel);
    const hintTarget = slugify(hint.target) || slugify(hint.targetLabel);
    const hintLabel = slugify(hint.label);
    if (!hintSource || !hintTarget || !hintLabel || slugify(edge.label) !== hintLabel) return false;
    return (sourceTokens.has(hintSource) && targetTokens.has(hintTarget))
      || (sourceTokens.has(hintTarget) && targetTokens.has(hintSource));
  });
  return {
    ...extraction,
    nodes: retainedNodes,
    edges: extraction.edges.filter((edge) => (
      nodesById.has(edge.source)
      && nodesById.has(edge.target)
      && !relationRejected(edge)
    ))
  };
}

export function extractGraph(title, text, { feedback = [], sourceUri } = {}) {
  const boundedText = sliceTextAtCodePointBoundary(asText(text), MAX_DOCUMENT_CHARS);
  const sourceId = `doc-${fingerprintText(boundedText)}`;
  const markdownLines = boundedText.split(/\r?\n/).map((raw) => ({
    raw: raw.trim(),
    text: raw.trim()
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^>\s+/, "")
  }));
  const isMarkdownUnit = (raw) => /^(?:[-*+]\s+|\d+[.)]\s+|>\s+)/.test(raw);
  const splitPunctuated = (value) => value
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 25);
  const isHeadingUnit = (raw) => /^#{1,3}\s+/.test(raw);
  const punctuatedUnits = [
    ...splitPunctuated(markdownLines.filter(({ raw }) => !isMarkdownUnit(raw) && !isHeadingUnit(raw)).map(({ raw }) => raw).join(" ")),
    ...markdownLines.filter(({ raw }) => isMarkdownUnit(raw)).flatMap(({ text }) => splitPunctuated(text))
  ];
  const markdownLineUnits = markdownLines.filter(({ raw, text }) => text.length > 25 && !isHeadingUnit(raw)).map(({ text }) => text);
  const supplementalLineUnits = punctuatedUnits.length
    ? markdownLines.filter(({ raw, text }) => text.length > 25 && isMarkdownUnit(raw)).map(({ text }) => text)
    : markdownLineUnits;
  const sentences = [...new Set([
    ...supplementalLineUnits,
    ...punctuatedUnits
  ])]
    .slice(0, MAX_EXTRACTION_UNITS);
  const hints = feedbackHints(feedback);
  const rejectedConcepts = new Set([...hints.concepts.values()].filter((hint) => hint.status === "rejected").map((hint) => hint.id));
  const candidates = new Map();
  const addCandidate = (raw, kind, sentence = "") => {
    const label = cleanPhrase(raw);
    const rawId = slugify(label);
    if (!rawId || hints.ambiguousConceptKeys.has(rawId) || label.length < 2 || label.length > 64 || stopWords.has(rawId)) return;
    const hint = hints.concepts.get(rawId);
    const id = hint?.id || rawId;
    if (rejectedConcepts.has(id) || hint?.status === "rejected") return;
    const existing = candidates.get(id);
    const candidateLimit = kind === "term" ? MAX_EXTRACTION_TERM_CANDIDATES : MAX_EXTRACTION_CANDIDATES;
    if (!existing && candidates.size >= candidateLimit) return;
    const candidate = existing || { id, label: hint?.label || label, kind, mentions: 0, evidence: [] };
    candidate.mentions = Math.min(MAX_NODE_MENTIONS, candidate.mentions + 1);
    if (sentence && candidate.evidence.length < 8 && !candidate.evidence.includes(sentence)) candidate.evidence.push(sentence);
    if (kind === "heading" || kind === "quoted") candidate.kind = kind;
    if (hint?.status === "accepted") {
      candidate.feedback = "accepted";
      candidate.aliases = [...new Set([...(candidate.aliases || []), ...hint.aliases, label].filter((item) => item !== candidate.label))].slice(0, MAX_ALIASES);
    }
    candidates.set(id, candidate);
  };
  const searchableText = ` ${boundedText.toLowerCase().normalize("NFKC").replace(/[^\p{Letter}\p{Number}]+/gu, " ").replace(/\s+/g, " ")} `;
  [...hints.concepts.values()]
    .filter((hint) => hint.status === "accepted")
    .filter((hint, index, values) => values.findIndex((candidate) => candidate.id === hint.id) === index)
    .slice(0, MAX_ACTIVE_FEEDBACK_CONCEPTS)
    .forEach((hint) => {
      for (const term of [hint.label, ...hint.aliases]) {
        if (hints.ambiguousConceptKeys.has(slugify(term))) continue;
        const normalizedTerm = ` ${term.toLowerCase().normalize("NFKC").replace(/[^\p{Letter}\p{Number}]+/gu, " ").replace(/\s+/g, " ")} `;
        if (searchableText.includes(normalizedTerm)) {
          const evidenceSentence = sentences.find((sentence) => (
            ` ${sentence.toLowerCase().normalize("NFKC").replace(/[^\p{Letter}\p{Number}]+/gu, " ").replace(/\s+/g, " ")} `
          ).includes(normalizedTerm)) || "";
          addCandidate(term, "feedback", evidenceSentence);
          break;
        }
      }
  });
  const structuralPhrase = (value, fromEnd = false) => {
    const words = String(value).normalize("NFKC").match(/\p{Letter}[\p{Letter}\p{Number}_-]*/gu) || [];
    const selected = [];
    const ordered = fromEnd ? [...words].reverse() : words;
    for (const word of ordered) {
      const normalizedWord = word.toLowerCase();
      if (stopWords.has(normalizedWord)) {
        if (selected.length) break;
        continue;
      }
      selected.push(word);
      if (selected.length >= 4) break;
    }
    return (fromEnd ? selected.reverse() : selected).join(" ");
  };
  const structuralRelations = [];
  const passiveRelations = [];
  sentences.forEach((sentence) => {
    const match = sentence.match(/^(.*?)\s+\b(consists of|refers to|means|is|are)\b\s+(.*)$/i);
    const passiveMatch = sentence.match(
      /^(.*?)\s+\b(is|are|was|were)\b\s+(stored|ranked|used|encoded|decoded|represented|defined|organized|retrieved|selected|filtered|generated|produced|transformed|combined|limited|based)\s+\b(in|by|as|from|on|into|to)\b\s+(.*)$/i
    );
    if (passiveMatch) {
      const sourceLabel = cleanPhrase(passiveMatch[1]).replace(/^(the|a|an)\s+/i, "").trim();
      const targetLabel = structuralPhrase(passiveMatch[5]);
      if (sourceLabel && targetLabel && slugify(sourceLabel) !== slugify(targetLabel)) {
        addCandidate(sourceLabel, "structural", sentence);
        addCandidate(targetLabel, "structural", sentence);
        passiveRelations.push({
          sourceLabel,
          targetLabel,
          label: `${passiveMatch[3].toLowerCase()} ${passiveMatch[4].toLowerCase()}`,
          sentence,
          copula: passiveMatch[2].toLowerCase()
        });
      }
      return;
    }
    if (!match) return;
    if (["is", "are"].includes(match[2].toLowerCase()) && !/^\s+(?:an?|the)\b/i.test(match[3])) return;
    const sourceLabel = structuralPhrase(match[1], true);
    const targetLabel = structuralPhrase(match[3]);
    if (!sourceLabel || !targetLabel || slugify(sourceLabel) === slugify(targetLabel)) return;
    addCandidate(sourceLabel, "structural", sentence);
    addCandidate(targetLabel, "structural", sentence);
    structuralRelations.push({
      sourceLabel,
      targetLabel,
      label: match[2].toLowerCase(),
      sentence
    });
  });
  boundedText.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
    if (/^#{1,3}\s+/.test(line)) addCandidate(line, "heading", line);
    (line.match(/`([^`]+)`/g) || []).forEach((term) => addCandidate(term, "quoted", line));
  });
  sentences.forEach((sentence) => {
    (sentence.match(/\b[A-Z][a-zA-Z0-9-]*(?:\s+[A-Z][a-zA-Z0-9-]*){0,3}\b/g) || []).forEach((term) => addCandidate(term, "phrase", sentence));
    wordsIn(sentence).forEach((word) => addCandidate(word, "term", sentence));
    const normalizedSentence = sentence.normalize("NFKC");
    const phraseWords = [...normalizedSentence.matchAll(/\p{Letter}[\p{Letter}\p{Number}_-]*/gu)];
    let phraseCount = 0;
    for (let index = 0; index < phraseWords.length - 1 && phraseCount < MAX_PHRASE_CANDIDATES_PER_UNIT; index += 1) {
      const left = phraseWords[index][0];
      const right = phraseWords[index + 1][0];
      const between = normalizedSentence.slice(
        phraseWords[index].index + left.length,
        phraseWords[index + 1].index
      );
      const sentenceInitialCapital = index === 0 && left !== left.toLowerCase();
      if (
        left.length < 3
        || right.length < 3
        || !/^\s+$/.test(between)
        || (left !== left.toLowerCase() && !sentenceInitialCapital)
        || right !== right.toLowerCase()
        || phraseNoiseWords.has(left.toLowerCase())
        || phraseNoiseWords.has(right.toLowerCase())
        || phraseBoundaryWords.has(left.toLowerCase())
        || phraseBoundaryWords.has(right.toLowerCase())
      ) continue;
      addCandidate(`${left} ${right}`, "phrase", sentence);
      phraseCount += 1;
    }
  });
  const boundedTitle = cleanPhrase(asLine(title));
  if (!candidates.size
    && boundedTitle
    && boundedTitle.toLowerCase() !== "untitled document") {
    // A title is useful topic metadata for genuinely sparse documents, but it
    // is not source evidence: leave the evidence list empty instead of
    // pretending the title appeared in the document body.
    addCandidate(boundedTitle, "heading");
  }
  const allCandidates = [...candidates.values()];
  const reviewedEndpointKeys = new Set(
    hints.relations
      .filter((hint) => hint.status === "accepted")
      .flatMap((hint) => [hint.source, hint.target, hint.sourceLabel, hint.targetLabel])
      .filter(Boolean)
      .map((value) => slugify(value))
  );
  // A one-off lowercase token is usually context vocabulary, not a durable
  // concept. Keep it only when the document is too sparse to produce a useful
  // graph; repeated terms, phrases, headings, quoted code, and reviewed
  // feedback endpoints remain eligible for the normal ranked representation.
  const meaningfulCandidates = allCandidates.filter((item) => (
    item.kind !== "term"
    || item.mentions > 1
    || reviewedEndpointKeys.has(item.id)
    || reviewedEndpointKeys.has(slugify(item.label))
  ));
  const phrasesByPrefix = new Map();
  meaningfulCandidates
    .filter((item) => item.label.includes(" "))
    .forEach((item) => {
      const prefix = item.label.toLowerCase().split(/\s+/, 1)[0];
      const phrases = phrasesByPrefix.get(prefix) || [];
      phrases.push(item);
      phrasesByPrefix.set(prefix, phrases);
    });
  const rankedCandidates = meaningfulCandidates.filter((item) => {
    if (item.kind === "heading" || item.kind === "quoted" || item.kind === "feedback" || item.label.includes(" ")) return true;
    if (reviewedEndpointKeys.has(item.id) || reviewedEndpointKeys.has(slugify(item.label))) return true;
    return !(phrasesByPrefix.get(item.label.toLowerCase()) || []).some((other) => (
      other !== item
      && other.label.includes(" ")
      && other.evidence.length >= item.evidence.length
      && item.evidence.every((evidence) => other.evidence.includes(evidence))
    ));
  });
  const ranked = (rankedCandidates.length ? rankedCandidates : meaningfulCandidates.length ? meaningfulCandidates : allCandidates).sort((a, b) => {
    const kindScore = (item) => item.kind === "heading" ? 10 : item.kind === "quoted" ? 7 : item.label.includes(" ") ? 4 : 0;
    return (b.mentions * 3 + kindScore(b)) - (a.mentions * 3 + kindScore(a));
  }).slice(0, 18);
  const nodeIds = new Set(ranked.map((item) => item.id));
  const nodes = ranked.map((item) => ({
    id: item.id,
    label: item.label,
    type: item.kind === "heading" ? "topic" : "concept",
    aliases: item.aliases || [],
    confidence: Math.min(.96, .46 + item.mentions * .09 + (item.kind === "heading" ? .16 : 0) + (item.feedback === "accepted" ? .14 : 0)),
    mentions: item.mentions,
    feedback: 0,
    status: "inferred",
    sources: [sourceId],
    evidence: item.evidence.slice(0, 4).map((sentence) => ({ text: sentence, sources: [sourceId] })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
  const edges = [];
  const relationVerbPattern = "consists of|refers to|depends on|leads to|results in|is|are|uses|enables|requires|contains|allows|supports|creates|causes|prevents|triggers|mitigates|implies|gives|removes|means|improves|preserves|reduces|increases|measures|catches|guides|models|mixes|connects|organizes|remains|augments|combines|converts|decodes|enriches|encodes|feeds|filters|generates|limits|orders|predicts|produces|ranks|retrieves|selects|stores|transforms";
  const labelStart = (value, label) => {
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(value).match(new RegExp(`(?:^|[^\\p{Letter}\\p{Number}_-])(${escaped})(?=$|[^\\p{Letter}\\p{Number}_-])`, "iu"));
    return match ? (match.index + match[0].length - match[1].length) : -1;
  };
  const matchesHintEndpoint = (hint, item, endpoint) => {
    const labelKey = endpoint === "source" ? "sourceLabel" : "targetLabel";
    return hint[endpoint] === item.id
      || (hint[labelKey] && [item.label, ...(item.aliases || [])].some((label) => slugify(label) === hint[labelKey]));
  };
  sentences.forEach((sentence) => {
    const lowerSentence = sentence.toLowerCase();
    const present = ranked
      .filter((item) => nodeIds.has(item.id))
      .map((item) => ({ item, start: labelStart(lowerSentence, item.label.toLowerCase()) }))
      .filter((entry) => entry.start >= 0)
      .sort((a, b) => a.start - b.start || b.item.label.length - a.item.label.length)
      .filter((entry, index, entries) => index === entries.findIndex((candidate) => candidate.start === entry.start))
      .slice(0, 5)
      .map((entry) => entry.item);
    const presentPositions = present.map((item) => ({
      item,
      start: labelStart(lowerSentence, item.label.toLowerCase())
    }));
    const addExplicitRelation = (source, target, label) => {
      if (!source || !target || source.id === target.id) return;
      const relationHints = hints.relations.filter((hint) => (
        (matchesHintEndpoint(hint, source, "source") && matchesHintEndpoint(hint, target, "target"))
        || (matchesHintEndpoint(hint, source, "target") && matchesHintEndpoint(hint, target, "source"))
      ));
      const acceptedRelation = relationHints.find((hint) => hint.status === "accepted");
      const resolvedLabel = acceptedRelation?.label || label;
      if (relationHints.some((hint) => hint.status === "rejected" && slugify(hint.label) === slugify(resolvedLabel))) return;
      edges.push({
        source: source.id,
        target: target.id,
        label: resolvedLabel,
        id: makeEdgeId(source.id, target.id, resolvedLabel),
        confidence: Math.min(.96, .56 + Math.min(.35, (source.mentions + target.mentions) * .04) + (acceptedRelation ? .14 : 0)),
        feedback: 0,
        evidence: [{ text: sentence, sources: [sourceId] }],
        sources: [sourceId],
        status: "inferred"
      });
    };
    let previousExplicitRelation = null;
    for (const match of lowerSentence.matchAll(new RegExp(`\\b(${relationVerbPattern})\\b`, "gi"))) {
      const verbStart = match.index ?? -1;
      const verbEnd = verbStart + match[0].length;
      const passive = passiveRelations.find((relation) => (
        relation.sentence === sentence
        && relation.copula === match[1].toLowerCase()
        && labelStart(lowerSentence, relation.sourceLabel) >= 0
        && labelStart(lowerSentence, relation.targetLabel) >= 0
      ));
      if (passive && ["is", "are", "was", "were"].includes(match[1].toLowerCase())) {
        const source = present.find((item) => slugify(item.label) === slugify(passive.sourceLabel));
        const target = present.find((item) => slugify(item.label) === slugify(passive.targetLabel));
        addExplicitRelation(source, target, passive.label);
        previousExplicitRelation = { source, verbEnd };
        continue;
      }
      const textSincePreviousVerb = previousExplicitRelation
        ? lowerSentence.slice(previousExplicitRelation.verbEnd, verbStart)
        : "";
      const sharedSubject = previousExplicitRelation?.source
        && /\b(?:and|but)\s*$/i.test(textSincePreviousVerb);
      const source = sharedSubject
        ? previousExplicitRelation.source
        : presentPositions.filter(({ start }) => start >= 0 && start < verbStart).at(-1)?.item;
      const target = presentPositions.find(({ start }) => start >= verbEnd)?.item;
      addExplicitRelation(source, target, match[1].toLowerCase());
      previousExplicitRelation = { source, verbEnd };
    }
    structuralRelations
      .filter((relation) => relation.sentence === sentence)
      .forEach((relation) => {
        const source = present.find((item) => slugify(item.label) === slugify(relation.sourceLabel));
        const target = present.find((item) => slugify(item.label) === slugify(relation.targetLabel));
        addExplicitRelation(source, target, relation.label);
      });
    for (let index = 0; index < present.length - 1; index += 1) {
      const left = present[index];
      const right = present[index + 1];
      const leftEnd = labelStart(lowerSentence, left.label.toLowerCase()) + left.label.length;
      const rightStart = labelStart(lowerSentence.slice(leftEnd), right.label.toLowerCase()) + leftEnd;
      const between = rightStart >= leftEnd ? sentence.slice(leftEnd, rightStart) : "";
      const passive = passiveRelations.find((relation) => (
        relation.sentence === sentence
        && slugify(relation.sourceLabel) === slugify(left.label)
        && slugify(relation.targetLabel) === slugify(right.label)
      ));
      if (passive) {
        addExplicitRelation(left, right, passive.label);
        continue;
      }
      const relationMatch = between.match(new RegExp(`\\b(${relationVerbPattern})\\b`, "i"));
      if (relationMatch && /\b(and|while|but)\b/i.test(between)) continue;
      const relationHints = hints.relations.filter((hint) => (
        (matchesHintEndpoint(hint, left, "source") && matchesHintEndpoint(hint, right, "target"))
        || (matchesHintEndpoint(hint, left, "target") && matchesHintEndpoint(hint, right, "source"))
      ));
      const acceptedRelation = relationHints.find((hint) => hint.status === "accepted");
      const multilingualSentence = present.some((item) => /[^\x00-\x7F]/.test(item.label));
      if (present.length > 2 && !acceptedRelation && !relationMatch && !multilingualSentence) continue;
      const label = acceptedRelation?.label || (relationMatch ? relationMatch[1].toLowerCase() : "co-mentioned with");
      const rejectedRelation = relationHints.find((hint) => hint.status === "rejected" && slugify(hint.label) === slugify(label));
      if (rejectedRelation) continue;
      edges.push({
        source: left.id,
        target: right.id,
        label,
        id: makeEdgeId(left.id, right.id, label),
        confidence: Math.min(.96, .52 + Math.min(.35, (left.mentions + right.mentions) * .04) + (acceptedRelation ? .14 : 0)),
        feedback: 0,
        evidence: [{ text: sentence, sources: [sourceId] }],
        sources: [sourceId],
        status: "inferred"
      });
    }
    hints.relations
      .map((hint) => ({
        hint,
        source: present.find((item) => matchesHintEndpoint(hint, item, "source")),
        target: present.find((item) => matchesHintEndpoint(hint, item, "target"))
      }))
      .filter(({ hint, source, target }) => hint.status === "accepted" && source && target && source.id !== target.id)
      .forEach(({ hint, source, target }) => {
        const key = relationSemanticKey(source.id, target.id, hint.label);
        if (edges.some((edge) => relationSemanticKey(edge.source, edge.target, edge.label) === key)) return;
        edges.push({
          source: source.id,
          target: target.id,
          label: hint.label,
          id: makeEdgeId(source.id, target.id, hint.label),
          confidence: .82,
          feedback: 0,
          evidence: [{ text: sentence, sources: [sourceId] }],
          sources: [sourceId],
          status: "inferred"
        });
      });
  });
  return normalizeExtraction({
    source: { id: sourceId, title: title || "Untitled document", text: boundedText, uri: normalizeSourceUri(sourceUri) },
    nodes,
    edges
  });
}

export function mergeExtraction(graph, extraction, { revisionReason, revisionOperation = "ingest", revisionExtractor = "unknown" } = {}) {
  graph = normalizeGraph(graph);
  extraction = normalizeExtraction(extraction);
  const importLimit = importIntegrityLimit(graph);
  if (importLimit) return { graph, duplicate: false, limited: importLimit };
  const duplicate = graph.documents.some((document) => (
    sameDocumentContent(document, extraction.source)
  ));
  if (duplicate) return { graph, duplicate: true };
  const conflictingSource = graph.documents.find((document) => (
    document.id === extraction.source.id
    && (document.text !== extraction.source.text || document.fingerprint !== extraction.source.fingerprint)
  ));
  if (conflictingSource) {
    let repairedSourceId = normalizeExtraction({
      source: { title: extraction.source.title, text: extraction.source.text },
      nodes: [],
      edges: []
    }).source.id;
    if (graph.documents.some((document) => document.id === repairedSourceId)) {
      const collisionDigest = identityDigest(`${extraction.source.id}\u0000${extraction.source.fingerprint}\u0000${extraction.source.text}`);
      const collisionBase = repairedSourceId;
      let collisionIndex = 1;
      do {
        repairedSourceId = appendIdSuffix(collisionBase, `${collisionDigest}-${collisionIndex}`);
        collisionIndex += 1;
      } while (graph.documents.some((document) => document.id === repairedSourceId));
    }
    const rebindSources = (sources) => [...new Set(sources.map((sourceId) => sourceId === extraction.source.id ? repairedSourceId : sourceId))];
    extraction = {
      ...extraction,
      source: { ...extraction.source, id: repairedSourceId },
      nodes: extraction.nodes.map((node) => ({
        ...node,
        sources: rebindSources(node.sources),
        evidence: node.evidence.map((evidence) => ({ ...evidence, sources: rebindSources(evidence.sources) }))
      })),
      edges: extraction.edges.map((edge) => ({
        ...edge,
        sources: rebindSources(edge.sources),
        evidence: edge.evidence.map((evidence) => ({ ...evidence, sources: rebindSources(evidence.sources) }))
      }))
    };
  }
  if (graph.documents.length >= MAX_GRAPH_DOCUMENTS) return { graph, duplicate: false, limited: "documents" };
  const currentDocumentChars = graph.documents.reduce((total, document) => total + document.text.length, 0);
  if (currentDocumentChars + extraction.source.text.length > MAX_GRAPH_DOCUMENT_CHARS) {
    return { graph, duplicate: false, limited: "document-text" };
  }
  if (!canAdvanceGraphVersion(graph)) return { graph, duplicate: false, limited: "version" };
  const now = new Date().toISOString();
  const cloneEvidence = (evidence) => evidence.map((item) => ({ text: item.text, sources: [...item.sources] }));
  const cloneNode = (node) => ({
    ...node,
    aliases: [...(node.aliases || [])],
    sources: [...node.sources],
    evidence: cloneEvidence(node.evidence)
  });
  const cloneEdge = (edge) => ({
    ...edge,
    sources: [...edge.sources],
    evidence: cloneEvidence(edge.evidence)
  });
  // Build the candidate graph from copies. If a collection limit is reached,
  // callers receive the untouched normalized graph rather than a partially
  // mutated candidate that looks successful.
  const knownNodes = new Map(graph.nodes.map((node) => [node.id, cloneNode(node)]));
  const knownNodeAliases = new Map();
  const ambiguousNodeAliases = new Set();
  const indexNodeAlias = (label, node) => {
    const key = canonicalLabelKey(label);
    if (!key || ambiguousNodeAliases.has(key)) return;
    const previous = knownNodeAliases.get(key);
    if (previous && previous.id !== node.id) {
      knownNodeAliases.delete(key);
      ambiguousNodeAliases.add(key);
      return;
    }
    knownNodeAliases.set(key, node);
  };
  knownNodes.forEach((node) => {
    [node.label, ...(node.aliases || [])].forEach((label) => indexNodeAlias(label, node));
  });
  const incomingToKnown = new Map();
  extraction.nodes.forEach((incoming) => {
    const existing = knownNodes.get(incoming.id)
      || knownNodeAliases.get(incoming.id)
      || knownNodeAliases.get(canonicalLabelKey(incoming.label));
    incomingToKnown.set(incoming.id, existing?.id || incoming.id);
    if (existing) {
      existing.mentions = Math.min(MAX_NODE_MENTIONS, existing.mentions + incoming.mentions);
      existing.confidence = existing.status === "rejected"
        ? Math.max(.05, existing.confidence + Math.min(0, existing.feedback) * .02)
        : Math.min(.99, (existing.confidence + incoming.confidence) / 2 + .03 + Math.max(0, existing.feedback) * .015);
      existing.aliases = [...new Set([...(existing.aliases || []), ...(incoming.aliases || [])])]
        .sort(lexicalCompare)
        .slice(0, MAX_ALIASES);
      existing.sources = mergeSourceIds(existing.sources, incoming.sources);
      existing.evidence = mergeEvidence(existing.evidence, incoming.evidence);
      existing.lastReviewedAt = newestTimestamp(existing.lastReviewedAt, incoming.lastReviewedAt);
      existing.updatedAt = now;
      existing.aliases.forEach((alias) => indexNodeAlias(alias, existing));
    } else {
      knownNodes.set(incoming.id, incoming);
      [incoming.label, ...(incoming.aliases || [])].forEach((label) => indexNodeAlias(label, incoming));
    }
  });
  if (knownNodes.size > MAX_GRAPH_NODES) return { graph, duplicate: false, limited: "nodes" };
  const knownEdges = new Map(graph.edges.map((edge) => [relationSemanticKey(edge.source, edge.target, edge.label), cloneEdge(edge)]));
  extraction.edges.forEach((incoming) => {
    const source = incomingToKnown.get(incoming.source) || incoming.source;
    const target = incomingToKnown.get(incoming.target) || incoming.target;
    const key = relationSemanticKey(source, target, incoming.label);
    const existing = knownEdges.get(key);
    if (existing) {
      existing.confidence = existing.status === "rejected"
        ? Math.max(.05, existing.confidence + Math.min(0, existing.feedback) * .02)
        : Math.min(.99, existing.confidence + .04 + Math.max(0, existing.feedback) * .015);
      existing.evidence = mergeEvidence(existing.evidence, incoming.evidence);
      existing.sources = mergeSourceIds(existing.sources, incoming.sources);
      existing.lastReviewedAt = newestTimestamp(existing.lastReviewedAt, incoming.lastReviewedAt);
    } else {
      knownEdges.set(key, { ...incoming, source, target, id: makeEdgeId(source, target, incoming.label) });
    }
  });
  if (knownEdges.size > MAX_GRAPH_EDGES) return { graph, duplicate: false, limited: "edges" };
  delete graph.redacted;
  graph.documents.push(extraction.source);
  graph.nodes = [...knownNodes.values()];
  graph.edges = makeUniqueEdgeIds([...knownEdges.values()].filter((edge) => knownNodes.has(edge.source) && knownNodes.has(edge.target)));
  advanceGraphVersion(graph);
  graph.updatedAt = now;
  graph.revisions.unshift({
    id: `rev-${graph.version}`,
    version: graph.version,
    timestamp: now,
    reason: revisionReason || `Ingested ${extraction.source.title}`,
    operation: REVISION_OPERATIONS.has(revisionOperation) ? revisionOperation : "ingest",
    extractor: REVISION_EXTRACTORS.has(revisionExtractor) ? revisionExtractor : "unknown",
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  return { graph, duplicate: false };
}

export function replaceSource(value, sourceId, extraction, {
  revisionExtractor = "unknown",
  preserveSourceCategories = false,
  preservedLearningDecisionKeys = new Set(),
  preserveSourceContent = false
} = {}) {
  const graph = normalizeGraph(value);
  const importLimit = importIntegrityLimit(graph);
  if (importLimit) return { graph, replaced: false, limited: importLimit };
  const normalizedSourceId = normalizeId(sourceId);
  if (graph.integrity.ambiguousSourceIds.includes(normalizedSourceId)) {
    return { graph, replaced: false, ambiguous: true };
  }
  const source = graph.documents.find((document) => document.id === normalizedSourceId);
  if (!source) return { graph, replaced: false };
  if (!canAdvanceGraphVersion(graph)) return { graph, replaced: false, limited: "version" };
  let normalizedExtraction = normalizeExtraction(extraction);
  const duplicate = graph.documents.some((document) => document.id !== normalizedSourceId && (
    sameDocumentContent(document, normalizedExtraction.source)
  ));
  if (duplicate) return { graph, replaced: false, duplicate: true };
  const sourceContributionCounts = (candidate) => ({
    nodes: candidate.nodes.filter((node) => (
      Array.isArray(node.sources) && node.sources.includes(normalizedSourceId)
    )).length,
    edges: candidate.edges.filter((edge) => (
      Array.isArray(edge.sources) && edge.sources.includes(normalizedSourceId)
    )).length
  });
  const previousSourceContributionCounts = sourceContributionCounts(graph);
  const incomingSourceId = normalizedExtraction.source.id;
  const rebindSource = (candidate) => candidate === incomingSourceId ? normalizedSourceId : candidate;
  normalizedExtraction = {
    ...normalizedExtraction,
    source: {
      ...normalizedExtraction.source,
      id: normalizedSourceId,
      ...(preserveSourceContent ? {
        title: source.title,
        text: source.text,
        fingerprint: source.fingerprint
      } : {}),
      addedAt: source.addedAt,
      uri: preserveSourceContent
        ? source.uri
        : normalizedExtraction.source.uri || source.uri || null,
      quality: source.quality,
      lastReviewedAt: null
    },
    nodes: normalizedExtraction.nodes.map((node) => ({
      ...node,
      sources: node.sources.map(rebindSource),
      evidence: node.evidence.map((evidence) => ({ ...evidence, sources: evidence.sources.map(rebindSource) }))
    })),
    edges: normalizedExtraction.edges.map((edge) => ({
      ...edge,
      sources: edge.sources.map(rebindSource),
      evidence: edge.evidence.map((evidence) => ({ ...evidence, sources: evidence.sources.map(rebindSource) }))
    }))
  };
  const acceptedNodeIds = new Set(graph.nodes.filter((node) => node.status === "accepted" && node.sources.includes(normalizedSourceId)).map((node) => node.id));
  const acceptedEdgeIds = new Set(graph.edges.filter((edge) => edge.status === "accepted" && edge.sources.includes(normalizedSourceId)).map((edge) => edge.id));
  const learningDecisionKey = (example) => `${example.kind === "concept" ? "node" : "edge"}|${example.id}`;
  const preservedLearningExamples = graph.learning.examples
    .filter((example) => preservedLearningDecisionKeys instanceof Set
      && preservedLearningDecisionKeys.has(learningDecisionKey(example)));
  const removed = removeSource(graph, normalizedSourceId, { recordRevision: false });
  const learningExamples = new Map(removed.graph.learning.examples.map((example) => [learningDecisionKey(example), example]));
  preservedLearningExamples.forEach((example) => learningExamples.set(learningDecisionKey(example), example));
  removed.graph.learning.examples = retainNewestLearningExamples([...learningExamples.values()]);
  removed.graph.nodes = removed.graph.nodes.map((node) => acceptedNodeIds.has(node.id)
    ? { ...node, sources: mergeSourceIds(node.sources, [normalizedSourceId]) }
    : node);
  removed.graph.edges = removed.graph.edges.map((edge) => acceptedEdgeIds.has(edge.id)
    ? { ...edge, sources: mergeSourceIds(edge.sources, [normalizedSourceId]) }
    : edge);
  const merged = mergeExtraction(removed.graph, normalizedExtraction, {
    revisionReason: `Replaced ${source.title} with ${normalizedExtraction.source.title}`,
    revisionOperation: "rebuild",
    revisionExtractor
  });
  if (merged.limited || merged.duplicate) return { graph, replaced: false, limited: merged.limited, duplicate: merged.duplicate };
  const replacementSourceContributionCounts = sourceContributionCounts(merged.graph);
  const degradedCategories = [
    previousSourceContributionCounts.nodes > 0 && replacementSourceContributionCounts.nodes === 0 ? "concepts" : null,
    previousSourceContributionCounts.edges > 0 && replacementSourceContributionCounts.edges === 0 ? "relations" : null
  ].filter(Boolean);
  if (degradedCategories.length === 2 || (preserveSourceCategories && degradedCategories.length)) {
    return {
      graph,
      replaced: false,
      empty: degradedCategories.length === 2,
      degraded: degradedCategories,
      removedNodes: removed.removedNodes,
      removedEdges: removed.removedEdges
    };
  }
  return {
    ...merged,
    replaced: true,
    replacedSourceId: normalizedSourceId,
    removedNodes: removed.removedNodes,
    removedEdges: removed.removedEdges
  };
}

function diffSummary(kind, item) {
  if (kind === "document") {
    return {
      id: item.id,
      title: item.title,
      fingerprint: item.fingerprint,
      uri: item.uri,
      quality: item.quality,
      lastReviewedAt: item.lastReviewedAt,
      addedAt: item.addedAt
    };
  }
  if (kind === "node") {
    return {
      id: item.id,
      label: item.label,
      aliases: item.aliases,
      status: item.status,
      confidence: item.confidence,
      mentions: item.mentions,
      feedback: item.feedback,
      lastReviewedAt: item.lastReviewedAt,
      sources: item.sources,
      evidenceCount: item.evidence.length
    };
  }
  if (kind === "learning") {
    return {
      id: `${item.kind}:${item.id}`,
      kind: item.kind,
      identity: item.id,
      label: item.label,
      aliases: item.aliases,
      source: item.source,
      target: item.target,
      status: item.status,
      lastReviewedAt: item.lastReviewedAt
    };
  }
  return {
    id: item.id,
    source: item.source,
    target: item.target,
    label: item.label,
    status: item.status,
    confidence: item.confidence,
    feedback: item.feedback,
    lastReviewedAt: item.lastReviewedAt,
    sources: item.sources,
    evidenceCount: item.evidence.length
  };
}

function diffCollection(beforeItems, afterItems, kind) {
  const before = new Map(beforeItems.map((item) => [item.id, diffSummary(kind, item)]));
  const after = new Map(afterItems.map((item) => [item.id, diffSummary(kind, item)]));
  const added = [];
  const removed = [];
  const changed = [];
  [...after.keys()].sort().forEach((id) => {
    if (!before.has(id)) added.push(after.get(id));
    else if (JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))) {
      changed.push({ id, before: before.get(id), after: after.get(id) });
    }
  });
  [...before.keys()].sort().forEach((id) => {
    if (!after.has(id)) removed.push(before.get(id));
  });
  return { added, removed, changed };
}

function diffStringSet(beforeValues, afterValues) {
  const before = new Set(beforeValues);
  const after = new Set(afterValues);
  return {
    added: [...after].filter((value) => !before.has(value)).sort(),
    removed: [...before].filter((value) => !after.has(value)).sort()
  };
}

const INTEGRITY_DIAGNOSTIC_KEYS = ["documents", "nodes", "edges", "revisions", "learningExamples", "documentTitle", "documentText", "evidenceText", "evidenceItems", "sourceReferences", "aliases"];
function diffIntegrityCounts(beforeValue, afterValue) {
  const normalizeCounts = (value) => Object.fromEntries(INTEGRITY_DIAGNOSTIC_KEYS.map((key) => [
    key,
    Number.isSafeInteger(value?.[key]) && value[key] >= 0 ? value[key] : 0
  ]));
  const before = normalizeCounts(beforeValue);
  const after = normalizeCounts(afterValue);
  return {
    before,
    after,
    changed: JSON.stringify(before) !== JSON.stringify(after)
  };
}

export function diffGraphs(beforeValue, afterValue) {
  const before = normalizeGraph(beforeValue);
  const after = normalizeGraph(afterValue);
  const documents = diffCollection(before.documents, after.documents, "document");
  const nodes = diffCollection(before.nodes, after.nodes, "node");
  const edges = diffCollection(before.edges, after.edges, "edge");
  const learning = diffCollection(before.learning.examples, after.learning.examples, "learning");
  const integrity = {
    ambiguousSourceIds: diffStringSet(before.integrity.ambiguousSourceIds, after.integrity.ambiguousSourceIds),
    ambiguousEdgeIds: diffStringSet(before.integrity.ambiguousEdgeIds, after.integrity.ambiguousEdgeIds),
    conflictingNodeIds: diffStringSet(before.integrity.conflictingNodeIds || [], after.integrity.conflictingNodeIds || []),
    conflictingEdgeIds: diffStringSet(before.integrity.conflictingEdgeIds || [], after.integrity.conflictingEdgeIds || []),
    truncated: diffIntegrityCounts(before.integrity.truncated, after.integrity.truncated),
    dropped: diffIntegrityCounts(before.integrity.dropped, after.integrity.dropped)
  };
  const redaction = {
    before: before.redacted === true,
    after: after.redacted === true,
    changed: (before.redacted === true) !== (after.redacted === true)
  };
  const summary = {
    added: documents.added.length + nodes.added.length + edges.added.length + learning.added.length
      + integrity.ambiguousSourceIds.added.length + integrity.ambiguousEdgeIds.added.length
      + integrity.conflictingNodeIds.added.length + integrity.conflictingEdgeIds.added.length,
    removed: documents.removed.length + nodes.removed.length + edges.removed.length + learning.removed.length
      + integrity.ambiguousSourceIds.removed.length + integrity.ambiguousEdgeIds.removed.length
      + integrity.conflictingNodeIds.removed.length + integrity.conflictingEdgeIds.removed.length,
    changed: documents.changed.length + nodes.changed.length + edges.changed.length + learning.changed.length
      + (integrity.truncated.changed ? 1 : 0)
      + (integrity.dropped.changed ? 1 : 0)
      + (redaction.changed ? 1 : 0)
  };
  return {
    format: DIFF_FORMAT,
    graphSchema: GRAPH_SCHEMA,
    fromVersion: before.version,
    toVersion: after.version,
    fromFingerprint: fingerprintBackup(before),
    toFingerprint: fingerprintBackup(after),
    documents,
    nodes,
    edges,
    learning,
    integrity,
    redaction,
    summary,
    changed: summary.added > 0 || summary.removed > 0 || summary.changed > 0
  };
}

export function redactGraph(value) {
  const graph = normalizeGraph(value);
  graph.documents = graph.documents.map((document) => ({
    ...document,
    title: "Redacted source",
    text: "",
    uri: null
  }));
  const redactEvidence = (item) => ({
    ...item,
    ...(Array.isArray(item.evidence)
      ? { evidence: item.evidence.map((evidence) => ({ ...evidence, text: "[redacted]" })) }
      : {})
  });
  graph.nodes = graph.nodes.map(redactEvidence);
  graph.edges = graph.edges.map(redactEvidence);
  graph.learning.examples = graph.learning.examples.map(redactEvidence);
  graph.redacted = true;
  return graph;
}

export function applyFeedback(value, kind, id, action) {
  const graph = normalizeGraph(value);
  const importLimit = importIntegrityLimit(graph);
  if (importLimit) return { graph, changed: false, limited: importLimit };
  const collection = kind === "node" ? graph.nodes : kind === "edge" ? graph.edges : null;
  if (!collection || !["restore", "up", "down"].includes(action)) {
    return { graph, changed: false };
  }
  const normalizedId = normalizeId(id);
  if (kind === "edge" && graph.integrity.ambiguousEdgeIds.includes(normalizedId)) {
    return { graph, changed: false, ambiguous: true };
  }
  const item = collection.find((candidate) => candidate.id === normalizedId);
  if (!item) return { graph, changed: false };
  if (!canAdvanceGraphVersion(graph)) return { graph, changed: false, limited: "version" };
  const subject = kind === "node" ? item.label : `relation ${item.label}`;
  const verb = action === "restore" ? "Restored" : action === "up" ? "Confirmed" : "Dismissed";
  mutateFeedbackItem(item, action);
  rememberLearningItem(graph, kind, item);
  appendRevision(graph, `${verb} ${subject}`, "feedback");
  return { graph, changed: true };
}

export function markSourceReviewed(value, sourceId) {
  const graph = normalizeGraph(value);
  const importLimit = importIntegrityLimit(graph);
  if (importLimit) return { graph, changed: false, limited: importLimit };
  const normalizedSourceId = normalizeId(sourceId);
  if (graph.integrity.ambiguousSourceIds.includes(normalizedSourceId)) {
    return { graph, changed: false, ambiguous: true };
  }
  const source = graph.documents.find((document) => document.id === normalizedSourceId);
  if (!source) return { graph, changed: false };
  const today = new Date().toISOString().slice(0, 10);
  const existingReviewedAt = parseTimestamp(source.lastReviewedAt);
  if (typeof source.lastReviewedAt === "string"
    && source.lastReviewedAt.slice(0, 10) === today
    && Number.isFinite(existingReviewedAt)
    && existingReviewedAt <= Date.now()) {
    return { graph, changed: false, alreadyReviewed: true };
  }
  if (!canAdvanceGraphVersion(graph)) return { graph, changed: false, limited: "version" };
  source.lastReviewedAt = new Date().toISOString();
  appendRevision(graph, `Reviewed source ${source.title}`, "manual");
  return { graph, changed: true };
}

export function mergeConcepts(value, sourceId, targetId) {
  const graph = normalizeGraph(value);
  const importLimit = importIntegrityLimit(graph);
  if (importLimit) return { graph, changed: false, limited: importLimit };
  const normalizedSourceId = normalizeId(sourceId);
  const normalizedTargetId = normalizeId(targetId);
  if (!normalizedSourceId || !normalizedTargetId || normalizedSourceId === normalizedTargetId) {
    return { graph, changed: false };
  }
  const source = graph.nodes.find((node) => node.id === normalizedSourceId);
  const target = graph.nodes.find((node) => node.id === normalizedTargetId);
  if (!source || !target) return { graph, changed: false };
  if (!canAdvanceGraphVersion(graph)) return { graph, changed: false, limited: "version" };

  const now = new Date().toISOString();
  const status = source.status === "accepted" || target.status === "accepted"
    ? "accepted"
    : source.status === "rejected" && target.status === "rejected"
      ? "rejected"
      : "inferred";
  target.aliases = [...new Set([
    ...(target.aliases || []),
    source.label,
    ...(source.aliases || [])
  ])]
    .filter((alias) => slugify(alias) !== slugify(target.label))
    .sort(lexicalCompare)
    .slice(0, MAX_ALIASES);
  target.sources = mergeSourceIds(target.sources, source.sources);
  target.evidence = mergeEvidence(target.evidence, source.evidence);
  target.mentions = Math.min(MAX_NODE_MENTIONS, target.mentions + source.mentions);
  target.feedback = Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, target.feedback + source.feedback));
  target.confidence = Math.max(target.confidence, source.confidence);
  target.status = status;
  target.updatedAt = now;
  target.lastReviewedAt = now;

  const mergedEdges = new Map();
  graph.edges.forEach((edge) => {
    const nextSource = edge.source === normalizedSourceId ? normalizedTargetId : edge.source;
    const nextTarget = edge.target === normalizedSourceId ? normalizedTargetId : edge.target;
    if (nextSource === nextTarget) return;
    const nextEdge = {
      ...edge,
      source: nextSource,
      target: nextTarget,
      id: makeEdgeId(nextSource, nextTarget, edge.label)
    };
    const key = relationSemanticKey(nextSource, nextTarget, nextEdge.label);
    const existing = mergedEdges.get(key);
    if (!existing) {
      mergedEdges.set(key, nextEdge);
      return;
    }
    existing.evidence = mergeEvidence(existing.evidence, nextEdge.evidence);
    existing.sources = mergeSourceIds(existing.sources, nextEdge.sources);
    existing.feedback = Math.max(-MAX_FEEDBACK_COUNT, Math.min(MAX_FEEDBACK_COUNT, existing.feedback + nextEdge.feedback));
    existing.confidence = Math.max(existing.confidence, nextEdge.confidence);
    if (existing.status !== "accepted" && nextEdge.status === "accepted") existing.status = "accepted";
    if (existing.status === "inferred" && nextEdge.status === "rejected") existing.status = "rejected";
    existing.lastReviewedAt = newestTimestamp(existing.lastReviewedAt, nextEdge.lastReviewedAt);
  });

  graph.nodes = graph.nodes.filter((node) => node.id !== normalizedSourceId);
  graph.edges = makeUniqueEdgeIds([...mergedEdges.values()]);
  const remappedLearning = new Map();
  const setRemappedLearning = (example) => {
    const key = learningExampleKey(example);
    const existing = remappedLearning.get(key);
    const preferred = preferLearningExample(existing, example);
    if (preferred !== existing) remappedLearning.set(key, preferred);
  };
  graph.learning.examples.forEach((example) => {
    if (example.kind === "concept") {
      if (example.id === normalizedSourceId || example.id === normalizedTargetId) return;
      setRemappedLearning(example);
      return;
    }
    const nextSource = example.source === normalizedSourceId ? normalizedTargetId : example.source;
    const nextTarget = example.target === normalizedSourceId ? normalizedTargetId : example.target;
    if (nextSource === nextTarget) return;
    const endpointChanged = nextSource !== example.source || nextTarget !== example.target;
    const matchingEdge = graph.edges.find((edge) => (
      (edge.source === nextSource && edge.target === nextTarget)
      || (edge.source === nextTarget && edge.target === nextSource)
    ) && slugify(edge.label) === slugify(example.label));
    const nextExample = matchingEdge || endpointChanged
      ? {
        ...example,
        id: matchingEdge?.id || makeEdgeId(nextSource, nextTarget, example.label),
        source: matchingEdge?.source || nextSource,
        sourceLabel: graph.nodes.find((node) => node.id === (matchingEdge?.source || nextSource))?.label || (matchingEdge?.source || nextSource),
        target: matchingEdge?.target || nextTarget,
        targetLabel: graph.nodes.find((node) => node.id === (matchingEdge?.target || nextTarget))?.label || (matchingEdge?.target || nextTarget)
      }
      : example;
    setRemappedLearning(nextExample);
  });
  graph.learning.examples = retainNewestLearningExamples([...remappedLearning.values()]);
  rememberLearningItem(graph, "node", target);
  appendRevision(graph, `Merged concept ${source.label} into ${target.label}`, "manual");
  return { graph, changed: true, mergedId: normalizedTargetId };
}

function mutateFeedbackItem(item, action) {
  item.lastReviewedAt = new Date().toISOString();
  if (Object.hasOwn(item, "updatedAt")) item.updatedAt = item.lastReviewedAt;
  if (action === "restore") {
    item.status = "inferred";
    item.feedback += 1;
    item.confidence = Math.max(.2, item.confidence);
  } else if (action === "up") {
    item.status = "accepted";
    item.feedback += 1;
    item.confidence = Math.min(.99, item.confidence + .08);
  } else {
    item.status = "rejected";
    item.feedback -= 1;
    item.confidence = Math.max(.05, item.confidence - .12);
  }
}

function updateLearningMemory(graph, kind, item) {
  const examples = new Map(graph.learning.examples.map((example) => [learningExampleKey(example), example]));
  const example = kind === "node"
    ? {
      kind: "concept",
      id: item.id,
      label: item.label,
      aliases: item.aliases || [],
      status: item.status,
      lastReviewedAt: item.lastReviewedAt || null
    }
    : {
      kind: "relation",
      id: item.id,
      source: item.source,
      sourceLabel: graph.nodes.find((node) => node.id === item.source)?.label || item.source,
      target: item.target,
      targetLabel: graph.nodes.find((node) => node.id === item.target)?.label || item.target,
      label: item.label,
      status: item.status,
      lastReviewedAt: item.lastReviewedAt || null
    };
  if (kind === "edge") {
    [...examples.entries()].forEach(([key, existing]) => {
      if (existing.kind === "relation" && existing.id === item.id) examples.delete(key);
    });
  }
  const key = learningExampleKey(example);
  if (["accepted", "rejected"].includes(item.status)) {
    const existing = examples.get(key);
    const preferred = preferLearningExample(existing, example);
    if (!existing || !learningExamplesEquivalent(existing, preferred) || existing.lastReviewedAt !== preferred.lastReviewedAt) {
      examples.delete(key);
      examples.set(key, preferred);
    }
  } else examples.delete(key);
  graph.learning.examples = retainNewestLearningExamples([...examples.values()]);
}

export function rememberLearningItem(graph, kind, item) {
  updateLearningMemory(graph, kind, item);
  return graph;
}

export function syncLearningRelationLabels(value) {
  const graph = normalizeGraph(value);
  const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  let changed = false;
  graph.learning.examples = graph.learning.examples.map((example) => {
    if (example.kind !== "relation") return example;
    const sourceLabel = labels.get(example.source) || example.sourceLabel;
    const targetLabel = labels.get(example.target) || example.targetLabel;
    if (sourceLabel === example.sourceLabel && targetLabel === example.targetLabel) return example;
    changed = true;
    return { ...example, sourceLabel, targetLabel };
  });
  return { graph, changed };
}

function appendRevision(graph, reason, operation = "unknown") {
  if (!advanceGraphVersion(graph)) return false;
  graph.updatedAt = new Date().toISOString();
  graph.revisions.unshift({
    id: `rev-${graph.version}`,
    version: graph.version,
    timestamp: graph.updatedAt,
    reason,
    operation: REVISION_OPERATIONS.has(operation) ? operation : "unknown",
    nodes: graph.nodes.length,
    edges: graph.edges.length
  });
  graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  return true;
}

export function applyFeedbackDataset(value, examples) {
  let graph = normalizeGraph(value);
  const originalGraph = normalizeGraph(graph);
  const importLimit = importIntegrityLimit(graph);
  if (importLimit) {
    return { graph, updates: 0, learned: 0, skipped: 0, conflicts: 0, changed: false, limited: importLimit };
  }
  if (Array.isArray(examples) && examples.length > MAX_FEEDBACK_FINGERPRINT_EXAMPLES) {
    return { graph, updates: 0, learned: 0, skipped: 0, conflicts: 0, changed: false, limited: "feedback-examples" };
  }
  if (!canAdvanceGraphVersion(graph)) {
    return { graph, updates: 0, learned: 0, skipped: 0, conflicts: 0, changed: false, limited: "version" };
  }
  let hitVersionLimit = false;
  let updates = 0;
  let skipped = 0;
  let learned = 0;
  const normalizedExamples = [];
  const preferredExamples = new Map();
  const statusesByKey = new Map();
  const conflictingKeys = new Set();
  const portableFeedbackKey = (example) => example.kind === "concept"
    ? `concept|${slugify(example.label) || example.id}`
    : `relation|${relationSemanticKey(
      slugify(example.sourceLabel || example.source),
      slugify(example.targetLabel || example.target),
      example.label
    )}`;
  let remembered = new Map(graph.learning.examples.map((example) => [learningExampleKey(example), example]));
  const initialLearning = new Map(remembered);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeByLabel = new Map();
  const ambiguousNodeLabels = new Set();
  const indexNodeLabel = (label, node) => {
    const key = slugify(label);
    if (!key || ambiguousNodeLabels.has(key)) return;
    const previous = nodeByLabel.get(key);
    if (previous && previous.id !== node.id) {
      nodeByLabel.delete(key);
      ambiguousNodeLabels.add(key);
      return;
    }
    nodeByLabel.set(key, node);
  };
  graph.nodes.forEach((node) => {
    [node.label, ...(node.aliases || [])].forEach((label) => indexNodeLabel(label, node));
  });
  const findNode = (id, label) => {
    const direct = nodeById.get(asText(id));
    if (direct) return direct;
    const key = slugify(asText(label, id));
    return ambiguousNodeLabels.has(key) ? null : nodeByLabel.get(key);
  };
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const edgeByKey = new Map(graph.edges.map((edge) => [relationSemanticKey(edge.source, edge.target, edge.label), edge]));
  const resolveFeedbackItem = (example) => {
    if (example.kind === "concept") {
      const direct = nodeById.get(example.id);
      if (direct) {
        const labelKey = slugify(asText(example.label));
        const idKey = slugify(asText(example.id));
        const labelMatches = slugify(direct.label) === labelKey
          || (direct.aliases || []).some((alias) => slugify(alias) === labelKey);
        if (!labelKey || labelMatches || labelKey === idKey) return direct;
        return null;
      }
      return findNode("", asText(example.label, example.id)) || null;
    }
    const direct = edgeById.get(example.id);
    if (direct) {
      const source = nodeById.get(direct.source);
      const target = nodeById.get(direct.target);
      const sourceMatches = direct.source === example.source
        || slugify(source?.label || "") === slugify(example.sourceLabel)
        || (source?.aliases || []).some((alias) => slugify(alias) === slugify(example.sourceLabel));
      const targetMatches = direct.target === example.target
        || slugify(target?.label || "") === slugify(example.targetLabel)
        || (target?.aliases || []).some((alias) => slugify(alias) === slugify(example.targetLabel));
      const endpointsMatch = (sourceMatches && targetMatches)
        || (direct.source === example.target && direct.target === example.source);
      if (slugify(direct.label) === slugify(example.label) && endpointsMatch) return direct;
      return null;
    }
    const source = findNode(example.source, example.sourceLabel);
    const target = findNode(example.target, example.targetLabel);
    if (!source || !target) return null;
    return edgeByKey.get(relationSemanticKey(source.id, target.id, asText(example.label)))
      || null;
  };
  const canonicalizeFeedbackExample = (example) => {
    const item = resolveFeedbackItem(example);
    if (!item) return { example, item: null };
    if (example.kind === "concept") {
      return { example: { ...example, id: item.id, label: item.label }, item };
    }
    return {
      example: {
        ...example,
        id: item.id,
        source: item.source,
        sourceLabel: graph.nodes.find((node) => node.id === item.source)?.label || example.sourceLabel,
        target: item.target,
        targetLabel: graph.nodes.find((node) => node.id === item.target)?.label || example.targetLabel,
        label: item.label
      },
      item
    };
  };
  asArray(examples).slice(0, MAX_FEEDBACK_FINGERPRINT_EXAMPLES).forEach((example) => {
    const normalizedExample = normalizeLearningExample(example);
    if (!normalizedExample) {
      skipped += 1;
      return;
    }
    if (normalizedExample.kind === "relation"
      && graph.integrity.ambiguousEdgeIds.includes(normalizedExample.id)) {
      skipped += 1;
      return;
    }
    const canonicalized = canonicalizeFeedbackExample(normalizedExample);
    const canonical = canonicalized.example;
    const memoryKey = canonicalized.item ? learningExampleKey(canonical) : portableFeedbackKey(canonical);
    const existingStatus = statusesByKey.get(memoryKey);
    if (existingStatus && existingStatus !== canonical.status) conflictingKeys.add(memoryKey);
    statusesByKey.set(memoryKey, canonical.status);
    const preferred = preferLearningExample(preferredExamples.get(memoryKey), canonical);
    preferredExamples.set(memoryKey, preferred);
  });
  normalizedExamples.push(...preferredExamples.values());
  normalizedExamples.sort((left, right) => {
    const leftTime = left.lastReviewedAt ? parseTimestamp(left.lastReviewedAt) : Number.NaN;
    const rightTime = right.lastReviewedAt ? parseTimestamp(right.lastReviewedAt) : Number.NaN;
    if (Number.isNaN(leftTime) && !Number.isNaN(rightTime)) return -1;
    if (!Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 1;
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
    return lexicalCompare(learningExampleTieBreak(left), learningExampleTieBreak(right));
  });
  normalizedExamples.forEach((normalizedExample) => {
    if (hitVersionLimit) return;
    if (!canAdvanceGraphVersion(graph)) {
      hitVersionLimit = true;
      return;
    }
    const kind = normalizedExample.kind === "relation" ? "edge" : "node";
    const memoryKey = learningExampleKey(normalizedExample);
    const previousLearning = remembered.get(memoryKey);
    const learnedThis = !previousLearning;
    const preferredLearning = preferLearningExample(previousLearning, normalizedExample);
    const learningChanged = !previousLearning || !learningExamplesEquivalent(previousLearning, preferredLearning)
      || previousLearning.lastReviewedAt !== preferredLearning.lastReviewedAt;
    if (learningChanged) {
      remembered.delete(memoryKey);
      remembered.set(memoryKey, preferredLearning);
    }
    const item = resolveFeedbackItem(normalizedExample);
    if (!item) {
      if (!learnedThis) skipped += 1;
      return;
    }
    let itemChanged = false;
    const currentDecision = kind === "node"
      ? {
        ...normalizedExample,
        id: item.id,
        label: item.label,
        aliases: item.aliases || [],
        status: item.status,
        lastReviewedAt: item.lastReviewedAt
      }
      : {
        ...normalizedExample,
        id: item.id,
        source: item.source,
        sourceLabel: item.sourceLabel || normalizedExample.sourceLabel,
        target: item.target,
        targetLabel: item.targetLabel || normalizedExample.targetLabel,
        label: item.label,
        status: item.status,
        lastReviewedAt: item.lastReviewedAt
      };
    const preferredDecision = preferImportedDecision(currentDecision, normalizedExample);
    const relationEndpointsMatch = kind === "edge" && (
      (item.source === normalizedExample.source && item.target === normalizedExample.target)
      || (item.source === normalizedExample.target && item.target === normalizedExample.source)
    );
    const decisionMatchesCurrent = kind === "node"
      ? item.status === normalizedExample.status && slugify(item.label) === slugify(normalizedExample.label)
      : item.status === normalizedExample.status
        && relationEndpointsMatch
        && slugify(item.label) === slugify(normalizedExample.label);
    if (preferredDecision !== normalizedExample) {
      if (previousLearning) remembered.set(memoryKey, previousLearning);
      else remembered.delete(memoryKey);
    }
    if (preferredDecision === normalizedExample && item.status !== normalizedExample.status) {
      mutateFeedbackItem(item, normalizedExample.status === "accepted" ? "up" : "down");
      if (!appendRevision(graph, `${normalizedExample.status === "accepted" ? "Confirmed" : "Dismissed"} ${kind === "node" ? item.label : `relation ${item.label}`}`, "feedback")) {
        hitVersionLimit = true;
        return;
      }
      itemChanged = true;
    }
    if (kind === "node" && preferredDecision === normalizedExample && normalizedExample.aliases.length && canAdvanceGraphVersion(graph)) {
      const updatedItem = item;
      const aliases = [...new Set([...(updatedItem.aliases || []), ...normalizedExample.aliases])].slice(0, MAX_ALIASES);
      if (JSON.stringify(aliases) !== JSON.stringify(updatedItem.aliases || [])) {
        updatedItem.aliases = aliases;
        aliases.forEach((alias) => indexNodeLabel(alias, updatedItem));
        updatedItem.updatedAt = new Date().toISOString();
        if (!advanceGraphVersion(graph)) {
          hitVersionLimit = true;
          return;
        }
        graph.updatedAt = updatedItem.updatedAt;
        graph.revisions.unshift({
          id: `rev-${graph.version}`,
          version: graph.version,
          timestamp: graph.updatedAt,
          reason: `Imported aliases for ${updatedItem.label}`,
          operation: "feedback",
          nodes: graph.nodes.length,
          edges: graph.edges.length
        });
        graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
        itemChanged = true;
      }
    }
    if (preferredDecision === normalizedExample || decisionMatchesCurrent) {
      rememberLearningItem(graph, kind, item);
      remembered = new Map(graph.learning.examples.map((example) => [learningExampleKey(example), example]));
    }
    if (itemChanged) updates += 1;
  });
  if (hitVersionLimit) {
    return { graph: originalGraph, updates: 0, learned: 0, skipped, conflicts: conflictingKeys.size, changed: false, limited: "version" };
  }
  const finalLearning = new Map(remembered);
  const learningKeys = new Set([...initialLearning.keys(), ...finalLearning.keys()]);
  learned = [...learningKeys].filter((key) => {
    const before = initialLearning.get(key);
    const after = finalLearning.get(key);
    return !before || !after || !learningExamplesEquivalent(before, after) || before.lastReviewedAt !== after.lastReviewedAt;
  }).length;
  if (learned) {
    graph.learning.examples = retainNewestLearningExamples([...finalLearning.values()]);
    if (!updates && !appendRevision(graph, `Stored ${learned} reusable learning example${learned === 1 ? "" : "s"}${conflictingKeys.size ? `; detected ${conflictingKeys.size} contradictory reviewed decision${conflictingKeys.size === 1 ? "" : "s"} and selected a deterministic value` : ""}`, "learning")) {
      return { graph: originalGraph, updates: 0, learned: 0, skipped, conflicts: conflictingKeys.size, changed: false, limited: "version" };
    }
  }
  if (conflictingKeys.size && updates && canAdvanceGraphVersion(graph)) {
    if (!appendRevision(graph, `Detected ${conflictingKeys.size} contradictory reviewed decision${conflictingKeys.size === 1 ? "" : "s"}; selected values by review freshness or deterministic tie-breaking`, "learning")) {
      return { graph: originalGraph, updates: 0, learned: 0, skipped, conflicts: conflictingKeys.size, changed: false, limited: "version" };
    }
  }
  return { graph, updates, learned, skipped, conflicts: conflictingKeys.size, changed: updates > 0 || learned > 0 };
}

export function buildExtractorFeedback(value, { includeStale = false, now = Date.now() } = {}) {
  const graph = normalizeGraph(value);
  const nodeLabels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const ambiguousEdgeIds = new Set(graph.integrity.ambiguousEdgeIds);
  const concepts = graph.nodes
      .filter((node) => (node.status === "accepted" || node.status === "rejected") && includeGuidanceItem(node, includeStale, now))
      .map((node) => ({
        kind: "concept",
        id: node.id,
        label: node.label,
        aliases: node.aliases || [],
        status: node.status,
        lastReviewedAt: node.lastReviewedAt || null
      }))
      .sort((left, right) => lexicalCompare(`${left.id}\u0000${slugify(left.label)}`, `${right.id}\u0000${slugify(right.label)}`));
  const relations = graph.edges
      .filter((edge) => !ambiguousEdgeIds.has(edge.id)
        && (edge.status === "accepted" || edge.status === "rejected")
        && includeGuidanceItem(edge, includeStale, now))
      .map((edge) => ({
        kind: "relation",
        id: edge.id,
        source: edge.source,
        sourceLabel: nodeLabels.get(edge.source) || edge.source,
        target: edge.target,
        targetLabel: nodeLabels.get(edge.target) || edge.target,
        label: edge.label,
        status: edge.status,
        lastReviewedAt: edge.lastReviewedAt || null
      }))
      .sort((left, right) => lexicalCompare(
        `${relationSemanticKey(left.source, left.target, left.label)}\u0000${left.id}`,
        `${relationSemanticKey(right.source, right.target, right.label)}\u0000${right.id}`
      ));
  const feedback = [];
  const seen = new Set();
  const add = (example) => {
    const key = learningExampleKey(example);
    if (seen.has(key)) {
      const index = feedback.findIndex((candidate) => learningExampleKey(candidate) === key);
      if (index >= 0) feedback[index] = preferLearningExample(feedback[index], example);
      return;
    }
    if (feedback.length >= MAX_FEEDBACK_EXAMPLES) return;
    seen.add(key);
    feedback.push(example);
  };
  const learningExamples = graph.learning.examples
    .filter((example) => !(example.kind === "relation" && ambiguousEdgeIds.has(example.id))
      && includeGuidanceItem(example, includeStale, now))
    .map((example, index) => ({
      example,
      index,
      timestamp: trustedReviewTime(example.lastReviewedAt, now)
    }))
    .sort((left, right) => {
      if (Number.isFinite(left.timestamp) && Number.isFinite(right.timestamp) && left.timestamp !== right.timestamp) {
        return right.timestamp - left.timestamp;
      }
      if (Number.isFinite(left.timestamp) !== Number.isFinite(right.timestamp)) {
        return Number.isFinite(left.timestamp) ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ example }) => example);
  const learningKeys = new Set(learningExamples.map(learningExampleKey));
  const reservedLiveKeys = new Set([
    ...concepts,
    ...relations
  ]
    .map(learningExampleKey)
    .filter((key) => !learningKeys.has(key)));
  const learningBudget = Math.max(0, MAX_FEEDBACK_EXAMPLES - reservedLiveKeys.size);
  const boundedLearningExamples = learningBudget ? learningExamples.slice(0, learningBudget) : [];
  boundedLearningExamples.forEach(add);
  for (let index = 0; feedback.length < MAX_FEEDBACK_EXAMPLES && (index < concepts.length || index < relations.length); index += 1) {
    if (concepts[index]) add(concepts[index]);
    if (relations[index]) add(relations[index]);
  }
  const feedbackFields = ["kind", "id", "label", "aliases", "source", "sourceLabel", "target", "targetLabel", "status"];
  return feedback.map((example) => Object.fromEntries(
    feedbackFields
      .filter((field) => example[field] !== undefined)
      .map((field) => [field, example[field]])
  ));
}

export function clearLearningMemory(value) {
  const graph = normalizeGraph(value);
  const importLimit = importIntegrityLimit(graph);
  if (importLimit) return { graph, changed: false, removed: 0, limited: importLimit };
  const removed = graph.learning.examples.length;
  if (!removed) return { graph, changed: false, removed: 0 };
  if (!canAdvanceGraphVersion(graph)) return { graph, changed: false, removed: 0, limited: "version" };
  graph.learning.examples = [];
  appendRevision(graph, `Forgot ${removed} reusable learning example${removed === 1 ? "" : "s"}`, "learning");
  return { graph, changed: true, removed };
}

export function clearStaleLearningMemory(value) {
  const graph = normalizeGraph(value);
  const importLimit = importIntegrityLimit(graph);
  if (importLimit) return { graph, changed: false, removed: 0, limited: importLimit };
  const stale = graph.learning.examples.filter((example) => isStaleLearningExample(example));
  if (!stale.length) return { graph, changed: false, removed: 0 };
  if (!canAdvanceGraphVersion(graph)) return { graph, changed: false, removed: 0, limited: "version" };
  const staleKeys = new Set(stale.map(learningExampleKey));
  graph.learning.examples = graph.learning.examples.filter((example) => !staleKeys.has(learningExampleKey(example)));
  appendRevision(graph, `Forgot ${stale.length} stale reusable learning example${stale.length === 1 ? "" : "s"}`, "learning");
  return { graph, changed: true, removed: stale.length };
}

export function removeSource(value, sourceId, { recordRevision = true } = {}) {
  const graph = normalizeGraph(value);
  const importLimit = importIntegrityLimit(graph);
  if (importLimit) return { graph, removed: false, removedNodes: 0, removedEdges: 0, limited: importLimit };
  const normalizedSourceId = normalizeId(sourceId);
  if (graph.integrity.ambiguousSourceIds.includes(normalizedSourceId)) {
    return { graph, removed: false, removedNodes: 0, removedEdges: 0, ambiguous: true };
  }
  const source = graph.documents.find((document) => document.id === normalizedSourceId);
  if (!source) return { graph, removed: false, removedNodes: 0, removedEdges: 0 };
  if (recordRevision && !canAdvanceGraphVersion(graph)) {
    return { graph, removed: false, removedNodes: 0, removedEdges: 0, limited: "version" };
  }
  graph.documents = graph.documents.filter((document) => document.id !== normalizedSourceId);
  const invalidatedNodeIds = new Set(graph.nodes
    .filter((node) => node.sources.includes(normalizedSourceId) || node.evidence.some((evidence) => evidence.sources.includes(normalizedSourceId)))
    .map((node) => node.id));
  const previousNodeIds = new Set(graph.nodes.map((node) => node.id));
  const previousNodeCount = graph.nodes.length;
  graph.nodes = graph.nodes.map((node) => {
    const sources = node.sources.filter((id) => id !== normalizedSourceId);
    const evidence = node.evidence.map((item) => ({
      text: item.text,
      sources: item.sources.filter((id) => id !== normalizedSourceId)
    })).filter((item) => item.sources.length > 0);
    if (!sources.length && !evidence.length && node.status !== "accepted") return null;
    return { ...node, sources, evidence, updatedAt: new Date().toISOString(), lastReviewedAt: invalidatedNodeIds.has(node.id) ? null : node.lastReviewedAt };
  }).filter(Boolean);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const removedNodeIds = new Set([...previousNodeIds].filter((id) => !nodeIds.has(id)));
  const invalidatedEdgeIds = new Set(graph.edges
    .filter((edge) => edge.sources.includes(normalizedSourceId) || edge.evidence.some((evidence) => evidence.sources.includes(normalizedSourceId)))
    .map((edge) => edge.id));
  const previousEdgeIds = new Set(graph.edges.map((edge) => edge.id));
  const previousEdgeCount = graph.edges.length;
  graph.edges = graph.edges.map((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return null;
    const sources = edge.sources.filter((id) => id !== normalizedSourceId);
    const evidence = edge.evidence.map((item) => ({
      text: item.text,
      sources: item.sources.filter((id) => id !== normalizedSourceId)
    })).filter((item) => item.sources.length > 0);
    if (!sources.length && !evidence.length && edge.status !== "accepted") return null;
    return { ...edge, sources, evidence, lastReviewedAt: invalidatedEdgeIds.has(edge.id) ? null : edge.lastReviewedAt };
  }).filter(Boolean);
  const retainedEdgeIds = new Set(graph.edges.map((edge) => edge.id));
  const removedEdgeIds = new Set([...previousEdgeIds].filter((id) => !retainedEdgeIds.has(id)));
  graph.learning.examples = graph.learning.examples.filter((example) => {
    if (example.kind === "concept") return !removedNodeIds.has(example.id);
    return !removedEdgeIds.has(example.id)
      && !removedNodeIds.has(example.source)
      && !removedNodeIds.has(example.target);
  }).map((example) => (
    (example.kind === "concept" && invalidatedNodeIds.has(example.id))
      || (example.kind === "relation" && invalidatedEdgeIds.has(example.id))
      ? { ...example, lastReviewedAt: null }
      : example
  ));
  if (recordRevision) {
    advanceGraphVersion(graph);
    graph.updatedAt = new Date().toISOString();
    graph.revisions.unshift({
      id: `rev-${graph.version}`,
      version: graph.version,
      timestamp: graph.updatedAt,
      reason: `Removed source ${source.title}`,
      operation: "source-removal",
      nodes: graph.nodes.length,
      edges: graph.edges.length
    });
    graph.revisions = graph.revisions.slice(0, MAX_GRAPH_REVISIONS);
  }
  return {
    graph,
    removed: true,
    removedNodes: previousNodeCount - graph.nodes.length,
    removedEdges: previousEdgeCount - graph.edges.length
  };
}

function buildEvidenceGrounding(graph) {
  const documentIds = new Set(graph.documents.map((document) => document.id));
  const ambiguousSourceIds = new Set(graph.integrity.ambiguousSourceIds);
  const sourceTextById = new Map(graph.documents.map((document) => [document.id, canonicalDocumentText(document.text)]));
  const unanchoredByItem = new Map();
  let evidenceGroundingComparisons = 0;
  let evidenceGroundingSourceScanChars = 0;
  let evidenceGroundingTruncated = false;
  let evidenceGroundingCheckedRecords = 0;
  let evidenceGroundingSkippedRecords = 0;
  let anchoredEvidenceRecords = 0;
  let unanchoredEvidenceRecords = 0;
  const evidenceIsAnchored = (evidence) => {
    const quote = canonicalDocumentText(evidence.text);
    if (!quote) return false;
    let hasValidSource = false;
    for (const sourceId of evidence.sources) {
      if (evidenceGroundingComparisons >= MAX_EVIDENCE_GROUNDING_COMPARISONS) {
        evidenceGroundingTruncated = true;
        return null;
      }
      const sourceText = sourceTextById.get(sourceId);
      if (!documentIds.has(sourceId) || ambiguousSourceIds.has(sourceId) || !sourceText) continue;
      hasValidSource = true;
      if (evidenceGroundingSourceScanChars + sourceText.length > MAX_EVIDENCE_GROUNDING_SOURCE_SCAN_CHARS) {
        evidenceGroundingTruncated = true;
        return null;
      }
      evidenceGroundingComparisons += 1;
      evidenceGroundingSourceScanChars += sourceText.length;
      if (sourceText.includes(quote)) return true;
    }
    return hasValidSource ? false : false;
  };
  const evidenceRecords = [
    ...graph.nodes.flatMap((node) => node.evidence.map((evidence) => ({ kind: "node", item: node, evidence }))),
    ...graph.edges.flatMap((edge) => edge.evidence.map((evidence) => ({ kind: "edge", item: edge, evidence })))
  ];
  const evidenceRecordsToCheck = graph.redacted === true
    ? []
    : evidenceRecords.slice(0, MAX_EVIDENCE_GROUNDING_RECORDS);
  for (const record of evidenceRecordsToCheck) {
    const anchored = evidenceIsAnchored(record.evidence);
    if (anchored === null) {
      evidenceGroundingSkippedRecords += 1;
      continue;
    }
    evidenceGroundingCheckedRecords += 1;
    if (anchored) {
        anchoredEvidenceRecords += 1;
    } else {
      unanchoredEvidenceRecords += 1;
      unanchoredByItem.set(`${record.kind}:${record.item.id}`, (unanchoredByItem.get(`${record.kind}:${record.item.id}`) || 0) + 1);
    }
  }
  if (graph.redacted !== true && evidenceRecords.length > evidenceRecordsToCheck.length) evidenceGroundingTruncated = true;
  if (evidenceGroundingSkippedRecords > 0) evidenceGroundingTruncated = true;
  return {
    evidenceGroundingAvailable: graph.redacted !== true,
    evidenceGroundingCheckedRecords,
    evidenceGroundingComparisons,
    evidenceGroundingSourceScanChars,
    evidenceGroundingTruncated,
    evidenceGroundingSkippedRecords,
    anchoredEvidenceRecords,
    unanchoredEvidenceRecords,
    unanchoredByItem
  };
}

export function inspectGraph(value, { now = Date.now(), includeReviewQueue = false } = {}) {
  const graph = normalizeGraph(value);
  const documentIds = new Set(graph.documents.map((document) => document.id));
  const ambiguousSourceIds = new Set(graph.integrity.ambiguousSourceIds);
  const ambiguousEdgeIds = new Set(graph.integrity.ambiguousEdgeIds);
  const conflictingNodeIds = new Set(graph.integrity.conflictingNodeIds || []);
  const conflictingEdgeIds = new Set(graph.integrity.conflictingEdgeIds || []);
  const nodeLabelOwners = new Map();
  const ambiguousNodeLabels = new Set();
  graph.nodes.forEach((node) => {
    const key = slugify(node.label);
    if (!key) return;
    const previous = nodeLabelOwners.get(key);
    if (previous && previous !== node.id) ambiguousNodeLabels.add(key);
    else nodeLabelOwners.set(key, node.id);
  });
  const sourceQuality = Object.fromEntries([...SOURCE_QUALITIES].map((quality) => [quality, graph.documents.filter((document) => document.quality === quality).length]));
  const reviewedSources = graph.documents.filter((document) => document.lastReviewedAt).length;
  const freshReviewedSources = graph.documents.filter((document) => {
    if (!document.lastReviewedAt) return false;
    const timestamp = parseTimestamp(document.lastReviewedAt);
    return !Number.isNaN(timestamp) && timestamp <= now && now - timestamp < REVIEW_STALE_DAYS * 86400000;
  }).length;
  const staleLearningExamples = graph.learning.examples.filter((example) => isStaleLearningExample(example, now)).length;
  const feedbackContext = feedbackContextStatsForGraph(graph, { includeStale: false, now });
  const truncation = graph.integrity.truncated || {};
  const dropped = graph.integrity.dropped || {};
  const truncatedItems = [
    truncation.documents,
    truncation.nodes,
    truncation.edges,
    truncation.revisions,
    truncation.learningExamples,
    truncation.documentTitle,
    truncation.documentText,
    truncation.evidenceText,
    truncation.evidenceItems,
    truncation.sourceReferences,
    truncation.aliases
  ].reduce((total, count) => Math.min(
    Number.MAX_SAFE_INTEGER,
    total + (Number.isSafeInteger(count) && count > 0 ? count : 0)
  ), 0);
  const droppedItems = [
    dropped.documents,
    dropped.nodes,
    dropped.edges,
    dropped.revisions,
    dropped.learningExamples
  ].reduce((total, count) => Math.min(
    Number.MAX_SAFE_INTEGER,
    total + (Number.isSafeInteger(count) && count > 0 ? count : 0)
  ), 0);
  const hasValidSource = (item) => item.sources.some((sourceId) => documentIds.has(sourceId) && !ambiguousSourceIds.has(sourceId));
  const evidenceHasValidSource = (item) => item.evidence.some((evidence) => evidence.sources.some((sourceId) => documentIds.has(sourceId) && !ambiguousSourceIds.has(sourceId)));
  const activeNodes = graph.nodes.filter((node) => node.status !== "rejected");
  const activeEdges = graph.edges.filter((edge) => edge.status !== "rejected");
  const reviewedNodes = graph.nodes.filter((node) => node.status !== "inferred" || node.feedback !== 0).length;
  const reviewedEdges = graph.edges.filter((edge) => edge.status !== "inferred" || edge.feedback !== 0).length;
  const reviewedItems = [...graph.nodes, ...graph.edges].filter((item) => item.status !== "inferred" || item.feedback !== 0);
  const acceptedItems = reviewedItems.filter((item) => item.status === "accepted").length;
  const rejectedItems = reviewedItems.filter((item) => item.status === "rejected").length;
  const evidenceRecords = [...graph.nodes.flatMap((node) => node.evidence), ...graph.edges.flatMap((edge) => edge.evidence)];
  const supportedNodes = activeNodes.filter((node) => hasValidSource(node) || evidenceHasValidSource(node));
  const supportedEdges = activeEdges.filter((edge) => hasValidSource(edge) || evidenceHasValidSource(edge));
  const provenanceItems = [...activeNodes, ...activeEdges];
  const grounding = buildEvidenceGrounding(graph);
  const orphanedSourceReferences = [
    ...graph.nodes.flatMap((node) => node.sources),
    ...graph.edges.flatMap((edge) => edge.sources),
    ...evidenceRecords.flatMap((evidence) => evidence.sources)
  ].filter((sourceId) => !documentIds.has(sourceId)).length;
  const ambiguousSourceReferences = [
    ...graph.nodes.flatMap((node) => node.sources),
    ...graph.edges.flatMap((edge) => edge.sources),
    ...evidenceRecords.flatMap((evidence) => evidence.sources)
  ].filter((sourceId) => ambiguousSourceIds.has(sourceId)).length;
  const reviewCandidates = buildReviewQueue(graph, MAX_REVIEW_QUEUE_ITEMS, now, grounding.unanchoredByItem);
  const health = {
    documents: graph.documents.length,
    nodes: graph.nodes.length,
    activeNodes: activeNodes.length,
    rejectedNodes: graph.nodes.length - activeNodes.length,
    edges: graph.edges.length,
    activeEdges: activeEdges.length,
    reviewedItems: reviewedNodes + reviewedEdges,
    reviewedNodes,
    reviewedEdges,
    reviewCandidates: reviewCandidates.length,
    reviewQueueTruncated: reviewCandidates.truncated === true,
    staleReviewCandidates: reviewCandidates.filter((candidate) => candidate.stale).length,
    newEvidenceReviewCandidates: reviewCandidates.filter((candidate) => candidate.newEvidence).length,
    learningExamples: graph.learning.examples.length,
    feedbackContextAvailable: feedbackContext.available,
    feedbackContextRetained: feedbackContext.retained,
    feedbackContextTruncated: feedbackContext.truncated,
    feedbackContextExcluded: feedbackContext.excluded,
    truncated: truncatedItems > 0,
    truncatedItems,
    truncatedDocuments: truncation.documents || 0,
    truncatedNodes: truncation.nodes || 0,
    truncatedEdges: truncation.edges || 0,
    truncatedRevisions: truncation.revisions || 0,
    truncatedLearningExamples: truncation.learningExamples || 0,
    truncatedDocumentTitle: truncation.documentTitle || 0,
    truncatedDocumentText: truncation.documentText || 0,
    truncatedEvidenceText: truncation.evidenceText || 0,
    truncatedEvidenceItems: truncation.evidenceItems || 0,
    truncatedSourceReferences: truncation.sourceReferences || 0,
    truncatedAliases: truncation.aliases || 0,
    dropped: droppedItems > 0,
    droppedItems,
    droppedDocuments: dropped.documents || 0,
    droppedNodes: dropped.nodes || 0,
    droppedEdges: dropped.edges || 0,
    droppedRevisions: dropped.revisions || 0,
    droppedLearningExamples: dropped.learningExamples || 0,
    conflictingNodeIds: conflictingNodeIds.size,
    conflictingEdgeIds: conflictingEdgeIds.size,
    conflictingItems: conflictingNodeIds.size + conflictingEdgeIds.size,
    staleLearningExamples,
    acceptedItems,
    rejectedItems,
    ambiguousLabels: ambiguousNodeLabels.size,
    rejectedEdges: graph.edges.length - activeEdges.length,
    evidenceRecords: evidenceRecords.length,
    evidenceGroundingAvailable: grounding.evidenceGroundingAvailable,
    evidenceGroundingCheckedRecords: grounding.evidenceGroundingCheckedRecords,
    evidenceGroundingComparisons: grounding.evidenceGroundingComparisons,
    evidenceGroundingSourceScanChars: grounding.evidenceGroundingSourceScanChars,
    evidenceGroundingTruncated: grounding.evidenceGroundingTruncated,
    anchoredEvidenceRecords: grounding.anchoredEvidenceRecords,
    unanchoredEvidenceRecords: grounding.unanchoredEvidenceRecords,
    evidenceGroundingCoverage: grounding.evidenceGroundingAvailable
      ? (grounding.evidenceGroundingCheckedRecords ? Math.round(grounding.anchoredEvidenceRecords / grounding.evidenceGroundingCheckedRecords * 100) : 100)
      : null,
    supportedNodes: supportedNodes.length,
    unsupportedNodes: activeNodes.length - supportedNodes.length,
    supportedEdges: supportedEdges.length,
    unsupportedEdges: activeEdges.length - supportedEdges.length,
    sourceQuality,
    reviewedSources,
    sourceReviewCoverage: graph.documents.length ? Math.round(reviewedSources / graph.documents.length * 100) : 100,
    freshSourceReviewCoverage: graph.documents.length ? Math.round(freshReviewedSources / graph.documents.length * 100) : 100,
    orphanedSourceReferences,
    ambiguousSourceIds: ambiguousSourceIds.size,
    ambiguousEdgeIds: ambiguousEdgeIds.size,
    ambiguousSourceReferences,
    redacted: graph.redacted === true,
    provenanceCoverage: provenanceItems.length ? Math.round((supportedNodes.length + supportedEdges.length) / provenanceItems.length * 100) : 100
  };
  if (includeReviewQueue) health.reviewQueue = reviewCandidates;
  return health;
}

function buildReviewQueue(graph, limit = 20, now = Date.now(), unanchoredByItem = new Map()) {
  const documentIds = new Set(graph.documents.map((document) => document.id));
  const documentsById = new Map(graph.documents.map((document) => [document.id, document]));
  const ambiguousSourceIds = new Set(graph.integrity.ambiguousSourceIds);
  const ambiguousEdgeIds = new Set(graph.integrity.ambiguousEdgeIds);
  const hasValidSource = (item) => item.sources.some((sourceId) => documentIds.has(sourceId) && !ambiguousSourceIds.has(sourceId))
    || item.evidence.some((evidence) => evidence.sources.some((sourceId) => documentIds.has(sourceId) && !ambiguousSourceIds.has(sourceId)));
  const reviewAgeDays = (item) => {
    if (!item.lastReviewedAt) return null;
    const timestamp = parseTimestamp(item.lastReviewedAt);
    if (Number.isNaN(timestamp) || timestamp > now) return null;
    return Math.max(0, Math.floor((now - timestamp) / 86400000));
  };
  const isStaleReview = (item) => item.status !== "inferred"
    && (reviewAgeDays(item) === null || reviewAgeDays(item) >= REVIEW_STALE_DAYS);
  const hasNewEvidenceSinceReview = (item) => {
    if (!item.lastReviewedAt) return false;
    const reviewedAt = parseTimestamp(item.lastReviewedAt);
    if (Number.isNaN(reviewedAt)) return false;
    const sourceIds = new Set([
      ...item.sources,
      ...item.evidence.flatMap((evidence) => evidence.sources || [])
    ]);
    return [...sourceIds].some((sourceId) => {
    const sourceAddedAt = parseTimestamp(documentsById.get(sourceId)?.addedAt || "");
      return !Number.isNaN(sourceAddedAt) && sourceAddedAt > reviewedAt;
    });
  };
  const unanchoredEvidenceFor = (kind, item) => unanchoredByItem.get(`${kind}:${item.id}`) || 0;
  const staleReason = (item) => {
    const age = reviewAgeDays(item);
    if (age !== null) return `review stale by ${age} day${age === 1 ? "" : "s"}`;
    if (item.lastReviewedAt && parseTimestamp(item.lastReviewedAt) > now) return "review timestamp is in the future";
    return "review timestamp missing";
  };
  const isStaleSourceReview = (document) => reviewAgeDays(document) === null || reviewAgeDays(document) >= REVIEW_STALE_DAYS;
  const describePriority = ({ confidence, evidence, supported }) => {
    const reasons = [];
    if (confidence < .6) reasons.push("low confidence");
    if (!evidence) reasons.push("no evidence");
    if (!supported) reasons.push("unresolved provenance");
    return reasons.length ? reasons.join(" · ") : "routine review";
  };
  const addGroundingReason = (reason, candidate) => candidate.unanchoredEvidence
    ? `${reason} · ${candidate.unanchoredEvidence} unanchored evidence`
    : reason;
  const candidates = [
    ...graph.nodes.filter((node) => node.status === "inferred").map((node) => ({
      kind: "node",
      id: node.id,
      label: node.label,
      confidence: node.confidence,
      evidence: node.evidence.length,
      supported: hasValidSource(node),
      unanchoredEvidence: unanchoredEvidenceFor("node", node)
    })),
    ...graph.edges.filter((edge) => edge.status === "inferred" && !ambiguousEdgeIds.has(edge.id)).map((edge) => ({
      kind: "edge",
      id: edge.id,
      label: edge.label,
      confidence: edge.confidence,
      evidence: edge.evidence.length,
      supported: hasValidSource(edge),
      unanchoredEvidence: unanchoredEvidenceFor("edge", edge)
    })),
    ...graph.nodes.filter((node) => node.status !== "inferred" && (isStaleReview(node) || hasNewEvidenceSinceReview(node) || unanchoredEvidenceFor("node", node) > 0)).map((node) => ({
      kind: "node",
      id: node.id,
      label: node.label,
      confidence: node.confidence,
      evidence: node.evidence.length,
      supported: hasValidSource(node),
      unanchoredEvidence: unanchoredEvidenceFor("node", node),
      stale: isStaleReview(node),
      newEvidence: hasNewEvidenceSinceReview(node),
      staleReason: staleReason(node)
    })),
    ...graph.edges.filter((edge) => !ambiguousEdgeIds.has(edge.id)
      && edge.status !== "inferred"
      && (isStaleReview(edge) || hasNewEvidenceSinceReview(edge) || unanchoredEvidenceFor("edge", edge) > 0)).map((edge) => ({
      kind: "edge",
      id: edge.id,
      label: edge.label,
      confidence: edge.confidence,
      evidence: edge.evidence.length,
      supported: hasValidSource(edge),
      unanchoredEvidence: unanchoredEvidenceFor("edge", edge),
      stale: isStaleReview(edge),
      newEvidence: hasNewEvidenceSinceReview(edge),
      staleReason: staleReason(edge)
    })),
    ...graph.documents
      .filter((document) => !ambiguousSourceIds.has(document.id)
        && (document.quality === "unknown" || isStaleSourceReview(document)))
      .map((document) => ({
        kind: "source",
        id: document.id,
        label: document.title,
        confidence: document.quality === "unknown" ? .4 : .7,
        evidence: document.text ? 1 : 0,
        supported: true,
        sourceQuality: document.quality,
        sourceReviewed: Boolean(document.lastReviewedAt),
        unanchoredEvidence: 0,
        stale: isStaleSourceReview(document),
        staleReason: staleReason(document)
      }))
  ];
  const boundedLimit = Math.max(0, Math.min(Number(limit) || 0, MAX_REVIEW_QUEUE_ITEMS));
  const rankedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      priority: Number((candidate.kind === "source"
        ? (candidate.sourceQuality === "unknown" ? 50 : 0) + (candidate.sourceReviewed ? 0 : 35) + (candidate.sourceReviewed && candidate.stale ? 20 : 0)
        : (1 - candidate.confidence) * 100
          + (candidate.evidence ? 0 : 25)
          + (candidate.supported ? 0 : 35)
          + (candidate.unanchoredEvidence ? 30 : 0)
          + (candidate.stale ? 20 : 0)
          + (candidate.newEvidence ? 30 : 0)).toFixed(2)),
      reason: candidate.kind === "source"
        ? [
          candidate.sourceQuality === "unknown" ? "source quality unknown" : "",
          candidate.sourceReviewed ? "" : "source not reviewed",
          candidate.sourceReviewed && candidate.stale ? candidate.staleReason : ""
        ].filter(Boolean).join(" · ")
        : addGroundingReason(candidate.newEvidence
          ? `new evidence since review${candidate.stale ? ` · ${candidate.staleReason}` : ""}`
          : candidate.stale
            ? candidate.staleReason
            : describePriority(candidate), candidate)
    }))
    .sort((left, right) => right.priority - left.priority
      || left.confidence - right.confidence
      || left.evidence - right.evidence
      || lexicalCompare(left.label, right.label)
      || lexicalCompare(left.kind, right.kind)
      || lexicalCompare(left.id, right.id));
  const result = rankedCandidates.slice(0, boundedLimit);
  Object.defineProperty(result, "truncated", {
    value: rankedCandidates.length > boundedLimit,
    enumerable: false
  });
  return result;
}

export function reviewQueue(value, limit = 20, { now = Date.now() } = {}) {
  const graph = normalizeGraph(value);
  return buildReviewQueue(graph, limit, now, buildEvidenceGrounding(graph).unanchoredByItem);
}

const reviewQueueExportItem = (candidate) => ({
    kind: candidate.kind,
    id: candidate.id,
    label: candidate.label,
    priority: candidate.priority,
    confidence: candidate.confidence,
    evidence: candidate.evidence,
    supported: candidate.supported,
    reason: candidate.reason,
    ...(candidate.unanchoredEvidence ? { unanchoredEvidence: candidate.unanchoredEvidence } : {}),
    ...(candidate.stale ? { stale: true } : {}),
    ...(candidate.newEvidence ? { newEvidence: true } : {}),
    ...(candidate.sourceQuality ? { sourceQuality: candidate.sourceQuality } : {}),
    ...(candidate.sourceReviewed ? { sourceReviewed: true } : {})
  });

export function reviewQueueExport(value, limit = MAX_REVIEW_QUEUE_ITEMS, options) {
  return reviewQueue(value, limit, options).map(reviewQueueExportItem);
}

export const HEALTH_COUNT_LIMITS = {
  documents: MAX_GRAPH_DOCUMENTS,
  nodes: MAX_GRAPH_NODES,
  activeNodes: MAX_GRAPH_NODES,
  rejectedNodes: MAX_GRAPH_NODES,
  edges: MAX_GRAPH_EDGES,
  activeEdges: MAX_GRAPH_EDGES,
  reviewedItems: MAX_GRAPH_NODES + MAX_GRAPH_EDGES,
  reviewedNodes: MAX_GRAPH_NODES,
  reviewedEdges: MAX_GRAPH_EDGES,
  reviewCandidates: MAX_REVIEW_QUEUE_ITEMS,
  staleReviewCandidates: MAX_REVIEW_QUEUE_ITEMS,
  newEvidenceReviewCandidates: MAX_REVIEW_QUEUE_ITEMS,
  feedbackContextAvailable: MAX_FEEDBACK_FINGERPRINT_EXAMPLES + MAX_FEEDBACK_EXAMPLES,
  feedbackContextRetained: MAX_FEEDBACK_EXAMPLES,
  feedbackContextExcluded: MAX_FEEDBACK_FINGERPRINT_EXAMPLES + MAX_FEEDBACK_EXAMPLES,
  learningExamples: MAX_FEEDBACK_EXAMPLES,
  staleLearningExamples: MAX_FEEDBACK_EXAMPLES,
  acceptedItems: MAX_GRAPH_NODES + MAX_GRAPH_EDGES,
  rejectedItems: MAX_GRAPH_NODES + MAX_GRAPH_EDGES,
  evidenceRecords: (MAX_GRAPH_NODES + MAX_GRAPH_EDGES) * 8,
  ambiguousLabels: MAX_GRAPH_NODES,
  rejectedEdges: MAX_GRAPH_EDGES,
  reviewedSources: MAX_GRAPH_DOCUMENTS,
  supportedNodes: MAX_GRAPH_NODES,
  unsupportedNodes: MAX_GRAPH_NODES,
  supportedEdges: MAX_GRAPH_EDGES,
  unsupportedEdges: MAX_GRAPH_EDGES,
  orphanedSourceReferences: MAX_SOURCE_REFERENCE_DIAGNOSTICS,
  ambiguousSourceIds: MAX_AMBIGUOUS_SOURCE_IDS,
  ambiguousEdgeIds: MAX_AMBIGUOUS_EDGE_IDS,
  ambiguousSourceReferences: MAX_SOURCE_REFERENCE_DIAGNOSTICS,
  conflictingNodeIds: MAX_CONFLICTING_ITEM_IDS,
  conflictingEdgeIds: MAX_CONFLICTING_ITEM_IDS,
  conflictingItems: MAX_CONFLICTING_ITEM_IDS * 2,
  truncatedAliases: (MAX_GRAPH_NODES + MAX_FEEDBACK_EXAMPLES) * MAX_ALIASES,
  truncatedDocuments: 0xffffffff,
  truncatedNodes: 0xffffffff,
  truncatedEdges: 0xffffffff,
  truncatedRevisions: 0xffffffff,
  truncatedLearningExamples: 0xffffffff,
  truncatedDocumentTitle: 0xffffffff,
  truncatedDocumentText: 0xffffffff,
  truncatedEvidenceText: 0xffffffff,
  truncatedEvidenceItems: 0xffffffff,
  truncatedSourceReferences: 0xffffffff,
  truncatedItems: Number.MAX_SAFE_INTEGER,
  droppedItems: Number.MAX_SAFE_INTEGER,
  droppedDocuments: Number.MAX_SAFE_INTEGER,
  droppedNodes: Number.MAX_SAFE_INTEGER,
  droppedEdges: Number.MAX_SAFE_INTEGER,
  droppedRevisions: Number.MAX_SAFE_INTEGER,
  droppedLearningExamples: Number.MAX_SAFE_INTEGER,
  evidenceGroundingCheckedRecords: MAX_EVIDENCE_GROUNDING_RECORDS,
  evidenceGroundingComparisons: MAX_EVIDENCE_GROUNDING_COMPARISONS,
  evidenceGroundingSourceScanChars: MAX_EVIDENCE_GROUNDING_SOURCE_SCAN_CHARS,
  anchoredEvidenceRecords: (MAX_GRAPH_NODES + MAX_GRAPH_EDGES) * MAX_EVIDENCE_RECORDS,
  unanchoredEvidenceRecords: (MAX_GRAPH_NODES + MAX_GRAPH_EDGES) * MAX_EVIDENCE_RECORDS
};

export const HEALTH_PERCENTAGES = new Set(["evidenceGroundingCoverage", "provenanceCoverage", "sourceReviewCoverage", "freshSourceReviewCoverage"]);
export const HEALTH_BOOLEANS = new Set([
  "feedbackContextTruncated",
  "truncated",
  "dropped",
  "reviewQueueTruncated",
  "evidenceGroundingAvailable",
  "evidenceGroundingTruncated",
  "redacted"
]);
export const HEALTH_OBJECTS = new Set(["sourceQuality"]);
export const HEALTH_GATE_LIMITS = {
  maxOrphaned: Number.MAX_SAFE_INTEGER,
  maxAmbiguous: Number.MAX_SAFE_INTEGER,
  maxUnsupportedNodes: MAX_GRAPH_NODES,
  maxUnsupportedEdges: MAX_GRAPH_EDGES,
  maxReviewCandidates: MAX_REVIEW_QUEUE_ITEMS,
  maxReviewQueueTruncated: 1,
  maxEvidenceGroundingTruncated: 1,
  maxFeedbackContextTruncated: 1,
  maxStaleReviewCandidates: MAX_REVIEW_QUEUE_ITEMS,
  maxStaleLearningExamples: MAX_FEEDBACK_EXAMPLES,
  maxWithheldGuidance: MAX_FEEDBACK_FINGERPRINT_EXAMPLES + MAX_FEEDBACK_EXAMPLES,
  maxUnanchoredEvidence: (MAX_GRAPH_NODES + MAX_GRAPH_EDGES) * 8,
  maxConflictingItems: MAX_CONFLICTING_ITEM_IDS * 2,
  maxTruncatedItems: Number.MAX_SAFE_INTEGER,
  maxDroppedItems: Number.MAX_SAFE_INTEGER
};

function assertHealthCount(value, path, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${path} must be an integer from 0 to ${maximum}.`);
}

export function validateHealthReport(value, { label = "health report" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  if (value.format !== HEALTH_FORMAT) throw new Error(`${label} must declare ${HEALTH_FORMAT}.`);
  if (value.graphSchema !== GRAPH_SCHEMA) throw new Error(`${label} must declare ${GRAPH_SCHEMA}.`);
  assertHealthCount(value.graphVersion, `${label}.graphVersion`, Number.MAX_SAFE_INTEGER);
  if (typeof value.inspectedAt !== "string" || Number.isNaN(parseTimestamp(value.inspectedAt))) throw new Error(`${label}.inspectedAt must be a valid timestamp.`);
  if (value.graphFingerprint !== undefined && !/^fnv64-[0-9a-f]{16}-[0-9]+$/.test(value.graphFingerprint)) throw new Error(`${label}.graphFingerprint is invalid.`);
  if (value.appVersion !== undefined && (typeof value.appVersion !== "string" || !value.appVersion.trim() || value.appVersion.length > MAX_PRODUCER_VERSION_CHARS)) throw new Error(`${label}.appVersion is invalid.`);
  if (!value.health || typeof value.health !== "object" || Array.isArray(value.health)) throw new Error(`${label}.health is missing.`);
  for (const [field, maximum] of Object.entries(HEALTH_COUNT_LIMITS)) {
    if (value.health[field] !== undefined) assertHealthCount(value.health[field], `${label}.health.${field}`, maximum);
  }
  for (const field of HEALTH_PERCENTAGES) {
    if (value.health[field] !== undefined && value.health[field] !== null) assertHealthCount(value.health[field], `${label}.health.${field}`, 100);
  }
  for (const field of HEALTH_BOOLEANS) {
    if (value.health[field] !== undefined && typeof value.health[field] !== "boolean") {
      throw new Error(`${label}.health.${field} must be boolean.`);
    }
  }
  if (value.health.sourceQuality !== undefined) {
    const sourceQuality = value.health.sourceQuality;
    if (!sourceQuality || typeof sourceQuality !== "object" || Array.isArray(sourceQuality)) {
      throw new Error(`${label}.health.sourceQuality must be an object.`);
    }
    for (const key of Object.keys(sourceQuality)) {
      if (!SOURCE_QUALITIES.has(key)) throw new Error(`${label}.health.sourceQuality.${key} is not a supported source quality.`);
      assertHealthCount(sourceQuality[key], `${label}.health.sourceQuality.${key}`, MAX_GRAPH_DOCUMENTS);
    }
  }
  const health = value.health;
  const assertHealthInvariant = (condition, message) => {
    if (!condition) throw new Error(`${label}.health.${message}`);
  };
  if (health.activeNodes !== undefined && health.nodes !== undefined && health.activeNodes > health.nodes) throw new Error(`${label}.health.activeNodes cannot exceed nodes.`);
  if (health.activeEdges !== undefined && health.edges !== undefined && health.activeEdges > health.edges) throw new Error(`${label}.health.activeEdges cannot exceed edges.`);
  if (health.reviewedItems !== undefined && health.reviewedNodes !== undefined && health.reviewedEdges !== undefined && health.reviewedItems !== health.reviewedNodes + health.reviewedEdges) throw new Error(`${label}.health.reviewedItems must equal reviewedNodes plus reviewedEdges.`);
  if (health.conflictingItems !== undefined && health.conflictingNodeIds !== undefined && health.conflictingEdgeIds !== undefined && health.conflictingItems !== health.conflictingNodeIds + health.conflictingEdgeIds) throw new Error(`${label}.health.conflictingItems must equal conflictingNodeIds plus conflictingEdgeIds.`);
  if (health.nodes !== undefined && health.activeNodes !== undefined && health.rejectedNodes !== undefined) {
    assertHealthInvariant(health.activeNodes + health.rejectedNodes === health.nodes, "activeNodes plus rejectedNodes must equal nodes.");
  }
  if (health.edges !== undefined && health.activeEdges !== undefined && health.rejectedEdges !== undefined) {
    assertHealthInvariant(health.activeEdges + health.rejectedEdges === health.edges, "activeEdges plus rejectedEdges must equal edges.");
  }
  if (health.reviewedNodes !== undefined && health.nodes !== undefined) {
    assertHealthInvariant(health.reviewedNodes <= health.nodes, "reviewedNodes cannot exceed nodes.");
  }
  if (health.reviewedEdges !== undefined && health.edges !== undefined) {
    assertHealthInvariant(health.reviewedEdges <= health.edges, "reviewedEdges cannot exceed edges.");
  }
  if (health.acceptedItems !== undefined && health.rejectedItems !== undefined && health.reviewedItems !== undefined) {
    assertHealthInvariant(health.acceptedItems + health.rejectedItems <= health.reviewedItems, "acceptedItems plus rejectedItems cannot exceed reviewedItems.");
  }
  if (health.supportedNodes !== undefined && health.unsupportedNodes !== undefined && health.activeNodes !== undefined) {
    assertHealthInvariant(health.supportedNodes + health.unsupportedNodes === health.activeNodes, "supportedNodes plus unsupportedNodes must equal activeNodes.");
  }
  if (health.supportedEdges !== undefined && health.unsupportedEdges !== undefined && health.activeEdges !== undefined) {
    assertHealthInvariant(health.supportedEdges + health.unsupportedEdges === health.activeEdges, "supportedEdges plus unsupportedEdges must equal activeEdges.");
  }
  if (health.reviewedSources !== undefined && health.documents !== undefined) {
    assertHealthInvariant(health.reviewedSources <= health.documents, "reviewedSources cannot exceed documents.");
  }
  if (health.sourceQuality !== undefined && health.documents !== undefined) {
    const sourceQualityTotal = Object.values(health.sourceQuality).reduce((total, count) => total + count, 0);
    assertHealthInvariant(sourceQualityTotal <= health.documents, "sourceQuality totals cannot exceed documents.");
  }
  if (health.feedbackContextAvailable !== undefined && health.feedbackContextRetained !== undefined) {
    assertHealthInvariant(health.feedbackContextRetained <= health.feedbackContextAvailable, "feedbackContextRetained cannot exceed feedbackContextAvailable.");
  }
  if (health.evidenceGroundingCheckedRecords !== undefined
    && health.anchoredEvidenceRecords !== undefined
    && health.unanchoredEvidenceRecords !== undefined) {
    assertHealthInvariant(
      health.anchoredEvidenceRecords + health.unanchoredEvidenceRecords <= health.evidenceGroundingCheckedRecords,
      "anchoredEvidenceRecords plus unanchoredEvidenceRecords cannot exceed evidenceGroundingCheckedRecords."
    );
  }
  if (health.reviewCandidates !== undefined && health.staleReviewCandidates !== undefined) {
    assertHealthInvariant(health.staleReviewCandidates <= health.reviewCandidates, "staleReviewCandidates cannot exceed reviewCandidates.");
  }
  if (health.reviewCandidates !== undefined && health.newEvidenceReviewCandidates !== undefined) {
    assertHealthInvariant(health.newEvidenceReviewCandidates <= health.reviewCandidates, "newEvidenceReviewCandidates cannot exceed reviewCandidates.");
  }
  if (health.learningExamples !== undefined && health.staleLearningExamples !== undefined) {
    assertHealthInvariant(health.staleLearningExamples <= health.learningExamples, "staleLearningExamples cannot exceed learningExamples.");
  }
  if (!Array.isArray(value.reviewQueue) || value.reviewQueue.length > MAX_REVIEW_QUEUE_ITEMS) throw new Error(`${label}.reviewQueue must contain at most ${MAX_REVIEW_QUEUE_ITEMS} items.`);
  if (health.reviewCandidates !== undefined && value.reviewQueue.length > health.reviewCandidates) {
    throw new Error(`${label}.reviewQueue cannot exceed health.reviewCandidates.`);
  }
  value.reviewQueue.forEach((candidate, index) => {
    const path = `${label}.reviewQueue[${index}]`;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`${path} must be an object.`);
    if (!["node", "edge", "source"].includes(candidate.kind)) throw new Error(`${path}.kind is invalid.`);
    if (typeof candidate.id !== "string" || !candidate.id.trim() || candidate.id.length > MAX_ID_CHARS) throw new Error(`${path}.id is invalid.`);
    if (typeof candidate.label !== "string" || candidate.label.length > MAX_CONCEPT_LABEL_CHARS) throw new Error(`${path}.label is invalid.`);
    if (!Number.isFinite(candidate.priority) || candidate.priority < 0 || candidate.priority > 1000) throw new Error(`${path}.priority is invalid.`);
    if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) throw new Error(`${path}.confidence is invalid.`);
    assertHealthCount(candidate.evidence, `${path}.evidence`, 8);
    if (typeof candidate.supported !== "boolean" || typeof candidate.reason !== "string" || !candidate.reason.trim() || candidate.reason.length > 200) throw new Error(`${path} has invalid routing metadata.`);
  });
  if (value.gate !== undefined) {
    if (!value.gate || typeof value.gate !== "object" || Array.isArray(value.gate)) throw new Error(`${label}.gate must be an object.`);
    if (typeof value.gate.passed !== "boolean") throw new Error(`${label}.gate.passed must be boolean.`);
    if (!Array.isArray(value.gate.violations) || value.gate.violations.length > 12 || value.gate.violations.some((violation) => typeof violation !== "string" || !violation.trim() || violation.length > 200)) {
      throw new Error(`${label}.gate.violations is invalid.`);
    }
    if (!value.gate.passed && value.gate.violations.length === 0) throw new Error(`${label}.gate cannot fail without violations.`);
    if (value.gate.passed && value.gate.violations.length > 0) throw new Error(`${label}.gate cannot pass with violations.`);
    if (!value.gate.thresholds || typeof value.gate.thresholds !== "object" || Array.isArray(value.gate.thresholds)) throw new Error(`${label}.gate.thresholds is missing.`);
    for (const [field, maximum] of Object.entries(HEALTH_GATE_LIMITS)) {
      const threshold = value.gate.thresholds[field];
      if (threshold !== undefined && threshold !== null) assertHealthCount(threshold, `${label}.gate.thresholds.${field}`, maximum);
    }
    for (const field of ["minProvenance", "minFreshSourceReview"]) {
      const threshold = value.gate.thresholds[field];
      if (threshold !== undefined && threshold !== null && (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)) {
        throw new Error(`${label}.gate.thresholds.${field} must be a percentage from 0 to 100 or null.`);
      }
    }
  }
  return true;
}

export function buildHealthReport(value, {
  appVersion = "unknown",
  inspectedAt = new Date().toISOString()
} = {}) {
  const graph = normalizeGraph(value);
  const fallbackInspectionTime = new Date().toISOString();
  const normalizedInspectionTime = asDateTime(inspectedAt, fallbackInspectionTime);
  const inspectionTime = parseTimestamp(normalizedInspectionTime);
  const health = inspectGraph(graph, { now: inspectionTime, includeReviewQueue: true });
  const reviewCandidates = health.reviewQueue || [];
  delete health.reviewQueue;
  const report = {
    format: HEALTH_FORMAT,
    graphSchema: GRAPH_SCHEMA,
    graphVersion: graph.version,
    graphFingerprint: fingerprintBackup(graph),
    appVersion: typeof appVersion === "string" && appVersion.trim() ? sliceTextAtCodePointBoundary(appVersion.trim(), MAX_PRODUCER_VERSION_CHARS) : "unknown",
    inspectedAt: normalizedInspectionTime,
    health,
    reviewQueue: reviewCandidates.map(reviewQueueExportItem)
  };
  validateHealthReport(report);
  return report;
}
