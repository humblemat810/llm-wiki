import assert from "node:assert/strict";
import { CLEAR_PENDING_KEY, IDB_OPERATION_TIMEOUT_MS, MAX_BROADCAST_VALUE_BYTES, MAX_BROADCAST_VALUE_CHARS, MAX_STORAGE_ENTRIES, MAX_STORAGE_KEY_CHARS, PENDING_WRITE_MARKER_PREFIX, PENDING_WRITES_KEY, STORAGE_MESSAGE_FORMAT, createMemoryStorage, getBrowserStorage, isExternalStorageRemoval, isValidStorageValue } from "../storage-adapter.js";
import { MAX_GRAPH_DOCUMENTS } from "../graph-core.js";
import { MAX_HISTORY_CAPACITY, MAX_PERSISTED_JSON_BYTES, MAX_PERSISTED_JSON_CHARS, MAX_RECOVERY_JSON_CHARS, createGraphStore } from "../graph-store.js";

const boundedConfigStore = createGraphStore(createMemoryStorage(), {
  historyLimit: Number.MAX_SAFE_INTEGER,
  maxPersistedJsonChars: Number.MAX_SAFE_INTEGER
});
assert.equal(MAX_HISTORY_CAPACITY, 20, "graph-store history capacity should share the graph revision ceiling");
assert.equal(MAX_PERSISTED_JSON_CHARS, 50 * 1024 * 1024, "graph-store persisted JSON ceiling should remain explicit");
assert.equal(MAX_PERSISTED_JSON_BYTES, 50 * 1024 * 1024, "graph-store persisted byte ceiling should remain explicit");
assert.equal(MAX_RECOVERY_JSON_CHARS, Math.floor(MAX_PERSISTED_JSON_BYTES / 4), "graph recovery should use a conservative UTF-8-safe character ceiling");
assert.equal(boundedConfigStore.write({ schema: "llm-field-notes/graph@1", version: 0, documents: [], nodes: [], edges: [], revisions: [] }), true, "bounded graph-store configuration should remain usable");
const boundedRecoveryStorage = createMemoryStorage();
const boundedRecoveryStore = createGraphStore(boundedRecoveryStorage, { recoveryKey: "bounded-recovery", maxRecoveryJsonChars: 32 });
boundedRecoveryStorage.setItem("llm-field-notes-knowledge-graph", "x".repeat(33));
boundedRecoveryStore.read();
assert.equal(boundedRecoveryStore.readRecovery(), null, "oversized recovery captures should be skipped instead of duplicating unsafe payloads");
assert.equal(boundedRecoveryStore.hasRecoverySuppression(), true, "oversized recovery captures should expose a suppression status");
assert.equal(boundedRecoveryStore.clearRecovery(), true, "recovery suppression should be clearable through the recovery action");
assert.equal(boundedRecoveryStore.hasRecoverySuppression(), false, "clearing recovery should clear its suppression status");
const importedRecoveryStorage = createMemoryStorage();
const importedRecoveryStore = createGraphStore(importedRecoveryStorage, { recoveryKey: "imported-recovery" });
importedRecoveryStore.captureRecoverySnapshot('{"schema":"llm-field-notes/graph@1","documents":[null]}');
assert.equal(importedRecoveryStore.readRecovery(), '{"schema":"llm-field-notes/graph@1","documents":[null]}', "imported recovery captures should preserve the original payload");
const unicodeBoundedStorage = createMemoryStorage();
const unicodeBoundedStore = createGraphStore(unicodeBoundedStorage, {
  maxPersistedJsonChars: 10000,
  maxPersistedJsonBytes: 500
});
assert.equal(unicodeBoundedStore.write({
  schema: "llm-field-notes/graph@1",
  version: 0,
  documents: [{ id: "unicode", title: "Unicode", text: "🙂".repeat(100), fingerprint: "unicode", addedAt: "2026-01-01T00:00:00.000Z" }],
  nodes: [],
  edges: [],
  revisions: []
}), false, "graph persistence should enforce UTF-8 byte limits even when character limits are not exceeded");
const partialGraphStorage = createMemoryStorage();
const partialGraphStore = createGraphStore(partialGraphStorage);
const partialGraph = {
  schema: "llm-field-notes/graph@1",
  documents: Array.from({ length: MAX_GRAPH_DOCUMENTS + 1 }, (_, index) => ({
    id: `partial-${index}`,
    title: `Partial ${index}`,
    text: "partial source"
  }))
};
assert.equal(partialGraphStore.write(partialGraph), true, "an imported partial graph should be persistable before repair");
const partialMutation = partialGraphStore.read();
partialMutation.version += 1;
partialMutation.nodes = [{ id: "new-partial-node", label: "New partial node" }];
assert.equal(partialGraphStore.write(partialMutation, { expectedVersion: partialGraphStore.read().version }), false, "partial graphs should reject mutations that preserve truncation");
assert.equal(partialGraphStore.getLastWriteMode(), "integrity", "partial graph mutation rejection should expose an integrity write mode");
assert.equal(partialGraphStore.read().nodes.length, 0, "rejected partial graph mutations should preserve the imported graph");
assert.equal(partialGraphStore.write({
  schema: "llm-field-notes/graph@1",
  documents: [{ id: "repaired", title: "Repaired", text: "complete source" }]
}, { expectedVersion: partialGraphStore.read().version }), true, "a clean graph restore should be allowed to repair a partial graph");
const droppedGraphStore = createGraphStore(createMemoryStorage());
const droppedGraph = {
  schema: "llm-field-notes/graph@1",
  documents: [{ id: "dropped-source", title: "Dropped source", text: "source text" }],
  integrity: { dropped: { nodes: 1 } }
};
assert.equal(droppedGraphStore.write(droppedGraph), true, "an imported graph with malformed-entry diagnostics should be persistable before repair");
const droppedMutation = droppedGraphStore.read();
droppedMutation.version += 1;
droppedMutation.nodes = [{ id: "new-dropped-node", label: "New dropped node" }];
assert.equal(droppedGraphStore.write(droppedMutation, { expectedVersion: droppedGraphStore.read().version }), false, "graphs with dropped malformed entries should reject mutations that preserve data-loss diagnostics");
assert.equal(droppedGraphStore.getLastWriteMode(), "integrity", "dropped-entry mutation rejection should expose an integrity write mode");

const orderedStorageValues = new Map([
  ["ordered-graph", JSON.stringify({ schema: "llm-field-notes/graph@1", version: 0, documents: [], nodes: [], edges: [], revisions: [] })],
  ["ordered-history", "[]"]
]);
const orderedStorageCalls = [];
const orderedStorage = {
  getItem: (key) => orderedStorageValues.has(key) ? orderedStorageValues.get(key) : null,
  setItem: (key, value) => {
    orderedStorageCalls.push(`set:${key}`);
    orderedStorageValues.set(key, String(value));
  },
  removeItem: (key) => {
    orderedStorageCalls.push(`remove:${key}`);
    orderedStorageValues.delete(key);
  }
};
const orderedStore = createGraphStore(orderedStorage, {
  graphKey: "ordered-graph",
  historyKey: "ordered-history"
});
assert.equal(orderedStore.write({
  schema: "llm-field-notes/graph@1",
  version: 0,
  documents: [],
  nodes: [{ id: "ordered-node", label: "Ordered node" }],
  edges: [],
  revisions: []
}), true, "graph writes should remain valid in the crash-ordering fixture");
assert.deepEqual(orderedStorageCalls.slice(-2), ["set:ordered-graph", "set:ordered-history"], "graph writes should commit the primary graph before undo history");
orderedStorageCalls.length = 0;
assert.equal(orderedStore.clear(), true, "clear should remain valid in the crash-ordering fixture");
assert.deepEqual(orderedStorageCalls.slice(-2), ["set:ordered-history", "remove:ordered-graph"], "clear should record undo history before removing the primary graph");

function createFakeIndexedDB(controlWrites = false, failClear = false) {
  const values = new Map();
  const pendingCompletions = [];
  let initialized = false;
  let clearFailure = failClear;
  let closeCount = 0;
  const database = {
    objectStoreNames: { contains: (name) => name === "values" },
    createObjectStore: () => {},
    close: () => { closeCount += 1; },
    transaction: () => {
      const transaction = { error: null, oncomplete: null, onerror: null, onabort: null };
      transaction.objectStore = () => ({
        put(value, key) {
          values.set(key, value);
          const complete = () => queueMicrotask(() => transaction.oncomplete?.());
          if (controlWrites) pendingCompletions.push(complete);
          else complete();
        },
        delete(key) {
          values.delete(key);
          const complete = () => queueMicrotask(() => transaction.oncomplete?.());
          if (controlWrites) pendingCompletions.push(complete);
          else complete();
        },
        clear() {
          if (!clearFailure) values.clear();
          const complete = () => queueMicrotask(() => transaction.oncomplete?.());
          const fail = () => queueMicrotask(() => transaction.onerror?.(new Error("IndexedDB clear failed.")));
          if (clearFailure) pendingCompletions.push(fail);
          else if (controlWrites) pendingCompletions.push(complete);
          else complete();
        },
        openCursor() {
          const request = { result: null, onsuccess: null, onerror: null };
          const entries = [...values.entries()];
          let index = 0;
          const advance = () => queueMicrotask(() => {
            if (index >= entries.length) {
              request.result = null;
              request.onsuccess?.();
              return;
            }
            const [key, value] = entries[index++];
            request.result = { key, value, continue: advance };
            request.onsuccess?.();
          });
          advance();
          return request;
        }
      });
      return transaction;
    }
  };
  return {
    open: () => {
      const request = { result: database, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        if (!initialized) {
          initialized = true;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
    seed: (key, value) => values.set(key, value),
    setFailClear: (value) => { clearFailure = value === true; },
    has: (key) => values.has(key),
    releaseNextWrite: () => pendingCompletions.shift()?.(),
    pendingWriteCount: () => pendingCompletions.length,
    closeCalls: () => closeCount
  };
}

function createLocalStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function createStorageOwner(localStorage, indexedDB) {
  const listeners = new Map();
  return {
    localStorage,
    indexedDB,
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    removeEventListener(type, callback) {
      if (listeners.get(type) === callback) listeners.delete(type);
    },
    dispatch(type, event) {
      listeners.get(type)?.(event);
    }
  };
}

const persistentValues = new Map();
const persistentStorage = {
  getItem: (key) => persistentValues.has(key) ? persistentValues.get(key) : null,
  setItem: (key, value) => persistentValues.set(key, String(value)),
  removeItem: (key) => persistentValues.delete(key)
};
const persistent = getBrowserStorage({ localStorage: persistentStorage });
assert.equal(persistent.persistent, true);
assert.equal(persistent.durable, false, "storage without IndexedDB should report its fallback durability mode");
await persistent.ready;
const persistentAnswerKey = "llm-field-notes-answer";
persistent.storage.setItem(persistentAnswerKey, 42);
assert.equal(persistent.storage.getItem(persistentAnswerKey), "42");
assert.throws(
  () => persistent.storage.setItem("x".repeat(MAX_STORAGE_KEY_CHARS + 1), "too-large"),
  /Storage keys must use/,
  "browser fallback writes should reject overlong storage keys before reaching localStorage"
);
assert.throws(
  () => persistent.storage.setItem("unrelated-site-state", "too-large"),
  /Storage keys must use/,
  "browser fallback writes should reject keys outside the application namespace"
);
assert.equal(persistent.storage.getItem("unrelated-site-state"), null, "browser storage should not read unrelated origin keys");
assert.equal(persistent.storage.getItem("__llm_field_notes_storage_probe__"), null);
const oversizedStorageValue = "x".repeat(MAX_BROADCAST_VALUE_CHARS + 1);
const oversizedHydration = getBrowserStorage({
  localStorage: createLocalStorage({ "llm-field-notes-knowledge-graph": oversizedStorageValue })
});
await oversizedHydration.ready;
assert.equal(oversizedHydration.storage.getItem("llm-field-notes-knowledge-graph"), null, "oversized localStorage values should be ignored during hydration");
const oversizedFallback = getBrowserStorage({
  localStorage: createLocalStorage({ "llm-field-notes-knowledge-graph": oversizedStorageValue })
});
assert.equal(oversizedFallback.durable, false, "localStorage-only fallback should disclose its non-durable mode");
assert.equal(oversizedFallback.storageFailure, true, "localStorage-only fallback should disclose rejected existing values");
const overlongFallbackKey = `llm-field-notes-${"x".repeat(MAX_STORAGE_KEY_CHARS)}`;
const overlongFallback = getBrowserStorage({
  localStorage: createLocalStorage({ [overlongFallbackKey]: "stale value" })
});
assert.equal(overlongFallback.storageFailure, true, "localStorage-only fallback should disclose rejected overlong namespaced keys");
const oversizedDatabase = createFakeIndexedDB();
oversizedDatabase.seed("llm-field-notes-knowledge-graph", oversizedStorageValue);
const oversizedDatabaseHydration = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: oversizedDatabase });
await oversizedDatabaseHydration.ready;
assert.equal(oversizedDatabaseHydration.durable, false, "malformed IndexedDB values should fail closed instead of reporting durable storage");
assert.equal(oversizedDatabaseHydration.storageFailure, true, "malformed IndexedDB values should expose degraded storage state");
assert.equal(oversizedDatabaseHydration.storage.getItem("llm-field-notes-knowledge-graph"), null, "oversized IndexedDB values should be ignored during hydration");
const malformedLocalMirrorWithDurableDb = getBrowserStorage({
  localStorage: createLocalStorage({ "llm-field-notes-knowledge-graph": oversizedStorageValue }),
  indexedDB: createFakeIndexedDB()
});
await malformedLocalMirrorWithDurableDb.ready;
assert.equal(malformedLocalMirrorWithDurableDb.durable, true, "a clean IndexedDB should remain usable despite a malformed synchronous mirror");
assert.equal(malformedLocalMirrorWithDurableDb.storageFailure, true, "a malformed synchronous mirror should remain disclosed alongside durable storage");
const durableOnlyDatabase = createFakeIndexedDB();
durableOnlyDatabase.seed("llm-field-notes-knowledge-graph", JSON.stringify({
  schema: "llm-field-notes/graph@1",
  version: 4,
  documents: [{ id: "durable-only", title: "Durable only", text: "Recovered from IndexedDB." }],
  nodes: [],
  edges: [],
  revisions: []
}));
const durableOnlyStatus = [];
const durableOnlyStorage = getBrowserStorage({
  localStorage: createLocalStorage(),
  indexedDB: durableOnlyDatabase
});
durableOnlyStorage.subscribe((event) => durableOnlyStatus.push(event));
await durableOnlyStorage.ready;
assert.equal(durableOnlyStorage.durable, true, "successful IndexedDB hydration should restore durable status");
assert.equal(
  JSON.parse(durableOnlyStorage.storage.getItem("llm-field-notes-knowledge-graph")).documents[0].id,
  "durable-only",
  "successful hydration should expose durable graph state when the synchronous mirror is empty"
);
assert(
  durableOnlyStatus.some((event) => event.type === "status" && event.durable === true && event.storageFailure === false),
  "successful hydration should notify subscribers so the workbench can rerender recovered state and durability"
);
const crowdedDatabase = createFakeIndexedDB();
for (let index = 0; index <= MAX_STORAGE_ENTRIES; index += 1) {
  crowdedDatabase.seed(`llm-field-notes-crowded-${index}`, "x");
}
const crowdedHydration = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: crowdedDatabase });
await crowdedHydration.ready;
assert.equal(crowdedHydration.durable, false, "IndexedDB hydration should fall back when aggregate entry count exceeds its safety limit");
assert.equal(crowdedHydration.storageFailure, true, "aggregate IndexedDB hydration limits should be observable");
const boundedWriteStorage = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: createFakeIndexedDB() });
await boundedWriteStorage.ready;
for (let index = 0; index < MAX_STORAGE_ENTRIES; index += 1) {
  boundedWriteStorage.storage.setItem(`llm-field-notes-write-${index}`, "x");
}
assert.throws(
  () => boundedWriteStorage.storage.setItem("llm-field-notes-write-overflow", "x"),
  /aggregate safety limit/,
  "durable storage writes should enforce the aggregate entry ceiling after hydration"
);
const boundedFallbackStorage = getBrowserStorage({ localStorage: createLocalStorage() });
const fallbackStatusEvents = [];
boundedFallbackStorage.subscribe((event) => {
  if (event.type === "status") fallbackStatusEvents.push(event);
});
for (let index = 0; index < MAX_STORAGE_ENTRIES; index += 1) {
  boundedFallbackStorage.storage.setItem(`llm-field-notes-fallback-${index}`, "x");
}
assert.throws(
  () => boundedFallbackStorage.storage.setItem("llm-field-notes-fallback-overflow", "x"),
  /aggregate safety limit/,
  "localStorage fallback writes should enforce the aggregate entry ceiling"
);
assert.equal(boundedFallbackStorage.storageFailure, true, "localStorage aggregate failures should expose degraded state");
assert(fallbackStatusEvents.some((event) => event.storageFailure === true), "localStorage aggregate failures should notify live status subscribers");
let fallbackStorageEventHandler = null;
let fallbackStorageChange = null;
const fallbackLocalStorage = createLocalStorage();
let fallbackBroadcastHandler = null;
const fallbackBroadcastMessages = [];
class FakeBroadcastChannel {
  constructor() {
    fallbackBroadcastMessages.push(this);
  }
  addEventListener(type, handler) {
    if (type === "message") fallbackBroadcastHandler = handler;
  }
  postMessage(message) {
    this.lastMessage = message;
  }
}
const fallbackPersistent = getBrowserStorage({
  localStorage: fallbackLocalStorage,
  addEventListener: (type, handler) => {
    if (type === "storage") fallbackStorageEventHandler = handler;
  },
  BroadcastChannel: FakeBroadcastChannel
});
const unsubscribeFallback = fallbackPersistent.subscribe((event) => {
  fallbackStorageChange = event;
});
const fallbackStorageFailureBeforeExternalInvalid = fallbackPersistent.storageFailure;
fallbackStorageEventHandler({
  key: "llm-field-notes-knowledge-graph",
  newValue: "external-graph",
  storageArea: fallbackLocalStorage
});
assert.equal(fallbackPersistent.storage.getItem("llm-field-notes-knowledge-graph"), null, "fallback storage should not invent external values before the browser updates its localStorage view");
assert.equal(fallbackStorageChange?.key, "llm-field-notes-knowledge-graph", "localStorage fallback should surface external graph changes");
assert.equal(fallbackStorageChange?.newValue, "external-graph");
assert.equal(fallbackStorageChange?.external, true);
fallbackBroadcastHandler({ data: { format: STORAGE_MESSAGE_FORMAT, key: "llm-field-notes-knowledge-graph", value: "broadcast-graph" } });
assert.equal(fallbackStorageChange?.newValue, "broadcast-graph", "localStorage fallback should surface BroadcastChannel graph changes");
assert.equal(fallbackPersistent.storage.getItem("llm-field-notes-knowledge-graph"), "broadcast-graph", "BroadcastChannel updates should persist into the fallback localStorage mirror");
fallbackBroadcastHandler({ data: { format: STORAGE_MESSAGE_FORMAT, key: "llm-field-notes-knowledge-graph", value: { forged: true } } });
assert.equal(fallbackPersistent.storageFailure, true, "invalid fallback BroadcastChannel values should disclose degraded storage");
assert.equal(fallbackStorageFailureBeforeExternalInvalid, false, "the fallback should begin healthy before an invalid external value");
fallbackPersistent.storage.setItem("llm-field-notes-knowledge-graph", "local-graph");
assert.equal(fallbackBroadcastMessages[0].lastMessage.format, STORAGE_MESSAGE_FORMAT, "localStorage fallback should publish versioned storage messages");
assert.equal(fallbackBroadcastMessages[0].lastMessage.value, "local-graph", "localStorage fallback should publish local writes to other tabs");
fallbackStorageChange = null;
fallbackBroadcastHandler({ data: { key: "llm-field-notes-knowledge-graph", value: "unversioned-forged-value" } });
assert.equal(fallbackStorageChange, null, "unversioned BroadcastChannel messages should be ignored");
const newerGraph = JSON.stringify({
  schema: "llm-field-notes/graph@1",
  version: 2,
  committedAt: "2026-02-02T00:00:00.000Z",
  documents: [],
  nodes: [{ id: "newer", label: "Newer" }],
  edges: [],
  revisions: []
});
const staleGraph = JSON.stringify({
  schema: "llm-field-notes/graph@1",
  version: 1,
  committedAt: "2026-02-01T00:00:00.000Z",
  documents: [],
  nodes: [{ id: "stale", label: "Stale" }],
  edges: [],
  revisions: []
});
const staleGraphLocalStorage = createLocalStorage({ "llm-field-notes-knowledge-graph": newerGraph });
let staleGraphBroadcastHandler = null;
let staleGraphStorageHandler = null;
class StaleGraphBroadcastChannel {
  addEventListener(type, handler) {
    if (type === "message") staleGraphBroadcastHandler = handler;
  }
  postMessage() {}
}
const staleGraphStorage = getBrowserStorage({
  localStorage: staleGraphLocalStorage,
  addEventListener(type, handler) {
    if (type === "storage") staleGraphStorageHandler = handler;
  },
  BroadcastChannel: StaleGraphBroadcastChannel
});
let staleGraphEventCount = 0;
staleGraphStorage.subscribe(() => { staleGraphEventCount += 1; });
staleGraphBroadcastHandler({ data: { format: STORAGE_MESSAGE_FORMAT, key: "llm-field-notes-knowledge-graph", value: staleGraph } });
assert.equal(staleGraphStorage.storage.getItem("llm-field-notes-knowledge-graph"), newerGraph, "stale BroadcastChannel graph values should not overwrite a newer local mirror");
assert.equal(staleGraphEventCount, 0, "stale BroadcastChannel graph values should not notify subscribers");
staleGraphStorageHandler({
  key: "llm-field-notes-knowledge-graph",
  oldValue: newerGraph,
  newValue: staleGraph,
  storageArea: staleGraphLocalStorage
});
assert.equal(staleGraphStorage.storage.getItem("llm-field-notes-knowledge-graph"), newerGraph, "stale native storage graph values should not overwrite a newer local mirror");
assert.equal(staleGraphEventCount, 0, "stale native storage graph values should not notify subscribers");
await staleGraphStorage.dispose();
unsubscribeFallback();
fallbackStorageChange = null;
let fallbackStorageListenerRemoved = 0;
let fallbackChannelListenerRemoved = 0;
let fallbackChannelClosed = 0;
class DisposableFallbackBroadcastChannel {
  addEventListener() {}
  removeEventListener() {
    fallbackChannelListenerRemoved += 1;
  }
  close() {
    fallbackChannelClosed += 1;
  }
  postMessage() {}
}
const disposableFallback = getBrowserStorage({
  localStorage: createLocalStorage(),
  addEventListener: () => {},
  removeEventListener: () => {
    fallbackStorageListenerRemoved += 1;
  },
  BroadcastChannel: DisposableFallbackBroadcastChannel
});
await disposableFallback.ready;
await disposableFallback.dispose();
await disposableFallback.dispose();
assert.equal(fallbackStorageListenerRemoved, 1, "storage disposal should remove the native storage listener exactly once");
assert.equal(fallbackChannelListenerRemoved, 1, "storage disposal should remove the BroadcastChannel listener exactly once");
assert.equal(fallbackChannelClosed, 1, "storage disposal should close its BroadcastChannel exactly once");
fallbackStorageEventHandler({
  key: "llm-field-notes-progress",
  newValue: "[1]",
  storageArea: fallbackLocalStorage
});
assert.equal(fallbackStorageChange, null, "unsubscribed fallback listeners should stop receiving external changes");
const fallbackClearLocalStorage = createLocalStorage({
  "llm-field-notes-progress": "[1]",
  "unrelated-site-state": "preserve-me"
});
const fallbackClearPersistent = getBrowserStorage({ localStorage: fallbackClearLocalStorage });
fallbackClearPersistent.storage.clear();
assert.equal(fallbackClearLocalStorage.getItem("llm-field-notes-progress"), null, "fallback clear should remove namespaced app state");
assert.equal(fallbackClearLocalStorage.getItem("unrelated-site-state"), "preserve-me", "fallback clear must preserve unrelated origin storage");
const durableClearDb = createFakeIndexedDB();
durableClearDb.seed("llm-field-notes-hidden-invalid", { forged: true });
const durableClearOverlongKey = `llm-field-notes-${"x".repeat(MAX_STORAGE_KEY_CHARS)}`;
const durableClearLocalStorage = createLocalStorage({
  "llm-field-notes-corrupt": "x".repeat(MAX_BROADCAST_VALUE_CHARS + 1),
  [durableClearOverlongKey]: "overlong-key"
});
const durableClearPersistent = getBrowserStorage({
  localStorage: durableClearLocalStorage,
  indexedDB: durableClearDb
});
await durableClearPersistent.ready;
assert.equal(durableClearPersistent.durable, false, "invalid IndexedDB entries should keep storage degraded until they are purged");
durableClearPersistent.storage.clear();
await durableClearPersistent.flush();
assert.equal(durableClearPersistent.storage.getItem("llm-field-notes-knowledge-graph"), null, "durable clear should remove pending namespace keys even when their values are not hydrated");
assert.equal(durableClearLocalStorage.getItem("llm-field-notes-corrupt"), null, "durable clear should remove oversized namespaced localStorage remnants");
assert.equal(durableClearLocalStorage.getItem(durableClearOverlongKey), null, "durable clear should remove overlong namespaced localStorage keys");
assert.equal(durableClearDb.has("llm-field-notes-hidden-invalid"), false, "durable clear should purge malformed IndexedDB namespace entries");
assert.equal(durableClearPersistent.durable, true, "a successful purge should restore durable storage capability");
assert.equal(durableClearPersistent.storageFailure, false, "a successful purge should clear the degraded storage state");
const durableClearMarkers = [];
for (let index = 0; index < durableClearLocalStorage.length; index += 1) {
  const key = durableClearLocalStorage.key(index);
  if (key?.startsWith(PENDING_WRITE_MARKER_PREFIX)) durableClearMarkers.push(key);
}
assert.deepEqual(durableClearMarkers, [], "durable clear should remove pending-write marker keys");
const failedClearDb = createFakeIndexedDB(false, true);
failedClearDb.seed("llm-field-notes-hidden-invalid", { forged: true });
const failedClearLocalStorage = createLocalStorage({ "llm-field-notes-visible": "local mirror" });
const failedClearStorage = getBrowserStorage({
  localStorage: failedClearLocalStorage,
  indexedDB: failedClearDb
});
const failedClearStatus = [];
failedClearStorage.subscribe((event) => failedClearStatus.push(event));
await failedClearStorage.ready;
failedClearStorage.storage.clear();
await failedClearStorage.flush();
assert.equal(failedClearStorage.durable, false, "a failed durable clear should demote storage to its synchronous fallback");
assert.equal(failedClearStorage.storageFailure, true, "a failed durable clear should disclose that deletion could not be verified");
assert(failedClearStatus.some((event) => event.type === "status" && event.storageFailure), "a failed durable clear should emit a storage failure status event");
assert.equal(failedClearDb.has("llm-field-notes-hidden-invalid"), true, "a failed durable clear should not claim that the durable namespace was purged");
assert.match(failedClearLocalStorage.getItem(CLEAR_PENDING_KEY) || "", /^\d+-/, "a failed durable clear should retain a generation-bearing retry marker across reloads");
failedClearStorage.storage.setItem("llm-field-notes-after-failed-clear", "new state");
failedClearDb.setFailClear(false);
const failedClearReload = getBrowserStorage({
  localStorage: failedClearLocalStorage,
  indexedDB: failedClearDb
});
await failedClearReload.ready;
await failedClearReload.flush();
assert.equal(failedClearReload.storage.getItem("llm-field-notes-hidden-invalid"), null, "a reloaded workspace should not adopt durable state while a clear retry is pending");
assert.equal(failedClearReload.storage.getItem("llm-field-notes-after-failed-clear"), "new state", "writes made after a failed clear should survive the retry while stale durable state is purged");
assert.equal(failedClearDb.has("llm-field-notes-hidden-invalid"), false, "a reloaded workspace should retry and complete a previously failed durable clear");
assert.equal(failedClearDb.has("llm-field-notes-after-failed-clear"), true, "post-clear writes should be committed after the durable purge completes");
assert.equal(failedClearLocalStorage.getItem(CLEAR_PENDING_KEY), null, "a successful retry should remove the clear marker");
assert.equal(failedClearReload.storageFailure, false, "a successful retry after reload should restore healthy durability");
const crossTabClearDb = createFakeIndexedDB();
crossTabClearDb.seed("llm-field-notes-stale", "stale durable state");
const crossTabClearLocalStorage = createLocalStorage();
const crossTabClearOwner = createStorageOwner(crossTabClearLocalStorage, crossTabClearDb);
const crossTabClearStorage = getBrowserStorage(crossTabClearOwner);
await crossTabClearStorage.ready;
crossTabClearOwner.dispatch("storage", {
  key: CLEAR_PENDING_KEY,
  newValue: "1",
  storageArea: crossTabClearLocalStorage
});
await crossTabClearStorage.flush();
assert.equal(crossTabClearDb.has("llm-field-notes-stale"), false, "a live tab should retry a clear intent received from another tab");
assert.equal(crossTabClearStorage.storageFailure, false, "a successful cross-tab clear retry should restore healthy durability");
failedClearStorage.storage.clear();
await failedClearStorage.flush();
assert.equal(failedClearStorage.durable, true, "a later successful durable clear should restore durable storage");
assert.equal(failedClearStorage.storageFailure, false, "a later successful durable clear should clear the prior storage failure");
assert.equal(failedClearDb.has("llm-field-notes-hidden-invalid"), false, "a later successful durable clear should purge the previously retained durable entry");
const duplicatePendingLocalStorage = createLocalStorage({
  "llm-field-notes-knowledge-graph": "newer-local-mirror",
  [PENDING_WRITES_KEY]: '{"llm-field-notes-knowledge-graph":"older","llm-field-notes-knowledge-graph":"newer"}'
});
const duplicatePendingDb = createFakeIndexedDB();
duplicatePendingDb.seed("llm-field-notes-knowledge-graph", "stale-indexeddb-value");
const duplicatePendingMarker = getBrowserStorage({
  localStorage: duplicatePendingLocalStorage,
  indexedDB: duplicatePendingDb
});
await duplicatePendingMarker.ready;
assert.notEqual(duplicatePendingLocalStorage.getItem(PENDING_WRITES_KEY), '{"llm-field-notes-knowledge-graph":"older","llm-field-notes-knowledge-graph":"newer"}', "ambiguous pending-write metadata should be replaced before it can influence future hydration");
assert.equal(duplicatePendingMarker.storage.getItem("llm-field-notes-knowledge-graph"), "newer-local-mirror", "ambiguous pending-write metadata should preserve the synchronous mirror instead of selecting stale IndexedDB state");
assert.equal(duplicatePendingMarker.storageFailure, true, "ambiguous pending-write metadata should disclose degraded durability");
await duplicatePendingMarker.flush();
const repairedPendingReload = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: duplicatePendingDb });
await repairedPendingReload.ready;
assert.equal(repairedPendingReload.storage.getItem("llm-field-notes-knowledge-graph"), "newer-local-mirror", "ambiguous pending-write recovery should repair the durable mirror before a later hydration");
const malformedTokenLocalStorage = createLocalStorage({
  "llm-field-notes-knowledge-graph": "newest-local-token-mirror",
  [PENDING_WRITES_KEY]: '{"llm-field-notes-knowledge-graph":42}'
});
const malformedTokenDb = createFakeIndexedDB();
malformedTokenDb.seed("llm-field-notes-knowledge-graph", "stale-token-indexeddb-value");
const malformedTokenStorage = getBrowserStorage({ localStorage: malformedTokenLocalStorage, indexedDB: malformedTokenDb });
await malformedTokenStorage.ready;
assert.equal(malformedTokenStorage.storage.getItem("llm-field-notes-knowledge-graph"), "newest-local-token-mirror", "invalid pending-write tokens should preserve the local mirror instead of selecting stale IndexedDB state");
const oversizedMarkerLocalStorage = createLocalStorage({
  "llm-field-notes-knowledge-graph": "bounded-marker-local"
});
for (let index = 0; index <= 100; index += 1) {
  oversizedMarkerLocalStorage.setItem(
    `${PENDING_WRITE_MARKER_PREFIX}llm-field-notes-marker-${index}`,
    `marker-${index}`
  );
}
const oversizedMarkerDb = createFakeIndexedDB();
oversizedMarkerDb.seed("llm-field-notes-knowledge-graph", "bounded-marker-stale");
const oversizedMarkerStorage = getBrowserStorage({ localStorage: oversizedMarkerLocalStorage, indexedDB: oversizedMarkerDb });
await oversizedMarkerStorage.ready;
assert.equal(oversizedMarkerStorage.storageFailure, true, "too many per-key pending markers should disclose degraded durability");
assert.equal(oversizedMarkerStorage.storage.getItem("llm-field-notes-knowledge-graph"), "bounded-marker-local", "too many per-key pending markers should preserve the synchronous mirror");
oversizedMarkerStorage.storage.setItem("llm-field-notes-marker-repair", "ordinary-write");
assert.equal(oversizedMarkerStorage.storageFailure, true, "ordinary writes must not hide unresolved malformed marker metadata");

const unavailable = getBrowserStorage({
  get localStorage() {
    throw new Error("storage blocked");
  }
});
assert.equal(unavailable.persistent, false);
await unavailable.ready;
unavailable.storage.setItem("answer", 42);
assert.equal(unavailable.storage.getItem("answer"), "42");
assert.equal(unavailable.storage.getItem("__llm_field_notes_storage_probe__"), null);

const memory = createMemoryStorage();
memory.setItem("value", "kept");
memory.removeItem("value");
assert.equal(memory.getItem("value"), null);

const fakeIndexedDB = createFakeIndexedDB();
const migratedLocalStorage = createLocalStorage({ "llm-field-notes-knowledge-graph": "legacy" });
const migratedOwner = { localStorage: migratedLocalStorage, indexedDB: fakeIndexedDB };
const durable = getBrowserStorage(migratedOwner);
assert.equal(durable.persistent, true);
await durable.ready;
assert.equal(durable.durable, true, "IndexedDB should become the durable storage path after hydration");
assert.equal(durable.storage.getItem("llm-field-notes-knowledge-graph"), "legacy", "existing local state should be readable after migration");
assert.throws(
  () => durable.storage.setItem("x".repeat(MAX_STORAGE_KEY_CHARS + 1), "too-large"),
  /Storage keys must use/,
  "durable writes should reject overlong storage keys before reaching IndexedDB"
);
durable.storage.setItem("llm-field-notes-knowledge-graph", "updated");
assert.equal(migratedLocalStorage.getItem("llm-field-notes-knowledge-graph"), "updated", "the synchronous browser mirror should update before IndexedDB completes");
await durable.flush();
await new Promise((resolve) => setTimeout(resolve, 0));
const reloaded = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: fakeIndexedDB });
await reloaded.ready;
assert.equal(reloaded.durable, true);
assert.equal(reloaded.storage.getItem("llm-field-notes-knowledge-graph"), "updated", "IndexedDB state should survive a new adapter instance");
const migratedAlongsideDurable = getBrowserStorage({
  localStorage: createLocalStorage({ "llm-field-notes-progress": "[1,2,3]" }),
  indexedDB: fakeIndexedDB
});
await migratedAlongsideDurable.ready;
assert.equal(migratedAlongsideDurable.storage.getItem("llm-field-notes-knowledge-graph"), "updated", "durable graph state should win during hydration");
assert.equal(migratedAlongsideDurable.storage.getItem("llm-field-notes-progress"), "[1,2,3]", "local keys absent from IndexedDB should be preserved during migration");
const migratedProgressReload = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: fakeIndexedDB });
await migratedProgressReload.ready;
assert.equal(migratedProgressReload.storage.getItem("llm-field-notes-progress"), "[1,2,3]", "preserved local keys should be written to IndexedDB");
const disposableDurableDb = createFakeIndexedDB();
const disposableDurable = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: disposableDurableDb });
await disposableDurable.ready;
await disposableDurable.dispose();
await disposableDurable.dispose();
assert.equal(disposableDurableDb.closeCalls(), 1, "durable storage disposal should close its IndexedDB connection exactly once");
const removedBeforeHydration = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: fakeIndexedDB });
removedBeforeHydration.storage.removeItem("llm-field-notes-progress");
await removedBeforeHydration.ready;
assert.equal(removedBeforeHydration.storage.getItem("llm-field-notes-progress"), null, "pre-hydration removals should beat stale IndexedDB values");
const removedProgressReload = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: fakeIndexedDB });
await removedProgressReload.ready;
assert.equal(removedProgressReload.storage.getItem("llm-field-notes-progress"), null, "pre-hydration removals should persist to IndexedDB");
let storageEventHandler = null;
const externalBeforeHydrationOwner = {
  localStorage: createLocalStorage(),
  indexedDB: fakeIndexedDB,
  addEventListener: (type, handler) => {
    if (type === "storage") storageEventHandler = handler;
  }
};
const externalBeforeHydration = getBrowserStorage(externalBeforeHydrationOwner);
const overlongExternalKey = `${"llm-field-notes-"}${"x".repeat(MAX_STORAGE_KEY_CHARS)}`;
storageEventHandler({
  key: overlongExternalKey,
  newValue: "forged",
  storageArea: externalBeforeHydrationOwner.localStorage
});
storageEventHandler({
  key: "llm-field-notes-progress",
  newValue: "[4,5,6]",
  storageArea: externalBeforeHydrationOwner.localStorage
});
await externalBeforeHydration.ready;
assert.equal(externalBeforeHydration.storage.getItem(overlongExternalKey), null, "overlong native storage events should be ignored before hydration");
assert.equal(externalBeforeHydration.storageFailure, true, "overlong native storage events should disclose degraded storage");
assert.equal(externalBeforeHydration.storage.getItem("llm-field-notes-progress"), "[4,5,6]", "external updates before hydration should win over stale durable state");
storageEventHandler({
  key: "llm-field-notes-progress",
  newValue: "[7,8,9]",
  storageArea: externalBeforeHydrationOwner.localStorage
});
await new Promise((resolve) => setTimeout(resolve, 0));
const externalProgressReload = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: fakeIndexedDB });
await externalProgressReload.ready;
assert.equal(externalProgressReload.storage.getItem("llm-field-notes-progress"), "[7,8,9]", "external updates should remain durable after hydration");
const blockedOwner = {
  get localStorage() {
    throw new Error("storage blocked");
  },
  indexedDB: fakeIndexedDB
};
const blocked = getBrowserStorage(blockedOwner);
assert.equal(blocked.persistent, true, "IndexedDB should remain a persistent path when localStorage is blocked");
await blocked.ready;
assert.equal(blocked.durable, true);
assert.equal(blocked.storage.getItem("llm-field-notes-knowledge-graph"), "updated", "blocked localStorage should still hydrate from IndexedDB");
assert.equal(blocked.storageFailure, false);
const interruptedWrite = getBrowserStorage({
  localStorage: createLocalStorage({
    "llm-field-notes-knowledge-graph": "interrupted-write",
    [PENDING_WRITES_KEY]: JSON.stringify(["llm-field-notes-knowledge-graph"])
  }),
  indexedDB: fakeIndexedDB
});
await interruptedWrite.ready;
assert.equal(interruptedWrite.storage.getItem("llm-field-notes-knowledge-graph"), "interrupted-write", "a pending synchronous mirror should win over stale IndexedDB state during hydration");
await interruptedWrite.flush();
const interruptedReload = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: fakeIndexedDB });
await interruptedReload.ready;
assert.equal(interruptedReload.storage.getItem("llm-field-notes-knowledge-graph"), "interrupted-write", "a recovered interrupted write should become durable after hydration");
const staleDurableGraph = JSON.stringify({
  schema: "llm-field-notes/graph@1",
  version: 1,
  committedAt: "2026-01-01T00:00:00.000Z",
  documents: [],
  nodes: [{ id: "durable-old", label: "Durable old" }],
  edges: [],
  revisions: []
});
const newerLocalGraph = JSON.stringify({
  schema: "llm-field-notes/graph@1",
  version: 2,
  committedAt: "2026-01-02T00:00:00.000Z",
  documents: [],
  nodes: [{ id: "local-new", label: "Local new" }],
  edges: [],
  revisions: []
});
const freshnessDatabase = createFakeIndexedDB();
freshnessDatabase.seed("llm-field-notes-knowledge-graph", staleDurableGraph);
freshnessDatabase.seed("llm-field-notes-knowledge-graph-history", "[]");
const freshnessStorage = getBrowserStorage({
  localStorage: createLocalStorage({
    "llm-field-notes-knowledge-graph": newerLocalGraph,
    "llm-field-notes-knowledge-graph-history": "[]"
  }),
  indexedDB: freshnessDatabase
});
await freshnessStorage.ready;
assert.equal(
  freshnessStorage.storage.getItem("llm-field-notes-knowledge-graph"),
  newerLocalGraph,
  "hydration should preserve a newer synchronous graph mirror over stale durable state"
);
await freshnessStorage.flush();
const freshnessReload = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: freshnessDatabase });
await freshnessReload.ready;
assert.equal(
  freshnessReload.storage.getItem("llm-field-notes-knowledge-graph"),
  newerLocalGraph,
  "hydration should reconcile a newer synchronous graph mirror back into durable storage"
);
const preHydrationFlushDb = createFakeIndexedDB();
const preHydrationFlush = getBrowserStorage({
  localStorage: createLocalStorage(),
  indexedDB: preHydrationFlushDb
});
preHydrationFlush.storage.setItem("llm-field-notes-knowledge-graph", "flushed-before-ready");
await preHydrationFlush.flush();
const preHydrationFlushReload = getBrowserStorage({
  localStorage: createLocalStorage(),
  indexedDB: preHydrationFlushDb
});
await preHydrationFlushReload.ready;
assert.equal(preHydrationFlushReload.storage.getItem("llm-field-notes-knowledge-graph"), "flushed-before-ready", "flush should wait for hydration before resolving");
const preHydrationClearDb = createFakeIndexedDB();
preHydrationClearDb.seed("llm-field-notes-stale", "stale-before-clear");
const preHydrationClear = getBrowserStorage({
  localStorage: createLocalStorage(),
  indexedDB: preHydrationClearDb
});
preHydrationClear.storage.clear();
preHydrationClear.storage.setItem("llm-field-notes-after-clear", "new-after-clear");
await preHydrationClear.ready;
await preHydrationClear.flush();
const preHydrationClearReload = getBrowserStorage({
  localStorage: createLocalStorage(),
  indexedDB: preHydrationClearDb
});
await preHydrationClearReload.ready;
assert.equal(preHydrationClearReload.storage.getItem("llm-field-notes-stale"), null, "pre-hydration clear should purge stale durable values");
assert.equal(preHydrationClearReload.storage.getItem("llm-field-notes-after-clear"), "new-after-clear", "writes after a pre-hydration clear should survive");
const controlledIndexedDB = createFakeIndexedDB(true);
const controlledLocalStorage = createLocalStorage();
const rapidWrites = getBrowserStorage({ localStorage: controlledLocalStorage, indexedDB: controlledIndexedDB });
await rapidWrites.ready;
rapidWrites.storage.setItem("llm-field-notes-knowledge-graph", "first-write");
rapidWrites.storage.setItem("llm-field-notes-knowledge-graph", "second-write");
for (let attempt = 0; attempt < 20 && controlledIndexedDB.pendingWriteCount() === 0; attempt += 1) await Promise.resolve();
assert.equal(controlledIndexedDB.pendingWriteCount(), 1, "the first rapid write should reach the durable queue");
let rapidFlushSettled = false;
const rapidFlush = rapidWrites.flush().then(() => {
  rapidFlushSettled = true;
});
await Promise.resolve();
assert.equal(rapidFlushSettled, false, "flush should remain pending while an IndexedDB write is blocked");
controlledIndexedDB.releaseNextWrite();
for (let attempt = 0; attempt < 20 && controlledIndexedDB.pendingWriteCount() === 0; attempt += 1) await Promise.resolve();
const pendingAfterOlderCommit = JSON.parse(controlledLocalStorage.getItem(PENDING_WRITES_KEY) || "{}");
assert(pendingAfterOlderCommit["llm-field-notes-knowledge-graph"], "an older commit must not clear the newer pending-write generation");
assert.equal(controlledIndexedDB.pendingWriteCount(), 1, "the second rapid write should remain queued after the first commit");
controlledIndexedDB.releaseNextWrite();
await rapidFlush;
assert.equal(rapidFlushSettled, true, "flush should resolve after all queued IndexedDB writes commit");
assert.equal(controlledLocalStorage.getItem(PENDING_WRITES_KEY), null, "the newest successful commit should clear its pending-write generation");
const rapidReload = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: controlledIndexedDB });
await rapidReload.ready;
assert.equal(rapidReload.storage.getItem("llm-field-notes-knowledge-graph"), "second-write", "rapid writes should persist the newest graph value");
let durableBroadcastHandler = null;
class DurableBroadcastChannel {
  addEventListener(type, handler) {
    if (type === "message") durableBroadcastHandler = handler;
  }
  postMessage() {}
}
const durableChannelStorage = createLocalStorage();
const durableChannel = getBrowserStorage({
  localStorage: durableChannelStorage,
  indexedDB: createFakeIndexedDB(),
  BroadcastChannel: DurableBroadcastChannel
});
const durableChannelEvents = [];
durableChannel.subscribe((event) => durableChannelEvents.push(event));
await durableChannel.ready;
durableBroadcastHandler({ data: { format: STORAGE_MESSAGE_FORMAT, key: PENDING_WRITES_KEY, value: "{\"forged\":true}" } });
assert.equal(durableChannel.storage.getItem(PENDING_WRITES_KEY), null, "durable BroadcastChannel updates must ignore the internal pending-write marker");
assert.equal(durableChannelEvents.filter((event) => event.type === "change").length, 0, "ignored pending-write broadcasts must not notify storage subscribers as changes");
durableBroadcastHandler({ data: { format: STORAGE_MESSAGE_FORMAT, key: "llm-field-notes-knowledge-graph", value: { forged: true } } });
assert.equal(durableChannel.storage.getItem("llm-field-notes-knowledge-graph"), null, "durable BroadcastChannel updates must reject non-string values");
assert.equal(durableChannelEvents.filter((event) => event.type === "change").length, 0, "rejected BroadcastChannel values must not notify storage subscribers as changes");
assert.equal(durableChannel.storageFailure, true, "rejected durable BroadcastChannel values should disclose degraded storage");
durableBroadcastHandler({ data: { format: STORAGE_MESSAGE_FORMAT, key: `${"llm-field-notes-"}${"x".repeat(MAX_STORAGE_KEY_CHARS)}`, value: "forged" } });
assert.equal(durableChannelEvents.filter((event) => event.type === "change").length, 0, "overlong BroadcastChannel keys must not notify storage subscribers");
assert.equal(MAX_STORAGE_KEY_CHARS, 256, "cross-tab storage keys should have an explicit bounded name ceiling");
assert.equal(MAX_BROADCAST_VALUE_CHARS, 50 * 1024 * 1024, "cross-tab value bounds should match the persisted graph character ceiling");
assert.equal(MAX_BROADCAST_VALUE_BYTES, 50 * 1024 * 1024, "cross-tab value bounds should match the persisted graph byte ceiling");
assert.equal(isValidStorageValue("🙂🙂", { maxChars: 4, maxBytes: 7 }), false, "storage values should reject UTF-8 byte overflow even when character count fits");
assert.equal(isValidStorageValue("🙂🙂", { maxChars: 4, maxBytes: 16 }), true, "storage values should accept Unicode content within both bounds");
assert.equal(isExternalStorageRemoval({ external: true, key: "llm-field-notes-knowledge-graph", newValue: null }, "llm-field-notes-knowledge-graph"), true, "explicit external graph removals should be distinguishable from stale updates");
assert.equal(isExternalStorageRemoval({ external: true, key: "llm-field-notes-knowledge-graph", newValue: "{}" }, "llm-field-notes-knowledge-graph"), false, "external graph writes should not be classified as removals");
assert.equal(isExternalStorageRemoval({ external: false, key: "llm-field-notes-knowledge-graph", newValue: null }, "llm-field-notes-knowledge-graph"), false, "local removals should not be classified as cross-tab removals");
assert.equal(IDB_OPERATION_TIMEOUT_MS, 5000, "IndexedDB writes should have an explicit bounded operation timeout");
const sharedPendingStorage = createLocalStorage();
const crossTabIndexedDB = createFakeIndexedDB(true);
const crossTabWriterA = getBrowserStorage({ localStorage: sharedPendingStorage, indexedDB: crossTabIndexedDB });
const crossTabWriterB = getBrowserStorage({ localStorage: sharedPendingStorage, indexedDB: crossTabIndexedDB });
await Promise.all([crossTabWriterA.ready, crossTabWriterB.ready]);
crossTabWriterA.storage.setItem("llm-field-notes-knowledge-graph", "tab-a");
const crossTabTokenA = JSON.parse(sharedPendingStorage.getItem(PENDING_WRITES_KEY) || "{}")["llm-field-notes-knowledge-graph"];
crossTabWriterB.storage.setItem("llm-field-notes-knowledge-graph", "tab-b");
const crossTabTokenB = JSON.parse(sharedPendingStorage.getItem(PENDING_WRITES_KEY) || "{}")["llm-field-notes-knowledge-graph"];
assert(crossTabTokenA && crossTabTokenB && crossTabTokenA !== crossTabTokenB, "cross-tab pending-write generations must remain unique even for same-key rapid writes");
crossTabWriterA.storage.setItem("llm-field-notes-answer", "tab-a-answer");
crossTabWriterB.storage.setItem("llm-field-notes-progress", "tab-b-progress");
const mergedPendingWrites = JSON.parse(sharedPendingStorage.getItem(PENDING_WRITES_KEY) || "{}");
assert(mergedPendingWrites["llm-field-notes-answer"], "cross-tab pending markers should retain a different key written by another tab");
assert(mergedPendingWrites["llm-field-notes-progress"], "cross-tab pending markers should retain the latest key written by another tab");
for (let attempt = 0; attempt < 100; attempt += 1) {
  crossTabIndexedDB.releaseNextWrite();
  await Promise.resolve();
}
await Promise.all([crossTabWriterA.flush(), crossTabWriterB.flush()]);
assert.equal(sharedPendingStorage.getItem(PENDING_WRITES_KEY), null, "cross-tab pending markers should clear only after all durable generations settle");
const markerRaceStorage = createLocalStorage();
const markerRaceDb = createFakeIndexedDB(true);
const markerRaceWriterA = getBrowserStorage({ localStorage: markerRaceStorage, indexedDB: markerRaceDb });
const markerRaceWriterB = getBrowserStorage({ localStorage: markerRaceStorage, indexedDB: markerRaceDb });
await Promise.all([markerRaceWriterA.ready, markerRaceWriterB.ready]);
markerRaceWriterA.storage.setItem("llm-field-notes-race-a", "a");
markerRaceWriterB.storage.setItem("llm-field-notes-race-b", "b");
const markerKeys = [];
for (let index = 0; index < markerRaceStorage.length; index += 1) {
  const key = markerRaceStorage.key(index);
  if (key?.startsWith(PENDING_WRITE_MARKER_PREFIX)) markerKeys.push(key);
}
assert.equal(markerKeys.length, 2, "cross-tab writes should use independent per-key pending markers");
assert(markerKeys.every((key) => markerRaceStorage.getItem(key)), "per-key pending markers should retain both concurrent generations");
for (let attempt = 0; attempt < 100; attempt += 1) {
  markerRaceDb.releaseNextWrite();
  await Promise.resolve();
}
await Promise.all([markerRaceWriterA.flush(), markerRaceWriterB.flush()]);
assert.equal(markerRaceStorage.getItem(PENDING_WRITES_KEY), null, "aggregate pending markers should clear after per-key generations settle");
assert.equal(markerRaceStorage.length, 2, "per-key pending markers should be removed after successful durable commits");
const entropyOwners = [
  { localStorage: createLocalStorage(), indexedDB: createFakeIndexedDB(true), crypto: { getRandomValues(values) { values.fill(0xabcdef01); return values; } } },
  { localStorage: createLocalStorage(), indexedDB: createFakeIndexedDB(true), crypto: { getRandomValues(values) { values.fill(0xabcdef02); return values; } } }
];
const entropyWriters = entropyOwners.map((owner) => getBrowserStorage(owner));
await Promise.all(entropyWriters.map((writer) => writer.ready));
entropyWriters[0].storage.setItem("llm-field-notes-entropy-a", "a");
entropyWriters[1].storage.setItem("llm-field-notes-entropy-b", "b");
const entropyTokens = entropyOwners.map((owner) => JSON.parse(owner.localStorage.getItem(PENDING_WRITES_KEY) || "{}"));
assert.notEqual(
  entropyTokens[0]["llm-field-notes-entropy-a"],
  entropyTokens[1]["llm-field-notes-entropy-b"],
  "durable write generations should use getRandomValues when randomUUID is unavailable"
);
await Promise.all(entropyWriters.map((writer) => writer.flush()));
const failingOwner = {
  localStorage: createLocalStorage(),
  indexedDB: {
    open: () => {
      const request = { error: new Error("IndexedDB unavailable"), onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => request.onerror?.());
      return request;
    }
  }
};
const failing = getBrowserStorage(failingOwner);
const statusEvents = [];
failing.subscribe((event) => statusEvents.push(event));
await failing.ready;
assert.equal(failing.durable, false);
assert.equal(failing.storageFailure, true, "failed durable hydration should be observable");
assert(statusEvents.some((event) => event.type === "status" && event.storageFailure), "storage failure should emit a status event");
const hangingRead = getBrowserStorage({
  localStorage: createLocalStorage(),
  indexedDB: {
    open: () => {
      const database = {
        objectStoreNames: { contains: () => true },
        transaction: () => ({
          objectStore: () => ({
            openCursor: () => ({ result: null, onsuccess: null, onerror: null })
          }),
          onerror: null
        })
      };
      const request = { result: database, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  }
});
await hangingRead.ready;
assert.equal(hangingRead.durable, false, "a stalled IndexedDB read should fall back instead of blocking startup");
assert.equal(hangingRead.storageFailure, true, "a stalled IndexedDB read should be observable");
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, Math.min(delay, 10), ...args);
try {
  const hangingWrite = getBrowserStorage({
    localStorage: createLocalStorage(),
    indexedDB: createFakeIndexedDB(true)
  });
  await hangingWrite.ready;
  hangingWrite.storage.setItem("llm-field-notes-knowledge-graph", "hanging-write");
  await hangingWrite.flush();
  assert.equal(hangingWrite.durable, false, "a stalled IndexedDB write should demote to fallback storage");
  assert.equal(hangingWrite.storageFailure, true, "a stalled IndexedDB write should be observable");
} finally {
  globalThis.setTimeout = originalSetTimeout;
}
let lateOpenRequest = null;
let lateCloseCalls = 0;
const lateDatabase = {
  objectStoreNames: { contains: () => true },
  close: () => { lateCloseCalls += 1; },
  transaction: () => ({
    objectStore: () => ({
      openCursor: () => ({ result: null, onsuccess: null, onerror: null })
    }),
    onerror: null
  })
};
const lateOpen = getBrowserStorage({
  localStorage: createLocalStorage(),
  indexedDB: {
    open: () => {
      lateOpenRequest = { result: lateDatabase, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      return lateOpenRequest;
    }
  }
});
await lateOpen.ready;
assert.equal(lateOpen.durable, false, "a late IndexedDB open should remain on the fallback path");
lateOpenRequest.onsuccess?.();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(lateCloseCalls, 1, "a database opened after hydration timeout should be closed");

console.log("storage adapter smoke ok");
