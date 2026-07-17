import { parseJsonWithUniqueKeys } from "./graph-core.js";

const STORAGE_PREFIX = "llm-field-notes-";
const DATABASE_NAME = "llm-field-notes";
const DATABASE_VERSION = 1;
const STORE_NAME = "values";
const CHANNEL_NAME = "llm-field-notes-storage";
export const STORAGE_MESSAGE_FORMAT = "llm-field-notes/storage@1";
const HYDRATION_TIMEOUT_MS = 1500;
const GRAPH_VALUE_KEY = `${STORAGE_PREFIX}knowledge-graph`;
const HISTORY_VALUE_KEY = `${STORAGE_PREFIX}knowledge-graph-history`;
export const IDB_OPERATION_TIMEOUT_MS = 5000;
export const PENDING_WRITES_KEY = `${STORAGE_PREFIX}pending-writes`;
export const PENDING_WRITE_MARKER_PREFIX = `${PENDING_WRITES_KEY}:`;
export const CLEAR_PENDING_KEY = `${STORAGE_PREFIX}clear-pending`;
export const MAX_STORAGE_KEY_CHARS = 256;
export const MAX_BROADCAST_VALUE_CHARS = 50 * 1024 * 1024;
export const MAX_BROADCAST_VALUE_BYTES = 50 * 1024 * 1024;
export const MAX_STORAGE_ENTRIES = 256;
export const MAX_STORAGE_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_PENDING_WRITES = 100;
let storageInstanceSequence = 0;
const utf8Encoder = new TextEncoder();

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
  values.invalid = false;
  let totalBytes = 0;
  if (!storage) return values;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (isNamespacedStorageKey(key) && key !== PENDING_WRITES_KEY && key !== CLEAR_PENDING_KEY) {
        if (!isValidStorageKey(key)) {
          values.invalid = true;
          continue;
        }
        const value = storage.getItem(key);
        if (!isValidBroadcastValue(value)) {
          values.invalid = true;
          continue;
        }
        const valueBytes = utf8Encoder.encode(value).byteLength;
        if (values.size >= MAX_STORAGE_ENTRIES || totalBytes + valueBytes > MAX_STORAGE_TOTAL_BYTES) {
          values.invalid = true;
          continue;
        }
        values.set(key, value);
        totalBytes += valueBytes;
      }
    }
  } catch {
    values.invalid = true;
  }
  return values;
}

function readNamespacedKeys(storage) {
  const keys = new Set();
  if (!storage) return keys;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(STORAGE_PREFIX)) keys.add(key);
    }
  } catch {
    // The caller still clears the keys it can observe.
  }
  return keys;
}

function readPendingWrites(storage) {
  const pending = new Map();
  pending.invalid = false;
  if (!storage) return pending;
  try {
    const parsed = parseJsonWithUniqueKeys(storage.getItem(PENDING_WRITES_KEY) || "[]", "Pending durable writes");
    if (Array.isArray(parsed)) {
      if (parsed.length > MAX_PENDING_WRITES || parsed.some((key) => !isValidStorageKey(key) || key === PENDING_WRITES_KEY)) {
        pending.invalid = true;
        return pending;
      }
      parsed
        .forEach((key) => pending.set(key, "legacy"));
      return pending;
    }
    if (!parsed || typeof parsed !== "object") {
      pending.invalid = true;
      return pending;
    }
    const entries = Object.entries(parsed);
    if (entries.length > MAX_PENDING_WRITES
      || entries.some(([key, token]) => !isValidStorageKey(key)
        || key === PENDING_WRITES_KEY
        || typeof token !== "string"
        || token.length > 128)) {
      pending.invalid = true;
      return pending;
    }
    entries.forEach(([key, token]) => pending.set(key, token));
    return pending;
  } catch {
    pending.invalid = true;
    return pending;
  }
}

function isPendingWriteMarkerKey(key) {
  return typeof key === "string"
    && key.startsWith(PENDING_WRITE_MARKER_PREFIX)
    && key !== PENDING_WRITES_KEY;
}

function readPendingWriteMarkers(storage) {
  const pending = new Map();
  pending.invalid = false;
  if (!storage) return pending;
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!isPendingWriteMarkerKey(key)) continue;
      let decodedKey;
      try {
        decodedKey = decodeURIComponent(key.slice(PENDING_WRITE_MARKER_PREFIX.length));
      } catch {
        pending.invalid = true;
        continue;
      }
      const token = storage.getItem(key);
      if (!isValidStorageKey(decodedKey) || typeof token !== "string" || token.length > 128) {
        pending.invalid = true;
        continue;
      }
      if (!pending.has(decodedKey) && pending.size >= MAX_PENDING_WRITES) {
        pending.invalid = true;
        continue;
      }
      pending.set(decodedKey, token);
    }
  } catch {
    pending.invalid = true;
  }
  return pending;
}

export function isValidStorageValue(value, {
  maxChars = MAX_BROADCAST_VALUE_CHARS,
  maxBytes = MAX_BROADCAST_VALUE_BYTES
} = {}) {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > maxChars || value.length > maxBytes) return false;
  // A JavaScript string encodes to at most four UTF-8 bytes per code unit.
  // Most graph values fit below this conservative threshold, avoiding a
  // complete re-encode on every ordinary storage read.
  if (value.length <= Math.floor(maxBytes / 4)) return true;
  return utf8Encoder.encode(value).byteLength <= maxBytes;
}

export function isExternalStorageRemoval(event, key) {
  return event?.external === true && event.key === key && event.newValue === null;
}

function fitsLocalStorageAggregate(storage, key, value) {
  const valueBytes = utf8Encoder.encode(value).byteLength;
  let entries = 0;
  let totalBytes = valueBytes;
  for (let index = 0; index < storage.length; index += 1) {
    const candidateKey = storage.key(index);
    if (!isValidStorageKey(candidateKey) || candidateKey === key) continue;
    const candidateValue = storage.getItem(candidateKey);
    if (!isValidBroadcastValue(candidateValue)) continue;
    entries += 1;
    totalBytes += utf8Encoder.encode(candidateValue).byteLength;
  }
  const addsEntry = storage.getItem(key) === null ? 1 : 0;
  return entries + addsEntry <= MAX_STORAGE_ENTRIES && totalBytes <= MAX_STORAGE_TOTAL_BYTES;
}

const isValidBroadcastValue = (value) => isValidStorageValue(value);

function committedAtFromGraphValue(value) {
  if (typeof value !== "string") return Number.NaN;
  try {
    const parsed = parseJsonWithUniqueKeys(value, "Persisted graph");
    const timestamp = Date.parse(parsed?.committedAt);
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function shouldPreferLocalGraph(localValue, durableValue) {
  if (typeof localValue !== "string" || typeof durableValue !== "string" || localValue === durableValue) return false;
  const localTimestamp = committedAtFromGraphValue(localValue);
  const durableTimestamp = committedAtFromGraphValue(durableValue);
  return Number.isFinite(localTimestamp)
    && (!Number.isFinite(durableTimestamp) || localTimestamp >= durableTimestamp);
}

function isStaleExternalGraphValue(key, currentValue, incomingValue) {
  return key === GRAPH_VALUE_KEY
    && typeof incomingValue === "string"
    && shouldPreferLocalGraph(currentValue, incomingValue);
}

function isValidStorageKey(key) {
  return typeof key === "string"
    && key.length <= MAX_STORAGE_KEY_CHARS
    && key.startsWith(STORAGE_PREFIX)
    && !isPendingWriteMarkerKey(key);
}

function isNamespacedStorageKey(key) {
  return typeof key === "string" && key.startsWith(STORAGE_PREFIX);
}

function assertStorageKey(key) {
  if (!isValidStorageKey(key)) {
    throw new Error(`Storage keys must use the "${STORAGE_PREFIX}" namespace and be no longer than ${MAX_STORAGE_KEY_CHARS} characters.`);
  }
  return key;
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
    let totalBytes = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(values);
        return;
      }
      if (!isValidStorageKey(cursor.key) || !isValidBroadcastValue(cursor.value)) {
        reject(Object.assign(new Error("IndexedDB storage contains an invalid entry."), { code: "STORAGE_INVALID" }));
        return;
      }
      const valueBytes = utf8Encoder.encode(cursor.value).byteLength;
      if (values.size >= MAX_STORAGE_ENTRIES || totalBytes + valueBytes > MAX_STORAGE_TOTAL_BYTES) {
        reject(Object.assign(new Error("IndexedDB storage exceeds the aggregate safety limit."), { code: "STORAGE_LIMIT" }));
        return;
      }
      values.set(cursor.key, cursor.value);
      totalBytes += valueBytes;
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

function clearDatabaseValues(database) {
  return runDatabaseWrite(database, (store) => store.clear(), "IndexedDB could not be cleared.");
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
  let storageFailure = values.invalid === true;
  let writeQueue = Promise.resolve();
  let channel = null;
  let channelMessageHandler = null;
  let disposalPromise = null;
  let clearRequestedBeforeReady = false;
  let databaseClosed = false;

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
  const fitsAggregateStorageLimit = (key, value) => {
    const valueBytes = utf8Encoder.encode(value).byteLength;
    if (!values.has(key) && values.size >= MAX_STORAGE_ENTRIES) return false;
    let totalBytes = valueBytes;
    values.forEach((currentValue, currentKey) => {
      if (currentKey !== key) totalBytes += utf8Encoder.encode(currentValue).byteLength;
    });
    return totalBytes <= MAX_STORAGE_TOTAL_BYTES;
  };
  const publish = (key, value) => {
    try {
      channel?.postMessage({ format: STORAGE_MESSAGE_FORMAT, key, value });
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
  const readPendingClearToken = () => {
    try {
      const value = fallbackStorage.getItem(CLEAR_PENDING_KEY);
      if (value === "1") return value;
      return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
    } catch {
      return null;
    }
  };
  const hasPendingClear = () => Boolean(readPendingClearToken());
  const pendingTokenParts = (token) => {
    if (typeof token !== "string" || token === "1" || token === "legacy") return null;
    const match = token.match(/^(\d+)-(.+)-(\d+)$/);
    if (!match) return null;
    const timestamp = Number(match[1]);
    const sequence = Number(match[3]);
    return Number.isSafeInteger(timestamp) && Number.isSafeInteger(sequence)
      ? { timestamp, instance: match[2], sequence }
      : null;
  };
  const isWriteAfterClear = (writeToken, clearToken) => {
    const write = pendingTokenParts(writeToken);
    const clear = pendingTokenParts(clearToken);
    if (!write || !clear) return false;
    if (write.timestamp !== clear.timestamp) return write.timestamp > clear.timestamp;
    if (write.instance === clear.instance) return write.sequence > clear.sequence;
    // Equal-millisecond writes from another tab cannot be ordered safely.
    // Preserve them rather than risking loss of data written after the clear.
    return true;
  };
  const markPendingClear = () => {
    pendingSequence += 1;
    const token = `${Date.now()}-${instanceId}-${pendingSequence}`;
    fallbackWrite(CLEAR_PENDING_KEY, token);
    return token;
  };
  const clearPendingClear = () => fallbackWrite(CLEAR_PENDING_KEY, null);
  const pendingWrites = readPendingWrites(fallbackStorage);
  const pendingMarkers = readPendingWriteMarkers(fallbackStorage);
  pendingMarkers.forEach((token, key) => pendingWrites.set(key, token));
  pendingWrites.invalid = pendingWrites.invalid || pendingMarkers.invalid;
  const clearPendingWriteMetadata = () => {
    readNamespacedKeys(fallbackStorage).forEach((key) => {
      if (key === PENDING_WRITES_KEY || isPendingWriteMarkerKey(key)) fallbackWrite(key, null);
    });
    pendingWrites.clear();
    pendingWrites.invalid = false;
  };
  const refreshPendingValidity = () => {
    const latestLegacy = readPendingWrites(fallbackStorage);
    const latestMarkers = readPendingWriteMarkers(fallbackStorage);
    pendingWrites.invalid = latestLegacy.invalid || latestMarkers.invalid;
  };
  const writeLegacyPendingWrites = (nextPendingWrites) => {
    const entries = [...nextPendingWrites.entries()]
      .filter(([key, token]) => isValidStorageKey(key) && typeof token === "string")
      .slice(-MAX_PENDING_WRITES);
    if (entries.length) {
      fallbackWrite(PENDING_WRITES_KEY, JSON.stringify(Object.fromEntries(entries)));
    } else {
      fallbackWrite(PENDING_WRITES_KEY, null);
    }
  };
  const updatePendingWrite = (key, token, remove = false) => {
    if (remove) {
      const latestMarkers = readPendingWriteMarkers(fallbackStorage);
      const markerToken = latestMarkers.get(key);
      if (markerToken !== undefined && markerToken !== token) {
        pendingWrites.delete(key);
        return;
      }
      if (markerToken === token) {
        fallbackWrite(`${PENDING_WRITE_MARKER_PREFIX}${encodeURIComponent(key)}`, null);
      }
      const latestLegacy = readPendingWrites(fallbackStorage);
      if (latestLegacy.get(key) === token || latestLegacy.get(key) === "legacy") {
        latestLegacy.delete(key);
        writeLegacyPendingWrites(latestLegacy);
      }
      pendingWrites.delete(key);
      refreshPendingValidity();
    } else {
      fallbackWrite(`${PENDING_WRITE_MARKER_PREFIX}${encodeURIComponent(key)}`, token);
      const latestLegacy = readPendingWrites(fallbackStorage);
      latestLegacy.set(key, token);
      writeLegacyPendingWrites(latestLegacy);
      pendingWrites.set(key, token);
      refreshPendingValidity();
    }
  };
  let pendingSequence = 0;
  const instanceId = (() => {
    try {
      if (typeof owner.crypto?.randomUUID === "function") return owner.crypto.randomUUID();
    } catch {
      // Try the lower-level entropy API before using the process-local fallback.
    }
    try {
      if (typeof owner.crypto?.getRandomValues === "function") {
        const random = new Uint32Array(4);
        owner.crypto.getRandomValues(random);
        return `instance-${[...random].map((value) => value.toString(16).padStart(8, "0")).join("")}`;
      }
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
    updatePendingWrite(key, token);
    return token;
  };
  const clearPending = (key, token) => {
    if (pendingWrites.get(key) !== token) return;
    updatePendingWrite(key, token, true);
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
  const enqueueDurableClear = () => {
    writeQueue = writeQueue.then(async () => {
      if (!database) return;
      await clearDatabaseValues(database);
      clearPendingWriteMetadata();
      clearPendingClear();
      durable = true;
      storageFailure = false;
      notifyStatus();
    }).catch(() => {
      durable = false;
      storageFailure = true;
      notifyStatus();
    });
    return writeQueue;
  };
  const closeDatabase = () => {
    if (!database || databaseClosed) return;
    databaseClosed = true;
    try {
      database.close?.();
    } catch {
      // Database teardown is best effort during host disposal.
    }
    database = null;
    durable = false;
  };
  const storage = {
    getItem(key) {
      if (!isValidStorageKey(key)) return null;
      if (hydrated) return values.has(key) ? values.get(key) : null;
      if (values.has(key)) return values.get(key);
      const fallbackValue = fallbackStorage.getItem(key);
      return isValidBroadcastValue(fallbackValue) ? fallbackValue : null;
    },
    setItem(key, value) {
      assertStorageKey(key);
      const normalized = String(value);
      if (!isValidBroadcastValue(normalized)) {
        throw new Error("Storage value exceeds the safety limit.");
      }
      if (!fitsAggregateStorageLimit(key, normalized)) {
        throw new Error("Storage namespace exceeds the aggregate safety limit.");
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
      if (!isValidStorageKey(key)) return;
      values.delete(key);
      if (!hydrated) dirtyBeforeReady.set(key, null);
      const pendingToken = owner.indexedDB ? markPending(key) : null;
      fallbackWrite(key, null);
      if (durable && database) enqueueDurableWrite(key, pendingToken, () => removeDatabaseValue(database, key), () => fallbackWrite(key, null));
      publish(key, null);
      notify(key, null);
    },
    clear() {
      const keys = new Set([
        ...values.keys(),
        ...pendingWrites.keys(),
        ...readNamespacedKeys(fallbackStorage)
      ]);
      keys.delete(PENDING_WRITES_KEY);
      keys.delete(CLEAR_PENDING_KEY);
      markPendingClear();
      if (!hydrated) clearRequestedBeforeReady = true;
      keys.forEach((key) => {
        if (isValidStorageKey(key)) storage.removeItem(key);
        else fallbackWrite(key, null);
      });
      clearPendingWriteMetadata();
      if (database) enqueueDurableClear();
      else if (!owner.indexedDB) clearPendingClear();
    }
  };

  const onStorage = (event) => {
    if (localStorage && event.storageArea && event.storageArea !== localStorage) return;
    if (event.key === CLEAR_PENDING_KEY) {
      if (event.newValue === "1") {
        storageFailure = true;
        if (!hydrated) clearRequestedBeforeReady = true;
        else if (database) enqueueDurableClear();
        notifyStatus();
      }
      return;
    }
    if (!isValidStorageKey(event.key)) {
      if (isNamespacedStorageKey(event.key) && event.key !== PENDING_WRITES_KEY && event.key !== CLEAR_PENDING_KEY) {
        storageFailure = true;
        notifyStatus();
      }
      return;
    }
    if (event.key === PENDING_WRITES_KEY) return;
    if (!isValidBroadcastValue(event.newValue)) {
      storageFailure = true;
      notifyStatus();
      return;
    }
    const currentValue = event.oldValue ?? values.get(event.key);
    if (isStaleExternalGraphValue(event.key, currentValue, event.newValue)) {
      fallbackWrite(event.key, currentValue);
      return;
    }
    if (event.newValue === null) values.delete(event.key);
    else if (isValidBroadcastValue(event.newValue)) {
      if (!fitsAggregateStorageLimit(event.key, event.newValue)) {
        fallbackWrite(event.key, currentValue);
        storageFailure = true;
        notifyStatus();
        return;
      }
      values.set(event.key, event.newValue);
    }
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
    channelMessageHandler = (event) => {
      if (event.data?.format !== STORAGE_MESSAGE_FORMAT) return;
      const key = event.data?.key;
      if (!isValidStorageKey(key)) {
        if (isNamespacedStorageKey(key) && key !== PENDING_WRITES_KEY && key !== CLEAR_PENDING_KEY) {
          storageFailure = true;
          notifyStatus();
        }
        return;
      }
      if (key === PENDING_WRITES_KEY || key === CLEAR_PENDING_KEY) return;
      const value = event.data.value;
      if (!isValidBroadcastValue(value)) {
        storageFailure = true;
        notifyStatus();
        return;
      }
      if (isStaleExternalGraphValue(key, values.get(key), value)) {
        fallbackWrite(key, values.get(key));
        return;
      }
      if (value === null) {
        values.delete(key);
        fallbackWrite(key, null);
      } else {
        if (!fitsAggregateStorageLimit(key, value)) {
          fallbackWrite(key, values.get(key) ?? null);
          storageFailure = true;
          notifyStatus();
          return;
        }
        values.set(key, value);
        fallbackWrite(key, value);
      }
      const pendingToken = owner.indexedDB ? markPending(key) : null;
      if (!hydrated) dirtyBeforeReady.set(key, value);
      else if (durable && database) {
        if (value === null) enqueueDurableWrite(key, pendingToken, () => removeDatabaseValue(database, key), () => fallbackWrite(key, null));
        else enqueueDurableWrite(key, pendingToken, () => writeDatabaseValue(database, key, value), () => fallbackWrite(key, value));
      }
      notify(key, value, true, true);
    };
    channel?.addEventListener("message", channelMessageHandler);
  } catch {
    channel = null;
    channelMessageHandler = null;
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
      let pendingKeys = new Set([...pendingWrites.keys(), ...pendingValues.keys()]);
      const pendingClearToken = readPendingClearToken();
      if (pendingClearToken) {
        storedValues.clear();
        const postClearKeys = new Set(
          [...pendingWrites.entries()]
            .filter(([, token]) => isWriteAfterClear(token, pendingClearToken))
            .map(([key]) => key)
        );
        for (const key of localValues.keys()) {
          if (!postClearKeys.has(key)) localValues.delete(key);
        }
        for (const key of pendingValues.keys()) {
          if (!postClearKeys.has(key)) pendingValues.delete(key);
        }
        pendingKeys = new Set([...pendingWrites.keys(), ...pendingValues.keys()]);
        clearRequestedBeforeReady = true;
        storageFailure = true;
      }
      if (shouldPreferLocalGraph(localValues.get(GRAPH_VALUE_KEY), storedValues.get(GRAPH_VALUE_KEY))) {
        // localStorage is the synchronous mirror and may contain a newer
        // committed graph than IndexedDB when a cross-tab durable write
        // completed out of order. Reconcile both graph and history from the
        // newer mirror before declaring hydration complete.
        pendingKeys.add(GRAPH_VALUE_KEY);
        pendingKeys.add(HISTORY_VALUE_KEY);
      }
      if (pendingWrites.invalid) {
        localValues.forEach((_, key) => pendingKeys.add(key));
        storageFailure = true;
      }
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
      if (clearRequestedBeforeReady) {
        clearRequestedBeforeReady = false;
        enqueueDurableClear();
      }
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
      notifyStatus();
    } catch (error) {
      hydrationAbandoned = true;
      if (error?.code === "STORAGE_INVALID" && openedDatabase) {
        // Keep the opened database available only so a confirmed local-data
        // purge can remove malformed entries. It remains non-durable until
        // the user clears the store and a later hydration succeeds.
        database = openedDatabase;
        hydrationAdopted = true;
      } else {
        closeHydrationDatabase();
      }
      durable = false;
      storageFailure = true;
      hydrated = true;
      // The synchronous localStorage or memory adapter remains usable if
      // IndexedDB is blocked, unavailable, or too slow to initialize.
      const pendingClearToken = readPendingClearToken();
      if (pendingClearToken && database) {
        const postClearKeys = new Set(
          [...pendingWrites.entries()]
            .filter(([, token]) => isWriteAfterClear(token, pendingClearToken))
            .map(([key]) => key)
        );
        for (const key of values.keys()) {
          if (!postClearKeys.has(key)) values.delete(key);
        }
        enqueueDurableClear();
        for (const [key, value] of values) {
          if (postClearKeys.has(key)) {
            enqueueDurableWrite(database, pendingWrites.get(key), () => writeDatabaseValue(database, key, value), () => fallbackWrite(key, value));
          }
        }
      }
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
    dispose() {
      if (disposalPromise) return disposalPromise;
      owner.removeEventListener?.("storage", onStorage);
      if (channel && channelMessageHandler) channel.removeEventListener?.("message", channelMessageHandler);
      try {
        channel?.close?.();
      } catch {
        // Channel teardown is best effort during page or host disposal.
      }
      channel = null;
      channelMessageHandler = null;
      subscribers.clear();
      disposalPromise = ready
        .then(() => writeQueue.catch(() => {}))
        .then(() => closeDatabase());
      return disposalPromise;
    },
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
    const initialLocalValues = readLocalValues(localStorage);
    let storageFailure = initialLocalValues.invalid === true;
    const notifyStatus = () => {
      const event = { type: "status", durable: false, storageFailure };
      subscribers.forEach((subscriber) => {
        try {
          subscriber(event);
        } catch {
          // A status subscriber must not break fallback persistence.
        }
      });
    };
    let channel = null;
    let channelMessageHandler = null;
    let disposalPromise = null;
    const publish = (key, value) => {
      try {
        channel?.postMessage({ format: STORAGE_MESSAGE_FORMAT, key, value });
      } catch {
        // BroadcastChannel is an optional synchronization enhancement.
      }
    };
    const notify = (event) => {
      if (event?.storageArea && event.storageArea !== localStorage) return;
      if (!isValidStorageKey(event?.key)) {
        if (isNamespacedStorageKey(event?.key) && event.key !== PENDING_WRITES_KEY) {
          storageFailure = true;
          notifyStatus();
        }
        return;
      }
      if (event.key === PENDING_WRITES_KEY) return;
      if (!isValidBroadcastValue(event.newValue)) {
        storageFailure = true;
        notifyStatus();
        return;
      }
      const currentValue = event.oldValue ?? localStorage.getItem(event.key);
      if (isStaleExternalGraphValue(event.key, currentValue, event.newValue)) {
        try {
          if (currentValue === null) localStorage.removeItem(event.key);
          else localStorage.setItem(event.key, currentValue);
        } catch {
          // Do not notify the application when the newer mirror cannot be
          // restored after a stale native storage event.
        }
        return;
      }
      if (event.newValue !== null && !fitsLocalStorageAggregate(localStorage, event.key, event.newValue)) {
        try {
          if (currentValue === null) localStorage.removeItem(event.key);
          else localStorage.setItem(event.key, currentValue);
        } catch {
          // The failed external value remains rejected even if restoration fails.
        }
        storageFailure = true;
        notifyStatus();
        return;
      }
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
      channelMessageHandler = (event) => {
        if (event.data?.format !== STORAGE_MESSAGE_FORMAT) return;
        const key = event.data?.key;
        if (typeof key !== "string") return;
        if (!isValidStorageKey(key)) {
          if (isNamespacedStorageKey(key) && key !== PENDING_WRITES_KEY) {
            storageFailure = true;
            notifyStatus();
          }
          return;
        }
        if (key === PENDING_WRITES_KEY) return;
        const value = event.data.value;
        if (!isValidBroadcastValue(value)) {
          storageFailure = true;
          notifyStatus();
          return;
        }
        const currentValue = localStorage.getItem(key);
        if (isStaleExternalGraphValue(key, currentValue, value)) return;
        if (value !== null && !fitsLocalStorageAggregate(localStorage, key, value)) {
          storageFailure = true;
          notifyStatus();
          return;
        }
        try {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        } catch {
          return;
        }
        notify({ key, newValue: event.data.value, storageArea: localStorage });
      };
      channel?.addEventListener("message", channelMessageHandler);
    } catch {
      channel = null;
      channelMessageHandler = null;
    }
    const storage = {
      getItem: (key) => {
        if (!isValidStorageKey(key)) return null;
        const value = localStorage.getItem(key);
        return isValidBroadcastValue(value) ? value : null;
      },
      setItem: (key, value) => {
        assertStorageKey(key);
        const normalized = String(value);
        if (!isValidBroadcastValue(normalized)) throw new Error("Storage value exceeds the safety limit.");
        if (!fitsLocalStorageAggregate(localStorage, key, normalized)) {
          storageFailure = true;
          notifyStatus();
          throw new Error("Storage namespace exceeds the aggregate safety limit.");
        }
        localStorage.setItem(key, normalized);
        publish(key, normalized);
      },
      removeItem: (key) => {
        if (!isValidStorageKey(key)) return;
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
      get storageFailure() {
        return storageFailure;
      },
      ready: Promise.resolve(),
      dispose() {
        if (disposalPromise) return disposalPromise;
        owner.removeEventListener?.("storage", notify);
        if (channel && channelMessageHandler) channel.removeEventListener?.("message", channelMessageHandler);
        try {
          channel?.close?.();
        } catch {
          // Channel teardown is best effort during page or host disposal.
        }
        channel = null;
        channelMessageHandler = null;
        subscribers.clear();
        disposalPromise = Promise.resolve();
        return disposalPromise;
      },
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
    dispose: async () => {},
    subscribe: () => () => {}
  };
}
