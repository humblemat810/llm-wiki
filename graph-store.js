import { GRAPH_SCHEMA, LEGACY_GRAPH_SCHEMAS, defaultGraph, normalizeGraph } from "./graph-core.js";

export const GRAPH_KEY = "llm-field-notes-knowledge-graph";
export const HISTORY_KEY = "llm-field-notes-knowledge-graph-history";
export const RECOVERY_KEY = "llm-field-notes-knowledge-graph-recovery";
export const HISTORY_LIMIT = 3;

export function createGraphStore(storage, {
  graphKey = GRAPH_KEY,
  historyKey = HISTORY_KEY,
  recoveryKey = RECOVERY_KEY,
  historyLimit = HISTORY_LIMIT
} = {}) {
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
      const stored = JSON.parse(storage.getItem(historyKey) || "[]");
      return Array.isArray(stored) ? stored.slice(-historyLimit).map(normalizeGraph) : [];
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
      try {
        previousGraphRaw = storage.getItem(graphKey);
        previousHistoryRaw = storage.getItem(historyKey);
        const normalized = normalizeGraph(graph);
        if (Number.isInteger(expectedVersion) && read().version !== expectedVersion) {
          lastWriteMode = "conflict";
          return false;
        }
        if (recordHistory) {
          const history = readHistory();
          const current = read();
          if (current.version !== normalized.version || JSON.stringify(current) !== JSON.stringify(normalized)) {
            history.push(current);
            storage.setItem(historyKey, JSON.stringify(history.slice(-historyLimit)));
          }
        }
        storage.setItem(graphKey, JSON.stringify(normalized));
        lastWriteMode = "normal";
        return true;
      } catch {
        rollback(previousGraphRaw, previousHistoryRaw);
        try {
          storage.setItem(graphKey, JSON.stringify(normalizeGraph(graph)));
          lastWriteMode = "without-new-history";
          return true;
        } catch {
          rollback(previousGraphRaw, previousHistoryRaw);
          try {
            storage.removeItem(historyKey);
            storage.setItem(graphKey, JSON.stringify(normalizeGraph(graph)));
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
    undo() {
      let previousGraphRaw;
      let previousHistoryRaw;
      try {
        previousGraphRaw = storage.getItem(graphKey);
        previousHistoryRaw = storage.getItem(historyKey);
        const history = readHistory();
        const previous = history.pop();
        if (!previous) return false;
        storage.setItem(graphKey, JSON.stringify(previous));
        storage.setItem(historyKey, JSON.stringify(history));
        return true;
      } catch {
        rollback(previousGraphRaw, previousHistoryRaw);
        return false;
      }
    },
    restore(graph, history = [], { expectedVersion } = {}) {
      let previousGraphRaw;
      let previousHistoryRaw;
      const normalizedGraph = normalizeGraph(graph);
      const normalizedHistory = Array.isArray(history) ? history.slice(-historyLimit).map(normalizeGraph) : [];
      try {
        previousGraphRaw = storage.getItem(graphKey);
        previousHistoryRaw = storage.getItem(historyKey);
        if (Number.isInteger(expectedVersion) && read().version !== expectedVersion) {
          lastWriteMode = "conflict";
          return false;
        }
        storage.setItem(graphKey, JSON.stringify(normalizedGraph));
        storage.setItem(historyKey, JSON.stringify(normalizedHistory));
        lastWriteMode = "normal";
        return true;
      } catch {
        rollback(previousGraphRaw, previousHistoryRaw);
        try {
          storage.removeItem(historyKey);
          storage.setItem(graphKey, JSON.stringify(normalizedGraph));
          lastWriteMode = "without-history";
          return true;
        } catch {
          rollback(previousGraphRaw, previousHistoryRaw);
          lastWriteMode = "failed";
          return false;
        }
      }
    },
    clear() {
      let previousGraphRaw;
      let previousHistoryRaw;
      try {
        previousGraphRaw = storage.getItem(graphKey);
        previousHistoryRaw = storage.getItem(historyKey);
        const current = read();
        if (current.nodes.length || current.documents.length) {
          const history = readHistory();
          history.push(current);
          storage.setItem(historyKey, JSON.stringify(history.slice(-historyLimit)));
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
