var AdsFriendlyPopup = (() => {
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
    VIDEO_OBSERVE: "video.observe",
    VIDEO_RESTORE_STATE: "video.restore_state",
    VIDEO_USER_ACTION: "video.user_action",
    VIDEO_AUTO_ACTION: "video.auto_action"
  });
  var C = CAPABILITIES;
  var T = CAPABILITY_TRIGGERS;
  var MODE_RANK = Object.freeze({
    [PROTECTION_MODES.SAFE]: 0,
    [PROTECTION_MODES.ASSIST]: 1,
    [PROTECTION_MODES.AUTO]: 2
  });
  var CAPABILITY_CATALOG = Object.freeze({
    [C.CORE_MESSAGING]: capability(C.CORE_MESSAGING, "safe", T.CORE, {
      availableWhenDisabled: true
    }),
    [C.CORE_MAINTENANCE]: capability(C.CORE_MAINTENANCE, "safe", T.CORE, {
      availableWhenDisabled: true
    }),
    [C.NAVIGATION_GUARD]: capability(C.NAVIGATION_GUARD, "safe", T.AUTOMATIC),
    [C.NAVIGATION_REVERSE_POPUNDER]: capability(
      C.NAVIGATION_REVERSE_POPUNDER,
      "safe",
      T.AUTOMATIC
    ),
    [C.NAVIGATION_INTENT]: capability(C.NAVIGATION_INTENT, "safe", T.PASSIVE),
    [C.NAVIGATION_FEEDBACK]: capability(C.NAVIGATION_FEEDBACK, "safe", T.USER),
    [C.DOM_STATIC_RULES]: capability(C.DOM_STATIC_RULES, "safe", T.AUTOMATIC),
    [C.DOM_OBSERVE]: capability(C.DOM_OBSERVE, "assist", T.PASSIVE),
    [C.DOM_SUGGEST]: capability(C.DOM_SUGGEST, "assist", T.SUGGESTION),
    [C.DOM_AUTO_HIDE]: capability(C.DOM_AUTO_HIDE, "auto", T.AUTOMATIC),
    [C.DOM_MANUAL_PICKER]: capability(C.DOM_MANUAL_PICKER, "safe", T.USER),
    [C.LEARNING_SEED]: capability(C.LEARNING_SEED, "safe", T.STORAGE),
    [C.LEARNING_FEEDBACK]: capability(C.LEARNING_FEEDBACK, "safe", T.USER),
    [C.LEARNING_APPLY]: capability(C.LEARNING_APPLY, "auto", T.AUTOMATIC),
    [C.TELEMETRY_QUEUE]: capability(C.TELEMETRY_QUEUE, "safe", T.STORAGE),
    [C.MEDIA_OBSERVE]: capability(C.MEDIA_OBSERVE, "assist", T.PASSIVE),
    [C.VIDEO_OBSERVE]: capability(C.VIDEO_OBSERVE, "assist", T.PASSIVE),
    [C.VIDEO_RESTORE_STATE]: capability(C.VIDEO_RESTORE_STATE, "safe", T.CORE, {
      availableWhenDisabled: true
    }),
    [C.VIDEO_USER_ACTION]: capability(C.VIDEO_USER_ACTION, "assist", T.USER),
    [C.VIDEO_AUTO_ACTION]: capability(C.VIDEO_AUTO_ACTION, "auto", T.AUTOMATIC)
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
    feature("video.surgeon", "video", C.VIDEO_OBSERVE, [
      C.VIDEO_RESTORE_STATE,
      C.VIDEO_USER_ACTION,
      C.VIDEO_AUTO_ACTION
    ]),
    feature("picker.controller", "picker", C.DOM_MANUAL_PICKER, [
      C.LEARNING_FEEDBACK
    ]),
    feature("main-world.network-capture", "main-world", C.MEDIA_OBSERVE),
    feature("main-world.timer-control", "main-world", C.VIDEO_AUTO_ACTION)
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
  function assertRegisteredCapability(capabilityId) {
    if (!CAPABILITY_SET.has(capabilityId) || !CAPABILITY_CATALOG[capabilityId]) {
      throw new Error(
        `[FeatureRegistry] Unknown capability "${capabilityId}". Register it in feature-catalog.js before use.`
      );
    }
    return capabilityId;
  }
  function getCapabilitiesForMode(mode) {
    assertProtectionMode(mode);
    return MODE_CAPABILITIES[mode];
  }
  function capability(id, minMode, trigger, { availableWhenDisabled = false, browserPermissions = [] } = {}) {
    return Object.freeze({
      id,
      minMode,
      trigger,
      availableWhenDisabled,
      browserPermissions: Object.freeze([...browserPermissions])
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
    const updates = {
      [SETTINGS_KEY]: settings2,
      isEnabled: settings2.enabled,
      friendlyMode: settings2.protectionMode === PROTECTION_MODES.SAFE
    };
    await storage.set(updates);
    const saved = await storage.get(Object.keys(updates));
    for (const [key, expected] of Object.entries(updates)) {
      if (JSON.stringify(saved[key]) !== JSON.stringify(expected))
        throw new Error(`Could not verify saved setting: ${key}.`);
    }
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
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!tab) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" });
      window.close();
    } catch (error) {
      console.error("Could not start picker:", error);
    }
  });
  document.getElementById("reset-rules-btn").addEventListener("click", async () => {
    const button = document.getElementById("reset-rules-btn");
    await runRuleButtonAction(button, "Resetting\u2026", async () => {
      const tab = await getActiveHttpTab();
      if (!tab) return false;
      const hostname = new URL(tab.url).hostname;
      const { userCustomRules = {} } = await chrome.storage.local.get("userCustomRules");
      const selectors = (userCustomRules[hostname] || []).map((rule) => typeof rule === "string" ? rule : rule?.selector).filter(Boolean);
      if (!selectors.length) return false;
      const response = await chrome.runtime.sendMessage({
        type: "REMOVE_CUSTOM_RULES",
        hostname,
        selectors
      });
      if (response?.status !== "saved")
        throw new Error(response?.error || "Could not remove site rules.");
      await chrome.tabs.reload(tab.id);
      window.close();
    });
  });
  document.getElementById("undo-btn").addEventListener("click", async () => {
    const button = document.getElementById("undo-btn");
    await runRuleButtonAction(button, "Restoring\u2026", async () => {
      const tab = await getActiveHttpTab();
      if (!tab) return false;
      const hostname = new URL(tab.url).hostname;
      const { userCustomRules = {} } = await chrome.storage.local.get("userCustomRules");
      const rules = userCustomRules[hostname];
      if (!rules?.length) return false;
      const undoneRule = rules.at(-1);
      const selector = typeof undoneRule === "string" ? undoneRule : undoneRule?.selector;
      const response = await chrome.runtime.sendMessage({
        type: "RESTORE_CUSTOM_RULES",
        hostname,
        selectors: [selector]
      });
      if (response?.status !== "saved")
        throw new Error(response?.error || "Could not restore the last rule.");
      if (undoneRule?.fingerprint) {
        await chrome.runtime.sendMessage({
          type: "NEGATIVE_LEARNING",
          fingerprint: undoneRule.fingerprint
        });
      }
      await chrome.tabs.reload(tab.id);
      window.close();
    });
  });
  async function runRuleButtonAction(button, workingText, action) {
    button.dataset.originalHtml ||= button.innerHTML;
    button.disabled = true;
    button.textContent = workingText;
    button.title = "";
    try {
      const completed = await action();
      if (completed === false) {
        button.disabled = false;
        button.innerHTML = button.dataset.originalHtml;
      }
    } catch (error) {
      button.disabled = false;
      button.textContent = "Failed \xB7 Retry";
      button.title = error?.message || String(error);
    }
  }
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
