var AdsFriendlyBackground = (() => {
  // src/background/state.js
  var runtimeState = {
    lastTrustedClick: {
      timestamp: 0,
      intentUrl: null,
      sourceUrl: null,
      intentKind: "navigation",
      intentReasons: [],
      tabId: null
    }
  };

  // src/shared/ad-patterns.js
  var BASELINE_AD_PATTERNS = [
    { type: "alt", value: "Ad", confidence: 0.9 },
    { type: "alt", value: "Advertisement", confidence: 0.9 },
    { type: "alt", value: "Sponsored", confidence: 0.9 },
    { type: "alt", value: "Promoted", confidence: 0.9 },
    { type: "title", value: "Ads by Google", confidence: 1 },
    { type: "domain", value: "taboola.com", confidence: 1 },
    { type: "domain", value: "outbrain.com", confidence: 1 },
    { type: "domain", value: "mgid.com", confidence: 1 },
    { type: "domain", value: "adnxs.com", confidence: 1 }
  ];
  var PROTECTED_KEYWORDS = [
    "messenger",
    "chat",
    "inbox",
    "cart",
    "checkout",
    "search",
    "account",
    "login",
    "social",
    "notification",
    "swiper",
    "carousel",
    "slick",
    "owl-",
    "slide"
  ];
  function isProtectedPattern(value = "") {
    return PROTECTED_KEYWORDS.some((kw) => value.toLowerCase().includes(kw));
  }

  // src/background/pattern-learning.js
  async function seedBaselinePatterns() {
    const result = await chrome.storage.local.get(["globalAdPatterns"]);
    if (!result.globalAdPatterns || result.globalAdPatterns.length === 0)
      await chrome.storage.local.set({ globalAdPatterns: BASELINE_AD_PATTERNS });
  }
  async function handleNegativeLearning(fingerprint) {
    if (!fingerprint) return;
    const {
      safePatterns = [],
      infrastructurePatterns = [],
      globalAdPatterns = []
    } = await chrome.storage.local.get([
      "safePatterns",
      "infrastructurePatterns",
      "globalAdPatterns"
    ]);
    const entry = {
      value: fingerprint.alt || fingerprint.title,
      type: fingerprint.alt ? "alt" : "title"
    };
    if (!entry.value) return;
    if (!safePatterns.some((p) => p.value === entry.value))
      safePatterns.push(entry);
    if (!infrastructurePatterns.some((p) => p.value === entry.value))
      infrastructurePatterns.push({ ...entry, timestamp: Date.now() });
    await chrome.storage.local.set({
      safePatterns,
      infrastructurePatterns,
      globalAdPatterns: globalAdPatterns.filter((p) => p.value !== entry.value)
    });
  }
  async function synthesizeGlobalPatterns() {
    const { userCustomRules = {}, safePatterns = [] } = await chrome.storage.local.get(["userCustomRules", "safePatterns"]);
    const freq = {};
    const spread = {};
    const add = (domain, type, value) => {
      if (!value || value.length < 3) return;
      const key = `${type}:${value}`;
      freq[key] = (freq[key] || 0) + 1;
      (spread[key] ||= /* @__PURE__ */ new Set()).add(domain);
    };
    Object.entries(userCustomRules).forEach(
      ([domain, rules]) => rules.forEach((rule) => {
        const f = rule?.fingerprint;
        if (!f) return;
        add(domain, "alt", f.alt);
        add(domain, "title", f.title);
        add(domain, "domain", f.linkDomain);
        add(domain, "class", f.className);
        add(domain, "id", f.id);
        add(domain, "srcHost", f.srcHost);
        (f.classTokens || []).forEach(
          (token) => add(domain, "classToken", token)
        );
        (f.idTokens || []).forEach((token) => add(domain, "idToken", token));
      })
    );
    const safe = (type, value) => safePatterns.some((p) => p.type === type && p.value === value);
    const globalAdPatterns = Object.entries(freq).filter(
      ([key]) => !isProtectedPattern(key.split(":")[1]) && spread[key].size >= 1
    ).map(([key, count]) => {
      const [type, value] = key.split(":");
      let confidence = Math.min((count + spread[key].size * 2) / 10, 1);
      if (safe(type, value)) confidence *= 0.3;
      return { type, value, confidence };
    });
    await chrome.storage.local.set({ globalAdPatterns });
  }

  // src/shared/pattern-store.js
  async function getGlobalPatterns() {
    const { globalAdPatterns = [] } = await chrome.storage.local.get("globalAdPatterns");
    return Array.isArray(globalAdPatterns) ? globalAdPatterns : [];
  }
  async function upsertGlobalPattern(nextPattern, merge) {
    if (!nextPattern?.type || !nextPattern.value) return;
    const globalAdPatterns = await getGlobalPatterns();
    const existing = globalAdPatterns.find(
      (pattern) => pattern.type === nextPattern.type && pattern.value === nextPattern.value
    );
    if (existing) {
      Object.assign(existing, merge ? merge(existing, nextPattern) : nextPattern);
    } else {
      globalAdPatterns.push(nextPattern);
    }
    await chrome.storage.local.set({ globalAdPatterns });
  }

  // src/background/video-learning.js
  async function handleLearnVideoAd(data) {
    const { src, hostname } = data;
    if (!src) return;
    let value = src;
    try {
      const url = new URL(src);
      value = url.hostname.includes("github") || url.hostname.includes("s3") || url.hostname.includes("cdn") ? url.hostname : url.hostname + (url.pathname.split("/")[1] ? "/" + url.pathname.split("/")[1] : "");
    } catch {
      value = src.split("?")[0].substring(0, 50);
    }
    await upsertGlobalPattern(
      {
        type: "video_source_marker",
        value,
        confidence: 1,
        source: hostname
      },
      () => ({ confidence: 1, source: hostname })
    );
  }
  async function handleVideoLearning(data) {
    const classList = (data.classes || "").split(" ").filter(
      (token) => token.includes("ad") || token.includes("player") || token.includes("video")
    );
    if (!classList.length) return;
    await Promise.all(
      classList.map(
        (cls) => upsertGlobalPattern(
          {
            type: "video_marker",
            value: `.${cls}`,
            confidence: 0.5,
            source: data.hostname
          },
          (existing) => ({
            confidence: Math.min(1, (existing.confidence || 0) + 0.1),
            source: data.hostname
          })
        )
      )
    );
  }

  // src/background/settings-mutations.js
  var MAX_RULES_PER_SITE = 250;
  var defaultStore = null;
  function getSettingsMutationStore(storage = chrome.storage.local) {
    if (!defaultStore) defaultStore = createSettingsMutationStore(storage);
    return defaultStore;
  }
  function createSettingsMutationStore(storage) {
    let mutationTail = Promise.resolve();
    const serial = (operation) => {
      const result = mutationTail.then(operation, operation);
      mutationTail = result.catch(() => {
      });
      return result;
    };
    return Object.freeze({
      upsertCustomRules(hostname, incomingRules) {
        return serial(async () => {
          const host = normalizeHostname(hostname);
          const additions = normalizeRules(incomingRules);
          if (!host || !additions.length)
            throw new Error("No valid custom rules to save.");
          const { userCustomRules = {} } = await storage.get("userCustomRules");
          const existing = Array.isArray(userCustomRules[host]) ? userCustomRules[host] : [];
          const bySelector = new Map(
            existing.filter((rule) => selectorOf(rule)).map((rule) => [selectorOf(rule), rule])
          );
          additions.forEach((rule) => bySelector.set(selectorOf(rule), rule));
          userCustomRules[host] = [...bySelector.values()].slice(
            -MAX_RULES_PER_SITE
          );
          await setAndVerify(storage, { userCustomRules });
          return {
            status: "saved",
            hostname: host,
            ruleCount: userCustomRules[host].length
          };
        });
      },
      removeCustomRules(hostname, selectors) {
        return serial(async () => {
          const host = normalizeHostname(hostname);
          const selectorSet = new Set(
            (Array.isArray(selectors) ? selectors : [selectors]).map((value) => String(value || "").trim()).filter(Boolean)
          );
          if (!host || !selectorSet.size)
            throw new Error("No valid custom rules to remove.");
          const { userCustomRules = {} } = await storage.get("userCustomRules");
          const existing = Array.isArray(userCustomRules[host]) ? userCustomRules[host] : [];
          const remaining = existing.filter(
            (rule) => !selectorSet.has(selectorOf(rule))
          );
          if (remaining.length) userCustomRules[host] = remaining;
          else delete userCustomRules[host];
          await setAndVerify(storage, { userCustomRules });
          return { status: "saved", hostname: host, ruleCount: remaining.length };
        });
      },
      restoreCustomRules(hostname, selectors = null) {
        return serial(async () => {
          const host = normalizeHostname(hostname);
          const selectorSet = normalizeSelectorSet(selectors);
          if (!host || !selectorSet.size)
            throw new Error("No valid custom rules to restore.");
          const { userCustomRules = {} } = await storage.get("userCustomRules");
          const existing = Array.isArray(userCustomRules[host]) ? userCustomRules[host] : [];
          const restored = existing.filter(
            (rule) => selectorSet.has(selectorOf(rule))
          );
          const remaining = existing.filter(
            (rule) => !selectorSet.has(selectorOf(rule))
          );
          if (remaining.length) userCustomRules[host] = remaining;
          else delete userCustomRules[host];
          await setAndVerify(storage, { userCustomRules });
          return {
            status: "saved",
            hostname: host,
            restoredCount: restored.length,
            ruleCount: remaining.length
          };
        });
      },
      resetCustomRules(hostname) {
        return serial(async () => {
          const host = normalizeHostname(hostname);
          if (!host) throw new Error("Invalid hostname for site reset.");
          const { userCustomRules = {}, siteResetHistory = {} } = await storage.get(["userCustomRules", "siteResetHistory"]);
          const removed = Array.isArray(userCustomRules[host]) ? userCustomRules[host] : [];
          delete userCustomRules[host];
          siteResetHistory[host] = { oldRules: removed, timestamp: Date.now() };
          await setAndVerify(storage, { userCustomRules, siteResetHistory });
          return {
            status: "saved",
            hostname: host,
            restoredCount: removed.length
          };
        });
      },
      saveDomainDecision(action, domain) {
        return serial(async () => {
          const hostname = normalizeHostname(domain);
          if (!hostname) throw new Error("Invalid domain decision.");
          const { whitelist = [], blacklist = [] } = await storage.get([
            "whitelist",
            "blacklist"
          ]);
          let nextWhitelist = [...whitelist];
          let nextBlacklist = [...blacklist];
          if (action === "WHITELIST") {
            nextWhitelist = [.../* @__PURE__ */ new Set([...nextWhitelist, hostname])];
            nextBlacklist = nextBlacklist.filter(
              (entry) => normalizeHostname(entry) !== hostname
            );
          } else if (action === "BLACKLIST") {
            nextBlacklist = [.../* @__PURE__ */ new Set([...nextBlacklist, `||${hostname}^`])];
            nextWhitelist = nextWhitelist.filter(
              (entry) => normalizeHostname(entry) !== hostname
            );
          } else {
            throw new Error(`Unsupported domain action: ${String(action)}`);
          }
          await setAndVerify(storage, {
            whitelist: nextWhitelist,
            blacklist: nextBlacklist
          });
          return { status: "saved", action, domain: hostname };
        });
      },
      removeDomainDecision(listName, domain) {
        return serial(async () => {
          const hostname = normalizeHostname(domain);
          if (!hostname || !["whitelist", "blacklist"].includes(listName))
            throw new Error("Invalid domain removal.");
          const current = await storage.get(listName);
          const next = (current[listName] || []).filter(
            (entry) => normalizeHostname(entry) !== hostname
          );
          await setAndVerify(storage, { [listName]: next });
          return { status: "saved", listName, domain: hostname };
        });
      }
    });
  }
  async function getStorageHealth(storage = chrome.storage.local) {
    const bytesInUse = typeof storage.getBytesInUse === "function" ? await storage.getBytesInUse(null) : null;
    let unlimited = false;
    try {
      unlimited = await chrome.permissions.contains({
        permissions: ["unlimitedStorage"]
      });
    } catch {
    }
    return { status: "ok", bytesInUse, unlimited };
  }
  async function setAndVerify(storage, updates) {
    try {
      await storage.set(updates);
      const saved = await storage.get(Object.keys(updates));
      for (const [key, expected] of Object.entries(updates)) {
        if (JSON.stringify(saved[key]) !== JSON.stringify(expected)) {
          throw new Error(`Storage verification failed for ${key}.`);
        }
      }
    } catch (error) {
      const message = String(error?.message || error);
      if (/quota|bytes|storage/i.test(message)) {
        throw new Error(`Settings storage is full: ${message}`);
      }
      throw error;
    }
  }
  function normalizeRules(rules) {
    return (Array.isArray(rules) ? rules : [rules]).filter((rule) => rule && typeof rule === "object").filter((rule) => selectorOf(rule));
  }
  function normalizeSelectorSet(selectors) {
    if (selectors == null) return /* @__PURE__ */ new Set();
    return new Set(
      (Array.isArray(selectors) ? selectors : [selectors]).map((value) => String(value || "").trim()).filter(Boolean)
    );
  }
  function selectorOf(rule) {
    return typeof rule === "string" ? rule.trim() : String(rule?.selector || "").trim();
  }
  function normalizeHostname(value) {
    const raw = String(value || "").trim().replace(/^\|\|/, "").replace(/\^$/, "");
    if (!raw) return "";
    try {
      const hostname = new URL(
        raw.includes("://") ? raw : `https://${raw}`
      ).hostname.toLowerCase();
      return /^[a-z0-9.-]+$/.test(hostname) ? hostname : "";
    } catch {
      return "";
    }
  }

  // src/navigation/background/trusted-paths.js
  async function syncTrustedPath(source, target, isManual = false) {
    if (!source || !target || source === target) return;
    const key = `p:${source}>${target}`;
    const current = await chrome.storage.local.get([key]);
    const entry = current[key] || {
      source,
      target,
      visits: 0,
      isManual: false,
      lastUpdated: Date.now()
    };
    entry.visits++;
    if (isManual) {
      entry.isManual = true;
      entry.visits = Math.max(entry.visits, 99);
    }
    entry.lastUpdated = Date.now();
    await chrome.storage.local.set({ [key]: entry });
  }
  async function getTrustedPath(source, target) {
    const key = `p:${source}>${target}`;
    return (await chrome.storage.local.get([key]))[key] || null;
  }
  async function handleUserDecision(message) {
    const { action, domain } = message;
    if (!["WHITELIST", "BLACKLIST"].includes(action)) return;
    return getSettingsMutationStore().saveDomainDecision(action, domain);
  }

  // src/background/reputation.js
  async function updateSiteReputation(hostname, blockedCount) {
    const { siteReputation = {} } = await chrome.storage.local.get("siteReputation");
    const data = siteReputation[hostname] ||= {
      trustScore: 0.5,
      blockActivity: 0
    };
    data.blockActivity = Math.max(data.blockActivity, blockedCount);
    if (blockedCount > 10) data.trustScore = Math.max(0, data.trustScore - 0.05);
    else if (blockedCount <= 1)
      data.trustScore = Math.min(1, data.trustScore + 0.01);
    await chrome.storage.local.set({ siteReputation });
  }
  async function getDynamicTrustWindow(hostname) {
    const { siteReputation = {} } = await chrome.storage.local.get("siteReputation");
    return siteReputation[hostname]?.blockedAdCount > 10 ? 500 : 2e3;
  }
  async function cleanupStaleMemory() {
    const { siteResetHistory = {} } = await chrome.storage.local.get("siteResetHistory");
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1e3;
    let changed = false;
    for (const host in siteResetHistory)
      if (siteResetHistory[host].timestamp < cutoff) {
        delete siteResetHistory[host];
        changed = true;
      }
    if (changed) await chrome.storage.local.set({ siteResetHistory });
  }

  // src/storage/training-store.js
  var DATABASE_NAME = "adsfriendly-training";
  var DATABASE_VERSION = 1;
  var DOM_STORE = "domSamples";
  var TELEMETRY_STORE = "telemetryQueue";
  var LEGACY_DOM_KEY = "domTrainingSamples";
  var LEGACY_TELEMETRY_KEY = "afsTelemetryQueue";
  var MAX_DOM_SAMPLES = 5e3;
  var MAX_TELEMETRY_EVENTS = 5e3;
  var databasePromise = null;
  async function addDomTrainingSample(sample) {
    return putCapped(DOM_STORE, ensureIdentity(sample), MAX_DOM_SAMPLES);
  }
  async function enqueueTelemetryEvent(event) {
    return putCapped(
      TELEMETRY_STORE,
      ensureIdentity(event),
      MAX_TELEMETRY_EVENTS
    );
  }
  async function listTelemetryBatch(limit = 50) {
    return listOldest(TELEMETRY_STORE, limit);
  }
  async function deleteTelemetryEvents(sampleIds) {
    if (!sampleIds?.length) return;
    const db = await openDatabase();
    const transaction = db.transaction(TELEMETRY_STORE, "readwrite");
    const store = transaction.objectStore(TELEMETRY_STORE);
    sampleIds.forEach((sampleId) => store.delete(sampleId));
    await transactionDone(transaction);
  }
  async function migrateLegacyTrainingStorage(storage = chrome.storage.local) {
    const legacy = await storage.get([LEGACY_DOM_KEY, LEGACY_TELEMETRY_KEY]);
    const domSamples = Array.isArray(legacy[LEGACY_DOM_KEY]) ? legacy[LEGACY_DOM_KEY] : [];
    const telemetryEvents = Array.isArray(legacy[LEGACY_TELEMETRY_KEY]) ? legacy[LEGACY_TELEMETRY_KEY] : [];
    for (const sample of domSamples.slice(-MAX_DOM_SAMPLES))
      await addDomTrainingSample(sample);
    for (const event of telemetryEvents.slice(-MAX_TELEMETRY_EVENTS))
      await enqueueTelemetryEvent(event);
    if (domSamples.length || telemetryEvents.length)
      await storage.remove([LEGACY_DOM_KEY, LEGACY_TELEMETRY_KEY]);
    return {
      status: "migrated",
      domSamples: domSamples.length,
      telemetryEvents: telemetryEvents.length
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
            keyPath: "sample_id"
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
      timestamp: Number(value.timestamp) || Date.now()
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
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // src/background/telemetry.js
  var ENABLED_KEY = "afsTelemetryEnabled";
  var ENDPOINT_KEY = "afsTelemetryEndpoint";
  var CLIENT_ID_KEY = "adsFriendlyClientId";
  var DEFAULT_ENDPOINT = "http://127.0.0.1:3000/api/ingest";
  var BATCH_SIZE = 50;
  var flushInFlight = false;
  async function recordTelemetry(raw = {}) {
    const event = await buildEvent(raw);
    await enqueueTelemetryEvent(event);
    flushTelemetry();
    return event;
  }
  async function flushTelemetry() {
    if (flushInFlight) return { status: "busy" };
    flushInFlight = true;
    try {
      const {
        [ENABLED_KEY]: enabled = true,
        [ENDPOINT_KEY]: endpoint = DEFAULT_ENDPOINT
      } = await chrome.storage.local.get([ENABLED_KEY, ENDPOINT_KEY]);
      const queue = await listTelemetryBatch(BATCH_SIZE);
      if (enabled === false || !queue.length) return { status: "skipped" };
      const batch = queue.slice(0, BATCH_SIZE);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch })
      });
      if (!response.ok && response.status !== 207) {
        return { status: "server_error", statusCode: response.status };
      }
      await deleteTelemetryEvents(batch.map((event) => event.sample_id));
      if (queue.length === BATCH_SIZE) setTimeout(flushTelemetry, 100);
      return { status: "flushed", count: batch.length };
    } catch (error) {
      return { status: "offline", error: error.message };
    } finally {
      flushInFlight = false;
    }
  }
  function startTelemetryFlush() {
    chrome.runtime.onStartup.addListener(flushTelemetry);
    chrome.runtime.onInstalled.addListener(flushTelemetry);
    const intervalId = setInterval(flushTelemetry, 6e4);
    return () => {
      clearInterval(intervalId);
      chrome.runtime.onStartup.removeListener(flushTelemetry);
      chrome.runtime.onInstalled.removeListener(flushTelemetry);
    };
  }
  async function buildEvent(raw) {
    const now = Date.now();
    const clientId = await getClientId();
    const site = normalizeSite(raw.site, raw);
    const labelSource = raw.label_source || "heuristic_weak";
    return {
      schema_version: raw.schema_version || "dataset.v1",
      sample_id: raw.sample_id || randomId2(),
      unit: raw.unit || "unknown",
      label: raw.label || "unknown",
      label_source: labelSource,
      label_strength: raw.label_strength || inferLabelStrength(labelSource),
      ad_type: raw.ad_type || "unknown",
      site,
      timestamp: raw.timestamp || now,
      identity: {
        client_id: clientId,
        platform: "chrome_extension",
        app: "adsfriendly",
        schema: "identity.v1",
        ...raw.identity || {}
      },
      sync: {
        scope: raw.sync?.scope || "user",
        status: "queued",
        client_time: now,
        ...raw.sync || {}
      },
      context: raw.context || {},
      evidence: raw.evidence || {},
      feedback: raw.feedback || null,
      action: raw.action || null,
      outcome: raw.outcome || null,
      model: raw.model || {}
    };
  }
  async function getClientId() {
    const result = await chrome.storage.local.get(CLIENT_ID_KEY);
    if (result[CLIENT_ID_KEY]) return result[CLIENT_ID_KEY];
    const clientId = randomId2();
    await chrome.storage.local.set({ [CLIENT_ID_KEY]: clientId });
    return clientId;
  }
  function normalizeSite(site, raw) {
    const url = site?.url || raw.url || raw.pageUrl || raw.sourceUrl || "";
    return {
      hostname: sanitizeHostname(site?.hostname || raw.hostname || raw.domain) || hostFromUrl(url || raw.targetUrl),
      url: sanitizeUrl(url)
    };
  }
  function inferLabelStrength(labelSource) {
    if (/^user_|restore|undo|allow|block/i.test(labelSource)) return "strong";
    if (/heuristic|rule|model/i.test(labelSource)) return "weak";
    return "unknown";
  }
  function hostFromUrl(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "unknown";
    }
  }
  function sanitizeHostname(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 253);
  }
  function sanitizeUrl(url) {
    try {
      const parsed = new URL(url);
      parsed.username = "";
      parsed.password = "";
      parsed.hash = "";
      for (const key of [...parsed.searchParams.keys()]) {
        if (/token|key|auth|session|password|email|user|uid|id$/i.test(key)) {
          parsed.searchParams.set(key, "[redacted]");
        }
      }
      return parsed.href.slice(0, 2048);
    } catch {
      return "";
    }
  }
  function randomId2() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // src/runtime/feature-catalog.js
  var PROTECTION_MODES = Object.freeze({
    SAFE: "safe",
    ASSIST: "assist",
    AUTO: "auto"
  });
  var CAPABILITIES = Object.freeze({
    CORE_MESSAGING: "core.messaging",
    CORE_MAINTENANCE: "core.maintenance",
    NAVIGATION_GUARD: "navigation.guard",
    NAVIGATION_REVERSE_POPUNDER: "navigation.reverse_popunder",
    NAVIGATION_INTENT: "navigation.intent",
    NAVIGATION_FEEDBACK: "navigation.feedback",
    DOM_STATIC_RULES: "dom.static_rules",
    DOM_OBSERVE: "dom.observe",
    DOM_SUGGEST: "dom.suggest",
    DOM_AUTO_HIDE: "dom.auto_hide",
    DOM_MANUAL_PICKER: "dom.manual_picker",
    LEARNING_SEED: "learning.seed",
    LEARNING_FEEDBACK: "learning.feedback",
    LEARNING_APPLY: "learning.apply_patterns",
    TELEMETRY_QUEUE: "telemetry.queue",
    MEDIA_OBSERVE: "media.observe",
    VIDEO_OBSERVE: "video.observe",
    VIDEO_AUTO_ACTION: "video.auto_action"
  });
  var C = CAPABILITIES;
  var MODE_CAPABILITIES = Object.freeze({
    [PROTECTION_MODES.SAFE]: Object.freeze([
      C.CORE_MESSAGING,
      C.CORE_MAINTENANCE,
      C.NAVIGATION_GUARD,
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.DOM_STATIC_RULES,
      C.DOM_MANUAL_PICKER,
      C.LEARNING_SEED,
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    [PROTECTION_MODES.ASSIST]: Object.freeze([
      C.CORE_MESSAGING,
      C.CORE_MAINTENANCE,
      C.NAVIGATION_GUARD,
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.DOM_STATIC_RULES,
      C.DOM_OBSERVE,
      C.DOM_SUGGEST,
      C.DOM_MANUAL_PICKER,
      C.LEARNING_SEED,
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE,
      C.MEDIA_OBSERVE,
      C.VIDEO_OBSERVE
    ]),
    [PROTECTION_MODES.AUTO]: Object.freeze([
      C.CORE_MESSAGING,
      C.CORE_MAINTENANCE,
      C.NAVIGATION_GUARD,
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.DOM_STATIC_RULES,
      C.DOM_OBSERVE,
      C.DOM_SUGGEST,
      C.DOM_AUTO_HIDE,
      C.DOM_MANUAL_PICKER,
      C.LEARNING_SEED,
      C.LEARNING_FEEDBACK,
      C.LEARNING_APPLY,
      C.TELEMETRY_QUEUE,
      C.MEDIA_OBSERVE,
      C.VIDEO_OBSERVE,
      C.VIDEO_AUTO_ACTION
    ])
  });
  var FEATURE_CATALOG = Object.freeze([
    feature("background.message-router", "background", C.CORE_MESSAGING, [
      C.CORE_MAINTENANCE,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("background.navigation-guard", "background", C.NAVIGATION_GUARD, [
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("background.telemetry-flush", "background", C.TELEMETRY_QUEUE),
    feature("background.memory-cleanup", "background", C.CORE_MAINTENANCE),
    feature("background.pattern-seed", "background", C.LEARNING_SEED),
    feature(
      "background.training-store-migration",
      "background",
      C.CORE_MAINTENANCE
    ),
    feature("background.settings-package-seed", "background", C.CORE_MAINTENANCE),
    feature("content.spy-injector", "content", C.MEDIA_OBSERVE),
    feature("content.youtube-cleaner", "content", C.DOM_STATIC_RULES),
    feature("content.navigation-intent", "content", C.NAVIGATION_INTENT),
    feature("content.navigation-toast", "content", C.NAVIGATION_FEEDBACK),
    feature("content.dom-static-blocker", "content", C.DOM_STATIC_RULES, [
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("content.dom-candidate-collector", "content", C.DOM_OBSERVE, [
      C.DOM_SUGGEST,
      C.DOM_AUTO_HIDE,
      C.LEARNING_FEEDBACK
    ]),
    feature("content.dom-learned-blocker", "content", C.LEARNING_APPLY, [
      C.DOM_AUTO_HIDE
    ]),
    feature("video.surgeon", "video", C.VIDEO_OBSERVE, [C.VIDEO_AUTO_ACTION]),
    feature("picker.controller", "picker", C.DOM_MANUAL_PICKER, [
      C.LEARNING_FEEDBACK
    ]),
    feature("main-world.network-capture", "main-world", C.MEDIA_OBSERVE),
    feature("main-world.timer-control", "main-world", C.VIDEO_AUTO_ACTION)
  ]);
  var CAPABILITY_SET = new Set(Object.values(CAPABILITIES));
  var FEATURE_BY_ID = new Map(FEATURE_CATALOG.map((item) => [item.id, item]));
  validateCatalog();
  function getFeatureDefinition(featureId) {
    const definition = FEATURE_BY_ID.get(featureId);
    if (!definition) {
      throw new Error(
        `[FeatureRegistry] Unknown feature "${featureId}". Register it in feature-catalog.js before use.`
      );
    }
    return definition;
  }
  function getFeaturesForContext(context) {
    return FEATURE_CATALOG.filter(
      (featureItem) => featureItem.context === context
    );
  }
  function assertRegisteredCapability(capability) {
    if (!CAPABILITY_SET.has(capability)) {
      throw new Error(
        `[FeatureRegistry] Unknown capability "${capability}". Register it in feature-catalog.js before use.`
      );
    }
    return capability;
  }
  function getCapabilitiesForMode(mode) {
    const capabilities = MODE_CAPABILITIES[mode];
    if (!capabilities) {
      throw new Error(`[FeatureRegistry] Unknown protection mode "${mode}".`);
    }
    return capabilities;
  }
  function feature(id, context, startCapability, extraCapabilities = []) {
    return Object.freeze({
      id,
      context,
      startCapability,
      capabilities: Object.freeze([startCapability, ...extraCapabilities])
    });
  }
  function validateCatalog() {
    const ids = /* @__PURE__ */ new Set();
    for (const definition of FEATURE_CATALOG) {
      if (ids.has(definition.id)) {
        throw new Error(
          `[FeatureRegistry] Duplicate feature "${definition.id}".`
        );
      }
      ids.add(definition.id);
      for (const capability of definition.capabilities) {
        assertRegisteredCapability(capability);
      }
    }
    for (const [mode, capabilities] of Object.entries(MODE_CAPABILITIES)) {
      for (const capability of capabilities) {
        if (!CAPABILITY_SET.has(capability)) {
          throw new Error(
            `[FeatureRegistry] Mode "${mode}" uses unregistered capability "${capability}".`
          );
        }
      }
    }
  }

  // src/shared/url.js
  function parseUrl(value, base) {
    try {
      return new URL(value, base);
    } catch {
      return null;
    }
  }
  function sameHostnameOrSubdomain(hostname, parent) {
    if (!hostname || !parent) return false;
    const h = hostname.toLowerCase();
    const p = parent.toLowerCase();
    return h === p || h.endsWith(`.${p}`);
  }

  // src/background/logs.js
  async function logBlockedNavigation(url, source) {
    const { blockedLogs = [] } = await chrome.storage.local.get(["blockedLogs"]);
    await chrome.storage.local.set({
      blockedLogs: [{ url, source, timestamp: Date.now() }, ...blockedLogs].slice(
        0,
        20
      )
    });
    await recordTelemetry({
      unit: "navigation",
      label: "ad",
      label_source: "heuristic_block",
      label_strength: "weak",
      ad_type: "popunder",
      targetUrl: url,
      sourceUrl: `https://${source}/`,
      action: "block",
      outcome: "auto_blocked_navigation",
      context: {
        source_host: source,
        target_host: safeHost(url),
        surface: "navigation_guard"
      }
    });
  }
  function safeHost(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "unknown";
    }
  }

  // src/navigation/background/new-tab-policy.js
  var NEW_TAB_DECISIONS = Object.freeze({
    ALLOW: "allow",
    CLOSE: "close",
    VERIFY: "verify"
  });
  var NEW_TAB_REVIEW_SURFACES = Object.freeze({
    FULL_PAGE: "full_page",
    TOAST: "toast",
    CLOSE: "close"
  });
  function decideNewTabNavigation({
    sameSite = false,
    trustedInitiator = false,
    trustedTarget = false,
    whitelisted = false,
    blacklisted = false,
    trustedPath = false,
    promotionalIntent = false
  } = {}) {
    if (blacklisted) return NEW_TAB_DECISIONS.CLOSE;
    if (sameSite || trustedInitiator || trustedTarget || whitelisted || !promotionalIntent && trustedPath)
      return NEW_TAB_DECISIONS.ALLOW;
    return NEW_TAB_DECISIONS.VERIFY;
  }
  function shouldKeepTrackingNewTab({ sameSite = false } = {}) {
    return sameSite;
  }
  function chooseNewTabReviewSurface({
    promotionalIntent = false,
    targetLikelyAd = false,
    intentReasons = [],
    targetReasons = []
  } = {}) {
    const reasons = /* @__PURE__ */ new Set([...intentReasons, ...targetReasons]);
    const strongTracking = reasons.has("strong_tracking_parameter");
    const corroboratingSignal = reasons.has("multiple_campaign_parameters") || reasons.has("promotional_element_or_destination");
    if (strongTracking && corroboratingSignal) {
      return NEW_TAB_REVIEW_SURFACES.CLOSE;
    }
    return promotionalIntent || targetLikelyAd ? NEW_TAB_REVIEW_SURFACES.FULL_PAGE : NEW_TAB_REVIEW_SURFACES.TOAST;
  }

  // src/navigation/background/reverse-popunder.js
  var REVERSE_POPUNDER_WINDOW_MS = 7e3;
  function isSelfCloneNavigation(originalUrl, cloneUrl) {
    const original = parseUrl(originalUrl);
    const clone = parseUrl(cloneUrl);
    if (!isHttpUrl(original) || !isHttpUrl(clone)) return false;
    return original.hostname.toLowerCase() === clone.hostname.toLowerCase() && normalizePath(original.pathname) === normalizePath(clone.pathname);
  }
  function isReversePopunderSequence({
    originalUrl,
    cloneUrl,
    redirectedUrl,
    elapsedMs
  }) {
    if (elapsedMs < 0 || elapsedMs > REVERSE_POPUNDER_WINDOW_MS) return false;
    if (!isSelfCloneNavigation(originalUrl, cloneUrl)) return false;
    const original = parseUrl(originalUrl);
    const redirected = parseUrl(redirectedUrl);
    if (!isHttpUrl(redirected)) return false;
    return !(sameHostnameOrSubdomain(original.hostname, redirected.hostname) || sameHostnameOrSubdomain(redirected.hostname, original.hostname));
  }
  function isHttpUrl(url) {
    return url?.protocol === "http:" || url?.protocol === "https:";
  }
  function normalizePath(pathname) {
    const normalized = pathname.replace(/\/+$/, "");
    return normalized || "/";
  }

  // src/navigation/shared/intent-classifier.js
  var STRONG_TRACKING_KEYS = /* @__PURE__ */ new Set([
    "adid",
    "aff_id",
    "affiliate",
    "bannerid",
    "clickid",
    "gclid",
    "pop_id",
    "popunder",
    "zoneid"
  ]);
  var PROMOTIONAL_TOKEN_RE = /(^|[^a-z0-9])(?:ad|ads|advert|banner|casino|hitclub|promo|sponsor|bet)([^a-z0-9]|$)/i;
  function classifyNavigationIntent({
    intentUrl,
    sourceUrl,
    evidence = ""
  } = {}) {
    const intent = parseUrl(intentUrl);
    const source = parseUrl(sourceUrl);
    const promotionalEvidence = PROMOTIONAL_TOKEN_RE.test(evidence);
    if (!intent || !/^https?:$/.test(intent.protocol)) {
      return {
        likelyAd: promotionalEvidence,
        reasons: promotionalEvidence ? ["promotional_element_or_destination"] : []
      };
    }
    const external = !source || !(sameHostnameOrSubdomain(intent.hostname, source.hostname) || sameHostnameOrSubdomain(source.hostname, intent.hostname));
    if (!external) return { likelyAd: false, reasons: [] };
    const keys = [...intent.searchParams.keys()].map((key) => key.toLowerCase());
    const strongTracking = keys.some((key) => STRONG_TRACKING_KEYS.has(key));
    const marketingCount = keys.filter((key) => key.startsWith("utm_")).length;
    const tokenEvidence = `${intent.hostname} ${intent.pathname} ${evidence}`;
    const promotionalToken = PROMOTIONAL_TOKEN_RE.test(tokenEvidence);
    const reasons = [];
    if (strongTracking) reasons.push("strong_tracking_parameter");
    if (marketingCount >= 2) reasons.push("multiple_campaign_parameters");
    if (promotionalToken) reasons.push("promotional_element_or_destination");
    return {
      likelyAd: reasons.length > 0,
      reasons
    };
  }

  // src/navigation/background/guard.js
  var TRUSTED_INITIATORS = [
    "google.com",
    "bing.com",
    "duckduckgo.com",
    "yahoo.com",
    "search.yahoo.com",
    "github.com",
    "microsoft.com",
    "login.microsoftonline.com",
    "live.com",
    "apple.com",
    "appleid.apple.com",
    "facebook.com",
    "accounts.facebook.com",
    "cloudflare.com",
    "challenges.cloudflare.com"
  ];
  var TRUSTED_TARGETS = [
    ...TRUSTED_INITIATORS,
    "paypal.com",
    "stripe.com",
    "checkout.stripe.com",
    "pay.google.com",
    "payments.google.com",
    "shop.app",
    "klarna.com",
    "adyen.com",
    "authorize.net"
  ];
  var pendingTabs = /* @__PURE__ */ new Map();
  var handledTabs = /* @__PURE__ */ new Map();
  var reverseCandidatesBySource = /* @__PURE__ */ new Map();
  var reverseCandidatesByClone = /* @__PURE__ */ new Map();
  var pendingReviewToasts = /* @__PURE__ */ new Map();
  var navigationPolicy = null;
  function registerNavigationGuard(policy) {
    navigationPolicy = policy;
    const onCreatedNavigationTarget = (details) => {
      trackReverseCandidate({
        sourceTabId: details.sourceTabId,
        cloneTabId: details.tabId,
        cloneUrl: details.url
      }).catch(logReversePopunderError);
      evaluateNewTab({
        sourceTabId: details.sourceTabId,
        tabId: details.tabId,
        url: details.url
      });
    };
    const onCreated = (tab) => {
      const sourceTabId = tab.openerTabId || getRecentUserGestureSourceTabId(2500);
      if (!sourceTabId || !tab.id) return;
      pendingTabs.set(tab.id, {
        sourceTabId,
        createdAt: Date.now(),
        hasRealOpener: !!tab.openerTabId
      });
      trackReverseCandidate({
        sourceTabId,
        cloneTabId: tab.id,
        cloneUrl: tab.pendingUrl || tab.url
      }).catch(logReversePopunderError);
      setTimeout(
        () => pendingTabs.delete(tab.id),
        tab.openerTabId ? 1e4 : REVERSE_POPUNDER_WINDOW_MS + 500
      );
      const initialUrl = tab.pendingUrl || tab.url;
      if (initialUrl && !isBlankUrl(initialUrl)) {
        evaluateNewTab({ sourceTabId, tabId: tab.id, url: initialUrl });
      }
    };
    const onUpdated = (tabId, changeInfo) => {
      if (!changeInfo.url || isBlankUrl(changeInfo.url)) return;
      observeReverseNavigation(tabId, changeInfo.url);
      const pending = pendingTabs.get(tabId);
      if (!pending) return;
      if (isExpiredFallbackPending(pending)) {
        pendingTabs.delete(tabId);
        return;
      }
      evaluateNewTab({
        sourceTabId: pending.sourceTabId,
        tabId,
        url: changeInfo.url
      });
    };
    const onCommitted = (details) => {
      if (details.frameId !== 0 || isBlankUrl(details.url)) return;
      observeReverseNavigation(details.tabId, details.url);
      const pending = pendingTabs.get(details.tabId);
      if (!pending) return;
      if (isExpiredFallbackPending(pending)) {
        pendingTabs.delete(details.tabId);
        return;
      }
      evaluateNewTab({
        sourceTabId: pending.sourceTabId,
        tabId: details.tabId,
        url: details.url
      });
    };
    chrome.webNavigation.onCreatedNavigationTarget.addListener(
      onCreatedNavigationTarget
    );
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    return () => {
      chrome.webNavigation.onCreatedNavigationTarget.removeListener(
        onCreatedNavigationTarget
      );
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      pendingTabs.clear();
      reverseCandidatesBySource.clear();
      reverseCandidatesByClone.clear();
      pendingReviewToasts.clear();
      navigationPolicy = null;
    };
  }
  function getRecentUserGestureSourceTabId(windowMs) {
    const click = runtimeState.lastTrustedClick;
    if (!click.tabId || !click.sourceUrl || Date.now() - click.timestamp >= windowMs)
      return null;
    return click.tabId;
  }
  function isExpiredFallbackPending(pending) {
    return !pending.hasRealOpener && Date.now() - pending.createdAt > REVERSE_POPUNDER_WINDOW_MS;
  }
  async function trackReverseCandidate({ sourceTabId, cloneTabId, cloneUrl }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_REVERSE_POPUNDER) || !sourceTabId || !cloneTabId)
      return;
    let candidate = reverseCandidatesBySource.get(sourceTabId);
    if (candidate && candidate.cloneTabId !== cloneTabId) {
      cleanupReverseCandidate(candidate);
      candidate = null;
    }
    if (!candidate) {
      candidate = {
        sourceTabId,
        cloneTabId,
        originalUrl: getRecentSourceUrl(sourceTabId),
        cloneUrl: null,
        redirectedUrl: null,
        createdAt: Date.now(),
        handling: false
      };
      reverseCandidatesBySource.set(sourceTabId, candidate);
      reverseCandidatesByClone.set(cloneTabId, candidate);
      setTimeout(
        () => cleanupReverseCandidate(candidate),
        REVERSE_POPUNDER_WINDOW_MS + 500
      );
    }
    if (!candidate.originalUrl) {
      try {
        const sourceTab = await chrome.tabs.get(sourceTabId);
        if (sourceTab?.url?.startsWith("http")) {
          candidate.originalUrl = sourceTab.url;
        }
      } catch {
      }
    }
    if (cloneUrl && !isBlankUrl(cloneUrl)) candidate.cloneUrl = cloneUrl;
    maybeHandleReversePopunder(candidate).catch(logReversePopunderError);
  }
  function observeReverseNavigation(tabId, url) {
    const cloneCandidate = reverseCandidatesByClone.get(tabId);
    if (cloneCandidate) {
      cloneCandidate.cloneUrl = url;
      maybeHandleReversePopunder(cloneCandidate).catch(logReversePopunderError);
    }
    const sourceCandidate = reverseCandidatesBySource.get(tabId);
    if (sourceCandidate) {
      sourceCandidate.redirectedUrl = url;
      maybeHandleReversePopunder(sourceCandidate).catch(logReversePopunderError);
    }
  }
  async function maybeHandleReversePopunder(candidate) {
    if (candidate.handling || !candidate.originalUrl || !candidate.cloneUrl || !candidate.redirectedUrl)
      return;
    const elapsedMs = Date.now() - candidate.createdAt;
    if (!isReversePopunderSequence({
      originalUrl: candidate.originalUrl,
      cloneUrl: candidate.cloneUrl,
      redirectedUrl: candidate.redirectedUrl,
      elapsedMs
    }))
      return;
    candidate.handling = true;
    if (await isAllowedReverseRedirect(candidate)) {
      cleanupReverseCandidate(candidate);
      return;
    }
    const sourceHost = new URL(candidate.originalUrl).hostname;
    await logBlockedNavigationIfAllowed(candidate.redirectedUrl, sourceHost);
    try {
      const cloneTab = await chrome.tabs.get(candidate.cloneTabId);
      if (!cloneTab?.url || !isSelfCloneNavigation(candidate.originalUrl, cloneTab.url))
        throw new Error("clone gone");
      await chrome.tabs.update(candidate.cloneTabId, { active: true });
      await chrome.tabs.remove(candidate.sourceTabId);
    } catch {
      try {
        await chrome.tabs.update(candidate.sourceTabId, {
          url: candidate.originalUrl
        });
      } catch {
      }
    } finally {
      pendingTabs.delete(candidate.cloneTabId);
      handledTabs.set(candidate.sourceTabId, Date.now());
      cleanupReverseCandidate(candidate);
    }
  }
  async function isAllowedReverseRedirect(candidate) {
    const original = new URL(candidate.originalUrl);
    const redirected = new URL(candidate.redirectedUrl);
    if (isTrustedTarget(redirected.hostname)) return true;
    const { whitelist = [] } = await chrome.storage.local.get("whitelist");
    if (whitelist.includes(redirected.hostname)) return true;
    const trustWindow = await getDynamicTrustWindow(original.hostname);
    if (hasMatchingIntent(candidate.sourceTabId, redirected.hostname, trustWindow))
      return true;
    const path = await getTrustedPath(original.hostname, redirected.hostname);
    return !isPromotionalIntent(candidate.sourceTabId) && !!path && (path.isManual || path.visits >= 3);
  }
  function getRecentSourceUrl(sourceTabId) {
    const click = runtimeState.lastTrustedClick;
    if (click.tabId === sourceTabId && click.sourceUrl?.startsWith("http") && Date.now() - click.timestamp < 2e3)
      return click.sourceUrl;
    return null;
  }
  function cleanupReverseCandidate(candidate) {
    if (reverseCandidatesBySource.get(candidate.sourceTabId) === candidate) {
      reverseCandidatesBySource.delete(candidate.sourceTabId);
    }
    if (reverseCandidatesByClone.get(candidate.cloneTabId) === candidate) {
      reverseCandidatesByClone.delete(candidate.cloneTabId);
    }
  }
  function logReversePopunderError(error) {
    console.error("Reverse pop-under guard failed:", error);
  }
  async function evaluateNewTab({ sourceTabId, tabId, url }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_GUARD)) return;
    if (!sourceTabId || !tabId || !url || isBlankUrl(url)) return;
    if (handledTabs.has(tabId)) return;
    let shouldFinalize = false;
    try {
      const { whitelist = [], blacklist = [] } = await chrome.storage.local.get([
        "whitelist",
        "blacklist"
      ]);
      const sourceTab = await chrome.tabs.get(sourceTabId);
      const capturedSourceUrl = reverseCandidatesBySource.get(sourceTabId)?.originalUrl || sourceTab?.url;
      if (!capturedSourceUrl?.startsWith("http")) return;
      const sourceUrl = new URL(capturedSourceUrl);
      const targetUrl = new URL(url);
      const targetDomain = targetUrl.hostname;
      const sameSite = sameHostnameOrSubdomain(sourceUrl.hostname, targetDomain) || sameHostnameOrSubdomain(targetDomain, sourceUrl.hostname);
      if (shouldKeepTrackingNewTab({ sameSite })) return;
      const trustWindow = await getDynamicTrustWindow(sourceUrl.hostname);
      const path = await getTrustedPath(sourceUrl.hostname, targetDomain);
      await delay(180);
      const intentClassification = getRecentIntentClassification(
        sourceTabId,
        trustWindow
      );
      const promotionalIntent = intentClassification.likelyAd;
      const decision = decideNewTabNavigation({
        sameSite,
        trustedInitiator: isTrustedInitiator(sourceUrl.hostname),
        trustedTarget: isTrustedTarget(targetDomain),
        whitelisted: whitelist.includes(targetDomain),
        blacklisted: isBlacklistedTarget(targetDomain, blacklist),
        trustedPath: !!path && (path.isManual || path.visits >= 3),
        promotionalIntent
      });
      if (decision === NEW_TAB_DECISIONS.ALLOW) {
        shouldFinalize = true;
        return;
      }
      if (decision === NEW_TAB_DECISIONS.CLOSE) {
        shouldFinalize = true;
        await logBlockedNavigationIfAllowed(url, sourceUrl.hostname);
        return closeTabQuietly(tabId);
      }
      const targetClassification = classifyNavigationIntent({
        intentUrl: url,
        sourceUrl: capturedSourceUrl
      });
      const reviewSurface = chooseNewTabReviewSurface({
        promotionalIntent,
        targetLikelyAd: targetClassification.likelyAd,
        intentReasons: intentClassification.reasons,
        targetReasons: targetClassification.reasons
      });
      shouldFinalize = true;
      if (reviewSurface === NEW_TAB_REVIEW_SURFACES.CLOSE) {
        await logBlockedNavigationIfAllowed(url, sourceUrl.hostname);
        return closeTabQuietly(tabId);
      }
      if (reviewSurface === NEW_TAB_REVIEW_SURFACES.FULL_PAGE) {
        return redirectToBlockedPage(tabId, url, sourceUrl.hostname);
      }
      const toastShown = await showNavigationReviewToast({
        tabId,
        url,
        source: sourceUrl.hostname,
        target: targetDomain
      });
      if (toastShown) return;
      return redirectToBlockedPage(tabId, url, sourceUrl.hostname);
    } catch (err) {
      console.error("Error evaluating navigation:", err);
    } finally {
      if (shouldFinalize) {
        pendingTabs.delete(tabId);
        handledTabs.set(tabId, Date.now());
        setTimeout(() => handledTabs.delete(tabId), 15e3);
      }
    }
  }
  function hasMatchingIntent(sourceTabId, targetDomain, trustWindow) {
    const click = runtimeState.lastTrustedClick;
    if (click.tabId !== sourceTabId) return false;
    const intent = parseUrl(click.intentUrl);
    if (isPromotionalIntent(sourceTabId)) return false;
    const timeSinceClick = Date.now() - click.timestamp;
    return timeSinceClick >= 0 && timeSinceClick < trustWindow && !!intent && (sameHostnameOrSubdomain(targetDomain, intent.hostname) || sameHostnameOrSubdomain(intent.hostname, targetDomain));
  }
  async function showNavigationReviewToast({ tabId, url, source, target }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_FEEDBACK)) return false;
    const message = {
      type: "SHOW_GRAY_NAVIGATION",
      tabId,
      url,
      source,
      target
    };
    pendingReviewToasts.set(tabId, {
      message,
      expiresAt: Date.now() + 1e4,
      delivered: false
    });
    setTimeout(() => {
      const pending = pendingReviewToasts.get(tabId);
      if (pending?.message === message) pendingReviewToasts.delete(tabId);
    }, 10500);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (await deliverPendingNavigationReview(tabId)) {
        pendingReviewToasts.delete(tabId);
        return true;
      }
      if (attempt < 5) await delay(220);
    }
    return pendingReviewToasts.has(tabId);
  }
  async function deliverPendingNavigationReview(tabId) {
    const pending = pendingReviewToasts.get(tabId);
    if (!pending) return false;
    if (pending.delivered) return true;
    if (Date.now() >= pending.expiresAt) {
      pendingReviewToasts.delete(tabId);
      return false;
    }
    try {
      await chrome.tabs.sendMessage(tabId, pending.message);
      pending.delivered = true;
      return true;
    } catch {
      return false;
    }
  }
  function isPromotionalIntent(sourceTabId) {
    return getRecentIntentClassification(sourceTabId).likelyAd;
  }
  function getRecentIntentClassification(sourceTabId, windowMs = 2500) {
    const click = runtimeState.lastTrustedClick;
    if (click.tabId !== sourceTabId || Date.now() - click.timestamp < 0 || Date.now() - click.timestamp >= windowMs)
      return { likelyAd: false, reasons: [] };
    const classification = classifyNavigationIntent({
      intentUrl: click.intentUrl,
      sourceUrl: click.sourceUrl,
      evidence: click.intentKind === "promotional" ? "promo" : ""
    });
    const reasons = [
      .../* @__PURE__ */ new Set([...click.intentReasons || [], ...classification.reasons])
    ];
    return {
      likelyAd: click.intentKind === "promotional" || classification.likelyAd,
      reasons
    };
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function redirectToBlockedPage(tabId, url, source) {
    await logBlockedNavigationIfAllowed(url, source);
    await chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL(
        `ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(source)}`
      )
    });
  }
  async function logBlockedNavigationIfAllowed(url, source) {
    if (navigationPolicy?.can(CAPABILITIES.TELEMETRY_QUEUE)) {
      await logBlockedNavigation(url, source);
    }
  }
  async function closeTabQuietly(tabId) {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      try {
        await chrome.tabs.update(tabId, { url: "about:blank" });
      } catch {
      }
    }
  }
  function isBlankUrl(url) {
    return !url || url === "about:blank" || url.startsWith("about:") || url.startsWith("chrome:");
  }
  function isTrustedInitiator(hostname) {
    return hostMatchesAny(hostname, TRUSTED_INITIATORS) || isGoogleHost(hostname);
  }
  function isTrustedTarget(hostname) {
    return hostMatchesAny(hostname, TRUSTED_TARGETS) || isGoogleHost(hostname);
  }
  function isBlacklistedTarget(hostname, blacklist = []) {
    const normalized = hostname.toLowerCase();
    return blacklist.some((entry) => {
      const value = String(entry || "").replace(/^\|\|/, "").replace(/\^$/, "").toLowerCase();
      return normalized === value || normalized.endsWith(`.${value}`);
    });
  }
  function hostMatchesAny(hostname, domains) {
    const normalized = hostname.toLowerCase();
    return domains.some(
      (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
    );
  }
  function isGoogleHost(hostname) {
    return /^(.+\.)?google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(
      hostname.toLowerCase()
    );
  }

  // src/background/message-router.js
  var MESSAGE_CAPABILITIES = Object.freeze({
    TRUSTED_CLICK: CAPABILITIES.NAVIGATION_INTENT,
    SYNC_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
    NEGATIVE_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
    USER_DECISION: CAPABILITIES.NAVIGATION_FEEDBACK,
    PATH_RESTORED: CAPABILITIES.NAVIGATION_FEEDBACK,
    RESTORE_GRAY_NAVIGATION: CAPABILITIES.NAVIGATION_FEEDBACK,
    BLOCK_GRAY_NAVIGATION: CAPABILITIES.NAVIGATION_FEEDBACK,
    KEEP_REVIEWED_TAB: CAPABILITIES.NAVIGATION_FEEDBACK,
    BLOCK_REVIEWED_TAB: CAPABILITIES.NAVIGATION_FEEDBACK,
    NAVIGATION_TOAST_READY: CAPABILITIES.NAVIGATION_FEEDBACK,
    LEARN_VIDEO_AD: CAPABILITIES.LEARNING_FEEDBACK,
    SYNC_VIDEO_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
    REPORT_AD_DENSITY: CAPABILITIES.CORE_MAINTENANCE,
    RECORD_TELEMETRY: CAPABILITIES.TELEMETRY_QUEUE,
    FLUSH_TELEMETRY: CAPABILITIES.TELEMETRY_QUEUE,
    UPSERT_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
    REMOVE_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
    RESTORE_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
    RESET_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
    SAVE_DOMAIN_DECISION: CAPABILITIES.CORE_MAINTENANCE,
    REMOVE_DOMAIN_DECISION: CAPABILITIES.CORE_MAINTENANCE,
    GET_STORAGE_HEALTH: CAPABILITIES.CORE_MAINTENANCE,
    RECORD_DOM_SAMPLE: CAPABILITIES.LEARNING_FEEDBACK
  });
  function registerMessageRouter(policy) {
    const onMessage = (message, sender, sendResponse) => {
      if (!policy.can(CAPABILITIES.CORE_MESSAGING)) {
        sendResponse({ status: "disabled" });
        return false;
      }
      const capability = MESSAGE_CAPABILITIES[message?.type];
      if (capability && !policy.can(capability)) {
        sendResponse({ status: "capability_disabled" });
        return false;
      }
      route(message, sender).then((r) => sendResponse(r || { status: "ok" })).catch((err) => sendResponse({ status: "error", error: err.message }));
      return true;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }
  async function route(message, sender) {
    if (!message) return { status: "ignored" };
    if (message.type === "TRUSTED_CLICK") {
      runtimeState.lastTrustedClick = {
        timestamp: Date.now(),
        intentUrl: message.intentUrl,
        sourceUrl: message.sourceUrl || sender?.tab?.url || null,
        intentKind: message.intentKind || "navigation",
        intentReasons: Array.isArray(message.intentReasons) ? message.intentReasons : [],
        tabId: sender?.tab?.id || null
      };
      return;
    }
    if (message.type === "NAVIGATION_TOAST_READY") {
      if (!sender?.tab?.id) return { status: "ignored" };
      const delivered = await deliverPendingNavigationReview(sender.tab.id);
      return { status: delivered ? "delivered" : "ready" };
    }
    if (message.type === "SYNC_LEARNING") return synthesizeGlobalPatterns();
    if (message.type === "UPSERT_CUSTOM_RULES")
      return getSettingsMutationStore().upsertCustomRules(
        message.hostname,
        message.rules
      );
    if (message.type === "REMOVE_CUSTOM_RULES")
      return getSettingsMutationStore().removeCustomRules(
        message.hostname,
        message.selectors
      );
    if (message.type === "RESTORE_CUSTOM_RULES")
      return getSettingsMutationStore().restoreCustomRules(
        message.hostname,
        message.selectors
      );
    if (message.type === "RESET_CUSTOM_RULES")
      return getSettingsMutationStore().resetCustomRules(message.hostname);
    if (message.type === "SAVE_DOMAIN_DECISION")
      return getSettingsMutationStore().saveDomainDecision(
        message.action,
        message.domain
      );
    if (message.type === "REMOVE_DOMAIN_DECISION")
      return getSettingsMutationStore().removeDomainDecision(
        message.listName,
        message.domain
      );
    if (message.type === "GET_STORAGE_HEALTH") return getStorageHealth();
    if (message.type === "RECORD_DOM_SAMPLE") {
      await addDomTrainingSample(message.sample);
      return { status: "saved" };
    }
    if (message.type === "NEGATIVE_LEARNING")
      return handleNegativeLearning(message.fingerprint);
    if (message.type === "USER_DECISION") return handleUserDecision(message);
    if (message.type === "PATH_RESTORED")
      return syncTrustedPath(message.source, message.target, true);
    if (message.type === "RESTORE_GRAY_NAVIGATION") {
      await syncTrustedPath(message.source, message.target, true);
      await recordTelemetryBestEffort({
        unit: "navigation",
        label: "false_positive",
        label_source: "user_restore",
        label_strength: "strong",
        ad_type: "popunder",
        targetUrl: message.url,
        sourceUrl: `https://${message.source}/`,
        action: "restore",
        outcome: "user_opened_gray_navigation",
        context: {
          source_host: message.source,
          target_host: message.target,
          surface: "navigation_toast"
        },
        feedback: {
          user_action: "restore",
          correction: "false_positive",
          surface: "navigation_toast"
        }
      });
      await chrome.tabs.create({ url: message.url, active: true });
      return;
    }
    if (message.type === "BLOCK_GRAY_NAVIGATION") {
      await handleUserDecision({ action: "BLACKLIST", domain: message.target });
      await recordTelemetryBestEffort({
        unit: "navigation",
        label: "ad",
        label_source: "user_block",
        label_strength: "strong",
        ad_type: "popunder",
        targetUrl: message.url,
        sourceUrl: `https://${message.source}/`,
        action: "block",
        outcome: "user_blocked_gray_navigation",
        context: {
          source_host: message.source,
          target_host: message.target,
          surface: "navigation_toast"
        },
        feedback: {
          user_action: "block",
          surface: "navigation_toast"
        }
      });
      return { status: "saved" };
    }
    if (message.type === "KEEP_REVIEWED_TAB") {
      await syncTrustedPath(message.source, message.target, true);
      await recordTelemetryBestEffort({
        unit: "navigation",
        label: "false_positive",
        label_source: "user_keep",
        label_strength: "strong",
        ad_type: "popunder",
        targetUrl: message.url,
        sourceUrl: `https://${message.source}/`,
        action: "allow",
        outcome: "user_kept_reviewed_tab",
        context: {
          source_host: message.source,
          target_host: message.target,
          surface: "navigation_toast"
        },
        feedback: {
          user_action: "keep",
          correction: "false_positive",
          surface: "navigation_toast"
        }
      });
      return;
    }
    if (message.type === "BLOCK_REVIEWED_TAB") {
      await handleUserDecision({ action: "BLACKLIST", domain: message.target });
      await recordTelemetryBestEffort({
        unit: "navigation",
        label: "ad",
        label_source: "user_block",
        label_strength: "strong",
        ad_type: "popunder",
        targetUrl: message.url,
        sourceUrl: `https://${message.source}/`,
        action: "block",
        outcome: "user_blocked_reviewed_tab",
        context: {
          source_host: message.source,
          target_host: message.target,
          surface: "navigation_toast"
        },
        feedback: {
          user_action: "block",
          surface: "navigation_toast"
        }
      });
      if (Number.isInteger(message.tabId)) {
        try {
          await chrome.tabs.remove(message.tabId);
        } catch {
        }
      }
      return;
    }
    if (message.type === "LEARN_VIDEO_AD") return handleLearnVideoAd(message);
    if (message.type === "SYNC_VIDEO_LEARNING")
      return handleVideoLearning(message);
    if (message.type === "REPORT_AD_DENSITY")
      return updateSiteReputation(message.hostname, message.count);
    if (message.type === "RECORD_TELEMETRY")
      return recordTelemetry(message.event || message);
    if (message.type === "FLUSH_TELEMETRY") return flushTelemetry();
    if (message.type === "TOGGLE_STATUS")
      console.log("Protection status:", message.isEnabled);
    return { status: "ignored" };
  }
  async function recordTelemetryBestEffort(event) {
    try {
      return await recordTelemetry(event);
    } catch (error) {
      console.warn("[AdsFriendly] Telemetry skipped:", error.message);
      return { status: "skipped", error: error.message };
    }
  }

  // src/runtime/settings-store.js
  var SETTINGS_KEY = "appSettings";
  var DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    protectionMode: PROTECTION_MODES.SAFE,
    featureOverrides: Object.freeze({})
  });
  function normalizeSettings(value = {}) {
    const protectionMode = Object.values(PROTECTION_MODES).includes(
      value.protectionMode
    ) ? value.protectionMode : DEFAULT_SETTINGS.protectionMode;
    return {
      enabled: value.enabled !== false,
      protectionMode,
      featureOverrides: value.featureOverrides && typeof value.featureOverrides === "object" ? { ...value.featureOverrides } : {}
    };
  }
  function migrateLegacySettings(stored = {}) {
    if (stored[SETTINGS_KEY]) return normalizeSettings(stored[SETTINGS_KEY]);
    const protectionMode = stored.friendlyMode === false ? PROTECTION_MODES.AUTO : PROTECTION_MODES.SAFE;
    return normalizeSettings({
      enabled: stored.isEnabled !== false,
      protectionMode
    });
  }
  async function loadSettings(storage = chrome.storage.local) {
    const stored = await storage.get([SETTINGS_KEY, "isEnabled", "friendlyMode"]);
    const settings = migrateLegacySettings(stored);
    if (!stored[SETTINGS_KEY]) await storage.set({ [SETTINGS_KEY]: settings });
    return settings;
  }
  function subscribeSettings(listener, storageArea = "local") {
    const onChanged = (changes, areaName) => {
      if (areaName !== storageArea || !changes[SETTINGS_KEY]) return;
      listener(normalizeSettings(changes[SETTINGS_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }

  // src/settings-package/schema.js
  var SETTINGS_PACKAGE_SCHEMA = "adsfriendly.settings-package.v1";
  var SETTINGS_PACKAGE_STATE_KEY = "settingsPackageState";
  var BUNDLED_SETTINGS_PACKAGE_PATH = "packages/default-settings-package.json";
  var MAX_RULES = 5e3;
  var MAX_RULES_PER_SITE2 = 250;
  var MAX_SELECTOR_LENGTH = 500;
  var DANGEROUS_SELECTORS = /* @__PURE__ */ new Set([
    "*",
    "html",
    "body",
    "head",
    "header",
    "nav",
    "main",
    "form",
    "div",
    "span",
    "p",
    "a",
    "li",
    "ul",
    "img",
    "section",
    "iframe",
    "video"
  ]);
  function normalizeSettingsPackage(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Settings package must be a JSON object.");
    }
    if (input.schema_version !== SETTINGS_PACKAGE_SCHEMA) {
      throw new Error(
        `Unsupported package schema: ${String(input.schema_version || "missing")}`
      );
    }
    const metadata = normalizeMetadata(input.metadata);
    const rawSettings = input.settings || {};
    const customRules = normalizeCustomRules(rawSettings.custom_rules);
    const totalRules = Object.values(customRules).reduce(
      (count, rules) => count + rules.length,
      0
    );
    if (totalRules > MAX_RULES) {
      throw new Error(`Package exceeds the ${MAX_RULES} rule limit.`);
    }
    return {
      schema_version: SETTINGS_PACKAGE_SCHEMA,
      metadata,
      settings: {
        app: normalizeSettings(rawSettings.app),
        whitelist: normalizeDomainList(rawSettings.whitelist, false),
        blacklist: normalizeDomainList(rawSettings.blacklist, true),
        custom_rules: customRules,
        trusted_paths: normalizeTrustedPaths(rawSettings.trusted_paths)
      }
    };
  }
  function packageToStorage(packageInput) {
    const settingsPackage = normalizeSettingsPackage(packageInput);
    const appSettings = settingsPackage.settings.app;
    const updates = {
      appSettings,
      isEnabled: appSettings.enabled,
      friendlyMode: appSettings.protectionMode === "safe",
      whitelist: settingsPackage.settings.whitelist,
      blacklist: settingsPackage.settings.blacklist,
      userCustomRules: settingsPackage.settings.custom_rules
    };
    for (const path of settingsPackage.settings.trusted_paths) {
      updates[`p:${path.source}>${path.target}`] = path;
    }
    return updates;
  }
  async function replaceSettingsWithPackage(packageInput, storage = chrome.storage.local, source = "imported") {
    const settingsPackage = normalizeSettingsPackage(packageInput);
    const current = await storage.get(null);
    const oldPathKeys = Object.keys(current).filter(
      (key) => key.startsWith("p:")
    );
    const updates = {
      ...packageToStorage(settingsPackage),
      [SETTINGS_PACKAGE_STATE_KEY]: {
        schema_version: "adsfriendly.settings-package-state.v1",
        initialized: true,
        source,
        package: settingsPackage.metadata,
        installed_at: Date.now()
      }
    };
    await storage.set(updates);
    const saved = await storage.get(Object.keys(updates));
    for (const [key, expected] of Object.entries(updates)) {
      if (JSON.stringify(saved[key]) !== JSON.stringify(expected))
        throw new Error(`Could not verify imported setting: ${key}.`);
    }
    const obsoletePathKeys = oldPathKeys.filter((key) => !(key in updates));
    if (obsoletePathKeys.length) await storage.remove(obsoletePathKeys);
    return settingsPackage;
  }
  function hasMeaningfulExistingSettings(snapshot = {}) {
    const settings = normalizeSettings(snapshot.appSettings);
    const settingsDiffer = settings.enabled !== DEFAULT_SETTINGS.enabled || settings.protectionMode !== DEFAULT_SETTINGS.protectionMode || Object.keys(settings.featureOverrides).length > 0;
    return settingsDiffer || (snapshot.whitelist?.length || 0) > 0 || (snapshot.blacklist?.length || 0) > 0 || Object.keys(snapshot.userCustomRules || {}).length > 0 || Object.keys(snapshot).some((key) => key.startsWith("p:"));
  }
  function normalizeMetadata(metadata = {}) {
    return {
      id: cleanText(metadata.id || `package.${Date.now()}`, 120),
      name: cleanText(metadata.name || "AdsFriendly Settings", 120),
      author: cleanText(metadata.author || "Unknown", 120),
      version: cleanText(metadata.version || "1.0.0", 40),
      description: cleanText(metadata.description || "", 500),
      created_at: cleanText(metadata.created_at || (/* @__PURE__ */ new Date()).toISOString(), 80)
    };
  }
  function normalizeDomainList(values, blacklist) {
    if (!Array.isArray(values)) return [];
    return [
      ...new Set(
        values.map(normalizeHostname2).filter(Boolean).map((hostname) => blacklist ? `||${hostname}^` : hostname)
      )
    ].slice(0, 2e3);
  }
  function normalizeCustomRules(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result = {};
    for (const [rawHostname, rawRules] of Object.entries(value)) {
      const hostname = normalizeHostname2(rawHostname);
      if (!hostname || !Array.isArray(rawRules)) continue;
      const rules = rawRules.slice(0, MAX_RULES_PER_SITE2).map(normalizeRule).filter(Boolean);
      if (rules.length) result[hostname] = dedupeRules(rules);
    }
    return result;
  }
  function normalizeRule(rule) {
    const rawSelector = typeof rule === "string" ? rule : rule?.selector;
    const selector = cleanText(rawSelector, MAX_SELECTOR_LENGTH);
    if (!isSafeSelector(selector)) return null;
    if (typeof rule === "string") return selector;
    const normalized = {
      selector,
      fingerprint: normalizeFingerprint(rule.fingerprint),
      confidence: clampNumber(rule.confidence, 0, 1, 0.8),
      source: cleanText(rule.source || "package", 80)
    };
    if (rule.isCorrection === true) normalized.isCorrection = true;
    return normalized;
  }
  function normalizeFingerprint(fingerprint) {
    if (!fingerprint || typeof fingerprint !== "object") return null;
    return {
      tag: cleanText(fingerprint.tag, 30) || null,
      id: cleanText(fingerprint.id, 160) || null,
      className: cleanText(fingerprint.className, 300) || null,
      alt: cleanText(fingerprint.alt, 300) || null,
      title: cleanText(fingerprint.title, 300) || null,
      linkDomain: normalizeHostname2(fingerprint.linkDomain) || null,
      srcHost: normalizeHostname2(fingerprint.srcHost) || null,
      idTokens: normalizeTokens(fingerprint.idTokens),
      classTokens: normalizeTokens(fingerprint.classTokens)
    };
  }
  function normalizeTrustedPaths(paths) {
    if (!Array.isArray(paths)) return [];
    const byKey = /* @__PURE__ */ new Map();
    for (const raw of paths.slice(0, 2e3)) {
      const source = normalizeHostname2(raw?.source);
      const target = normalizeHostname2(raw?.target);
      if (!source || !target || source === target) continue;
      byKey.set(`${source}>${target}`, {
        source,
        target,
        visits: Math.max(0, Math.min(999999, Number(raw.visits) || 0)),
        isManual: raw.isManual === true,
        lastUpdated: Number(raw.lastUpdated) || Date.now()
      });
    }
    return [...byKey.values()];
  }
  function normalizeHostname2(value) {
    const raw = String(value || "").trim().replace(/^\|\|/, "").replace(/\^$/, "");
    if (!raw) return "";
    try {
      const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
      const hostname = parsed.hostname.toLowerCase();
      return /^[a-z0-9.-]+$/.test(hostname) ? hostname.slice(0, 253) : "";
    } catch {
      return "";
    }
  }
  function isSafeSelector(selector) {
    if (!selector || selector.length > MAX_SELECTOR_LENGTH) return false;
    const normalized = selector.toLowerCase().trim();
    if (DANGEROUS_SELECTORS.has(normalized)) return false;
    if (normalized.includes(":has(")) return false;
    try {
      if (typeof document !== "undefined") document.querySelector(selector);
      return true;
    } catch {
      return false;
    }
  }
  function dedupeRules(rules) {
    const seen = /* @__PURE__ */ new Set();
    return rules.filter((rule) => {
      const selector = typeof rule === "string" ? rule : rule.selector;
      if (seen.has(selector)) return false;
      seen.add(selector);
      return true;
    });
  }
  function normalizeTokens(values) {
    if (!Array.isArray(values)) return [];
    return [
      ...new Set(
        values.map((value) => cleanText(value, 80).toLowerCase()).filter(Boolean)
      )
    ].slice(0, 40);
  }
  function cleanText(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
  }
  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  // src/background/settings-package-seed.js
  async function initializeBundledSettingsPackage(storage = chrome.storage.local, fetchPackage = loadBundledSettingsPackage) {
    const snapshot = await storage.get(null);
    if (snapshot[SETTINGS_PACKAGE_STATE_KEY]?.initialized) {
      return { status: "already_initialized" };
    }
    if (hasMeaningfulExistingSettings(snapshot)) {
      await storage.set({
        [SETTINGS_PACKAGE_STATE_KEY]: {
          schema_version: "adsfriendly.settings-package-state.v1",
          initialized: true,
          source: "existing_settings",
          package: null,
          installed_at: Date.now()
        }
      });
      return { status: "preserved_existing_settings" };
    }
    const settingsPackage = await fetchPackage();
    await replaceSettingsWithPackage(settingsPackage, storage, "bundled");
    return { status: "installed_bundled_package" };
  }
  async function loadBundledSettingsPackage() {
    const response = await fetch(
      chrome.runtime.getURL(BUNDLED_SETTINGS_PACKAGE_PATH)
    );
    if (!response.ok) {
      throw new Error(`Could not load bundled settings (${response.status}).`);
    }
    return normalizeSettingsPackage(await response.json());
  }

  // src/runtime/main-controller.js
  function createMainController({
    context,
    implementations,
    initialSettings = null,
    watchSettings = true,
    settingsLoader = loadSettings,
    settingsSubscriber = subscribeSettings,
    logger = console
  }) {
    const catalogFeatures = getFeaturesForContext(context);
    validateImplementations(context, catalogFeatures, implementations);
    let settings = normalizeSettings(initialSettings || DEFAULT_SETTINGS);
    let unsubscribe = null;
    let started = false;
    const lifecycles = /* @__PURE__ */ new Map();
    const listeners = /* @__PURE__ */ new Set();
    const controller2 = {
      context,
      async start() {
        if (started) return controller2;
        started = true;
        if (!initialSettings) settings = await settingsLoader();
        await reconcile();
        if (watchSettings) {
          unsubscribe = settingsSubscriber((nextSettings) => {
            controller2.updateSettings(nextSettings).catch(
              (error) => logger.error(
                `[MainController:${context}] reconcile failed`,
                error
              )
            );
          });
        }
        notify();
        return controller2;
      },
      async updateSettings(nextSettings) {
        settings = normalizeSettings(nextSettings);
        if (started) await reconcile();
        notify();
        return controller2.snapshot();
      },
      snapshot() {
        return {
          context,
          settings: {
            ...settings,
            featureOverrides: { ...settings.featureOverrides }
          },
          activeFeatures: [...lifecycles.entries()].filter(([, lifecycle]) => lifecycle.active).map(([featureId]) => featureId)
        };
      },
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async stop() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        for (const [featureId, lifecycle] of lifecycles) {
          await stopLifecycle(featureId, lifecycle);
        }
        lifecycles.clear();
        started = false;
      }
    };
    async function reconcile() {
      validateFeatureOverrides(settings.featureOverrides);
      for (const definition of catalogFeatures) {
        const desired = shouldStartFeature(definition, settings);
        const lifecycle = lifecycles.get(definition.id);
        if (desired && !lifecycle?.active) {
          const policy = createFeaturePolicy(definition, () => settings);
          if (lifecycle?.started && !lifecycle.cleanup) {
            lifecycle.active = true;
            continue;
          }
          const result = implementations[definition.id]({
            controller: controller2,
            feature: definition,
            policy
          });
          const cleanup = isPromiseLike(result) ? await result : result;
          lifecycles.set(definition.id, {
            active: true,
            started: true,
            cleanup: typeof cleanup === "function" ? cleanup : null
          });
        } else if (!desired && lifecycle?.active) {
          if (lifecycle.cleanup) {
            await stopLifecycle(definition.id, lifecycle);
            lifecycles.delete(definition.id);
          } else {
            lifecycle.active = false;
          }
        }
      }
    }
    async function stopLifecycle(featureId, lifecycle) {
      if (!lifecycle.cleanup) {
        lifecycle.active = false;
        return;
      }
      try {
        await lifecycle.cleanup();
      } catch (error) {
        logger.error(
          `[MainController:${context}] failed to stop ${featureId}`,
          error
        );
      }
      lifecycle.active = false;
    }
    function notify() {
      const snapshot = controller2.snapshot();
      for (const listener of listeners) listener(snapshot);
    }
    return controller2;
  }
  function createFeaturePolicy(definitionOrId, readSettings) {
    const definition = typeof definitionOrId === "string" ? getFeatureDefinition(definitionOrId) : definitionOrId;
    const declared = new Set(definition.capabilities);
    function assertAllowed(capability) {
      assertRegisteredCapability(capability);
      if (!declared.has(capability)) {
        throw new Error(
          `[FeatureRegistry] Feature "${definition.id}" tried to use undeclared capability "${capability}". Add it to that feature in feature-catalog.js.`
        );
      }
    }
    return Object.freeze({
      featureId: definition.id,
      can(capability) {
        assertAllowed(capability);
        const settings = readSettings();
        if (!settings.enabled)
          return [
            CAPABILITIES.CORE_MESSAGING,
            CAPABILITIES.CORE_MAINTENANCE
          ].includes(capability);
        return getCapabilitiesForMode(settings.protectionMode).includes(
          capability
        );
      },
      require(capability) {
        if (!this.can(capability)) {
          const settings = readSettings();
          throw new Error(
            `[FeatureRegistry] Capability "${capability}" is disabled for feature "${definition.id}" in mode "${settings.protectionMode}".`
          );
        }
        return true;
      }
    });
  }
  function shouldStartFeature(definition, settings) {
    const override = settings.featureOverrides?.[definition.id];
    if (override === false) return false;
    if ([CAPABILITIES.CORE_MESSAGING, CAPABILITIES.CORE_MAINTENANCE].includes(
      definition.startCapability
    ))
      return true;
    if (!settings.enabled) return false;
    return getCapabilitiesForMode(settings.protectionMode).includes(
      definition.startCapability
    );
  }
  function validateFeatureOverrides(featureOverrides = {}) {
    for (const featureId of Object.keys(featureOverrides)) {
      getFeatureDefinition(featureId);
    }
  }
  function isPromiseLike(value) {
    return value && typeof value.then === "function";
  }
  function validateImplementations(context, catalogFeatures, implementations) {
    const expected = new Set(catalogFeatures.map((feature2) => feature2.id));
    for (const featureId of Object.keys(implementations)) {
      const definition = getFeatureDefinition(featureId);
      if (definition.context !== context) {
        throw new Error(
          `[FeatureRegistry] Feature "${featureId}" belongs to context "${definition.context}", not "${context}".`
        );
      }
    }
    for (const featureId of expected) {
      if (typeof implementations[featureId] !== "function") {
        throw new Error(
          `[FeatureRegistry] Feature "${featureId}" is registered for context "${context}" but has no implementation in its main feature list.`
        );
      }
    }
  }

  // src/background/index.js
  var controller = createMainController({
    context: "background",
    initialSettings: DEFAULT_SETTINGS,
    implementations: {
      "background.message-router": ({ policy }) => registerMessageRouter(policy),
      "background.navigation-guard": ({ policy }) => registerNavigationGuard(policy),
      "background.telemetry-flush": () => startTelemetryFlush(),
      "background.memory-cleanup": () => {
        chrome.runtime.onStartup.addListener(cleanupStaleMemory);
        cleanupStaleMemory();
        return () => chrome.runtime.onStartup.removeListener(cleanupStaleMemory);
      },
      "background.pattern-seed": () => {
        chrome.runtime.onInstalled.addListener(seedBaselinePatterns);
        seedBaselinePatterns();
        return () => chrome.runtime.onInstalled.removeListener(seedBaselinePatterns);
      },
      "background.settings-package-seed": () => initializeBundledSettingsPackage(),
      "background.training-store-migration": () => migrateLegacyTrainingStorage()
    }
  });
  controller.start().then(() => loadSettings()).then((settings) => controller.updateSettings(settings)).catch(
    (error) => console.error("[AdsFriendly Background] MainController failed", error)
  );
})();
