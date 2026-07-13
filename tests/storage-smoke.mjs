import assert from "node:assert/strict";
import { PENDING_WRITES_KEY, createMemoryStorage, getBrowserStorage } from "../storage-adapter.js";

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
persistent.storage.setItem("answer", 42);
assert.equal(persistent.storage.getItem("answer"), "42");
assert.equal(persistent.storage.getItem("__llm_field_notes_storage_probe__"), null);

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
storageEventHandler({
  key: "llm-field-notes-progress",
  newValue: "[4,5,6]",
  storageArea: externalBeforeHydrationOwner.localStorage
});
await externalBeforeHydration.ready;
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
