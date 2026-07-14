const STORAGE_PREFIX = "llm-field-notes-";
const DATABASE_NAME = "llm-field-notes";
const DATABASE_VERSION = 1;
const STORE_NAME = "values";
const CHANNEL_NAME = "llm-field-notes-storage";
const HYDRATION_TIMEOUT_MS = 1500;
export const IDB_OPERATION_TIMEOUT_MS = 5000;
export const PENDING_WRITES_KEY = `${STORAGE_PREFIX}pending-writes`;
export const MAX_STORAGE_KEY_CHARS = 256;
export const MAX_BROADCAST_VALUE_CHARS = 50 * 1024 * 1024;
const MAX_PENDING_WRITES = 100;
let storageInstanceSequence = 0;

export function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

function readLocalValues(storage) {
  const values = new Map();
  if (!storage) return values;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (isValidStorageKey(key) && key !== PENDING_WRITES_KEY) {
        const value = storage.getItem(key);
        if (isValidBroadcastValue(value)) values.set(key, value);
      }
    }
  } catch {
    // The caller already has the storage fallback path.
  }
  return values;
}

function readPendingWrites(storage) {
  if (!storage) return new Map();
  try {
    const parsed = JSON.parse(storage.getItem(PENDING_WRITES_KEY) || "[]");
    const pending = new Map();
    if (Array.isArray(parsed)) {
      parsed
        .filter((key) => isValidStorageKey(key) && key !== PENDING_WRITES_KEY)
        .slice(-MAX_PENDING_WRITES)
        .forEach((key) => pending.set(key, "legacy"));
      return pending;
    }
    if (!parsed || typeof parsed !== "object") return pending;
    Object.entries(parsed)
      .filter(([key, token]) => isValidStorageKey(key) && key !== PENDING_WRITES_KEY && typeof token === "string" && token.length <= 128)
      .slice(-MAX_PENDING_WRITES)
      .forEach(([key, token]) => pending.set(key, token));
    return pending;
  } catch {
    return new Map();
  }
}

function isValidBroadcastValue(value) {
  return value === null || (typeof value === "string" && value.length <= MAX_BROADCAST_VALUE_CHARS);
}

function isValidStorageKey(key) {
  return typeof key === "string" && key.length <= MAX_STORAGE_KEY_CHARS && key.startsWith(STORAGE_PREFIX);
}

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => finish(resolve, request.result);
    request.onerror = () => finish(reject, request.error || new Error("IndexedDB could not be opened."));
    request.onblocked = () => finish(reject, new Error("IndexedDB is blocked by another connection."));
  });
}

function readDatabaseValues(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).openCursor();
    const values = new Map();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(values);
        return;
      }
      if (isValidStorageKey(cursor.key) && isValidBroadcastValue(cursor.value)) values.set(cursor.key, cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error("IndexedDB could not be read."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

function writeDatabaseValue(database, key, value) {
  return runDatabaseWrite(database, (store) => store.put(value, key), "IndexedDB could not be written.");
}

function removeDatabaseValue(database, key) {
  return runDatabaseWrite(database, (store) => store.delete(key), "IndexedDB could not be updated.");
}

function runDatabaseWrite(database, operation, failureMessage) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      finish(reject, new Error(`${failureMessage} Transaction timed out.`));
      try {
        transaction.abort?.();
      } catch {
        // A non-conforming transaction must not suppress fallback persistence.
      }
    }, IDB_OPERATION_TIMEOUT_MS);
    transaction.oncomplete = () => finish(resolve);
    transaction.onerror = () => finish(reject, transaction.error || new Error(failureMessage));
    transaction.onabort = () => finish(reject, transaction.error || new Error(`${failureMessage} Transaction aborted.`));
    try {
      operation(transaction.objectStore(STORE_NAME));
    } catch (error) {
      finish(reject, error);
    }
  });
}

function createDurableStorage(owner, localStorage) {
  const fallbackStorage = localStorage || createMemoryStorage();
  const values = readLocalValues(localStorage);
  const dirtyBeforeReady = new Map();
  const subscribers = new Set();
  let database = null;
  let hydrated = false;
  let durable = false;
  let storageFailure = false;
  let writeQueue = Promise.resolve();
  let channel = null;

  const notify = (key, value, external = false, broadcast = false) => {
    const event = { type: "change", key, newValue: value, storageArea: localStorage, external, broadcast };
    subscribers.forEach((subscriber) => {
      try {
        subscriber(event);
      } catch {
        // A subscriber must not break persistence.
      }
    });
  };
  const notifyStatus = () => {
    const event = { type: "status", durable, storageFailure };
    subscribers.forEach((subscriber) => {
      try {
        subscriber(event);
      } catch {
        // A subscriber must not break persistence.
      }
    });
  };
  const publish = (key, value) => {
    try {
      channel?.postMessage({ key, value });
    } catch {
      // BroadcastChannel is an optional synchronization enhancement.
    }
  };
  const fallbackWrite = (key, value) => {
    try {
      if (value === null) fallbackStorage.removeItem(key);
      else fallbackStorage.setItem(key, value);
    } catch {
      // The graph store reports the write failure through its own adapter.
    }
  };
  const pendingWrites = readPendingWrites(fallbackStorage);
  const persistPendingWrites = () => {
    if (pendingWrites.size) fallbackWrite(PENDING_WRITES_KEY, JSON.stringify(Object.fromEntries([...pendingWrites].slice(-MAX_PENDING_WRITES))));
    else fallbackWrite(PENDING_WRITES_KEY, null);
  };
  let pendingSequence = 0;
  const instanceId = (() => {
    try {
      if (typeof owner.crypto?.randomUUID === "function") return owner.crypto.randomUUID();
    } catch {
      // Fall back to a process-local identity for test and restricted contexts.
    }
    storageInstanceSequence += 1;
    return `instance-${storageInstanceSequence}`;
  })();
  const markPending = (key) => {
    if (!key || key === PENDING_WRITES_KEY) return null;
    pendingSequence += 1;
    const token = `${Date.now()}-${instanceId}-${pendingSequence}`;
    pendingWrites.set(key, token);
    persistPendingWrites();
    return token;
  };
  const clearPending = (key, token) => {
    if (pendingWrites.get(key) !== token) return;
    pendingWrites.delete(key);
    persistPendingWrites();
  };
  const enqueueDurableWrite = (key, token, operation, fallback) => {
    writeQueue = writeQueue.then(async () => {
      await operation();
      clearPending(key, token);
    }).catch(() => {
      durable = false;
      storageFailure = true;
      fallback?.();
      notifyStatus();
    });
    return writeQueue;
  };
  const storage = {
    getItem(key) {
      if (hydrated) return values.has(key) ? values.get(key) : null;
      if (values.has(key)) return values.get(key);
      const fallbackValue = fallbackStorage.getItem(key);
      return isValidBroadcastValue(fallbackValue) ? fallbackValue : null;
    },
    setItem(key, value) {
      const normalized = String(value);
      if (!isValidBroadcastValue(normalized)) {
        throw new Error("Storage value exceeds the safety limit.");
      }
      values.set(key, normalized);
      if (!hydrated) dirtyBeforeReady.set(key, normalized);
      const pendingToken = owner.indexedDB ? markPending(key) : null;
      fallbackWrite(key, normalized);
      if (durable && database) enqueueDurableWrite(key, pendingToken, () => writeDatabaseValue(database, key, normalized), () => fallbackWrite(key, normalized));
      publish(key, normalized);
      notify(key, normalized);
    },
    removeItem(key) {
      values.delete(key);
      if (!hydrated) dirtyBeforeReady.set(key, null);
      const pendingToken = owner.indexedDB ? markPending(key) : null;
      fallbackWrite(key, null);
      if (durable && database) enqueueDurableWrite(key, pendingToken, () => removeDatabaseValue(database, key), () => fallbackWrite(key, null));
      publish(key, null);
      notify(key, null);
    },
    clear() {
      new Set([...values.keys(), ...pendingWrites.keys()]).forEach((key) => storage.removeItem(key));
    }
  };

  const onStorage = (event) => {
    if (localStorage && event.storageArea && event.storageArea !== localStorage) return;
    if (!isValidStorageKey(event.key) || event.key === PENDING_WRITES_KEY) return;
    if (event.newValue === null) values.delete(event.key);
    else if (isValidBroadcastValue(event.newValue)) values.set(event.key, event.newValue);
    else return;
    const pendingToken = owner.indexedDB ? markPending(event.key) : null;
    if (!hydrated) dirtyBeforeReady.set(event.key, event.newValue);
    else if (durable && database) {
      if (event.newValue === null) enqueueDurableWrite(event.key, pendingToken, () => removeDatabaseValue(database, event.key), () => fallbackWrite(event.key, null));
      else enqueueDurableWrite(event.key, pendingToken, () => writeDatabaseValue(database, event.key, String(event.newValue)), () => fallbackWrite(event.key, event.newValue));
    }
    notify(event.key, event.newValue, true);
  };
  owner.addEventListener?.("storage", onStorage);
  try {
    channel = typeof owner.BroadcastChannel === "function" ? new owner.BroadcastChannel(CHANNEL_NAME) : null;
    channel?.addEventListener("message", (event) => {
      const key = event.data?.key;
      if (!isValidStorageKey(key) || key === PENDING_WRITES_KEY) return;
      const value = event.data.value;
      if (!isValidBroadcastValue(value)) return;
      if (value === null) values.delete(key);
      else values.set(key, value);
      const pendingToken = owner.indexedDB ? markPending(key) : null;
      if (!hydrated) dirtyBeforeReady.set(key, value);
      else if (durable && database) {
        if (value === null) enqueueDurableWrite(key, pendingToken, () => removeDatabaseValue(database, key), () => fallbackWrite(key, null));
        else enqueueDurableWrite(key, pendingToken, () => writeDatabaseValue(database, key, value), () => fallbackWrite(key, value));
      }
      notify(key, value, true, true);
    });
  } catch {
    channel = null;
  }

  const ready = (async () => {
    if (!owner.indexedDB) {
      hydrated = true;
      return;
    }
    let openedDatabase = null;
    let hydrationPromise = null;
    let hydrationAbandoned = false;
    let hydrationAdopted = false;
    let hydrationClosed = false;
    const closeHydrationDatabase = () => {
      if (!openedDatabase || hydrationClosed || hydrationAdopted) return;
      hydrationClosed = true;
      openedDatabase.close?.();
    };
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("IndexedDB hydration timed out.")), HYDRATION_TIMEOUT_MS));
      hydrationPromise = (async () => {
        openedDatabase = await openDatabase(owner.indexedDB);
        if (hydrationAbandoned) closeHydrationDatabase();
        return { opened: openedDatabase, storedValues: await readDatabaseValues(openedDatabase) };
      })();
      const { opened, storedValues } = await Promise.race([hydrationPromise, timeout]);
      const localValues = new Map(values);
      const pendingValues = new Map(dirtyBeforeReady);
      const pendingKeys = new Set([...pendingWrites.keys(), ...pendingValues.keys()]);
      values.clear();
      storedValues.forEach((value, key) => values.set(key, value));
      localValues.forEach((value, key) => {
        if (pendingKeys.has(key) || !storedValues.has(key)) values.set(key, value);
      });
      pendingValues.forEach((value, key) => {
        if (value === null) values.delete(key);
        else values.set(key, value);
      });
      pendingKeys.forEach((key) => {
        let localValue;
        if (pendingValues.has(key)) {
          localValue = pendingValues.get(key);
        } else {
          try {
            localValue = fallbackStorage.getItem(key);
          } catch {
            localValue = values.has(key) ? values.get(key) : null;
          }
        }
        if (localValue === null) values.delete(key);
        else values.set(key, String(localValue));
      });
      localValues.forEach((_, key) => fallbackWrite(key, values.has(key) ? values.get(key) : null));
      values.forEach((value, key) => fallbackWrite(key, value));
      database = opened;
      hydrationAdopted = true;
      durable = true;
      hydrated = true;
      pendingKeys.forEach((key) => {
        if (!pendingWrites.has(key)) markPending(key);
      });
      for (const [key, value] of values) {
        if (!storedValues.has(key) || pendingKeys.has(key)) {
          enqueueDurableWrite(key, pendingWrites.get(key), () => writeDatabaseValue(database, key, value), () => fallbackWrite(key, value));
        }
      }
      pendingKeys.forEach((key) => {
        if (!values.has(key)) enqueueDurableWrite(key, pendingWrites.get(key), () => removeDatabaseValue(database, key), () => fallbackWrite(key, null));
      });
    } catch {
      hydrationAbandoned = true;
      closeHydrationDatabase();
      durable = false;
      storageFailure = true;
      hydrated = true;
      // The synchronous localStorage or memory adapter remains usable if
      // IndexedDB is blocked, unavailable, or too slow to initialize.
      notifyStatus();
    } finally {
      dirtyBeforeReady.clear();
      if (!hydrationAdopted) {
        hydrationPromise?.then(() => closeHydrationDatabase(), () => {});
      }
    }
  })();

  return {
    storage,
    persistent: true,
    get durable() {
      return durable;
    },
    get storageFailure() {
      return storageFailure;
    },
    flush() {
      return ready.then(() => writeQueue.catch(() => {}));
    },
    ready,
    subscribe(callback) {
      if (typeof callback !== "function") return () => {};
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    }
  };
}

export function getBrowserStorage(owner = globalThis) {
  let localStorage = null;
  try {
    localStorage = owner.localStorage;
    const probe = "__llm_field_notes_storage_probe__";
    localStorage.setItem(probe, "ok");
    localStorage.removeItem(probe);
  } catch {
    localStorage = null;
  }
  if (owner.indexedDB) return createDurableStorage(owner, localStorage);
  if (localStorage) {
    const subscribers = new Set();
    let channel = null;
    const publish = (key, value) => {
      try {
        channel?.postMessage({ key, value });
      } catch {
        // BroadcastChannel is an optional synchronization enhancement.
      }
    };
    const notify = (event) => {
      if (event?.storageArea && event.storageArea !== localStorage) return;
      if (!isValidStorageKey(event?.key) || event.key === PENDING_WRITES_KEY) return;
      if (!isValidBroadcastValue(event.newValue)) return;
      const change = {
        type: "change",
        key: event.key,
        newValue: event.newValue,
        storageArea: localStorage,
        external: true,
        broadcast: false
      };
      subscribers.forEach((subscriber) => {
        try {
          subscriber(change);
        } catch {
          // A subscriber must not break fallback storage synchronization.
        }
      });
    };
    owner.addEventListener?.("storage", notify);
    try {
      channel = typeof owner.BroadcastChannel === "function" ? new owner.BroadcastChannel(CHANNEL_NAME) : null;
      channel?.addEventListener("message", (event) => {
        const key = event.data?.key;
        if (typeof key !== "string") return;
        notify({ key, newValue: event.data.value, storageArea: localStorage });
      });
    } catch {
      channel = null;
    }
    const storage = {
      getItem: (key) => {
        const value = localStorage.getItem(key);
        return isValidBroadcastValue(value) ? value : null;
      },
      setItem: (key, value) => {
        const normalized = String(value);
        if (!isValidBroadcastValue(normalized)) throw new Error("Storage value exceeds the safety limit.");
        localStorage.setItem(key, normalized);
        publish(key, normalized);
      },
      removeItem: (key) => {
        localStorage.removeItem(key);
        publish(key, null);
      },
      clear: () => {
        const keys = [];
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (typeof key === "string" && key.startsWith(STORAGE_PREFIX)) keys.push(key);
        }
        keys.forEach((key) => storage.removeItem(key));
      }
    };
    return {
      storage,
      persistent: true,
      durable: false,
      ready: Promise.resolve(),
      subscribe(callback) {
        if (typeof callback !== "function") return () => {};
        subscribers.add(callback);
        return () => subscribers.delete(callback);
      }
    };
  }
  return {
    storage: createMemoryStorage(),
    persistent: false,
    durable: false,
    ready: Promise.resolve(),
    subscribe: () => () => {}
  };
}
