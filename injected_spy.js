var AdsFriendlyMainWorld = (() => {
  // src/main-world/bridge.js
  function notifyContentScript(data) {
    window.postMessage({ source: "adsfriendly-spy", ...data }, "*");
  }
  function onContentMessage(handler) {
    const onMessage = (event) => {
      if (event.data?.source === "adsfriendly-content") handler(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }

  // src/main-world/manifest-analyzer.js
  var AD_MARKERS = [
    "#EXT-X-CUE-OUT",
    "#EXT-X-DATERANGE",
    "adunit",
    "vpaid",
    "doubleclick"
  ];
  function analyzeManifest(url, body) {
    if (!AD_MARKERS.some((marker) => body.includes(marker))) return;
    console.log("[AdsFriendly Spy] Ad segment detected in manifest:", url);
    notifyContentScript({ type: "AD_MAP_DETECTED", url });
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

  // src/main-world/network-capture.js
  function installNetworkCapture(policy) {
    const stopFetchCapture = installFetchCapture(policy);
    const stopXhrCapture = installXhrCapture(policy);
    return () => {
      stopFetchCapture();
      stopXhrCapture();
    };
  }
  function installFetchCapture(policy) {
    const originalFetch = window.fetch;
    const fetchWrapper = async function(...args) {
      const url = requestUrl(args[0]);
      const response = await originalFetch.apply(this, args);
      if (policy.can(CAPABILITIES.MEDIA_OBSERVE) && isManifestLike(url)) {
        response.clone().text().then((body) => analyzeManifest(url, body)).catch(() => {
        });
      }
      return response;
    };
    window.fetch = fetchWrapper;
    return () => {
      if (window.fetch === fetchWrapper) window.fetch = originalFetch;
    };
  }
  function installXhrCapture(policy) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const openWrapper = function(method, url, ...rest) {
      this.__adsfriendly_url = requestUrl(url);
      return originalOpen.call(this, method, url, ...rest);
    };
    const sendWrapper = function(...args) {
      this.addEventListener("load", () => {
        if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
        const url = this.__adsfriendly_url || "";
        if (!isManifestLike(url)) return;
        try {
          if (typeof this.responseText === "string")
            analyzeManifest(url, this.responseText);
        } catch {
        }
      });
      return originalSend.apply(this, args);
    };
    XMLHttpRequest.prototype.open = openWrapper;
    XMLHttpRequest.prototype.send = sendWrapper;
    return () => {
      if (XMLHttpRequest.prototype.open === openWrapper)
        XMLHttpRequest.prototype.open = originalOpen;
      if (XMLHttpRequest.prototype.send === sendWrapper)
        XMLHttpRequest.prototype.send = originalSend;
    };
  }
  function requestUrl(input) {
    if (!input) return "";
    if (typeof input === "string") return input;
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.href;
    return input.toString();
  }
  function isManifestLike(url = "") {
    return url.includes(".m3u8") || url.includes(".mpd") || url.includes("player/v1/player");
  }

  // src/main-world/timer-control.js
  var isAdMode = false;
  var timerPolicy = null;
  function setAdMode(value) {
    isAdMode = !!value;
    console.log("[AdsFriendly Spy] Ad mode changed:", isAdMode);
  }
  function installTimerControl(policy) {
    timerPolicy = policy;
    const originalTimeout = window.setTimeout;
    const originalInterval = window.setInterval;
    const timeoutWrapper = (handler, timeout, ...args) => originalTimeout(handler, scaled(timeout), ...args);
    const intervalWrapper = (handler, timeout, ...args) => originalInterval(handler, scaled(timeout), ...args);
    window.setTimeout = timeoutWrapper;
    window.setInterval = intervalWrapper;
    return () => {
      if (window.setTimeout === timeoutWrapper)
        window.setTimeout = originalTimeout;
      if (window.setInterval === intervalWrapper)
        window.setInterval = originalInterval;
      timerPolicy = null;
      isAdMode = false;
    };
  }
  function scaled(timeout) {
    return isAdMode && timerPolicy?.can(CAPABILITIES.VIDEO_AUTO_ACTION) && typeof timeout === "number" && timeout > 50 ? timeout / 100 : timeout;
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

  // src/runtime/main-controller.js
  function createMainController({
    context,
    implementations,
    initialSettings: initialSettings2 = null,
    watchSettings = true,
    settingsLoader = loadSettings,
    settingsSubscriber = subscribeSettings,
    logger = console
  }) {
    const catalogFeatures = getFeaturesForContext(context);
    validateImplementations(context, catalogFeatures, implementations);
    let settings = normalizeSettings(initialSettings2 || DEFAULT_SETTINGS);
    let unsubscribe = null;
    let started = false;
    const lifecycles = /* @__PURE__ */ new Map();
    const listeners = /* @__PURE__ */ new Set();
    const controller2 = {
      context,
      async start() {
        if (started) return controller2;
        started = true;
        if (!initialSettings2) settings = await settingsLoader();
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

  // src/main-world/index.js
  var script = document.currentScript;
  var initialSettings = {
    enabled: script?.dataset.protectionEnabled !== "false",
    protectionMode: script?.dataset.protectionMode || "safe"
  };
  var controller = createMainController({
    context: "main-world",
    initialSettings,
    watchSettings: false,
    implementations: {
      "main-world.network-capture": ({ policy }) => installNetworkCapture(policy),
      "main-world.timer-control": ({ policy }) => installTimerControl(policy)
    }
  });
  onContentMessage((message) => {
    if (message.type === "SET_AD_MODE") setAdMode(message.value);
    if (message.type === "PROTECTION_SETTINGS_CHANGED")
      controller.updateSettings(message.settings);
  });
  console.log("[AdsFriendly Spy] Injected and controlled by MainController.");
  controller.start().catch(
    (error) => console.error("[AdsFriendly Spy] MainController failed", error)
  );
})();
