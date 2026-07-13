import { GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, defaultGraph, normalizeGraph } from "./graph-core.js";

export const GRAPH_KEY = "llm-field-notes-knowledge-graph";
export const HISTORY_KEY = "llm-field-notes-knowledge-graph-history";
export const RECOVERY_KEY = "llm-field-notes-knowledge-graph-recovery";
export const HISTORY_LIMIT = 3;
export const MAX_PERSISTED_JSON_CHARS = 50 * 1024 * 1024;

export function createGraphStore(storage, {
  graphKey = GRAPH_KEY,
  historyKey = HISTORY_KEY,
  recoveryKey = RECOVERY_KEY,
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
  const captureRecovery = (raw) => {
    if (typeof raw !== "string" || !raw) return;
    try {
      if (!storage.getItem(recoveryKey)) storage.setItem(recoveryKey, raw);
    } catch {
      // Recovery is best effort when storage itself is unavailable.
    }
  };
  const read = () => {
    let raw = null;
    try {
      raw = storage.getItem(graphKey);
      if (typeof raw === "string" && raw.length > persistedJsonLimit) throw new Error("Persisted graph exceeds the safety limit.");
      const stored = JSON.parse(raw || "null");
      const normalized = normalizeGraph(stored);
      if (stored && typeof stored === "object" && stored.schema !== GRAPH_SCHEMA && !LEGACY_GRAPH_SCHEMAS.has(stored.schema)) {
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
  const readHistory = () => {
    try {
      const raw = storage.getItem(historyKey);
      if (typeof raw === "string" && raw.length > persistedJsonLimit) return [];
      const stored = JSON.parse(raw || "[]");
      return Array.isArray(stored) ? trimHistory(stored.filter(isGraphRecord)).map(normalizeGraph) : [];
    } catch {
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
    getLastWriteMode: () => lastWriteMode,
    write(graph, { recordHistory = true, expectedVersion } = {}) {
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
        if (Number.isInteger(expectedVersion) && read().version !== expectedVersion) {
          lastWriteMode = "conflict";
          return false;
        }
        if (recordHistory) {
          const history = readHistory();
          const current = read();
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
    undo({ expectedVersion } = {}) {
      let previousGraphRaw;
      let previousHistoryRaw;
      try {
        previousGraphRaw = storage.getItem(graphKey);
        previousHistoryRaw = storage.getItem(historyKey);
        if (Number.isInteger(expectedVersion) && read().version !== expectedVersion) {
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
    restore(graph, history = [], { expectedVersion, preserveCurrent = false } = {}) {
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
        if (Number.isInteger(expectedVersion) && read().version !== expectedVersion) {
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
    clear({ expectedVersion } = {}) {
      let previousGraphRaw;
      let previousHistoryRaw;
      try {
        previousGraphRaw = storage.getItem(graphKey);
        previousHistoryRaw = storage.getItem(historyKey);
        const current = read();
        if (Number.isInteger(expectedVersion) && current.version !== expectedVersion) {
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
