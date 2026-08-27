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

  // src/media/adaptive-track-policy.js
  var ADAPTIVE_TRACK_RESOLUTION = Object.freeze({
    RESOLVED: "resolved",
    N_TRANSFORM_PENDING: "n_transform_pending",
    SIGNATURE_CIPHER_PENDING: "signature_cipher_pending",
    PROVIDER_CLIENT_PENDING: "provider_client_pending"
  });
  function hasHttpAdaptiveTrackUrl(track) {
    try {
      return ["http:", "https:"].includes(
        new URL(track?.sourceUrl || track?.url).protocol
      );
    } catch {
      return false;
    }
  }
  function isYouTubeProviderResolvableTrack(candidate, track) {
    return candidate?.provider === "youtube" && track?.urlResolution === ADAPTIVE_TRACK_RESOLUTION.PROVIDER_CLIENT_PENDING && /^\d{1,6}$/.test(String(track?.itag || ""));
  }
  function isAcquirableAdaptiveTrack(candidate, track) {
    if (isYouTubeProviderResolvableTrack(candidate, track)) return true;
    if (!hasHttpAdaptiveTrackUrl(track)) return false;
    if ([
      ADAPTIVE_TRACK_RESOLUTION.N_TRANSFORM_PENDING,
      ADAPTIVE_TRACK_RESOLUTION.SIGNATURE_CIPHER_PENDING
    ].includes(track?.urlResolution))
      return Boolean(candidate?.playerUrl);
    return true;
  }
  function hasYouTubeProviderPendingTracks(candidate) {
    return [
      ...candidate?.variants || [],
      ...candidate?.audioTracks || []
    ].some((track) => isYouTubeProviderResolvableTrack(candidate, track));
  }

  // src/media/download-options.js
  var MEDIA_OUTPUT_CONTAINERS = Object.freeze({
    SOURCE: "source",
    MP4: "mp4",
    MKV: "mkv"
  });
  function getMediaDownloadProfiles(candidate = {}, { canSelectContainer = true } = {}) {
    if (candidate.kind === "direct") {
      const container = classifyDirectMediaContainer(candidate);
      return [
        Object.freeze({
          id: "source",
          container: MEDIA_OUTPUT_CONTAINERS.SOURCE,
          extension: container ? `.${container}` : null,
          label: `Original${container ? ` \xB7 ${container.toUpperCase()}` : ""}`,
          description: "Download the original file without conversion."
        })
      ];
    }
    if (!["hls", "dash", "adaptive"].includes(candidate.kind)) return [];
    const profiles = [
      Object.freeze({
        id: "video-mp4",
        container: MEDIA_OUTPUT_CONTAINERS.MP4,
        extension: ".mp4",
        label: "MP4 \xB7 compatible",
        description: "Best compatibility for browsers, phones, and TVs."
      })
    ];
    if (canSelectContainer) {
      profiles.push(
        Object.freeze({
          id: "video-mkv",
          container: MEDIA_OUTPUT_CONTAINERS.MKV,
          extension: ".mkv",
          label: "MKV \xB7 flexible",
          description: "Keeps more source codecs without re-encoding."
        })
      );
    }
    return profiles;
  }
  function getMediaVideoQualityOptions(candidate = {}) {
    if (candidate.kind !== "adaptive") return [];
    const hasSeparateAudio = (candidate.audioTracks || []).some(
      (track) => isAcquirableAdaptiveTrack(candidate, track)
    );
    return uniqueObjects(candidate.variants || []).filter(
      (track) => isAcquirableAdaptiveTrack(candidate, track) && (track.muxed === true || hasSeparateAudio)
    ).sort(compareVideoQuality).map(
      (track) => Object.freeze({
        id: track.id,
        label: videoQualityLabel(track),
        height: positiveInteger(track.resolution?.height || track.height),
        muxed: track.muxed === true,
        estimatedBytes: positiveInteger(track.contentLength)
      })
    );
  }
  function compareVideoQuality(left, right) {
    return (right.resolution?.height || right.height || 0) - (left.resolution?.height || left.height || 0) || (right.averageBandwidth || right.bandwidth || 0) - (left.averageBandwidth || left.bandwidth || 0);
  }
  function videoQualityLabel(track) {
    const quality = track.qualityLabel || (track.resolution?.height || track.height ? `${track.resolution?.height || track.height}p` : "Source quality");
    const format = String(track.mimeType || "").includes("webm") ? "WebM" : String(track.mimeType || "").includes("mp4") ? "MP4" : null;
    const codec = codecLabel(track.codecs);
    return [quality, format, track.muxed === true ? "audio included" : codec].filter(Boolean).join(" \xB7 ");
  }
  function codecLabel(value) {
    const codec = String(value || "").toLowerCase();
    if (codec.includes("avc1") || codec.includes("avc3")) return "H.264";
    if (codec.includes("av01")) return "AV1";
    if (codec.includes("vp9") || codec.includes("vp09")) return "VP9";
    if (codec.includes("hev1") || codec.includes("hvc1")) return "HEVC";
    return null;
  }
  function classifyDirectMediaContainer(candidate = {}) {
    const mime = String(candidate.mimeType || "").split(";", 1)[0].trim().toLowerCase();
    const byMime = {
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/webm": "webm",
      "audio/ogg": "ogg"
    }[mime];
    if (byMime) return byMime;
    try {
      const path = new URL(candidate.sourceUrl).pathname;
      const extension = path.match(/\.([a-z0-9]{2,6})$/i)?.[1]?.toLowerCase();
      return extension || null;
    } catch {
      return null;
    }
  }
  function getMediaDownloadEstimate(candidate = {}, displayItem = null, { videoTrackId = null } = {}) {
    const presentation = displayItem || candidate;
    const resolved = presentation.resolvedStream || candidate.resolvedStream;
    const allVariants = uniqueObjects([
      ...candidate.variants || [],
      ...presentation.variants || []
    ]);
    const variants = (candidate.kind === "adaptive" ? allVariants.filter(
      (track) => isAcquirableAdaptiveTrack(candidate, track)
    ) : allVariants).sort(compareBandwidth);
    const selectedVariant = variants.find((variant) => variant.id === videoTrackId) || variants[0] || null;
    const resolution = resolved?.resolution || (candidate.kind === "adaptive" ? selectedVariant?.resolution : null) || candidate.resolution || presentation.resolution || selectedVariant?.resolution || null;
    const duration = firstPositiveNumber(
      resolved?.duration,
      candidate.duration,
      presentation.duration
    );
    let bandwidth = firstPositiveNumber(
      resolved?.bandwidth,
      candidate.kind === "adaptive" ? selectedVariant?.averageBandwidth : null,
      candidate.kind === "adaptive" ? selectedVariant?.bandwidth : null,
      candidate.averageBandwidth,
      candidate.bandwidth,
      selectedVariant?.averageBandwidth,
      selectedVariant?.bandwidth
    );
    if (["dash", "adaptive"].includes(candidate.kind) && bandwidth && selectedVariant?.muxed !== true) {
      const audioBandwidth = [...candidate.audioTracks || []].filter(
        (track) => candidate.kind === "adaptive" ? isAcquirableAdaptiveTrack(candidate, track) : true
      ).map(
        (track) => firstPositiveNumber(track.averageBandwidth, track.bandwidth)
      ).filter(Boolean).sort((left, right) => right - left)[0];
      if (audioBandwidth) bandwidth += audioBandwidth;
    }
    const adaptiveBytes = candidate.kind === "adaptive" ? adaptiveContentLength(candidate, selectedVariant) : null;
    const estimatedBytes = adaptiveBytes || (duration && bandwidth ? Math.round(duration * bandwidth / 8) : null);
    return Object.freeze({
      resolution: resolution ? {
        width: positiveInteger(resolution.width),
        height: positiveInteger(resolution.height)
      } : null,
      duration,
      bandwidth,
      estimatedBytes,
      basis: estimatedBytes ? candidate.kind === "adaptive" ? adaptiveBytes ? "track_content_length" : "track_bitrate" : "manifest_bandwidth" : null
    });
  }
  function adaptiveContentLength(candidate, selectedVariant = null) {
    const video = selectedVariant?.contentLength || [...candidate.variants || []].sort(compareBandwidth)[0]?.contentLength;
    if (selectedVariant?.muxed === true) {
      const total2 = Number(video) || 0;
      return Number.isSafeInteger(total2) && total2 > 0 ? total2 : null;
    }
    const audio = [...candidate.audioTracks || []].filter((track) => isAcquirableAdaptiveTrack(candidate, track)).sort(compareBandwidth)[0]?.contentLength;
    const total = (Number(video) || 0) + (Number(audio) || 0);
    return Number.isSafeInteger(total) && total > 0 ? total : null;
  }
  function compareBandwidth(left, right) {
    return (firstPositiveNumber(right.averageBandwidth, right.bandwidth) || 0) - (firstPositiveNumber(left.averageBandwidth, left.bandwidth) || 0) || (right.resolution?.height || 0) - (left.resolution?.height || 0);
  }
  function uniqueObjects(items) {
    const unique = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      unique.set(
        item.id || `${item.url || ""}:${item.bandwidth || ""}:${item.resolution?.height || ""}`,
        item
      );
    }
    return [...unique.values()];
  }
  function firstPositiveNumber(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return null;
  }
  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  // src/media/protection-policy.js
  var STRONG_DRM_EVIDENCE = /* @__PURE__ */ new Set(["hls-keyformat", "eme-key-system-access"]);
  function hasStrongDrmEvidence(candidate = {}) {
    if (candidate.drm === "confirmed") return true;
    if (candidate.drm !== "suspected") return false;
    if (candidate.drmSystem) return true;
    if ((candidate.drmEvidence || []).some(
      (evidence) => STRONG_DRM_EVIDENCE.has(String(evidence).toLowerCase())
    )) {
      return true;
    }
    const eme = candidate.eme;
    return Boolean(
      eme?.keySystems?.length || eme?.keyStatuses?.length || eme?.licenseStatus
    );
  }
  function isWeakSampleAesSignal(candidate = {}) {
    if (candidate.drm !== "suspected") return false;
    if (candidate.encryptionScheme !== "sample-aes") return false;
    return !hasStrongDrmEvidence(candidate);
  }
  function isFfmpegCompatibleSampleAes(candidate = {}) {
    if (!isWeakSampleAesSignal(candidate)) return false;
    if (hasUnsupportedHlsKeyFormat(candidate)) return false;
    const methods = candidate.encryptionMethods || [];
    return methods.length === 0 || methods.every((method) => {
      const normalized = String(method).trim().toUpperCase();
      return normalized === "AES-128" || normalized.startsWith("SAMPLE-AES");
    });
  }
  function hasUnsupportedHlsKeyFormat(candidate = {}) {
    return (candidate.encryptionKeyFormats || []).map(normalizeHlsKeyFormat).filter(Boolean).some((format) => format !== "identity");
  }
  function normalizeHlsKeyFormat(value) {
    return String(value || "").trim().replace(/^["']|["']$/g, "").trim().toLowerCase().slice(0, 100);
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
      if (hasStrongDrmEvidence(candidate))
        return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
      return { supported: true, reason: null };
    }
    if (candidate.kind === "dash") {
      if (candidate.probeStatus !== "ready")
        return { supported: false, reason: "DASH manifest is not ready." };
      if (hasStrongDrmEvidence(candidate))
        return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
      if (candidate.streamType === "live")
        return { supported: false, reason: "Live DASH is not supported yet." };
      if (candidate.streamType !== "vod")
        return { supported: false, reason: "Unknown DASH stream type." };
      if (!candidate.variants?.length && !candidate.audioTracks?.length)
        return { supported: false, reason: "DASH manifest has no media tracks." };
      return { supported: true, reason: null };
    }
    if (candidate.kind === "adaptive") {
      if (candidate.probeStatus !== "ready")
        return {
          supported: false,
          reason: "Adaptive media is waiting for both video and audio tracks."
        };
      if (hasStrongDrmEvidence(candidate))
        return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
      if (candidate.streamType !== "vod")
        return {
          supported: false,
          reason: "Only completed adaptive media is supported."
        };
      let variants;
      let audioTracks;
      try {
        variants = normalizeAdaptiveTracks(
          candidate.variants,
          "video",
          candidate
        );
        audioTracks = normalizeAdaptiveTracks(
          candidate.audioTracks,
          "audio",
          candidate
        );
      } catch {
        return {
          supported: false,
          reason: "An adaptive track URL is invalid or no longer usable."
        };
      }
      const hasMuxedTrack = variants.some((track) => track.muxed === true);
      if (!variants.length || !audioTracks.length && !hasMuxedTrack)
        return {
          supported: false,
          reason: "Adaptive media needs one resolved video and audio track."
        };
      return { supported: true, reason: null };
    }
    if (candidate.kind !== "hls")
      return {
        supported: false,
        reason: "This media type is not supported yet."
      };
    if (candidate.probeStatus !== "ready")
      return { supported: false, reason: "Manifest is not ready." };
    if (candidate.probeSource === "decrypted_blob" && !hasCurrentManifestHandoff(candidate))
      return {
        supported: false,
        reason: "Player-decrypted manifest found; secure download handoff is not ready yet."
      };
    if (hasStrongDrmEvidence(candidate))
      return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
    if (hasUnsupportedHlsKeyFormat(candidate))
      return {
        supported: false,
        reason: customHlsPlaybackOnlyReason(candidate)
      };
    if (isWeakSampleAesSignal(candidate) && !isFfmpegCompatibleSampleAes(candidate))
      return {
        supported: false,
        reason: "SAMPLE-AES signal needs player-resolved segments before download."
      };
    if (candidate.encryptionMethods?.length && !isDownloadableHlsEncryption(candidate))
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
  function normalizeAdaptiveTracks(value, expectedType, candidate) {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (track) => track && typeof track === "object" && isAcquirableAdaptiveTrack(candidate, track)
    ).slice(0, 24).map((track, index) => ({
      id: optionalString(track.id) || `${expectedType}-${index + 1}`,
      type: expectedType,
      sourceUrl: isYouTubeProviderResolvableTrack(candidate, track) ? null : requiredHttpUrl(
        track.sourceUrl || track.url,
        `candidate.${expectedType}Tracks[${index}].sourceUrl`
      ),
      mimeType: optionalString(track.mimeType),
      codecs: optionalString(track.codecs),
      itag: optionalString(track.itag),
      bandwidth: optionalFiniteNumber(track.bandwidth),
      averageBandwidth: optionalFiniteNumber(track.averageBandwidth),
      contentLength: optionalNonNegativeInteger(track.contentLength),
      width: optionalNonNegativeInteger(track.width || track.resolution?.width),
      height: optionalNonNegativeInteger(
        track.height || track.resolution?.height
      ),
      resolution: track.resolution && typeof track.resolution === "object" ? {
        width: optionalNonNegativeInteger(track.resolution.width),
        height: optionalNonNegativeInteger(track.resolution.height)
      } : null,
      qualityLabel: optionalString(track.qualityLabel),
      urlResolution: Object.values(ADAPTIVE_TRACK_RESOLUTION).includes(
        track.urlResolution
      ) ? track.urlResolution : "resolved",
      signatureCipher: optionalString(track.signatureCipher),
      muxed: track.muxed === true
    }));
  }
  function hasCurrentManifestHandoff(candidate) {
    return candidate.manifestHandoff?.mediaId === candidate.id && candidate.manifestHandoff?.manifestUrl === candidate.manifestUrl && Number(candidate.manifestHandoff?.expiresAt) > Date.now();
  }
  function isDownloadableHlsEncryption(candidate) {
    if (isFfmpegCompatibleSampleAes(candidate)) return true;
    const methods = candidate.encryptionMethods || [];
    const formats = candidate.encryptionKeyFormats || [];
    return methods.length > 0 && methods.every((method) => String(method).toUpperCase() === "AES-128") && formats.every((format) => String(format).toLowerCase() === "identity");
  }
  function drmPlaybackOnlyReason(candidate) {
    const state = candidate.drm === "confirmed" ? "confirmed" : "suspected";
    const system = candidate.drmSystem ? ` \xB7 ${formatDrmSystem(candidate.drmSystem)}` : "";
    return `DRM ${state}${system} \xB7 Playback only.`;
  }
  function customHlsPlaybackOnlyReason(candidate) {
    const format = (candidate.encryptionKeyFormats || []).map((value) => String(value || "").trim()).find((value) => value && value.toLowerCase() !== "identity");
    return `Custom protected HLS${format ? ` \xB7 ${format}` : ""} \xB7 Playback only.`;
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
  function finiteNumber(value, field) {
    const number = Number(value);
    if (!Number.isFinite(number))
      throw new Error(`[MediaDownload] ${field} must be finite.`);
    return number;
  }
  function nonNegativeInteger(value, field) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0)
      throw new Error(`[MediaDownload] ${field} must be non-negative.`);
    return number;
  }
  function optionalString(value) {
    return typeof value === "string" && value ? value : null;
  }
  function optionalFiniteNumber(value) {
    if (value === null || value === void 0) return null;
    return finiteNumber(value, "optional number");
  }
  function optionalNonNegativeInteger(value) {
    if (value === null || value === void 0) return null;
    return nonNegativeInteger(value, "optional integer");
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
    facts.push(connectionFact);
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
      local_processing: "Processing downloaded media\u2026"
    };
    return stages[job.progress?.stage] || "Checking media source\u2026";
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

  // src/media/resolution-diagnostics.js
  var MEDIA_RESOLUTION_STAGES = Object.freeze({
    NETWORK_OBSERVATION: "network_observation",
    MANIFEST_PROBE: "manifest_probe",
    CHILD_DISCOVERY: "child_discovery",
    CHILD_PROBE: "child_probe",
    SOURCE_MATCHING: "source_matching",
    PLAYER_DECRYPTION: "player_decryption",
    PLAYER_SEGMENT_RESOLUTION: "player_segment_resolution",
    DOWNLOAD_READY: "download_ready",
    PLAYBACK_ONLY: "playback_only"
  });
  var MEDIA_RESOLUTION_DIAGNOSTIC_STATES = Object.freeze({
    WAITING: "waiting",
    FAILED: "failed",
    UNHANDLED: "unhandled",
    READY: "ready",
    BLOCKED: "blocked"
  });
  var S = MEDIA_RESOLUTION_STAGES;
  var D = MEDIA_RESOLUTION_DIAGNOSTIC_STATES;
  var MEDIA_RESOLUTION_STAGE_CATALOG = Object.freeze({
    [S.NETWORK_OBSERVATION]: stage("Browser media request", "Catalog candidate"),
    [S.MANIFEST_PROBE]: stage("Manifest candidate", "Parsed manifest"),
    [S.CHILD_DISCOVERY]: stage(
      "Master or playback request",
      "Observed child playlist"
    ),
    [S.CHILD_PROBE]: stage("Observed child playlist", "Playable child stream"),
    [S.SOURCE_MATCHING]: stage(
      "Playable child stream + player context",
      "Selected media source"
    ),
    [S.PLAYER_DECRYPTION]: stage(
      "Encrypted manifest + player Blob",
      "Parsed plaintext manifest"
    ),
    [S.PLAYER_SEGMENT_RESOLUTION]: stage(
      "SAMPLE-AES candidate + player playback",
      "Resolved media segment sequence"
    ),
    [S.DOWNLOAD_READY]: stage("Selected media source", "Download plan input"),
    [S.PLAYBACK_ONLY]: stage("Protected media metadata", "Playback-only result")
  });
  function diagnoseMediaResolution(item, items = []) {
    const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
    const target = item.kind === "blob" && item.selectedMediaId ? byId.get(item.selectedMediaId) || item.resolvedStream || item : item;
    if (target.kind === "direct")
      return diagnostic(S.DOWNLOAD_READY, D.READY, "direct_ready", {
        message: "Download ready \xB7 direct media"
      });
    if (target.kind === "blob")
      return diagnostic(S.NETWORK_OBSERVATION, D.WAITING, "blob_source_missing", {
        message: "Network observation \xB7 Blob found \xB7 source request missing"
      });
    if (!["hls", "dash"].includes(target.kind))
      return diagnostic(S.NETWORK_OBSERVATION, D.UNHANDLED, "media_unhandled", {
        message: "Network observation \xB7 media type not handled"
      });
    if (hasStrongDrmEvidence(target))
      return diagnostic(S.PLAYBACK_ONLY, D.BLOCKED, "drm_playback_only", {
        message: "Playback only \xB7 DRM protected"
      });
    if (hasUnsupportedHlsKeyFormat(target))
      return diagnostic(
        S.PLAYBACK_ONLY,
        D.BLOCKED,
        "custom_hls_protection_playback_only",
        { message: "Playback only \xB7 custom HLS protection" }
      );
    if (target.probeStatus === "ready" && isWeakSampleAesSignal(target) && !isFfmpegCompatibleSampleAes(target))
      return diagnostic(
        S.PLAYER_SEGMENT_RESOLUTION,
        D.WAITING,
        "sample_aes_player_segments_pending",
        {
          message: "Player URL resolution \xB7 waiting for resolved media segments"
        }
      );
    if (target.kind === "dash") return diagnoseDash(target);
    if (target.probeSource === "decrypted_blob" && !(Number(target.manifestHandoff?.expiresAt) > Date.now()))
      return diagnostic(
        S.PLAYER_DECRYPTION,
        D.UNHANDLED,
        "decrypted_manifest_handoff_pending",
        {
          message: "Player decryption \xB7 manifest parsed \xB7 download handoff pending"
        }
      );
    if (target.resolutionStatus === "resolved" || target.probeStatus === "ready" && target.playlistType === "media" && target.streamType === "vod" && target.segmentCount > 0)
      return diagnostic(S.DOWNLOAD_READY, D.READY, "hls_ready", {
        message: "Download ready \xB7 HLS VOD resolved"
      });
    if (target.probeStatus === "unsupported")
      return diagnostic(
        S.MANIFEST_PROBE,
        D.UNHANDLED,
        "hls_manifest_unsupported",
        { message: "Manifest probe \xB7 HLS format not handled" }
      );
    const latestTargetProbe = latestProbeDiagnostic([target]);
    if (latestTargetProbe?.code?.startsWith("contextual_probe_")) {
      const described2 = describeProbeDiagnostic(latestTargetProbe);
      return diagnostic(S.MANIFEST_PROBE, described2.status, described2.code, {
        probeDiagnostic: latestTargetProbe,
        message: `Manifest probe \xB7 ${described2.message}`
      });
    }
    const children = findObservedChildren(target, items);
    const readyChildren = children.filter(isUsableChild);
    const failedChildren = children.filter(
      (candidate) => candidate.probeStatus === "failed"
    );
    const facts = {
      observedChildCount: children.length,
      readyChildCount: readyChildren.length,
      failedChildCount: failedChildren.length,
      masterProbeStatus: target.probeStatus || "discovered",
      masterProbeError: target.probeError || null
    };
    if (!children.length) {
      const masterFailure = formatProbeFailure(target);
      if (target.probeStatus !== "failed" && target.playlistType !== "master") {
        return diagnostic(S.MANIFEST_PROBE, D.WAITING, "hls_probe_pending", {
          ...facts,
          message: "Manifest probe \xB7 HLS response not parsed yet"
        });
      }
      return diagnostic(
        S.CHILD_DISCOVERY,
        target.probeStatus === "failed" ? D.FAILED : D.WAITING,
        target.probeStatus === "failed" ? "master_failed_child_not_observed" : "child_request_not_observed",
        {
          ...facts,
          message: `Child discovery \xB7 0 child playlists${masterFailure ? ` \xB7 ${masterFailure}` : ""}`
        }
      );
    }
    if (readyChildren.length && !target.selectedMediaId) {
      return diagnostic(S.SOURCE_MATCHING, D.WAITING, "child_ready_not_matched", {
        ...facts,
        message: `Source matching \xB7 ${readyChildren.length} child ready \xB7 not linked to player`
      });
    }
    const latestChildProbe = latestProbeDiagnostic(children);
    if (latestChildProbe) {
      const described2 = describeProbeDiagnostic(latestChildProbe);
      return diagnostic(S.CHILD_PROBE, described2.status, described2.code, {
        ...facts,
        probeDiagnostic: latestChildProbe,
        message: `Child probe \xB7 ${described2.message}`
      });
    }
    if (failedChildren.length === children.length) {
      return diagnostic(S.CHILD_PROBE, D.FAILED, "child_probe_failed", {
        ...facts,
        message: `Child probe \xB7 ${failedChildren.length} failed \xB7 ${formatProbeFailure(failedChildren[0]) || "request rejected"}`
      });
    }
    return diagnostic(S.CHILD_PROBE, D.WAITING, "child_observed_probe_pending", {
      ...facts,
      message: `Child probe \xB7 ${children.length} observed \xB7 manifest not parsed`
    });
  }
  function diagnoseDash(item) {
    if (item.probeStatus === "failed")
      return diagnostic(S.MANIFEST_PROBE, D.FAILED, "dash_probe_failed", {
        message: `Manifest probe \xB7 DASH failed${item.probeError ? ` \xB7 ${item.probeError}` : ""}`
      });
    if (item.probeStatus !== "ready")
      return diagnostic(S.MANIFEST_PROBE, D.WAITING, "dash_probe_pending", {
        message: "Manifest probe \xB7 DASH tracks not parsed"
      });
    return diagnostic(S.DOWNLOAD_READY, D.READY, "dash_ready", {
      message: "Download ready \xB7 DASH tracks resolved"
    });
  }
  function findObservedChildren(parent, items) {
    const explicitIds = new Set(parent.childManifestIds || []);
    return items.filter((candidate) => {
      if (candidate.kind !== "hls" || candidate.id === parent.id) return false;
      if (explicitIds.has(candidate.id) || candidate.parentManifestIds?.includes(parent.id))
        return true;
      if (!sameFrame(parent, candidate)) return false;
      const parentAt = parent.firstSeenAt || parent.lastSeenAt;
      const childAt = candidate.firstSeenAt || candidate.lastSeenAt;
      return Number.isFinite(parentAt) && Number.isFinite(childAt) && Math.abs(parentAt - childAt) <= 6e4;
    });
  }
  function isUsableChild(item) {
    return item.probeStatus === "ready" && item.playlistType === "media" && ["vod", "live"].includes(item.streamType) && (item.segmentCount > 0 || item.partialSegmentCount > 0);
  }
  function sameFrame(left, right) {
    return Number.isInteger(left.frameId) && Number.isInteger(right.frameId) && left.frameId === right.frameId;
  }
  function formatProbeFailure(item) {
    if (item.probeError === "manifest_http_403") return "master probe 403";
    if (item.probeError === "fallback_fetch_blocked")
      return "probe blocked by page/CORS";
    if (item.probeStatus === "failed") return "manifest probe failed";
    return null;
  }
  function latestProbeDiagnostic(items) {
    return items.flatMap((item) => item.probeDiagnostics || [item.probeDiagnostic]).filter(Boolean).sort((left, right) => (right.observedAt || 0) - (left.observedAt || 0))[0];
  }
  function describeProbeDiagnostic(diagnostic2) {
    const code = diagnostic2.code || "probe_status_unknown";
    if (code === "iframe_probe_scheduled")
      return described(D.WAITING, code, "scheduled in player frame");
    if (code === "manifest_fetch_dispatched")
      return described(D.WAITING, code, "request sent \xB7 waiting for response");
    if (code === "contextual_probe_prepared")
      return described(
        D.WAITING,
        code,
        "Referer/Origin prepared \xB7 retry starting"
      );
    if (code === "contextual_manifest_fetch_dispatched")
      return described(
        D.WAITING,
        code,
        "contextual request sent \xB7 waiting for response"
      );
    if (code.startsWith("contextual_probe_"))
      return described(
        D.FAILED,
        code,
        `context setup failed \xB7 ${code.slice("contextual_probe_".length)}`
      );
    if (code === "content_duplicate")
      return described(D.WAITING, code, "duplicate schedule skipped");
    if (code === "probe_gate_duplicate")
      return described(D.WAITING, code, "probe already in progress or completed");
    if (code === "manifest_probe_timeout")
      return described(D.FAILED, code, "timed out after 10s");
    if (/^manifest_http_\d+$/.test(code))
      return described(
        D.FAILED,
        code,
        `HTTP ${diagnostic2.httpStatus || code.split("_").at(-1)}`
      );
    if (code === "fallback_fetch_blocked")
      return described(D.FAILED, code, "request blocked by page/CORS");
    if (code === "manifest_body_received")
      return described(
        D.WAITING,
        code,
        `${formatBodySize(diagnostic2.bodyBytes)} body received \xB7 ${diagnostic2.bodyFormat || "unknown"} format \xB7 parser pending`
      );
    if (code === "manifest_parsed_zero_segments")
      return described(
        D.UNHANDLED,
        code,
        `${formatBodySize(diagnostic2.bodyBytes)} ${diagnostic2.bodyFormat || "unknown"} parsed \xB7 0 segments`
      );
    if (code === "manifest_parsed_no_stream")
      return described(
        D.UNHANDLED,
        code,
        `${formatBodySize(diagnostic2.bodyBytes)} body parsed \xB7 no playable stream`
      );
    if (code === "manifest_unsupported")
      return described(D.UNHANDLED, code, "body received \xB7 format unsupported");
    if (code === "manifest_parsed")
      return described(
        D.WAITING,
        code,
        `${diagnostic2.playlistType || "manifest"} parsed \xB7 ${diagnostic2.segmentCount || 0} segments \xB7 matching pending`
      );
    if (code === "decrypted_manifest_blob_observed")
      return described(
        D.WAITING,
        code,
        `player decrypted ${diagnostic2.bodyFormat || "manifest"} \xB7 parser pending`
      );
    if (code === "decrypted_manifest_parsed")
      return described(
        D.READY,
        code,
        `player-decrypted ${diagnostic2.playlistType || "manifest"} parsed \xB7 ${diagnostic2.segmentCount || 0} segments`
      );
    if (code === "decrypted_manifest_zero_segments")
      return described(
        D.UNHANDLED,
        code,
        "player-decrypted manifest \xB7 0 segments"
      );
    if (code === "decrypted_manifest_no_stream")
      return described(
        D.UNHANDLED,
        code,
        "player-decrypted manifest \xB7 no playable stream"
      );
    if (code === "decrypted_manifest_unsupported")
      return described(D.UNHANDLED, code, "player-decrypted format unsupported");
    if (code === "decrypted_manifest_parse_failed")
      return described(D.FAILED, code, "player-decrypted manifest parse failed");
    return described(
      diagnostic2.phase === "failed" ? D.FAILED : D.WAITING,
      code,
      code.replaceAll("_", " ")
    );
  }
  function described(status, code, message) {
    return { status, code, message };
  }
  function formatBodySize(bytes) {
    if (!Number.isFinite(bytes)) return "Unknown-size";
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  function diagnostic(stage2, status, code, facts = {}) {
    const contract = MEDIA_RESOLUTION_STAGE_CATALOG[stage2];
    return Object.freeze({
      stage: stage2,
      status,
      code,
      input: contract.input,
      output: contract.output,
      ...facts
    });
  }
  function stage(input, output) {
    return Object.freeze({ input, output });
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
        canDownloadDecryptedHls: helper.canDownloadDecryptedHls,
        canSelectContainer: helper.canSelectContainer,
        canDownloadDash: helper.canDownloadDash,
        canDownloadAdaptive: helper.canDownloadAdaptive,
        canResolveYouTubePlayerJs: helper.canResolveYouTubePlayerJs,
        canResolveYouTubeProviderFormats: helper.canResolveYouTubeProviderFormats,
        error: helper.error
      } : null,
      items: items.map(mediaRenderFacts)
    });
  }
  function selectVisibleMediaItems(items = [], maximum = 8) {
    const diagnosedItems = items.map((item) => ({
      ...item,
      resolutionDiagnostic: diagnoseMediaResolution(item, items)
    }));
    const blobResolvedSourceIds = new Set(
      diagnosedItems.filter((item) => item.kind === "blob" && item.selectedMediaId).flatMap((item) => [
        item.selectedMediaId,
        ...item.resolvedMediaIds || [],
        ...item.blobTrace?.candidateIds || []
      ]).filter(Boolean)
    );
    for (const blob of diagnosedItems.filter(
      (item) => item.kind === "blob" && item.selectedMediaId
    )) {
      for (const source of diagnosedItems) {
        if (source.kind !== "blob" && samePlaybackFrame(blob, source) && (source.selectedMediaId === blob.selectedMediaId || source.resolvedMediaIds?.includes(blob.selectedMediaId) || (blob.resolvedMediaIds || []).some(
          (id) => source.resolvedMediaIds?.includes(id)
        ))) {
          blobResolvedSourceIds.add(source.id);
        }
      }
    }
    const sorted = [...diagnosedItems].sort(
      (left, right) => (right.firstSeenAt || 0) - (left.firstSeenAt || 0) || String(left.id || "").localeCompare(String(right.id || ""))
    );
    const visible = [];
    const adaptivePages = new Set(
      diagnosedItems.filter((item) => item.kind === "adaptive").map((item) => item.pageUrl)
    );
    const blobGroups = /* @__PURE__ */ new Map();
    const resolvedBlobGroupKeys = resolvedBlobGroupKeysByPage(diagnosedItems);
    for (const item of sorted) {
      if (item.kind === "blob" && adaptivePages.has(item.pageUrl)) continue;
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
      if (!["direct", "hls", "dash", "adaptive"].includes(candidate.kind))
        continue;
      candidates.set(candidate.id, candidate);
    }
    const availability = [...candidates.values()].map((candidate) => ({
      candidate,
      ...getMediaDownloadAvailability(candidate)
    }));
    const diagnostic2 = mediaDownloadDiagnostic(items, availability);
    return {
      candidateCount: availability.length,
      downloadableCount: availability.filter((item) => item.supported).length,
      drmBlockedCount: availability.filter(
        (item) => String(item.reason || "").includes("DRM")
      ).length,
      unavailableCount: availability.filter((item) => !item.supported).length,
      ...diagnostic2 ? {
        diagnosticCode: diagnostic2.code,
        diagnosticMessage: diagnostic2.message
      } : {}
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
      if (downloadState.diagnosticMessage) return downloadState.diagnosticMessage;
      if (downloadState.drmBlockedCount)
        return "Media found \xB7 DRM stream is playback only.";
      return "Media found \xB7 no downloadable source is ready yet.";
    }
    if (helper.status === "permission_required")
      return "Media found \xB7 allow Media Helper connection to download.";
    if (helper.status === "not_installed")
      return "Media found \xB7 Media Helper is not installed.";
    if (helper.status === "ready" && (helper.canDownloadDirect || helper.canDownloadHls || helper.canDownloadDash || helper.canDownloadAdaptive))
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
  function mediaDownloadDiagnostic(items, availability) {
    const adaptive = items.find(
      (item) => item.kind === "adaptive" && item.provider === "youtube"
    );
    if (adaptive) {
      const acquisitionDiagnostic = adaptive.acquisitionDiagnostic;
      const acquisitionMessage = youtubeAcquisitionMessage(acquisitionDiagnostic);
      const videoCount = (adaptive.variants || []).filter(
        (track) => isAcquirableAdaptiveTrack(adaptive, track)
      ).length;
      const audioCount = (adaptive.audioTracks || []).filter(
        (track) => isAcquirableAdaptiveTrack(adaptive, track)
      ).length;
      const muxedVideoCount = (adaptive.variants || []).filter(
        (track) => track.muxed === true && isAcquirableAdaptiveTrack(adaptive, track)
      ).length;
      if (muxedVideoCount && ["n_transform_pending", "signature_cipher_pending"].includes(
        acquisitionDiagnostic?.stage
      ) && !adaptive.playerUrl)
        return {
          code: "youtube_player_js_url_missing",
          message: "YouTube muxed track found \xB7 waiting for the Player JS URL required to resolve it."
        };
      if (!videoCount && !audioCount && acquisitionMessage)
        return {
          code: `youtube_${acquisitionDiagnostic.stage}`,
          message: acquisitionMessage
        };
      if (!videoCount && !audioCount)
        return {
          code: "youtube_tracks_empty",
          message: "YouTube player found \xB7 no resolved video or audio track was captured."
        };
      if (!videoCount)
        return {
          code: "youtube_video_pending",
          message: `YouTube audio captured (${audioCount}) \xB7 waiting for a video track.`
        };
      if (!audioCount && !muxedVideoCount)
        return {
          code: "youtube_audio_pending",
          message: `YouTube video captured (${videoCount}) \xB7 waiting for an audio track.`
        };
      const entry = availability.find(
        (item) => item.candidate.id === adaptive.id
      );
      if (entry && !entry.supported)
        return {
          code: "youtube_tracks_unavailable",
          message: `YouTube tracks captured \xB7 ${entry.reason}`
        };
    }
    const youtubeBlob = items.find(
      (item) => item.kind === "blob" && isYouTubeUrl(item.pageUrl)
    );
    if (youtubeBlob)
      return {
        code: "youtube_network_track_missing",
        message: "YouTube Blob player found \xB7 no googlevideo playback URL was visible to webRequest, page hooks, or Resource Timing."
      };
    return null;
  }
  function formatMediaDetails(item) {
    if (item.kind === "blob" && item.selectedMediaId)
      return resolvedBlobDetails(item);
    if (item.kind === "blob")
      return item.resolutionDiagnostic?.message || (isYouTubeUrl(item.pageUrl) ? "Network observation \xB7 Blob found \xB7 webRequest/page hook/resource timing source missing" : null) || (item.relatedCount > 1 ? `${item.relatedCount} Blob signals \xB7 tracing source buffers` : item.blobTrace?.appendCount ? `${item.blobTrace.appendCount} buffers observed \xB7 matching source` : "Blob signal \xB7 tracing source buffers");
    if (item.kind === "direct") return "Direct video file";
    if (item.kind === "adaptive") return adaptiveDetails(item);
    if (item.kind === "dash") return dashDetails(item);
    if (item.kind !== "hls") return "Media source found";
    if (item.resolvedStream && item.selectedMediaId && item.selectedMediaId !== item.id)
      return resolvedHlsDetails(item);
    if (item.probeStatus === "failed")
      return item.resolutionDiagnostic?.message || "Manifest probe \xB7 HLS request failed";
    if (item.probeStatus === "unsupported")
      return "HLS \xB7 manifest format not supported";
    if (item.probeStatus !== "ready")
      return item.resolutionDiagnostic?.message || "Manifest probe \xB7 HLS response not parsed yet";
    if (item.playlistType === "unknown")
      return item.resolutionDiagnostic?.message || "HLS endpoint \xB7 watching for a playable stream";
    const facts = [];
    if (item.probeSource === "decrypted_blob") facts.push("Player decrypted");
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
  function isYouTubeUrl(value) {
    try {
      const hostname = new URL(value).hostname.toLowerCase();
      return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
    } catch {
      return false;
    }
  }
  function formatMediaName(item) {
    const sourceUrl = item.resolvedStream?.manifestUrl || item.resolvedStream?.sourceUrl || item.manifestUrl || item.sourceUrl || "";
    try {
      const url = new URL(sourceUrl);
      if (item.kind === "adaptive")
        return readableMediaTitle(item.title) || (item.provider === "youtube" ? "YouTube video" : "Adaptive video");
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
    if (stream.probeSource === "decrypted_blob") facts.push("Player decrypted");
    if (item.resolutionDiagnostic?.message && !["ready", "blocked"].includes(item.resolutionDiagnostic.status)) {
      facts.push(item.resolutionDiagnostic.message);
      return facts.join(" \xB7 ");
    }
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
  function adaptiveDetails(item) {
    const facts = [item.provider === "youtube" ? "YouTube" : "Adaptive media"];
    const videos = (item.variants || []).filter(
      (track) => isAcquirableAdaptiveTrack(item, track)
    );
    const audio = (item.audioTracks || []).filter(
      (track) => isAcquirableAdaptiveTrack(item, track)
    );
    const muxed = videos.some((track) => track.muxed === true);
    const acquisition = item.acquisitionDiagnostic;
    if (!videos.length && !audio.length && acquisition) {
      facts.push(playerAcquisitionLabel(acquisition));
      if (acquisition.descriptorCount)
        facts.push(`${acquisition.descriptorCount} format descriptors`);
      facts.push("direct track URLs unavailable");
      return facts.join(" \xB7 ");
    }
    if (videos.length) {
      const best = [...videos].sort(compareVariantQuality)[0];
      facts.push(
        best.resolution?.height ? `${best.resolution.height}p` : `${videos.length} video track${videos.length === 1 ? "" : "s"}`
      );
    } else {
      facts.push("waiting for video track");
    }
    facts.push(
      audio.length ? `${audio.length} audio` : muxed ? "audio included" : "waiting for audio track"
    );
    if (Number.isFinite(item.duration) && item.duration > 0)
      facts.push(formatDuration2(item.duration));
    if (acquisition?.stage === "n_transform_pending")
      facts.push("Helper resolves n");
    if (acquisition?.stage === "signature_cipher_pending")
      facts.push("Helper resolves signature");
    if (hasYouTubeProviderPendingTracks(item))
      facts.push("Helper resolves qualities");
    return facts.join(" \xB7 ");
  }
  function youtubeAcquisitionMessage(diagnostic2) {
    if (!diagnostic2?.stage) return null;
    const descriptors = diagnostic2.descriptorCount ? ` \xB7 ${diagnostic2.descriptorCount} format descriptors` : "";
    switch (diagnostic2.stage) {
      case "sabr_resolver_pending":
        return `YouTube player response found \xB7 SABR endpoint observed${descriptors} \xB7 resolver pending.`;
      case "n_transform_pending":
        return `YouTube player response found${descriptors} \xB7 n parameter transform pending.`;
      case "signature_cipher_pending":
        return `YouTube player response found${descriptors} \xB7 signature decipher pending.`;
      case "format_urls_missing":
        return `YouTube player response found${descriptors} \xB7 format URLs are not exposed.`;
      case "streaming_data_missing":
        return "YouTube player response found \xB7 streamingData is missing.";
      case "playability_blocked":
        return `YouTube playback is unavailable (${diagnostic2.playabilityStatus || "unknown"}).`;
      default:
        return null;
    }
  }
  function playerAcquisitionLabel(diagnostic2) {
    switch (diagnostic2.stage) {
      case "sabr_resolver_pending":
        return "Player response \xB7 SABR";
      case "n_transform_pending":
        return "Player response \xB7 n transform pending";
      case "signature_cipher_pending":
        return "Player response \xB7 signature pending";
      case "playability_blocked":
        return `Playback ${diagnostic2.playabilityStatus || "blocked"}`;
      default:
        return "Player response";
    }
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
    if (hasStrongDrmEvidence(item)) {
      facts.push(
        `DRM suspected${item.drmSystem ? ` \xB7 ${formatDrmSystem2(item.drmSystem)}` : ""}`,
        "Playback only"
      );
      return;
    }
    if (hasUnsupportedHlsKeyFormat(item)) {
      const format = item.encryptionKeyFormats.map((value) => String(value || "").trim()).find((value) => value && value.toLowerCase() !== "identity");
      facts.push(
        `Custom protected HLS${format ? ` \xB7 ${format}` : ""}`,
        "Playback only"
      );
      return;
    }
    if (isWeakSampleAesSignal(item)) {
      facts.push(
        isFfmpegCompatibleSampleAes(item) ? "Encrypted HLS \xB7 SAMPLE-AES \xB7 Helper compatible" : "SAMPLE-AES signal \xB7 DRM not confirmed"
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
      provider: item.provider,
      acquisitionProfile: item.acquisitionProfile,
      probeStatus: item.probeStatus,
      probeError: item.probeError,
      probeDiagnostic: item.probeDiagnostic,
      playlistType: item.playlistType,
      streamType: item.streamType,
      duration: item.duration,
      resolution: item.resolution,
      bandwidth: item.bandwidth,
      averageBandwidth: item.averageBandwidth,
      segmentCount: item.segmentCount,
      partialSegmentCount: item.partialSegmentCount,
      skippedSegmentCount: item.skippedSegmentCount,
      lowLatency: item.lowLatency,
      mediaSequence: item.mediaSequence,
      discontinuitySequence: item.discontinuitySequence,
      revisionId: item.revisionId,
      probeSource: item.probeSource,
      manifestEnvelope: item.manifestEnvelope,
      manifestHandoff: item.manifestHandoff,
      relatedCount: item.relatedCount,
      parentManifestIds: item.parentManifestIds,
      childManifestIds: item.childManifestIds,
      resolutionStatus: item.resolutionStatus,
      resolutionStrategy: item.resolutionStrategy,
      resolutionConfidence: item.resolutionConfidence,
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
      subtitles: item.subtitles,
      resolutionDiagnostic: item.resolutionDiagnostic
    };
  }
  function samePlaybackFrame(left, right) {
    if (Number.isInteger(left.frameId) && Number.isInteger(right.frameId))
      return left.frameId === right.frameId;
    return Boolean(
      left.frameUrl && right.frameUrl && left.frameUrl === right.frameUrl
    );
  }

  // src/media/storage-keys.js
  var MEDIA_CATALOG_SESSION_PREFIX = "adsfriendly.mediaCatalog.";
  function mediaCatalogSessionKey(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new Error("[MediaCatalog] A valid tab ID is required.");
    }
    return `${MEDIA_CATALOG_SESSION_PREFIX}${tabId}`;
  }

  // src/media/deep-inspection.js
  var MEDIA_DEEP_INSPECTION_STRATEGIES = Object.freeze({
    EARLY_MSE_LINEAGE: "early_mse_lineage"
  });
  var MIN_APPEND_COUNT = 3;
  var MIN_APPENDED_BYTES = 256 * 1024;
  var RETRYABLE_REASONS = /* @__PURE__ */ new Set([
    "Manifest is not ready.",
    "HLS endpoint has not exposed a media playlist yet.",
    "HLS media playlist is waiting for segments."
  ]);
  function evaluateMediaDeepInspection(item, items = []) {
    if (item?.kind !== "blob") return closed("not_blob");
    const trace = item.blobTrace;
    if (!trace) return closed("no_mse_trace");
    const related = relatedCandidates(item, items);
    const protectedCandidate = [item, ...related].find(isProtectedMedia);
    if (protectedCandidate) return blocked("protected_media");
    if (!["interactive", "complete"].includes(trace.observerDocumentState)) {
      return closed(
        trace.observerDocumentState === "loading" ? "observer_already_early" : "observer_start_unknown"
      );
    }
    if (trace.appendCount < MIN_APPEND_COUNT || trace.totalAppendedBytes < MIN_APPENDED_BYTES) {
      return closed("playback_not_proven");
    }
    if (!trace.sourceUrls?.length || !trace.candidateIds?.length) {
      return closed("source_lineage_not_proven");
    }
    const retryable = related.find((candidate) => {
      if (candidate.kind !== "hls") return false;
      const availability = getMediaDownloadAvailability(candidate);
      return !availability.supported && RETRYABLE_REASONS.has(availability.reason);
    });
    if (!retryable) return closed("no_known_early_hook_gap");
    return Object.freeze({
      eligible: true,
      blocked: false,
      code: "observer_started_late",
      confidence: 0.95,
      strategy: MEDIA_DEEP_INSPECTION_STRATEGIES.EARLY_MSE_LINEAGE,
      mediaId: retryable.id,
      evidence: Object.freeze({
        appendCount: trace.appendCount,
        totalAppendedBytes: trace.totalAppendedBytes,
        sourceCount: trace.sourceUrls.length,
        observerDocumentState: trace.observerDocumentState
      })
    });
  }
  function relatedCandidates(item, items) {
    const ids = /* @__PURE__ */ new Set([
      item.selectedMediaId,
      ...item.resolvedMediaIds || [],
      ...item.blobTrace?.candidateIds || []
    ]);
    ids.delete(null);
    ids.delete(void 0);
    ids.delete(item.id);
    return items.filter((candidate) => ids.has(candidate.id));
  }
  function isProtectedMedia(candidate) {
    if (hasStrongDrmEvidence(candidate)) return true;
    if (hasUnsupportedHlsKeyFormat(candidate)) return true;
    if (candidate?.drm && candidate.drm !== "none") return true;
    if (candidate?.encryptionMethods?.length) return true;
    if (candidate?.encryptionScheme && !["none", "unknown"].includes(candidate.encryptionScheme)) {
      return true;
    }
    const eme = candidate?.eme;
    return Boolean(
      eme?.keySystems?.length || eme?.keyStatuses?.length || eme?.licenseStatus
    );
  }
  function closed(code) {
    return Object.freeze({ eligible: false, blocked: false, code });
  }
  function blocked(code) {
    return Object.freeze({ eligible: false, blocked: true, code });
  }

  // src/media/deep-inspection-profiles.js
  var MEDIA_DEEP_INSPECTION_PROFILES_KEY = "mediaDeepInspectionProfiles";
  var PENDING_TTL_MS = 15 * 60 * 1e3;
  var MAX_PROFILES = 64;
  async function stageMediaDeepInspectionProfile(storage, { pageUrl, frameUrl, suggestion, now = Date.now() }) {
    if (!suggestion?.eligible || suggestion.confidence < 0.9 || !Object.values(MEDIA_DEEP_INSPECTION_STRATEGIES).includes(
      suggestion.strategy
    ) || typeof suggestion.mediaId !== "string" || !suggestion.mediaId) {
      throw new Error("Deep media inspection needs verified technical evidence.");
    }
    const topOrigin = httpOrigin(pageUrl);
    const frameOrigin = httpOrigin(frameUrl || pageUrl);
    if (!topOrigin || !frameOrigin) {
      throw new Error("Deep media inspection needs HTTP page and frame origins.");
    }
    const profiles = await readProfiles(storage, now);
    const id = `${topOrigin}|${frameOrigin}|${suggestion.strategy}`;
    const existing = profiles.find((profile) => profile.id === id);
    const next = {
      id,
      topOrigin,
      frameOrigin,
      strategy: suggestion.strategy,
      mediaId: suggestion.mediaId,
      state: "pending",
      evidenceCode: suggestion.code,
      confidence: suggestion.confidence,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt: now + PENDING_TTL_MS,
      lastVerifiedAt: existing?.lastVerifiedAt || null
    };
    const merged = [
      next,
      ...profiles.filter((profile) => profile.id !== id)
    ].slice(0, MAX_PROFILES);
    await storage.set({ [MEDIA_DEEP_INSPECTION_PROFILES_KEY]: merged });
    return next;
  }
  async function verifyMediaDeepInspectionProfiles(storage, { pageUrl, frameUrls = [], successfulMediaIds = [], now = Date.now() }) {
    const topOrigin = httpOrigin(pageUrl);
    if (!topOrigin) return [];
    const allowedFrames = new Set(
      [pageUrl, ...frameUrls].map(httpOrigin).filter(Boolean)
    );
    const successful = new Set(successfulMediaIds.filter(Boolean));
    const profiles = await readProfiles(storage, now);
    let changed = false;
    const next = profiles.map((profile) => {
      if (profile.state !== "pending" || profile.topOrigin !== topOrigin || !allowedFrames.has(profile.frameOrigin) || !successful.has(profile.mediaId)) {
        return profile;
      }
      changed = true;
      return {
        ...profile,
        state: "verified",
        updatedAt: now,
        expiresAt: null,
        lastVerifiedAt: now
      };
    });
    if (changed)
      await storage.set({ [MEDIA_DEEP_INSPECTION_PROFILES_KEY]: next });
    return next;
  }
  async function readProfiles(storage, now) {
    const snapshot = await storage.get(MEDIA_DEEP_INSPECTION_PROFILES_KEY);
    const raw = Array.isArray(snapshot[MEDIA_DEEP_INSPECTION_PROFILES_KEY]) ? snapshot[MEDIA_DEEP_INSPECTION_PROFILES_KEY] : [];
    const profiles = raw.filter(
      (profile) => profile && typeof profile.id === "string" && ["pending", "verified"].includes(profile.state) && (profile.state === "verified" || Number(profile.expiresAt) > now)
    );
    if (profiles.length !== raw.length)
      await storage.set({ [MEDIA_DEEP_INSPECTION_PROFILES_KEY]: profiles });
    return profiles.slice(0, MAX_PROFILES);
  }
  function httpOrigin(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
    } catch {
      return null;
    }
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
    canDownloadDecryptedHls: false,
    canDownloadDash: false,
    canDownloadAdaptive: false,
    canResolveYouTubePlayerJs: false,
    canResolveYouTubeProviderFormats: false,
    canSelectContainer: false
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
      if (downloadState.downloadableCount > 0) {
        await verifyMediaDeepInspectionProfiles(chrome.storage.local, {
          pageUrl: tab.url,
          frameUrls: items.map((item) => item.frameUrl).filter(Boolean),
          successfulMediaIds: items.filter((item) => getMediaDownloadAvailability(item).supported).map((item) => item.id)
        }).catch(() => {
        });
      }
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
    const actions = document.createElement("div");
    actions.className = "media-actions";
    if (["direct", "hls", "dash", "adaptive"].includes(item.kind) || item.kind === "blob" && item.selectedMediaId) {
      const downloadItem = itemsById.get(item.selectedMediaId) || item;
      actions.append(createMediaDownloadControl(item, downloadItem, tab, helper));
    }
    const debugMediaId = debugCaptureMediaId(item);
    if (tab && debugMediaId)
      actions.append(createManifestSaveButton(item, tab, debugMediaId));
    const inspection = evaluateMediaDeepInspection(item, [...itemsById.values()]);
    if (tab && inspection.eligible) {
      actions.append(createMediaInspectionReloadButton(item, tab, inspection));
    }
    if (actions.childElementCount) row.append(actions);
    return row;
  }
  function createMediaInspectionReloadButton(item, tab, inspection) {
    const button = document.createElement("button");
    button.className = "media-download media-inspection-reload";
    button.textContent = "Reload & analyze";
    button.title = "Playback succeeded, but the observer started after the player. Reload to capture the standard source from document start.";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Reloading\u2026";
      try {
        await stageMediaDeepInspectionProfile(chrome.storage.local, {
          pageUrl: tab.url,
          frameUrl: item.frameUrl || tab.url,
          suggestion: inspection
        });
        await chrome.tabs.reload(tab.id);
        window.close();
      } catch (error) {
        button.disabled = false;
        button.textContent = "Retry reload";
        button.title = error?.message || String(error);
      }
    });
    return button;
  }
  function debugCaptureMediaId(item) {
    const handoff = item.resolvedStream?.manifestHandoff || item.manifestHandoff;
    if (Number(handoff?.expiresAt) > Date.now()) return null;
    const diagnostic2 = item.resolutionDiagnostic?.probeDiagnostic || item.probeDiagnostic;
    return [
      "manifest_parsed_no_stream",
      "manifest_parsed_zero_segments",
      "manifest_unsupported",
      "manifest_parse_failed",
      "decrypted_manifest_no_stream",
      "decrypted_manifest_zero_segments",
      "decrypted_manifest_unsupported",
      "decrypted_manifest_parse_failed"
    ].includes(diagnostic2?.code) ? diagnostic2.mediaId : null;
  }
  function createManifestSaveButton(item, tab, mediaId) {
    const button = document.createElement("button");
    button.className = "media-download media-debug-save";
    button.textContent = "Save manifest";
    button.title = "Save the temporary unresolved manifest locally for debugging.";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Saving\u2026";
      try {
        const response = await chrome.runtime.sendMessage({
          type: "GET_MEDIA_DEBUG_MANIFEST",
          tabId: tab.id,
          mediaId
        });
        if (response?.status !== "found" || !response.capture?.body)
          throw new Error("Temporary manifest expired. Reload the video page.");
        saveDebugManifestFile(response.capture, item);
        button.textContent = "Saved";
      } catch (error) {
        button.disabled = false;
        button.textContent = "Retry save";
        button.title = error?.message || String(error);
      }
    });
    return button;
  }
  function saveDebugManifestFile(capture, item) {
    const extension = capture.kind === "dash" ? "mpd" : "m3u8";
    const hostname = safeHostname(capture.manifestUrl) || "manifest";
    const timestamp = new Date(capture.capturedAt || Date.now()).toISOString().replaceAll(":", "-");
    const filename = sanitizeFilename(
      `adsfriendly-debug-${hostname}-${item.id}-${timestamp}.${extension}`
    );
    const blob = new Blob([capture.body], {
      type: capture.kind === "dash" ? "application/dash+xml" : "application/vnd.apple.mpegurl"
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1e4);
  }
  function safeHostname(value) {
    try {
      return new URL(value).hostname;
    } catch {
      return null;
    }
  }
  function sanitizeFilename(value) {
    return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 180);
  }
  function createMediaDownloadControl(item, downloadItem, tab, helper) {
    const availability = getMediaDownloadAvailability(downloadItem);
    const control = document.createElement("div");
    control.className = "media-download-control";
    const profiles = getMediaDownloadProfiles(downloadItem, {
      canSelectContainer: helper.canSelectContainer === true
    });
    const profileSelect = document.createElement("select");
    profileSelect.className = "media-download-profile";
    profileSelect.title = "Output format";
    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.label;
      option.title = profile.description;
      profileSelect.append(option);
    }
    profileSelect.disabled = !availability.supported || profiles.length < 2;
    const qualityOptions = getMediaVideoQualityOptions(downloadItem);
    const qualitySelect = document.createElement("select");
    qualitySelect.className = "media-download-profile";
    qualitySelect.title = "Video quality";
    const automaticQuality = document.createElement("option");
    automaticQuality.value = "";
    automaticQuality.textContent = "Quality \xB7 Auto (best)";
    qualitySelect.append(automaticQuality);
    for (const quality of qualityOptions) {
      const option = document.createElement("option");
      option.value = quality.id;
      option.textContent = quality.label;
      qualitySelect.append(option);
    }
    qualitySelect.disabled = !availability.supported || !qualityOptions.length;
    const estimateLabel = document.createElement("span");
    estimateLabel.className = "media-download-estimate";
    const updateEstimate = () => {
      const estimate = getMediaDownloadEstimate(downloadItem, item, {
        videoTrackId: qualitySelect.value || null
      });
      estimateLabel.textContent = formatDownloadEstimate(estimate);
      estimateLabel.title = formatDownloadEstimateTitle(estimate);
    };
    qualitySelect.addEventListener("change", updateEstimate);
    updateEstimate();
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
          connections: settings?.mediaDownloadConnections ?? 8,
          output: {
            profileId: profileSelect.value || profiles[0]?.id,
            videoTrackId: qualitySelect.value || null
          }
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
    if (availability.supported) control.append(estimateLabel);
    if (availability.supported && downloadItem.kind === "adaptive")
      control.append(qualitySelect);
    if (availability.supported && profiles.length) control.append(profileSelect);
    control.append(button);
    return control;
  }
  function formatDownloadEstimate(estimate) {
    const quality = estimate.resolution?.height ? `${estimate.resolution.height}p` : "Source quality";
    const size = estimate.estimatedBytes ? `Est. ${formatBytes(estimate.estimatedBytes)}` : "Size unavailable";
    return `${quality} \xB7 ${size}`;
  }
  function formatDownloadEstimateTitle(estimate) {
    if (!estimate.estimatedBytes) {
      return "The manifest does not expose enough bitrate data to estimate size before download.";
    }
    return "Estimated from manifest bitrate and duration. Final file size may differ.";
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
    if (item.kind === "hls")
      return helper.canDownloadHls === true && (item.probeSource !== "decrypted_blob" || helper.canDownloadDecryptedHls === true);
    if (item.kind === "adaptive")
      return helper.canDownloadAdaptive === true && (item.acquisitionProfile !== "youtube_player_js_challenge" || helper.canResolveYouTubePlayerJs === true) && (!hasYouTubeProviderPendingTracks(item) || helper.canResolveYouTubeProviderFormats === true);
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
      canDownloadDecryptedHls: false,
      canDownloadDash: false,
      canDownloadAdaptive: false,
      canResolveYouTubePlayerJs: false,
      canResolveYouTubeProviderFormats: false,
      canSelectContainer: false,
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
    const errorDetails = document.createElement("pre");
    errorDetails.className = "media-job-error";
    errorDetails.hidden = true;
    copy.append(label, detail);
    row.append(copy, actions, errorDetails);
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
    const errorDetails = row.querySelector(".media-job-error");
    const hasError = job.status === "failed" && Boolean(job.error);
    const errorExpanded = hasError && row.dataset.errorExpanded === "true";
    errorDetails.textContent = hasError ? job.error : "";
    errorDetails.hidden = !errorExpanded;
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
    if (hasError) {
      const toggle = createLocalMediaJobAction(
        errorExpanded ? "Hide" : "Details",
        () => {
          const expanded = row.dataset.errorExpanded !== "true";
          row.dataset.errorExpanded = String(expanded);
          errorDetails.hidden = !expanded;
          toggle.textContent = expanded ? "Hide" : "Details";
          toggle.setAttribute("aria-expanded", String(expanded));
        }
      );
      toggle.setAttribute("aria-expanded", String(errorExpanded));
      const copy = createLocalMediaJobAction("Copy", async () => {
        await copyText(job.error);
        const original = copy.textContent;
        copy.textContent = "Copied";
        setTimeout(() => {
          copy.textContent = original;
        }, 1200);
      });
      actions.append(toggle, copy);
    }
  }
  function createLocalMediaJobAction(label, action) {
    const button = document.createElement("button");
    button.className = "media-download media-job-action";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      try {
        await action();
      } catch (error) {
        button.title = error?.message || String(error);
        button.textContent = "Failed";
      }
    });
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
    if (reason.includes("DRM") || reason.includes("Playback only"))
      return "Playback only";
    if (reason.includes("Live")) return "Live";
    if (reason.includes("Encrypted")) return "Encrypted";
    if (reason.includes("waiting") || reason.includes("not exposed") || reason.includes("player-resolved"))
      return "Watching";
    if (reason.includes("no media")) return "No media";
    return "Unavailable";
  }
  async function getActiveHttpTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url?.startsWith("http") ? tab : null;
  }
})();
