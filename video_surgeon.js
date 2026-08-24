var AdsFriendlyVideo = (() => {
  // src/video/state.js
  var videoState = {
    activeAds: /* @__PURE__ */ new Set(),
    playbackSnapshots: /* @__PURE__ */ new WeakMap(),
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

  // src/video/spy-bridge.js
  function notifySpy(adMode) {
    window.postMessage(
      { source: "adsfriendly-content", type: "SET_AD_MODE", value: adMode },
      "*"
    );
  }
  function startSpyBridge(onAdDetected) {
    const onMessage = (event) => {
      if (event.data?.source === "adsfriendly-spy" && event.data.type === "AD_MAP_DETECTED")
        onAdDetected();
      if (event.data?.source === "adsfriendly-content" && event.data.type === "AD_DENSITY_VALUE" && window.AdsFriendlyVideoState)
        window.AdsFriendlyVideoState.currentAdDensity = event.data.value;
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
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
    feature("background.media-download-jobs", "background", C2.MEDIA_DOWNLOAD),
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
    feature("video.surgeon", "video", C2.VIDEO_OBSERVE, [
      C2.VIDEO_RESTORE_STATE,
      C2.VIDEO_USER_ACTION,
      C2.VIDEO_AUTO_ACTION
    ]),
    feature("picker.controller", "picker", C2.DOM_MANUAL_PICKER, [
      C2.LEARNING_FEEDBACK
    ]),
    feature("main-world.network-capture", "main-world", C2.MEDIA_OBSERVE),
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

  // src/runtime/action-catalog.js
  var ACTIONS = Object.freeze({
    MEDIA_DOWNLOAD_CREATE: "media.download.create",
    VIDEO_ACCELERATE_AUTOMATIC: "video.accelerate.automatic",
    VIDEO_ACCELERATE_USER: "video.accelerate.user",
    VIDEO_RESTORE_PLAYBACK: "video.restore_playback",
    VIDEO_SKIP_AUTOMATIC: "video.skip.automatic"
  });
  var A = ACTIONS;
  var C3 = CAPABILITIES;
  var ACTION_CATALOG = Object.freeze({
    [A.MEDIA_DOWNLOAD_CREATE]: action(
      A.MEDIA_DOWNLOAD_CREATE,
      "background.media-download-jobs",
      C3.MEDIA_DOWNLOAD
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

  // src/video/observer.js
  var videoActions = null;
  var attachments = /* @__PURE__ */ new Map();
  function setVideoActions(actions) {
    videoActions = actions;
  }
  function scanAndObserveVideos() {
    document.querySelectorAll("video").forEach((video) => {
      if (video.dataset.adsfriendlyVideoObserved) return;
      video.dataset.adsfriendlyVideoObserved = "true";
      attach(video);
      checkAndExecute(video);
    });
  }
  function checkAllVideos() {
    document.querySelectorAll("video").forEach(checkAndExecute);
  }
  function stopObservingVideos() {
    for (const [video, attachment] of attachments) {
      attachment.observer.disconnect();
      video.removeEventListener("play", attachment.onPlayback);
      video.removeEventListener("playing", attachment.onPlayback);
      delete video.dataset.adsfriendlyVideoObserved;
    }
    attachments.clear();
    videoActions = null;
  }
  function attach(video) {
    const observer = new MutationObserver(() => checkAndExecute(video));
    observer.observe(video, { attributes: true, attributeFilter: ["src"] });
    const onPlayback = () => checkAndExecute(video);
    video.addEventListener("play", onPlayback);
    video.addEventListener("playing", onPlayback);
    attachments.set(video, { observer, onPlayback });
  }
  function checkAndExecute(video) {
    const score = calculateAdScore(video);
    if (score >= 0.8 && videoActions?.can(ACTIONS.VIDEO_ACCELERATE_AUTOMATIC)) {
      console.log(
        `[AdsFriendly Video] Neutralizing Ad (${(score * 100).toFixed(0)}%)`
      );
      execute(ACTIONS.VIDEO_ACCELERATE_AUTOMATIC, video);
      notifySpy(true);
    } else {
      execute(ACTIONS.VIDEO_RESTORE_PLAYBACK, video);
      notifySpy(false);
    }
  }
  function execute(actionId, video) {
    if (!videoActions?.can(actionId)) return;
    videoActions.execute(actionId, video).catch(
      (error) => console.error(`[AdsFriendly Video] Action ${actionId} failed`, error)
    );
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
  function skipVisibleAds() {
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

  // src/video/actions.js
  function accelerate(video) {
    if (video.playbackRate >= 16) return;
    console.log(
      "[AdsFriendly Video] Neutralizing Ad:",
      video.src || "Dynamic Stream"
    );
    if (!videoState.activeAds.has(video)) {
      videoState.playbackSnapshots.set(video, {
        playbackRate: video.playbackRate,
        muted: video.muted
      });
    }
    video.playbackRate = 16;
    video.muted = true;
    videoState.activeAds.add(video);
    notifyBrainOfAdState(video);
  }
  function restore(video) {
    if (!videoState.activeAds.has(video)) return;
    console.log("[AdsFriendly Video] Ad finished. Restoring content speed.");
    const snapshot = videoState.playbackSnapshots.get(video);
    video.playbackRate = snapshot?.playbackRate ?? 1;
    video.muted = snapshot?.muted ?? false;
    videoState.activeAds.delete(video);
    videoState.playbackSnapshots.delete(video);
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

  // src/video/index.js
  function startVideoSurgeon(policy) {
    if (videoState.initialized) return;
    videoState.initialized = true;
    const actions = createActionBroker({
      featureId: "video.surgeon",
      policy,
      handlers: {
        [ACTIONS.VIDEO_ACCELERATE_AUTOMATIC]: accelerate,
        [ACTIONS.VIDEO_ACCELERATE_USER]: accelerate,
        [ACTIONS.VIDEO_RESTORE_PLAYBACK]: restore,
        [ACTIONS.VIDEO_SKIP_AUTOMATIC]: skipVisibleAds
      }
    });
    setVideoActions(actions);
    window.AdsFriendlyVideoState = videoState;
    console.log("[AdsFriendly Video] Surgeon controlled by MainController.");
    loadPatternsAndReputation();
    scanAndObserveVideos();
    const stopBodyObserver = startBodyObserver();
    const skipIntervalId = setInterval(() => {
      if (!actions.can(ACTIONS.VIDEO_SKIP_AUTOMATIC)) return;
      actions.execute(ACTIONS.VIDEO_SKIP_AUTOMATIC).catch(
        (error) => console.error("[AdsFriendly Video] Auto-skip failed", error)
      );
    }, 500);
    const stopSpyBridge = startSpyBridge(checkAllVideos);
    const onRuntimeMessage = (message) => {
      if (message.type === "SYNC_LEARNING") loadPatternsAndReputation();
    };
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    const publicApi = {
      accelerate: (video) => actions.execute(ACTIONS.VIDEO_ACCELERATE_USER, video),
      calculateAdScore,
      isAdVideo,
      scanAndObserve: scanAndObserveVideos
    };
    window.VideoSurgeon = publicApi;
    return async () => {
      clearInterval(skipIntervalId);
      stopBodyObserver();
      stopSpyBridge();
      stopObservingVideos();
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      await Promise.all(
        [...videoState.activeAds].map(
          (video) => actions.execute(ACTIONS.VIDEO_RESTORE_PLAYBACK, video)
        )
      );
      if (window.VideoSurgeon === publicApi) delete window.VideoSurgeon;
      if (window.AdsFriendlyVideoState === videoState)
        delete window.AdsFriendlyVideoState;
      videoState.initialized = false;
    };
  }
  function startBodyObserver() {
    let stopped = false;
    let observer = null;
    let retryId = null;
    const start = () => {
      if (stopped) return;
      if (document.body) {
        observer = new MutationObserver(scanAndObserveVideos);
        observer.observe(document.body, { childList: true, subtree: true });
      } else {
        retryId = setTimeout(start, 50);
      }
    };
    start();
    return () => {
      stopped = true;
      if (retryId) clearTimeout(retryId);
      observer?.disconnect();
    };
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
