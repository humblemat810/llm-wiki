import { GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, MAX_GRAPH_REVISIONS, defaultGraph, fingerprintBackup, normalizeGraph, parseJsonWithUniqueKeys } from "./graph-core.js";

export const GRAPH_KEY = "llm-field-notes-knowledge-graph";
export const HISTORY_KEY = "llm-field-notes-knowledge-graph-history";
export const RECOVERY_KEY = "llm-field-notes-knowledge-graph-recovery";
export const HISTORY_RECOVERY_KEY = "llm-field-notes-knowledge-graph-history-recovery";
export const HISTORY_LIMIT = 3;
export const MAX_PERSISTED_JSON_CHARS = 50 * 1024 * 1024;
export const MAX_PERSISTED_JSON_BYTES = 50 * 1024 * 1024;
export const MAX_HISTORY_CAPACITY = MAX_GRAPH_REVISIONS;
export const MAX_RECOVERY_JSON_CHARS = Math.floor(MAX_PERSISTED_JSON_BYTES / 4);

export function createGraphStore(storage, {
  graphKey = GRAPH_KEY,
  historyKey = HISTORY_KEY,
  recoveryKey = RECOVERY_KEY,
  historyRecoveryKey = HISTORY_RECOVERY_KEY,
  historyLimit = HISTORY_LIMIT,
  maxPersistedJsonChars = MAX_PERSISTED_JSON_CHARS,
  maxPersistedJsonBytes = MAX_PERSISTED_JSON_BYTES,
  maxRecoveryJsonChars = MAX_RECOVERY_JSON_CHARS
} = {}) {
  const numericHistoryLimit = Number(historyLimit);
  const historyCapacity = Number.isFinite(numericHistoryLimit) && numericHistoryLimit >= 0
    ? Math.min(MAX_HISTORY_CAPACITY, Math.floor(numericHistoryLimit))
    : HISTORY_LIMIT;
  const numericPersistedLimit = Number(maxPersistedJsonChars);
  const persistedJsonLimit = Number.isFinite(numericPersistedLimit) && numericPersistedLimit > 0
    ? Math.min(MAX_PERSISTED_JSON_CHARS, Math.floor(numericPersistedLimit))
    : MAX_PERSISTED_JSON_CHARS;
  const numericPersistedBytesLimit = Number(maxPersistedJsonBytes);
  const persistedJsonBytesLimit = Number.isFinite(numericPersistedBytesLimit) && numericPersistedBytesLimit > 0
    ? Math.min(MAX_PERSISTED_JSON_BYTES, Math.floor(numericPersistedBytesLimit))
    : MAX_PERSISTED_JSON_BYTES;
  const numericRecoveryLimit = Number(maxRecoveryJsonChars);
  const recoveryJsonLimit = Number.isFinite(numericRecoveryLimit) && numericRecoveryLimit > 0
    ? Math.min(MAX_RECOVERY_JSON_CHARS, Math.floor(numericRecoveryLimit))
    : MAX_RECOVERY_JSON_CHARS;
  const serializedBytes = (value) => new TextEncoder().encode(value).byteLength;
  const exceedsPersistedLimit = (value) => value.length > persistedJsonLimit || serializedBytes(value) > persistedJsonBytesLimit;
  const suppressedRecoveryKeys = new Set();
  const serializeGraph = (graph) => {
    const raw = JSON.stringify(normalizeGraph(graph));
    if (exceedsPersistedLimit(raw)) throw new Error("Graph exceeds the persisted state safety limit.");
    return raw;
  };
  const serializeHistory = (history) => {
    const raw = JSON.stringify(history);
    if (exceedsPersistedLimit(raw)) throw new Error("Graph history exceeds the persisted state safety limit.");
    return raw;
  };
  const hasImportIntegrityLoss = (graph) => [
    ...Object.values(graph?.integrity?.truncated || {}),
    ...Object.values(graph?.integrity?.dropped || {})
  ].some((count) => Number.isSafeInteger(count) && count > 0);
  const commitTimestamp = () => new Date().toISOString();
  const graphContentSerialization = (graph) => {
    if (!graph || typeof graph !== "object") return JSON.stringify(graph);
    const { committedAt, ...content } = graph;
    return JSON.stringify(content);
  };
  const trimHistory = (history) => historyCapacity === 0 ? [] : history.slice(-historyCapacity);
  const isGraphRecord = (value) => value
    && typeof value === "object"
    && (value.schema === GRAPH_SCHEMA || LEGACY_GRAPH_SCHEMAS.has(value.schema));
  let lastWriteMode = "none";
  const captureRaw = (key, raw) => {
    if (typeof raw !== "string" || !raw) return;
    if (raw.length > recoveryJsonLimit) {
      suppressedRecoveryKeys.add(key);
      return;
    }
    try {
      if (!storage.getItem(key)) storage.setItem(key, raw);
    } catch {
      // Recovery is best effort when storage itself is unavailable.
    }
  };
  const captureRecovery = (raw) => captureRaw(recoveryKey, raw);
  const read = () => {
    let raw = null;
    try {
      raw = storage.getItem(graphKey);
      if (typeof raw === "string" && exceedsPersistedLimit(raw)) throw new Error("Persisted graph exceeds the safety limit.");
      const stored = parseJsonWithUniqueKeys(raw || "null", "Persisted graph");
      const normalized = normalizeGraph(stored);
      if (stored && typeof stored === "object" && (
        (stored.schema !== GRAPH_SCHEMA && !LEGACY_GRAPH_SCHEMAS.has(stored.schema))
        || JSON.stringify(stored) !== JSON.stringify(normalized)
      )) {
        captureRecovery(raw);
      }
      return normalized;
    } catch {
      captureRecovery(raw);
      return defaultGraph();
    }
  };
  const readRecovery = () => {
    try {
      return storage.getItem(recoveryKey);
    } catch {
      return null;
    }
  };
  const clearRecovery = () => {
    try {
      storage.removeItem(recoveryKey);
      suppressedRecoveryKeys.delete(recoveryKey);
      return true;
    } catch {
      return false;
    }
  };
  const readHistoryRecovery = () => {
    try {
      return storage.getItem(historyRecoveryKey);
    } catch {
      return null;
    }
  };
  const clearHistoryRecovery = () => {
    try {
      storage.removeItem(historyRecoveryKey);
      suppressedRecoveryKeys.delete(historyRecoveryKey);
      return true;
    } catch {
      return false;
    }
  };
  const readHistory = () => {
    let raw = null;
    try {
      raw = storage.getItem(historyKey);
      if (typeof raw === "string" && exceedsPersistedLimit(raw)) {
        captureRaw(historyRecoveryKey, raw);
        return [];
      }
      const stored = parseJsonWithUniqueKeys(raw || "[]", "Persisted graph history");
      if (!Array.isArray(stored)) {
        captureRaw(historyRecoveryKey, raw);
        return [];
      }
      const valid = stored.filter(isGraphRecord);
      const trimmed = trimHistory(valid);
      const normalized = trimmed.map(normalizeGraph);
      if (valid.length !== stored.length || valid.length > historyCapacity || JSON.stringify(trimmed) !== JSON.stringify(normalized)) {
        captureRaw(historyRecoveryKey, raw);
      }
      return normalized;
    } catch {
      captureRaw(historyRecoveryKey, raw);
      return [];
    }
  };
  const rollback = (previousGraphRaw, previousHistoryRaw) => {
    const restore = (key, raw) => {
      try {
        if (raw === null || raw === undefined) storage.removeItem(key);
        else storage.setItem(key, raw);
        return true;
      } catch {
        return false;
      }
    };
    return {
      graph: restore(graphKey, previousGraphRaw),
      history: restore(historyKey, previousHistoryRaw)
    };
  };
  const rollbackAndCapture = (previousGraphRaw, previousHistoryRaw) => {
    const restored = rollback(previousGraphRaw, previousHistoryRaw);
    if (!restored.graph) captureRaw(recoveryKey, previousGraphRaw);
    if (!restored.history) captureRaw(historyRecoveryKey, previousHistoryRaw);
    return restored;
  };
  const readRawSnapshot = () => {
    try {
      return {
        graph: storage.getItem(graphKey),
        history: storage.getItem(historyKey)
      };
    } catch {
      return null;
    }
  };
  return {
    read,
    readHistory,
    readRecovery,
    captureRecoverySnapshot(raw) {
      captureRecovery(raw);
    },
    clearRecovery,
    readHistoryRecovery,
    clearHistoryRecovery,
    hasRecoverySuppression: () => suppressedRecoveryKeys.size > 0,
    getLastWriteMode: () => lastWriteMode,
    write(graph, { recordHistory = true, expectedVersion, expectedFingerprint } = {}) {
      let previousGraphRaw;
      let previousHistoryRaw;
      let normalizedRaw;
      let nextHistoryRaw = null;
      let normalized;
      try {
        normalized = normalizeGraph(graph);
        normalizedRaw = serializeGraph(normalized);
      } catch {
        lastWriteMode = "failed";
        return false;
      }
      try {
        const snapshot = readRawSnapshot();
        if (!snapshot) {
          lastWriteMode = "failed";
          return false;
        }
        previousGraphRaw = snapshot.graph;
        previousHistoryRaw = snapshot.history;
        const current = read();
        if ((Number.isInteger(expectedVersion) && current.version !== expectedVersion)
          || (typeof expectedFingerprint === "string" && fingerprintBackup(current) !== expectedFingerprint)) {
          lastWriteMode = "conflict";
          return false;
        }
        if (hasImportIntegrityLoss(current)
          && hasImportIntegrityLoss(normalized)
          && fingerprintBackup(current) !== fingerprintBackup(normalized)) {
          lastWriteMode = "integrity";
          return false;
        }
        const graphChanged = graphContentSerialization(current) !== graphContentSerialization(normalized);
        if (graphChanged) {
          normalized.committedAt = commitTimestamp();
          normalizedRaw = serializeGraph(normalized);
        } else if (current.committedAt) {
          normalized.committedAt = current.committedAt;
          normalizedRaw = serializeGraph(normalized);
        }
        if (recordHistory) {
          const history = readHistory();
          if (graphChanged) {
            history.push(current);
            nextHistoryRaw = serializeHistory(trimHistory(history));
          }
        }
        // Commit the primary graph before its undo history. If a tab is
        // terminated between synchronous storage writes, preserving the
        // newest graph is safer than exposing history for a graph that is
        // still current.
        storage.setItem(graphKey, normalizedRaw);
        if (nextHistoryRaw !== null) storage.setItem(historyKey, nextHistoryRaw);
        lastWriteMode = "normal";
        return true;
      } catch {
        rollbackAndCapture(previousGraphRaw, previousHistoryRaw);
        try {
          storage.setItem(graphKey, normalizedRaw || serializeGraph(graph));
          lastWriteMode = "without-new-history";
          return true;
        } catch {
          rollbackAndCapture(previousGraphRaw, previousHistoryRaw);
          try {
            storage.setItem(graphKey, normalizedRaw || serializeGraph(graph));
            storage.removeItem(historyKey);
            lastWriteMode = "without-history";
            return true;
          } catch {
            captureRaw(historyRecoveryKey, previousHistoryRaw);
            rollbackAndCapture(previousGraphRaw, previousHistoryRaw);
            lastWriteMode = "failed";
            return false;
          }
        }
      }
    },
    canUndo() {
      return readHistory().length > 0;
    },
    undo({ expectedVersion, expectedFingerprint } = {}) {
      let previousGraphRaw;
      let previousHistoryRaw;
      try {
        const snapshot = readRawSnapshot();
        if (!snapshot) {
          lastWriteMode = "failed";
          return false;
        }
        previousGraphRaw = snapshot.graph;
        previousHistoryRaw = snapshot.history;
        const current = read();
        if ((Number.isInteger(expectedVersion) && current.version !== expectedVersion)
          || (typeof expectedFingerprint === "string" && fingerprintBackup(current) !== expectedFingerprint)) {
          lastWriteMode = "conflict";
          return false;
        }
        const history = readHistory();
        const previous = history.pop();
        if (!previous) {
          lastWriteMode = "none";
          return false;
        }
        previous.committedAt = commitTimestamp();
        storage.setItem(graphKey, serializeGraph(previous));
        storage.setItem(historyKey, serializeHistory(history));
        lastWriteMode = "normal";
        return true;
      } catch {
        rollbackAndCapture(previousGraphRaw, previousHistoryRaw);
        lastWriteMode = "failed";
        return false;
      }
    },
    restore(graph, history = [], { expectedVersion, expectedFingerprint, preserveCurrent = false } = {}) {
      let previousGraphRaw;
      let previousHistoryRaw;
      const rawGraph = (() => {
        try {
          return JSON.stringify(graph);
        } catch {
          return null;
        }
      })();
      let normalizedGraph;
      try {
        normalizedGraph = normalizeGraph(graph);
      } catch {
        lastWriteMode = "failed";
        return false;
      }
      if (hasImportIntegrityLoss(normalizedGraph)) captureRaw(recoveryKey, rawGraph);
      const rawHistory = Array.isArray(history)
        ? (() => {
          try {
            return JSON.stringify(history);
          } catch {
            return null;
          }
        })()
        : null;
      const validHistory = Array.isArray(history) ? history.filter(isGraphRecord) : [];
      const boundedHistory = trimHistory(validHistory);
      let normalizedHistory = boundedHistory.map(normalizeGraph);
      let historyNormalizationChanged;
      try {
        historyNormalizationChanged = JSON.stringify(boundedHistory) !== JSON.stringify(normalizedHistory);
      } catch {
        lastWriteMode = "failed";
        return false;
      }
      if (Array.isArray(history)
        && (validHistory.length !== history.length
          || validHistory.length > historyCapacity
          || historyNormalizationChanged)) {
        captureRaw(historyRecoveryKey, rawHistory);
      }
      if (preserveCurrent) {
        const current = read();
        const currentHasContent = current.nodes.length
          || current.edges.length
          || current.documents.length
          || current.learning?.examples?.length;
        if (currentHasContent && graphContentSerialization(current) !== graphContentSerialization(normalizedGraph)) {
          const combinedHistory = [...normalizedHistory, current];
          if (combinedHistory.length > historyCapacity) {
            captureRaw(historyRecoveryKey, (() => {
              try {
                return JSON.stringify(combinedHistory);
              } catch {
                return null;
              }
            })());
          }
          normalizedHistory = trimHistory(combinedHistory);
        }
      }
      let normalizedGraphRaw;
      let normalizedHistoryRaw;
      try {
        normalizedGraphRaw = serializeGraph(normalizedGraph);
        normalizedHistoryRaw = serializeHistory(normalizedHistory);
      } catch {
        lastWriteMode = "failed";
        return false;
      }
      try {
        const snapshot = readRawSnapshot();
        if (!snapshot) {
          lastWriteMode = "failed";
          return false;
        }
        previousGraphRaw = snapshot.graph;
        previousHistoryRaw = snapshot.history;
        const current = read();
        if ((Number.isInteger(expectedVersion) && current.version !== expectedVersion)
          || (typeof expectedFingerprint === "string" && fingerprintBackup(current) !== expectedFingerprint)) {
          lastWriteMode = "conflict";
          return false;
        }
        if (graphContentSerialization(current) !== graphContentSerialization(normalizedGraph)) {
          normalizedGraph.committedAt = commitTimestamp();
          normalizedGraphRaw = serializeGraph(normalizedGraph);
        } else if (current.committedAt) {
          normalizedGraph.committedAt = current.committedAt;
          normalizedGraphRaw = serializeGraph(normalizedGraph);
        }
        storage.setItem(graphKey, normalizedGraphRaw);
        storage.setItem(historyKey, normalizedHistoryRaw);
        lastWriteMode = "normal";
        return true;
        } catch {
          rollbackAndCapture(previousGraphRaw, previousHistoryRaw);
          try {
            storage.setItem(graphKey, normalizedGraphRaw);
            storage.removeItem(historyKey);
            lastWriteMode = "without-history";
            return true;
          } catch {
            captureRaw(historyRecoveryKey, previousHistoryRaw);
            rollbackAndCapture(previousGraphRaw, previousHistoryRaw);
            lastWriteMode = "failed";
            return false;
        }
      }
    },
    clear({ expectedVersion, expectedFingerprint } = {}) {
      let previousGraphRaw;
      let previousHistoryRaw;
      let nextHistoryRaw = null;
      try {
        const snapshot = readRawSnapshot();
        if (!snapshot) {
          lastWriteMode = "failed";
          return false;
        }
        previousGraphRaw = snapshot.graph;
        previousHistoryRaw = snapshot.history;
        const current = read();
        if ((Number.isInteger(expectedVersion) && current.version !== expectedVersion)
          || (typeof expectedFingerprint === "string" && fingerprintBackup(current) !== expectedFingerprint)) {
          lastWriteMode = "conflict";
          return false;
        }
        if (current.nodes.length || current.documents.length || current.edges.length || current.learning?.examples?.length) {
          const history = readHistory();
          history.push(current);
          nextHistoryRaw = serializeHistory(trimHistory(history));
        }
        // A clear is destructive: record the undo snapshot before removing
        // the visible graph so an interrupted operation preserves recovery.
        // If termination occurs after this write, the still-visible graph is
        // safer than losing it before its snapshot exists.
        if (nextHistoryRaw !== null) storage.setItem(historyKey, nextHistoryRaw);
        storage.removeItem(graphKey);
        lastWriteMode = "normal";
        return true;
      } catch {
        rollbackAndCapture(previousGraphRaw, previousHistoryRaw);
        try {
          storage.removeItem(graphKey);
          storage.removeItem(historyKey);
          lastWriteMode = "without-history";
          return true;
        } catch {
          captureRaw(historyRecoveryKey, previousHistoryRaw);
          rollbackAndCapture(previousGraphRaw, previousHistoryRaw);
          lastWriteMode = "failed";
          return false;
        }
      }
    }
  };
}
