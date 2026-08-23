var AdsFriendlyVideo = (() => {
  // src/video/state.js
  var videoState = {
    activeAds: /* @__PURE__ */ new Set(),
    cachedPatterns: [],
    currentAdDensity: 0,
    siteTrustScore: 0.5,
    initialized: false
  };

  // src/shared/pattern-store.js
  var VIDEO_PATTERN_TYPES = /* @__PURE__ */ new Set([
    "video_source_marker",
    "video_marker"
  ]);
  async function getGlobalPatterns() {
    const { globalAdPatterns = [] } = await chrome.storage.local.get("globalAdPatterns");
    return Array.isArray(globalAdPatterns) ? globalAdPatterns : [];
  }
  async function getVideoPatterns() {
    return (await getGlobalPatterns()).filter(
      (pattern) => VIDEO_PATTERN_TYPES.has(pattern?.type)
    );
  }

  // src/video/patterns.js
  async function loadPatternsAndReputation() {
    try {
      const { siteReputation = {} } = await chrome.storage.local.get("siteReputation");
      videoState.cachedPatterns = await getVideoPatterns();
      const rep = siteReputation[location.hostname];
      if (rep) videoState.siteTrustScore = rep.trustScore;
      console.log(
        `[AdsFriendly Video] Brain Synced. Site Trust: ${videoState.siteTrustScore.toFixed(2)}`
      );
    } catch {
    }
  }

  // src/video/spy-bridge.js
  function notifySpy(adMode) {
    window.postMessage(
      { source: "adsfriendly-content", type: "SET_AD_MODE", value: adMode },
      "*"
    );
  }
  function startSpyBridge(onAdDetected) {
    window.addEventListener("message", (event) => {
      if (event.data?.source === "adsfriendly-spy" && event.data.type === "AD_MAP_DETECTED")
        onAdDetected();
      if (event.data?.source === "adsfriendly-content" && event.data.type === "AD_DENSITY_VALUE" && window.AdsFriendlyVideoState)
        window.AdsFriendlyVideoState.currentAdDensity = event.data.value;
    });
  }

  // src/video/actions.js
  function accelerate(video) {
    if (video.playbackRate >= 16) return;
    console.log(
      "[AdsFriendly Video] Neutralizing Ad:",
      video.src || "Dynamic Stream"
    );
    video.playbackRate = 16;
    video.muted = true;
    videoState.activeAds.add(video);
    notifyBrainOfAdState(video);
  }
  function restore(video) {
    if (!videoState.activeAds.has(video)) return;
    console.log("[AdsFriendly Video] Ad finished. Restoring content speed.");
    video.playbackRate = 1;
    video.muted = false;
    videoState.activeAds.delete(video);
    notifySpy(false);
  }
  function notifyBrainOfAdState(video) {
    const player = video.closest('[class*="player"]');
    if (!player) return;
    chrome.runtime.sendMessage({
      type: "SYNC_VIDEO_LEARNING",
      hostname: location.hostname,
      classes: player.className,
      duration: video.duration
    });
  }

  // src/video/scoring.js
  function calculateAdScore(video) {
    let score = 0;
    const src = video.currentSrc || video.src || "";
    if (!src) return 0;
    videoState.cachedPatterns.forEach((p) => {
      if (p.type === "video_source_marker" && src.includes(p.value)) score += 0.8;
      if (p.type === "video_marker" && video.closest(p.value)) score += 0.6;
    });
    if (videoState.siteTrustScore < 0.3) score += 0.3;
    if (videoState.siteTrustScore > 0.8) score -= 0.6;
    if (videoState.currentAdDensity > 5) score += 0.2;
    if (videoState.currentAdDensity > 15) score += 0.4;
    const external = !src.startsWith("blob:") && !src.includes(location.hostname);
    if (external) {
      score += 0.3;
      if (src.includes("githubusercontent.com") || src.includes("github.io"))
        score += 0.2;
      if (src.toLowerCase().endsWith(".mp4")) score += 0.2;
    }
    if (video.duration > 0 && video.duration < 65) score += 0.2;
    if (video.duration > 300) score -= 1;
    return Math.min(1, score);
  }
  function isAdVideo(video) {
    return calculateAdScore(video) >= 0.8;
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

  // src/video/observer.js
  var videoPolicy = null;
  function setVideoPolicy(policy) {
    videoPolicy = policy;
  }
  function scanAndObserveVideos() {
    document.querySelectorAll("video").forEach((video) => {
      if (video.dataset.observed) return;
      video.dataset.observed = "true";
      attach(video);
      checkAndExecute(video);
    });
  }
  function checkAllVideos() {
    document.querySelectorAll("video").forEach(checkAndExecute);
  }
  function attach(video) {
    const observer = new MutationObserver(() => checkAndExecute(video));
    observer.observe(video, { attributes: true, attributeFilter: ["src"] });
    video.addEventListener("play", () => checkAndExecute(video));
    video.addEventListener("playing", () => checkAndExecute(video));
  }
  function checkAndExecute(video) {
    const score = calculateAdScore(video);
    if (score >= 0.8 && videoPolicy?.can(CAPABILITIES.VIDEO_AUTO_ACTION)) {
      console.log(
        `[AdsFriendly Video] Neutralizing Ad (${(score * 100).toFixed(0)}%)`
      );
      accelerate(video);
      notifySpy(true);
    } else {
      restore(video);
      notifySpy(false);
    }
  }

  // src/video/skip.js
  var SKIP_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-container",
    ".videoAdUiSkipButton",
    ".fluid_ad_skip_button",
    'button[class*="skip"]',
    '[aria-label*="Skip ad"]'
  ];
  function autoSkip(policy) {
    if (!policy?.can(CAPABILITIES.VIDEO_AUTO_ACTION)) return;
    SKIP_SELECTORS.forEach((selector) => {
      const button = document.querySelector(selector);
      clickIfVisible(button);
    });
    document.querySelectorAll('button, div[role="button"], span[role="button"]').forEach((button) => {
      const text = button.textContent.toLowerCase();
      if ((text.includes("skip") || text.includes("b\u1ECF qua")) && (text.includes("ad") || text.includes("qu\u1EA3ng")) && isVisible(button)) {
        clickIfVisible(button);
      }
    });
  }
  function clickIfVisible(element) {
    if (!isVisible(element) || typeof element.click !== "function") return;
    element.click();
  }
  function isVisible(element) {
    if (!element) return false;
    return element.offsetParent !== null || element.getClientRects().length > 0;
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

  // src/video/index.js
  function startVideoSurgeon(policy) {
    if (videoState.initialized) return;
    videoState.initialized = true;
    setVideoPolicy(policy);
    window.AdsFriendlyVideoState = videoState;
    console.log("[AdsFriendly Video] Surgeon controlled by MainController.");
    loadPatternsAndReputation();
    scanAndObserveVideos();
    startBodyObserver();
    setInterval(() => autoSkip(policy), 500);
    startSpyBridge(checkAllVideos);
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "SYNC_LEARNING") loadPatternsAndReputation();
    });
    window.VideoSurgeon = {
      accelerate,
      calculateAdScore,
      isAdVideo,
      scanAndObserve: scanAndObserveVideos
    };
  }
  function startBodyObserver() {
    const start = () => {
      if (document.body) {
        const observer = new MutationObserver(scanAndObserveVideos);
        observer.observe(document.body, { childList: true, subtree: true });
      } else {
        setTimeout(start, 50);
      }
    };
    start();
  }
  var controller = createMainController({
    context: "video",
    implementations: {
      "video.surgeon": ({ policy }) => startVideoSurgeon(policy)
    }
  });
  controller.start().catch(
    (error) => console.error("[AdsFriendly Video] MainController failed", error)
  );
})();
