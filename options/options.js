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

  // src/options/section-catalog.js
  var SETTINGS_SECTIONS = Object.freeze(
    [
      {
        id: "protection",
        title: "Protection",
        description: "Choose how AdsFriendly protects your browsing.",
        icon: "shield"
      },
      {
        id: "sites",
        title: "Sites & Rules",
        description: "Manage allowed sites, blocked sites and personal page decisions.",
        icon: "rules",
        aliases: ["element-decisions"]
      },
      {
        id: "packages",
        title: "Settings Package",
        description: "Save, share or install an editable settings snapshot.",
        icon: "package"
      },
      {
        id: "downloads",
        title: "Downloads",
        description: "Manage downloads and files without leaving Settings.",
        icon: "download"
      },
      {
        id: "activity",
        title: "Activity",
        description: "Review recent navigation blocks.",
        icon: "activity"
      },
      {
        id: "advanced",
        title: "Advanced",
        description: "Local training data, developer diagnostics and storage tools.",
        icon: "tools"
      }
    ].map(
      (section) => Object.freeze({
        ...section,
        aliases: Object.freeze(section.aliases || [])
      })
    )
  );
  function resolveSettingsSection(hash, remembered = null) {
    const requested = String(hash || "").replace(/^#/, "");
    const direct = SETTINGS_SECTIONS.find(
      (section) => section.id === requested || section.aliases.includes(requested)
    );
    if (requested) return direct || SETTINGS_SECTIONS[0];
    return SETTINGS_SECTIONS.find((section) => section.id === remembered) || SETTINGS_SECTIONS[0];
  }
  function matchesSettingsSearch(values, query) {
    const needle = String(query || "").trim().toLocaleLowerCase();
    return !needle || values.some(
      (value) => String(value || "").toLocaleLowerCase().includes(needle)
    );
  }

  // src/options/section-navigation.js
  var LAST_SECTION_KEY = "adsfriendly.settings.lastSection";
  var ICON_PATHS = {
    shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3z",
    rules: "M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1",
    package: "M12 3l9 5-9 5-9-5 9-5zm-9 5v10l9 5 9-5V8M12 13v10",
    download: "M12 3v12m-5-5l5 5 5-5M4 17v4h16v-4",
    activity: "M3 12h4l3-8 4 16 3-8h4",
    tools: "M4 7h16M4 17h16M8 4v6m8 4v6"
  };
  function createSettingsNavigation({ document: document2, window: window2, onActivate }) {
    const nav = document2.getElementById("settings-navigation");
    const select = document2.getElementById("settings-section-select");
    const title = document2.getElementById("settings-page-title");
    const description = document2.getElementById("settings-page-description");
    const links = /* @__PURE__ */ new Map();
    const panels = /* @__PURE__ */ new Map();
    let active = null;
    let stopped = false;
    for (const section of SETTINGS_SECTIONS) {
      const panel = document2.getElementById(`settings-panel-${section.id}`);
      if (!panel) throw new Error(`Missing Settings section: ${section.id}`);
      panels.set(section.id, panel);
      const link = document2.createElement("a");
      link.href = `#${section.id}`;
      link.className = "settings-nav-link";
      const icon = document2.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      const path = document2.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", ICON_PATHS[section.icon] || ICON_PATHS.tools);
      icon.append(path);
      const label = document2.createElement("span");
      label.textContent = section.title;
      link.append(icon, label);
      nav.append(link);
      links.set(section.id, link);
      const option = document2.createElement("option");
      option.value = section.id;
      option.textContent = section.title;
      select.append(option);
    }
    function remembered() {
      try {
        return window2.sessionStorage.getItem(LAST_SECTION_KEY);
      } catch {
        return null;
      }
    }
    function activate() {
      if (stopped) return;
      const section = resolveSettingsSection(window2.location.hash, remembered());
      const changed = section.id !== active;
      active = section.id;
      for (const [id, panel] of panels) panel.hidden = id !== active;
      for (const [id, link] of links) {
        if (id === active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
      select.value = active;
      title.textContent = section.title;
      description.textContent = section.description;
      document2.title = `${section.title} \xB7 AdsFriendly Settings`;
      try {
        window2.sessionStorage.setItem(LAST_SECTION_KEY, active);
      } catch {
      }
      if (changed) {
        document2.getElementById("settings-main").scrollTop = 0;
        window2.scrollTo?.({ top: 0, behavior: "instant" });
      }
      onActivate(section.id, { hash: window2.location.hash, changed });
    }
    function onSelect() {
      window2.location.hash = select.value;
    }
    window2.addEventListener("hashchange", activate);
    select.addEventListener("change", onSelect);
    activate();
    return {
      isActive: (id) => active === id,
      current: () => active,
      stop() {
        stopped = true;
        window2.removeEventListener("hashchange", activate);
        select.removeEventListener("change", onSelect);
      }
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
  function formatDownloadEta(progress, now = Date.now()) {
    const seconds = progress?.etaSeconds;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(progress.etaUpdatedAt) || now - progress.etaUpdatedAt > 12e3)
      return null;
    if (seconds < 60) return `${Math.max(10, Math.ceil(seconds / 10) * 10)} s`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
    const minutes = Math.ceil(seconds / 300) * 5;
    return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  }

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
    const totalBytes = finiteOrNull(progress.totalBytes ?? job.totalBytes);
    const processedSeconds = finiteOrNull(progress.processedSeconds);
    const duration = finiteOrNull(progress.duration);
    const { percent } = getDownloadProgress({ ...progress, totalBytes });
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
    else if (job.status === "downloading")
      facts.push("Progress not yet available");
    if (getDownloadProgress(job.progress).basis === "resources")
      facts.push(
        `${job.progress.completedResources} / ${job.progress.totalResources} resources`
      );
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
    const eta = job.status === "downloading" && formatDownloadEta(job.progress);
    if (eta) facts.push(eta);
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
  function isMediaJobActive(job = {}) {
    return [...ACTIVE_STATUSES, "pausing", "cancelling"].includes(job.status);
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

  // src/downloads/ui/progress-bar.js
  function createDownloadProgressBar(document2) {
    const track = document2.createElement("div");
    track.className = "download-progress-track";
    const bar = document2.createElement("div");
    bar.className = "download-progress-bar";
    track.append(bar);
    return track;
  }
  function updateDownloadProgressBar(track, percent, active) {
    track.hidden = !active;
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", "Download progress");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    const known = Number.isFinite(percent);
    const value = known ? Math.max(0, Math.min(100, percent)) : null;
    track.classList.toggle("is-indeterminate", !known);
    track.querySelector(".download-progress-bar").style.width = known ? `${value}%` : "100%";
    if (known) {
      track.setAttribute("aria-valuenow", String(value));
      track.setAttribute("aria-valuetext", `${value}%`);
    } else {
      track.removeAttribute("aria-valuenow");
      track.setAttribute("aria-valuetext", "Progress not yet available");
    }
  }

  // src/options/downloads/history-list.js
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
  function createDownloadHistoryList({ document: document2, window: window2, actionButton }) {
    const $2 = (id) => document2.getElementById(id);
    const navigator = window2.navigator;
    const DOWNLOAD_HISTORY_VISIBLE_ITEMS = 15;
    const getComputedStyle = (node) => window2.getComputedStyle(node);
    function render(jobs, helper) {
      const container = $2("download-job-manager");
      if (!jobs.length) {
        const empty = document2.createElement("div");
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
      const sorted = [...jobs].sort(
        (a, b) => Number(isActiveDownload(b)) - Number(isActiveDownload(a))
      );
      for (const [index, job] of sorted.entries()) {
        visibleIds.add(job.id);
        const row = existing.get(job.id) || createDownloadHistoryItem();
        updateDownloadHistoryItem(row, job, helper);
        if (container.children[index] !== row)
          container.insertBefore(row, container.children[index] || null);
      }
      for (const [jobId, row] of existing)
        if (!visibleIds.has(jobId)) row.remove();
    }
    function updateDownloadHistoryViewport(container) {
      const rows = [
        ...container.querySelectorAll(".download-history-item")
      ].filter((row) => !row.hidden);
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
      container.style.maxHeight = `${Math.ceil(Math.min(height, window2.innerHeight * 0.65))}px`;
    }
    function createDownloadHistoryItem() {
      const row = document2.createElement("article");
      row.className = "download-history-item";
      const header = document2.createElement("div");
      header.className = "download-history-header";
      const title = document2.createElement("div");
      title.className = "download-history-title";
      const badge = document2.createElement("span");
      badge.className = "download-status";
      header.append(title, badge);
      const progressTrack = createDownloadProgressBar(document2);
      const details = document2.createElement("div");
      details.className = "download-history-details";
      const output = document2.createElement("div");
      output.className = "download-output-path";
      const errorDetails = document2.createElement("pre");
      errorDetails.className = "download-error-details";
      errorDetails.hidden = true;
      const controls = document2.createElement("div");
      controls.className = "download-history-controls";
      row.append(header, progressTrack, details, output, errorDetails, controls);
      return row;
    }
    function updateDownloadHistoryItem(row, job, helper) {
      row.dataset.jobId = job.id;
      row.dataset.status = job.status;
      row.dataset.searchText = [job.title, job.outputPath].filter(Boolean).join(" ");
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
      updateDownloadProgressBar(progressTrack, progress.percent, active);
      const details = row.querySelector(".download-history-details");
      const completedSize = job.status === "completed" ? progress.totalBytes : null;
      details.hidden = !active && !completedSize;
      details.textContent = active ? formatMediaJobDetails(job) : completedSize ? [formatBytes(completedSize), job.downloadSummary?.qualityLabel].filter(Boolean).join(" \xB7 ") : "";
      const output = row.querySelector(".download-output-path");
      output.textContent = job.outputPath || job.error || (active ? formatMediaJobStage(job) : "No output file");
      output.title = output.textContent;
      const errorDetails = row.querySelector(".download-error-details");
      const hasError = job.status === "failed" && Boolean(job.error);
      const errorExpanded = hasError && row.dataset.errorExpanded === "true";
      errorDetails.textContent = hasError ? job.error : "";
      errorDetails.hidden = !errorExpanded;
      const controls = row.querySelector(".download-history-controls");
      const controlsKey = JSON.stringify([
        job.status,
        Boolean(job.outputPath),
        job.error,
        errorExpanded,
        job.historyOnly,
        job.progress?.resumable,
        helper?.capabilities?.["output.open"],
        helper?.capabilities?.["output.reveal"]
      ]);
      if (row.dataset.controlsKey === controlsKey) return;
      row.dataset.controlsKey = controlsKey;
      controls.replaceChildren();
      const primary = getMediaJobPrimaryAction(job);
      const pauseAvailability = getMediaJobPauseAvailability(job);
      if (pauseAvailability && !pauseAvailability.supported) {
        const unavailable = document2.createElement("button");
        unavailable.className = "btn-secondary download-unavailable";
        unavailable.textContent = pauseAvailability.label;
        unavailable.title = pauseAvailability.reason;
        unavailable.disabled = true;
        controls.append(unavailable);
      }
      if (primary) {
        controls.append(
          actionButton(primary.label, primary.messageType, job.id, {
            danger: primary.type === "cancel",
            compact: !active
          })
        );
      }
      if (job.status === "completed" && job.outputPath) {
        const outputActionsReady = helper?.capabilities?.["output.open"] === true && helper?.capabilities?.["output.reveal"] === true;
        const open = actionButton("Open", "OPEN_MEDIA_DOWNLOAD_OUTPUT", job.id, {
          compact: true
        });
        const reveal = actionButton(
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
          window2.setTimeout(() => {
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
          actionButton("Remove", "REMOVE_MEDIA_DOWNLOAD_HISTORY", job.id, {
            danger: true,
            compact: true
          })
        );
      }
    }
    function localDownloadButton(label, action) {
      const button = document2.createElement("button");
      button.className = "btn-secondary download-compact-action";
      button.type = "button";
      button.textContent = label;
      button.onclick = async () => {
        try {
          await action();
        } catch (error) {
          $2("download-manager-status").textContent = `Action failed \xB7 ${error.message}`;
          $2("download-manager-status").style.color = "#f87171";
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
      const textarea = document2.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document2.body.append(textarea);
      textarea.select();
      const copied = document2.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("Could not copy the error details.");
    }
    return {
      render,
      updateViewport: () => updateDownloadHistoryViewport($2("download-job-manager"))
    };
  }

  // src/downloads/intake-contract.js
  var DOWNLOAD_OBSERVER_FEATURE = "background.browser-download-observer";
  var DOWNLOAD_INTAKE_KEY = "browserDownloadIntake.v1";
  var DOWNLOAD_INTAKE_MESSAGES = Object.freeze({
    GET: "GET_BROWSER_DOWNLOAD_INTAKE",
    CLEAR: "CLEAR_BROWSER_DOWNLOAD_INTAKE"
  });
  var INTAKE_MAX_AGE_MS = 60 * 60 * 1e3;

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

  // src/downloads/intake-policy.js
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
  var FILE_AUTO_CHECK_FEATURE = "background.browser-file-auto-check";
  var FILE_AUTO_MIN_BYTES = 8 * 1024 * 1024;
  var FILE_AUTO_CHECK_KEY = "browserFileChecks.v1";

  // src/downloads/intake-diagnostics.js
  function describeDownloadIntake(item, snapshot = {}) {
    const job = snapshot.fileTransfers?.find((row) => row.browserId === item.id);
    const managed = {
      pause_requested: ["helper_preparing", "Preparing Helper transfer"],
      downloading: ["helper_downloading", "Downloading with Helper"],
      completed: ["helper_completed", "Completed with Helper"],
      returned_to_chrome: ["returned_to_chrome", "Returned to Chrome"],
      needs_browser_attention: ["browser_attention", "Check Chrome"]
    }[job?.status];
    if (managed)
      return {
        code: managed[0],
        label: `Detected \xB7 ${managed[1]}`,
        detail: job.status === "downloading" ? "Helper owns this transfer; Chrome is retained as fallback." : "See Browser file transfers below for the result and available actions.",
        tone: job.status === "needs_browser_attention" ? "warning" : "info"
      };
    const notes = [];
    const signedNote = item.authorizationHints ? "Signed/session URL \xB7 temporary link requires Helper verification." : "";
    if (item.state === "complete")
      notes.push("Already completed in Chrome; no Helper transfer was started.");
    if (item.state === "interrupted")
      notes.push("Interrupted in Chrome; no Helper transfer was started.");
    if (item.credentialed) notes.push("URL credentials \xB7 keep in Chrome.");
    const extension = String(item.filename || "").split(".").pop().toLowerCase();
    const unsupported = !FILE_EXTENSIONS.includes(extension);
    if (unsupported) notes.push("File type not supported for Helper handoff.");
    if (notes.length)
      return {
        code: item.authorizationHints ? "signed_url_browser_only" : item.state === "complete" ? "browser_completed" : item.state === "interrupted" ? "browser_interrupted" : unsupported ? "unsupported_file_type" : "browser_only",
        label: `Detected \xB7 ${item.state === "complete" ? "Completed in Chrome" : item.state === "interrupted" ? "Interrupted in Chrome" : "Chrome only"}`,
        detail: [
          signedNote,
          ...notes,
          snapshot.autoChecks?.enabled && item.totalBytes > 0 && item.totalBytes < FILE_AUTO_MIN_BYTES ? "Small file (under 8 MB) \xB7 automatic Helper check skipped." : null
        ].filter(Boolean).join(" "),
        tone: "neutral"
      };
    if (item.assessment?.disposition !== "needs_validation")
      return {
        code: "browser_only",
        label: "Detected \xB7 Chrome only",
        detail: [signedNote, INTAKE_REASON_LABELS[item.assessment?.reason]].filter(Boolean).join(" ") || "Transfer eligibility is unknown; keep in Chrome.",
        tone: "neutral"
      };
    const automatic = snapshot.autoChecks?.items?.find(
      (row) => row.browserId === item.id
    );
    if (["queued", "checking"].includes(automatic?.status))
      return {
        code: "helper_checking",
        label: "Detected \xB7 Checking with Helper",
        detail: "Chrome is still downloading. Checking the same GET file, size, ETag and Range support; no transfer has started.",
        tone: "info"
      };
    if (snapshot.checkErrors?.some((row) => row.browserId === item.id) || automatic?.status === "failed")
      return {
        code: "helper_check_failed",
        label: "Detected \xB7 Helper check failed",
        detail: "The file was detected, but the Helper check failed. Chrome still owns the download; see the error below.",
        tone: "warning"
      };
    if (snapshot.checks?.some((row) => row.browserId === item.id))
      return {
        code: "ready_for_handoff",
        label: "Detected \xB7 Ready to transfer",
        detail: "Same GET file verified \xB7 confirmation required. Chrome continues until you confirm.",
        tone: "ready"
      };
    if (automatic?.status === "closed")
      return {
        code: "helper_check_closed",
        label: "Detected \xB7 Check again",
        detail: "The temporary checked session is no longer available. Chrome continues downloading; check again before transferring.",
        tone: "neutral"
      };
    return {
      code: "check_available",
      label: "Detected \xB7 Check available",
      detail: [
        signedNote,
        automatic?.reason === "small_file" ? "Auto-check skipped: file under 8 MB. Chrome continues; a manual check is optional." : automatic?.reason === "permission_required" ? "Automatic check needs Helper permission; enable it in Settings." : "HTTP file \xB7 request method and browser session not verified. Check with Helper first; no automatic takeover."
      ].filter(Boolean).join(" "),
      tone: "info"
    };
  }
  function describeDownloadObserver(snapshot = {}) {
    const count = Array.isArray(snapshot.items) ? snapshot.items.length : 0;
    const states = {
      off: [
        "Observation off \xB7 downloads are not being recorded",
        "Enable observation before starting a new download. Existing Chrome history is not scanned."
      ],
      starting: [
        "Starting download observation\u2026",
        "Waiting for observation to become ready."
      ],
      permission_required: [
        "Downloads permission required \xB7 detection unavailable",
        "Allow Downloads permission using the observation switch before testing again."
      ],
      observing: [
        `Observing \xB7 ${count} detected \xB7 Downloads stay in Chrome until a confirmed transfer`,
        "No download event recorded in the current observation window. This does not prove a missed download: earlier, private-tab and extension-created downloads are not included."
      ]
    };
    const state = states[snapshot.status] || [
      "Download observation unavailable",
      "Could not read observation state. Reload the extension and try again."
    ];
    return {
      label: state[0] + (snapshot.storageFailed ? " \xB7 Session storage unavailable" : ""),
      empty: state[1]
    };
  }
  function buildDownloadIntakeDiagnosticReport(snapshot = {}) {
    const items = Array.isArray(snapshot.items) ? snapshot.items.slice(0, 50) : [];
    const text = (value, limit) => String(value || "").slice(0, limit);
    return {
      version: 1,
      observerStatus: [
        "off",
        "starting",
        "permission_required",
        "observing",
        "unavailable"
      ].includes(snapshot.status) ? snapshot.status : "unavailable",
      storageFailed: snapshot.storageFailed === true,
      scope: "Current observation window only; not Chrome download history",
      detectedCount: items.length,
      items: items.map((item) => {
        const diagnostic = describeDownloadIntake(item, snapshot);
        return {
          id: item.id,
          filename: text(item.filename, 180),
          host: text(item.host, 253),
          state: text(item.state, 32),
          mime: text(item.mime, 100),
          totalBytes: Number.isSafeInteger(item.totalBytes) && item.totalBytes >= 0 ? item.totalBytes : null,
          authorizationHints: item.authorizationHints === true,
          paused: item.paused === true,
          diagnostic: diagnostic.code,
          reason: text(item.assessment?.reason, 64),
          autoCheck: text(
            snapshot.autoChecks?.items?.find((row) => row.browserId === item.id)?.reason,
            64
          )
        };
      })
    };
  }

  // src/options/downloads/file-transfer-view.js
  var ACTIVE = /* @__PURE__ */ new Set(["pause_requested", "downloading", "returning"]);
  function createFileTransferView({
    document: document2,
    window: window2,
    chrome: chrome2,
    refresh,
    onError
  }) {
    let disposed2 = false;
    function action(label, type, payload, { confirm: confirm2 = false, native = false } = {}) {
      const button = document2.createElement("button");
      button.type = "button";
      button.className = "btn-secondary download-compact-action";
      button.textContent = label;
      button.onclick = async () => {
        if (disposed2) return;
        if (confirm2 && !window2.confirm(
          "Transfer this checked file to Media Helper? Chrome will be paused as a fallback and cancelled only after Helper completes. If handoff fails, AdsFriendly will try to resume Chrome."
        ))
          return;
        button.disabled = true;
        button.textContent = "Working\u2026";
        try {
          if (native && !await chrome2.permissions.request({
            permissions: ["nativeMessaging"]
          }))
            throw Error("Helper connection permission was not granted.");
          const result = await chrome2.runtime.sendMessage({ type, ...payload });
          if (![
            "ready_for_handoff",
            "transferring",
            "returned_to_chrome",
            "opened"
          ].includes(result?.status))
            throw Error(result?.error || "File action is unavailable.");
          if (!disposed2) await refresh();
        } catch (error) {
          if (!disposed2) {
            await refresh();
            onError(error);
          }
        } finally {
          if (!disposed2 && button.isConnected) {
            button.disabled = false;
            button.textContent = label;
          }
        }
      };
      return button;
    }
    function observation(row, item, snapshot) {
      let controls = row.querySelector(".file-check-controls");
      if (!controls) {
        controls = document2.createElement("div");
        controls.className = "file-check-controls download-history-controls";
        row.append(controls);
      }
      const checked = snapshot.checks?.find(
        (check) => check.browserId === item.id
      );
      const active = snapshot.fileTransfers?.find(
        (job) => job.browserId === item.id && ACTIVE.has(job.status)
      );
      const error = snapshot.checkErrors?.find(
        (entry) => entry.browserId === item.id
      )?.error;
      const autoBusy = snapshot.autoChecks?.items?.some(
        (entry) => entry.browserId === item.id && ["queued", "checking"].includes(entry.status)
      );
      const key = JSON.stringify([
        checked?.checkId,
        active?.id,
        item.assessment?.disposition,
        error,
        autoBusy
      ]);
      if (controls.dataset.key === key) return;
      controls.dataset.key = key;
      controls.replaceChildren();
      if (active) {
        const text = document2.createElement("small");
        text.textContent = "Managed below \xB7 Chrome retained as fallback";
        controls.append(text);
      } else if (autoBusy && !checked) {
        const text = document2.createElement("small");
        text.textContent = "Checking\u2026 \xB7 Chrome continues";
        controls.append(text);
      } else if (item.assessment?.disposition === "needs_validation" && FILE_EXTENSIONS.includes(
        String(item.filename || "").split(".").pop().toLowerCase()
      )) {
        controls.append(
          checked ? action(
            "Transfer to Helper",
            FILE_MESSAGES.ACCEPT,
            { browserId: item.id, checkId: checked.checkId },
            { confirm: true }
          ) : action(
            "Check with Helper",
            FILE_MESSAGES.CHECK,
            { browserId: item.id },
            { native: true }
          )
        );
      }
      if (error) {
        const note = document2.createElement("small");
        note.className = "file-transfer-error";
        note.textContent = error;
        controls.append(note);
      }
    }
    function render(snapshot) {
      const container = document2.getElementById("browser-file-transfers");
      if (!container) return;
      const items = snapshot.fileTransfers || [];
      document2.getElementById("browser-file-transfer-card").hidden = !items.length;
      const existing = new Map(
        [...container.children].map((row) => [row.dataset.jobId, row])
      );
      const sorted = [...items].sort(
        (a, b) => Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status))
      );
      const labels = {
        pause_requested: "Preparing handoff",
        downloading: "Downloading with Helper",
        completed: "Completed",
        returned_to_chrome: "Continued in Chrome",
        needs_browser_attention: "Check Chrome"
      };
      for (const [index, job] of sorted.entries()) {
        let row = existing.get(job.id);
        if (!row) {
          row = document2.createElement("article");
          row.className = "download-history-item";
          row.dataset.jobId = job.id;
          for (const name of ["title", "details", "path", "note", "controls"]) {
            const node = document2.createElement("div");
            node.className = "file-transfer-" + name;
            if (name === "path") node.classList.add("download-output-path");
            if (name === "controls")
              node.classList.add("download-history-controls");
            row.append(node);
          }
          row.insertBefore(
            createDownloadProgressBar(document2),
            row.querySelector(".file-transfer-details")
          );
        }
        row.querySelector(".file-transfer-title").textContent = job.filename;
        const active = ACTIVE.has(job.status);
        const { percent } = getMediaJobProgress(job);
        updateDownloadProgressBar(
          row.querySelector(".download-progress-track"),
          percent,
          active
        );
        row.querySelector(".file-transfer-details").textContent = [
          labels[job.status] || job.status,
          active && percent !== null ? `${percent}%` : null,
          job.status === "downloading" ? formatDownloadEta(job.progress) : null,
          active ? `${formatBytes(job.progress?.downloadedBytes || 0)} / ${formatBytes(job.totalBytes)} \xB7 ${formatBytes(job.progress?.bytesPerSecond || 0)}/s` : formatBytes(job.totalBytes)
        ].filter(Boolean).join(" \xB7 ");
        const path = row.querySelector(".file-transfer-path");
        path.textContent = job.outputPath || job.error || "";
        path.title = path.textContent;
        row.querySelector(".file-transfer-note").textContent = job.outputPath && job.error ? job.error : "";
        const controls = row.querySelector(".file-transfer-controls");
        if (controls.dataset.status !== job.status) {
          controls.dataset.status = job.status;
          controls.replaceChildren();
          if (job.status === "downloading")
            controls.append(
              action("Return to Chrome", FILE_MESSAGES.RETURN, { jobId: job.id })
            );
          if (job.status === "completed" && job.outputPath) {
            controls.append(
              action("Open", FILE_MESSAGES.OPEN, { jobId: job.id }),
              action("Folder", FILE_MESSAGES.REVEAL, { jobId: job.id })
            );
          }
        }
        if (container.children[index] !== row)
          container.insertBefore(row, container.children[index] || null);
        existing.delete(job.id);
      }
      for (const row of existing.values()) row.remove();
    }
    return {
      observation,
      render,
      stop() {
        disposed2 = true;
      }
    };
  }

  // src/options/downloads/intake-panel.js
  function createDownloadIntakePanel({
    document: document2,
    window: window2 = document2.defaultView,
    chrome: chrome2,
    isActive,
    getEnabled = () => false,
    saveEnabled,
    getAutoCheckEnabled = () => false,
    saveAutoCheckEnabled = async () => {
    }
  }) {
    const $2 = (id) => document2.getElementById(id);
    const toggle = $2("browser-download-observe");
    if (!toggle)
      return {
        bind() {
        },
        render: async () => {
        },
        scheduleRefresh() {
        },
        stop() {
        }
      };
    let disposed2 = false, revision = 0, timer = null, bound = false, busy = false;
    const status = $2("browser-download-intake-status");
    const copy = $2("browser-download-intake-copy");
    const autoToggle = $2("browser-file-auto-check");
    let lastSnapshot = null;
    const files = createFileTransferView({
      document: document2,
      window: window2,
      chrome: chrome2,
      refresh: render,
      onError: showError
    });
    function showError(error) {
      if (!disposed2)
        status.textContent = error?.message || "Browser download observation unavailable.";
    }
    async function render() {
      if (disposed2 || !isActive()) return;
      const request = ++revision;
      toggle.checked = getEnabled();
      if (autoToggle) autoToggle.checked = getAutoCheckEnabled();
      try {
        const snapshot = await chrome2.runtime.sendMessage({
          type: DOWNLOAD_INTAKE_MESSAGES.GET
        });
        if (disposed2 || !isActive() || request !== revision) return;
        lastSnapshot = snapshot || { status: "unavailable" };
        if (copy) copy.disabled = false;
        const observer = describeDownloadObserver(lastSnapshot);
        status.textContent = observer.label;
        const list = $2("browser-download-observations");
        const existing = new Map(
          [...list.querySelectorAll(".browser-download-observation")].map(
            (row) => [Number(row.dataset.browserId), row]
          )
        );
        list.querySelector(".empty-msg")?.remove();
        const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
        $2("browser-download-intake-clear").disabled = !items.length;
        if (!items.length) {
          const empty = document2.createElement("p");
          empty.className = "empty-msg";
          empty.textContent = observer.empty;
          list.append(empty);
        }
        for (const [index, item] of items.entries()) {
          let row = existing.get(item.id);
          if (!row) {
            row = document2.createElement("article");
            row.className = "browser-download-observation";
            row.dataset.browserId = item.id;
            row.append(
              document2.createElement("strong"),
              Object.assign(document2.createElement("span"), {
                className: "browser-download-detection"
              }),
              document2.createElement("div"),
              document2.createElement("small")
            );
          }
          const title = row.querySelector("strong");
          title.textContent = item.filename || "Unnamed file";
          const details = row.querySelector("div");
          details.textContent = [
            item.host || "Browser-local source",
            item.totalBytes === null ? "Size unavailable" : formatBytes(item.totalBytes),
            item.state
          ].filter(Boolean).join(" \xB7 ");
          const reason = row.querySelector("small");
          const diagnostic = describeDownloadIntake(item, snapshot);
          row.dataset.detection = diagnostic.code;
          const detection = row.querySelector(".browser-download-detection");
          detection.textContent = diagnostic.label;
          detection.dataset.tone = diagnostic.tone;
          reason.textContent = diagnostic.detail;
          files.observation(row, item, snapshot);
          if (list.children[index] !== row)
            list.insertBefore(row, list.children[index] || null);
          existing.delete(item.id);
        }
        for (const row of existing.values()) row.remove();
        files.render(snapshot);
      } catch (error) {
        if (request === revision && isActive()) {
          lastSnapshot = null;
          if (copy) copy.disabled = true;
          showError(error);
        }
      }
    }
    function scheduleRefresh() {
      if (disposed2 || !isActive() || timer) return;
      timer = setTimeout(() => {
        timer = null;
        void render();
      }, 250);
    }
    async function change() {
      if (disposed2 || busy) return;
      busy = true;
      toggle.disabled = true;
      const wanted = toggle.checked;
      try {
        if (wanted && !await chrome2.permissions.request({ permissions: ["downloads"] })) {
          toggle.checked = getEnabled();
          status.textContent = "Permission not granted \xB7 downloads continue in Chrome";
          return;
        }
        if (disposed2) return;
        await saveEnabled(wanted);
        await render();
      } catch (error) {
        toggle.checked = getEnabled();
        showError(error);
      } finally {
        busy = false;
        toggle.disabled = false;
      }
    }
    async function clear() {
      try {
        const result = await chrome2.runtime.sendMessage({
          type: DOWNLOAD_INTAKE_MESSAGES.CLEAR
        });
        if (result?.status !== "cleared")
          throw Error("Could not clear observation metadata.");
        await render();
      } catch (error) {
        showError(error);
      }
    }
    async function changeAutomaticChecks() {
      if (disposed2 || !autoToggle || autoToggle.disabled) return;
      const wanted = autoToggle.checked;
      autoToggle.disabled = true;
      try {
        if (wanted && !await chrome2.permissions.request({
          permissions: ["downloads", "nativeMessaging"]
        }))
          throw Error("Helper permission not granted. Downloads stay in Chrome.");
        if (disposed2) return;
        await saveAutoCheckEnabled(wanted);
        await render();
      } catch (error) {
        autoToggle.checked = getAutoCheckEnabled();
        showError(error);
      } finally {
        autoToggle.disabled = false;
      }
    }
    async function copyDiagnostics() {
      if (disposed2 || !lastSnapshot || !isActive()) return;
      try {
        const report = JSON.stringify(
          buildDownloadIntakeDiagnosticReport(lastSnapshot),
          null,
          2
        );
        if (window2.navigator.clipboard?.writeText)
          await window2.navigator.clipboard.writeText(report);
        else {
          const field = document2.createElement("textarea");
          field.value = report;
          field.style.position = "fixed";
          field.style.opacity = "0";
          document2.body.append(field);
          try {
            field.select();
            if (!document2.execCommand("copy"))
              throw Error("Could not copy diagnostics.");
          } finally {
            field.remove();
          }
        }
        if (!disposed2)
          status.textContent = "Diagnostics copied \xB7 includes filenames and hosts, not source URLs or tokens.";
      } catch (error) {
        showError(error);
      }
    }
    const refresh = () => {
      void render();
    };
    function bind() {
      if (disposed2 || bound) return;
      bound = true;
      toggle.addEventListener("change", change);
      $2("browser-download-intake-refresh").addEventListener("click", refresh);
      $2("browser-download-intake-clear").addEventListener("click", clear);
      copy?.addEventListener("click", copyDiagnostics);
      autoToggle?.addEventListener("change", changeAutomaticChecks);
      chrome2.permissions?.onAdded?.addListener(scheduleRefresh);
      chrome2.permissions?.onRemoved?.addListener(scheduleRefresh);
    }
    function stop() {
      disposed2 = true;
      files.stop();
      ++revision;
      clearTimeout(timer);
      toggle.removeEventListener("change", change);
      $2("browser-download-intake-refresh").removeEventListener("click", refresh);
      $2("browser-download-intake-clear").removeEventListener("click", clear);
      copy?.removeEventListener("click", copyDiagnostics);
      autoToggle?.removeEventListener("change", changeAutomaticChecks);
      chrome2.permissions?.onAdded?.removeListener(scheduleRefresh);
      chrome2.permissions?.onRemoved?.removeListener(scheduleRefresh);
    }
    return { bind, render, scheduleRefresh, stop };
  }

  // src/options/downloads-section.js
  function createDownloadsSection({
    document: document2,
    window: window2,
    chrome: chrome2,
    isActive,
    updateFilters,
    saveConnections,
    onError,
    getObserverEnabled,
    saveObserverEnabled,
    getAutoCheckEnabled,
    saveAutoCheckEnabled
  }) {
    const $2 = (id) => document2.getElementById(id);
    const confirm2 = (message) => window2.confirm(message);
    let disposed2 = false;
    let downloadRenderRevision = 0;
    let downloadRefreshTimer = null;
    const bindings = [];
    const intakePanel = createDownloadIntakePanel({
      document: document2,
      chrome: chrome2,
      isActive,
      getEnabled: getObserverEnabled,
      saveEnabled: saveObserverEnabled,
      getAutoCheckEnabled,
      saveAutoCheckEnabled
    });
    const historyList = createDownloadHistoryList({
      document: document2,
      window: window2,
      actionButton: downloadActionButton
    });
    function bind() {
      if (disposed2 || bindings.length) return;
      intakePanel.bind();
      for (const [id, event, action] of [
        ["btn-download-refresh", "click", renderDownloads],
        ["btn-download-clear", "click", clearDownloadHistory],
        [
          "media-download-connections",
          "change",
          () => saveConnections(Number($2("media-download-connections").value || 8))
        ]
      ]) {
        const handler = () => {
          if (!disposed2)
            void Promise.resolve().then(() => {
              if (!disposed2) return action();
            }).catch(onError);
        };
        $2(id).addEventListener(event, handler);
        bindings.push(() => $2(id).removeEventListener(event, handler));
      }
    }
    function scheduleDownloadRefresh() {
      if (!isActive() || disposed2) return;
      if (downloadRefreshTimer) return;
      downloadRefreshTimer = setTimeout(() => {
        downloadRefreshTimer = null;
        if (isActive()) void renderDownloads();
      }, 250);
    }
    async function renderDownloads() {
      if (!isActive() || disposed2) return;
      const revision = ++downloadRenderRevision;
      const container = $2("download-job-manager");
      const status = $2("download-manager-status");
      if (!container || !status) return;
      try {
        const [jobsResponse, helper] = await Promise.all([
          chrome2.runtime.sendMessage({ type: "GET_MEDIA_DOWNLOAD_JOBS" }),
          chrome2.runtime.sendMessage({ type: "GET_MEDIA_HELPER_STATUS" })
        ]);
        if (revision !== downloadRenderRevision || !isActive() || disposed2)
          return;
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
        $2("btn-download-clear").disabled = !jobs.some(
          (job) => !isActiveDownload(job)
        );
        historyList.render(jobs, helper);
        updateFilters();
      } catch (error) {
        if (disposed2 || !isActive() || revision !== downloadRenderRevision)
          return;
        status.textContent = `Downloads unavailable \xB7 ${error.message}`;
        status.style.color = "#f87171";
      }
    }
    function downloadActionButton(label, messageType, jobId, { danger = false, compact = false } = {}) {
      const button = document2.createElement("button");
      button.className = danger ? "btn-secondary download-danger" : "btn-secondary";
      if (compact) button.classList.add("download-compact-action");
      button.textContent = label;
      button.onclick = async () => {
        if (disposed2) return;
        if (messageType === "REMOVE_MEDIA_DOWNLOAD_HISTORY" && !confirm2("Remove this history entry? The downloaded file will be kept."))
          return;
        button.disabled = true;
        const original = button.textContent;
        button.textContent = "Working\u2026";
        try {
          const response = await chrome2.runtime.sendMessage({
            type: messageType,
            jobId,
            connections: Number($2("media-download-connections").value || 8)
          });
          if (!["started", "pausing", "cancelling", "opened", "removed"].includes(
            response?.status
          ))
            throw new Error(
              response?.reason || response?.error || "Download action failed."
            );
          await renderDownloads();
        } catch (error) {
          if (disposed2) return;
          $2("download-manager-status").textContent = `Action failed \xB7 ${error.message}`;
          $2("download-manager-status").style.color = "#f87171";
        } finally {
          if (!disposed2 && button.isConnected) {
            button.disabled = false;
            button.textContent = original;
          }
        }
      };
      return button;
    }
    async function clearDownloadHistory() {
      if (!confirm2(
        "Clear all finished download history? Downloaded files will be kept."
      ))
        return;
      const response = await chrome2.runtime.sendMessage({
        type: "CLEAR_MEDIA_DOWNLOAD_HISTORY"
      });
      if (response?.status !== "removed") {
        $2("download-manager-status").textContent = `Could not clear history \xB7 ${response?.reason || response?.error || "unknown error"}`;
        $2("download-manager-status").style.color = "#f87171";
        return;
      }
      await renderDownloads();
    }
    function stop() {
      disposed2 = true;
      ++downloadRenderRevision;
      clearTimeout(downloadRefreshTimer);
      intakePanel.stop();
      for (const unbind of bindings.splice(0)) unbind();
    }
    return {
      bind,
      render: () => Promise.all([renderDownloads(), intakePanel.render()]),
      refreshIntake: intakePanel.scheduleRefresh,
      scheduleRefresh: scheduleDownloadRefresh,
      updateViewport: historyList.updateViewport,
      stop
    };
  }

  // src/options/list-filters.js
  function matchesDownloadFilter(status, filter) {
    if (filter === "active") return isMediaJobActive({ status });
    if (filter === "paused") return ["paused", "cancelled"].includes(status);
    return filter === "all" || status === filter;
  }
  function createSettingsListFilters(document2, onDownloadsFiltered = () => {
  }) {
    const groups = [
      {
        input: "sites-search",
        status: "sites-search-status",
        selector: "#whitelist-list > .item, #blacklist-list > .item, #custom-rules-container > .rule-site, #learned-paths-container > .item"
      },
      {
        input: "activity-search",
        status: "activity-search-status",
        selector: "#blocked-logs-container > .item"
      },
      {
        input: "download-search",
        status: "download-search-status",
        selector: "#download-job-manager > .download-history-item",
        filter: "download-filter"
      }
    ];
    const listeners = [];
    function apply(group) {
      const query = document2.getElementById(group.input).value;
      const filter = group.filter ? document2.getElementById(group.filter).value : "all";
      const rows = [...document2.querySelectorAll(group.selector)];
      for (const row of rows)
        row.hidden = !matchesSettingsSearch(
          [row.dataset.searchText || row.textContent],
          query
        ) || group.filter && !matchesDownloadFilter(row.dataset.status, filter);
      const visible = rows.filter((row) => !row.hidden).length;
      document2.getElementById(group.status).textContent = rows.length ? `${visible} of ${rows.length} entries${visible === 0 ? " \xB7 No matches" : ""}` : "";
      if (group.filter) onDownloadsFiltered();
    }
    for (const group of groups) {
      for (const [id, event] of [
        [group.input, "input"],
        ...group.filter ? [[group.filter, "change"]] : []
      ]) {
        const element = document2.getElementById(id);
        const run = () => apply(group);
        element.addEventListener(event, run);
        listeners.push(() => element.removeEventListener(event, run));
      }
    }
    return {
      update: () => groups.forEach(apply),
      stop: () => listeners.forEach((remove) => remove())
    };
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

  // src/options/index.js
  var $ = (id) => document.getElementById(id);
  var whitelistEl = $("whitelist-list");
  var blacklistEl = $("blacklist-list");
  var domSamplesEl = $("dom-samples-container");
  var packageStatusEl = $("package-status");
  var currentSnapshot = {};
  var storageRefreshTimer = null;
  var settingsNavigation = null;
  var listFilters = null;
  var pageLoaded = false;
  var disposed = false;
  var expandedRuleHost = null;
  var handledElementLink = null;
  var downloadsSection = createDownloadsSection({
    document,
    window,
    chrome,
    isActive: () => settingsNavigation?.isActive("downloads") === true,
    updateFilters: () => listFilters?.update(),
    saveConnections: saveDownloadConnections,
    getObserverEnabled: () => currentSnapshot.appSettings?.featureOverrides?.[DOWNLOAD_OBSERVER_FEATURE] === true,
    saveObserverEnabled: async (enabled) => {
      const latest = await loadSettings();
      currentSnapshot.appSettings = await saveSettings({
        ...latest,
        featureOverrides: {
          ...latest.featureOverrides,
          [DOWNLOAD_OBSERVER_FEATURE]: enabled
        }
      });
    },
    getAutoCheckEnabled: () => currentSnapshot.appSettings?.featureOverrides?.[FILE_AUTO_CHECK_FEATURE] === true,
    saveAutoCheckEnabled: async (enabled) => {
      const latest = await loadSettings();
      currentSnapshot.appSettings = await saveSettings({
        ...latest,
        featureOverrides: {
          ...latest.featureOverrides,
          [FILE_AUTO_CHECK_FEATURE]: enabled
        }
      });
    },
    onError: (error) => showPackageStatus(error.message, true)
  });
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
    downloadsSection.bind();
    listFilters = createSettingsListFilters(document, () => {
      if (settingsNavigation?.isActive("downloads"))
        downloadsSection.updateViewport();
    });
    settingsNavigation = createSettingsNavigation({
      document,
      window,
      onActivate: () => {
        if (pageLoaded)
          void renderActiveSection().catch(
            (error) => showPackageStatus(error.message, true)
          );
      }
    });
    $("settings-version").textContent = `\xB7 ${chrome.runtime.getManifest().version}`;
    chrome.storage.onChanged.addListener(handleStorageChange);
    window.addEventListener("unload", () => {
      disposed = true;
      settingsNavigation.stop();
      listFilters.stop();
      clearTimeout(storageRefreshTimer);
      downloadsSection.stop();
      chrome.storage.onChanged.removeListener(handleStorageChange);
    });
    await loadPage();
  }
  var sectionRenderers = Object.freeze({
    protection: () => {
    },
    packages: renderPackageStatus,
    sites: () => {
      renderDomainList(currentSnapshot.whitelist || [], whitelistEl, "whitelist");
      renderDomainList(currentSnapshot.blacklist || [], blacklistEl, "blacklist");
      renderCustomRules();
      renderLearnedPaths();
    },
    downloads: downloadsSection.render,
    activity: () => renderNavigationLogs(currentSnapshot.blockedLogs || []),
    advanced: async () => {
      await renderStorageHealth();
      if (!settingsNavigation.isActive("advanced") || disposed) return;
      if ($("training-details").open) await renderDomSamples();
      if ($("diagnostics-details").open) await renderNavigationDiagnostics();
    }
  });
  async function renderActiveSection() {
    if (disposed || !pageLoaded) return;
    const section = settingsNavigation.current();
    await sectionRenderers[section]();
    if (disposed || section !== settingsNavigation.current()) return;
    listFilters.update();
    const elementLink = section === "sites" && location.hash === "#element-decisions" ? location.href : null;
    if (elementLink && elementLink !== handledElementLink) {
      const site = new URLSearchParams(location.search).get("site");
      const siteCard = site ? [...document.querySelectorAll(".rule-site")].find(
        (card) => card.dataset.host === site
      ) : null;
      if (siteCard) expandRuleSite(siteCard.dataset.host);
      siteCard?.scrollIntoView({ block: "nearest" });
    }
    handledElementLink = elementLink;
  }
  function handleStorageChange(changes, areaName) {
    if (areaName === "session" && DOWNLOAD_INTAKE_KEY in changes || FILE_TRANSFER_KEY in changes || FILE_AUTO_CHECK_KEY in changes) {
      downloadsSection.refreshIntake();
    }
    if (areaName === "session" && Object.keys(changes).some((key) => key.startsWith(DOWNLOAD_JOB_PREFIX))) {
      downloadsSection.scheduleRefresh();
      return;
    }
    if (areaName === "local" && DOWNLOAD_HISTORY_KEY in changes) {
      downloadsSection.scheduleRefresh();
    }
    if (areaName !== "local") return;
    const keys = Object.keys(changes);
    const affectsSettings = keys.some(
      (key) => [
        "appSettings",
        "blockedLogs",
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
  function bindStaticActions() {
    document.querySelector(".skip-link").onclick = (event) => {
      event.preventDefault();
      $("settings-main").focus();
    };
    $("training-details").addEventListener("toggle", () => {
      if ($("training-details").open && settingsNavigation?.isActive("advanced"))
        void renderDomSamples();
    });
    $("diagnostics-details").addEventListener("toggle", () => {
      if ($("diagnostics-details").open && settingsNavigation?.isActive("advanced"))
        void renderNavigationDiagnostics();
    });
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
    $("btn-nav-diagnostics-start").onclick = startNavigationDiagnostics;
    $("btn-nav-diagnostics-stop").onclick = stopNavigationDiagnostics;
    $("btn-nav-diagnostics-refresh").onclick = renderNavigationDiagnostics;
    $("btn-nav-diagnostics-export").onclick = exportNavigationDiagnostics;
    $("btn-nav-diagnostics-clear").onclick = clearNavigationDiagnostics;
    $("btn-reset").onclick = factoryReset;
    bindFeedbackForm();
  }
  async function renderNavigationDiagnostics() {
    if (disposed || !settingsNavigation?.isActive("advanced") || !$("diagnostics-details").open)
      return;
    const status = $("nav-diagnostics-status");
    const preview = $("nav-diagnostics-preview");
    if (!status || !preview) return;
    try {
      const snapshot = await chrome.runtime.sendMessage({
        type: "GET_NAVIGATION_DIAGNOSTICS"
      });
      if (!Array.isArray(snapshot?.events))
        throw new Error(snapshot?.error || "Trace is unavailable.");
      status.textContent = snapshot.captureUntil ? snapshot.events.length + " events \xB7 capture active until " + new Date(snapshot.captureUntil).toLocaleTimeString() : snapshot.events.length + " recent events \xB7 session-only buffer";
      preview.textContent = JSON.stringify(snapshot.events, null, 2);
      status.style.color = "";
    } catch (error) {
      status.textContent = "Diagnostics unavailable \xB7 " + error.message;
      status.style.color = "#f87171";
    }
  }
  async function startNavigationDiagnostics() {
    await runNavigationDiagnosticsAction("btn-nav-diagnostics-start", {
      type: "START_NAVIGATION_DIAGNOSTICS",
      durationMs: 10 * 60 * 1e3
    });
  }
  async function stopNavigationDiagnostics() {
    await runNavigationDiagnosticsAction("btn-nav-diagnostics-stop", {
      type: "STOP_NAVIGATION_DIAGNOSTICS"
    });
  }
  async function clearNavigationDiagnostics() {
    if (!confirm("Clear the session navigation trace?")) return;
    await runNavigationDiagnosticsAction("btn-nav-diagnostics-clear", {
      type: "CLEAR_NAVIGATION_DIAGNOSTICS"
    });
  }
  async function exportNavigationDiagnostics() {
    const button = $("btn-nav-diagnostics-export");
    button.disabled = true;
    try {
      const snapshot = await requestNavigationDiagnostics({
        type: "GET_NAVIGATION_DIAGNOSTICS"
      });
      if (!Array.isArray(snapshot?.events))
        throw new Error("The recorder returned no trace to export.");
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json"
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "adsfriendly-navigation-trace-" + Date.now() + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1e3);
    } catch (error) {
      showNavigationDiagnosticsError(error);
    } finally {
      button.disabled = false;
    }
  }
  async function runNavigationDiagnosticsAction(buttonId, message) {
    const button = $(buttonId);
    button.disabled = true;
    try {
      await requestNavigationDiagnostics(message);
      await renderNavigationDiagnostics();
    } catch (error) {
      showNavigationDiagnosticsError(error);
    } finally {
      button.disabled = false;
    }
  }
  async function requestNavigationDiagnostics(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (response?.status === "ignored" || response?.status === "disabled" || response?.status === "capability_disabled" || response?.status === "error") {
      throw new Error(response.error || "The background rejected this action.");
    }
    return response;
  }
  function showNavigationDiagnosticsError(error) {
    const status = $("nav-diagnostics-status");
    status.textContent = "Diagnostics action failed \xB7 " + error.message;
    status.style.color = "#f87171";
  }
  async function saveDownloadConnections(connections) {
    const settings = await saveSettings({
      ...currentSnapshot.appSettings || {},
      mediaDownloadConnections: connections
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
    renderProtectionSummary(settings);
    pageLoaded = true;
    await renderActiveSection();
  }
  function renderProtectionSummary(settings) {
    const modeLabels = { safe: "Safe", assist: "Assist", auto: "Auto" };
    const descriptions = {
      safe: "Conservative protection using navigation safeguards, static rules and your saved decisions.",
      assist: "Safe protection, with page suggestions you can review. Media tools are enabled.",
      auto: "Assist protection, with eligible automatic hiding and video actions."
    };
    $("protection-status").textContent = settings.enabled ? `${modeLabels[settings.protectionMode]} \xB7 On` : "Protection off";
    $("protection-status").classList.toggle("is-disabled", !settings.enabled);
    $("protection-mode-description").textContent = descriptions[settings.protectionMode];
    const whitelist = currentSnapshot.whitelist?.length || 0;
    const blacklist = currentSnapshot.blacklist?.length || 0;
    const rules = currentSnapshot.userCustomRules || {};
    const exceptions = currentSnapshot.userElementExceptions || {};
    $("allowed-count").textContent = $("whitelist-count").textContent = whitelist;
    $("blocked-sites-count").textContent = $("blacklist-count").textContent = blacklist;
    $("page-decisions-count").textContent = [
      ...Object.values(rules),
      ...Object.values(exceptions)
    ].reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
    $("rule-sites-count").textContent = `${(/* @__PURE__ */ new Set([...Object.keys(rules), ...Object.keys(exceptions)])).size} sites`;
    $("workflow-count").textContent = Object.keys(currentSnapshot).filter(
      (key) => key.startsWith("p:")
    ).length;
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
    showSettingsNotice("Protection settings saved.");
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
    showSettingsNotice(
      `Added ${hostname} to ${type === "whitelist" ? "allowed" : "blocked"} sites.`
    );
  }
  function renderDomainList(list, element, type) {
    if (!list.length) {
      element.innerHTML = '<div class="empty-msg">No sites added yet</div>';
      return;
    }
    element.innerHTML = list.map(
      (domain, index) => `
        <div class="item" data-search-text="${safeText(domain)}">
          <span>${safeText(domain)}</span>
          <button class="btn-delete" data-index="${index}" title="Remove" aria-label="Remove ${safeText(domain)}">
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
        <div class="rule-site" data-host="${safeText(hostname)}" data-search-text="${safeText([hostname, ...rules.map((rule) => typeof rule === "string" ? rule : rule.selector), ...exceptions.map((rule) => rule.selector)].join(" "))}" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); padding:12px; border-radius:12px; margin-bottom:10px;">
          <div class="rule-header">
            <div>
              <div style="font-weight:bold; color:#e2e8f0">${safeText(hostname)}</div>
              <div style="font-size:0.75rem; color:#64748b">${rules.length} hidden \xB7 ${exceptions.length} not ads</div>
            </div>
            <div class="rule-actions">
              <button class="toggle-details btn-secondary" aria-expanded="false">Details</button>
              <button class="reset-site-rules btn-secondary" data-host="${safeText(hostname)}">Reset site</button>
            </div>
          </div>
          <div class="details-pane" style="display:none; margin-top:10px">${details}</div>
        </div>`;
    }).join("");
    container.querySelectorAll(".toggle-details").forEach((button) => {
      button.onclick = () => {
        const host = button.closest(".rule-site").dataset.host;
        expandRuleSite(expandedRuleHost === host ? null : host);
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
    expandRuleSite(expandedRuleHost);
  }
  function expandRuleSite(host) {
    expandedRuleHost = host;
    for (const card of document.querySelectorAll(".rule-site")) {
      const expanded = card.dataset.host === host;
      const button = card.querySelector(".toggle-details");
      button.setAttribute("aria-expanded", String(expanded));
      button.textContent = expanded ? "Hide details" : "Details";
      card.querySelector(".details-pane").style.display = expanded ? "block" : "none";
    }
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
      <div class="item" data-search-text="${safeText(`${path.source} ${path.target}`)}">
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
      <div class="item" data-search-text="${safeText(`${log.url} ${log.source}`)}" style="flex-direction:column; align-items:flex-start; gap:4px">
        <div style="font-size:0.8rem; color:#fbd38d; font-weight:bold">Blocked Navigation</div>
        <div style="font-family:monospace; font-size:0.75rem; word-break:break-all">Target: ${safeText(log.url)}</div>
        <div style="font-size:0.7rem; color:#64748b">Source: ${safeText(log.source)} \xB7 ${safeText(new Date(log.timestamp).toLocaleString())}</div>
      </div>`
    ).join("");
  }
  async function renderDomSamples() {
    if (disposed || !settingsNavigation?.isActive("advanced") || !$("training-details").open)
      return;
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
      "Reset local settings, personal decisions, training data and stored history, then restore the bundled Settings Package? Downloaded files are kept. Active downloads are not cancelled."
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
    if (error) showSettingsNotice(message, true);
  }
  function showSettingsNotice(message, error = false) {
    const notice = $("settings-notice");
    notice.hidden = !message;
    notice.textContent = message;
    notice.classList.toggle("is-error", error);
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
