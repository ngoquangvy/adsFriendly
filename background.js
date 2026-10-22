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
    const result2 = await chrome.storage.local.get(["globalAdPatterns"]);
    if (!result2.globalAdPatterns || result2.globalAdPatterns.length === 0)
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

  // src/dom/layout-context.js
  var RESPONSIVE_LAYOUTS = Object.freeze({
    ANY: "any",
    COMPACT: "compact",
    WIDE: "wide"
  });

  // src/dom/element-exceptions.js
  function elementExceptionKey(rule) {
    if (typeof rule?.id === "string" && rule.id.trim()) return rule.id.trim();
    return [
      rule?.selector || "",
      rule?.layout || "any",
      rule?.fingerprint?.linkDomain || "",
      rule?.fingerprint?.srcHost || "",
      rule?.fingerprint?.id || "",
      rule?.fingerprint?.alt || "",
      rule?.fingerprint?.title || "",
      ...rule?.fingerprint?.classTokens || []
    ].join("|");
  }

  // src/shared/storage-verification.js
  function storageValuesEqual(actual, expected) {
    const normalize = (value) => {
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.keys(value).sort().filter((key) => value[key] !== void 0).map((key) => [key, normalize(value[key])])
        );
      return value;
    };
    return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
  }
  function isStorageQuotaError(error) {
    const message = String(error?.message || error || "");
    if (/verification failed/i.test(message)) return false;
    return /\bquota(?:_bytes(?:_per_item)?)?\b.*(?:exceeded|exceeds|limit|full)|(?:storage|disk)(?:\s+is)?\s+full|(?:exceeded|exceeds).*(?:quota|storage.*limit)/i.test(
      message
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
      const result2 = mutationTail.then(operation, operation);
      mutationTail = result2.catch(() => {
      });
      return result2;
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
      upsertElementExceptions(hostname, incomingRules) {
        return serial(async () => {
          const host = normalizeHostname(hostname);
          const additions = normalizeElementExceptions(incomingRules);
          if (!host || !additions.length)
            throw new Error("No valid element exceptions to save.");
          const { userElementExceptions = {} } = await storage.get(
            "userElementExceptions"
          );
          const existing = Array.isArray(userElementExceptions[host]) ? userElementExceptions[host] : [];
          const byIdentity = new Map(
            existing.map((rule) => [elementExceptionKey(rule), rule])
          );
          additions.forEach(
            (rule) => byIdentity.set(elementExceptionKey(rule), rule)
          );
          userElementExceptions[host] = [...byIdentity.values()].slice(
            -MAX_RULES_PER_SITE
          );
          await setAndVerify(storage, { userElementExceptions });
          return {
            status: "saved",
            hostname: host,
            ruleCount: userElementExceptions[host].length
          };
        });
      },
      removeElementExceptions(hostname, ids) {
        return serial(async () => {
          const host = normalizeHostname(hostname);
          const identitySet = normalizeIdentitySet(ids);
          if (!host || !identitySet.size)
            throw new Error("No valid element exceptions to remove.");
          const { userElementExceptions = {} } = await storage.get(
            "userElementExceptions"
          );
          const existing = Array.isArray(userElementExceptions[host]) ? userElementExceptions[host] : [];
          const remaining = existing.filter(
            (rule) => !identitySet.has(elementExceptionKey(rule))
          );
          if (remaining.length) userElementExceptions[host] = remaining;
          else delete userElementExceptions[host];
          await setAndVerify(storage, { userElementExceptions });
          return { status: "saved", hostname: host, ruleCount: remaining.length };
        });
      },
      resetElementDecisions(hostname) {
        return serial(async () => {
          const host = normalizeHostname(hostname);
          if (!host) throw new Error("Invalid hostname for site reset.");
          const {
            userCustomRules = {},
            userElementExceptions = {},
            siteResetHistory = {}
          } = await storage.get([
            "userCustomRules",
            "userElementExceptions",
            "siteResetHistory"
          ]);
          const hiddenRules = Array.isArray(userCustomRules[host]) ? userCustomRules[host] : [];
          const exceptions = Array.isArray(userElementExceptions[host]) ? userElementExceptions[host] : [];
          delete userCustomRules[host];
          delete userElementExceptions[host];
          if (hiddenRules.length) {
            siteResetHistory[host] = {
              oldRules: hiddenRules,
              timestamp: Date.now()
            };
          }
          await setAndVerify(storage, {
            userCustomRules,
            userElementExceptions,
            siteResetHistory
          });
          return {
            status: "saved",
            hostname: host,
            restoredCount: hiddenRules.length,
            forgottenCount: exceptions.length
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
        if (!storageValuesEqual(saved[key], expected)) {
          throw new Error(`Storage verification failed for ${key}.`);
        }
      }
    } catch (error) {
      const message = String(error?.message || error);
      if (isStorageQuotaError(error)) {
        throw new Error(`Settings storage is full: ${message}`);
      }
      throw error;
    }
  }
  function normalizeRules(rules) {
    return (Array.isArray(rules) ? rules : [rules]).filter((rule) => rule && typeof rule === "object").filter((rule) => selectorOf(rule));
  }
  function normalizeElementExceptions(rules) {
    return (Array.isArray(rules) ? rules : [rules]).filter((rule) => rule && typeof rule === "object").map((rule) => ({
      ...rule,
      id: String(rule.id || "").trim() || `not-ad-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      selector: String(rule.selector || "").trim()
    })).filter((rule) => rule.selector && rule.fingerprint);
  }
  function normalizeIdentitySet(values) {
    return new Set(
      (Array.isArray(values) ? values : [values]).map((value) => String(value || "").trim()).filter(Boolean)
    );
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
    const result2 = await chrome.storage.local.get(CLIENT_ID_KEY);
    if (result2[CLIENT_ID_KEY]) return result2[CLIENT_ID_KEY];
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
    BROWSER_DOWNLOAD_OBSERVE: "downloads.browser_observe",
    BROWSER_FILE_TRANSFER: "downloads.file_transfer",
    BROWSER_FILE_AUTO_CHECK: "downloads.file_auto_check",
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
    [C2.BROWSER_FILE_AUTO_CHECK]: capability(
      C2.BROWSER_FILE_AUTO_CHECK,
      "safe",
      T.PASSIVE,
      {
        availableWhenDisabled: true,
        browserPermissions: ["downloads", "nativeMessaging"],
        productIds: [P2.MEDIA_TOOLS],
        requiredComponents: [R.BROWSER_EXTENSION, R.MEDIA_HELPER]
      }
    ),
    [C2.BROWSER_FILE_TRANSFER]: capability(
      C2.BROWSER_FILE_TRANSFER,
      "safe",
      T.USER,
      {
        availableWhenDisabled: true,
        browserPermissions: ["downloads", "nativeMessaging"],
        productIds: [P2.MEDIA_TOOLS],
        requiredComponents: [R.BROWSER_EXTENSION, R.MEDIA_HELPER]
      }
    ),
    [C2.BROWSER_DOWNLOAD_OBSERVE]: capability(
      C2.BROWSER_DOWNLOAD_OBSERVE,
      "safe",
      T.PASSIVE,
      {
        availableWhenDisabled: true,
        browserPermissions: ["downloads", "webRequest"],
        productIds: [P2.MEDIA_TOOLS]
      }
    ),
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
    feature("background.browser-file-handoff", "background", C2.CORE_MAINTENANCE, [
      C2.BROWSER_FILE_TRANSFER,
      C2.BROWSER_FILE_AUTO_CHECK,
      C2.BROWSER_DOWNLOAD_OBSERVE
    ]),
    feature(
      "background.browser-file-auto-check",
      "background",
      C2.BROWSER_FILE_AUTO_CHECK,
      [],
      { enabledByDefault: false }
    ),
    feature(
      "background.browser-download-observer",
      "background",
      C2.BROWSER_DOWNLOAD_OBSERVE,
      [],
      { enabledByDefault: false }
    ),
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
    feature("content.player-download", "content", C2.MEDIA_DOWNLOAD, [
      C2.MEDIA_CATALOG
    ]),
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
    feature("media-frame.player-download", "media-frame", C2.MEDIA_DOWNLOAD, [
      C2.MEDIA_CATALOG
    ]),
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
      "main-world.youtube-player-response",
      "main-world",
      C2.CORE_MESSAGING,
      [C2.MEDIA_OBSERVE]
    ),
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
  function feature(id, context, startCapability, extraCapabilities = [], { enabledByDefault = true } = {}) {
    return Object.freeze({
      id,
      context,
      startCapability,
      enabledByDefault,
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

  // src/background/logs.js
  async function logBlockedNavigation(url, source, attribution = {}) {
    const { blockedLogs = [] } = await chrome.storage.local.get(["blockedLogs"]);
    await chrome.storage.local.set({
      blockedLogs: [
        { url, source, timestamp: Date.now(), attribution },
        ...blockedLogs
      ].slice(0, 20)
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
      },
      evidence: {
        navigation: attribution,
        interpretation: "policy_inference_not_user_label"
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
  var USER_NAVIGATION_TRANSITIONS = /* @__PURE__ */ new Set([
    "typed",
    "generated",
    "keyword",
    "keyword_generated",
    "auto_bookmark"
  ]);
  function isWebNavigationTarget(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }
  function isBrowserUiNewTab({
    url = "",
    pendingUrl = "",
    openerTabId = null
  } = {}) {
    if (Number.isInteger(openerTabId)) return false;
    const initialUrl = pendingUrl || url;
    return initialUrl === "chrome://newtab/" || initialUrl === "chrome://new-tab-page/" || initialUrl.startsWith("chrome-search://local-ntp/");
  }
  function isExplicitAddressBarNavigation({
    transitionType = "",
    transitionQualifiers = []
  } = {}) {
    return USER_NAVIGATION_TRANSITIONS.has(transitionType) || transitionQualifiers.includes("from_address_bar");
  }
  function shouldEvaluateCommittedNavigation(details = {}) {
    return !isExplicitAddressBarNavigation(details);
  }
  function isExplicitAddressBarCommitForUrl(url, details = {}) {
    return Boolean(
      url && details.url === url && !shouldEvaluateCommittedNavigation(details)
    );
  }
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

  // src/navigation/background/attribution.js
  var NAVIGATION_CONTEXT_SCHEMA = "navigation-context.v1";
  var ATTRIBUTION_EVIDENCE = Object.freeze({
    WEB_TARGET: "web_navigation_target",
    OPENER: "opener_tab",
    RECENT_CLICK: "recent_click_timing",
    REVERSE_SEQUENCE: "observed_clone_and_source_redirect"
  });
  var EVIDENCE_RANK = Object.freeze({
    [ATTRIBUTION_EVIDENCE.RECENT_CLICK]: 1,
    [ATTRIBUTION_EVIDENCE.OPENER]: 2,
    [ATTRIBUTION_EVIDENCE.WEB_TARGET]: 3,
    [ATTRIBUTION_EVIDENCE.REVERSE_SEQUENCE]: 3
  });
  function sameIntentUrl(left, right) {
    try {
      const a = new URL(left), b = new URL(right);
      a.hash = "";
      b.hash = "";
      return a.href === b.href;
    } catch {
      return false;
    }
  }
  function createNavigationAttribution({
    now = () => Date.now(),
    maximum = 256
  } = {}) {
    const contexts = /* @__PURE__ */ new Map();
    const intents = /* @__PURE__ */ new Map();
    let nextId = 0;
    const prune = () => {
      const timestamp = now();
      for (const [id, context] of contexts)
        if (context.expiresAt <= timestamp) contexts.delete(id);
      for (const [id, intent] of intents)
        if (timestamp - intent.timestamp > 2500) intents.delete(id);
      while (contexts.size > maximum)
        contexts.delete(contexts.keys().next().value);
      while (intents.size > maximum) intents.delete(intents.keys().next().value);
    };
    const rememberIntent = (click) => {
      prune();
      if (!Number.isInteger(click?.tabId) || !isWebNavigationTarget(click.sourceUrl))
        return;
      const intent = Object.freeze({
        tabId: click.tabId,
        sourceFrameId: Number.isInteger(click.sourceFrameId) ? click.sourceFrameId : null,
        timestamp: now(),
        sourceUrl: click.sourceUrl,
        intentUrl: isWebNavigationTarget(click.intentUrl) ? click.intentUrl : null,
        intentKind: click.intentKind === "promotional" ? "promotional" : "navigation",
        intentReasons: Object.freeze(
          (Array.isArray(click.intentReasons) ? click.intentReasons : []).filter((value) => typeof value === "string").slice(0, 12)
        )
      });
      const key = `${intent.tabId}:${intent.sourceFrameId}`;
      intents.delete(key);
      intents.set(key, intent);
      prune();
      return intent;
    };
    const getIntent = (sourceTabId, sourceFrameId = null) => {
      prune();
      const intent = Number.isInteger(sourceFrameId) ? intents.get(`${sourceTabId}:${sourceFrameId}`) : [...intents.values()].filter((item) => item.tabId === sourceTabId).at(-1);
      if (!intent || now() < intent.timestamp) return null;
      if (Number.isInteger(sourceFrameId) && intent.sourceFrameId !== sourceFrameId)
        return null;
      return intent;
    };
    const latestIntent = () => {
      prune();
      return [...intents.values()].filter((intent) => intent.timestamp <= now()).at(-1) || null;
    };
    const get = (tabId) => {
      prune();
      return contexts.get(tabId) || null;
    };
    const link = ({
      targetTabId,
      sourceTabId,
      sourceFrameId = null,
      sourceUrl = null,
      targetUrl = null,
      evidence,
      origin = "website"
    }) => {
      prune();
      if (!Number.isInteger(targetTabId)) return null;
      if (origin === "website" && (!Number.isInteger(sourceTabId) || !EVIDENCE_RANK[evidence]))
        return null;
      const previous = contexts.get(targetTabId);
      const rank = EVIDENCE_RANK[evidence] || 0;
      if (previous && (previous.origin !== "website" && previous.targetUrl === targetUrl || rank < previous.rank))
        return previous;
      if (previous && previous.sourceTabId === sourceTabId && previous.rank === rank && previous.targetUrl === targetUrl)
        return previous;
      const sameSource2 = Boolean(
        previous && previous.sourceTabId === sourceTabId && (previous.targetUrl === targetUrl || rank > previous.rank || !previous.targetUrl || previous.targetUrl === "about:blank")
      );
      const intent = sameSource2 ? Number.isInteger(sourceFrameId) && previous.intent?.sourceFrameId !== sourceFrameId ? null : previous.intent : getIntent(sourceTabId, sourceFrameId);
      const intentAssociation = !intent ? "none" : sameSource2 && previous.intentAssociation === "matched_link" || sameIntentUrl(intent.intentUrl, targetUrl) ? "matched_link" : !intent.intentUrl && Number.isInteger(sourceFrameId) && intent.sourceFrameId === sourceFrameId && now() - intent.timestamp <= 500 ? "frame_temporal" : "temporal_only";
      const context = Object.freeze({
        schema: NAVIGATION_CONTEXT_SCHEMA,
        navigationId: sameSource2 ? previous.navigationId : `nav-${now().toString(36)}-${++nextId}`,
        targetTabId,
        sourceTabId: sourceTabId ?? null,
        sourceFrameId,
        sourceUrl: sourceUrl || intent?.sourceUrl || (sameSource2 ? previous.sourceUrl : null),
        targetUrl,
        origin,
        rank,
        attribution: origin !== "website" || rank >= 3 ? "confirmed" : rank === 2 ? "probable" : "unconfirmed",
        evidence: Object.freeze([
          ...new Set(
            [...sameSource2 ? previous.evidence : [], evidence].filter(Boolean)
          )
        ]),
        intent: intent || null,
        intentAssociation,
        createdAt: sameSource2 ? previous.createdAt : now(),
        expiresAt: sameSource2 ? previous.expiresAt : now() + 1e4,
        revision: (previous?.revision || 0) + 1
      });
      contexts.set(targetTabId, context);
      prune();
      return context;
    };
    const isCurrent = (context) => {
      const current = get(context?.targetTabId);
      return Boolean(
        current && current.navigationId === context.navigationId && current.revision === context.revision
      );
    };
    const retarget = (context, targetUrl) => {
      if (!isCurrent(context)) return null;
      if (context.targetUrl === targetUrl) return context;
      const updated = Object.freeze({
        ...context,
        targetUrl,
        revision: context.revision + 1
      });
      contexts.set(context.targetTabId, updated);
      return updated;
    };
    const invalidate = (tabId) => {
      contexts.delete(tabId);
    };
    const removeTab = (tabId) => {
      contexts.delete(tabId);
      for (const [key, intent] of intents)
        if (intent.tabId === tabId) intents.delete(key);
      for (const [target, context] of contexts)
        if (context.sourceTabId === tabId) contexts.delete(target);
    };
    return {
      rememberIntent,
      getIntent,
      latestIntent,
      get,
      link,
      retarget,
      isCurrent,
      invalidate,
      removeTab,
      clear: () => {
        contexts.clear();
        intents.clear();
      }
    };
  }
  var navigationAttribution = createNavigationAttribution();
  function navigationAttributionFacts(context) {
    return context ? normalizeNavigationAttributionFacts({
      navigationSchema: context.schema,
      navigationId: context.navigationId,
      attribution: context.attribution,
      origin: context.origin,
      sourceFrameId: context.sourceFrameId,
      revision: context.revision,
      attributionEvidence: context.evidence,
      intentAssociation: context.intentAssociation
    }) : {};
  }
  function normalizeNavigationAttributionFacts(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const facts = {};
    if (value.navigationSchema === NAVIGATION_CONTEXT_SCHEMA)
      facts.navigationSchema = value.navigationSchema;
    if (/^nav-[a-z0-9-]{1,80}$/.test(value.navigationId || ""))
      facts.navigationId = value.navigationId;
    if (["confirmed", "probable", "unconfirmed"].includes(value.attribution))
      facts.attribution = value.attribution;
    if (["extension", "browser-ui", "website", "unknown"].includes(value.origin))
      facts.origin = value.origin;
    for (const key of ["sourceFrameId", "revision"])
      if (Number.isInteger(value[key]) && value[key] >= 0)
        facts[key] = value[key];
    if (["none", "matched_link", "frame_temporal", "temporal_only"].includes(
      value.intentAssociation
    ))
      facts.intentAssociation = value.intentAssociation;
    if (Array.isArray(value.attributionEvidence))
      facts.attributionEvidence = value.attributionEvidence.filter(
        (item) => [
          ...Object.values(ATTRIBUTION_EVIDENCE),
          "registered_extension_action"
        ].includes(item)
      ).slice(0, 8);
    return facts;
  }

  // src/navigation/background/diagnostics.js
  var NAVIGATION_DIAGNOSTICS_SESSION_KEY = "adsfriendly.navigationDiagnostics";
  var DEFAULT_CAPTURE_MS = 10 * 60 * 1e3;
  var MAX_CAPTURE_MS = 15 * 60 * 1e3;
  var BUFFER_TTL_MS = 5 * 60 * 1e3;
  var CAPTURE_TTL_MS = 60 * 60 * 1e3;
  var BUFFER_LIMIT = 120;
  var CAPTURE_LIMIT = 500;
  var ALLOWED_EVENT_TYPES = /* @__PURE__ */ new Set([
    "tab_created",
    "navigation_target_created",
    "navigation_committed",
    "candidate_linked",
    "policy_decided",
    "enforcement_requested",
    "enforcement_completed",
    "tab_removed",
    "capture_triggered"
  ]);
  function normalizeNavigationDiagnosticEvent(event2 = {}, now = Date.now()) {
    const normalized = {
      at: Number.isFinite(event2.at) ? event2.at : now,
      type: ALLOWED_EVENT_TYPES.has(event2.type) ? event2.type : "unknown"
    };
    for (const key of [
      "tabId",
      "sourceTabId",
      "openerTabId",
      "sourceFrameId",
      "revision"
    ]) {
      if (Number.isInteger(event2[key])) normalized[key] = event2[key];
    }
    Object.assign(normalized, normalizeNavigationAttributionFacts(event2));
    for (const key of ["url", "sourceUrl", "targetUrl"]) {
      const safeUrl = summarizeNavigationDiagnosticUrl(event2[key]);
      if (safeUrl) normalized[`${key}Host`] = safeUrl.host;
      if (key === "url" && safeUrl?.hasSearchQuery)
        normalized.searchQueryPresent = true;
    }
    for (const key of [
      "transitionType",
      "role",
      "decision",
      "reviewSurface",
      "action",
      "reason"
    ]) {
      if (typeof event2[key] === "string" && event2[key].length <= 80)
        normalized[key] = event2[key];
    }
    if (Array.isArray(event2.transitionQualifiers)) {
      normalized.transitionQualifiers = event2.transitionQualifiers.filter((value) => typeof value === "string").slice(0, 8);
    }
    if (Array.isArray(event2.reasons)) {
      normalized.reasons = event2.reasons.filter((value) => typeof value === "string").slice(0, 12);
    }
    return normalized;
  }
  function summarizeNavigationDiagnosticUrl(value) {
    if (typeof value !== "string" || !value) return null;
    try {
      const url = new URL(value);
      return {
        host: url.host.slice(0, 255),
        hasSearchQuery: url.searchParams.has("q")
      };
    } catch {
      return null;
    }
  }
  function createNavigationDiagnostics({
    getStorage,
    now = () => Date.now()
  } = {}) {
    let writeQueue = Promise.resolve();
    const enqueue = (operation) => {
      const result2 = writeQueue.then(operation);
      writeQueue = result2.catch(() => {
      });
      return result2;
    };
    const readState = async () => {
      const storage = getStorage?.();
      if (!storage)
        return {
          events: [],
          captureUntil: 0,
          retainUntil: 0,
          captureReason: null
        };
      const snapshot = await storage.get(NAVIGATION_DIAGNOSTICS_SESSION_KEY);
      const state = snapshot?.[NAVIGATION_DIAGNOSTICS_SESSION_KEY];
      return state && typeof state === "object" ? state : { events: [], captureUntil: 0, retainUntil: 0, captureReason: null };
    };
    const pruneEvents = (events, timestamp, extendedRetention) => {
      const ttl = extendedRetention ? CAPTURE_TTL_MS : BUFFER_TTL_MS;
      const limit = extendedRetention ? CAPTURE_LIMIT : BUFFER_LIMIT;
      return (Array.isArray(events) ? events : []).filter(
        (event2) => Number.isFinite(event2?.at) && event2.at >= timestamp - ttl && event2.at <= timestamp + 1e3
      ).slice(-limit);
    };
    const record = (event2) => enqueue(async () => {
      const timestamp = now();
      const state = await readState();
      const captureUntil = Number.isFinite(state.captureUntil) && state.captureUntil > timestamp ? state.captureUntil : 0;
      const retainUntil = Number.isFinite(state.retainUntil) && state.retainUntil > timestamp ? state.retainUntil : 0;
      if (!captureUntil && retainUntil) {
        return { status: "retained", count: state.events?.length || 0 };
      }
      const extendedRetention = captureUntil > timestamp;
      const events = pruneEvents(state.events, timestamp, extendedRetention);
      events.push(normalizeNavigationDiagnosticEvent(event2, timestamp));
      const limit = extendedRetention ? CAPTURE_LIMIT : BUFFER_LIMIT;
      await getStorage()?.set({
        [NAVIGATION_DIAGNOSTICS_SESSION_KEY]: {
          events: events.slice(-limit),
          captureUntil,
          retainUntil,
          captureReason: extendedRetention ? state.captureReason || "developer" : null
        }
      });
      return { status: "recorded", count: events.length };
    });
    const startCapture = ({
      durationMs = DEFAULT_CAPTURE_MS,
      reason = "developer"
    } = {}) => enqueue(async () => {
      const timestamp = now();
      const duration = Math.min(
        MAX_CAPTURE_MS,
        Math.max(
          6e4,
          Number.isFinite(durationMs) ? durationMs : DEFAULT_CAPTURE_MS
        )
      );
      const state = await readState();
      const events = pruneEvents(state.events, timestamp, true);
      const captureUntil = timestamp + duration;
      events.push(
        normalizeNavigationDiagnosticEvent(
          { type: "capture_triggered", reason },
          timestamp
        )
      );
      await getStorage()?.set({
        [NAVIGATION_DIAGNOSTICS_SESSION_KEY]: {
          events: events.slice(-CAPTURE_LIMIT),
          captureUntil,
          retainUntil: captureUntil + CAPTURE_TTL_MS,
          captureReason: reason
        }
      });
      return { status: "capturing", captureUntil };
    });
    const stopCapture = () => enqueue(async () => {
      const timestamp = now();
      const state = await readState();
      const retainUntil = Number.isFinite(state.retainUntil) && state.retainUntil > timestamp ? state.retainUntil : timestamp + CAPTURE_TTL_MS;
      const events = pruneEvents(state.events, timestamp, true);
      await getStorage()?.set({
        [NAVIGATION_DIAGNOSTICS_SESSION_KEY]: {
          events: events.slice(-CAPTURE_LIMIT),
          captureUntil: 0,
          retainUntil,
          captureReason: state.captureReason || "developer"
        }
      });
      return { status: "stopped", count: events.length };
    });
    const getSnapshot = () => enqueue(async () => {
      const timestamp = now();
      const state = await readState();
      const captureUntil = Number.isFinite(state.captureUntil) && state.captureUntil > timestamp ? state.captureUntil : 0;
      const retainUntil = Number.isFinite(state.retainUntil) && state.retainUntil > timestamp ? state.retainUntil : 0;
      const extendedRetention = captureUntil > timestamp || retainUntil > timestamp;
      const events = pruneEvents(state.events, timestamp, extendedRetention);
      return {
        events,
        captureUntil,
        retainedUntil: retainUntil,
        captureReason: extendedRetention ? state.captureReason || "developer" : null
      };
    });
    const clear = () => enqueue(async () => {
      await getStorage()?.remove(NAVIGATION_DIAGNOSTICS_SESSION_KEY);
      return { status: "cleared" };
    });
    return { record, startCapture, stopCapture, getSnapshot, clear };
  }
  var navigationDiagnostics = createNavigationDiagnostics({
    getStorage: () => chrome.storage.session
  });

  // src/navigation/background/managed-tabs.js
  var ACTION_TTL_MS = 5e3;
  var MANAGED_ACTIONS = /* @__PURE__ */ new Set([
    "extension_action",
    "download_manager",
    "element_decisions",
    "user_restore",
    "user_open_once",
    "user_allow_source"
  ]);
  function createManagedTabRegistry({
    now = () => Date.now(),
    maximum = 32
  } = {}) {
    const pending = /* @__PURE__ */ new Set();
    const receipts = /* @__PURE__ */ new Map();
    let nextId = 0;
    const prune = () => {
      for (const action2 of pending)
        if (action2.expiresAt <= now()) pending.delete(action2);
      for (const [id, receipt] of receipts)
        if (receipt.expiresAt <= now()) receipts.delete(id);
    };
    const owns = (tabId, url) => {
      prune();
      const receipt = receipts.get(tabId);
      return receipt?.url === url ? receipt : null;
    };
    const matching = (tab) => [...pending].filter(
      (action2) => action2.expiresAt > now() && action2.url === (tab.pendingUrl || tab.url) && (!Number.isInteger(tab.windowId) || !Number.isInteger(action2.windowId) || action2.windowId === tab.windowId)
    );
    const open = async (properties, {
      reason = "extension_action",
      create = (value) => chrome.tabs.create(value)
    } = {}) => {
      prune();
      if (!MANAGED_ACTIONS.has(reason))
        throw new Error(
          "Unknown managed tab action. Register its purpose before use."
        );
      const target = new URL(properties.url);
      if (!["http:", "https:", "chrome-extension:"].includes(target.protocol))
        throw new Error("Unsupported managed tab destination.");
      if (pending.size >= maximum)
        throw new Error("Too many pending extension tab actions.");
      let finish;
      const action2 = {
        url: target.href,
        windowId: properties.windowId,
        expiresAt: now() + ACTION_TTL_MS,
        reason,
        settled: new Promise((resolve) => {
          finish = resolve;
        })
      };
      pending.add(action2);
      try {
        const tab = await create(properties);
        if (Number.isInteger(tab?.id)) {
          receipts.set(tab.id, {
            url: action2.url,
            reason,
            navigationId: `nav-${now().toString(36)}-managed-${++nextId}`,
            expiresAt: now() + ACTION_TTL_MS
          });
          while (receipts.size > maximum)
            receipts.delete(receipts.keys().next().value);
        }
        return tab;
      } finally {
        pending.delete(action2);
        finish();
      }
    };
    const waitForCreatedTab = async (tab) => {
      if (owns(tab.id, tab.pendingUrl || tab.url)) return true;
      const actions = matching(tab);
      if (!actions.length) return false;
      let timeout;
      try {
        await Promise.race([
          Promise.all(actions.map((action2) => action2.settled)),
          new Promise((resolve) => {
            timeout = setTimeout(resolve, ACTION_TTL_MS);
          })
        ]);
      } finally {
        clearTimeout(timeout);
      }
      return Boolean(owns(tab.id, tab.pendingUrl || tab.url));
    };
    return {
      open,
      owns,
      hasPending: (tab) => matching(tab).length > 0,
      waitForCreatedTab,
      removeTab: (tabId) => receipts.delete(tabId),
      clear: () => receipts.clear()
    };
  }
  var managedNavigationTabs = createManagedTabRegistry();
  var openExtensionManagedTab = (properties, reason) => managedNavigationTabs.open(properties, { reason });

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

  // src/navigation/background/enforcement-policy.js
  function constrainNavigationEnforcement(context, evaluation) {
    if (context?.origin === "extension" || context?.origin === "browser-ui") {
      return {
        ...evaluation,
        decision: NEW_TAB_DECISIONS.ALLOW,
        reviewSurface: null,
        attributionReason: "owned_user_navigation"
      };
    }
    if (context?.attribution === "confirmed")
      return { ...evaluation, attributionReason: "confirmed_source" };
    if (evaluation.decision === NEW_TAB_DECISIONS.ALLOW)
      return { ...evaluation, attributionReason: "existing_allow_policy" };
    const hasAdEvidence = evaluation.targetLikelyAd || evaluation.promotionalIntent || evaluation.blacklisted;
    return {
      ...evaluation,
      decision: hasAdEvidence ? NEW_TAB_DECISIONS.VERIFY : NEW_TAB_DECISIONS.ALLOW,
      reviewSurface: hasAdEvidence ? NEW_TAB_REVIEW_SURFACES.TOAST : null,
      attributionReason: "insufficient_source_evidence",
      mayReplacePage: false
    };
  }

  // src/navigation/background/policy.js
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
  async function evaluateNavigationPolicy({
    sourceUrl: sourceValue,
    targetUrl: targetValue,
    allowMatchingIntent = false,
    allowTrustedInitiator = true,
    context
  }, { storage = chrome.storage.local, readTrustedPath = getTrustedPath } = {}) {
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
    const [{ whitelist = [], blacklist = [] }, path] = await Promise.all([
      storage.get(["whitelist", "blacklist"]),
      readTrustedPath(sourceUrl.hostname, trustTarget)
    ]);
    const intentClassification = classifyCapturedIntent(context);
    const promotionalIntent = intentClassification.likelyAd;
    const allowedSearch = prefilledSearch && path?.isManual === true;
    const matchingIntent = allowMatchingIntent && hasMatchingIntent(context, targetDomain);
    const blacklisted = isBlacklistedTarget(targetDomain, blacklist);
    const decision = allowedSearch ? NEW_TAB_DECISIONS.ALLOW : decideNewTabNavigation({
      sameSite,
      trustedInitiator: allowTrustedInitiator && isTrustedInitiator(sourceUrl.hostname),
      trustedTarget: isTrustedTarget(targetDomain),
      whitelisted: whitelist.includes(targetDomain),
      blacklisted,
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
    const evaluation = constrainNavigationEnforcement(context, {
      sourceUrl,
      targetUrl,
      targetDomain,
      sameSite,
      trustTarget,
      allowedSearch,
      decision,
      reviewSurface,
      blacklisted,
      promotionalIntent,
      targetLikelyAd: targetClassification.likelyAd,
      reasons: [
        .../* @__PURE__ */ new Set([
          ...targetClassification.reasons,
          ...intentClassification.reasons
        ])
      ]
    });
    if (evaluation.decision !== NEW_TAB_DECISIONS.ALLOW && promotionalIntent && !targetClassification.likelyAd && !blacklisted && context?.intentAssociation !== "matched_link") {
      return {
        ...evaluation,
        decision: NEW_TAB_DECISIONS.VERIFY,
        reviewSurface: "toast",
        mayReplacePage: false,
        attributionReason: "intent_not_linked_to_destination"
      };
    }
    return evaluation;
  }
  function hasMatchingIntent(context, targetDomain) {
    const click = context?.intent;
    if (!click || context.intentAssociation !== "matched_link") return false;
    const intent = parseUrl(click.intentUrl);
    if (classifyCapturedIntent(context).likelyAd) return false;
    return !!intent && (sameHostnameOrSubdomain(targetDomain, intent.hostname) || sameHostnameOrSubdomain(intent.hostname, targetDomain));
  }
  function classifyCapturedIntent(context) {
    const click = context?.intent;
    if (!click || !["matched_link", "frame_temporal"].includes(context.intentAssociation))
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

  // src/navigation/background/user-navigation.js
  function createUserNavigationTracker({
    now = () => Date.now(),
    maximum = 256
  } = {}) {
    const sessions = /* @__PURE__ */ new Map();
    const get = (tabId) => {
      const session = sessions.get(tabId);
      if (!session || session.expiresAt <= now()) {
        sessions.delete(tabId);
        return null;
      }
      return session;
    };
    const begin = (tabId, url) => {
      try {
        const target = new URL(url);
        if (!/^https?:$/.test(target.protocol)) return;
        sessions.set(tabId, {
          url: target.href,
          expiresAt: now() + 1e4,
          redirects: 0
        });
        while (sessions.size > maximum)
          sessions.delete(sessions.keys().next().value);
      } catch {
      }
    };
    const continueRedirect = ({ tabId, url, transitionQualifiers = [] }) => {
      const session = get(tabId);
      if (!session || session.redirects >= 5 || !transitionQualifiers.some(
        (value) => value === "server_redirect" || value === "client_redirect"
      ))
        return false;
      try {
        const previous = new URL(session.url), next = new URL(url);
        const google = (host) => /(^|\.)google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host);
        const sameHost = previous.hostname === next.hostname || previous.hostname.endsWith(`.${next.hostname}`) || next.hostname.endsWith(`.${previous.hostname}`);
        const sameGoogleSearch = google(previous.hostname) && google(next.hostname) && previous.pathname === "/search" && next.pathname === "/search" && previous.searchParams.has("q") && previous.searchParams.get("q") === next.searchParams.get("q");
        if (!/^https?:$/.test(next.protocol) || (!(google(previous.hostname) && google(next.hostname)) ? !sameHost : !sameGoogleSearch))
          return false;
        session.url = next.href;
        session.redirects++;
        return true;
      } catch {
        return false;
      }
    };
    return {
      begin,
      continueRedirect,
      removeTab: (tabId) => sessions.delete(tabId),
      clear: () => sessions.clear()
    };
  }
  var userNavigationTracker = createUserNavigationTracker();

  // src/navigation/background/guard.js
  var pendingTabs = /* @__PURE__ */ new Map();
  var handledTabs = /* @__PURE__ */ new Map();
  var evaluatingTabs = /* @__PURE__ */ new Map();
  var reverseCandidatesBySource = /* @__PURE__ */ new Map();
  var reverseCandidatesByClone = /* @__PURE__ */ new Map();
  var committedUrlsByTab = /* @__PURE__ */ new Map();
  var committedNavigationsByTab = /* @__PURE__ */ new Map();
  var pendingReviewToasts = /* @__PURE__ */ new Map();
  var blockedNoticesBySource = /* @__PURE__ */ new Map();
  var browserUiTabs = /* @__PURE__ */ new Map();
  var explicitNavigationEpochs = /* @__PURE__ */ new Map();
  var navigationPolicy = null;
  var guardGeneration = 0;
  function registerNavigationGuard(policy) {
    const generation = ++guardGeneration;
    navigationPolicy = policy;
    chrome.tabs.query({}).then((tabs) => {
      if (generation !== guardGeneration) return;
      for (const tab of tabs) rememberCommittedUrl(tab.id, tab.url);
    }).catch(() => {
    });
    const onCreatedNavigationTarget = (details) => {
      if (deferManagedTab(
        { id: details.tabId, url: details.url },
        () => onCreatedNavigationTarget(details)
      ))
        return;
      if (!isBlankUrl(details.url) && !isWebNavigationTarget(details.url)) return;
      if (browserUiTabs.has(details.tabId) || isExplicitAddressBarCommitForUrl(
        details.url,
        committedNavigationsByTab.get(details.tabId)
      ))
        return;
      recordNavigationTrace({
        type: "navigation_target_created",
        sourceTabId: details.sourceTabId,
        tabId: details.tabId,
        url: details.url,
        role: "web_created_target"
      });
      const context = registerPendingTab(
        { id: details.tabId, url: details.url },
        details.sourceTabId,
        ATTRIBUTION_EVIDENCE.WEB_TARGET,
        details.sourceFrameId
      );
      if (!context) return;
      evaluateNewTab({
        sourceTabId: details.sourceTabId,
        tabId: details.tabId,
        url: details.url,
        context
      });
    };
    const registerPendingTab = (tab, sourceTabId, evidence, sourceFrameId = null) => {
      if (!Number.isInteger(tab?.id) || !Number.isInteger(sourceTabId)) return;
      const destination = tab.pendingUrl || tab.url;
      if (destination && !isBlankUrl(destination) && !isWebNavigationTarget(destination))
        return;
      const initialUrl = tab.pendingUrl || tab.url;
      if (isExplicitAddressBarCommitForUrl(
        initialUrl,
        committedNavigationsByTab.get(tab.id)
      ))
        return;
      const context = navigationAttribution.link({
        targetTabId: tab.id,
        sourceTabId,
        sourceFrameId,
        targetUrl: initialUrl,
        sourceUrl: committedUrlsByTab.get(sourceTabId),
        evidence
      });
      if (!context || context.origin !== "website") return;
      if (context.targetUrl !== initialUrl) return context;
      recordNavigationTrace({
        type: "candidate_linked",
        tabId: tab.id,
        sourceTabId: context.sourceTabId,
        openerTabId: tab.openerTabId,
        url: tab.pendingUrl || tab.url,
        role: evidence,
        ...navigationAttributionFacts(context)
      });
      rememberCommittedUrl(tab.id, tab.pendingUrl || tab.url);
      pendingTabs.set(tab.id, context);
      trackReverseCandidate({
        sourceTabId: context.sourceTabId,
        cloneTabId: tab.id,
        cloneUrl: tab.pendingUrl || tab.url,
        context
      }).catch(logReversePopunderError);
      setTimeout(() => {
        if (pendingTabs.get(tab.id) === context) pendingTabs.delete(tab.id);
      }, 1e4);
      if (initialUrl && !isBlankUrl(initialUrl)) {
        const committed = committedNavigationsByTab.get(tab.id);
        if (isExplicitAddressBarCommitForUrl(initialUrl, committed)) {
          pendingTabs.delete(tab.id);
          return;
        }
        if (committed?.url === initialUrl) {
          evaluateNewTab({
            sourceTabId: context.sourceTabId,
            tabId: tab.id,
            url: initialUrl,
            context
          });
        }
      }
      return context;
    };
    const markManagedTab = (tab) => {
      const receipt = managedNavigationTabs.owns(
        tab.id,
        tab.pendingUrl || tab.url
      );
      if (!receipt) return false;
      cancelTabAttribution(tab.id);
      recordNavigationTrace({
        type: "candidate_linked",
        tabId: tab.id,
        url: receipt.url,
        navigationSchema: "navigation-context.v1",
        navigationId: receipt.navigationId,
        origin: "extension",
        attribution: "confirmed",
        attributionEvidence: ["registered_extension_action"],
        reason: receipt.reason
      });
      return true;
    };
    const deferManagedTab = (tab, retry) => {
      if (markManagedTab(tab)) return true;
      if (!managedNavigationTabs.hasPending(tab)) return false;
      managedNavigationTabs.waitForCreatedTab(tab).then((owned) => {
        if (!navigationPolicy || generation !== guardGeneration) return;
        if (owned) markManagedTab(tab);
        else retry();
      }).catch(() => {
      });
      return true;
    };
    const onCreated = (tab) => {
      rememberCommittedUrl(tab.id, tab.pendingUrl || tab.url);
      recordNavigationTrace({
        type: "tab_created",
        tabId: tab.id,
        openerTabId: tab.openerTabId,
        url: tab.pendingUrl || tab.url,
        role: Number.isInteger(tab.openerTabId) ? "has_opener" : "no_opener"
      });
      if (deferManagedTab(tab, () => onCreated(tab))) return;
      if (isBrowserUiNewTab({ ...tab, openerTabId: null }) && Number.isInteger(tab.id)) {
        browserUiTabs.set(tab.id, Date.now());
        setTimeout(() => browserUiTabs.delete(tab.id), 2 * 60 * 1e3);
        return;
      }
      const initialUrl = tab.pendingUrl || tab.url;
      if (initialUrl && !isBlankUrl(initialUrl) && !isWebNavigationTarget(initialUrl))
        return;
      const recentIntent = navigationAttribution.latestIntent();
      const sourceTabId = Number.isInteger(tab.openerTabId) ? tab.openerTabId : recentIntent?.tabId;
      if (Number.isInteger(sourceTabId)) {
        registerPendingTab(
          tab,
          sourceTabId,
          Number.isInteger(tab.openerTabId) ? ATTRIBUTION_EVIDENCE.OPENER : ATTRIBUTION_EVIDENCE.RECENT_CLICK
        );
        return;
      }
      if (!Number.isInteger(tab.id)) return;
      setTimeout(async () => {
        if (!navigationPolicy || generation !== guardGeneration || pendingTabs.has(tab.id) || handledTabs.has(tab.id) || browserUiTabs.has(tab.id))
          return;
        const delayedSourceTabId = navigationAttribution.latestIntent()?.tabId;
        if (!Number.isInteger(delayedSourceTabId)) return;
        try {
          const currentTab = await chrome.tabs.get(tab.id);
          if (deferManagedTab(currentTab, () => onCreated(currentTab))) return;
          registerPendingTab(
            currentTab,
            delayedSourceTabId,
            ATTRIBUTION_EVIDENCE.RECENT_CLICK
          );
        } catch {
        }
      }, 300);
    };
    const onCommitted = (details) => {
      if (details.frameId !== 0 || isBlankUrl(details.url)) return;
      if (markManagedTab({ id: details.tabId, url: details.url })) return;
      if (!isWebNavigationTarget(details.url)) {
        cancelTabAttribution(details.tabId);
        return;
      }
      const wasBrowserUiTab = browserUiTabs.has(details.tabId);
      const explicitAddressBarCommit = !shouldEvaluateCommittedNavigation(details);
      committedNavigationsByTab.set(details.tabId, {
        url: details.url,
        transitionType: details.transitionType,
        transitionQualifiers: details.transitionQualifiers || []
      });
      if (explicitAddressBarCommit) {
        if (pendingTabs.has(details.tabId) || evaluatingTabs.has(details.tabId) || reverseCandidatesByClone.has(details.tabId) || reverseCandidatesBySource.has(details.tabId)) {
          triggerNavigationDiagnosticCapture(
            "address_bar_commit_superseded_pending_ad_candidate"
          );
        }
      }
      recordNavigationTrace({
        type: "navigation_committed",
        tabId: details.tabId,
        url: details.url,
        transitionType: details.transitionType,
        transitionQualifiers: details.transitionQualifiers,
        role: wasBrowserUiTab ? "browser_ui_tab" : explicitAddressBarCommit ? "explicit_user_navigation" : "tracked_or_unknown"
      });
      const userRedirect = userNavigationTracker.continueRedirect(details);
      if (wasBrowserUiTab || explicitAddressBarCommit || userRedirect) {
        cancelTabAttribution(details.tabId);
        if (!userRedirect)
          userNavigationTracker.begin(details.tabId, details.url);
        browserUiTabs.delete(details.tabId);
        pendingTabs.delete(details.tabId);
        rememberCommittedUrl(details.tabId, details.url);
        return;
      }
      const previousContext = pendingTabs.get(details.tabId);
      if (previousContext) {
        const updated = navigationAttribution.retarget(
          previousContext,
          details.url
        );
        if (updated) {
          pendingTabs.set(details.tabId, updated);
          const clone = reverseCandidatesByClone.get(details.tabId);
          if (clone) clone.context = updated;
        }
      }
      observeReverseNavigation(details.tabId, details.url);
      rememberCommittedUrl(details.tabId, details.url);
      const pending = pendingTabs.get(details.tabId);
      if (!pending) return;
      if (!navigationAttribution.isCurrent(pending)) {
        pendingTabs.delete(details.tabId);
        return;
      }
      evaluateNewTab({
        sourceTabId: pending.sourceTabId,
        tabId: details.tabId,
        url: details.url,
        context: pending
      });
    };
    const onRemoved = (tabId) => {
      recordNavigationTrace({
        type: "tab_removed",
        tabId,
        url: committedUrlsByTab.get(tabId),
        sourceTabId: pendingTabs.get(tabId)?.sourceTabId,
        role: "no_extension_removal_cause_recorded"
      });
      committedUrlsByTab.delete(tabId);
      committedNavigationsByTab.delete(tabId);
      pendingReviewToasts.delete(tabId);
      browserUiTabs.delete(tabId);
      explicitNavigationEpochs.delete(tabId);
      pendingTabs.delete(tabId);
      handledTabs.delete(tabId);
      navigationAttribution.removeTab(tabId);
      managedNavigationTabs.removeTab(tabId);
      userNavigationTracker.removeTab(tabId);
      for (const candidate of /* @__PURE__ */ new Set([
        reverseCandidatesBySource.get(tabId),
        reverseCandidatesByClone.get(tabId)
      ]))
        if (candidate) cleanupReverseCandidate(candidate);
    };
    chrome.webNavigation.onCreatedNavigationTarget.addListener(
      onCreatedNavigationTarget
    );
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      if (generation !== guardGeneration) return;
      guardGeneration++;
      chrome.webNavigation.onCreatedNavigationTarget.removeListener(
        onCreatedNavigationTarget
      );
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      pendingTabs.clear();
      evaluatingTabs.clear();
      reverseCandidatesBySource.clear();
      reverseCandidatesByClone.clear();
      committedUrlsByTab.clear();
      committedNavigationsByTab.clear();
      pendingReviewToasts.clear();
      blockedNoticesBySource.clear();
      handledTabs.clear();
      navigationAttribution.clear();
      managedNavigationTabs.clear();
      userNavigationTracker.clear();
      browserUiTabs.clear();
      explicitNavigationEpochs.clear();
      navigationPolicy = null;
    };
  }
  function cancelTabAttribution(tabId) {
    explicitNavigationEpochs.set(
      tabId,
      (explicitNavigationEpochs.get(tabId) || 0) + 1
    );
    navigationAttribution.invalidate(tabId);
    pendingTabs.delete(tabId);
    pendingReviewToasts.delete(tabId);
    for (const candidate of /* @__PURE__ */ new Set([
      reverseCandidatesBySource.get(tabId),
      reverseCandidatesByClone.get(tabId)
    ]))
      if (candidate) cleanupReverseCandidate(candidate);
  }
  async function trackReverseCandidate({
    sourceTabId,
    cloneTabId,
    cloneUrl,
    context
  }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_REVERSE_POPUNDER) || !sourceTabId || !cloneTabId)
      return;
    if (!navigationAttribution.isCurrent(context)) return;
    const previousClone = reverseCandidatesByClone.get(cloneTabId);
    if (previousClone && previousClone.sourceTabId !== sourceTabId)
      cleanupReverseCandidate(previousClone);
    let candidate = reverseCandidatesBySource.get(sourceTabId);
    if (candidate && candidate.cloneTabId !== cloneTabId) {
      cleanupReverseCandidate(candidate);
      candidate = null;
    }
    if (!candidate) {
      candidate = {
        sourceTabId,
        cloneTabId,
        originalUrl: context.sourceUrl || context.intent?.sourceUrl || committedUrlsByTab.get(sourceTabId),
        context,
        cloneUrl: null,
        redirectedUrl: null,
        createdAt: Date.now(),
        handling: false,
        reviewTimer: null,
        revision: 0
      };
      reverseCandidatesBySource.set(sourceTabId, candidate);
      reverseCandidatesByClone.set(cloneTabId, candidate);
      setTimeout(
        () => cleanupReverseCandidate(candidate),
        REVERSE_POPUNDER_WINDOW_MS + 500
      );
    }
    candidate.context = context;
    if (!candidate.originalUrl) {
      try {
        const sourceTab = await chrome.tabs.get(sourceTabId);
        if (sourceTab?.url?.startsWith("http")) {
          candidate.originalUrl = sourceTab.url;
        }
      } catch {
      }
    }
    if (!isCurrentReverseCandidate(candidate)) return;
    if (cloneUrl && !isBlankUrl(cloneUrl)) candidate.cloneUrl = cloneUrl;
    maybeHandleReversePopunder(candidate).catch(logReversePopunderError);
  }
  function observeReverseNavigation(tabId, url) {
    const cloneCandidate = reverseCandidatesByClone.get(tabId);
    if (cloneCandidate) {
      if (cloneCandidate.cloneUrl !== url) cloneCandidate.revision++;
      cloneCandidate.cloneUrl = url;
      maybeHandleReversePopunder(cloneCandidate).catch(logReversePopunderError);
    }
    const sourceCandidate = reverseCandidatesBySource.get(tabId);
    if (sourceCandidate) {
      if (sourceCandidate.redirectedUrl !== url) sourceCandidate.revision++;
      sourceCandidate.redirectedUrl = url;
      maybeHandleReversePopunder(sourceCandidate).catch(logReversePopunderError);
    }
  }
  async function maybeHandleReversePopunder(candidate) {
    if (!isCurrentReverseCandidate(candidate) || candidate.handling || !candidate.originalUrl || !candidate.cloneUrl || !candidate.redirectedUrl)
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
    if (candidate.context.attribution !== "confirmed") {
      const context = navigationAttribution.link({
        targetTabId: candidate.cloneTabId,
        sourceTabId: candidate.sourceTabId,
        sourceFrameId: candidate.context.sourceFrameId,
        sourceUrl: candidate.originalUrl,
        targetUrl: candidate.cloneUrl,
        evidence: ATTRIBUTION_EVIDENCE.REVERSE_SEQUENCE
      });
      if (!context || context.origin !== "website") return;
      candidate.context = context;
      pendingTabs.set(candidate.cloneTabId, context);
      recordNavigationTrace({
        type: "candidate_linked",
        tabId: candidate.cloneTabId,
        sourceTabId: candidate.sourceTabId,
        role: "reverse_sequence_confirmed",
        ...navigationAttributionFacts(context)
      });
    }
    candidate.handling = true;
    const expectedRevision = candidate.revision;
    const expectedContext = candidate.context;
    const isCurrent = () => isCurrentReverseCandidate(candidate) && candidate.revision === expectedRevision && navigationAttribution.isCurrent(expectedContext);
    if (await isAllowedReverseRedirect(candidate)) {
      cleanupReverseCandidate(candidate);
      return;
    }
    if (!isCurrent()) return;
    const sourceHost = new URL(candidate.originalUrl).hostname;
    try {
      const sourceTab = await chrome.tabs.get(candidate.sourceTabId);
      if (!isCurrent() || (sourceTab.pendingUrl || sourceTab.url) !== candidate.redirectedUrl)
        return;
    } catch {
      return;
    }
    let enforcementPlan = createNavigationEnforcementPlan({
      sequence: NAVIGATION_SEQUENCES.ORIGINAL_TAB_WAS_REDIRECTED,
      originalTabId: candidate.sourceTabId,
      openedTabId: candidate.cloneTabId
    });
    let applied = false;
    try {
      const cloneTab = await chrome.tabs.get(candidate.cloneTabId);
      if (!isCurrent()) return;
      if (!cloneTab?.url || !isSelfCloneNavigation(candidate.originalUrl, cloneTab.url))
        throw new Error("clone gone");
      await chrome.tabs.update(enforcementPlan.survivingTabId, { active: true });
      if (!isCurrent()) return;
      recordNavigationTrace({
        type: "enforcement_requested",
        tabId: enforcementPlan.closeTabId,
        sourceTabId: enforcementPlan.notifyTabId,
        targetUrl: candidate.redirectedUrl,
        action: "close_tab",
        role: "reverse_popunder",
        ...navigationAttributionFacts(expectedContext)
      });
      await chrome.tabs.remove(enforcementPlan.closeTabId);
      applied = true;
    } catch {
      if (!isCurrent()) return;
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
        applied = true;
      } catch {
      }
    } finally {
      if (applied) {
        recordNavigationTrace({
          type: "enforcement_completed",
          tabId: enforcementPlan.closeTabId ?? enforcementPlan.restoreTabId,
          sourceTabId: enforcementPlan.notifyTabId,
          action: enforcementPlan.restoreTabId === null ? "close_tab" : "restore_original",
          role: "reverse_popunder",
          ...navigationAttributionFacts(expectedContext)
        });
        void logBlockedNavigationIfAllowed(
          candidate.redirectedUrl,
          sourceHost,
          expectedContext
        );
        pendingTabs.delete(candidate.cloneTabId);
        await showBlockedNavigationToast({
          sourceTabId: enforcementPlan.notifyTabId,
          url: candidate.redirectedUrl,
          source: sourceHost,
          target: new URL(candidate.redirectedUrl).hostname
        });
        cleanupReverseCandidate(candidate);
      }
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
    if (candidate.handling || !isCurrentReverseCandidate(candidate)) return;
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
    const revision = candidate.revision;
    const context = candidate.context;
    const evaluation = await evaluateNavigationPolicy({
      sourceUrl: candidate.originalUrl,
      targetUrl: candidate.redirectedUrl,
      sourceTabId: candidate.sourceTabId,
      allowMatchingIntent: true,
      allowTrustedInitiator: false,
      context
    });
    if (!isCurrentReverseCandidate(candidate) || candidate.revision !== revision || !navigationAttribution.isCurrent(context))
      return;
    if (evaluation.decision !== NEW_TAB_DECISIONS.ALLOW) {
      await showNavigationReviewToast({
        tabId: candidate.sourceTabId,
        url: candidate.redirectedUrl,
        source: evaluation.sourceUrl.hostname,
        target: evaluation.targetDomain,
        context
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
      allowTrustedInitiator: false,
      context: candidate.context
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
  function isCurrentReverseCandidate(candidate) {
    return reverseCandidatesBySource.get(candidate.sourceTabId) === candidate && reverseCandidatesByClone.get(candidate.cloneTabId) === candidate && navigationAttribution.isCurrent(candidate.context);
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
  async function evaluateNewTab({ sourceTabId, tabId, url, context }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_GUARD)) return;
    if (!sourceTabId || !tabId || !url || isBlankUrl(url)) return;
    if (!isWebNavigationTarget(url)) return;
    if (context?.targetUrl !== url) return;
    if (!navigationAttribution.isCurrent(context) || handledTabs.get(tabId) === context)
      return;
    if (evaluatingTabs.get(tabId) === context) return;
    evaluatingTabs.set(tabId, context);
    const evaluationEpoch = explicitNavigationEpochs.get(tabId) || 0;
    const isCurrentEvaluation = () => navigationPolicy && navigationAttribution.isCurrent(context) && (explicitNavigationEpochs.get(tabId) || 0) === evaluationEpoch;
    const canEnforce = async () => {
      if (!isCurrentEvaluation()) return false;
      try {
        const tab = await chrome.tabs.get(tabId);
        return isCurrentEvaluation() && (tab.pendingUrl || tab.url) === url;
      } catch {
        return false;
      }
    };
    let shouldFinalize = false;
    try {
      const sourceTab = await chrome.tabs.get(sourceTabId);
      const capturedSourceUrl = context.sourceUrl || context.intent?.sourceUrl || sourceTab?.url;
      if (!capturedSourceUrl?.startsWith("http")) return;
      const evaluation = await evaluateNavigationPolicy({
        sourceUrl: capturedSourceUrl,
        targetUrl: url,
        sourceTabId,
        context
      });
      if (!isCurrentEvaluation()) return;
      const { sourceUrl, targetDomain, decision, reviewSurface } = evaluation;
      recordNavigationTrace({
        type: "policy_decided",
        tabId,
        sourceTabId,
        sourceUrl: sourceUrl.href,
        targetUrl: url,
        decision,
        reviewSurface,
        reasons: evaluation.reasons,
        reason: evaluation.attributionReason,
        ...navigationAttributionFacts(context)
      });
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
      shouldFinalize = true;
      if (decision === NEW_TAB_DECISIONS.CLOSE || reviewSurface === NEW_TAB_REVIEW_SURFACES.CLOSE) {
        const enforcementPlan = createNavigationEnforcementPlan({
          sequence: NAVIGATION_SEQUENCES.OPENED_TAB_IS_TARGET,
          originalTabId: sourceTabId,
          openedTabId: tabId
        });
        if (!await canEnforce()) return;
        recordNavigationTrace({
          type: "enforcement_requested",
          tabId: enforcementPlan.closeTabId,
          sourceTabId: enforcementPlan.notifyTabId,
          sourceUrl: sourceUrl.href,
          targetUrl: url,
          decision,
          action: "close_tab",
          reason: decision === NEW_TAB_DECISIONS.CLOSE ? "blacklisted_target" : "review_policy_close",
          ...navigationAttributionFacts(context)
        });
        const outcome = await closeTabQuietly(
          enforcementPlan.closeTabId,
          canEnforce
        );
        if (!outcome) return;
        recordNavigationTrace({
          type: "enforcement_completed",
          tabId,
          action: outcome,
          ...navigationAttributionFacts(context)
        });
        void logBlockedNavigationIfAllowed(url, sourceUrl.hostname, context);
        return showBlockedNavigationToast({
          sourceTabId: enforcementPlan.notifyTabId,
          url,
          source: sourceUrl.hostname,
          target: targetDomain
        });
      }
      if (reviewSurface === NEW_TAB_REVIEW_SURFACES.FULL_PAGE) {
        return redirectToBlockedPage(
          tabId,
          url,
          sourceUrl.hostname,
          canEnforce,
          context
        );
      }
      if (!await canEnforce()) return;
      const toastShown = await showNavigationReviewToast({
        tabId,
        url,
        source: sourceUrl.hostname,
        target: targetDomain,
        context
      });
      if (toastShown || evaluation.mayReplacePage === false) return;
      return redirectToBlockedPage(
        tabId,
        url,
        sourceUrl.hostname,
        canEnforce,
        context
      );
    } catch (err) {
      console.error("Error evaluating navigation:", err);
    } finally {
      if (evaluatingTabs.get(tabId) === context) evaluatingTabs.delete(tabId);
      if (shouldFinalize && isCurrentEvaluation()) {
        pendingTabs.delete(tabId);
        handledTabs.set(tabId, context);
        setTimeout(() => {
          if (handledTabs.get(tabId) === context) handledTabs.delete(tabId);
        }, 15e3);
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
  async function showNavigationReviewToast({
    tabId,
    url,
    source,
    target,
    context
  }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_FEEDBACK)) return false;
    const message = {
      type: "SHOW_GRAY_NAVIGATION",
      tabId,
      url,
      // Keep/Block feedback must not create trusted workflows for a guessed source.
      source: context?.attribution === "confirmed" ? source : "",
      target,
      navigationAttribution: navigationAttributionFacts(context)
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
      const pending2 = pendingReviewToasts.get(tabId);
      if (pending2?.message === message) pendingReviewToasts.delete(tabId);
    }, 10500);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (await deliverPendingNavigationReview(tabId)) {
        pendingReviewToasts.delete(tabId);
        return true;
      }
      if (attempt < 5) await delay(220);
    }
    const pending = pendingReviewToasts.get(tabId);
    if (pending?.message === message) pendingReviewToasts.delete(tabId);
    return false;
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
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function redirectToBlockedPage(tabId, url, source, shouldContinue = () => true, context) {
    if (!await shouldContinue()) return false;
    recordNavigationTrace({
      type: "enforcement_requested",
      tabId,
      sourceUrl: `https://${source}`,
      targetUrl: url,
      decision: NEW_TAB_DECISIONS.VERIFY,
      action: "redirect_to_blocked_page",
      reason: "review_fallback",
      ...navigationAttributionFacts(context)
    });
    await chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL(
        `ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(source)}`
      )
    });
    recordNavigationTrace({
      type: "enforcement_completed",
      tabId,
      action: "redirect_to_blocked_page",
      ...navigationAttributionFacts(context)
    });
    void logBlockedNavigationIfAllowed(url, source, context);
    return true;
  }
  async function logBlockedNavigationIfAllowed(url, source, context) {
    if (!navigationPolicy?.can(CAPABILITIES.TELEMETRY_QUEUE)) return;
    try {
      await logBlockedNavigation(
        url,
        source,
        navigationAttributionFacts(context)
      );
    } catch (error) {
      console.debug("Navigation logging unavailable", error);
    }
  }
  async function closeTabQuietly(tabId, shouldContinue) {
    try {
      await chrome.tabs.remove(tabId);
      return "close_tab";
    } catch {
      if (!await shouldContinue()) return null;
      try {
        await chrome.tabs.update(tabId, { url: "about:blank" });
        return "blank_tab";
      } catch {
        return null;
      }
    }
  }
  function recordNavigationTrace(event2) {
    navigationDiagnostics.record(event2).catch(() => {
    });
  }
  function triggerNavigationDiagnosticCapture(reason) {
    navigationDiagnostics.startCapture({ durationMs: 10 * 60 * 1e3, reason }).catch(() => {
    });
  }
  function isBlankUrl(url) {
    return !url || url === "about:blank" || url.startsWith("about:") || url.startsWith("chrome:");
  }

  // src/media/contracts.js
  var MEDIA_KINDS = Object.freeze({
    DIRECT: "direct",
    HLS: "hls",
    DASH: "dash",
    ADAPTIVE: "adaptive",
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
  var MEDIA_PLAYBACK_STATES = Object.freeze({
    IDLE: "idle",
    PLAYING: "playing",
    PAUSED: "paused",
    WAITING: "waiting",
    SEEKING: "seeking",
    ENDED: "ended"
  });
  var MEDIA_PLAYBACK_TRIGGERS = Object.freeze([
    "initial",
    "loadedmetadata",
    "durationchange",
    "play",
    "pause",
    "ended",
    "waiting",
    "seeking",
    "seeked",
    "ratechange",
    "timeupdate",
    "visibility"
  ]);
  function normalizeMediaCandidate(value = {}) {
    const candidate = {
      id: requiredString(value.id, "id"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      sourceUrl: optionalString(value.sourceUrl),
      manifestUrl: optionalString(value.manifestUrl),
      kind: enumValue(value.kind, Object.values(MEDIA_KINDS), "kind"),
      title: optionalString(value.title),
      mimeType: optionalString(value.mimeType),
      provider: optionalString(value.provider),
      acquisitionProfile: optionalString(value.acquisitionProfile),
      playerUrl: optionalString(value.playerUrl),
      acquisitionDiagnostic: normalizeMediaAcquisitionDiagnostic(
        value.acquisitionDiagnostic
      ),
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
      contentLength: optionalNonNegativeInteger(value.contentLength),
      resolution: normalizeResolution(value.resolution),
      playback: normalizePlaybackState(value.playback),
      bandwidth: optionalPositiveNumber(value.bandwidth),
      averageBandwidth: optionalPositiveNumber(value.averageBandwidth),
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
  function normalizePlaybackState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      playing: value.playing === true,
      visible: value.visible === true,
      muted: value.muted === true,
      currentTime: optionalFiniteNumber(value.currentTime),
      observedAt: optionalNonNegativeInteger(value.observedAt)
    };
  }
  function normalizeMediaPlaybackObservation(value = {}) {
    return {
      sessionId: requiredString(value.sessionId, "sessionId").slice(0, 160),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      mediaId: optionalString(value.mediaId)?.slice(0, 200) || null,
      state: enumValue(
        value.state,
        Object.values(MEDIA_PLAYBACK_STATES),
        "playback.state"
      ),
      trigger: enumValue(
        value.trigger,
        MEDIA_PLAYBACK_TRIGGERS,
        "playback.trigger"
      ),
      currentTime: optionalNonNegativeNumber(value.currentTime),
      duration: optionalPositiveNumber(value.duration),
      playbackRate: optionalPositiveNumber(value.playbackRate) || 1,
      muted: value.muted === true,
      visible: value.visible === true,
      readyState: optionalBoundedInteger(value.readyState, 0, 4),
      observedAt: optionalNonNegativeInteger(value.observedAt) || Date.now()
    };
  }
  function normalizeMediaAcquisitionDiagnostic(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      provider: optionalString(value.provider),
      input: optionalString(value.input),
      stage: optionalString(value.stage),
      descriptorCount: optionalNonNegativeInteger(value.descriptorCount),
      videoDescriptorCount: optionalNonNegativeInteger(
        value.videoDescriptorCount
      ),
      audioDescriptorCount: optionalNonNegativeInteger(
        value.audioDescriptorCount
      ),
      directVideoCount: optionalNonNegativeInteger(value.directVideoCount),
      directAudioCount: optionalNonNegativeInteger(value.directAudioCount),
      signatureCipherCount: optionalNonNegativeInteger(
        value.signatureCipherCount
      ),
      nTransformCount: optionalNonNegativeInteger(value.nTransformCount),
      serverAbrAvailable: value.serverAbrAvailable === true,
      hlsManifestAvailable: value.hlsManifestAvailable === true,
      dashManifestAvailable: value.dashManifestAvailable === true,
      playabilityStatus: optionalString(value.playabilityStatus),
      playerUrlAvailable: value.playerUrlAvailable === true
    };
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
      bandwidth: optionalPositiveNumber(value.bandwidth),
      averageBandwidth: optionalPositiveNumber(value.averageBandwidth),
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
      appendFormats: normalizeStrings(value.appendFormats).filter(
        (format) => ["iso-bmff", "mpeg-ts", "webm", "aac-adts"].includes(format)
      ).slice(0, 4),
      appendCount: optionalNonNegativeInteger(value.appendCount) || 0,
      unclassifiedAppendCount: optionalNonNegativeInteger(value.unclassifiedAppendCount) || 0,
      totalAppendedBytes: optionalNonNegativeInteger(value.totalAppendedBytes) || 0,
      observerStartedAt: optionalFiniteNumber(value.observerStartedAt) || null,
      observerDocumentState: optionalEnumValue(
        value.observerDocumentState,
        ["loading", "interactive", "complete", "unknown"],
        "observerDocumentState"
      ) || "unknown",
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
    const strategy3 = optionalEnumValue(
      value.strategy,
      ["remove_query_parameter"],
      "resolutionAttempt.strategy"
    );
    if (!strategy3) return null;
    return {
      adapterId: optionalString(value.adapterId)?.slice(0, 100) || null,
      strategy: strategy3,
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
  function normalizeResolution(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const width = optionalNonNegativeInteger(value.width);
    const height = optionalNonNegativeInteger(value.height);
    return width || height ? { width, height } : null;
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
  function optionalPositiveNumber(value) {
    if (value === null || value === void 0) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      throw new Error("[MediaContract] Expected a positive number.");
    }
    return number;
  }
  function optionalNonNegativeNumber(value) {
    if (value === null || value === void 0) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error("[MediaContract] Expected a non-negative number.");
    }
    return number;
  }
  function optionalBoundedInteger(value, minimum, maximum) {
    if (value === null || value === void 0) return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw new Error(
        `[MediaContract] Expected an integer from ${minimum} to ${maximum}.`
      );
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
    MEDIA_PLAYBACK_OBSERVED: "media.playback_observed",
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
    [E.MEDIA_PLAYBACK_OBSERVED]: event(
      E.MEDIA_PLAYBACK_OBSERVED,
      "media.playback-observer",
      ["media.catalog", "video-ad.evidence-collector"],
      normalizeMediaPlaybackObservation
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
    contentLength = null,
    resolution = null,
    playback = null,
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
      contentLength: kind === MEDIA_KINDS.DIRECT ? contentLength : null,
      resolution,
      playback,
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
    const visit = (item, quality = null, strategy3 = itemStrategy(item)) => {
      const visitKey = `${item.id}:${quality?.height || 0}:${quality?.bandwidth || 0}`;
      if (visited.has(visitKey)) return;
      visited.add(visitKey);
      if (item.playlistType === "media") {
        streams.push({
          item,
          quality,
          readiness: mediaReadiness(item),
          ...strategy3
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
      bandwidth: quality?.bandwidth || item.averageBandwidth || item.bandwidth || null,
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

  // src/media/adaptive-track-policy.js
  var ADAPTIVE_TRACK_RESOLUTION = Object.freeze({
    RESOLVED: "resolved",
    N_TRANSFORM_PENDING: "n_transform_pending",
    SIGNATURE_CIPHER_PENDING: "signature_cipher_pending",
    PROVIDER_CLIENT_PENDING: "provider_client_pending"
  });
  function hasHttpAdaptiveTrackUrl(track) {
    try {
      return ["http:", "https:"].includes(
        new URL(track?.sourceUrl || track?.url).protocol
      );
    } catch {
      return false;
    }
  }
  function isYouTubeProviderResolvableTrack(candidate, track) {
    return candidate?.provider === "youtube" && track?.urlResolution === ADAPTIVE_TRACK_RESOLUTION.PROVIDER_CLIENT_PENDING && /^\d{1,6}$/.test(String(track?.itag || ""));
  }
  function isAcquirableAdaptiveTrack(candidate, track) {
    if (isYouTubeProviderResolvableTrack(candidate, track)) return true;
    if (!hasHttpAdaptiveTrackUrl(track)) return false;
    if ([
      ADAPTIVE_TRACK_RESOLUTION.N_TRANSFORM_PENDING,
      ADAPTIVE_TRACK_RESOLUTION.SIGNATURE_CIPHER_PENDING
    ].includes(track?.urlResolution))
      return Boolean(candidate?.playerUrl);
    return true;
  }
  function hasYouTubeProviderPendingTracks(candidate) {
    return [
      ...candidate?.variants || [],
      ...candidate?.audioTracks || []
    ].some((track) => isYouTubeProviderResolvableTrack(candidate, track));
  }

  // src/media/session-timeline.js
  var DEFAULT_MAXIMUM_SESSIONS = 16;
  var DEFAULT_MAXIMUM_OBSERVATIONS = 64;
  function createMediaSessionTimeline({
    maximumSessions = DEFAULT_MAXIMUM_SESSIONS,
    maximumObservations = DEFAULT_MAXIMUM_OBSERVATIONS
  } = {}) {
    const sessions = /* @__PURE__ */ new Map();
    return Object.freeze({
      add(observation, { frameId = null, frameUrl = null } = {}) {
        const existing = sessions.get(observation.sessionId);
        const session = existing || {
          id: observation.sessionId,
          lineageId: lineageId(frameId, observation.sessionId),
          pageUrl: observation.pageUrl,
          frameId: normalizedFrameId(frameId),
          frameUrl: normalizedHttpUrl(frameUrl),
          mediaIds: [],
          firstSeenAt: observation.observedAt,
          lastSeenAt: observation.observedAt,
          current: null,
          timeline: []
        };
        if (observation.mediaId && !session.mediaIds.includes(observation.mediaId))
          session.mediaIds = [...session.mediaIds, observation.mediaId].slice(
            -16
          );
        session.frameId = session.frameId ?? normalizedFrameId(frameId);
        session.frameUrl = session.frameUrl || normalizedHttpUrl(frameUrl);
        session.lastSeenAt = Math.max(session.lastSeenAt, observation.observedAt);
        const point = timelinePoint(observation);
        const previous = session.timeline.at(-1);
        if (canCoalesce(previous, point))
          session.timeline[session.timeline.length - 1] = point;
        else session.timeline.push(point);
        session.timeline = session.timeline.slice(-maximumObservations);
        session.current = point;
        sessions.set(session.id, session);
        trimSessions(sessions, maximumSessions);
        return cloneSession(session);
      },
      list() {
        return [...sessions.values()].sort((left, right) => right.lastSeenAt - left.lastSeenAt).map(cloneSession);
      },
      forMedia(mediaId) {
        return [...sessions.values()].filter((session) => session.mediaIds.includes(mediaId)).sort((left, right) => right.lastSeenAt - left.lastSeenAt).map(cloneSession);
      },
      clear() {
        sessions.clear();
      }
    });
  }
  function timelinePoint(observation) {
    return {
      mediaId: observation.mediaId,
      state: observation.state,
      trigger: observation.trigger,
      currentTime: observation.currentTime,
      duration: observation.duration,
      playbackRate: observation.playbackRate,
      muted: observation.muted,
      visible: observation.visible,
      readyState: observation.readyState,
      observedAt: observation.observedAt
    };
  }
  function canCoalesce(previous, next) {
    return previous?.trigger === "timeupdate" && next.trigger === "timeupdate" && previous.mediaId === next.mediaId && previous.state === next.state && previous.visible === next.visible && previous.muted === next.muted && previous.playbackRate === next.playbackRate;
  }
  function cloneSession(session) {
    return {
      ...session,
      mediaIds: [...session.mediaIds],
      current: session.current ? { ...session.current } : null,
      timeline: session.timeline.map((point) => ({ ...point }))
    };
  }
  function trimSessions(sessions, maximum) {
    while (sessions.size > maximum) {
      const oldest = [...sessions.values()].sort(
        (left, right) => left.lastSeenAt - right.lastSeenAt
      )[0];
      if (!oldest) return;
      sessions.delete(oldest.id);
    }
  }
  function lineageId(frameId, sessionId) {
    return `frame-${normalizedFrameId(frameId) ?? "unknown"}:${sessionId}`;
  }
  function normalizedFrameId(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  function normalizedHttpUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
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
          tabCatalog = createTabCatalog(candidate.pageUrl);
          tabs.set(tabId, tabCatalog);
        }
        const now = event2.timestamp;
        const existing = tabCatalog.items.get(candidate.id);
        const preserveExistingProbe = existing && existing.probeStatus !== MEDIA_PROBE_STATES.DISCOVERED && candidate.probeStatus === MEDIA_PROBE_STATES.DISCOVERED;
        const adaptiveTracks = candidate.kind === MEDIA_KINDS.ADAPTIVE ? mergeAdaptiveTracks(existing, candidate) : null;
        const item = {
          ...existing || {},
          ...candidate,
          ...preserveExistingProbe ? probeFields(existing) : {},
          ...adaptiveTracks || {},
          acquisitionDiagnostic: candidate.acquisitionDiagnostic || existing?.acquisitionDiagnostic || null,
          duration: candidate.duration ?? existing?.duration ?? null,
          contentLength: candidate.contentLength ?? existing?.contentLength ?? null,
          resolution: candidate.resolution ?? existing?.resolution ?? null,
          playback: candidate.playback || existing?.playback || null,
          requestContexts: mergeRequestContexts(
            existing?.requestContexts,
            candidate.requestContexts,
            now
          ),
          probeCount: existing?.probeCount || 0,
          lastProbeAt: existing?.lastProbeAt || null,
          lastUsableProbeAt: existing?.lastUsableProbeAt || null,
          frameId: normalizedFrameId2(event2.metadata?.frameId, existing?.frameId),
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
        attachKnownSessions(item, tabCatalog.sessions);
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
          tabCatalog = createTabCatalog(probe.pageUrl);
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
          frameId: normalizedFrameId2(event2.metadata?.frameId, existing?.frameId),
          frameUrl: normalizedFrameUrl(event2.metadata?.frameUrl) || existing?.frameUrl || null,
          playerAdapters: [...existing?.playerAdapters || []],
          detectionSources: uniqueStrings([
            ...existing?.detectionSources || [],
            MEDIA_DETECTION_SOURCES.NETWORK
          ]),
          firstSeenAt: existing?.firstSeenAt || event2.timestamp,
          lastSeenAt: event2.timestamp
        };
        attachKnownSessions(item, tabCatalog.sessions);
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
        const diagnostic2 = event2.payload;
        let tabCatalog = tabs.get(tabId);
        if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, diagnostic2.pageUrl)) {
          tabs.delete(tabId);
          tabCatalog = null;
        }
        if (!tabCatalog) {
          tabCatalog = createTabCatalog(diagnostic2.pageUrl);
          tabs.set(tabId, tabCatalog);
        }
        const existing = tabCatalog.items.get(diagnostic2.mediaId);
        const base = existing || normalizeMediaCandidate({
          id: diagnostic2.mediaId,
          pageUrl: diagnostic2.pageUrl,
          manifestUrl: diagnostic2.manifestUrl,
          kind: diagnostic2.kind,
          detectedBy: MEDIA_DETECTION_SOURCES.NETWORK
        });
        const probeDiagnostics = mergeProbeDiagnostics(
          existing?.probeDiagnostics,
          diagnostic2
        );
        const item = {
          ...base,
          probeDiagnostic: probeDiagnostics[0] || null,
          probeDiagnostics,
          frameId: normalizedFrameId2(event2.metadata?.frameId, existing?.frameId),
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
        attachKnownSessions(item, tabCatalog.sessions);
        applyEmeToItem(item, tabCatalog.eme);
        tabCatalog.items.set(diagnostic2.mediaId, item);
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
          tabCatalog = createTabCatalog(trace.pageUrl);
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
          frameId: normalizedFrameId2(event2.metadata?.frameId, existing?.frameId),
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
        attachKnownSessions(item, tabCatalog.sessions);
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
      applyPlayback(tabId, rawEvent) {
        assertTabId(tabId);
        const event2 = normalizeRegisteredEvent(rawEvent);
        if (event2.type !== EVENTS.MEDIA_PLAYBACK_OBSERVED) {
          throw new Error(
            `[MediaCatalog] Cannot apply playback event "${event2.type}".`
          );
        }
        const observation = event2.payload;
        let tabCatalog = tabs.get(tabId);
        if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, observation.pageUrl)) {
          tabs.delete(tabId);
          tabCatalog = null;
        }
        if (!tabCatalog) {
          tabCatalog = createTabCatalog(observation.pageUrl);
          tabs.set(tabId, tabCatalog);
        }
        const session = tabCatalog.sessions.add(observation, {
          frameId: event2.metadata?.frameId,
          frameUrl: event2.metadata?.frameUrl
        });
        for (const mediaId of session.mediaIds) {
          const item = tabCatalog.items.get(mediaId);
          if (!item) continue;
          item.playerSessionIds = uniqueStrings([
            ...item.playerSessionIds || [],
            session.id
          ]).slice(-16);
          item.playback = playbackFromSessionPoint(session.current);
          item.lastSeenAt = Math.max(item.lastSeenAt || 0, event2.timestamp);
        }
        return session;
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
          tabCatalog = createTabCatalog(observation.pageUrl);
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
        return listTabItems(tabCatalog);
      },
      listSessions(tabId, pageUrl = null) {
        assertTabId(tabId);
        const tabCatalog = tabs.get(tabId);
        if (!tabCatalog || pageUrl && !samePageUrl(tabCatalog.pageUrl, pageUrl))
          return [];
        return tabCatalog.sessions.list();
      },
      snapshot(tabId) {
        assertTabId(tabId);
        const tabCatalog = tabs.get(tabId);
        if (!tabCatalog) return null;
        return {
          version: 2,
          pageUrl: tabCatalog.pageUrl,
          items: listTabItems(tabCatalog),
          sessions: tabCatalog.sessions.list()
        };
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
  function createTabCatalog(pageUrl) {
    return {
      pageUrl,
      items: /* @__PURE__ */ new Map(),
      sessions: createMediaSessionTimeline(),
      eme: null
    };
  }
  function listTabItems(tabCatalog) {
    const items = [...tabCatalog.items.values()].sort(
      (left, right) => right.lastSeenAt - left.lastSeenAt
    );
    const resolutions = resolveHlsSources(items);
    const blobResolutions = resolveBlobSources(items, resolutions);
    return items.map(
      (item) => cloneItem(item, blobResolutions.get(item.id) || resolutions.get(item.id))
    );
  }
  function attachKnownSessions(item, sessions) {
    const related = sessions.forMedia(item.id);
    item.playerSessionIds = uniqueStrings([
      ...item.playerSessionIds || [],
      ...related.map((session) => session.id)
    ]).slice(-16);
    if (!item.playback && related[0]?.current)
      item.playback = playbackFromSessionPoint(related[0].current);
  }
  function playbackFromSessionPoint(point) {
    if (!point) return null;
    return {
      state: point.state,
      playing: point.state === "playing",
      visible: point.visible === true,
      muted: point.muted === true,
      currentTime: point.currentTime,
      playbackRate: point.playbackRate,
      observedAt: point.observedAt
    };
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
      bandwidth: item.bandwidth,
      averageBandwidth: item.averageBandwidth,
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
      bandwidth: probe.bandwidth,
      averageBandwidth: probe.averageBandwidth,
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
    for (const diagnostic2 of [incoming, ...existing || []]) {
      if (!diagnostic2) continue;
      const key = [
        diagnostic2.phase,
        diagnostic2.code,
        diagnostic2.httpStatus,
        diagnostic2.bodyBytes,
        diagnostic2.playlistType,
        diagnostic2.segmentCount
      ].join("\n");
      if (!unique.has(key)) unique.set(key, { ...diagnostic2 });
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
      appendFormats: uniqueStrings([
        ...existing?.appendFormats || [],
        ...incoming.appendFormats || []
      ]).slice(-4),
      appendCount: Math.max(
        existing?.appendCount || 0,
        incoming.appendCount || 0
      ),
      totalAppendedBytes: Math.max(
        existing?.totalAppendedBytes || 0,
        incoming.totalAppendedBytes || 0
      ),
      unclassifiedAppendCount: Math.max(
        existing?.unclassifiedAppendCount || 0,
        incoming.unclassifiedAppendCount || 0
      ),
      observerStartedAt: existing?.observerStartedAt || incoming.observerStartedAt || null,
      observerDocumentState: existing?.observerDocumentState && existing.observerDocumentState !== "unknown" ? existing.observerDocumentState : incoming.observerDocumentState || "unknown",
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
  function mergeAdaptiveTracks(existing, candidate) {
    const variants = mergeTrackList(existing?.variants, candidate.variants);
    const audioTracks = mergeTrackList(
      existing?.audioTracks,
      candidate.audioTracks
    );
    const bestVideo = [...variants].sort(compareAdaptiveTrackQuality)[0] || null;
    const bestAudio = [...audioTracks].sort(compareAdaptiveTrackQuality)[0] || null;
    const playerUrl = candidate.playerUrl || existing?.playerUrl || null;
    const acquisitionCandidate = { ...candidate, playerUrl };
    const muxedReady = variants.some(
      (track) => track.muxed === true && isAcquirableAdaptiveTrack(acquisitionCandidate, track)
    );
    return {
      variants,
      audioTracks,
      sourceUrl: bestVideo?.sourceUrl || existing?.sourceUrl || candidate.sourceUrl || bestAudio?.sourceUrl || null,
      mimeType: bestVideo?.mimeType || candidate.mimeType || existing?.mimeType,
      resolution: bestVideo?.resolution || candidate.resolution || existing?.resolution,
      bandwidth: bestVideo?.bandwidth || candidate.bandwidth || existing?.bandwidth,
      averageBandwidth: bestVideo?.averageBandwidth || candidate.averageBandwidth || existing?.averageBandwidth,
      playerUrl,
      probeStatus: muxedReady || variants.some(
        (track) => isAcquirableAdaptiveTrack(acquisitionCandidate, track)
      ) && audioTracks.some(
        (track) => isAcquirableAdaptiveTrack(acquisitionCandidate, track)
      ) ? MEDIA_PROBE_STATES.READY : MEDIA_PROBE_STATES.DISCOVERED,
      streamType: "vod"
    };
  }
  function mergeTrackList(existing = [], incoming = []) {
    const tracks = /* @__PURE__ */ new Map();
    for (const track of [...existing || [], ...incoming || []]) {
      if (!track || typeof track !== "object") continue;
      const key = track.id || `${track.type || "track"}:${track.itag || track.sourceUrl}`;
      const previous = tracks.get(key) || {};
      tracks.set(key, {
        ...previous,
        ...track,
        sourceUrl: track.sourceUrl || previous.sourceUrl || null,
        signatureCipher: track.signatureCipher || previous.signatureCipher || null,
        muxed: track.muxed === true || previous.muxed === true
      });
    }
    return [...tracks.values()];
  }
  function compareAdaptiveTrackQuality(left, right) {
    return (right.resolution?.height || right.height || 0) - (left.resolution?.height || left.height || 0) || (right.averageBandwidth || right.bandwidth || 0) - (left.averageBandwidth || left.bandwidth || 0) || (right.contentLength || 0) - (left.contentLength || 0);
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
      playerSessionIds: [...item.playerSessionIds || []],
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
      probeDiagnostics: (item.probeDiagnostics || []).map((diagnostic2) => ({
        ...diagnostic2
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
        mimeTypes: [...item.blobTrace.mimeTypes || []],
        appendFormats: [...item.blobTrace.appendFormats || []]
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
  function normalizedFrameId2(value, fallback = null) {
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
  var PLAYBACK_CHECKPOINT_INTERVAL_MS = 1e4;
  var playbackCheckpointTimers = /* @__PURE__ */ new Map();
  var preferredMedia = /* @__PURE__ */ new Map();
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
      for (const timer of playbackCheckpointTimers.values()) clearTimeout(timer);
      playbackCheckpointTimers.clear();
      catalog.clearAll();
      preferredMedia.clear();
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
  async function recordMediaPlaybackObservation(tabId, event2) {
    if (!active) return { status: "catalog_disabled" };
    const session = catalog.applyPlayback(tabId, event2);
    if (event2?.payload?.trigger === "timeupdate")
      schedulePlaybackCheckpoint(tabId);
    else await flushPlaybackCheckpoint(tabId).catch(() => {
    });
    return { status: "recorded", session };
  }
  async function listDiscoveredMedia(tabId, pageUrl = null) {
    if (!active) return { status: "catalog_disabled", items: [] };
    return {
      status: "ok",
      items: catalog.list(tabId, pageUrl),
      preferredMediaId: preferredMedia.get(tabId) || null
    };
  }
  async function preferDiscoveredMedia(tabId, mediaId) {
    if (!active) return { status: "catalog_disabled" };
    preferredMedia.set(tabId, mediaId);
    await persistTab(tabId).catch(() => {
    });
    return { status: "selected" };
  }
  async function listMediaPlaybackSessions(tabId, pageUrl = null) {
    if (!active) return { status: "catalog_disabled", sessions: [] };
    return { status: "ok", sessions: catalog.listSessions(tabId, pageUrl) };
  }
  async function hydrateCatalog() {
    const storage = chrome.storage.session;
    if (!storage) return;
    const snapshot = await storage.get(null);
    for (const [key, stored] of Object.entries(snapshot)) {
      if (!key.startsWith(MEDIA_CATALOG_SESSION_PREFIX)) continue;
      const { items, sessions } = normalizeStoredMediaCatalogSnapshot(stored);
      if (!items.length && !sessions.length) continue;
      const tabId = Number(key.slice(MEDIA_CATALOG_SESSION_PREFIX.length));
      if (!Number.isInteger(tabId)) continue;
      if (typeof stored?.preferredMediaId === "string")
        preferredMedia.set(tabId, stored.preferredMediaId);
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
        for (const diagnostic2 of item.probeDiagnostics || []) {
          try {
            catalog.applyProbeDiagnostic(tabId, {
              ...createRegisteredEvent(EVENTS.MEDIA_PROBE_DIAGNOSTIC, diagnostic2),
              timestamp: diagnostic2.observedAt || item.lastSeenAt || Date.now(),
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
      for (const session of sessions) {
        for (const point of session.timeline || []) {
          try {
            catalog.applyPlayback(tabId, {
              ...createRegisteredEvent(EVENTS.MEDIA_PLAYBACK_OBSERVED, {
                ...point,
                sessionId: session.id,
                pageUrl: session.pageUrl || stored.pageUrl
              }),
              timestamp: point.observedAt || session.lastSeenAt || Date.now(),
              metadata: {
                frameId: session.frameId ?? null,
                frameUrl: session.frameUrl || null
              }
            });
          } catch {
          }
        }
      }
      const cleanedItems = catalog.list(tabId);
      if (cleanedItems.length || catalog.listSessions(tabId).length)
        await storage.set({ [key]: catalog.snapshot(tabId) });
      else await storage.remove(key);
    }
  }
  function normalizeStoredMediaCatalogSnapshot(stored) {
    return {
      items: Array.isArray(stored) ? stored : Array.isArray(stored?.items) ? stored.items : [],
      sessions: Array.isArray(stored?.sessions) ? stored.sessions : []
    };
  }
  async function persistTab(tabId) {
    const storage = chrome.storage.session;
    if (!storage) return;
    const snapshot = catalog.snapshot(tabId);
    if (snapshot)
      await storage.set({
        [mediaCatalogSessionKey(tabId)]: {
          ...snapshot,
          preferredMediaId: preferredMedia.get(tabId) || null
        }
      });
  }
  function schedulePlaybackCheckpoint(tabId) {
    if (playbackCheckpointTimers.has(tabId)) return;
    const timer = setTimeout(() => {
      playbackCheckpointTimers.delete(tabId);
      if (active) persistTab(tabId).catch(() => {
      });
    }, PLAYBACK_CHECKPOINT_INTERVAL_MS);
    playbackCheckpointTimers.set(tabId, timer);
  }
  async function flushPlaybackCheckpoint(tabId) {
    const timer = playbackCheckpointTimers.get(tabId);
    if (timer) clearTimeout(timer);
    playbackCheckpointTimers.delete(tabId);
    await persistTab(tabId);
  }
  async function clearTab(tabId) {
    const timer = playbackCheckpointTimers.get(tabId);
    if (timer) clearTimeout(timer);
    playbackCheckpointTimers.delete(tabId);
    catalog.clear(tabId);
    preferredMedia.delete(tabId);
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
    BROWSER_FILE_CHECK: "downloads.file.check",
    BROWSER_FILE_AUTO_CHECK: "downloads.file.auto_check",
    BROWSER_FILE_ACCEPT: "downloads.file.accept",
    BROWSER_FILE_RETURN: "downloads.file.return",
    BROWSER_FILE_OPEN: "downloads.file.open",
    BROWSER_FILE_REVEAL: "downloads.file.reveal",
    MEDIA_DOWNLOAD_CANCEL: "media.download.cancel",
    MEDIA_DOWNLOAD_CREATE: "media.download.create",
    MEDIA_DOWNLOAD_PREFLIGHT: "media.download.preflight",
    MEDIA_DOWNLOAD_LOOKUP: "media.download.lookup",
    MEDIA_OUTPUT_CANARY: "media.output.canary",
    MEDIA_OUTPUT_CAPTURE_START: "media.output.capture.start",
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
    [A.BROWSER_FILE_AUTO_CHECK]: action(
      A.BROWSER_FILE_AUTO_CHECK,
      "background.browser-file-handoff",
      C3.BROWSER_FILE_AUTO_CHECK
    ),
    [A.BROWSER_FILE_CHECK]: action(
      A.BROWSER_FILE_CHECK,
      "background.browser-file-handoff",
      C3.BROWSER_FILE_TRANSFER
    ),
    [A.BROWSER_FILE_ACCEPT]: action(
      A.BROWSER_FILE_ACCEPT,
      "background.browser-file-handoff",
      C3.BROWSER_FILE_TRANSFER
    ),
    [A.BROWSER_FILE_RETURN]: action(
      A.BROWSER_FILE_RETURN,
      "background.browser-file-handoff",
      C3.BROWSER_DOWNLOAD_OBSERVE
    ),
    [A.BROWSER_FILE_OPEN]: action(
      A.BROWSER_FILE_OPEN,
      "background.browser-file-handoff",
      C3.BROWSER_FILE_TRANSFER
    ),
    [A.BROWSER_FILE_REVEAL]: action(
      A.BROWSER_FILE_REVEAL,
      "background.browser-file-handoff",
      C3.BROWSER_FILE_TRANSFER
    ),
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
    [A.MEDIA_DOWNLOAD_PREFLIGHT]: action(
      A.MEDIA_DOWNLOAD_PREFLIGHT,
      "background.media-download-jobs",
      C3.MEDIA_NATIVE_DOWNLOAD
    ),
    [A.MEDIA_DOWNLOAD_LOOKUP]: action(
      A.MEDIA_DOWNLOAD_LOOKUP,
      "background.media-download-jobs",
      C3.MEDIA_DOWNLOAD
    ),
    [A.MEDIA_OUTPUT_CANARY]: action(
      A.MEDIA_OUTPUT_CANARY,
      "background.media-download-jobs",
      C3.MEDIA_NATIVE_DOWNLOAD
    ),
    [A.MEDIA_OUTPUT_CAPTURE_START]: action(
      A.MEDIA_OUTPUT_CAPTURE_START,
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

  // src/media/audio-language-label.js
  var ROLE_LABELS = Object.freeze({
    original: "Original",
    dubbed: "Dubbed",
    auto_dubbed: "Auto-dubbed",
    descriptive: "Audio Description",
    secondary: "Secondary"
  });
  var LOCALIZED_LANGUAGE_NAMES = Object.freeze({
    "ti\u1EBFng vi\u1EC7t": "Vietnamese",
    "ti\u1EBFng anh": "English",
    "ti\u1EBFng trung": "Chinese",
    "ti\u1EBFng trung qu\u1ED1c": "Chinese",
    "ti\u1EBFng nh\u1EADt": "Japanese",
    "ti\u1EBFng h\xE0n": "Korean"
  });
  function formatAudioLanguageLabel({
    language = null,
    name = null,
    role = null,
    isDefault = false
  } = {}) {
    const locale = normalizedLocale(language);
    const baseName = englishLanguageName(locale?.language) || normalizedSourceName(name);
    const region = normalizedRegion(
      locale?.region || regionFromName(name),
      locale?.language
    );
    const effectiveRole = role || roleFromName(name);
    const qualifiers = [region, ROLE_LABELS[effectiveRole]].filter(Boolean);
    const identity = baseName || (isDefault ? "Default Audio" : "Audio");
    return qualifiers.length ? `${identity} (${qualifiers.join(", ")})` : identity;
  }
  function normalizedLocale(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      return new Intl.Locale(value.replace(/_/g, "-"));
    } catch {
      return null;
    }
  }
  function englishLanguageName(value) {
    if (!value) return null;
    try {
      return new Intl.DisplayNames(["en"], { type: "language" }).of(value);
    } catch {
      return null;
    }
  }
  function normalizedSourceName(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const withoutQualifiers = value.replace(/\s*\([^)]*\)\s*$/u, "").trim();
    return LOCALIZED_LANGUAGE_NAMES[withoutQualifiers.toLowerCase()] || withoutQualifiers;
  }
  function regionFromName(value) {
    if (typeof value !== "string") return null;
    return value.match(/\((US|UK|GB|United States|United Kingdom)\b/i)?.[1] || null;
  }
  function normalizedRegion(value, language) {
    if (!value) return null;
    const region = String(value).toUpperCase();
    if (language === "vi" && region === "VN" || language === "zh" && region === "CN" || language === "ja" && region === "JP" || language === "ko" && region === "KR")
      return null;
    if (region === "UNITED STATES") return "US";
    if (region === "UNITED KINGDOM") return "UK";
    return region === "GB" ? "UK" : region;
  }
  function roleFromName(value) {
    if (typeof value !== "string") return null;
    const qualifier = value.match(/\(([^)]*)\)\s*$/u)?.[1]?.toLowerCase() || "";
    if (/\boriginal\b/.test(qualifier)) return "original";
    if (/\bauto[- ]?dubbed\b/.test(qualifier)) return "auto_dubbed";
    if (/\bdubbed\b/.test(qualifier)) return "dubbed";
    return null;
  }

  // src/media/download-options.js
  var MEDIA_OUTPUT_CONTAINERS = Object.freeze({
    SOURCE: "source",
    MP4: "mp4",
    MKV: "mkv",
    OGG: "ogg"
  });
  function getMediaDownloadProfiles(candidate = {}, { canSelectContainer = true } = {}) {
    if (candidate.kind === "direct") {
      const container = classifyDirectMediaContainer(candidate);
      return [
        Object.freeze({
          id: "source",
          container: MEDIA_OUTPUT_CONTAINERS.SOURCE,
          extension: container ? `.${container}` : null,
          label: `Original${container ? ` \xB7 ${container.toUpperCase()}` : ""}`,
          description: "Download the original file without conversion."
        })
      ];
    }
    if (!["hls", "dash", "adaptive"].includes(candidate.kind)) return [];
    const profiles = [];
    if (candidate.kind !== "adaptive" || (candidate.variants || []).length) {
      profiles.push(
        Object.freeze({
          id: "video-mp4",
          container: MEDIA_OUTPUT_CONTAINERS.MP4,
          extension: ".mp4",
          label: "MP4 \xB7 compatible",
          description: "Best compatibility for browsers, phones, and TVs."
        })
      );
    }
    if (candidate.provider === "youtube" && (candidate.audioTracks || []).length) {
      profiles.push(
        Object.freeze({
          id: "audio-ogg",
          container: MEDIA_OUTPUT_CONTAINERS.OGG,
          extension: ".ogg",
          label: "Audio \xB7 OGG",
          description: "Download the best available YouTube audio as an OGG file."
        })
      );
    }
    if (canSelectContainer && (candidate.kind !== "adaptive" || (candidate.variants || []).length)) {
      profiles.push(
        Object.freeze({
          id: "video-mkv",
          container: MEDIA_OUTPUT_CONTAINERS.MKV,
          extension: ".mkv",
          label: "MKV \xB7 flexible",
          description: "Keeps more source codecs without re-encoding."
        })
      );
    }
    return profiles;
  }
  function normalizeMediaDownloadOutput(value, candidate = {}) {
    const profiles = getMediaDownloadProfiles(candidate);
    if (!profiles.length)
      throw new Error("[MediaDownload] No output format is available.");
    const requested = typeof value?.profileId === "string" ? value.profileId : profiles[0].id;
    const profile = profiles.find((item) => item.id === requested);
    if (!profile) {
      throw new Error(
        `[MediaDownload] Output profile "${requested}" is not supported for ${candidate.kind || "this media"}.`
      );
    }
    const normalized = {
      profileId: profile.id,
      container: profile.container,
      extension: profile.extension,
      videoTrackId: normalizeVideoTrackId(value?.videoTrackId, candidate)
    };
    if (candidate.kind === "adaptive") {
      normalized.allowEquivalentVideo = value?.allowEquivalentVideo === true;
      if ((candidate.audioTracks || []).length) {
        normalized.audioTrackId = normalizeAudioTrackId(
          value?.audioTrackId,
          candidate
        );
      }
    }
    return normalized;
  }
  function getMediaAudioTrackOptions(candidate = {}) {
    if (candidate.kind !== "adaptive") return [];
    return uniqueObjects(candidate.audioTracks || []).filter((track) => isAcquirableAdaptiveTrack(candidate, track)).sort(compareAudioPreference).map(
      (track) => Object.freeze({
        id: track.id,
        label: audioTrackLabel(track),
        language: track.language || null,
        role: track.audioRole || null,
        isOriginal: track.audioRole === "original",
        isDefault: track.audioIsDefault === true,
        estimatedBytes: positiveInteger(track.contentLength)
      })
    );
  }
  function getMediaVideoQualityOptions(candidate = {}) {
    if (candidate.kind !== "adaptive") return [];
    const hasSeparateAudio = (candidate.audioTracks || []).some(
      (track) => isAcquirableAdaptiveTrack(candidate, track)
    );
    return uniqueObjects(candidate.variants || []).filter(
      (track) => isAcquirableAdaptiveTrack(candidate, track) && (track.muxed === true || hasSeparateAudio)
    ).sort(compareVideoQuality).map(
      (track) => Object.freeze({
        id: track.id,
        label: videoQualityLabel(track),
        groupLabel: videoQualityGroupLabel(track),
        optionLabel: videoQualityOptionLabel(track),
        height: positiveInteger(track.resolution?.height || track.height),
        muxed: track.muxed === true,
        estimatedBytes: positiveInteger(track.contentLength)
      })
    );
  }
  function normalizeVideoTrackId(value, candidate) {
    if (candidate.kind !== "adaptive") return null;
    if (value === null || value === void 0 || value === "") return null;
    if (typeof value !== "string")
      throw new Error("[MediaDownload] Invalid video quality selection.");
    const track = (candidate.variants || []).find(
      (item) => item?.id === value && isAcquirableAdaptiveTrack(candidate, item)
    );
    if (!track || track.muxed !== true && !(candidate.audioTracks || []).length)
      throw new Error(
        "[MediaDownload] Selected video quality is no longer downloadable."
      );
    return value;
  }
  function normalizeAudioTrackId(value, candidate) {
    if (value === null || value === void 0 || value === "") return null;
    if (typeof value !== "string")
      throw new Error("[MediaDownload] Invalid audio track selection.");
    const track = (candidate.audioTracks || []).find(
      (item) => item?.id === value && isAcquirableAdaptiveTrack(candidate, item)
    );
    if (!track)
      throw new Error(
        "[MediaDownload] Selected audio track is no longer downloadable."
      );
    return value;
  }
  function compareVideoQuality(left, right) {
    return (right.resolution?.height || right.height || 0) - (left.resolution?.height || left.height || 0) || qualityFps(right) - qualityFps(left) || videoCompatibilityScore(right) - videoCompatibilityScore(left) || (right.averageBandwidth || right.bandwidth || 0) - (left.averageBandwidth || left.bandwidth || 0);
  }
  function videoQualityLabel(track) {
    return [videoQualityGroupLabel(track), videoQualityOptionLabel(track)].filter(Boolean).join(" \xB7 ");
  }
  function videoQualityGroupLabel(track) {
    const quality = track.qualityLabel || (track.resolution?.height || track.height ? `${track.resolution?.height || track.height}p` : "Source quality");
    return quality;
  }
  function videoQualityOptionLabel(track) {
    const format = String(track.mimeType || "").includes("webm") ? "WebM" : String(track.mimeType || "").includes("mp4") ? "MP4" : null;
    const codec = codecLabel(track.codecs);
    return [format, codec, track.muxed === true ? "audio included" : null].filter(Boolean).join(" \xB7 ");
  }
  function qualityFps(track) {
    const explicit = positiveInteger(track.fps);
    if (explicit) return explicit;
    return positiveInteger(String(track.qualityLabel || "").match(/p(\d+)$/i)?.[1]) || 0;
  }
  function videoCompatibilityScore(track) {
    const mime = String(track.mimeType || "").toLowerCase();
    const codec = String(track.codecs || "").toLowerCase();
    if (mime.includes("mp4") && (codec.includes("avc1") || codec.includes("avc3")))
      return 40;
    if (mime.includes("mp4") && codec.includes("av01")) return 30;
    if (mime.includes("webm") && (codec.includes("vp9") || codec.includes("vp09")))
      return 20;
    if (mime.includes("mp4")) return 10;
    return 0;
  }
  function codecLabel(value) {
    const codec = String(value || "").toLowerCase();
    if (codec.includes("avc1") || codec.includes("avc3")) return "H.264";
    if (codec.includes("av01")) return "AV1";
    if (codec.includes("vp9") || codec.includes("vp09")) return "VP9";
    if (codec.includes("hev1") || codec.includes("hvc1")) return "HEVC";
    if (codec.includes("mp4a") || codec.includes("aac")) return "AAC";
    if (codec.includes("opus")) return "Opus";
    if (codec.includes("vorbis")) return "Vorbis";
    return null;
  }
  function classifyDirectMediaContainer(candidate = {}) {
    const mime = String(candidate.mimeType || "").split(";", 1)[0].trim().toLowerCase();
    const byMime = {
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/webm": "webm",
      "audio/ogg": "ogg"
    }[mime];
    if (byMime) return byMime;
    try {
      const path = new URL(candidate.sourceUrl).pathname;
      const extension = path.match(/\.([a-z0-9]{2,6})$/i)?.[1]?.toLowerCase();
      return extension || null;
    } catch {
      return null;
    }
  }
  function compareAudioPreference(left, right) {
    return audioRoleScore(right) - audioRoleScore(left) || Number(right.audioIsDefault === true) - Number(left.audioIsDefault === true) || Number(left.isDrc === true) - Number(right.isDrc === true) || compareBandwidth(left, right) || mp4AudioScore(right) - mp4AudioScore(left);
  }
  function audioRoleScore(track) {
    return {
      original: 50,
      secondary: 30,
      dubbed: 20,
      auto_dubbed: 10,
      descriptive: 5
    }[track.audioRole] || 25;
  }
  function audioTrackLabel(track) {
    const language = formatAudioLanguageLabel({
      language: track.language,
      name: track.audioTrackName,
      role: track.audioRole,
      isDefault: track.audioIsDefault === true
    });
    const codec = codecLabel(track.codecs);
    const bitrate = audioBitrateLabel(
      firstPositiveNumber(track.averageBandwidth, track.bandwidth)
    );
    return [
      language,
      bitrate,
      codec,
      audioChannelsLabel(track.audioChannels),
      audioSampleRateLabel(track.audioSampleRate),
      track.isDrc ? "DRC" : null
    ].filter(Boolean).join(" \xB7 ");
  }
  function audioBitrateLabel(value) {
    const bitrate = positiveInteger(value);
    return bitrate ? `${Math.round(bitrate / 1e3)} kbps` : null;
  }
  function audioChannelsLabel(value) {
    const channels = positiveInteger(value);
    if (channels === 1) return "Mono";
    if (channels === 2) return "Stereo";
    return channels ? `${channels} channels` : null;
  }
  function audioSampleRateLabel(value) {
    const rate = positiveInteger(value);
    if (!rate) return null;
    const khz = rate / 1e3;
    return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
  }
  function mp4AudioScore(track) {
    return /\/(?:mp4|m4a)(?:$|;)/i.test(track.mimeType || "") ? 1 : 0;
  }
  function compareBandwidth(left, right) {
    return (firstPositiveNumber(right.averageBandwidth, right.bandwidth) || 0) - (firstPositiveNumber(left.averageBandwidth, left.bandwidth) || 0) || (right.resolution?.height || 0) - (left.resolution?.height || 0);
  }
  function uniqueObjects(items) {
    const unique = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      unique.set(
        item.id || `${item.url || ""}:${item.bandwidth || ""}:${item.resolution?.height || ""}`,
        item
      );
    }
    return [...unique.values()];
  }
  function firstPositiveNumber(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return null;
  }
  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  // src/media/protection-policy.js
  var STRONG_DRM_EVIDENCE = /* @__PURE__ */ new Set(["hls-keyformat", "eme-key-system-access"]);
  function hasStrongDrmEvidence(candidate = {}) {
    if (candidate.drm === "confirmed") return true;
    if (candidate.drm !== "suspected") return false;
    if (candidate.drmSystem) return true;
    if ((candidate.drmEvidence || []).some(
      (evidence) => STRONG_DRM_EVIDENCE.has(String(evidence).toLowerCase())
    )) {
      return true;
    }
    const eme = candidate.eme;
    return Boolean(
      eme?.keySystems?.length || eme?.keyStatuses?.length || eme?.licenseStatus
    );
  }
  function isWeakSampleAesSignal(candidate = {}) {
    if (candidate.drm !== "suspected") return false;
    if (candidate.encryptionScheme !== "sample-aes") return false;
    return !hasStrongDrmEvidence(candidate);
  }
  function isFfmpegCompatibleSampleAes(candidate = {}) {
    if (!isWeakSampleAesSignal(candidate)) return false;
    if (hasUnsupportedHlsKeyFormat(candidate)) return false;
    const methods = candidate.encryptionMethods || [];
    return methods.length === 0 || methods.every((method) => {
      const normalized = String(method).trim().toUpperCase();
      return normalized === "AES-128" || normalized.startsWith("SAMPLE-AES");
    });
  }
  function hasUnsupportedHlsKeyFormat(candidate = {}) {
    return (candidate.encryptionKeyFormats || []).map(normalizeHlsKeyFormat).filter(Boolean).some((format) => format !== "identity");
  }
  function normalizeHlsKeyFormat(value) {
    return String(value || "").trim().replace(/^["']|["']$/g, "").trim().toLowerCase().slice(0, 100);
  }

  // src/media/key-handoff-diagnostics.js
  function normalizeAesKeyHandoffDiagnostic(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const count = (field, maximum = 1e3) => Math.max(0, Math.min(maximum, Math.trunc(Number(value[field]) || 0)));
    return {
      framesQueried: count("framesQueried"),
      framesResponded: count("framesResponded"),
      requestedManifestCount: count("requestedManifestCount"),
      matchedManifestCount: count("matchedManifestCount"),
      relatedManifestCount: count("relatedManifestCount"),
      relatedManifestBytes: count("relatedManifestBytes", 8 * 1024 * 1024),
      childManifestCount: count("childManifestCount"),
      keyDirectiveCount: count("keyDirectiveCount"),
      unsupportedKeyDirectiveCount: count("unsupportedKeyDirectiveCount"),
      segmentDirectiveCount: count("segmentDirectiveCount"),
      encryptionMethods: normalizeDiagnosticStrings(value.encryptionMethods),
      encryptionKeyFormats: normalizeDiagnosticStrings(
        value.encryptionKeyFormats
      ),
      declaredKeyCount: count("declaredKeyCount"),
      capturedKeyCount: count("capturedKeyCount"),
      pageFetchAttemptCount: count("pageFetchAttemptCount"),
      pageFetchSuccessCount: count("pageFetchSuccessCount"),
      pageFetchStatuses: [
        ...new Set(
          Array.isArray(value.pageFetchStatuses) ? value.pageFetchStatuses : []
        )
      ].map(Number).filter(
        (status) => Number.isInteger(status) && status >= 0 && status <= 599
      ).slice(0, 8),
      pageFetchErrorCount: count("pageFetchErrorCount"),
      pageManifestFetchAttemptCount: count("pageManifestFetchAttemptCount"),
      pageManifestFetchSuccessCount: count("pageManifestFetchSuccessCount"),
      pageManifestFetchStatuses: [
        ...new Set(
          Array.isArray(value.pageManifestFetchStatuses) ? value.pageManifestFetchStatuses : []
        )
      ].map(Number).filter(
        (status) => Number.isInteger(status) && status >= 0 && status <= 599
      ).slice(0, 8),
      pageManifestFetchErrorCount: count("pageManifestFetchErrorCount")
    };
  }
  function formatAesKeyHandoffDiagnostic(value) {
    const diagnostic2 = normalizeAesKeyHandoffDiagnostic(value);
    if (!diagnostic2) return "";
    const statuses = diagnostic2.pageFetchStatuses.length ? `; key fetch status ${diagnostic2.pageFetchStatuses.join(", ")}` : "";
    const manifestStatuses = diagnostic2.pageManifestFetchStatuses.length ? `; manifest fetch status ${diagnostic2.pageManifestFetchStatuses.join(", ")}` : "";
    const encryption = diagnostic2.encryptionMethods.length ? `, encryption ${diagnostic2.encryptionMethods.join("+")} (${diagnostic2.encryptionKeyFormats.join("+") || "no key format"})` : "";
    return ` Browser capture: ${diagnostic2.framesResponded}/${diagnostic2.framesQueried} frames responded, ${diagnostic2.matchedManifestCount}/${diagnostic2.requestedManifestCount} requested manifests matched, ${diagnostic2.relatedManifestCount} related manifests (${diagnostic2.relatedManifestBytes} bytes, ${diagnostic2.childManifestCount} children, ${diagnostic2.segmentDirectiveCount} segments), ${diagnostic2.pageManifestFetchSuccessCount}/${diagnostic2.pageManifestFetchAttemptCount} manifest fetches succeeded${manifestStatuses}, ${diagnostic2.keyDirectiveCount} key directives (${diagnostic2.unsupportedKeyDirectiveCount} unsupported)${encryption}, ${diagnostic2.declaredKeyCount} identity keys declared, ${diagnostic2.capturedKeyCount} captured, ${diagnostic2.pageFetchSuccessCount}/${diagnostic2.pageFetchAttemptCount} key fetches succeeded${statuses}.`;
  }
  function normalizeDiagnosticStrings(value) {
    return Array.isArray(value) ? [
      ...new Set(
        value.filter((item) => typeof item === "string").map((item) => item.trim().slice(0, 100)).filter(Boolean)
      )
    ].slice(0, 8) : [];
  }

  // src/media/download-job-contract.js
  var DOWNLOAD_JOB_PREFIX = "adsfriendly.mediaDownloadJob.";
  var DOWNLOAD_HISTORY_KEY = "mediaDownloadHistory";
  var DOWNLOAD_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
  function normalizeMediaDownloadJob(value = {}) {
    const candidate = value.candidate;
    if (!candidate || !["direct", "hls", "dash", "adaptive"].includes(candidate.kind)) {
      throw new Error(
        "[MediaDownload] Direct, HLS, DASH, or adaptive candidate required."
      );
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
      output: normalizeMediaDownloadOutput(value.output, candidate),
      candidate: candidate.kind === "direct" ? {
        ...shared,
        sourceUrl: requiredHttpUrl(
          candidate.sourceUrl,
          "candidate.sourceUrl"
        )
      } : candidate.kind === "adaptive" ? {
        ...shared,
        sourceUrl: requiredHttpUrl(
          candidate.sourceUrl,
          "candidate.sourceUrl"
        ),
        provider: optionalString2(candidate.provider),
        acquisitionProfile: optionalString2(candidate.acquisitionProfile),
        playerUrl: optionalString2(candidate.playerUrl),
        probeStatus: candidate.probeStatus,
        streamType: candidate.streamType,
        variants: normalizeAdaptiveTracks(
          candidate.variants,
          "video",
          candidate
        ),
        audioTracks: normalizeAdaptiveTracks(
          candidate.audioTracks,
          "audio",
          candidate
        ),
        duration: optionalFiniteNumber2(candidate.duration),
        requestContext: normalizeDownloadRequestContext(
          candidate.resolvedRequestContext || candidate.requestContext
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
        keyHandoff: normalizeAesKeyHandoff(
          candidate.keyHandoff,
          candidate
        ),
        keyHandoffDiagnostic: normalizeAesKeyHandoffDiagnostic(
          candidate.keyHandoffDiagnostic
        ),
        requestContext: normalizeDownloadRequestContext(
          candidate.resolvedRequestContext || candidate.requestContext
        )
      }
    };
  }
  function normalizeAesKeyHandoff(value, candidate) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.manifestUrl !== candidate.manifestUrl) {
      throw new Error("[MediaDownload] AES key handoff does not match manifest.");
    }
    const keys = Array.isArray(value.keys) ? value.keys.slice(0, 16).map((item) => normalizeAesKeyEntry(item)).filter(Boolean) : [];
    return keys.length ? { kind: "hls_aes_keys", manifestUrl: candidate.manifestUrl, keys } : null;
  }
  function normalizeAesKeyEntry(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const url = requiredHttpUrl(value.url, "candidate.keyHandoff.keys.url");
    const data = optionalString2(value.data);
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
    let bytes = null;
    try {
      bytes = atob(data).length;
    } catch {
      return null;
    }
    if (!bytes || bytes > 64 * 1024) return null;
    return { url, data, bytes };
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
      if (hasStrongDrmEvidence(candidate))
        return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
      return { supported: true, reason: null };
    }
    if (candidate.kind === "dash") {
      if (candidate.probeStatus !== "ready")
        return { supported: false, reason: "DASH manifest is not ready." };
      if (hasStrongDrmEvidence(candidate))
        return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
      if (candidate.streamType === "live")
        return { supported: false, reason: "Live DASH is not supported yet." };
      if (candidate.streamType !== "vod")
        return { supported: false, reason: "Unknown DASH stream type." };
      if (!candidate.variants?.length && !candidate.audioTracks?.length)
        return { supported: false, reason: "DASH manifest has no media tracks." };
      return { supported: true, reason: null };
    }
    if (candidate.kind === "adaptive") {
      if (candidate.probeStatus !== "ready")
        return {
          supported: false,
          reason: "Adaptive media is waiting for both video and audio tracks."
        };
      if (hasStrongDrmEvidence(candidate))
        return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
      if (candidate.streamType !== "vod")
        return {
          supported: false,
          reason: "Only completed adaptive media is supported."
        };
      let variants;
      let audioTracks;
      try {
        variants = normalizeAdaptiveTracks(
          candidate.variants,
          "video",
          candidate
        );
        audioTracks = normalizeAdaptiveTracks(
          candidate.audioTracks,
          "audio",
          candidate
        );
      } catch {
        return {
          supported: false,
          reason: "An adaptive track URL is invalid or no longer usable."
        };
      }
      const hasMuxedTrack = variants.some((track) => track.muxed === true);
      const audioOnlyYouTube = candidate.provider === "youtube" && !variants.length && audioTracks.length > 0;
      if (!variants.length && !audioOnlyYouTube || !audioTracks.length && !hasMuxedTrack && !audioOnlyYouTube)
        return {
          supported: false,
          reason: "Adaptive media needs one resolved video and audio track."
        };
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
    if (hasStrongDrmEvidence(candidate))
      return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
    if (hasUnsupportedHlsKeyFormat(candidate))
      return {
        supported: false,
        reason: customHlsPlaybackOnlyReason(candidate)
      };
    if (isWeakSampleAesSignal(candidate) && !isFfmpegCompatibleSampleAes(candidate))
      return {
        supported: false,
        reason: "SAMPLE-AES signal needs player-resolved segments before download."
      };
    if (candidate.encryptionMethods?.length && !isDownloadableHlsEncryption(candidate))
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
  function normalizeAdaptiveTracks(value, expectedType, candidate) {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (track) => track && typeof track === "object" && isAcquirableAdaptiveTrack(candidate, track)
    ).slice(0, 24).map((track, index) => ({
      id: optionalString2(track.id) || `${expectedType}-${index + 1}`,
      type: expectedType,
      sourceUrl: isYouTubeProviderResolvableTrack(candidate, track) ? null : requiredHttpUrl(
        track.sourceUrl || track.url,
        `candidate.${expectedType}Tracks[${index}].sourceUrl`
      ),
      mimeType: optionalString2(track.mimeType),
      codecs: optionalString2(track.codecs),
      itag: optionalString2(track.itag),
      bandwidth: optionalFiniteNumber2(track.bandwidth),
      averageBandwidth: optionalFiniteNumber2(track.averageBandwidth),
      contentLength: optionalNonNegativeInteger2(track.contentLength),
      width: optionalNonNegativeInteger2(track.width || track.resolution?.width),
      height: optionalNonNegativeInteger2(
        track.height || track.resolution?.height
      ),
      resolution: track.resolution && typeof track.resolution === "object" ? {
        width: optionalNonNegativeInteger2(track.resolution.width),
        height: optionalNonNegativeInteger2(track.resolution.height)
      } : null,
      qualityLabel: optionalString2(track.qualityLabel),
      urlResolution: Object.values(ADAPTIVE_TRACK_RESOLUTION).includes(
        track.urlResolution
      ) ? track.urlResolution : "resolved",
      signatureCipher: optionalString2(track.signatureCipher),
      muxed: track.muxed === true,
      requestUserAgent: optionalString2(track.requestUserAgent),
      providerClient: optionalString2(track.providerClient),
      requestMode: optionalEnumValue2(
        track.requestMode,
        ["youtube_query_range", "http_range"],
        `candidate.${expectedType}Tracks[${index}].requestMode`
      ),
      requestCpn: typeof track.requestCpn === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(track.requestCpn) ? track.requestCpn : null,
      language: optionalString2(track.language),
      audioTrackId: optionalString2(track.audioTrackId),
      audioTrackName: optionalString2(track.audioTrackName),
      audioRole: optionalEnumValue2(
        track.audioRole,
        ["original", "dubbed", "auto_dubbed", "descriptive", "secondary"],
        `candidate.${expectedType}Tracks[${index}].audioRole`
      ),
      audioIsDefault: track.audioIsDefault === true,
      isDrc: track.isDrc === true,
      audioSampleRate: optionalNonNegativeInteger2(track.audioSampleRate),
      audioChannels: optionalNonNegativeInteger2(track.audioChannels),
      audioQuality: optionalString2(track.audioQuality)
    }));
  }
  function hasCurrentManifestHandoff(candidate) {
    return candidate.manifestHandoff?.mediaId === candidate.id && candidate.manifestHandoff?.manifestUrl === candidate.manifestUrl && Number(candidate.manifestHandoff?.expiresAt) > Date.now();
  }
  function isDownloadableHlsEncryption(candidate) {
    if (isFfmpegCompatibleSampleAes(candidate)) return true;
    const methods = candidate.encryptionMethods || [];
    const formats = candidate.encryptionKeyFormats || [];
    return methods.length > 0 && methods.every((method) => String(method).toUpperCase() === "AES-128") && formats.every((format) => String(format).toLowerCase() === "identity");
  }
  function drmPlaybackOnlyReason(candidate) {
    const state = candidate.drm === "confirmed" ? "confirmed" : "suspected";
    const system = candidate.drmSystem ? ` \xB7 ${formatDrmSystem(candidate.drmSystem)}` : "";
    return `DRM ${state}${system} \xB7 Playback only.`;
  }
  function customHlsPlaybackOnlyReason(candidate) {
    const format = (candidate.encryptionKeyFormats || []).map((value) => String(value || "").trim()).find((value) => value && value.toLowerCase() !== "identity");
    return `Custom protected HLS${format ? ` \xB7 ${format}` : ""} \xB7 Playback only.`;
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
  function optionalEnumValue2(value, allowed, field) {
    if (value === null || value === void 0 || value === "") return null;
    if (!allowed.includes(value))
      throw new Error(`[MediaDownload] ${field} is invalid.`);
    return value;
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

  // src/downloads/progress.js
  function getDownloadProgress(value = {}) {
    value ||= {};
    const pairs = [
      ["bytes", value.downloadedBytes, value.totalBytes],
      ["time", value.processedSeconds, value.duration],
      ["resources", value.completedResources, value.totalResources]
    ];
    for (const [basis, done, total] of pairs) {
      const completed = finite(done), maximum = finite(total);
      if (completed === null || !(maximum > 0)) continue;
      return {
        percent: Math.min(
          100,
          Math.max(0, Math.round(completed / maximum * 100))
        ),
        basis
      };
    }
    return { percent: null, basis: null };
  }
  function finite(value) {
    if (value === null || value === void 0 || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  // src/downloads/eta.js
  var WINDOW_MS = 3e4;
  var UPDATE_MS = 3e3;
  function createDownloadEtaEstimator({ now = Date.now } = {}) {
    const entries = /* @__PURE__ */ new Map();
    function update(id, progress, status = progress?.phase) {
      const time = now(), { basis } = getDownloadProgress(progress);
      const fields = {
        bytes: ["downloadedBytes", "totalBytes"],
        time: ["processedSeconds", "duration"],
        resources: ["completedResources", "totalResources"]
      }[basis];
      if (status !== "downloading" || !fields) {
        entries.delete(id);
        return { etaSeconds: null, etaUpdatedAt: null };
      }
      const done = Math.max(0, Number(progress[fields[0]])), total = Number(progress[fields[1]]);
      let entry = entries.get(id);
      if (!entry || entry.basis !== basis || entry.total !== total || done < entry.done || time - entry.lastSeen > 15e3 || entry.stage !== progress.stage) {
        entry = {
          basis,
          total,
          stage: progress.stage,
          done,
          lastSeen: time,
          samples: [],
          lastUpdate: time,
          speed: null,
          eta: null
        };
        entries.delete(id);
        entries.set(id, entry);
      }
      entry.lastSeen = time;
      entry.done = done;
      entry.samples.push({ time, done });
      while (entry.samples.length > 256 || entry.samples.length > 2 && entry.samples[1].time < time - WINDOW_MS)
        entry.samples.shift();
      while (entries.size > 100) entries.delete(entries.keys().next().value);
      if (time - entry.lastUpdate >= UPDATE_MS) {
        const first = entry.samples[0], elapsed = (time - first.time) / 1e3;
        const speed = elapsed >= 3 ? (done - first.done) / elapsed : 0;
        if (speed > 0) {
          entry.speed = entry.speed === null ? speed : entry.speed * 0.75 + speed * 0.25;
          entry.eta = Math.max(0, (total - done) / entry.speed);
        } else entry.eta = null;
        entry.lastUpdate = time;
      }
      return { etaSeconds: entry.eta, etaUpdatedAt: entry.lastUpdate };
    }
    return { update, forget: (id) => entries.delete(id) };
  }

  // src/downloads/file-contract.js
  var FILE_HELPER_REQUESTS = Object.freeze({
    FILE_PREPARE: "file.prepare",
    FILE_START: "file.start",
    FILE_CANCEL: "file.cancel"
  });
  var FILE_HELPER_EVENTS = Object.freeze({
    FILE_PREPARED: "file.prepared",
    FILE_STARTED: "file.started",
    FILE_PROGRESS: "file.progress",
    FILE_COMPLETED: "file.completed",
    FILE_CANCELLED: "file.cancelled",
    FILE_FAILED: "file.failed"
  });
  var FILE_HTTP_CAPABILITY = "download.file_http";
  var FILE_TRANSFER_KEY = "browserFileTransfers.v1";
  var FILE_MESSAGES = Object.freeze({
    CHECK: "CHECK_BROWSER_FILE",
    ACCEPT: "ACCEPT_BROWSER_FILE",
    RETURN: "RETURN_BROWSER_FILE",
    OPEN: "OPEN_BROWSER_FILE",
    REVEAL: "REVEAL_BROWSER_FILE"
  });
  var FILE_EXTENSIONS = Object.freeze([
    "zip",
    "7z",
    "rar",
    "gz",
    "tar",
    "pdf",
    "txt",
    "csv",
    "json",
    "xml",
    "epub",
    "mp4",
    "mkv",
    "webm",
    "mov",
    "mp3",
    "m4a",
    "ogg",
    "flac",
    "wav",
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp"
  ]);

  // src/media/access-strategy-catalog.js
  var MEDIA_ACCESS_STRATEGIES = Object.freeze({
    CAPTURED_REFERER_ORIGIN: "captured_referer_origin",
    CAPTURED_REFERER: "captured_referer",
    DOCUMENT_REFERER: "document_referer",
    PARENT_REFERER: "parent_referer",
    PAGE_REFERER: "page_referer",
    BROWSER_KEY_HANDOFF: "browser_key_handoff",
    YOUTUBE_MWEB_PO: "youtube_mweb_po",
    YOUTUBE_WEB_PO: "youtube_web_po",
    YOUTUBE_YTMUSIC_PO: "youtube_ytmusic_po",
    YOUTUBE_MOBILE_DIRECT: "youtube_mobile_direct",
    YOUTUBE_WEB_DIRECT: "youtube_web_direct",
    YOUTUBE_BROWSER_HANDOFF: "youtube_browser_handoff",
    YOUTUBE_YTDLP_PROVIDER: "youtube_ytdlp_provider"
  });
  var MEDIA_ACCESS_STRATEGY_CATALOG = Object.freeze([
    strategy2(MEDIA_ACCESS_STRATEGIES.BROWSER_KEY_HANDOFF, "key", 1.2),
    strategy2(MEDIA_ACCESS_STRATEGIES.CAPTURED_REFERER_ORIGIN, "http", 0.92),
    strategy2(MEDIA_ACCESS_STRATEGIES.CAPTURED_REFERER, "http", 0.9),
    strategy2(MEDIA_ACCESS_STRATEGIES.DOCUMENT_REFERER, "http", 0.82),
    strategy2(MEDIA_ACCESS_STRATEGIES.PARENT_REFERER, "http", 0.72),
    strategy2(MEDIA_ACCESS_STRATEGIES.PAGE_REFERER, "http", 0.72),
    strategy2(MEDIA_ACCESS_STRATEGIES.YOUTUBE_MWEB_PO, "provider", 1),
    strategy2(MEDIA_ACCESS_STRATEGIES.YOUTUBE_WEB_PO, "provider", 0.95),
    strategy2(MEDIA_ACCESS_STRATEGIES.YOUTUBE_YTMUSIC_PO, "provider", 0.8),
    strategy2(MEDIA_ACCESS_STRATEGIES.YOUTUBE_MOBILE_DIRECT, "provider", 0.65),
    strategy2(MEDIA_ACCESS_STRATEGIES.YOUTUBE_WEB_DIRECT, "provider", 0.55),
    strategy2(MEDIA_ACCESS_STRATEGIES.YOUTUBE_BROWSER_HANDOFF, "provider", 0.5),
    strategy2(MEDIA_ACCESS_STRATEGIES.YOUTUBE_YTDLP_PROVIDER, "provider", 0.35)
  ]);
  var STRATEGY_BY_ID2 = new Map(
    MEDIA_ACCESS_STRATEGY_CATALOG.map((definition) => [
      definition.id,
      definition
    ])
  );
  function isRegisteredMediaAccessStrategy(strategyId) {
    return STRATEGY_BY_ID2.has(strategyId);
  }
  function strategy2(id, resourceKind, baseScore) {
    return Object.freeze({ id, resourceKind, baseScore });
  }

  // src/media/helper-contract.js
  var MEDIA_HELPER_PROTOCOL_VERSION = 12;
  var MEDIA_HELPER_HOST_NAME = "com.adsfriendly.media_helper";
  var MEDIA_HELPER_REQUESTS = Object.freeze({
    ...FILE_HELPER_REQUESTS,
    HELLO: "helper.hello",
    GET_CAPABILITIES: "helper.capabilities.get",
    YOUTUBE_QUALITY_PREFLIGHT: "youtube.quality_preflight",
    PLAYER_OUTPUT_CANARY: "player_output.canary",
    PLAYER_OUTPUT_CAPTURE_START: "player_output.capture.start",
    PLAYER_OUTPUT_CAPTURE_CHUNK: "player_output.capture.chunk",
    PLAYER_OUTPUT_CAPTURE_FINISH: "player_output.capture.finish",
    PLAYER_OUTPUT_CAPTURE_CANCEL: "player_output.capture.cancel",
    DOWNLOAD_START: "download.start",
    DOWNLOAD_CANCEL: "download.cancel",
    OUTPUT_OPEN: "output.open",
    OUTPUT_REVEAL: "output.reveal",
    OUTPUT_STAT: "output.stat"
  });
  var MEDIA_HELPER_EVENTS = Object.freeze({
    ...FILE_HELPER_EVENTS,
    READY: "helper.ready",
    CAPABILITIES: "helper.capabilities",
    YOUTUBE_QUALITY_PREFLIGHT: "youtube.quality_preflight",
    PLAYER_OUTPUT_CANARY: "player_output.canary",
    PLAYER_OUTPUT_CHUNK_ACCEPTED: "player_output.chunk.accepted",
    DOWNLOAD_STARTED: "download.started",
    DOWNLOAD_PROGRESS: "download.progress",
    ACCESS_STRATEGY_RESULT: "media.access_strategy_result",
    DOWNLOAD_COMPLETED: "download.completed",
    DOWNLOAD_CANCELLED: "download.cancelled",
    OUTPUT_OPENED: "output.opened",
    OUTPUT_STAT: "output.stat",
    ERROR: "helper.error"
  });
  var MEDIA_HELPER_CAPABILITIES = Object.freeze({
    FILE_HTTP_DOWNLOAD: FILE_HTTP_CAPABILITY,
    DIRECT_HTTP_DOWNLOAD: "download.direct_http",
    HLS_VOD_DOWNLOAD: "download.hls_vod",
    HLS_PARALLEL_ACQUISITION: "download.hls_parallel_acquisition",
    HLS_DECRYPTED_MANIFEST: "download.hls_decrypted_manifest",
    OUTPUT_CONTAINER_SELECTION: "output.container_selection",
    DASH_VOD_DOWNLOAD: "download.dash_vod",
    ADAPTIVE_HTTP_DOWNLOAD: "download.adaptive_http",
    YOUTUBE_PLAYER_JS_RESOLUTION: "resolve.youtube_player_js",
    YOUTUBE_PROVIDER_FORMAT_RESOLUTION: "resolve.youtube_provider_formats",
    YOUTUBE_QUALITY_PREFLIGHT: "resolve.youtube_quality_preflight",
    PLAYER_OUTPUT_CANARY: "validate.player_output_canary",
    PLAYER_OUTPUT_CAPTURE: "capture.player_output",
    FFMPEG_MUX: "mux.ffmpeg",
    OUTPUT_OPEN: "output.open",
    OUTPUT_REVEAL: "output.reveal",
    OUTPUT_STAT: "output.stat"
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

  // src/media/resolution-diagnostics.js
  var MEDIA_RESOLUTION_STAGES = Object.freeze({
    NETWORK_OBSERVATION: "network_observation",
    MANIFEST_PROBE: "manifest_probe",
    CHILD_DISCOVERY: "child_discovery",
    CHILD_PROBE: "child_probe",
    SOURCE_MATCHING: "source_matching",
    PLAYER_DECRYPTION: "player_decryption",
    PLAYER_SEGMENT_RESOLUTION: "player_segment_resolution",
    DOWNLOAD_READY: "download_ready",
    PLAYBACK_ONLY: "playback_only"
  });
  var MEDIA_RESOLUTION_DIAGNOSTIC_STATES = Object.freeze({
    WAITING: "waiting",
    FAILED: "failed",
    UNHANDLED: "unhandled",
    READY: "ready",
    BLOCKED: "blocked"
  });
  var S2 = MEDIA_RESOLUTION_STAGES;
  var D = MEDIA_RESOLUTION_DIAGNOSTIC_STATES;
  var MEDIA_RESOLUTION_STAGE_CATALOG = Object.freeze({
    [S2.NETWORK_OBSERVATION]: stage("Browser media request", "Catalog candidate"),
    [S2.MANIFEST_PROBE]: stage("Manifest candidate", "Parsed manifest"),
    [S2.CHILD_DISCOVERY]: stage(
      "Master or playback request",
      "Observed child playlist"
    ),
    [S2.CHILD_PROBE]: stage("Observed child playlist", "Playable child stream"),
    [S2.SOURCE_MATCHING]: stage(
      "Playable child stream + player context",
      "Selected media source"
    ),
    [S2.PLAYER_DECRYPTION]: stage(
      "Encrypted manifest + player Blob",
      "Parsed plaintext manifest"
    ),
    [S2.PLAYER_SEGMENT_RESOLUTION]: stage(
      "SAMPLE-AES candidate + player playback",
      "Resolved media segment sequence"
    ),
    [S2.DOWNLOAD_READY]: stage("Selected media source", "Download plan input"),
    [S2.PLAYBACK_ONLY]: stage("Protected media metadata", "Playback-only result")
  });
  function diagnoseMediaResolution(item, items = []) {
    const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
    const target = item.kind === "blob" && item.selectedMediaId ? byId.get(item.selectedMediaId) || item.resolvedStream || item : item;
    if (target.kind === "direct")
      return diagnostic(S2.DOWNLOAD_READY, D.READY, "direct_ready", {
        message: "Download ready \xB7 direct media"
      });
    if (target.kind === "blob")
      return diagnostic(S2.NETWORK_OBSERVATION, D.WAITING, "blob_source_missing", {
        message: "Network observation \xB7 Blob found \xB7 source request missing"
      });
    if (!["hls", "dash"].includes(target.kind))
      return diagnostic(S2.NETWORK_OBSERVATION, D.UNHANDLED, "media_unhandled", {
        message: "Network observation \xB7 media type not handled"
      });
    if (hasStrongDrmEvidence(target))
      return diagnostic(S2.PLAYBACK_ONLY, D.BLOCKED, "drm_playback_only", {
        message: "Playback only \xB7 DRM protected"
      });
    if (hasUnsupportedHlsKeyFormat(target))
      return diagnostic(
        S2.PLAYBACK_ONLY,
        D.BLOCKED,
        "custom_hls_protection_playback_only",
        { message: "Playback only \xB7 custom HLS protection" }
      );
    if (target.probeStatus === "ready" && isWeakSampleAesSignal(target) && !isFfmpegCompatibleSampleAes(target))
      return diagnostic(
        S2.PLAYER_SEGMENT_RESOLUTION,
        D.WAITING,
        "sample_aes_player_segments_pending",
        {
          message: "Player URL resolution \xB7 waiting for resolved media segments"
        }
      );
    if (target.kind === "dash") return diagnoseDash(target);
    if (target.probeSource === "decrypted_blob" && !(Number(target.manifestHandoff?.expiresAt) > Date.now()))
      return diagnostic(
        S2.PLAYER_DECRYPTION,
        D.UNHANDLED,
        "decrypted_manifest_handoff_pending",
        {
          message: "Player decryption \xB7 manifest parsed \xB7 download handoff pending"
        }
      );
    if (target.resolutionStatus === "resolved" || target.probeStatus === "ready" && target.playlistType === "media" && target.streamType === "vod" && target.segmentCount > 0)
      return diagnostic(S2.DOWNLOAD_READY, D.READY, "hls_ready", {
        message: "Download ready \xB7 HLS VOD resolved"
      });
    if (target.probeStatus === "unsupported")
      return diagnostic(
        S2.MANIFEST_PROBE,
        D.UNHANDLED,
        "hls_manifest_unsupported",
        { message: "Manifest probe \xB7 HLS format not handled" }
      );
    const latestTargetProbe = latestProbeDiagnostic([target]);
    if (latestTargetProbe?.code?.startsWith("contextual_probe_")) {
      const described2 = describeProbeDiagnostic(latestTargetProbe);
      return diagnostic(S2.MANIFEST_PROBE, described2.status, described2.code, {
        probeDiagnostic: latestTargetProbe,
        message: `Manifest probe \xB7 ${described2.message}`
      });
    }
    const children = findObservedChildren(target, items);
    const readyChildren = children.filter(isUsableChild);
    const failedChildren = children.filter(
      (candidate) => candidate.probeStatus === "failed"
    );
    const facts = {
      observedChildCount: children.length,
      readyChildCount: readyChildren.length,
      failedChildCount: failedChildren.length,
      masterProbeStatus: target.probeStatus || "discovered",
      masterProbeError: target.probeError || null
    };
    if (!children.length) {
      const masterFailure = formatProbeFailure(target);
      if (target.probeStatus !== "failed" && target.playlistType !== "master") {
        return diagnostic(S2.MANIFEST_PROBE, D.WAITING, "hls_probe_pending", {
          ...facts,
          message: "Manifest probe \xB7 HLS response not parsed yet"
        });
      }
      return diagnostic(
        S2.CHILD_DISCOVERY,
        target.probeStatus === "failed" ? D.FAILED : D.WAITING,
        target.probeStatus === "failed" ? "master_failed_child_not_observed" : "child_request_not_observed",
        {
          ...facts,
          message: `Child discovery \xB7 0 child playlists${masterFailure ? ` \xB7 ${masterFailure}` : ""}`
        }
      );
    }
    if (readyChildren.length && !target.selectedMediaId) {
      return diagnostic(S2.SOURCE_MATCHING, D.WAITING, "child_ready_not_matched", {
        ...facts,
        message: `Source matching \xB7 ${readyChildren.length} child ready \xB7 not linked to player`
      });
    }
    const latestChildProbe = latestProbeDiagnostic(children);
    if (latestChildProbe) {
      const described2 = describeProbeDiagnostic(latestChildProbe);
      return diagnostic(S2.CHILD_PROBE, described2.status, described2.code, {
        ...facts,
        probeDiagnostic: latestChildProbe,
        message: `Child probe \xB7 ${described2.message}`
      });
    }
    if (failedChildren.length === children.length) {
      return diagnostic(S2.CHILD_PROBE, D.FAILED, "child_probe_failed", {
        ...facts,
        message: `Child probe \xB7 ${failedChildren.length} failed \xB7 ${formatProbeFailure(failedChildren[0]) || "request rejected"}`
      });
    }
    return diagnostic(S2.CHILD_PROBE, D.WAITING, "child_observed_probe_pending", {
      ...facts,
      message: `Child probe \xB7 ${children.length} observed \xB7 manifest not parsed`
    });
  }
  function diagnoseDash(item) {
    if (item.probeStatus === "failed")
      return diagnostic(S2.MANIFEST_PROBE, D.FAILED, "dash_probe_failed", {
        message: `Manifest probe \xB7 DASH failed${item.probeError ? ` \xB7 ${item.probeError}` : ""}`
      });
    if (item.probeStatus !== "ready")
      return diagnostic(S2.MANIFEST_PROBE, D.WAITING, "dash_probe_pending", {
        message: "Manifest probe \xB7 DASH tracks not parsed"
      });
    return diagnostic(S2.DOWNLOAD_READY, D.READY, "dash_ready", {
      message: "Download ready \xB7 DASH tracks resolved"
    });
  }
  function findObservedChildren(parent, items) {
    const explicitIds = new Set(parent.childManifestIds || []);
    return items.filter((candidate) => {
      if (candidate.kind !== "hls" || candidate.id === parent.id) return false;
      if (explicitIds.has(candidate.id) || candidate.parentManifestIds?.includes(parent.id))
        return true;
      if (!sameFrame2(parent, candidate)) return false;
      const parentAt = parent.firstSeenAt || parent.lastSeenAt;
      const childAt = candidate.firstSeenAt || candidate.lastSeenAt;
      return Number.isFinite(parentAt) && Number.isFinite(childAt) && Math.abs(parentAt - childAt) <= 6e4;
    });
  }
  function isUsableChild(item) {
    return item.probeStatus === "ready" && item.playlistType === "media" && ["vod", "live"].includes(item.streamType) && (item.segmentCount > 0 || item.partialSegmentCount > 0);
  }
  function sameFrame2(left, right) {
    return Number.isInteger(left.frameId) && Number.isInteger(right.frameId) && left.frameId === right.frameId;
  }
  function formatProbeFailure(item) {
    if (item.probeError === "manifest_http_403") return "master probe 403";
    if (item.probeError === "fallback_fetch_blocked")
      return "probe blocked by page/CORS";
    if (item.probeStatus === "failed") return "manifest probe failed";
    return null;
  }
  function latestProbeDiagnostic(items) {
    return items.flatMap((item) => item.probeDiagnostics || [item.probeDiagnostic]).filter(Boolean).sort((left, right) => (right.observedAt || 0) - (left.observedAt || 0))[0];
  }
  function describeProbeDiagnostic(diagnostic2) {
    const code = diagnostic2.code || "probe_status_unknown";
    if (code === "iframe_probe_scheduled")
      return described(D.WAITING, code, "scheduled in player frame");
    if (code === "manifest_fetch_dispatched")
      return described(D.WAITING, code, "request sent \xB7 waiting for response");
    if (code === "contextual_probe_prepared")
      return described(
        D.WAITING,
        code,
        "Referer/Origin prepared \xB7 retry starting"
      );
    if (code === "contextual_manifest_fetch_dispatched")
      return described(
        D.WAITING,
        code,
        "contextual request sent \xB7 waiting for response"
      );
    if (code.startsWith("contextual_probe_"))
      return described(
        D.FAILED,
        code,
        `context setup failed \xB7 ${code.slice("contextual_probe_".length)}`
      );
    if (code === "content_duplicate")
      return described(D.WAITING, code, "duplicate schedule skipped");
    if (code === "probe_gate_duplicate")
      return described(D.WAITING, code, "probe already in progress or completed");
    if (code === "manifest_probe_timeout")
      return described(D.FAILED, code, "timed out after 10s");
    if (/^manifest_http_\d+$/.test(code))
      return described(
        D.FAILED,
        code,
        `HTTP ${diagnostic2.httpStatus || code.split("_").at(-1)}`
      );
    if (code === "fallback_fetch_blocked")
      return described(D.FAILED, code, "request blocked by page/CORS");
    if (code === "manifest_body_received")
      return described(
        D.WAITING,
        code,
        `${formatBodySize(diagnostic2.bodyBytes)} body received \xB7 ${diagnostic2.bodyFormat || "unknown"} format \xB7 parser pending`
      );
    if (code === "manifest_parsed_zero_segments")
      return described(
        D.UNHANDLED,
        code,
        `${formatBodySize(diagnostic2.bodyBytes)} ${diagnostic2.bodyFormat || "unknown"} parsed \xB7 0 segments`
      );
    if (code === "manifest_parsed_no_stream")
      return described(
        D.UNHANDLED,
        code,
        `${formatBodySize(diagnostic2.bodyBytes)} body parsed \xB7 no playable stream`
      );
    if (code === "manifest_unsupported")
      return described(D.UNHANDLED, code, "body received \xB7 format unsupported");
    if (code === "manifest_parsed")
      return described(
        D.WAITING,
        code,
        `${diagnostic2.playlistType || "manifest"} parsed \xB7 ${diagnostic2.segmentCount || 0} segments \xB7 matching pending`
      );
    if (code === "decrypted_manifest_blob_observed")
      return described(
        D.WAITING,
        code,
        `player decrypted ${diagnostic2.bodyFormat || "manifest"} \xB7 parser pending`
      );
    if (code === "decrypted_manifest_parsed")
      return described(
        D.READY,
        code,
        `player-decrypted ${diagnostic2.playlistType || "manifest"} parsed \xB7 ${diagnostic2.segmentCount || 0} segments`
      );
    if (code === "decrypted_manifest_zero_segments")
      return described(
        D.UNHANDLED,
        code,
        "player-decrypted manifest \xB7 0 segments"
      );
    if (code === "decrypted_manifest_no_stream")
      return described(
        D.UNHANDLED,
        code,
        "player-decrypted manifest \xB7 no playable stream"
      );
    if (code === "decrypted_manifest_unsupported")
      return described(D.UNHANDLED, code, "player-decrypted format unsupported");
    if (code === "decrypted_manifest_parse_failed")
      return described(D.FAILED, code, "player-decrypted manifest parse failed");
    return described(
      diagnostic2.phase === "failed" ? D.FAILED : D.WAITING,
      code,
      code.replaceAll("_", " ")
    );
  }
  function described(status, code, message) {
    return { status, code, message };
  }
  function formatBodySize(bytes) {
    if (!Number.isFinite(bytes)) return "Unknown-size";
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  function diagnostic(stage2, status, code, facts = {}) {
    const contract = MEDIA_RESOLUTION_STAGE_CATALOG[stage2];
    return Object.freeze({
      stage: stage2,
      status,
      code,
      input: contract.input,
      output: contract.output,
      ...facts
    });
  }
  function stage(input, output) {
    return Object.freeze({ input, output });
  }

  // src/media/catalog-view.js
  function selectVisibleMediaItems(items = [], maximum = 8) {
    const diagnosedItems = items.map((item) => ({
      ...item,
      resolutionDiagnostic: diagnoseMediaResolution(item, items)
    }));
    const displayItems = prioritizeFacebookPlayback(
      groupFacebookDirectRepresentations(diagnosedItems)
    );
    const blobResolvedSourceIds = new Set(
      diagnosedItems.filter((item) => item.kind === "blob" && item.selectedMediaId).flatMap((item) => [
        item.selectedMediaId,
        ...item.resolvedMediaIds || [],
        ...item.blobTrace?.candidateIds || []
      ]).filter(Boolean)
    );
    for (const blob of diagnosedItems.filter(
      (item) => item.kind === "blob" && item.selectedMediaId
    )) {
      for (const source of diagnosedItems) {
        if (source.kind !== "blob" && samePlaybackFrame(blob, source) && (source.selectedMediaId === blob.selectedMediaId || source.resolvedMediaIds?.includes(blob.selectedMediaId) || (blob.resolvedMediaIds || []).some(
          (id) => source.resolvedMediaIds?.includes(id)
        ))) {
          blobResolvedSourceIds.add(source.id);
        }
      }
    }
    const sorted = [...displayItems].sort(
      (left, right) => playbackPriority(right) - playbackPriority(left) || (right.firstSeenAt || 0) - (left.firstSeenAt || 0) || String(left.id || "").localeCompare(String(right.id || ""))
    );
    const visible = [];
    const adaptivePages = new Set(
      displayItems.filter((item) => item.kind === "adaptive").map((item) => item.pageUrl)
    );
    const blobGroups = /* @__PURE__ */ new Map();
    const directGroups = /* @__PURE__ */ new Map();
    const resolvedBlobGroupKeys = resolvedBlobGroupKeysByPage(diagnosedItems);
    for (const item of sorted) {
      if (item.kind === "blob" && adaptivePages.has(item.pageUrl)) continue;
      if (item.kind !== "blob" && blobResolvedSourceIds.has(item.id)) continue;
      if (item.kind === "hls" && item.parentManifestIds?.length) continue;
      if (item.kind === "direct") {
        const key2 = directMediaGroupKey(item);
        const existing2 = directGroups.get(key2);
        if (existing2) {
          existing2.relatedCount += 1;
          continue;
        }
        const grouped2 = { ...item, relatedCount: 1 };
        directGroups.set(key2, grouped2);
        visible.push(grouped2);
        continue;
      }
      if (item.kind !== "blob") {
        visible.push(item);
        continue;
      }
      const key = blobGroupKey(item, resolvedBlobGroupKeys);
      const existing = blobGroups.get(key);
      if (existing) {
        existing.relatedCount += 1;
        if (item.selectedMediaId && !existing.selectedMediaId) {
          const resolved = { ...item, relatedCount: existing.relatedCount };
          blobGroups.set(key, resolved);
          const visibleIndex = visible.indexOf(existing);
          if (visibleIndex >= 0) visible[visibleIndex] = resolved;
        }
        continue;
      }
      const grouped = { ...item, relatedCount: 1 };
      blobGroups.set(key, grouped);
      visible.push(grouped);
    }
    return visible.slice(0, maximum);
  }
  function playbackPriority(item) {
    if (item.playback?.playing === true) return 2;
    if (item.playback?.visible === true) return 1;
    return 0;
  }
  function groupFacebookDirectRepresentations(items) {
    const groups = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (item.kind !== "direct") continue;
      const key = facebookMediaAssetKey(item);
      if (!key) continue;
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }
    const consumed = /* @__PURE__ */ new Set();
    const synthetic = [];
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      const adaptive = createFacebookAdaptiveGroup(key, group);
      if (!adaptive) continue;
      group.forEach((item) => consumed.add(item.id));
      synthetic.push(adaptive);
    }
    return [
      ...items.filter(
        (item) => !consumed.has(item.id) && !isFacebookAudioTrack(item)
      ),
      ...synthetic
    ];
  }
  function prioritizeFacebookPlayback(items) {
    const facebookItems = items.filter(isFacebookMediaItem);
    if (facebookItems.length <= 1) return items;
    const playing = facebookItems.filter((item) => item.playback?.playing);
    const visible = facebookItems.filter((item) => item.playback?.visible);
    const preferred = playing.length ? playing : visible.length ? visible : [...facebookItems].sort(
      (left, right) => (right.lastSeenAt || right.firstSeenAt || 0) - (left.lastSeenAt || left.firstSeenAt || 0)
    ).slice(0, 1);
    const preferredIds = new Set(preferred.map((item) => item.id));
    return items.filter(
      (item) => !isFacebookMediaItem(item) || preferredIds.has(item.id)
    );
  }
  function isFacebookMediaItem(item) {
    if (item.provider === "facebook") return true;
    try {
      return item.kind === "direct" && isFacebookCdnHost(new URL(item.sourceUrl).hostname);
    } catch {
      return false;
    }
  }
  function createFacebookAdaptiveGroup(key, items) {
    const audioItems = items.filter(isFacebookAudioTrack);
    const representations = collapseFacebookRepresentations(
      items.filter((item) => !isFacebookAudioTrack(item))
    );
    if (!representations.length) return null;
    const sorted = [...representations].sort(
      (left, right) => facebookQualityScore(right) - facebookQualityScore(left) || (right.contentLength || 0) - (left.contentLength || 0) || (right.lastSeenAt || 0) - (left.lastSeenAt || 0)
    );
    const primary = sorted[0];
    const variants = sorted.map((item, index) => ({
      id: item.id,
      type: "video",
      sourceUrl: facebookFullMediaUrl(item.sourceUrl),
      mimeType: item.mimeType || "video/mp4",
      codecs: null,
      itag: null,
      bandwidth: item.bandwidth || null,
      averageBandwidth: item.averageBandwidth || null,
      contentLength: facebookUrlHasByteLimit(item.sourceUrl) ? null : item.contentLength || null,
      width: item.resolution?.width || null,
      height: item.resolution?.height || null,
      qualityLabel: facebookQualityLabel(item) || `Source ${index + 1}`,
      urlResolution: "resolved",
      signatureCipher: null,
      muxed: !isFacebookDashTrack(item)
    }));
    const audioTracks = createFacebookAudioTracks(audioItems);
    return {
      ...primary,
      id: stableMediaId("adaptive", key),
      kind: "adaptive",
      provider: "facebook",
      title: primary.title && !/^(?:\(\d+\+?\)\s*)?facebook$/i.test(primary.title.trim()) ? primary.title : "Facebook video",
      sourceUrl: facebookFullMediaUrl(primary.sourceUrl),
      contentLength: facebookUrlHasByteLimit(primary.sourceUrl) ? null : primary.contentLength || null,
      mimeType: "video/mp4",
      variants,
      audioTracks,
      subtitles: [],
      acquisitionProfile: "facebook_direct_representations",
      probeStatus: "ready",
      streamType: "vod",
      relatedCount: items.length,
      playback: newestPlaybackState(items),
      firstSeenAt: Math.min(...items.map((item) => item.firstSeenAt || 0)),
      lastSeenAt: Math.max(...items.map((item) => item.lastSeenAt || 0))
    };
  }
  function createFacebookAudioTracks(items) {
    if (!items.length) return [];
    const selected = [...items].sort(
      (left, right) => facebookAudioScore(right) - facebookAudioScore(left) || facebookObservationTime(right) - facebookObservationTime(left)
    )[0];
    return [
      {
        id: selected.id,
        type: "audio",
        sourceUrl: facebookFullMediaUrl(selected.sourceUrl),
        mimeType: selected.mimeType || "audio/mp4",
        codecs: null,
        bandwidth: selected.bandwidth || null,
        averageBandwidth: selected.averageBandwidth || null,
        contentLength: facebookUrlHasByteLimit(selected.sourceUrl) ? null : selected.contentLength || null,
        qualityLabel: "Facebook audio",
        urlResolution: "resolved",
        signatureCipher: null,
        muxed: false,
        language: null,
        audioTrackName: "Facebook audio",
        audioRole: "original",
        audioIsDefault: true
      }
    ];
  }
  function isFacebookAudioTrack(item) {
    const mimeType = String(item?.mimeType || "").toLowerCase();
    if (mimeType.startsWith("audio/")) return true;
    const tag = facebookEncodingTag(item?.sourceUrl);
    return /(?:^|[_-])(?:audio|aac|opus)(?:[_-]|$)/i.test(tag || "");
  }
  function isFacebookDashTrack(item) {
    return /(?:^|[_-])dash(?:[_-]|$)/i.test(
      facebookEncodingTag(item?.sourceUrl) || ""
    );
  }
  function facebookAudioScore(item) {
    const bandwidth = item.averageBandwidth || item.bandwidth;
    if (Number.isFinite(bandwidth) && bandwidth > 0) return bandwidth;
    const tag = facebookEncodingTag(item.sourceUrl) || "";
    const kilobits = Number(
      tag.match(/(?:audio|aac|opus)[_-]?(\d{2,3})(?:k|kbps)?/i)?.[1]
    );
    return Number.isFinite(kilobits) ? kilobits * 1e3 : 0;
  }
  function collapseFacebookRepresentations(items) {
    const representations = /* @__PURE__ */ new Map();
    for (const item of items) {
      const quality = facebookQualityLabel(item);
      const key = quality?.toLowerCase() || "source";
      const existing = representations.get(key);
      if (!existing || facebookObservationTime(item) >= facebookObservationTime(existing))
        representations.set(key, item);
    }
    return [...representations.values()];
  }
  function facebookObservationTime(item) {
    return item.playback?.observedAt || item.lastSeenAt || item.firstSeenAt || 0;
  }
  function facebookFullMediaUrl(value) {
    try {
      const url = new URL(value || "");
      for (const name of ["range", "bytestart", "byteend"])
        url.searchParams.delete(name);
      return url.href;
    } catch {
      return value;
    }
  }
  function facebookUrlHasByteLimit(value) {
    try {
      const url = new URL(value || "");
      return ["range", "bytestart", "byteend"].some(
        (name) => url.searchParams.has(name)
      );
    } catch {
      return false;
    }
  }
  function newestPlaybackState(items) {
    const states = items.map((item) => item.playback).filter(Boolean).sort((left, right) => (right.observedAt || 0) - (left.observedAt || 0));
    if (!states.length) return null;
    const active3 = states.find((state) => state.playing) || states[0];
    return {
      ...active3,
      playing: states.some((state) => state.playing),
      visible: states.some((state) => state.visible)
    };
  }
  function facebookMediaAssetKey(item) {
    try {
      const source = new URL(item.sourceUrl || "");
      if (!isFacebookCdnHost(source.hostname)) return null;
      const envelope = decodeFacebookEfg(source.searchParams.get("efg"));
      const assetId = findFacebookAssetId(envelope);
      if (assetId) return `facebook-asset:${assetId}`;
      const pageId = facebookPageVideoId(item.pageUrl);
      return pageId ? `facebook-page:${pageId}` : null;
    } catch {
      return null;
    }
  }
  function decodeFacebookEfg(value) {
    if (typeof value !== "string" || !value || value.length > 1e4)
      return null;
    try {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }
  function findFacebookAssetId(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 2) return null;
    for (const key of ["xpv_asset_id", "video_id", "asset_id"]) {
      const candidate = value[key];
      if (typeof candidate === "string" || Number.isSafeInteger(candidate))
        return String(candidate);
    }
    for (const child of Object.values(value)) {
      const candidate = findFacebookAssetId(child, depth + 1);
      if (candidate) return candidate;
    }
    return null;
  }
  function facebookPageVideoId(value) {
    try {
      const page = new URL(value || "");
      if (!(page.hostname === "facebook.com" || page.hostname.endsWith(".facebook.com")))
        return null;
      return page.searchParams.get("v") || page.pathname.match(/\/(?:reel|videos)\/(\d+)/i)?.[1] || null;
    } catch {
      return null;
    }
  }
  function facebookQualityLabel(item) {
    const tag = facebookEncodingTag(item.sourceUrl);
    const height = item.resolution?.height || Number(tag?.match(/(?:^|[^0-9])(\d{3,4})p/i)?.[1]);
    if (height) return `${height}p`;
    if (/\bhd\b/i.test(tag || "")) return "HD";
    if (/\bsd\b/i.test(tag || "")) return "SD";
    return null;
  }
  function facebookQualityScore(item) {
    const label = facebookQualityLabel(item);
    const height = Number(label?.match(/^(\d+)p$/)?.[1]);
    if (height) return height;
    if (label === "HD") return 720;
    if (label === "SD") return 480;
    return 0;
  }
  function facebookEncodingTag(value) {
    try {
      const envelope = decodeFacebookEfg(new URL(value).searchParams.get("efg"));
      return typeof envelope?.vencode_tag === "string" ? envelope.vencode_tag : null;
    } catch {
      return null;
    }
  }
  function directMediaGroupKey(item) {
    const sourceUrl = item.sourceUrl || "";
    try {
      const url = new URL(sourceUrl);
      url.hash = "";
      if (isFacebookCdnHost(url.hostname))
        return `facebook:${url.pathname.toLowerCase()}`;
      for (const name of ["range", "bytestart", "byteend"])
        url.searchParams.delete(name);
      const entries = [...url.searchParams.entries()].sort(
        ([leftKey, left], [rightKey, right]) => leftKey.localeCompare(rightKey) || left.localeCompare(right)
      );
      url.search = "";
      for (const [name, value] of entries) url.searchParams.append(name, value);
      return url.href;
    } catch {
      return sourceUrl;
    }
  }
  function isFacebookCdnHost(value) {
    const host = String(value || "").toLowerCase();
    return host === "fbcdn.net" || host.endsWith(".fbcdn.net");
  }
  function readableMediaTitle(value) {
    const title = typeof value === "string" ? value.trim() : "";
    if (!title || title.length > 160) return null;
    if (/^[a-f0-9]{24,}$/i.test(title)) return null;
    return title;
  }
  function resolvedBlobGroupKeysByPage(items) {
    const byPage = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (item.kind !== "blob" || !item.selectedMediaId) continue;
      const pageUrl = item.pageUrl || "";
      const matches = byPage.get(pageUrl) || [];
      matches.push(item);
      byPage.set(pageUrl, matches);
    }
    return new Map(
      [...byPage].flatMap(
        ([pageUrl, matches]) => matches.length === 1 ? [[pageUrl, `${pageUrl}
${blobTitleKey(matches[0].title)}`]] : []
      )
    );
  }
  function blobGroupKey(item, resolvedGroupKeys) {
    const pageUrl = item.pageUrl || "";
    if (!item.selectedMediaId && isGenericBlobTitle(item.title)) {
      const resolvedKey = resolvedGroupKeys.get(pageUrl);
      if (resolvedKey) return resolvedKey;
    }
    return `${pageUrl}
${blobTitleKey(item.title)}`;
  }
  function blobTitleKey(value) {
    return readableMediaTitle(value)?.toLowerCase() || "blob";
  }
  function isGenericBlobTitle(value) {
    const title = typeof value === "string" ? value.trim() : "";
    return !readableMediaTitle(title) || /^(blob|blob media stream|media stream)$/i.test(title);
  }
  function samePlaybackFrame(left, right) {
    if (Number.isInteger(left.frameId) && Number.isInteger(right.frameId))
      return left.frameId === right.frameId;
    return Boolean(
      left.frameUrl && right.frameUrl && left.frameUrl === right.frameUrl
    );
  }

  // src/media/download-job-view.js
  var ACTIVE_STATUSES = /* @__PURE__ */ new Set([
    "starting",
    "probing",
    "downloading",
    "finalizing"
  ]);
  function isMediaJobActive(job = {}) {
    return [...ACTIVE_STATUSES, "pausing", "cancelling"].includes(job.status);
  }

  // src/media/download-identity.js
  var DOWNLOAD_IDENTITY_SCHEMA = "download-identity.v1";
  var RECENT_DOWNLOAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1e3;
  function sourceIdentity(candidate) {
    if (candidate.provider === "youtube" && candidate.kind === "adaptive") {
      for (const value of [candidate.pageUrl, candidate.sourceUrl]) {
        try {
          const url2 = new URL(value);
          if (!/(^|\.)youtube\.com$/.test(url2.hostname)) continue;
          const id = url2.searchParams.get("v") || url2.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
          if (id) return { asset: `youtube:${id}`, representation: "adaptive" };
        } catch {
        }
      }
    }
    if (candidate.provider === "facebook" && candidate.kind === "adaptive") {
      const id = facebookMediaAssetKey(candidate);
      if (id) return { asset: id, representation: "adaptive" };
    }
    const url = new URL(candidate.manifestUrl || candidate.sourceUrl);
    if (!/^https?:$/.test(url.protocol))
      throw new Error("HTTP media source required.");
    url.hash = "";
    for (const key of ["range", "bytestart", "byteend"])
      url.searchParams.delete(key);
    url.searchParams.sort();
    if (candidate.kind === "direct" && /^s\d+\.pornone\.com$/.test(url.hostname)) {
      const match = url.pathname.match(
        /^\/vid2\/[^/]+\/\d+\/[^/]+\/(\d+)\/(\d+_[^/]+\.mp4)$/
      );
      if (match && match[2].startsWith(`${match[1]}_`))
        return {
          asset: `pornone:${match[1]}`,
          representation: `${match[2]}${url.search}`
        };
    }
    return { asset: `${candidate.kind}:${url.href}`, representation: "source" };
  }
  function trackIdentity(track, candidate) {
    if (!track) return null;
    const facts = {
      itag: track.itag || null,
      codec: track.codecs || track.mimeType || null,
      width: track.width || track.resolution?.width || null,
      height: track.height || track.resolution?.height || null,
      fps: track.frameRate || track.fps || null,
      bitrate: track.averageBandwidth || track.bandwidth || null,
      audioTrackId: track.audioTrackId || null,
      language: track.language || null,
      role: track.audioRole || null,
      sampleRate: track.audioSampleRate || null,
      channels: track.audioChannels || null,
      muxed: track.muxed === true,
      drc: track.isDrc === true
    };
    if (candidate.provider === "facebook" && facebookMediaAssetKey(candidate) && facebookMediaAssetKey({
      ...candidate,
      sourceUrl: track.sourceUrl || track.url
    }) === facebookMediaAssetKey(candidate)) {
      try {
        const source = new URL(track.sourceUrl || track.url);
        facts.source = `${source.pathname}|${source.searchParams.get("efg") || ""}`;
      } catch {
        facts.source = track.sourceUrl || track.url || track.id;
      }
    } else if (candidate.provider !== "youtube")
      facts.source = track.sourceUrl || track.url || track.id;
    else if (!facts.itag) facts.id = track.id;
    return facts;
  }
  async function digest(value) {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(value))
    );
    return Array.from(
      new Uint8Array(bytes),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join("");
  }
  async function buildMediaDownloadIdentity(candidate, value) {
    const output = normalizeMediaDownloadOutput(value, candidate);
    const audioOnly = output.profileId === "audio-ogg";
    const source = sourceIdentity(candidate);
    const tracks = (values) => values.map((track) => JSON.stringify(trackIdentity(track, candidate))).sort();
    const selection = {
      profile: output.profileId,
      representation: source.representation,
      video: audioOnly ? null : output.videoTrackId ? trackIdentity(
        candidate.variants?.find(
          (track) => track.id === output.videoTrackId
        ),
        candidate
      ) : candidate.kind === "adaptive" ? { auto: tracks(candidate.variants || []) } : "source",
      audio: output.audioTrackId ? trackIdentity(
        candidate.audioTracks?.find(
          (track) => track.id === output.audioTrackId
        ),
        candidate
      ) : candidate.kind === "adaptive" ? { auto: tracks(candidate.audioTracks || []) } : "included"
    };
    const [assetKey, selectionKey] = await Promise.all([
      digest(source.asset),
      digest(selection)
    ]);
    return Object.freeze({
      schema: DOWNLOAD_IDENTITY_SCHEMA,
      assetKey,
      selectionKey,
      requestKey: await digest([assetKey, selectionKey])
    });
  }
  function buildMediaDownloadSummary(candidate, value) {
    const output = normalizeMediaDownloadOutput(value, candidate);
    const quality = getMediaVideoQualityOptions(candidate).find(
      (item) => item.id === output.videoTrackId
    );
    const audio = getMediaAudioTrackOptions(candidate).find(
      (item) => item.id === output.audioTrackId
    );
    const height = candidate.resolution?.height;
    return {
      profileLabel: getMediaDownloadProfiles(candidate).find(
        (item) => item.id === output.profileId
      )?.label || output.profileId,
      qualityLabel: output.profileId === "audio-ogg" ? "Audio only" : quality?.label || (candidate.kind === "adaptive" ? "Auto quality" : height ? `${height}p` : "Source quality"),
      audioLabel: audio?.label || null
    };
  }
  function normalizeDownloadIdentity(value) {
    return value?.schema === DOWNLOAD_IDENTITY_SCHEMA && [value.assetKey, value.selectionKey, value.requestKey].every(
      (key) => typeof key === "string" && /^[a-f0-9]{64}$/.test(key)
    ) ? {
      schema: DOWNLOAD_IDENTITY_SCHEMA,
      assetKey: value.assetKey,
      selectionKey: value.selectionKey,
      requestKey: value.requestKey
    } : null;
  }
  function findRelatedDownloadJobs(jobs, identity, { exact = true, now = Date.now() } = {}) {
    const normalized = normalizeDownloadIdentity(identity);
    if (!normalized) return [];
    return jobs.filter((job) => {
      const saved = normalizeDownloadIdentity(job.downloadIdentity);
      if (!saved || saved.assetKey !== normalized.assetKey || exact && saved.requestKey !== normalized.requestKey)
        return false;
      return isMediaJobActive(job) || job.status === "completed" && Number(job.updatedAt) >= now - RECENT_DOWNLOAD_WINDOW_MS;
    }).sort(
      (a, b) => Number(isMediaJobActive(b)) - Number(isMediaJobActive(a)) || (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
    );
  }
  function presentDownloadJob(job, fileStatus = "unchecked") {
    if (!job) return null;
    return {
      id: job.id,
      status: job.status,
      title: job.title,
      updatedAt: job.updatedAt,
      progress: job.progress ? { ...job.progress } : null,
      outputPath: job.outputPath || null,
      output: job.output || null,
      summary: job.downloadSummary || null,
      fileStatus
    };
  }

  // src/background/media-access-strategy-memory.js
  var STORAGE_KEY = "mediaAccessStrategyMemory";
  var MEMORY_VERSION = 1;
  var MAX_HOSTS = 100;
  var MAX_STRATEGIES_PER_HOST = 8;
  var mutationQueue = Promise.resolve();
  function recordMediaAccessStrategyResult(value = {}) {
    const operation = mutationQueue.then(() => recordResult(value));
    mutationQueue = operation.catch(() => {
    });
    return operation;
  }
  async function recordResult(value) {
    const hostname = normalizeHostname2(value.resourceHost);
    const strategyId = normalizeStrategyId(value.strategyId);
    const outcome = ["success", "rejected", "error"].includes(value.outcome) ? value.outcome : null;
    if (!hostname || !strategyId || !outcome) return { status: "ignored" };
    const snapshot = await chrome.storage.local.get(STORAGE_KEY);
    const memory = normalizeMemory(snapshot[STORAGE_KEY]);
    const host = memory[hostname] || { updatedAt: 0, strategies: {} };
    const current = host.strategies[strategyId] || {
      score: 0,
      successes: 0,
      failures: 0,
      lastOutcome: null
    };
    if (outcome === "success") {
      current.successes += 1;
      current.score = Math.min(10, current.score + 2);
    } else {
      current.failures += 1;
      current.score = Math.max(
        -5,
        current.score - (outcome === "rejected" ? 0.5 : 1)
      );
    }
    current.lastOutcome = outcome;
    current.updatedAt = Date.now();
    host.updatedAt = current.updatedAt;
    host.strategies[strategyId] = current;
    host.strategies = Object.fromEntries(
      Object.entries(host.strategies).sort(([, left], [, right]) => right.updatedAt - left.updatedAt).slice(0, MAX_STRATEGIES_PER_HOST)
    );
    memory[hostname] = host;
    const bounded = Object.fromEntries(
      Object.entries(memory).sort(([, left], [, right]) => right.updatedAt - left.updatedAt).slice(0, MAX_HOSTS)
    );
    await chrome.storage.local.set({
      [STORAGE_KEY]: { version: MEMORY_VERSION, hosts: bounded }
    });
    return { status: "recorded" };
  }
  async function getMediaAccessStrategyPreferences() {
    const snapshot = await chrome.storage.local.get(STORAGE_KEY);
    const memory = normalizeMemory(snapshot[STORAGE_KEY]);
    return Object.fromEntries(
      Object.entries(memory).map(([hostname, host]) => [
        hostname,
        Object.fromEntries(
          Object.entries(host.strategies).map(([strategyId, facts]) => [
            strategyId,
            Number(facts.score) || 0
          ])
        )
      ])
    );
  }
  function normalizeMemory(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const rawHosts = value.version === MEMORY_VERSION ? value.hosts : value;
    if (!rawHosts || typeof rawHosts !== "object" || Array.isArray(rawHosts)) {
      return {};
    }
    const memory = {};
    for (const [hostname, rawHost] of Object.entries(rawHosts).slice(
      0,
      MAX_HOSTS
    )) {
      const normalizedHost = normalizeHostname2(hostname);
      if (!normalizedHost || !rawHost || typeof rawHost !== "object") continue;
      const strategies = {};
      for (const [strategyId, rawFacts] of Object.entries(
        rawHost.strategies || {}
      ).slice(0, MAX_STRATEGIES_PER_HOST)) {
        const normalizedId = normalizeStrategyId(strategyId);
        if (!normalizedId || !rawFacts || typeof rawFacts !== "object") continue;
        strategies[normalizedId] = {
          score: Math.max(-5, Math.min(10, Number(rawFacts.score) || 0)),
          successes: Math.max(0, Number(rawFacts.successes) || 0),
          failures: Math.max(0, Number(rawFacts.failures) || 0),
          lastOutcome: String(rawFacts.lastOutcome || "").slice(0, 20),
          updatedAt: Math.max(0, Number(rawFacts.updatedAt) || 0)
        };
      }
      memory[normalizedHost] = {
        updatedAt: Math.max(0, Number(rawHost.updatedAt) || 0),
        strategies
      };
    }
    return memory;
  }
  function normalizeHostname2(value) {
    const hostname = String(value || "").toLowerCase();
    return /^[a-z0-9.-]{1,253}$/.test(hostname) ? hostname : null;
  }
  function normalizeStrategyId(value) {
    const strategyId = String(value || "");
    return /^[a-z0-9_]{1,64}$/.test(strategyId) && isRegisteredMediaAccessStrategy(strategyId) ? strategyId : null;
  }

  // src/background/media-helper-bridge.js
  var DEFAULT_TIMEOUT_MS = 8e3;
  var STATUS_CACHE_MS = 15e3;
  var FAILED_STATUS_CACHE_MS = 2e3;
  var YOUTUBE_QUALITY_PREFLIGHT_CACHE_MS = 2 * 60 * 1e3;
  var cachedStatus = null;
  var cachedAt = 0;
  var statusPromise = null;
  var activePorts = /* @__PURE__ */ new Map();
  var downloadEta = createDownloadEtaEstimator();
  var historyWriteChain = Promise.resolve();
  var youtubeQualityPreflightCache = /* @__PURE__ */ new Map();
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
        canAcquireHlsInParallel: capabilities[MEDIA_HELPER_CAPABILITIES.HLS_PARALLEL_ACQUISITION] === true,
        canDownloadDecryptedHls: capabilities[MEDIA_HELPER_CAPABILITIES.HLS_DECRYPTED_MANIFEST] === true,
        canSelectContainer: capabilities[MEDIA_HELPER_CAPABILITIES.OUTPUT_CONTAINER_SELECTION] === true,
        canDownloadDash: capabilities[MEDIA_HELPER_CAPABILITIES.DASH_VOD_DOWNLOAD] === true,
        canDownloadAdaptive: capabilities[MEDIA_HELPER_CAPABILITIES.ADAPTIVE_HTTP_DOWNLOAD] === true,
        canResolveYouTubePlayerJs: capabilities[MEDIA_HELPER_CAPABILITIES.YOUTUBE_PLAYER_JS_RESOLUTION] === true,
        canResolveYouTubeProviderFormats: capabilities[MEDIA_HELPER_CAPABILITIES.YOUTUBE_PROVIDER_FORMAT_RESOLUTION] === true,
        canResolveYouTubeQualityPreflight: capabilities[MEDIA_HELPER_CAPABILITIES.YOUTUBE_QUALITY_PREFLIGHT] === true,
        canValidatePlayerOutput: capabilities[MEDIA_HELPER_CAPABILITIES.PLAYER_OUTPUT_CANARY] === true,
        canCapturePlayerOutput: capabilities[MEDIA_HELPER_CAPABILITIES.PLAYER_OUTPUT_CAPTURE] === true,
        canMuxWithFfmpeg: capabilities[MEDIA_HELPER_CAPABILITIES.FFMPEG_MUX] === true,
        canCheckOutput: capabilities[MEDIA_HELPER_CAPABILITIES.OUTPUT_STAT] === true
      });
    } catch (error) {
      const message = messageOf(error);
      return helperStatus(classifyNativeMessagingError(message), {
        error: message
      });
    }
  }
  async function validateMediaHelperPlayerOutputCanary(canary) {
    if (!await hasNativeMessagingPermission()) {
      return {
        status: "permission_required",
        reason: "Native Messaging permission is required."
      };
    }
    const helper = await getMediaHelperStatus();
    if (helper.status !== MEDIA_HELPER_STATES.READY) {
      return {
        status: "helper_unavailable",
        reason: helper.error || "Media Helper is unavailable."
      };
    }
    if (!helper.canValidatePlayerOutput) {
      return {
        status: "helper_update",
        reason: "Update Media Helper to validate player output."
      };
    }
    const requestId = randomId4();
    try {
      const response = normalizeHelperEvent(
        await withTimeout(
          chrome.runtime.sendNativeMessage(MEDIA_HELPER_HOST_NAME, {
            type: MEDIA_HELPER_REQUESTS.PLAYER_OUTPUT_CANARY,
            requestId,
            protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
            payload: canary
          }),
          2e4
        )
      );
      if (response.requestId !== requestId || response.type !== MEDIA_HELPER_EVENTS.PLAYER_OUTPUT_CANARY) {
        throw new Error("Media Helper returned an invalid player-output check.");
      }
      return normalizePlayerOutputCanaryResult(response.payload);
    } catch (error) {
      return { status: "unavailable", reason: messageOf(error), tracks: [] };
    }
  }
  function normalizePlayerOutputCanaryResult(payload) {
    const tracks = Array.isArray(payload?.tracks) ? payload.tracks.slice(0, 4).map((track) => ({
      id: stringOrNull(track?.id),
      format: stringOrNull(track?.format),
      capturedBytes: Math.max(0, Number(track?.capturedBytes) || 0),
      status: track?.status === "recognized" ? "recognized" : "unrecognized",
      streamTypes: Array.isArray(track?.streamTypes) ? track.streamTypes.filter(
        (value) => ["video", "audio"].includes(value)
      ) : [],
      codecs: Array.isArray(track?.codecs) ? track.codecs.filter((value) => typeof value === "string").slice(0, 8) : [],
      startTimes: Array.isArray(track?.startTimes) ? track.startTimes.filter((value) => typeof value === "string").slice(0, 8) : [],
      diagnostic: stringOrNull(track?.diagnostic)
    })) : [];
    return {
      status: payload?.status === "ready" ? "ready" : "unrecognized",
      hasVideo: payload?.hasVideo === true,
      hasAudio: payload?.hasAudio === true,
      timeline: normalizePlayerOutputTimeline(payload?.timeline),
      tracks,
      reason: stringOrNull(payload?.reason)
    };
  }
  function normalizePlayerOutputTimeline(value) {
    const status = ["aligned", "misaligned", "unknown"].includes(value?.status) ? value.status : "unknown";
    return {
      status,
      videoStart: value?.videoStart !== null && Number.isFinite(Number(value?.videoStart)) ? Number(value.videoStart) : null,
      audioStart: value?.audioStart !== null && Number.isFinite(Number(value?.audioStart)) ? Number(value.audioStart) : null,
      deltaSeconds: value?.deltaSeconds !== null && Number.isFinite(Number(value?.deltaSeconds)) ? Math.max(0, Number(value.deltaSeconds)) : null
    };
  }
  async function startMediaHelperDownload(rawJob, {
    connections = 8,
    attempt = 1,
    downloadIdentity = null,
    downloadSummary = null
  } = {}) {
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
    const accessStrategyPreferences = await getMediaAccessStrategyPreferences().catch(() => ({}));
    const port = chrome.runtime.connectNative(MEDIA_HELPER_HOST_NAME);
    const state = {
      id: job.id,
      mediaId: job.candidate.id,
      kind: job.candidate.kind,
      title: job.candidate.title,
      output: job.output,
      downloadIdentity: normalizeDownloadIdentity(downloadIdentity),
      downloadSummary,
      sourceTabId: job.sourceTabId,
      candidate: withoutSensitiveHandoffs(job.candidate),
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
        output: job.output,
        browserUserAgent: globalThis.navigator?.userAgent || null,
        accessStrategyPreferences,
        candidate: job.candidate
      }
    });
    return { status: "started", jobId: job.id };
  }
  async function startMediaHelperPlayerOutputCapture({
    jobId,
    mediaId,
    title,
    duration,
    sourceTabId,
    sourceFrameId,
    outputDirectory = null
  }) {
    if (!await hasNativeMessagingPermission()) {
      throw new Error("Native Messaging permission is required.");
    }
    const previousConnection = activePorts.get(jobId);
    if (previousConnection && !previousConnection.terminal)
      throw new Error("Player output capture is already active.");
    const requestId = randomId4();
    const port = chrome.runtime.connectNative(MEDIA_HELPER_HOST_NAME);
    const state = {
      id: jobId,
      mediaId,
      kind: "player_output",
      title: title || "Player output video",
      output: { profileId: "video-mp4", container: "mp4" },
      sourceTabId,
      sourceFrameId,
      candidate: { id: mediaId, kind: "player_output" },
      connections: 1,
      attempt: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "starting",
      progress: {
        phase: "starting",
        stage: "player_output_capture",
        downloadedBytes: 0,
        totalBytes: null,
        bytesPerSecond: 0,
        processedSeconds: 0,
        duration: Number.isFinite(Number(duration)) ? Number(duration) : null,
        resumable: false
      },
      outputPath: null,
      error: null
    };
    await removeHistoryEntry(jobId);
    const connection = {
      port,
      requestId,
      terminal: false,
      terminalStatus: "cancelled",
      queue: Promise.resolve(),
      capture: true,
      sourceTabId,
      sourceFrameId,
      pendingChunkAcks: /* @__PURE__ */ new Map()
    };
    activePorts.set(jobId, connection);
    await persistJobState(state);
    port.onMessage.addListener((rawEvent) => {
      if (activePorts.get(jobId) !== connection) return;
      connection.queue = connection.queue.then(
        () => handleJobEvent(jobId, requestId, rawEvent)
      );
    });
    port.onDisconnect.addListener(() => {
      if (activePorts.get(jobId) !== connection) return;
      const message = chrome.runtime.lastError?.message || "Media Helper disconnected.";
      rejectPendingCaptureAcks(connection, new Error(message));
      void connection.queue.finally(async () => {
        activePorts.delete(jobId);
        if (!connection.terminal)
          await updateJobState(jobId, { status: "failed", error: message });
      }).catch(() => {
      });
    });
    port.postMessage({
      type: MEDIA_HELPER_REQUESTS.PLAYER_OUTPUT_CAPTURE_START,
      requestId,
      protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
      payload: { jobId, mediaId, title, duration, outputDirectory }
    });
    return { status: "started", jobId };
  }
  async function appendMediaHelperPlayerOutputChunk(jobId, chunk, sourceTabId, sourceFrameId) {
    const connection = activePorts.get(jobId);
    if (!connection?.capture || connection.terminal)
      return { status: "capture_not_running" };
    if (connection.sourceTabId !== sourceTabId)
      return { status: "source_tab_mismatch" };
    if (connection.sourceFrameId !== sourceFrameId)
      return { status: "source_frame_mismatch" };
    const ackKey = `${chunk.trackId}:${chunk.sequence}`;
    if (connection.pendingChunkAcks.has(ackKey))
      return { status: "duplicate_chunk" };
    const ack = new Promise((resolve, reject) => {
      connection.pendingChunkAcks.set(ackKey, { resolve, reject });
    });
    connection.port.postMessage({
      type: MEDIA_HELPER_REQUESTS.PLAYER_OUTPUT_CAPTURE_CHUNK,
      requestId: connection.requestId,
      protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
      payload: { jobId, ...chunk }
    });
    try {
      await withTimeout(ack, 2e4);
      return {
        status: "accepted",
        trackId: chunk.trackId,
        sequence: chunk.sequence
      };
    } catch (error) {
      connection.pendingChunkAcks.delete(ackKey);
      throw error;
    }
  }
  async function finishMediaHelperPlayerOutputCapture(jobId, sourceTabId, sourceFrameId) {
    const connection = activePorts.get(jobId);
    if (!connection?.capture || connection.terminal)
      return { status: "capture_not_running" };
    if (connection.sourceTabId !== sourceTabId)
      return { status: "source_tab_mismatch" };
    if (connection.sourceFrameId !== sourceFrameId)
      return { status: "source_frame_mismatch" };
    connection.port.postMessage({
      type: MEDIA_HELPER_REQUESTS.PLAYER_OUTPUT_CAPTURE_FINISH,
      requestId: connection.requestId,
      protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
      payload: { jobId }
    });
    await updateJobState(jobId, {
      status: "finalizing",
      progress: {
        ...await readStoredProgress(jobId),
        phase: "finalizing",
        stage: "player_output_probe"
      }
    });
    return { status: "finalizing", jobId };
  }
  async function failMediaHelperPlayerOutputCapture(jobId, error, sourceTabId, sourceFrameId) {
    const connection = activePorts.get(jobId);
    if (!connection?.capture) return { status: "capture_not_running" };
    if (connection.sourceTabId !== sourceTabId)
      return { status: "source_tab_mismatch" };
    if (connection.sourceFrameId !== sourceFrameId)
      return { status: "source_frame_mismatch" };
    connection.terminal = true;
    connection.terminalStatus = "failed";
    rejectPendingCaptureAcks(connection, new Error(error || "Capture failed."));
    connection.port.postMessage({
      type: MEDIA_HELPER_REQUESTS.PLAYER_OUTPUT_CAPTURE_CANCEL,
      requestId: connection.requestId,
      protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
      payload: { jobId }
    });
    await updateJobState(jobId, {
      status: "failed",
      error: error || "Player output capture failed."
    });
    return { status: "failed", jobId };
  }
  async function preflightMediaHelperYouTubeQualities(candidate) {
    if (candidate?.kind !== "adaptive" || candidate?.provider !== "youtube") {
      return {
        status: "not_required",
        videoOptions: [],
        audioOption: null,
        audioOptions: [],
        reason: null
      };
    }
    const cacheKey = youtubeQualityPreflightKey(candidate);
    const cached = youtubeQualityPreflightCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const helper = await getMediaHelperStatus();
    if (helper.status !== MEDIA_HELPER_STATES.READY) {
      return {
        status: "helper_unavailable",
        videoOptions: [],
        audioOption: null,
        audioOptions: [],
        reason: helper.error || "Media Helper is unavailable."
      };
    }
    if (helper.capabilities?.[MEDIA_HELPER_CAPABILITIES.YOUTUBE_QUALITY_PREFLIGHT] !== true) {
      return {
        status: "helper_update",
        videoOptions: [],
        audioOption: null,
        audioOptions: [],
        reason: "Update Media Helper to check YouTube quality compatibility."
      };
    }
    const requestId = randomId4();
    try {
      const response = normalizeHelperEvent(
        await withTimeout(
          chrome.runtime.sendNativeMessage(MEDIA_HELPER_HOST_NAME, {
            type: MEDIA_HELPER_REQUESTS.YOUTUBE_QUALITY_PREFLIGHT,
            requestId,
            protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
            payload: { candidate }
          }),
          2e4
        )
      );
      if (response.requestId !== requestId || response.type !== MEDIA_HELPER_EVENTS.YOUTUBE_QUALITY_PREFLIGHT) {
        throw new Error(
          "Media Helper returned an invalid YouTube quality check."
        );
      }
      const value = normalizeYouTubeQualityPreflight(response.payload);
      youtubeQualityPreflightCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + YOUTUBE_QUALITY_PREFLIGHT_CACHE_MS
      });
      while (youtubeQualityPreflightCache.size > 30)
        youtubeQualityPreflightCache.delete(
          youtubeQualityPreflightCache.keys().next().value
        );
      return value;
    } catch (error) {
      return {
        status: "unavailable",
        videoOptions: [],
        audioOption: null,
        audioOptions: [],
        reason: messageOf(error)
      };
    }
  }
  function youtubeQualityPreflightKey(candidate) {
    const video = [...candidate.variants || []].map((track) => `${track?.id || ""}:${track?.itag || ""}`).join(",");
    const audio = [...candidate.audioTracks || []].map((track) => `${track?.id || ""}:${track?.itag || ""}`).join(",");
    return `${candidate.id}|${candidate.pageUrl}|${video}|${audio}`;
  }
  function normalizeYouTubeQualityPreflight(payload) {
    const videoOptions = Array.isArray(payload?.videoOptions) ? payload.videoOptions.filter(
      (item) => item && typeof item.id === "string" && ["exact", "equivalent"].includes(item.availability) && typeof item.sourceLabel === "string"
    ).slice(0, 24).map((item) => ({
      id: item.id,
      availability: item.availability,
      sourceLabel: item.sourceLabel.slice(0, 120)
    })) : [];
    const audioOption = payload?.audioOption && typeof payload.audioOption.id === "string" ? {
      id: payload.audioOption.id,
      sourceLabel: typeof payload.audioOption.sourceLabel === "string" ? payload.audioOption.sourceLabel.slice(0, 120) : "Audio source"
    } : null;
    const audioOptions = Array.isArray(payload?.audioOptions) ? payload.audioOptions.filter(
      (item) => item && typeof item.id === "string" && typeof item.sourceLabel === "string"
    ).slice(0, 24).map((item) => ({
      id: item.id,
      sourceLabel: item.sourceLabel.slice(0, 160),
      language: typeof item.language === "string" ? item.language.slice(0, 40) : null,
      role: [
        "original",
        "dubbed",
        "auto_dubbed",
        "descriptive",
        "secondary"
      ].includes(item.role) ? item.role : null,
      isDefault: item.isDefault === true
    })) : audioOption ? [{ ...audioOption, language: null, role: null, isDefault: false }] : [];
    return {
      status: payload?.status === "ready" ? "ready" : "unavailable",
      videoOptions,
      audioOption,
      audioOptions,
      reason: typeof payload?.reason === "string" ? payload.reason.slice(0, 500) : null
    };
  }
  function withoutSensitiveHandoffs(candidate) {
    const { keyHandoff: _keyHandoff, ...publicCandidate } = candidate;
    const sanitizedCandidate = publicCandidate.provider === "youtube" ? {
      ...publicCandidate,
      variants: (publicCandidate.variants || []).map(
        withoutYouTubeSessionData
      ),
      audioTracks: (publicCandidate.audioTracks || []).map(
        withoutYouTubeSessionData
      )
    } : publicCandidate;
    if (!sanitizedCandidate.manifestHandoff) return sanitizedCandidate;
    const { body: _body, ...manifestHandoff } = sanitizedCandidate.manifestHandoff;
    return { ...sanitizedCandidate, manifestHandoff };
  }
  function withoutYouTubeSessionData(track) {
    const {
      sourceUrl: _sourceUrl,
      requestCpn: _requestCpn,
      signatureCipher: _signatureCipher,
      ...publicTrack
    } = track;
    return {
      ...publicTrack,
      sourceUrl: null,
      requestCpn: null,
      signatureCipher: null,
      urlResolution: track.urlResolution === "resolved" ? "provider_client_pending" : track.urlResolution
    };
  }
  async function cancelMediaHelperDownload(jobId, { terminalStatus = "cancelled" } = {}) {
    const connection = activePorts.get(jobId);
    if (!connection) return { status: "not_running" };
    connection.terminalStatus = terminalStatus === "paused" ? "paused" : "cancelled";
    connection.port.postMessage({
      type: connection.capture ? MEDIA_HELPER_REQUESTS.PLAYER_OUTPUT_CAPTURE_CANCEL : MEDIA_HELPER_REQUESTS.DOWNLOAD_CANCEL,
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
  async function inspectMediaHelperOutput(outputPath) {
    const helper = await getMediaHelperStatus();
    if (helper.status !== "ready" || !helper.canCheckOutput)
      return { status: "unchecked", size: null };
    const requestId = randomId4();
    const response = normalizeHelperEvent(
      await withTimeout(
        chrome.runtime.sendNativeMessage(MEDIA_HELPER_HOST_NAME, {
          type: MEDIA_HELPER_REQUESTS.OUTPUT_STAT,
          requestId,
          protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
          payload: { outputPath }
        }),
        DEFAULT_TIMEOUT_MS
      )
    );
    if (response.requestId !== requestId || response.type !== MEDIA_HELPER_EVENTS.OUTPUT_STAT)
      throw new Error("Could not check the downloaded file.");
    return {
      status: ["available", "missing"].includes(response.payload.status) ? response.payload.status : "unchecked",
      size: Number.isSafeInteger(response.payload.size) ? response.payload.size : null
    };
  }
  async function handleJobEvent(jobId, requestId, rawEvent) {
    try {
      const event2 = normalizeHelperEvent(rawEvent);
      if (event2.requestId !== requestId) return;
      if (event2.type === MEDIA_HELPER_EVENTS.DOWNLOAD_STARTED) {
        await updateJobState(jobId, { status: "probing" });
        return;
      }
      if (event2.type === MEDIA_HELPER_EVENTS.PLAYER_OUTPUT_CHUNK_ACCEPTED) {
        const connection = activePorts.get(jobId);
        const ackKey = `${event2.payload.trackId}:${event2.payload.sequence}`;
        const pending = connection?.pendingChunkAcks?.get(ackKey);
        if (pending) {
          connection.pendingChunkAcks.delete(ackKey);
          pending.resolve(event2.payload);
        }
        await updateJobState(jobId, {
          status: "downloading",
          progress: { ...event2.payload }
        });
        return;
      }
      if (event2.type === MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS) {
        await updateJobState(jobId, {
          status: event2.payload.phase || "downloading",
          progress: { ...event2.payload }
        });
        return;
      }
      if (event2.type === MEDIA_HELPER_EVENTS.ACCESS_STRATEGY_RESULT) {
        await recordMediaAccessStrategyResult(event2.payload);
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
        if (activePorts.get(jobId)?.terminalStatus === "failed") {
          markTerminal(jobId);
          activePorts.get(jobId)?.port.disconnect();
          return;
        }
        const terminalStatus = activePorts.get(jobId)?.terminalStatus === "paused" ? "paused" : "cancelled";
        markTerminal(jobId);
        await updateJobState(jobId, { status: terminalStatus });
        activePorts.get(jobId)?.port.disconnect();
        return;
      }
      if (event2.type === MEDIA_HELPER_EVENTS.ERROR) {
        rejectPendingCaptureAcks(
          activePorts.get(jobId),
          new Error(event2.payload.message || "Media Helper capture failed.")
        );
        markTerminal(jobId);
        const message = await appendStoredKeyCaptureDiagnostic(
          jobId,
          event2.payload.message || "Media Helper download failed."
        );
        await updateJobState(jobId, {
          status: "failed",
          error: message
        });
        activePorts.get(jobId)?.port.disconnect();
      }
    } catch (error) {
      markTerminal(jobId);
      await updateJobState(jobId, { status: "failed", error: messageOf(error) });
      activePorts.get(jobId)?.port.disconnect();
    }
  }
  function rejectPendingCaptureAcks(connection, error) {
    if (!connection?.pendingChunkAcks) return;
    for (const pending of connection.pendingChunkAcks.values())
      pending.reject(error);
    connection.pendingChunkAcks.clear();
  }
  async function readStoredProgress(jobId) {
    const key = downloadJobKey(jobId);
    return (await chrome.storage.session.get(key))[key]?.progress || {};
  }
  async function appendStoredKeyCaptureDiagnostic(jobId, message) {
    if (!/no captured browser key was available/i.test(message) || /Browser capture:/i.test(message)) {
      return message;
    }
    const key = downloadJobKey(jobId);
    const state = (await chrome.storage.session.get(key))[key];
    const detail = formatAesKeyHandoffDiagnostic(
      state?.candidate?.keyHandoffDiagnostic
    );
    return detail ? `${message}${detail}` : `${message} Browser capture diagnostics were unavailable before the Helper started.`;
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
    if (changes.progress)
      next.progress = {
        ...changes.progress,
        ...downloadEta.update(jobId, changes.progress, next.status)
      };
    else if (next.status !== "downloading") {
      downloadEta.forget(jobId);
      if (next.progress)
        next.progress = { ...next.progress, etaSeconds: null, etaUpdatedAt: null };
    }
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
      sourceFrameId: state.sourceFrameId,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      status: state.status,
      progress: state.progress ? { ...state.progress } : null,
      outputPath: state.outputPath,
      error: state.error,
      connections: state.connections,
      attempt: state.attempt,
      output: state.output,
      downloadIdentity: normalizeDownloadIdentity(state.downloadIdentity),
      downloadSummary: state.downloadSummary || null
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
      canAcquireHlsInParallel: false,
      canDownloadDecryptedHls: false,
      canSelectContainer: false,
      canDownloadDash: false,
      canDownloadAdaptive: false,
      canResolveYouTubePlayerJs: false,
      canResolveYouTubeProviderFormats: false,
      canResolveYouTubeQualityPreflight: false,
      canMuxWithFfmpeg: false,
      canCheckOutput: false,
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
      const segmentBitrates = [];
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
            encryptionKeyFormats.add(normalizeHlsKeyFormat(attributes.KEYFORMAT));
          continue;
        }
        if (line.startsWith("#EXTINF:")) {
          const value = Number(valueAfterColon(line).split(",", 1)[0]);
          pendingSegmentDuration = Number.isFinite(value) && value >= 0 ? value : 0;
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-BITRATE:")) {
          const kilobitsPerSecond = Number(valueAfterColon(line));
          if (Number.isFinite(kilobitsPerSecond) && kilobitsPerSecond > 0) {
            segmentBitrates.push(kilobitsPerSecond * 1e3);
          }
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
        bandwidth: playlistType === "media" && segmentBitrates.length ? Math.max(...segmentBitrates) : null,
        averageBandwidth: playlistType === "media" && segmentBitrates.length ? Math.round(
          segmentBitrates.reduce((total, value) => total + value, 0) / segmentBitrates.length
        ) : null,
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
    const bandwidth = optionalPositiveNumber2(attributes.BANDWIDTH);
    const averageBandwidth = optionalPositiveNumber2(
      attributes["AVERAGE-BANDWIDTH"]
    );
    return {
      id: stableVariantId(uri, bandwidth, attributes.RESOLUTION),
      url: resolveUrl(uri, manifestUrl),
      bandwidth,
      averageBandwidth,
      resolution: parseResolution(attributes.RESOLUTION),
      codecs: optionalText(attributes.CODECS),
      frameRate: optionalPositiveNumber2(attributes["FRAME-RATE"]),
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
  function optionalPositiveNumber2(value) {
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
    const width = positiveInteger2(representation.width || adaptation.width);
    const height = positiveInteger2(representation.height || adaptation.height);
    const bandwidth = positiveInteger2(representation.bandwidth);
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
  function positiveInteger2(value) {
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
    const result2 = storageOperation.then(operation, operation);
    storageOperation = result2.catch(() => {
    });
    return result2;
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

  // src/background/recent-downloads.js
  function createRecentDownloadService({
    listJobs,
    checkFile,
    now = () => Date.now()
  }) {
    const checks = /* @__PURE__ */ new Map();
    const operations = /* @__PURE__ */ new Map();
    const fileState = async (job, verify) => {
      if (job.status !== "completed") return "unchecked";
      if (!job.outputPath) return "missing";
      const key = `${job.id}|${job.outputPath}|${job.updatedAt}`;
      const cached = checks.get(key);
      if (!verify) return cached?.expiresAt > now() ? cached.status : "unchecked";
      let status;
      try {
        const result2 = await checkFile(job.outputPath);
        status = result2?.status || "unchecked";
        const expectedSize = job.progress?.totalBytes;
        if (status === "available" && expectedSize > 0 && result2.size !== expectedSize)
          status = "changed";
      } catch {
        status = "unchecked";
      }
      checks.set(key, { status, expiresAt: now() + 6e4 });
      while (checks.size > 128) checks.delete(checks.keys().next().value);
      return status;
    };
    const lookup = async (candidate, output, { verifyFile = false } = {}) => {
      const identity = await buildMediaDownloadIdentity(candidate, output);
      const jobs = await listJobs();
      const compatible = await Promise.all(
        jobs.map(async (job) => {
          if (job.downloadIdentity || !job.candidate || !job.output) return job;
          try {
            return {
              ...job,
              downloadIdentity: await buildMediaDownloadIdentity(
                job.candidate,
                job.output
              ),
              downloadSummary: buildMediaDownloadSummary(
                job.candidate,
                job.output
              )
            };
          } catch {
            return job;
          }
        })
      );
      const exact = findRelatedDownloadJobs(compatible, identity, { now: now() })[0] || null;
      const related = findRelatedDownloadJobs(compatible, identity, {
        exact: false,
        now: now()
      }).slice(0, 5);
      const selected = related[0] || null;
      const states = new Map(
        await Promise.all(
          [...new Set([exact, selected].filter(Boolean))].map(async (job) => [
            job.id,
            await fileState(job, verifyFile)
          ])
        )
      );
      return {
        status: "ok",
        identity,
        exactJob: exact ? presentDownloadJob(exact, states.get(exact.id)) : null,
        latestJob: selected ? presentDownloadJob(selected, states.get(selected.id)) : null,
        relatedCount: related.length
      };
    };
    const duplicate = async (candidate, output, repeatOf = null) => {
      const result2 = await lookup(candidate, output, { verifyFile: true });
      const job = result2.exactJob;
      if (!job) return null;
      if (isMediaJobActive(job)) return { status: "already_downloading", job };
      if (["missing", "changed"].includes(job.fileStatus) || job.id === repeatOf)
        return null;
      return { status: "already_downloaded", job };
    };
    const withRequestLock = async (key, run) => {
      const previous = operations.get(key) || Promise.resolve();
      const operation = previous.catch(() => {
      }).then(run);
      operations.set(key, operation);
      try {
        return await operation;
      } finally {
        if (operations.get(key) === operation) operations.delete(key);
      }
    };
    return { lookup, duplicate, withRequestLock, clear: () => checks.clear() };
  }

  // src/background/media-download-jobs.js
  var broker = null;
  var recentDownloads = createRecentDownloadService({
    listJobs: listMediaHelperDownloads,
    checkFile: inspectMediaHelperOutput
  });
  async function startMediaDownloadJobStore(policy) {
    await removeStaleJobs();
    broker = createActionBroker({
      featureId: "background.media-download-jobs",
      policy,
      handlers: {
        [ACTIONS.MEDIA_DOWNLOAD_CANCEL]: cancelJob,
        [ACTIONS.MEDIA_DOWNLOAD_CLEAR_HISTORY]: clearJobHistory,
        [ACTIONS.MEDIA_DOWNLOAD_CREATE]: createJob,
        [ACTIONS.MEDIA_DOWNLOAD_PREFLIGHT]: preflightJob,
        [ACTIONS.MEDIA_DOWNLOAD_LOOKUP]: lookupDownload,
        [ACTIONS.MEDIA_OUTPUT_CANARY]: validatePlayerOutput,
        [ACTIONS.MEDIA_OUTPUT_CAPTURE_START]: startPlayerOutputCapture,
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
      recentDownloads.clear();
    };
  }
  async function requestMediaDownloadJob(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_CREATE, payload);
  }
  async function requestMediaDownloadQualityPreflight(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_PREFLIGHT, payload);
  }
  async function requestMediaDownloadContext(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_DOWNLOAD_LOOKUP, payload);
  }
  async function lookupDownload({
    tabId,
    mediaId,
    output,
    verifyFile = false
  } = {}) {
    if (!Number.isInteger(tabId) || typeof mediaId !== "string")
      return { status: "invalid_media" };
    const catalog2 = await listDiscoveredMedia(tabId);
    const candidate = findDownloadCandidate(catalog2.items, mediaId);
    if (!candidate) return { status: "media_not_found" };
    return recentDownloads.lookup(candidate, output, { verifyFile });
  }
  async function requestPlayerOutputCanary(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_OUTPUT_CANARY, payload);
  }
  async function requestPlayerOutputCapture(payload) {
    if (!broker) return { status: "download_disabled" };
    return broker.execute(ACTIONS.MEDIA_OUTPUT_CAPTURE_START, payload);
  }
  async function receivePlayerOutputCaptureChunk(payload, sender = {}) {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId ?? 0;
    if (!Number.isInteger(tabId)) return { status: "invalid_tab" };
    return appendMediaHelperPlayerOutputChunk(
      payload.captureId,
      {
        trackId: payload.trackId,
        sequence: payload.sequence,
        mimeType: payload.mimeType,
        appendFormat: payload.appendFormat,
        processedSeconds: payload.processedSeconds,
        duration: payload.duration,
        data: payload.data
      },
      tabId,
      frameId
    );
  }
  async function receivePlayerOutputCaptureFinish(payload, sender = {}) {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId ?? 0;
    if (!Number.isInteger(tabId)) return { status: "invalid_tab" };
    return finishMediaHelperPlayerOutputCapture(
      payload.captureId,
      tabId,
      frameId
    );
  }
  async function receivePlayerOutputCaptureFailure(payload, sender = {}) {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId ?? 0;
    if (!Number.isInteger(tabId)) return { status: "invalid_tab" };
    return failMediaHelperPlayerOutputCapture(
      payload.captureId,
      typeof payload.error === "string" ? payload.error.slice(0, 1e3) : null,
      tabId,
      frameId
    );
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
  async function validatePlayerOutput({ tabId, mediaId } = {}) {
    if (!Number.isInteger(tabId) || tabId < 0) return { status: "invalid_tab" };
    if (typeof mediaId !== "string" || !mediaId)
      return { status: "invalid_media" };
    const catalog2 = await listDiscoveredMedia(tabId);
    const candidate = findDownloadCandidate(catalog2.items || [], mediaId);
    if (!candidate) return { status: "media_not_found" };
    if (!isPlayerOutputCanaryEligible(candidate)) {
      return {
        status: "not_eligible",
        reason: "No custom-protected player output was detected for this item."
      };
    }
    let frames = [{ frameId: 0 }];
    try {
      frames = await chrome.webNavigation?.getAllFrames?.({ tabId }) || frames;
    } catch {
    }
    const responses = await Promise.all(
      frames.slice(0, 24).map(async ({ frameId }) => {
        try {
          return frameId === 0 ? await chrome.tabs.sendMessage(tabId, {
            type: "GET_PLAYER_OUTPUT_CANARY"
          }) : await chrome.tabs.sendMessage(
            tabId,
            { type: "GET_PLAYER_OUTPUT_CANARY" },
            { frameId }
          );
        } catch {
          return null;
        }
      })
    );
    const canary = responses.map((response) => response?.canary).filter((value) => value?.status === "ready" && value.tracks?.length).sort(
      (left, right) => (Number(right.capturedBytes) || 0) - (Number(left.capturedBytes) || 0)
    )[0];
    if (!canary) {
      return {
        status: "reload_required",
        reason: "No bounded player-output sample is available yet. Reload the page, play the video briefly, then test again."
      };
    }
    return validateMediaHelperPlayerOutputCanary(canary);
  }
  async function startPlayerOutputCapture({ tabId, mediaId } = {}) {
    if (!Number.isInteger(tabId) || tabId < 0) return { status: "invalid_tab" };
    if (typeof mediaId !== "string" || !mediaId)
      return { status: "invalid_media" };
    const catalog2 = await listDiscoveredMedia(tabId);
    const candidate = findDownloadCandidate(catalog2.items || [], mediaId);
    if (!candidate || !isPlayerOutputCanaryEligible(candidate)) {
      return {
        status: "not_eligible",
        reason: "No validated custom player output is available."
      };
    }
    const helper = await getMediaHelperStatus({ force: true });
    if (helper.status !== "ready" || !helper.canCapturePlayerOutput) {
      return {
        status: "helper_update",
        reason: "Media Helper 0.24.0 or newer is required for player capture."
      };
    }
    let frames = [{ frameId: 0 }];
    try {
      frames = await chrome.webNavigation?.getAllFrames?.({ tabId }) || frames;
    } catch {
    }
    const preferredFrameId = Number.isInteger(candidate.frameId) ? candidate.frameId : null;
    const frameIds = [...new Set(frames.map((frame) => frame.frameId))].sort(
      (left, right) => Number(right === preferredFrameId) - Number(left === preferredFrameId)
    );
    let sourceFrameId = null;
    for (const frameId of frameIds.slice(0, 24)) {
      try {
        const response = frameId === 0 ? await chrome.tabs.sendMessage(tabId, {
          type: "GET_PLAYER_OUTPUT_CANARY"
        }) : await chrome.tabs.sendMessage(
          tabId,
          { type: "GET_PLAYER_OUTPUT_CANARY" },
          { frameId }
        );
        if (response?.canary?.status === "ready" && response.canary.tracks?.length) {
          sourceFrameId = frameId;
          break;
        }
      } catch {
      }
    }
    if (!Number.isInteger(sourceFrameId)) {
      sourceFrameId = frameIds.includes(preferredFrameId) ? preferredFrameId : null;
    }
    if (!Number.isInteger(sourceFrameId)) {
      return {
        status: "reload_required",
        reason: "The player frame could not be identified for automatic reload capture."
      };
    }
    const jobId = randomId5();
    const stream = candidate.resolvedStream || candidate;
    const title = candidate.title || stream.title || "Player output video";
    await startMediaHelperPlayerOutputCapture({
      jobId,
      mediaId: candidate.id,
      title,
      duration: stream.duration,
      sourceTabId: tabId,
      sourceFrameId
    });
    let result2 = null;
    try {
      result2 = sourceFrameId === 0 ? await chrome.tabs.sendMessage(tabId, {
        type: "START_PLAYER_OUTPUT_CAPTURE",
        captureId: jobId
      }) : await chrome.tabs.sendMessage(
        tabId,
        { type: "START_PLAYER_OUTPUT_CAPTURE", captureId: jobId },
        { frameId: sourceFrameId }
      );
    } catch {
    }
    if (result2?.status === "reload_required") {
      let reloadResult = null;
      try {
        reloadResult = sourceFrameId === 0 ? await chrome.tabs.sendMessage(tabId, {
          type: "PREPARE_PLAYER_OUTPUT_CAPTURE_RELOAD",
          captureId: jobId
        }) : await chrome.tabs.sendMessage(
          tabId,
          {
            type: "PREPARE_PLAYER_OUTPUT_CAPTURE_RELOAD",
            captureId: jobId
          },
          { frameId: sourceFrameId }
        );
      } catch {
      }
      if (reloadResult?.status === "reloading") {
        return {
          status: "started",
          jobId,
          reloading: true,
          reason: "The player frame is reloading and capture is armed from its first output buffer."
        };
      }
      result2 = {
        status: "reload_unavailable",
        reason: reloadResult?.reason || "The player frame could not preserve capture across reload."
      };
    }
    if (result2?.status !== "started") {
      await failMediaHelperPlayerOutputCapture(
        jobId,
        result2?.reason || "Player output capture could not start in the media frame.",
        tabId,
        sourceFrameId
      );
      return result2 || {
        status: "capture_unavailable",
        reason: "The player frame did not expose a continuous start buffer."
      };
    }
    return { ...result2, jobId, status: "started" };
  }
  function isPlayerOutputCanaryEligible(candidate) {
    if (candidate?.kind !== "blob") return false;
    if (!candidate.blobTrace?.appendFormats?.length) return false;
    const stream = candidate.resolvedStream || candidate;
    if (candidate.eme?.confirmed === true || stream.drm === "confirmed")
      return false;
    return (stream.encryptionKeyFormats || []).some((format) => {
      const value = String(format || "").toLowerCase();
      return value && value !== "identity" && !value.includes("widevine") && !value.includes("playready") && !value.includes("fairplay");
    });
  }
  async function createJob({
    tabId,
    mediaId,
    connections,
    output,
    repeatOf = null
  } = {}) {
    if (!Number.isInteger(tabId) || tabId < 0) return { status: "invalid_tab" };
    if (typeof mediaId !== "string" || !mediaId)
      return { status: "invalid_media" };
    const response = await listDiscoveredMedia(tabId);
    let candidate = findDownloadCandidate(response.items, mediaId);
    if (!candidate) return { status: "media_not_found" };
    if (candidate.kind === "hls" && candidate.selectedMediaId) {
      candidate = response.items.find((item) => item.id === candidate.selectedMediaId) || candidate;
    }
    const normalizedOutput = normalizeMediaDownloadOutput(output, candidate);
    const downloadIdentity = await buildMediaDownloadIdentity(
      candidate,
      normalizedOutput
    );
    const downloadSummary = buildMediaDownloadSummary(
      candidate,
      normalizedOutput
    );
    return recentDownloads.withRequestLock(
      downloadIdentity.requestKey,
      async () => {
        const duplicate = await recentDownloads.duplicate(
          candidate,
          normalizedOutput,
          repeatOf
        );
        if (duplicate) return duplicate;
        candidate = await attachFreshYouTubeBrowserHandoff(tabId, candidate);
        const availability = getMediaDownloadAvailability(candidate);
        if (!availability.supported)
          return { status: "unsupported", reason: availability.reason };
        const qualityCheck = await normalizeYouTubeQualityCheck(
          candidate,
          normalizedOutput
        );
        if (qualityCheck.status !== "ready") return qualityCheck;
        const checkedOutput = qualityCheck.output;
        const helperFailure = await helperFailureFor(candidate, checkedOutput);
        if (helperFailure) return helperFailure;
        const handoffResult = await attachManifestHandoff(tabId, candidate);
        if (handoffResult.status !== "ready") return handoffResult;
        candidate = handoffResult.candidate;
        candidate = await attachAesKeyHandoff(tabId, candidate);
        const job = normalizeMediaDownloadJob({
          id: randomId5(),
          createdAt: Date.now(),
          sourceTabId: tabId,
          output: checkedOutput,
          candidate
        });
        const settings = await loadSettings();
        return startMediaHelperDownload(job, {
          downloadIdentity,
          downloadSummary,
          connections: normalizeMediaDownloadConnections(
            connections ?? settings.mediaDownloadConnections
          )
        });
      }
    );
  }
  async function preflightJob({ tabId, mediaId } = {}) {
    if (!Number.isInteger(tabId) || tabId < 0) return { status: "invalid_tab" };
    if (typeof mediaId !== "string" || !mediaId)
      return { status: "invalid_media" };
    const response = await listDiscoveredMedia(tabId);
    let candidate = findDownloadCandidate(response.items, mediaId);
    if (!candidate) return { status: "media_not_found" };
    candidate = await attachFreshYouTubeBrowserHandoff(tabId, candidate);
    return preflightMediaHelperYouTubeQualities(candidate);
  }
  async function normalizeYouTubeQualityCheck(candidate, output) {
    if (candidate.kind !== "adaptive" || candidate.provider !== "youtube" || !hasYouTubeProviderPendingTracks(candidate))
      return { status: "ready", output };
    const result2 = await preflightMediaHelperYouTubeQualities(candidate);
    if (result2.status !== "ready") {
      return {
        status: "quality_unavailable",
        reason: result2.reason || "No compatible YouTube quality is available through the current provider profile."
      };
    }
    if (output.profileId === "audio-ogg") {
      const selectedAudio = result2.audioOptions?.find((item) => item.id === output.audioTrackId) || result2.audioOption;
      if (!selectedAudio) {
        return {
          status: "quality_unavailable",
          reason: "No compatible YouTube audio track is available through the current provider profile."
        };
      }
      return {
        status: "ready",
        output: {
          ...output,
          audioTrackId: selectedAudio.id,
          allowEquivalentVideo: false
        }
      };
    }
    if (!result2.videoOptions.length) {
      return {
        status: "quality_unavailable",
        reason: "No downloadable YouTube video quality is available through the current provider profile."
      };
    }
    if (!output.videoTrackId) {
      return {
        status: "ready",
        output: {
          ...output,
          audioTrackId: result2.audioOptions?.some(
            (item) => item.id === output.audioTrackId
          ) ? output.audioTrackId : result2.audioOption?.id || null,
          allowEquivalentVideo: true
        }
      };
    }
    const option = result2.videoOptions.find(
      (item) => item.id === output.videoTrackId
    );
    if (!option) {
      return {
        status: "quality_unavailable",
        reason: "The selected YouTube quality is not available through the current provider profile."
      };
    }
    return {
      status: "ready",
      output: {
        ...output,
        audioTrackId: result2.audioOptions?.some(
          (item) => item.id === output.audioTrackId
        ) ? output.audioTrackId : result2.audioOption?.id || null,
        allowEquivalentVideo: option.availability === "equivalent"
      }
    };
  }
  async function cancelJob({ jobId } = {}) {
    if (typeof jobId !== "string" || !jobId) return { status: "invalid_job" };
    const state = await readJob(jobId);
    if (state?.kind === "player_output") {
      try {
        await chrome.tabs.sendMessage(
          state.sourceTabId,
          { type: "STOP_PLAYER_OUTPUT_CAPTURE", captureId: jobId },
          Number.isInteger(state.sourceFrameId) ? { frameId: state.sourceFrameId } : void 0
        );
      } catch {
      }
    }
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
    if (state.kind === "player_output") {
      return {
        status: "reload_required",
        reason: "Reload the video page and start a new player output capture."
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
    candidate = await attachFreshYouTubeBrowserHandoff(
      state.sourceTabId,
      candidate
    );
    const handoffResult = await attachManifestHandoff(
      state.sourceTabId,
      candidate
    );
    if (handoffResult.status !== "ready") return handoffResult;
    candidate = handoffResult.candidate;
    candidate = await attachAesKeyHandoff(state.sourceTabId, candidate);
    const helperFailure = await helperFailureFor(candidate, state.output);
    if (helperFailure) return helperFailure;
    const job = normalizeMediaDownloadJob({
      id: state.id,
      createdAt: Date.now(),
      sourceTabId: state.sourceTabId,
      output: state.output,
      candidate
    });
    const settings = await loadSettings();
    return startMediaHelperDownload(job, {
      connections: normalizeMediaDownloadConnections(
        requestedConnections ?? settings.mediaDownloadConnections
      ),
      attempt: Math.max(1, Number(state.attempt) || 1) + 1,
      downloadIdentity: state.downloadIdentity,
      downloadSummary: state.downloadSummary
    });
  }
  async function attachFreshYouTubeBrowserHandoff(tabId, candidate) {
    if (candidate?.kind !== "adaptive" || candidate?.provider !== "youtube" || !Number.isInteger(tabId))
      return candidate;
    let frames = [{ frameId: 0 }];
    try {
      frames = await chrome.webNavigation?.getAllFrames?.({ tabId }) || frames;
    } catch {
    }
    const responses = await Promise.all(
      frames.slice(0, 24).map(async ({ frameId }) => {
        try {
          return frameId === 0 ? await chrome.tabs.sendMessage(tabId, {
            type: "GET_YOUTUBE_MEDIA_HANDOFF"
          }) : await chrome.tabs.sendMessage(
            tabId,
            { type: "GET_YOUTUBE_MEDIA_HANDOFF" },
            { frameId }
          );
        } catch {
          return null;
        }
      })
    );
    const targetVideoId = youtubeVideoId(candidate.pageUrl);
    const fresh = responses.flatMap((response) => response?.handoff?.candidates || []).find(
      (item) => item?.kind === "adaptive" && item?.provider === "youtube" && (!targetVideoId || youtubeVideoId(item.pageUrl) === targetVideoId)
    );
    if (!fresh) return candidate;
    return {
      ...candidate,
      playerUrl: fresh.playerUrl || candidate.playerUrl,
      variants: mergeFreshTracks(candidate.variants, fresh.variants),
      audioTracks: mergeFreshTracks(candidate.audioTracks, fresh.audioTracks),
      acquisitionDiagnostic: fresh.acquisitionDiagnostic || candidate.acquisitionDiagnostic
    };
  }
  function mergeFreshTracks(existing = [], fresh = []) {
    const freshById = new Map(fresh.map((track) => [track.id, track]));
    const merged = existing.map((track) => ({
      ...track,
      ...freshById.get(track.id) || {}
    }));
    const known = new Set(merged.map((track) => track.id));
    merged.push(...fresh.filter((track) => !known.has(track.id)));
    return merged;
  }
  function youtubeVideoId(value) {
    try {
      const url = new URL(value || "");
      if (url.hostname === "youtu.be") return url.pathname.slice(1) || null;
      if (/(^|\.)youtube\.com$/i.test(url.hostname))
        return url.searchParams.get("v") || url.pathname.match(/^\/shorts\/([^/]+)/)?.[1] || null;
    } catch {
    }
    return null;
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
  async function attachAesKeyHandoff(tabId, candidate) {
    if (!shouldRequestAesKeyHandoff(candidate)) return candidate;
    try {
      const catalog2 = await listDiscoveredMedia(tabId);
      const targets = collectAesKeyHandoffTargets(candidate, catalog2.items || []);
      const message = {
        type: "GET_MEDIA_AES_KEY_HANDOFF",
        requestedManifestUrl: candidate.manifestUrl,
        manifestUrls: targets.manifestUrls
      };
      const keys = /* @__PURE__ */ new Map();
      const diagnostics = [];
      const responses = await Promise.all(
        targets.frameIds.map(async (frameId) => {
          try {
            return frameId === null ? await chrome.tabs.sendMessage(tabId, message) : await chrome.tabs.sendMessage(tabId, message, { frameId });
          } catch {
            return null;
          }
        })
      );
      for (const response of responses) {
        if (response?.status !== "ready" || response.requestedManifestUrl !== candidate.manifestUrl) {
          continue;
        }
        for (const key of response.keys || []) {
          if (key?.url) keys.set(key.url, key);
        }
        if (response.diagnostic) diagnostics.push(response.diagnostic);
      }
      const keyHandoffDiagnostic = aggregateAesKeyHandoffDiagnostics(
        targets,
        responses,
        diagnostics
      );
      if (!keys.size) return { ...candidate, keyHandoffDiagnostic };
      return {
        ...candidate,
        keyHandoffDiagnostic,
        keyHandoff: {
          kind: "hls_aes_keys",
          manifestUrl: candidate.manifestUrl,
          keys: [...keys.values()].slice(0, 16)
        }
      };
    } catch {
      return candidate;
    }
  }
  function shouldRequestAesKeyHandoff(candidate = {}) {
    return candidate.kind === "hls";
  }
  function aggregateAesKeyHandoffDiagnostics(targets, responses, diagnostics) {
    const sums = (field) => diagnostics.reduce((total, item) => total + (Number(item[field]) || 0), 0);
    return {
      framesQueried: targets.frameIds.length,
      framesResponded: responses.filter(Boolean).length,
      requestedManifestCount: diagnostics.length ? sums("requestedManifestCount") : targets.manifestUrls.length,
      matchedManifestCount: sums("matchedManifestCount"),
      relatedManifestCount: sums("relatedManifestCount"),
      relatedManifestBytes: sums("relatedManifestBytes"),
      childManifestCount: sums("childManifestCount"),
      keyDirectiveCount: sums("keyDirectiveCount"),
      unsupportedKeyDirectiveCount: sums("unsupportedKeyDirectiveCount"),
      segmentDirectiveCount: sums("segmentDirectiveCount"),
      encryptionMethods: [
        ...new Set(
          diagnostics.flatMap(
            (item) => Array.isArray(item.encryptionMethods) ? item.encryptionMethods : []
          )
        )
      ].slice(0, 8),
      encryptionKeyFormats: [
        ...new Set(
          diagnostics.flatMap(
            (item) => Array.isArray(item.encryptionKeyFormats) ? item.encryptionKeyFormats : []
          )
        )
      ].slice(0, 8),
      declaredKeyCount: sums("declaredKeyCount"),
      capturedKeyCount: sums("capturedKeyCount"),
      pageFetchAttemptCount: sums("pageFetchAttemptCount"),
      pageFetchSuccessCount: sums("pageFetchSuccessCount"),
      pageFetchStatuses: [
        ...new Set(
          diagnostics.flatMap(
            (item) => Array.isArray(item.pageFetchStatuses) ? item.pageFetchStatuses : []
          )
        )
      ].slice(0, 8),
      pageFetchErrorCount: sums("pageFetchErrorCount"),
      pageManifestFetchAttemptCount: sums("pageManifestFetchAttemptCount"),
      pageManifestFetchSuccessCount: sums("pageManifestFetchSuccessCount"),
      pageManifestFetchStatuses: [
        ...new Set(
          diagnostics.flatMap(
            (item) => Array.isArray(item.pageManifestFetchStatuses) ? item.pageManifestFetchStatuses : []
          )
        )
      ].slice(0, 8),
      pageManifestFetchErrorCount: sums("pageManifestFetchErrorCount")
    };
  }
  function collectAesKeyHandoffTargets(candidate, items = []) {
    const relatedIds = /* @__PURE__ */ new Set([
      candidate.id,
      candidate.selectedMediaId,
      ...candidate.parentManifestIds || [],
      ...candidate.childManifestIds || [],
      ...candidate.resolvedMediaIds || []
    ]);
    const related = [candidate];
    for (const item of items) {
      if (relatedIds.has(item.id) || (item.parentManifestIds || []).includes(candidate.id) || (item.childManifestIds || []).includes(candidate.id) || (item.resolvedMediaIds || []).includes(candidate.id)) {
        related.push(item);
      }
    }
    const manifestUrls = uniqueHttpUrls(
      related.flatMap((item) => [
        item.manifestUrl,
        item.resolvedStream?.manifestUrl,
        ...(item.variants || []).map((variant) => variant.url)
      ])
    ).slice(0, 16);
    const frameIds = [
      ...new Set(
        related.map((item) => item.frameId).filter((frameId) => Number.isInteger(frameId) && frameId >= 0)
      )
    ].slice(0, 8);
    return {
      manifestUrls,
      frameIds: frameIds.length ? frameIds : [null]
    };
  }
  function uniqueHttpUrls(values) {
    const urls = [];
    for (const value of values) {
      try {
        const url = new URL(value);
        if (["http:", "https:"].includes(url.protocol)) urls.push(url.href);
      } catch {
      }
    }
    return [...new Set(urls)];
  }
  async function recoverCandidate(state) {
    if (!Number.isInteger(state.sourceTabId) || !state.mediaId) return null;
    const response = await listDiscoveredMedia(state.sourceTabId);
    return findDownloadCandidate(response.items, state.mediaId);
  }
  function findDownloadCandidate(items, mediaId) {
    return items.find((item) => item.id === mediaId) || selectVisibleMediaItems(items, Number.MAX_SAFE_INTEGER).find(
      (item) => item.id === mediaId
    ) || null;
  }
  async function helperFailureFor(candidate, output) {
    const helper = await getMediaHelperStatus({ force: true });
    if (helper.status !== "ready") {
      return {
        status: "helper_required",
        helper,
        reason: "Media Helper must be installed and available to download video."
      };
    }
    if (output?.profileId !== "source" && output?.profileId !== "video-mp4") {
      if (!helper.canSelectContainer) {
        return {
          status: "helper_not_ready",
          helper,
          reason: "This Media Helper build cannot select a different output container yet."
        };
      }
    }
    if (candidate.kind === "adaptive" && candidate.acquisitionProfile === "youtube_player_js_challenge" && !helper.canResolveYouTubePlayerJs) {
      return {
        status: "helper_not_ready",
        helper,
        reason: "This Media Helper build cannot resolve YouTube Player JS challenges yet."
      };
    }
    if (candidate.kind === "adaptive" && hasYouTubeProviderPendingTracks(candidate) && !helper.canResolveYouTubeProviderFormats) {
      return {
        status: "helper_not_ready",
        helper,
        reason: "This Media Helper build cannot resolve YouTube adaptive quality tracks yet."
      };
    }
    const capabilityReady = candidate.kind === "direct" ? helper.canDownloadDirect : candidate.kind === "hls" ? candidate.probeSource === "decrypted_blob" ? helper.canDownloadHls && helper.canDownloadDecryptedHls : helper.canDownloadHls : candidate.kind === "dash" ? helper.canDownloadDash : helper.canDownloadAdaptive;
    if (capabilityReady) return null;
    return {
      status: "helper_not_ready",
      helper,
      reason: candidate.kind === "direct" ? "This Media Helper build cannot download direct media yet." : candidate.kind === "hls" ? candidate.probeSource === "decrypted_blob" ? "This Media Helper build cannot accept a player-decrypted HLS manifest yet." : "This Media Helper build does not execute HLS downloads yet." : candidate.kind === "dash" ? "This Media Helper build does not execute DASH downloads yet." : "This Media Helper build cannot mux resolved adaptive tracks yet."
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
    parentDocumentUrl,
    frameDocumentUrl
  }) {
    const ruleId = nextProbeRuleId();
    const rule = createMediaProbeRefererRule({
      ruleId,
      tabId,
      manifestUrl,
      parentDocumentUrl,
      frameDocumentUrl
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
    parentDocumentUrl,
    frameDocumentUrl = parentDocumentUrl
  }) {
    if (!Number.isInteger(ruleId) || ruleId <= 0)
      throw new TypeError("Media probe rule needs a positive integer ID.");
    if (!Number.isInteger(tabId) || tabId < 0)
      throw new TypeError("Media probe rule needs a valid tab ID.");
    const manifest = requiredHttpUrl3(manifestUrl, "manifestUrl");
    const parent = requiredHttpUrl3(parentDocumentUrl, "parentDocumentUrl");
    const frame = requiredHttpUrl3(frameDocumentUrl, "frameDocumentUrl");
    return {
      id: ruleId,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: parent.href },
          { header: "Origin", operation: "set", value: frame.origin }
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
  var CAPTURE_TTL_MS2 = 15 * 60 * 1e3;
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
      expiresAt: now + CAPTURE_TTL_MS2
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

  // src/media/player-download-target.js
  function resolvePlayerDownloadTarget({
    sourceUrl,
    pageUrl,
    frameId,
    items = []
  }) {
    if (!sourceUrl) return null;
    const scoped = items.filter((item) => item.frameId === frameId);
    const displayed = selectVisibleMediaItems(scoped, Infinity);
    const raw = scoped.find((item) => sameSource(item.sourceUrl, sourceUrl));
    let matches = displayed.filter(
      (item) => sameSource(item.sourceUrl, sourceUrl) || item.variants?.some((track) => sameSource(track.sourceUrl, sourceUrl))
    );
    if (!matches.length && raw?.kind === "blob") {
      const ids = new Set(
        [raw.selectedMediaId, ...raw.blobTrace?.candidateIds || []].filter(
          Boolean
        )
      );
      matches = displayed.filter(
        (item) => ids.has(item.id) || item.selectedMediaId && ids.has(item.selectedMediaId)
      );
      if (!matches.length) {
        try {
          const page = new URL(pageUrl);
          const id = page.searchParams.get("v") || page.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
          if (id && /(^|\.)youtube\.com$/.test(page.hostname)) {
            matches = displayed.filter(
              (item) => item.provider === "youtube" && item.id === stableMediaId("adaptive", `youtube:${id}`)
            );
          }
        } catch {
        }
      }
    }
    if (matches.length !== 1) return null;
    const presentation = matches[0];
    const candidate = scoped.find((item) => item.id === presentation.selectedMediaId) || presentation;
    if (!getMediaDownloadAvailability(candidate).supported) return null;
    return { presentation, candidate };
  }
  function sameSource(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    try {
      const normalize = (value) => {
        const url = new URL(value);
        for (const key of ["range", "bytestart", "byteend"])
          url.searchParams.delete(key);
        url.hash = "";
        url.searchParams.sort();
        return url.href;
      };
      return normalize(left) === normalize(right);
    } catch {
      return false;
    }
  }

  // src/downloads/intake-contract.js
  var DOWNLOAD_INTAKE_KEY = "browserDownloadIntake.v1";
  var DOWNLOAD_INTAKE_MESSAGES = Object.freeze({
    GET: "GET_BROWSER_DOWNLOAD_INTAKE",
    CLEAR: "CLEAR_BROWSER_DOWNLOAD_INTAKE"
  });
  var INTAKE_LIMIT = 50;
  var INTAKE_MAX_AGE_MS = 60 * 60 * 1e3;
  function sourceFacts(value) {
    try {
      const url = new URL(value);
      return {
        protocol: url.protocol,
        host: url.hostname,
        credentialed: Boolean(url.username || url.password),
        authorizationHints: [...url.searchParams.keys()].some(
          (key) => /(^|[_-])(token|sig|signature|auth|expire|expires|policy|key|jwt|credential)([_-]|$)/i.test(
            key
          ) || /^(X-Amz-|X-Goog-)/i.test(key)
        )
      };
    } catch {
      return {
        protocol: "unknown",
        host: "",
        credentialed: false,
        authorizationHints: false
      };
    }
  }
  function normalizeDownloadIntake(item, now = Date.now()) {
    if (!Number.isInteger(item?.id) || item.id < 0 || item.incognito || item.byExtensionId)
      return null;
    const original = sourceFacts(item.url);
    const final = sourceFacts(item.finalUrl || item.url);
    return {
      id: item.id,
      filename: String(item.filename || "").split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "Unnamed file",
      host: final.host,
      protocol: final.protocol,
      credentialed: original.credentialed || final.credentialed,
      authorizationHints: original.authorizationHints || final.authorizationHints,
      mime: String(item.mime || "").split(";")[0].slice(0, 100),
      totalBytes: size(item.totalBytes),
      state: ["in_progress", "complete", "interrupted"].includes(item.state) ? item.state : "unknown",
      danger: String(item.danger || "unknown").slice(0, 64),
      paused: item.paused === true,
      observedAt: now,
      method: "unknown"
    };
  }
  function applyDownloadDelta(record, delta) {
    const next = { ...record };
    for (const key of [
      "state",
      "danger",
      "paused",
      "totalBytes",
      "mime",
      "filename"
    ])
      if (delta[key] && Object.hasOwn(delta[key], "current")) {
        const value = delta[key].current;
        if (key === "totalBytes") next[key] = size(value);
        else if (key === "paused") next[key] = value === true;
        else if (key === "filename")
          next[key] = String(value || "").split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "Unnamed file";
        else next[key] = String(value || "unknown").slice(0, 100);
      }
    if (delta.finalUrl?.current || delta.url?.current) {
      const facts = sourceFacts(delta.finalUrl?.current || delta.url.current);
      next.host = facts.host;
      next.protocol = facts.protocol;
      next.credentialed ||= facts.credentialed;
      next.authorizationHints ||= facts.authorizationHints;
    }
    return next;
  }
  function restoreDownloadIntake(value, now = Date.now()) {
    if (value?.version !== 1 || !Array.isArray(value.items)) return [];
    return value.items.slice(0, INTAKE_LIMIT).flatMap((row) => {
      if (!Number.isInteger(row?.id) || !Number.isFinite(row.observedAt) || row.observedAt > now || now - row.observedAt > INTAKE_MAX_AGE_MS)
        return [];
      const normalized = normalizeDownloadIntake(
        {
          ...row,
          url: `${row.protocol}//${row.host}/`,
          incognito: false,
          byExtensionId: null
        },
        row.observedAt
      );
      if (!normalized) return [];
      normalized.authorizationHints = row.authorizationHints === true;
      normalized.credentialed = row.credentialed === true;
      return [normalized];
    });
  }
  function size(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  // src/downloads/intake-policy.js
  function assessDownloadIntake(record) {
    let reason;
    if (record.credentialed) reason = "url_credentials";
    else if (!["https:", "http:"].includes(record.protocol))
      reason = "unsupported_source";
    else if (record.danger !== "safe") reason = "browser_safety_check";
    else if (record.state !== "in_progress") reason = "not_active";
    else if (record.paused) reason = "browser_paused";
    else if (/^(text\/html|application\/(vnd.apple.mpegurl|x-mpegurl|dash\+xml))$/i.test(
      record.mime
    ))
      reason = "not_direct_file";
    else if (record.authorizationHints) reason = "authorization_not_verified";
    else reason = "request_not_verified";
    return {
      disposition: [
        "request_not_verified",
        "authorization_not_verified"
      ].includes(reason) ? "needs_validation" : "browser_only",
      reason,
      canTakeOver: false
    };
  }
  var INTAKE_REASON_LABELS = Object.freeze({
    request_not_verified: "HTTP file \xB7 request method and browser session not verified",
    authorization_not_verified: "Signed/session URL \xB7 requires Helper verification",
    url_credentials: "URL credentials \xB7 keep in Chrome",
    unsupported_source: "Browser-local or unsupported source \xB7 keep in Chrome",
    browser_safety_check: "Chrome safety status not clear \xB7 keep in Chrome",
    not_active: "Already finished or interrupted \xB7 keep in Chrome",
    browser_paused: "Paused in Chrome",
    not_direct_file: "Not a direct file \xB7 use the media workflow if applicable"
  });

  // src/downloads/auto-check-policy.js
  var FILE_AUTO_MIN_BYTES = 8 * 1024 * 1024;
  var FILE_OFFERS_MESSAGE = "GET_BROWSER_FILE_OFFERS";
  var FILE_AUTO_CHECK_KEY = "browserFileChecks.v1";
  function assessAutomaticFileCheck(row) {
    if (assessDownloadIntake(row).disposition !== "needs_validation")
      return { eligible: false, reason: "browser_only" };
    if (!Number.isSafeInteger(row.totalBytes) || row.totalBytes <= 0)
      return { eligible: false, reason: "size_unknown" };
    if (row.totalBytes < FILE_AUTO_MIN_BYTES)
      return { eligible: false, reason: "small_file" };
    if (!FILE_EXTENSIONS.includes(
      String(row.filename || "").split(".").pop().toLowerCase()
    ))
      return { eligible: false, reason: "unsupported_file_type" };
    return { eligible: true, reason: "preflight_required" };
  }

  // src/background/downloads/intake-messages.js
  var FILE_ACTIONS = Object.freeze({
    [FILE_MESSAGES.CHECK]: ACTIONS.BROWSER_FILE_CHECK,
    [FILE_MESSAGES.ACCEPT]: ACTIONS.BROWSER_FILE_ACCEPT,
    [FILE_MESSAGES.RETURN]: ACTIONS.BROWSER_FILE_RETURN,
    [FILE_MESSAGES.OPEN]: ACTIONS.BROWSER_FILE_OPEN,
    [FILE_MESSAGES.REVEAL]: ACTIONS.BROWSER_FILE_REVEAL
  });
  function routeDownloadIntakeMessage(message, sender, intake, chrome2, handoff, automaticFiles2) {
    if (message?.type === FILE_OFFERS_MESSAGE) {
      if (sender?.id !== chrome2.runtime.id || sender?.url?.split(/[?#]/)[0] !== chrome2.runtime.getURL("popup/popup.html"))
        return { status: "ignored" };
      return automaticFiles2?.snapshot().then((value) => ({ status: "ok", items: value.offers })) || {
        status: "ok",
        items: []
      };
    }
    if (!Object.values(DOWNLOAD_INTAKE_MESSAGES).includes(message?.type) && !FILE_ACTIONS[message?.type])
      return null;
    if (sender?.id !== chrome2.runtime.id || sender?.url?.split(/[?#]/)[0] !== chrome2.runtime.getURL("options/options.html"))
      return { status: "ignored" };
    if (FILE_ACTIONS[message.type])
      return handoff?.execute(FILE_ACTIONS[message.type], {
        browserId: message.browserId,
        checkId: message.checkId,
        jobId: message.jobId
      }) || { status: "unavailable" };
    if (message.type === DOWNLOAD_INTAKE_MESSAGES.GET && handoff)
      return Promise.all([handoff.snapshot(), automaticFiles2?.snapshot()]).then(
        ([extra, auto]) => ({ ...intake.snapshot(), ...extra, autoChecks: auto })
      );
    return message.type === DOWNLOAD_INTAKE_MESSAGES.GET ? intake.snapshot() : intake.clear();
  }

  // src/background/message-router.js
  var NAVIGATION_DIAGNOSTICS_MESSAGES = /* @__PURE__ */ new Set([
    "START_NAVIGATION_DIAGNOSTICS",
    "STOP_NAVIGATION_DIAGNOSTICS",
    "GET_NAVIGATION_DIAGNOSTICS",
    "CLEAR_NAVIGATION_DIAGNOSTICS"
  ]);
  var MESSAGE_CAPABILITIES = Object.freeze({
    [DOWNLOAD_INTAKE_MESSAGES.GET]: CAPABILITIES.CORE_MAINTENANCE,
    [DOWNLOAD_INTAKE_MESSAGES.CLEAR]: CAPABILITIES.CORE_MAINTENANCE,
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
    START_NAVIGATION_DIAGNOSTICS: CAPABILITIES.CORE_MESSAGING,
    STOP_NAVIGATION_DIAGNOSTICS: CAPABILITIES.CORE_MESSAGING,
    GET_NAVIGATION_DIAGNOSTICS: CAPABILITIES.CORE_MESSAGING,
    CLEAR_NAVIGATION_DIAGNOSTICS: CAPABILITIES.CORE_MESSAGING,
    LEARN_VIDEO_AD: CAPABILITIES.LEARNING_FEEDBACK,
    SYNC_VIDEO_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
    REPORT_AD_DENSITY: CAPABILITIES.CORE_MAINTENANCE,
    RECORD_TELEMETRY: CAPABILITIES.TELEMETRY_QUEUE,
    FLUSH_TELEMETRY: CAPABILITIES.TELEMETRY_QUEUE,
    UPSERT_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
    REMOVE_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
    RESTORE_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
    RESET_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
    UPSERT_ELEMENT_EXCEPTIONS: CAPABILITIES.CORE_MAINTENANCE,
    REMOVE_ELEMENT_EXCEPTIONS: CAPABILITIES.CORE_MAINTENANCE,
    RESET_ELEMENT_DECISIONS: CAPABILITIES.CORE_MAINTENANCE,
    SAVE_DOMAIN_DECISION: CAPABILITIES.CORE_MAINTENANCE,
    REMOVE_DOMAIN_DECISION: CAPABILITIES.CORE_MAINTENANCE,
    GET_STORAGE_HEALTH: CAPABILITIES.CORE_MAINTENANCE,
    RECORD_DOM_SAMPLE: CAPABILITIES.LEARNING_FEEDBACK,
    MEDIA_DISCOVERED: CAPABILITIES.MEDIA_CATALOG,
    MEDIA_PROBED: CAPABILITIES.MEDIA_CATALOG,
    MEDIA_PROBE_DIAGNOSTIC: CAPABILITIES.MEDIA_CATALOG,
    MEDIA_BLOB_TRACED: CAPABILITIES.MEDIA_CATALOG,
    MEDIA_EME_OBSERVED: CAPABILITIES.MEDIA_CATALOG,
    MEDIA_PLAYBACK_OBSERVED: CAPABILITIES.MEDIA_CATALOG,
    PREPARE_MEDIA_CONTEXTUAL_PROBE: CAPABILITIES.MEDIA_CATALOG,
    GET_MEDIA_CATALOG: CAPABILITIES.MEDIA_CATALOG,
    GET_PLAYER_MEDIA_CONTEXT: CAPABILITIES.MEDIA_DOWNLOAD,
    GET_PLAYER_DOWNLOAD_CONTEXT: CAPABILITIES.MEDIA_DOWNLOAD,
    SELECT_PLAYER_MEDIA: CAPABILITIES.MEDIA_DOWNLOAD,
    OPEN_PLAYER_DOWNLOAD_MANAGER: CAPABILITIES.MEDIA_DOWNLOAD,
    OPEN_ELEMENT_DECISIONS: CAPABILITIES.CORE_MAINTENANCE,
    GET_MEDIA_SESSIONS: CAPABILITIES.MEDIA_CATALOG,
    SAVE_MEDIA_DEBUG_MANIFEST: CAPABILITIES.MEDIA_CATALOG,
    GET_MEDIA_DEBUG_MANIFEST: CAPABILITIES.MEDIA_CATALOG,
    SAVE_DECRYPTED_MEDIA_MANIFEST: CAPABILITIES.MEDIA_CATALOG,
    GET_MEDIA_HELPER_STATUS: CAPABILITIES.MEDIA_DOWNLOAD,
    PREFLIGHT_MEDIA_DOWNLOAD_QUALITIES: CAPABILITIES.MEDIA_DOWNLOAD,
    VALIDATE_PLAYER_OUTPUT_CANARY: CAPABILITIES.MEDIA_DOWNLOAD,
    START_PLAYER_OUTPUT_CAPTURE: CAPABILITIES.MEDIA_DOWNLOAD,
    PLAYER_OUTPUT_CAPTURE_CHUNK: CAPABILITIES.MEDIA_DOWNLOAD,
    PLAYER_OUTPUT_CAPTURE_FINISH: CAPABILITIES.MEDIA_DOWNLOAD,
    PLAYER_OUTPUT_CAPTURE_FAILED: CAPABILITIES.MEDIA_DOWNLOAD,
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
  function registerMessageRouter(policy, { downloadIntake: downloadIntake2, fileHandoff: fileHandoff2, automaticFiles: automaticFiles2 } = {}) {
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
      if (downloadIntake2) {
        const result2 = routeDownloadIntakeMessage(
          message,
          sender,
          downloadIntake2,
          chrome,
          fileHandoff2,
          automaticFiles2
        );
        if (result2 !== null) {
          Promise.resolve(result2).then(sendResponse).catch(() => sendResponse({ status: "error" }));
          return true;
        }
      }
      route(message, sender).then((r) => sendResponse(r || { status: "ok" })).catch((err) => sendResponse({ status: "error", error: err.message }));
      return true;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }
  async function route(message, sender) {
    if (!message) return { status: "ignored" };
    if (NAVIGATION_DIAGNOSTICS_MESSAGES.has(message.type) && !sender?.url?.startsWith(chrome.runtime.getURL("options/")))
      return { status: "ignored" };
    if (message.type === "START_NAVIGATION_DIAGNOSTICS")
      return navigationDiagnostics.startCapture({
        durationMs: message.durationMs,
        reason: "developer_test"
      });
    if (message.type === "STOP_NAVIGATION_DIAGNOSTICS")
      return navigationDiagnostics.stopCapture();
    if (message.type === "GET_NAVIGATION_DIAGNOSTICS")
      return navigationDiagnostics.getSnapshot();
    if (message.type === "CLEAR_NAVIGATION_DIAGNOSTICS")
      return navigationDiagnostics.clear();
    if (message.type === "TRUSTED_CLICK") {
      runtimeState.lastTrustedClick = {
        timestamp: Date.now(),
        intentUrl: message.intentUrl,
        sourceUrl: sender?.tab?.url || message.sourceUrl || null,
        intentKind: message.intentKind || "navigation",
        intentReasons: Array.isArray(message.intentReasons) ? message.intentReasons : [],
        tabId: sender?.tab?.id || null,
        sourceFrameId: sender?.frameId ?? null
      };
      navigationAttribution.rememberIntent(runtimeState.lastTrustedClick);
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
    if (message.type === "UPSERT_ELEMENT_EXCEPTIONS")
      return getSettingsMutationStore().upsertElementExceptions(
        message.hostname,
        message.rules
      );
    if (message.type === "REMOVE_ELEMENT_EXCEPTIONS")
      return getSettingsMutationStore().removeElementExceptions(
        message.hostname,
        message.ids
      );
    if (message.type === "RESET_ELEMENT_DECISIONS")
      return getSettingsMutationStore().resetElementDecisions(message.hostname);
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
    if (message.type === "MEDIA_PLAYBACK_OBSERVED") {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return { status: "ignored" };
      return recordMediaPlaybackObservation(tabId, {
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
      if (candidate.frameUrl && !sameOrigin2(message.frameDocumentUrl, candidate.frameUrl))
        return { status: "invalid_frame" };
      return prepareMediaProbeReferer({
        tabId,
        manifestUrl: candidate.manifestUrl,
        parentDocumentUrl: message.parentDocumentUrl,
        frameDocumentUrl: candidate.frameUrl || message.frameDocumentUrl
      });
    }
    if (message.type === "GET_MEDIA_CATALOG") {
      if (!Number.isInteger(message.tabId)) return { status: "invalid_tab" };
      return listDiscoveredMedia(message.tabId, message.pageUrl || null);
    }
    if (message.type === "GET_PLAYER_MEDIA_CONTEXT") {
      if (!Number.isInteger(sender?.tab?.id)) return { status: "invalid_tab" };
      const snapshot = await listDiscoveredMedia(sender.tab.id, sender.tab.url);
      return {
        ...snapshot,
        tab: { id: sender.tab.id, url: sender.tab.url },
        frameId: sender.frameId ?? 0
      };
    }
    if (message.type === "GET_PLAYER_DOWNLOAD_CONTEXT") {
      if (!Number.isInteger(sender?.tab?.id)) return { status: "invalid_tab" };
      const snapshot = await listDiscoveredMedia(sender.tab.id, sender.tab.url);
      const target = resolvePlayerDownloadTarget({
        sourceUrl: message.sourceUrl,
        pageUrl: sender.url,
        frameId: sender.frameId ?? 0,
        items: snapshot.items
      });
      if (!target) return { status: "unavailable" };
      return requestMediaDownloadContext({
        tabId: sender.tab.id,
        mediaId: target.candidate.id,
        output: message.output,
        verifyFile: message.verifyFile === true
      });
    }
    if (message.type === "SELECT_PLAYER_MEDIA") {
      if (!Number.isInteger(sender?.tab?.id)) return { status: "invalid_tab" };
      const snapshot = await listDiscoveredMedia(sender.tab.id, sender.tab.url);
      const target = resolvePlayerDownloadTarget({
        sourceUrl: message.sourceUrl,
        pageUrl: sender.url,
        frameId: sender.frameId ?? 0,
        items: snapshot.items
      });
      if (!target) return { status: "unavailable" };
      return preferDiscoveredMedia(sender.tab.id, target.presentation.id);
    }
    if (message.type === "OPEN_PLAYER_DOWNLOAD_MANAGER") {
      await openExtensionManagedTab(
        {
          url: chrome.runtime.getURL("options/options.html#downloads")
        },
        "download_manager"
      );
      return { status: "opened" };
    }
    if (message.type === "OPEN_ELEMENT_DECISIONS") {
      if (!isExtensionPageSender(sender) || !Number.isInteger(message.tabId))
        return { status: "forbidden" };
      const tab = await chrome.tabs.get(message.tabId);
      const page = new URL(tab.url);
      if (!/^https?:$/.test(page.protocol)) return { status: "invalid_tab" };
      await openExtensionManagedTab(
        {
          url: chrome.runtime.getURL("options/options.html") + `?site=${encodeURIComponent(page.hostname)}#element-decisions`
        },
        "element_decisions"
      );
      return { status: "opened" };
    }
    if (message.type === "GET_MEDIA_SESSIONS") {
      if (!Number.isInteger(message.tabId)) return { status: "invalid_tab" };
      return listMediaPlaybackSessions(message.tabId, message.pageUrl || null);
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
        connections: message.connections,
        output: message.output,
        repeatOf: typeof message.repeatOf === "string" ? message.repeatOf : null
      });
    if (message.type === "PREFLIGHT_MEDIA_DOWNLOAD_QUALITIES")
      return requestMediaDownloadQualityPreflight({
        tabId: message.tabId,
        mediaId: message.mediaId
      });
    if (message.type === "VALIDATE_PLAYER_OUTPUT_CANARY")
      return requestPlayerOutputCanary({
        tabId: message.tabId,
        mediaId: message.mediaId
      });
    if (message.type === "START_PLAYER_OUTPUT_CAPTURE")
      return requestPlayerOutputCapture({
        tabId: message.tabId,
        mediaId: message.mediaId
      });
    if (message.type === "PLAYER_OUTPUT_CAPTURE_CHUNK")
      return receivePlayerOutputCaptureChunk(message, sender);
    if (message.type === "PLAYER_OUTPUT_CAPTURE_FINISH")
      return receivePlayerOutputCaptureFinish(message, sender);
    if (message.type === "PLAYER_OUTPUT_CAPTURE_FAILED")
      return receivePlayerOutputCaptureFailure(message, sender);
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
      await openExtensionManagedTab(
        { url: message.url, active: true },
        "user_restore"
      );
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
        evidence: {
          navigation: normalizeNavigationAttributionFacts(
            message.navigationAttribution
          ),
          interpretation: "explicit_user_feedback"
        },
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
        evidence: {
          navigation: normalizeNavigationAttributionFacts(
            message.navigationAttribution
          ),
          interpretation: "explicit_user_feedback"
        },
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
      await openExtensionManagedTab(
        tabCreateProperties(targetUrl.href, sender),
        "user_open_once"
      );
      return { status: "opened" };
    }
    if (message.type === "ALLOW_BLOCKED_SOURCE") {
      const source = senderSourceHostname(sender);
      const search = getPrefilledSearchNavigation(message.url);
      if (!source || !search) return { status: "invalid_navigation" };
      await syncTrustedPath(source, PREFILLED_SEARCH_TRUST_TARGET, true);
      const tab = await openExtensionManagedTab(
        tabCreateProperties(message.url, sender),
        "user_allow_source"
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
    const elementExceptions = normalizeElementExceptions2(
      rawSettings.element_exceptions
    );
    const totalRules = Object.values(customRules).reduce(
      (count, rules) => count + rules.length,
      0
    );
    const totalExceptions = Object.values(elementExceptions).reduce(
      (count, rules) => count + rules.length,
      0
    );
    if (totalRules + totalExceptions > MAX_RULES) {
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
        element_exceptions: elementExceptions,
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
      userCustomRules: settingsPackage.settings.custom_rules,
      userElementExceptions: settingsPackage.settings.element_exceptions
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
    return settingsDiffer || !snapshot.appSettings && (snapshot.isEnabled === false || snapshot.friendlyMode === false) || (snapshot.whitelist?.length || 0) > 0 || (snapshot.blacklist?.length || 0) > 0 || Object.keys(snapshot.userCustomRules || {}).length > 0 || Object.keys(snapshot.userElementExceptions || {}).length > 0 || Object.keys(snapshot).some((key) => key.startsWith("p:"));
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
        values.map(normalizeHostname3).filter(Boolean).map((hostname) => blacklist ? `||${hostname}^` : hostname)
      )
    ].slice(0, 2e3);
  }
  function normalizeCustomRules(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result2 = {};
    for (const [rawHostname, rawRules] of Object.entries(value)) {
      const hostname = normalizeHostname3(rawHostname);
      if (!hostname || !Array.isArray(rawRules)) continue;
      const rules = rawRules.slice(0, MAX_RULES_PER_SITE2).map(normalizeRule).filter(Boolean);
      if (rules.length) result2[hostname] = dedupeRules(rules);
    }
    return result2;
  }
  function normalizeElementExceptions2(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result2 = {};
    for (const [rawHostname, rawRules] of Object.entries(value)) {
      const hostname = normalizeHostname3(rawHostname);
      if (!hostname || !Array.isArray(rawRules)) continue;
      const rules = rawRules.slice(0, MAX_RULES_PER_SITE2).map(normalizeElementException).filter(Boolean);
      if (rules.length) result2[hostname] = dedupeElementExceptions(rules);
    }
    return result2;
  }
  function normalizeElementException(rule) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
    const selector = cleanText(rule.selector, MAX_SELECTOR_LENGTH);
    const fingerprint = normalizeFingerprint(rule.fingerprint);
    if (!isSafeSelector(selector) || !fingerprint || !hasElementExceptionIdentity(fingerprint))
      return null;
    return {
      id: cleanText(rule.id, 160) || `not-ad-${stableTextId2(
        `${selector}|${fingerprint.linkDomain}|${fingerprint.srcHost}|${fingerprint.id}|${fingerprint.descendantLinkHosts.join(",")}|${fingerprint.descendantSrcHosts.join(",")}`
      )}`,
      selector,
      fingerprint,
      confidence: clampNumber(rule.confidence, 0, 1, 0.5),
      source: cleanText(rule.source || "user_not_ad", 80),
      layout: VALID_RULE_LAYOUTS.has(rule.layout) ? rule.layout : "any"
    };
  }
  function hasElementExceptionIdentity(fingerprint) {
    return Boolean(
      fingerprint.tag && (fingerprint.id || fingerprint.className || fingerprint.alt || fingerprint.title || fingerprint.linkDomain || fingerprint.srcHost || fingerprint.idTokens.length || fingerprint.classTokens.length || fingerprint.descendantLinkHosts.length || fingerprint.descendantSrcHosts.length)
    );
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
      linkDomain: normalizeHostname3(fingerprint.linkDomain) || null,
      srcHost: normalizeHostname3(fingerprint.srcHost) || null,
      idTokens: normalizeTokens(fingerprint.idTokens),
      classTokens: normalizeTokens(fingerprint.classTokens),
      descendantLinkHosts: normalizeHostList(fingerprint.descendantLinkHosts),
      descendantSrcHosts: normalizeHostList(fingerprint.descendantSrcHosts)
    };
  }
  function normalizeHostList(values) {
    return [
      ...new Set(
        (Array.isArray(values) ? values : []).map((value) => normalizeHostname3(value)).filter(Boolean)
      )
    ].sort().slice(0, 12);
  }
  function normalizeTrustedPaths(paths) {
    if (!Array.isArray(paths)) return [];
    const byKey = /* @__PURE__ */ new Map();
    for (const raw of paths.slice(0, 2e3)) {
      const source = normalizeHostname3(raw?.source);
      const target = normalizeHostname3(raw?.target);
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
  function normalizeHostname3(value) {
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
      const key = selector + "|" + (typeof rule === "string" ? "any" : rule.layout || "any");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function dedupeElementExceptions(rules) {
    const seen = /* @__PURE__ */ new Set();
    return rules.filter((rule) => {
      if (seen.has(rule.id)) return false;
      seen.add(rule.id);
      return true;
    });
  }
  function stableTextId2(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
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
          const result2 = implementations[definition.id]({
            controller: controller2,
            feature: definition,
            policy
          });
          const cleanup = isPromiseLike(result2) ? await result2 : result2;
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
    if (definition.enabledByDefault === false && override !== true) return false;
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

  // src/media/youtube-track-profile.js
  var YOUTUBE_PAGE_HOSTS = /* @__PURE__ */ new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com"
  ]);
  function parseYouTubePlaybackTrack(sourceUrl, { mimeType = null, responseHeaders = [] } = {}) {
    let url;
    try {
      url = new URL(sourceUrl);
    } catch {
      return null;
    }
    if (!["http:", "https:"].includes(url.protocol) || !isGoogleVideoHost(url.hostname) || url.pathname !== "/videoplayback") {
      return null;
    }
    const declaredMime = cleanMimeType(url.searchParams.get("mime") || mimeType);
    const responseMime = cleanMimeType(mimeType);
    const effectiveMime = declaredMime || responseMime;
    const type = effectiveMime?.startsWith("video/") ? "video" : effectiveMime?.startsWith("audio/") ? "audio" : null;
    const itag = safeToken(url.searchParams.get("itag"), 24);
    if (!type || !itag) return null;
    const normalizedUrl = new URL(url);
    normalizedUrl.searchParams.delete("range");
    const size2 = parseSize(url.searchParams.get("size"));
    const duration = positiveNumber(url.searchParams.get("dur"));
    const contentLength = positiveInteger3(url.searchParams.get("clen")) || contentRangeTotal(responseHeaders) || positiveInteger3(headerValue(responseHeaders, "content-length"));
    const bitrate = positiveInteger3(url.searchParams.get("bitrate"));
    const codecs = parseCodecs(url.searchParams.get("mime"));
    const assetToken = safeToken(url.searchParams.get("id"), 180) || safeToken(url.searchParams.get("docid"), 64) || null;
    return Object.freeze({
      id: `youtube-${type}-${itag}`,
      provider: "youtube",
      acquisitionProfile: "youtube_resolved_tracks",
      type,
      itag,
      assetToken,
      sourceUrl: normalizedUrl.href,
      observedUrl: url.href,
      mimeType: effectiveMime,
      codecs,
      duration,
      bandwidth: bitrate,
      averageBandwidth: bitrate,
      contentLength,
      width: size2?.width || null,
      height: size2?.height || null,
      resolution: size2,
      qualityLabel: safeToken(url.searchParams.get("quality_label"), 40) || safeToken(url.searchParams.get("quality"), 40),
      observedAt: Date.now()
    });
  }
  function createYouTubeAdaptiveCandidate({
    pageUrl,
    title = null,
    track,
    playerUrl = null
  }) {
    if (!track || track.provider !== "youtube") return null;
    const videoId = youtubeVideoId2(pageUrl);
    if (!videoId || !isYouTubePage(pageUrl)) return null;
    const id = stableMediaId(MEDIA_KINDS.ADAPTIVE, `youtube:${videoId}`);
    const normalizedTrack = {
      id: track.id,
      type: track.type,
      sourceUrl: track.sourceUrl,
      mimeType: track.mimeType,
      codecs: track.codecs,
      itag: track.itag,
      bandwidth: track.bandwidth,
      averageBandwidth: track.averageBandwidth,
      contentLength: track.contentLength,
      width: track.width,
      height: track.height,
      resolution: track.resolution,
      qualityLabel: track.qualityLabel,
      observedAt: track.observedAt,
      urlResolution: track.urlResolution || "resolved",
      signatureCipher: track.signatureCipher || null,
      muxed: track.muxed === true,
      language: track.language || null,
      audioTrackId: track.audioTrackId || null,
      audioTrackName: track.audioTrackName || null,
      audioRole: track.audioRole || null,
      audioIsDefault: track.audioIsDefault === true,
      isDrc: track.isDrc === true,
      audioSampleRate: track.audioSampleRate || null,
      audioChannels: track.audioChannels || null,
      audioQuality: track.audioQuality || null
    };
    return normalizeMediaCandidate({
      id,
      pageUrl,
      sourceUrl: track.sourceUrl,
      kind: MEDIA_KINDS.ADAPTIVE,
      title,
      mimeType: track.mimeType,
      duration: track.duration,
      resolution: track.resolution,
      bandwidth: track.bandwidth,
      averageBandwidth: track.averageBandwidth,
      variants: track.type === "video" ? [normalizedTrack] : [],
      audioTracks: track.type === "audio" ? [normalizedTrack] : [],
      detectedBy: MEDIA_DETECTION_SOURCES.NETWORK,
      probeStatus: MEDIA_PROBE_STATES.DISCOVERED,
      streamType: "vod",
      provider: "youtube",
      acquisitionProfile: [
        "n_transform_pending",
        "signature_cipher_pending"
      ].includes(track.urlResolution) ? "youtube_player_js_challenge" : "youtube_resolved_tracks",
      playerUrl
    });
  }
  function isYouTubePage(value) {
    try {
      const hostname = new URL(value).hostname.toLowerCase();
      return YOUTUBE_PAGE_HOSTS.has(hostname) || hostname.endsWith(".youtube.com");
    } catch {
      return false;
    }
  }
  function youtubeVideoId2(value) {
    try {
      const url = new URL(value);
      if (!isYouTubePage(url.href)) return null;
      if (url.pathname === "/watch")
        return safeToken(url.searchParams.get("v"), 64);
      const shortMatch = url.pathname.match(
        /^\/(?:shorts|embed|live)\/([^/?#]+)/i
      );
      return shortMatch ? safeToken(shortMatch[1], 64) : null;
    } catch {
      return null;
    }
  }
  function isGoogleVideoHost(hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === "googlevideo.com" || normalized.endsWith(".googlevideo.com");
  }
  function cleanMimeType(value) {
    const normalized = String(value || "").split(";", 1)[0].trim().toLowerCase();
    return /^(?:video|audio)\/[a-z0-9.+-]+$/.test(normalized) ? normalized : null;
  }
  function parseCodecs(value) {
    const match = String(value || "").match(/codecs\s*=\s*["']?([^"';]+)/i);
    return match?.[1]?.trim().slice(0, 120) || null;
  }
  function parseSize(value) {
    const match = String(value || "").match(/^(\d{2,5})x(\d{2,5})$/i);
    if (!match) return null;
    const width = positiveInteger3(match[1]);
    const height = positiveInteger3(match[2]);
    return width && height ? { width, height } : null;
  }
  function contentRangeTotal(headers) {
    const value = headerValue(headers, "content-range");
    return positiveInteger3(String(value || "").match(/\/(\d+)$/)?.[1]);
  }
  function headerValue(headers, name) {
    const match = (headers || []).find(
      (item) => String(item?.name || "").toLowerCase() === name
    );
    return typeof match?.value === "string" ? match.value : null;
  }
  function safeToken(value, maximum) {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maximum ? normalized : null;
  }
  function positiveInteger3(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  // src/background/media-size-probe.js
  var DEFAULT_MAX_CONCURRENT = 2;
  var DEFAULT_MAX_PER_SCOPE = 8;
  var DEFAULT_CACHE_TTL_MS = 5 * 6e4;
  var DEFAULT_TIMEOUT_MS2 = 5e3;
  var DEFAULT_MAX_CACHE_ENTRIES = 256;
  var DEFAULT_MAX_SCOPES = 64;
  var DEFAULT_MAX_QUEUED = 16;
  function createMediaSizeProbe({
    fetchImpl = globalThis.fetch,
    now = Date.now,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    maxPerScope = DEFAULT_MAX_PER_SCOPE,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS2,
    maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
    maxScopes = DEFAULT_MAX_SCOPES,
    maxQueued = DEFAULT_MAX_QUEUED
  } = {}) {
    if (typeof fetchImpl !== "function")
      throw new TypeError("Media size probe requires fetch().");
    const cache = /* @__PURE__ */ new Map();
    const inFlight = /* @__PURE__ */ new Map();
    const scopeUrls = /* @__PURE__ */ new Map();
    const waiters = [];
    let active3 = 0;
    return Object.freeze({
      probe(rawUrl, { scopeKey = "default" } = {}) {
        const url = validDirectUrl(rawUrl);
        if (!url) return Promise.resolve(result("skipped", "invalid_url"));
        const cached = cache.get(url);
        if (cached && now() - cached.at < cacheTtlMs) {
          cache.delete(url);
          cache.set(url, cached);
          return Promise.resolve(cached.value);
        }
        cache.delete(url);
        if (inFlight.has(url)) return inFlight.get(url);
        pruneExpired(now());
        const scopedUrls = scopeUrls.get(scopeKey)?.urls || /* @__PURE__ */ new Set();
        if (!scopedUrls.has(url)) {
          if (scopedUrls.size >= maxPerScope)
            return Promise.resolve(result("skipped", "scope_limit"));
          scopedUrls.add(url);
          scopeUrls.set(scopeKey, { urls: scopedUrls, at: now() });
        }
        if (active3 >= maxConcurrent && waiters.length >= maxQueued)
          return Promise.resolve(result("skipped", "queue_limit"));
        const operation = runQueued(async () => {
          const value = await probeResponseMetadata(url, fetchImpl, timeoutMs);
          cache.set(url, { at: now(), value });
          trimCache();
          return value;
        });
        inFlight.set(url, operation);
        operation.finally(() => inFlight.delete(url));
        return operation;
      }
    });
    function pruneExpired(timestamp) {
      for (const [key, entry] of cache) {
        if (timestamp - entry.at >= cacheTtlMs) cache.delete(key);
      }
      for (const [key, entry] of scopeUrls) {
        if (timestamp - entry.at >= cacheTtlMs) scopeUrls.delete(key);
      }
      if (scopeUrls.size >= maxScopes) {
        const oldest = [...scopeUrls.entries()].sort(
          (left, right) => left[1].at - right[1].at
        );
        for (const [key] of oldest.slice(0, scopeUrls.size - maxScopes + 1))
          scopeUrls.delete(key);
      }
    }
    function trimCache() {
      while (cache.size > maxCacheEntries)
        cache.delete(cache.keys().next().value);
    }
    async function runQueued(task) {
      if (active3 >= maxConcurrent) {
        await new Promise((resolve) => waiters.push(resolve));
      } else {
        active3 += 1;
      }
      try {
        return await task();
      } finally {
        const next = waiters.shift();
        if (next) next();
        else active3 -= 1;
      }
    }
  }
  async function probeResponseMetadata(url, fetchImpl, timeoutMs) {
    const head = await requestHeadersOnly(
      fetchImpl,
      url,
      "HEAD",
      null,
      timeoutMs
    );
    const headSize = totalBytes(head);
    if (headSize) return result("resolved", null, headSize, "HEAD", head.status);
    const range = await requestHeadersOnly(
      fetchImpl,
      url,
      "GET",
      "bytes=0-0",
      timeoutMs
    );
    const rangeSize = totalBytes(range);
    if (rangeSize)
      return result("resolved", null, rangeSize, "GET_RANGE", range.status);
    if (head.error || range.error)
      return result("unavailable", "request_failed", null, null, range.status);
    return result("unavailable", "size_header_missing", null, null, range.status);
  }
  async function requestHeadersOnly(fetchImpl, url, method, range, timeoutMs) {
    const controller2 = new AbortController();
    const timeout = setTimeout(() => controller2.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        signal: controller2.signal,
        ...range ? { headers: { Range: range } } : {}
      });
      const metadata = {
        status: Number(response.status) || 0,
        headers: response.headers,
        error: false
      };
      if (method !== "HEAD") {
        await response.body?.cancel().catch(() => {
        });
      }
      return metadata;
    } catch {
      return { status: 0, headers: null, error: true };
    } finally {
      clearTimeout(timeout);
    }
  }
  function totalBytes(response) {
    if (!response || response.error || response.status < 200 || response.status >= 300)
      return null;
    const headers = response.headers;
    const encoding = String(headers?.get?.("content-encoding") || "").trim().toLowerCase();
    if (encoding && encoding !== "identity") return null;
    if (response.status === 206) {
      const total = String(headers?.get?.("content-range") || "").match(
        /^\s*bytes\s+\d+-\d+\/(\d+)\s*$/i
      )?.[1];
      return positiveSafeInteger(total);
    }
    return positiveSafeInteger(headers?.get?.("content-length"));
  }
  function validDirectUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }
  function positiveSafeInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  function result(status, reason, contentLength = null, method = null, httpStatus = null) {
    return Object.freeze({ status, reason, contentLength, method, httpStatus });
  }

  // src/background/media-request-observer.js
  var mediaSizeProbe = createMediaSizeProbe();
  var pendingSizeUpdates = /* @__PURE__ */ new Set();
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
    const contentLength = responseTotalBytes(details);
    const adaptiveTrack = parseYouTubePlaybackTrack(details.url, {
      mimeType,
      responseHeaders: details.responseHeaders
    });
    const kind = adaptiveTrack?.type ? "adaptive" : classifyMediaSource(details.url, mimeType);
    if (!kind) return null;
    return Object.freeze({
      requestId: String(details.requestId || ""),
      tabId: details.tabId,
      frameId: Number.isInteger(details.frameId) ? details.frameId : -1,
      parentFrameId: Number.isInteger(details.parentFrameId) ? details.parentFrameId : -1,
      initiator: safeHttpOrigin(details.initiator),
      url: details.url,
      mimeType,
      contentLength,
      kind,
      adaptiveTrack,
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
    const title = chooseMediaTitle(null, tab.title, tab.url);
    const candidate = observation.adaptiveTrack ? createYouTubeAdaptiveCandidate({
      pageUrl: tab.url,
      title,
      track: observation.adaptiveTrack
    }) : createMediaCandidateFromSource({
      pageUrl: tab.url,
      sourceUrl: observation.url,
      mimeType: observation.mimeType,
      contentLength: observation.kind === "direct" ? observation.contentLength : null,
      title,
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
    const result2 = await recordDiscoveredMedia(
      observation.tabId,
      createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate, {
        frameId: frameContext.frameId,
        frameUrl: frameContext.frameUrl,
        observationInput: observation.input,
        observationOutput: observation.output
      })
    );
    if (result2?.status === "recorded" && candidate.kind === "direct" && !result2.item?.contentLength) {
      probeMissingMediaSize({
        tabId: observation.tabId,
        candidate,
        frameId: frameContext.frameId,
        frameUrl: frameContext.frameUrl
      });
    }
    if (result2?.status !== "recorded" || !["hls", "dash"].includes(candidate.kind) || frameContext.frameId < 0)
      return;
    await chrome.tabs.sendMessage(
      observation.tabId,
      { type: "PROBE_OBSERVED_MEDIA", candidate },
      { frameId: frameContext.frameId }
    ).catch(() => {
    });
  }
  function probeMissingMediaSize({ tabId, candidate, frameId, frameUrl }) {
    const scopeKey = mediaProbeScope(tabId, candidate.pageUrl);
    const updateKey = `${scopeKey}:${candidate.id}`;
    if (pendingSizeUpdates.has(updateKey)) return;
    pendingSizeUpdates.add(updateKey);
    mediaSizeProbe.probe(candidate.sourceUrl, {
      scopeKey
    }).then(async (probe) => {
      if (probe.status !== "resolved" || !probe.contentLength) return;
      if (!await isCurrentTabPage(tabId, candidate.pageUrl)) return;
      await recordDiscoveredMedia(
        tabId,
        createRegisteredEvent(
          EVENTS.MEDIA_DISCOVERED,
          { ...candidate, contentLength: probe.contentLength },
          {
            frameId,
            frameUrl,
            observationInput: "media.size_probe.headers",
            observationOutput: "media.catalog.content_length"
          }
        )
      );
    }).catch(() => {
    }).finally(() => pendingSizeUpdates.delete(updateKey));
  }
  function mediaProbeScope(tabId, pageUrl) {
    try {
      const url = new URL(pageUrl);
      return `${tabId}:${url.href}`;
    } catch {
      return String(tabId);
    }
  }
  async function isCurrentTabPage(tabId, pageUrl) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const current = new URL(tab.url);
      const observed = new URL(pageUrl);
      current.hash = "";
      observed.hash = "";
      return current.href === observed.href;
    } catch {
      return false;
    }
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
  function responseTotalBytes(details = {}) {
    const headers = Array.isArray(details.responseHeaders) ? details.responseHeaders : [];
    const headerValue2 = (name) => headers.find((item) => String(item?.name || "").toLowerCase() === name)?.value;
    const status = Number(details.statusCode);
    const contentEncoding = String(headerValue2("content-encoding") || "").trim().toLowerCase();
    if (contentEncoding && contentEncoding !== "identity") return null;
    if (status === 206) {
      const total = String(headerValue2("content-range") || "").match(
        /^\s*bytes\s+\d+-\d+\/(\d+)\s*$/i
      )?.[1];
      return positiveSafeInteger2(total);
    }
    if (status < 200 || status >= 300) return null;
    return positiveSafeInteger2(headerValue2("content-length"));
  }
  function positiveSafeInteger2(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
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

  // src/background/downloads/intake-observer.js
  function createBrowserDownloadIntake({
    chrome: chrome2,
    now = Date.now,
    onAvailability = () => {
    }
  }) {
    let enabled = false, ready = false, attached = false, settled = false;
    let generation = 0, writeTimer = null, writeChain = Promise.resolve();
    let status = "off", storageFailed = false, pending = [];
    let clearSequence = 0, featurePolicy = null;
    const records = /* @__PURE__ */ new Map();
    const subscribers = /* @__PURE__ */ new Set();
    function emit(event2) {
      for (const listener of subscribers) {
        try {
          listener(event2);
        } catch {
        }
      }
    }
    function accept(event2) {
      if (!ready) {
        if (!settled || enabled) {
          pending.push(event2);
          if (pending.length > INTAKE_LIMIT * 2) pending.shift();
        }
        return;
      }
      if (!enabled) return;
      if (event2.type !== "create" && !records.has(event2.id)) return;
      if (event2.type === "change" && !Object.keys(event2.patch).length) return;
      apply(event2);
      scheduleWrite();
    }
    const onCreated = (item) => {
      const row = normalizeDownloadIntake(item, now());
      if (row) accept({ type: "create", row });
    };
    const onChanged = (delta) => {
      if (Number.isInteger(delta?.id))
        accept({
          type: "change",
          id: delta.id,
          patch: applyDownloadDelta({}, delta)
        });
    };
    const onErased = (id) => accept({ type: "erase", id });
    function attach() {
      if (attached || !chrome2.downloads?.onCreated) return;
      try {
        chrome2.downloads.onCreated.addListener(onCreated);
        chrome2.downloads.onChanged.addListener(onChanged);
        chrome2.downloads.onErased.addListener(onErased);
        attached = true;
      } catch {
        detach();
        status = "permission_required";
      }
    }
    function detach() {
      chrome2.downloads?.onCreated?.removeListener(onCreated);
      chrome2.downloads?.onChanged?.removeListener(onChanged);
      chrome2.downloads?.onErased?.removeListener(onErased);
      attached = false;
    }
    function prune() {
      for (const [id, row] of records)
        if (now() - row.observedAt > INTAKE_MAX_AGE_MS) records.delete(id);
      while (records.size > INTAKE_LIMIT)
        records.delete(records.keys().next().value);
    }
    function apply(event2) {
      if (event2.type === "create") {
        const previous = records.get(event2.row.id);
        records.set(
          event2.row.id,
          previous ? {
            ...event2.row,
            observedAt: previous.observedAt,
            authorizationHints: previous.authorizationHints || event2.row.authorizationHints,
            credentialed: previous.credentialed || event2.row.credentialed
          } : event2.row
        );
      } else if (event2.type === "change" && records.has(event2.id)) {
        const previous = records.get(event2.id);
        records.set(event2.id, {
          ...previous,
          ...event2.patch,
          authorizationHints: previous.authorizationHints || event2.patch.authorizationHints === true,
          credentialed: previous.credentialed || event2.patch.credentialed === true
        });
      } else if (event2.type === "erase") records.delete(event2.id);
      prune();
      emit({
        type: event2.type,
        row: records.get(event2.row?.id ?? event2.id),
        id: event2.row?.id ?? event2.id
      });
    }
    function persist(remove = false) {
      clearTimeout(writeTimer);
      writeTimer = null;
      prune();
      const epoch = generation;
      const value = { version: 1, items: [...records.values()] };
      writeChain = writeChain.catch(() => {
      }).then(async () => {
        if (epoch !== generation) return;
        try {
          if (remove) await chrome2.storage.session.remove(DOWNLOAD_INTAKE_KEY);
          else if (enabled && ready)
            await chrome2.storage.session.set({ [DOWNLOAD_INTAKE_KEY]: value });
          storageFailed = false;
        } catch {
          storageFailed = true;
        }
      });
      return writeChain;
    }
    function scheduleWrite() {
      if (writeTimer) return;
      writeTimer = setTimeout(() => {
        void persist();
      }, 500);
    }
    function disable(nextStatus = "off") {
      onAvailability(false);
      ++generation;
      enabled = false;
      ready = false;
      status = nextStatus;
      pending = [];
      records.clear();
      emit({ type: "reset" });
      detach();
      void persist(true);
    }
    const onRemoved = (change) => {
      if (change.permissions?.includes("downloads"))
        disable("permission_required");
    };
    const onAdded = (change) => {
      if (change.permissions?.includes("downloads") && featurePolicy && !enabled)
        void start(featurePolicy);
    };
    async function start(policy) {
      policy.require(CAPABILITIES.BROWSER_DOWNLOAD_OBSERVE);
      featurePolicy = policy;
      const epoch = ++generation;
      enabled = true;
      onAvailability(true);
      ready = false;
      status = "starting";
      attach();
      chrome2.permissions?.onRemoved?.addListener(onRemoved);
      chrome2.permissions?.onAdded?.addListener(onAdded);
      try {
        const granted = await chrome2.permissions.contains({
          permissions: ["downloads"]
        });
        if (epoch !== generation) return stop;
        if (!granted || !attached) {
          disable("permission_required");
          return stop;
        }
        try {
          const sequence = clearSequence;
          const saved = await chrome2.storage.session.get(DOWNLOAD_INTAKE_KEY);
          if (epoch !== generation) return stop;
          if (sequence === clearSequence)
            for (const row of restoreDownloadIntake(
              saved?.[DOWNLOAD_INTAKE_KEY],
              now()
            ))
              records.set(row.id, row);
        } catch {
          storageFailed = true;
        }
        if (epoch !== generation) return stop;
        ready = true;
        status = "observing";
        for (const event2 of pending.splice(0)) apply(event2);
        scheduleWrite();
      } catch {
        if (epoch === generation) disable("permission_required");
      }
      return stop;
    }
    function stop() {
      featurePolicy = null;
      chrome2.permissions?.onRemoved?.removeListener(onRemoved);
      chrome2.permissions?.onAdded?.removeListener(onAdded);
      disable();
    }
    function settleBootstrap() {
      settled = true;
      if (!enabled) {
        onAvailability(false);
        pending = [];
        detach();
        void persist(true);
      }
    }
    function snapshot() {
      const previousSize = records.size;
      prune();
      if (records.size !== previousSize && enabled && ready) scheduleWrite();
      return {
        status,
        storageFailed,
        observationOnly: true,
        maxItems: INTAKE_LIMIT,
        items: [...records.values()].reverse().map((row) => ({ ...row, assessment: assessDownloadIntake(row) }))
      };
    }
    async function clear() {
      ++clearSequence;
      records.clear();
      emit({ type: "reset" });
      pending = [];
      await persist(true);
      return { status: storageFailed ? "storage_error" : "cleared" };
    }
    return {
      subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
      bootstrap: attach,
      start,
      startFeature(policy) {
        void start(policy).catch(() => disable("unavailable"));
        return stop;
      },
      settleBootstrap,
      snapshot,
      clear,
      flush: () => persist(),
      stop
    };
  }

  // src/background/downloads/request-evidence.js
  function createDownloadRequestEvidence({ chrome: chrome2, now = Date.now }) {
    const records = /* @__PURE__ */ new Map(), pending = /* @__PURE__ */ new Set();
    let attached = false, generation = 0;
    async function capture(details) {
      if (details.statusCode < 200 || details.statusCode >= 300 || pending.size >= 200)
        return;
      const read = (name) => details.responseHeaders?.find(
        (header) => header.name.toLowerCase() === name
      )?.value || "";
      let url;
      try {
        url = new URL(details.url);
      } catch {
        return;
      }
      const mime = read("content-type").split(";")[0];
      if (!read("content-disposition").toLowerCase().includes("attachment") && !FILE_EXTENSIONS.includes(url.pathname.split(".").pop().toLowerCase()) && !/^(video\/|audio\/|application\/(zip|pdf|octet-stream))/.test(mime))
        return;
      const epoch = generation;
      const key = await sourceKey(url.href);
      if (epoch !== generation) return;
      const total = Number(
        read("content-range").match(/\/(\d+)$/)?.[1] || read("content-length")
      );
      const row = {
        method: String(details.method || "unknown").toUpperCase(),
        etag: read("etag"),
        size: Number.isSafeInteger(total) && total > 0 ? total : null,
        mime,
        capturedAt: Number(details.timeStamp) || now()
      };
      const related = (records.get(key) || []).filter(
        (item) => now() - item.capturedAt < 36e5
      );
      records.delete(key);
      records.set(key, [...related, row].slice(-10));
      while (records.size > 200) records.delete(records.keys().next().value);
    }
    const onHeaders = (details) => {
      const task = capture(details).catch(() => {
      }).finally(() => pending.delete(task));
      pending.add(task);
    };
    function start() {
      if (attached) return;
      chrome2.webRequest.onHeadersReceived.addListener(
        onHeaders,
        {
          urls: ["http://*/*", "https://*/*"],
          types: ["main_frame", "sub_frame", "other", "xmlhttprequest", "media"]
        },
        ["responseHeaders"]
      );
      attached = true;
    }
    function stop() {
      ++generation;
      if (attached) chrome2.webRequest.onHeadersReceived.removeListener(onHeaders);
      attached = false;
      records.clear();
    }
    async function forDownload(item) {
      await Promise.allSettled([...pending]);
      const key = await sourceKey(item.finalUrl || item.url);
      const started = Date.parse(item.startTime);
      const matches = (records.get(key) || []).filter(
        (row) => Number.isFinite(started) && row.capturedAt >= started - 1e3 && row.capturedAt <= started + 1e4 && now() - row.capturedAt < 36e5
      );
      if (!matches.length || matches.some((row) => row.method !== "GET"))
        throw Error(
          "A matching GET download request was not observed. Keep this download in Chrome."
        );
      const last = matches.at(-1);
      if (matches.some((row) => row.etag !== last.etag) || !/^"[^"\r\n]{1,200}"$/.test(last.etag) || !last.size)
        throw Error(
          "The file has no unambiguous strong validator and size. Keep it in Chrome."
        );
      return { ...last, key };
    }
    return { bootstrap: start, start, stop, forDownload };
  }
  async function sourceKey(value) {
    const url = new URL(value);
    url.hash = "";
    const digest2 = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(url.href)
    );
    return [...new Uint8Array(digest2)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // src/background/downloads/file-transfer-store.js
  var active2 = /* @__PURE__ */ new Set(["pause_requested", "downloading", "returning"]);
  var isFileTransferActive = (row) => active2.has(row?.status);
  function createFileTransferStore(chrome2) {
    const jobs = /* @__PURE__ */ new Map();
    const eta = createDownloadEtaEstimator();
    let chain = Promise.resolve(), timer = null, revision = 0;
    function project(row) {
      return {
        id: String(row.id),
        browserId: Number(row.browserId),
        sourceKey: String(row.sourceKey || ""),
        browserStartTime: String(row.browserStartTime || ""),
        filename: String(row.filename || "File").slice(0, 180),
        status: String(row.status),
        createdAt: Number(row.createdAt) || Date.now(),
        totalBytes: Number(row.totalBytes) || null,
        outputPath: row.outputPath || null,
        error: row.error ? String(row.error).replace(/https?:\/\/\S+/g, "[source]").slice(0, 600) : null,
        ownedPause: row.ownedPause === true
      };
    }
    async function load() {
      const saved = await chrome2.storage.local.get(FILE_TRANSFER_KEY);
      for (const row of (saved?.[FILE_TRANSFER_KEY]?.items || []).slice(-100)) {
        if (typeof row?.id !== "string" || !Number.isInteger(row.browserId))
          continue;
        jobs.set(row.id, project(row));
      }
    }
    function list() {
      return [...jobs.values()].reverse().map((row) => ({
        ...row,
        progress: row.progress ? { ...row.progress } : null
      }));
    }
    function publish(lifecycle = false) {
      clearTimeout(timer);
      timer = null;
      const snapshot = { version: 1, revision: ++revision, items: list() };
      const journal = { version: 1, items: [...jobs.values()].map(project) };
      chain = chain.catch(() => {
      }).then(async () => {
        if (lifecycle)
          await chrome2.storage.local.set({ [FILE_TRANSFER_KEY]: journal });
        await chrome2.storage.session.set({ [FILE_TRANSFER_KEY]: snapshot });
      });
      return chain;
    }
    function put(row) {
      if (row.status !== "downloading") eta.forget(row.id);
      jobs.set(row.id, { ...jobs.get(row.id), ...project(row) });
      while (jobs.size > 100) {
        const removable = [...jobs.values()].find(
          (item) => !isFileTransferActive(item)
        );
        if (!removable) break;
        jobs.delete(removable.id);
      }
      return publish(true);
    }
    function progress(id, value) {
      const row = jobs.get(id);
      if (!row) return;
      row.progress = {
        downloadedBytes: Number(value.downloadedBytes) || 0,
        totalBytes: row.totalBytes,
        bytesPerSecond: Number(value.bytesPerSecond) || 0
      };
      Object.assign(row.progress, eta.update(id, row.progress, row.status));
      if (!timer)
        timer = setTimeout(() => {
          void publish().catch(() => {
          });
        }, 500);
    }
    return {
      load,
      list,
      get: (id) => jobs.get(id),
      put,
      progress,
      notify: () => publish(),
      flush: () => chain,
      stop() {
        clearTimeout(timer);
      }
    };
  }

  // src/background/downloads/file-helper-client.js
  async function prepareFileHelper(chrome2, payload, onProgress, signal) {
    signal?.throwIfAborted();
    const port = chrome2.runtime.connectNative(MEDIA_HELPER_HOST_NAME);
    const pending = /* @__PURE__ */ new Map();
    let closed = false, terminal = null, idleTimer = null;
    function failAll(error) {
      clearTimeout(idleTimer);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      pending.clear();
      terminal?.reject(error);
      terminal = null;
    }
    function close() {
      if (closed) return;
      closed = true;
      signal?.removeEventListener("abort", onAbort);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      failAll(
        Error("Helper connection closed; the Chrome download must be resumed.")
      );
      port.disconnect();
    }
    const onDisconnect = () => {
      signal?.removeEventListener("abort", onAbort);
      void chrome2.runtime.lastError;
      closed = true;
      failAll(Error("Helper disconnected; the Chrome download must be resumed."));
    };
    const onMessage = (message) => {
      if (message?.protocolVersion !== MEDIA_HELPER_PROTOCOL_VERSION || typeof message.requestId !== "string")
        return;
      if (message.payload?.jobId && message.payload.jobId !== payload.jobId)
        return;
      const wait = pending.get(message.requestId);
      if (wait) {
        pending.delete(message.requestId);
        clearTimeout(wait.timer);
        if (message.type === "helper.error" || message.type === FILE_HELPER_EVENTS.FILE_FAILED)
          wait.reject(
            Error(message.payload?.message || "Helper rejected the file.")
          );
        else wait.resolve(message);
        return;
      }
      if (!terminal || message.requestId !== terminal.requestId) return;
      clearTimeout(idleTimer);
      if ([FILE_HELPER_EVENTS.FILE_PROGRESS, FILE_HELPER_EVENTS.FILE_STARTED].includes(message.type))
        idleTimer = setTimeout(() => {
          failAll(Error("Helper file transfer stalled. Returning to Chrome."));
          close();
        }, 45e3);
      if (message.type === FILE_HELPER_EVENTS.FILE_PROGRESS) onProgress(message.payload);
      if (message.type === FILE_HELPER_EVENTS.FILE_COMPLETED) {
        const done = terminal;
        terminal = null;
        done.resolve(message.payload);
      }
      if ([FILE_HELPER_EVENTS.FILE_FAILED, FILE_HELPER_EVENTS.FILE_CANCELLED, "helper.error"].includes(message.type)) {
        const done = terminal;
        terminal = null;
        done.reject(Error(message.payload?.message || "File transfer stopped."));
      }
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    const onAbort = () => close();
    signal?.addEventListener("abort", onAbort, { once: true });
    function request(type, data, timeout = 18e3) {
      if (closed) return Promise.reject(Error("Helper connection unavailable."));
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(Error("Helper file check timed out."));
        }, timeout);
        pending.set(requestId, { resolve, reject, timer });
        try {
          port.postMessage({
            type,
            requestId,
            protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
            payload: data
          });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(requestId);
          reject(error);
        }
      });
    }
    try {
      const hello = await request(
        "helper.hello",
        { extensionVersion: chrome2.runtime.getManifest().version },
        8e3
      );
      if (hello.type !== "helper.ready" || hello.payload?.capabilities?.[FILE_HTTP_CAPABILITY] !== true)
        throw Error("Update Media Helper to 0.25.0 or newer for file downloads.");
      const prepared = await request(FILE_HELPER_REQUESTS.FILE_PREPARE, payload);
      if (prepared.type !== FILE_HELPER_EVENTS.FILE_PREPARED || typeof prepared.payload?.token !== "string" || prepared.payload.totalBytes !== payload.expected.size)
        throw Error("Helper returned an invalid file check.");
      return {
        filename: prepared.payload.filename,
        totalBytes: prepared.payload.totalBytes,
        isReady: () => !closed,
        start() {
          if (closed)
            return Promise.reject(
              Error("Prepared Helper session is no longer available.")
            );
          const requestId = crypto.randomUUID();
          return new Promise((resolve, reject) => {
            terminal = { resolve, reject, requestId };
            idleTimer = setTimeout(() => {
              failAll(
                Error("Helper did not start the file. Returning to Chrome.")
              );
              close();
            }, 45e3);
            try {
              port.postMessage({
                type: FILE_HELPER_REQUESTS.FILE_START,
                requestId,
                protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
                payload: { jobId: payload.jobId, token: prepared.payload.token }
              });
            } catch (error) {
              terminal = null;
              reject(error);
            }
          });
        },
        close
      };
    } catch (error) {
      close();
      throw error;
    }
  }

  // src/background/downloads/file-handoff.js
  function createFileHandoff({
    chrome: chrome2,
    intake,
    evidence,
    prepare = (payload, onProgress, signal) => prepareFileHelper(chrome2, payload, onProgress, signal),
    store = createFileTransferStore(chrome2),
    settings = () => loadSettings(chrome2.storage.local),
    outputAction = runMediaHelperOutputAction
  }) {
    const tickets = /* @__PURE__ */ new Map(), running = /* @__PURE__ */ new Map(), locks = /* @__PURE__ */ new Set(), sources = /* @__PURE__ */ new Map(), errors = /* @__PURE__ */ new Map();
    const checking = /* @__PURE__ */ new Map();
    const automaticChecking = /* @__PURE__ */ new Set();
    const subscribers = /* @__PURE__ */ new Set();
    function notifyChecks() {
      for (const listener of subscribers) {
        try {
          listener();
        } catch {
        }
      }
      void store.notify().catch(() => {
      });
    }
    let changesAttached = false;
    let broker2 = null, ready = Promise.resolve(), stopped = false, generation = 0;
    async function getItem(id) {
      const rows = await chrome2.downloads.search({ id });
      if (rows.length !== 1)
        throw Error("The Chrome download is no longer available.");
      return rows[0];
    }
    async function verify(id) {
      if (intake.snapshot().status !== "observing" || !intake.snapshot().items.some((row2) => row2.id === id))
        throw Error("Enable observation and start a new Chrome download first.");
      const item = await getItem(id);
      const row = normalizeDownloadIntake(item);
      if (!row || assessDownloadIntake(row).disposition !== "needs_validation")
        throw Error(
          "This source must stay in Chrome (state, safety, session URL or source type)."
        );
      if (!FILE_EXTENSIONS.includes(row.filename.split(".").pop().toLowerCase()))
        throw Error("This file type must stay in Chrome.");
      return { item, row };
    }
    function disposeTicket(id) {
      const ticket = tickets.get(id);
      if (!ticket) return;
      clearTimeout(ticket.timer);
      ticket.client.close();
      tickets.delete(id);
      notifyChecks();
      if (sources.get(ticket.key) === id) sources.delete(ticket.key);
    }
    async function check({ browserId, automatic = false }) {
      await ready;
      if (stopped || !Number.isInteger(browserId))
        throw Error("Invalid browser download.");
      if (locks.has(browserId) || running.has(browserId))
        throw Error("This file is already being checked or transferred.");
      if (locks.size + tickets.size + running.size >= 3)
        throw Error("Finish or return a transfer before checking another file.");
      const epoch = generation;
      locks.add(browserId);
      const checkController = new AbortController();
      checking.set(browserId, checkController);
      if (automatic) automaticChecking.add(browserId);
      disposeTicket(browserId);
      errors.delete(browserId);
      let reserved = null;
      let preparedClient = null;
      try {
        const { item, row } = await verify(browserId);
        const proof = await evidence.forDownload(item);
        if (sources.has(proof.key))
          throw Error("This source is already checked or transferring.");
        reserved = proof.key;
        sources.set(proof.key, browserId);
        if (row.totalBytes !== null && row.totalBytes !== proof.size)
          throw Error("Chrome file size changed; keep it in Chrome.");
        const jobId = crypto.randomUUID(), config = await settings();
        checkController.signal.throwIfAborted();
        const client = await prepare(
          {
            jobId,
            url: item.finalUrl || item.url,
            filename: row.filename,
            expected: { size: proof.size, etag: proof.etag, mime: proof.mime },
            connections: config.mediaDownloadConnections,
            referrer: item.referrer,
            userAgent: globalThis.navigator?.userAgent || ""
          },
          (progress) => store.progress(jobId, progress),
          checkController.signal
        );
        preparedClient = client;
        checkController.signal.throwIfAborted();
        const fresh = await verify(browserId);
        if (fresh.item.startTime !== item.startTime || await sourceKey(fresh.item.finalUrl || fresh.item.url) !== proof.key || fresh.row.totalBytes !== null && fresh.row.totalBytes !== proof.size)
          throw Error(
            "Chrome download completed or changed during the Helper check. Keep it in Chrome."
          );
        if (epoch !== generation || stopped || intake.snapshot().status !== "observing") {
          client.close();
          throw Error("Browser observation was stopped.");
        }
        const ticket = {
          browserId,
          automatic,
          jobId,
          key: proof.key,
          checkId: crypto.randomUUID(),
          client,
          browserStartTime: item.startTime,
          filename: client.filename,
          totalBytes: proof.size,
          expiresAt: Date.now() + (row.authorizationHints ? 1e4 : 3e4),
          timer: null
        };
        ticket.timer = setTimeout(
          () => {
            disposeTicket(browserId);
            void store.notify().catch(() => {
            });
          },
          row.authorizationHints ? 1e4 : 3e4
        );
        tickets.set(browserId, ticket);
        notifyChecks();
        await store.notify();
        return { status: "ready_for_handoff" };
      } catch (error) {
        preparedClient?.close();
        disposeTicket(browserId);
        if (reserved && sources.get(reserved) === browserId)
          sources.delete(reserved);
        if (epoch === generation) errors.set(browserId, safeMessage(error));
        while (errors.size > 50) errors.delete(errors.keys().next().value);
        throw error;
      } finally {
        checking.delete(browserId);
        automaticChecking.delete(browserId);
        locks.delete(browserId);
      }
    }
    async function accept({ browserId, checkId }) {
      await ready;
      if (locks.has(browserId) || running.has(browserId))
        throw Error("A transfer is already active.");
      const ticket = tickets.get(browserId);
      if (!ticket || ticket.checkId !== checkId || ticket.expiresAt < Date.now())
        throw Error("The file check expired. Check again.");
      if (ticket.client.isReady?.() === false) {
        disposeTicket(browserId);
        throw Error(
          "Helper disconnected. Check the file again before transferring."
        );
      }
      locks.add(browserId);
      const epoch = generation;
      let pauseAttempted = false;
      function requireCurrentCheck() {
        if (stopped || epoch !== generation || intake.snapshot().status !== "observing" || tickets.get(browserId) !== ticket || ticket.client.isReady?.() === false)
          throw Error("File handoff was stopped. Keep this download in Chrome.");
      }
      try {
        const { item } = await verify(browserId);
        if (!changesAttached) {
          try {
            chrome2.downloads.onChanged.addListener(onChanged);
            changesAttached = true;
          } catch {
            throw Error(
              "Chrome download changes cannot be monitored; keep the file in Chrome."
            );
          }
        }
        if (item.startTime !== ticket.browserStartTime || await sourceKey(item.finalUrl || item.url) !== ticket.key)
          throw Error("The Chrome source changed. Check it again.");
        const job = {
          id: ticket.jobId,
          browserId,
          sourceKey: ticket.key,
          browserStartTime: item.startTime,
          filename: ticket.filename,
          totalBytes: ticket.totalBytes,
          createdAt: Date.now(),
          status: "pause_requested",
          ownedPause: true
        };
        await store.put(job);
        requireCurrentCheck();
        pauseAttempted = true;
        await chrome2.downloads.pause(browserId);
        requireCurrentCheck();
        const after = await getItem(browserId);
        if (after.state !== "in_progress" || !after.paused || after.canResume !== true || after.danger !== "safe")
          throw Error(
            "Chrome cannot preserve a resumable fallback for this file."
          );
        await store.put({ ...job, status: "downloading" });
        clearTimeout(ticket.timer);
        tickets.delete(browserId);
        notifyChecks();
        running.set(browserId, { ticket, job, promise: null });
        const operation = finish(ticket, job);
        running.get(browserId).promise = operation;
        return { status: "transferring" };
      } catch (error) {
        disposeTicket(browserId);
        const record = store.get(ticket.jobId);
        if (pauseAttempted)
          await restoreChrome(
            record || { browserId, ...ticket },
            safeMessage(error)
          );
        else if (record?.ownedPause)
          await store.put({
            ...record,
            status: "returned_to_chrome",
            ownedPause: false,
            error: safeMessage(error)
          });
        throw error;
      } finally {
        locks.delete(browserId);
      }
    }
    async function finish(ticket, job) {
      let completed = null;
      try {
        const result2 = await ticket.client.start();
        if (result2.totalBytes !== job.totalBytes || typeof result2.outputPath !== "string")
          throw Error("Helper completion did not match the checked file.");
        completed = {
          ...job,
          status: "completed",
          ownedPause: true,
          outputPath: result2.outputPath
        };
        await store.put(completed);
        let warning = null;
        try {
          const current = await getItem(job.browserId);
          if (current.startTime !== job.browserStartTime || await sourceKey(current.finalUrl || current.url) !== job.sourceKey)
            throw Error("Chrome source changed.");
          if (current.state === "in_progress" && current.paused)
            await chrome2.downloads.cancel(job.browserId);
          else if (current.state === "complete")
            warning = "Chrome also completed its copy.";
        } catch {
          warning = "File completed. Check the original Chrome download; it could not be closed automatically.";
        }
        await store.put({
          ...completed,
          ownedPause: false,
          error: warning
        });
      } catch (error) {
        await restoreChrome(completed || job, safeMessage(error)).catch(() => {
        });
      } finally {
        ticket.client.close();
        running.delete(job.browserId);
        sources.delete(ticket.key);
      }
    }
    async function restoreChrome(job, reason) {
      let error = reason, status = "returned_to_chrome";
      try {
        const item = await getItem(job.browserId);
        if (item.startTime !== job.browserStartTime || await sourceKey(item.finalUrl || item.url) !== job.sourceKey)
          throw Error(
            "The original Chrome download identity is no longer available."
          );
        if (item.danger !== "safe")
          throw Error("Check the download safety state in Chrome.");
        if (item.state === "in_progress" && item.paused)
          await chrome2.downloads.resume(job.browserId);
        else if (item.state !== "in_progress" && item.state !== "complete")
          throw Error("Resume this download manually in Chrome.");
      } catch {
        status = "needs_browser_attention";
        error = reason + " Resume the original download manually in Chrome.";
      }
      await store.put({
        ...job,
        status: job.status === "completed" && job.outputPath ? "completed" : status,
        error,
        ownedPause: false
      });
    }
    async function returnToChrome({ jobId }) {
      await ready;
      const job = store.get(jobId), entry = job && running.get(job.browserId);
      if (!entry) throw Error("No active file transfer was found.");
      entry.ticket.client.close();
      await entry.promise;
      return { status: "returned_to_chrome" };
    }
    async function recover() {
      await store.load();
      await Promise.all(
        store.list().filter((row) => row.ownedPause).map((row) => restoreChrome(row, "Helper connection ended."))
      );
    }
    async function output({ jobId, action: action2 }) {
      const job = store.get(jobId);
      if (job?.status !== "completed" || !job.outputPath)
        throw Error("Completed file not found.");
      await outputAction(action2, job.outputPath);
      return { status: "opened" };
    }
    function startFeature(policy) {
      stopped = false;
      ready = recover().catch(() => {
      });
      broker2 = createActionBroker({
        featureId: "background.browser-file-handoff",
        policy,
        handlers: {
          [ACTIONS.BROWSER_FILE_CHECK]: check,
          [ACTIONS.BROWSER_FILE_AUTO_CHECK]: (payload) => check({ ...payload, automatic: true }),
          [ACTIONS.BROWSER_FILE_ACCEPT]: accept,
          [ACTIONS.BROWSER_FILE_RETURN]: returnToChrome,
          [ACTIONS.BROWSER_FILE_OPEN]: (payload) => output({ ...payload, action: "open" }),
          [ACTIONS.BROWSER_FILE_REVEAL]: (payload) => output({ ...payload, action: "reveal" })
        }
      });
      chrome2.permissions?.onRemoved?.addListener(onPermissionRemoved);
      return async () => {
        stopped = true;
        if (changesAttached)
          chrome2.downloads?.onChanged?.removeListener(onChanged);
        changesAttached = false;
        chrome2.permissions?.onRemoved?.removeListener(onPermissionRemoved);
        await returnAll();
        broker2 = null;
        store.stop();
      };
    }
    const onChanged = (delta) => {
      const entry = running.get(delta.id);
      if (entry && (delta.paused?.current === false || delta.state?.current === "complete" || delta.error?.current === "USER_CANCELED" || delta.danger?.current && delta.danger.current !== "safe"))
        entry.ticket.client.close();
    };
    const onPermissionRemoved = (change) => {
      if (change.permissions?.some(
        (name) => ["downloads", "nativeMessaging"].includes(name)
      ))
        void returnAll().catch(() => {
        });
    };
    async function returnAll() {
      ++generation;
      errors.clear();
      for (const controller2 of checking.values()) controller2.abort();
      for (const id of [...tickets.keys()]) disposeTicket(id);
      for (const entry of running.values()) entry.ticket.client.close();
      await Promise.allSettled(
        [...running.values()].map((entry) => entry.promise)
      );
    }
    async function snapshot() {
      await ready;
      return {
        checks: [...tickets.values()].filter(
          (ticket) => ticket.expiresAt > Date.now() && ticket.client.isReady?.() !== false
        ).map(({ browserId, checkId, expiresAt }) => ({
          browserId,
          checkId,
          expiresAt
        })),
        checkErrors: [...errors].slice(-50).map(([browserId, error]) => ({ browserId, error })),
        fileTransfers: store.list()
      };
    }
    return {
      subscribeChecks(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
      discardCheck(id, automaticOnly = false) {
        if (automaticOnly && !automaticChecking.has(id) && tickets.get(id)?.automatic !== true)
          return;
        if (locks.has(id) && !checking.has(id)) return;
        checking.get(id)?.abort();
        disposeTicket(id);
      },
      startFeature,
      snapshot,
      returnAll,
      execute: async (action2, payload) => {
        if (!broker2) return { status: "unavailable" };
        try {
          return await broker2.execute(action2, payload);
        } catch (error) {
          return { status: "error", error: safeMessage(error) };
        }
      }
    };
  }
  function safeMessage(error) {
    return String(error?.message || "File handoff failed.").replace(/https?:\/\/\S+/g, "[source]").slice(0, 600);
  }

  // src/background/downloads/auto-file-checks.js
  function createAutomaticFileChecks({
    chrome: chrome2,
    intake,
    handoff,
    now = Date.now
  }) {
    const states = /* @__PURE__ */ new Map(), owned = /* @__PURE__ */ new Set(), queue = [];
    let enabled = false, epoch = 0, startTime = 0, inFlight = false, timer = null;
    let unsubscribe = null, uncheck = null, revision = 0;
    async function snapshot() {
      const observed = intake.snapshot(), checked = await handoff.snapshot();
      const offers = !enabled ? [] : (checked.checks || []).flatMap((check) => {
        const row = observed.items.find(
          (item) => item.id === check.browserId
        );
        return row?.state === "in_progress" && !row.paused ? [
          {
            browserId: row.id,
            filename: row.filename,
            totalBytes: row.totalBytes,
            expiresAt: check.expiresAt
          }
        ] : [];
      });
      return {
        enabled,
        status: enabled ? "on" : "off",
        items: [...states.values()],
        offers
      };
    }
    function publish() {
      if (timer) return;
      const stamp = ++revision;
      timer = setTimeout(async () => {
        timer = null;
        try {
          const value = await snapshot();
          if (stamp !== revision) return;
          const count = enabled ? value.offers.length : 0;
          for (const id of owned)
            if (states.get(id)?.status === "ready" && !value.offers.some((row) => row.browserId === id)) {
              owned.delete(id);
              states.set(id, {
                browserId: id,
                status: "closed",
                reason: "check_closed"
              });
            }
          await chrome2.action?.setBadgeBackgroundColor?.({ color: "#15803d" });
          await chrome2.action?.setBadgeText?.({
            text: count ? String(count) : ""
          });
          await chrome2.storage.session.set({
            [FILE_AUTO_CHECK_KEY]: {
              revision: stamp,
              enabled,
              count,
              items: value.items
            }
          });
        } catch {
        }
      }, 250);
    }
    function put(browserId, status, reason) {
      states.set(browserId, { browserId, status, reason });
      while (states.size > 50) states.delete(states.keys().next().value);
      publish();
    }
    async function drain() {
      if (inFlight || !enabled || !queue.length) return;
      inFlight = true;
      const generation = epoch, next = queue.shift();
      try {
        const row = intake.snapshot().items.find((row2) => row2.id === next.id);
        if (!row || now() - next.at > 15e3 || !assessAutomaticFileCheck(row).eligible) {
          put(next.id, "skipped", "source_changed");
          return;
        }
        const permitted = await chrome2.permissions.contains({
          permissions: ["downloads", "nativeMessaging"]
        });
        if (!enabled || generation !== epoch) return;
        if (!permitted) {
          put(next.id, "skipped", "permission_required");
          return;
        }
        if (!enabled || generation !== epoch) return;
        owned.add(next.id);
        put(next.id, "checking", "preflight_required");
        const result2 = await handoff.execute(ACTIONS.BROWSER_FILE_AUTO_CHECK, {
          browserId: next.id
        });
        if (!enabled || generation !== epoch) return;
        const fresh = intake.snapshot().items.find((row2) => row2.id === next.id);
        put(
          next.id,
          result2?.status === "ready_for_handoff" ? "ready" : fresh?.state !== "in_progress" ? "skipped" : "failed",
          result2?.status === "ready_for_handoff" ? "verified" : fresh?.state !== "in_progress" ? "not_active" : "preflight_failed"
        );
        if (result2?.status !== "ready_for_handoff") owned.delete(next.id);
      } catch {
        owned.delete(next.id);
        if (enabled && generation === epoch)
          put(next.id, "failed", "preflight_failed");
      } finally {
        inFlight = false;
        if (enabled) void drain();
      }
    }
    function reset() {
      ++epoch;
      queue.length = 0;
      for (const id of owned) handoff.discardCheck(id, true);
      owned.clear();
      states.clear();
      publish();
    }
    function onRecord(event2) {
      if (!enabled) return;
      if (event2.type === "reset") {
        reset();
        return;
      }
      const row = event2.row;
      if (!row || row.state !== "in_progress" || row.paused) {
        if (owned.has(event2.id)) handoff.discardCheck(event2.id, true);
        owned.delete(event2.id);
        const index = queue.findIndex((row2) => row2.id === event2.id);
        if (index >= 0) queue.splice(index, 1);
        if (row || states.has(event2.id)) put(event2.id, "skipped", "not_active");
        return;
      }
      if (row.observedAt < startTime - 1e3) return;
      const prior = states.get(row.id);
      if (prior && !["size_unknown", "unsupported_file_type", "browser_only"].includes(
        prior.reason
      ))
        return;
      const assessment = assessAutomaticFileCheck(row);
      if (!assessment.eligible) {
        put(row.id, "skipped", assessment.reason);
        return;
      }
      if (queue.length >= 10) {
        put(row.id, "skipped", "queue_full");
        return;
      }
      put(row.id, "queued", "preflight_required");
      queue.push({ id: row.id, at: now() });
      void drain();
    }
    const removed = (change) => {
      if (change.permissions?.some(
        (name) => ["downloads", "nativeMessaging"].includes(name)
      ))
        reset();
    };
    return {
      snapshot,
      refreshIndicators: publish,
      startFeature(policy) {
        policy.require(CAPABILITIES.BROWSER_FILE_AUTO_CHECK);
        enabled = true;
        startTime = now();
        unsubscribe = intake.subscribe(onRecord);
        uncheck = handoff.subscribeChecks(publish);
        chrome2.permissions?.onRemoved?.addListener(removed);
        publish();
        return () => {
          enabled = false;
          reset();
          unsubscribe?.();
          uncheck?.();
          chrome2.permissions?.onRemoved?.removeListener(removed);
        };
      }
    };
  }

  // src/background/index.js
  var requestEvidence = createDownloadRequestEvidence({ chrome });
  requestEvidence.bootstrap();
  var fileHandoff;
  var downloadIntake = createBrowserDownloadIntake({
    chrome,
    onAvailability: (enabled) => {
      if (enabled) requestEvidence.start();
      else {
        requestEvidence.stop();
        void fileHandoff?.returnAll().catch(() => {
        });
      }
    }
  });
  fileHandoff = createFileHandoff({
    chrome,
    intake: downloadIntake,
    evidence: requestEvidence
  });
  var automaticFiles = createAutomaticFileChecks({
    chrome,
    intake: downloadIntake,
    handoff: fileHandoff
  });
  downloadIntake.bootstrap();
  var controller = createMainController({
    context: "background",
    initialSettings: DEFAULT_SETTINGS,
    implementations: {
      "background.message-router": ({ policy }) => registerMessageRouter(policy, {
        downloadIntake,
        fileHandoff,
        automaticFiles
      }),
      "background.browser-file-auto-check": ({ policy }) => automaticFiles.startFeature(policy),
      "background.browser-file-handoff": ({ policy }) => fileHandoff.startFeature(policy),
      "background.browser-download-observer": ({ policy }) => downloadIntake.startFeature(policy),
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
  ).then((settings) => controller.updateSettings(settings)).then(() => {
    downloadIntake.settleBootstrap();
    automaticFiles.refreshIndicators();
    controller.onChange(() => {
      downloadIntake.settleBootstrap();
      automaticFiles.refreshIndicators();
    });
  }).catch((error) => {
    downloadIntake.settleBootstrap();
    console.error("[AdsFriendly Background] MainController failed", error);
  });
})();
