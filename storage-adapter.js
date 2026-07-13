const STORAGE_PREFIX = "llm-field-notes-";
const DATABASE_NAME = "llm-field-notes";
const DATABASE_VERSION = 1;
const STORE_NAME = "values";
const CHANNEL_NAME = "llm-field-notes-storage";
const HYDRATION_TIMEOUT_MS = 1500;

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
      if (typeof key === "string" && key.startsWith(STORAGE_PREFIX)) {
        const value = storage.getItem(key);
        if (value !== null) values.set(key, value);
      }
    }
  } catch {
    // The caller already has the storage fallback path.
  }
  return values;
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
      if (typeof cursor.key === "string" && typeof cursor.value === "string") values.set(cursor.key, cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error || new Error("IndexedDB could not be read."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

function writeDatabaseValue(database, key, value) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB could not be written."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB write was aborted."));
  });
}

function removeDatabaseValue(database, key) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB could not be updated."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB delete was aborted."));
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
  const enqueue = (operation, fallback) => {
    writeQueue = writeQueue.then(operation).catch(() => {
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
      return values.has(key) ? values.get(key) : fallbackStorage.getItem(key);
    },
    setItem(key, value) {
      const normalized = String(value);
      values.set(key, normalized);
      if (!hydrated) dirtyBeforeReady.set(key, normalized);
      fallbackWrite(key, normalized);
      if (durable && database) enqueue(() => writeDatabaseValue(database, key, normalized), () => fallbackWrite(key, normalized));
      publish(key, normalized);
      notify(key, normalized);
    },
    removeItem(key) {
      values.delete(key);
      if (!hydrated) dirtyBeforeReady.set(key, null);
      fallbackWrite(key, null);
      if (durable && database) enqueue(() => removeDatabaseValue(database, key), () => fallbackWrite(key, null));
      publish(key, null);
      notify(key, null);
    },
    clear() {
      [...values.keys()].forEach((key) => storage.removeItem(key));
    }
  };

  const onStorage = (event) => {
    if (localStorage && event.storageArea && event.storageArea !== localStorage) return;
    if (typeof event.key !== "string" || !event.key.startsWith(STORAGE_PREFIX)) return;
    if (event.newValue === null) values.delete(event.key);
    else values.set(event.key, event.newValue);
    if (!hydrated) dirtyBeforeReady.set(event.key, event.newValue);
    else if (durable && database) {
      if (event.newValue === null) enqueue(() => removeDatabaseValue(database, event.key), () => fallbackWrite(event.key, null));
      else enqueue(() => writeDatabaseValue(database, event.key, String(event.newValue)), () => fallbackWrite(event.key, event.newValue));
    }
    notify(event.key, event.newValue, true);
  };
  owner.addEventListener?.("storage", onStorage);
  try {
    channel = typeof owner.BroadcastChannel === "function" ? new owner.BroadcastChannel(CHANNEL_NAME) : null;
    channel?.addEventListener("message", (event) => {
      const key = event.data?.key;
      if (typeof key !== "string" || !key.startsWith(STORAGE_PREFIX)) return;
      const value = event.data.value === null ? null : String(event.data.value);
      if (value === null) values.delete(key);
      else values.set(key, value);
      if (!hydrated) dirtyBeforeReady.set(key, value);
      else if (durable && database) {
        if (value === null) enqueue(() => removeDatabaseValue(database, key), () => fallbackWrite(key, null));
        else enqueue(() => writeDatabaseValue(database, key, value), () => fallbackWrite(key, value));
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
      values.clear();
      storedValues.forEach((value, key) => values.set(key, value));
      localValues.forEach((value, key) => {
        if (pendingValues.has(key) || !storedValues.has(key)) values.set(key, value);
      });
      pendingValues.forEach((value, key) => {
        if (value === null) values.delete(key);
        else values.set(key, value);
      });
      localValues.forEach((_, key) => fallbackWrite(key, values.has(key) ? values.get(key) : null));
      values.forEach((value, key) => fallbackWrite(key, value));
      database = opened;
      hydrationAdopted = true;
      durable = true;
      hydrated = true;
      for (const [key, value] of values) {
        if (!storedValues.has(key) || pendingValues.has(key)) {
          enqueue(() => writeDatabaseValue(database, key, value), () => fallbackWrite(key, value));
        }
      }
      pendingValues.forEach((value, key) => {
        if (value === null) enqueue(() => removeDatabaseValue(database, key), () => fallbackWrite(key, null));
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
      return writeQueue.catch(() => {});
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
    return {
      storage: localStorage,
      persistent: true,
      durable: false,
      ready: Promise.resolve(),
      subscribe: () => () => {}
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
