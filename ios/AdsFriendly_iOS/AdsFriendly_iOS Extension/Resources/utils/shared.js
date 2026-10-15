(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/settings-package/schema.js
  var schema_exports = {};
  __export(schema_exports, {
    BUNDLED_SETTINGS_PACKAGE_PATH: () => BUNDLED_SETTINGS_PACKAGE_PATH,
    SETTINGS_PACKAGE_SCHEMA: () => SETTINGS_PACKAGE_SCHEMA,
    SETTINGS_PACKAGE_STATE_KEY: () => SETTINGS_PACKAGE_STATE_KEY,
    createSettingsPackage: () => createSettingsPackage,
    hasMeaningfulExistingSettings: () => hasMeaningfulExistingSettings,
    normalizeSettingsPackage: () => normalizeSettingsPackage,
    packageToStorage: () => packageToStorage,
    replaceSettingsWithPackage: () => replaceSettingsWithPackage,
    summarizeSettingsPackage: () => summarizeSettingsPackage
  });

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
    [C2.BROWSER_DOWNLOAD_OBSERVE]: capability(
      C2.BROWSER_DOWNLOAD_OBSERVE,
      "safe",
      T.PASSIVE,
      {
        availableWhenDisabled: true,
        browserPermissions: ["downloads"],
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
  function assertRegisteredCapability(capabilityId) {
    if (!CAPABILITY_SET.has(capabilityId) || !CAPABILITY_CATALOG[capabilityId]) {
      throw new Error(
        `[FeatureRegistry] Unknown capability "${capabilityId}". Register it in feature-catalog.js before use.`
      );
    }
    return capabilityId;
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

  // src/runtime/settings-store.js
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
  var VALID_RULE_LAYOUTS = /* @__PURE__ */ new Set(["any", "compact", "wide"]);
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
        element_exceptions: storageSnapshot.userElementExceptions || {},
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
    const elementExceptions = normalizeElementExceptions(
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
  function summarizeSettingsPackage(packageInput) {
    const settingsPackage = normalizeSettingsPackage(packageInput);
    const hiddenSites = Object.keys(settingsPackage.settings.custom_rules);
    const exceptionSites = Object.keys(
      settingsPackage.settings.element_exceptions
    );
    return {
      name: settingsPackage.metadata.name,
      author: settingsPackage.metadata.author,
      version: settingsPackage.metadata.version,
      whitelistCount: settingsPackage.settings.whitelist.length,
      blacklistCount: settingsPackage.settings.blacklist.length,
      siteCount: (/* @__PURE__ */ new Set([...hiddenSites, ...exceptionSites])).size,
      ruleCount: Object.values(settingsPackage.settings.custom_rules).reduce(
        (count, rules) => count + rules.length,
        0
      ),
      exceptionCount: Object.values(
        settingsPackage.settings.element_exceptions
      ).reduce((count, rules) => count + rules.length, 0),
      trustedPathCount: settingsPackage.settings.trusted_paths.length
    };
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
  function normalizeElementExceptions(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result = {};
    for (const [rawHostname, rawRules] of Object.entries(value)) {
      const hostname = normalizeHostname(rawHostname);
      if (!hostname || !Array.isArray(rawRules)) continue;
      const rules = rawRules.slice(0, MAX_RULES_PER_SITE).map(normalizeElementException).filter(Boolean);
      if (rules.length) result[hostname] = dedupeElementExceptions(rules);
    }
    return result;
  }
  function normalizeElementException(rule) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
    const selector = cleanText(rule.selector, MAX_SELECTOR_LENGTH);
    const fingerprint = normalizeFingerprint(rule.fingerprint);
    if (!isSafeSelector(selector) || !fingerprint || !hasElementExceptionIdentity(fingerprint))
      return null;
    return {
      id: cleanText(rule.id, 160) || `not-ad-${stableTextId(
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
      linkDomain: normalizeHostname(fingerprint.linkDomain) || null,
      srcHost: normalizeHostname(fingerprint.srcHost) || null,
      idTokens: normalizeTokens(fingerprint.idTokens),
      classTokens: normalizeTokens(fingerprint.classTokens),
      descendantLinkHosts: normalizeHostList(fingerprint.descendantLinkHosts),
      descendantSrcHosts: normalizeHostList(fingerprint.descendantSrcHosts)
    };
  }
  function normalizeHostList(values) {
    return [
      ...new Set(
        (Array.isArray(values) ? values : []).map((value) => normalizeHostname(value)).filter(Boolean)
      )
    ].sort().slice(0, 12);
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
  function stableTextId(value) {
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

  // src/navigation/shared/search-navigation.js
  var GOOGLE_HOST_RE = /^(.+\.)?google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/i;
  var EMBEDDED_HOST_RE = /(?:^|\s)(?:https?:\/\/)?(?:www\.)?([a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+)(?:\b|\/)/i;
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

  // src/dom/layout-context.js
  var RESPONSIVE_LAYOUTS = Object.freeze({
    ANY: "any",
    COMPACT: "compact",
    WIDE: "wide"
  });
  function getResponsiveLayout(width = globalThis.innerWidth) {
    return (Number(width) || 1024) <= 767 ? RESPONSIVE_LAYOUTS.COMPACT : RESPONSIVE_LAYOUTS.WIDE;
  }
  function ruleMatchesResponsiveLayout(rule, layout = getResponsiveLayout()) {
    if (!rule || typeof rule === "string") return true;
    return !rule.layout || rule.layout === RESPONSIVE_LAYOUTS.ANY || rule.layout === layout;
  }

  // src/dom/features.js
  var AD_TOKEN_RE = /(^|[-_])(?:ad|ads|adv|advert|banner|promo|sponsor|popup|preload)([-_]|$)/i;
  var PROTECTED_SELECTOR = 'nav, [role="navigation"], form, [data-testid*="login" i]';
  var NAV_SELECTOR = 'nav, [role="navigation"]';
  var NON_ACTIONABLE_SELECTORS = /* @__PURE__ */ new Set(["html", "body", ":root", "*"]);
  function extractDomFeatures(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const link = element.closest("a[href]");
    const src = normalizeUrlText(element.currentSrc || element.src);
    const href = normalizeUrlText(link?.href || element.href);
    const idTokens = tokenize(element.id);
    const classTokens = tokenize(
      typeof element.className === "string" ? element.className : ""
    );
    const parent = element.parentElement;
    const descendants = inspectDescendants(element);
    const navRoot = element.closest(NAV_SELECTOR);
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      className: typeof element.className === "string" ? element.className : "",
      idTokens,
      classTokens,
      src,
      srcHost: safeHost(src),
      href,
      hrefHost: safeHost(href),
      alt: element.alt || "",
      title: element.title || "",
      textLength: (element.textContent || "").trim().length,
      rect: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        area: Math.round(rect.width * rect.height),
        areaRatio: viewportArea() ? rect.width * rect.height / viewportArea() : 0
      },
      style: {
        position: style.position,
        display: style.display,
        visibility: style.visibility,
        opacity: Number.parseFloat(style.opacity || "1"),
        zIndex: style.zIndex,
        maxWidth: style.maxWidth
      },
      visible: isVisible(element, rect, style),
      fixedOrSticky: style.position === "fixed" || style.position === "sticky",
      absoluteOrFixed: style.position === "absolute" || style.position === "fixed",
      inProtectedArea: !!element.closest(PROTECTED_SELECTOR),
      inNavigationArea: !!navRoot,
      navAdLinkRatio: navRoot ? getAdLinkRatio(navRoot) : 0,
      linkExternal: href ? safeHost(href) !== location.hostname : false,
      compactBannerShape: isCompactBanner(rect),
      billboardShape: isBillboard(rect),
      tallSidebarShape: isTallSidebar(rect),
      descendants,
      ancestry: getAncestry(element),
      siblings: getSiblingSummary(element),
      parent: parent ? {
        tag: parent.tagName.toLowerCase(),
        id: parent.id || "",
        className: typeof parent.className === "string" ? parent.className : "",
        childCount: parent.children.length,
        inProtectedArea: !!parent.closest(PROTECTED_SELECTOR)
      } : null,
      signals: {
        idHasAdToken: tokensHaveAdSignal(idTokens),
        idLooksAdSlot: looksAdSlotId(element.id),
        classHasAdToken: tokensHaveAdSignal(classTokens),
        srcIsImageCdn: isImageCdn(src),
        hrefLooksAdLike: looksAdLikeUrl(href),
        hrefHostLooksCommercial: looksCommercialHost(href),
        descendantsHaveAdSignals: descendants.externalAdLinkCount > 0 || descendants.imageCdnCount > 0 || descendants.iframeCount > 0,
        hasAltOrTitle: !!(element.alt || element.title)
      }
    };
  }
  function buildDomSelector(element) {
    if (!element?.tagName) return null;
    const tag = element.tagName.toLowerCase();
    const dynamicAdIdSelector = buildDynamicAdIdSelector(element);
    if (dynamicAdIdSelector) return dynamicAdIdSelector;
    if (element.id && AD_TOKEN_RE.test(element.id))
      return `#${cssEscape(element.id)}`;
    const className = typeof element.className === "string" ? element.className.split(/\s+/).find((token) => AD_TOKEN_RE.test(token)) : "";
    if (className) return `${tag}.${cssEscape(className)}`;
    if (element.id && !/\d{5,}/.test(element.id))
      return `#${cssEscape(element.id)}`;
    const hrefHost = safeHost(element.getAttribute?.("href") || element.href);
    if (tag === "a" && hrefHost)
      return `a[href*="${cssAttributeValue(`//${hrefHost}`)}"]`;
    const srcHost = safeHost(
      element.getAttribute?.("src") || element.currentSrc || element.src
    );
    if (["img", "iframe"].includes(tag) && srcHost)
      return `${tag}[src*="${cssAttributeValue(`//${srcHost}`)}"]`;
    const labelledSelector = buildLabelSelector(element, tag);
    if (labelledSelector) return labelledSelector;
    return buildStructuralSelector(element);
  }
  function isReusableDomSelector(selector) {
    if (typeof selector !== "string" || !selector.trim()) return false;
    return !NON_ACTIONABLE_SELECTORS.has(selector.trim().toLowerCase());
  }
  function buildDynamicAdIdSelector(element) {
    if (!element?.tagName || !element.id) return null;
    const match = element.id.match(
      /^((?:ad|ads|adv|advert|banner|promo|sponsor|popup)[-_])(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{5,}$/i
    );
    if (!match) return null;
    return `${element.tagName.toLowerCase()}[id^="${cssAttributeValue(match[1])}"]`;
  }
  function tokensHaveAdSignal(tokens) {
    return tokens.some((token) => AD_TOKEN_RE.test(token));
  }
  function looksAdLikeUrl(url = "") {
    const value = normalizeUrlText(url).toLowerCase();
    return /(?:[?&](?:utm_|aff_|clickid|adid|zoneid|bannerid)|\/(?:ad|ads|adv|advert|banner)(?:\/|\.|-|_))/i.test(
      value
    );
  }
  function inspectDescendants(element) {
    const links = Array.from(element.querySelectorAll?.("a[href]") || []).slice(
      0,
      40
    );
    const images = Array.from(element.querySelectorAll?.("img, iframe") || []).slice(0, 40).map((node) => ({
      tag: node.tagName.toLowerCase(),
      src: normalizeUrlText(node.currentSrc || node.src),
      srcHost: safeHost(node.currentSrc || node.src || "")
    }));
    const externalLinks = links.filter(
      (link) => safeHost(link.href) !== location.hostname
    );
    const externalAdLinks = externalLinks.filter((link) => {
      const text = [
        link.id,
        typeof link.className === "string" ? link.className : "",
        normalizeUrlText(link.href),
        link.textContent || ""
      ].join(" ");
      return tokensHaveAdSignal(tokenize(text)) || looksAdLikeUrl(link.href) || looksCommercialHost(link.href);
    });
    return {
      childCount: element.children?.length || 0,
      linkCount: links.length,
      externalLinkCount: externalLinks.length,
      externalAdLinkCount: externalAdLinks.length,
      imageCount: images.filter((item) => item.tag === "img").length,
      iframeCount: images.filter((item) => item.tag === "iframe").length,
      imageCdnCount: images.filter((item) => isImageCdn(item.src)).length,
      hrefHosts: uniqueHosts(externalLinks.map((link) => safeHost(link.href))),
      srcHosts: uniqueHosts(images.map((item) => item.srcHost))
    };
  }
  function getAdLinkRatio(root) {
    const links = Array.from(root.querySelectorAll?.("a[href]") || []);
    if (links.length < 3) return 0;
    const adLinks = links.filter((link) => {
      const value = [
        link.id,
        typeof link.className === "string" ? link.className : "",
        normalizeUrlText(link.href),
        link.textContent || ""
      ].join(" ");
      return tokensHaveAdSignal(tokenize(value)) || looksAdLikeUrl(link.href) || looksCommercialHost(link.href);
    });
    return adLinks.length / links.length;
  }
  function looksCommercialHost(url = "") {
    const host = safeHost(url);
    return /(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|adcenter|admicro|doubleclick|googlesyndication|casino|bet|88|789|fun|click|track|promo)/i.test(
      host
    );
  }
  function tokenize(value = "") {
    return String(value).split(/[^a-z0-9]+/i).filter(Boolean).map((token) => token.toLowerCase());
  }
  function safeHost(url) {
    try {
      const base = typeof location === "undefined" ? "https://adsfriendly.invalid/" : location.href;
      const value = normalizeUrlText(url);
      return value ? new URL(value, base).hostname.toLowerCase() : "";
    } catch {
      return "";
    }
  }
  function normalizeUrlText(value) {
    if (typeof value === "string") return value;
    if (!value) return "";
    if (typeof value.baseVal === "string") return value.baseVal;
    if (typeof value.href === "string") return value.href;
    if (typeof value.url === "string") return value.url;
    try {
      const text = String(value);
      return /^\[object .+\]$/.test(text) ? "" : text;
    } catch {
      return "";
    }
  }
  function isImageCdn(url = "") {
    const host = safeHost(url);
    return /(?:googleusercontent\.com|gstatic\.com|cloudfront\.net|akamaihd\.net|imgur\.com|cdn)/i.test(
      host
    );
  }
  function isCompactBanner(rect) {
    return rect.width >= 250 && rect.height >= 40 && rect.height <= 140;
  }
  function isBillboard(rect) {
    return rect.width >= 600 && rect.height >= 90 && rect.height <= 320;
  }
  function isTallSidebar(rect) {
    return rect.width >= 160 && rect.width <= 360 && rect.height >= 240;
  }
  function looksAdSlotId(id = "") {
    return /^(?:ads?|adv|advert|banner|native[-_]?ad|ad[-_]?place)(?:[-_]|$)/i.test(
      id
    );
  }
  function isVisible(element, rect, style) {
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number.parseFloat(style.opacity || "1") > 0.05 && element.getClientRects().length > 0;
  }
  function viewportArea() {
    return window.innerWidth * window.innerHeight;
  }
  function cssEscape(value) {
    if (typeof window !== "undefined" && window.CSS?.escape)
      return window.CSS.escape(value);
    return String(value).replace(/["\\#.;:[\],>+~*='()]/g, "\\$&");
  }
  function cssAttributeValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  function buildLabelSelector(element, tag) {
    for (const attribute of ["alt", "title", "aria-label"]) {
      const value = String(element.getAttribute?.(attribute) || "").trim();
      if (value.length >= 3 && value.length <= 120) {
        return `${tag}[${attribute}="${cssAttributeValue(value)}"]`;
      }
    }
    return null;
  }
  function buildStructuralSelector(element) {
    const segments = [];
    let current = element;
    while (current?.tagName && segments.length < 5) {
      const tag = current.tagName.toLowerCase();
      if (["html", "body"].includes(tag)) break;
      if (current.id && !/\d{5,}/.test(current.id)) {
        segments.unshift(`#${cssEscape(current.id)}`);
        return segments.join(" > ");
      }
      const parent = current.parentElement;
      let segment = tag;
      if (parent?.children) {
        const sameTag = Array.from(parent.children).filter(
          (child) => child.tagName?.toLowerCase() === tag
        );
        const index = sameTag.indexOf(current);
        if (sameTag.length > 1 && index >= 0)
          segment += `:nth-of-type(${index + 1})`;
      }
      segments.unshift(segment);
      current = parent;
    }
    return segments.length >= 2 ? segments.join(" > ") : null;
  }
  function uniqueHosts(hosts) {
    return [...new Set(hosts.filter(Boolean))].slice(0, 12);
  }
  function getAncestry(element) {
    const chain = [];
    let current = element.parentElement;
    while (current && chain.length < 5 && current !== document.documentElement) {
      chain.push({
        tag: current.tagName.toLowerCase(),
        id: current.id || "",
        className: typeof current.className === "string" ? current.className : "",
        role: current.getAttribute("role") || "",
        childCount: current.children.length
      });
      current = current.parentElement;
    }
    return chain;
  }
  function getSiblingSummary(element) {
    const siblings = Array.from(element.parentElement?.children || []).filter(
      (node) => node !== element
    );
    return {
      count: siblings.length,
      adLikeCount: siblings.filter(
        (node) => tokensHaveAdSignal(
          tokenize(
            [
              node.id,
              typeof node.className === "string" ? node.className : "",
              node.getAttribute?.("href") || "",
              node.getAttribute?.("src") || ""
            ].join(" ")
          )
        )
      ).length,
      tags: [
        ...new Set(siblings.map((node) => node.tagName.toLowerCase()))
      ].slice(0, 8)
    };
  }

  // src/dom/element-exceptions.js
  var VALID_LAYOUTS = /* @__PURE__ */ new Set(["any", "compact", "wide"]);
  function createElementException(candidate, { id = randomId(), timestamp = Date.now(), layout = "any" } = {}) {
    const selector = candidate?.selector;
    const fingerprint = elementExceptionFingerprint(candidate?.features);
    if (!isReusableDomSelector(selector) || !hasStableElementIdentity(fingerprint))
      throw new Error(
        "This element has no stable identity to remember safely. Dismiss it once with \xD7."
      );
    return {
      id,
      selector,
      fingerprint,
      timestamp,
      confidence: clampConfidence(candidate.decision?.confidence),
      source: "user_not_ad",
      layout: VALID_LAYOUTS.has(layout) ? layout : "any"
    };
  }
  function elementExceptionFingerprint(features = {}) {
    return {
      tag: clean(features.tag, 30),
      id: clean(features.id, 160),
      className: clean(features.className, 300),
      alt: clean(features.alt, 300),
      title: clean(features.title, 300),
      linkDomain: clean(features.hrefHost, 253).toLowerCase(),
      srcHost: clean(features.srcHost, 253).toLowerCase(),
      idTokens: normalizedTokens(features.idTokens),
      classTokens: normalizedTokens(features.classTokens),
      descendantLinkHosts: normalizedHosts(features.descendants?.hrefHosts),
      descendantSrcHosts: normalizedHosts(features.descendants?.srcHosts)
    };
  }
  function matchesElementException(rule, { selector, features, layout } = {}) {
    if (!rule || typeof rule !== "object") return false;
    if (!isReusableDomSelector(selector) || rule.selector !== selector)
      return false;
    if (!ruleMatchesResponsiveLayout(rule, layout)) return false;
    const expected = rule.fingerprint;
    if (!expected || typeof expected !== "object") return false;
    const actual = elementExceptionFingerprint(features);
    if (expected.tag && expected.tag !== actual.tag) return false;
    let identityScore = 0;
    for (const key of ["linkDomain", "srcHost", "id", "alt", "title"]) {
      if (!expected[key]) continue;
      if (!actual[key] || expected[key] !== actual[key]) return false;
      identityScore += ["linkDomain", "srcHost"].includes(key) ? 3 : 2;
    }
    if (expected.className) {
      if (expected.className === actual.className) identityScore += 1;
      else return false;
    }
    if (tokenOverlap(expected.idTokens, actual.idTokens)) identityScore += 2;
    if (tokenOverlap(expected.classTokens, actual.classTokens))
      identityScore += 1;
    for (const key of ["descendantLinkHosts", "descendantSrcHosts"]) {
      if (!Array.isArray(expected[key]) || !expected[key].length) continue;
      if (!sameValues(expected[key], actual[key])) return false;
      identityScore += 3;
    }
    return identityScore > 0 || isIdentitySelector(selector);
  }
  function tokenOverlap(expected, actual) {
    if (!Array.isArray(expected) || !expected.length || !Array.isArray(actual))
      return false;
    const actualTokens = new Set(actual);
    return expected.some((token) => actualTokens.has(token));
  }
  function isIdentitySelector(selector) {
    return /^#[^\s>+~]+$/.test(selector) || /^[a-z][a-z0-9-]*\.[^\s>+~]+$/i.test(selector) || /\[(?:href|src|alt|title|aria-label)[*^$]?=/i.test(selector);
  }
  function normalizedTokens(values) {
    return [
      ...new Set(
        (Array.isArray(values) ? values : []).map((value) => clean(value, 80).toLowerCase()).filter(Boolean)
      )
    ].slice(0, 40);
  }
  function normalizedHosts(values) {
    return [
      ...new Set(
        (Array.isArray(values) ? values : []).map((value) => clean(value, 253).toLowerCase()).filter((value) => /^[a-z0-9.-]+$/.test(value))
      )
    ].sort().slice(0, 12);
  }
  function sameValues(expected, actual) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return false;
    return expected.every((value, index) => value === actual[index]);
  }
  function hasStableElementIdentity(fingerprint) {
    return Boolean(
      fingerprint.id || fingerprint.className || fingerprint.alt || fingerprint.title || fingerprint.linkDomain || fingerprint.srcHost || fingerprint.idTokens.length || fingerprint.classTokens.length || fingerprint.descendantLinkHosts.length || fingerprint.descendantSrcHosts.length
    );
  }
  function clean(value, maximumLength = 300) {
    return String(value || "").trim().slice(0, maximumLength);
  }
  function clampConfidence(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
  }
  function randomId() {
    return globalThis.crypto?.randomUUID?.() || `not-ad-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // src/ios/navigation.js
  var navigation_exports = {};
  __export(navigation_exports, {
    createNavigationTracker: () => createNavigationTracker,
    exactDestination: () => exactDestination,
    explicitNavigation: () => explicitNavigation,
    httpUrl: () => httpUrl,
    navigationDecision: () => navigationDecision,
    sameHostFamily: () => sameHostFamily
  });
  function httpUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }
  function sameHostFamily(left, right) {
    const a = httpUrl(left)?.hostname, b = httpUrl(right)?.hostname;
    return !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a));
  }
  function exactDestination(left, right) {
    const a = httpUrl(left), b = httpUrl(right);
    if (!a || !b) return false;
    a.hash = "";
    b.hash = "";
    return a.href === b.href;
  }
  function explicitNavigation(details = {}) {
    return [
      "typed",
      "generated",
      "keyword",
      "keyword_generated",
      "auto_bookmark"
    ].includes(details.transitionType) || (details.transitionQualifiers || []).includes("from_address_bar");
  }
  function navigationDecision({
    sourceUrl,
    targetUrl,
    enabled = true,
    sourcePolicy = "default",
    blocked = false,
    allowed = false,
    knownAd = false,
    intent = null,
    trustedPath = false,
    now = Date.now()
  }) {
    if (!enabled || !httpUrl(targetUrl))
      return { action: "allow", reason: "disabled_or_non_http" };
    if (blocked) return { action: "block", reason: "remembered_block" };
    if (allowed || sourcePolicy === "allow")
      return { action: "allow", reason: "explicit_allow" };
    const classification = classifyNavigationIntent({
      intentUrl: targetUrl,
      sourceUrl
    });
    if (knownAd || classification.likelyAd)
      return {
        action: "review",
        reason: "advertising_signals",
        reasons: classification.reasons
      };
    if (sameHostFamily(sourceUrl, targetUrl))
      return { action: "allow", reason: "same_host_family", keepTracking: true };
    if (intent && now - intent.time < 2500 && exactDestination(intent.url, targetUrl))
      return { action: "allow", reason: "exact_clicked_link" };
    if (trustedPath && sourcePolicy !== "block")
      return { action: "allow", reason: "manual_trusted_path" };
    return { action: "review", reason: "unmatched_web_created_tab" };
  }
  function createNavigationTracker({
    now = Date.now,
    ttl = 3e4,
    maxEntries = 100
  } = {}) {
    const candidates = /* @__PURE__ */ new Map(), userContexts = /* @__PURE__ */ new Map(), once = /* @__PURE__ */ new Map(), handled = /* @__PURE__ */ new Map();
    let sequence = 0;
    function prune() {
      for (const map of [candidates, userContexts, once, handled]) {
        for (const [key, value] of map)
          if (value.expiresAt <= now()) map.delete(key);
        while (map.size > maxEntries) map.delete(map.keys().next().value);
      }
    }
    return {
      link(tabId, sourceTabId) {
        prune();
        if (tabId === sourceTabId || userContexts.has(tabId) || handled.has(tabId))
          return null;
        let value = candidates.get(tabId);
        if (!value) {
          value = {
            sourceTabId,
            createdAt: now(),
            expiresAt: now() + ttl,
            epoch: ++sequence
          };
          candidates.set(tabId, value);
        }
        return value;
      },
      candidate(tabId) {
        prune();
        return candidates.get(tabId);
      },
      commit(details) {
        prune();
        if (explicitNavigation(details)) {
          candidates.delete(details.tabId);
          userContexts.set(details.tabId, {
            url: details.url,
            expiresAt: now() + 1e4
          });
          return "user";
        }
        const user = userContexts.get(details.tabId);
        if (user && sameHostFamily(user.url, details.url)) return "user";
        if (user) {
          candidates.delete(details.tabId);
          return "user";
        }
        return "web";
      },
      finish(tabId) {
        candidates.delete(tabId);
        handled.set(tabId, { expiresAt: now() + ttl });
      },
      current(tabId, candidate) {
        prune();
        return candidates.get(tabId) === candidate;
      },
      grantOnce(url) {
        prune();
        if (!httpUrl(url))
          throw new Error("Only HTTP(S) destinations can be opened.");
        const token = ++sequence;
        once.set(token, { url, expiresAt: now() + 5e3 });
        return token;
      },
      consumeOnce(url) {
        const tabId = arguments[1];
        prune();
        for (const [token, ticket] of once) {
          if (tabId !== void 0 && ticket.tabId !== tabId) continue;
          if (exactDestination(ticket.url, url)) {
            once.delete(token);
            return true;
          }
        }
        return false;
      },
      bindOnce(token, tabId) {
        const ticket = once.get(token);
        if (ticket) ticket.tabId = tabId;
      },
      revokeOnce(token) {
        once.delete(token);
      },
      remove(tabId) {
        candidates.delete(tabId);
        userContexts.delete(tabId);
        handled.delete(tabId);
      },
      prune
    };
  }

  // src/ios/dom-state.js
  function createHiddenElements({ limit = 500 } = {}) {
    const hidden = /* @__PURE__ */ new Map();
    return {
      has: (element) => hidden.has(element),
      hide(element, metadata) {
        if (hidden.has(element) || hidden.size >= limit) return false;
        hidden.set(element, {
          value: element.style.getPropertyValue("display"),
          priority: element.style.getPropertyPriority("display"),
          metadata
        });
        element.style.setProperty("display", "none", "important");
        return true;
      },
      restore(element) {
        const saved = hidden.get(element);
        if (!saved) return false;
        hidden.delete(element);
        if (element.style.getPropertyValue("display") === "none" && element.style.getPropertyPriority("display") === "important") {
          if (saved.value)
            element.style.setProperty("display", saved.value, saved.priority);
          else element.style.removeProperty("display");
        }
        return true;
      },
      reconcile(keep) {
        for (const [element, saved] of hidden) {
          if (element.isConnected === false) hidden.delete(element);
          else if (!keep(element, saved.metadata)) this.restore(element);
        }
      },
      get size() {
        return hidden.size;
      }
    };
  }

  // src/ios/review-queue.js
  function createReviewQueue({ limit = 8 } = {}) {
    const pending = [];
    let current = null;
    return {
      enqueue(item) {
        if (current?.key === item.key || pending.some((value) => value.key === item.key))
          return false;
        if (pending.length >= limit) return false;
        pending.push(item);
        return true;
      },
      take() {
        if (!current) current = pending.shift() || null;
        return current;
      },
      finish() {
        const previous = current;
        current = null;
        return previous;
      },
      get size() {
        return pending.length + (current ? 1 : 0);
      },
      get active() {
        return current;
      }
    };
  }
  function createBannerReviewGate({ limit = 2, intervalMs = 6e4 } = {}) {
    const reviewed = [];
    let lastPrompt = -Infinity;
    return {
      canPrompt(key, element, now = Date.now()) {
        if (reviewed.length >= limit || now - lastPrompt < intervalMs)
          return false;
        return !reviewed.some(
          (previous) => previous.key === key || previous.element === element || previous.element?.contains?.(element) || element?.contains?.(previous.element)
        );
      },
      record(key, element, now = Date.now()) {
        if (!this.canPrompt(key, element, now)) return false;
        reviewed.push({ key, element });
        lastPrompt = now;
        return true;
      }
    };
  }

  // src/dom/review-target.js
  var UI_SELECTOR = '[data-afs-ui], [id^="adsfriendly-"]';
  var MEDIA_SELECTOR = "img, iframe, video, svg, canvas";
  function visuallyPresent(element) {
    if (!element?.isConnected || element.closest?.(UI_SELECTOR)) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.contentVisibility === "hidden" || Number.parseFloat(style.opacity || "1") <= 0.05 || node.hasAttribute("data-adsfriendly-rule-hidden"))
        return false;
    }
    return true;
  }
  function getReviewRect(element) {
    if (!visuallyPresent(element)) return null;
    const boxes = [
      element,
      ...Array.from(element.querySelectorAll(MEDIA_SELECTOR)).slice(0, 20)
    ].filter(visuallyPresent).map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (!boxes.length) return null;
    let left = Math.max(0, Math.min(...boxes.map((rect) => rect.left)));
    let top = Math.max(0, Math.min(...boxes.map((rect) => rect.top)));
    let right = Math.min(
      innerWidth,
      Math.max(...boxes.map((rect) => rect.right))
    );
    let bottom = Math.min(
      innerHeight,
      Math.max(...boxes.map((rect) => rect.bottom))
    );
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) {
        left = Math.max(left, rect.left);
        right = Math.min(right, rect.right);
      }
      if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) {
        top = Math.max(top, rect.top);
        bottom = Math.min(bottom, rect.bottom);
      }
    }
    if (right - left < 12 || bottom - top < 12) return null;
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top
    };
  }
  function hasReviewContent(element) {
    const media = [
      element,
      ...Array.from(element.querySelectorAll(MEDIA_SELECTOR)).slice(0, 20)
    ];
    if (media.some((node) => {
      if (!getReviewRect(node)) return false;
      if (node.tagName === "IMG") return node.complete && node.naturalWidth > 0;
      if (node.tagName === "IFRAME")
        return !!node.getAttribute("srcdoc") || /^https?:/i.test(node.src || "");
      if (node.tagName === "VIDEO") return node.readyState > 0;
      if (node.tagName === "SVG")
        return !!node.querySelector("path, rect, circle, image, use, text");
      return false;
    }))
      return true;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node, count = 0; (node = walker.nextNode()) && count < 80; count++) {
      if (!(node.textContent || "").trim() || !getReviewRect(node.parentElement))
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (Array.from(range.getClientRects()).some(
        (rect) => rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight
      ))
        return true;
    }
    return false;
  }
  function isReviewTarget(element) {
    return !!element && !["HTML", "BODY", "HEAD", "MAIN"].includes(element.tagName) && !element.closest('nav, header, form, [role="navigation"]') && !!getReviewRect(element) && hasReviewContent(element);
  }
  function reviewTargetIdentity(element) {
    if (!element) return "";
    return JSON.stringify([
      element.tagName,
      element.id,
      (element.innerText || "").trim().slice(0, 500),
      [
        element,
        ...Array.from(
          element.querySelectorAll("a[href], img, iframe, video")
        ).slice(0, 20)
      ].map((node) => [
        node.tagName,
        node.href || "",
        node.currentSrc || node.src || ""
      ])
    ]);
  }
  function watchReviewTarget(element, {
    identity = reviewTargetIdentity(element),
    isValid = () => true,
    onInvalid = () => {
    }
  } = {}) {
    if (!isReviewTarget(element) || !isValid()) return null;
    const marker = document.createElement("div");
    marker.id = "adsfriendly-review-target";
    marker.setAttribute("data-afs-ui", "true");
    marker.setAttribute("aria-hidden", "true");
    marker.style.cssText = "all:initial!important;position:fixed!important;z-index:2147483646!important;pointer-events:none!important;";
    const shadow = marker.attachShadow({ mode: "closed" });
    const frame = document.createElement("div");
    frame.style.cssText = "box-sizing:border-box;width:100%;height:100%;border:2px solid #60a5fa;border-radius:5px;box-shadow:0 0 0 1px #0f172a66;";
    const label = document.createElement("span");
    label.textContent = "Reviewing this area";
    label.style.cssText = "position:absolute;top:2px;left:2px;padding:2px 5px;background:#172235;color:#fff;border-radius:3px;font:11px -apple-system,BlinkMacSystemFont,sans-serif;white-space:nowrap;";
    frame.appendChild(label);
    shadow.appendChild(frame);
    document.body.appendChild(marker);
    let timer = null;
    const cleanup = () => {
      clearTimeout(timer);
      marker.remove();
    };
    const update = () => {
      if (!isValid() || !isReviewTarget(element) || reviewTargetIdentity(element) !== identity) {
        cleanup();
        onInvalid();
        return;
      }
      const rect = getReviewRect(element);
      for (const [key, value] of Object.entries({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }))
        marker.style.setProperty(key, value + "px", "important");
      timer = setTimeout(update, 150);
    };
    update();
    return cleanup;
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

  // src/ios/shared.js
  var extensionApi = globalThis.browser || globalThis.chrome;
  function safeDomSelector(selector) {
    return isReusableDomSelector(selector) && selector.length <= 500 && !selector.includes(":has(") && ![
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
    ].includes(selector.trim().toLowerCase());
  }
  function iosFeatureEnabled(settings, featureId) {
    return settings?.enabled !== false && settings?.featureOverrides?.[featureId] !== false;
  }
  function callApi(object, method, ...args) {
    return new Promise((resolve, reject) => {
      try {
        object[method](...args, (result) => {
          const error = extensionApi?.runtime?.lastError;
          if (error) reject(new Error(error.message));
          else resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  function storageAdapter(area = extensionApi.storage.local) {
    return Object.fromEntries(
      ["get", "set", "remove"].map((method) => [
        method,
        (...args) => callApi(area, method, ...args)
      ])
    );
  }
  var tail = Promise.resolve();
  function serialMutation(operation) {
    const result = tail.then(operation);
    tail = result.catch(() => {
    });
    return result;
  }
  var backupKey = "afsPackageBackup";
  var managedKeys = [
    "appSettings",
    "isEnabled",
    "friendlyMode",
    "whitelist",
    "blacklist",
    "userCustomRules",
    "userElementExceptions",
    "settingsPackageState",
    "afsAllowedPopupHosts",
    "afsBlockedPopupHosts",
    "afsAllowedDomSelectors"
  ];
  var managed = (key) => managedKeys.includes(key) || key.startsWith("p:");
  function managedSnapshot(snapshot) {
    return Object.fromEntries(
      Object.entries(snapshot).filter(([key]) => managed(key))
    );
  }
  async function restoreSnapshot(snapshot, storage) {
    const current = await storage.get(null);
    await storage.set(snapshot);
    const obsolete = Object.keys(current).filter(
      (key) => managed(key) && !(key in snapshot)
    );
    if (obsolete.length) await storage.remove(obsolete);
    const saved = managedSnapshot(await storage.get(null));
    for (const [key, value] of Object.entries(snapshot)) {
      if (JSON.stringify(saved[key]) !== JSON.stringify(value))
        throw new Error("Could not verify restored settings: " + key);
    }
  }
  async function importPackage(input, storage = storageAdapter()) {
    if (new TextEncoder().encode(JSON.stringify(input)).length > 2 * 1024 * 1024)
      throw new Error("Package exceeds 2 MB.");
    const normalized = normalizeSettingsPackage(input);
    return serialMutation(async () => {
      const current = await storage.get(null);
      const before = managedSnapshot(current);
      await storage.set({
        [backupKey]: { savedAt: Date.now(), snapshot: before }
      });
      try {
        await replaceSettingsWithPackage(normalized, storage, "imported");
        await storage.set({
          afsAllowedPopupHosts: {},
          afsBlockedPopupHosts: {},
          afsAllowedDomSelectors: {}
        });
      } catch (error) {
        await restoreSnapshot(before, storage);
        if (current[backupKey])
          await storage.set({ [backupKey]: current[backupKey] });
        else await storage.remove(backupKey);
        throw error;
      }
      return summarizeSettingsPackage(normalized);
    });
  }
  function undoImport(storage = storageAdapter()) {
    return serialMutation(async () => {
      const data = await storage.get(backupKey);
      const backup = data[backupKey];
      if (!backup?.snapshot) throw new Error("No import to undo.");
      await restoreSnapshot(backup.snapshot, storage);
      await storage.remove(backupKey);
    });
  }
  function callbackResult(promise, callback) {
    promise.then(
      (result) => callback(null, result),
      (error) => callback(error)
    );
  }
  async function loadBundled() {
    const response = await fetch(
      extensionApi.runtime.getURL(BUNDLED_SETTINGS_PACKAGE_PATH)
    );
    if (!response.ok)
      throw new Error(`Cannot load bundled package (${response.status}).`);
    return normalizeSettingsPackage(await response.json());
  }
  async function initialize(storage) {
    const data = await storage.get(null);
    if (data[SETTINGS_PACKAGE_STATE_KEY]?.initialized)
      return "already_initialized";
    if (hasMeaningfulExistingSettings(data) || Object.keys(data.afsAllowedPopupHosts || {}).length || Object.keys(data.afsBlockedPopupHosts || {}).length) {
      await storage.set({
        [SETTINGS_PACKAGE_STATE_KEY]: {
          initialized: true,
          source: "existing_settings",
          installed_at: Date.now()
        }
      });
      return "preserved_existing_settings";
    }
    await replaceSettingsWithPackage(
      await loadBundled(),
      storage,
      "bundled"
    );
    return "installed_bundled_package";
  }
  if (typeof window !== "undefined") {
    window.AFSettingsPackage = {
      normalize: normalizeSettingsPackage,
      normalizeApp: normalizeSettings,
      normalizeHost(value) {
        try {
          return new URL(
            String(value || "").replace(/^\|\|/, "").replace(/\^$/, "").replace(/^(?![a-z]+:\/\/)/, "https://")
          ).hostname;
        } catch {
          return "";
        }
      },
      summarize: summarizeSettingsPackage,
      packageToStorage,
      initialize(area, callback) {
        callbackResult(
          serialMutation(() => initialize(storageAdapter(area))),
          callback
        );
      },
      install(input, area, source, callback) {
        callbackResult(
          importPackage(input, storageAdapter(area)).then(
            () => normalizeSettingsPackage(input)
          ),
          callback
        );
      }
    };
    window.AFShared = {
      ...schema_exports,
      ...navigation_exports,
      safeDomSelector,
      iosFeatureEnabled,
      createHiddenElements,
      createReviewQueue,
      createBannerReviewGate,
      isReviewTarget,
      reviewTargetIdentity,
      watchReviewTarget,
      storageValuesEqual,
      isStorageQuotaError,
      callApi,
      storageAdapter,
      serialMutation,
      importPackage,
      undoImport,
      classifyNavigationIntent,
      getResponsiveLayout,
      ruleMatchesResponsiveLayout,
      buildDomSelector,
      extractDomFeatures,
      isReusableDomSelector,
      createElementException,
      matchesElementException
    };
  }
})();
