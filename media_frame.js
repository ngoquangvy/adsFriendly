var AdsFriendlyMediaFrame = (() => {
  // src/media/contracts.js
  var MEDIA_KINDS = Object.freeze({
    DIRECT: "direct",
    HLS: "hls",
    DASH: "dash",
    BLOB: "blob"
  });
  var MEDIA_DETECTION_SOURCES = Object.freeze({
    DOM: "dom",
    NETWORK: "network",
    PLAYER: "player"
  });
  var DRM_STATES = Object.freeze({
    NONE: "none",
    SUSPECTED: "suspected",
    CONFIRMED: "confirmed"
  });
  var ENCRYPTION_SCHEMES = Object.freeze({
    NONE: "none",
    AES_128: "aes-128",
    SAMPLE_AES: "sample-aes",
    CENC: "cenc",
    CBCS: "cbcs",
    UNKNOWN: "unknown"
  });
  var DRM_SYSTEMS = Object.freeze({
    WIDEVINE: "widevine",
    PLAYREADY: "playready",
    FAIRPLAY: "fairplay",
    CLEARKEY: "clearkey",
    UNKNOWN: "unknown"
  });
  var MEDIA_PROBE_STATES = Object.freeze({
    DISCOVERED: "discovered",
    READY: "ready",
    UNSUPPORTED: "unsupported",
    FAILED: "failed"
  });
  var MEDIA_PROBE_DIAGNOSTIC_PHASES = Object.freeze({
    SCHEDULED: "scheduled",
    DISPATCHED: "dispatched",
    RESPONSE_RECEIVED: "response_received",
    PARSED: "parsed",
    SKIPPED: "skipped",
    FAILED: "failed"
  });
  function normalizeMediaCandidate(value = {}) {
    const candidate = {
      id: requiredString(value.id, "id"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      sourceUrl: optionalString(value.sourceUrl),
      manifestUrl: optionalString(value.manifestUrl),
      kind: enumValue(value.kind, Object.values(MEDIA_KINDS), "kind"),
      title: optionalString(value.title),
      mimeType: optionalString(value.mimeType),
      variants: normalizeArray(value.variants),
      iframeVariants: normalizeArray(value.iframeVariants),
      audioTracks: normalizeArray(value.audioTracks),
      subtitles: normalizeArray(value.subtitles),
      detectedBy: enumValue(
        value.detectedBy,
        Object.values(MEDIA_DETECTION_SOURCES),
        "detectedBy"
      ),
      drm: enumValue(
        value.drm || DRM_STATES.NONE,
        Object.values(DRM_STATES),
        "drm"
      ),
      probeStatus: enumValue(
        value.probeStatus || MEDIA_PROBE_STATES.DISCOVERED,
        Object.values(MEDIA_PROBE_STATES),
        "probeStatus"
      ),
      probeError: optionalString(value.probeError),
      playlistType: optionalEnumValue(
        value.playlistType,
        ["master", "media", "unknown"],
        "playlistType"
      ),
      streamType: optionalEnumValue(
        value.streamType,
        ["vod", "live", "unknown"],
        "streamType"
      ),
      duration: optionalFiniteNumber(value.duration),
      targetDuration: optionalFiniteNumber(value.targetDuration),
      segmentCount: optionalNonNegativeInteger(value.segmentCount),
      partialSegmentCount: optionalNonNegativeInteger(value.partialSegmentCount),
      skippedSegmentCount: optionalNonNegativeInteger(value.skippedSegmentCount),
      lowLatency: value.lowLatency === true,
      mediaSequence: optionalNonNegativeInteger(value.mediaSequence),
      discontinuitySequence: optionalNonNegativeInteger(
        value.discontinuitySequence
      ),
      revisionId: optionalString(value.revisionId),
      requestContexts: normalizeRequestContexts(value.requestContexts),
      resolutionAttempt: normalizeMediaResolutionAttempt(value.resolutionAttempt),
      encryptionMethods: normalizeStrings(value.encryptionMethods),
      encryptionScheme: normalizeEncryptionScheme(value.encryptionScheme),
      encryptionKeyFormats: normalizeStrings(value.encryptionKeyFormats).slice(
        0,
        20
      ),
      drmSystem: normalizeDrmSystem(value.drmSystem),
      drmEvidence: normalizeStrings(value.drmEvidence).slice(0, 20),
      eme: normalizeEmeMetadata(value.eme)
    };
    if (!candidate.sourceUrl && !candidate.manifestUrl) {
      throw new Error(
        "[MediaContract] A media candidate needs sourceUrl or manifestUrl."
      );
    }
    return candidate;
  }
  function normalizeMediaProbe(value = {}) {
    const kind = enumValue(
      value.kind,
      [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH],
      "kind"
    );
    const probeStatus = enumValue(
      value.status,
      [
        MEDIA_PROBE_STATES.READY,
        MEDIA_PROBE_STATES.UNSUPPORTED,
        MEDIA_PROBE_STATES.FAILED
      ],
      "status"
    );
    return {
      mediaId: requiredString(value.mediaId, "mediaId"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      manifestUrl: requiredString(value.manifestUrl, "manifestUrl"),
      kind,
      status: probeStatus,
      error: optionalString(value.error),
      playlistType: optionalEnumValue(
        value.playlistType,
        ["master", "media", "unknown"],
        "playlistType"
      ),
      streamType: optionalEnumValue(
        value.streamType,
        ["vod", "live", "unknown"],
        "streamType"
      ),
      variants: normalizeArray(value.variants),
      iframeVariants: normalizeArray(value.iframeVariants),
      audioTracks: normalizeArray(value.audioTracks),
      subtitles: normalizeArray(value.subtitles),
      duration: optionalFiniteNumber(value.duration),
      targetDuration: optionalFiniteNumber(value.targetDuration),
      segmentCount: optionalNonNegativeInteger(value.segmentCount),
      partialSegmentCount: optionalNonNegativeInteger(value.partialSegmentCount),
      skippedSegmentCount: optionalNonNegativeInteger(value.skippedSegmentCount),
      lowLatency: value.lowLatency === true,
      mediaSequence: optionalNonNegativeInteger(value.mediaSequence),
      discontinuitySequence: optionalNonNegativeInteger(
        value.discontinuitySequence
      ),
      revisionId: optionalString(value.revisionId),
      requestContext: normalizeMediaRequestContext(value.requestContext),
      resolutionAttempt: normalizeMediaResolutionAttempt(value.resolutionAttempt),
      encryptionMethods: normalizeStrings(value.encryptionMethods),
      encryptionScheme: normalizeEncryptionScheme(value.encryptionScheme),
      encryptionKeyFormats: normalizeStrings(value.encryptionKeyFormats).slice(
        0,
        20
      ),
      drmSystem: normalizeDrmSystem(value.drmSystem),
      drmEvidence: normalizeStrings(value.drmEvidence).slice(0, 20),
      eme: normalizeEmeMetadata(value.eme),
      drm: enumValue(
        value.drm || DRM_STATES.NONE,
        Object.values(DRM_STATES),
        "drm"
      )
    };
  }
  function normalizeMediaProbeDiagnostic(value = {}) {
    return {
      mediaId: requiredString(value.mediaId, "mediaId"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      manifestUrl: requiredString(value.manifestUrl, "manifestUrl"),
      kind: enumValue(value.kind, [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH], "kind"),
      phase: enumValue(
        value.phase,
        Object.values(MEDIA_PROBE_DIAGNOSTIC_PHASES),
        "phase"
      ),
      code: requiredString(value.code, "code").slice(0, 100),
      httpStatus: optionalNonNegativeInteger(value.httpStatus),
      bodyBytes: optionalNonNegativeInteger(value.bodyBytes),
      bodyFormat: optionalEnumValue(
        value.bodyFormat,
        ["hls", "dash", "unknown"],
        "bodyFormat"
      ),
      playlistType: optionalEnumValue(
        value.playlistType,
        ["master", "media", "unknown"],
        "playlistType"
      ),
      segmentCount: optionalNonNegativeInteger(value.segmentCount),
      observedAt: optionalFiniteNumber(value.observedAt) || Date.now()
    };
  }
  function normalizeEmeObservation(value = {}) {
    return {
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      keySystem: normalizeKeySystem(value.keySystem),
      initDataType: safeMetadataString(value.initDataType),
      encryptionSchemes: normalizeStrings(value.encryptionSchemes).map(normalizeObservedEncryptionScheme).filter(Boolean).slice(0, 8),
      keyStatuses: normalizeStrings(value.keyStatuses).map((status) => status.toLowerCase()).filter(
        (status) => [
          "usable",
          "expired",
          "released",
          "output-restricted",
          "output-downscaled",
          "status-pending",
          "internal-error"
        ].includes(status)
      ).slice(0, 8),
      licenseStatus: optionalEnumValue(
        value.licenseStatus,
        ["requested", "updated", "usable", "restricted", "expired", "error"],
        "licenseStatus"
      ),
      observedAt: optionalFiniteNumber(value.observedAt) || Date.now()
    };
  }
  function normalizeEmeMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      keySystems: normalizeStrings(value.keySystems).map(normalizeKeySystem).filter(Boolean).slice(0, 8),
      initDataTypes: normalizeStrings(value.initDataTypes).map(safeMetadataString).filter(Boolean).slice(0, 8),
      encryptionSchemes: normalizeStrings(value.encryptionSchemes).map(normalizeObservedEncryptionScheme).filter(Boolean).slice(0, 8),
      keyStatuses: normalizeStrings(value.keyStatuses).map((status) => status.toLowerCase()).filter(Boolean).slice(0, 8),
      licenseStatus: optionalString(value.licenseStatus),
      observedAt: optionalFiniteNumber(value.observedAt) || null
    };
  }
  function normalizeBlobSourceTrace(value = {}) {
    const blobUrl = requiredString(value.blobUrl, "blobUrl");
    if (!blobUrl.startsWith("blob:")) {
      throw new Error("[MediaContract] blobUrl must use the blob: protocol.");
    }
    return {
      mediaId: requiredString(value.mediaId, "mediaId"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      blobUrl,
      sourceUrls: normalizeHttpUrls(value.sourceUrls, 32),
      candidateIds: normalizeStrings(value.candidateIds).slice(0, 8),
      mimeTypes: normalizeStrings(value.mimeTypes).slice(0, 8),
      appendCount: optionalNonNegativeInteger(value.appendCount) || 0,
      totalAppendedBytes: optionalNonNegativeInteger(value.totalAppendedBytes) || 0,
      observedAt: optionalFiniteNumber(value.observedAt) || Date.now()
    };
  }
  function normalizeMediaResolutionAttempt(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const strategy = optionalEnumValue(
      value.strategy,
      ["remove_query_parameter"],
      "resolutionAttempt.strategy"
    );
    if (!strategy) return null;
    return {
      adapterId: optionalString(value.adapterId)?.slice(0, 100) || null,
      strategy,
      removedQueryKey: optionalString(value.removedQueryKey)?.slice(0, 100) || null,
      evidence: normalizeStrings(value.evidence).slice(0, 20)
    };
  }
  function normalizeMediaRequestContext(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const credentials = optionalEnumValue(
      value.credentials,
      ["omit", "same-origin", "include", "unknown"],
      "requestContext.credentials"
    );
    const transport = optionalEnumValue(
      value.transport,
      ["fetch", "xhr", "fallback", "web_request"],
      "requestContext.transport"
    );
    return {
      requestUrl: optionalString(value.requestUrl),
      finalUrl: optionalString(value.finalUrl),
      documentUrl: optionalString(value.documentUrl),
      parentDocumentUrl: optionalString(value.parentDocumentUrl),
      referrer: optionalString(value.referrer),
      method: typeof value.method === "string" && value.method ? value.method.toUpperCase().slice(0, 12) : "GET",
      credentials: credentials || "unknown",
      transport,
      requiresBrowserSession: value.requiresBrowserSession === true,
      observedAt: optionalFiniteNumber(value.observedAt)
    };
  }
  function normalizeVideoAdEvidence(value = {}) {
    const confidence = Number(value.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error("[MediaContract] confidence must be between 0 and 1.");
    }
    return {
      mediaId: requiredString(value.mediaId, "mediaId"),
      startTime: optionalFiniteNumber(value.startTime),
      endTime: optionalFiniteNumber(value.endTime),
      signals: Array.isArray(value.signals) ? value.signals.filter((signal) => typeof signal === "string") : [],
      confidence,
      label: enumValue(
        value.label || "unknown",
        ["ad", "content", "unknown"],
        "label"
      ),
      labelSource: enumValue(
        value.labelSource,
        ["user", "manifest", "heuristic", "model"],
        "labelSource"
      )
    };
  }
  function requiredString(value, field) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`[MediaContract] ${field} must be a non-empty string.`);
    }
    return value;
  }
  function optionalString(value) {
    return typeof value === "string" && value ? value : null;
  }
  function enumValue(value, allowed, field) {
    if (!allowed.includes(value)) {
      throw new Error(
        `[MediaContract] ${field} must be one of: ${allowed.join(", ")}.`
      );
    }
    return value;
  }
  function optionalEnumValue(value, allowed, field) {
    if (value === null || value === void 0 || value === "") return null;
    return enumValue(value, allowed, field);
  }
  function normalizeArray(value) {
    return Array.isArray(value) ? value.slice(0, 100).map((item) => ({ ...item })) : [];
  }
  function normalizeStrings(value) {
    return Array.isArray(value) ? [
      ...new Set(
        value.slice(0, 100).filter((item) => typeof item === "string" && item).map((item) => item.slice(0, 100))
      )
    ] : [];
  }
  function normalizeEncryptionScheme(value) {
    return enumValue(
      value || ENCRYPTION_SCHEMES.NONE,
      Object.values(ENCRYPTION_SCHEMES),
      "encryptionScheme"
    );
  }
  function normalizeObservedEncryptionScheme(value) {
    const normalized = String(value || "").toLowerCase();
    if (["cenc", "cbcs", "cens", "cbc1"].includes(normalized)) return normalized;
    return null;
  }
  function normalizeKeySystem(value) {
    const normalized = safeMetadataString(value)?.toLowerCase();
    if (!normalized) return null;
    if (normalized === "com.widevine.alpha") return normalized;
    if (normalized.includes("playready")) return "com.microsoft.playready";
    if (normalized.includes("fairplay")) return "com.apple.fps";
    if (normalized.includes("clearkey")) return "org.w3.clearkey";
    return "unknown";
  }
  function normalizeDrmSystem(value) {
    if (value === null || value === void 0 || value === "") return null;
    return enumValue(value, Object.values(DRM_SYSTEMS), "drmSystem");
  }
  function safeMetadataString(value) {
    if (typeof value !== "string" || !value) return null;
    return value.slice(0, 100);
  }
  function normalizeHttpUrls(value, maximum) {
    if (!Array.isArray(value)) return [];
    const urls = [];
    for (const item of value.slice(0, maximum)) {
      if (typeof item !== "string") continue;
      try {
        const url = new URL(item);
        if (["http:", "https:"].includes(url.protocol)) urls.push(url.href);
      } catch {
      }
    }
    return [...new Set(urls)];
  }
  function normalizeRequestContexts(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 8).map(normalizeMediaRequestContext).filter(Boolean);
  }
  function optionalFiniteNumber(value) {
    if (value === null || value === void 0) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error("[MediaContract] Timeline values must be finite numbers.");
    }
    return number;
  }
  function optionalNonNegativeInteger(value) {
    if (value === null || value === void 0) return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      throw new Error("[MediaContract] Expected a non-negative integer.");
    }
    return number;
  }

  // src/media/detection.js
  var HLS_MIME_TYPES = /* @__PURE__ */ new Set([
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl"
  ]);
  var DASH_MIME_TYPES = /* @__PURE__ */ new Set(["application/dash+xml"]);
  var SEGMENT_MIME_TYPES = /* @__PURE__ */ new Set([
    "video/mp2t",
    "video/iso.segment",
    "audio/aac",
    "audio/aacp"
  ]);
  var SEGMENT_PATH_PATTERN = /\.(?:ts|m2ts|m4s|cmfv|cmfa|aac)$/i;
  function classifyMediaSource(sourceUrl = "", mimeType = "") {
    const normalizedUrl = String(sourceUrl).trim().toLowerCase();
    const normalizedMime = String(mimeType).split(";")[0].trim().toLowerCase();
    const path = normalizedUrl.split(/[?#]/)[0];
    if (normalizedUrl.startsWith("blob:")) return MEDIA_KINDS.BLOB;
    if (path.endsWith(".m3u8") || HLS_MIME_TYPES.has(normalizedMime))
      return MEDIA_KINDS.HLS;
    if (path.endsWith(".mpd") || DASH_MIME_TYPES.has(normalizedMime))
      return MEDIA_KINDS.DASH;
    if (isLikelyMediaSegment(normalizedUrl, normalizedMime)) return null;
    if (/\.(mp4|webm|m4v|mov)$/.test(path) || normalizedMime.startsWith("video/"))
      return MEDIA_KINDS.DIRECT;
    return null;
  }
  function isLikelyMediaSegment(sourceUrl = "", mimeType = "") {
    const normalizedUrl = String(sourceUrl).trim().toLowerCase();
    const normalizedMime = String(mimeType).split(";", 1)[0].trim().toLowerCase();
    const path = normalizedUrl.split(/[?#]/, 1)[0];
    return SEGMENT_PATH_PATTERN.test(path) || SEGMENT_MIME_TYPES.has(normalizedMime);
  }
  function createMediaCandidateFromSource({
    pageUrl,
    sourceUrl,
    mimeType = null,
    title = null,
    duration = null,
    detectedBy = MEDIA_DETECTION_SOURCES.DOM
  }) {
    const absoluteSourceUrl = resolveSourceUrl(sourceUrl, pageUrl);
    const kind = classifyMediaSource(absoluteSourceUrl, mimeType);
    if (!kind) return null;
    const isManifest = [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(kind);
    return normalizeMediaCandidate({
      id: stableMediaId(kind, absoluteSourceUrl),
      pageUrl,
      sourceUrl: isManifest ? null : absoluteSourceUrl,
      manifestUrl: isManifest ? absoluteSourceUrl : null,
      kind,
      title,
      mimeType,
      duration,
      detectedBy,
      drm: "none"
    });
  }
  function stableMediaId(kind, sourceUrl) {
    const input = `${kind}:${sourceUrl}`;
    let hash = 2166136261;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `media-${(hash >>> 0).toString(36)}`;
  }
  function resolveSourceUrl(sourceUrl, pageUrl) {
    if (typeof sourceUrl !== "string" || !sourceUrl.trim()) return "";
    try {
      return new URL(sourceUrl, pageUrl).href;
    } catch {
      return sourceUrl;
    }
  }

  // src/runtime/event-catalog.js
  var EVENTS = Object.freeze({
    MEDIA_DISCOVERED: "media.discovered",
    MEDIA_PROBED: "media.probed",
    MEDIA_PROBE_DIAGNOSTIC: "media.probe_diagnostic",
    MEDIA_BLOB_TRACED: "media.blob_traced",
    MEDIA_EME_OBSERVED: "media.eme_observed",
    MEDIA_CATALOG_UPDATED: "media.catalog.updated",
    VIDEO_AD_EVIDENCE_FOUND: "video_ad.evidence_found",
    VIDEO_AD_LABELLED: "video_ad.labelled"
  });
  var E = EVENTS;
  var EVENT_CATALOG = Object.freeze({
    [E.MEDIA_DISCOVERED]: event(
      E.MEDIA_DISCOVERED,
      "media.observer",
      ["media.catalog"],
      normalizeMediaCandidate
    ),
    [E.MEDIA_PROBED]: event(
      E.MEDIA_PROBED,
      "media.probe",
      ["media.catalog"],
      normalizeMediaProbe
    ),
    [E.MEDIA_PROBE_DIAGNOSTIC]: event(
      E.MEDIA_PROBE_DIAGNOSTIC,
      "media.probe",
      ["media.catalog"],
      normalizeMediaProbeDiagnostic
    ),
    [E.MEDIA_BLOB_TRACED]: event(
      E.MEDIA_BLOB_TRACED,
      "media.blob-source-tracer",
      ["media.catalog"],
      normalizeBlobSourceTrace
    ),
    [E.MEDIA_EME_OBSERVED]: event(
      E.MEDIA_EME_OBSERVED,
      "media.eme-observer",
      ["media.catalog"],
      normalizeEmeObservation
    ),
    [E.MEDIA_CATALOG_UPDATED]: event(
      E.MEDIA_CATALOG_UPDATED,
      "media.catalog",
      ["media.downloader", "video-ad.evidence-collector"],
      normalizeCatalogUpdate
    ),
    [E.VIDEO_AD_EVIDENCE_FOUND]: event(
      E.VIDEO_AD_EVIDENCE_FOUND,
      "video-ad.evidence-collector",
      ["video-ad.classifier"],
      normalizeVideoAdEvidence
    ),
    [E.VIDEO_AD_LABELLED]: event(
      E.VIDEO_AD_LABELLED,
      "video-ad.feedback-labeler",
      ["training.samples"],
      normalizeVideoAdEvidence
    )
  });
  validateEventCatalog();
  function getEventDefinition(eventId) {
    const definition = EVENT_CATALOG[eventId];
    if (!definition) {
      throw new Error(
        `[EventRegistry] Unknown event "${eventId}". Register it in event-catalog.js before use.`
      );
    }
    return definition;
  }
  function createRegisteredEvent(eventId, payload, metadata = {}) {
    const definition = getEventDefinition(eventId);
    return {
      eventId: randomId(),
      type: eventId,
      timestamp: Date.now(),
      producer: definition.producer,
      payload: definition.normalize(payload),
      metadata: { ...metadata }
    };
  }
  function normalizeRegisteredEvent(value = {}) {
    const definition = getEventDefinition(value.type);
    return {
      eventId: typeof value.eventId === "string" && value.eventId ? value.eventId : randomId(),
      type: definition.id,
      timestamp: Number.isFinite(Number(value.timestamp)) ? Number(value.timestamp) : Date.now(),
      producer: definition.producer,
      payload: definition.normalize(value.payload),
      metadata: value.metadata && typeof value.metadata === "object" ? { ...value.metadata } : {}
    };
  }
  function event(id, producer, consumers, normalize) {
    return Object.freeze({
      id,
      producer,
      consumers: Object.freeze([...consumers]),
      normalize
    });
  }
  function normalizeCatalogUpdate(value = {}) {
    if (typeof value.mediaId !== "string" || !value.mediaId) {
      throw new Error("[EventRegistry] catalog update needs mediaId.");
    }
    const revision = Number(value.revision);
    if (!Number.isInteger(revision) || revision < 0) {
      throw new Error(
        "[EventRegistry] catalog update revision must be a non-negative integer."
      );
    }
    return { mediaId: value.mediaId, revision };
  }
  function validateEventCatalog() {
    const eventIds = Object.values(EVENTS);
    if (new Set(eventIds).size !== eventIds.length) {
      throw new Error("[EventRegistry] Duplicate event ID.");
    }
    for (const eventId of eventIds) {
      const definition = EVENT_CATALOG[eventId];
      if (!definition || definition.id !== eventId) {
        throw new Error(
          `[EventRegistry] Event "${eventId}" has no metadata definition.`
        );
      }
      if (!definition.producer || !definition.consumers.length) {
        throw new Error(
          `[EventRegistry] Event "${eventId}" needs a producer and consumers.`
        );
      }
    }
  }
  function randomId() {
    return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // src/shared/extension-context.js
  function isExtensionContextInvalidated(error) {
    return /extension context invalidated/i.test(String(error?.message || error));
  }

  // src/content/media-observer.js
  function startMediaObserver() {
    let stopped = false;
    const reported = /* @__PURE__ */ new Set();
    const pending = /* @__PURE__ */ new Set();
    const retryCounts = /* @__PURE__ */ new Map();
    const retryTimers = /* @__PURE__ */ new Set();
    const probeTimers = /* @__PURE__ */ new Set();
    const requestedProbes = /* @__PURE__ */ new Set();
    const contextualProbeRetries = /* @__PURE__ */ new Set();
    const videoListeners = /* @__PURE__ */ new Map();
    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") scanElement(mutation.target);
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) scanElement(node);
        }
      }
    });
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["src", "type"],
      childList: true,
      subtree: true
    });
    const onMainWorldMessage = (messageEvent) => {
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "MEDIA_PROBE_CONTEXT_REQUIRED") {
        retryProbeWithParentContext(messageEvent.data);
        return;
      }
      if (messageEvent.source !== window || messageEvent.data?.source !== "adsfriendly-spy" || messageEvent.data?.type !== "REGISTERED_EVENT" || ![
        EVENTS.MEDIA_DISCOVERED,
        EVENTS.MEDIA_PROBED,
        EVENTS.MEDIA_PROBE_DIAGNOSTIC,
        EVENTS.MEDIA_BLOB_TRACED,
        EVENTS.MEDIA_EME_OBSERVED
      ].includes(messageEvent.data.event?.type))
        return;
      try {
        reportEvent(normalizeRegisteredEvent(messageEvent.data.event));
      } catch {
      }
    };
    window.addEventListener("message", onMainWorldMessage);
    const onBackgroundMessage = (message) => {
      if (message?.type !== "PROBE_OBSERVED_MEDIA") return;
      try {
        scheduleManifestProbe(normalizeMediaCandidate(message.candidate));
      } catch (error) {
        console.debug("[AdsFriendly Media] Invalid observed media", error);
      }
    };
    chrome.runtime.onMessage.addListener(onBackgroundMessage);
    const performanceObserver = startPerformanceObserver((entry) => {
      reportSource(entry.name, null, MEDIA_DETECTION_SOURCES.NETWORK);
    });
    scanElement(document.documentElement);
    performance.getEntriesByType("resource").forEach((entry) => reportSource(entry.name, null, "network"));
    return () => {
      stopped = true;
      mutationObserver.disconnect();
      performanceObserver?.disconnect();
      window.removeEventListener("message", onMainWorldMessage);
      chrome.runtime.onMessage.removeListener(onBackgroundMessage);
      for (const [video, listener] of videoListeners) {
        video.removeEventListener("loadedmetadata", listener);
        video.removeEventListener("durationchange", listener);
        video.removeEventListener("play", listener);
      }
      videoListeners.clear();
      reported.clear();
      pending.clear();
      retryCounts.clear();
      retryTimers.forEach(clearTimeout);
      retryTimers.clear();
      probeTimers.forEach(clearTimeout);
      probeTimers.clear();
      requestedProbes.clear();
      contextualProbeRetries.clear();
    };
    function scanElement(element) {
      if (stopped || !element) return;
      if (element.matches?.("video")) observeVideo(element);
      if (element.matches?.("video, source")) reportElementSource(element);
      element.querySelectorAll?.("video").forEach(observeVideo);
      element.querySelectorAll?.("video, video source").forEach(reportElementSource);
    }
    function observeVideo(video) {
      if (videoListeners.has(video)) return;
      const listener = () => {
        reportElementSource(video);
        video.querySelectorAll("source").forEach(reportElementSource);
      };
      videoListeners.set(video, listener);
      video.addEventListener("loadedmetadata", listener);
      video.addEventListener("durationchange", listener);
      video.addEventListener("play", listener);
      listener();
    }
    function reportElementSource(element) {
      const sourceUrl = element.currentSrc || element.src || element.getAttribute?.("src");
      const mimeType = element.currentType || element.type || element.getAttribute?.("type");
      const duration = element.matches?.("video") && Number.isFinite(element.duration) ? element.duration : null;
      reportSource(sourceUrl, mimeType, MEDIA_DETECTION_SOURCES.DOM, duration);
    }
    function reportSource(sourceUrl, mimeType, detectedBy, duration = null) {
      const candidate = createMediaCandidateFromSource({
        pageUrl: location.href,
        sourceUrl,
        mimeType,
        title: document.title || null,
        duration,
        detectedBy
      });
      if (!candidate) return;
      reportEvent(createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
    }
    function reportEvent(event2) {
      if (stopped) return;
      const reportKey = createMediaObserverReportKey(event2);
      if (reported.has(reportKey) || pending.has(reportKey)) return;
      pending.add(reportKey);
      chrome.runtime.sendMessage({
        type: event2.type === EVENTS.MEDIA_PROBED ? "MEDIA_PROBED" : event2.type === EVENTS.MEDIA_PROBE_DIAGNOSTIC ? "MEDIA_PROBE_DIAGNOSTIC" : event2.type === EVENTS.MEDIA_BLOB_TRACED ? "MEDIA_BLOB_TRACED" : event2.type === EVENTS.MEDIA_EME_OBSERVED ? "MEDIA_EME_OBSERVED" : "MEDIA_DISCOVERED",
        event: event2
      }).then((response) => {
        pending.delete(reportKey);
        if (response?.status === "recorded") {
          reported.add(reportKey);
          retryCounts.delete(reportKey);
          if (event2.type === EVENTS.MEDIA_DISCOVERED)
            scheduleManifestProbe(event2.payload);
          return;
        }
        if (["catalog_disabled", "capability_disabled"].includes(response?.status)) {
          const retryCount = retryCounts.get(reportKey) || 0;
          if (retryCount >= 6) return;
          retryCounts.set(reportKey, retryCount + 1);
          const retryId = setTimeout(() => {
            retryTimers.delete(retryId);
            reportEvent(event2);
          }, 500);
          retryTimers.add(retryId);
        }
      }).catch((error) => {
        pending.delete(reportKey);
        if (!isExtensionContextInvalidated(error))
          console.debug("[AdsFriendly Media] Catalog unavailable", error);
      });
    }
    function scheduleManifestProbe(candidate) {
      if (!["hls", "dash"].includes(candidate.kind) || !candidate.manifestUrl)
        return "invalid";
      if (requestedProbes.has(candidate.id)) {
        reportProbeDiagnostic(candidate, "skipped", "content_duplicate");
        return "duplicate";
      }
      requestedProbes.add(candidate.id);
      reportProbeDiagnostic(candidate, "scheduled", "iframe_probe_scheduled");
      for (const delay of [750]) {
        const timerId = setTimeout(() => {
          probeTimers.delete(timerId);
          if (stopped) return;
          window.postMessage(
            {
              source: "adsfriendly-content",
              type: "PROBE_MEDIA_MANIFEST",
              mediaId: candidate.id,
              kind: candidate.kind,
              manifestUrl: candidate.manifestUrl
            },
            "*"
          );
        }, delay);
        probeTimers.add(timerId);
      }
      return "scheduled";
    }
    function reportProbeDiagnostic(candidate, phase, code) {
      reportEvent(
        createRegisteredEvent(EVENTS.MEDIA_PROBE_DIAGNOSTIC, {
          mediaId: candidate.id,
          pageUrl: location.href,
          manifestUrl: candidate.manifestUrl,
          kind: candidate.kind,
          phase,
          code,
          observedAt: Date.now()
        })
      );
    }
    function retryProbeWithParentContext({ mediaId, kind, manifestUrl }) {
      if (stopped || !mediaId || !manifestUrl || contextualProbeRetries.has(mediaId) || !document.referrer)
        return;
      contextualProbeRetries.add(mediaId);
      chrome.runtime.sendMessage({
        type: "PREPARE_MEDIA_CONTEXTUAL_PROBE",
        mediaId,
        manifestUrl,
        parentDocumentUrl: document.referrer
      }).then((response) => {
        if (stopped || response?.status !== "prepared") return;
        window.postMessage(
          {
            source: "adsfriendly-content",
            type: "PROBE_MEDIA_MANIFEST",
            mediaId,
            kind,
            manifestUrl,
            contextualRetry: true
          },
          "*"
        );
      }).catch(() => {
      });
    }
  }
  function createMediaObserverReportKey(event2) {
    const payload = event2?.payload || {};
    const mediaId = payload.id || payload.mediaId || "unknown";
    if (event2?.type === EVENTS.MEDIA_DISCOVERED) {
      const playbackDuration = payload.kind === "blob" && Number.isFinite(payload.duration) ? Math.round(payload.duration) : "unknown";
      return `${event2.type}:${mediaId}:${payload.detectedBy || "unknown"}:${playbackDuration}`;
    }
    if (event2?.type === EVENTS.MEDIA_BLOB_TRACED) {
      return [
        event2.type,
        mediaId,
        payload.sourceUrls?.length || 0,
        payload.candidateIds?.join(",") || "none",
        Math.floor((payload.appendCount || 0) / 10)
      ].join(":");
    }
    if (event2?.type === EVENTS.MEDIA_EME_OBSERVED) {
      return [
        event2.type,
        payload.keySystem || "unknown",
        payload.initDataType || "none",
        payload.licenseStatus || "none",
        ...payload.keyStatuses || []
      ].join(":");
    }
    if (event2?.type === EVENTS.MEDIA_PROBE_DIAGNOSTIC) {
      return [
        event2.type,
        mediaId,
        payload.phase || "unknown",
        payload.code || "unknown",
        payload.httpStatus ?? "none",
        payload.bodyBytes ?? "none",
        payload.playlistType || "none",
        payload.segmentCount ?? "none"
      ].join(":");
    }
    if (event2?.type !== EVENTS.MEDIA_PROBED) {
      return `${event2?.type || "unknown"}:${mediaId}`;
    }
    const segmentSignal = payload.streamType === "live" ? Number(payload.segmentCount > 0 || payload.partialSegmentCount > 0) : payload.segmentCount ?? payload.partialSegmentCount ?? "none";
    return [
      event2.type,
      mediaId,
      payload.status || "unknown",
      payload.error || "none",
      payload.playlistType || "unknown",
      payload.streamType || "unknown",
      payload.variants?.length || 0,
      segmentSignal,
      payload.drm || "none",
      payload.drmSystem || "none",
      payload.encryptionScheme || "none",
      (payload.encryptionMethods || []).join(",")
    ].join(":");
  }
  function startPerformanceObserver(onEntry) {
    if (typeof PerformanceObserver === "undefined") return null;
    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach(onEntry);
      });
      observer.observe({ type: "resource", buffered: true });
      return observer;
    } catch {
      return null;
    }
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

  // src/navigation/content/intent-tracker.js
  function startIntentTracker() {
    const recordIntent = (event2) => {
      if (!event2.isTrusted) return;
      try {
        const link = event2.target?.closest?.("a[href]");
        const sourceUrl = window.top === window ? location.href : document.referrer || location.href;
        const intent = classifyNavigationIntent({
          intentUrl: link?.href,
          sourceUrl,
          evidence: buildClickEvidence(link, event2.target)
        });
        chrome.runtime.sendMessage({
          type: "TRUSTED_CLICK",
          intentUrl: link?.href || null,
          sourceUrl,
          frameUrl: location.href,
          intentKind: intent.likelyAd ? "promotional" : "navigation",
          intentReasons: intent.reasons
        });
      } catch {
      }
    };
    const onKeydown = (event2) => {
      if (event2.key === "Enter") recordIntent(event2);
    };
    document.addEventListener("pointerdown", recordIntent, true);
    document.addEventListener("contextmenu", recordIntent, true);
    document.addEventListener("keydown", onKeydown, true);
    return () => {
      document.removeEventListener("pointerdown", recordIntent, true);
      document.removeEventListener("contextmenu", recordIntent, true);
      document.removeEventListener("keydown", onKeydown, true);
    };
  }
  function buildClickEvidence(link, target) {
    return [
      link?.id,
      typeof link?.className === "string" ? link.className : "",
      link?.title,
      target?.id,
      typeof target?.className === "string" ? target.className : "",
      target?.getAttribute?.("alt"),
      target?.getAttribute?.("title")
    ].filter(Boolean).join(" ");
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
    const controller = {
      context,
      async start() {
        if (started) return controller;
        started = true;
        if (!initialSettings) settings = await settingsLoader();
        await reconcile();
        if (watchSettings) {
          unsubscribe = settingsSubscriber((nextSettings) => {
            controller.updateSettings(nextSettings).catch(
              (error) => logger.error(
                `[MainController:${context}] reconcile failed`,
                error
              )
            );
          });
        }
        notify();
        return controller;
      },
      async updateSettings(nextSettings) {
        settings = normalizeSettings(nextSettings);
        if (started) await reconcile();
        notify();
        return controller.snapshot();
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
            controller,
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
      const snapshot = controller.snapshot();
      for (const listener of listeners) listener(snapshot);
    }
    return controller;
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

  // src/media-frame/index.js
  if (window.top !== window) {
    const controller = createMainController({
      context: "media-frame",
      implementations: {
        "media-frame.observer": () => startMediaObserver(),
        "media-frame.navigation-intent": () => startIntentTracker()
      }
    });
    controller.onChange(({ settings }) => {
      window.postMessage(
        {
          source: "adsfriendly-content",
          type: "PROTECTION_SETTINGS_CHANGED",
          settings
        },
        "*"
      );
    });
    controller.start().catch(
      (error) => console.error("[AdsFriendly Media Frame] MainController failed", error)
    );
  }
})();
