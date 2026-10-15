var AdsFriendlyMediaFrame = (() => {
  // src/media/contracts.js
  var MEDIA_KINDS = Object.freeze({
    DIRECT: "direct",
    HLS: "hls",
    DASH: "dash",
    ADAPTIVE: "adaptive",
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
  var MEDIA_PROBE_SOURCES = Object.freeze({
    NETWORK_RESPONSE: "network_response",
    DECRYPTED_BLOB: "decrypted_blob"
  });
  var MEDIA_PLAYBACK_STATES = Object.freeze({
    IDLE: "idle",
    PLAYING: "playing",
    PAUSED: "paused",
    WAITING: "waiting",
    SEEKING: "seeking",
    ENDED: "ended"
  });
  var MEDIA_PLAYBACK_TRIGGERS = Object.freeze([
    "initial",
    "loadedmetadata",
    "durationchange",
    "play",
    "pause",
    "ended",
    "waiting",
    "seeking",
    "seeked",
    "ratechange",
    "timeupdate",
    "visibility"
  ]);
  function normalizeMediaCandidate(value = {}) {
    const candidate = {
      id: requiredString(value.id, "id"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      sourceUrl: optionalString(value.sourceUrl),
      manifestUrl: optionalString(value.manifestUrl),
      kind: enumValue(value.kind, Object.values(MEDIA_KINDS), "kind"),
      title: optionalString(value.title),
      mimeType: optionalString(value.mimeType),
      provider: optionalString(value.provider),
      acquisitionProfile: optionalString(value.acquisitionProfile),
      playerUrl: optionalString(value.playerUrl),
      acquisitionDiagnostic: normalizeMediaAcquisitionDiagnostic(
        value.acquisitionDiagnostic
      ),
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
      contentLength: optionalNonNegativeInteger(value.contentLength),
      resolution: normalizeResolution(value.resolution),
      playback: normalizePlaybackState(value.playback),
      bandwidth: optionalPositiveNumber(value.bandwidth),
      averageBandwidth: optionalPositiveNumber(value.averageBandwidth),
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
  function normalizePlaybackState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      playing: value.playing === true,
      visible: value.visible === true,
      muted: value.muted === true,
      currentTime: optionalFiniteNumber(value.currentTime),
      observedAt: optionalNonNegativeInteger(value.observedAt)
    };
  }
  function normalizeMediaPlaybackObservation(value = {}) {
    return {
      sessionId: requiredString(value.sessionId, "sessionId").slice(0, 160),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      mediaId: optionalString(value.mediaId)?.slice(0, 200) || null,
      state: enumValue(
        value.state,
        Object.values(MEDIA_PLAYBACK_STATES),
        "playback.state"
      ),
      trigger: enumValue(
        value.trigger,
        MEDIA_PLAYBACK_TRIGGERS,
        "playback.trigger"
      ),
      currentTime: optionalNonNegativeNumber(value.currentTime),
      duration: optionalPositiveNumber(value.duration),
      playbackRate: optionalPositiveNumber(value.playbackRate) || 1,
      muted: value.muted === true,
      visible: value.visible === true,
      readyState: optionalBoundedInteger(value.readyState, 0, 4),
      observedAt: optionalNonNegativeInteger(value.observedAt) || Date.now()
    };
  }
  function normalizeMediaAcquisitionDiagnostic(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      provider: optionalString(value.provider),
      input: optionalString(value.input),
      stage: optionalString(value.stage),
      descriptorCount: optionalNonNegativeInteger(value.descriptorCount),
      videoDescriptorCount: optionalNonNegativeInteger(
        value.videoDescriptorCount
      ),
      audioDescriptorCount: optionalNonNegativeInteger(
        value.audioDescriptorCount
      ),
      directVideoCount: optionalNonNegativeInteger(value.directVideoCount),
      directAudioCount: optionalNonNegativeInteger(value.directAudioCount),
      signatureCipherCount: optionalNonNegativeInteger(
        value.signatureCipherCount
      ),
      nTransformCount: optionalNonNegativeInteger(value.nTransformCount),
      serverAbrAvailable: value.serverAbrAvailable === true,
      hlsManifestAvailable: value.hlsManifestAvailable === true,
      dashManifestAvailable: value.dashManifestAvailable === true,
      playabilityStatus: optionalString(value.playabilityStatus),
      playerUrlAvailable: value.playerUrlAvailable === true
    };
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
      bandwidth: optionalPositiveNumber(value.bandwidth),
      averageBandwidth: optionalPositiveNumber(value.averageBandwidth),
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
      probeSource: optionalEnumValue(
        value.probeSource,
        Object.values(MEDIA_PROBE_SOURCES),
        "probeSource"
      ),
      manifestEnvelope: normalizeManifestEnvelope(value.manifestEnvelope),
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
      observationSource: optionalEnumValue(
        value.observationSource,
        [
          "network_response",
          "active_probe",
          "decrypted_blob",
          "player_api",
          "media_source"
        ],
        "observationSource"
      ),
      envelopeScheme: optionalEnumValue(
        value.envelopeScheme,
        ["aes-gcm", "unknown"],
        "envelopeScheme"
      ),
      correlationConfidence: optionalConfidence(value.correlationConfidence),
      evidence: normalizeStrings(value.evidence).slice(0, 20),
      observedAt: optionalFiniteNumber(value.observedAt) || Date.now()
    };
  }
  function normalizeManifestEnvelope(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      scheme: enumValue(
        value.scheme || "unknown",
        ["aes-gcm", "unknown"],
        "manifestEnvelope.scheme"
      ),
      observedAt: optionalFiniteNumber(value.observedAt),
      correlationConfidence: optionalConfidence(value.correlationConfidence),
      evidence: normalizeStrings(value.evidence).slice(0, 20)
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
      appendFormats: normalizeStrings(value.appendFormats).filter(
        (format) => ["iso-bmff", "mpeg-ts", "webm", "aac-adts"].includes(format)
      ).slice(0, 4),
      appendCount: optionalNonNegativeInteger(value.appendCount) || 0,
      unclassifiedAppendCount: optionalNonNegativeInteger(value.unclassifiedAppendCount) || 0,
      totalAppendedBytes: optionalNonNegativeInteger(value.totalAppendedBytes) || 0,
      observerStartedAt: optionalFiniteNumber(value.observerStartedAt) || null,
      observerDocumentState: optionalEnumValue(
        value.observerDocumentState,
        ["loading", "interactive", "complete", "unknown"],
        "observerDocumentState"
      ) || "unknown",
      observedAt: optionalFiniteNumber(value.observedAt) || Date.now()
    };
  }
  function normalizeMediaManifestHandoff(value = {}) {
    return {
      mediaId: requiredString(value.mediaId, "mediaId"),
      pageUrl: requiredString(value.pageUrl, "pageUrl"),
      manifestUrl: requiredString(value.manifestUrl, "manifestUrl"),
      kind: enumValue(value.kind, [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH], "kind"),
      bodyBytes: optionalNonNegativeInteger(value.bodyBytes) || 0,
      revisionId: optionalString(value.revisionId),
      capturedAt: optionalFiniteNumber(value.capturedAt) || Date.now(),
      expiresAt: optionalFiniteNumber(value.expiresAt)
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
  function optionalConfidence(value) {
    if (value === null || value === void 0 || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 1) {
      throw new Error("[MediaContract] confidence must be between 0 and 1.");
    }
    return number;
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
  function normalizeResolution(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const width = optionalNonNegativeInteger(value.width);
    const height = optionalNonNegativeInteger(value.height);
    return width || height ? { width, height } : null;
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
  function optionalPositiveNumber(value) {
    if (value === null || value === void 0) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      throw new Error("[MediaContract] Expected a positive number.");
    }
    return number;
  }
  function optionalNonNegativeNumber(value) {
    if (value === null || value === void 0) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error("[MediaContract] Expected a non-negative number.");
    }
    return number;
  }
  function optionalBoundedInteger(value, minimum, maximum) {
    if (value === null || value === void 0) return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw new Error(
        `[MediaContract] Expected an integer from ${minimum} to ${maximum}.`
      );
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
    contentLength = null,
    resolution = null,
    playback = null,
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
      contentLength: kind === MEDIA_KINDS.DIRECT ? contentLength : null,
      resolution,
      playback,
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
    MEDIA_MANIFEST_HANDOFF_READY: "media.manifest_handoff_ready",
    MEDIA_EME_OBSERVED: "media.eme_observed",
    MEDIA_PLAYBACK_OBSERVED: "media.playback_observed",
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
    [E.MEDIA_MANIFEST_HANDOFF_READY]: event(
      E.MEDIA_MANIFEST_HANDOFF_READY,
      "media.manifest-handoff",
      ["media.catalog", "media.downloader"],
      normalizeMediaManifestHandoff
    ),
    [E.MEDIA_EME_OBSERVED]: event(
      E.MEDIA_EME_OBSERVED,
      "media.eme-observer",
      ["media.catalog"],
      normalizeEmeObservation
    ),
    [E.MEDIA_PLAYBACK_OBSERVED]: event(
      E.MEDIA_PLAYBACK_OBSERVED,
      "media.playback-observer",
      ["media.catalog", "video-ad.evidence-collector"],
      normalizeMediaPlaybackObservation
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

  // src/media/youtube-track-profile.js
  var YOUTUBE_PAGE_HOSTS = /* @__PURE__ */ new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com"
  ]);
  function parseYouTubePlaybackTrack(sourceUrl, { mimeType = null, responseHeaders = [] } = {}) {
    let url;
    try {
      url = new URL(sourceUrl);
    } catch {
      return null;
    }
    if (!["http:", "https:"].includes(url.protocol) || !isGoogleVideoHost(url.hostname) || url.pathname !== "/videoplayback") {
      return null;
    }
    const declaredMime = cleanMimeType(url.searchParams.get("mime") || mimeType);
    const responseMime = cleanMimeType(mimeType);
    const effectiveMime = declaredMime || responseMime;
    const type = effectiveMime?.startsWith("video/") ? "video" : effectiveMime?.startsWith("audio/") ? "audio" : null;
    const itag = safeToken(url.searchParams.get("itag"), 24);
    if (!type || !itag) return null;
    const normalizedUrl = new URL(url);
    normalizedUrl.searchParams.delete("range");
    const size = parseSize(url.searchParams.get("size"));
    const duration = positiveNumber(url.searchParams.get("dur"));
    const contentLength = positiveInteger(url.searchParams.get("clen")) || contentRangeTotal(responseHeaders) || positiveInteger(headerValue(responseHeaders, "content-length"));
    const bitrate = positiveInteger(url.searchParams.get("bitrate"));
    const codecs = parseCodecs(url.searchParams.get("mime"));
    const assetToken = safeToken(url.searchParams.get("id"), 180) || safeToken(url.searchParams.get("docid"), 64) || null;
    return Object.freeze({
      id: `youtube-${type}-${itag}`,
      provider: "youtube",
      acquisitionProfile: "youtube_resolved_tracks",
      type,
      itag,
      assetToken,
      sourceUrl: normalizedUrl.href,
      observedUrl: url.href,
      mimeType: effectiveMime,
      codecs,
      duration,
      bandwidth: bitrate,
      averageBandwidth: bitrate,
      contentLength,
      width: size?.width || null,
      height: size?.height || null,
      resolution: size,
      qualityLabel: safeToken(url.searchParams.get("quality_label"), 40) || safeToken(url.searchParams.get("quality"), 40),
      observedAt: Date.now()
    });
  }
  function createYouTubeAdaptiveCandidate({
    pageUrl,
    title = null,
    track,
    playerUrl = null
  }) {
    if (!track || track.provider !== "youtube") return null;
    const videoId = youtubeVideoId(pageUrl);
    if (!videoId || !isYouTubePage(pageUrl)) return null;
    const id = stableMediaId(MEDIA_KINDS.ADAPTIVE, `youtube:${videoId}`);
    const normalizedTrack = {
      id: track.id,
      type: track.type,
      sourceUrl: track.sourceUrl,
      mimeType: track.mimeType,
      codecs: track.codecs,
      itag: track.itag,
      bandwidth: track.bandwidth,
      averageBandwidth: track.averageBandwidth,
      contentLength: track.contentLength,
      width: track.width,
      height: track.height,
      resolution: track.resolution,
      qualityLabel: track.qualityLabel,
      observedAt: track.observedAt,
      urlResolution: track.urlResolution || "resolved",
      signatureCipher: track.signatureCipher || null,
      muxed: track.muxed === true,
      language: track.language || null,
      audioTrackId: track.audioTrackId || null,
      audioTrackName: track.audioTrackName || null,
      audioRole: track.audioRole || null,
      audioIsDefault: track.audioIsDefault === true,
      isDrc: track.isDrc === true,
      audioSampleRate: track.audioSampleRate || null,
      audioChannels: track.audioChannels || null,
      audioQuality: track.audioQuality || null
    };
    return normalizeMediaCandidate({
      id,
      pageUrl,
      sourceUrl: track.sourceUrl,
      kind: MEDIA_KINDS.ADAPTIVE,
      title,
      mimeType: track.mimeType,
      duration: track.duration,
      resolution: track.resolution,
      bandwidth: track.bandwidth,
      averageBandwidth: track.averageBandwidth,
      variants: track.type === "video" ? [normalizedTrack] : [],
      audioTracks: track.type === "audio" ? [normalizedTrack] : [],
      detectedBy: MEDIA_DETECTION_SOURCES.NETWORK,
      probeStatus: MEDIA_PROBE_STATES.DISCOVERED,
      streamType: "vod",
      provider: "youtube",
      acquisitionProfile: [
        "n_transform_pending",
        "signature_cipher_pending"
      ].includes(track.urlResolution) ? "youtube_player_js_challenge" : "youtube_resolved_tracks",
      playerUrl
    });
  }
  function createYouTubeCandidateFromObservedSource({
    pageUrl,
    sourceUrl,
    title = null,
    mimeType = null,
    responseHeaders = []
  }) {
    const track = parseYouTubePlaybackTrack(sourceUrl, {
      mimeType,
      responseHeaders
    });
    if (!track) return null;
    return createYouTubeAdaptiveCandidate({ pageUrl, title, track });
  }
  function isYouTubePage(value) {
    try {
      const hostname = new URL(value).hostname.toLowerCase();
      return YOUTUBE_PAGE_HOSTS.has(hostname) || hostname.endsWith(".youtube.com");
    } catch {
      return false;
    }
  }
  function youtubeVideoId(value) {
    try {
      const url = new URL(value);
      if (!isYouTubePage(url.href)) return null;
      if (url.pathname === "/watch")
        return safeToken(url.searchParams.get("v"), 64);
      const shortMatch = url.pathname.match(
        /^\/(?:shorts|embed|live)\/([^/?#]+)/i
      );
      return shortMatch ? safeToken(shortMatch[1], 64) : null;
    } catch {
      return null;
    }
  }
  function isGoogleVideoHost(hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === "googlevideo.com" || normalized.endsWith(".googlevideo.com");
  }
  function cleanMimeType(value) {
    const normalized = String(value || "").split(";", 1)[0].trim().toLowerCase();
    return /^(?:video|audio)\/[a-z0-9.+-]+$/.test(normalized) ? normalized : null;
  }
  function parseCodecs(value) {
    const match = String(value || "").match(/codecs\s*=\s*["']?([^"';]+)/i);
    return match?.[1]?.trim().slice(0, 120) || null;
  }
  function parseSize(value) {
    const match = String(value || "").match(/^(\d{2,5})x(\d{2,5})$/i);
    if (!match) return null;
    const width = positiveInteger(match[1]);
    const height = positiveInteger(match[2]);
    return width && height ? { width, height } : null;
  }
  function contentRangeTotal(headers) {
    const value = headerValue(headers, "content-range");
    return positiveInteger(String(value || "").match(/\/(\d+)$/)?.[1]);
  }
  function headerValue(headers, name) {
    const match = (headers || []).find(
      (item) => String(item?.name || "").toLowerCase() === name
    );
    return typeof match?.value === "string" ? match.value : null;
  }
  function safeToken(value, maximum) {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maximum ? normalized : null;
  }
  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  // src/media/playback-observation.js
  var PLAYBACK_EVENT_TYPES = Object.freeze([
    "initial",
    "loadedmetadata",
    "durationchange",
    "play",
    "pause",
    "ended",
    "waiting",
    "seeking",
    "seeked",
    "ratechange",
    "timeupdate",
    "visibility"
  ]);
  var TIMEUPDATE_INTERVAL_MS = 1e3;
  function createPlaybackObservationTracker({
    scopeId = randomScopeId(),
    now = () => Date.now()
  } = {}) {
    const sessions = /* @__PURE__ */ new WeakMap();
    let nextSession = 1;
    return Object.freeze({
      observe(mediaElement, { pageUrl, mediaId = null, trigger = "initial", visible = false } = {}) {
        if (!mediaElement || typeof mediaElement !== "object") return null;
        if (!PLAYBACK_EVENT_TYPES.includes(trigger)) return null;
        let session = sessions.get(mediaElement);
        if (!session) {
          session = {
            id: `${scopeId}:player-${nextSession++}`,
            lastObservedAt: 0,
            lastSignature: null
          };
          sessions.set(mediaElement, session);
        }
        const observedAt = now();
        if (trigger === "timeupdate" && observedAt - session.lastObservedAt < TIMEUPDATE_INTERVAL_MS)
          return null;
        const observation = {
          sessionId: session.id,
          pageUrl,
          mediaId,
          state: playbackState(mediaElement, trigger),
          trigger,
          currentTime: finiteOrNull(mediaElement.currentTime),
          duration: positiveFiniteOrNull(mediaElement.duration),
          playbackRate: positiveFiniteOrNull(mediaElement.playbackRate) || 1,
          muted: mediaElement.muted === true,
          visible: visible === true,
          readyState: boundedReadyState(mediaElement.readyState),
          observedAt
        };
        const signature = [
          observation.mediaId,
          observation.state,
          observation.trigger,
          observation.visible,
          observation.muted,
          observation.playbackRate,
          Math.floor((observation.currentTime || 0) * 2)
        ].join(":");
        if (trigger !== "timeupdate" && signature === session.lastSignature && observedAt - session.lastObservedAt < 250)
          return null;
        session.lastObservedAt = observedAt;
        session.lastSignature = signature;
        return observation;
      }
    });
  }
  function playbackState(mediaElement, trigger) {
    if (trigger === "waiting") return "waiting";
    if (trigger === "seeking") return "seeking";
    if (mediaElement.ended === true || trigger === "ended") return "ended";
    if (mediaElement.paused === false) return "playing";
    if (finiteOrNull(mediaElement.currentTime) > 0) return "paused";
    return "idle";
  }
  function boundedReadyState(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number <= 4 ? number : null;
  }
  function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }
  function positiveFiniteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }
  function randomScopeId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // src/content/media-observer.js
  var VIDEO_OBSERVATION_EVENTS = Object.freeze([
    "loadedmetadata",
    "durationchange",
    "play",
    "pause",
    "ended",
    "waiting",
    "seeking",
    "seeked",
    "ratechange",
    "timeupdate"
  ]);
  var MAX_REPORTED_EVENT_KEYS = 2e3;
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
    const playbackTracker = createPlaybackObservationTracker();
    const videoVisibilityObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver(
      (entries) => entries.forEach(
        (entry) => reportElementSource(entry.target, "visibility")
      ),
      { threshold: [0, 0.25, 0.6] }
    ) : null;
    const aesKeyHandoffRequests = /* @__PURE__ */ new Map();
    const youtubeMediaHandoffRequests = /* @__PURE__ */ new Map();
    const playerOutputCanaryRequests = /* @__PURE__ */ new Map();
    const playerOutputCaptureStartRequests = /* @__PURE__ */ new Map();
    const playerOutputCaptureReloadRequests = /* @__PURE__ */ new Map();
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
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "PLAYER_OUTPUT_CAPTURE_RELOAD_RESPONSE") {
        const pendingRequest = playerOutputCaptureReloadRequests.get(
          messageEvent.data.requestId
        );
        if (!pendingRequest) return;
        playerOutputCaptureReloadRequests.delete(messageEvent.data.requestId);
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.resolve(messageEvent.data.result || { status: "error" });
        return;
      }
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "PLAYER_OUTPUT_CAPTURE_START_RESPONSE") {
        const pendingRequest = playerOutputCaptureStartRequests.get(
          messageEvent.data.requestId
        );
        if (!pendingRequest) return;
        playerOutputCaptureStartRequests.delete(messageEvent.data.requestId);
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.resolve(messageEvent.data.result || { status: "error" });
        return;
      }
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "PLAYER_OUTPUT_CAPTURE_CHUNK") {
        forwardPlayerOutputChunk(messageEvent.data);
        return;
      }
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "PLAYER_OUTPUT_CAPTURE_FINISH") {
        chrome.runtime.sendMessage({
          type: "PLAYER_OUTPUT_CAPTURE_FINISH",
          captureId: messageEvent.data.captureId
        }).catch(() => {
        });
        return;
      }
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "PLAYER_OUTPUT_CAPTURE_FAILED") {
        chrome.runtime.sendMessage({
          type: "PLAYER_OUTPUT_CAPTURE_FAILED",
          captureId: messageEvent.data.captureId,
          error: messageEvent.data.error
        }).catch(() => {
        });
        return;
      }
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "PLAYER_OUTPUT_CANARY_RESPONSE") {
        const pendingRequest = playerOutputCanaryRequests.get(
          messageEvent.data.requestId
        );
        if (!pendingRequest) return;
        playerOutputCanaryRequests.delete(messageEvent.data.requestId);
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.resolve({
          status: "ready",
          canary: messageEvent.data.canary || null
        });
        return;
      }
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "YOUTUBE_MEDIA_HANDOFF_RESPONSE") {
        const pendingRequest = youtubeMediaHandoffRequests.get(
          messageEvent.data.requestId
        );
        if (!pendingRequest) return;
        youtubeMediaHandoffRequests.delete(messageEvent.data.requestId);
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.resolve({
          status: "ready",
          handoff: messageEvent.data.handoff || null
        });
        return;
      }
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "MEDIA_AES_KEY_HANDOFF_RESPONSE") {
        const pendingRequest = aesKeyHandoffRequests.get(
          messageEvent.data.requestId
        );
        if (!pendingRequest) return;
        aesKeyHandoffRequests.delete(messageEvent.data.requestId);
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.resolve({
          status: "ready",
          requestedManifestUrl: messageEvent.data.requestedManifestUrl,
          keys: Array.isArray(messageEvent.data.keys) ? messageEvent.data.keys : [],
          diagnostic: messageEvent.data.diagnostic && typeof messageEvent.data.diagnostic === "object" ? messageEvent.data.diagnostic : null
        });
        return;
      }
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "MEDIA_PROBE_CONTEXT_REQUIRED") {
        retryProbeWithParentContext(messageEvent.data);
        return;
      }
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "MEDIA_DEBUG_MANIFEST_CAPTURE") {
        chrome.runtime.sendMessage({
          type: "SAVE_MEDIA_DEBUG_MANIFEST",
          capture: messageEvent.data.capture
        }).catch(() => {
        });
        return;
      }
      if (messageEvent.source === window && messageEvent.data?.source === "adsfriendly-spy" && messageEvent.data?.type === "MEDIA_DECRYPTED_MANIFEST_READY") {
        saveDecryptedManifestHandoff(messageEvent.data.handoff);
        return;
      }
      if (messageEvent.source !== window || messageEvent.data?.source !== "adsfriendly-spy" || messageEvent.data?.type !== "REGISTERED_EVENT" || ![
        EVENTS.MEDIA_DISCOVERED,
        EVENTS.MEDIA_PROBED,
        EVENTS.MEDIA_PROBE_DIAGNOSTIC,
        EVENTS.MEDIA_BLOB_TRACED,
        EVENTS.MEDIA_EME_OBSERVED,
        EVENTS.MEDIA_PLAYBACK_OBSERVED
      ].includes(messageEvent.data.event?.type))
        return;
      try {
        reportEvent(normalizeRegisteredEvent(messageEvent.data.event));
      } catch {
      }
    };
    window.addEventListener("message", onMainWorldMessage);
    const onBackgroundMessage = (message, _sender, sendResponse) => {
      if (message?.type === "GET_MEDIA_AES_KEY_HANDOFF") {
        requestAesKeyHandoff(
          message.requestedManifestUrl,
          message.manifestUrls
        ).then(sendResponse);
        return true;
      }
      if (message?.type === "GET_YOUTUBE_MEDIA_HANDOFF") {
        requestYouTubeMediaHandoff().then(sendResponse);
        return true;
      }
      if (message?.type === "GET_PLAYER_OUTPUT_CANARY") {
        requestPlayerOutputCanary().then(sendResponse);
        return true;
      }
      if (message?.type === "START_PLAYER_OUTPUT_CAPTURE") {
        requestPlayerOutputCaptureStart(message.captureId).then(sendResponse);
        return true;
      }
      if (message?.type === "PREPARE_PLAYER_OUTPUT_CAPTURE_RELOAD") {
        requestPlayerOutputCaptureReload(message.captureId).then(sendResponse);
        return true;
      }
      if (message?.type === "STOP_PLAYER_OUTPUT_CAPTURE") {
        window.postMessage(
          {
            source: "adsfriendly-content",
            type: "STOP_PLAYER_OUTPUT_CAPTURE",
            captureId: message.captureId
          },
          "*"
        );
        sendResponse({ status: "stopped" });
        return false;
      }
      if (message?.type !== "PROBE_OBSERVED_MEDIA") return void 0;
      try {
        scheduleManifestProbe(normalizeMediaCandidate(message.candidate));
      } catch (error) {
        console.debug("[AdsFriendly Media] Invalid observed media", error);
      }
      return void 0;
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
        for (const eventType of VIDEO_OBSERVATION_EVENTS)
          video.removeEventListener(eventType, listener);
      }
      videoListeners.clear();
      videoVisibilityObserver?.disconnect();
      reported.clear();
      pending.clear();
      retryCounts.clear();
      retryTimers.forEach(clearTimeout);
      retryTimers.clear();
      probeTimers.forEach(clearTimeout);
      probeTimers.clear();
      requestedProbes.clear();
      contextualProbeRetries.clear();
      for (const pendingRequest of aesKeyHandoffRequests.values()) {
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.resolve({ status: "stopped", keys: [] });
      }
      aesKeyHandoffRequests.clear();
      for (const pendingRequest of youtubeMediaHandoffRequests.values()) {
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.resolve({ status: "stopped", handoff: null });
      }
      youtubeMediaHandoffRequests.clear();
      for (const pendingRequest of playerOutputCanaryRequests.values()) {
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.resolve({ status: "stopped", canary: null });
      }
      playerOutputCanaryRequests.clear();
      for (const pendingRequest of playerOutputCaptureStartRequests.values()) {
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.resolve({ status: "stopped" });
      }
      playerOutputCaptureStartRequests.clear();
      for (const pendingRequest of playerOutputCaptureReloadRequests.values()) {
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.resolve({ status: "stopped" });
      }
      playerOutputCaptureReloadRequests.clear();
    };
    function requestAesKeyHandoff(requestedManifestUrl, manifestUrls) {
      if (typeof requestedManifestUrl !== "string" || !/^https?:/i.test(requestedManifestUrl)) {
        return Promise.resolve({ status: "invalid_manifest", keys: [] });
      }
      const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          aesKeyHandoffRequests.delete(requestId);
          resolve({ status: "timeout", keys: [] });
        }, 5e3);
        aesKeyHandoffRequests.set(requestId, { resolve, timeoutId });
        window.postMessage(
          {
            source: "adsfriendly-content",
            type: "GET_MEDIA_AES_KEY_HANDOFF",
            requestId,
            requestedManifestUrl,
            manifestUrls
          },
          "*"
        );
      });
    }
    function requestYouTubeMediaHandoff() {
      const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          youtubeMediaHandoffRequests.delete(requestId);
          resolve({ status: "timeout", handoff: null });
        }, 3e3);
        youtubeMediaHandoffRequests.set(requestId, { resolve, timeoutId });
        window.postMessage(
          {
            source: "adsfriendly-content",
            type: "GET_YOUTUBE_MEDIA_HANDOFF",
            requestId
          },
          "*"
        );
      });
    }
    function requestPlayerOutputCanary() {
      const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          playerOutputCanaryRequests.delete(requestId);
          resolve({ status: "timeout", canary: null });
        }, 5e3);
        playerOutputCanaryRequests.set(requestId, { resolve, timeoutId });
        window.postMessage(
          {
            source: "adsfriendly-content",
            type: "GET_PLAYER_OUTPUT_CANARY",
            requestId
          },
          "*"
        );
      });
    }
    function requestPlayerOutputCaptureStart(captureId) {
      const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          playerOutputCaptureStartRequests.delete(requestId);
          resolve({ status: "timeout" });
        }, 5e3);
        playerOutputCaptureStartRequests.set(requestId, { resolve, timeoutId });
        window.postMessage(
          {
            source: "adsfriendly-content",
            type: "START_PLAYER_OUTPUT_CAPTURE",
            requestId,
            captureId
          },
          "*"
        );
      });
    }
    function requestPlayerOutputCaptureReload(captureId) {
      const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          playerOutputCaptureReloadRequests.delete(requestId);
          resolve({ status: "timeout" });
        }, 5e3);
        playerOutputCaptureReloadRequests.set(requestId, { resolve, timeoutId });
        window.postMessage(
          {
            source: "adsfriendly-content",
            type: "PREPARE_PLAYER_OUTPUT_CAPTURE_RELOAD",
            requestId,
            captureId
          },
          "*"
        );
      });
    }
    function forwardPlayerOutputChunk(message) {
      chrome.runtime.sendMessage({
        type: "PLAYER_OUTPUT_CAPTURE_CHUNK",
        captureId: message.captureId,
        trackId: message.trackId,
        sequence: message.sequence,
        mimeType: message.mimeType,
        appendFormat: message.appendFormat,
        processedSeconds: message.processedSeconds,
        duration: message.duration,
        data: message.data
      }).then((response) => {
        window.postMessage(
          {
            source: "adsfriendly-content",
            type: "PLAYER_OUTPUT_CAPTURE_ACK",
            requestId: message.requestId,
            status: response?.status,
            error: response?.error || response?.reason || null
          },
          "*"
        );
      }).catch((error) => {
        window.postMessage(
          {
            source: "adsfriendly-content",
            type: "PLAYER_OUTPUT_CAPTURE_ACK",
            requestId: message.requestId,
            status: "error",
            error: error?.message || String(error)
          },
          "*"
        );
      });
    }
    function scanElement(element) {
      if (stopped || !element) return;
      if (element.matches?.("video")) observeVideo(element);
      if (element.matches?.("video, source")) reportElementSource(element);
      element.querySelectorAll?.("video").forEach(observeVideo);
      element.querySelectorAll?.("video, video source").forEach(reportElementSource);
    }
    function observeVideo(video) {
      if (videoListeners.has(video)) return;
      const listener = (event2) => {
        reportElementSource(video, event2?.type || "initial");
        video.querySelectorAll("source").forEach(reportElementSource);
      };
      videoListeners.set(video, listener);
      for (const eventType of VIDEO_OBSERVATION_EVENTS)
        video.addEventListener(eventType, listener);
      videoVisibilityObserver?.observe(video);
      listener({ type: "initial" });
    }
    function reportElementSource(element, playbackTrigger = null) {
      const sourceUrl = element.currentSrc || element.src || element.getAttribute?.("src");
      const mimeType = element.currentType || element.type || element.getAttribute?.("type");
      const duration = element.matches?.("video") && Number.isFinite(element.duration) ? element.duration : null;
      const resolution = element.matches?.("video") ? {
        width: Number(element.videoWidth) || null,
        height: Number(element.videoHeight) || null
      } : null;
      const playback = element.matches?.("video") ? {
        playing: element.paused === false && element.ended !== true,
        visible: isVisibleVideo(element),
        muted: element.muted === true,
        currentTime: Number.isFinite(element.currentTime) ? element.currentTime : null,
        observedAt: Date.now()
      } : null;
      const candidate = reportSource(
        sourceUrl,
        mimeType,
        MEDIA_DETECTION_SOURCES.DOM,
        duration,
        resolution,
        playback
      );
      if (element.matches?.("video")) {
        reportPlaybackObservation(
          element,
          candidate?.id || null,
          playbackTrigger || "initial"
        );
      }
    }
    function reportSource(sourceUrl, mimeType, detectedBy, duration = null, resolution = null, playback = null) {
      const candidate = createYouTubeCandidateFromObservedSource({
        pageUrl: location.href,
        sourceUrl,
        mimeType,
        title: document.title || null
      }) || createMediaCandidateFromSource({
        pageUrl: location.href,
        sourceUrl,
        mimeType,
        title: document.title || null,
        duration,
        resolution,
        playback,
        detectedBy
      });
      if (!candidate) return null;
      reportEvent(createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
      return candidate;
    }
    function reportPlaybackObservation(video, mediaId, trigger) {
      const observation = playbackTracker.observe(video, {
        pageUrl: location.href,
        mediaId,
        trigger,
        visible: isVisibleVideo(video)
      });
      if (!observation) return;
      reportEvent(
        createRegisteredEvent(EVENTS.MEDIA_PLAYBACK_OBSERVED, observation)
      );
    }
    function isVisibleVideo(video) {
      try {
        const rect = video.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const visibleWidth = Math.max(
          0,
          Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
        );
        const visibleHeight = Math.max(
          0,
          Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
        );
        return rect.width > 0 && rect.height > 0 && visibleWidth * visibleHeight >= rect.width * rect.height * 0.25;
      } catch {
        return false;
      }
    }
    function reportEvent(event2) {
      if (stopped) return;
      const reportKey = createMediaObserverReportKey(event2);
      if (reported.has(reportKey) || pending.has(reportKey)) return;
      pending.add(reportKey);
      chrome.runtime.sendMessage({
        type: event2.type === EVENTS.MEDIA_PROBED ? "MEDIA_PROBED" : event2.type === EVENTS.MEDIA_PROBE_DIAGNOSTIC ? "MEDIA_PROBE_DIAGNOSTIC" : event2.type === EVENTS.MEDIA_BLOB_TRACED ? "MEDIA_BLOB_TRACED" : event2.type === EVENTS.MEDIA_EME_OBSERVED ? "MEDIA_EME_OBSERVED" : event2.type === EVENTS.MEDIA_PLAYBACK_OBSERVED ? "MEDIA_PLAYBACK_OBSERVED" : "MEDIA_DISCOVERED",
        event: event2
      }).then((response) => {
        pending.delete(reportKey);
        if (response?.status === "recorded") {
          rememberReportedKey(reported, reportKey);
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
        parentDocumentUrl: document.referrer,
        frameDocumentUrl: location.href
      }).then((response) => {
        if (stopped) return;
        if (response?.status !== "prepared") {
          reportProbeDiagnostic(
            { id: mediaId, kind, manifestUrl },
            "failed",
            `contextual_probe_${response?.status || "failed"}`
          );
          return;
        }
        reportProbeDiagnostic(
          { id: mediaId, kind, manifestUrl },
          "dispatched",
          "contextual_probe_prepared"
        );
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
    function saveDecryptedManifestHandoff(handoff, attempt = 0) {
      if (stopped || !handoff) return;
      chrome.runtime.sendMessage({
        type: "SAVE_DECRYPTED_MEDIA_MANIFEST",
        handoff
      }).then((response) => {
        if (response?.status !== "catalog_pending" || attempt >= 4) return;
        const retryId = setTimeout(
          () => {
            retryTimers.delete(retryId);
            saveDecryptedManifestHandoff(handoff, attempt + 1);
          },
          100 * (attempt + 1)
        );
        retryTimers.add(retryId);
      }).catch(() => {
      });
    }
  }
  function createMediaObserverReportKey(event2) {
    const payload = event2?.payload || {};
    const mediaId = payload.id || payload.mediaId || "unknown";
    if (event2?.type === EVENTS.MEDIA_DISCOVERED) {
      const playbackKey = payload.playback ? `:${payload.playback.playing ? "playing" : "paused"}:${payload.playback.visible ? "visible" : "hidden"}` : "";
      if (payload.kind === "adaptive") {
        const videoTracks = (payload.variants || []).map((track) => track.id || track.itag || track.sourceUrl).filter(Boolean).join(",");
        const audioTracks = (payload.audioTracks || []).map((track) => track.id || track.itag || track.sourceUrl).filter(Boolean).join(",");
        const acquisition = payload.acquisitionDiagnostic;
        return `${event2.type}:${mediaId}:${payload.detectedBy || "unknown"}:video=${videoTracks || "none"}:audio=${audioTracks || "none"}:stage=${acquisition?.stage || "none"}:direct=${acquisition?.directVideoCount || 0}+${acquisition?.directAudioCount || 0}${playbackKey}`;
      }
      const playbackDuration = payload.kind === "blob" && Number.isFinite(payload.duration) ? Math.round(payload.duration) : "unknown";
      return `${event2.type}:${mediaId}:${payload.detectedBy || "unknown"}:${playbackDuration}:${payload.resolution?.width || 0}x${payload.resolution?.height || 0}${playbackKey}`;
    }
    if (event2?.type === EVENTS.MEDIA_BLOB_TRACED) {
      return [
        event2.type,
        mediaId,
        payload.sourceUrls?.length || 0,
        payload.candidateIds?.join(",") || "none",
        Math.floor((payload.appendCount || 0) / 10),
        payload.observerDocumentState || "unknown"
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
    if (event2?.type === EVENTS.MEDIA_PLAYBACK_OBSERVED) {
      return [
        event2.type,
        payload.sessionId,
        payload.mediaId || "unlinked",
        payload.state,
        payload.trigger,
        payload.visible ? "visible" : "hidden",
        Math.floor((payload.currentTime || 0) / 5)
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
  function rememberReportedKey(reported, reportKey) {
    reported.add(reportKey);
    while (reported.size > MAX_REPORTED_EVENT_KEYS) {
      const oldest = reported.values().next().value;
      if (oldest === void 0) return;
      reported.delete(oldest);
    }
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
  function formatAudioLanguageLabel({
    language = null,
    name = null,
    role = null,
    isDefault = false
  } = {}) {
    const locale = normalizedLocale(language);
    const baseName = englishLanguageName(locale?.language) || normalizedSourceName(name);
    const region = normalizedRegion(
      locale?.region || regionFromName(name),
      locale?.language
    );
    const effectiveRole = role || roleFromName(name);
    const qualifiers = [region, ROLE_LABELS[effectiveRole]].filter(Boolean);
    const identity = baseName || (isDefault ? "Default Audio" : "Audio");
    return qualifiers.length ? `${identity} (${qualifiers.join(", ")})` : identity;
  }
  function normalizedLocale(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      return new Intl.Locale(value.replace(/_/g, "-"));
    } catch {
      return null;
    }
  }
  function englishLanguageName(value) {
    if (!value) return null;
    try {
      return new Intl.DisplayNames(["en"], { type: "language" }).of(value);
    } catch {
      return null;
    }
  }
  function normalizedSourceName(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const withoutQualifiers = value.replace(/\s*\([^)]*\)\s*$/u, "").trim();
    return LOCALIZED_LANGUAGE_NAMES[withoutQualifiers.toLowerCase()] || withoutQualifiers;
  }
  function regionFromName(value) {
    if (typeof value !== "string") return null;
    return value.match(/\((US|UK|GB|United States|United Kingdom)\b/i)?.[1] || null;
  }
  function normalizedRegion(value, language) {
    if (!value) return null;
    const region = String(value).toUpperCase();
    if (language === "vi" && region === "VN" || language === "zh" && region === "CN" || language === "ja" && region === "JP" || language === "ko" && region === "KR")
      return null;
    if (region === "UNITED STATES") return "US";
    if (region === "UNITED KINGDOM") return "UK";
    return region === "GB" ? "UK" : region;
  }
  function roleFromName(value) {
    if (typeof value !== "string") return null;
    const qualifier = value.match(/\(([^)]*)\)\s*$/u)?.[1]?.toLowerCase() || "";
    if (/\boriginal\b/.test(qualifier)) return "original";
    if (/\bauto[- ]?dubbed\b/.test(qualifier)) return "auto_dubbed";
    if (/\bdubbed\b/.test(qualifier)) return "dubbed";
    return null;
  }

  // src/media/download-options.js
  var MEDIA_OUTPUT_CONTAINERS = Object.freeze({
    SOURCE: "source",
    MP4: "mp4",
    MKV: "mkv",
    OGG: "ogg"
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
    const profiles = [];
    if (candidate.kind !== "adaptive" || (candidate.variants || []).length) {
      profiles.push(
        Object.freeze({
          id: "video-mp4",
          container: MEDIA_OUTPUT_CONTAINERS.MP4,
          extension: ".mp4",
          label: "MP4 \xB7 compatible",
          description: "Best compatibility for browsers, phones, and TVs."
        })
      );
    }
    if (candidate.provider === "youtube" && (candidate.audioTracks || []).length) {
      profiles.push(
        Object.freeze({
          id: "audio-ogg",
          container: MEDIA_OUTPUT_CONTAINERS.OGG,
          extension: ".ogg",
          label: "Audio \xB7 OGG",
          description: "Download the best available YouTube audio as an OGG file."
        })
      );
    }
    if (canSelectContainer && (candidate.kind !== "adaptive" || (candidate.variants || []).length)) {
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
  function getMediaAudioTrackOptions(candidate = {}) {
    if (candidate.kind !== "adaptive") return [];
    return uniqueObjects(candidate.audioTracks || []).filter((track) => isAcquirableAdaptiveTrack(candidate, track)).sort(compareAudioPreference).map(
      (track) => Object.freeze({
        id: track.id,
        label: audioTrackLabel(track),
        language: track.language || null,
        role: track.audioRole || null,
        isOriginal: track.audioRole === "original",
        isDefault: track.audioIsDefault === true,
        estimatedBytes: positiveInteger2(track.contentLength)
      })
    );
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
        groupLabel: videoQualityGroupLabel(track),
        optionLabel: videoQualityOptionLabel(track),
        height: positiveInteger2(track.resolution?.height || track.height),
        muxed: track.muxed === true,
        estimatedBytes: positiveInteger2(track.contentLength)
      })
    );
  }
  function compareVideoQuality(left, right) {
    return (right.resolution?.height || right.height || 0) - (left.resolution?.height || left.height || 0) || qualityFps(right) - qualityFps(left) || videoCompatibilityScore(right) - videoCompatibilityScore(left) || (right.averageBandwidth || right.bandwidth || 0) - (left.averageBandwidth || left.bandwidth || 0);
  }
  function videoQualityLabel(track) {
    return [videoQualityGroupLabel(track), videoQualityOptionLabel(track)].filter(Boolean).join(" \xB7 ");
  }
  function videoQualityGroupLabel(track) {
    const quality = track.qualityLabel || (track.resolution?.height || track.height ? `${track.resolution?.height || track.height}p` : "Source quality");
    return quality;
  }
  function videoQualityOptionLabel(track) {
    const format = String(track.mimeType || "").includes("webm") ? "WebM" : String(track.mimeType || "").includes("mp4") ? "MP4" : null;
    const codec = codecLabel(track.codecs);
    return [format, codec, track.muxed === true ? "audio included" : null].filter(Boolean).join(" \xB7 ");
  }
  function qualityFps(track) {
    const explicit = positiveInteger2(track.fps);
    if (explicit) return explicit;
    return positiveInteger2(String(track.qualityLabel || "").match(/p(\d+)$/i)?.[1]) || 0;
  }
  function videoCompatibilityScore(track) {
    const mime = String(track.mimeType || "").toLowerCase();
    const codec = String(track.codecs || "").toLowerCase();
    if (mime.includes("mp4") && (codec.includes("avc1") || codec.includes("avc3")))
      return 40;
    if (mime.includes("mp4") && codec.includes("av01")) return 30;
    if (mime.includes("webm") && (codec.includes("vp9") || codec.includes("vp09")))
      return 20;
    if (mime.includes("mp4")) return 10;
    return 0;
  }
  function codecLabel(value) {
    const codec = String(value || "").toLowerCase();
    if (codec.includes("avc1") || codec.includes("avc3")) return "H.264";
    if (codec.includes("av01")) return "AV1";
    if (codec.includes("vp9") || codec.includes("vp09")) return "VP9";
    if (codec.includes("hev1") || codec.includes("hvc1")) return "HEVC";
    if (codec.includes("mp4a") || codec.includes("aac")) return "AAC";
    if (codec.includes("opus")) return "Opus";
    if (codec.includes("vorbis")) return "Vorbis";
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
  function getMediaDownloadEstimate(candidate = {}, displayItem = null, { videoTrackId = null, audioTrackId = null, audioOnly = false } = {}) {
    const presentation = displayItem || candidate;
    const resolved = presentation.resolvedStream || candidate.resolvedStream;
    const allVariants = uniqueObjects([
      ...candidate.variants || [],
      ...presentation.variants || []
    ]);
    const variants = (candidate.kind === "adaptive" ? allVariants.filter(
      (track) => isAcquirableAdaptiveTrack(candidate, track)
    ) : allVariants).sort(compareBandwidth);
    const selectedVariant = audioOnly ? null : variants.find((variant) => variant.id === videoTrackId) || variants[0] || null;
    const resolution = resolved?.resolution || (candidate.kind === "adaptive" ? selectedVariant?.resolution : null) || candidate.resolution || presentation.resolution || selectedVariant?.resolution || null;
    const duration = firstPositiveNumber(
      resolved?.duration,
      candidate.duration,
      presentation.duration
    );
    let bandwidth = firstPositiveNumber(
      audioOnly ? null : resolved?.bandwidth,
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
        (track) => (candidate.kind !== "adaptive" || isAcquirableAdaptiveTrack(candidate, track)) && (!audioTrackId || track.id === audioTrackId)
      ).map(
        (track) => firstPositiveNumber(track.averageBandwidth, track.bandwidth)
      ).filter(Boolean).sort((left, right) => right - left)[0];
      if (audioBandwidth) bandwidth += audioBandwidth;
    }
    if (audioOnly) {
      bandwidth = firstPositiveNumber(
        ...(candidate.audioTracks || []).filter((track) => !audioTrackId || track.id === audioTrackId).map((track) => track.averageBandwidth || track.bandwidth)
      );
    }
    const adaptiveBytes = candidate.kind === "adaptive" ? adaptiveContentLength(
      candidate,
      selectedVariant,
      audioOnly,
      audioTrackId
    ) : null;
    const directBytes = candidate.kind === "direct" ? positiveInteger2(candidate.contentLength || presentation.contentLength) : null;
    const estimatedBytes = directBytes || adaptiveBytes || (duration && bandwidth ? Math.round(duration * bandwidth / 8) : null);
    return Object.freeze({
      resolution: resolution ? {
        width: positiveInteger2(resolution.width),
        height: positiveInteger2(resolution.height)
      } : null,
      duration,
      bandwidth,
      estimatedBytes,
      basis: estimatedBytes ? directBytes ? "source_headers" : candidate.kind === "adaptive" ? adaptiveBytes ? "track_content_length" : "track_bitrate" : "manifest_bandwidth" : null
    });
  }
  function adaptiveContentLength(candidate, selectedVariant = null, audioOnly = false, audioTrackId = null) {
    if (audioOnly) {
      const audio2 = [...candidate.audioTracks || []].filter(
        (track) => isAcquirableAdaptiveTrack(candidate, track) && (!audioTrackId || track.id === audioTrackId)
      ).sort(compareAudioPreference)[0]?.contentLength;
      const total2 = Number(audio2) || 0;
      return Number.isSafeInteger(total2) && total2 > 0 ? total2 : null;
    }
    const video = selectedVariant?.contentLength || [...candidate.variants || []].sort(compareBandwidth)[0]?.contentLength;
    if (selectedVariant?.muxed === true) {
      const total2 = Number(video) || 0;
      return Number.isSafeInteger(total2) && total2 > 0 ? total2 : null;
    }
    const audio = [...candidate.audioTracks || []].filter(
      (track) => isAcquirableAdaptiveTrack(candidate, track) && (!audioTrackId || track.id === audioTrackId)
    ).sort(compareAudioPreference)[0]?.contentLength;
    const total = (Number(video) || 0) + (Number(audio) || 0);
    return Number.isSafeInteger(total) && total > 0 ? total : null;
  }
  function compareAudioPreference(left, right) {
    return audioRoleScore(right) - audioRoleScore(left) || Number(right.audioIsDefault === true) - Number(left.audioIsDefault === true) || Number(left.isDrc === true) - Number(right.isDrc === true) || compareBandwidth(left, right) || mp4AudioScore(right) - mp4AudioScore(left);
  }
  function audioRoleScore(track) {
    return {
      original: 50,
      secondary: 30,
      dubbed: 20,
      auto_dubbed: 10,
      descriptive: 5
    }[track.audioRole] || 25;
  }
  function audioTrackLabel(track) {
    const language = formatAudioLanguageLabel({
      language: track.language,
      name: track.audioTrackName,
      role: track.audioRole,
      isDefault: track.audioIsDefault === true
    });
    const codec = codecLabel(track.codecs);
    const bitrate = audioBitrateLabel(
      firstPositiveNumber(track.averageBandwidth, track.bandwidth)
    );
    return [
      language,
      bitrate,
      codec,
      audioChannelsLabel(track.audioChannels),
      audioSampleRateLabel(track.audioSampleRate),
      track.isDrc ? "DRC" : null
    ].filter(Boolean).join(" \xB7 ");
  }
  function audioBitrateLabel(value) {
    const bitrate = positiveInteger2(value);
    return bitrate ? `${Math.round(bitrate / 1e3)} kbps` : null;
  }
  function audioChannelsLabel(value) {
    const channels = positiveInteger2(value);
    if (channels === 1) return "Mono";
    if (channels === 2) return "Stereo";
    return channels ? `${channels} channels` : null;
  }
  function audioSampleRateLabel(value) {
    const rate = positiveInteger2(value);
    if (!rate) return null;
    const khz = rate / 1e3;
    return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
  }
  function mp4AudioScore(track) {
    return /\/(?:mp4|m4a)(?:$|;)/i.test(track.mimeType || "") ? 1 : 0;
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
  function positiveInteger2(value) {
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
      const audioOnlyYouTube = candidate.provider === "youtube" && !variants.length && audioTracks.length > 0;
      if (!variants.length && !audioOnlyYouTube || !audioTracks.length && !hasMuxedTrack && !audioOnlyYouTube)
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
      id: optionalString2(track.id) || `${expectedType}-${index + 1}`,
      type: expectedType,
      sourceUrl: isYouTubeProviderResolvableTrack(candidate, track) ? null : requiredHttpUrl(
        track.sourceUrl || track.url,
        `candidate.${expectedType}Tracks[${index}].sourceUrl`
      ),
      mimeType: optionalString2(track.mimeType),
      codecs: optionalString2(track.codecs),
      itag: optionalString2(track.itag),
      bandwidth: optionalFiniteNumber2(track.bandwidth),
      averageBandwidth: optionalFiniteNumber2(track.averageBandwidth),
      contentLength: optionalNonNegativeInteger2(track.contentLength),
      width: optionalNonNegativeInteger2(track.width || track.resolution?.width),
      height: optionalNonNegativeInteger2(
        track.height || track.resolution?.height
      ),
      resolution: track.resolution && typeof track.resolution === "object" ? {
        width: optionalNonNegativeInteger2(track.resolution.width),
        height: optionalNonNegativeInteger2(track.resolution.height)
      } : null,
      qualityLabel: optionalString2(track.qualityLabel),
      urlResolution: Object.values(ADAPTIVE_TRACK_RESOLUTION).includes(
        track.urlResolution
      ) ? track.urlResolution : "resolved",
      signatureCipher: optionalString2(track.signatureCipher),
      muxed: track.muxed === true,
      requestUserAgent: optionalString2(track.requestUserAgent),
      providerClient: optionalString2(track.providerClient),
      requestMode: optionalEnumValue2(
        track.requestMode,
        ["youtube_query_range", "http_range"],
        `candidate.${expectedType}Tracks[${index}].requestMode`
      ),
      requestCpn: typeof track.requestCpn === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(track.requestCpn) ? track.requestCpn : null,
      language: optionalString2(track.language),
      audioTrackId: optionalString2(track.audioTrackId),
      audioTrackName: optionalString2(track.audioTrackName),
      audioRole: optionalEnumValue2(
        track.audioRole,
        ["original", "dubbed", "auto_dubbed", "descriptive", "secondary"],
        `candidate.${expectedType}Tracks[${index}].audioRole`
      ),
      audioIsDefault: track.audioIsDefault === true,
      isDrc: track.isDrc === true,
      audioSampleRate: optionalNonNegativeInteger2(track.audioSampleRate),
      audioChannels: optionalNonNegativeInteger2(track.audioChannels),
      audioQuality: optionalString2(track.audioQuality)
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
  function requiredString2(value, field) {
    if (typeof value !== "string" || !value.trim())
      throw new Error(`[MediaDownload] ${field} is required.`);
    return value;
  }
  function requiredHttpUrl(value, field) {
    const url = requiredString2(value, field);
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
  function optionalString2(value) {
    return typeof value === "string" && value ? value : null;
  }
  function optionalEnumValue2(value, allowed, field) {
    if (value === null || value === void 0 || value === "") return null;
    if (!allowed.includes(value))
      throw new Error(`[MediaDownload] ${field} is invalid.`);
    return value;
  }
  function optionalFiniteNumber2(value) {
    if (value === null || value === void 0) return null;
    return finiteNumber(value, "optional number");
  }
  function optionalNonNegativeInteger2(value) {
    if (value === null || value === void 0) return null;
    return nonNegativeInteger(value, "optional integer");
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
  function selectVisibleMediaItems(items = [], maximum = 8) {
    const diagnosedItems = items.map((item) => ({
      ...item,
      resolutionDiagnostic: diagnoseMediaResolution(item, items)
    }));
    const displayItems = prioritizeFacebookPlayback(
      groupFacebookDirectRepresentations(diagnosedItems)
    );
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
    const sorted = [...displayItems].sort(
      (left, right) => playbackPriority(right) - playbackPriority(left) || (right.firstSeenAt || 0) - (left.firstSeenAt || 0) || String(left.id || "").localeCompare(String(right.id || ""))
    );
    const visible = [];
    const adaptivePages = new Set(
      displayItems.filter((item) => item.kind === "adaptive").map((item) => item.pageUrl)
    );
    const blobGroups = /* @__PURE__ */ new Map();
    const directGroups = /* @__PURE__ */ new Map();
    const resolvedBlobGroupKeys = resolvedBlobGroupKeysByPage(diagnosedItems);
    for (const item of sorted) {
      if (item.kind === "blob" && adaptivePages.has(item.pageUrl)) continue;
      if (item.kind !== "blob" && blobResolvedSourceIds.has(item.id)) continue;
      if (item.kind === "hls" && item.parentManifestIds?.length) continue;
      if (item.kind === "direct") {
        const key2 = directMediaGroupKey(item);
        const existing2 = directGroups.get(key2);
        if (existing2) {
          existing2.relatedCount += 1;
          continue;
        }
        const grouped2 = { ...item, relatedCount: 1 };
        directGroups.set(key2, grouped2);
        visible.push(grouped2);
        continue;
      }
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
  function playbackPriority(item) {
    if (item.playback?.playing === true) return 2;
    if (item.playback?.visible === true) return 1;
    return 0;
  }
  function groupFacebookDirectRepresentations(items) {
    const groups = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (item.kind !== "direct") continue;
      const key = facebookMediaAssetKey(item);
      if (!key) continue;
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }
    const consumed = /* @__PURE__ */ new Set();
    const synthetic = [];
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      const adaptive = createFacebookAdaptiveGroup(key, group);
      if (!adaptive) continue;
      group.forEach((item) => consumed.add(item.id));
      synthetic.push(adaptive);
    }
    return [
      ...items.filter(
        (item) => !consumed.has(item.id) && !isFacebookAudioTrack(item)
      ),
      ...synthetic
    ];
  }
  function prioritizeFacebookPlayback(items) {
    const facebookItems = items.filter(isFacebookMediaItem);
    if (facebookItems.length <= 1) return items;
    const playing = facebookItems.filter((item) => item.playback?.playing);
    const visible = facebookItems.filter((item) => item.playback?.visible);
    const preferred = playing.length ? playing : visible.length ? visible : [...facebookItems].sort(
      (left, right) => (right.lastSeenAt || right.firstSeenAt || 0) - (left.lastSeenAt || left.firstSeenAt || 0)
    ).slice(0, 1);
    const preferredIds = new Set(preferred.map((item) => item.id));
    return items.filter(
      (item) => !isFacebookMediaItem(item) || preferredIds.has(item.id)
    );
  }
  function isFacebookMediaItem(item) {
    if (item.provider === "facebook") return true;
    try {
      return item.kind === "direct" && isFacebookCdnHost(new URL(item.sourceUrl).hostname);
    } catch {
      return false;
    }
  }
  function createFacebookAdaptiveGroup(key, items) {
    const audioItems = items.filter(isFacebookAudioTrack);
    const representations = collapseFacebookRepresentations(
      items.filter((item) => !isFacebookAudioTrack(item))
    );
    if (!representations.length) return null;
    const sorted = [...representations].sort(
      (left, right) => facebookQualityScore(right) - facebookQualityScore(left) || (right.contentLength || 0) - (left.contentLength || 0) || (right.lastSeenAt || 0) - (left.lastSeenAt || 0)
    );
    const primary = sorted[0];
    const variants = sorted.map((item, index) => ({
      id: item.id,
      type: "video",
      sourceUrl: facebookFullMediaUrl(item.sourceUrl),
      mimeType: item.mimeType || "video/mp4",
      codecs: null,
      itag: null,
      bandwidth: item.bandwidth || null,
      averageBandwidth: item.averageBandwidth || null,
      contentLength: facebookUrlHasByteLimit(item.sourceUrl) ? null : item.contentLength || null,
      width: item.resolution?.width || null,
      height: item.resolution?.height || null,
      qualityLabel: facebookQualityLabel(item) || `Source ${index + 1}`,
      urlResolution: "resolved",
      signatureCipher: null,
      muxed: !isFacebookDashTrack(item)
    }));
    const audioTracks = createFacebookAudioTracks(audioItems);
    return {
      ...primary,
      id: stableMediaId("adaptive", key),
      kind: "adaptive",
      provider: "facebook",
      title: primary.title && !/^(?:\(\d+\+?\)\s*)?facebook$/i.test(primary.title.trim()) ? primary.title : "Facebook video",
      sourceUrl: facebookFullMediaUrl(primary.sourceUrl),
      contentLength: facebookUrlHasByteLimit(primary.sourceUrl) ? null : primary.contentLength || null,
      mimeType: "video/mp4",
      variants,
      audioTracks,
      subtitles: [],
      acquisitionProfile: "facebook_direct_representations",
      probeStatus: "ready",
      streamType: "vod",
      relatedCount: items.length,
      playback: newestPlaybackState(items),
      firstSeenAt: Math.min(...items.map((item) => item.firstSeenAt || 0)),
      lastSeenAt: Math.max(...items.map((item) => item.lastSeenAt || 0))
    };
  }
  function createFacebookAudioTracks(items) {
    if (!items.length) return [];
    const selected = [...items].sort(
      (left, right) => facebookAudioScore(right) - facebookAudioScore(left) || facebookObservationTime(right) - facebookObservationTime(left)
    )[0];
    return [
      {
        id: selected.id,
        type: "audio",
        sourceUrl: facebookFullMediaUrl(selected.sourceUrl),
        mimeType: selected.mimeType || "audio/mp4",
        codecs: null,
        bandwidth: selected.bandwidth || null,
        averageBandwidth: selected.averageBandwidth || null,
        contentLength: facebookUrlHasByteLimit(selected.sourceUrl) ? null : selected.contentLength || null,
        qualityLabel: "Facebook audio",
        urlResolution: "resolved",
        signatureCipher: null,
        muxed: false,
        language: null,
        audioTrackName: "Facebook audio",
        audioRole: "original",
        audioIsDefault: true
      }
    ];
  }
  function isFacebookAudioTrack(item) {
    const mimeType = String(item?.mimeType || "").toLowerCase();
    if (mimeType.startsWith("audio/")) return true;
    const tag = facebookEncodingTag(item?.sourceUrl);
    return /(?:^|[_-])(?:audio|aac|opus)(?:[_-]|$)/i.test(tag || "");
  }
  function isFacebookDashTrack(item) {
    return /(?:^|[_-])dash(?:[_-]|$)/i.test(
      facebookEncodingTag(item?.sourceUrl) || ""
    );
  }
  function facebookAudioScore(item) {
    const bandwidth = item.averageBandwidth || item.bandwidth;
    if (Number.isFinite(bandwidth) && bandwidth > 0) return bandwidth;
    const tag = facebookEncodingTag(item.sourceUrl) || "";
    const kilobits = Number(
      tag.match(/(?:audio|aac|opus)[_-]?(\d{2,3})(?:k|kbps)?/i)?.[1]
    );
    return Number.isFinite(kilobits) ? kilobits * 1e3 : 0;
  }
  function collapseFacebookRepresentations(items) {
    const representations = /* @__PURE__ */ new Map();
    for (const item of items) {
      const quality = facebookQualityLabel(item);
      const key = quality?.toLowerCase() || "source";
      const existing = representations.get(key);
      if (!existing || facebookObservationTime(item) >= facebookObservationTime(existing))
        representations.set(key, item);
    }
    return [...representations.values()];
  }
  function facebookObservationTime(item) {
    return item.playback?.observedAt || item.lastSeenAt || item.firstSeenAt || 0;
  }
  function facebookFullMediaUrl(value) {
    try {
      const url = new URL(value || "");
      for (const name of ["range", "bytestart", "byteend"])
        url.searchParams.delete(name);
      return url.href;
    } catch {
      return value;
    }
  }
  function facebookUrlHasByteLimit(value) {
    try {
      const url = new URL(value || "");
      return ["range", "bytestart", "byteend"].some(
        (name) => url.searchParams.has(name)
      );
    } catch {
      return false;
    }
  }
  function newestPlaybackState(items) {
    const states = items.map((item) => item.playback).filter(Boolean).sort((left, right) => (right.observedAt || 0) - (left.observedAt || 0));
    if (!states.length) return null;
    const active = states.find((state) => state.playing) || states[0];
    return {
      ...active,
      playing: states.some((state) => state.playing),
      visible: states.some((state) => state.visible)
    };
  }
  function facebookMediaAssetKey(item) {
    try {
      const source = new URL(item.sourceUrl || "");
      if (!isFacebookCdnHost(source.hostname)) return null;
      const envelope = decodeFacebookEfg(source.searchParams.get("efg"));
      const assetId = findFacebookAssetId(envelope);
      if (assetId) return `facebook-asset:${assetId}`;
      const pageId = facebookPageVideoId(item.pageUrl);
      return pageId ? `facebook-page:${pageId}` : null;
    } catch {
      return null;
    }
  }
  function decodeFacebookEfg(value) {
    if (typeof value !== "string" || !value || value.length > 1e4)
      return null;
    try {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }
  function findFacebookAssetId(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 2) return null;
    for (const key of ["xpv_asset_id", "video_id", "asset_id"]) {
      const candidate = value[key];
      if (typeof candidate === "string" || Number.isSafeInteger(candidate))
        return String(candidate);
    }
    for (const child of Object.values(value)) {
      const candidate = findFacebookAssetId(child, depth + 1);
      if (candidate) return candidate;
    }
    return null;
  }
  function facebookPageVideoId(value) {
    try {
      const page = new URL(value || "");
      if (!(page.hostname === "facebook.com" || page.hostname.endsWith(".facebook.com")))
        return null;
      return page.searchParams.get("v") || page.pathname.match(/\/(?:reel|videos)\/(\d+)/i)?.[1] || null;
    } catch {
      return null;
    }
  }
  function facebookQualityLabel(item) {
    const tag = facebookEncodingTag(item.sourceUrl);
    const height = item.resolution?.height || Number(tag?.match(/(?:^|[^0-9])(\d{3,4})p/i)?.[1]);
    if (height) return `${height}p`;
    if (/\bhd\b/i.test(tag || "")) return "HD";
    if (/\bsd\b/i.test(tag || "")) return "SD";
    return null;
  }
  function facebookQualityScore(item) {
    const label = facebookQualityLabel(item);
    const height = Number(label?.match(/^(\d+)p$/)?.[1]);
    if (height) return height;
    if (label === "HD") return 720;
    if (label === "SD") return 480;
    return 0;
  }
  function facebookEncodingTag(value) {
    try {
      const envelope = decodeFacebookEfg(new URL(value).searchParams.get("efg"));
      return typeof envelope?.vencode_tag === "string" ? envelope.vencode_tag : null;
    } catch {
      return null;
    }
  }
  function directMediaGroupKey(item) {
    const sourceUrl = item.sourceUrl || "";
    try {
      const url = new URL(sourceUrl);
      url.hash = "";
      if (isFacebookCdnHost(url.hostname))
        return `facebook:${url.pathname.toLowerCase()}`;
      for (const name of ["range", "bytestart", "byteend"])
        url.searchParams.delete(name);
      const entries = [...url.searchParams.entries()].sort(
        ([leftKey, left], [rightKey, right]) => leftKey.localeCompare(rightKey) || left.localeCompare(right)
      );
      url.search = "";
      for (const [name, value] of entries) url.searchParams.append(name, value);
      return url.href;
    } catch {
      return sourceUrl;
    }
  }
  function isFacebookCdnHost(value) {
    const host = String(value || "").toLowerCase();
    return host === "fbcdn.net" || host.endsWith(".fbcdn.net");
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
  function samePlaybackFrame(left, right) {
    if (Number.isInteger(left.frameId) && Number.isInteger(right.frameId))
      return left.frameId === right.frameId;
    return Boolean(
      left.frameUrl && right.frameUrl && left.frameUrl === right.frameUrl
    );
  }

  // src/media/player-download-target.js
  function readPlayerSource(video) {
    if (video.error || video.networkState === 3) return "";
    if (video.getAttribute("src")) return video.src;
    if (video.currentSrc) return video.currentSrc;
    const sources = [
      ...new Set(
        Array.from(video.querySelectorAll?.("source[src]") || []).filter((source) => source.getAttribute?.("src") !== "").map((source) => source.src).filter(Boolean)
      )
    ];
    return sources.length === 1 ? sources[0] : "";
  }
  function resolvePlayerDownloadTarget({
    sourceUrl,
    pageUrl,
    frameId,
    items = []
  }) {
    if (!sourceUrl) return null;
    const scoped = items.filter((item) => item.frameId === frameId);
    const displayed = selectVisibleMediaItems(scoped, Infinity);
    const raw = scoped.find((item) => sameSource(item.sourceUrl, sourceUrl));
    let matches = displayed.filter(
      (item) => sameSource(item.sourceUrl, sourceUrl) || item.variants?.some((track) => sameSource(track.sourceUrl, sourceUrl))
    );
    if (!matches.length && raw?.kind === "blob") {
      const ids = new Set(
        [raw.selectedMediaId, ...raw.blobTrace?.candidateIds || []].filter(
          Boolean
        )
      );
      matches = displayed.filter(
        (item) => ids.has(item.id) || item.selectedMediaId && ids.has(item.selectedMediaId)
      );
      if (!matches.length) {
        try {
          const page = new URL(pageUrl);
          const id = page.searchParams.get("v") || page.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
          if (id && /(^|\.)youtube\.com$/.test(page.hostname)) {
            matches = displayed.filter(
              (item) => item.provider === "youtube" && item.id === stableMediaId("adaptive", `youtube:${id}`)
            );
          }
        } catch {
        }
      }
    }
    if (matches.length !== 1) return null;
    const presentation = matches[0];
    const candidate = scoped.find((item) => item.id === presentation.selectedMediaId) || presentation;
    if (!getMediaDownloadAvailability(candidate).supported) return null;
    return { presentation, candidate };
  }
  function sameSource(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    try {
      const normalize = (value) => {
        const url = new URL(value);
        for (const key of ["range", "bytestart", "byteend"])
          url.searchParams.delete(key);
        url.hash = "";
        url.searchParams.sort();
        return url.href;
      };
      return normalize(left) === normalize(right);
    } catch {
      return false;
    }
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
    const downloadedBytes = finiteOrNull2(progress.downloadedBytes);
    const totalBytes = finiteOrNull2(progress.totalBytes ?? job.totalBytes);
    const processedSeconds = finiteOrNull2(progress.processedSeconds);
    const duration = finiteOrNull2(progress.duration);
    const { percent } = getDownloadProgress({ ...progress, totalBytes });
    return {
      percent,
      downloadedBytes,
      totalBytes,
      bytesPerSecond: finiteOrNull2(progress.bytesPerSecond),
      processedSeconds,
      duration,
      resumedBytes: finiteOrNull2(progress.resumedBytes),
      resumable: progress.resumable === true,
      connections: normalizeConnections(job.connections)
    };
  }
  function isMediaJobActive(job = {}) {
    return [...ACTIVE_STATUSES, "pausing", "cancelling"].includes(job.status);
  }
  function formatMediaJobTransferSummary(job = {}) {
    const progress = getMediaJobProgress(job);
    return [
      progress.percent !== null ? `${progress.percent}%` : null,
      `${formatBytes(progress.bytesPerSecond || 0)}/s`,
      job.status === "downloading" ? formatDownloadEta(job.progress) : null
    ].filter(Boolean).join(" \xB7 ");
  }
  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.round(value / 1024)} KB`;
  }
  function finiteOrNull2(value) {
    if (value === null || value === void 0 || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function normalizeConnections(value) {
    const connections = Number(value);
    return Number.isInteger(connections) && connections > 0 ? connections : 8;
  }

  // src/media/ui/download-history.js
  function downloadHistoryView(job, exact = true) {
    if (!job) return null;
    const active = isMediaJobActive(job);
    const missing = ["missing", "changed"].includes(job.fileStatus);
    if (!active && job.status !== "completed") return null;
    return {
      active,
      missing,
      status: active ? "Downloading" : "Completed",
      detail: active ? exact ? "This selection is already downloading." : "Another selection is downloading." : missing ? "Saved file is missing or has changed. You can download it again." : job.fileStatus === "unchecked" ? "Downloaded recently \xB7 file not checked" : exact ? "Downloaded recently" : "Another selection was downloaded recently",
      size: job.progress?.totalBytes || job.progress?.downloadedBytes || 0,
      canOpen: !active && !missing && Boolean(job.outputPath),
      canRepeat: exact && !active
    };
  }
  function createDownloadHistoryCard(job, { exact = true, open, folder, repeat, options, manager } = {}) {
    const view = downloadHistoryView(job, exact);
    if (!view) return null;
    const card = document.createElement("div");
    card.className = "media-download-history";
    card.setAttribute("role", "status");
    const status = document.createElement("strong");
    status.textContent = view.status;
    const detail = document.createElement("span");
    detail.textContent = view.detail;
    const metadata = document.createElement("span");
    metadata.textContent = [
      view.size ? formatBytes(view.size) : null,
      job.summary?.qualityLabel,
      job.summary?.profileLabel,
      job.summary?.audioLabel
    ].filter(Boolean).join(" \xB7 ");
    card.append(status, detail, metadata);
    const actions = document.createElement("div");
    actions.className = "media-download-history-actions";
    const action = (label, run) => {
      if (!run) return;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", async (event2) => {
        if (!event2.isTrusted) return;
        button.disabled = true;
        try {
          await run(event2);
        } catch (error) {
          detail.textContent = error?.message || "Action failed. Try again.";
        } finally {
          button.disabled = false;
        }
      });
      actions.append(button);
    };
    if (view.canOpen) {
      action("Open", open);
      action("Folder", folder);
    }
    if (view.canRepeat)
      action(view.missing ? "Download" : "Download again", repeat);
    if (view.active) action("View download", manager);
    action("Change options", options);
    card.append(actions);
    return card;
  }

  // src/media/ui/download-control.js
  function createMediaDownloadControl(item, downloadItem, tab, helper, {
    settings = null,
    qualityPreflightCache: youtubeQualityPreflightCache = /* @__PURE__ */ new Map(),
    setupMediaHelper,
    onStarted: updateMediaJobs = async () => {
    },
    initialSelection = {},
    onSelectionChange = () => {
    },
    onOutputChange = () => {
    },
    onController = () => {
    },
    openManager = null
  } = {}) {
    let preferred = initialSelection;
    let historyJob = null;
    let historyExact = true;
    let historyKey = null;
    let editing = false;
    let submitting = false;
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
    if (profiles.some((profile) => profile.id === preferred.profileId))
      profileSelect.value = preferred.profileId;
    const qualityOptions = getMediaVideoQualityOptions(downloadItem);
    const needsYouTubePreflight = downloadItem.kind === "adaptive" && downloadItem.provider === "youtube" && hasYouTubeProviderPendingTracks(downloadItem);
    const preflightKey = needsYouTubePreflight ? `${tab?.id || ""}|${downloadItem.id}` : null;
    let qualityVerdict = preflightKey ? youtubeQualityPreflightCache.get(preflightKey) || null : null;
    const qualitySelect = document.createElement("select");
    qualitySelect.className = "media-download-profile";
    qualitySelect.title = "Video quality";
    const audioTrackOptions = getMediaAudioTrackOptions(downloadItem);
    const audioSelect = document.createElement("select");
    audioSelect.className = "media-download-profile";
    audioSelect.title = "Audio track";
    const renderAudioOptions = () => {
      audioSelect.replaceChildren();
      const availableById = new Map(
        (qualityVerdict?.audioOptions || []).map((option) => [option.id, option])
      );
      const visibleAudio = needsYouTubePreflight ? audioTrackOptions.filter((option) => availableById.has(option.id)) : audioTrackOptions;
      if (!visibleAudio.length) {
        const option = document.createElement("option");
        option.textContent = needsYouTubePreflight && !qualityVerdict ? "Audio \xB7 Checking availability\u2026" : "Audio \xB7 unavailable";
        option.disabled = true;
        audioSelect.append(option);
        audioSelect.disabled = true;
        return;
      }
      for (const audio of visibleAudio) {
        const option = document.createElement("option");
        option.value = audio.id;
        option.textContent = audio.label;
        const verdict = availableById.get(audio.id);
        option.title = verdict?.sourceLabel || audio.label;
        audioSelect.append(option);
      }
      audioSelect.disabled = !availability.supported || visibleAudio.length < 2;
      const previous = [...audioSelect.options].find(
        (option) => option.textContent === preferred.audioLabel
      );
      if (previous) audioSelect.value = previous.value;
    };
    const renderQualityOptions = () => {
      qualitySelect.replaceChildren();
      if (profileSelect.value === "audio-ogg") {
        const option = document.createElement("option");
        option.textContent = "Audio only \xB7 OGG";
        option.title = "The selected audio track will be converted to OGG.";
        option.disabled = true;
        qualitySelect.append(option);
        qualitySelect.disabled = true;
        return;
      }
      if (needsYouTubePreflight && (helper.status !== "ready" || helper.canResolveYouTubeQualityPreflight !== true)) {
        const option = document.createElement("option");
        option.textContent = helper.status === "ready" ? "Quality \xB7 update helper to check" : "Quality \xB7 helper required";
        option.title = helper.status === "ready" ? "Update Media Helper to verify downloadable YouTube qualities." : "Connect Media Helper to verify downloadable YouTube qualities.";
        option.disabled = true;
        qualitySelect.append(option);
        qualitySelect.disabled = true;
        return;
      }
      if (needsYouTubePreflight && !qualityVerdict) {
        const option = document.createElement("option");
        option.textContent = "Quality \xB7 Checking availability\u2026";
        option.disabled = true;
        qualitySelect.append(option);
        qualitySelect.disabled = true;
        return;
      }
      if (needsYouTubePreflight && qualityVerdict?.status !== "ready") {
        const option = document.createElement("option");
        option.textContent = "Quality \xB7 unavailable";
        option.title = qualityVerdict?.reason || "No downloadable quality was found.";
        option.disabled = true;
        qualitySelect.append(option);
        qualitySelect.disabled = true;
        return;
      }
      const automaticQuality = document.createElement("option");
      automaticQuality.value = "";
      automaticQuality.textContent = needsYouTubePreflight ? "Quality \xB7 Auto (best available)" : "Quality \xB7 Auto (best)";
      qualitySelect.append(automaticQuality);
      const availableById = new Map(
        (qualityVerdict?.videoOptions || []).map((option) => [option.id, option])
      );
      const visibleQualities = needsYouTubePreflight ? qualityOptions.filter((quality) => availableById.has(quality.id)) : qualityOptions;
      const qualityGroups = /* @__PURE__ */ new Map();
      for (const quality of visibleQualities) {
        const option = document.createElement("option");
        option.value = quality.id;
        const verdict = availableById.get(quality.id);
        option.textContent = quality.optionLabel || quality.label || "Source quality";
        if (quality.groupLabel && !option.textContent.startsWith(quality.groupLabel))
          option.textContent = `${quality.groupLabel} \xB7 ${option.textContent}`;
        if (verdict?.availability === "equivalent") {
          option.textContent += " \xB7 compatible equivalent";
          option.title = `Provider source: ${verdict.sourceLabel}`;
        } else if (verdict?.sourceLabel) {
          option.title = `Provider source: ${verdict.sourceLabel}`;
        }
        const groupLabel = quality.groupLabel || "Source quality";
        let group = qualityGroups.get(groupLabel);
        if (!group) {
          group = document.createElement("optgroup");
          group.label = groupLabel;
          qualityGroups.set(groupLabel, group);
          qualitySelect.append(group);
        }
        group.append(option);
      }
      qualitySelect.disabled = !availability.supported || !visibleQualities.length;
      const previous = [...qualitySelect.options].find(
        (option) => qualityKey(option) === preferred.qualityLabel
      );
      if (previous) qualitySelect.value = previous.value;
    };
    renderAudioOptions();
    renderQualityOptions();
    const estimateLabel = document.createElement("span");
    estimateLabel.className = "media-download-estimate";
    const updateEstimate = () => {
      const estimate = getMediaDownloadEstimate(downloadItem, item, {
        videoTrackId: qualitySelect.value || null,
        audioTrackId: audioSelect.value || null,
        audioOnly: profileSelect.value === "audio-ogg"
      });
      estimateLabel.textContent = formatDownloadEstimate(estimate);
      estimateLabel.title = formatDownloadEstimateTitle(estimate);
    };
    const syncDownloadButton = () => {
      const presentation2 = downloadButtonPresentation(
        availability,
        helper,
        downloadItem
      );
      let next = presentation2;
      if (needsYouTubePreflight && helper.status === "ready" && helper.canResolveYouTubeQualityPreflight !== true) {
        next = {
          disabled: true,
          label: "Update helper",
          title: "Update Media Helper to verify YouTube qualities before downloading."
        };
      } else if (needsYouTubePreflight && helper.status === "ready" && helper.canResolveYouTubeQualityPreflight === true) {
        if (!qualityVerdict) {
          next = {
            disabled: true,
            label: "Checking\u2026",
            title: "Checking which YouTube qualities are downloadable."
          };
        } else if (profileSelect.value !== "audio-ogg" && qualityVerdict.status !== "ready") {
          next = {
            disabled: true,
            label: "Unavailable",
            title: qualityVerdict.reason || "No YouTube quality is available through the current provider profile."
          };
        } else if (profileSelect.value !== "audio-ogg" && qualityVerdict.videoOptions.length === 0) {
          next = {
            disabled: true,
            label: "Unavailable",
            title: "No downloadable YouTube video quality is available."
          };
        } else if (profileSelect.value !== "audio-ogg" && qualitySelect.value && !qualityVerdict.videoOptions.some(
          (option) => option.id === qualitySelect.value
        )) {
          next = {
            disabled: true,
            label: "Unavailable",
            title: "The selected YouTube quality is not downloadable."
          };
        } else if (profileSelect.value === "audio-ogg" && !qualityVerdict.audioOptions?.some(
          (option) => option.id === audioSelect.value
        )) {
          next = {
            disabled: true,
            label: "Unavailable",
            title: "No downloadable YouTube audio track is available."
          };
        }
      }
      button.disabled = next.disabled;
      button.textContent = next.label;
      button.title = next.title;
    };
    qualitySelect.addEventListener("change", () => {
      rememberSelection();
      updateEstimate();
      syncDownloadButton();
    });
    audioSelect.addEventListener("change", () => {
      rememberSelection();
      updateEstimate();
      syncDownloadButton();
    });
    profileSelect.addEventListener("change", () => {
      preferred = { ...preferred, profileId: profileSelect.value };
      renderQualityOptions();
      rememberSelection();
      updateEstimate();
      syncDownloadButton();
    });
    updateEstimate();
    function rememberSelection() {
      preferred = {
        profileId: profileSelect.value,
        qualityLabel: qualityKey(qualitySelect.selectedOptions[0]),
        audioLabel: audioSelect.selectedOptions[0]?.textContent || ""
      };
      onSelectionChange(preferred);
      historyJob = null;
      historyKey = null;
      editing = false;
      renderHistory();
      onOutputChange(getOutput());
    }
    for (const select of [profileSelect, qualitySelect, audioSelect])
      select.setAttribute("aria-label", select.title);
    function qualityKey(option) {
      return option ? `${option.parentElement?.label || ""}|${option.textContent}` : "";
    }
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
    const getOutput = () => ({
      profileId: profileSelect.value || profiles[0]?.id,
      videoTrackId: profileSelect.value === "audio-ogg" ? null : qualitySelect.value || null,
      audioTrackId: audioSelect.value || qualityVerdict?.audioOption?.id || null,
      allowEquivalentVideo: qualityVerdict?.videoOptions?.find(
        (option) => option.id === qualitySelect.value
      )?.availability === "equivalent" || profileSelect.value !== "audio-ogg" && !qualitySelect.value && needsYouTubePreflight
    });
    async function startDownload(event2, repeatOf = null) {
      if (!event2.isTrusted) return;
      if (submitting) return;
      submitting = true;
      button.disabled = true;
      if (helper.status !== "ready" || !helperCanDownload(downloadItem, helper)) {
        try {
          await setupMediaHelper(button, helper);
        } finally {
          submitting = false;
        }
        return;
      }
      button.textContent = "Starting\u2026";
      try {
        const response = await chrome.runtime.sendMessage({
          type: "CREATE_MEDIA_DOWNLOAD_JOB",
          tabId: tab.id,
          mediaId: downloadItem.id,
          connections: settings?.mediaDownloadConnections ?? 8,
          output: getOutput(),
          repeatOf
        });
        if (["already_downloaded", "already_downloading"].includes(response?.status)) {
          editing = false;
          historyKey = null;
          setHistory({ exactJob: response.job, latestJob: response.job });
          return;
        }
        if (response?.status !== "started")
          throw new Error(
            response?.reason || response?.error || "Could not start the helper download job."
          );
        button.textContent = "Started";
        historyJob = null;
        historyKey = null;
        editing = false;
        renderHistory();
        await updateMediaJobs();
      } catch (error) {
        button.disabled = false;
        button.textContent = "Retry";
        button.title = error?.message || String(error);
      } finally {
        submitting = false;
      }
    }
    button.addEventListener("click", (event2) => void startDownload(event2));
    if (availability.supported) control.append(estimateLabel);
    if (availability.supported && downloadItem.kind === "adaptive" && profiles.some((profile) => profile.id === "video-mp4"))
      control.append(qualitySelect);
    if (availability.supported && profiles.length) control.append(profileSelect);
    if (availability.supported && downloadItem.kind === "adaptive" && audioTrackOptions.length)
      control.append(audioSelect);
    control.append(button);
    const history = document.createElement("div");
    history.hidden = true;
    control.append(history);
    async function outputAction(type) {
      const response = await chrome.runtime.sendMessage({
        type,
        jobId: historyJob.id
      });
      if (response?.status !== "opened" && response?.status !== "revealed")
        throw new Error(
          response?.error || response?.reason || "Could not open saved file. It may have moved."
        );
    }
    function renderHistory() {
      const card = !editing && historyJob ? createDownloadHistoryCard(historyJob, {
        exact: historyExact,
        open: () => outputAction("OPEN_MEDIA_DOWNLOAD_OUTPUT"),
        folder: () => outputAction("REVEAL_MEDIA_DOWNLOAD_OUTPUT"),
        repeat: (event2) => startDownload(event2, historyJob.id),
        options: historyExact ? () => {
          editing = true;
          renderHistory();
          syncDownloadButton();
        } : null,
        manager: openManager
      }) : null;
      history.replaceChildren(...card ? [card] : []);
      history.hidden = !card;
      for (const child of control.children)
        if (child !== history) child.hidden = Boolean(card && historyExact);
    }
    function setHistory(context) {
      if (submitting && !context?.exactJob) return;
      const job = context?.exactJob || context?.latestJob || null;
      const exact = Boolean(context?.exactJob);
      const key = job ? `${job.id}|${job.status}|${job.fileStatus}|${exact}` : "none";
      if (key === historyKey) return;
      const old = historyJob;
      historyKey = key;
      historyJob = job;
      historyExact = exact;
      if (old?.id !== job?.id || old?.status !== job?.status) editing = false;
      renderHistory();
      if ((!job || !exact) && !submitting) syncDownloadButton();
    }
    onController({ getOutput, setHistory });
    if (needsYouTubePreflight && helper.status === "ready" && helper.canResolveYouTubeQualityPreflight === true) {
      if (!qualityVerdict) {
        const request = chrome.runtime.sendMessage({
          type: "PREFLIGHT_MEDIA_DOWNLOAD_QUALITIES",
          tabId: tab?.id,
          mediaId: downloadItem.id
        }).then((response) => {
          qualityVerdict = normalizePopupYouTubePreflight(response);
          if (preflightKey && qualityVerdict)
            youtubeQualityPreflightCache.set(preflightKey, qualityVerdict);
          if (!control.isConnected) return;
          renderQualityOptions();
          renderAudioOptions();
          syncDownloadButton();
          updateEstimate();
          onOutputChange(getOutput());
        }).catch((error) => {
          qualityVerdict = {
            status: "unavailable",
            videoOptions: [],
            reason: error?.message || String(error)
          };
          if (control.isConnected) {
            renderQualityOptions();
            renderAudioOptions();
            syncDownloadButton();
          }
        });
        void request;
      }
      syncDownloadButton();
    }
    onOutputChange(getOutput());
    return control;
  }
  function normalizePopupYouTubePreflight(response) {
    const result = response?.result || response;
    const options = Array.isArray(result?.videoOptions) ? result.videoOptions.filter(
      (option) => option && typeof option.id === "string" && ["exact", "equivalent"].includes(option.availability)
    ) : [];
    return {
      status: result?.status === "ready" ? "ready" : "unavailable",
      videoOptions: options,
      audioOption: result?.audioOption && typeof result.audioOption.id === "string" ? {
        id: result.audioOption.id,
        sourceLabel: typeof result.audioOption.sourceLabel === "string" ? result.audioOption.sourceLabel : "Audio source"
      } : null,
      audioOptions: Array.isArray(result?.audioOptions) ? result.audioOptions.filter(
        (option) => option && typeof option.id === "string"
      ) : result?.audioOption && typeof result.audioOption.id === "string" ? [result.audioOption] : [],
      reason: typeof result?.reason === "string" ? result.reason : null
    };
  }
  function formatDownloadEstimate(estimate) {
    const quality = estimate.resolution?.height ? `${estimate.resolution.height}p` : "Source quality";
    const size = estimate.estimatedBytes ? `${estimate.basis === "source_headers" ? "" : "Est. "}${formatBytes(
      estimate.estimatedBytes
    )}` : "Size unavailable";
    return `${quality} \xB7 ${size}`;
  }
  function formatDownloadEstimateTitle(estimate) {
    if (!estimate.estimatedBytes) {
      return "The manifest does not expose enough bitrate data to estimate size before download.";
    }
    if (estimate.basis === "source_headers")
      return "Total file size from the media response headers.";
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

  // src/media/player-download-position.js
  function playerDownloadPosition(rect, viewportWidth, launcherHeight) {
    const margin = 8;
    const width = Math.min(
      300,
      rect.width - margin * 2,
      viewportWidth - margin * 2
    );
    const left = Math.max(
      margin,
      Math.min(
        rect.left + (rect.width - width) / 2,
        viewportWidth - width - margin
      )
    );
    const top = Math.max(margin, rect.top - Math.max(0, launcherHeight) * 0.7);
    return { width, left, top };
  }

  // src/media/ui/player-download-attention.js
  var PLAYER_DOWNLOAD_NOTICE_MS = 3e3;
  function createPlayerDownloadAttention({
    onNotice,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  }) {
    let visible = false;
    let timer = null;
    let revision = 0;
    let disposed = false;
    function reset() {
      revision++;
      visible = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
      onNotice(false);
    }
    return {
      setVisible(next) {
        if (disposed || Boolean(next) === visible) return;
        if (!next) {
          reset();
          return;
        }
        visible = true;
        const expected = ++revision;
        onNotice(true);
        timer = setTimer(() => {
          if (disposed || expected !== revision || !visible) return;
          timer = null;
          onNotice(false);
        }, PLAYER_DOWNLOAD_NOTICE_MS);
      },
      reset() {
        if (!disposed) reset();
      },
      dispose() {
        if (!disposed) {
          reset();
          disposed = true;
        }
      }
    };
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
    BROWSER_DOWNLOAD_OBSERVE: "downloads.browser_observe",
    BROWSER_FILE_TRANSFER: "downloads.file_transfer",
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
      C2.BROWSER_DOWNLOAD_OBSERVE
    ]),
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
  function subscribeSettings(listener, storageArea = "local") {
    const onChanged = (changes, areaName) => {
      if (areaName !== storageArea || !changes[SETTINGS_KEY]) return;
      listener(normalizeSettings(changes[SETTINGS_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }

  // src/media/storage-keys.js
  var MEDIA_CATALOG_SESSION_PREFIX = "adsfriendly.mediaCatalog.";

  // src/content/player-download.js
  function startPlayerDownload({ shadowMode = "closed" } = {}) {
    const players = /* @__PURE__ */ new Map();
    const preflightCache = /* @__PURE__ */ new Map();
    let stopped = false;
    let refreshing = false;
    let refreshingJobs = false;
    let snapshot = null;
    let chosenVideo = null;
    let nextOverlay = 0;
    let openEntry = null;
    const make = (video) => {
      const host = document.createElement("div");
      host.hidden = true;
      host.id = `adsfriendly-player-download-${nextOverlay++}`;
      host.dataset.adsfriendlyUi = "player-download";
      const shadow = host.attachShadow({ mode: shadowMode });
      shadow.innerHTML = `<style>
      :host{position:fixed;z-index:2147483646;display:block;font:13px system-ui;color:#e2e8f0;pointer-events:none}:host([hidden]){display:none!important}
      *{box-sizing:border-box}button,select{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.65}
      .launcher{display:flex;align-items:center;gap:2px;width:max-content;margin:auto;padding:2px;border:1px solid #64748b;background:#172033ed;border-radius:18px;box-shadow:0 2px 6px #0005;pointer-events:auto;opacity:.4;transition:opacity .3s ease}
      :host([data-notice]) .launcher,:host([data-open]) .launcher,.launcher:hover,.launcher:has(:focus-visible){opacity:1}.launcher:hover .dismiss,.launcher:has(:focus-visible) .dismiss{opacity:1}.launch{display:flex;align-items:center;gap:6px;min-height:28px;border:0;background:transparent;color:#e2e8f0;border-radius:14px;padding:2px 8px 2px 3px;font-size:12px}.launch:hover{background:#334155}.brand{display:block;width:24px;height:24px;border-radius:6px;pointer-events:none}
      .dismiss,.close{display:grid;place-items:center;flex-shrink:0;width:28px;height:28px;border:1px solid #475569;background:#1e293b;color:#cbd5e1;border-radius:50%;font-size:18px;line-height:1;opacity:.7;transition:opacity .15s ease,background .15s ease}.dismiss{margin-right:2px}.dismiss:hover,.dismiss:focus-visible,.close:hover,.close:focus-visible{opacity:1;background:#475569;color:#fff}.launch:focus-visible,.dismiss:focus-visible,.close:focus-visible{outline:2px solid #86efac;outline-offset:2px}
      @media(hover:none){.dismiss,.close{opacity:1}.launch,.dismiss,.close{min-height:36px}.dismiss,.close{min-width:36px}}@media(prefers-reduced-motion:reduce){.launcher,.dismiss,.close{transition:none}}
      .panel{pointer-events:auto;margin-top:6px;background:#0f172af5;border:1px solid #475569;border-radius:12px;padding:12px;box-shadow:0 6px 24px #0007;max-height:300px;overflow:auto}
      [hidden]{display:none!important}.heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
      .media-download-control{display:flex;flex-direction:column;gap:8px}.media-download-profile{width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:6px;padding:7px;font-size:12px}.media-download{background:#166534;color:#dcfce7;border:1px solid #22c55e;border-radius:6px;padding:7px}.media-download-estimate{font-size:12px;color:#93c5fd}.manager{margin-top:8px;background:transparent;color:#93c5fd;border:0;padding:4px 0;font-size:12px}
      .quick-open{border:0;background:transparent;color:#86efac;padding:4px;font-size:12px;border-radius:8px}.quick-open:hover{background:#334155}.media-download-history{display:flex;flex-direction:column;gap:6px;font-size:12px}.media-download-history strong{color:#86efac}.media-download-history-actions{display:flex;flex-wrap:wrap;gap:6px}.media-download-history-actions button{border:1px solid #475569;border-radius:6px;background:#1e293b;color:#e2e8f0;padding:6px;font-size:12px}
    </style><div class="launcher"><button class="launch" type="button" title="AdsFriendly \xB7 Download this video" aria-label="Download this video" aria-expanded="false"><img class="brand" alt="" aria-hidden="true"><span class="launch-label">\u2193 Download</span></button><button class="quick-open" hidden type="button" title="Open downloaded file">Open</button><button class="dismiss" type="button" title="Hide this button for this video \xB7 downloads keep running" aria-label="Hide download button for this video">\xD7</button></div><section class="panel" hidden aria-label="Video download options"><div class="heading"><span class="title"></span><button class="close" type="button" title="Close download options" aria-label="Close download options">\xD7</button></div><div class="controls"></div><button class="manager">Download Manager</button></section>`;
      shadow.querySelector(".brand").src = chrome.runtime.getURL("icons/icon48.png");
      const entry = {
        video,
        host,
        shadow,
        target: null,
        source: null,
        controlKey: null,
        opening: false,
        dismissedSource: null,
        controller: null,
        output: null,
        context: null,
        revision: 0,
        checkedCompletion: null,
        contextRequest: 0,
        attention: createPlayerDownloadAttention({
          onNotice: (active) => host.toggleAttribute("data-notice", active)
        })
      };
      shadow.querySelector(".quick-open").addEventListener("click", async (event2) => {
        if (!event2.isTrusted) return;
        const job = entry.context?.latestJob;
        if (!job || entry.source !== readPlayerSource(video)) return;
        const button = event2.currentTarget;
        button.disabled = true;
        try {
          const result = await chrome.runtime.sendMessage({
            type: "OPEN_MEDIA_DOWNLOAD_OUTPUT",
            jobId: job.id
          });
          if (result?.status !== "opened")
            button.title = result?.error || "Could not open saved file.";
        } catch (error) {
          button.title = error?.message || "Could not open saved file.";
        } finally {
          button.disabled = false;
        }
      });
      shadow.querySelector(".launch").addEventListener("click", () => void toggle(entry));
      shadow.querySelector(".close").addEventListener("click", () => {
        close(entry);
        shadow.querySelector(".launch").focus({ preventScroll: true });
      });
      shadow.querySelector(".dismiss").addEventListener("click", () => {
        entry.dismissedSource = entry.source;
        close(entry);
        position();
        video.focus({ preventScroll: true });
      });
      shadow.querySelector(".manager").addEventListener("click", () => void openManager());
      shadow.addEventListener("keydown", (event2) => {
        if (event2.key === "Escape") {
          event2.stopPropagation();
          close(entry);
          shadow.querySelector(".launch").focus();
        }
      });
      players.set(video, entry);
      document.documentElement.append(host);
      return entry;
    };
    function close(entry) {
      entry.host.removeAttribute("data-open");
      entry.shadow.querySelector(".panel").hidden = true;
      entry.shadow.querySelector(".launch").setAttribute("aria-expanded", "false");
      if (openEntry === entry) openEntry = null;
    }
    async function openManager() {
      await chrome.runtime.sendMessage({ type: "OPEN_PLAYER_DOWNLOAD_MANAGER" }).catch(() => {
      });
    }
    async function toggle(entry) {
      if (entry.opening) return;
      if (openEntry === entry) {
        close(entry);
        return;
      }
      if (openEntry) close(openEntry);
      entry.opening = true;
      const expectedSource = entry.source;
      try {
        const helper = await chrome.runtime.sendMessage({
          type: "GET_MEDIA_HELPER_STATUS"
        });
        if (stopped || entry.dismissedSource === expectedSource || !entry.video.isConnected || expectedSource !== readPlayerSource(entry.video))
          return;
        const { presentation, candidate } = entry.target;
        await chrome.runtime.sendMessage({
          type: "SELECT_PLAYER_MEDIA",
          sourceUrl: expectedSource
        });
        const { mediaDownloadUiPreferences = {} } = await chrome.storage.local.get("mediaDownloadUiPreferences");
        const settings = await loadSettings();
        if (stopped || entry.dismissedSource === expectedSource || expectedSource !== readPlayerSource(entry.video) || candidate.id !== entry.target?.candidate.id)
          return;
        const control = createMediaDownloadControl(
          presentation,
          candidate,
          snapshot.tab,
          helper || {},
          {
            settings,
            qualityPreflightCache: preflightCache,
            initialSelection: mediaDownloadUiPreferences,
            onController: (controller) => {
              entry.controller = controller;
            },
            onOutputChange: (output) => {
              if (entry.source !== expectedSource || candidate.id !== entry.target?.candidate.id)
                return;
              entry.output = output;
              entry.revision++;
              void refreshEntryJobs(entry, true);
            },
            openManager,
            onSelectionChange: (preference) => void chrome.storage.local.set({ mediaDownloadUiPreferences: preference }).catch(() => {
            }),
            setupMediaHelper: async (button) => {
              await openManager();
              button.disabled = false;
              button.textContent = "Set up helper";
            },
            onStarted: async () => {
              if (stopped || entry.source !== expectedSource || candidate.id !== entry.target?.candidate.id)
                return;
              entry.shadow.querySelector(".launch-label").textContent = "\u2193 Started";
              await refreshJobs();
            }
          }
        );
        entry.shadow.querySelector(".controls").replaceChildren(control);
        entry.shadow.querySelector(".title").textContent = presentation.title || "Download video";
        entry.shadow.querySelector(".panel").hidden = false;
        entry.host.setAttribute("data-open", "");
        entry.shadow.querySelector(".launch").setAttribute("aria-expanded", "true");
        openEntry = entry;
        await refreshEntryJobs(entry, true);
        position();
      } catch (error) {
        entry.shadow.querySelector(".launch").title = error?.message || "Could not open download options. Try again.";
      } finally {
        entry.opening = false;
      }
    }
    function position() {
      if (document.hidden) return;
      const eligible = [...players.values()].filter((entry) => {
        const rect = entry.video.getBoundingClientRect();
        return entry.video.isConnected && rect.width >= 240 && rect.height >= 120 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && getComputedStyle(entry.video).visibility !== "hidden" && !entry.video.closest(
          '[data-ad],.ima-ad-container,.vast-ad,[aria-label="Advertisement"]'
        );
      });
      const primary = eligible.find((entry) => entry.video === chosenVideo) || eligible.sort((a, b) => {
        const ar = a.video.getBoundingClientRect();
        const br = b.video.getBoundingClientRect();
        return br.width * br.height - ar.width * ar.height || (Number.isFinite(b.video.duration) ? b.video.duration : 0) - (Number.isFinite(a.video.duration) ? a.video.duration : 0);
      })[0];
      for (const entry of players.values()) {
        const rect = entry.video.getBoundingClientRect();
        const visible = entry === primary && entry.target && entry.dismissedSource !== entry.source && rect.width >= 240 && rect.height >= 120 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && getComputedStyle(entry.video).visibility !== "hidden";
        entry.host.hidden = !visible;
        entry.attention.setVisible(visible);
        if (!visible) {
          close(entry);
          continue;
        }
        const { width, left, top } = playerDownloadPosition(
          rect,
          innerWidth,
          entry.shadow.querySelector(".launcher").getBoundingClientRect().height
        );
        entry.host.style.width = `${width}px`;
        entry.host.style.left = `${left}px`;
        entry.host.style.top = `${top}px`;
        const container = document.fullscreenElement || document.documentElement;
        if (!container.contains(entry.host) && !container.matches("video"))
          container.append(entry.host);
      }
    }
    async function refreshJobs() {
      if (stopped || refreshingJobs || document.hidden || ![...players.values()].some((entry) => !entry.host.hidden))
        return;
      refreshingJobs = true;
      try {
        await Promise.all(
          [...players.values()].filter((entry) => !entry.host.hidden).map((entry) => refreshEntryJobs(entry))
        );
      } finally {
        refreshingJobs = false;
      }
    }
    async function refreshEntryJobs(entry, verifyFile = false) {
      const source = entry.source;
      const revision = entry.revision;
      if (!entry.target || stopped) return;
      const request = ++entry.contextRequest;
      let response = await chrome.runtime.sendMessage({
        type: "GET_PLAYER_DOWNLOAD_CONTEXT",
        sourceUrl: source,
        output: entry.output || {},
        verifyFile
      }).catch(() => null);
      if (stopped || request !== entry.contextRequest || source !== readPlayerSource(entry.video) || source !== entry.source || revision !== entry.revision || response?.status !== "ok")
        return;
      const completedJob = response.latestJob?.status === "completed" ? response.latestJob : null;
      const completionKey = completedJob ? `${completedJob.id}|${completedJob.updatedAt}` : null;
      if (!verifyFile && completedJob?.fileStatus === "unchecked" && completionKey !== entry.checkedCompletion) {
        entry.checkedCompletion = completionKey;
        const checked = await chrome.runtime.sendMessage({
          type: "GET_PLAYER_DOWNLOAD_CONTEXT",
          sourceUrl: source,
          output: entry.output || {},
          verifyFile: true
        }).catch(() => null);
        if (stopped || request !== entry.contextRequest || source !== readPlayerSource(entry.video) || source !== entry.source || revision !== entry.revision)
          return;
        if (checked?.status === "ok") response = checked;
      }
      entry.context = response;
      const job = response.latestJob;
      const completed = job?.status === "completed" && !["missing", "changed"].includes(job.fileStatus);
      entry.shadow.querySelector(".launch-label").textContent = job && isMediaJobActive(job) ? `\u2193 ${formatMediaJobTransferSummary(job)}` : completed ? "\u2713 Completed" : "\u2193 Download";
      entry.shadow.querySelector(".quick-open").hidden = !completed || !job.outputPath;
      entry.controller?.setHistory(response);
    }
    async function refresh() {
      if (stopped || refreshing || document.hidden) return;
      refreshing = true;
      try {
        const videos = [...document.querySelectorAll("video")];
        for (const [video, entry] of players)
          if (!videos.includes(video)) {
            entry.attention.dispose();
            close(entry);
            entry.host.remove();
            players.delete(video);
          }
        if (!videos.length) return;
        snapshot = await chrome.runtime.sendMessage({
          type: "GET_PLAYER_MEDIA_CONTEXT"
        });
        if (stopped) return;
        for (const video of videos) {
          const source = readPlayerSource(video);
          const target = resolvePlayerDownloadTarget({
            sourceUrl: source,
            pageUrl: location.href,
            frameId: snapshot.frameId,
            items: snapshot.items
          });
          let entry = players.get(video) || make(video);
          if (!target) {
            if (entry) {
              entry.target = null;
              entry.host.hidden = true;
              entry.attention.setVisible(false);
              close(entry);
            }
            continue;
          }
          if (source !== entry.source || target.candidate.id !== entry.target?.candidate.id) {
            close(entry);
            entry.attention.reset();
            if (source !== entry.source) entry.dismissedSource = null;
            entry.shadow.querySelector(".launch-label").textContent = "\u2193 Download";
            entry.shadow.querySelector(".quick-open").hidden = true;
            entry.controller = null;
            entry.context = null;
            entry.output = null;
            entry.checkedCompletion = null;
            entry.revision++;
          }
          entry.source = source;
          entry.target = target;
        }
        position();
        await refreshJobs();
      } catch {
      } finally {
        refreshing = false;
      }
    }
    const timer = setInterval(() => void refresh(), 2e3);
    const onStorage = (changes, area) => {
      if (area === "session") {
        if (Object.keys(changes).some(
          (key) => key.startsWith(MEDIA_CATALOG_SESSION_PREFIX)
        ))
          void refresh();
        if (Object.keys(changes).some((key) => key.startsWith(DOWNLOAD_JOB_PREFIX)))
          void refreshJobs();
      }
    };
    const onViewport = () => position();
    const onVisibility = () => {
      if (document.hidden) {
        for (const entry of players.values()) entry.attention.setVisible(false);
      } else {
        position();
        void refresh();
      }
    };
    const onMedia = () => {
      for (const entry of players.values())
        if (entry.source !== readPlayerSource(entry.video)) {
          entry.target = null;
          entry.host.hidden = true;
          entry.attention.setVisible(false);
          close(entry);
        }
      void refresh();
    };
    const onPointer = (event2) => {
      if (!event2.isTrusted) return;
      const container = event2.target.closest?.("video,.video-js,[data-player]");
      const video = container?.matches("video") ? container : container?.querySelector("video");
      if (video) {
        chosenVideo = video;
        position();
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    window.addEventListener("scroll", onViewport, true);
    window.addEventListener("resize", onViewport);
    document.addEventListener("fullscreenchange", onViewport);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("play", onMedia, true);
    document.addEventListener("loadstart", onMedia, true);
    document.addEventListener("emptied", onMedia, true);
    document.addEventListener("pointerdown", onPointer, true);
    void refresh();
    return () => {
      stopped = true;
      clearInterval(timer);
      chrome.storage.onChanged.removeListener(onStorage);
      window.removeEventListener("scroll", onViewport, true);
      window.removeEventListener("resize", onViewport);
      document.removeEventListener("fullscreenchange", onViewport);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("play", onMedia, true);
      document.removeEventListener("loadstart", onMedia, true);
      document.removeEventListener("emptied", onMedia, true);
      document.removeEventListener("pointerdown", onPointer, true);
      for (const entry of players.values()) {
        entry.attention.dispose();
        entry.host.remove();
      }
      players.clear();
    };
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

  // src/navigation/content/owned-ui.js
  function isOwnedUiEvent(event2) {
    const path = event2.composedPath?.() || [event2.target];
    return path.some(
      (node) => node?.closest?.("[data-adsfriendly-ui], [data-afs-ui]")
    );
  }

  // src/navigation/content/intent-tracker.js
  function startIntentTracker() {
    const recordIntent = (event2) => {
      if (!event2.isTrusted || isOwnedUiEvent(event2)) return;
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
    if (definition.enabledByDefault === false && override !== true) return false;
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
        "media-frame.player-download": () => startPlayerDownload(),
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
