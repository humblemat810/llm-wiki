import assert from "node:assert/strict";
import { IDB_OPERATION_TIMEOUT_MS, MAX_BROADCAST_VALUE_BYTES, MAX_BROADCAST_VALUE_CHARS, MAX_STORAGE_KEY_CHARS, PENDING_WRITES_KEY, createMemoryStorage, getBrowserStorage, isExternalStorageRemoval, isValidStorageValue } from "../storage-adapter.js";
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

function createFakeIndexedDB(controlWrites = false) {
  const values = new Map();
  const pendingCompletions = [];
  let initialized = false;
  const database = {
    objectStoreNames: { contains: (name) => name === "values" },
    createObjectStore: () => {},
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
    releaseNextWrite: () => pendingCompletions.shift()?.(),
    pendingWriteCount: () => pendingCompletions.length
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
const oversizedDatabase = createFakeIndexedDB();
oversizedDatabase.seed("llm-field-notes-knowledge-graph", oversizedStorageValue);
const oversizedDatabaseHydration = getBrowserStorage({ localStorage: createLocalStorage(), indexedDB: oversizedDatabase });
await oversizedDatabaseHydration.ready;
assert.equal(oversizedDatabaseHydration.storage.getItem("llm-field-notes-knowledge-graph"), null, "oversized IndexedDB values should be ignored during hydration");
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
fallbackStorageEventHandler({
  key: "llm-field-notes-knowledge-graph",
  newValue: "external-graph",
  storageArea: fallbackLocalStorage
});
assert.equal(fallbackPersistent.storage.getItem("llm-field-notes-knowledge-graph"), null, "fallback storage should not invent external values before the browser updates its localStorage view");
assert.equal(fallbackStorageChange?.key, "llm-field-notes-knowledge-graph", "localStorage fallback should surface external graph changes");
assert.equal(fallbackStorageChange?.newValue, "external-graph");
assert.equal(fallbackStorageChange?.external, true);
fallbackBroadcastHandler({ data: { key: "llm-field-notes-knowledge-graph", value: "broadcast-graph" } });
assert.equal(fallbackStorageChange?.newValue, "broadcast-graph", "localStorage fallback should surface BroadcastChannel graph changes");
fallbackPersistent.storage.setItem("llm-field-notes-knowledge-graph", "local-graph");
assert.equal(fallbackBroadcastMessages[0].lastMessage.value, "local-graph", "localStorage fallback should publish local writes to other tabs");
unsubscribeFallback();
fallbackStorageChange = null;
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
const durableClearPersistent = getBrowserStorage({
  localStorage: createLocalStorage({ [PENDING_WRITES_KEY]: JSON.stringify({ "llm-field-notes-knowledge-graph": "stale-token" }) }),
  indexedDB: durableClearDb
});
await durableClearPersistent.ready;
durableClearPersistent.storage.clear();
await durableClearPersistent.flush();
assert.equal(durableClearPersistent.storage.getItem("llm-field-notes-knowledge-graph"), null, "durable clear should remove pending namespace keys even when their values are not hydrated");
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
const controlledIndexedDB = createFakeIndexedDB(true);
const controlledLocalStorage = createLocalStorage();
const rapidWrites = getBrowserStorage({ localStorage: controlledLocalStorage, indexedDB: controlledIndexedDB });
await rapidWrites.ready;
rapidWrites.storage.setItem("llm-field-notes-knowledge-graph", "first-write");
rapidWrites.storage.setItem("llm-field-notes-knowledge-graph", "second-write");
for (let attempt = 0; attempt < 20 && controlledIndexedDB.pendingWriteCount() === 0; attempt += 1) await Promise.resolve();
assert.equal(controlledIndexedDB.pendingWriteCount(), 1, "the first rapid write should reach the durable queue");
controlledIndexedDB.releaseNextWrite();
for (let attempt = 0; attempt < 20 && controlledIndexedDB.pendingWriteCount() === 0; attempt += 1) await Promise.resolve();
const pendingAfterOlderCommit = JSON.parse(controlledLocalStorage.getItem(PENDING_WRITES_KEY) || "{}");
assert(pendingAfterOlderCommit["llm-field-notes-knowledge-graph"], "an older commit must not clear the newer pending-write generation");
assert.equal(controlledIndexedDB.pendingWriteCount(), 1, "the second rapid write should remain queued after the first commit");
controlledIndexedDB.releaseNextWrite();
await rapidWrites.flush();
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
durableBroadcastHandler({ data: { key: PENDING_WRITES_KEY, value: "{\"forged\":true}" } });
assert.equal(durableChannel.storage.getItem(PENDING_WRITES_KEY), null, "durable BroadcastChannel updates must ignore the internal pending-write marker");
assert.equal(durableChannelEvents.length, 0, "ignored pending-write broadcasts must not notify storage subscribers");
durableBroadcastHandler({ data: { key: "llm-field-notes-knowledge-graph", value: { forged: true } } });
assert.equal(durableChannel.storage.getItem("llm-field-notes-knowledge-graph"), null, "durable BroadcastChannel updates must reject non-string values");
assert.equal(durableChannelEvents.length, 0, "rejected BroadcastChannel values must not notify storage subscribers");
durableBroadcastHandler({ data: { key: `${"llm-field-notes-"}${"x".repeat(MAX_STORAGE_KEY_CHARS)}`, value: "forged" } });
assert.equal(durableChannelEvents.length, 0, "overlong BroadcastChannel keys must not notify storage subscribers");
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
