var AdsFriendlyPicker = (() => {
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

  // src/dom/features.js
  function buildDynamicAdIdSelector(element) {
    if (!element?.tagName || !element.id) return null;
    const match = element.id.match(
      /^((?:ad|ads|adv|advert|banner|promo|sponsor|popup)[-_])(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{5,}$/i
    );
    if (!match) return null;
    return `${element.tagName.toLowerCase()}[id^="${cssAttributeValue(match[1])}"]`;
  }
  function cssAttributeValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  // src/dom/layout-context.js
  var RESPONSIVE_LAYOUTS = Object.freeze({
    ANY: "any",
    COMPACT: "compact",
    WIDE: "wide"
  });
  function getResponsiveLayout(width = globalThis.innerWidth) {
    return (Number(width) || 1024) <= 767 ? RESPONSIVE_LAYOUTS.COMPACT : RESPONSIVE_LAYOUTS.WIDE;
  }

  // src/picker/index.js
  function startPickerController(policy) {
    (function() {
      let isActive = false;
      let hoveredElement = null;
      let selectedItems = [];
      let overlays = [];
      let activeOverlay = null;
      let controlPanel = null;
      const GENERIC_CLASSES = [
        "lazyloaded",
        "ls-is-cached",
        "active",
        "show",
        "showing",
        "visible",
        "container",
        "inner",
        "wrapper",
        "img-responsive",
        "swiper-wrapper",
        "swiper-slide",
        "swiper-container",
        "owl-stage",
        "owl-item",
        "slick-track",
        "slick-slide",
        "carousel-inner"
      ];
      const STRUCTURAL_TAGS = [
        "html",
        "body",
        "header",
        "footer",
        "nav",
        "main",
        "section",
        "article",
        "aside"
      ];
      const createUI = () => {
        if (activeOverlay) return;
        activeOverlay = document.createElement("div");
        activeOverlay.id = "adsfriendly-picker-active-overlay";
        activeOverlay.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 2147483647;
            background: rgba(16, 185, 129, 0.2);
            outline: 2px solid #10b981;
            box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
            transition: all 0.1s ease;
            display: none;
            border-radius: 4px;
        `;
        document.body.appendChild(activeOverlay);
        controlPanel = document.createElement("div");
        controlPanel.id = "adsfriendly-picker-panel";
        controlPanel.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            background: #1e293b;
            color: white;
            padding: 10px 16px;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            display: none;
            flex-direction: row;
            align-items: center;
            gap: 15px;
            font-family: system-ui, -apple-system, sans-serif;
            border: 1px solid rgba(255,255,255,0.1);
            pointer-events: auto;
        `;
        document.body.appendChild(controlPanel);
        updatePanelUI();
      };
      const updatePanelUI = (errorMsg = null) => {
        if (!controlPanel) return;
        const count = selectedItems.length;
        const color = errorMsg ? "#ef4444" : "#10b981";
        let videoContext = false;
        if (hoveredElement) {
          videoContext = hoveredElement.tagName === "VIDEO" || hoveredElement.querySelector("video") || hoveredElement.closest(".jw-video, .video-js, .fluid_player_instance");
        }
        controlPanel.innerHTML = `
            <div style="font-weight: bold; font-size: 1rem; color: ${color};">${errorMsg ? "!" : videoContext ? "VIDEO" : "TARGET"}</div>
            <div style="display: flex; flex-direction: column;">
                <div style="font-weight: bold; font-size: 0.85rem; color: ${errorMsg ? "#f87171" : "white"};">${errorMsg || (videoContext ? "Video Player Detected" : count > 0 ? `${count} Ads Marked` : "Select Ads to Zap")}</div>
                <div style="font-size: 0.7rem; color: #94a3b8;">${errorMsg ? "Please select a smaller area" : videoContext ? "Is this a Video Ad? Mark it to Neutralize." : count > 0 ? "Press <b>Enter</b> to Zap all, <b>Esc</b> to Cancel" : "Click to mark, Scroll to expand"}</div>
            </div>
            <div style="display: flex; gap: 8px;">
                ${videoContext ? `<button id="neutralize-video-btn" style="background: #a855f7; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: bold;">Neutralize</button>` : ""}
                ${count > 0 && !errorMsg ? `<button id="zap-confirm-btn" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: bold;">Zap All</button>` : ""}
            </div>
        `;
        const zapBtn = document.getElementById("zap-confirm-btn");
        if (zapBtn) zapBtn.onclick = confirmAllZaps;
        const neuBtn = document.getElementById("neutralize-video-btn");
        if (neuBtn) neuBtn.onclick = handleNeutralizeVideo;
      };
      const handleNeutralizeVideo = async () => {
        if (!hoveredElement) return;
        const video = hoveredElement.tagName === "VIDEO" ? hoveredElement : hoveredElement.querySelector("video") || hoveredElement.closest("div").querySelector("video");
        if (video) {
          console.log(
            "[AdsFriendly Picker] Neutralizing Video Ad manually:",
            video.currentSrc
          );
          if (typeof VideoSurgeon !== "undefined") {
            VideoSurgeon.accelerate(video);
          }
          chrome.runtime.sendMessage({
            type: "LEARN_VIDEO_AD",
            hostname: window.location.hostname,
            src: video.currentSrc || video.src,
            classes: video.className + " " + (video.parentElement ? video.parentElement.className : "")
          });
          updatePanelUI("Video Neutralized! (Learning pattern...)");
          setTimeout(() => stopPicker(), 1500);
        }
      };
      const startPicker = async () => {
        if (isActive) return;
        isActive = true;
        createUI();
        activeOverlay.style.display = "block";
        controlPanel.style.display = "flex";
        selectedItems = [];
        clearOverlays();
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("click", handleClick, true);
        document.addEventListener("scroll", handleScroll, true);
        document.addEventListener("keydown", handleKeyDown);
        console.log(
          "%c[AdsFriendly AI] Starting Picker - Predictive Scan initiated...",
          "color: #10b981; font-weight: bold;"
        );
        const { globalAdPatterns = [] } = await chrome.storage.local.get("globalAdPatterns");
        if (globalAdPatterns.length > 0) {
          const elements = document.querySelectorAll(
            'img, a, div[style*="background-image"], [href*="http"]'
          );
          let autoMarkedCount = 0;
          elements.forEach((el) => {
            if (STRUCTURAL_TAGS.includes(el.tagName.toLowerCase())) return;
            let score = 0;
            let reasons = [];
            globalAdPatterns.forEach((p) => {
              if (p.type === "alt" && el.alt === p.value) {
                score += p.confidence;
                reasons.push(`alt='${p.value}'`);
              }
              if (p.type === "title" && el.title === p.value) {
                score += p.confidence;
                reasons.push(`title='${p.value}'`);
              }
              if (p.type === "domain") {
                const link = el.closest("a");
                if (link && link.href && link.href.includes(p.value)) {
                  score += p.confidence;
                  reasons.push(`domain='${p.value}'`);
                }
              }
            });
            if (score >= 0.9) {
              markElement(el);
              autoMarkedCount++;
              console.log(
                `[AdsFriendly AI] Auto-marked element: %o
Confidence: ${(score * 100).toFixed(1)}%
Reason: ${reasons.join(", ")}`,
                el
              );
            }
          });
          if (autoMarkedCount > 0) {
            console.log(
              `[AdsFriendly AI] Auto-marked ${autoMarkedCount} high-confidence ads.`
            );
            updatePanelUI();
          }
        }
      };
      const stopPicker = () => {
        isActive = false;
        if (activeOverlay) activeOverlay.style.display = "none";
        if (controlPanel) controlPanel.style.display = "none";
        clearOverlays();
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("click", handleClick, true);
        document.removeEventListener("scroll", handleScroll, true);
        document.removeEventListener("keydown", handleKeyDown);
      };
      const clearOverlays = () => {
        overlays.forEach((o) => o.remove());
        overlays = [];
      };
      const handleMouseMove = (e) => {
        if (!isActive) return;
        let el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && STRUCTURAL_TAGS.includes(el.tagName.toLowerCase())) {
          return;
        }
        if (el && el !== activeOverlay && !controlPanel.contains(el) && !isOverlay(el)) {
          updateSelection(el);
        }
      };
      const isOverlay = (el) => el.id && (el.id.includes("overlay") || el.id.includes("panel"));
      const updateSelection = (el) => {
        const findMeaningfulParent = (curr, depth = 0) => {
          if (!curr || curr === document.body || depth > 3) return curr;
          const r = curr.getBoundingClientRect();
          if (r.width > 25 && r.height > 25) return curr;
          return findMeaningfulParent(curr.parentElement, depth + 1);
        };
        let target = findMeaningfulParent(el);
        const isAdRelated = (node) => {
          if (node.tagName === "IMG" || node.tagName === "A") return true;
          if (node.tagName === "BR" || node.tagName === "CENTER") return true;
          if (node.id && /ad|pop|banner|promo/i.test(node.id)) return true;
          return false;
        };
        const isExclusiveAdWrapper = (container) => {
          if (!container || container === document.body) return false;
          const text = container.innerText.trim();
          if (text.length > 50) return false;
          const children = Array.from(container.children);
          if (children.length === 0) return false;
          return children.every(
            (child) => isAdRelated(child) || isExclusiveAdWrapper(child)
          );
        };
        const promoteToWrapper = (curr, depth = 0) => {
          if (!curr || curr.parentElement === document.body || depth > 3)
            return curr;
          const parent = curr.parentElement;
          if (isExclusiveAdWrapper(parent)) {
            const rect2 = parent.getBoundingClientRect();
            if (rect2.width * rect2.height < window.innerWidth * window.innerHeight * 0.35) {
              return promoteToWrapper(parent, depth + 1);
            }
          }
          return curr;
        };
        target = promoteToWrapper(target);
        hoveredElement = target;
        const selector = generateSelector(target);
        const validation = validateSelector(selector);
        const rect = target.getBoundingClientRect();
        activeOverlay.style.top = rect.top + "px";
        activeOverlay.style.left = rect.left + "px";
        activeOverlay.style.width = rect.width + "px";
        activeOverlay.style.height = rect.height + "px";
        if (!validation.valid) {
          activeOverlay.style.background = "rgba(239, 68, 68, 0.3)";
          activeOverlay.style.outlineColor = "#ef4444";
          activeOverlay.style.boxShadow = "0 0 20px rgba(239, 68, 68, 0.5)";
          updatePanelUI(`DANGEROUS: ${validation.reason}`);
        } else {
          activeOverlay.style.background = "rgba(16, 185, 129, 0.2)";
          activeOverlay.style.outlineColor = "#10b981";
          activeOverlay.style.boxShadow = "0 0 15px rgba(16, 185, 129, 0.4)";
          updatePanelUI();
        }
        const panelHeight = controlPanel.offsetHeight || 50;
        let panelTop = rect.top - panelHeight - 12;
        if (panelTop < 12) panelTop = rect.bottom + 12;
        controlPanel.style.top = panelTop + "px";
        controlPanel.style.left = Math.max(
          12,
          Math.min(window.innerWidth - controlPanel.offsetWidth - 12, rect.left)
        ) + "px";
      };
      const handleClick = (e) => {
        if (!isActive || !hoveredElement) return;
        const selector = generateSelector(hoveredElement);
        const validation = validateSelector(selector);
        if (!validation.valid) {
          console.warn(
            "[AdsFriendly Picker] Blocked dangerous selection:",
            validation.reason
          );
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && !selectedItems.some((item) => item.element === el)) {
          markElement(el, selector);
        }
      };
      const markElement = (el, selector) => {
        if (!selector) return;
        const fingerprint = generateFingerprint(el);
        selectedItems.push({ element: el, selector, fingerprint });
        const rect = el.getBoundingClientRect();
        const pOverlay = document.createElement("div");
        pOverlay.style.cssText = `
            position: fixed;
            top: ${rect.top}px;
            left: ${rect.left}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            background: rgba(16, 185, 129, 0.3);
            border: 2px solid #10b981;
            pointer-events: none;
            z-index: 2147483646;
            border-radius: 4px;
        `;
        document.body.appendChild(pOverlay);
        overlays.push(pOverlay);
        updatePanelUI();
      };
      const handleScroll = (e) => {
        if (!isActive || !hoveredElement) return;
        e.preventDefault();
        if (e.deltaY < 0 && hoveredElement.parentElement && hoveredElement.parentElement !== document.body) {
          updateSelection(hoveredElement.parentElement);
        }
      };
      const handleKeyDown = (e) => {
        if (e.key === "Escape") stopPicker();
        if (e.key === "Enter" && selectedItems.length > 0) confirmAllZaps();
      };
      const confirmAllZaps = async () => {
        const hostname = window.location.hostname;
        const { userCustomRules = {}, siteResetHistory = {} } = await chrome.storage.local.get(["userCustomRules", "siteResetHistory"]);
        if (!userCustomRules[hostname]) userCustomRules[hostname] = [];
        let addedCount = 0;
        const rulesToSave = [];
        const resetData = siteResetHistory[hostname];
        const isCorrectionLoop = !!resetData;
        selectedItems.forEach((item) => {
          const validation = validateSelector(item.selector);
          if (!validation.valid) {
            console.error(
              "[AdsFriendly Picker] Skipping dangerous rule:",
              item.selector,
              validation.reason
            );
            return;
          }
          let finalSelector = item.selector;
          if (isCorrectionLoop && resetData.oldRules) {
            console.log(
              `%c[AdsFriendly AI] Differential Analysis triggered for ${hostname}`,
              "color: #a855f7; font-weight: bold;"
            );
            resetData.oldRules.forEach((oldRule) => {
              const oldF = typeof oldRule === "string" ? null : oldRule.fingerprint;
              if (oldF && oldF.tag === item.fingerprint.tag) {
                const delta = findFingerprintDelta(oldF, item.fingerprint);
                if (delta) {
                  console.log("[AdsFriendly AI] Found learning delta:", delta);
                  if (delta.type === "dataAttr") {
                    finalSelector = `${item.selector.split(" > ").pop()}[${delta.key}="${delta.value}"]`;
                  } else if (delta.type === "class" && delta.value) {
                    finalSelector = `${item.selector.split(" > ").pop()}.${delta.value.split(" ")[0]}`;
                  }
                }
              }
            });
          }
          const ruleObject = {
            selector: finalSelector,
            fingerprint: item.fingerprint,
            timestamp: Date.now(),
            timesZapped: 1,
            confidence: isCorrectionLoop ? 1 : 0.8,
            isCorrection: isCorrectionLoop,
            layout: getResponsiveLayout()
          };
          if (isCorrectionLoop) {
            console.log(
              `%c[AdsFriendly AI] Correction learned: ${finalSelector}`,
              "color: #10b981; font-weight: bold;"
            );
          }
          const existingIndex = userCustomRules[hostname].findIndex(
            (r) => typeof r === "string" ? r === finalSelector : r.selector === finalSelector
          );
          if (existingIndex > -1)
            userCustomRules[hostname][existingIndex] = ruleObject;
          else userCustomRules[hostname].push(ruleObject);
          rulesToSave.push(ruleObject);
          addedCount++;
        });
        if (addedCount > 0) {
          try {
            const response = await chrome.runtime.sendMessage({
              type: "UPSERT_CUSTOM_RULES",
              hostname,
              rules: rulesToSave
            });
            if (response?.status !== "saved")
              throw new Error(response?.error || "Could not save selected rules.");
            selectedItems.forEach((item) => {
              item.element.style.opacity = "0";
              item.element.style.pointerEvents = "none";
            });
            await chrome.runtime.sendMessage({ type: "SYNC_LEARNING" });
          } catch (error) {
            updatePanelUI(`Save failed: ${error.message}`);
            return;
          }
        }
        stopPicker();
      };
      const generateSelector = (el) => {
        const tag = el.tagName.toLowerCase();
        const structuralTags = [
          "div",
          "span",
          "p",
          "a",
          "li",
          "ul",
          "img",
          "section",
          "article",
          "main",
          "aside"
        ];
        const isSafeId = (id) => id && !GENERIC_CLASSES.some((gc) => id.includes(gc)) && !/[0-9]{5,}/.test(id);
        const isSafeClass = (cls) => cls && typeof cls === "string" && cls.split(/\s+/).some((c) => c && !GENERIC_CLASSES.includes(c) && !/[0-9]{5,}/.test(c));
        const dynamicAdIdSelector = buildDynamicAdIdSelector(el);
        if (dynamicAdIdSelector) return dynamicAdIdSelector;
        if (tag === "a" && el.href && el.href.includes("javascript:")) {
          if (isSafeId(el.id)) return `#${el.id}`;
          if (el.parentElement && isSafeId(el.parentElement.id))
            return `#${el.parentElement.id} > ${tag}`;
          const jsMatch = el.href.match(/javascript:([a-zA-Z0-9_]+)/);
          if (jsMatch && jsMatch[1].length > 3) {
            return `${tag}[href*="${jsMatch[1]}"]`;
          }
        }
        const adKeywords = ["quangcao", "catfish", "ads", "popup", "banner"];
        if (el.id && adKeywords.some((k) => el.id.toLowerCase().includes(k)))
          return `#${el.id}`;
        if (isSafeId(el.id)) return `#${el.id}`;
        const buildPath = (curr, depth = 0) => {
          if (!curr || curr === document.body || depth > 2) return "";
          let part = curr.tagName.toLowerCase();
          if (curr.id && adKeywords.some((k) => curr.id.toLowerCase().includes(k)))
            return `#${curr.id} ${part}`.trim();
          if (isSafeId(curr.id)) return `#${curr.id} ${part}`.trim();
          if (curr.className && typeof curr.className === "string") {
            const validClass = curr.className.split(/\s+/).find(
              (c) => c && !GENERIC_CLASSES.includes(c) && !/[0-9]{5,}/.test(c)
            );
            if (validClass) part = `.${validClass}`;
          }
          const parentPart = buildPath(curr.parentElement, depth + 1);
          return (parentPart ? parentPart + " > " : "") + part;
        };
        const path = buildPath(el);
        if (!path || structuralTags.includes(path.split(" > ").pop())) {
          const rect = el.getBoundingClientRect();
          if (rect.width * rect.height > 1e4 || structuralTags.includes(tag)) {
            return null;
          }
          return tag;
        }
        return path;
      };
      const validateSelector = (selector) => {
        if (!selector) return { valid: false, reason: "No selector generated" };
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length > 5)
            return {
              valid: false,
              reason: `Matches too many elements (${matches.length})`
            };
          let totalArea = 0;
          const viewportArea = window.innerWidth * window.innerHeight;
          matches.forEach((m) => {
            const r = m.getBoundingClientRect();
            totalArea += r.width * r.height;
          });
          if (totalArea > viewportArea * 0.35)
            return { valid: false, reason: "Selector area is too large (>35%)" };
          return { valid: true };
        } catch (e) {
          return { valid: false, reason: "Invalid selector logic" };
        }
      };
      const generateFingerprint = (el) => {
        const cleanId = (id) => id && !/(_[a-z0-9]{1,3}_|[0-9]{5,})/.test(id) ? id : null;
        const cleanClass = (cls) => {
          if (!cls || typeof cls !== "string") return null;
          return cls.split(/\s+/).filter((c) => !/(active|hover|focus|selected|clicked)/.test(c)).join(" ");
        };
        let linkDomain = null;
        const link = el.closest("a");
        if (link && link.href) {
          try {
            const url = new URL(link.href);
            if (url.hostname !== window.location.hostname) {
              linkDomain = url.hostname.split(".").slice(-2).join(".");
            }
          } catch (e) {
          }
        }
        const dataAttrs = {};
        if (el.attributes) {
          Array.from(el.attributes).forEach((attr) => {
            if (attr.name.startsWith("data-") && attr.value.length < 50) {
              dataAttrs[attr.name] = attr.value;
            }
          });
        }
        return {
          tag: el.tagName.toLowerCase(),
          className: cleanClass(el.className),
          parentId: el.parentElement ? cleanId(el.parentElement.id) : null,
          parentClass: el.parentElement ? cleanClass(el.parentElement.className) : null,
          alt: el.alt || null,
          title: el.title || null,
          linkDomain,
          childCount: el.children ? el.children.length : 0,
          dataAttrs
        };
      };
      const findFingerprintDelta = (oldF, newF) => {
        if (!oldF || !newF) return null;
        for (const key in newF.dataAttrs) {
          if (!oldF.dataAttrs || oldF.dataAttrs[key] !== newF.dataAttrs[key]) {
            return { type: "dataAttr", key, value: newF.dataAttrs[key] };
          }
        }
        if (newF.className !== oldF.className)
          return { type: "class", value: newF.className };
        if (newF.childCount !== oldF.childCount)
          return { type: "childCount", value: newF.childCount };
        return null;
      };
      chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "START_PICKER" && policy.can(CAPABILITIES.DOM_MANUAL_PICKER))
          startPicker();
      });
    })();
  }
  var controller = createMainController({
    context: "picker",
    implementations: {
      "picker.controller": ({ policy }) => startPickerController(policy)
    }
  });
  controller.start().catch(
    (error) => console.error("[AdsFriendly Picker] MainController failed", error)
  );
})();
