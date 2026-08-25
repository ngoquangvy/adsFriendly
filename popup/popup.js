var AdsFriendlyPopup = (() => {
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
  async function loadSettings(storage = chrome.storage.local, { persistMissing = false } = {}) {
    const stored = await storage.get([SETTINGS_KEY, "isEnabled", "friendlyMode"]);
    const settings2 = migrateLegacySettings(stored);
    if (!stored[SETTINGS_KEY] && persistMissing) {
      await storage.set({ [SETTINGS_KEY]: settings2 });
    }
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

  // src/media/download-job-contract.js
  var DOWNLOAD_JOB_PREFIX = "adsfriendly.mediaDownloadJob.";
  var DOWNLOAD_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
  function getMediaDownloadAvailability(candidate = {}) {
    if (candidate.kind === "direct") {
      try {
        requiredHttpUrl(candidate.sourceUrl, "candidate.sourceUrl");
      } catch {
        return { supported: false, reason: "Direct media URL is not ready." };
      }
      if (candidate.drm === "suspected" || candidate.drm === "confirmed")
        return { supported: false, reason: "DRM-protected stream." };
      return { supported: true, reason: null };
    }
    if (candidate.kind === "dash") {
      if (candidate.probeStatus !== "ready")
        return { supported: false, reason: "DASH manifest is not ready." };
      if (candidate.drm === "suspected" || candidate.drm === "confirmed")
        return { supported: false, reason: "DRM-protected stream." };
      if (candidate.streamType === "live")
        return { supported: false, reason: "Live DASH is not supported yet." };
      if (candidate.streamType !== "vod")
        return { supported: false, reason: "Unknown DASH stream type." };
      if (!candidate.variants?.length && !candidate.audioTracks?.length)
        return { supported: false, reason: "DASH manifest has no media tracks." };
      return { supported: true, reason: null };
    }
    if (candidate.kind !== "hls")
      return {
        supported: false,
        reason: "This media type is not supported yet."
      };
    if (candidate.probeStatus !== "ready")
      return { supported: false, reason: "Manifest is not ready." };
    if (candidate.drm === "suspected" || candidate.drm === "confirmed")
      return { supported: false, reason: "DRM-protected stream." };
    if (candidate.encryptionMethods?.length)
      return { supported: false, reason: "Encrypted HLS is not supported yet." };
    if (candidate.playlistType === "unknown")
      return {
        supported: false,
        reason: "HLS endpoint has not exposed a media playlist yet."
      };
    if (candidate.playlistType === "media" && candidate.streamType === "unknown")
      return {
        supported: false,
        reason: "HLS media playlist is waiting for segments."
      };
    if (candidate.playlistType === "media" && candidate.streamType === "live")
      return { supported: false, reason: "Live HLS is not supported yet." };
    if (candidate.playlistType === "media" && candidate.streamType === "vod" && !candidate.segmentCount)
      return { supported: false, reason: "HLS VOD has no media segments." };
    if (candidate.playlistType === "master" && !candidate.variants?.length)
      return { supported: false, reason: "No quality variants found." };
    if (!["master", "media"].includes(candidate.playlistType))
      return { supported: false, reason: "Unknown HLS playlist type." };
    return { supported: true, reason: null };
  }
  function requiredString(value, field) {
    if (typeof value !== "string" || !value.trim())
      throw new Error(`[MediaDownload] ${field} is required.`);
    return value;
  }
  function requiredHttpUrl(value, field) {
    const url = requiredString(value, field);
    try {
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
    } catch {
      throw new Error(`[MediaDownload] ${field} must be an HTTP(S) URL.`);
    }
    return url;
  }

  // src/media/catalog-view.js
  function createMediaCatalogViewSignature({
    tabId = null,
    status = "",
    helper = null,
    items = []
  } = {}) {
    return JSON.stringify({
      tabId,
      status,
      helper: helper ? {
        status: helper.status,
        helperVersion: helper.helperVersion,
        canDownloadDirect: helper.canDownloadDirect,
        canDownloadHls: helper.canDownloadHls,
        canDownloadDash: helper.canDownloadDash,
        error: helper.error
      } : null,
      items: items.map(mediaRenderFacts)
    });
  }
  function selectVisibleMediaItems(items = [], maximum = 8) {
    const sorted = [...items].sort(
      (left, right) => (right.firstSeenAt || 0) - (left.firstSeenAt || 0) || String(left.id || "").localeCompare(String(right.id || ""))
    );
    const visible = [];
    const blobGroups = /* @__PURE__ */ new Map();
    for (const item of sorted) {
      if (item.kind === "hls" && item.parentManifestIds?.length) continue;
      if (item.kind !== "blob") {
        visible.push(item);
        continue;
      }
      const key = `${item.pageUrl || ""}
${item.title || "blob"}`;
      const existing = blobGroups.get(key);
      if (existing) {
        existing.relatedCount += 1;
        continue;
      }
      const grouped = { ...item, relatedCount: 1 };
      blobGroups.set(key, grouped);
      visible.push(grouped);
    }
    return visible.slice(0, maximum);
  }
  function helperSetupPresentation(helper) {
    if (!helper || helper.status === "ready") return null;
    if (helper.status === "permission_required") {
      return {
        label: "Allow helper connection",
        title: "Allow AdsFriendly to communicate with the installed Media Helper."
      };
    }
    if (helper.status === "not_installed") {
      return {
        label: "Install helper",
        title: "Media Helper is not installed or registered for this browser."
      };
    }
    return {
      label: "Retry helper",
      title: helper.error || "Check the Media Helper connection again."
    };
  }
  function formatMediaDetails(item) {
    if (item.kind === "blob")
      return item.relatedCount > 1 ? `${item.relatedCount} Blob signals \xB7 tracing one source` : "Blob signal \xB7 tracing network source";
    if (item.kind === "direct") return "Direct video file";
    if (item.kind === "dash") return dashDetails(item);
    if (item.kind !== "hls") return "Media source found";
    if (item.resolvedStream && item.selectedMediaId && item.selectedMediaId !== item.id)
      return resolvedHlsDetails(item);
    if (item.probeStatus === "failed")
      return item.probeError === "fallback_fetch_blocked" ? "HLS \xB7 page/CORS blocked manifest reading" : "HLS \xB7 manifest request or parse failed";
    if (item.probeStatus === "unsupported")
      return "HLS \xB7 manifest format not supported";
    if (item.probeStatus !== "ready")
      return "HLS manifest found \xB7 reading qualities";
    if (item.playlistType === "unknown")
      return "HLS endpoint \xB7 waiting for media playlist";
    const facts = [];
    if (item.playlistType === "master") {
      const qualityLabels = [...item.variants || []].sort(compareVariantQuality).map(variantLabel).filter(
        (label, index, labels) => label && labels.indexOf(label) === index
      ).slice(0, 4);
      facts.push(
        qualityLabels.length ? qualityLabels.join(" \xB7 ") : item.iframeVariants?.length ? `${item.iframeVariants.length} preview streams \xB7 waiting for primary stream` : "Master playlist \xB7 waiting for quality streams"
      );
      if (item.childManifestIds?.length)
        facts.push(`${item.childManifestIds.length} active child streams`);
    } else {
      if (item.streamType === "unknown")
        return "HLS media playlist \xB7 waiting for segments";
      const streamLabel = item.streamType === "live" ? item.lowLatency ? "Low-latency live" : "Live stream" : "VOD stream";
      facts.push(
        item.parentManifestIds?.length ? `Variant ${streamLabel}` : streamLabel
      );
      if (Number.isFinite(item.duration) && item.duration > 0)
        facts.push(formatDuration(item.duration));
      if (Number.isInteger(item.segmentCount) && item.segmentCount > 0)
        facts.push(`${item.segmentCount} segments`);
      if (Number.isInteger(item.partialSegmentCount) && item.partialSegmentCount > 0)
        facts.push(`${item.partialSegmentCount} parts`);
      if (Number.isInteger(item.skippedSegmentCount) && item.skippedSegmentCount > 0)
        facts.push(`${item.skippedSegmentCount} skipped`);
      if (item.streamType === "live" && !item.segmentCount && !item.partialSegmentCount)
        facts.push("waiting for segments");
    }
    if (item.audioTracks?.length) facts.push(`${item.audioTracks.length} audio`);
    if (item.subtitles?.length) facts.push(`${item.subtitles.length} subtitles`);
    if (item.drm === "suspected") facts.push("DRM suspected");
    else if (item.encryptionMethods?.length) facts.push("Encrypted");
    return facts.filter(Boolean).join(" \xB7 ") || "HLS manifest ready";
  }
  function dashDetails(item) {
    if (item.probeStatus === "failed") return "DASH manifest request failed";
    if (item.probeStatus === "unsupported") return "DASH manifest not supported";
    if (item.probeStatus !== "ready")
      return "DASH manifest found \xB7 reading tracks";
    const facts = [item.streamType === "live" ? "Live DASH" : "DASH VOD"];
    if (Number.isFinite(item.duration) && item.duration > 0)
      facts.push(formatDuration(item.duration));
    const qualities = [...item.variants || []].sort(compareVariantQuality).map(variantLabel).filter((label, index, labels) => label && labels.indexOf(label) === index).slice(0, 4);
    if (qualities.length) facts.push(qualities.join(" \xB7 "));
    if (item.audioTracks?.length) facts.push(`${item.audioTracks.length} audio`);
    if (item.subtitles?.length) facts.push(`${item.subtitles.length} subtitles`);
    if (["suspected", "confirmed"].includes(item.drm)) facts.push("DRM");
    return facts.join(" \xB7 ");
  }
  function resolvedHlsDetails(item) {
    const stream = item.resolvedStream;
    const facts = ["Resolved"];
    if (stream.resolution?.height) facts.push(`${stream.resolution.height}p`);
    else if (stream.bandwidth)
      facts.push(
        stream.bandwidth >= 1e6 ? `${(stream.bandwidth / 1e6).toFixed(1)} Mbps` : `${Math.round(stream.bandwidth / 1e3)} Kbps`
      );
    facts.push(stream.streamType === "vod" ? "VOD" : "Live");
    if (Number.isFinite(stream.duration) && stream.duration > 0)
      facts.push(formatDuration(stream.duration));
    if (stream.segmentCount > 0) facts.push(`${stream.segmentCount} segments`);
    if (stream.partialSegmentCount > 0)
      facts.push(`${stream.partialSegmentCount} parts`);
    if (["suspected", "confirmed"].includes(stream.drm)) facts.push("DRM");
    else if (stream.encryptionMethods?.length) facts.push("Encrypted");
    if (item.resolvedRequestContext?.requiresBrowserSession)
      facts.push("browser session");
    return facts.join(" \xB7 ");
  }
  function compareVariantQuality(left, right) {
    return (right.resolution?.height || 0) - (left.resolution?.height || 0) || (right.averageBandwidth || right.bandwidth || 0) - (left.averageBandwidth || left.bandwidth || 0);
  }
  function variantLabel(variant) {
    if (variant.resolution?.height) return `${variant.resolution.height}p`;
    const bandwidth = variant.averageBandwidth || variant.bandwidth;
    if (!Number.isFinite(bandwidth)) return null;
    return bandwidth >= 1e6 ? `${(bandwidth / 1e6).toFixed(1)} Mbps` : `${Math.round(bandwidth / 1e3)} Kbps`;
  }
  function formatDuration(seconds) {
    const rounded = Math.round(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor(rounded % 3600 / 60);
    const remainingSeconds = rounded % 60;
    if (hours)
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(
        remainingSeconds
      ).padStart(2, "0")}`;
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  function mediaRenderFacts(item) {
    return {
      id: item.id,
      kind: item.kind,
      sourceUrl: item.sourceUrl,
      manifestUrl: item.manifestUrl,
      title: item.title,
      probeStatus: item.probeStatus,
      probeError: item.probeError,
      playlistType: item.playlistType,
      streamType: item.streamType,
      duration: item.duration,
      segmentCount: item.segmentCount,
      partialSegmentCount: item.partialSegmentCount,
      skippedSegmentCount: item.skippedSegmentCount,
      lowLatency: item.lowLatency,
      mediaSequence: item.mediaSequence,
      discontinuitySequence: item.discontinuitySequence,
      revisionId: item.revisionId,
      relatedCount: item.relatedCount,
      parentManifestIds: item.parentManifestIds,
      childManifestIds: item.childManifestIds,
      resolutionStatus: item.resolutionStatus,
      resolvedMediaIds: item.resolvedMediaIds,
      selectedMediaId: item.selectedMediaId,
      resolvedStream: item.resolvedStream,
      requiresBrowserSession: item.resolvedRequestContext?.requiresBrowserSession === true,
      drm: item.drm,
      encryptionMethods: item.encryptionMethods,
      variants: item.variants,
      iframeVariants: item.iframeVariants,
      audioTracks: item.audioTracks,
      subtitles: item.subtitles
    };
  }

  // src/media/storage-keys.js
  var MEDIA_CATALOG_SESSION_PREFIX = "adsfriendly.mediaCatalog.";
  function mediaCatalogSessionKey(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new Error("[MediaCatalog] A valid tab ID is required.");
    }
    return `${MEDIA_CATALOG_SESSION_PREFIX}${tabId}`;
  }

  // src/popup/index.js
  var blockedCountElement = document.getElementById("blocked-count");
  var statusToggle = document.getElementById("status-toggle");
  var modeSelect = document.getElementById("protection-mode-select");
  var modeDescription = document.getElementById("mode-description");
  var mediaCount = document.getElementById("media-count");
  var mediaStatus = document.getElementById("media-status");
  var mediaHelperAction = document.getElementById("media-helper-action");
  var mediaList = document.getElementById("media-list");
  var mediaJobList = document.getElementById("media-job-list");
  var MODE_DESCRIPTIONS = Object.freeze({
    safe: "Verified rules; no predictive DOM actions",
    assist: "Detect and ask before hiding",
    auto: "Allow registered automatic actions"
  });
  var settings = null;
  var mediaRefreshInFlight = false;
  var mediaHelperStatus = {
    status: "checking",
    canDownloadDirect: false,
    canDownloadHls: false,
    canDownloadDash: false
  };
  var activeMediaTabId = null;
  var mediaRenderSignature = null;
  var scheduledMediaRefresh = null;
  initialize().catch(
    (error) => console.error("[AdsFriendly Popup] initialization failed", error)
  );
  statusToggle.addEventListener("change", async () => {
    settings = await saveSettings({
      ...settings,
      enabled: statusToggle.checked
    });
    await renderMode();
    await updateMediaCatalog();
  });
  modeSelect.addEventListener("change", async () => {
    settings = await saveSettings({
      ...settings,
      protectionMode: modeSelect.value
    });
    await renderMode();
    await updateMediaCatalog();
  });
  mediaHelperAction.addEventListener("click", async () => {
    mediaHelperAction.disabled = true;
    await setupMediaHelper(mediaHelperAction, mediaHelperStatus);
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
  setInterval(updateMediaCatalog, 1e4);
  chrome.storage.onChanged.addListener(onMediaStorageChanged);
  async function initialize() {
    settings = await loadSettings();
    await render();
  }
  async function render() {
    statusToggle.checked = settings.enabled;
    modeSelect.value = settings.protectionMode;
    await updateBlockedCount();
    await renderMode();
    await updateMediaJobs();
    const tab = await getActiveHttpTab();
    await renderMediaCatalog(tab);
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
  async function updateMediaCatalog() {
    if (!settings || mediaRefreshInFlight) return;
    mediaRefreshInFlight = true;
    try {
      await renderMediaCatalog(await getActiveHttpTab());
    } finally {
      mediaRefreshInFlight = false;
    }
  }
  async function renderMediaCatalog(tab) {
    activeMediaTabId = tab?.id ?? null;
    if (!settings.enabled) {
      commitMediaCatalog({
        status: "Protection is off; media observation is paused."
      });
      return;
    }
    if (settings.protectionMode === "safe") {
      commitMediaCatalog({
        status: "Switch to Assist or Auto, then reload the video page."
      });
      return;
    }
    if (!tab) {
      commitMediaCatalog({
        status: "Open an HTTP video page to test detection."
      });
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_MEDIA_CATALOG",
        tabId: tab.id,
        pageUrl: tab.url
      });
      const items = Array.isArray(response?.items) ? response.items : [];
      if (!items.length) {
        commitMediaCatalog({
          tab,
          status: response?.status === "capability_disabled" ? "Media observation is still starting. Reload the page once." : "No MP4, WebM, HLS, or DASH source detected yet."
        });
        return;
      }
      mediaHelperStatus = await readMediaHelperStatus();
      commitMediaCatalog({
        tab,
        status: helperSummary(mediaHelperStatus),
        items,
        helper: mediaHelperStatus
      });
    } catch (error) {
      setText(mediaStatus, "Could not refresh media \xB7 showing previous results.");
      console.debug("[AdsFriendly Popup] Media catalog unavailable", error);
    }
  }
  function commitMediaCatalog({ status, items = [], tab = null, helper = null }) {
    const visibleItems = selectVisibleMediaItems(items);
    const signature = createMediaCatalogViewSignature({
      tabId: tab?.id ?? null,
      status,
      helper,
      items: visibleItems
    });
    setText(mediaCount, String(items.length));
    setText(mediaStatus, status);
    renderMediaHelperAction(helper);
    if (signature === mediaRenderSignature) return;
    const fragment = document.createDocumentFragment();
    const itemsById = new Map(items.map((item) => [item.id, item]));
    for (const item of visibleItems) {
      fragment.append(createMediaItem(item, tab, helper, itemsById));
    }
    mediaList.replaceChildren(fragment);
    mediaList.hidden = visibleItems.length === 0;
    mediaRenderSignature = signature;
  }
  function renderMediaHelperAction(helper) {
    const presentation = helperSetupPresentation(helper);
    mediaHelperAction.hidden = !presentation;
    if (!presentation) return;
    mediaHelperAction.disabled = false;
    mediaHelperAction.textContent = presentation.label;
    mediaHelperAction.title = presentation.title;
  }
  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }
  function onMediaStorageChanged(changes, areaName) {
    if (areaName !== "session") return;
    if (Object.keys(changes).some((key2) => key2.startsWith(DOWNLOAD_JOB_PREFIX))) {
      void updateMediaJobs();
    }
    if (!Number.isInteger(activeMediaTabId)) return;
    const key = mediaCatalogSessionKey(activeMediaTabId);
    if (!(key in changes)) return;
    clearTimeout(scheduledMediaRefresh);
    scheduledMediaRefresh = setTimeout(() => {
      scheduledMediaRefresh = null;
      updateMediaCatalog();
    }, 120);
  }
  function createMediaItem(item, tab, helper, itemsById) {
    const row = document.createElement("div");
    row.className = "media-item";
    const kind = document.createElement("span");
    kind.className = "media-kind";
    kind.textContent = String(item.kind || "media").toUpperCase();
    const copy = document.createElement("div");
    copy.className = "media-copy";
    const name = document.createElement("span");
    name.className = "media-name";
    const sourceUrl = item.manifestUrl || item.sourceUrl || "";
    name.textContent = mediaDisplayName(item, sourceUrl);
    name.title = sourceUrl;
    const details = document.createElement("span");
    details.className = "media-details";
    details.textContent = formatMediaDetails(item);
    copy.append(name, details);
    row.append(kind, copy);
    if (["direct", "hls", "dash"].includes(item.kind)) {
      const downloadItem = itemsById.get(item.selectedMediaId) || item;
      row.append(createMediaDownloadButton(item, downloadItem, tab, helper));
    }
    return row;
  }
  function createMediaDownloadButton(item, downloadItem, tab, helper) {
    const availability = getMediaDownloadAvailability(downloadItem);
    const button = document.createElement("button");
    button.className = "media-download";
    const presentation = downloadButtonPresentation(availability, helper, item);
    button.disabled = presentation.disabled;
    button.textContent = presentation.label;
    button.title = presentation.title;
    button.addEventListener("click", async () => {
      button.disabled = true;
      if (helper.status !== "ready" || !helperCanDownload(item, helper)) {
        await setupMediaHelper(button, helper);
        return;
      }
      button.textContent = "Starting\u2026";
      try {
        const response = await chrome.runtime.sendMessage({
          type: "CREATE_MEDIA_DOWNLOAD_JOB",
          tabId: tab.id,
          mediaId: downloadItem.id
        });
        if (response?.status !== "started")
          throw new Error(
            response?.reason || response?.error || "Could not start the helper download job."
          );
        button.textContent = "Started";
        await updateMediaJobs();
      } catch (error) {
        button.disabled = false;
        button.textContent = "Retry";
        button.title = error?.message || String(error);
      }
    });
    return button;
  }
  function downloadButtonPresentation(availability, helper, item) {
    if (!availability.supported) {
      return {
        disabled: true,
        label: downloadUnavailableLabel(availability.reason),
        title: availability.reason
      };
    }
    if (helper.status === "permission_required") {
      return {
        disabled: false,
        label: "Set up",
        title: "Enable the optional Media Helper connection to download video."
      };
    }
    if (helper.status === "not_installed") {
      return {
        disabled: false,
        label: "Install",
        title: "Media Helper is required for video downloads."
      };
    }
    if (helper.status === "ready" && !helperCanDownload(item, helper)) {
      return {
        disabled: true,
        label: "Helper update",
        title: `The installed Media Helper does not support ${item.kind.toUpperCase()} downloads yet.`
      };
    }
    if (helper.status !== "ready") {
      return {
        disabled: false,
        label: "Retry",
        title: helper.error || "Could not connect to Media Helper."
      };
    }
    return {
      disabled: false,
      label: "Download",
      title: "Download with AdsFriendly Media Helper."
    };
  }
  function helperCanDownload(item, helper) {
    if (item.kind === "direct") return helper.canDownloadDirect === true;
    if (item.kind === "hls") return helper.canDownloadHls === true;
    return helper.canDownloadDash === true;
  }
  async function setupMediaHelper(button, helper) {
    try {
      if (helper.status === "permission_required") {
        button.textContent = "Allowing\u2026";
        const granted = await chrome.permissions.request({
          permissions: ["nativeMessaging"]
        });
        if (!granted) {
          button.disabled = false;
          button.textContent = "Allow helper connection";
          button.title = "Media Helper permission was not granted.";
          return;
        }
      } else if (helper.status === "not_installed") {
        alert(
          "AdsFriendly Media Helper is not installed or registered. Install the Windows helper, then reopen this popup."
        );
        button.disabled = false;
        button.textContent = "Install";
        return;
      }
      button.textContent = "Checking\u2026";
      mediaHelperStatus = await readMediaHelperStatus(true);
      await renderMediaCatalog(await getActiveHttpTab());
    } catch (error) {
      button.disabled = false;
      button.textContent = "Retry";
      button.title = error?.message || String(error);
    }
  }
  async function readMediaHelperStatus(force = false) {
    const response = await chrome.runtime.sendMessage({
      type: "GET_MEDIA_HELPER_STATUS",
      force
    });
    return response?.status ? response : {
      status: "unavailable",
      canDownloadDirect: false,
      canDownloadHls: false,
      canDownloadDash: false,
      error: response?.error || "Could not read Media Helper status."
    };
  }
  function helperSummary(helper) {
    if (helper.status === "permission_required")
      return "Media found \xB7 allow Media Helper connection to download.";
    if (helper.status === "not_installed")
      return "Media found \xB7 Media Helper is not installed.";
    if (helper.status === "ready" && (helper.canDownloadDirect || helper.canDownloadHls || helper.canDownloadDash))
      return `Media Helper ${helper.helperVersion || ""} ready.`.trim();
    if (helper.status === "ready")
      return "Media Helper connected \xB7 downloader update required.";
    if (helper.status === "incompatible")
      return "Media Helper version is incompatible.";
    return "Media found \xB7 Media Helper is unavailable.";
  }
  async function updateMediaJobs() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_MEDIA_DOWNLOAD_JOBS"
      });
      renderMediaJobs(Array.isArray(response?.items) ? response.items : []);
    } catch (error) {
      console.debug("[AdsFriendly Popup] Download jobs unavailable", error);
    }
  }
  function renderMediaJobs(items) {
    const visible = items.slice(0, 4);
    const existing = new Map(
      [...mediaJobList.children].map((row) => [row.dataset.jobId, row])
    );
    const visibleIds = /* @__PURE__ */ new Set();
    for (const item of visible) {
      visibleIds.add(item.id);
      const row = existing.get(item.id) || createMediaJobItem();
      updateMediaJobItem(row, item);
      mediaJobList.append(row);
    }
    for (const [jobId, row] of existing) {
      if (!visibleIds.has(jobId)) row.remove();
    }
    mediaJobList.hidden = visible.length === 0;
  }
  function createMediaJobItem() {
    const row = document.createElement("div");
    row.className = "media-job";
    const copy = document.createElement("div");
    copy.className = "media-job-copy";
    const label = document.createElement("span");
    label.className = "media-name media-job-label";
    const detail = document.createElement("span");
    detail.className = "media-details media-job-detail";
    copy.append(label, detail);
    row.append(copy);
    return row;
  }
  function updateMediaJobItem(row, job) {
    row.dataset.jobId = job.id;
    setText(
      row.querySelector(".media-job-label"),
      job.title || String(job.kind || "media").toUpperCase()
    );
    setText(row.querySelector(".media-job-detail"), mediaJobDetails(job));
    let cancel = row.querySelector(".media-cancel");
    if (["starting", "probing", "downloading", "finalizing"].includes(job.status)) {
      if (!cancel) {
        cancel = document.createElement("button");
        cancel.className = "media-download media-cancel";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", async () => {
          cancel.disabled = true;
          cancel.textContent = "Stopping\u2026";
          await chrome.runtime.sendMessage({
            type: "CANCEL_MEDIA_DOWNLOAD_JOB",
            jobId: cancel.dataset.jobId
          });
          await updateMediaJobs();
        });
        row.append(cancel);
      }
      cancel.dataset.jobId = job.id;
    } else {
      cancel?.remove();
    }
  }
  function mediaJobDetails(job) {
    if (job.status === "completed")
      return `Completed \xB7 ${job.outputPath || "saved"}`;
    if (job.status === "failed")
      return `Failed \xB7 ${job.error || "unknown error"}`;
    if (job.status === "cancelled")
      return "Cancelled \xB7 resume available on retry";
    if (job.status === "cancelling") return "Stopping\u2026";
    const downloaded = job.progress?.downloadedBytes;
    const total = job.progress?.totalBytes;
    const processedSeconds = job.progress?.processedSeconds;
    const duration = job.progress?.duration;
    if (Number.isFinite(processedSeconds) && Number.isFinite(duration) && duration > 0) {
      const percent = Math.min(
        100,
        Math.round(processedSeconds / duration * 100)
      );
      const size = Number.isFinite(downloaded) ? ` \xB7 ${formatBytes(downloaded)}` : "";
      return `${percent}% \xB7 ${formatDuration2(processedSeconds)} / ${formatDuration2(duration)}${size}`;
    }
    if (Number.isFinite(downloaded) && Number.isFinite(total) && total > 0) {
      const percent = Math.min(100, Math.round(downloaded / total * 100));
      const speed = Number.isFinite(job.progress?.bytesPerSecond) ? ` \xB7 ${formatBytes(job.progress.bytesPerSecond)}/s` : "";
      return `${percent}% \xB7 ${formatBytes(downloaded)} / ${formatBytes(total)}${speed}`;
    }
    return `${job.status || "starting"}\u2026`;
  }
  function formatDuration2(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const remaining = total % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}` : `${minutes}:${String(remaining).padStart(2, "0")}`;
  }
  function formatBytes(bytes) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  }
  function downloadUnavailableLabel(reason = "") {
    if (reason.includes("DRM")) return "DRM";
    if (reason.includes("Live")) return "Live";
    if (reason.includes("Encrypted")) return "Encrypted";
    if (reason.includes("waiting") || reason.includes("not exposed"))
      return "Waiting";
    if (reason.includes("no media")) return "No media";
    return "Unavailable";
  }
  function mediaDisplayName(item, sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (url.protocol === "blob:") return item.title || "Blob media stream";
      const file = url.pathname.split("/").filter(Boolean).at(-1);
      if (item.kind === "hls" && file?.length > 48 && /^[a-z0-9_-]+$/i.test(file))
        return `${url.hostname} \xB7 tokenized playlist`;
      return file ? `${url.hostname} \xB7 ${file}` : url.hostname;
    } catch {
      return item.title || sourceUrl || "Unknown media";
    }
  }
  async function getActiveHttpTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url?.startsWith("http") ? tab : null;
  }
})();
