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
    feature("main-world.blob-source-tracer", "main-world", C2.MEDIA_OBSERVE),
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
        return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
      return { supported: true, reason: null };
    }
    if (candidate.kind === "dash") {
      if (candidate.probeStatus !== "ready")
        return { supported: false, reason: "DASH manifest is not ready." };
      if (candidate.drm === "suspected" || candidate.drm === "confirmed")
        return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
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
      return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
    if (candidate.encryptionMethods?.length && !isDownloadableAes128(candidate))
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
  function isDownloadableAes128(candidate) {
    const methods = candidate.encryptionMethods || [];
    const formats = candidate.encryptionKeyFormats || [];
    return methods.length > 0 && methods.every((method) => String(method).toUpperCase() === "AES-128") && formats.every((format) => String(format).toLowerCase() === "identity");
  }
  function drmPlaybackOnlyReason(candidate) {
    const state = candidate.drm === "confirmed" ? "confirmed" : "suspected";
    const system = candidate.drmSystem ? ` \xB7 ${formatDrmSystem(candidate.drmSystem)}` : "";
    return `DRM ${state}${system} \xB7 Playback only.`;
  }
  function formatDrmSystem(value) {
    return value === "widevine" ? "Widevine" : value === "playready" ? "PlayReady" : value === "fairplay" ? "FairPlay" : value === "clearkey" ? "Clear Key" : "Unknown system";
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
    facts.push(connectionFact);
    if (facts.length === 1) facts.unshift(capitalize(job.status || "starting"));
    return facts.join(" \xB7 ");
  }
  function formatCompactMediaJobDetails(job = {}) {
    if (job.status === "completed") {
      const progress = getMediaJobProgress(job);
      const size = progress.totalBytes ?? progress.downloadedBytes;
      return ["Completed", size !== null ? formatBytes(size) : null].filter(Boolean).join(" \xB7 ");
    }
    const terminalLabels = {
      failed: "Failed",
      cancelled: "Cancelled",
      paused: "Paused"
    };
    return terminalLabels[job.status] || formatMediaJobDetails(job);
  }
  function selectCompactMediaJobs(items, limit = 3) {
    const jobs = Array.isArray(items) ? items : [];
    const active = jobs.filter((job) => isMediaJobActive(job));
    const recent = jobs.filter((job) => !isMediaJobActive(job));
    return [...active, ...recent].slice(0, Math.max(0, limit));
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
    const blobResolvedSourceIds = new Set(
      items.filter((item) => item.kind === "blob" && item.selectedMediaId).flatMap((item) => [
        item.selectedMediaId,
        ...item.resolvedMediaIds || [],
        ...item.blobTrace?.candidateIds || []
      ]).filter(Boolean)
    );
    const sorted = [...items].sort(
      (left, right) => (right.firstSeenAt || 0) - (left.firstSeenAt || 0) || String(left.id || "").localeCompare(String(right.id || ""))
    );
    const visible = [];
    const blobGroups = /* @__PURE__ */ new Map();
    const resolvedBlobGroupKeys = resolvedBlobGroupKeysByPage(items);
    for (const item of sorted) {
      if (item.kind !== "blob" && blobResolvedSourceIds.has(item.id)) continue;
      if (item.kind === "hls" && item.parentManifestIds?.length) continue;
      if (item.kind !== "blob") {
        visible.push(item);
        continue;
      }
      const key = blobGroupKey(item, resolvedBlobGroupKeys);
      const existing = blobGroups.get(key);
      if (existing) {
        existing.relatedCount += 1;
        if (item.selectedMediaId && !existing.selectedMediaId) {
          const resolved = { ...item, relatedCount: existing.relatedCount };
          blobGroups.set(key, resolved);
          const visibleIndex = visible.indexOf(existing);
          if (visibleIndex >= 0) visible[visibleIndex] = resolved;
        }
        continue;
      }
      const grouped = { ...item, relatedCount: 1 };
      blobGroups.set(key, grouped);
      visible.push(grouped);
    }
    return visible.slice(0, maximum);
  }
  function getMediaCatalogDownloadState(items = []) {
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const candidates = /* @__PURE__ */ new Map();
    for (const item of selectVisibleMediaItems(items, Number.MAX_SAFE_INTEGER)) {
      const candidate = item.selectedMediaId ? itemsById.get(item.selectedMediaId) || item.resolvedStream || item : item;
      if (!["direct", "hls", "dash"].includes(candidate.kind)) continue;
      candidates.set(candidate.id, candidate);
    }
    const availability = [...candidates.values()].map((candidate) => ({
      candidate,
      ...getMediaDownloadAvailability(candidate)
    }));
    return {
      candidateCount: availability.length,
      downloadableCount: availability.filter((item) => item.supported).length,
      drmBlockedCount: availability.filter(
        (item) => String(item.reason || "").includes("DRM")
      ).length,
      unavailableCount: availability.filter((item) => !item.supported).length
    };
  }
  function helperSetupPresentation(helper, { hasDownloadableMedia = true } = {}) {
    if (!hasDownloadableMedia || !helper || helper.status === "ready")
      return null;
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
  function formatMediaHelperSummary(helper, downloadState) {
    if (!downloadState.downloadableCount) {
      if (downloadState.drmBlockedCount)
        return "Media found \xB7 DRM stream is playback only.";
      return "Media found \xB7 no downloadable source is ready yet.";
    }
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
    if (/timed out/i.test(helper.error || ""))
      return "Media found \xB7 Media Helper took too long to start.";
    if (/exited|disconnected/i.test(helper.error || ""))
      return "Media found \xB7 Media Helper exited during startup.";
    return "Media found \xB7 Media Helper connection failed.";
  }
  function formatMediaDetails(item) {
    if (item.kind === "blob" && item.selectedMediaId)
      return resolvedBlobDetails(item);
    if (item.kind === "blob")
      return item.relatedCount > 1 ? `${item.relatedCount} Blob signals \xB7 tracing source buffers` : item.blobTrace?.appendCount ? `${item.blobTrace.appendCount} buffers observed \xB7 matching source` : "Blob signal \xB7 tracing source buffers";
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
        facts.push(formatDuration2(item.duration));
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
    appendProtectionFacts(facts, item);
    return facts.filter(Boolean).join(" \xB7 ") || "HLS manifest ready";
  }
  function formatMediaName(item) {
    const sourceUrl = item.resolvedStream?.manifestUrl || item.resolvedStream?.sourceUrl || item.manifestUrl || item.sourceUrl || "";
    try {
      const url = new URL(sourceUrl);
      if (item.kind === "blob") {
        const title = readableMediaTitle(item.title);
        if (title) return title;
        if (["http:", "https:"].includes(url.protocol))
          return `${url.hostname} \xB7 ${String(item.resolvedKind || "media").toUpperCase()} source`;
        return "Blob media stream";
      }
      const file = url.pathname.split("/").filter(Boolean).at(-1);
      if (item.kind === "hls" && file?.length > 48 && /^[a-z0-9_-]+$/i.test(file))
        return `${url.hostname} \xB7 tokenized playlist`;
      return file ? `${url.hostname} \xB7 ${file}` : url.hostname;
    } catch {
      return readableMediaTitle(item.title) || sourceUrl || "Unknown media";
    }
  }
  function resolvedBlobDetails(item) {
    const stream = item.resolvedStream || {};
    const kind = String(
      item.resolvedKind || stream.kind || "media"
    ).toUpperCase();
    const facts = [`Blob resolved to ${kind}`];
    if (stream.resolution?.height) facts.push(`${stream.resolution.height}p`);
    if (Number.isFinite(stream.duration) && stream.duration > 0)
      facts.push(formatDuration2(stream.duration));
    appendProtectionFacts(facts, stream);
    return facts.join(" \xB7 ");
  }
  function dashDetails(item) {
    if (item.probeStatus === "failed") return "DASH manifest request failed";
    if (item.probeStatus === "unsupported") return "DASH manifest not supported";
    if (item.probeStatus !== "ready")
      return "DASH manifest found \xB7 reading tracks";
    const facts = [item.streamType === "live" ? "Live DASH" : "DASH VOD"];
    if (Number.isFinite(item.duration) && item.duration > 0)
      facts.push(formatDuration2(item.duration));
    const qualities = [...item.variants || []].sort(compareVariantQuality).map(variantLabel).filter((label, index, labels) => label && labels.indexOf(label) === index).slice(0, 4);
    if (qualities.length) facts.push(qualities.join(" \xB7 "));
    if (item.audioTracks?.length) facts.push(`${item.audioTracks.length} audio`);
    if (item.subtitles?.length) facts.push(`${item.subtitles.length} subtitles`);
    appendProtectionFacts(facts, item);
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
      facts.push(formatDuration2(stream.duration));
    if (stream.segmentCount > 0) facts.push(`${stream.segmentCount} segments`);
    if (stream.partialSegmentCount > 0)
      facts.push(`${stream.partialSegmentCount} parts`);
    appendProtectionFacts(facts, stream);
    if (item.resolvedRequestContext?.requiresBrowserSession)
      facts.push("browser session");
    return facts.join(" \xB7 ");
  }
  function appendProtectionFacts(facts, item) {
    if (item.drm === "confirmed") {
      facts.push(
        `DRM confirmed${item.drmSystem ? ` \xB7 ${formatDrmSystem2(item.drmSystem)}` : ""}`,
        "Playback only"
      );
      return;
    }
    if (item.drm === "suspected") {
      facts.push(
        item.encryptionScheme === "sample-aes" ? "DRM suspected \xB7 SAMPLE-AES" : "DRM suspected",
        "Playback only"
      );
      return;
    }
    if (item.encryptionScheme === "aes-128") {
      facts.push("Encrypted HLS \xB7 AES-128");
      return;
    }
    if (item.encryptionMethods?.length) facts.push("Encrypted");
  }
  function formatDrmSystem2(value) {
    return value === "widevine" ? "Widevine" : value === "playready" ? "PlayReady" : value === "fairplay" ? "FairPlay" : value === "clearkey" ? "Clear Key" : "Unknown system";
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
  function formatDuration2(seconds) {
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
  function readableMediaTitle(value) {
    const title = typeof value === "string" ? value.trim() : "";
    if (!title || title.length > 160) return null;
    if (/^[a-f0-9]{24,}$/i.test(title)) return null;
    return title;
  }
  function resolvedBlobGroupKeysByPage(items) {
    const byPage = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (item.kind !== "blob" || !item.selectedMediaId) continue;
      const pageUrl = item.pageUrl || "";
      const matches = byPage.get(pageUrl) || [];
      matches.push(item);
      byPage.set(pageUrl, matches);
    }
    return new Map(
      [...byPage].flatMap(
        ([pageUrl, matches]) => matches.length === 1 ? [[pageUrl, `${pageUrl}
${blobTitleKey(matches[0].title)}`]] : []
      )
    );
  }
  function blobGroupKey(item, resolvedGroupKeys) {
    const pageUrl = item.pageUrl || "";
    if (!item.selectedMediaId && isGenericBlobTitle(item.title)) {
      const resolvedKey = resolvedGroupKeys.get(pageUrl);
      if (resolvedKey) return resolvedKey;
    }
    return `${pageUrl}
${blobTitleKey(item.title)}`;
  }
  function blobTitleKey(value) {
    return readableMediaTitle(value)?.toLowerCase() || "blob";
  }
  function isGenericBlobTitle(value) {
    const title = typeof value === "string" ? value.trim() : "";
    return !readableMediaTitle(title) || /^(blob|blob media stream|media stream)$/i.test(title);
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
      resolvedKind: item.resolvedKind,
      blobTrace: item.blobTrace,
      requiresBrowserSession: item.resolvedRequestContext?.requiresBrowserSession === true,
      drm: item.drm,
      drmSystem: item.drmSystem,
      drmEvidence: item.drmEvidence,
      eme: item.eme,
      encryptionScheme: item.encryptionScheme,
      encryptionKeyFormats: item.encryptionKeyFormats,
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
  var mediaManagerLink = document.getElementById("media-manager-link");
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
  var hasMediaDownloadJobs = false;
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
  mediaManagerLink.addEventListener("click", () => {
    void chrome.tabs.create({
      url: chrome.runtime.getURL("options/options.html#downloads")
    });
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
    const tab = await getActiveHttpTab();
    await renderMediaCatalog(tab);
    await updateMediaJobs();
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
      const downloadState = getMediaCatalogDownloadState(items);
      commitMediaCatalog({
        tab,
        status: formatMediaHelperSummary(mediaHelperStatus, downloadState),
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
    if (!visibleItems.length && hasMediaDownloadJobs && /Open an HTTP video page|No MP4, WebM, HLS, or DASH/i.test(status)) {
      status = "No media on this tab \xB7 downloads remain available below.";
    }
    const downloadState = getMediaCatalogDownloadState(items);
    const signature = createMediaCatalogViewSignature({
      tabId: tab?.id ?? null,
      status,
      helper,
      items: visibleItems
    });
    setText(mediaCount, String(visibleItems.length));
    setText(mediaStatus, status);
    renderMediaHelperAction(helper, downloadState);
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
  function renderMediaHelperAction(helper, downloadState) {
    const presentation = helperSetupPresentation(helper, {
      hasDownloadableMedia: downloadState.downloadableCount > 0
    });
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
    const sourceUrl = item.resolvedStream?.manifestUrl || item.resolvedStream?.sourceUrl || item.manifestUrl || item.sourceUrl || "";
    name.textContent = formatMediaName(item);
    name.title = sourceUrl;
    const details = document.createElement("span");
    details.className = "media-details";
    details.textContent = formatMediaDetails(item);
    copy.append(name, details);
    row.append(kind, copy);
    if (["direct", "hls", "dash"].includes(item.kind) || item.kind === "blob" && item.selectedMediaId) {
      const downloadItem = itemsById.get(item.selectedMediaId) || item;
      row.append(createMediaDownloadButton(item, downloadItem, tab, helper));
    }
    return row;
  }
  function createMediaDownloadButton(item, downloadItem, tab, helper) {
    const availability = getMediaDownloadAvailability(downloadItem);
    const button = document.createElement("button");
    button.className = "media-download";
    const presentation = downloadButtonPresentation(
      availability,
      helper,
      downloadItem
    );
    button.disabled = presentation.disabled;
    button.textContent = presentation.label;
    button.title = presentation.title;
    button.addEventListener("click", async () => {
      button.disabled = true;
      if (helper.status !== "ready" || !helperCanDownload(downloadItem, helper)) {
        await setupMediaHelper(button, helper);
        return;
      }
      button.textContent = "Starting\u2026";
      try {
        const response = await chrome.runtime.sendMessage({
          type: "CREATE_MEDIA_DOWNLOAD_JOB",
          tabId: tab.id,
          mediaId: downloadItem.id,
          connections: settings?.mediaDownloadConnections ?? 8
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
      await updateMediaJobs();
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
    const visible = selectCompactMediaJobs(items, 3);
    hasMediaDownloadJobs = visible.length > 0;
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
    mediaManagerLink.hidden = visible.length === 0;
    if (visible.length && mediaCount.textContent === "0" && /Open an HTTP video page|No MP4, WebM, HLS, or DASH/i.test(
      mediaStatus.textContent
    )) {
      setText(
        mediaStatus,
        "No media on this tab \xB7 downloads remain available below."
      );
    }
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
    const actions = document.createElement("div");
    actions.className = "media-job-actions";
    copy.append(label, detail);
    row.append(copy, actions);
    return row;
  }
  function updateMediaJobItem(row, job) {
    row.dataset.jobId = job.id;
    const active = isMediaJobActive(job);
    row.classList.toggle("media-job-terminal", !active);
    setText(
      row.querySelector(".media-job-label"),
      job.title || String(job.kind || "media").toUpperCase()
    );
    const detail = row.querySelector(".media-job-detail");
    setText(
      detail,
      active ? formatMediaJobDetails(job) : formatCompactMediaJobDetails(job)
    );
    detail.className = `media-details media-job-detail media-job-status-${job.status || "unknown"}`;
    detail.title = active ? "" : job.error || job.outputPath || "";
    const action = getMediaJobPrimaryAction(job);
    const pauseAvailability = getMediaJobPauseAvailability(job);
    const actions = row.querySelector(".media-job-actions");
    actions.replaceChildren();
    if (action) {
      actions.append(
        createMediaJobAction(job, {
          label: action.label,
          messageType: action.messageType,
          actionType: action.type,
          title: action.type === "cancel" && pauseAvailability?.supported === false ? `${pauseAvailability.reason} Cancel is still available.` : "",
          danger: action.type === "cancel"
        })
      );
    }
    if (job.status === "completed" && job.outputPath) {
      const outputActionsReady = mediaHelperStatus?.capabilities?.["output.open"] === true && mediaHelperStatus?.capabilities?.["output.reveal"] === true;
      const open = createMediaJobAction(job, {
        label: "Open",
        messageType: "OPEN_MEDIA_DOWNLOAD_OUTPUT",
        actionType: "output",
        title: "Open downloaded video"
      });
      const folder = createMediaJobAction(job, {
        label: "Folder",
        messageType: "REVEAL_MEDIA_DOWNLOAD_OUTPUT",
        actionType: "output",
        title: "Open file location"
      });
      open.disabled = !outputActionsReady;
      folder.disabled = !outputActionsReady;
      if (!outputActionsReady) {
        open.title = folder.title = "Media Helper output actions are unavailable.";
      }
      actions.append(open, folder);
    }
  }
  function createMediaJobAction(job, { label, messageType, actionType, title = "", danger = false }) {
    const button = document.createElement("button");
    button.className = "media-download media-job-action";
    button.classList.toggle("media-cancel", danger);
    button.textContent = label;
    button.title = title;
    button.dataset.jobId = job.id;
    button.dataset.messageType = messageType;
    button.dataset.actionType = actionType;
    button.addEventListener("click", () => runMediaJobAction(button));
    return button;
  }
  async function runMediaJobAction(button) {
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = button.dataset.actionType === "pause" ? "Pausing\u2026" : button.dataset.actionType === "cancel" ? "Stopping\u2026" : button.dataset.actionType === "output" ? "\u2026" : "Starting\u2026";
    try {
      const response = await chrome.runtime.sendMessage({
        type: button.dataset.messageType,
        jobId: button.dataset.jobId,
        connections: settings?.mediaDownloadConnections ?? 8
      });
      if (!["started", "pausing", "cancelling", "opened"].includes(response?.status)) {
        throw new Error(
          response?.reason || response?.error || "Job action failed."
        );
      }
      if (response.status === "opened") button.textContent = originalLabel;
      await updateMediaJobs();
    } catch (error) {
      button.disabled = false;
      button.textContent = button.dataset.actionType === "output" ? originalLabel : "Retry action";
      button.title = error?.message || String(error);
    }
  }
  function downloadUnavailableLabel(reason = "") {
    if (reason.includes("DRM")) return "Playback only";
    if (reason.includes("Live")) return "Live";
    if (reason.includes("Encrypted")) return "Encrypted";
    if (reason.includes("waiting") || reason.includes("not exposed"))
      return "Waiting";
    if (reason.includes("no media")) return "No media";
    return "Unavailable";
  }
  async function getActiveHttpTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url?.startsWith("http") ? tab : null;
  }
})();
