var AdsFriendlyPopup = (() => {
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
    const settings2 = migrateLegacySettings(stored);
    if (!stored[SETTINGS_KEY]) await storage.set({ [SETTINGS_KEY]: settings2 });
    return settings2;
  }
  async function saveSettings(nextSettings, storage = chrome.storage.local) {
    const settings2 = normalizeSettings(nextSettings);
    await storage.set({
      [SETTINGS_KEY]: settings2,
      isEnabled: settings2.enabled,
      friendlyMode: settings2.protectionMode === PROTECTION_MODES.SAFE
    });
    return settings2;
  }

  // src/popup/index.js
  var blockedCountElement = document.getElementById("blocked-count");
  var statusToggle = document.getElementById("status-toggle");
  var modeSelect = document.getElementById("protection-mode-select");
  var modeDescription = document.getElementById("mode-description");
  var MODE_DESCRIPTIONS = Object.freeze({
    safe: "Verified rules; no predictive DOM actions",
    assist: "Detect and ask before hiding",
    auto: "Allow registered automatic actions"
  });
  var settings = null;
  initialize().catch(
    (error) => console.error("[AdsFriendly Popup] initialization failed", error)
  );
  statusToggle.addEventListener("change", async () => {
    settings = await saveSettings({
      ...settings,
      enabled: statusToggle.checked
    });
    await renderMode();
  });
  modeSelect.addEventListener("change", async () => {
    settings = await saveSettings({
      ...settings,
      protectionMode: modeSelect.value
    });
    await renderMode();
  });
  document.getElementById("settings-btn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById("magic-wand-btn").addEventListener("click", async () => {
    if (!settings.enabled || !getCapabilitiesForMode(settings.protectionMode).includes(
      CAPABILITIES.DOM_MANUAL_PICKER
    )) {
      alert("Manual picker is disabled by the current protection policy.");
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" });
      window.close();
    } catch (error) {
      console.error("Could not start picker:", error);
    }
  });
  document.getElementById("reset-rules-btn").addEventListener("click", async () => {
    const tab = await getActiveHttpTab();
    if (!tab) return;
    const hostname = new URL(tab.url).hostname;
    const { userCustomRules = {} } = await chrome.storage.local.get("userCustomRules");
    if (!userCustomRules[hostname]) return;
    delete userCustomRules[hostname];
    await chrome.storage.local.set({ userCustomRules });
    await chrome.tabs.reload(tab.id);
    window.close();
  });
  document.getElementById("undo-btn").addEventListener("click", async () => {
    const tab = await getActiveHttpTab();
    if (!tab) return;
    const hostname = new URL(tab.url).hostname;
    const { userCustomRules = {} } = await chrome.storage.local.get("userCustomRules");
    const rules = userCustomRules[hostname];
    if (!rules?.length) return;
    const undoneRule = rules.pop();
    await chrome.storage.local.set({ userCustomRules });
    if (undoneRule?.fingerprint) {
      await chrome.runtime.sendMessage({
        type: "NEGATIVE_LEARNING",
        fingerprint: undoneRule.fingerprint
      });
    }
    await chrome.tabs.reload(tab.id);
    window.close();
  });
  setInterval(updateBlockedCount, 1e3);
  async function initialize() {
    settings = await loadSettings();
    await render();
  }
  async function render() {
    statusToggle.checked = settings.enabled;
    modeSelect.value = settings.protectionMode;
    await updateBlockedCount();
    await renderMode();
    const tab = await getActiveHttpTab();
    if (!tab) return;
    const hostname = new URL(tab.url).hostname;
    const { userCustomRules = {} } = await chrome.storage.local.get("userCustomRules");
    document.getElementById("undo-section").style.display = userCustomRules[hostname]?.length > 0 ? "block" : "none";
  }
  async function renderMode() {
    modeSelect.disabled = !settings.enabled;
    modeDescription.textContent = settings.enabled ? MODE_DESCRIPTIONS[settings.protectionMode] : "All protection features are disabled";
  }
  async function updateBlockedCount() {
    const { blockedCount = 0 } = await chrome.storage.local.get("blockedCount");
    blockedCountElement.textContent = blockedCount;
  }
  async function getActiveHttpTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url?.startsWith("http") ? tab : null;
  }
})();
