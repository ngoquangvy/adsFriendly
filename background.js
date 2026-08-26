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
      saveDomainDecision(action2, domain) {
        return serial(async () => {
          const hostname = normalizeHostname(domain);
          if (!hostname) throw new Error("Invalid domain decision.");
          const { whitelist = [], blacklist = [] } = await storage.get([
            "whitelist",
            "blacklist"
          ]);
          let nextWhitelist = [...whitelist];
          let nextBlacklist = [...blacklist];
          if (action2 === "WHITELIST") {
            nextWhitelist = [.../* @__PURE__ */ new Set([...nextWhitelist, hostname])];
            nextBlacklist = nextBlacklist.filter(
              (entry) => normalizeHostname(entry) !== hostname
            );
          } else if (action2 === "BLACKLIST") {
            nextBlacklist = [.../* @__PURE__ */ new Set([...nextBlacklist, `||${hostname}^`])];
            nextWhitelist = nextWhitelist.filter(
              (entry) => normalizeHostname(entry) !== hostname
            );
          } else {
            throw new Error(`Unsupported domain action: ${String(action2)}`);
          }
          await setAndVerify(storage, {
            whitelist: nextWhitelist,
            blacklist: nextBlacklist
          });
          return { status: "saved", action: action2, domain: hostname };
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

  // src/navigation/shared/search-navigation.js
  var GOOGLE_HOST_RE = /^(.+\.)?google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/i;
  var EMBEDDED_HOST_RE = /(?:^|\s)(?:https?:\/\/)?(?:www\.)?([a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+)(?:\b|\/)/i;
  var PREFILLED_SEARCH_TRUST_TARGET = "google.com";
  function getPrefilledSearchNavigation(value) {
    let url;
    try {
      url = value instanceof URL ? value : new URL(value);
    } catch {
      return null;
    }
    const query = url.searchParams.get("q")?.trim() || "";
    if (!GOOGLE_HOST_RE.test(url.hostname) || url.pathname !== "/search" || !query)
      return null;
    const embeddedHost = EMBEDDED_HOST_RE.exec(query)?.[1]?.toLowerCase() || null;
    return {
      searchHost: url.hostname.toLowerCase(),
      embeddedHost
    };
  }
  function resolveNavigationDecisionTarget({ action: action2, domain, url } = {}) {
    const search = getPrefilledSearchNavigation(url);
    if (!search) return { scope: "domain", domain };
    if (action2 === "BLACKLIST" && search.embeddedHost) {
      return { scope: "embedded_domain", domain: search.embeddedHost };
    }
    return { scope: "navigation_only", domain: null };
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
  async function removeTrustedPath(source, target) {
    if (!source || !target || source === target) return false;
    const key = `p:${source}>${target}`;
    await chrome.storage.local.remove(key);
    return true;
  }
  async function handleUserDecision(message) {
    const { action: action2 } = message;
    if (!["WHITELIST", "BLACKLIST"].includes(action2)) return;
    const decision = resolveNavigationDecisionTarget(message);
    if (decision.scope === "navigation_only") {
      return { status: "navigation_only", action: action2 };
    }
    return getSettingsMutationStore().saveDomainDecision(action2, decision.domain);
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
  async function enqueueTelemetryEvent(event2) {
    return putCapped(
      TELEMETRY_STORE,
      ensureIdentity(event2),
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
    for (const event2 of telemetryEvents.slice(-MAX_TELEMETRY_EVENTS))
      await enqueueTelemetryEvent(event2);
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
    const event2 = await buildEvent(raw);
    await enqueueTelemetryEvent(event2);
    flushTelemetry();
    return event2;
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
      await deleteTelemetryEvents(batch.map((event2) => event2.sample_id));
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

  // src/runtime/ecosystem-catalog.js
  var PRODUCT_IDS = Object.freeze({
    AD_PROTECTION: "ad-protection",
    MEDIA_TOOLS: "media-tools"
  });
  var COMPONENT_IDS = Object.freeze({
    BROWSER_EXTENSION: "browser-extension",
    MEDIA_HELPER: "media-helper"
  });
  var P = PRODUCT_IDS;
  var C = COMPONENT_IDS;
  var PRODUCT_CATALOG = Object.freeze({
    [P.AD_PROTECTION]: product(P.AD_PROTECTION, {
      name: "AdsFriendly Protection",
      requiredComponents: [C.BROWSER_EXTENSION],
      optionalComponents: []
    }),
    [P.MEDIA_TOOLS]: product(P.MEDIA_TOOLS, {
      name: "AdsFriendly Media Tools",
      requiredComponents: [C.BROWSER_EXTENSION],
      optionalComponents: [C.MEDIA_HELPER]
    })
  });
  validateProductCatalog();
  function getProductDefinition(productId) {
    const definition = PRODUCT_CATALOG[productId];
    if (!definition) {
      throw new Error(
        `[EcosystemRegistry] Unknown product "${productId}". Register it in ecosystem-catalog.js before use.`
      );
    }
    return definition;
  }
  function assertRegisteredProduct(productId) {
    getProductDefinition(productId);
    return productId;
  }
  function assertRegisteredComponent(componentId) {
    if (!Object.values(COMPONENT_IDS).includes(componentId)) {
      throw new Error(
        `[EcosystemRegistry] Unknown component "${componentId}". Register it in ecosystem-catalog.js before use.`
      );
    }
    return componentId;
  }
  function product(id, { name, requiredComponents = [], optionalComponents = [] }) {
    return Object.freeze({
      id,
      name,
      requiredComponents: Object.freeze([...requiredComponents]),
      optionalComponents: Object.freeze([...optionalComponents])
    });
  }
  function validateProductCatalog() {
    const productIds = Object.values(PRODUCT_IDS);
    if (new Set(productIds).size !== productIds.length) {
      throw new Error("[EcosystemRegistry] Duplicate product ID.");
    }
    for (const productId of productIds) {
      const definition = PRODUCT_CATALOG[productId];
      if (!definition || definition.id !== productId) {
        throw new Error(
          `[EcosystemRegistry] Product "${productId}" has no metadata definition.`
        );
      }
      const components = [
        ...definition.requiredComponents,
        ...definition.optionalComponents
      ];
      if (new Set(components).size !== components.length) {
        throw new Error(
          `[EcosystemRegistry] Product "${productId}" declares a component more than once.`
        );
      }
      for (const componentId of components) {
        assertRegisteredComponent(componentId);
      }
    }
  }

  // src/runtime/feature-catalog.js
  var PROTECTION_MODES = Object.freeze({
    SAFE: "safe",
    ASSIST: "assist",
    AUTO: "auto"
  });
  var CAPABILITY_TRIGGERS = Object.freeze({
    CORE: "core",
    PASSIVE: "passive",
    USER: "user",
    SUGGESTION: "suggestion",
    AUTOMATIC: "automatic",
    STORAGE: "storage"
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
    MEDIA_NETWORK_OBSERVE: "media.network_observe",
    MEDIA_CATALOG: "media.catalog",
    MEDIA_DOWNLOAD: "media.download",
    MEDIA_NATIVE_DOWNLOAD: "media.native_download",
    VIDEO_OBSERVE: "video.observe",
    VIDEO_RESTORE_STATE: "video.restore_state",
    VIDEO_USER_ACTION: "video.user_action",
    VIDEO_AUTO_ACTION: "video.auto_action"
  });
  var C2 = CAPABILITIES;
  var T = CAPABILITY_TRIGGERS;
  var P2 = PRODUCT_IDS;
  var R = COMPONENT_IDS;
  var MODE_RANK = Object.freeze({
    [PROTECTION_MODES.SAFE]: 0,
    [PROTECTION_MODES.ASSIST]: 1,
    [PROTECTION_MODES.AUTO]: 2
  });
  var CAPABILITY_CATALOG = Object.freeze({
    [C2.CORE_MESSAGING]: capability(C2.CORE_MESSAGING, "safe", T.CORE, {
      availableWhenDisabled: true,
      productIds: [P2.AD_PROTECTION, P2.MEDIA_TOOLS]
    }),
    [C2.CORE_MAINTENANCE]: capability(C2.CORE_MAINTENANCE, "safe", T.CORE, {
      availableWhenDisabled: true,
      productIds: [P2.AD_PROTECTION, P2.MEDIA_TOOLS]
    }),
    [C2.NAVIGATION_GUARD]: capability(C2.NAVIGATION_GUARD, "safe", T.AUTOMATIC, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.NAVIGATION_REVERSE_POPUNDER]: capability(
      C2.NAVIGATION_REVERSE_POPUNDER,
      "safe",
      T.AUTOMATIC,
      { productIds: [P2.AD_PROTECTION] }
    ),
    [C2.NAVIGATION_INTENT]: capability(C2.NAVIGATION_INTENT, "safe", T.PASSIVE, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.NAVIGATION_FEEDBACK]: capability(C2.NAVIGATION_FEEDBACK, "safe", T.USER, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.DOM_STATIC_RULES]: capability(C2.DOM_STATIC_RULES, "safe", T.AUTOMATIC, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.DOM_OBSERVE]: capability(C2.DOM_OBSERVE, "assist", T.PASSIVE, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.DOM_SUGGEST]: capability(C2.DOM_SUGGEST, "assist", T.SUGGESTION, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.DOM_AUTO_HIDE]: capability(C2.DOM_AUTO_HIDE, "auto", T.AUTOMATIC, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.DOM_MANUAL_PICKER]: capability(C2.DOM_MANUAL_PICKER, "safe", T.USER, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.LEARNING_SEED]: capability(C2.LEARNING_SEED, "safe", T.STORAGE, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.LEARNING_FEEDBACK]: capability(C2.LEARNING_FEEDBACK, "safe", T.USER, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.LEARNING_APPLY]: capability(C2.LEARNING_APPLY, "auto", T.AUTOMATIC, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.TELEMETRY_QUEUE]: capability(C2.TELEMETRY_QUEUE, "safe", T.STORAGE, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.MEDIA_OBSERVE]: capability(C2.MEDIA_OBSERVE, "assist", T.PASSIVE, {
      productIds: [P2.AD_PROTECTION, P2.MEDIA_TOOLS]
    }),
    [C2.MEDIA_NETWORK_OBSERVE]: capability(
      C2.MEDIA_NETWORK_OBSERVE,
      "assist",
      T.PASSIVE,
      {
        browserPermissions: ["webRequest"],
        productIds: [P2.AD_PROTECTION, P2.MEDIA_TOOLS]
      }
    ),
    [C2.MEDIA_CATALOG]: capability(C2.MEDIA_CATALOG, "assist", T.PASSIVE, {
      productIds: [P2.AD_PROTECTION, P2.MEDIA_TOOLS]
    }),
    [C2.MEDIA_DOWNLOAD]: capability(C2.MEDIA_DOWNLOAD, "assist", T.USER, {
      browserPermissions: ["storage", "tabs"],
      productIds: [P2.MEDIA_TOOLS]
    }),
    [C2.MEDIA_NATIVE_DOWNLOAD]: capability(
      C2.MEDIA_NATIVE_DOWNLOAD,
      "assist",
      T.USER,
      {
        browserPermissions: ["nativeMessaging"],
        productIds: [P2.MEDIA_TOOLS],
        requiredComponents: [R.BROWSER_EXTENSION, R.MEDIA_HELPER]
      }
    ),
    [C2.VIDEO_OBSERVE]: capability(C2.VIDEO_OBSERVE, "assist", T.PASSIVE, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.VIDEO_RESTORE_STATE]: capability(C2.VIDEO_RESTORE_STATE, "safe", T.CORE, {
      availableWhenDisabled: true,
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.VIDEO_USER_ACTION]: capability(C2.VIDEO_USER_ACTION, "assist", T.USER, {
      productIds: [P2.AD_PROTECTION]
    }),
    [C2.VIDEO_AUTO_ACTION]: capability(C2.VIDEO_AUTO_ACTION, "auto", T.AUTOMATIC, {
      productIds: [P2.AD_PROTECTION]
    })
  });
  var FEATURE_CATALOG = Object.freeze([
    feature("background.message-router", "background", C2.CORE_MESSAGING, [
      C2.CORE_MAINTENANCE,
      C2.NAVIGATION_INTENT,
      C2.NAVIGATION_FEEDBACK,
      C2.LEARNING_FEEDBACK,
      C2.TELEMETRY_QUEUE,
      C2.MEDIA_CATALOG,
      C2.MEDIA_DOWNLOAD
    ]),
    feature("background.media-catalog", "background", C2.MEDIA_CATALOG),
    feature("background.media-debug-capture", "background", C2.MEDIA_CATALOG),
    feature("background.media-manifest-handoff", "background", C2.MEDIA_CATALOG),
    feature(
      "background.media-request-observer",
      "background",
      C2.MEDIA_NETWORK_OBSERVE,
      [C2.MEDIA_CATALOG]
    ),
    feature("background.media-download-jobs", "background", C2.MEDIA_DOWNLOAD, [
      C2.MEDIA_NATIVE_DOWNLOAD
    ]),
    feature("background.navigation-guard", "background", C2.NAVIGATION_GUARD, [
      C2.NAVIGATION_REVERSE_POPUNDER,
      C2.NAVIGATION_FEEDBACK,
      C2.TELEMETRY_QUEUE
    ]),
    feature("background.telemetry-flush", "background", C2.TELEMETRY_QUEUE),
    feature("background.memory-cleanup", "background", C2.CORE_MAINTENANCE),
    feature("background.pattern-seed", "background", C2.LEARNING_SEED),
    feature(
      "background.training-store-migration",
      "background",
      C2.CORE_MAINTENANCE
    ),
    feature("background.settings-package-seed", "background", C2.CORE_MAINTENANCE),
    feature("content.media-observer", "content", C2.MEDIA_OBSERVE, [
      C2.MEDIA_CATALOG
    ]),
    feature("content.youtube-cleaner", "content", C2.DOM_STATIC_RULES),
    feature("content.navigation-intent", "content", C2.NAVIGATION_INTENT),
    feature("content.navigation-toast", "content", C2.NAVIGATION_FEEDBACK),
    feature("content.dom-static-blocker", "content", C2.DOM_STATIC_RULES, [
      C2.LEARNING_FEEDBACK,
      C2.TELEMETRY_QUEUE
    ]),
    feature("content.dom-candidate-collector", "content", C2.DOM_OBSERVE, [
      C2.DOM_SUGGEST,
      C2.DOM_AUTO_HIDE,
      C2.LEARNING_FEEDBACK
    ]),
    feature("content.dom-learned-blocker", "content", C2.LEARNING_APPLY, [
      C2.DOM_AUTO_HIDE
    ]),
    feature("media-frame.observer", "media-frame", C2.MEDIA_OBSERVE, [
      C2.MEDIA_CATALOG
    ]),
    feature("media-frame.navigation-intent", "media-frame", C2.NAVIGATION_INTENT),
    feature("video.surgeon", "video", C2.VIDEO_OBSERVE, [
      C2.VIDEO_RESTORE_STATE,
      C2.VIDEO_USER_ACTION,
      C2.VIDEO_AUTO_ACTION
    ]),
    feature("picker.controller", "picker", C2.DOM_MANUAL_PICKER, [
      C2.LEARNING_FEEDBACK
    ]),
    feature("main-world.network-capture", "main-world", C2.CORE_MESSAGING, [
      C2.MEDIA_OBSERVE
    ]),
    feature("main-world.player-source-observer", "main-world", C2.CORE_MESSAGING, [
      C2.MEDIA_OBSERVE
    ]),
    feature(
      "main-world.decrypted-manifest-observer",
      "main-world",
      C2.CORE_MESSAGING,
      [C2.MEDIA_OBSERVE]
    ),
    feature("main-world.blob-source-tracer", "main-world", C2.CORE_MESSAGING, [
      C2.MEDIA_OBSERVE
    ]),
    feature("main-world.eme-observer", "main-world", C2.MEDIA_OBSERVE),
    feature("main-world.timer-control", "main-world", C2.VIDEO_AUTO_ACTION)
  ]);
  var CAPABILITY_SET = new Set(Object.values(CAPABILITIES));
  var FEATURE_BY_ID = new Map(FEATURE_CATALOG.map((item) => [item.id, item]));
  validateCatalog();
  var MODE_CAPABILITIES = Object.freeze(
    Object.fromEntries(
      Object.values(PROTECTION_MODES).map((mode) => [
        mode,
        Object.freeze(resolveCapabilitiesForMode(mode))
      ])
    )
  );
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
  function getCapabilityDefinition(capabilityId) {
    assertRegisteredCapability(capabilityId);
    return CAPABILITY_CATALOG[capabilityId];
  }
  function assertRegisteredCapability(capabilityId) {
    if (!CAPABILITY_SET.has(capabilityId) || !CAPABILITY_CATALOG[capabilityId]) {
      throw new Error(
        `[FeatureRegistry] Unknown capability "${capabilityId}". Register it in feature-catalog.js before use.`
      );
    }
    return capabilityId;
  }
  function isCapabilityEnabled(capabilityId, settings = {}) {
    const definition = getCapabilityDefinition(capabilityId);
    const mode = settings.protectionMode || PROTECTION_MODES.SAFE;
    assertProtectionMode(mode);
    if (settings.enabled === false) return definition.availableWhenDisabled;
    return MODE_RANK[mode] >= MODE_RANK[definition.minMode];
  }
  function capability(id, minMode, trigger, {
    availableWhenDisabled = false,
    browserPermissions = [],
    productIds = [P2.AD_PROTECTION, P2.MEDIA_TOOLS],
    requiredComponents = [R.BROWSER_EXTENSION]
  } = {}) {
    return Object.freeze({
      id,
      minMode,
      trigger,
      availableWhenDisabled,
      browserPermissions: Object.freeze([...browserPermissions]),
      productIds: Object.freeze([...productIds]),
      requiredComponents: Object.freeze([...requiredComponents])
    });
  }
  function feature(id, context, startCapability, extraCapabilities = []) {
    return Object.freeze({
      id,
      context,
      startCapability,
      capabilities: Object.freeze([startCapability, ...extraCapabilities])
    });
  }
  function resolveCapabilitiesForMode(mode) {
    assertProtectionMode(mode);
    return Object.values(CAPABILITY_CATALOG).filter((definition) => MODE_RANK[mode] >= MODE_RANK[definition.minMode]).map((definition) => definition.id);
  }
  function assertProtectionMode(mode) {
    if (!(mode in MODE_RANK)) {
      throw new Error(`[FeatureRegistry] Unknown protection mode "${mode}".`);
    }
  }
  function validateCatalog() {
    const capabilityIds = Object.values(CAPABILITIES);
    if (new Set(capabilityIds).size !== capabilityIds.length) {
      throw new Error("[FeatureRegistry] Duplicate capability ID.");
    }
    for (const capabilityId of capabilityIds) {
      const definition = CAPABILITY_CATALOG[capabilityId];
      if (!definition || definition.id !== capabilityId) {
        throw new Error(
          `[FeatureRegistry] Capability "${capabilityId}" has no metadata definition.`
        );
      }
      assertProtectionMode(definition.minMode);
      if (!Object.values(CAPABILITY_TRIGGERS).includes(definition.trigger)) {
        throw new Error(
          `[FeatureRegistry] Capability "${capabilityId}" has unknown trigger "${definition.trigger}".`
        );
      }
      if (!definition.productIds.length) {
        throw new Error(
          `[FeatureRegistry] Capability "${capabilityId}" must belong to at least one product.`
        );
      }
      for (const productId of definition.productIds) {
        assertRegisteredProduct(productId);
      }
      if (!definition.requiredComponents.length) {
        throw new Error(
          `[FeatureRegistry] Capability "${capabilityId}" must require at least one component.`
        );
      }
      for (const componentId of definition.requiredComponents) {
        assertRegisteredComponent(componentId);
      }
    }
    const ids = /* @__PURE__ */ new Set();
    for (const definition of FEATURE_CATALOG) {
      if (ids.has(definition.id)) {
        throw new Error(
          `[FeatureRegistry] Duplicate feature "${definition.id}".`
        );
      }
      ids.add(definition.id);
      if (new Set(definition.capabilities).size !== definition.capabilities.length) {
        throw new Error(
          `[FeatureRegistry] Feature "${definition.id}" declares a capability more than once.`
        );
      }
      for (const capabilityId of definition.capabilities) {
        assertRegisteredCapability(capabilityId);
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
    promotionalIntent = false,
    targetLikelyAd = false
  } = {}) {
    if (blacklisted) return NEW_TAB_DECISIONS.CLOSE;
    if (sameSite || trustedInitiator || trustedTarget && !promotionalIntent && !targetLikelyAd || whitelisted || !promotionalIntent && !targetLikelyAd && trustedPath)
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
    const strongPrefilledSearch = reasons.has("prefilled_search_navigation");
    const corroboratingSignal = reasons.has("multiple_campaign_parameters") || reasons.has("promotional_element_or_destination");
    if (strongPrefilledSearch || strongTracking && corroboratingSignal) {
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
  function isReversePopunderReviewSequence({
    originalUrl,
    cloneUrl,
    redirectedUrl,
    elapsedMs
  }) {
    if (elapsedMs < 0 || elapsedMs > REVERSE_POPUNDER_WINDOW_MS) return false;
    const original = parseUrl(originalUrl);
    const clone = parseUrl(cloneUrl);
    const redirected = parseUrl(redirectedUrl);
    if (![original, clone, redirected].every(isHttpUrl)) return false;
    const cloneStayedOnSource = sameHostnameOrSubdomain(original.hostname, clone.hostname) || sameHostnameOrSubdomain(clone.hostname, original.hostname);
    const sourceWasReplaced = !(sameHostnameOrSubdomain(original.hostname, redirected.hostname) || sameHostnameOrSubdomain(redirected.hostname, original.hostname));
    return cloneStayedOnSource && sourceWasReplaced;
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
  var PROMOTIONAL_SEARCH_DESTINATION_RE = /(?:^|\s)(?:https?:\/\/)?(?:www\.)?[a-z0-9-]{4,}\.(?:bet|casino|click|live|top|vip|win|xyz)(?:\b|\/)/i;
  var STRONG_CAMPAIGN_VALUE_RE = /(^|[^a-z0-9])(?:popunder|popup|interstitial)([^a-z0-9]|$)/i;
  var AD_NETWORK_VALUE_RE = /(^|[^a-z0-9])(?:clickadu|popads|propellerads|adsterra)([^a-z0-9]|$)/i;
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
    const campaignValues = [...intent.searchParams.entries()].filter(([key]) => key.toLowerCase().startsWith("utm_")).map(([, value]) => value);
    const strongCampaignValue = campaignValues.some(
      (value) => STRONG_CAMPAIGN_VALUE_RE.test(value)
    );
    const adNetworkValue = campaignValues.some(
      (value) => AD_NETWORK_VALUE_RE.test(value)
    );
    const strongTracking = keys.some((key) => STRONG_TRACKING_KEYS.has(key)) || strongCampaignValue;
    const marketingCount = keys.filter((key) => key.startsWith("utm_")).length;
    const tokenEvidence = `${intent.hostname} ${intent.pathname} ${evidence}`;
    const promotionalToken = PROMOTIONAL_TOKEN_RE.test(tokenEvidence);
    const searchNavigation = getPrefilledSearchNavigation(intent);
    const prefilledSearchNavigation = Boolean(searchNavigation);
    const promotionalSearchDestination = Boolean(
      searchNavigation?.embeddedHost && PROMOTIONAL_SEARCH_DESTINATION_RE.test(searchNavigation.embeddedHost)
    );
    const reasons = [];
    if (strongTracking) reasons.push("strong_tracking_parameter");
    if (marketingCount >= 2) reasons.push("multiple_campaign_parameters");
    if (promotionalToken || adNetworkValue)
      reasons.push("promotional_element_or_destination");
    if (prefilledSearchNavigation) reasons.push("prefilled_search_navigation");
    if (promotionalSearchDestination)
      reasons.push("promotional_search_destination");
    return {
      likelyAd: reasons.length > 0,
      reasons
    };
  }

  // src/navigation/background/navigation-sequences.js
  var NAVIGATION_SEQUENCES = Object.freeze({
    OPENED_TAB_IS_TARGET: "opened_tab_is_target",
    ORIGINAL_TAB_WAS_REDIRECTED: "original_tab_was_redirected"
  });
  var SEQUENCE_PLANS = Object.freeze({
    [NAVIGATION_SEQUENCES.OPENED_TAB_IS_TARGET]: ({
      originalTabId,
      openedTabId
    }) => ({
      closeTabId: openedTabId,
      restoreTabId: null,
      survivingTabId: originalTabId,
      notifyTabId: originalTabId
    }),
    [NAVIGATION_SEQUENCES.ORIGINAL_TAB_WAS_REDIRECTED]: ({
      originalTabId,
      openedTabId,
      restoreOriginal = false
    }) => restoreOriginal ? {
      closeTabId: null,
      restoreTabId: originalTabId,
      survivingTabId: originalTabId,
      notifyTabId: originalTabId
    } : {
      closeTabId: originalTabId,
      restoreTabId: null,
      survivingTabId: openedTabId,
      notifyTabId: openedTabId
    }
  });
  function createNavigationEnforcementPlan({
    sequence,
    originalTabId,
    openedTabId,
    restoreOriginal = false
  }) {
    const buildPlan = SEQUENCE_PLANS[sequence];
    if (!buildPlan) {
      throw new Error(
        `Unknown navigation sequence: ${sequence}. Register it before use.`
      );
    }
    if (!Number.isInteger(originalTabId) || !Number.isInteger(openedTabId)) {
      throw new TypeError("Navigation enforcement requires two valid tab IDs.");
    }
    const plan = Object.freeze(
      buildPlan({ originalTabId, openedTabId, restoreOriginal })
    );
    if (plan.notifyTabId !== plan.survivingTabId) {
      throw new Error("Navigation toast must target the surviving tab.");
    }
    if (plan.closeTabId === plan.notifyTabId) {
      throw new Error("Navigation toast cannot target the tab being closed.");
    }
    return plan;
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
  var evaluatingTabs = /* @__PURE__ */ new Set();
  var reverseCandidatesBySource = /* @__PURE__ */ new Map();
  var reverseCandidatesByClone = /* @__PURE__ */ new Map();
  var committedUrlsByTab = /* @__PURE__ */ new Map();
  var pendingReviewToasts = /* @__PURE__ */ new Map();
  var blockedNoticesBySource = /* @__PURE__ */ new Map();
  var userOpenedNavigations = /* @__PURE__ */ new Map();
  var navigationPolicy = null;
  function registerNavigationGuard(policy) {
    navigationPolicy = policy;
    chrome.tabs.query({}).then((tabs) => {
      for (const tab of tabs) rememberCommittedUrl(tab.id, tab.url);
    }).catch(() => {
    });
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
    const registerPendingTab = (tab, sourceTabId, hasRealOpener) => {
      if (!Number.isInteger(tab?.id) || !Number.isInteger(sourceTabId)) return;
      rememberCommittedUrl(tab.id, tab.pendingUrl || tab.url);
      pendingTabs.set(tab.id, {
        sourceTabId,
        createdAt: Date.now(),
        hasRealOpener
      });
      trackReverseCandidate({
        sourceTabId,
        cloneTabId: tab.id,
        cloneUrl: tab.pendingUrl || tab.url
      }).catch(logReversePopunderError);
      setTimeout(
        () => pendingTabs.delete(tab.id),
        hasRealOpener ? 1e4 : REVERSE_POPUNDER_WINDOW_MS + 500
      );
      const initialUrl = tab.pendingUrl || tab.url;
      if (initialUrl && !isBlankUrl(initialUrl)) {
        evaluateNewTab({ sourceTabId, tabId: tab.id, url: initialUrl });
      }
    };
    const onCreated = (tab) => {
      rememberCommittedUrl(tab.id, tab.pendingUrl || tab.url);
      const sourceTabId = tab.openerTabId || getRecentUserGestureSourceTabId(2500);
      if (sourceTabId) {
        registerPendingTab(tab, sourceTabId, !!tab.openerTabId);
        return;
      }
      if (!Number.isInteger(tab.id)) return;
      setTimeout(async () => {
        if (!navigationPolicy || pendingTabs.has(tab.id) || handledTabs.has(tab.id))
          return;
        const delayedSourceTabId = getRecentUserGestureSourceTabId(2500);
        if (!delayedSourceTabId) return;
        try {
          const currentTab = await chrome.tabs.get(tab.id);
          registerPendingTab(currentTab, delayedSourceTabId, false);
        } catch {
        }
      }, 300);
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
      rememberCommittedUrl(details.tabId, details.url);
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
    const onRemoved = (tabId) => {
      committedUrlsByTab.delete(tabId);
      pendingReviewToasts.delete(tabId);
    };
    chrome.webNavigation.onCreatedNavigationTarget.addListener(
      onCreatedNavigationTarget
    );
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      chrome.webNavigation.onCreatedNavigationTarget.removeListener(
        onCreatedNavigationTarget
      );
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      pendingTabs.clear();
      evaluatingTabs.clear();
      reverseCandidatesBySource.clear();
      reverseCandidatesByClone.clear();
      committedUrlsByTab.clear();
      pendingReviewToasts.clear();
      blockedNoticesBySource.clear();
      userOpenedNavigations.clear();
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
        originalUrl: getRecentSourceUrl(sourceTabId) || committedUrlsByTab.get(sourceTabId),
        cloneUrl: null,
        redirectedUrl: null,
        createdAt: Date.now(),
        handling: false,
        reviewTimer: null
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
    })) {
      scheduleReverseRedirectReview(candidate);
      return;
    }
    candidate.handling = true;
    if (await isAllowedReverseRedirect(candidate)) {
      cleanupReverseCandidate(candidate);
      return;
    }
    const sourceHost = new URL(candidate.originalUrl).hostname;
    await logBlockedNavigationIfAllowed(candidate.redirectedUrl, sourceHost);
    let enforcementPlan = createNavigationEnforcementPlan({
      sequence: NAVIGATION_SEQUENCES.ORIGINAL_TAB_WAS_REDIRECTED,
      originalTabId: candidate.sourceTabId,
      openedTabId: candidate.cloneTabId
    });
    try {
      const cloneTab = await chrome.tabs.get(candidate.cloneTabId);
      if (!cloneTab?.url || !isSelfCloneNavigation(candidate.originalUrl, cloneTab.url))
        throw new Error("clone gone");
      await chrome.tabs.update(enforcementPlan.survivingTabId, { active: true });
      await chrome.tabs.remove(enforcementPlan.closeTabId);
    } catch {
      enforcementPlan = createNavigationEnforcementPlan({
        sequence: NAVIGATION_SEQUENCES.ORIGINAL_TAB_WAS_REDIRECTED,
        originalTabId: candidate.sourceTabId,
        openedTabId: candidate.cloneTabId,
        restoreOriginal: true
      });
      try {
        await chrome.tabs.update(enforcementPlan.restoreTabId, {
          url: candidate.originalUrl
        });
      } catch {
      }
    } finally {
      pendingTabs.delete(candidate.cloneTabId);
      handledTabs.set(candidate.sourceTabId, Date.now());
      await showBlockedNavigationToast({
        sourceTabId: enforcementPlan.notifyTabId,
        url: candidate.redirectedUrl,
        source: sourceHost,
        target: new URL(candidate.redirectedUrl).hostname
      });
      cleanupReverseCandidate(candidate);
    }
  }
  function scheduleReverseRedirectReview(candidate) {
    if (candidate.reviewTimer) return;
    const elapsedMs = Date.now() - candidate.createdAt;
    if (!isReversePopunderReviewSequence({
      originalUrl: candidate.originalUrl,
      cloneUrl: candidate.cloneUrl,
      redirectedUrl: candidate.redirectedUrl,
      elapsedMs
    }))
      return;
    candidate.reviewTimer = setTimeout(() => {
      candidate.reviewTimer = null;
      reviewReverseRedirect(candidate).catch(logReversePopunderError);
    }, 400);
  }
  async function reviewReverseRedirect(candidate) {
    if (candidate.handling || reverseCandidatesBySource.get(candidate.sourceTabId) !== candidate)
      return;
    const elapsedMs = Date.now() - candidate.createdAt;
    if (isReversePopunderSequence({
      originalUrl: candidate.originalUrl,
      cloneUrl: candidate.cloneUrl,
      redirectedUrl: candidate.redirectedUrl,
      elapsedMs
    })) {
      await maybeHandleReversePopunder(candidate);
      return;
    }
    if (!isReversePopunderReviewSequence({
      originalUrl: candidate.originalUrl,
      cloneUrl: candidate.cloneUrl,
      redirectedUrl: candidate.redirectedUrl,
      elapsedMs
    }))
      return;
    candidate.handling = true;
    const evaluation = await evaluateNavigationPolicy({
      sourceUrl: candidate.originalUrl,
      targetUrl: candidate.redirectedUrl,
      sourceTabId: candidate.sourceTabId,
      allowMatchingIntent: true,
      allowTrustedInitiator: false
    });
    if (evaluation.decision !== NEW_TAB_DECISIONS.ALLOW) {
      await showNavigationReviewToast({
        tabId: candidate.sourceTabId,
        url: candidate.redirectedUrl,
        source: evaluation.sourceUrl.hostname,
        target: evaluation.targetDomain
      });
    }
    cleanupReverseCandidate(candidate);
  }
  async function isAllowedReverseRedirect(candidate) {
    const evaluation = await evaluateNavigationPolicy({
      sourceUrl: candidate.originalUrl,
      targetUrl: candidate.redirectedUrl,
      sourceTabId: candidate.sourceTabId,
      allowMatchingIntent: true,
      allowTrustedInitiator: false
    });
    if (evaluation.allowedSearch) {
      await showAllowedSearchToast({
        tabId: candidate.sourceTabId,
        url: evaluation.targetUrl.href,
        source: evaluation.sourceUrl.hostname,
        target: evaluation.trustTarget
      });
    }
    return evaluation.decision === NEW_TAB_DECISIONS.ALLOW;
  }
  function getRecentSourceUrl(sourceTabId) {
    const click = runtimeState.lastTrustedClick;
    if (click.tabId === sourceTabId && click.sourceUrl?.startsWith("http") && Date.now() - click.timestamp < 2e3)
      return click.sourceUrl;
    return null;
  }
  function cleanupReverseCandidate(candidate) {
    if (candidate.reviewTimer) clearTimeout(candidate.reviewTimer);
    candidate.reviewTimer = null;
    if (reverseCandidatesBySource.get(candidate.sourceTabId) === candidate) {
      reverseCandidatesBySource.delete(candidate.sourceTabId);
    }
    if (reverseCandidatesByClone.get(candidate.cloneTabId) === candidate) {
      reverseCandidatesByClone.delete(candidate.cloneTabId);
    }
  }
  function rememberCommittedUrl(tabId, url) {
    if (Number.isInteger(tabId) && url?.startsWith("http")) {
      committedUrlsByTab.set(tabId, url);
    }
  }
  function logReversePopunderError(error) {
    console.error("Reverse pop-under guard failed:", error);
  }
  async function evaluateNavigationPolicy({
    sourceUrl: sourceValue,
    targetUrl: targetValue,
    sourceTabId,
    allowMatchingIntent = false,
    allowTrustedInitiator = true,
    waitForIntent = false
  }) {
    const sourceUrl = new URL(sourceValue);
    const targetUrl = new URL(targetValue);
    const targetDomain = targetUrl.hostname;
    const sameSite = sameHostnameOrSubdomain(sourceUrl.hostname, targetDomain) || sameHostnameOrSubdomain(targetDomain, sourceUrl.hostname);
    const targetClassification = classifyNavigationIntent({
      intentUrl: targetUrl.href,
      sourceUrl: sourceUrl.href
    });
    const prefilledSearch = targetClassification.reasons.includes(
      "prefilled_search_navigation"
    );
    const trustTarget = prefilledSearch ? PREFILLED_SEARCH_TRUST_TARGET : targetDomain;
    const [{ whitelist = [], blacklist = [] }, path, trustWindow] = await Promise.all([
      chrome.storage.local.get(["whitelist", "blacklist"]),
      getTrustedPath(sourceUrl.hostname, trustTarget),
      getDynamicTrustWindow(sourceUrl.hostname)
    ]);
    if (waitForIntent) await delay(180);
    const intentClassification = getRecentIntentClassification(
      sourceTabId,
      trustWindow
    );
    const promotionalIntent = intentClassification.likelyAd;
    const allowedSearch = prefilledSearch && path?.isManual === true;
    const matchingIntent = allowMatchingIntent && hasMatchingIntent(sourceTabId, targetDomain, trustWindow);
    const decision = allowedSearch ? NEW_TAB_DECISIONS.ALLOW : decideNewTabNavigation({
      sameSite,
      trustedInitiator: allowTrustedInitiator && isTrustedInitiator(sourceUrl.hostname),
      trustedTarget: isTrustedTarget(targetDomain),
      whitelisted: whitelist.includes(targetDomain),
      blacklisted: isBlacklistedTarget(targetDomain, blacklist),
      trustedPath: matchingIntent || !!path?.isManual || (path?.visits || 0) >= 3,
      promotionalIntent,
      targetLikelyAd: targetClassification.likelyAd
    });
    const reviewSurface = decision === NEW_TAB_DECISIONS.VERIFY ? chooseNewTabReviewSurface({
      promotionalIntent,
      targetLikelyAd: targetClassification.likelyAd,
      intentReasons: intentClassification.reasons,
      targetReasons: targetClassification.reasons
    }) : null;
    return {
      sourceUrl,
      targetUrl,
      targetDomain,
      sameSite,
      trustTarget,
      allowedSearch,
      decision,
      reviewSurface
    };
  }
  async function evaluateNewTab({ sourceTabId, tabId, url }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_GUARD)) return;
    if (!sourceTabId || !tabId || !url || isBlankUrl(url)) return;
    if (handledTabs.has(tabId) || evaluatingTabs.has(tabId)) return;
    if (consumeUserOpenedNavigation(url)) {
      pendingTabs.delete(tabId);
      handledTabs.set(tabId, Date.now());
      setTimeout(() => handledTabs.delete(tabId), 15e3);
      return;
    }
    evaluatingTabs.add(tabId);
    let shouldFinalize = false;
    try {
      const sourceTab = await chrome.tabs.get(sourceTabId);
      const capturedSourceUrl = reverseCandidatesBySource.get(sourceTabId)?.originalUrl || sourceTab?.url;
      if (!capturedSourceUrl?.startsWith("http")) return;
      const evaluation = await evaluateNavigationPolicy({
        sourceUrl: capturedSourceUrl,
        targetUrl: url,
        sourceTabId,
        waitForIntent: true
      });
      const { sourceUrl, targetDomain, decision, reviewSurface } = evaluation;
      if (shouldKeepTrackingNewTab({ sameSite: evaluation.sameSite })) return;
      if (evaluation.allowedSearch) {
        shouldFinalize = true;
        return showAllowedSearchToast({
          tabId,
          url,
          source: sourceUrl.hostname,
          target: evaluation.trustTarget
        });
      }
      if (decision === NEW_TAB_DECISIONS.ALLOW) {
        shouldFinalize = true;
        return;
      }
      if (decision === NEW_TAB_DECISIONS.CLOSE) {
        shouldFinalize = true;
        const enforcementPlan = createNavigationEnforcementPlan({
          sequence: NAVIGATION_SEQUENCES.OPENED_TAB_IS_TARGET,
          originalTabId: sourceTabId,
          openedTabId: tabId
        });
        await logBlockedNavigationIfAllowed(url, sourceUrl.hostname);
        await closeTabQuietly(enforcementPlan.closeTabId);
        return showBlockedNavigationToast({
          sourceTabId: enforcementPlan.notifyTabId,
          url,
          source: sourceUrl.hostname,
          target: targetDomain
        });
      }
      shouldFinalize = true;
      if (reviewSurface === NEW_TAB_REVIEW_SURFACES.CLOSE) {
        const enforcementPlan = createNavigationEnforcementPlan({
          sequence: NAVIGATION_SEQUENCES.OPENED_TAB_IS_TARGET,
          originalTabId: sourceTabId,
          openedTabId: tabId
        });
        await logBlockedNavigationIfAllowed(url, sourceUrl.hostname);
        await closeTabQuietly(enforcementPlan.closeTabId);
        return showBlockedNavigationToast({
          sourceTabId: enforcementPlan.notifyTabId,
          url,
          source: sourceUrl.hostname,
          target: targetDomain
        });
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
      evaluatingTabs.delete(tabId);
      if (shouldFinalize) {
        pendingTabs.delete(tabId);
        handledTabs.set(tabId, Date.now());
        setTimeout(() => handledTabs.delete(tabId), 15e3);
      }
    }
  }
  async function showAllowedSearchToast({ tabId, url, source, target }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_FEEDBACK)) return false;
    const message = {
      type: "SHOW_ALLOWED_SEARCH_NAVIGATION",
      url,
      source,
      target
    };
    return queueNavigationToast(tabId, message);
  }
  function showAllowedSearchNavigation(details) {
    return showAllowedSearchToast(details);
  }
  function allowUserOpenedNavigation(url) {
    let normalized;
    try {
      normalized = new URL(url).href;
    } catch {
      return false;
    }
    userOpenedNavigations.set(normalized, Date.now() + 5e3);
    return true;
  }
  function consumeUserOpenedNavigation(url) {
    let normalized;
    try {
      normalized = new URL(url).href;
    } catch {
      return false;
    }
    const expiresAt = userOpenedNavigations.get(normalized) || 0;
    userOpenedNavigations.delete(normalized);
    return expiresAt > Date.now();
  }
  async function showBlockedNavigationToast({
    sourceTabId,
    url,
    source,
    target
  }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_FEEDBACK)) return false;
    const now = Date.now();
    const previous = blockedNoticesBySource.get(sourceTabId);
    const count = previous?.expiresAt > now ? previous.count + 1 : 1;
    const notice = {
      count,
      expiresAt: now + 1e4,
      message: {
        type: "SHOW_BLOCKED_NAVIGATION",
        count,
        url,
        source,
        target
      }
    };
    blockedNoticesBySource.set(sourceTabId, notice);
    setTimeout(() => {
      if (blockedNoticesBySource.get(sourceTabId) === notice)
        blockedNoticesBySource.delete(sourceTabId);
    }, 10500);
    return queueNavigationToast(sourceTabId, notice.message);
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
    return queueNavigationToast(tabId, message);
  }
  async function queueNavigationToast(tabId, message) {
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

  // src/media/contracts.js
  var MEDIA_KINDS = Object.freeze({
    DIRECT: "direct",
    HLS: "hls",
    DASH: "dash",
    BLOB: "blob"
  });
  var MEDIA_DETECTION_SOURCES = Object.freeze({
    DOM: "dom",
    NETWORK: "network",
    PLAYER: "player"
  });
  var DRM_STATES = Object.freeze({
    NONE: "none",
    SUSPECTED: "suspected",
    CONFIRMED: "confirmed"
  });
  var ENCRYPTION_SCHEMES = Object.freeze({
    NONE: "none",
    AES_128: "aes-128",
    SAMPLE_AES: "sample-aes",
    CENC: "cenc",
    CBCS: "cbcs",
    UNKNOWN: "unknown"
  });
  var DRM_SYSTEMS = Object.freeze({
    WIDEVINE: "widevine",
    PLAYREADY: "playready",
    FAIRPLAY: "fairplay",
    CLEARKEY: "clearkey",
    UNKNOWN: "unknown"
  });
  var MEDIA_PROBE_STATES = Object.freeze({
    DISCOVERED: "discovered",
    READY: "ready",
    UNSUPPORTED: "unsupported",
    FAILED: "failed"
  });
  var MEDIA_PROBE_DIAGNOSTIC_PHASES = Object.freeze({
    SCHEDULED: "scheduled",
    DISPATCHED: "dispatched",
    RESPONSE_RECEIVED: "response_received",
    PARSED: "parsed",
    SKIPPED: "skipped",
    FAILED: "failed"
  });
  var MEDIA_PROBE_SOURCES = Object.freeze({
    NETWORK_RESPONSE: "network_response",
    DECRYPTED_BLOB: "decrypted_blob"
  });
  function normalizeMediaCandidate(value = {}) {
    const candidate = {
      id: requiredString(value.id, "id"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      sourceUrl: optionalString(value.sourceUrl),
      manifestUrl: optionalString(value.manifestUrl),
      kind: enumValue(value.kind, Object.values(MEDIA_KINDS), "kind"),
      title: optionalString(value.title),
      mimeType: optionalString(value.mimeType),
      variants: normalizeArray(value.variants),
      iframeVariants: normalizeArray(value.iframeVariants),
      audioTracks: normalizeArray(value.audioTracks),
      subtitles: normalizeArray(value.subtitles),
      detectedBy: enumValue(
        value.detectedBy,
        Object.values(MEDIA_DETECTION_SOURCES),
        "detectedBy"
      ),
      drm: enumValue(
        value.drm || DRM_STATES.NONE,
        Object.values(DRM_STATES),
        "drm"
      ),
      probeStatus: enumValue(
        value.probeStatus || MEDIA_PROBE_STATES.DISCOVERED,
        Object.values(MEDIA_PROBE_STATES),
        "probeStatus"
      ),
      probeError: optionalString(value.probeError),
      playlistType: optionalEnumValue(
        value.playlistType,
        ["master", "media", "unknown"],
        "playlistType"
      ),
      streamType: optionalEnumValue(
        value.streamType,
        ["vod", "live", "unknown"],
        "streamType"
      ),
      duration: optionalFiniteNumber(value.duration),
      targetDuration: optionalFiniteNumber(value.targetDuration),
      segmentCount: optionalNonNegativeInteger(value.segmentCount),
      partialSegmentCount: optionalNonNegativeInteger(value.partialSegmentCount),
      skippedSegmentCount: optionalNonNegativeInteger(value.skippedSegmentCount),
      lowLatency: value.lowLatency === true,
      mediaSequence: optionalNonNegativeInteger(value.mediaSequence),
      discontinuitySequence: optionalNonNegativeInteger(
        value.discontinuitySequence
      ),
      revisionId: optionalString(value.revisionId),
      requestContexts: normalizeRequestContexts(value.requestContexts),
      resolutionAttempt: normalizeMediaResolutionAttempt(value.resolutionAttempt),
      encryptionMethods: normalizeStrings(value.encryptionMethods),
      encryptionScheme: normalizeEncryptionScheme(value.encryptionScheme),
      encryptionKeyFormats: normalizeStrings(value.encryptionKeyFormats).slice(
        0,
        20
      ),
      drmSystem: normalizeDrmSystem(value.drmSystem),
      drmEvidence: normalizeStrings(value.drmEvidence).slice(0, 20),
      eme: normalizeEmeMetadata(value.eme)
    };
    if (!candidate.sourceUrl && !candidate.manifestUrl) {
      throw new Error(
        "[MediaContract] A media candidate needs sourceUrl or manifestUrl."
      );
    }
    return candidate;
  }
  function normalizeMediaProbe(value = {}) {
    const kind = enumValue(
      value.kind,
      [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH],
      "kind"
    );
    const probeStatus = enumValue(
      value.status,
      [
        MEDIA_PROBE_STATES.READY,
        MEDIA_PROBE_STATES.UNSUPPORTED,
        MEDIA_PROBE_STATES.FAILED
      ],
      "status"
    );
    return {
      mediaId: requiredString(value.mediaId, "mediaId"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      manifestUrl: requiredString(value.manifestUrl, "manifestUrl"),
      kind,
      status: probeStatus,
      error: optionalString(value.error),
      playlistType: optionalEnumValue(
        value.playlistType,
        ["master", "media", "unknown"],
        "playlistType"
      ),
      streamType: optionalEnumValue(
        value.streamType,
        ["vod", "live", "unknown"],
        "streamType"
      ),
      variants: normalizeArray(value.variants),
      iframeVariants: normalizeArray(value.iframeVariants),
      audioTracks: normalizeArray(value.audioTracks),
      subtitles: normalizeArray(value.subtitles),
      duration: optionalFiniteNumber(value.duration),
      targetDuration: optionalFiniteNumber(value.targetDuration),
      segmentCount: optionalNonNegativeInteger(value.segmentCount),
      partialSegmentCount: optionalNonNegativeInteger(value.partialSegmentCount),
      skippedSegmentCount: optionalNonNegativeInteger(value.skippedSegmentCount),
      lowLatency: value.lowLatency === true,
      mediaSequence: optionalNonNegativeInteger(value.mediaSequence),
      discontinuitySequence: optionalNonNegativeInteger(
        value.discontinuitySequence
      ),
      revisionId: optionalString(value.revisionId),
      probeSource: optionalEnumValue(
        value.probeSource,
        Object.values(MEDIA_PROBE_SOURCES),
        "probeSource"
      ),
      manifestEnvelope: normalizeManifestEnvelope(value.manifestEnvelope),
      requestContext: normalizeMediaRequestContext(value.requestContext),
      resolutionAttempt: normalizeMediaResolutionAttempt(value.resolutionAttempt),
      encryptionMethods: normalizeStrings(value.encryptionMethods),
      encryptionScheme: normalizeEncryptionScheme(value.encryptionScheme),
      encryptionKeyFormats: normalizeStrings(value.encryptionKeyFormats).slice(
        0,
        20
      ),
      drmSystem: normalizeDrmSystem(value.drmSystem),
      drmEvidence: normalizeStrings(value.drmEvidence).slice(0, 20),
      eme: normalizeEmeMetadata(value.eme),
      drm: enumValue(
        value.drm || DRM_STATES.NONE,
        Object.values(DRM_STATES),
        "drm"
      )
    };
  }
  function normalizeMediaProbeDiagnostic(value = {}) {
    return {
      mediaId: requiredString(value.mediaId, "mediaId"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      manifestUrl: requiredString(value.manifestUrl, "manifestUrl"),
      kind: enumValue(value.kind, [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH], "kind"),
      phase: enumValue(
        value.phase,
        Object.values(MEDIA_PROBE_DIAGNOSTIC_PHASES),
        "phase"
      ),
      code: requiredString(value.code, "code").slice(0, 100),
      httpStatus: optionalNonNegativeInteger(value.httpStatus),
      bodyBytes: optionalNonNegativeInteger(value.bodyBytes),
      bodyFormat: optionalEnumValue(
        value.bodyFormat,
        ["hls", "dash", "unknown"],
        "bodyFormat"
      ),
      playlistType: optionalEnumValue(
        value.playlistType,
        ["master", "media", "unknown"],
        "playlistType"
      ),
      segmentCount: optionalNonNegativeInteger(value.segmentCount),
      observationSource: optionalEnumValue(
        value.observationSource,
        [
          "network_response",
          "active_probe",
          "decrypted_blob",
          "player_api",
          "media_source"
        ],
        "observationSource"
      ),
      envelopeScheme: optionalEnumValue(
        value.envelopeScheme,
        ["aes-gcm", "unknown"],
        "envelopeScheme"
      ),
      correlationConfidence: optionalConfidence(value.correlationConfidence),
      evidence: normalizeStrings(value.evidence).slice(0, 20),
      observedAt: optionalFiniteNumber(value.observedAt) || Date.now()
    };
  }
  function normalizeManifestEnvelope(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      scheme: enumValue(
        value.scheme || "unknown",
        ["aes-gcm", "unknown"],
        "manifestEnvelope.scheme"
      ),
      observedAt: optionalFiniteNumber(value.observedAt),
      correlationConfidence: optionalConfidence(value.correlationConfidence),
      evidence: normalizeStrings(value.evidence).slice(0, 20)
    };
  }
  function normalizeEmeObservation(value = {}) {
    return {
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      keySystem: normalizeKeySystem(value.keySystem),
      initDataType: safeMetadataString(value.initDataType),
      encryptionSchemes: normalizeStrings(value.encryptionSchemes).map(normalizeObservedEncryptionScheme).filter(Boolean).slice(0, 8),
      keyStatuses: normalizeStrings(value.keyStatuses).map((status) => status.toLowerCase()).filter(
        (status) => [
          "usable",
          "expired",
          "released",
          "output-restricted",
          "output-downscaled",
          "status-pending",
          "internal-error"
        ].includes(status)
      ).slice(0, 8),
      licenseStatus: optionalEnumValue(
        value.licenseStatus,
        ["requested", "updated", "usable", "restricted", "expired", "error"],
        "licenseStatus"
      ),
      observedAt: optionalFiniteNumber(value.observedAt) || Date.now()
    };
  }
  function normalizeEmeMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      keySystems: normalizeStrings(value.keySystems).map(normalizeKeySystem).filter(Boolean).slice(0, 8),
      initDataTypes: normalizeStrings(value.initDataTypes).map(safeMetadataString).filter(Boolean).slice(0, 8),
      encryptionSchemes: normalizeStrings(value.encryptionSchemes).map(normalizeObservedEncryptionScheme).filter(Boolean).slice(0, 8),
      keyStatuses: normalizeStrings(value.keyStatuses).map((status) => status.toLowerCase()).filter(Boolean).slice(0, 8),
      licenseStatus: optionalString(value.licenseStatus),
      observedAt: optionalFiniteNumber(value.observedAt) || null
    };
  }
  function normalizeBlobSourceTrace(value = {}) {
    const blobUrl = requiredString(value.blobUrl, "blobUrl");
    if (!blobUrl.startsWith("blob:")) {
      throw new Error("[MediaContract] blobUrl must use the blob: protocol.");
    }
    return {
      mediaId: requiredString(value.mediaId, "mediaId"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      blobUrl,
      sourceUrls: normalizeHttpUrls(value.sourceUrls, 32),
      candidateIds: normalizeStrings(value.candidateIds).slice(0, 8),
      mimeTypes: normalizeStrings(value.mimeTypes).slice(0, 8),
      appendCount: optionalNonNegativeInteger(value.appendCount) || 0,
      totalAppendedBytes: optionalNonNegativeInteger(value.totalAppendedBytes) || 0,
      observedAt: optionalFiniteNumber(value.observedAt) || Date.now()
    };
  }
  function normalizeMediaManifestHandoff(value = {}) {
    return {
      mediaId: requiredString(value.mediaId, "mediaId"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      manifestUrl: requiredString(value.manifestUrl, "manifestUrl"),
      kind: enumValue(value.kind, [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH], "kind"),
      bodyBytes: optionalNonNegativeInteger(value.bodyBytes) || 0,
      revisionId: optionalString(value.revisionId),
      capturedAt: optionalFiniteNumber(value.capturedAt) || Date.now(),
      expiresAt: optionalFiniteNumber(value.expiresAt)
    };
  }
  function normalizeMediaResolutionAttempt(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const strategy2 = optionalEnumValue(
      value.strategy,
      ["remove_query_parameter"],
      "resolutionAttempt.strategy"
    );
    if (!strategy2) return null;
    return {
      adapterId: optionalString(value.adapterId)?.slice(0, 100) || null,
      strategy: strategy2,
      removedQueryKey: optionalString(value.removedQueryKey)?.slice(0, 100) || null,
      evidence: normalizeStrings(value.evidence).slice(0, 20)
    };
  }
  function normalizeMediaRequestContext(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const credentials = optionalEnumValue(
      value.credentials,
      ["omit", "same-origin", "include", "unknown"],
      "requestContext.credentials"
    );
    const transport = optionalEnumValue(
      value.transport,
      ["fetch", "xhr", "fallback", "web_request"],
      "requestContext.transport"
    );
    return {
      requestUrl: optionalString(value.requestUrl),
      finalUrl: optionalString(value.finalUrl),
      documentUrl: optionalString(value.documentUrl),
      parentDocumentUrl: optionalString(value.parentDocumentUrl),
      referrer: optionalString(value.referrer),
      method: typeof value.method === "string" && value.method ? value.method.toUpperCase().slice(0, 12) : "GET",
      credentials: credentials || "unknown",
      transport,
      requiresBrowserSession: value.requiresBrowserSession === true,
      observedAt: optionalFiniteNumber(value.observedAt)
    };
  }
  function normalizeVideoAdEvidence(value = {}) {
    const confidence = Number(value.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error("[MediaContract] confidence must be between 0 and 1.");
    }
    return {
      mediaId: requiredString(value.mediaId, "mediaId"),
      startTime: optionalFiniteNumber(value.startTime),
      endTime: optionalFiniteNumber(value.endTime),
      signals: Array.isArray(value.signals) ? value.signals.filter((signal) => typeof signal === "string") : [],
      confidence,
      label: enumValue(
        value.label || "unknown",
        ["ad", "content", "unknown"],
        "label"
      ),
      labelSource: enumValue(
        value.labelSource,
        ["user", "manifest", "heuristic", "model"],
        "labelSource"
      )
    };
  }
  function requiredString(value, field) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`[MediaContract] ${field} must be a non-empty string.`);
    }
    return value;
  }
  function optionalString(value) {
    return typeof value === "string" && value ? value : null;
  }
  function optionalConfidence(value) {
    if (value === null || value === void 0 || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 1) {
      throw new Error("[MediaContract] confidence must be between 0 and 1.");
    }
    return number;
  }
  function enumValue(value, allowed, field) {
    if (!allowed.includes(value)) {
      throw new Error(
        `[MediaContract] ${field} must be one of: ${allowed.join(", ")}.`
      );
    }
    return value;
  }
  function optionalEnumValue(value, allowed, field) {
    if (value === null || value === void 0 || value === "") return null;
    return enumValue(value, allowed, field);
  }
  function normalizeArray(value) {
    return Array.isArray(value) ? value.slice(0, 100).map((item) => ({ ...item })) : [];
  }
  function normalizeStrings(value) {
    return Array.isArray(value) ? [
      ...new Set(
        value.slice(0, 100).filter((item) => typeof item === "string" && item).map((item) => item.slice(0, 100))
      )
    ] : [];
  }
  function normalizeEncryptionScheme(value) {
    return enumValue(
      value || ENCRYPTION_SCHEMES.NONE,
      Object.values(ENCRYPTION_SCHEMES),
      "encryptionScheme"
    );
  }
  function normalizeObservedEncryptionScheme(value) {
    const normalized = String(value || "").toLowerCase();
    if (["cenc", "cbcs", "cens", "cbc1"].includes(normalized)) return normalized;
    return null;
  }
  function normalizeKeySystem(value) {
    const normalized = safeMetadataString(value)?.toLowerCase();
    if (!normalized) return null;
    if (normalized === "com.widevine.alpha") return normalized;
    if (normalized.includes("playready")) return "com.microsoft.playready";
    if (normalized.includes("fairplay")) return "com.apple.fps";
    if (normalized.includes("clearkey")) return "org.w3.clearkey";
    return "unknown";
  }
  function normalizeDrmSystem(value) {
    if (value === null || value === void 0 || value === "") return null;
    return enumValue(value, Object.values(DRM_SYSTEMS), "drmSystem");
  }
  function safeMetadataString(value) {
    if (typeof value !== "string" || !value) return null;
    return value.slice(0, 100);
  }
  function normalizeHttpUrls(value, maximum) {
    if (!Array.isArray(value)) return [];
    const urls = [];
    for (const item of value.slice(0, maximum)) {
      if (typeof item !== "string") continue;
      try {
        const url = new URL(item);
        if (["http:", "https:"].includes(url.protocol)) urls.push(url.href);
      } catch {
      }
    }
    return [...new Set(urls)];
  }
  function normalizeRequestContexts(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 8).map(normalizeMediaRequestContext).filter(Boolean);
  }
  function optionalFiniteNumber(value) {
    if (value === null || value === void 0) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error("[MediaContract] Timeline values must be finite numbers.");
    }
    return number;
  }
  function optionalNonNegativeInteger(value) {
    if (value === null || value === void 0) return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      throw new Error("[MediaContract] Expected a non-negative integer.");
    }
    return number;
  }

  // src/runtime/event-catalog.js
  var EVENTS = Object.freeze({
    MEDIA_DISCOVERED: "media.discovered",
    MEDIA_PROBED: "media.probed",
    MEDIA_PROBE_DIAGNOSTIC: "media.probe_diagnostic",
    MEDIA_BLOB_TRACED: "media.blob_traced",
    MEDIA_MANIFEST_HANDOFF_READY: "media.manifest_handoff_ready",
    MEDIA_EME_OBSERVED: "media.eme_observed",
    MEDIA_CATALOG_UPDATED: "media.catalog.updated",
    VIDEO_AD_EVIDENCE_FOUND: "video_ad.evidence_found",
    VIDEO_AD_LABELLED: "video_ad.labelled"
  });
  var E = EVENTS;
  var EVENT_CATALOG = Object.freeze({
    [E.MEDIA_DISCOVERED]: event(
      E.MEDIA_DISCOVERED,
      "media.observer",
      ["media.catalog"],
      normalizeMediaCandidate
    ),
    [E.MEDIA_PROBED]: event(
      E.MEDIA_PROBED,
      "media.probe",
      ["media.catalog"],
      normalizeMediaProbe
    ),
    [E.MEDIA_PROBE_DIAGNOSTIC]: event(
      E.MEDIA_PROBE_DIAGNOSTIC,
      "media.probe",
      ["media.catalog"],
      normalizeMediaProbeDiagnostic
    ),
    [E.MEDIA_BLOB_TRACED]: event(
      E.MEDIA_BLOB_TRACED,
      "media.blob-source-tracer",
      ["media.catalog"],
      normalizeBlobSourceTrace
    ),
    [E.MEDIA_MANIFEST_HANDOFF_READY]: event(
      E.MEDIA_MANIFEST_HANDOFF_READY,
      "media.manifest-handoff",
      ["media.catalog", "media.downloader"],
      normalizeMediaManifestHandoff
    ),
    [E.MEDIA_EME_OBSERVED]: event(
      E.MEDIA_EME_OBSERVED,
      "media.eme-observer",
      ["media.catalog"],
      normalizeEmeObservation
    ),
    [E.MEDIA_CATALOG_UPDATED]: event(
      E.MEDIA_CATALOG_UPDATED,
      "media.catalog",
      ["media.downloader", "video-ad.evidence-collector"],
      normalizeCatalogUpdate
    ),
    [E.VIDEO_AD_EVIDENCE_FOUND]: event(
      E.VIDEO_AD_EVIDENCE_FOUND,
      "video-ad.evidence-collector",
      ["video-ad.classifier"],
      normalizeVideoAdEvidence
    ),
    [E.VIDEO_AD_LABELLED]: event(
      E.VIDEO_AD_LABELLED,
      "video-ad.feedback-labeler",
      ["training.samples"],
      normalizeVideoAdEvidence
    )
  });
  validateEventCatalog();
  function getEventDefinition(eventId) {
    const definition = EVENT_CATALOG[eventId];
    if (!definition) {
      throw new Error(
        `[EventRegistry] Unknown event "${eventId}". Register it in event-catalog.js before use.`
      );
    }
    return definition;
  }
  function createRegisteredEvent(eventId, payload, metadata = {}) {
    const definition = getEventDefinition(eventId);
    return {
      eventId: randomId3(),
      type: eventId,
      timestamp: Date.now(),
      producer: definition.producer,
      payload: definition.normalize(payload),
      metadata: { ...metadata }
    };
  }
  function normalizeRegisteredEvent(value = {}) {
    const definition = getEventDefinition(value.type);
    return {
      eventId: typeof value.eventId === "string" && value.eventId ? value.eventId : randomId3(),
      type: definition.id,
      timestamp: Number.isFinite(Number(value.timestamp)) ? Number(value.timestamp) : Date.now(),
      producer: definition.producer,
      payload: definition.normalize(value.payload),
      metadata: value.metadata && typeof value.metadata === "object" ? { ...value.metadata } : {}
    };
  }
  function event(id, producer, consumers, normalize) {
    return Object.freeze({
      id,
      producer,
      consumers: Object.freeze([...consumers]),
      normalize
    });
  }
  function normalizeCatalogUpdate(value = {}) {
    if (typeof value.mediaId !== "string" || !value.mediaId) {
      throw new Error("[EventRegistry] catalog update needs mediaId.");
    }
    const revision = Number(value.revision);
    if (!Number.isInteger(revision) || revision < 0) {
      throw new Error(
        "[EventRegistry] catalog update revision must be a non-negative integer."
      );
    }
    return { mediaId: value.mediaId, revision };
  }
  function validateEventCatalog() {
    const eventIds = Object.values(EVENTS);
    if (new Set(eventIds).size !== eventIds.length) {
      throw new Error("[EventRegistry] Duplicate event ID.");
    }
    for (const eventId of eventIds) {
      const definition = EVENT_CATALOG[eventId];
      if (!definition || definition.id !== eventId) {
        throw new Error(
          `[EventRegistry] Event "${eventId}" has no metadata definition.`
        );
      }
      if (!definition.producer || !definition.consumers.length) {
        throw new Error(
          `[EventRegistry] Event "${eventId}" needs a producer and consumers.`
        );
      }
    }
  }
  function randomId3() {
    return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // src/media/detection.js
  var HLS_MIME_TYPES = /* @__PURE__ */ new Set([
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl"
  ]);
  var DASH_MIME_TYPES = /* @__PURE__ */ new Set(["application/dash+xml"]);
  var SEGMENT_MIME_TYPES = /* @__PURE__ */ new Set([
    "video/mp2t",
    "video/iso.segment",
    "audio/aac",
    "audio/aacp"
  ]);
  var SEGMENT_PATH_PATTERN = /\.(?:ts|m2ts|m4s|cmfv|cmfa|aac)$/i;
  function classifyMediaSource(sourceUrl = "", mimeType = "") {
    const normalizedUrl = String(sourceUrl).trim().toLowerCase();
    const normalizedMime = String(mimeType).split(";")[0].trim().toLowerCase();
    const path = normalizedUrl.split(/[?#]/)[0];
    if (normalizedUrl.startsWith("blob:")) return MEDIA_KINDS.BLOB;
    if (path.endsWith(".m3u8") || HLS_MIME_TYPES.has(normalizedMime))
      return MEDIA_KINDS.HLS;
    if (path.endsWith(".mpd") || DASH_MIME_TYPES.has(normalizedMime))
      return MEDIA_KINDS.DASH;
    if (isLikelyMediaSegment(normalizedUrl, normalizedMime)) return null;
    if (/\.(mp4|webm|m4v|mov)$/.test(path) || normalizedMime.startsWith("video/"))
      return MEDIA_KINDS.DIRECT;
    return null;
  }
  function isLikelyMediaSegment(sourceUrl = "", mimeType = "") {
    const normalizedUrl = String(sourceUrl).trim().toLowerCase();
    const normalizedMime = String(mimeType).split(";", 1)[0].trim().toLowerCase();
    const path = normalizedUrl.split(/[?#]/, 1)[0];
    return SEGMENT_PATH_PATTERN.test(path) || SEGMENT_MIME_TYPES.has(normalizedMime);
  }
  function createMediaCandidateFromSource({
    pageUrl,
    sourceUrl,
    mimeType = null,
    title = null,
    duration = null,
    detectedBy = MEDIA_DETECTION_SOURCES.DOM
  }) {
    const absoluteSourceUrl = resolveSourceUrl(sourceUrl, pageUrl);
    const kind = classifyMediaSource(absoluteSourceUrl, mimeType);
    if (!kind) return null;
    const isManifest = [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(kind);
    return normalizeMediaCandidate({
      id: stableMediaId(kind, absoluteSourceUrl),
      pageUrl,
      sourceUrl: isManifest ? null : absoluteSourceUrl,
      manifestUrl: isManifest ? absoluteSourceUrl : null,
      kind,
      title,
      mimeType,
      duration,
      detectedBy,
      drm: "none"
    });
  }
  function stableMediaId(kind, sourceUrl) {
    const input = `${kind}:${sourceUrl}`;
    let hash = 2166136261;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `media-${(hash >>> 0).toString(36)}`;
  }
  function resolveSourceUrl(sourceUrl, pageUrl) {
    if (typeof sourceUrl !== "string" || !sourceUrl.trim()) return "";
    try {
      return new URL(sourceUrl, pageUrl).href;
    } catch {
      return sourceUrl;
    }
  }

  // src/media/resolution-strategy-catalog.js
  var MEDIA_RESOLUTION_STRATEGIES = Object.freeze({
    CAPTURED_RESPONSE: "captured_response",
    OBSERVED_CHILD: "observed_child",
    PLAYER_API: "player_api",
    CONTEXTUAL_PROBE: "contextual_probe",
    BOUNDED_URL_ADAPTER: "bounded_url_adapter",
    DECRYPTED_MANIFEST: "decrypted_manifest"
  });
  var S = MEDIA_RESOLUTION_STRATEGIES;
  var MEDIA_RESOLUTION_STRATEGY_CATALOG = Object.freeze([
    strategy(S.CAPTURED_RESPONSE, 100, 0, "passive"),
    strategy(S.DECRYPTED_MANIFEST, 95, 0, "passive"),
    strategy(S.OBSERVED_CHILD, 90, 0, "passive"),
    strategy(S.PLAYER_API, 80, 0, "passive"),
    strategy(S.CONTEXTUAL_PROBE, 60, 1, "active"),
    strategy(S.BOUNDED_URL_ADAPTER, 40, 3, "active")
  ]);
  var STRATEGY_BY_ID = new Map(
    MEDIA_RESOLUTION_STRATEGY_CATALOG.map((definition) => [
      definition.id,
      definition
    ])
  );
  validateCatalog2();
  function findPassiveHlsChildMatches(items = [], { maximumAgeMs = 6e4 } = {}) {
    const playerLinks = items.filter(
      (item) => item.kind === "blob" && item.blobTrace?.candidateIds?.length
    );
    const children = items.filter(isUsableMediaPlaylist);
    const playbackDurations = items.filter(
      (item) => item.kind === "blob" && Number.isFinite(item.duration) && item.duration >= 60
    ).map((item) => ({ item, duration: item.duration }));
    const matches = [];
    for (const parent of items.filter(needsPassiveChild)) {
      const ranked = children.filter((child) => child.id !== parent.id).map(
        (child) => passiveMatch(
          parent,
          child,
          playerLinks,
          playbackDurations,
          maximumAgeMs
        )
      ).filter(Boolean).sort(
        (left, right) => right.confidence - left.confidence || (right.child.duration || 0) - (left.child.duration || 0) || (right.child.lastSeenAt || 0) - (left.child.lastSeenAt || 0)
      );
      const selected = ranked[0];
      if (!selected || selected.confidence < 0.8) continue;
      const alternative = ranked[1];
      if (alternative && selected.confidence - alternative.confidence < 0.08 && !selected.evidence.includes("player-linked") && !selected.evidence.includes("playback-duration-match")) {
        continue;
      }
      matches.push({
        parentId: parent.id,
        childId: selected.child.id,
        strategyId: S.OBSERVED_CHILD,
        confidence: selected.confidence,
        evidence: selected.evidence
      });
    }
    return matches;
  }
  function passiveMatch(parent, child, playerLinks, playbackDurations, maximumAgeMs) {
    if (!sameFrame(parent, child)) return null;
    const age = observationDistance(parent, child);
    if (!Number.isFinite(age) || age > maximumAgeMs) return null;
    const originMatched = sameOrigin(parent, child);
    const playerLinked = playerLinks.some(
      (blob) => sameFrame(parent, blob) && blob.blobTrace.candidateIds.includes(child.id)
    ) || child.detectionSources?.includes("player");
    const durationMatched = playbackDurations.some(
      ({ item, duration }) => sameFrame(parent, item) && durationsMatch(duration, child.duration)
    );
    if (!originMatched && !playerLinked && !durationMatched) return null;
    const evidence = ["same-frame"];
    let confidence = 0.45;
    if (originMatched) {
      confidence += 0.2;
      evidence.push("same-origin");
    } else {
      evidence.push("cross-cdn");
    }
    if (age <= 15e3) {
      confidence += 0.1;
      evidence.push("nearby-observation");
    }
    if (sharedPathPrefix(parent.manifestUrl, child.manifestUrl)) {
      confidence += 0.1;
      evidence.push("shared-path");
    }
    if (playerLinked) {
      confidence += 0.25;
      evidence.push("player-linked");
    }
    if (durationMatched) {
      confidence += 0.25;
      evidence.push("playback-duration-match");
    }
    if (Number.isFinite(child.duration) && child.duration >= 60) {
      confidence += 0.05;
      evidence.push("content-duration");
    }
    return {
      child,
      confidence: Math.min(1, Number(confidence.toFixed(2))),
      evidence
    };
  }
  function durationsMatch(playbackDuration, playlistDuration) {
    if (!Number.isFinite(playbackDuration) || !Number.isFinite(playlistDuration) || playbackDuration < 60 || playlistDuration < 60)
      return false;
    const tolerance = Math.max(5, playbackDuration * 0.02);
    return Math.abs(playbackDuration - playlistDuration) <= tolerance;
  }
  function needsPassiveChild(item) {
    if (item.kind !== "hls") return false;
    if (isUsableMediaPlaylist(item)) return false;
    return item.probeStatus === "discovered" || item.probeStatus === "failed" || item.playlistType === "unknown" || item.playlistType === "master" && !item.variants?.length;
  }
  function isUsableMediaPlaylist(item) {
    return item.kind === "hls" && item.probeStatus === "ready" && item.playlistType === "media" && ["vod", "live"].includes(item.streamType) && ((item.segmentCount || 0) > 0 || (item.partialSegmentCount || 0) > 0);
  }
  function sameFrame(left, right) {
    if (Number.isInteger(left.frameId) && Number.isInteger(right.frameId)) {
      return left.frameId === right.frameId;
    }
    const leftUrl = normalizedDocumentUrl(left.frameUrl);
    const rightUrl = normalizedDocumentUrl(right.frameUrl);
    return Boolean(leftUrl && rightUrl && leftUrl === rightUrl);
  }
  function sameOrigin(left, right) {
    try {
      return new URL(left.manifestUrl).origin === new URL(right.manifestUrl).origin;
    } catch {
      return false;
    }
  }
  function observationDistance(left, right) {
    const leftAt = left.firstSeenAt || left.lastSeenAt;
    const rightAt = right.firstSeenAt || right.lastSeenAt;
    return Number.isFinite(leftAt) && Number.isFinite(rightAt) ? Math.abs(leftAt - rightAt) : Infinity;
  }
  function sharedPathPrefix(left, right) {
    try {
      const leftParts = new URL(left).pathname.split("/").filter(Boolean);
      const rightParts = new URL(right).pathname.split("/").filter(Boolean);
      let shared = 0;
      while (shared < leftParts.length && shared < rightParts.length && leftParts[shared] === rightParts[shared]) {
        shared += 1;
      }
      return shared >= 2;
    } catch {
      return false;
    }
  }
  function normalizedDocumentUrl(value) {
    try {
      const url = new URL(value);
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  }
  function strategy(id, priority, maximumExtraRequests, trigger) {
    return Object.freeze({ id, priority, maximumExtraRequests, trigger });
  }
  function validateCatalog2() {
    const ids = Object.values(MEDIA_RESOLUTION_STRATEGIES);
    if (new Set(ids).size !== ids.length) {
      throw new Error("[MediaResolution] Duplicate strategy ID.");
    }
    for (const id of ids) {
      const definition = STRATEGY_BY_ID.get(id);
      if (!definition || definition.id !== id) {
        throw new Error(`[MediaResolution] Strategy "${id}" is not registered.`);
      }
    }
  }

  // src/media/hls-resolver.js
  function resolveHlsSources(items = []) {
    const annotations = new Map(
      items.map((item) => [
        item.id,
        {
          parents: /* @__PURE__ */ new Set(),
          children: /* @__PURE__ */ new Set(),
          edges: []
        }
      ])
    );
    const byManifestUrl = new Map(
      items.filter((item) => item.kind === "hls" && item.manifestUrl).map((item) => [normalizeUrl(item.manifestUrl), item])
    );
    for (const parent of items) {
      if (parent.kind !== "hls") continue;
      if (parent.playlistType === "master") {
        addEdges(parent, parent.variants, "variant");
        addEdges(parent, parent.audioTracks, "audio");
        addEdges(parent, parent.subtitles, "subtitles");
      }
      for (const context of parent.requestContexts || []) {
        const source = byManifestUrl.get(normalizeUrl(context.requestUrl));
        if (source && source.id !== parent.id) {
          connect(source, parent, "redirect", null);
        }
      }
    }
    for (const match of findPassiveHlsChildMatches(items)) {
      const parent = items.find((item) => item.id === match.parentId);
      const child = items.find((item) => item.id === match.childId);
      if (parent && child) {
        connect(parent, child, "passive_child", {
          strategyId: match.strategyId,
          confidence: match.confidence,
          evidence: match.evidence,
          ...qualityFromUrl(child.manifestUrl)
        });
      }
    }
    const resolved = /* @__PURE__ */ new Map();
    for (const item of items) {
      const relation = annotations.get(item.id);
      if (item.kind !== "hls") {
        resolved.set(item.id, emptyResolution(relation));
        continue;
      }
      const streams = collectMediaStreams(item, annotations, items);
      const selected = streams.sort(compareResolvedStreams)[0] || null;
      resolved.set(item.id, {
        parents: relation.parents,
        children: relation.children,
        resolutionStatus: resolutionStatus(item, selected),
        resolvedMediaIds: [...new Set(streams.map((stream) => stream.item.id))],
        selectedMediaId: selected?.item.id || null,
        resolvedStream: selected ? summarizeStream(selected) : null,
        resolvedRequestContext: selected ? chooseRequestContext(selected.item.requestContexts) : chooseRequestContext(item.requestContexts),
        resolutionStrategy: selected?.strategyId || null,
        resolutionConfidence: selected?.confidence ?? null,
        resolutionEvidence: [...selected?.evidence || []]
      });
    }
    return resolved;
    function addEdges(parent, entries = [], kind) {
      for (const entry of entries || []) {
        const child = byManifestUrl.get(normalizeUrl(entry.url));
        if (child && child.id !== parent.id) connect(parent, child, kind, entry);
      }
    }
    function connect(parent, child, kind, metadata) {
      const parentRelation = annotations.get(parent.id);
      const childRelation = annotations.get(child.id);
      if (!parentRelation || !childRelation) return;
      if (parentRelation.edges.some(
        (edge) => edge.childId === child.id && edge.kind === kind
      ))
        return;
      parentRelation.children.add(child.id);
      childRelation.parents.add(parent.id);
      parentRelation.edges.push({ childId: child.id, kind, metadata });
    }
  }
  function chooseRequestContext(contexts = []) {
    return [...contexts].filter((context) => context && typeof context === "object").sort(
      (left, right) => Number(right.requiresBrowserSession) - Number(left.requiresBrowserSession) || (right.observedAt || 0) - (left.observedAt || 0)
    )[0] || null;
  }
  function collectMediaStreams(root, annotations, items) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const streams = [];
    const visited = /* @__PURE__ */ new Set();
    const visit = (item, quality = null, strategy2 = itemStrategy(item)) => {
      const visitKey = `${item.id}:${quality?.height || 0}:${quality?.bandwidth || 0}`;
      if (visited.has(visitKey)) return;
      visited.add(visitKey);
      if (item.playlistType === "media") {
        streams.push({
          item,
          quality,
          readiness: mediaReadiness(item),
          ...strategy2
        });
        return;
      }
      for (const edge of annotations.get(item.id)?.edges || []) {
        if (!["variant", "redirect", "passive_child"].includes(edge.kind))
          continue;
        const child = byId.get(edge.childId);
        if (!child) continue;
        visit(
          child,
          ["variant", "passive_child"].includes(edge.kind) ? variantQuality(edge.metadata) : quality,
          edgeStrategy(edge, child)
        );
      }
    };
    visit(root);
    return streams;
  }
  function mediaReadiness(item) {
    if (["suspected", "confirmed"].includes(item.drm) || item.encryptionMethods?.length)
      return "protected";
    if (item.streamType === "vod" && item.segmentCount > 0) return "vod";
    if (item.streamType === "live" && (item.segmentCount > 0 || item.partialSegmentCount > 0))
      return "live";
    return "waiting";
  }
  function resolutionStatus(item, selected) {
    if (selected?.readiness === "vod")
      return selected.item.id === item.id ? "ready" : "resolved";
    if (selected?.readiness === "live") return "live";
    if (selected?.readiness === "protected") return "protected";
    return "waiting";
  }
  function compareResolvedStreams(left, right) {
    const readinessRank = { vod: 4, live: 3, protected: 2, waiting: 1 };
    return (readinessRank[right.readiness] || 0) - (readinessRank[left.readiness] || 0) || (right.quality?.height || 0) - (left.quality?.height || 0) || (right.quality?.bandwidth || 0) - (left.quality?.bandwidth || 0) || (right.item.segmentCount || 0) - (left.item.segmentCount || 0);
  }
  function summarizeStream(stream) {
    const { item, quality, readiness, strategyId, confidence, evidence } = stream;
    return {
      id: item.id,
      manifestUrl: item.manifestUrl,
      readiness,
      streamType: item.streamType,
      duration: item.duration,
      segmentCount: item.segmentCount,
      partialSegmentCount: item.partialSegmentCount,
      lowLatency: item.lowLatency === true,
      drm: item.drm,
      encryptionMethods: [...item.encryptionMethods || []],
      probeSource: item.probeSource || null,
      manifestEnvelope: item.manifestEnvelope ? {
        ...item.manifestEnvelope,
        evidence: [...item.manifestEnvelope.evidence || []]
      } : null,
      manifestHandoff: item.manifestHandoff ? { ...item.manifestHandoff } : null,
      resolution: quality?.resolution || null,
      bandwidth: quality?.bandwidth || null,
      resolutionStrategy: strategyId || null,
      resolutionConfidence: confidence ?? null,
      resolutionEvidence: [...evidence || []]
    };
  }
  function variantQuality(variant = {}) {
    return {
      resolution: variant.resolution || null,
      height: variant.resolution?.height || 0,
      bandwidth: variant.averageBandwidth || variant.bandwidth || 0
    };
  }
  function emptyResolution(relation) {
    return {
      parents: relation.parents,
      children: relation.children,
      resolutionStatus: null,
      resolvedMediaIds: [],
      selectedMediaId: null,
      resolvedStream: null,
      resolvedRequestContext: null,
      resolutionStrategy: null,
      resolutionConfidence: null,
      resolutionEvidence: []
    };
  }
  function edgeStrategy(edge, child) {
    if (edge.kind === "passive_child") {
      return {
        strategyId: edge.metadata?.strategyId || MEDIA_RESOLUTION_STRATEGIES.OBSERVED_CHILD,
        confidence: edge.metadata?.confidence ?? 0.8,
        evidence: [...edge.metadata?.evidence || []]
      };
    }
    if (edge.kind === "redirect") {
      return {
        strategyId: MEDIA_RESOLUTION_STRATEGIES.CAPTURED_RESPONSE,
        confidence: 0.98,
        evidence: ["request-redirect"]
      };
    }
    const childStrategy = itemStrategy(child);
    return {
      ...childStrategy,
      evidence: [...childStrategy.evidence, "master-variant"]
    };
  }
  function itemStrategy(item) {
    if (item.probeSource === "decrypted_blob") {
      return {
        strategyId: MEDIA_RESOLUTION_STRATEGIES.DECRYPTED_MANIFEST,
        confidence: item.manifestEnvelope?.correlationConfidence ?? 0.9,
        evidence: [
          "player-decrypted-manifest",
          ...item.manifestEnvelope?.evidence || []
        ]
      };
    }
    if (item.resolutionAttempt) {
      return {
        strategyId: MEDIA_RESOLUTION_STRATEGIES.BOUNDED_URL_ADAPTER,
        confidence: 0.9,
        evidence: ["validated-url-adapter"]
      };
    }
    const requestContext = chooseRequestContext(item.requestContexts);
    if (requestContext?.transport === "fallback") {
      return {
        strategyId: MEDIA_RESOLUTION_STRATEGIES.CONTEXTUAL_PROBE,
        confidence: 0.9,
        evidence: ["contextual-probe"]
      };
    }
    if (item.playerAdapters?.length || item.detectionSources?.includes("player")) {
      return {
        strategyId: MEDIA_RESOLUTION_STRATEGIES.PLAYER_API,
        confidence: 0.9,
        evidence: ["public-player-api"]
      };
    }
    return {
      strategyId: MEDIA_RESOLUTION_STRATEGIES.CAPTURED_RESPONSE,
      confidence: 1,
      evidence: ["parsed-media-playlist"]
    };
  }
  function qualityFromUrl(value) {
    try {
      const match = /(?:^|[\/_-])(\d{3,4})p(?:[\/_.-]|$)/i.exec(
        new URL(value).pathname
      );
      const height = Number(match?.[1]);
      if (!Number.isInteger(height) || height < 144 || height > 4320) return {};
      return { resolution: { width: null, height } };
    } catch {
      return {};
    }
  }
  function normalizeUrl(value) {
    try {
      return new URL(value).href;
    } catch {
      return typeof value === "string" ? value : "";
    }
  }

  // src/media/catalog.js
  function createMediaCatalog({ maximumPerTab = 50 } = {}) {
    const tabs = /* @__PURE__ */ new Map();
    return Object.freeze({
      add(tabId, rawEvent) {
        assertTabId(tabId);
        const event2 = normalizeRegisteredEvent(rawEvent);
        if (event2.type !== EVENTS.MEDIA_DISCOVERED) {
          throw new Error(`[MediaCatalog] Cannot add event "${event2.type}".`);
        }
        const candidate = event2.payload;
        if (candidate.kind === "direct" && isLikelyMediaSegment(candidate.sourceUrl, candidate.mimeType))
          return null;
        let tabCatalog = tabs.get(tabId);
        if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, candidate.pageUrl)) {
          tabs.delete(tabId);
          tabCatalog = null;
        }
        if (!tabCatalog) {
          tabCatalog = { pageUrl: candidate.pageUrl, items: /* @__PURE__ */ new Map() };
          tabs.set(tabId, tabCatalog);
        }
        const now = event2.timestamp;
        const existing = tabCatalog.items.get(candidate.id);
        const preserveExistingProbe = existing && existing.probeStatus !== MEDIA_PROBE_STATES.DISCOVERED && candidate.probeStatus === MEDIA_PROBE_STATES.DISCOVERED;
        const item = {
          ...existing || {},
          ...candidate,
          ...preserveExistingProbe ? probeFields(existing) : {},
          duration: candidate.duration ?? existing?.duration ?? null,
          requestContexts: mergeRequestContexts(
            existing?.requestContexts,
            candidate.requestContexts,
            now
          ),
          probeCount: existing?.probeCount || 0,
          lastProbeAt: existing?.lastProbeAt || null,
          lastUsableProbeAt: existing?.lastUsableProbeAt || null,
          frameId: normalizedFrameId(event2.metadata?.frameId, existing?.frameId),
          frameUrl: normalizedFrameUrl(event2.metadata?.frameUrl) || existing?.frameUrl || null,
          playerAdapters: uniqueStrings([
            ...existing?.playerAdapters || [],
            event2.metadata?.playerAdapter
          ]),
          detectionSources: uniqueStrings([
            ...existing?.detectionSources || [],
            candidate.detectedBy
          ]),
          firstSeenAt: existing?.firstSeenAt || now,
          lastSeenAt: now
        };
        applyEmeToItem(item, tabCatalog.eme);
        tabCatalog.items.set(candidate.id, item);
        trimOldest(tabCatalog.items, maximumPerTab);
        return cloneItem(item);
      },
      applyProbe(tabId, rawEvent) {
        assertTabId(tabId);
        const event2 = normalizeRegisteredEvent(rawEvent);
        if (event2.type !== EVENTS.MEDIA_PROBED) {
          throw new Error(
            `[MediaCatalog] Cannot apply probe event "${event2.type}".`
          );
        }
        const probe = event2.payload;
        let tabCatalog = tabs.get(tabId);
        if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, probe.pageUrl)) {
          tabs.delete(tabId);
          tabCatalog = null;
        }
        if (!tabCatalog) {
          tabCatalog = { pageUrl: probe.pageUrl, items: /* @__PURE__ */ new Map() };
          tabs.set(tabId, tabCatalog);
        }
        const existing = tabCatalog.items.get(probe.mediaId);
        const base = existing || normalizeMediaCandidate({
          id: probe.mediaId,
          pageUrl: probe.pageUrl,
          manifestUrl: probe.manifestUrl,
          kind: probe.kind,
          detectedBy: MEDIA_DETECTION_SOURCES.NETWORK
        });
        const acceptProbe = !existing || probeQuality(probe) >= probeQuality(existing);
        const acceptedProbe = acceptProbe ? probeFieldsFromProbe(probe) : probeFields(existing);
        const item = {
          ...base,
          ...acceptedProbe,
          requestContexts: mergeRequestContexts(
            existing?.requestContexts,
            probe.requestContext,
            event2.timestamp
          ),
          probeCount: (existing?.probeCount || 0) + 1,
          lastProbeAt: event2.timestamp,
          lastUsableProbeAt: acceptProbe && probeQuality(probe) > 0 ? event2.timestamp : existing?.lastUsableProbeAt || existing?.lastProbeAt || null,
          frameId: normalizedFrameId(event2.metadata?.frameId, existing?.frameId),
          frameUrl: normalizedFrameUrl(event2.metadata?.frameUrl) || existing?.frameUrl || null,
          playerAdapters: [...existing?.playerAdapters || []],
          detectionSources: uniqueStrings([
            ...existing?.detectionSources || [],
            MEDIA_DETECTION_SOURCES.NETWORK
          ]),
          firstSeenAt: existing?.firstSeenAt || event2.timestamp,
          lastSeenAt: event2.timestamp
        };
        applyEmeToItem(item, tabCatalog.eme);
        tabCatalog.items.set(probe.mediaId, item);
        trimOldest(tabCatalog.items, maximumPerTab);
        return cloneItem(item);
      },
      applyProbeDiagnostic(tabId, rawEvent) {
        assertTabId(tabId);
        const event2 = normalizeRegisteredEvent(rawEvent);
        if (event2.type !== EVENTS.MEDIA_PROBE_DIAGNOSTIC) {
          throw new Error(
            `[MediaCatalog] Cannot apply probe diagnostic event "${event2.type}".`
          );
        }
        const diagnostic = event2.payload;
        let tabCatalog = tabs.get(tabId);
        if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, diagnostic.pageUrl)) {
          tabs.delete(tabId);
          tabCatalog = null;
        }
        if (!tabCatalog) {
          tabCatalog = { pageUrl: diagnostic.pageUrl, items: /* @__PURE__ */ new Map() };
          tabs.set(tabId, tabCatalog);
        }
        const existing = tabCatalog.items.get(diagnostic.mediaId);
        const base = existing || normalizeMediaCandidate({
          id: diagnostic.mediaId,
          pageUrl: diagnostic.pageUrl,
          manifestUrl: diagnostic.manifestUrl,
          kind: diagnostic.kind,
          detectedBy: MEDIA_DETECTION_SOURCES.NETWORK
        });
        const probeDiagnostics = mergeProbeDiagnostics(
          existing?.probeDiagnostics,
          diagnostic
        );
        const item = {
          ...base,
          probeDiagnostic: probeDiagnostics[0] || null,
          probeDiagnostics,
          frameId: normalizedFrameId(event2.metadata?.frameId, existing?.frameId),
          frameUrl: normalizedFrameUrl(event2.metadata?.frameUrl) || existing?.frameUrl || null,
          playerAdapters: [...existing?.playerAdapters || []],
          detectionSources: uniqueStrings([
            ...existing?.detectionSources || [],
            MEDIA_DETECTION_SOURCES.NETWORK
          ]),
          probeCount: existing?.probeCount || 0,
          lastProbeAt: existing?.lastProbeAt || null,
          lastUsableProbeAt: existing?.lastUsableProbeAt || null,
          firstSeenAt: existing?.firstSeenAt || event2.timestamp,
          lastSeenAt: event2.timestamp
        };
        applyEmeToItem(item, tabCatalog.eme);
        tabCatalog.items.set(diagnostic.mediaId, item);
        trimOldest(tabCatalog.items, maximumPerTab);
        return cloneItem(item);
      },
      applyBlobTrace(tabId, rawEvent) {
        assertTabId(tabId);
        const event2 = normalizeRegisteredEvent(rawEvent);
        if (event2.type !== EVENTS.MEDIA_BLOB_TRACED) {
          throw new Error(
            `[MediaCatalog] Cannot apply blob trace event "${event2.type}".`
          );
        }
        const trace = event2.payload;
        let tabCatalog = tabs.get(tabId);
        if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, trace.pageUrl)) {
          tabs.delete(tabId);
          tabCatalog = null;
        }
        if (!tabCatalog) {
          tabCatalog = { pageUrl: trace.pageUrl, items: /* @__PURE__ */ new Map() };
          tabs.set(tabId, tabCatalog);
        }
        const existing = tabCatalog.items.get(trace.mediaId);
        const base = existing || normalizeMediaCandidate({
          id: trace.mediaId,
          pageUrl: trace.pageUrl,
          sourceUrl: trace.blobUrl,
          kind: MEDIA_KINDS.BLOB,
          detectedBy: MEDIA_DETECTION_SOURCES.PLAYER
        });
        const blobTrace = mergeBlobTrace(existing?.blobTrace, trace);
        const item = {
          ...base,
          blobTrace,
          frameId: normalizedFrameId(event2.metadata?.frameId, existing?.frameId),
          frameUrl: normalizedFrameUrl(event2.metadata?.frameUrl) || existing?.frameUrl || null,
          playerAdapters: [...existing?.playerAdapters || []],
          detectionSources: uniqueStrings([
            ...existing?.detectionSources || [],
            MEDIA_DETECTION_SOURCES.PLAYER
          ]),
          probeCount: existing?.probeCount || 0,
          lastProbeAt: existing?.lastProbeAt || null,
          lastUsableProbeAt: existing?.lastUsableProbeAt || null,
          firstSeenAt: existing?.firstSeenAt || event2.timestamp,
          lastSeenAt: event2.timestamp
        };
        applyEmeToItem(item, tabCatalog.eme);
        tabCatalog.items.set(trace.mediaId, item);
        trimOldest(tabCatalog.items, maximumPerTab);
        return cloneItem(item);
      },
      applyManifestHandoff(tabId, rawEvent) {
        assertTabId(tabId);
        const event2 = normalizeRegisteredEvent(rawEvent);
        if (event2.type !== EVENTS.MEDIA_MANIFEST_HANDOFF_READY) {
          throw new Error(
            `[MediaCatalog] Cannot apply manifest handoff event "${event2.type}".`
          );
        }
        const handoff = event2.payload;
        const tabCatalog = tabs.get(tabId);
        if (!tabCatalog || !samePageUrl(tabCatalog.pageUrl, handoff.pageUrl))
          return null;
        const existing = tabCatalog.items.get(handoff.mediaId);
        if (!existing || existing.manifestUrl !== handoff.manifestUrl)
          return null;
        const item = {
          ...existing,
          manifestHandoff: { ...handoff },
          lastSeenAt: Math.max(existing.lastSeenAt || 0, event2.timestamp)
        };
        tabCatalog.items.set(handoff.mediaId, item);
        return cloneItem(item);
      },
      applyEme(tabId, rawEvent) {
        assertTabId(tabId);
        const event2 = normalizeRegisteredEvent(rawEvent);
        if (event2.type !== EVENTS.MEDIA_EME_OBSERVED) {
          throw new Error(
            `[MediaCatalog] Cannot apply EME event "${event2.type}".`
          );
        }
        const observation = event2.payload;
        let tabCatalog = tabs.get(tabId);
        if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, observation.pageUrl)) {
          tabs.delete(tabId);
          tabCatalog = null;
        }
        if (!tabCatalog) {
          tabCatalog = {
            pageUrl: observation.pageUrl,
            items: /* @__PURE__ */ new Map(),
            eme: null
          };
          tabs.set(tabId, tabCatalog);
        }
        tabCatalog.eme = mergeEmeMetadata(tabCatalog.eme, observation);
        for (const item of tabCatalog.items.values())
          applyEmeToItem(item, tabCatalog.eme);
        return [...tabCatalog.items.values()].map((item) => cloneItem(item));
      },
      list(tabId, pageUrl = null) {
        assertTabId(tabId);
        const tabCatalog = tabs.get(tabId);
        if (!tabCatalog || pageUrl && !samePageUrl(tabCatalog.pageUrl, pageUrl))
          return [];
        const items = [...tabCatalog.items.values()].sort(
          (left, right) => right.lastSeenAt - left.lastSeenAt
        );
        const resolutions = resolveHlsSources(items);
        const blobResolutions = resolveBlobSources(items, resolutions);
        return items.map(
          (item) => cloneItem(
            item,
            blobResolutions.get(item.id) || resolutions.get(item.id)
          )
        );
      },
      clear(tabId) {
        assertTabId(tabId);
        tabs.delete(tabId);
      },
      clearAll() {
        tabs.clear();
      }
    });
  }
  function probeFields(item) {
    return {
      variants: item.variants,
      iframeVariants: item.iframeVariants,
      audioTracks: item.audioTracks,
      subtitles: item.subtitles,
      drm: item.drm,
      probeStatus: item.probeStatus,
      probeError: item.probeError,
      playlistType: item.playlistType,
      streamType: item.streamType,
      duration: item.duration,
      targetDuration: item.targetDuration,
      segmentCount: item.segmentCount,
      partialSegmentCount: item.partialSegmentCount,
      skippedSegmentCount: item.skippedSegmentCount,
      lowLatency: item.lowLatency,
      mediaSequence: item.mediaSequence,
      discontinuitySequence: item.discontinuitySequence,
      revisionId: item.revisionId,
      probeSource: item.probeSource,
      manifestEnvelope: item.manifestEnvelope,
      resolutionAttempt: item.resolutionAttempt,
      encryptionMethods: item.encryptionMethods,
      encryptionKeyFormats: item.encryptionKeyFormats,
      encryptionScheme: item.encryptionScheme,
      drmSystem: item.drmSystem,
      drmEvidence: item.drmEvidence,
      eme: item.eme
    };
  }
  function probeFieldsFromProbe(probe) {
    return {
      variants: probe.variants,
      iframeVariants: probe.iframeVariants,
      audioTracks: probe.audioTracks,
      subtitles: probe.subtitles,
      drm: probe.drm,
      probeStatus: probe.status,
      probeError: probe.error,
      playlistType: probe.playlistType,
      streamType: probe.streamType,
      duration: probe.duration,
      targetDuration: probe.targetDuration,
      segmentCount: probe.segmentCount,
      partialSegmentCount: probe.partialSegmentCount,
      skippedSegmentCount: probe.skippedSegmentCount,
      lowLatency: probe.lowLatency,
      mediaSequence: probe.mediaSequence,
      discontinuitySequence: probe.discontinuitySequence,
      revisionId: probe.revisionId,
      probeSource: probe.probeSource,
      manifestEnvelope: probe.manifestEnvelope,
      resolutionAttempt: probe.resolutionAttempt,
      encryptionMethods: probe.encryptionMethods,
      encryptionKeyFormats: probe.encryptionKeyFormats,
      encryptionScheme: probe.encryptionScheme,
      drmSystem: probe.drmSystem,
      drmEvidence: probe.drmEvidence
    };
  }
  function probeQuality(value) {
    const status = value.probeStatus || value.status;
    if (status !== MEDIA_PROBE_STATES.READY) return 0;
    if (value.playlistType === "unknown") return 1;
    if (value.playlistType === "master") return value.variants?.length ? 4 : 2;
    if (value.playlistType !== "media") return 1;
    if (value.streamType === "vod" && value.segmentCount > 0) return 5;
    if (value.streamType === "live" && (value.segmentCount > 0 || value.partialSegmentCount > 0))
      return 4;
    return 2;
  }
  function mergeRequestContexts(existing = [], incoming, observedAt) {
    const contexts = [...existing || []];
    const incomingContexts = Array.isArray(incoming) ? incoming : incoming ? [incoming] : [];
    for (const context of incomingContexts) {
      contexts.push({
        ...context,
        observedAt: context.observedAt || observedAt
      });
    }
    const unique = /* @__PURE__ */ new Map();
    for (const context of contexts) {
      const key = [
        context.requestUrl,
        context.finalUrl,
        context.documentUrl,
        context.transport,
        context.credentials
      ].join("\n");
      unique.set(key, context);
    }
    return [...unique.values()].sort((left, right) => (right.observedAt || 0) - (left.observedAt || 0)).slice(0, 8);
  }
  function mergeProbeDiagnostics(existing = [], incoming) {
    const unique = /* @__PURE__ */ new Map();
    for (const diagnostic of [incoming, ...existing || []]) {
      if (!diagnostic) continue;
      const key = [
        diagnostic.phase,
        diagnostic.code,
        diagnostic.httpStatus,
        diagnostic.bodyBytes,
        diagnostic.playlistType,
        diagnostic.segmentCount
      ].join("\n");
      if (!unique.has(key)) unique.set(key, { ...diagnostic });
    }
    return [...unique.values()].sort((left, right) => (right.observedAt || 0) - (left.observedAt || 0)).slice(0, 8);
  }
  function mergeBlobTrace(existing, incoming) {
    return {
      blobUrl: incoming.blobUrl,
      sourceUrls: uniqueStrings([
        ...existing?.sourceUrls || [],
        ...incoming.sourceUrls || []
      ]).slice(-32),
      candidateIds: uniqueStrings([
        ...existing?.candidateIds || [],
        ...incoming.candidateIds || []
      ]).slice(-8),
      mimeTypes: uniqueStrings([
        ...existing?.mimeTypes || [],
        ...incoming.mimeTypes || []
      ]).slice(-8),
      appendCount: Math.max(
        existing?.appendCount || 0,
        incoming.appendCount || 0
      ),
      totalAppendedBytes: Math.max(
        existing?.totalAppendedBytes || 0,
        incoming.totalAppendedBytes || 0
      ),
      observedAt: Math.max(existing?.observedAt || 0, incoming.observedAt || 0)
    };
  }
  function mergeEmeMetadata(existing, observation) {
    return {
      keySystems: uniqueStrings([
        ...existing?.keySystems || [],
        observation.keySystem
      ]).slice(0, 8),
      initDataTypes: uniqueStrings([
        ...existing?.initDataTypes || [],
        observation.initDataType
      ]).slice(0, 8),
      encryptionSchemes: uniqueStrings([
        ...existing?.encryptionSchemes || [],
        ...observation.encryptionSchemes || []
      ]).slice(0, 8),
      keyStatuses: uniqueStrings([
        ...existing?.keyStatuses || [],
        ...observation.keyStatuses || []
      ]).slice(0, 8),
      licenseStatus: observation.licenseStatus || existing?.licenseStatus || null,
      observedAt: Math.max(
        existing?.observedAt || 0,
        observation.observedAt || 0
      )
    };
  }
  function applyEmeToItem(item, eme) {
    if (!eme) return item;
    item.eme = mergeEmeMetadata(item.eme, {
      keySystem: null,
      initDataType: null,
      encryptionSchemes: eme.encryptionSchemes,
      keyStatuses: eme.keyStatuses,
      licenseStatus: eme.licenseStatus,
      observedAt: eme.observedAt
    });
    item.eme.keySystems = uniqueStrings([
      ...item.eme.keySystems || [],
      ...eme.keySystems || []
    ]).slice(0, 8);
    item.eme.initDataTypes = uniqueStrings([
      ...item.eme.initDataTypes || [],
      ...eme.initDataTypes || []
    ]).slice(0, 8);
    const hasCdmEvidence = eme.keySystems?.length > 0 || eme.keyStatuses?.length > 0 || Boolean(eme.licenseStatus);
    if (item.drm === "suspected" && hasCdmEvidence) {
      item.drm = "confirmed";
      item.drmSystem = item.drmSystem || drmSystemFromKeySystems(eme.keySystems);
      item.drmEvidence = uniqueStrings([
        ...item.drmEvidence || [],
        "eme-key-system-access"
      ]);
    }
    return item;
  }
  function drmSystemFromKeySystems(keySystems = []) {
    const value = keySystems.join(" ").toLowerCase();
    if (value.includes("widevine")) return "widevine";
    if (value.includes("playready")) return "playready";
    if (value.includes("apple") || value.includes("fairplay")) return "fairplay";
    if (value.includes("clearkey")) return "clearkey";
    return "unknown";
  }
  function resolveBlobSources(items, adaptiveResolutions) {
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const resolved = /* @__PURE__ */ new Map();
    for (const blob of items.filter((item) => item.kind === MEDIA_KINDS.BLOB)) {
      const candidates = [];
      for (const candidateId of blob.blobTrace?.candidateIds || []) {
        let item = itemsById.get(candidateId);
        const adaptive = adaptiveResolutions.get(candidateId);
        if (adaptive?.selectedMediaId) {
          item = itemsById.get(adaptive.selectedMediaId) || item;
        }
        if (!item || item.kind === MEDIA_KINDS.BLOB) continue;
        candidates.push(item);
      }
      const uniqueCandidates = [
        ...new Map(candidates.map((item) => [item.id, item])).values()
      ].sort(
        (left, right) => blobCandidateScore(right) - blobCandidateScore(left)
      );
      const selected = uniqueCandidates[0];
      if (!selected) continue;
      const selectedResolution = adaptiveResolutions.get(selected.id);
      resolved.set(blob.id, {
        parents: [],
        children: [],
        resolutionStatus: "resolved",
        resolvedMediaIds: uniqueCandidates.map((item) => item.id),
        selectedMediaId: selected.id,
        resolvedKind: selected.kind,
        resolvedStream: selected,
        resolvedRequestContext: selected.resolvedRequestContext || selected.requestContexts?.[0] || null,
        resolutionStrategy: selectedResolution?.resolutionStrategy || null,
        resolutionConfidence: selectedResolution?.resolutionConfidence ?? null,
        resolutionEvidence: [...selectedResolution?.resolutionEvidence || []]
      });
    }
    return resolved;
  }
  function blobCandidateScore(item) {
    if (["suspected", "confirmed"].includes(item.drm)) return -100;
    if (item.kind === MEDIA_KINDS.DIRECT) return 80;
    if (item.probeStatus !== MEDIA_PROBE_STATES.READY) return 10;
    if (item.streamType === "vod") return 70;
    if (item.streamType === "live") return 20;
    return 40;
  }
  function trimOldest(items, maximum) {
    while (items.size > maximum) {
      let oldestId = null;
      let oldestTimestamp = Infinity;
      for (const [id, item] of items) {
        if (item.lastSeenAt < oldestTimestamp) {
          oldestId = id;
          oldestTimestamp = item.lastSeenAt;
        }
      }
      if (!oldestId) return;
      items.delete(oldestId);
    }
  }
  function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === "string"))];
  }
  function cloneItem(item, resolution = null) {
    return {
      ...item,
      variants: item.variants.map((variant) => ({
        ...variant,
        resolution: variant.resolution ? { ...variant.resolution } : null
      })),
      iframeVariants: item.iframeVariants.map((variant) => ({
        ...variant,
        resolution: variant.resolution ? { ...variant.resolution } : null
      })),
      audioTracks: item.audioTracks.map((track) => ({ ...track })),
      subtitles: item.subtitles.map((track) => ({ ...track })),
      detectionSources: [...item.detectionSources],
      playerAdapters: [...item.playerAdapters || []],
      encryptionMethods: [...item.encryptionMethods || []],
      encryptionKeyFormats: [...item.encryptionKeyFormats || []],
      drmEvidence: [...item.drmEvidence || []],
      eme: item.eme ? {
        ...item.eme,
        keySystems: [...item.eme.keySystems || []],
        initDataTypes: [...item.eme.initDataTypes || []],
        encryptionSchemes: [...item.eme.encryptionSchemes || []],
        keyStatuses: [...item.eme.keyStatuses || []]
      } : null,
      requestContexts: (item.requestContexts || []).map((context) => ({
        ...context
      })),
      probeDiagnostic: item.probeDiagnostic ? { ...item.probeDiagnostic } : null,
      probeDiagnostics: (item.probeDiagnostics || []).map((diagnostic) => ({
        ...diagnostic
      })),
      resolutionAttempt: item.resolutionAttempt ? {
        ...item.resolutionAttempt,
        evidence: [...item.resolutionAttempt.evidence || []]
      } : null,
      manifestEnvelope: item.manifestEnvelope ? {
        ...item.manifestEnvelope,
        evidence: [...item.manifestEnvelope.evidence || []]
      } : null,
      manifestHandoff: item.manifestHandoff ? { ...item.manifestHandoff } : null,
      blobTrace: item.blobTrace ? {
        ...item.blobTrace,
        sourceUrls: [...item.blobTrace.sourceUrls || []],
        candidateIds: [...item.blobTrace.candidateIds || []],
        mimeTypes: [...item.blobTrace.mimeTypes || []]
      } : null,
      parentManifestIds: [...resolution?.parents || []],
      childManifestIds: [...resolution?.children || []],
      resolutionStatus: resolution?.resolutionStatus || null,
      resolvedMediaIds: [...resolution?.resolvedMediaIds || []],
      selectedMediaId: resolution?.selectedMediaId || null,
      resolvedKind: resolution?.resolvedKind || null,
      resolvedStream: resolution?.resolvedStream ? {
        ...resolution.resolvedStream,
        resolution: resolution.resolvedStream.resolution ? { ...resolution.resolvedStream.resolution } : null,
        encryptionMethods: [
          ...resolution.resolvedStream.encryptionMethods || []
        ],
        encryptionKeyFormats: [
          ...resolution.resolvedStream.encryptionKeyFormats || []
        ],
        drmEvidence: [...resolution.resolvedStream.drmEvidence || []],
        resolutionEvidence: [
          ...resolution.resolvedStream.resolutionEvidence || []
        ]
      } : null,
      resolvedRequestContext: resolution?.resolvedRequestContext ? { ...resolution.resolvedRequestContext } : null,
      resolutionStrategy: resolution?.resolutionStrategy || null,
      resolutionConfidence: resolution?.resolutionConfidence ?? null,
      resolutionEvidence: [...resolution?.resolutionEvidence || []]
    };
  }
  function assertTabId(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new Error("[MediaCatalog] A valid tab ID is required.");
    }
  }
  function samePageUrl(left, right) {
    try {
      const leftUrl = new URL(left);
      const rightUrl = new URL(right);
      leftUrl.hash = "";
      rightUrl.hash = "";
      return leftUrl.href === rightUrl.href;
    } catch {
      return left === right;
    }
  }
  function normalizedFrameId(value, fallback = null) {
    return Number.isInteger(value) && value >= 0 ? value : fallback ?? null;
  }
  function normalizedFrameUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  // src/media/storage-keys.js
  var MEDIA_CATALOG_SESSION_PREFIX = "adsfriendly.mediaCatalog.";
  function mediaCatalogSessionKey(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new Error("[MediaCatalog] A valid tab ID is required.");
    }
    return `${MEDIA_CATALOG_SESSION_PREFIX}${tabId}`;
  }

  // src/background/media-catalog.js
  var catalog = createMediaCatalog();
  var active = false;
  async function startBackgroundMediaCatalog() {
    await hydrateCatalog().catch(() => {
    });
    active = true;
    const onRemoved = (tabId) => clearTab(tabId).catch(() => {
    });
    const onUpdated = (tabId, changeInfo) => {
      if (!changeInfo.url) return;
      const currentPageUrl = catalog.list(tabId)[0]?.pageUrl;
      if (currentPageUrl && sameDocumentExceptHash(currentPageUrl, changeInfo.url))
        return;
      clearTab(tabId).catch(() => {
      });
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return async () => {
      active = false;
      catalog.clearAll();
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      await clearSessionCatalog().catch(() => {
      });
    };
  }
  async function recordDiscoveredMedia(tabId, event2) {
    if (!active) return { status: "catalog_disabled" };
    const item = catalog.add(tabId, event2);
    await persistTab(tabId).catch(() => {
    });
    return { status: "recorded", item };
  }
  async function recordMediaProbe(tabId, event2) {
    if (!active) return { status: "catalog_disabled" };
    const item = catalog.applyProbe(tabId, event2);
    await persistTab(tabId).catch(() => {
    });
    return { status: "recorded", item };
  }
  async function recordMediaProbeDiagnostic(tabId, event2) {
    if (!active) return { status: "catalog_disabled" };
    const item = catalog.applyProbeDiagnostic(tabId, event2);
    await persistTab(tabId).catch(() => {
    });
    return { status: "recorded", item };
  }
  async function recordBlobSourceTrace(tabId, event2) {
    if (!active) return { status: "catalog_disabled" };
    const item = catalog.applyBlobTrace(tabId, event2);
    await persistTab(tabId).catch(() => {
    });
    return { status: "recorded", item };
  }
  async function recordMediaManifestHandoff(tabId, event2) {
    if (!active) return { status: "catalog_disabled" };
    const item = catalog.applyManifestHandoff(tabId, event2);
    if (!item) return { status: "catalog_pending" };
    await persistTab(tabId).catch(() => {
    });
    return { status: "recorded", item };
  }
  async function recordMediaEmeObservation(tabId, event2) {
    if (!active) return { status: "catalog_disabled" };
    const items = catalog.applyEme(tabId, event2);
    await persistTab(tabId).catch(() => {
    });
    return { status: "recorded", items };
  }
  async function listDiscoveredMedia(tabId, pageUrl = null) {
    if (!active) return { status: "catalog_disabled", items: [] };
    return { status: "ok", items: catalog.list(tabId, pageUrl) };
  }
  async function hydrateCatalog() {
    const storage = chrome.storage.session;
    if (!storage) return;
    const snapshot = await storage.get(null);
    for (const [key, items] of Object.entries(snapshot)) {
      if (!key.startsWith(MEDIA_CATALOG_SESSION_PREFIX) || !Array.isArray(items))
        continue;
      const tabId = Number(key.slice(MEDIA_CATALOG_SESSION_PREFIX.length));
      if (!Number.isInteger(tabId)) continue;
      for (const item of items) {
        if (item.kind === "direct" && isLikelyMediaSegment(item.sourceUrl, item.mimeType))
          continue;
        const sources = item.detectionSources?.length ? item.detectionSources : [item.detectedBy];
        for (const detectedBy of sources) {
          try {
            catalog.add(tabId, {
              ...createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, {
                ...item,
                detectedBy
              }),
              timestamp: item.lastSeenAt || Date.now(),
              metadata: {
                frameId: item.frameId ?? null,
                frameUrl: item.frameUrl || null,
                playerAdapter: item.playerAdapters?.[0] || null
              }
            });
          } catch {
          }
        }
        for (const diagnostic of item.probeDiagnostics || []) {
          try {
            catalog.applyProbeDiagnostic(tabId, {
              ...createRegisteredEvent(EVENTS.MEDIA_PROBE_DIAGNOSTIC, diagnostic),
              timestamp: diagnostic.observedAt || item.lastSeenAt || Date.now(),
              metadata: {
                frameId: item.frameId ?? null,
                frameUrl: item.frameUrl || null
              }
            });
          } catch {
          }
        }
        if (item.kind === "blob" && item.blobTrace) {
          try {
            catalog.applyBlobTrace(
              tabId,
              createRegisteredEvent(EVENTS.MEDIA_BLOB_TRACED, {
                mediaId: item.id,
                pageUrl: item.pageUrl,
                blobUrl: item.sourceUrl,
                ...item.blobTrace
              })
            );
          } catch {
          }
        }
        if (item.manifestHandoff) {
          try {
            catalog.applyManifestHandoff(
              tabId,
              createRegisteredEvent(EVENTS.MEDIA_MANIFEST_HANDOFF_READY, {
                ...item.manifestHandoff,
                mediaId: item.id,
                pageUrl: item.pageUrl,
                manifestUrl: item.manifestUrl,
                kind: item.kind
              })
            );
          } catch {
          }
        }
      }
      const cleanedItems = catalog.list(tabId);
      if (cleanedItems.length) await storage.set({ [key]: cleanedItems });
      else await storage.remove(key);
    }
  }
  async function persistTab(tabId) {
    const storage = chrome.storage.session;
    if (!storage) return;
    await storage.set({ [mediaCatalogSessionKey(tabId)]: catalog.list(tabId) });
  }
  async function clearTab(tabId) {
    catalog.clear(tabId);
    if (chrome.storage.session)
      await chrome.storage.session.remove(mediaCatalogSessionKey(tabId));
  }
  async function clearSessionCatalog() {
    const storage = chrome.storage.session;
    if (!storage) return;
    const snapshot = await storage.get(null);
    const keys = Object.keys(snapshot).filter(
      (key) => key.startsWith(MEDIA_CATALOG_SESSION_PREFIX)
    );
    if (keys.length) await storage.remove(keys);
  }
  function sameDocumentExceptHash(left, right) {
    try {
      const leftUrl = new URL(left);
      const rightUrl = new URL(right);
      leftUrl.hash = "";
      rightUrl.hash = "";
      return leftUrl.href === rightUrl.href;
    } catch {
      return left === right;
    }
  }

  // src/runtime/action-catalog.js
  var ACTIONS = Object.freeze({
    MEDIA_DOWNLOAD_CANCEL: "media.download.cancel",
    MEDIA_DOWNLOAD_CREATE: "media.download.create",
    MEDIA_DOWNLOAD_PAUSE: "media.download.pause",
    MEDIA_DOWNLOAD_OPEN: "media.download.open",
    MEDIA_DOWNLOAD_CLEAR_HISTORY: "media.download.clear_history",
    MEDIA_DOWNLOAD_REMOVE_HISTORY: "media.download.remove_history",
    MEDIA_DOWNLOAD_REVEAL: "media.download.reveal",
    MEDIA_DOWNLOAD_RESUME: "media.download.resume",
    MEDIA_DOWNLOAD_RETRY: "media.download.retry",
    VIDEO_ACCELERATE_AUTOMATIC: "video.accelerate.automatic",
    VIDEO_ACCELERATE_USER: "video.accelerate.user",
    VIDEO_RESTORE_PLAYBACK: "video.restore_playback",
    VIDEO_SKIP_AUTOMATIC: "video.skip.automatic"
  });
  var A = ACTIONS;
  var C3 = CAPABILITIES;
  var ACTION_CATALOG = Object.freeze({
    [A.MEDIA_DOWNLOAD_CANCEL]: action(
      A.MEDIA_DOWNLOAD_CANCEL,
      "background.media-download-jobs",
      C3.MEDIA_NATIVE_DOWNLOAD
    ),
    [A.MEDIA_DOWNLOAD_CREATE]: action(
      A.MEDIA_DOWNLOAD_CREATE,
      "background.media-download-jobs",
      C3.MEDIA_NATIVE_DOWNLOAD
    ),
    [A.MEDIA_DOWNLOAD_PAUSE]: action(
      A.MEDIA_DOWNLOAD_PAUSE,
      "background.media-download-jobs",
      C3.MEDIA_NATIVE_DOWNLOAD
    ),
    [A.MEDIA_DOWNLOAD_OPEN]: action(
      A.MEDIA_DOWNLOAD_OPEN,
      "background.media-download-jobs",
      C3.MEDIA_NATIVE_DOWNLOAD
    ),
    [A.MEDIA_DOWNLOAD_CLEAR_HISTORY]: action(
      A.MEDIA_DOWNLOAD_CLEAR_HISTORY,
      "background.media-download-jobs",
      C3.MEDIA_NATIVE_DOWNLOAD
    ),
    [A.MEDIA_DOWNLOAD_REMOVE_HISTORY]: action(
      A.MEDIA_DOWNLOAD_REMOVE_HISTORY,
      "background.media-download-jobs",
      C3.MEDIA_NATIVE_DOWNLOAD
    ),
    [A.MEDIA_DOWNLOAD_REVEAL]: action(
      A.MEDIA_DOWNLOAD_REVEAL,
      "background.media-download-jobs",
      C3.MEDIA_NATIVE_DOWNLOAD
    ),
    [A.MEDIA_DOWNLOAD_RESUME]: action(
      A.MEDIA_DOWNLOAD_RESUME,
      "background.media-download-jobs",
      C3.MEDIA_NATIVE_DOWNLOAD
    ),
    [A.MEDIA_DOWNLOAD_RETRY]: action(
      A.MEDIA_DOWNLOAD_RETRY,
      "background.media-download-jobs",
      C3.MEDIA_NATIVE_DOWNLOAD
    ),
    [A.VIDEO_ACCELERATE_AUTOMATIC]: action(
      A.VIDEO_ACCELERATE_AUTOMATIC,
      "video.surgeon",
      C3.VIDEO_AUTO_ACTION
    ),
    [A.VIDEO_ACCELERATE_USER]: action(
      A.VIDEO_ACCELERATE_USER,
      "video.surgeon",
      C3.VIDEO_USER_ACTION
    ),
    [A.VIDEO_RESTORE_PLAYBACK]: action(
      A.VIDEO_RESTORE_PLAYBACK,
      "video.surgeon",
      C3.VIDEO_RESTORE_STATE
    ),
    [A.VIDEO_SKIP_AUTOMATIC]: action(
      A.VIDEO_SKIP_AUTOMATIC,
      "video.surgeon",
      C3.VIDEO_AUTO_ACTION
    )
  });
  validateActionCatalog();
  function getActionDefinition(actionId) {
    const definition = ACTION_CATALOG[actionId];
    if (!definition) {
      throw new Error(
        `[ActionRegistry] Unknown action "${actionId}". Register it in action-catalog.js before use.`
      );
    }
    return definition;
  }
  function getActionsForFeature(featureId) {
    getFeatureDefinition(featureId);
    return Object.values(ACTION_CATALOG).filter(
      (definition) => definition.featureId === featureId
    );
  }
  function action(id, featureId, capability2) {
    return Object.freeze({ id, featureId, capability: capability2 });
  }
  function validateActionCatalog() {
    const actionIds = Object.values(ACTIONS);
    if (new Set(actionIds).size !== actionIds.length) {
      throw new Error("[ActionRegistry] Duplicate action ID.");
    }
    for (const actionId of actionIds) {
      const definition = ACTION_CATALOG[actionId];
      if (!definition || definition.id !== actionId) {
        throw new Error(
          `[ActionRegistry] Action "${actionId}" has no metadata definition.`
        );
      }
      const feature2 = getFeatureDefinition(definition.featureId);
      getCapabilityDefinition(definition.capability);
      if (!feature2.capabilities.includes(definition.capability)) {
        throw new Error(
          `[ActionRegistry] Action "${actionId}" uses capability "${definition.capability}" not declared by feature "${feature2.id}".`
        );
      }
    }
  }

  // src/runtime/action-broker.js
  function createActionBroker({
    featureId,
    policy,
    handlers,
    permissionChecker = hasBrowserPermissions
  }) {
    const declaredActions = getActionsForFeature(featureId);
    const declaredIds = new Set(declaredActions.map((action2) => action2.id));
    for (const action2 of declaredActions) {
      if (typeof handlers[action2.id] !== "function") {
        throw new Error(
          `[ActionBroker] Feature "${featureId}" has no handler for registered action "${action2.id}".`
        );
      }
    }
    for (const actionId of Object.keys(handlers)) {
      const action2 = getActionDefinition(actionId);
      if (action2.featureId !== featureId || !declaredIds.has(actionId)) {
        throw new Error(
          `[ActionBroker] Feature "${featureId}" cannot handle action "${actionId}" owned by "${action2.featureId}".`
        );
      }
    }
    return Object.freeze({
      featureId,
      can(actionId) {
        const action2 = requireOwnedAction(actionId, featureId);
        return policy.can(action2.capability);
      },
      async execute(actionId, payload) {
        const action2 = requireOwnedAction(actionId, featureId);
        policy.require(action2.capability);
        const capability2 = getCapabilityDefinition(action2.capability);
        if (capability2.browserPermissions.length > 0 && !await permissionChecker(capability2.browserPermissions)) {
          throw new Error(
            `[ActionBroker] Action "${actionId}" requires browser permissions: ${capability2.browserPermissions.join(", ")}.`
          );
        }
        return handlers[actionId](payload);
      }
    });
  }
  function requireOwnedAction(actionId, featureId) {
    const action2 = getActionDefinition(actionId);
    if (action2.featureId !== featureId) {
      throw new Error(
        `[ActionBroker] Feature "${featureId}" cannot execute action "${actionId}" owned by "${action2.featureId}".`
      );
    }
    return action2;
  }
  async function hasBrowserPermissions(permissions) {
    if (!permissions.length) return true;
    if (typeof chrome === "undefined" || !chrome.permissions?.contains)
      return false;
    return chrome.permissions.contains({ permissions });
  }

  // src/runtime/settings-store.js
  var SETTINGS_KEY = "appSettings";
  var DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    protectionMode: PROTECTION_MODES.SAFE,
    featureOverrides: Object.freeze({}),
    mediaDownloadConnections: 8
  });
  function normalizeSettings(value = {}) {
    const protectionMode = Object.values(PROTECTION_MODES).includes(
      value.protectionMode
    ) ? value.protectionMode : DEFAULT_SETTINGS.protectionMode;
    return {
      enabled: value.enabled !== false,
      protectionMode,
      featureOverrides: value.featureOverrides && typeof value.featureOverrides === "object" ? { ...value.featureOverrides } : {},
      mediaDownloadConnections: normalizeMediaDownloadConnections(
        value.mediaDownloadConnections
      )
    };
  }
  function normalizeMediaDownloadConnections(value) {
    const connections = Number(
      value ?? DEFAULT_SETTINGS.mediaDownloadConnections
    );
    return [4, 8, 12, 16].includes(connections) ? connections : DEFAULT_SETTINGS.mediaDownloadConnections;
  }
  function migrateLegacySettings(stored = {}) {
    if (stored[SETTINGS_KEY]) return normalizeSettings(stored[SETTINGS_KEY]);
    const protectionMode = stored.friendlyMode === false ? PROTECTION_MODES.AUTO : PROTECTION_MODES.SAFE;
    return normalizeSettings({
      enabled: stored.isEnabled !== false,
      protectionMode
    });
  }
  async function loadSettings(storage = chrome.storage.local, { persistMissing = false } = {}) {
    const stored = await storage.get([SETTINGS_KEY, "isEnabled", "friendlyMode"]);
    const settings = migrateLegacySettings(stored);
    if (!stored[SETTINGS_KEY] && persistMissing) {
      await storage.set({ [SETTINGS_KEY]: settings });
    }
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

  // src/media/download-job-contract.js
  var DOWNLOAD_JOB_PREFIX = "adsfriendly.mediaDownloadJob.";
  var DOWNLOAD_HISTORY_KEY = "mediaDownloadHistory";
  var DOWNLOAD_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
  function normalizeMediaDownloadJob(value = {}) {
    const candidate = value.candidate;
    if (!candidate || !["direct", "hls", "dash"].includes(candidate.kind)) {
      throw new Error("[MediaDownload] Direct, HLS, or DASH candidate required.");
    }
    const shared = {
      id: requiredString2(candidate.id, "candidate.id"),
      pageUrl: requiredHttpUrl(candidate.pageUrl, "candidate.pageUrl"),
      kind: candidate.kind,
      title: optionalString2(candidate.title),
      mimeType: optionalString2(candidate.mimeType),
      drm: candidate.drm || "none",
      drmSystem: candidate.drmSystem || null,
      drmEvidence: stringArray(candidate.drmEvidence),
      encryptionScheme: candidate.encryptionScheme || "none"
    };
    return {
      id: requiredString2(value.id, "id"),
      createdAt: finiteNumber(value.createdAt, "createdAt"),
      sourceTabId: nonNegativeInteger(value.sourceTabId, "sourceTabId"),
      candidate: candidate.kind === "direct" ? {
        ...shared,
        sourceUrl: requiredHttpUrl(
          candidate.sourceUrl,
          "candidate.sourceUrl"
        )
      } : {
        ...shared,
        manifestUrl: requiredHttpUrl(
          candidate.manifestUrl,
          "candidate.manifestUrl"
        ),
        probeStatus: candidate.probeStatus,
        playlistType: candidate.playlistType,
        streamType: candidate.streamType,
        drm: candidate.drm || "none",
        encryptionMethods: stringArray(candidate.encryptionMethods),
        encryptionKeyFormats: stringArray(candidate.encryptionKeyFormats),
        variants: objectArray(candidate.variants),
        iframeVariants: objectArray(candidate.iframeVariants),
        audioTracks: objectArray(candidate.audioTracks),
        subtitles: objectArray(candidate.subtitles),
        duration: optionalFiniteNumber2(candidate.duration),
        segmentCount: optionalNonNegativeInteger2(candidate.segmentCount),
        partialSegmentCount: optionalNonNegativeInteger2(
          candidate.partialSegmentCount
        ),
        skippedSegmentCount: optionalNonNegativeInteger2(
          candidate.skippedSegmentCount
        ),
        lowLatency: candidate.lowLatency === true,
        probeSource: candidate.probeSource === "decrypted_blob" ? "decrypted_blob" : candidate.probeSource || null,
        manifestHandoff: normalizeDownloadManifestHandoff(
          candidate.manifestHandoff,
          candidate
        ),
        requestContext: normalizeDownloadRequestContext(
          candidate.resolvedRequestContext || candidate.requestContext
        )
      }
    };
  }
  function normalizeDownloadManifestHandoff(value, candidate) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const body = typeof value.body === "string" ? value.body : "";
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (!body || bodyBytes > 512 * 1024)
      throw new Error("[MediaDownload] Invalid decrypted manifest handoff.");
    const manifestUrl = requiredHttpUrl(
      value.manifestUrl,
      "candidate.manifestHandoff.manifestUrl"
    );
    if (manifestUrl !== candidate.manifestUrl || value.kind !== candidate.kind || Number(value.expiresAt) <= Date.now()) {
      throw new Error("[MediaDownload] Decrypted manifest handoff expired.");
    }
    return {
      kind: value.kind,
      manifestUrl,
      body,
      bodyBytes,
      revisionId: optionalString2(value.revisionId),
      expiresAt: Number(value.expiresAt)
    };
  }
  function downloadJobKey(jobId) {
    return `${DOWNLOAD_JOB_PREFIX}${requiredString2(jobId, "jobId")}`;
  }
  function getMediaDownloadAvailability(candidate = {}) {
    if (candidate.kind === "direct") {
      try {
        requiredHttpUrl(candidate.sourceUrl, "candidate.sourceUrl");
      } catch {
        return { supported: false, reason: "Direct media URL is not ready." };
      }
      if (candidate.drm === "suspected" || candidate.drm === "confirmed")
        return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
      return { supported: true, reason: null };
    }
    if (candidate.kind === "dash") {
      if (candidate.probeStatus !== "ready")
        return { supported: false, reason: "DASH manifest is not ready." };
      if (candidate.drm === "suspected" || candidate.drm === "confirmed")
        return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
      if (candidate.streamType === "live")
        return { supported: false, reason: "Live DASH is not supported yet." };
      if (candidate.streamType !== "vod")
        return { supported: false, reason: "Unknown DASH stream type." };
      if (!candidate.variants?.length && !candidate.audioTracks?.length)
        return { supported: false, reason: "DASH manifest has no media tracks." };
      return { supported: true, reason: null };
    }
    if (candidate.kind !== "hls")
      return {
        supported: false,
        reason: "This media type is not supported yet."
      };
    if (candidate.probeStatus !== "ready")
      return { supported: false, reason: "Manifest is not ready." };
    if (candidate.probeSource === "decrypted_blob" && !hasCurrentManifestHandoff(candidate))
      return {
        supported: false,
        reason: "Player-decrypted manifest found; secure download handoff is not ready yet."
      };
    if (candidate.drm === "suspected" || candidate.drm === "confirmed")
      return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
    if (candidate.encryptionMethods?.length && !isDownloadableAes128(candidate))
      return { supported: false, reason: "Encrypted HLS is not supported yet." };
    if (candidate.playlistType === "unknown")
      return {
        supported: false,
        reason: "HLS endpoint has not exposed a media playlist yet."
      };
    if (candidate.playlistType === "media" && candidate.streamType === "unknown")
      return {
        supported: false,
        reason: "HLS media playlist is waiting for segments."
      };
    if (candidate.playlistType === "media" && candidate.streamType === "live")
      return { supported: false, reason: "Live HLS is not supported yet." };
    if (candidate.playlistType === "media" && candidate.streamType === "vod" && !candidate.segmentCount)
      return { supported: false, reason: "HLS VOD has no media segments." };
    if (candidate.playlistType === "master" && !candidate.variants?.length)
      return { supported: false, reason: "No quality variants found." };
    if (!["master", "media"].includes(candidate.playlistType))
      return { supported: false, reason: "Unknown HLS playlist type." };
    return { supported: true, reason: null };
  }
  function hasCurrentManifestHandoff(candidate) {
    return candidate.manifestHandoff?.mediaId === candidate.id && candidate.manifestHandoff?.manifestUrl === candidate.manifestUrl && Number(candidate.manifestHandoff?.expiresAt) > Date.now();
  }
  function isDownloadableAes128(candidate) {
    const methods = candidate.encryptionMethods || [];
    const formats = candidate.encryptionKeyFormats || [];
    return methods.length > 0 && methods.every((method) => String(method).toUpperCase() === "AES-128") && formats.every((format) => String(format).toLowerCase() === "identity");
  }
  function drmPlaybackOnlyReason(candidate) {
    const state = candidate.drm === "confirmed" ? "confirmed" : "suspected";
    const system = candidate.drmSystem ? ` \xB7 ${formatDrmSystem(candidate.drmSystem)}` : "";
    return `DRM ${state}${system} \xB7 Playback only.`;
  }
  function formatDrmSystem(value) {
    return value === "widevine" ? "Widevine" : value === "playready" ? "PlayReady" : value === "fairplay" ? "FairPlay" : value === "clearkey" ? "Clear Key" : "Unknown system";
  }
  function requiredString2(value, field) {
    if (typeof value !== "string" || !value.trim())
      throw new Error(`[MediaDownload] ${field} is required.`);
    return value;
  }
  function requiredHttpUrl(value, field) {
    const url = requiredString2(value, field);
    try {
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
    } catch {
      throw new Error(`[MediaDownload] ${field} must be an HTTP(S) URL.`);
    }
    return url;
  }
  function finiteNumber(value, field) {
    const number = Number(value);
    if (!Number.isFinite(number))
      throw new Error(`[MediaDownload] ${field} must be finite.`);
    return number;
  }
  function nonNegativeInteger(value, field) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0)
      throw new Error(`[MediaDownload] ${field} must be non-negative.`);
    return number;
  }
  function optionalString2(value) {
    return typeof value === "string" && value ? value : null;
  }
  function optionalFiniteNumber2(value) {
    if (value === null || value === void 0) return null;
    return finiteNumber(value, "optional number");
  }
  function optionalNonNegativeInteger2(value) {
    if (value === null || value === void 0) return null;
    return nonNegativeInteger(value, "optional integer");
  }
  function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, 20) : [];
  }
  function objectArray(value) {
    return Array.isArray(value) ? value.filter((item) => item && typeof item === "object").slice(0, 100).map((item) => ({ ...item })) : [];
  }
  function normalizeDownloadRequestContext(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      requestUrl: optionalString2(value.requestUrl),
      finalUrl: optionalString2(value.finalUrl),
      documentUrl: optionalString2(value.documentUrl),
      parentDocumentUrl: optionalString2(value.parentDocumentUrl),
      referrer: optionalString2(value.referrer),
      method: typeof value.method === "string" ? value.method : "GET",
      credentials: ["omit", "same-origin", "include", "unknown"].includes(
        value.credentials
      ) ? value.credentials : "unknown",
      requiresBrowserSession: value.requiresBrowserSession === true
    };
  }

  // src/media/helper-contract.js
  var MEDIA_HELPER_PROTOCOL_VERSION = 2;
  var MEDIA_HELPER_HOST_NAME = "com.adsfriendly.media_helper";
  var MEDIA_HELPER_REQUESTS = Object.freeze({
    HELLO: "helper.hello",
    GET_CAPABILITIES: "helper.capabilities.get",
    DOWNLOAD_START: "download.start",
    DOWNLOAD_CANCEL: "download.cancel",
    OUTPUT_OPEN: "output.open",
    OUTPUT_REVEAL: "output.reveal"
  });
  var MEDIA_HELPER_EVENTS = Object.freeze({
    READY: "helper.ready",
    CAPABILITIES: "helper.capabilities",
    DOWNLOAD_STARTED: "download.started",
    DOWNLOAD_PROGRESS: "download.progress",
    DOWNLOAD_COMPLETED: "download.completed",
    DOWNLOAD_CANCELLED: "download.cancelled",
    OUTPUT_OPENED: "output.opened",
    ERROR: "helper.error"
  });
  var MEDIA_HELPER_CAPABILITIES = Object.freeze({
    DIRECT_HTTP_DOWNLOAD: "download.direct_http",
    HLS_VOD_DOWNLOAD: "download.hls_vod",
    HLS_DECRYPTED_MANIFEST: "download.hls_decrypted_manifest",
    DASH_VOD_DOWNLOAD: "download.dash_vod",
    FFMPEG_MUX: "mux.ffmpeg",
    OUTPUT_OPEN: "output.open",
    OUTPUT_REVEAL: "output.reveal"
  });
  function normalizeHelperEvent(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("[MediaHelperProtocol] Event must be an object.");
    }
    if (!Object.values(MEDIA_HELPER_EVENTS).includes(value.type)) {
      throw new Error(
        `[MediaHelperProtocol] Unknown event type "${value.type || ""}".`
      );
    }
    if (typeof value.requestId !== "string" || !value.requestId.trim()) {
      throw new Error("[MediaHelperProtocol] requestId is required.");
    }
    return {
      type: value.type,
      requestId: value.requestId.trim(),
      protocolVersion: normalizeProtocolVersion(value.protocolVersion),
      payload: value.payload && typeof value.payload === "object" && !Array.isArray(value.payload) ? { ...value.payload } : {}
    };
  }
  function normalizeProtocolVersion(value) {
    const version = Number(value);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("[MediaHelperProtocol] Invalid protocol version.");
    }
    return version;
  }

  // src/background/media-helper-bridge.js
  var DEFAULT_TIMEOUT_MS = 8e3;
  var STATUS_CACHE_MS = 15e3;
  var FAILED_STATUS_CACHE_MS = 2e3;
  var cachedStatus = null;
  var cachedAt = 0;
  var statusPromise = null;
  var activePorts = /* @__PURE__ */ new Map();
  var historyWriteChain = Promise.resolve();
  var MEDIA_HELPER_STATES = Object.freeze({
    PERMISSION_REQUIRED: "permission_required",
    NOT_INSTALLED: "not_installed",
    READY: "ready",
    INCOMPATIBLE: "incompatible",
    UNAVAILABLE: "unavailable"
  });
  async function getMediaHelperStatus({
    force = false,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}) {
    const cacheDuration = cachedStatus?.status === MEDIA_HELPER_STATES.READY ? STATUS_CACHE_MS : FAILED_STATUS_CACHE_MS;
    if (!force && cachedStatus && Date.now() - cachedAt < cacheDuration) {
      return cachedStatus;
    }
    if (!force && statusPromise) return statusPromise;
    statusPromise = probeMediaHelperStatus(timeoutMs);
    try {
      cachedStatus = await statusPromise;
      cachedAt = Date.now();
      return cachedStatus;
    } finally {
      statusPromise = null;
    }
  }
  async function probeMediaHelperStatus(timeoutMs) {
    if (!await hasNativeMessagingPermission()) {
      return helperStatus(MEDIA_HELPER_STATES.PERMISSION_REQUIRED);
    }
    const requestId = randomId4();
    try {
      const response = normalizeHelperEvent(
        await withTimeout(
          chrome.runtime.sendNativeMessage(MEDIA_HELPER_HOST_NAME, {
            type: MEDIA_HELPER_REQUESTS.HELLO,
            requestId,
            protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
            payload: { extensionVersion: chrome.runtime.getManifest().version }
          }),
          timeoutMs
        )
      );
      if (response.requestId !== requestId) {
        throw new Error("Media Helper returned a mismatched request ID.");
      }
      if (response.protocolVersion !== MEDIA_HELPER_PROTOCOL_VERSION) {
        return helperStatus(MEDIA_HELPER_STATES.INCOMPATIBLE, {
          error: `Protocol ${response.protocolVersion} is not supported.`
        });
      }
      if (response.type === MEDIA_HELPER_EVENTS.ERROR) {
        return helperStatus(MEDIA_HELPER_STATES.UNAVAILABLE, {
          error: response.payload.message || "Media Helper reported an error."
        });
      }
      if (response.type !== MEDIA_HELPER_EVENTS.READY) {
        throw new Error(`Unexpected Media Helper event: ${response.type}.`);
      }
      const capabilities = normalizeCapabilities(response.payload.capabilities);
      return helperStatus(MEDIA_HELPER_STATES.READY, {
        helperVersion: stringOrNull(response.payload.helperVersion),
        capabilities,
        canDownloadDirect: capabilities[MEDIA_HELPER_CAPABILITIES.DIRECT_HTTP_DOWNLOAD] === true,
        canDownloadHls: capabilities[MEDIA_HELPER_CAPABILITIES.HLS_VOD_DOWNLOAD] === true,
        canDownloadDecryptedHls: capabilities[MEDIA_HELPER_CAPABILITIES.HLS_DECRYPTED_MANIFEST] === true,
        canDownloadDash: capabilities[MEDIA_HELPER_CAPABILITIES.DASH_VOD_DOWNLOAD] === true,
        canMuxWithFfmpeg: capabilities[MEDIA_HELPER_CAPABILITIES.FFMPEG_MUX] === true
      });
    } catch (error) {
      const message = messageOf(error);
      return helperStatus(classifyNativeMessagingError(message), {
        error: message
      });
    }
  }
  async function startMediaHelperDownload(rawJob, { connections = 8, attempt = 1 } = {}) {
    if (!await hasNativeMessagingPermission()) {
      throw new Error("Native Messaging permission is required.");
    }
    const job = normalizeMediaDownloadJob(rawJob);
    const previousConnection = activePorts.get(job.id);
    if (previousConnection && !previousConnection.terminal)
      throw new Error("Download job is already active.");
    if (previousConnection) {
      activePorts.delete(job.id);
      previousConnection.port.disconnect();
    }
    const requestId = randomId4();
    const port = chrome.runtime.connectNative(MEDIA_HELPER_HOST_NAME);
    const state = {
      id: job.id,
      mediaId: job.candidate.id,
      kind: job.candidate.kind,
      title: job.candidate.title,
      sourceTabId: job.sourceTabId,
      candidate: withoutManifestBody(job.candidate),
      connections,
      attempt,
      createdAt: job.createdAt,
      updatedAt: Date.now(),
      status: "starting",
      progress: null,
      outputPath: null,
      error: null
    };
    await removeHistoryEntry(job.id);
    const connection = {
      port,
      requestId,
      terminal: false,
      terminalStatus: "cancelled",
      queue: Promise.resolve()
    };
    activePorts.set(job.id, connection);
    await persistJobState(state);
    port.onMessage.addListener((rawEvent) => {
      if (activePorts.get(job.id) !== connection) return;
      connection.queue = connection.queue.then(
        () => handleJobEvent(job.id, requestId, rawEvent)
      );
    });
    port.onDisconnect.addListener(() => {
      if (activePorts.get(job.id) !== connection) return;
      const message = chrome.runtime.lastError?.message || "Media Helper disconnected.";
      void connection.queue.finally(async () => {
        activePorts.delete(job.id);
        if (!connection.terminal) {
          await updateJobState(job.id, { status: "failed", error: message });
        }
      }).catch(() => {
      });
    });
    port.postMessage({
      type: MEDIA_HELPER_REQUESTS.DOWNLOAD_START,
      requestId,
      protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
      payload: {
        jobId: job.id,
        connections,
        candidate: job.candidate
      }
    });
    return { status: "started", jobId: job.id };
  }
  function withoutManifestBody(candidate) {
    if (!candidate.manifestHandoff) return candidate;
    const { body: _body, ...manifestHandoff } = candidate.manifestHandoff;
    return { ...candidate, manifestHandoff };
  }
  async function cancelMediaHelperDownload(jobId, { terminalStatus = "cancelled" } = {}) {
    const connection = activePorts.get(jobId);
    if (!connection) return { status: "not_running" };
    connection.terminalStatus = terminalStatus === "paused" ? "paused" : "cancelled";
    connection.port.postMessage({
      type: MEDIA_HELPER_REQUESTS.DOWNLOAD_CANCEL,
      requestId: connection.requestId,
      protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
      payload: { jobId }
    });
    const status = connection.terminalStatus === "paused" ? "pausing" : "cancelling";
    await updateJobState(jobId, { status });
    return { status, jobId };
  }
  async function listMediaHelperDownloads() {
    const [snapshot, local] = await Promise.all([
      chrome.storage.session.get(null),
      chrome.storage.local.get(DOWNLOAD_HISTORY_KEY)
    ]);
    const sessionJobs = Object.entries(snapshot).filter(([key]) => key.startsWith(DOWNLOAD_JOB_PREFIX)).map(([, value]) => value).filter((value) => value && typeof value === "object");
    const history = Array.isArray(local[DOWNLOAD_HISTORY_KEY]) ? local[DOWNLOAD_HISTORY_KEY] : [];
    const merged = new Map(
      history.filter((value) => value && typeof value === "object" && value.id).map((value) => [value.id, { ...value, historyOnly: true }])
    );
    for (const job of sessionJobs) merged.set(job.id, job);
    return [...merged.values()].sort(
      (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
    );
  }
  async function removeMediaHelperDownloadHistory(jobId) {
    await Promise.all([
      chrome.storage.session.remove(downloadJobKey(jobId)),
      removeHistoryEntry(jobId)
    ]);
  }
  async function clearMediaHelperDownloadHistory() {
    const snapshot = await chrome.storage.session.get(null);
    const terminalKeys = Object.entries(snapshot).filter(
      ([key, value]) => key.startsWith(DOWNLOAD_JOB_PREFIX) && ![
        "starting",
        "probing",
        "downloading",
        "finalizing",
        "pausing",
        "cancelling"
      ].includes(value?.status)
    ).map(([key]) => key);
    await Promise.all([
      terminalKeys.length ? chrome.storage.session.remove(terminalKeys) : Promise.resolve(),
      updateHistory(() => [])
    ]);
    return { removedCount: terminalKeys.length };
  }
  async function runMediaHelperOutputAction(action2, outputPath) {
    if (!await hasNativeMessagingPermission()) {
      throw new Error("Native Messaging permission is required.");
    }
    const type = action2 === "open" ? MEDIA_HELPER_REQUESTS.OUTPUT_OPEN : action2 === "reveal" ? MEDIA_HELPER_REQUESTS.OUTPUT_REVEAL : null;
    if (!type) throw new Error("Unknown Media Helper output action.");
    const requestId = randomId4();
    const response = normalizeHelperEvent(
      await withTimeout(
        chrome.runtime.sendNativeMessage(MEDIA_HELPER_HOST_NAME, {
          type,
          requestId,
          protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
          payload: { outputPath }
        }),
        DEFAULT_TIMEOUT_MS
      )
    );
    if (response.requestId !== requestId)
      throw new Error("Media Helper returned a mismatched request ID.");
    if (response.type === MEDIA_HELPER_EVENTS.ERROR)
      throw new Error(
        response.payload.message || "Media Helper output action failed."
      );
    if (response.type !== MEDIA_HELPER_EVENTS.OUTPUT_OPENED)
      throw new Error(`Unexpected Media Helper event: ${response.type}.`);
    return { status: "opened", action: action2, outputPath };
  }
  async function handleJobEvent(jobId, requestId, rawEvent) {
    try {
      const event2 = normalizeHelperEvent(rawEvent);
      if (event2.requestId !== requestId) return;
      if (event2.type === MEDIA_HELPER_EVENTS.DOWNLOAD_STARTED) {
        await updateJobState(jobId, { status: "probing" });
        return;
      }
      if (event2.type === MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS) {
        await updateJobState(jobId, {
          status: event2.payload.phase || "downloading",
          progress: { ...event2.payload }
        });
        return;
      }
      if (event2.type === MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED) {
        markTerminal(jobId);
        await updateJobState(jobId, {
          status: "completed",
          progress: { ...event2.payload, phase: "completed" },
          outputPath: event2.payload.outputPath || null
        });
        activePorts.get(jobId)?.port.disconnect();
        return;
      }
      if (event2.type === MEDIA_HELPER_EVENTS.DOWNLOAD_CANCELLED) {
        const terminalStatus = activePorts.get(jobId)?.terminalStatus === "paused" ? "paused" : "cancelled";
        markTerminal(jobId);
        await updateJobState(jobId, { status: terminalStatus });
        activePorts.get(jobId)?.port.disconnect();
        return;
      }
      if (event2.type === MEDIA_HELPER_EVENTS.ERROR) {
        markTerminal(jobId);
        await updateJobState(jobId, {
          status: "failed",
          error: event2.payload.message || "Media Helper download failed."
        });
        activePorts.get(jobId)?.port.disconnect();
      }
    } catch (error) {
      markTerminal(jobId);
      await updateJobState(jobId, { status: "failed", error: messageOf(error) });
      activePorts.get(jobId)?.port.disconnect();
    }
  }
  function markTerminal(jobId) {
    const connection = activePorts.get(jobId);
    if (connection) connection.terminal = true;
  }
  async function persistJobState(state) {
    await chrome.storage.session.set({ [downloadJobKey(state.id)]: state });
  }
  async function updateJobState(jobId, changes) {
    const key = downloadJobKey(jobId);
    const current = (await chrome.storage.session.get(key))[key];
    if (!current) return;
    const next = { ...current, ...changes, updatedAt: Date.now() };
    await persistJobState(next);
    if (["completed", "failed", "cancelled", "paused"].includes(next.status))
      await persistHistoryEntry(next);
  }
  async function persistHistoryEntry(state) {
    const safeState = {
      id: state.id,
      mediaId: state.mediaId,
      kind: state.kind,
      title: state.title,
      sourceTabId: state.sourceTabId,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      status: state.status,
      progress: state.progress ? { ...state.progress } : null,
      outputPath: state.outputPath,
      error: state.error,
      connections: state.connections,
      attempt: state.attempt
    };
    return updateHistory(
      (history) => [safeState, ...history.filter((item) => item?.id !== state.id)].slice(
        0,
        100
      )
    );
  }
  async function removeHistoryEntry(jobId) {
    return updateHistory(
      (history) => history.filter((item) => item?.id !== jobId)
    );
  }
  function updateHistory(mutate) {
    const operation = historyWriteChain.then(async () => {
      const local = await chrome.storage.local.get(DOWNLOAD_HISTORY_KEY);
      const history = Array.isArray(local[DOWNLOAD_HISTORY_KEY]) ? local[DOWNLOAD_HISTORY_KEY] : [];
      const next = mutate(history);
      if (JSON.stringify(next) === JSON.stringify(history)) return;
      await chrome.storage.local.set({ [DOWNLOAD_HISTORY_KEY]: next });
    });
    historyWriteChain = operation.catch(() => {
    });
    return operation;
  }
  function classifyNativeMessagingError(message = "") {
    if (/host.*not found|specified native messaging host not found|not registered/i.test(
      message
    )) {
      return MEDIA_HELPER_STATES.NOT_INSTALLED;
    }
    if (/protocol|incompatible/i.test(message)) {
      return MEDIA_HELPER_STATES.INCOMPATIBLE;
    }
    return MEDIA_HELPER_STATES.UNAVAILABLE;
  }
  async function hasNativeMessagingPermission() {
    if (!chrome.permissions?.contains) return false;
    return chrome.permissions.contains({ permissions: ["nativeMessaging"] });
  }
  function normalizeCapabilities(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, enabled]) => typeof enabled === "boolean")
    );
  }
  function helperStatus(status, details = {}) {
    return {
      status,
      installed: status === MEDIA_HELPER_STATES.READY,
      canDownloadDirect: false,
      canDownloadHls: false,
      canDownloadDecryptedHls: false,
      canDownloadDash: false,
      canMuxWithFfmpeg: false,
      helperVersion: null,
      capabilities: {},
      error: null,
      ...details
    };
  }
  function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Media Helper handshake timed out.")),
        timeoutMs
      );
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }
  function randomId4() {
    return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  function stringOrNull(value) {
    return typeof value === "string" && value ? value : null;
  }
  function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
  }

  // src/media/hls-parser.js
  var MAX_MANIFEST_LENGTH = 2 * 1024 * 1024;
  var MAX_LINES = 2e4;
  var MAX_VARIANTS = 100;
  var MAX_TRACKS = 100;
  function parseHlsManifest(manifestUrl, body) {
    const source = typeof body === "string" ? body.replace(/^\uFEFF/, "") : "";
    if (!source.trimStart().startsWith("#EXTM3U")) {
      return unsupported("not_hls_manifest");
    }
    if (source.length > MAX_MANIFEST_LENGTH) {
      return unsupported("manifest_too_large");
    }
    const lines = source.split(/\r?\n/).map((line) => line.trim());
    if (lines.length > MAX_LINES) return unsupported("too_many_manifest_lines");
    try {
      const variants = [];
      const iframeVariants = [];
      const audioTracks = [];
      const subtitles = [];
      const encryptionMethods = /* @__PURE__ */ new Set();
      const encryptionKeyFormats = /* @__PURE__ */ new Set();
      let pendingVariant = null;
      let pendingSegmentDuration = null;
      let segmentCount = 0;
      let partialSegmentCount = 0;
      let skippedSegmentCount = 0;
      let duration = 0;
      let targetDuration = null;
      let mediaSequence = null;
      let discontinuitySequence = null;
      let hasEndList = false;
      let declaredPlaylistType = null;
      let hasMediaEvidence = false;
      let hasLowLatencyTag = false;
      for (const line of lines) {
        if (!line) continue;
        if (pendingVariant && !line.startsWith("#")) {
          if (variants.length < MAX_VARIANTS) {
            variants.push(normalizeVariant(pendingVariant, line, manifestUrl));
          }
          pendingVariant = null;
          continue;
        }
        if (pendingSegmentDuration !== null && !line.startsWith("#")) {
          duration += pendingSegmentDuration;
          segmentCount += 1;
          pendingSegmentDuration = null;
          continue;
        }
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          pendingVariant = parseAttributeList(valueAfterColon(line));
          continue;
        }
        if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF:")) {
          const attributes = parseAttributeList(valueAfterColon(line));
          if (attributes.URI && iframeVariants.length < MAX_VARIANTS) {
            iframeVariants.push(
              normalizeVariant(attributes, attributes.URI, manifestUrl, true)
            );
          }
          continue;
        }
        if (line.startsWith("#EXT-X-MEDIA:")) {
          const track = normalizeTrack(
            parseAttributeList(valueAfterColon(line)),
            manifestUrl
          );
          if (!track) continue;
          if (track.type === "audio" && audioTracks.length < MAX_TRACKS)
            audioTracks.push(track);
          if (track.type === "subtitles" && subtitles.length < MAX_TRACKS)
            subtitles.push(track);
          continue;
        }
        if (line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-SESSION-KEY:")) {
          const attributes = parseAttributeList(valueAfterColon(line));
          const method = attributes.METHOD;
          if (method && method.toUpperCase() !== "NONE")
            encryptionMethods.add(method.toUpperCase());
          if (attributes.KEYFORMAT)
            encryptionKeyFormats.add(
              String(attributes.KEYFORMAT).toLowerCase().slice(0, 100)
            );
          continue;
        }
        if (line.startsWith("#EXTINF:")) {
          const value = Number(valueAfterColon(line).split(",", 1)[0]);
          pendingSegmentDuration = Number.isFinite(value) && value >= 0 ? value : 0;
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-PART:")) {
          partialSegmentCount += 1;
          hasMediaEvidence = true;
          hasLowLatencyTag = true;
          continue;
        }
        if (line.startsWith("#EXT-X-PART-INF:") || line.startsWith("#EXT-X-SERVER-CONTROL:")) {
          hasMediaEvidence = true;
          hasLowLatencyTag = true;
          continue;
        }
        if (line.startsWith("#EXT-X-PRELOAD-HINT:")) {
          const type = parseAttributeList(valueAfterColon(line)).TYPE;
          hasMediaEvidence = true;
          if (String(type || "").toUpperCase() === "PART")
            hasLowLatencyTag = true;
          continue;
        }
        if (line.startsWith("#EXT-X-SKIP:")) {
          const skipped = Number(
            parseAttributeList(valueAfterColon(line))["SKIPPED-SEGMENTS"]
          );
          if (Number.isInteger(skipped) && skipped >= 0)
            skippedSegmentCount = skipped;
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-TARGETDURATION:")) {
          const value = Number(valueAfterColon(line));
          if (Number.isFinite(value) && value >= 0) targetDuration = value;
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
          mediaSequence = optionalNonNegativeInteger3(valueAfterColon(line));
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) {
          discontinuitySequence = optionalNonNegativeInteger3(
            valueAfterColon(line)
          );
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-MAP:")) {
          hasMediaEvidence = true;
          continue;
        }
        if (line === "#EXT-X-ENDLIST") {
          hasEndList = true;
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
          declaredPlaylistType = valueAfterColon(line).toUpperCase();
          hasMediaEvidence = true;
        }
      }
      const hasMasterEvidence = variants.length > 0 || iframeVariants.length > 0 || (audioTracks.length > 0 || subtitles.length > 0) && !hasMediaEvidence;
      const playlistType = hasMasterEvidence ? "master" : hasMediaEvidence ? "media" : "unknown";
      const streamType = playlistType === "master" ? null : playlistType === "unknown" ? "unknown" : hasEndList || declaredPlaylistType === "VOD" ? "vod" : segmentCount > 0 || partialSegmentCount > 0 || targetDuration !== null || declaredPlaylistType === "EVENT" ? "live" : "unknown";
      const methods = [...encryptionMethods];
      const keyFormats = [...encryptionKeyFormats];
      const classification = classifyHlsEncryption(methods, keyFormats);
      return {
        status: "ready",
        error: null,
        playlistType,
        streamType,
        variants,
        iframeVariants,
        audioTracks,
        subtitles,
        duration: playlistType === "media" ? round(duration, 3) : null,
        targetDuration: playlistType === "media" ? targetDuration : null,
        segmentCount: playlistType === "media" ? segmentCount : null,
        partialSegmentCount: playlistType === "media" ? partialSegmentCount : null,
        skippedSegmentCount: playlistType === "media" ? skippedSegmentCount : null,
        lowLatency: playlistType === "media" && hasLowLatencyTag,
        mediaSequence: playlistType === "media" ? mediaSequence : null,
        discontinuitySequence: playlistType === "media" ? discontinuitySequence : null,
        revisionId: stableTextId(source),
        encryptionMethods: methods,
        encryptionKeyFormats: keyFormats,
        ...classification
      };
    } catch (error) {
      return {
        ...unsupported("manifest_parse_failed"),
        status: "failed",
        error: error?.message || "Could not parse HLS manifest."
      };
    }
  }
  function normalizeVariant(attributes, uri, manifestUrl, iframeOnly = false) {
    const bandwidth = optionalPositiveNumber(attributes.BANDWIDTH);
    const averageBandwidth = optionalPositiveNumber(
      attributes["AVERAGE-BANDWIDTH"]
    );
    return {
      id: stableVariantId(uri, bandwidth, attributes.RESOLUTION),
      url: resolveUrl(uri, manifestUrl),
      bandwidth,
      averageBandwidth,
      resolution: parseResolution(attributes.RESOLUTION),
      codecs: optionalText(attributes.CODECS),
      frameRate: optionalPositiveNumber(attributes["FRAME-RATE"]),
      audioGroup: optionalText(attributes.AUDIO),
      subtitlesGroup: optionalText(attributes.SUBTITLES),
      iframeOnly
    };
  }
  function normalizeTrack(attributes, manifestUrl) {
    const type = String(attributes.TYPE || "").toLowerCase();
    if (!["audio", "subtitles"].includes(type)) return null;
    const name = optionalText(attributes.NAME);
    const groupId = optionalText(attributes["GROUP-ID"]);
    return {
      id: stableVariantId(attributes.URI || name || type, null, groupId),
      type,
      groupId,
      name,
      language: optionalText(attributes.LANGUAGE),
      url: attributes.URI ? resolveUrl(attributes.URI, manifestUrl) : null,
      default: yesNo(attributes.DEFAULT),
      autoselect: yesNo(attributes.AUTOSELECT),
      forced: yesNo(attributes.FORCED),
      channels: optionalText(attributes.CHANNELS)
    };
  }
  function parseAttributeList(value) {
    const attributes = {};
    let index = 0;
    while (index < value.length) {
      while (value[index] === "," || /\s/.test(value[index] || "")) index++;
      const equals = value.indexOf("=", index);
      if (equals < 0) break;
      const key = value.slice(index, equals).trim().toUpperCase();
      index = equals + 1;
      let parsed = "";
      if (value[index] === '"') {
        index++;
        while (index < value.length) {
          const character = value[index++];
          if (character === '"') break;
          parsed += character;
        }
      } else {
        const comma = value.indexOf(",", index);
        const end = comma < 0 ? value.length : comma;
        parsed = value.slice(index, end).trim();
        index = end;
      }
      if (key) attributes[key] = parsed;
      while (index < value.length && value[index] !== ",") index++;
      if (value[index] === ",") index++;
    }
    return attributes;
  }
  function parseResolution(value) {
    const match = /^(\d+)x(\d+)$/i.exec(String(value || "").trim());
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  function unsupported(error) {
    return {
      status: "unsupported",
      error,
      playlistType: null,
      streamType: null,
      variants: [],
      iframeVariants: [],
      audioTracks: [],
      subtitles: [],
      duration: null,
      targetDuration: null,
      segmentCount: null,
      partialSegmentCount: null,
      skippedSegmentCount: null,
      lowLatency: false,
      mediaSequence: null,
      discontinuitySequence: null,
      revisionId: null,
      encryptionMethods: [],
      encryptionKeyFormats: [],
      encryptionScheme: "none",
      drmSystem: null,
      drmEvidence: [],
      drm: "none"
    };
  }
  function classifyHlsEncryption(methods, keyFormats) {
    if (!methods.length) {
      return {
        encryptionScheme: "none",
        drm: "none",
        drmSystem: null,
        drmEvidence: []
      };
    }
    const drmSystem = detectDrmSystem(keyFormats);
    const sampleAes = methods.some((method) => method.startsWith("SAMPLE-AES"));
    const aes128 = methods.every((method) => method === "AES-128");
    const encryptionScheme = sampleAes ? "sample-aes" : aes128 ? "aes-128" : "unknown";
    if (drmSystem) {
      return {
        encryptionScheme,
        drm: "confirmed",
        drmSystem,
        drmEvidence: ["hls-keyformat"]
      };
    }
    return {
      encryptionScheme,
      drm: sampleAes ? "suspected" : "none",
      drmSystem: null,
      drmEvidence: sampleAes ? ["hls-sample-aes"] : []
    };
  }
  function detectDrmSystem(keyFormats) {
    for (const format of keyFormats) {
      if (format === "identity") continue;
      if (format.includes("edef8ba9") || format.includes("widevine"))
        return "widevine";
      if (format.includes("9a04f079") || format.includes("playready"))
        return "playready";
      if (format.includes("94ce86fb") || format.includes("streamingkeydelivery"))
        return "fairplay";
      if (format.includes("e2719d58") || format.includes("clearkey"))
        return "clearkey";
    }
    return null;
  }
  function valueAfterColon(line) {
    return line.slice(line.indexOf(":") + 1);
  }
  function resolveUrl(value, baseUrl) {
    try {
      return new URL(value, baseUrl).href;
    } catch {
      return value;
    }
  }
  function optionalPositiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }
  function optionalText(value) {
    return typeof value === "string" && value ? value : null;
  }
  function yesNo(value) {
    return String(value || "").toUpperCase() === "YES";
  }
  function round(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }
  function stableVariantId(...parts) {
    const input = parts.filter((part) => part !== null).join(":");
    let hash = 2166136261;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `stream-${(hash >>> 0).toString(36)}`;
  }
  function optionalNonNegativeInteger3(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }
  function stableTextId(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `revision-${(hash >>> 0).toString(36)}`;
  }

  // src/media/dash-parser.js
  function parseDashManifest(manifestUrl, body) {
    try {
      const xml = String(body || "").replace(/^\uFEFF/, "").trim();
      const root = xml.match(/<MPD\b([^>]*)>/i);
      if (!root) return unsupported2("not_dash_manifest");
      const rootAttributes = parseXmlAttributes(root[1]);
      const streamType = String(rootAttributes.type || "static").toLowerCase() === "dynamic" ? "live" : "vod";
      const duration = parseIsoDuration(rootAttributes.mediaPresentationDuration);
      const protectionSchemes = extractProtectionSchemes(xml);
      const drmSystem = detectDrmSystem2(protectionSchemes);
      const drm = drmSystem ? "confirmed" : protectionSchemes.length ? "suspected" : "none";
      const tracks = extractTracks(xml);
      const variants = tracks.filter((track) => track.type === "video");
      const audioTracks = tracks.filter((track) => track.type === "audio");
      const subtitles = tracks.filter((track) => track.type === "text");
      return {
        kind: "dash",
        status: "ready",
        error: null,
        playlistType: "master",
        streamType,
        duration,
        variants,
        iframeVariants: [],
        audioTracks,
        subtitles,
        segmentCount: null,
        partialSegmentCount: null,
        skippedSegmentCount: null,
        lowLatency: streamType === "live" && /availabilityTimeOffset\s*=/i.test(xml),
        mediaSequence: null,
        discontinuitySequence: null,
        revisionId: revisionId(manifestUrl, xml),
        encryptionMethods: protectionSchemes,
        encryptionKeyFormats: [],
        encryptionScheme: protectionSchemes.length ? /cbcs|cbc1/i.test(xml) ? "cbcs" : "cenc" : "none",
        drmSystem,
        drmEvidence: drmSystem ? ["dash-content-protection"] : [],
        drm
      };
    } catch (error) {
      return {
        ...unsupported2("dash_parse_failed"),
        error: error?.message || "dash_parse_failed"
      };
    }
  }
  function detectDrmSystem2(schemes) {
    for (const scheme of schemes) {
      if (scheme.includes("widevine") || scheme.includes("edef8ba9"))
        return "widevine";
      if (scheme.includes("playready") || scheme.includes("9a04f079"))
        return "playready";
      if (scheme.includes("fairplay") || scheme.includes("94ce86fb"))
        return "fairplay";
      if (scheme.includes("clearkey") || scheme.includes("e2719d58"))
        return "clearkey";
    }
    return null;
  }
  function extractTracks(xml) {
    const tracks = [];
    const adaptations = [
      ...xml.matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet\s*>/gi)
    ];
    for (const [, rawAttributes, content] of adaptations) {
      const adaptation = parseXmlAttributes(rawAttributes);
      const representations = [
        ...content.matchAll(/<Representation\b([^>]*?)(?:\/?>)/gi)
      ];
      if (!representations.length) {
        const track = normalizeTrack2(adaptation, adaptation, tracks.length);
        if (track) tracks.push(track);
        continue;
      }
      for (const [, representationAttributes] of representations) {
        const representation = parseXmlAttributes(representationAttributes);
        const track = normalizeTrack2(adaptation, representation, tracks.length);
        if (track) tracks.push(track);
      }
    }
    if (adaptations.length) return deduplicateTracks(tracks);
    for (const [, rawAttributes] of xml.matchAll(
      /<Representation\b([^>]*?)(?:\/?>)/gi
    )) {
      const representation = parseXmlAttributes(rawAttributes);
      const track = normalizeTrack2({}, representation, tracks.length);
      if (track) tracks.push(track);
    }
    return deduplicateTracks(tracks);
  }
  function normalizeTrack2(adaptation, representation, index) {
    const mimeType = representation.mimeType || adaptation.mimeType || null;
    const contentType = String(
      adaptation.contentType || representation.contentType || mimeType || ""
    ).toLowerCase();
    const type = contentType.includes("video") ? "video" : contentType.includes("audio") ? "audio" : contentType.includes("text") || contentType.includes("subtitle") || contentType.includes("application") ? "text" : null;
    if (!type) return null;
    const width = positiveInteger(representation.width || adaptation.width);
    const height = positiveInteger(representation.height || adaptation.height);
    const bandwidth = positiveInteger(representation.bandwidth);
    return {
      id: representation.id || adaptation.id || `${type}-${index + 1}`,
      type,
      bandwidth,
      averageBandwidth: bandwidth,
      width,
      height,
      resolution: width || height ? { width, height } : null,
      codecs: representation.codecs || adaptation.codecs || null,
      mimeType,
      language: adaptation.lang || representation.lang || null,
      name: adaptation.label || representation.label || adaptation.lang || null
    };
  }
  function deduplicateTracks(tracks) {
    const unique = /* @__PURE__ */ new Map();
    for (const track of tracks) {
      const key = [
        track.type,
        track.id,
        track.bandwidth,
        track.width,
        track.height,
        track.language
      ].join(":");
      unique.set(key, track);
    }
    return [...unique.values()].slice(0, 100);
  }
  function extractProtectionSchemes(xml) {
    return [
      ...new Set(
        [...xml.matchAll(/<ContentProtection\b([^>]*)>/gi)].map((match) => parseXmlAttributes(match[1]).schemeIdUri).filter(Boolean).map((value) => String(value).toLowerCase().slice(0, 100))
      )
    ];
  }
  function parseIsoDuration(value) {
    if (typeof value !== "string" || !value) return null;
    const match = value.match(
      /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
    );
    if (!match) return null;
    const seconds = Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0);
    return Number.isFinite(seconds) ? seconds : null;
  }
  function parseXmlAttributes(value) {
    const attributes = {};
    for (const match of String(value || "").matchAll(
      /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    )) {
      attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
    }
    return attributes;
  }
  function decodeXml(value) {
    return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }
  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }
  function revisionId(url, body) {
    let hash = 2166136261;
    const input = `${url || ""}
${body}`;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `dash-${(hash >>> 0).toString(36)}`;
  }
  function unsupported2(error) {
    return {
      kind: "dash",
      status: "unsupported",
      error,
      playlistType: null,
      streamType: null,
      duration: null,
      variants: [],
      iframeVariants: [],
      audioTracks: [],
      subtitles: [],
      segmentCount: null,
      partialSegmentCount: null,
      skippedSegmentCount: null,
      lowLatency: false,
      mediaSequence: null,
      discontinuitySequence: null,
      revisionId: null,
      encryptionMethods: [],
      encryptionKeyFormats: [],
      encryptionScheme: "none",
      drmSystem: null,
      drmEvidence: [],
      drm: "none"
    };
  }

  // src/media/probe-gate.js
  function isUsableMediaProbe(probe = {}) {
    if (probe.status !== "ready") return false;
    if (probe.kind === "dash") {
      return Boolean(
        probe.variants?.length || probe.audioTracks?.length || ["vod", "live"].includes(probe.streamType)
      );
    }
    if (probe.playlistType === "master") {
      return Boolean(
        probe.variants?.length || probe.iframeVariants?.length || probe.audioTracks?.length || probe.subtitles?.length
      );
    }
    if (probe.playlistType !== "media") return false;
    return Boolean(
      probe.segmentCount > 0 || probe.partialSegmentCount > 0 || ["vod", "live"].includes(probe.streamType)
    );
  }

  // src/background/media-manifest-handoff.js
  var HANDOFF_PREFIX = "adsfriendly.mediaManifestHandoff.";
  var MAX_HANDOFF_BYTES = 512 * 1024;
  var MAX_HANDOFFS_PER_TAB = 2;
  var MAX_HANDOFFS_TOTAL = 8;
  var HANDOFF_TTL_MS = 15 * 60 * 1e3;
  var storageOperation = Promise.resolve();
  function startMediaManifestHandoffStore() {
    const onRemoved = (tabId) => clearMediaManifestHandoffs(tabId).catch(() => {
    });
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => chrome.tabs.onRemoved.removeListener(onRemoved);
  }
  async function saveMediaManifestHandoff(tabId, rawHandoff) {
    assertTabId2(tabId);
    const handoff = normalizeMediaManifestHandoff2(rawHandoff);
    return withStorageLock(async () => {
      const key = handoffKey(tabId);
      const snapshot = await chrome.storage.session.get(null);
      const records = [{ key, handoff }];
      for (const [storedKey, value] of Object.entries(snapshot)) {
        if (!storedKey.startsWith(HANDOFF_PREFIX)) continue;
        for (const storedHandoff of pruneHandoffs(value)) {
          if (storedKey === key && storedHandoff.mediaId === handoff.mediaId)
            continue;
          records.push({ key: storedKey, handoff: storedHandoff });
        }
      }
      records.sort(
        (left, right) => Number(right.handoff.capturedAt) - Number(left.handoff.capturedAt)
      );
      const selected = [];
      const perTab = /* @__PURE__ */ new Map();
      for (const record of records) {
        if (selected.length >= MAX_HANDOFFS_TOTAL) break;
        const count = perTab.get(record.key) || 0;
        if (count >= MAX_HANDOFFS_PER_TAB) continue;
        selected.push(record);
        perTab.set(record.key, count + 1);
      }
      const updates = {};
      for (const record of selected) {
        (updates[record.key] ||= []).push(record.handoff);
      }
      const storedKeys = Object.keys(snapshot).filter(
        (storedKey) => storedKey.startsWith(HANDOFF_PREFIX)
      );
      const removedKeys = storedKeys.filter((storedKey) => !updates[storedKey]);
      if (Object.keys(updates).length) await chrome.storage.session.set(updates);
      if (removedKeys.length) await chrome.storage.session.remove(removedKeys);
      return { status: "saved", handoff: publicHandoff(handoff) };
    });
  }
  async function getMediaManifestHandoff(tabId, mediaId) {
    assertTabId2(tabId);
    if (typeof mediaId !== "string" || !mediaId)
      return { status: "invalid_media" };
    return withStorageLock(async () => {
      const key = handoffKey(tabId);
      const snapshot = await chrome.storage.session.get(key);
      const stored = Array.isArray(snapshot[key]) ? snapshot[key] : [];
      const handoffs = pruneHandoffs(stored);
      if (handoffs.length !== stored.length) {
        if (handoffs.length)
          await chrome.storage.session.set({ [key]: handoffs });
        else await chrome.storage.session.remove(key);
      }
      const handoff = handoffs.find((item) => item.mediaId === mediaId);
      return handoff ? { status: "found", handoff: { ...handoff } } : { status: "not_found" };
    });
  }
  async function clearMediaManifestHandoffs(tabId) {
    assertTabId2(tabId);
    return withStorageLock(
      () => chrome.storage.session.remove(handoffKey(tabId))
    );
  }
  function normalizeMediaManifestHandoff2(value = {}, now = Date.now()) {
    const body = typeof value.body === "string" ? value.body : "";
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (!body || bodyBytes > MAX_HANDOFF_BYTES) {
      throw new Error(
        bodyBytes > MAX_HANDOFF_BYTES ? "Decrypted manifest exceeds the 512 KB handoff limit." : "Decrypted manifest body is empty."
      );
    }
    const kind = value.kind === "dash" ? "dash" : "hls";
    const manifestUrl = requiredHttpUrl2(value.manifestUrl);
    const parsed = kind === "dash" ? { kind, ...parseDashManifest(manifestUrl, body) } : { kind, ...parseHlsManifest(manifestUrl, body) };
    if (!isUsableMediaProbe(parsed)) {
      throw new Error("Decrypted manifest is not a usable media source.");
    }
    return Object.freeze({
      mediaId: requiredString3(value.mediaId, "mediaId"),
      manifestUrl,
      kind,
      body,
      bodyBytes,
      revisionId: parsed.revisionId || null,
      playlistType: parsed.playlistType || null,
      streamType: parsed.streamType || null,
      capturedAt: now,
      expiresAt: now + HANDOFF_TTL_MS
    });
  }
  function pruneHandoffs(value, now = Date.now()) {
    return (Array.isArray(value) ? value : []).filter(
      (item) => item && typeof item.body === "string" && Number(item.expiresAt) > now
    ).slice(0, MAX_HANDOFFS_PER_TAB);
  }
  function publicHandoff(handoff) {
    const { body: _body, ...metadata } = handoff;
    return metadata;
  }
  function withStorageLock(operation) {
    const result = storageOperation.then(operation, operation);
    storageOperation = result.catch(() => {
    });
    return result;
  }
  function handoffKey(tabId) {
    return `${HANDOFF_PREFIX}${tabId}`;
  }
  function assertTabId2(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0)
      throw new Error("A valid tab ID is required for manifest handoff.");
  }
  function requiredString3(value, field) {
    if (typeof value !== "string" || !value.trim())
      throw new Error(`Manifest handoff ${field} is required.`);
    return value;
  }
  function requiredHttpUrl2(value) {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      return url.href;
    } catch {
      throw new Error("Manifest handoff URL must be HTTP(S).");
    }
  }

  // src/background/media-download-jobs.js
  var broker = null;
  async function startMediaDownloadJobStore(policy) {
    await removeStaleJobs();
    broker = createActionBroker({
      featureId: "background.media-download-jobs",
      policy,
      handlers: {
        [ACTIONS.MEDIA_DOWNLOAD_CANCEL]: cancelJob,
        [ACTIONS.MEDIA_DOWNLOAD_CLEAR_HISTORY]: clearJobHistory,
        [ACTIONS.MEDIA_DOWNLOAD_CREATE]: createJob,
        [ACTIONS.MEDIA_DOWNLOAD_PAUSE]: pauseJob,
        [ACTIONS.MEDIA_DOWNLOAD_OPEN]: openJobOutput,
        [ACTIONS.MEDIA_DOWNLOAD_REMOVE_HISTORY]: removeJobHistory,
        [ACTIONS.MEDIA_DOWNLOAD_REVEAL]: revealJobOutput,
        [ACTIONS.MEDIA_DOWNLOAD_RESUME]: resumeJob,
        [ACTIONS.MEDIA_DOWNLOAD_RETRY]: retryJob
      }
    });
    return () => {
      broker = null;
    };
  }
  async function requestMediaDownloadJob(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_CREATE, payload);
  }
  async function requestMediaDownloadCancel(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_CANCEL, payload);
  }
  async function requestMediaDownloadPause(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_PAUSE, payload);
  }
  async function requestMediaDownloadResume(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_RESUME, payload);
  }
  async function requestMediaDownloadRetry(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_RETRY, payload);
  }
  async function requestMediaDownloadOpen(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_OPEN, payload);
  }
  async function requestMediaDownloadReveal(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_REVEAL, payload);
  }
  async function requestMediaDownloadHistoryRemove(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_REMOVE_HISTORY, payload);
  }
  async function requestMediaDownloadHistoryClear() {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_CLEAR_HISTORY, {});
  }
  async function listMediaDownloadJobs() {
    return { status: "ok", items: await listMediaHelperDownloads() };
  }
  async function createJob({ tabId, mediaId, connections } = {}) {
    if (!Number.isInteger(tabId) || tabId < 0) return { status: "invalid_tab" };
    if (typeof mediaId !== "string" || !mediaId)
      return { status: "invalid_media" };
    const response = await listDiscoveredMedia(tabId);
    let candidate = response.items.find((item) => item.id === mediaId);
    if (!candidate) return { status: "media_not_found" };
    if (candidate.kind === "hls" && candidate.selectedMediaId) {
      candidate = response.items.find((item) => item.id === candidate.selectedMediaId) || candidate;
    }
    const availability = getMediaDownloadAvailability(candidate);
    if (!availability.supported)
      return { status: "unsupported", reason: availability.reason };
    const helperFailure = await helperFailureFor(candidate);
    if (helperFailure) return helperFailure;
    const handoffResult = await attachManifestHandoff(tabId, candidate);
    if (handoffResult.status !== "ready") return handoffResult;
    candidate = handoffResult.candidate;
    const job = normalizeMediaDownloadJob({
      id: randomId5(),
      createdAt: Date.now(),
      sourceTabId: tabId,
      candidate
    });
    const settings = await loadSettings();
    return startMediaHelperDownload(job, {
      connections: normalizeMediaDownloadConnections(
        connections ?? settings.mediaDownloadConnections
      )
    });
  }
  async function cancelJob({ jobId } = {}) {
    if (typeof jobId !== "string" || !jobId) return { status: "invalid_job" };
    return cancelMediaHelperDownload(jobId);
  }
  async function pauseJob({ jobId } = {}) {
    const state = await readJob(jobId);
    if (!state) return { status: "job_not_found" };
    if (state.progress?.resumable !== true)
      return {
        status: "pause_unsupported",
        reason: "This download adapter cannot resume partial data yet."
      };
    return cancelMediaHelperDownload(jobId, { terminalStatus: "paused" });
  }
  async function resumeJob(payload = {}) {
    const state = await readJob(payload.jobId);
    if (!state) return { status: "job_not_found" };
    if (state.status !== "paused")
      return { status: "not_paused", reason: "Only a paused job can resume." };
    return restartJob(state, payload.connections);
  }
  async function retryJob(payload = {}) {
    const state = await readJob(payload.jobId);
    if (!state) return { status: "job_not_found" };
    if (!["cancelled", "failed"].includes(state.status)) {
      return {
        status: "retry_unavailable",
        reason: "Only a cancelled or failed job can be retried."
      };
    }
    return restartJob(state, payload.connections);
  }
  async function openJobOutput({ jobId } = {}) {
    return runJobOutputAction(jobId, "open");
  }
  async function revealJobOutput({ jobId } = {}) {
    return runJobOutputAction(jobId, "reveal");
  }
  async function runJobOutputAction(jobId, action2) {
    const state = await readJob(jobId);
    if (!state?.outputPath)
      return {
        status: "output_not_found",
        reason: "This job has no saved output file."
      };
    return runMediaHelperOutputAction(action2, state.outputPath);
  }
  async function removeJobHistory({ jobId } = {}) {
    const state = await readJob(jobId);
    if (!state) return { status: "job_not_found" };
    if ([
      "starting",
      "probing",
      "downloading",
      "finalizing",
      "pausing",
      "cancelling"
    ].includes(state.status)) {
      return {
        status: "job_active",
        reason: "Stop the active download before removing its history."
      };
    }
    await removeMediaHelperDownloadHistory(jobId);
    return { status: "removed", jobId };
  }
  async function clearJobHistory() {
    const { removedCount } = await clearMediaHelperDownloadHistory();
    return { status: "removed", removedCount };
  }
  async function restartJob(state, requestedConnections) {
    let candidate = await recoverCandidate(state) || state.candidate;
    if (!candidate) {
      return {
        status: "media_not_found",
        reason: "The original media source is no longer available. Reopen its video page."
      };
    }
    const handoffResult = await attachManifestHandoff(
      state.sourceTabId,
      candidate
    );
    if (handoffResult.status !== "ready") return handoffResult;
    candidate = handoffResult.candidate;
    const helperFailure = await helperFailureFor(candidate);
    if (helperFailure) return helperFailure;
    const job = normalizeMediaDownloadJob({
      id: state.id,
      createdAt: Date.now(),
      sourceTabId: state.sourceTabId,
      candidate
    });
    const settings = await loadSettings();
    return startMediaHelperDownload(job, {
      connections: normalizeMediaDownloadConnections(
        requestedConnections ?? settings.mediaDownloadConnections
      ),
      attempt: Math.max(1, Number(state.attempt) || 1) + 1
    });
  }
  async function attachManifestHandoff(tabId, candidate) {
    if (candidate.probeSource !== "decrypted_blob")
      return { status: "ready", candidate };
    const response = await getMediaManifestHandoff(tabId, candidate.id);
    const handoff = response.handoff;
    if (response.status !== "found" || handoff?.manifestUrl !== candidate.manifestUrl || handoff?.kind !== candidate.kind || candidate.revisionId && handoff?.revisionId !== candidate.revisionId) {
      return {
        status: "manifest_handoff_expired",
        reason: "The decrypted manifest expired. Reload the video page and retry."
      };
    }
    return {
      status: "ready",
      candidate: { ...candidate, manifestHandoff: handoff }
    };
  }
  async function recoverCandidate(state) {
    if (!Number.isInteger(state.sourceTabId) || !state.mediaId) return null;
    const response = await listDiscoveredMedia(state.sourceTabId);
    return response.items.find((item) => item.id === state.mediaId) || null;
  }
  async function helperFailureFor(candidate) {
    const helper = await getMediaHelperStatus({ force: true });
    if (helper.status !== "ready") {
      return {
        status: "helper_required",
        helper,
        reason: "Media Helper must be installed and available to download video."
      };
    }
    const capabilityReady = candidate.kind === "direct" ? helper.canDownloadDirect : candidate.kind === "hls" ? candidate.probeSource === "decrypted_blob" ? helper.canDownloadHls && helper.canDownloadDecryptedHls : helper.canDownloadHls : helper.canDownloadDash;
    if (capabilityReady) return null;
    return {
      status: "helper_not_ready",
      helper,
      reason: candidate.kind === "direct" ? "This Media Helper build cannot download direct media yet." : candidate.kind === "hls" ? candidate.probeSource === "decrypted_blob" ? "This Media Helper build cannot accept a player-decrypted HLS manifest yet." : "This Media Helper build does not execute HLS downloads yet." : "This Media Helper build does not execute DASH downloads yet."
    };
  }
  async function readJob(jobId) {
    if (typeof jobId !== "string" || !jobId) return null;
    const key = downloadJobKey(jobId);
    const sessionJob = (await chrome.storage.session.get(key))[key];
    if (sessionJob) return sessionJob;
    return (await listMediaHelperDownloads()).find((item) => item.id === jobId) || null;
  }
  async function removeStaleJobs() {
    const snapshot = await chrome.storage.session.get(null);
    const cutoff = Date.now() - DOWNLOAD_JOB_MAX_AGE_MS;
    const staleKeys = Object.entries(snapshot).filter(
      ([key, value]) => key.startsWith(DOWNLOAD_JOB_PREFIX) && (!Number.isFinite(value?.createdAt) || value.createdAt < cutoff)
    ).map(([key]) => key);
    if (staleKeys.length) await chrome.storage.session.remove(staleKeys);
  }
  function randomId5() {
    return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // src/background/media-probe-context.js
  var PROBE_RULE_ID_BASE = 17e5;
  var PROBE_RULE_LIFETIME_MS = 6e3;
  var nextRuleId = PROBE_RULE_ID_BASE;
  async function prepareMediaProbeReferer({
    tabId,
    manifestUrl,
    parentDocumentUrl
  }) {
    const ruleId = nextProbeRuleId();
    const rule = createMediaProbeRefererRule({
      ruleId,
      tabId,
      manifestUrl,
      parentDocumentUrl
    });
    const support = await chrome.declarativeNetRequest.isRegexSupported({
      regex: rule.condition.regexFilter
    });
    if (!support?.isSupported) {
      return { status: "unsupported", reason: support?.reason || "regex" };
    }
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [rule]
    });
    setTimeout(() => {
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {
      });
    }, PROBE_RULE_LIFETIME_MS);
    return { status: "prepared", ruleId };
  }
  function createMediaProbeRefererRule({
    ruleId,
    tabId,
    manifestUrl,
    parentDocumentUrl
  }) {
    if (!Number.isInteger(ruleId) || ruleId <= 0)
      throw new TypeError("Media probe rule needs a positive integer ID.");
    if (!Number.isInteger(tabId) || tabId < 0)
      throw new TypeError("Media probe rule needs a valid tab ID.");
    const manifest = requiredHttpUrl3(manifestUrl, "manifestUrl");
    const parent = requiredHttpUrl3(parentDocumentUrl, "parentDocumentUrl");
    return {
      id: ruleId,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: parent.href }
        ]
      },
      condition: {
        regexFilter: `^${escapeRegex(manifest.href)}$`,
        resourceTypes: ["xmlhttprequest"],
        tabIds: [tabId]
      }
    };
  }
  function nextProbeRuleId() {
    const ruleId = nextRuleId;
    nextRuleId += 1;
    if (nextRuleId > PROBE_RULE_ID_BASE + 1e5)
      nextRuleId = PROBE_RULE_ID_BASE;
    return ruleId;
  }
  function requiredHttpUrl3(value, field) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError(`${field} must be an HTTP URL.`);
    }
    if (!["http:", "https:"].includes(url.protocol))
      throw new TypeError(`${field} must be an HTTP URL.`);
    return url;
  }
  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // src/background/media-debug-capture.js
  var DEBUG_CAPTURE_PREFIX = "adsfriendly.mediaDebugCaptures.";
  var MAX_CAPTURE_BYTES = 512 * 1024;
  var MAX_CAPTURES_PER_TAB = 3;
  var CAPTURE_TTL_MS = 15 * 60 * 1e3;
  function startMediaDebugCaptureStore() {
    const onRemoved = (tabId) => clearMediaDebugCaptures(tabId).catch(() => {
    });
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => chrome.tabs.onRemoved.removeListener(onRemoved);
  }
  async function saveMediaDebugCapture(tabId, rawCapture) {
    assertTabId3(tabId);
    const capture = normalizeDebugCapture(rawCapture);
    const key = debugCaptureKey(tabId);
    const snapshot = await chrome.storage.session.get(key);
    const captures = pruneCaptures(snapshot[key]);
    const next = [
      capture,
      ...captures.filter((item) => item.mediaId !== capture.mediaId)
    ].slice(0, MAX_CAPTURES_PER_TAB);
    await chrome.storage.session.set({ [key]: next });
    return { status: "saved", capture: publicCapture(capture) };
  }
  async function getMediaDebugCapture(tabId, mediaId) {
    assertTabId3(tabId);
    if (typeof mediaId !== "string" || !mediaId)
      return { status: "invalid_media" };
    const key = debugCaptureKey(tabId);
    const snapshot = await chrome.storage.session.get(key);
    const stored = Array.isArray(snapshot[key]) ? snapshot[key] : [];
    const captures = pruneCaptures(stored);
    if (captures.length !== stored.length) {
      if (captures.length) await chrome.storage.session.set({ [key]: captures });
      else await chrome.storage.session.remove(key);
    }
    const capture = captures.find((item) => item.mediaId === mediaId);
    return capture ? { status: "found", capture: { ...capture } } : { status: "not_found" };
  }
  async function clearMediaDebugCaptures(tabId) {
    assertTabId3(tabId);
    await chrome.storage.session.remove(debugCaptureKey(tabId));
  }
  function normalizeDebugCapture(value = {}, now = Date.now()) {
    const body = typeof value.body === "string" ? value.body : "";
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (!body || bodyBytes > MAX_CAPTURE_BYTES) {
      throw new Error(
        bodyBytes > MAX_CAPTURE_BYTES ? "Debug manifest exceeds the 512 KB session limit." : "Debug manifest body is empty."
      );
    }
    return Object.freeze({
      mediaId: requiredString4(value.mediaId, "mediaId"),
      manifestUrl: requiredHttpUrl4(value.manifestUrl),
      kind: ["hls", "dash"].includes(value.kind) ? value.kind : "hls",
      body,
      bodyBytes,
      bodyFormat: ["hls", "dash", "unknown"].includes(value.bodyFormat) ? value.bodyFormat : "unknown",
      reason: requiredString4(value.reason, "reason").slice(0, 100),
      capturedAt: now,
      expiresAt: now + CAPTURE_TTL_MS
    });
  }
  function pruneCaptures(value, now = Date.now()) {
    return (Array.isArray(value) ? value : []).filter(
      (item) => item && typeof item.body === "string" && Number(item.expiresAt) > now
    ).slice(0, MAX_CAPTURES_PER_TAB);
  }
  function publicCapture(capture) {
    const { body: _body, ...metadata } = capture;
    return metadata;
  }
  function debugCaptureKey(tabId) {
    return `${DEBUG_CAPTURE_PREFIX}${tabId}`;
  }
  function assertTabId3(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0)
      throw new Error("A valid tab ID is required for debug capture.");
  }
  function requiredString4(value, field) {
    if (typeof value !== "string" || !value.trim())
      throw new Error(`Debug capture ${field} is required.`);
    return value;
  }
  function requiredHttpUrl4(value) {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      return url.href;
    } catch {
      throw new Error("Debug capture manifestUrl must be HTTP(S).");
    }
  }

  // src/media/media-title.js
  function chooseMediaTitle(candidateTitle, pageTitle, pageUrl = "") {
    const candidate = cleanMediaTitle(candidateTitle, pageUrl);
    if (candidate && !isGenericMediaTitle(candidate, pageUrl)) return candidate;
    return cleanMediaTitle(pageTitle, pageUrl) || candidate || null;
  }
  function cleanMediaTitle(value, pageUrl = "") {
    let title = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!title) return null;
    title = title.replace(/^(?:xem\s+phim|watch)\s+/i, "").replace(/\s+(?:vietsub|thuyết\s+minh)(?:\s*[-|].*)?$/i, "").trim();
    const hostname = safeHostname(pageUrl);
    if (hostname) {
      const site = hostname.replace(/^www\./, "").split(".", 1)[0];
      title = title.replace(
        new RegExp(`\\s*[-|]\\s*${escapeRegex2(site)}.*$`, "i"),
        ""
      );
    }
    return title.slice(0, 180).trim() || null;
  }
  function isGenericMediaTitle(value, pageUrl) {
    if (/^(?:player|video|media|blob|blob media stream)$/i.test(value))
      return true;
    if (/^[a-f0-9_-]{24,}$/i.test(value)) return true;
    const hostname = safeHostname(pageUrl);
    return Boolean(hostname && value.toLowerCase() === hostname.toLowerCase());
  }
  function safeHostname(value) {
    try {
      return new URL(value).hostname;
    } catch {
      return "";
    }
  }
  function escapeRegex2(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    OPEN_BLOCKED_NAVIGATION: CAPABILITIES.NAVIGATION_FEEDBACK,
    ALLOW_BLOCKED_SOURCE: CAPABILITIES.NAVIGATION_FEEDBACK,
    BLOCK_ALLOWED_SEARCH_SOURCE: CAPABILITIES.NAVIGATION_FEEDBACK,
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
    RECORD_DOM_SAMPLE: CAPABILITIES.LEARNING_FEEDBACK,
    MEDIA_DISCOVERED: CAPABILITIES.MEDIA_CATALOG,
    MEDIA_PROBED: CAPABILITIES.MEDIA_CATALOG,
    MEDIA_PROBE_DIAGNOSTIC: CAPABILITIES.MEDIA_CATALOG,
    MEDIA_BLOB_TRACED: CAPABILITIES.MEDIA_CATALOG,
    MEDIA_EME_OBSERVED: CAPABILITIES.MEDIA_CATALOG,
    PREPARE_MEDIA_CONTEXTUAL_PROBE: CAPABILITIES.MEDIA_CATALOG,
    GET_MEDIA_CATALOG: CAPABILITIES.MEDIA_CATALOG,
    SAVE_MEDIA_DEBUG_MANIFEST: CAPABILITIES.MEDIA_CATALOG,
    GET_MEDIA_DEBUG_MANIFEST: CAPABILITIES.MEDIA_CATALOG,
    SAVE_DECRYPTED_MEDIA_MANIFEST: CAPABILITIES.MEDIA_CATALOG,
    GET_MEDIA_HELPER_STATUS: CAPABILITIES.MEDIA_DOWNLOAD,
    CREATE_MEDIA_DOWNLOAD_JOB: CAPABILITIES.MEDIA_DOWNLOAD,
    CANCEL_MEDIA_DOWNLOAD_JOB: CAPABILITIES.MEDIA_DOWNLOAD,
    PAUSE_MEDIA_DOWNLOAD_JOB: CAPABILITIES.MEDIA_DOWNLOAD,
    OPEN_MEDIA_DOWNLOAD_OUTPUT: CAPABILITIES.MEDIA_DOWNLOAD,
    REVEAL_MEDIA_DOWNLOAD_OUTPUT: CAPABILITIES.MEDIA_DOWNLOAD,
    REMOVE_MEDIA_DOWNLOAD_HISTORY: CAPABILITIES.MEDIA_DOWNLOAD,
    CLEAR_MEDIA_DOWNLOAD_HISTORY: CAPABILITIES.MEDIA_DOWNLOAD,
    RESUME_MEDIA_DOWNLOAD_JOB: CAPABILITIES.MEDIA_DOWNLOAD,
    RETRY_MEDIA_DOWNLOAD_JOB: CAPABILITIES.MEDIA_DOWNLOAD,
    GET_MEDIA_DOWNLOAD_JOBS: CAPABILITIES.MEDIA_DOWNLOAD
  });
  function registerMessageRouter(policy) {
    const onMessage = (message, sender, sendResponse) => {
      if (!policy.can(CAPABILITIES.CORE_MESSAGING)) {
        sendResponse({ status: "disabled" });
        return false;
      }
      const capability2 = MESSAGE_CAPABILITIES[message?.type];
      if (capability2 && !policy.can(capability2)) {
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
    if (message.type === "MEDIA_DISCOVERED") {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return { status: "ignored" };
      return recordDiscoveredMedia(tabId, {
        ...message.event,
        payload: {
          ...message.event?.payload,
          pageUrl: sender.tab.url || message.event?.payload?.pageUrl,
          title: chooseMediaTitle(
            message.event?.payload?.title,
            sender.tab.title,
            sender.tab.url
          )
        },
        metadata: {
          ...message.event?.metadata,
          frameId: sender.frameId ?? null,
          frameUrl: message.event?.payload?.pageUrl || null
        }
      });
    }
    if (message.type === "MEDIA_PROBED") {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return { status: "ignored" };
      return recordMediaProbe(tabId, {
        ...message.event,
        payload: {
          ...message.event?.payload,
          pageUrl: sender.tab.url || message.event?.payload?.pageUrl
        },
        metadata: {
          ...message.event?.metadata,
          frameId: sender.frameId ?? null,
          frameUrl: message.event?.payload?.pageUrl || null
        }
      });
    }
    if (message.type === "MEDIA_PROBE_DIAGNOSTIC") {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return { status: "ignored" };
      return recordMediaProbeDiagnostic(tabId, {
        ...message.event,
        payload: {
          ...message.event?.payload,
          pageUrl: sender.tab.url || message.event?.payload?.pageUrl
        },
        metadata: {
          ...message.event?.metadata,
          frameId: sender.frameId ?? null,
          frameUrl: message.event?.payload?.pageUrl || null
        }
      });
    }
    if (message.type === "MEDIA_BLOB_TRACED") {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return { status: "ignored" };
      return recordBlobSourceTrace(tabId, {
        ...message.event,
        payload: {
          ...message.event?.payload,
          pageUrl: sender.tab.url || message.event?.payload?.pageUrl
        },
        metadata: {
          ...message.event?.metadata,
          frameId: sender.frameId ?? null,
          frameUrl: message.event?.payload?.pageUrl || null
        }
      });
    }
    if (message.type === "MEDIA_EME_OBSERVED") {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return { status: "ignored" };
      return recordMediaEmeObservation(tabId, {
        ...message.event,
        payload: {
          ...message.event?.payload,
          pageUrl: sender.tab.url || message.event?.payload?.pageUrl
        },
        metadata: {
          ...message.event?.metadata,
          frameId: sender.frameId ?? null,
          frameUrl: message.event?.payload?.pageUrl || null
        }
      });
    }
    if (message.type === "PREPARE_MEDIA_CONTEXTUAL_PROBE") {
      const tabId = sender?.tab?.id;
      const frameId = sender?.frameId;
      if (!Number.isInteger(tabId) || !Number.isInteger(frameId))
        return { status: "ignored" };
      if (!sameOrigin2(message.parentDocumentUrl, sender.tab.url))
        return { status: "invalid_parent" };
      const snapshot = await listDiscoveredMedia(tabId);
      const candidate = snapshot.items.find(
        (item) => item.id === message.mediaId && item.manifestUrl === message.manifestUrl && item.frameId === frameId
      );
      if (!candidate) return { status: "unknown_media" };
      return prepareMediaProbeReferer({
        tabId,
        manifestUrl: candidate.manifestUrl,
        parentDocumentUrl: message.parentDocumentUrl
      });
    }
    if (message.type === "GET_MEDIA_CATALOG") {
      if (!Number.isInteger(message.tabId)) return { status: "invalid_tab" };
      return listDiscoveredMedia(message.tabId, message.pageUrl || null);
    }
    if (message.type === "SAVE_MEDIA_DEBUG_MANIFEST") {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return { status: "ignored" };
      return saveMediaDebugCapture(tabId, message.capture);
    }
    if (message.type === "GET_MEDIA_DEBUG_MANIFEST") {
      if (!isExtensionPageSender(sender)) return { status: "forbidden" };
      if (!Number.isInteger(message.tabId)) return { status: "invalid_tab" };
      return getMediaDebugCapture(message.tabId, message.mediaId);
    }
    if (message.type === "SAVE_DECRYPTED_MEDIA_MANIFEST") {
      const tabId = sender?.tab?.id;
      const frameId = sender?.frameId;
      if (!Number.isInteger(tabId) || !Number.isInteger(frameId))
        return { status: "ignored" };
      const snapshot = await listDiscoveredMedia(tabId);
      const candidate = snapshot.items.find(
        (item) => item.id === message.handoff?.mediaId && item.manifestUrl === message.handoff?.manifestUrl && item.kind === message.handoff?.kind && item.probeSource === "decrypted_blob" && item.frameId === frameId
      );
      if (!candidate) return { status: "catalog_pending" };
      const saved = await saveMediaManifestHandoff(tabId, message.handoff);
      const recorded = await recordMediaManifestHandoff(
        tabId,
        createRegisteredEvent(EVENTS.MEDIA_MANIFEST_HANDOFF_READY, {
          ...saved.handoff,
          pageUrl: candidate.pageUrl
        })
      );
      return recorded.status === "recorded" ? { status: "saved", handoff: saved.handoff } : recorded;
    }
    if (message.type === "GET_MEDIA_HELPER_STATUS") {
      return getMediaHelperStatus({ force: message.force === true });
    }
    if (message.type === "CREATE_MEDIA_DOWNLOAD_JOB")
      return requestMediaDownloadJob({
        tabId: message.tabId,
        mediaId: message.mediaId,
        connections: message.connections
      });
    if (message.type === "CANCEL_MEDIA_DOWNLOAD_JOB")
      return requestMediaDownloadCancel({ jobId: message.jobId });
    if (message.type === "PAUSE_MEDIA_DOWNLOAD_JOB")
      return requestMediaDownloadPause({ jobId: message.jobId });
    if (message.type === "RESUME_MEDIA_DOWNLOAD_JOB")
      return requestMediaDownloadResume({
        jobId: message.jobId,
        connections: message.connections
      });
    if (message.type === "RETRY_MEDIA_DOWNLOAD_JOB")
      return requestMediaDownloadRetry({
        jobId: message.jobId,
        connections: message.connections
      });
    if (message.type === "OPEN_MEDIA_DOWNLOAD_OUTPUT")
      return requestMediaDownloadOpen({ jobId: message.jobId });
    if (message.type === "REVEAL_MEDIA_DOWNLOAD_OUTPUT")
      return requestMediaDownloadReveal({ jobId: message.jobId });
    if (message.type === "REMOVE_MEDIA_DOWNLOAD_HISTORY")
      return requestMediaDownloadHistoryRemove({ jobId: message.jobId });
    if (message.type === "CLEAR_MEDIA_DOWNLOAD_HISTORY")
      return requestMediaDownloadHistoryClear();
    if (message.type === "GET_MEDIA_DOWNLOAD_JOBS")
      return listMediaDownloadJobs();
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
      await handleUserDecision({
        action: "BLACKLIST",
        domain: message.target,
        url: message.url,
        source: message.source
      });
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
      return { status: "saved" };
    }
    if (message.type === "BLOCK_REVIEWED_TAB") {
      await handleUserDecision({
        action: "BLACKLIST",
        domain: message.target,
        url: message.url,
        source: message.source
      });
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
      return { status: "saved" };
    }
    if (message.type === "OPEN_BLOCKED_NAVIGATION") {
      let targetUrl;
      try {
        targetUrl = new URL(message.url);
      } catch {
        return { status: "invalid_url" };
      }
      if (!/^https?:$/.test(targetUrl.protocol)) return { status: "invalid_url" };
      allowUserOpenedNavigation(targetUrl.href);
      await chrome.tabs.create(tabCreateProperties(targetUrl.href, sender));
      return { status: "opened" };
    }
    if (message.type === "ALLOW_BLOCKED_SOURCE") {
      const source = senderSourceHostname(sender);
      const search = getPrefilledSearchNavigation(message.url);
      if (!source || !search) return { status: "invalid_navigation" };
      await syncTrustedPath(source, PREFILLED_SEARCH_TRUST_TARGET, true);
      allowUserOpenedNavigation(message.url);
      const tab = await chrome.tabs.create(
        tabCreateProperties(message.url, sender)
      );
      await showAllowedSearchNavigation({
        tabId: tab.id,
        url: message.url,
        source,
        target: PREFILLED_SEARCH_TRUST_TARGET
      });
      return { status: "allowed" };
    }
    if (message.type === "BLOCK_ALLOWED_SEARCH_SOURCE") {
      const source = String(message.source || "").toLowerCase();
      const search = getPrefilledSearchNavigation(sender?.tab?.url);
      if (!source || !search) return { status: "invalid_navigation" };
      await removeTrustedPath(source, PREFILLED_SEARCH_TRUST_TARGET);
      return { status: "saved" };
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
  function sameOrigin2(left, right) {
    try {
      return new URL(left).origin === new URL(right).origin;
    } catch {
      return false;
    }
  }
  function isExtensionPageSender(sender) {
    const baseUrl = chrome.runtime.getURL("");
    return sender?.id === chrome.runtime.id && typeof sender.url === "string" && sender.url.startsWith(baseUrl);
  }
  function senderSourceHostname(sender) {
    try {
      return new URL(sender?.tab?.url).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  function tabCreateProperties(url, sender) {
    const properties = { url, active: true };
    if (Number.isInteger(sender?.tab?.id)) {
      properties.openerTabId = sender.tab.id;
    }
    return properties;
  }
  async function recordTelemetryBestEffort(event2) {
    try {
      return await recordTelemetry(event2);
    } catch (error) {
      console.warn("[AdsFriendly] Telemetry skipped:", error.message);
      return { status: "skipped", error: error.message };
    }
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
  var VALID_RULE_LAYOUTS = /* @__PURE__ */ new Set(["any", "compact", "wide"]);
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
    const transactionId = createPackageTransactionId();
    const updates = {
      ...packageToStorage(settingsPackage),
      [SETTINGS_PACKAGE_STATE_KEY]: {
        schema_version: "adsfriendly.settings-package-state.v1",
        initialized: true,
        source,
        package: settingsPackage.metadata,
        installed_at: Date.now(),
        transaction_id: transactionId
      }
    };
    await storage.set(updates);
    const saved = await storage.get(SETTINGS_PACKAGE_STATE_KEY);
    if (saved[SETTINGS_PACKAGE_STATE_KEY]?.transaction_id !== transactionId) {
      throw new Error("Could not verify imported settings transaction.");
    }
    const obsoletePathKeys = oldPathKeys.filter((key) => !(key in updates));
    if (obsoletePathKeys.length) await storage.remove(obsoletePathKeys);
    return settingsPackage;
  }
  function createPackageTransactionId() {
    if (typeof globalThis.crypto?.randomUUID === "function")
      return globalThis.crypto.randomUUID();
    return `settings-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  function hasMeaningfulExistingSettings(snapshot = {}) {
    const settings = normalizeSettings(snapshot.appSettings);
    const settingsDiffer = settings.enabled !== DEFAULT_SETTINGS.enabled || settings.protectionMode !== DEFAULT_SETTINGS.protectionMode || settings.mediaDownloadConnections !== DEFAULT_SETTINGS.mediaDownloadConnections || Object.keys(settings.featureOverrides).length > 0;
    return settingsDiffer || !snapshot.appSettings && (snapshot.isEnabled === false || snapshot.friendlyMode === false) || (snapshot.whitelist?.length || 0) > 0 || (snapshot.blacklist?.length || 0) > 0 || Object.keys(snapshot.userCustomRules || {}).length > 0 || Object.keys(snapshot).some((key) => key.startsWith("p:"));
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
      source: cleanText(rule.source || "package", 80),
      layout: VALID_RULE_LAYOUTS.has(rule.layout) ? rule.layout : "any"
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
    function assertAllowed(capability2) {
      assertRegisteredCapability(capability2);
      if (!declared.has(capability2)) {
        throw new Error(
          `[FeatureRegistry] Feature "${definition.id}" tried to use undeclared capability "${capability2}". Add it to that feature in feature-catalog.js.`
        );
      }
    }
    return Object.freeze({
      featureId: definition.id,
      can(capability2) {
        assertAllowed(capability2);
        const settings = readSettings();
        return isCapabilityEnabled(capability2, settings);
      },
      require(capability2) {
        if (!this.can(capability2)) {
          const settings = readSettings();
          throw new Error(
            `[FeatureRegistry] Capability "${capability2}" is disabled for feature "${definition.id}" in mode "${settings.protectionMode}".`
          );
        }
        return true;
      }
    });
  }
  function shouldStartFeature(definition, settings) {
    const override = settings.featureOverrides?.[definition.id];
    if (override === false) return false;
    return isCapabilityEnabled(definition.startCapability, settings);
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

  // src/background/media-request-observer.js
  var OBSERVED_RESOURCE_TYPES = Object.freeze([
    "xmlhttprequest",
    "media",
    "other"
  ]);
  function startBackgroundMediaRequestObserver() {
    const onHeadersReceived = (details) => {
      const observation = createMediaRequestObservation(details);
      if (!observation) return;
      recordObservation(observation).catch(
        (error) => console.debug("[AdsFriendly Media] Request observation skipped", error)
      );
    };
    chrome.webRequest.onHeadersReceived.addListener(
      onHeadersReceived,
      { urls: ["<all_urls>"], types: [...OBSERVED_RESOURCE_TYPES] },
      ["responseHeaders"]
    );
    return () => chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
  }
  function createMediaRequestObservation(details = {}) {
    if (!Number.isInteger(details.tabId) || details.tabId < 0 || typeof details.url !== "string" || !/^https?:/i.test(details.url) || Number(details.statusCode) < 200 || Number(details.statusCode) >= 400)
      return null;
    const mimeType = responseMimeType(details.responseHeaders);
    const kind = classifyMediaSource(details.url, mimeType);
    if (!kind) return null;
    return Object.freeze({
      requestId: String(details.requestId || ""),
      tabId: details.tabId,
      frameId: Number.isInteger(details.frameId) ? details.frameId : -1,
      parentFrameId: Number.isInteger(details.parentFrameId) ? details.parentFrameId : -1,
      initiator: safeHttpOrigin(details.initiator),
      url: details.url,
      mimeType,
      kind,
      method: String(details.method || "GET").toUpperCase(),
      statusCode: Number(details.statusCode),
      fromCache: details.fromCache === true,
      observedAt: Number(details.timeStamp) || Date.now(),
      input: "chrome.webRequest.onHeadersReceived",
      output: "media.catalog.candidate"
    });
  }
  async function recordObservation(observation) {
    const tab = await chrome.tabs.get(observation.tabId);
    if (!tab?.url?.startsWith("http")) return;
    const frameContext = await resolveFrameContext(observation);
    const candidate = createMediaCandidateFromSource({
      pageUrl: tab.url,
      sourceUrl: observation.url,
      mimeType: observation.mimeType,
      title: chooseMediaTitle(null, tab.title, tab.url),
      detectedBy: "network"
    });
    if (!candidate) return;
    candidate.requestContexts = [
      {
        requestUrl: observation.url,
        finalUrl: observation.url,
        documentUrl: frameContext.frameUrl,
        parentDocumentUrl: tab.url,
        referrer: frameContext.frameUrl,
        method: observation.method,
        credentials: "unknown",
        transport: "web_request",
        requiresBrowserSession: true,
        observedAt: observation.observedAt
      }
    ];
    const result = await recordDiscoveredMedia(
      observation.tabId,
      createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate, {
        frameId: frameContext.frameId,
        frameUrl: frameContext.frameUrl,
        observationInput: observation.input,
        observationOutput: observation.output
      })
    );
    if (result?.status !== "recorded" || !["hls", "dash"].includes(candidate.kind) || frameContext.frameId < 0)
      return;
    await chrome.tabs.sendMessage(
      observation.tabId,
      { type: "PROBE_OBSERVED_MEDIA", candidate },
      { frameId: frameContext.frameId }
    ).catch(() => {
    });
  }
  async function resolveFrameContext(observation) {
    if (observation.frameId >= 0) {
      return {
        frameId: observation.frameId,
        frameUrl: observation.initiator
      };
    }
    const snapshot = await listDiscoveredMedia(observation.tabId);
    const matches = snapshot.items.filter(
      (item) => Number.isInteger(item.frameId) && sameOrigin3(item.frameUrl, observation.initiator)
    );
    const frameIds = [...new Set(matches.map((item) => item.frameId))];
    return frameIds.length === 1 ? { frameId: frameIds[0], frameUrl: matches[0].frameUrl } : { frameId: -1, frameUrl: observation.initiator };
  }
  function responseMimeType(headers = []) {
    const header = headers.find(
      (item) => String(item?.name || "").toLowerCase() === "content-type"
    );
    return typeof header?.value === "string" ? header.value : null;
  }
  function safeHttpOrigin(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
    } catch {
      return null;
    }
  }
  function sameOrigin3(left, right) {
    try {
      return new URL(left).origin === new URL(right).origin;
    } catch {
      return false;
    }
  }

  // src/background/index.js
  var controller = createMainController({
    context: "background",
    initialSettings: DEFAULT_SETTINGS,
    implementations: {
      "background.message-router": ({ policy }) => registerMessageRouter(policy),
      "background.media-catalog": () => startBackgroundMediaCatalog(),
      "background.media-debug-capture": () => startMediaDebugCaptureStore(),
      "background.media-manifest-handoff": () => startMediaManifestHandoffStore(),
      "background.media-request-observer": () => startBackgroundMediaRequestObserver(),
      "background.media-download-jobs": ({ policy }) => startMediaDownloadJobStore(policy),
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
      "background.settings-package-seed": async () => {
        try {
          await initializeBundledSettingsPackage();
        } catch (error) {
          console.error(
            "[AdsFriendly Background] Bundled settings initialization failed",
            error
          );
        }
      },
      "background.training-store-migration": () => migrateLegacyTrainingStorage()
    }
  });
  controller.start().then(
    () => loadSettings(chrome.storage.local, {
      persistMissing: true
    })
  ).then((settings) => controller.updateSettings(settings)).catch(
    (error) => console.error("[AdsFriendly Background] MainController failed", error)
  );
})();
