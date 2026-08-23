var AdsFriendlyOptions = (() => {
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
  function assertRegisteredCapability(capability) {
    if (!CAPABILITY_SET.has(capability)) {
      throw new Error(
        `[FeatureRegistry] Unknown capability "${capability}". Register it in feature-catalog.js before use.`
      );
    }
    return capability;
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
  async function saveSettings(nextSettings, storage = chrome.storage.local) {
    const settings = normalizeSettings(nextSettings);
    await storage.set({
      [SETTINGS_KEY]: settings,
      isEnabled: settings.enabled,
      friendlyMode: settings.protectionMode === PROTECTION_MODES.SAFE
    });
    return settings;
  }

  // src/settings-package/schema.js
  var SETTINGS_PACKAGE_SCHEMA = "adsfriendly.settings-package.v1";
  var SETTINGS_PACKAGE_STATE_KEY = "settingsPackageState";
  var BUNDLED_SETTINGS_PACKAGE_PATH = "packages/default-settings-package.json";
  var MAX_RULES = 5e3;
  var MAX_RULES_PER_SITE = 250;
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
  function createSettingsPackage(storageSnapshot = {}, metadata = {}) {
    const trustedPaths = Object.entries(storageSnapshot).filter(([key, value]) => key.startsWith("p:") && value).map(([, value]) => value);
    return normalizeSettingsPackage({
      schema_version: SETTINGS_PACKAGE_SCHEMA,
      metadata: {
        id: metadata.id || `local.${Date.now()}`,
        name: metadata.name || "AdsFriendly Settings",
        author: metadata.author || "AdsFriendly User",
        version: metadata.version || "1.0.0",
        description: metadata.description || "Exported AdsFriendly configuration",
        created_at: metadata.created_at || (/* @__PURE__ */ new Date()).toISOString()
      },
      settings: {
        app: storageSnapshot.appSettings || DEFAULT_SETTINGS,
        whitelist: storageSnapshot.whitelist || [],
        blacklist: storageSnapshot.blacklist || [],
        custom_rules: storageSnapshot.userCustomRules || {},
        trusted_paths: trustedPaths
      }
    });
  }
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
    if (oldPathKeys.length) await storage.remove(oldPathKeys);
    await storage.set({
      ...packageToStorage(settingsPackage),
      [SETTINGS_PACKAGE_STATE_KEY]: {
        schema_version: "adsfriendly.settings-package-state.v1",
        initialized: true,
        source,
        package: settingsPackage.metadata,
        installed_at: Date.now()
      }
    });
    return settingsPackage;
  }
  function summarizeSettingsPackage(packageInput) {
    const settingsPackage = normalizeSettingsPackage(packageInput);
    return {
      name: settingsPackage.metadata.name,
      author: settingsPackage.metadata.author,
      version: settingsPackage.metadata.version,
      whitelistCount: settingsPackage.settings.whitelist.length,
      blacklistCount: settingsPackage.settings.blacklist.length,
      siteCount: Object.keys(settingsPackage.settings.custom_rules).length,
      ruleCount: Object.values(settingsPackage.settings.custom_rules).reduce(
        (count, rules) => count + rules.length,
        0
      ),
      trustedPathCount: settingsPackage.settings.trusted_paths.length
    };
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
        values.map(normalizeHostname).filter(Boolean).map((hostname) => blacklist ? `||${hostname}^` : hostname)
      )
    ].slice(0, 2e3);
  }
  function normalizeCustomRules(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result = {};
    for (const [rawHostname, rawRules] of Object.entries(value)) {
      const hostname = normalizeHostname(rawHostname);
      if (!hostname || !Array.isArray(rawRules)) continue;
      const rules = rawRules.slice(0, MAX_RULES_PER_SITE).map(normalizeRule).filter(Boolean);
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
      linkDomain: normalizeHostname(fingerprint.linkDomain) || null,
      srcHost: normalizeHostname(fingerprint.srcHost) || null,
      idTokens: normalizeTokens(fingerprint.idTokens),
      classTokens: normalizeTokens(fingerprint.classTokens)
    };
  }
  function normalizeTrustedPaths(paths) {
    if (!Array.isArray(paths)) return [];
    const byKey = /* @__PURE__ */ new Map();
    for (const raw of paths.slice(0, 2e3)) {
      const source = normalizeHostname(raw?.source);
      const target = normalizeHostname(raw?.target);
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
  function normalizeHostname(value) {
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

  // src/storage/training-store.js
  var DATABASE_NAME = "adsfriendly-training";
  var DATABASE_VERSION = 1;
  var DOM_STORE = "domSamples";
  var TELEMETRY_STORE = "telemetryQueue";
  var databasePromise = null;
  async function listDomTrainingSamples(limit = 5e3) {
    return listNewest(DOM_STORE, limit);
  }
  async function clearDomTrainingSamples() {
    return clearStore(DOM_STORE);
  }
  async function clearAllTrainingData() {
    await Promise.all([clearStore(DOM_STORE), clearStore(TELEMETRY_STORE)]);
  }
  async function listNewest(storeName, limit) {
    return listByDirection(storeName, limit, "prev");
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
            keyPath: "sample_id"
          });
          store.createIndex("timestamp", "timestamp");
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
    return databasePromise;
  }
  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  // src/options/index.js
  var $ = (id) => document.getElementById(id);
  var whitelistEl = $("whitelist-list");
  var blacklistEl = $("blacklist-list");
  var domSamplesEl = $("dom-samples-container");
  var packageStatusEl = $("package-status");
  var currentSnapshot = {};
  var storageRefreshTimer = null;
  initialize().catch((error) => showPackageStatus(error.message, true));
  async function initialize() {
    bindStaticActions();
    chrome.storage.onChanged.addListener(handleStorageChange);
    window.addEventListener(
      "unload",
      () => chrome.storage.onChanged.removeListener(handleStorageChange)
    );
    await loadPage();
  }
  function handleStorageChange(changes, areaName) {
    if (areaName !== "local") return;
    const keys = Object.keys(changes);
    const affectsSettings = keys.some(
      (key) => [
        "appSettings",
        "whitelist",
        "blacklist",
        "userCustomRules",
        SETTINGS_PACKAGE_STATE_KEY
      ].includes(key) || key.startsWith("p:")
    );
    if (!affectsSettings) return;
    clearTimeout(storageRefreshTimer);
    storageRefreshTimer = setTimeout(() => {
      loadPage().catch((error) => showPackageStatus(error.message, true));
    }, 80);
  }
  function bindStaticActions() {
    $("btn-package-export").onclick = exportSettingsPackage;
    $("btn-package-import").onclick = () => $("package-file-input").click();
    $("package-file-input").onchange = importSettingsPackage;
    $("btn-package-default").onclick = restoreBundledDefault;
    $("settings-mode").onchange = saveProtectionControls;
    $("settings-enabled").onchange = saveProtectionControls;
    $("btn-whitelist-add").onclick = () => addDomain("whitelist");
    $("btn-blacklist-add").onclick = () => addDomain("blacklist");
    $("whitelist-input").onkeydown = (event) => {
      if (event.key === "Enter") addDomain("whitelist");
    };
    $("blacklist-input").onkeydown = (event) => {
      if (event.key === "Enter") addDomain("blacklist");
    };
    $("btn-dom-refresh").onclick = renderDomSamples;
    $("btn-dom-export").onclick = exportDomSamples;
    $("btn-dom-clear").onclick = clearDomSamples;
    $("btn-reset").onclick = factoryReset;
    bindFeedbackForm();
  }
  async function loadPage() {
    currentSnapshot = await chrome.storage.local.get(null);
    const settings = await loadSettings();
    currentSnapshot.appSettings = settings;
    $("settings-enabled").checked = settings.enabled;
    $("settings-mode").value = settings.protectionMode;
    renderPackageStatus();
    renderStorageHealth();
    renderDomainList(currentSnapshot.whitelist || [], whitelistEl, "whitelist");
    renderDomainList(currentSnapshot.blacklist || [], blacklistEl, "blacklist");
    renderCustomRules();
    renderNavigationLogs(currentSnapshot.blockedLogs || []);
    renderLearnedPaths();
    renderDomSamples();
  }
  async function renderStorageHealth() {
    const element = $("storage-health");
    try {
      const health = await chrome.runtime.sendMessage({
        type: "GET_STORAGE_HEALTH"
      });
      if (health?.status !== "ok")
        throw new Error(health?.error || "Storage health check failed.");
      const size = Number.isFinite(health.bytesInUse) ? `${(health.bytesInUse / 1048576).toFixed(2)} MiB settings` : "settings storage ready";
      element.textContent = `${size} \xB7 training database separate \xB7 ${health.unlimited ? "large-dataset storage enabled" : "storage limit active"}`;
      element.style.color = health.unlimited ? "#22c55e" : "#f59e0b";
    } catch (error) {
      element.textContent = `Storage unavailable \xB7 ${error.message}`;
      element.style.color = "#f87171";
    }
  }
  function renderPackageStatus() {
    const settingsPackage = createSettingsPackage(currentSnapshot, {
      name: $("package-name").value || "My AdsFriendly Settings",
      author: $("package-author").value || "AdsFriendly User"
    });
    const summary = summarizeSettingsPackage(settingsPackage);
    const state = currentSnapshot[SETTINGS_PACKAGE_STATE_KEY];
    const metadata = state?.package;
    if (metadata) {
      $("package-name").value = metadata.name || $("package-name").value;
      $("package-author").value = metadata.author || $("package-author").value;
    }
    $("package-source").textContent = String(
      state?.source || "local"
    ).toUpperCase();
    showPackageStatus(
      `${summary.siteCount} sites \xB7 ${summary.ruleCount} element rules \xB7 ${summary.whitelistCount} trusted \xB7 ${summary.blacklistCount} blocked \xB7 ${summary.trustedPathCount} workflows`
    );
  }
  async function saveProtectionControls() {
    await saveSettings({
      ...currentSnapshot.appSettings || {},
      enabled: $("settings-enabled").checked,
      protectionMode: $("settings-mode").value
    });
    await loadPage();
  }
  async function exportSettingsPackage() {
    const snapshot = await chrome.storage.local.get(null);
    const settingsPackage = createSettingsPackage(snapshot, {
      id: `user.${Date.now()}`,
      name: $("package-name").value,
      author: $("package-author").value,
      version: "1.0.0"
    });
    downloadText(
      `${slug(settingsPackage.metadata.name)}.afsettings.json`,
      JSON.stringify(settingsPackage, null, 2),
      "application/json"
    );
    showPackageStatus("Settings package exported.");
  }
  async function importSettingsPackage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const settingsPackage = normalizeSettingsPackage(
        JSON.parse(await file.text())
      );
      const summary = summarizeSettingsPackage(settingsPackage);
      const accepted = confirm(
        `Install \u201C${summary.name}\u201D by ${summary.author}?

${summary.ruleCount} element rules across ${summary.siteCount} sites
${summary.whitelistCount} trusted domains
${summary.blacklistCount} blocked domains
${summary.trustedPathCount} trusted workflows

This replaces the current shareable settings. Diagnostics and training samples are preserved.`
      );
      if (!accepted) return;
      await replaceSettingsWithPackage(
        settingsPackage,
        chrome.storage.local,
        "imported"
      );
      await loadPage();
      showPackageStatus(`Installed \u201C${summary.name}\u201D.`);
    } catch (error) {
      showPackageStatus(`Import failed: ${error.message}`, true);
    }
  }
  async function restoreBundledDefault() {
    if (!confirm(
      "Replace current shareable settings with the bundled default package?"
    )) {
      return;
    }
    try {
      const settingsPackage = await loadBundledPackage();
      await replaceSettingsWithPackage(
        settingsPackage,
        chrome.storage.local,
        "bundled"
      );
      await loadPage();
      showPackageStatus("Bundled default settings restored.");
    } catch (error) {
      showPackageStatus(`Could not restore default: ${error.message}`, true);
    }
  }
  async function loadBundledPackage() {
    const response = await fetch(
      chrome.runtime.getURL(BUNDLED_SETTINGS_PACKAGE_PATH)
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return normalizeSettingsPackage(await response.json());
  }
  async function addDomain(type) {
    const input = $(`${type}-input`);
    const hostname = normalizeHostname2(input.value);
    if (!hostname) {
      alert("Enter a valid hostname, for example: example.com");
      return;
    }
    const { whitelist = [], blacklist = [] } = await chrome.storage.local.get([
      "whitelist",
      "blacklist"
    ]);
    if (type === "whitelist") {
      const nextWhitelist = [.../* @__PURE__ */ new Set([...whitelist, hostname])];
      const nextBlacklist = blacklist.filter(
        (value) => normalizeHostname2(value) !== hostname
      );
      await chrome.storage.local.set({
        whitelist: nextWhitelist,
        blacklist: nextBlacklist
      });
    } else {
      const rule = `||${hostname}^`;
      const nextBlacklist = [.../* @__PURE__ */ new Set([...blacklist, rule])];
      const nextWhitelist = whitelist.filter(
        (value) => normalizeHostname2(value) !== hostname
      );
      await chrome.storage.local.set({
        whitelist: nextWhitelist,
        blacklist: nextBlacklist
      });
    }
    input.value = "";
    await loadPage();
  }
  function renderDomainList(list, element, type) {
    if (!list.length) {
      element.innerHTML = '<div class="empty-msg">No sites added yet</div>';
      return;
    }
    element.innerHTML = list.map(
      (domain, index) => `
        <div class="item">
          <span>${safeText(domain)}</span>
          <button class="btn-delete" data-index="${index}" title="Remove">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>`
    ).join("");
    element.querySelectorAll(".btn-delete").forEach((button) => {
      button.onclick = async () => {
        const current = await chrome.storage.local.get(type);
        const updated = [...current[type] || []];
        updated.splice(Number(button.dataset.index), 1);
        await chrome.storage.local.set({ [type]: updated });
        await loadPage();
      };
    });
  }
  function renderCustomRules() {
    const container = $("custom-rules-container");
    const rulesByHost = currentSnapshot.userCustomRules || {};
    const hostnames = Object.keys(rulesByHost).sort();
    if (!hostnames.length) {
      container.innerHTML = '<div class="empty-msg">No custom rules found yet.</div>';
      return;
    }
    container.innerHTML = hostnames.map((hostname) => {
      const rules = rulesByHost[hostname] || [];
      const details = rules.map((rule, index) => {
        const selector = typeof rule === "string" ? rule : rule.selector;
        const fingerprint = typeof rule === "object" && rule.fingerprint ? JSON.stringify(rule.fingerprint) : "Simple selector";
        return `
            <div style="display:flex; justify-content:space-between; gap:0.75rem; padding:8px 0; border-top:1px solid rgba(255,255,255,0.05); font-size:0.75rem;">
              <div style="min-width:0">
                <code style="word-break:break-all; color:#93c5fd">${safeText(selector)}</code>
                <div style="color:#64748b; margin-top:3px; word-break:break-all">${safeText(fingerprint)}</div>
              </div>
              <button class="btn-delete-rule-item btn-delete" data-host="${safeText(hostname)}" data-index="${index}" title="Delete rule">Delete</button>
            </div>`;
      }).join("");
      return `
        <div class="rule-site" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); padding:12px; border-radius:12px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem">
            <div>
              <div style="font-weight:bold; color:#e2e8f0">${safeText(hostname)}</div>
              <div style="font-size:0.75rem; color:#64748b">${rules.length} active rules</div>
            </div>
            <div style="display:flex; gap:8px">
              <button class="toggle-details btn-secondary">Details</button>
              <button class="reset-site-rules btn-secondary" data-host="${safeText(hostname)}">Reset site</button>
            </div>
          </div>
          <div class="details-pane" style="display:none; margin-top:10px">${details}</div>
        </div>`;
    }).join("");
    container.querySelectorAll(".toggle-details").forEach((button) => {
      button.onclick = () => {
        const pane = button.closest(".rule-site").querySelector(".details-pane");
        pane.style.display = pane.style.display === "none" ? "block" : "none";
      };
    });
    container.querySelectorAll(".btn-delete-rule-item").forEach((button) => {
      button.onclick = async () => {
        const rules = structuredClone(currentSnapshot.userCustomRules || {});
        rules[button.dataset.host].splice(Number(button.dataset.index), 1);
        if (!rules[button.dataset.host].length) delete rules[button.dataset.host];
        await chrome.storage.local.set({ userCustomRules: rules });
        await loadPage();
      };
    });
    container.querySelectorAll(".reset-site-rules").forEach((button) => {
      button.onclick = async () => {
        const hostname = button.dataset.host;
        if (!confirm(`Remove all packaged and personal rules for ${hostname}?`))
          return;
        const rules = structuredClone(currentSnapshot.userCustomRules || {});
        const removed = rules[hostname] || [];
        delete rules[hostname];
        const siteResetHistory = structuredClone(
          currentSnapshot.siteResetHistory || {}
        );
        siteResetHistory[hostname] = { oldRules: removed, timestamp: Date.now() };
        await chrome.storage.local.set({
          userCustomRules: rules,
          siteResetHistory
        });
        await loadPage();
      };
    });
  }
  function renderLearnedPaths() {
    const container = $("learned-paths-container");
    const entries = Object.entries(currentSnapshot).filter(([key]) => key.startsWith("p:")).sort(([, a], [, b]) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    if (!entries.length) {
      container.innerHTML = '<div class="empty-msg">No learned workflows yet.</div>';
      return;
    }
    container.innerHTML = entries.map(
      ([key, path]) => `
      <div class="item">
        <div>
          <div style="font-size:0.85rem; font-weight:bold">${safeText(path.source)} \u2192 ${safeText(path.target)}</div>
          <div style="font-size:0.7rem; color:${path.isManual ? "#a855f7" : "#22c55e"}">${path.isManual ? "MANUAL TRUST" : `Natural habit (${Number(path.visits) || 0} visits)`}</div>
        </div>
        <button class="btn-delete delete-path" data-key="${safeText(key)}">Delete</button>
      </div>`
    ).join("");
    container.querySelectorAll(".delete-path").forEach((button) => {
      button.onclick = async () => {
        await chrome.storage.local.remove(button.dataset.key);
        await loadPage();
      };
    });
  }
  function renderNavigationLogs(logs) {
    const container = $("blocked-logs-container");
    if (!logs.length) {
      container.innerHTML = '<div class="empty-msg">Clean history. No suspicious navigations blocked recently.</div>';
      return;
    }
    container.innerHTML = logs.slice(0, 20).map(
      (log) => `
      <div class="item" style="flex-direction:column; align-items:flex-start; gap:4px">
        <div style="font-size:0.8rem; color:#fbd38d; font-weight:bold">Blocked Navigation</div>
        <div style="font-family:monospace; font-size:0.75rem; word-break:break-all">Target: ${safeText(log.url)}</div>
        <div style="font-size:0.7rem; color:#64748b">Source: ${safeText(log.source)} \xB7 ${safeText(new Date(log.timestamp).toLocaleString())}</div>
      </div>`
    ).join("");
  }
  async function renderDomSamples() {
    if (!domSamplesEl) return;
    const domTrainingSamples = await listDomTrainingSamples(80);
    if (!domTrainingSamples.length) {
      domSamplesEl.innerHTML = '<div class="empty-msg">No DOM samples yet.</div>';
      return;
    }
    domSamplesEl.innerHTML = [...domTrainingSamples].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 80).map((sample) => {
      const features = sample.evidence?.features || {};
      const reasons = sample.evidence?.reasons || [];
      const selector = sample.context?.selector || "unknown selector";
      const confidence = sample.context?.confidence;
      return `
        <div class="item sample-row">
          <div style="display:flex; width:100%; justify-content:space-between">
            <strong style="color:${sample.label === "ad" ? "#f87171" : "#22c55e"}">${safeText(String(sample.label || "unknown").toUpperCase())}</strong>
            <span style="font-size:0.72rem; color:#64748b">${safeText(new Date(sample.timestamp).toLocaleString())}</span>
          </div>
          <div style="font-family:monospace; font-size:0.76rem; word-break:break-all">${safeText(selector)}</div>
          <div style="font-size:0.72rem; color:#94a3b8">${safeText(sample.site?.hostname)} \xB7 ${safeText(sample.label_source)} \xB7 ${formatPct(confidence)}</div>
          <div class="sample-meta">${reasons.slice(0, 8).map(
        (reason) => `<span class="sample-chip">${safeText(reason)}</span>`
      ).join("") || '<span class="sample-chip">no reasons</span>'}</div>
          <div class="sample-meta">${[
        features.tag,
        features.id,
        features.className,
        features.hrefHost
      ].filter(Boolean).slice(0, 6).map(
        (value) => `<span class="sample-chip">${safeText(value)}</span>`
      ).join("")}</div>
        </div>`;
    }).join("");
  }
  async function exportDomSamples() {
    const domTrainingSamples = await listDomTrainingSamples(5e3);
    if (!domTrainingSamples.length) return alert("No DOM samples to export yet.");
    downloadText(
      "adsfriendly-dom-samples.jsonl",
      domTrainingSamples.map((sample) => JSON.stringify(sample)).join("\n"),
      "application/jsonl"
    );
  }
  async function clearDomSamples() {
    if (!confirm("Clear all local DOM training samples?")) return;
    await clearDomTrainingSamples();
    await renderDomSamples();
  }
  async function factoryReset() {
    if (!confirm(
      "Factory reset all memory and restore the bundled Settings Package?"
    )) {
      return;
    }
    const bundled = await loadBundledPackage();
    await chrome.storage.local.clear();
    await clearAllTrainingData();
    await replaceSettingsWithPackage(bundled, chrome.storage.local, "bundled");
    await chrome.storage.local.set({ blockedCount: 0 });
    await chrome.action.setBadgeText({ text: "" });
    await loadPage();
  }
  function bindFeedbackForm() {
    const form = $("feedback-form");
    if (!form) return;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const status = $("fb-status");
      const submit = $("fb-submit");
      const body = $("fb-body").value.trim();
      const rating = document.querySelector(
        'input[name="rating"]:checked'
      )?.value;
      const { lastFeedbackTime = 0 } = await chrome.storage.local.get("lastFeedbackTime");
      if (Date.now() - lastFeedbackTime < 36e5) {
        return showFeedbackStatus(
          "Please wait before sending feedback again.",
          true
        );
      }
      if (!body || !confirm("Send your feedback?")) return;
      submit.disabled = true;
      showFeedbackStatus("Sending\u2026");
      try {
        await fetch(
          "https://telegarmworker.ngoquangvy97.workers.dev/adsfriendly",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body, rating: Number(rating) || 5 })
          }
        );
        await chrome.storage.local.set({ lastFeedbackTime: Date.now() });
        form.reset();
        showFeedbackStatus("Sent successfully. Thank you!");
      } catch (error) {
        showFeedbackStatus(`Error: ${error.message}`, true);
      } finally {
        submit.disabled = false;
      }
      function showFeedbackStatus(message, error = false) {
        status.style.display = "block";
        status.style.color = error ? "var(--danger)" : "#22c55e";
        status.textContent = message;
      }
    };
  }
  function showPackageStatus(message, error = false) {
    packageStatusEl.textContent = message;
    packageStatusEl.style.color = error ? "#f87171" : "#94a3b8";
  }
  function downloadText(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  function normalizeHostname2(value) {
    const raw = String(value || "").trim().replace(/^\|\|/, "").replace(/\^$/, "");
    try {
      const hostname = new URL(
        raw.includes("://") ? raw : `https://${raw}`
      ).hostname.toLowerCase();
      return /^[a-z0-9.-]+$/.test(hostname) ? hostname : "";
    } catch {
      return "";
    }
  }
  function safeText(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function formatPct(value) {
    return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "n/a";
  }
  function slug(value) {
    return String(value || "adsfriendly-settings").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "adsfriendly-settings";
  }
})();
