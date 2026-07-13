import { GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, defaultGraph, fingerprintBackup, normalizeGraph } from "./graph-core.js";

export const GRAPH_KEY = "llm-field-notes-knowledge-graph";
export const HISTORY_KEY = "llm-field-notes-knowledge-graph-history";
export const RECOVERY_KEY = "llm-field-notes-knowledge-graph-recovery";
export const HISTORY_RECOVERY_KEY = "llm-field-notes-knowledge-graph-history-recovery";
export const HISTORY_LIMIT = 3;
export const MAX_PERSISTED_JSON_CHARS = 50 * 1024 * 1024;

export function createGraphStore(storage, {
  graphKey = GRAPH_KEY,
  historyKey = HISTORY_KEY,
  recoveryKey = RECOVERY_KEY,
  historyRecoveryKey = HISTORY_RECOVERY_KEY,
  historyLimit = HISTORY_LIMIT,
  maxPersistedJsonChars = MAX_PERSISTED_JSON_CHARS
} = {}) {
  const numericHistoryLimit = Number(historyLimit);
  const historyCapacity = Number.isFinite(numericHistoryLimit) && numericHistoryLimit >= 0
    ? Math.floor(numericHistoryLimit)
    : HISTORY_LIMIT;
  const numericPersistedLimit = Number(maxPersistedJsonChars);
  const persistedJsonLimit = Number.isFinite(numericPersistedLimit) && numericPersistedLimit > 0
    ? Math.floor(numericPersistedLimit)
    : MAX_PERSISTED_JSON_CHARS;
  const serializeGraph = (graph) => {
    const raw = JSON.stringify(normalizeGraph(graph));
    if (raw.length > persistedJsonLimit) throw new Error("Graph exceeds the persisted state safety limit.");
    return raw;
  };
  const serializeHistory = (history) => {
    const raw = JSON.stringify(history);
    if (raw.length > persistedJsonLimit) throw new Error("Graph history exceeds the persisted state safety limit.");
    return raw;
  };
  const trimHistory = (history) => historyCapacity === 0 ? [] : history.slice(-historyCapacity);
  const isGraphRecord = (value) => value
    && typeof value === "object"
    && (value.schema === GRAPH_SCHEMA || LEGACY_GRAPH_SCHEMAS.has(value.schema));
  let lastWriteMode = "none";
  const captureRaw = (key, raw) => {
    if (typeof raw !== "string" || !raw) return;
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
      if (typeof raw === "string" && raw.length > persistedJsonLimit) throw new Error("Persisted graph exceeds the safety limit.");
      const stored = JSON.parse(raw || "null");
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
      return true;
    } catch {
      return false;
    }
  };
  const readHistory = () => {
    let raw = null;
    try {
      raw = storage.getItem(historyKey);
      if (typeof raw === "string" && raw.length > persistedJsonLimit) {
        captureRaw(historyRecoveryKey, raw);
        return [];
      }
      const stored = JSON.parse(raw || "[]");
      if (!Array.isArray(stored)) {
        captureRaw(historyRecoveryKey, raw);
        return [];
      }
      const valid = stored.filter(isGraphRecord);
      const trimmed = trimHistory(valid);
      const normalized = trimmed.map(normalizeGraph);
      if (valid.length !== stored.length || JSON.stringify(trimmed) !== JSON.stringify(normalized)) {
        captureRaw(historyRecoveryKey, raw);
      }
      return normalized;
    } catch {
      captureRaw(historyRecoveryKey, raw);
      return [];
    }
  };
  const rollback = (previousGraphRaw, previousHistoryRaw) => {
    try {
      if (previousGraphRaw === null || previousGraphRaw === undefined) storage.removeItem(graphKey);
      else storage.setItem(graphKey, previousGraphRaw);
      if (previousHistoryRaw === null || previousHistoryRaw === undefined) storage.removeItem(historyKey);
      else storage.setItem(historyKey, previousHistoryRaw);
    } catch {
      // Storage is unavailable; the caller still receives failure.
    }
  };
  return {
    read,
    readHistory,
    readRecovery,
    clearRecovery,
    readHistoryRecovery,
    clearHistoryRecovery,
    getLastWriteMode: () => lastWriteMode,
    write(graph, { recordHistory = true, expectedVersion, expectedFingerprint } = {}) {
      let previousGraphRaw;
      let previousHistoryRaw;
      let normalizedRaw;
      let normalized;
      try {
        normalized = normalizeGraph(graph);
        normalizedRaw = serializeGraph(normalized);
      } catch {
        lastWriteMode = "failed";
        return false;
      }
      try {
        previousGraphRaw = storage.getItem(graphKey);
        previousHistoryRaw = storage.getItem(historyKey);
        const current = read();
        if ((Number.isInteger(expectedVersion) && current.version !== expectedVersion)
          || (typeof expectedFingerprint === "string" && fingerprintBackup(current) !== expectedFingerprint)) {
          lastWriteMode = "conflict";
          return false;
        }
        if (recordHistory) {
          const history = readHistory();
          if (current.version !== normalized.version || JSON.stringify(current) !== JSON.stringify(normalized)) {
            history.push(current);
            storage.setItem(historyKey, serializeHistory(trimHistory(history)));
          }
        }
        storage.setItem(graphKey, normalizedRaw);
        lastWriteMode = "normal";
        return true;
      } catch {
        rollback(previousGraphRaw, previousHistoryRaw);
        try {
          storage.setItem(graphKey, normalizedRaw || serializeGraph(graph));
          lastWriteMode = "without-new-history";
          return true;
        } catch {
          rollback(previousGraphRaw, previousHistoryRaw);
          try {
            storage.removeItem(historyKey);
            storage.setItem(graphKey, normalizedRaw || serializeGraph(graph));
            lastWriteMode = "without-history";
            return true;
          } catch {
            rollback(previousGraphRaw, previousHistoryRaw);
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
        previousGraphRaw = storage.getItem(graphKey);
        previousHistoryRaw = storage.getItem(historyKey);
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
        storage.setItem(graphKey, serializeGraph(previous));
        storage.setItem(historyKey, serializeHistory(history));
        lastWriteMode = "normal";
        return true;
      } catch {
        rollback(previousGraphRaw, previousHistoryRaw);
        lastWriteMode = "failed";
        return false;
      }
    },
    restore(graph, history = [], { expectedVersion, expectedFingerprint, preserveCurrent = false } = {}) {
      let previousGraphRaw;
      let previousHistoryRaw;
      const normalizedGraph = normalizeGraph(graph);
      let normalizedHistory = Array.isArray(history) ? trimHistory(history.filter(isGraphRecord)).map(normalizeGraph) : [];
      if (preserveCurrent) {
        const current = read();
        const currentHasContent = current.nodes.length
          || current.edges.length
          || current.documents.length
          || current.learning?.examples?.length;
        if (currentHasContent && JSON.stringify(current) !== JSON.stringify(normalizedGraph)) {
          normalizedHistory = trimHistory([...normalizedHistory, current]);
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
        previousGraphRaw = storage.getItem(graphKey);
        previousHistoryRaw = storage.getItem(historyKey);
        const current = read();
        if ((Number.isInteger(expectedVersion) && current.version !== expectedVersion)
          || (typeof expectedFingerprint === "string" && fingerprintBackup(current) !== expectedFingerprint)) {
          lastWriteMode = "conflict";
          return false;
        }
        storage.setItem(graphKey, normalizedGraphRaw);
        storage.setItem(historyKey, normalizedHistoryRaw);
        lastWriteMode = "normal";
        return true;
      } catch {
        rollback(previousGraphRaw, previousHistoryRaw);
        try {
          storage.removeItem(historyKey);
          storage.setItem(graphKey, normalizedGraphRaw);
          lastWriteMode = "without-history";
          return true;
        } catch {
          rollback(previousGraphRaw, previousHistoryRaw);
          lastWriteMode = "failed";
          return false;
        }
      }
    },
    clear({ expectedVersion, expectedFingerprint } = {}) {
      let previousGraphRaw;
      let previousHistoryRaw;
      try {
        previousGraphRaw = storage.getItem(graphKey);
        previousHistoryRaw = storage.getItem(historyKey);
        const current = read();
        if ((Number.isInteger(expectedVersion) && current.version !== expectedVersion)
          || (typeof expectedFingerprint === "string" && fingerprintBackup(current) !== expectedFingerprint)) {
          lastWriteMode = "conflict";
          return false;
        }
        if (current.nodes.length || current.documents.length || current.edges.length || current.learning?.examples?.length) {
          const history = readHistory();
          history.push(current);
          storage.setItem(historyKey, serializeHistory(trimHistory(history)));
        }
        storage.removeItem(graphKey);
        lastWriteMode = "normal";
        return true;
      } catch {
        rollback(previousGraphRaw, previousHistoryRaw);
        try {
          storage.removeItem(historyKey);
          storage.removeItem(graphKey);
          lastWriteMode = "without-history";
          return true;
        } catch {
          rollback(previousGraphRaw, previousHistoryRaw);
          lastWriteMode = "failed";
          return false;
        }
      }
    }
  };
}
