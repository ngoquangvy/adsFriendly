var AdsFriendlyOptions = (() => {
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
  async function saveSettings(nextSettings, storage = chrome.storage.local) {
    const settings = normalizeSettings(nextSettings);
    const updates = {
      [SETTINGS_KEY]: settings,
      isEnabled: settings.enabled,
      friendlyMode: settings.protectionMode === PROTECTION_MODES.SAFE
    };
    await storage.set(updates);
    const saved = await storage.get(Object.keys(updates));
    for (const [key, expected] of Object.entries(updates)) {
      if (JSON.stringify(saved[key]) !== JSON.stringify(expected))
        throw new Error(`Could not verify saved setting: ${key}.`);
    }
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
        `${selector}|${fingerprint.linkDomain}|${fingerprint.srcHost}|${fingerprint.id}`
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
      fingerprint.tag && (fingerprint.id || fingerprint.className || fingerprint.alt || fingerprint.title || fingerprint.linkDomain || fingerprint.srcHost || fingerprint.idTokens.length || fingerprint.classTokens.length)
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

  // src/media/adaptive-track-policy.js
  var ADAPTIVE_TRACK_RESOLUTION = Object.freeze({
    RESOLVED: "resolved",
    N_TRANSFORM_PENDING: "n_transform_pending",
    SIGNATURE_CIPHER_PENDING: "signature_cipher_pending",
    PROVIDER_CLIENT_PENDING: "provider_client_pending"
  });

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

  // src/media/download-options.js
  var MEDIA_OUTPUT_CONTAINERS = Object.freeze({
    SOURCE: "source",
    MP4: "mp4",
    MKV: "mkv",
    OGG: "ogg"
  });

  // src/media/download-job-contract.js
  var DOWNLOAD_JOB_PREFIX = "adsfriendly.mediaDownloadJob.";
  var DOWNLOAD_HISTORY_KEY = "mediaDownloadHistory";
  var DOWNLOAD_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1e3;

  // src/media/download-job-view.js
  var ACTIVE_STATUSES = /* @__PURE__ */ new Set([
    "starting",
    "probing",
    "downloading",
    "finalizing"
  ]);
  function getMediaJobProgress(job = {}) {
    const progress = job.progress || {};
    const downloadedBytes = finiteOrNull(progress.downloadedBytes);
    const totalBytes = finiteOrNull(progress.totalBytes);
    const processedSeconds = finiteOrNull(progress.processedSeconds);
    const duration = finiteOrNull(progress.duration);
    let percent = null;
    if (duration > 0 && processedSeconds !== null) {
      percent = Math.min(100, Math.round(processedSeconds / duration * 100));
    } else if (totalBytes > 0 && downloadedBytes !== null) {
      percent = Math.min(100, Math.round(downloadedBytes / totalBytes * 100));
    }
    return {
      percent,
      downloadedBytes,
      totalBytes,
      bytesPerSecond: finiteOrNull(progress.bytesPerSecond),
      processedSeconds,
      duration,
      resumedBytes: finiteOrNull(progress.resumedBytes),
      resumable: progress.resumable === true,
      connections: normalizeConnections(job.connections)
    };
  }
  function getMediaJobPrimaryAction(job = {}) {
    if (job.historyOnly === true) return null;
    if (job.status === "paused")
      return {
        type: "resume",
        label: "Resume",
        messageType: "RESUME_MEDIA_DOWNLOAD_JOB"
      };
    if (["cancelled", "failed"].includes(job.status))
      return {
        type: "retry",
        label: "Retry",
        messageType: "RETRY_MEDIA_DOWNLOAD_JOB"
      };
    if (!ACTIVE_STATUSES.has(job.status)) return null;
    if (job.progress?.resumable === true)
      return {
        type: "pause",
        label: "Pause",
        messageType: "PAUSE_MEDIA_DOWNLOAD_JOB"
      };
    return {
      type: "cancel",
      label: "Cancel",
      messageType: "CANCEL_MEDIA_DOWNLOAD_JOB"
    };
  }
  function getMediaJobPauseAvailability(job = {}) {
    if (!ACTIVE_STATUSES.has(job.status)) return null;
    if (job.progress?.resumable === true)
      return { supported: true, label: "Pause", reason: null };
    if (["hls", "dash"].includes(job.kind)) {
      return {
        supported: false,
        label: "Pause unavailable",
        reason: `${job.kind.toUpperCase()} downloads run through FFmpeg and cannot resume partial output yet.`
      };
    }
    if (job.kind === "player_output") {
      return {
        supported: false,
        label: "Pause unavailable",
        reason: "Player output capture must remain continuous; cancel and reload the page to restart."
      };
    }
    if (job.kind === "direct" && job.progress) {
      return {
        supported: false,
        label: "Pause unavailable",
        reason: "This server does not support resumable HTTP Range downloads."
      };
    }
    return {
      supported: false,
      label: "Checking pause\u2026",
      reason: "Pause becomes available after the server confirms HTTP Range support."
    };
  }
  function formatMediaJobDetails(job = {}) {
    const progress = getMediaJobProgress(job);
    if (job.status === "starting") return "Starting Media Helper\u2026";
    if (job.status === "probing") return formatMediaJobStage(job);
    const connectionFact = `${progress.connections} connections`;
    const speedFact = `Speed ${formatBytes(
      ACTIVE_STATUSES.has(job.status) ? progress.bytesPerSecond || 0 : 0
    )}/s`;
    if (job.status === "completed") {
      const size = progress.totalBytes ?? progress.downloadedBytes;
      return [
        "Completed",
        size !== null ? formatBytes(size) : null,
        speedFact,
        connectionFact
      ].filter(Boolean).join(" \xB7 ");
    }
    if (job.status === "failed")
      return ["Failed", job.error || "unknown error", speedFact, connectionFact].filter(Boolean).join(" \xB7 ");
    if (["cancelled", "paused"].includes(job.status)) {
      return [
        job.status === "paused" ? "Paused" : "Cancelled",
        progress.downloadedBytes !== null ? `${formatBytes(progress.downloadedBytes)} downloaded` : null,
        progress.resumable ? "partial data kept" : null,
        speedFact,
        connectionFact
      ].filter(Boolean).join(" \xB7 ");
    }
    if (job.status === "cancelling")
      return `Stopping \xB7 ${speedFact} \xB7 ${connectionFact}`;
    if (job.status === "pausing")
      return `Pausing \xB7 ${speedFact} \xB7 ${connectionFact}`;
    const facts = [];
    if (progress.percent !== null) facts.push(`${progress.percent}%`);
    if (progress.duration > 0 && progress.processedSeconds !== null) {
      facts.push(
        `${formatDuration(progress.processedSeconds)} / ${formatDuration(progress.duration)}`
      );
    }
    if (progress.downloadedBytes !== null) {
      facts.push(
        progress.totalBytes > 0 ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}` : formatBytes(progress.downloadedBytes)
      );
    }
    facts.push(speedFact);
    if (progress.resumedBytes > 0)
      facts.push(`resumed ${formatBytes(progress.resumedBytes)}`);
    if (job.kind !== "player_output") facts.push(connectionFact);
    if (facts.length === 1) facts.unshift(capitalize(job.status || "starting"));
    return facts.join(" \xB7 ");
  }
  function formatMediaJobStage(job = {}) {
    const stages = {
      manifest_fetch: "Reading HLS manifest\u2026",
      resource_check: "Checking HLS key and segment URLs\u2026",
      output_prepare: "Preparing output file\u2026",
      ffmpeg_start: "Starting FFmpeg\u2026",
      compatibility_check: "Testing key and sample segment\u2026",
      provider_resolution: "Resolving selected YouTube quality\u2026",
      segment_download: "Downloading HLS segments\u2026",
      local_assembly: "Preparing local HLS manifest\u2026",
      local_processing: "Processing downloaded media\u2026",
      player_output_capture: "Fast-capturing decoded player output\u2026",
      player_output_probe: "Validating captured video and audio\u2026",
      player_output_remux: "Remuxing captured tracks to MP4\u2026"
    };
    return stages[job.progress?.stage] || "Checking media source\u2026";
  }
  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.round(value / 1024)} KB`;
  }
  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const remaining = total % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}` : `${minutes}:${String(remaining).padStart(2, "0")}`;
  }
  function finiteOrNull(value) {
    if (value === null || value === void 0 || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function normalizeConnections(value) {
    const connections = Number(value);
    return Number.isInteger(connections) && connections > 0 ? connections : 8;
  }
  function capitalize(value) {
    return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Starting";
  }

  // src/options/index.js
  var $ = (id) => document.getElementById(id);
  var whitelistEl = $("whitelist-list");
  var blacklistEl = $("blacklist-list");
  var domSamplesEl = $("dom-samples-container");
  var packageStatusEl = $("package-status");
  var currentSnapshot = {};
  var storageRefreshTimer = null;
  var downloadRefreshTimer = null;
  var DOWNLOAD_HISTORY_VISIBLE_ITEMS = 15;
  initialize().catch((error) => showPackageStatus(error.message, true));
  window.addEventListener("unhandledrejection", (event) => {
    showPackageStatus(
      event.reason?.message || String(event.reason || "Settings action failed."),
      true
    );
    event.preventDefault();
  });
  async function initialize() {
    bindStaticActions();
    chrome.storage.onChanged.addListener(handleStorageChange);
    window.addEventListener(
      "unload",
      () => chrome.storage.onChanged.removeListener(handleStorageChange)
    );
    await loadPage();
    await renderDownloads();
    if (location.hash === "#downloads")
      $("downloads").scrollIntoView({ behavior: "smooth", block: "start" });
    if (location.hash === "#element-decisions") {
      $("element-decisions")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
      const site = new URLSearchParams(location.search).get("site");
      const siteCard = site ? [...document.querySelectorAll(".rule-site")].find(
        (card) => card.dataset.host === site
      ) : null;
      siteCard?.querySelector(".toggle-details")?.click();
    }
  }
  function handleStorageChange(changes, areaName) {
    if (areaName === "session" && Object.keys(changes).some((key) => key.startsWith(DOWNLOAD_JOB_PREFIX))) {
      scheduleDownloadRefresh();
      return;
    }
    if (areaName === "local" && DOWNLOAD_HISTORY_KEY in changes) {
      scheduleDownloadRefresh();
    }
    if (areaName !== "local") return;
    const keys = Object.keys(changes);
    const affectsSettings = keys.some(
      (key) => [
        "appSettings",
        "whitelist",
        "blacklist",
        "userCustomRules",
        "userElementExceptions",
        SETTINGS_PACKAGE_STATE_KEY
      ].includes(key) || key.startsWith("p:")
    );
    if (!affectsSettings) return;
    clearTimeout(storageRefreshTimer);
    storageRefreshTimer = setTimeout(() => {
      loadPage().catch((error) => showPackageStatus(error.message, true));
    }, 80);
  }
  function scheduleDownloadRefresh() {
    if (downloadRefreshTimer) return;
    downloadRefreshTimer = setTimeout(() => {
      downloadRefreshTimer = null;
      void renderDownloads();
    }, 250);
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
    $("btn-download-refresh").onclick = renderDownloads;
    $("btn-download-clear").onclick = clearDownloadHistory;
    $("media-download-connections").onchange = saveDownloadConnections;
    $("btn-reset").onclick = factoryReset;
    bindFeedbackForm();
  }
  async function renderDownloads() {
    const container = $("download-job-manager");
    const status = $("download-manager-status");
    if (!container || !status) return;
    try {
      const [jobsResponse, helper] = await Promise.all([
        chrome.runtime.sendMessage({ type: "GET_MEDIA_DOWNLOAD_JOBS" }),
        chrome.runtime.sendMessage({ type: "GET_MEDIA_HELPER_STATUS" })
      ]);
      const jobs = Array.isArray(jobsResponse?.items) ? jobsResponse.items : [];
      const activeCount = jobs.filter(
        (job) => [
          "starting",
          "probing",
          "downloading",
          "finalizing",
          "pausing",
          "cancelling"
        ].includes(job.status)
      ).length;
      status.textContent = `${jobs.length} jobs \xB7 ${activeCount} active \xB7 ${helper?.status === "ready" ? `Media Helper ${helper.helperVersion || "ready"}` : "Media Helper unavailable"}`;
      status.style.color = helper?.status === "ready" ? "#94a3b8" : "#f59e0b";
      $("btn-download-clear").disabled = !jobs.some(
        (job) => !isActiveDownload(job)
      );
      if (!jobs.length) {
        const empty = document.createElement("div");
        empty.className = "empty-msg";
        empty.textContent = "No download history yet.";
        container.replaceChildren(empty);
        updateDownloadHistoryViewport(container);
        return;
      }
      container.querySelector(".empty-msg")?.remove();
      const existing = new Map(
        [...container.querySelectorAll(".download-history-item")].map((row) => [
          row.dataset.jobId,
          row
        ])
      );
      const visibleIds = /* @__PURE__ */ new Set();
      for (const job of jobs) {
        visibleIds.add(job.id);
        const row = existing.get(job.id) || createDownloadHistoryItem();
        updateDownloadHistoryItem(row, job, helper);
        container.append(row);
      }
      for (const [jobId, row] of existing) {
        if (!visibleIds.has(jobId)) row.remove();
      }
      updateDownloadHistoryViewport(container);
    } catch (error) {
      status.textContent = `Downloads unavailable \xB7 ${error.message}`;
      status.style.color = "#f87171";
    }
  }
  function updateDownloadHistoryViewport(container) {
    const rows = [...container.querySelectorAll(".download-history-item")];
    const scrollable = rows.length > DOWNLOAD_HISTORY_VISIBLE_ITEMS;
    container.classList.toggle("is-scrollable", scrollable);
    if (!scrollable) {
      container.style.removeProperty("max-height");
      return;
    }
    const visibleRows = rows.slice(0, DOWNLOAD_HISTORY_VISIBLE_ITEMS);
    const styles = getComputedStyle(container);
    const gap = Number.parseFloat(styles.rowGap || styles.gap) || 0;
    const height = visibleRows.reduce(
      (total, row) => total + row.getBoundingClientRect().height,
      gap * (visibleRows.length - 1)
    );
    container.style.maxHeight = `${Math.ceil(height)}px`;
  }
  function createDownloadHistoryItem() {
    const row = document.createElement("article");
    row.className = "download-history-item";
    const header = document.createElement("div");
    header.className = "download-history-header";
    const title = document.createElement("div");
    title.className = "download-history-title";
    const badge = document.createElement("span");
    badge.className = "download-status";
    header.append(title, badge);
    const progressTrack = document.createElement("div");
    progressTrack.className = "download-progress-track";
    const progressBar = document.createElement("div");
    progressBar.className = "download-progress-bar";
    progressTrack.append(progressBar);
    const details = document.createElement("div");
    details.className = "download-history-details";
    const output = document.createElement("div");
    output.className = "download-output-path";
    const errorDetails = document.createElement("pre");
    errorDetails.className = "download-error-details";
    errorDetails.hidden = true;
    const controls = document.createElement("div");
    controls.className = "download-history-controls";
    row.append(header, progressTrack, details, output, errorDetails, controls);
    return row;
  }
  function updateDownloadHistoryItem(row, job, helper) {
    row.dataset.jobId = job.id;
    const active = isActiveDownload(job);
    row.classList.toggle("is-terminal", !active);
    const title = row.querySelector(".download-history-title");
    title.textContent = job.title || `${String(job.kind || "media").toUpperCase()} download`;
    title.title = job.outputPath || job.candidate?.manifestUrl || job.candidate?.sourceUrl || "";
    const badge = row.querySelector(".download-status");
    badge.className = `download-status download-status-${job.status || "unknown"}`;
    badge.textContent = String(job.status || "unknown").toUpperCase();
    const progress = getMediaJobProgress(job);
    const progressTrack = row.querySelector(".download-progress-track");
    progressTrack.hidden = !active;
    row.querySelector(".download-progress-bar").style.width = `${progress.percent ?? 0}%`;
    const details = row.querySelector(".download-history-details");
    details.hidden = !active;
    details.textContent = formatMediaJobDetails(job);
    const output = row.querySelector(".download-output-path");
    output.textContent = job.outputPath || job.error || (active ? formatMediaJobStage(job) : "No output file");
    output.title = output.textContent;
    const errorDetails = row.querySelector(".download-error-details");
    const hasError = job.status === "failed" && Boolean(job.error);
    const errorExpanded = hasError && row.dataset.errorExpanded === "true";
    errorDetails.textContent = hasError ? job.error : "";
    errorDetails.hidden = !errorExpanded;
    const controls = row.querySelector(".download-history-controls");
    controls.replaceChildren();
    const primary = getMediaJobPrimaryAction(job);
    const pauseAvailability = getMediaJobPauseAvailability(job);
    if (pauseAvailability && !pauseAvailability.supported) {
      const unavailable = document.createElement("button");
      unavailable.className = "btn-secondary download-unavailable";
      unavailable.textContent = pauseAvailability.label;
      unavailable.title = pauseAvailability.reason;
      unavailable.disabled = true;
      controls.append(unavailable);
    }
    if (primary) {
      controls.append(
        downloadActionButton(primary.label, primary.messageType, job.id, {
          danger: primary.type === "cancel",
          compact: !active
        })
      );
    }
    if (job.status === "completed" && job.outputPath) {
      const outputActionsReady = helper?.capabilities?.["output.open"] === true && helper?.capabilities?.["output.reveal"] === true;
      const open = downloadActionButton(
        "Open",
        "OPEN_MEDIA_DOWNLOAD_OUTPUT",
        job.id,
        { compact: true }
      );
      const reveal = downloadActionButton(
        "Folder",
        "REVEAL_MEDIA_DOWNLOAD_OUTPUT",
        job.id,
        { compact: true }
      );
      reveal.title = "Open file location";
      open.disabled = !outputActionsReady;
      reveal.disabled = !outputActionsReady;
      if (!outputActionsReady) {
        open.title = reveal.title = "Update Media Helper to use output actions.";
      }
      controls.append(open, reveal);
    }
    if (hasError) {
      const toggle = localDownloadButton(
        errorExpanded ? "Hide details" : "Show details",
        () => {
          const expanded = row.dataset.errorExpanded !== "true";
          row.dataset.errorExpanded = String(expanded);
          errorDetails.hidden = !expanded;
          toggle.textContent = expanded ? "Hide details" : "Show details";
          toggle.setAttribute("aria-expanded", String(expanded));
        }
      );
      toggle.setAttribute("aria-expanded", String(errorExpanded));
      const copy = localDownloadButton("Copy error", async () => {
        await copyText(job.error);
        const original = copy.textContent;
        copy.textContent = "Copied";
        setTimeout(() => {
          copy.textContent = original;
        }, 1200);
      });
      controls.append(toggle, copy);
    }
    if (![
      "starting",
      "probing",
      "downloading",
      "finalizing",
      "pausing",
      "cancelling"
    ].includes(job.status)) {
      controls.append(
        downloadActionButton("Remove", "REMOVE_MEDIA_DOWNLOAD_HISTORY", job.id, {
          danger: true,
          compact: true
        })
      );
    }
  }
  function localDownloadButton(label, action) {
    const button = document.createElement("button");
    button.className = "btn-secondary download-compact-action";
    button.type = "button";
    button.textContent = label;
    button.onclick = async () => {
      try {
        await action();
      } catch (error) {
        $("download-manager-status").textContent = `Action failed \xB7 ${error.message}`;
        $("download-manager-status").style.color = "#f87171";
      }
    };
    return button;
  }
  async function copyText(value) {
    const text = String(value || "");
    if (!text) throw new Error("No error details to copy.");
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Could not copy the error details.");
  }
  function downloadActionButton(label, messageType, jobId, { danger = false, compact = false } = {}) {
    const button = document.createElement("button");
    button.className = danger ? "btn-secondary download-danger" : "btn-secondary";
    if (compact) button.classList.add("download-compact-action");
    button.textContent = label;
    button.onclick = async () => {
      if (messageType === "REMOVE_MEDIA_DOWNLOAD_HISTORY" && !confirm("Remove this history entry? The downloaded file will be kept."))
        return;
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "Working\u2026";
      try {
        const response = await chrome.runtime.sendMessage({
          type: messageType,
          jobId,
          connections: Number($("media-download-connections").value || 8)
        });
        if (!["started", "pausing", "cancelling", "opened", "removed"].includes(
          response?.status
        ))
          throw new Error(
            response?.reason || response?.error || "Download action failed."
          );
        await renderDownloads();
      } catch (error) {
        button.disabled = false;
        button.textContent = original;
        $("download-manager-status").textContent = `Action failed \xB7 ${error.message}`;
        $("download-manager-status").style.color = "#f87171";
      }
    };
    return button;
  }
  function isActiveDownload(job) {
    return [
      "starting",
      "probing",
      "downloading",
      "finalizing",
      "pausing",
      "cancelling"
    ].includes(job.status);
  }
  async function clearDownloadHistory() {
    if (!confirm(
      "Clear all finished download history? Downloaded files will be kept."
    ))
      return;
    const response = await chrome.runtime.sendMessage({
      type: "CLEAR_MEDIA_DOWNLOAD_HISTORY"
    });
    if (response?.status !== "removed") {
      $("download-manager-status").textContent = `Could not clear history \xB7 ${response?.reason || response?.error || "unknown error"}`;
      $("download-manager-status").style.color = "#f87171";
      return;
    }
    await renderDownloads();
  }
  async function saveDownloadConnections() {
    const settings = await saveSettings({
      ...currentSnapshot.appSettings || {},
      mediaDownloadConnections: Number(
        $("media-download-connections").value || 8
      )
    });
    currentSnapshot.appSettings = settings;
  }
  async function loadPage() {
    currentSnapshot = await chrome.storage.local.get(null);
    const settings = await loadSettings();
    currentSnapshot.appSettings = settings;
    $("settings-enabled").checked = settings.enabled;
    $("settings-mode").value = settings.protectionMode;
    $("media-download-connections").value = String(
      settings.mediaDownloadConnections
    );
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
      `${summary.siteCount} sites \xB7 ${summary.ruleCount} hidden \xB7 ${summary.exceptionCount} not ads \xB7 ${summary.whitelistCount} trusted \xB7 ${summary.blacklistCount} blocked \xB7 ${summary.trustedPathCount} workflows`
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

${summary.ruleCount} hidden rules and ${summary.exceptionCount} not-ad decisions across ${summary.siteCount} sites
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
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_DOMAIN_DECISION",
      action: type === "whitelist" ? "WHITELIST" : "BLACKLIST",
      domain: hostname
    });
    if (response?.status !== "saved")
      throw new Error(response?.error || "Could not save domain.");
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
        const domain = list[Number(button.dataset.index)];
        const response = await chrome.runtime.sendMessage({
          type: "REMOVE_DOMAIN_DECISION",
          listName: type,
          domain
        });
        if (response?.status !== "saved")
          throw new Error(response?.error || "Could not remove domain.");
        await loadPage();
      };
    });
  }
  function renderCustomRules() {
    const container = $("custom-rules-container");
    const rulesByHost = currentSnapshot.userCustomRules || {};
    const exceptionsByHost = currentSnapshot.userElementExceptions || {};
    const hostnames = [
      .../* @__PURE__ */ new Set([...Object.keys(rulesByHost), ...Object.keys(exceptionsByHost)])
    ].sort();
    if (!hostnames.length) {
      container.innerHTML = '<div class="empty-msg">No page element decisions found yet.</div>';
      return;
    }
    container.innerHTML = hostnames.map((hostname) => {
      const rules = rulesByHost[hostname] || [];
      const exceptions = exceptionsByHost[hostname] || [];
      const hiddenDetails = rules.map((rule, index) => {
        const selector = typeof rule === "string" ? rule : rule.selector;
        const fingerprint = typeof rule === "object" && rule.fingerprint ? JSON.stringify(rule.fingerprint) : "Simple selector";
        const layout = typeof rule === "object" ? rule.layout || "any" : "any";
        return `
            <div style="display:flex; justify-content:space-between; gap:0.75rem; padding:8px 0; border-top:1px solid rgba(255,255,255,0.05); font-size:0.75rem;">
              <div style="min-width:0">
                <span class="sample-chip" style="margin-right:6px; color:#fca5a5">HIDDEN</span>
                <code style="word-break:break-all; color:#93c5fd">${safeText(selector)}</code>
                <span class="sample-chip" style="margin-left:6px">${safeText(layout.toUpperCase())}</span>
                <div style="color:#64748b; margin-top:3px; word-break:break-all">${safeText(fingerprint)}</div>
              </div>
              <button class="btn-delete-rule-item btn-delete" data-host="${safeText(hostname)}" data-index="${index}" title="Delete rule">Delete</button>
            </div>`;
      }).join("");
      const exceptionDetails = exceptions.map((rule) => {
        const fingerprint = rule?.fingerprint ? JSON.stringify(rule.fingerprint) : "Fingerprint unavailable";
        return `
            <div style="display:flex; justify-content:space-between; gap:0.75rem; padding:8px 0; border-top:1px solid rgba(255,255,255,0.05); font-size:0.75rem;">
              <div style="min-width:0">
                <span class="sample-chip" style="margin-right:6px; color:#86efac">NOT AD</span>
                <code style="word-break:break-all; color:#93c5fd">${safeText(rule.selector)}</code>
                <span class="sample-chip" style="margin-left:6px">${safeText((rule.layout || "any").toUpperCase())}</span>
                <div style="color:#64748b; margin-top:3px; word-break:break-all">${safeText(fingerprint)}</div>
              </div>
              <button class="btn-delete-exception-item btn-delete" data-host="${safeText(hostname)}" data-id="${safeText(rule.id)}" title="Forget decision">Forget</button>
            </div>`;
      }).join("");
      const details = `${hiddenDetails}${exceptionDetails}`;
      return `
        <div class="rule-site" data-host="${safeText(hostname)}" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); padding:12px; border-radius:12px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem">
            <div>
              <div style="font-weight:bold; color:#e2e8f0">${safeText(hostname)}</div>
              <div style="font-size:0.75rem; color:#64748b">${rules.length} hidden \xB7 ${exceptions.length} not ads</div>
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
        const rule = currentSnapshot.userCustomRules?.[button.dataset.host]?.[Number(button.dataset.index)];
        const selector = typeof rule === "string" ? rule : rule?.selector;
        const response = await chrome.runtime.sendMessage({
          type: "REMOVE_CUSTOM_RULES",
          hostname: button.dataset.host,
          selectors: [selector]
        });
        if (response?.status !== "saved")
          throw new Error(response?.error || "Could not delete rule.");
        await loadPage();
      };
    });
    container.querySelectorAll(".btn-delete-exception-item").forEach((button) => {
      button.onclick = async () => {
        const response = await chrome.runtime.sendMessage({
          type: "REMOVE_ELEMENT_EXCEPTIONS",
          hostname: button.dataset.host,
          ids: [button.dataset.id]
        });
        if (response?.status !== "saved")
          throw new Error(response?.error || "Could not forget decision.");
        await loadPage();
      };
    });
    container.querySelectorAll(".reset-site-rules").forEach((button) => {
      button.onclick = async () => {
        const hostname = button.dataset.host;
        if (!confirm(`Remove all hidden and not-ad decisions for ${hostname}?`))
          return;
        const response = await chrome.runtime.sendMessage({
          type: "RESET_ELEMENT_DECISIONS",
          hostname
        });
        if (response?.status !== "saved")
          throw new Error(response?.error || "Could not reset site rules.");
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
