var AdsFriendlyMainWorld = (() => {
  // src/main-world/bridge.js
  function notifyContentScript(data) {
    window.postMessage({ source: "adsfriendly-spy", ...data }, "*");
  }
  function onContentMessage(handler) {
    const onMessage = (event2) => {
      if (event2.data?.source === "adsfriendly-content") handler(event2.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }

  // src/main-world/manifest-analyzer.js
  var AD_MARKERS = [
    "#EXT-X-CUE-OUT",
    "#EXT-X-DATERANGE",
    "adunit",
    "vpaid",
    "doubleclick"
  ];
  function analyzeManifest(url, body) {
    if (!AD_MARKERS.some((marker) => body.includes(marker))) return;
    console.log("[AdsFriendly Spy] Ad segment detected in manifest:", url);
    notifyContentScript({ type: "AD_MAP_DETECTED", url });
  }

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
  var MEDIA_PROBE_SOURCES = Object.freeze({
    NETWORK_RESPONSE: "network_response",
    DECRYPTED_BLOB: "decrypted_blob"
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

  // src/media/hls-parser.js
  var MAX_MANIFEST_LENGTH = 2 * 1024 * 1024;
  var MAX_LINES = 2e4;
  var MAX_VARIANTS = 100;
  var MAX_TRACKS = 100;
  function parseHlsManifest(manifestUrl, body) {
    const source = typeof body === "string" ? body.replace(/^\uFEFF/, "") : "";
    if (!source.trimStart().startsWith("#EXTM3U")) {
      return unsupported("not_hls_manifest");
    }
    if (source.length > MAX_MANIFEST_LENGTH) {
      return unsupported("manifest_too_large");
    }
    const lines = source.split(/\r?\n/).map((line) => line.trim());
    if (lines.length > MAX_LINES) return unsupported("too_many_manifest_lines");
    try {
      const variants = [];
      const iframeVariants = [];
      const audioTracks = [];
      const subtitles = [];
      const encryptionMethods = /* @__PURE__ */ new Set();
      const encryptionKeyFormats = /* @__PURE__ */ new Set();
      let pendingVariant = null;
      let pendingSegmentDuration = null;
      let segmentCount = 0;
      let partialSegmentCount = 0;
      let skippedSegmentCount = 0;
      let duration = 0;
      let targetDuration = null;
      let mediaSequence = null;
      let discontinuitySequence = null;
      let hasEndList = false;
      let declaredPlaylistType = null;
      let hasMediaEvidence = false;
      let hasLowLatencyTag = false;
      for (const line of lines) {
        if (!line) continue;
        if (pendingVariant && !line.startsWith("#")) {
          if (variants.length < MAX_VARIANTS) {
            variants.push(normalizeVariant(pendingVariant, line, manifestUrl));
          }
          pendingVariant = null;
          continue;
        }
        if (pendingSegmentDuration !== null && !line.startsWith("#")) {
          duration += pendingSegmentDuration;
          segmentCount += 1;
          pendingSegmentDuration = null;
          continue;
        }
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          pendingVariant = parseAttributeList(valueAfterColon(line));
          continue;
        }
        if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF:")) {
          const attributes = parseAttributeList(valueAfterColon(line));
          if (attributes.URI && iframeVariants.length < MAX_VARIANTS) {
            iframeVariants.push(
              normalizeVariant(attributes, attributes.URI, manifestUrl, true)
            );
          }
          continue;
        }
        if (line.startsWith("#EXT-X-MEDIA:")) {
          const track = normalizeTrack(
            parseAttributeList(valueAfterColon(line)),
            manifestUrl
          );
          if (!track) continue;
          if (track.type === "audio" && audioTracks.length < MAX_TRACKS)
            audioTracks.push(track);
          if (track.type === "subtitles" && subtitles.length < MAX_TRACKS)
            subtitles.push(track);
          continue;
        }
        if (line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-SESSION-KEY:")) {
          const attributes = parseAttributeList(valueAfterColon(line));
          const method = attributes.METHOD;
          if (method && method.toUpperCase() !== "NONE")
            encryptionMethods.add(method.toUpperCase());
          if (attributes.KEYFORMAT)
            encryptionKeyFormats.add(
              String(attributes.KEYFORMAT).toLowerCase().slice(0, 100)
            );
          continue;
        }
        if (line.startsWith("#EXTINF:")) {
          const value = Number(valueAfterColon(line).split(",", 1)[0]);
          pendingSegmentDuration = Number.isFinite(value) && value >= 0 ? value : 0;
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-PART:")) {
          partialSegmentCount += 1;
          hasMediaEvidence = true;
          hasLowLatencyTag = true;
          continue;
        }
        if (line.startsWith("#EXT-X-PART-INF:") || line.startsWith("#EXT-X-SERVER-CONTROL:")) {
          hasMediaEvidence = true;
          hasLowLatencyTag = true;
          continue;
        }
        if (line.startsWith("#EXT-X-PRELOAD-HINT:")) {
          const type = parseAttributeList(valueAfterColon(line)).TYPE;
          hasMediaEvidence = true;
          if (String(type || "").toUpperCase() === "PART")
            hasLowLatencyTag = true;
          continue;
        }
        if (line.startsWith("#EXT-X-SKIP:")) {
          const skipped = Number(
            parseAttributeList(valueAfterColon(line))["SKIPPED-SEGMENTS"]
          );
          if (Number.isInteger(skipped) && skipped >= 0)
            skippedSegmentCount = skipped;
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-TARGETDURATION:")) {
          const value = Number(valueAfterColon(line));
          if (Number.isFinite(value) && value >= 0) targetDuration = value;
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
          mediaSequence = optionalNonNegativeInteger2(valueAfterColon(line));
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) {
          discontinuitySequence = optionalNonNegativeInteger2(
            valueAfterColon(line)
          );
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-MAP:")) {
          hasMediaEvidence = true;
          continue;
        }
        if (line === "#EXT-X-ENDLIST") {
          hasEndList = true;
          hasMediaEvidence = true;
          continue;
        }
        if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
          declaredPlaylistType = valueAfterColon(line).toUpperCase();
          hasMediaEvidence = true;
        }
      }
      const hasMasterEvidence = variants.length > 0 || iframeVariants.length > 0 || (audioTracks.length > 0 || subtitles.length > 0) && !hasMediaEvidence;
      const playlistType = hasMasterEvidence ? "master" : hasMediaEvidence ? "media" : "unknown";
      const streamType = playlistType === "master" ? null : playlistType === "unknown" ? "unknown" : hasEndList || declaredPlaylistType === "VOD" ? "vod" : segmentCount > 0 || partialSegmentCount > 0 || targetDuration !== null || declaredPlaylistType === "EVENT" ? "live" : "unknown";
      const methods = [...encryptionMethods];
      const keyFormats = [...encryptionKeyFormats];
      const classification = classifyHlsEncryption(methods, keyFormats);
      return {
        status: "ready",
        error: null,
        playlistType,
        streamType,
        variants,
        iframeVariants,
        audioTracks,
        subtitles,
        duration: playlistType === "media" ? round(duration, 3) : null,
        targetDuration: playlistType === "media" ? targetDuration : null,
        segmentCount: playlistType === "media" ? segmentCount : null,
        partialSegmentCount: playlistType === "media" ? partialSegmentCount : null,
        skippedSegmentCount: playlistType === "media" ? skippedSegmentCount : null,
        lowLatency: playlistType === "media" && hasLowLatencyTag,
        mediaSequence: playlistType === "media" ? mediaSequence : null,
        discontinuitySequence: playlistType === "media" ? discontinuitySequence : null,
        revisionId: stableTextId(source),
        encryptionMethods: methods,
        encryptionKeyFormats: keyFormats,
        ...classification
      };
    } catch (error) {
      return {
        ...unsupported("manifest_parse_failed"),
        status: "failed",
        error: error?.message || "Could not parse HLS manifest."
      };
    }
  }
  function normalizeVariant(attributes, uri, manifestUrl, iframeOnly = false) {
    const bandwidth = optionalPositiveNumber(attributes.BANDWIDTH);
    const averageBandwidth = optionalPositiveNumber(
      attributes["AVERAGE-BANDWIDTH"]
    );
    return {
      id: stableVariantId(uri, bandwidth, attributes.RESOLUTION),
      url: resolveUrl(uri, manifestUrl),
      bandwidth,
      averageBandwidth,
      resolution: parseResolution(attributes.RESOLUTION),
      codecs: optionalText(attributes.CODECS),
      frameRate: optionalPositiveNumber(attributes["FRAME-RATE"]),
      audioGroup: optionalText(attributes.AUDIO),
      subtitlesGroup: optionalText(attributes.SUBTITLES),
      iframeOnly
    };
  }
  function normalizeTrack(attributes, manifestUrl) {
    const type = String(attributes.TYPE || "").toLowerCase();
    if (!["audio", "subtitles"].includes(type)) return null;
    const name = optionalText(attributes.NAME);
    const groupId = optionalText(attributes["GROUP-ID"]);
    return {
      id: stableVariantId(attributes.URI || name || type, null, groupId),
      type,
      groupId,
      name,
      language: optionalText(attributes.LANGUAGE),
      url: attributes.URI ? resolveUrl(attributes.URI, manifestUrl) : null,
      default: yesNo(attributes.DEFAULT),
      autoselect: yesNo(attributes.AUTOSELECT),
      forced: yesNo(attributes.FORCED),
      channels: optionalText(attributes.CHANNELS)
    };
  }
  function parseAttributeList(value) {
    const attributes = {};
    let index = 0;
    while (index < value.length) {
      while (value[index] === "," || /\s/.test(value[index] || "")) index++;
      const equals = value.indexOf("=", index);
      if (equals < 0) break;
      const key = value.slice(index, equals).trim().toUpperCase();
      index = equals + 1;
      let parsed = "";
      if (value[index] === '"') {
        index++;
        while (index < value.length) {
          const character = value[index++];
          if (character === '"') break;
          parsed += character;
        }
      } else {
        const comma = value.indexOf(",", index);
        const end = comma < 0 ? value.length : comma;
        parsed = value.slice(index, end).trim();
        index = end;
      }
      if (key) attributes[key] = parsed;
      while (index < value.length && value[index] !== ",") index++;
      if (value[index] === ",") index++;
    }
    return attributes;
  }
  function parseResolution(value) {
    const match = /^(\d+)x(\d+)$/i.exec(String(value || "").trim());
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  function unsupported(error) {
    return {
      status: "unsupported",
      error,
      playlistType: null,
      streamType: null,
      variants: [],
      iframeVariants: [],
      audioTracks: [],
      subtitles: [],
      duration: null,
      targetDuration: null,
      segmentCount: null,
      partialSegmentCount: null,
      skippedSegmentCount: null,
      lowLatency: false,
      mediaSequence: null,
      discontinuitySequence: null,
      revisionId: null,
      encryptionMethods: [],
      encryptionKeyFormats: [],
      encryptionScheme: "none",
      drmSystem: null,
      drmEvidence: [],
      drm: "none"
    };
  }
  function classifyHlsEncryption(methods, keyFormats) {
    if (!methods.length) {
      return {
        encryptionScheme: "none",
        drm: "none",
        drmSystem: null,
        drmEvidence: []
      };
    }
    const drmSystem = detectDrmSystem(keyFormats);
    const sampleAes = methods.some((method) => method.startsWith("SAMPLE-AES"));
    const aes128 = methods.every((method) => method === "AES-128");
    const encryptionScheme = sampleAes ? "sample-aes" : aes128 ? "aes-128" : "unknown";
    if (drmSystem) {
      return {
        encryptionScheme,
        drm: "confirmed",
        drmSystem,
        drmEvidence: ["hls-keyformat"]
      };
    }
    return {
      encryptionScheme,
      drm: sampleAes ? "suspected" : "none",
      drmSystem: null,
      drmEvidence: sampleAes ? ["hls-sample-aes"] : []
    };
  }
  function detectDrmSystem(keyFormats) {
    for (const format of keyFormats) {
      if (format === "identity") continue;
      if (format.includes("edef8ba9") || format.includes("widevine"))
        return "widevine";
      if (format.includes("9a04f079") || format.includes("playready"))
        return "playready";
      if (format.includes("94ce86fb") || format.includes("streamingkeydelivery"))
        return "fairplay";
      if (format.includes("e2719d58") || format.includes("clearkey"))
        return "clearkey";
    }
    return null;
  }
  function valueAfterColon(line) {
    return line.slice(line.indexOf(":") + 1);
  }
  function resolveUrl(value, baseUrl) {
    try {
      return new URL(value, baseUrl).href;
    } catch {
      return value;
    }
  }
  function optionalPositiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }
  function optionalText(value) {
    return typeof value === "string" && value ? value : null;
  }
  function yesNo(value) {
    return String(value || "").toUpperCase() === "YES";
  }
  function round(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }
  function stableVariantId(...parts) {
    const input = parts.filter((part) => part !== null).join(":");
    let hash = 2166136261;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `stream-${(hash >>> 0).toString(36)}`;
  }
  function optionalNonNegativeInteger2(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }
  function stableTextId(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `revision-${(hash >>> 0).toString(36)}`;
  }

  // src/media/dash-parser.js
  function parseDashManifest(manifestUrl, body) {
    try {
      const xml = String(body || "").replace(/^\uFEFF/, "").trim();
      const root = xml.match(/<MPD\b([^>]*)>/i);
      if (!root) return unsupported2("not_dash_manifest");
      const rootAttributes = parseXmlAttributes(root[1]);
      const streamType = String(rootAttributes.type || "static").toLowerCase() === "dynamic" ? "live" : "vod";
      const duration = parseIsoDuration(rootAttributes.mediaPresentationDuration);
      const protectionSchemes = extractProtectionSchemes(xml);
      const drmSystem = detectDrmSystem2(protectionSchemes);
      const drm = drmSystem ? "confirmed" : protectionSchemes.length ? "suspected" : "none";
      const tracks = extractTracks(xml);
      const variants = tracks.filter((track) => track.type === "video");
      const audioTracks = tracks.filter((track) => track.type === "audio");
      const subtitles = tracks.filter((track) => track.type === "text");
      return {
        kind: "dash",
        status: "ready",
        error: null,
        playlistType: "master",
        streamType,
        duration,
        variants,
        iframeVariants: [],
        audioTracks,
        subtitles,
        segmentCount: null,
        partialSegmentCount: null,
        skippedSegmentCount: null,
        lowLatency: streamType === "live" && /availabilityTimeOffset\s*=/i.test(xml),
        mediaSequence: null,
        discontinuitySequence: null,
        revisionId: revisionId(manifestUrl, xml),
        encryptionMethods: protectionSchemes,
        encryptionKeyFormats: [],
        encryptionScheme: protectionSchemes.length ? /cbcs|cbc1/i.test(xml) ? "cbcs" : "cenc" : "none",
        drmSystem,
        drmEvidence: drmSystem ? ["dash-content-protection"] : [],
        drm
      };
    } catch (error) {
      return {
        ...unsupported2("dash_parse_failed"),
        error: error?.message || "dash_parse_failed"
      };
    }
  }
  function detectDrmSystem2(schemes) {
    for (const scheme of schemes) {
      if (scheme.includes("widevine") || scheme.includes("edef8ba9"))
        return "widevine";
      if (scheme.includes("playready") || scheme.includes("9a04f079"))
        return "playready";
      if (scheme.includes("fairplay") || scheme.includes("94ce86fb"))
        return "fairplay";
      if (scheme.includes("clearkey") || scheme.includes("e2719d58"))
        return "clearkey";
    }
    return null;
  }
  function extractTracks(xml) {
    const tracks = [];
    const adaptations = [
      ...xml.matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet\s*>/gi)
    ];
    for (const [, rawAttributes, content] of adaptations) {
      const adaptation = parseXmlAttributes(rawAttributes);
      const representations = [
        ...content.matchAll(/<Representation\b([^>]*?)(?:\/?>)/gi)
      ];
      if (!representations.length) {
        const track = normalizeTrack2(adaptation, adaptation, tracks.length);
        if (track) tracks.push(track);
        continue;
      }
      for (const [, representationAttributes] of representations) {
        const representation = parseXmlAttributes(representationAttributes);
        const track = normalizeTrack2(adaptation, representation, tracks.length);
        if (track) tracks.push(track);
      }
    }
    if (adaptations.length) return deduplicateTracks(tracks);
    for (const [, rawAttributes] of xml.matchAll(
      /<Representation\b([^>]*?)(?:\/?>)/gi
    )) {
      const representation = parseXmlAttributes(rawAttributes);
      const track = normalizeTrack2({}, representation, tracks.length);
      if (track) tracks.push(track);
    }
    return deduplicateTracks(tracks);
  }
  function normalizeTrack2(adaptation, representation, index) {
    const mimeType = representation.mimeType || adaptation.mimeType || null;
    const contentType = String(
      adaptation.contentType || representation.contentType || mimeType || ""
    ).toLowerCase();
    const type = contentType.includes("video") ? "video" : contentType.includes("audio") ? "audio" : contentType.includes("text") || contentType.includes("subtitle") || contentType.includes("application") ? "text" : null;
    if (!type) return null;
    const width = positiveInteger(representation.width || adaptation.width);
    const height = positiveInteger(representation.height || adaptation.height);
    const bandwidth = positiveInteger(representation.bandwidth);
    return {
      id: representation.id || adaptation.id || `${type}-${index + 1}`,
      type,
      bandwidth,
      averageBandwidth: bandwidth,
      width,
      height,
      resolution: width || height ? { width, height } : null,
      codecs: representation.codecs || adaptation.codecs || null,
      mimeType,
      language: adaptation.lang || representation.lang || null,
      name: adaptation.label || representation.label || adaptation.lang || null
    };
  }
  function deduplicateTracks(tracks) {
    const unique = /* @__PURE__ */ new Map();
    for (const track of tracks) {
      const key = [
        track.type,
        track.id,
        track.bandwidth,
        track.width,
        track.height,
        track.language
      ].join(":");
      unique.set(key, track);
    }
    return [...unique.values()].slice(0, 100);
  }
  function extractProtectionSchemes(xml) {
    return [
      ...new Set(
        [...xml.matchAll(/<ContentProtection\b([^>]*)>/gi)].map((match) => parseXmlAttributes(match[1]).schemeIdUri).filter(Boolean).map((value) => String(value).toLowerCase().slice(0, 100))
      )
    ];
  }
  function parseIsoDuration(value) {
    if (typeof value !== "string" || !value) return null;
    const match = value.match(
      /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
    );
    if (!match) return null;
    const seconds = Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0);
    return Number.isFinite(seconds) ? seconds : null;
  }
  function parseXmlAttributes(value) {
    const attributes = {};
    for (const match of String(value || "").matchAll(
      /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    )) {
      attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
    }
    return attributes;
  }
  function decodeXml(value) {
    return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }
  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }
  function revisionId(url, body) {
    let hash = 2166136261;
    const input = `${url || ""}
${body}`;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `dash-${(hash >>> 0).toString(36)}`;
  }
  function unsupported2(error) {
    return {
      kind: "dash",
      status: "unsupported",
      error,
      playlistType: null,
      streamType: null,
      duration: null,
      variants: [],
      iframeVariants: [],
      audioTracks: [],
      subtitles: [],
      segmentCount: null,
      partialSegmentCount: null,
      skippedSegmentCount: null,
      lowLatency: false,
      mediaSequence: null,
      discontinuitySequence: null,
      revisionId: null,
      encryptionMethods: [],
      encryptionKeyFormats: [],
      encryptionScheme: "none",
      drmSystem: null,
      drmEvidence: [],
      drm: "none"
    };
  }

  // src/media/hls-probe-adapters.js
  var MAX_PROBE_ATTEMPTS = 3;
  var PROTECTED_QUERY_KEYS = Object.freeze([
    "access_token",
    "auth",
    "authorization",
    "expires",
    "expiry",
    "hash",
    "id",
    "jwt",
    "key",
    "policy",
    "session",
    "session_id",
    "sig",
    "signature",
    "token"
  ]);
  var CONTROL_QUERY_KEYS = Object.freeze([
    "d",
    "decrypt",
    "encrypted",
    "encryption",
    "enc",
    "mode",
    "format",
    "output",
    "response",
    "type"
  ]);
  var HLS_PROBE_ADAPTERS = Object.freeze([
    Object.freeze({
      id: "aesgcm-b65-query-mutation",
      evidence: Object.freeze(["enc_aesgcm", "ext_x_b65"]),
      matches(body) {
        const source = normalizeBody(body);
        return source.startsWith("#EXTM3U") && source.includes("#ENC-AESGCM;") && source.includes("#EXT-X-B65:");
      },
      attempts(manifestUrl) {
        const sourceUrl = new URL(manifestUrl);
        return mutationKeys(sourceUrl).map((removedQueryKey) => {
          const url = new URL(sourceUrl.href);
          url.searchParams.delete(removedQueryKey);
          return {
            url: url.href,
            adapterId: this.id,
            strategy: "remove_query_parameter",
            removedQueryKey,
            evidence: [...this.evidence]
          };
        });
      }
    })
  ]);
  function createHlsProbeAttempts(manifestUrl, body) {
    let url;
    try {
      url = new URL(manifestUrl);
    } catch {
      return [];
    }
    if (!["http:", "https:"].includes(url.protocol)) return [];
    const attempts = [];
    for (const adapter of HLS_PROBE_ADAPTERS) {
      if (!adapter.matches(body)) continue;
      for (const attempt of adapter.attempts(url.href)) {
        if (attempt.url !== url.href && !attempts.some((item) => item.url === attempt.url)) {
          attempts.push(attempt);
        }
      }
    }
    return attempts.slice(0, MAX_PROBE_ATTEMPTS);
  }
  function mutationKeys(url) {
    const keys = [...new Set(url.searchParams.keys())].filter(
      (key) => key && !isProtectedQueryKey(key)
    );
    return keys.sort((left, right) => queryKeyRank(left) - queryKeyRank(right));
  }
  function isProtectedQueryKey(key) {
    const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    return PROTECTED_QUERY_KEYS.some(
      (protectedKey) => normalized === protectedKey || normalized.endsWith(`_${protectedKey}`)
    );
  }
  function queryKeyRank(key) {
    const preferred = CONTROL_QUERY_KEYS.indexOf(key.toLowerCase());
    return preferred === -1 ? CONTROL_QUERY_KEYS.length : preferred;
  }
  function normalizeBody(body) {
    return typeof body === "string" ? body.replace(/^\uFEFF/, "").trimStart() : "";
  }

  // src/media/probe-gate.js
  function createMediaProbeGate({ maximumRemembered = 100 } = {}) {
    const states = /* @__PURE__ */ new Map();
    return Object.freeze({
      claim(url) {
        const key = normalizeHttpMediaUrl(url);
        if (!key || states.has(key)) return null;
        remember(key, "pending");
        return key;
      },
      remember(url, state = "complete") {
        const key = normalizeHttpMediaUrl(url);
        if (!key) return null;
        remember(key, state);
        return key;
      },
      release(url) {
        const key = normalizeHttpMediaUrl(url);
        if (!key) return false;
        return states.delete(key);
      },
      state(url) {
        const key = normalizeHttpMediaUrl(url);
        return key ? states.get(key) || null : null;
      },
      clear() {
        states.clear();
      }
    });
    function remember(key, state) {
      states.delete(key);
      states.set(key, state);
      while (states.size > maximumRemembered) {
        states.delete(states.keys().next().value);
      }
    }
  }
  function isUsableMediaProbe(probe = {}) {
    if (probe.status !== "ready") return false;
    if (probe.kind === "dash") {
      return Boolean(
        probe.variants?.length || probe.audioTracks?.length || ["vod", "live"].includes(probe.streamType)
      );
    }
    if (probe.playlistType === "master") {
      return Boolean(
        probe.variants?.length || probe.iframeVariants?.length || probe.audioTracks?.length || probe.subtitles?.length
      );
    }
    if (probe.playlistType !== "media") return false;
    return Boolean(
      probe.segmentCount > 0 || probe.partialSegmentCount > 0 || ["vod", "live"].includes(probe.streamType)
    );
  }
  function normalizeHttpMediaUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
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

  // src/main-world/request-context-registry.js
  function createRequestContextRegistry({
    maximumEntries = 64,
    maximumAgeMs = 6e4
  } = {}) {
    const contexts = /* @__PURE__ */ new Map();
    return Object.freeze({
      remember(context, observedAt = Date.now()) {
        const normalized = normalizeMediaRequestContext({
          ...context,
          observedAt
        });
        if (!normalized) return null;
        for (const value of [normalized.requestUrl, normalized.finalUrl]) {
          const key = normalizeHttpUrl(value);
          if (!key) continue;
          contexts.delete(key);
          contexts.set(key, normalized);
        }
        trim2(observedAt);
        return { ...normalized };
      },
      find(url, now = Date.now()) {
        trim2(now);
        const context = contexts.get(normalizeHttpUrl(url));
        return context ? { ...context } : null;
      },
      clear() {
        contexts.clear();
      }
    });
    function trim2(now) {
      for (const [key, context] of contexts) {
        if (now - (context.observedAt || 0) > maximumAgeMs) contexts.delete(key);
      }
      while (contexts.size > maximumEntries) {
        contexts.delete(contexts.keys().next().value);
      }
    }
  }
  function normalizeHttpUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  // src/main-world/media-observation-ledger.js
  var MAXIMUM_OBSERVATIONS = 64;
  var MAXIMUM_AGE_MS = 6e4;
  var observations = [];
  function rememberMediaObservation(candidate, observedAt = Date.now()) {
    if (!candidate?.id || !candidate?.kind) return;
    observations.push({ candidate: { ...candidate }, observedAt });
    trim(observedAt);
  }
  function findRelatedMediaObservations(sourceUrls = [], { observedAt = Date.now(), maximum = 8, allowedKinds = null } = {}) {
    trim(observedAt);
    const sourceHosts = new Set(sourceUrls.map(hostOf).filter(Boolean));
    return observations.map((observation) => ({
      ...observation,
      score: observationScore(observation, sourceHosts, observedAt)
    })).filter(
      (observation) => !allowedKinds || allowedKinds.includes(observation.candidate.kind)
    ).filter((observation) => observation.score > 0).sort(
      (left, right) => right.score - left.score || right.observedAt - left.observedAt
    ).slice(0, maximum).map((observation) => ({
      id: observation.candidate.id,
      kind: observation.candidate.kind,
      sourceUrl: observation.candidate.manifestUrl || observation.candidate.sourceUrl,
      observedAt: observation.observedAt
    }));
  }
  function clearMediaObservations() {
    observations.length = 0;
  }
  function observationScore(observation, sourceHosts, now) {
    const age = Math.max(0, now - observation.observedAt);
    if (age > MAXIMUM_AGE_MS) return 0;
    const candidate = observation.candidate;
    const candidateHost = hostOf(candidate.manifestUrl || candidate.sourceUrl);
    const adaptive = ["hls", "dash"].includes(candidate.kind);
    const sameHost = candidateHost && sourceHosts.has(candidateHost);
    if (sourceHosts.size && !sameHost) return 0;
    if (!sourceHosts.size && !adaptive) return 0;
    return (sameHost ? 100 : 20) + (adaptive ? 10 : 0) - age / 1e4;
  }
  function trim(now) {
    const cutoff = now - MAXIMUM_AGE_MS;
    while (observations.length && (observations.length > MAXIMUM_OBSERVATIONS || observations[0].observedAt < cutoff)) {
      observations.shift();
    }
  }
  function hostOf(value) {
    try {
      return new URL(value).hostname;
    } catch {
      return null;
    }
  }

  // src/main-world/decrypted-manifest-observer.js
  var MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
  var MAX_ENVELOPES = 16;
  var ENVELOPE_MAXIMUM_AGE_MS = 2e4;
  var PENDING_BLOB_MAXIMUM_AGE_MS = 5e3;
  var createdBlobListeners = /* @__PURE__ */ new Set();
  var encryptedEnvelopeListeners = /* @__PURE__ */ new Set();
  var encryptedEnvelopes = [];
  function publishCreatedBlob(object, objectUrl) {
    for (const listener of createdBlobListeners) {
      try {
        const result = listener({ object, objectUrl, observedAt: Date.now() });
        result?.catch?.(() => {
        });
      } catch {
      }
    }
  }
  function installDecryptedManifestObserver(policy) {
    const inspectedObjectUrls = /* @__PURE__ */ new Set();
    const pendingBlobs = /* @__PURE__ */ new Map();
    let stopped = false;
    const listener = async ({ object, objectUrl, observedAt }) => {
      if (stopped || inspectedObjectUrls.has(objectUrl) || !(object instanceof Blob) || !policy.can(CAPABILITIES.MEDIA_OBSERVE) || !shouldInspectBlob(object, observedAt))
        return;
      inspectedObjectUrls.add(objectUrl);
      const matched = await inspectBlob(object, objectUrl, observedAt).catch(
        () => false
      );
      if (!matched && isManifestMimeType(object.type)) {
        pendingBlobs.set(objectUrl, { object, objectUrl, observedAt });
        trimPendingBlobs(pendingBlobs, Date.now());
      }
    };
    const envelopeListener = () => {
      const now = Date.now();
      trimPendingBlobs(pendingBlobs, now);
      for (const pending of pendingBlobs.values()) {
        if (pending.processing) continue;
        pending.processing = true;
        inspectBlob(pending.object, pending.objectUrl, pending.observedAt).then((matched) => {
          if (matched) pendingBlobs.delete(pending.objectUrl);
          else pending.processing = false;
        }).catch(() => {
          pending.processing = false;
        });
      }
    };
    createdBlobListeners.add(listener);
    encryptedEnvelopeListeners.add(envelopeListener);
    return () => {
      stopped = true;
      createdBlobListeners.delete(listener);
      encryptedEnvelopeListeners.delete(envelopeListener);
      inspectedObjectUrls.clear();
      pendingBlobs.clear();
    };
  }
  function rememberEncryptedManifestEnvelope({
    candidate,
    manifestUrl,
    body,
    requestContext: requestContext2 = null,
    observedAt = Date.now()
  } = {}) {
    const classification = classifyEncryptedManifestEnvelope(body);
    if (!classification || !candidate?.id || !manifestUrl) return null;
    const envelope = {
      mediaId: candidate.id,
      manifestUrl,
      kind: candidate.kind,
      scheme: classification.scheme,
      evidence: classification.evidence,
      requestContext: requestContext2 ? { ...requestContext2 } : null,
      observedAt
    };
    encryptedEnvelopes.push(envelope);
    trimEncryptedEnvelopes(observedAt);
    for (const listener of encryptedEnvelopeListeners) {
      try {
        listener(envelope);
      } catch {
      }
    }
    return { ...envelope, evidence: [...envelope.evidence] };
  }
  function classifyEncryptedManifestEnvelope(body) {
    const source = String(body || "").replace(/^\uFEFF/, "").trim();
    if (!source.startsWith("#EXTM3U")) return null;
    const lines = source.split(/\r?\n/).map((line) => line.trim());
    const encryptionTag = lines.find(
      (line) => /^#ENC-[A-Z0-9-]+(?::|;|$)/i.test(line)
    );
    const base64Tag = lines.find(
      (line) => /^#EXT-X-B(?:64|65)(?::|;|$)/i.test(line)
    );
    const payloads = lines.filter((line) => line && !line.startsWith("#"));
    if (!encryptionTag || payloads.length !== 1) return null;
    const payload = payloads[0];
    if (payload.length < (base64Tag ? 32 : 256) || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload))
      return null;
    const tagScheme = /^#ENC-([A-Z0-9-]+)/i.exec(encryptionTag)?.[1] || "";
    return {
      scheme: tagScheme.toLowerCase().replaceAll("-", "") === "aesgcm" ? "aes-gcm" : "unknown",
      evidence: [
        "custom-encryption-tag",
        ...base64Tag ? ["base64-payload-tag"] : [],
        "opaque-base64-payload"
      ]
    };
  }
  function clearEncryptedManifestEnvelopes() {
    encryptedEnvelopes.length = 0;
  }
  async function inspectBlob(blob, objectUrl, observedAt) {
    const body = await blob.text();
    if (byteLength(body) > MAX_MANIFEST_BYTES) return false;
    const kind = manifestKind(body);
    if (!kind) return false;
    const match = findRecentEncryptedEnvelope(kind, observedAt);
    if (!match) return false;
    const parsed = kind === MEDIA_KINDS.DASH ? parseDashManifest(match.envelope.manifestUrl, body) : parseHlsManifest(match.envelope.manifestUrl, body);
    const probe = { kind, ...parsed };
    const bodyBytes = byteLength(body);
    const manifestEnvelope = {
      scheme: match.envelope.scheme,
      observedAt: match.envelope.observedAt,
      correlationConfidence: match.confidence,
      evidence: [...match.envelope.evidence, "same-frame", "nearby-blob"]
    };
    reportDiagnostic(match.envelope, {
      phase: "response_received",
      code: "decrypted_manifest_blob_observed",
      bodyBytes,
      bodyFormat: kind,
      observationSource: "decrypted_blob",
      envelopeScheme: match.envelope.scheme,
      correlationConfidence: match.confidence,
      evidence: manifestEnvelope.evidence
    });
    reportDiagnostic(match.envelope, {
      phase: "parsed",
      code: decryptedProbeDiagnosticCode(probe),
      bodyBytes,
      bodyFormat: kind,
      playlistType: probe.playlistType,
      segmentCount: probe.segmentCount,
      observationSource: "decrypted_blob",
      envelopeScheme: match.envelope.scheme,
      correlationConfidence: match.confidence,
      evidence: manifestEnvelope.evidence
    });
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_PROBED, {
        mediaId: match.envelope.mediaId,
        pageUrl: location.href,
        manifestUrl: match.envelope.manifestUrl,
        kind,
        ...probe,
        requestContext: match.envelope.requestContext,
        probeSource: "decrypted_blob",
        manifestEnvelope
      })
    });
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_BLOB_TRACED, {
        mediaId: stableMediaId("blob", objectUrl),
        pageUrl: location.href,
        blobUrl: objectUrl,
        sourceUrls: [match.envelope.manifestUrl],
        candidateIds: [match.envelope.mediaId],
        mimeTypes: [blob.type || manifestMimeType(kind)],
        appendCount: 0,
        totalAppendedBytes: blob.size,
        observedAt
      })
    });
    if (!isUsableMediaProbe(probe)) {
      notifyContentScript({
        type: "MEDIA_DEBUG_MANIFEST_CAPTURE",
        capture: {
          mediaId: match.envelope.mediaId,
          manifestUrl: match.envelope.manifestUrl,
          kind,
          body,
          bodyFormat: kind,
          reason: decryptedProbeDiagnosticCode(probe)
        }
      });
    }
    return true;
  }
  function shouldInspectBlob(blob, observedAt) {
    if (!Number.isFinite(blob.size) || blob.size <= 0 || blob.size > MAX_MANIFEST_BYTES)
      return false;
    const mimeType = String(blob.type || "").toLowerCase();
    if (isManifestMimeType(mimeType)) return true;
    if (mimeType && !["application/octet-stream", "text/plain"].includes(mimeType))
      return false;
    trimEncryptedEnvelopes(observedAt);
    return encryptedEnvelopes.length > 0;
  }
  function findRecentEncryptedEnvelope(kind, observedAt) {
    trimEncryptedEnvelopes(observedAt);
    const candidates = encryptedEnvelopes.filter(
      (item) => item.kind === kind && Math.abs(observedAt - item.observedAt) <= ENVELOPE_MAXIMUM_AGE_MS
    ).sort((left, right) => right.observedAt - left.observedAt);
    if (!candidates.length) return null;
    const closest = candidates[0];
    const next = candidates[1];
    const distance = Math.max(0, observedAt - closest.observedAt);
    let confidence = distance <= 5e3 ? 0.98 : 0.9;
    if (next && Math.abs(closest.observedAt - next.observedAt) < 500)
      confidence = 0.78;
    return { envelope: closest, confidence };
  }
  function trimPendingBlobs(pendingBlobs, now) {
    for (const [objectUrl, pending] of pendingBlobs) {
      if (now - pending.observedAt > PENDING_BLOB_MAXIMUM_AGE_MS)
        pendingBlobs.delete(objectUrl);
    }
  }
  function trimEncryptedEnvelopes(now) {
    const cutoff = now - ENVELOPE_MAXIMUM_AGE_MS;
    while (encryptedEnvelopes.length && (encryptedEnvelopes.length > MAX_ENVELOPES || encryptedEnvelopes[0].observedAt < cutoff)) {
      encryptedEnvelopes.shift();
    }
  }
  function manifestKind(body) {
    const source = String(body || "").replace(/^\uFEFF/, "").trimStart();
    if (source.startsWith("#EXTM3U")) return MEDIA_KINDS.HLS;
    if (/^(?:<\?xml[^>]*>\s*)?<MPD\b/i.test(source)) return MEDIA_KINDS.DASH;
    return null;
  }
  function isManifestMimeType(value) {
    return /(?:mpegurl|dash\+xml)/i.test(value);
  }
  function manifestMimeType(kind) {
    return kind === MEDIA_KINDS.DASH ? "application/dash+xml" : "application/vnd.apple.mpegurl";
  }
  function decryptedProbeDiagnosticCode(probe) {
    if (probe.status === "unsupported") return "decrypted_manifest_unsupported";
    if (probe.status === "failed") return "decrypted_manifest_parse_failed";
    if (probe.playlistType === "unknown") return "decrypted_manifest_no_stream";
    if (probe.playlistType === "media" && !probe.segmentCount && !probe.partialSegmentCount)
      return "decrypted_manifest_zero_segments";
    return "decrypted_manifest_parsed";
  }
  function reportDiagnostic(envelope, facts) {
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_PROBE_DIAGNOSTIC, {
        mediaId: envelope.mediaId,
        pageUrl: location.href,
        manifestUrl: envelope.manifestUrl,
        kind: envelope.kind,
        observedAt: Date.now(),
        ...facts
      })
    });
  }
  function byteLength(value) {
    return new TextEncoder().encode(String(value || "")).byteLength;
  }

  // src/main-world/network-capture.js
  function installNetworkCapture(policy) {
    const originalFetch = window.fetch;
    const probeGate = createMediaProbeGate();
    const requestContexts = createRequestContextRegistry();
    const resolutionTasks = /* @__PURE__ */ new Map();
    const inspect = (manifestUrl, body, candidate, requestContext2 = null, resolutionAttempt = null) => {
      const probe = inspectManifest(
        manifestUrl,
        body,
        candidate,
        requestContext2,
        resolutionAttempt
      );
      if (isUsableMediaProbe(probe)) probeGate.remember(manifestUrl, "ready");
      else probeGate.release(manifestUrl);
      return probe;
    };
    const resolveAttempts = (options) => {
      const existing = resolutionTasks.get(options.manifestUrl);
      if (existing) return existing;
      const task = tryHlsProbeAttempts({
        ...options,
        originalFetch,
        probeGate,
        inspect,
        requestContexts
      }).finally(() => resolutionTasks.delete(options.manifestUrl));
      resolutionTasks.set(options.manifestUrl, task);
      return task;
    };
    const stopFetchCapture = installFetchCapture(
      policy,
      inspect,
      resolveAttempts,
      requestContexts
    );
    const stopXhrCapture = installXhrCapture(
      policy,
      inspect,
      resolveAttempts,
      requestContexts
    );
    const stopFallbackProbe = installFallbackProbe({
      policy,
      originalFetch,
      probeGate,
      inspect,
      resolveAttempts,
      requestContexts
    });
    return () => {
      stopFetchCapture();
      stopXhrCapture();
      stopFallbackProbe();
      resolutionTasks.clear();
      probeGate.clear();
      requestContexts.clear();
      clearMediaObservations();
      clearEncryptedManifestEnvelopes();
    };
  }
  function installFetchCapture(policy, inspect, resolveAttempts, requestContexts) {
    const originalFetch = window.fetch;
    const fetchWrapper = async function(...args) {
      const url = requestUrl(args[0]);
      if (isManifestLike(url)) {
        requestContexts.remember(createFetchRequestContext(args, url, url));
      }
      const response = await originalFetch.apply(this, args);
      if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return response;
      const finalUrl = response.url || url;
      const requestContext2 = createFetchRequestContext(args, url, finalUrl);
      requestContexts.remember(requestContext2);
      const mimeType = response.headers.get("content-type");
      const candidate = reportMediaSource(finalUrl, mimeType);
      if (url && finalUrl !== url && [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(candidate?.kind)) {
        reportMediaSource(url, mimeType);
      }
      if (isManifestLike(finalUrl) || [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(candidate?.kind)) {
        response.clone().text().then((body) => {
          const primaryProbe = inspect(
            finalUrl,
            body,
            candidate,
            requestContext2
          );
          if (primaryProbe?.kind === MEDIA_KINDS.HLS && !isUsableMediaProbe(primaryProbe)) {
            resolveAttempts({
              manifestUrl: finalUrl,
              body,
              candidate,
              requestContext: requestContext2
            }).catch(() => {
            });
          }
        }).catch(() => {
        });
      }
      return response;
    };
    window.fetch = fetchWrapper;
    return () => {
      if (window.fetch === fetchWrapper) window.fetch = originalFetch;
    };
  }
  function installXhrCapture(policy, inspect, resolveAttempts, requestContexts) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const openWrapper = function(method, url, ...rest) {
      this.__adsfriendly_url = requestUrl(url);
      this.__adsfriendly_method = String(method || "GET").toUpperCase();
      return originalOpen.call(this, method, url, ...rest);
    };
    const sendWrapper = function(...args) {
      if (isManifestLike(this.__adsfriendly_url)) {
        requestContexts.remember(
          createXhrRequestContext(this, this.__adsfriendly_url || "")
        );
      }
      this.addEventListener("load", () => {
        if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
        const url = this.responseURL || this.__adsfriendly_url || "";
        const requestContext2 = createXhrRequestContext(this, url);
        requestContexts.remember(requestContext2);
        const mimeType = this.getResponseHeader("content-type");
        const candidate = reportMediaSource(url, mimeType);
        if (this.__adsfriendly_url && url !== this.__adsfriendly_url && [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(candidate?.kind)) {
          reportMediaSource(this.__adsfriendly_url, mimeType);
        }
        if (!isManifestLike(url) && ![MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(candidate?.kind))
          return;
        readXhrResponseBody(this).then((body) => {
          if (typeof body !== "string") return;
          const primaryProbe = inspect(url, body, candidate, requestContext2);
          if (primaryProbe?.kind === MEDIA_KINDS.HLS && !isUsableMediaProbe(primaryProbe)) {
            resolveAttempts({
              manifestUrl: url,
              body,
              candidate,
              requestContext: requestContext2
            }).catch(() => {
            });
          }
        }).catch(() => {
        });
      });
      return originalSend.apply(this, args);
    };
    XMLHttpRequest.prototype.open = openWrapper;
    XMLHttpRequest.prototype.send = sendWrapper;
    return () => {
      if (XMLHttpRequest.prototype.open === openWrapper)
        XMLHttpRequest.prototype.open = originalOpen;
      if (XMLHttpRequest.prototype.send === sendWrapper)
        XMLHttpRequest.prototype.send = originalSend;
    };
  }
  async function readXhrResponseBody(xhr) {
    const responseType = String(xhr?.responseType || "").toLowerCase();
    if (!responseType || responseType === "text") {
      return typeof xhr?.responseText === "string" ? xhr.responseText : null;
    }
    if (responseType === "arraybuffer" && xhr?.response instanceof ArrayBuffer) {
      return new TextDecoder().decode(xhr.response);
    }
    if (responseType === "blob" && xhr?.response instanceof Blob) {
      return xhr.response.text();
    }
    return null;
  }
  function installFallbackProbe({
    policy,
    originalFetch,
    probeGate,
    inspect,
    resolveAttempts,
    requestContexts
  }) {
    let stopped = false;
    const onProbeRequest = (messageEvent) => {
      if (stopped || messageEvent.source !== window || messageEvent.data?.source !== "adsfriendly-content" || !["PROBE_HLS_MANIFEST", "PROBE_MEDIA_MANIFEST"].includes(
        messageEvent.data?.type
      ) || !policy.can(CAPABILITIES.MEDIA_OBSERVE))
        return;
      const requestedKind = messageEvent.data.kind === MEDIA_KINDS.DASH ? MEDIA_KINDS.DASH : MEDIA_KINDS.HLS;
      const requestedUrl = messageEvent.data.manifestUrl;
      const candidate = createMediaCandidateFromSource({
        pageUrl: location.href,
        sourceUrl: requestedUrl,
        mimeType: requestedKind === MEDIA_KINDS.DASH ? "application/dash+xml" : "application/vnd.apple.mpegurl",
        title: document.title || null,
        detectedBy: MEDIA_DETECTION_SOURCES.NETWORK
      });
      const manifestUrl = probeGate.claim(requestedUrl);
      if (!manifestUrl) {
        reportProbeDiagnostic(candidate, {
          phase: "skipped",
          code: "probe_gate_duplicate"
        });
        return;
      }
      const observedRequestContext = requestContexts.find(manifestUrl);
      reportProbeDiagnostic(candidate, {
        phase: "dispatched",
        code: "manifest_fetch_dispatched"
      });
      fetchManifestWithTimeout(
        originalFetch,
        manifestUrl,
        createContextualProbeInit(observedRequestContext)
      ).then(async (response) => {
        if (!response.ok)
          throw new Error(`manifest_http_${response.status || "error"}`);
        const finalUrl = response.url || manifestUrl;
        const body = await response.text();
        reportProbeDiagnostic(candidate, {
          phase: "response_received",
          code: "manifest_body_received",
          httpStatus: response.status,
          bodyBytes: byteLength2(body),
          bodyFormat: detectManifestBodyFormat(body)
        });
        const finalCandidate = finalUrl === manifestUrl ? candidate : reportMediaSource(
          finalUrl,
          response.headers.get("content-type")
        ) || candidate;
        const primaryProbe = inspect(
          finalUrl,
          body,
          finalCandidate,
          createFallbackRequestContext(
            manifestUrl,
            finalUrl,
            observedRequestContext
          )
        );
        if (requestedKind === MEDIA_KINDS.DASH || isUsableMediaProbe(primaryProbe))
          return primaryProbe;
        return await resolveAttempts({
          manifestUrl: finalUrl,
          body,
          candidate: finalCandidate,
          requestContext: observedRequestContext
        }) || primaryProbe;
      }).catch((error) => {
        if (probeGate.state(manifestUrl) !== "pending") return;
        probeGate.release(manifestUrl);
        const errorCode = probeErrorCode(error);
        reportProbeDiagnostic(candidate, {
          phase: "failed",
          code: errorCode,
          httpStatus: httpStatusFromProbeError(errorCode)
        });
        reportProbeFailure(manifestUrl, candidate, errorCode);
        if (errorCode === "manifest_http_403" && messageEvent.data.contextualRetry !== true) {
          notifyContentScript({
            type: "MEDIA_PROBE_CONTEXT_REQUIRED",
            mediaId: candidate.id,
            kind: candidate.kind,
            manifestUrl
          });
        }
      });
    };
    window.addEventListener("message", onProbeRequest);
    return () => {
      stopped = true;
      window.removeEventListener("message", onProbeRequest);
    };
  }
  async function tryHlsProbeAttempts({
    manifestUrl,
    body,
    candidate,
    originalFetch,
    probeGate,
    inspect,
    requestContext: requestContext2 = null
  }) {
    for (const attempt of createHlsProbeAttempts(manifestUrl, body)) {
      try {
        const response = await originalFetch.call(
          window,
          attempt.url,
          createContextualProbeInit(requestContext2)
        );
        if (!response.ok) continue;
        const finalUrl = response.url || attempt.url;
        const alternativeBody = await response.text();
        if (!isUsableMediaProbe(parseHlsManifest(finalUrl, alternativeBody))) {
          continue;
        }
        const alternativeCandidate = createMediaCandidateFromSource({
          pageUrl: location.href,
          sourceUrl: finalUrl,
          mimeType: response.headers.get("content-type"),
          title: document.title || null,
          detectedBy: MEDIA_DETECTION_SOURCES.NETWORK
        }) || candidate;
        const alternativeProbe = inspect(
          finalUrl,
          alternativeBody,
          alternativeCandidate,
          createFallbackRequestContext(manifestUrl, finalUrl, requestContext2),
          attempt
        );
        if (isUsableMediaProbe(alternativeProbe)) {
          probeGate.remember(manifestUrl, "ready");
          return alternativeProbe;
        }
      } catch {
      }
    }
    return null;
  }
  function reportMediaSource(sourceUrl, mimeType) {
    const candidate = createMediaCandidateFromSource({
      pageUrl: location.href,
      sourceUrl,
      mimeType,
      title: document.title || null,
      detectedBy: MEDIA_DETECTION_SOURCES.NETWORK
    });
    if (!candidate) return null;
    rememberMediaObservation(candidate);
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate)
    });
    return candidate;
  }
  function inspectManifest(manifestUrl, body, candidate, requestContext2 = null, resolutionAttempt = null) {
    analyzeManifest(manifestUrl, body);
    let manifestCandidate = candidate;
    if (![MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(manifestCandidate?.kind) && typeof body === "string" && body.replace(/^\uFEFF/, "").trimStart().startsWith("#EXTM3U")) {
      manifestCandidate = reportMediaSource(
        manifestUrl,
        "application/vnd.apple.mpegurl"
      );
    }
    if (manifestCandidate?.kind !== MEDIA_KINDS.DASH && typeof body === "string" && /^\s*(?:<\?xml[^>]*>\s*)?<MPD\b/i.test(body.replace(/^\uFEFF/, ""))) {
      manifestCandidate = reportMediaSource(manifestUrl, "application/dash+xml");
    }
    if (![MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(manifestCandidate?.kind))
      return null;
    const manifestEnvelope = rememberEncryptedManifestEnvelope({
      candidate: manifestCandidate,
      manifestUrl,
      body,
      requestContext: requestContext2
    });
    const parsedProbe = manifestCandidate.kind === MEDIA_KINDS.DASH ? parseDashManifest(manifestUrl, body) : parseHlsManifest(manifestUrl, body);
    const probe = { kind: manifestCandidate.kind, ...parsedProbe };
    const diagnosticCode = parsedProbeDiagnosticCode(probe);
    reportProbeDiagnostic(manifestCandidate, {
      phase: "parsed",
      code: diagnosticCode,
      bodyBytes: byteLength2(body),
      bodyFormat: detectManifestBodyFormat(body),
      playlistType: probe.playlistType,
      segmentCount: probe.segmentCount,
      observationSource: "network_response",
      envelopeScheme: manifestEnvelope?.scheme || null,
      evidence: manifestEnvelope?.evidence || []
    });
    if (diagnosticCode !== "manifest_parsed") {
      notifyContentScript({
        type: "MEDIA_DEBUG_MANIFEST_CAPTURE",
        capture: {
          mediaId: manifestCandidate.id,
          manifestUrl: manifestCandidate.manifestUrl,
          kind: manifestCandidate.kind,
          body,
          bodyFormat: detectManifestBodyFormat(body),
          reason: diagnosticCode
        }
      });
    }
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_PROBED, {
        mediaId: manifestCandidate.id,
        pageUrl: location.href,
        manifestUrl: manifestCandidate.manifestUrl,
        kind: manifestCandidate.kind,
        ...probe,
        requestContext: requestContext2,
        resolutionAttempt,
        probeSource: "network_response",
        manifestEnvelope
      })
    });
    return probe;
  }
  function reportProbeFailure(manifestUrl, candidate, error) {
    if (![MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(candidate?.kind)) return;
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_PROBED, {
        mediaId: candidate.id,
        pageUrl: location.href,
        manifestUrl,
        kind: candidate.kind,
        status: "failed",
        error
      })
    });
  }
  function probeErrorCode(error) {
    const message = error?.message || "";
    const httpMatch = /manifest_http_\d+/.exec(message);
    if (httpMatch) return httpMatch[0];
    if (/manifest_probe_timeout|abort/i.test(message))
      return "manifest_probe_timeout";
    return "fallback_fetch_blocked";
  }
  function reportProbeDiagnostic(candidate, facts) {
    if (![MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(candidate?.kind)) return;
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_PROBE_DIAGNOSTIC, {
        mediaId: candidate.id,
        pageUrl: location.href,
        manifestUrl: candidate.manifestUrl,
        kind: candidate.kind,
        observedAt: Date.now(),
        ...facts
      })
    });
  }
  async function fetchManifestWithTimeout(originalFetch, manifestUrl, init, timeoutMs = 1e4) {
    const controller2 = new AbortController();
    const timerId = setTimeout(() => controller2.abort(), timeoutMs);
    try {
      return await originalFetch.call(window, manifestUrl, {
        ...init,
        signal: controller2.signal
      });
    } catch (error) {
      if (controller2.signal.aborted)
        throw new Error("manifest_probe_timeout", { cause: error });
      throw error;
    } finally {
      clearTimeout(timerId);
    }
  }
  function parsedProbeDiagnosticCode(probe) {
    if (probe.status === "unsupported") return "manifest_unsupported";
    if (probe.status === "failed") return probe.error || "manifest_parse_failed";
    if (probe.playlistType === "unknown") return "manifest_parsed_no_stream";
    if (probe.playlistType === "media" && !probe.segmentCount && !probe.partialSegmentCount)
      return "manifest_parsed_zero_segments";
    return "manifest_parsed";
  }
  function detectManifestBodyFormat(body) {
    const normalized = String(body || "").replace(/^\uFEFF/, "").trimStart();
    if (normalized.startsWith("#EXTM3U")) return "hls";
    if (/^(?:<\?xml[^>]*>\s*)?<MPD\b/i.test(normalized)) return "dash";
    return "unknown";
  }
  function byteLength2(value) {
    return new TextEncoder().encode(String(value || "")).byteLength;
  }
  function httpStatusFromProbeError(code) {
    const match = /manifest_http_(\d+)/.exec(code || "");
    return match ? Number(match[1]) : null;
  }
  function requestUrl(input) {
    if (!input) return "";
    if (typeof input === "string") return input;
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.href;
    return input.toString();
  }
  function isManifestLike(url = "") {
    const normalized = String(url || "").toLowerCase();
    return normalized.includes(".m3u8") || normalized.includes(".mpd") || normalized.includes("player/v1/player");
  }
  function createFetchRequestContext(args, originalUrl, finalUrl) {
    const input = args[0];
    const init = args[1] && typeof args[1] === "object" && !Array.isArray(args[1]) ? args[1] : {};
    const request = input && typeof input === "object" ? input : {};
    const credentials = normalizeCredentials(
      init.credentials || request.credentials || "same-origin"
    );
    return requestContext({
      requestUrl: originalUrl,
      finalUrl,
      method: init.method || request.method || "GET",
      credentials,
      referrer: init.referrer || request.referrer || location.href,
      transport: "fetch"
    });
  }
  function createXhrRequestContext(xhr, finalUrl) {
    return requestContext({
      requestUrl: xhr.__adsfriendly_url,
      finalUrl,
      method: xhr.__adsfriendly_method || "GET",
      credentials: xhr.withCredentials ? "include" : "same-origin",
      referrer: location.href,
      transport: "xhr"
    });
  }
  function createFallbackRequestContext(manifestUrl, finalUrl = manifestUrl, observedContext = null) {
    return requestContext({
      requestUrl: manifestUrl,
      finalUrl,
      method: "GET",
      credentials: observedContext?.credentials || "same-origin",
      referrer: observedContext?.referrer || observedContext?.documentUrl || location.href,
      transport: "fallback"
    });
  }
  function createContextualProbeInit(observedContext, currentDocumentUrl = globalThis.location?.href || "") {
    const credentials = ["omit", "same-origin", "include"].includes(
      observedContext?.credentials
    ) ? observedContext.credentials : "same-origin";
    const init = { credentials, cache: "default" };
    const referrer = [
      observedContext?.referrer,
      observedContext?.documentUrl,
      currentDocumentUrl
    ].find((value) => sameOrigin(value, currentDocumentUrl));
    if (referrer) init.referrer = referrer;
    return init;
  }
  function requestContext({
    requestUrl: sourceUrl,
    finalUrl,
    method,
    credentials,
    referrer,
    transport
  }) {
    const documentUrl = location.href;
    return {
      requestUrl: String(sourceUrl || ""),
      finalUrl: String(finalUrl || sourceUrl || ""),
      documentUrl,
      parentDocumentUrl: String(document.referrer || ""),
      referrer: String(referrer || ""),
      method: String(method || "GET").toUpperCase(),
      credentials,
      transport,
      requiresBrowserSession: credentials === "include" || credentials === "same-origin" && sameOrigin(finalUrl || sourceUrl, documentUrl)
    };
  }
  function normalizeCredentials(value) {
    return ["omit", "same-origin", "include"].includes(value) ? value : "unknown";
  }
  function sameOrigin(left, right) {
    try {
      return new URL(left, right).origin === new URL(right).origin;
    } catch {
      return false;
    }
  }

  // src/main-world/player-source-observer.js
  var SCAN_DELAYS_MS = Object.freeze([0, 300, 1e3, 3e3, 8e3, 15e3]);
  var JW_EVENTS = Object.freeze([
    "ready",
    "playlist",
    "playlistItem",
    "levels",
    "levelsChanged",
    "firstFrame",
    "play"
  ]);
  function installPlayerSourceObserver(policy) {
    const timers = /* @__PURE__ */ new Set();
    const observedPlayers = /* @__PURE__ */ new WeakSet();
    const cleanups = [];
    let stopped = false;
    let mutationTimer = null;
    const stopFactoryWatch = watchJwPlayerFactory(() => scheduleScan(0));
    for (const delay of SCAN_DELAYS_MS) {
      scheduleScan(delay);
    }
    const mutationObserver = typeof MutationObserver === "function" ? new MutationObserver((mutations) => {
      if (!mutations.some(containsPossiblePlayer)) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (node?.nodeType !== 1 || !node.matches?.("script")) continue;
          const onLoad = () => scheduleScan(0);
          node.addEventListener("load", onLoad, { once: true });
          cleanups.push(() => node.removeEventListener("load", onLoad));
        }
      }
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(scan, 100);
    }) : null;
    mutationObserver?.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
      timers.clear();
      clearTimeout(mutationTimer);
      mutationObserver?.disconnect();
      stopFactoryWatch();
      for (const cleanup of cleanups.reverse()) cleanup();
    };
    function scheduleScan(delay) {
      if (stopped) return;
      const timerId = setTimeout(() => {
        timers.delete(timerId);
        scan();
      }, delay);
      timers.add(timerId);
    }
    function scan() {
      if (stopped || !policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
      const factory = globalThis.jwplayer;
      if (typeof factory !== "function") return;
      const players = [];
      addPlayer(players, () => factory());
      document.querySelectorAll?.(".jwplayer[id], [data-jwplayer-id][id]").forEach((element) => addPlayer(players, () => factory(element.id)));
      for (const player of players) observePlayer(player);
    }
    function observePlayer(player) {
      reportPlayer(player);
      if (observedPlayers.has(player)) return;
      observedPlayers.add(player);
      if (typeof player.on !== "function") return;
      for (const eventName of JW_EVENTS) {
        const listener = () => reportPlayer(player);
        try {
          player.on(eventName, listener);
          cleanups.push(() => {
            try {
              player.off?.(eventName, listener);
            } catch {
            }
          });
        } catch {
        }
      }
    }
    function reportPlayer(player) {
      if (stopped || !policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
      for (const source of extractJwPlayerSources(player)) {
        const candidate = createMediaCandidateFromSource({
          pageUrl: location.href,
          sourceUrl: source.url,
          mimeType: source.mimeType,
          title: source.title || document.title || null,
          detectedBy: MEDIA_DETECTION_SOURCES.PLAYER
        });
        if (!candidate) continue;
        rememberMediaObservation(candidate);
        notifyContentScript({
          type: "REGISTERED_EVENT",
          event: createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate, {
            playerAdapter: "jwplayer"
          })
        });
      }
    }
  }
  function extractJwPlayerSources(player) {
    if (!player || typeof player !== "object") return [];
    const items = [];
    try {
      const current = player.getPlaylistItem?.();
      if (current) items.push(current);
    } catch {
    }
    try {
      const playlist = player.getPlaylist?.();
      if (Array.isArray(playlist)) items.push(...playlist);
    } catch {
    }
    const sources = [];
    for (const item of items) {
      const title = safeString(item?.title);
      addSource(sources, item?.file, item?.type, title, item?.label);
      for (const source of Array.isArray(item?.sources) ? item.sources : []) {
        addSource(
          sources,
          source?.file || source?.src,
          source?.type,
          title,
          source?.label
        );
      }
    }
    return [
      ...new Map(sources.map((source) => [source.url, source])).values()
    ];
  }
  function addPlayer(players, readPlayer) {
    try {
      const player = readPlayer();
      if (player && typeof player === "object" && !players.includes(player)) {
        players.push(player);
      }
    } catch {
    }
  }
  function addSource(sources, value, mimeType, title, label) {
    if (typeof value !== "string" || !value.trim()) return;
    try {
      const url = new URL(value, location.href);
      if (!["http:", "https:"].includes(url.protocol)) return;
      sources.push({
        url: url.href,
        mimeType: safeString(mimeType),
        title,
        label: safeString(label)
      });
    } catch {
    }
  }
  function safeString(value) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
  }
  function containsPossiblePlayer(mutation) {
    return [...mutation.addedNodes || []].some(
      (node) => node?.nodeType === 1 && (node.matches?.("script, .jwplayer, [data-jwplayer-id]") || node.querySelector?.(".jwplayer, [data-jwplayer-id]"))
    );
  }
  function watchJwPlayerFactory(onAvailable) {
    const target = globalThis;
    const existing = Object.getOwnPropertyDescriptor(target, "jwplayer");
    if (existing || !Object.isExtensible(target)) return () => {
    };
    let active = true;
    const getter = () => void 0;
    const setter = (value) => {
      active = false;
      Object.defineProperty(target, "jwplayer", {
        configurable: true,
        enumerable: true,
        writable: true,
        value
      });
      if (typeof value === "function") onAvailable();
    };
    try {
      Object.defineProperty(target, "jwplayer", {
        configurable: true,
        enumerable: true,
        get: getter,
        set: setter
      });
    } catch {
      return () => {
      };
    }
    return () => {
      if (!active) return;
      const current = Object.getOwnPropertyDescriptor(target, "jwplayer");
      if (current?.get === getter && current?.set === setter) {
        delete target.jwplayer;
      }
    };
  }

  // src/main-world/blob-source-tracer.js
  var MAX_SOURCE_URLS = 32;
  var MAX_MIME_TYPES = 8;
  var REPORT_DELAY_MS = 200;
  function installBlobSourceTracer(policy) {
    const bufferSources = /* @__PURE__ */ new WeakMap();
    const blobSources = /* @__PURE__ */ new WeakMap();
    const mediaSourceStates = /* @__PURE__ */ new WeakMap();
    const sourceBufferStates = /* @__PURE__ */ new WeakMap();
    const objectUrlStates = /* @__PURE__ */ new Map();
    const cleanups = [];
    patchResponseArrayBuffer();
    patchResponseBlob();
    patchBlobArrayBuffer();
    patchXhrResponse();
    patchMediaSource();
    patchObjectUrls();
    return () => {
      for (const cleanup of cleanups.reverse()) cleanup();
      for (const state of objectUrlStates.values()) clearTimeout(state.timerId);
      objectUrlStates.clear();
    };
    function patchResponseArrayBuffer() {
      const original = globalThis.Response?.prototype?.arrayBuffer;
      if (typeof original !== "function") return;
      const wrapper = async function(...args) {
        const value = await original.apply(this, args);
        rememberBuffer(value, responseSource(this));
        return value;
      };
      Response.prototype.arrayBuffer = wrapper;
      cleanups.push(() => {
        if (Response.prototype.arrayBuffer === wrapper)
          Response.prototype.arrayBuffer = original;
      });
    }
    function patchResponseBlob() {
      const original = globalThis.Response?.prototype?.blob;
      if (typeof original !== "function") return;
      const wrapper = async function(...args) {
        const value = await original.apply(this, args);
        if (value instanceof Blob) blobSources.set(value, responseSource(this));
        return value;
      };
      Response.prototype.blob = wrapper;
      cleanups.push(() => {
        if (Response.prototype.blob === wrapper)
          Response.prototype.blob = original;
      });
    }
    function patchBlobArrayBuffer() {
      const original = globalThis.Blob?.prototype?.arrayBuffer;
      if (typeof original !== "function") return;
      const wrapper = async function(...args) {
        const value = await original.apply(this, args);
        rememberBuffer(value, blobSources.get(this));
        return value;
      };
      Blob.prototype.arrayBuffer = wrapper;
      cleanups.push(() => {
        if (Blob.prototype.arrayBuffer === wrapper)
          Blob.prototype.arrayBuffer = original;
      });
    }
    function patchXhrResponse() {
      const prototype = globalThis.XMLHttpRequest?.prototype;
      const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "response") : null;
      if (!prototype || typeof descriptor?.get !== "function" || !descriptor.configurable)
        return;
      const getter = function() {
        const value = descriptor.get.call(this);
        const source = {
          url: this.responseURL || this.__adsfriendly_url || "",
          mimeType: safeXhrContentType(this),
          observedAt: Date.now()
        };
        if (value instanceof ArrayBuffer) rememberBuffer(value, source);
        else if (value instanceof Blob) blobSources.set(value, source);
        return value;
      };
      Object.defineProperty(prototype, "response", {
        ...descriptor,
        get: getter
      });
      cleanups.push(() => {
        const current = Object.getOwnPropertyDescriptor(prototype, "response");
        if (current?.get === getter)
          Object.defineProperty(prototype, "response", descriptor);
      });
    }
    function patchMediaSource() {
      const mediaSourcePrototype = globalThis.MediaSource?.prototype;
      const sourceBufferPrototype = globalThis.SourceBuffer?.prototype;
      const originalAdd = mediaSourcePrototype?.addSourceBuffer;
      const originalAppend = sourceBufferPrototype?.appendBuffer;
      if (typeof originalAdd === "function") {
        const addWrapper = function(mimeType) {
          const sourceBuffer = originalAdd.call(this, mimeType);
          const state = mediaSourceState(this);
          rememberBounded(
            state.mimeTypes,
            String(mimeType || ""),
            MAX_MIME_TYPES
          );
          sourceBufferStates.set(sourceBuffer, { state, mimeType });
          scheduleReport(state);
          return sourceBuffer;
        };
        mediaSourcePrototype.addSourceBuffer = addWrapper;
        cleanups.push(() => {
          if (mediaSourcePrototype.addSourceBuffer === addWrapper)
            mediaSourcePrototype.addSourceBuffer = originalAdd;
        });
      }
      if (typeof originalAppend === "function") {
        const appendWrapper = function(value) {
          const sourceBufferState = sourceBufferStates.get(this);
          if (sourceBufferState) {
            const state = sourceBufferState.state;
            const buffer = value instanceof ArrayBuffer ? value : value?.buffer;
            const source = bufferSources.get(buffer);
            state.appendCount += 1;
            state.totalAppendedBytes += Number(value?.byteLength || 0);
            state.lastAppendAt = Date.now();
            if (source?.url) {
              rememberBounded(state.sourceUrls, source.url, MAX_SOURCE_URLS);
              if (source.mimeType)
                rememberBounded(state.mimeTypes, source.mimeType, MAX_MIME_TYPES);
            }
            scheduleReport(state);
          }
          return originalAppend.call(this, value);
        };
        sourceBufferPrototype.appendBuffer = appendWrapper;
        cleanups.push(() => {
          if (sourceBufferPrototype.appendBuffer === appendWrapper)
            sourceBufferPrototype.appendBuffer = originalAppend;
        });
      }
    }
    function patchObjectUrls() {
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;
      if (typeof originalCreate === "function") {
        const createWrapper = function(object) {
          const objectUrl = originalCreate.call(this, object);
          if (object instanceof Blob) publishCreatedBlob(object, objectUrl);
          if (object instanceof MediaSource) {
            const state = mediaSourceState(object);
            state.blobUrl = objectUrl;
            objectUrlStates.set(objectUrl, state);
            scheduleReport(state);
          } else if (object instanceof Blob) {
            const source = blobSources.get(object);
            if (source?.url) {
              const state = createTraceState(objectUrl, "blob_object");
              rememberBounded(state.sourceUrls, source.url, MAX_SOURCE_URLS);
              if (source.mimeType || object.type)
                rememberBounded(
                  state.mimeTypes,
                  source.mimeType || object.type,
                  MAX_MIME_TYPES
                );
              state.totalAppendedBytes = object.size || 0;
              objectUrlStates.set(objectUrl, state);
              scheduleReport(state);
            }
          }
          return objectUrl;
        };
        URL.createObjectURL = createWrapper;
        cleanups.push(() => {
          if (URL.createObjectURL === createWrapper)
            URL.createObjectURL = originalCreate;
        });
      }
      if (typeof originalRevoke === "function") {
        const revokeWrapper = function(objectUrl) {
          const state = objectUrlStates.get(String(objectUrl));
          if (state) {
            clearTimeout(state.timerId);
            objectUrlStates.delete(String(objectUrl));
          }
          return originalRevoke.call(this, objectUrl);
        };
        URL.revokeObjectURL = revokeWrapper;
        cleanups.push(() => {
          if (URL.revokeObjectURL === revokeWrapper)
            URL.revokeObjectURL = originalRevoke;
        });
      }
    }
    function mediaSourceState(mediaSource) {
      let state = mediaSourceStates.get(mediaSource);
      if (!state) {
        state = createTraceState(null, "media_source");
        mediaSourceStates.set(mediaSource, state);
      }
      return state;
    }
    function scheduleReport(state) {
      if (!state.blobUrl || !policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
      clearTimeout(state.timerId);
      state.timerId = setTimeout(() => reportState(state), REPORT_DELAY_MS);
    }
    function reportState(state) {
      state.timerId = null;
      if (!state.blobUrl || !policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
      const related = findRelatedMediaObservations(state.sourceUrls, {
        observedAt: state.lastAppendAt || Date.now(),
        allowedKinds: state.traceKind === "media_source" ? ["hls", "dash"] : ["direct"]
      });
      const signature = JSON.stringify({
        sourceUrls: state.sourceUrls,
        candidateIds: related.map((item) => item.id),
        appendCount: state.appendCount,
        totalAppendedBytes: state.totalAppendedBytes
      });
      if (signature === state.lastReportSignature) return;
      state.lastReportSignature = signature;
      notifyContentScript({
        type: "REGISTERED_EVENT",
        event: createRegisteredEvent(EVENTS.MEDIA_BLOB_TRACED, {
          mediaId: stableMediaId("blob", state.blobUrl),
          pageUrl: location.href,
          blobUrl: state.blobUrl,
          sourceUrls: state.sourceUrls,
          candidateIds: related.map((item) => item.id),
          mimeTypes: state.mimeTypes,
          appendCount: state.appendCount,
          totalAppendedBytes: state.totalAppendedBytes,
          observedAt: Date.now()
        })
      });
    }
    function rememberBuffer(buffer, source) {
      if (buffer instanceof ArrayBuffer && source?.url)
        bufferSources.set(buffer, source);
    }
  }
  function createTraceState(blobUrl, traceKind) {
    return {
      blobUrl,
      traceKind,
      sourceUrls: [],
      mimeTypes: [],
      appendCount: 0,
      totalAppendedBytes: 0,
      lastAppendAt: null,
      lastReportSignature: null,
      timerId: null
    };
  }
  function responseSource(response) {
    return {
      url: response?.url || "",
      mimeType: response?.headers?.get?.("content-type") || "",
      observedAt: Date.now()
    };
  }
  function safeXhrContentType(xhr) {
    try {
      return xhr.getResponseHeader("content-type") || "";
    } catch {
      return "";
    }
  }
  function rememberBounded(items, value, maximum) {
    if (!value || items.includes(value)) return;
    items.push(value);
    if (items.length > maximum) items.shift();
  }

  // src/main-world/eme-observer.js
  function installEmeObserver() {
    const cleanups = [];
    const observedSessions = /* @__PURE__ */ new WeakSet();
    const mediaKeysSystems = /* @__PURE__ */ new WeakMap();
    const sessionSystems = /* @__PURE__ */ new WeakMap();
    const onEncrypted = (event2) => {
      emit({ initDataType: event2.initDataType || null });
    };
    document.addEventListener("encrypted", onEncrypted, true);
    cleanups.push(
      () => document.removeEventListener("encrypted", onEncrypted, true)
    );
    patchMethod(
      navigator,
      "requestMediaKeySystemAccess",
      (original) => function requestMediaKeySystemAccess(keySystem, configurations) {
        const requestedKeySystem = typeof keySystem === "string" ? keySystem : null;
        emit({
          keySystem: requestedKeySystem,
          encryptionSchemes: collectEncryptionSchemes(configurations),
          licenseStatus: "requested"
        });
        return original.apply(this, arguments);
      },
      cleanups
    );
    patchMethod(
      globalThis.MediaKeySystemAccess?.prototype,
      "createMediaKeys",
      (original) => function createMediaKeys() {
        const keySystem = this.keySystem || null;
        return Promise.resolve(original.apply(this, arguments)).then(
          (mediaKeys) => {
            if (mediaKeys) mediaKeysSystems.set(mediaKeys, keySystem);
            return mediaKeys;
          }
        );
      },
      cleanups
    );
    patchMethod(
      globalThis.MediaKeys?.prototype,
      "createSession",
      (original) => function createSession() {
        const session = original.apply(this, arguments);
        const keySystem = mediaKeysSystems.get(this) || null;
        if (session) sessionSystems.set(session, keySystem);
        observeSession(session, keySystem);
        return session;
      },
      cleanups
    );
    patchMethod(
      globalThis.MediaKeySession?.prototype,
      "generateRequest",
      (original) => function generateRequest(initDataType) {
        emit({
          keySystem: sessionSystems.get(this) || null,
          initDataType: typeof initDataType === "string" ? initDataType : null,
          licenseStatus: "requested"
        });
        return original.apply(this, arguments);
      },
      cleanups
    );
    patchMethod(
      globalThis.MediaKeySession?.prototype,
      "update",
      (original) => function update() {
        const result = original.apply(this, arguments);
        return Promise.resolve(result).then(
          (value) => {
            emit({
              keySystem: sessionSystems.get(this) || null,
              licenseStatus: "updated"
            });
            return value;
          },
          (error) => {
            emit({
              keySystem: sessionSystems.get(this) || null,
              licenseStatus: "error"
            });
            throw error;
          }
        );
      },
      cleanups
    );
    return () => cleanups.reverse().forEach((cleanup) => cleanup());
    function observeSession(session, keySystem) {
      if (!session || observedSessions.has(session)) return;
      observedSessions.add(session);
      const onStatusesChanged = () => {
        const keyStatuses = [];
        try {
          session.keyStatuses?.forEach((status) => keyStatuses.push(status));
        } catch {
        }
        emit({
          keySystem,
          keyStatuses,
          licenseStatus: licenseStatusFromKeyStatuses(keyStatuses)
        });
      };
      session.addEventListener?.("keystatuseschange", onStatusesChanged);
      cleanups.push(
        () => session.removeEventListener?.("keystatuseschange", onStatusesChanged)
      );
    }
    function emit(payload) {
      notifyContentScript({
        type: "REGISTERED_EVENT",
        event: createRegisteredEvent(EVENTS.MEDIA_EME_OBSERVED, {
          pageUrl: location.href,
          ...payload,
          observedAt: Date.now()
        })
      });
    }
  }
  function patchMethod(target, property, createReplacement, cleanups) {
    if (!target || typeof target[property] !== "function") return;
    const original = target[property];
    const replacement = createReplacement(original);
    try {
      target[property] = replacement;
      cleanups.push(() => {
        try {
          if (target[property] === replacement) target[property] = original;
        } catch {
        }
      });
    } catch {
    }
  }
  function collectEncryptionSchemes(configurations) {
    const schemes = [];
    for (const configuration of Array.isArray(configurations) ? configurations : []) {
      for (const capability2 of [
        ...configuration?.audioCapabilities || [],
        ...configuration?.videoCapabilities || []
      ]) {
        if (typeof capability2?.encryptionScheme === "string")
          schemes.push(capability2.encryptionScheme);
      }
    }
    return [...new Set(schemes)].slice(0, 8);
  }
  function licenseStatusFromKeyStatuses(statuses) {
    if (statuses.includes("usable")) return "usable";
    if (statuses.includes("expired")) return "expired";
    if (statuses.includes("output-restricted") || statuses.includes("output-downscaled"))
      return "restricted";
    if (statuses.includes("internal-error")) return "error";
    return null;
  }

  // src/main-world/timer-control.js
  var isAdMode = false;
  var timerPolicy = null;
  function setAdMode(value) {
    isAdMode = !!value;
    console.log("[AdsFriendly Spy] Ad mode changed:", isAdMode);
  }
  function installTimerControl(policy) {
    timerPolicy = policy;
    const originalTimeout = window.setTimeout;
    const originalInterval = window.setInterval;
    const timeoutWrapper = (handler, timeout, ...args) => originalTimeout(handler, scaled(timeout), ...args);
    const intervalWrapper = (handler, timeout, ...args) => originalInterval(handler, scaled(timeout), ...args);
    window.setTimeout = timeoutWrapper;
    window.setInterval = intervalWrapper;
    return () => {
      if (window.setTimeout === timeoutWrapper)
        window.setTimeout = originalTimeout;
      if (window.setInterval === intervalWrapper)
        window.setInterval = originalInterval;
      timerPolicy = null;
      isAdMode = false;
    };
  }
  function scaled(timeout) {
    return isAdMode && timerPolicy?.can(CAPABILITIES.VIDEO_AUTO_ACTION) && typeof timeout === "number" && timeout > 50 ? timeout / 100 : timeout;
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
    initialSettings: initialSettings2 = null,
    watchSettings = true,
    settingsLoader = loadSettings,
    settingsSubscriber = subscribeSettings,
    logger = console
  }) {
    const catalogFeatures = getFeaturesForContext(context);
    validateImplementations(context, catalogFeatures, implementations);
    let settings = normalizeSettings(initialSettings2 || DEFAULT_SETTINGS);
    let unsubscribe = null;
    let started = false;
    const lifecycles = /* @__PURE__ */ new Map();
    const listeners = /* @__PURE__ */ new Set();
    const controller2 = {
      context,
      async start() {
        if (started) return controller2;
        started = true;
        if (!initialSettings2) settings = await settingsLoader();
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

  // src/main-world/index.js
  var script = document.currentScript;
  var initialSettings = {
    enabled: script?.dataset.protectionEnabled !== "false",
    protectionMode: script?.dataset.protectionMode || "safe"
  };
  var controller = createMainController({
    context: "main-world",
    initialSettings,
    watchSettings: false,
    implementations: {
      "main-world.network-capture": ({ policy }) => installNetworkCapture(policy),
      "main-world.player-source-observer": ({ policy }) => installPlayerSourceObserver(policy),
      "main-world.decrypted-manifest-observer": ({ policy }) => installDecryptedManifestObserver(policy),
      "main-world.blob-source-tracer": ({ policy }) => installBlobSourceTracer(policy),
      "main-world.eme-observer": () => installEmeObserver(),
      "main-world.timer-control": ({ policy }) => installTimerControl(policy)
    }
  });
  onContentMessage((message) => {
    if (message.type === "SET_AD_MODE") setAdMode(message.value);
    if (message.type === "PROTECTION_SETTINGS_CHANGED")
      controller.updateSettings(message.settings);
  });
  console.log("[AdsFriendly Spy] Injected and controlled by MainController.");
  controller.start().catch(
    (error) => console.error("[AdsFriendly Spy] MainController failed", error)
  );
})();
