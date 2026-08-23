const DATABASE_NAME = "adsfriendly-training";
const DATABASE_VERSION = 1;
const DOM_STORE = "domSamples";
const TELEMETRY_STORE = "telemetryQueue";
const LEGACY_DOM_KEY = "domTrainingSamples";
const LEGACY_TELEMETRY_KEY = "afsTelemetryQueue";
const MAX_DOM_SAMPLES = 5000;
const MAX_TELEMETRY_EVENTS = 5000;

let databasePromise = null;

export async function addDomTrainingSample(sample) {
  return putCapped(DOM_STORE, ensureIdentity(sample), MAX_DOM_SAMPLES);
}

export async function listDomTrainingSamples(limit = 5000) {
  return listNewest(DOM_STORE, limit);
}

export async function clearDomTrainingSamples() {
  return clearStore(DOM_STORE);
}

export async function enqueueTelemetryEvent(event) {
  return putCapped(
    TELEMETRY_STORE,
    ensureIdentity(event),
    MAX_TELEMETRY_EVENTS,
  );
}

export async function listTelemetryBatch(limit = 50) {
  return listOldest(TELEMETRY_STORE, limit);
}

export async function deleteTelemetryEvents(sampleIds) {
  if (!sampleIds?.length) return;
  const db = await openDatabase();
  const transaction = db.transaction(TELEMETRY_STORE, "readwrite");
  const store = transaction.objectStore(TELEMETRY_STORE);
  sampleIds.forEach((sampleId) => store.delete(sampleId));
  await transactionDone(transaction);
}

export async function clearAllTrainingData() {
  await Promise.all([clearStore(DOM_STORE), clearStore(TELEMETRY_STORE)]);
}

export async function migrateLegacyTrainingStorage(
  storage = chrome.storage.local,
) {
  const legacy = await storage.get([LEGACY_DOM_KEY, LEGACY_TELEMETRY_KEY]);
  const domSamples = Array.isArray(legacy[LEGACY_DOM_KEY])
    ? legacy[LEGACY_DOM_KEY]
    : [];
  const telemetryEvents = Array.isArray(legacy[LEGACY_TELEMETRY_KEY])
    ? legacy[LEGACY_TELEMETRY_KEY]
    : [];
  for (const sample of domSamples.slice(-MAX_DOM_SAMPLES))
    await addDomTrainingSample(sample);
  for (const event of telemetryEvents.slice(-MAX_TELEMETRY_EVENTS))
    await enqueueTelemetryEvent(event);
  if (domSamples.length || telemetryEvents.length)
    await storage.remove([LEGACY_DOM_KEY, LEGACY_TELEMETRY_KEY]);
  return {
    status: "migrated",
    domSamples: domSamples.length,
    telemetryEvents: telemetryEvents.length,
  };
}

async function putCapped(storeName, value, maximum) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  store.put(value);
  const count = await requestResult(store.count());
  let remainingToDelete = Math.max(0, count - maximum);
  if (remainingToDelete > 0) {
    await new Promise((resolve, reject) => {
      const request = store.index("timestamp").openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || remainingToDelete <= 0) return resolve();
        cursor.delete();
        remainingToDelete--;
        cursor.continue();
      };
    });
  }
  await transactionDone(transaction);
  return value;
}

async function listNewest(storeName, limit) {
  return listByDirection(storeName, limit, "prev");
}

async function listOldest(storeName, limit) {
  return listByDirection(storeName, limit, "next");
}

async function listByDirection(storeName, limit, direction) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readonly");
  const index = transaction.objectStore(storeName).index("timestamp");
  const values = [];
  await new Promise((resolve, reject) => {
    const request = index.openCursor(null, direction);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || values.length >= limit) return resolve();
      values.push(cursor.value);
      cursor.continue();
    };
  });
  await transactionDone(transaction);
  return values;
}

async function clearStore(storeName) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).clear();
  await transactionDone(transaction);
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of [DOM_STORE, TELEMETRY_STORE]) {
        if (db.objectStoreNames.contains(storeName)) continue;
        const store = db.createObjectStore(storeName, {
          keyPath: "sample_id",
        });
        store.createIndex("timestamp", "timestamp");
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return databasePromise;
}

function ensureIdentity(value = {}) {
  return {
    ...value,
    sample_id: value.sample_id || randomId(),
    timestamp: Number(value.timestamp) || Date.now(),
  };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function randomId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
