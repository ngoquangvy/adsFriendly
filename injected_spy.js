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
  var MEDIA_PROBE_STATES = Object.freeze({
    DISCOVERED: "discovered",
    READY: "ready",
    UNSUPPORTED: "unsupported",
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
        ["master", "media"],
        "playlistType"
      ),
      streamType: optionalEnumValue(
        value.streamType,
        ["vod", "live"],
        "streamType"
      ),
      duration: optionalFiniteNumber(value.duration),
      targetDuration: optionalFiniteNumber(value.targetDuration),
      segmentCount: optionalNonNegativeInteger(value.segmentCount),
      encryptionMethods: normalizeStrings(value.encryptionMethods)
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
        ["master", "media"],
        "playlistType"
      ),
      streamType: optionalEnumValue(
        value.streamType,
        ["vod", "live"],
        "streamType"
      ),
      variants: normalizeArray(value.variants),
      audioTracks: normalizeArray(value.audioTracks),
      subtitles: normalizeArray(value.subtitles),
      duration: optionalFiniteNumber(value.duration),
      targetDuration: optionalFiniteNumber(value.targetDuration),
      segmentCount: optionalNonNegativeInteger(value.segmentCount),
      encryptionMethods: normalizeStrings(value.encryptionMethods),
      drm: enumValue(
        value.drm || DRM_STATES.NONE,
        Object.values(DRM_STATES),
        "drm"
      )
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
  function classifyMediaSource(sourceUrl = "", mimeType = "") {
    const normalizedUrl = String(sourceUrl).trim().toLowerCase();
    const normalizedMime = String(mimeType).split(";")[0].trim().toLowerCase();
    const path = normalizedUrl.split(/[?#]/)[0];
    if (normalizedUrl.startsWith("blob:")) return MEDIA_KINDS.BLOB;
    if (path.endsWith(".m3u8") || HLS_MIME_TYPES.has(normalizedMime))
      return MEDIA_KINDS.HLS;
    if (path.endsWith(".mpd") || DASH_MIME_TYPES.has(normalizedMime))
      return MEDIA_KINDS.DASH;
    if (/\.(mp4|webm|m4v|mov)$/.test(path) || normalizedMime.startsWith("video/"))
      return MEDIA_KINDS.DIRECT;
    return null;
  }
  function createMediaCandidateFromSource({
    pageUrl,
    sourceUrl,
    mimeType = null,
    title = null,
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
      const audioTracks = [];
      const subtitles = [];
      const encryptionMethods = /* @__PURE__ */ new Set();
      let pendingVariant = null;
      let segmentCount = 0;
      let duration = 0;
      let targetDuration = null;
      let hasEndList = false;
      let declaredPlaylistType = null;
      for (const line of lines) {
        if (!line) continue;
        if (pendingVariant && !line.startsWith("#")) {
          if (variants.length < MAX_VARIANTS) {
            variants.push(normalizeVariant(pendingVariant, line, manifestUrl));
          }
          pendingVariant = null;
          continue;
        }
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          pendingVariant = parseAttributeList(valueAfterColon(line));
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
          const method = parseAttributeList(valueAfterColon(line)).METHOD;
          if (method && method.toUpperCase() !== "NONE")
            encryptionMethods.add(method.toUpperCase());
          continue;
        }
        if (line.startsWith("#EXTINF:")) {
          const value = Number(valueAfterColon(line).split(",", 1)[0]);
          if (Number.isFinite(value) && value >= 0) duration += value;
          segmentCount += 1;
          continue;
        }
        if (line.startsWith("#EXT-X-TARGETDURATION:")) {
          const value = Number(valueAfterColon(line));
          if (Number.isFinite(value) && value >= 0) targetDuration = value;
          continue;
        }
        if (line === "#EXT-X-ENDLIST") {
          hasEndList = true;
          continue;
        }
        if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
          declaredPlaylistType = valueAfterColon(line).toUpperCase();
        }
      }
      const playlistType = variants.length ? "master" : "media";
      const streamType = playlistType === "master" ? null : hasEndList || declaredPlaylistType === "VOD" ? "vod" : "live";
      const methods = [...encryptionMethods];
      return {
        status: "ready",
        error: null,
        playlistType,
        streamType,
        variants,
        audioTracks,
        subtitles,
        duration: playlistType === "media" ? round(duration, 3) : null,
        targetDuration: playlistType === "media" ? targetDuration : null,
        segmentCount: playlistType === "media" ? segmentCount : null,
        encryptionMethods: methods,
        drm: methods.some(isDrmLikeMethod) ? "suspected" : "none"
      };
    } catch (error) {
      return {
        ...unsupported("manifest_parse_failed"),
        status: "failed",
        error: error?.message || "Could not parse HLS manifest."
      };
    }
  }
  function normalizeVariant(attributes, uri, manifestUrl) {
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
      subtitlesGroup: optionalText(attributes.SUBTITLES)
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
      audioTracks: [],
      subtitles: [],
      duration: null,
      targetDuration: null,
      segmentCount: null,
      encryptionMethods: [],
      drm: "none"
    };
  }
  function isDrmLikeMethod(method) {
    return method.startsWith("SAMPLE-AES");
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
    VIDEO_OBSERVE: "video.observe",
    VIDEO_RESTORE_STATE: "video.restore_state",
    VIDEO_USER_ACTION: "video.user_action",
    VIDEO_AUTO_ACTION: "video.auto_action"
  });
  var C = CAPABILITIES;
  var T = CAPABILITY_TRIGGERS;
  var MODE_RANK = Object.freeze({
    [PROTECTION_MODES.SAFE]: 0,
    [PROTECTION_MODES.ASSIST]: 1,
    [PROTECTION_MODES.AUTO]: 2
  });
  var CAPABILITY_CATALOG = Object.freeze({
    [C.CORE_MESSAGING]: capability(C.CORE_MESSAGING, "safe", T.CORE, {
      availableWhenDisabled: true
    }),
    [C.CORE_MAINTENANCE]: capability(C.CORE_MAINTENANCE, "safe", T.CORE, {
      availableWhenDisabled: true
    }),
    [C.NAVIGATION_GUARD]: capability(C.NAVIGATION_GUARD, "safe", T.AUTOMATIC),
    [C.NAVIGATION_REVERSE_POPUNDER]: capability(
      C.NAVIGATION_REVERSE_POPUNDER,
      "safe",
      T.AUTOMATIC
    ),
    [C.NAVIGATION_INTENT]: capability(C.NAVIGATION_INTENT, "safe", T.PASSIVE),
    [C.NAVIGATION_FEEDBACK]: capability(C.NAVIGATION_FEEDBACK, "safe", T.USER),
    [C.DOM_STATIC_RULES]: capability(C.DOM_STATIC_RULES, "safe", T.AUTOMATIC),
    [C.DOM_OBSERVE]: capability(C.DOM_OBSERVE, "assist", T.PASSIVE),
    [C.DOM_SUGGEST]: capability(C.DOM_SUGGEST, "assist", T.SUGGESTION),
    [C.DOM_AUTO_HIDE]: capability(C.DOM_AUTO_HIDE, "auto", T.AUTOMATIC),
    [C.DOM_MANUAL_PICKER]: capability(C.DOM_MANUAL_PICKER, "safe", T.USER),
    [C.LEARNING_SEED]: capability(C.LEARNING_SEED, "safe", T.STORAGE),
    [C.LEARNING_FEEDBACK]: capability(C.LEARNING_FEEDBACK, "safe", T.USER),
    [C.LEARNING_APPLY]: capability(C.LEARNING_APPLY, "auto", T.AUTOMATIC),
    [C.TELEMETRY_QUEUE]: capability(C.TELEMETRY_QUEUE, "safe", T.STORAGE),
    [C.MEDIA_OBSERVE]: capability(C.MEDIA_OBSERVE, "assist", T.PASSIVE),
    [C.MEDIA_CATALOG]: capability(C.MEDIA_CATALOG, "assist", T.PASSIVE),
    [C.VIDEO_OBSERVE]: capability(C.VIDEO_OBSERVE, "assist", T.PASSIVE),
    [C.VIDEO_RESTORE_STATE]: capability(C.VIDEO_RESTORE_STATE, "safe", T.CORE, {
      availableWhenDisabled: true
    }),
    [C.VIDEO_USER_ACTION]: capability(C.VIDEO_USER_ACTION, "assist", T.USER),
    [C.VIDEO_AUTO_ACTION]: capability(C.VIDEO_AUTO_ACTION, "auto", T.AUTOMATIC)
  });
  var FEATURE_CATALOG = Object.freeze([
    feature("background.message-router", "background", C.CORE_MESSAGING, [
      C.CORE_MAINTENANCE,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE,
      C.MEDIA_CATALOG
    ]),
    feature("background.media-catalog", "background", C.MEDIA_CATALOG),
    feature("background.navigation-guard", "background", C.NAVIGATION_GUARD, [
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("background.telemetry-flush", "background", C.TELEMETRY_QUEUE),
    feature("background.memory-cleanup", "background", C.CORE_MAINTENANCE),
    feature("background.pattern-seed", "background", C.LEARNING_SEED),
    feature(
      "background.training-store-migration",
      "background",
      C.CORE_MAINTENANCE
    ),
    feature("background.settings-package-seed", "background", C.CORE_MAINTENANCE),
    feature("content.media-observer", "content", C.MEDIA_OBSERVE, [
      C.MEDIA_CATALOG
    ]),
    feature("content.youtube-cleaner", "content", C.DOM_STATIC_RULES),
    feature("content.navigation-intent", "content", C.NAVIGATION_INTENT),
    feature("content.navigation-toast", "content", C.NAVIGATION_FEEDBACK),
    feature("content.dom-static-blocker", "content", C.DOM_STATIC_RULES, [
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("content.dom-candidate-collector", "content", C.DOM_OBSERVE, [
      C.DOM_SUGGEST,
      C.DOM_AUTO_HIDE,
      C.LEARNING_FEEDBACK
    ]),
    feature("content.dom-learned-blocker", "content", C.LEARNING_APPLY, [
      C.DOM_AUTO_HIDE
    ]),
    feature("media-frame.observer", "media-frame", C.MEDIA_OBSERVE, [
      C.MEDIA_CATALOG
    ]),
    feature("video.surgeon", "video", C.VIDEO_OBSERVE, [
      C.VIDEO_RESTORE_STATE,
      C.VIDEO_USER_ACTION,
      C.VIDEO_AUTO_ACTION
    ]),
    feature("picker.controller", "picker", C.DOM_MANUAL_PICKER, [
      C.LEARNING_FEEDBACK
    ]),
    feature("main-world.network-capture", "main-world", C.MEDIA_OBSERVE),
    feature("main-world.timer-control", "main-world", C.VIDEO_AUTO_ACTION)
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
  function capability(id, minMode, trigger, { availableWhenDisabled = false, browserPermissions = [] } = {}) {
    return Object.freeze({
      id,
      minMode,
      trigger,
      availableWhenDisabled,
      browserPermissions: Object.freeze([...browserPermissions])
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

  // src/main-world/network-capture.js
  function installNetworkCapture(policy) {
    const originalFetch = window.fetch;
    const probeGate = createMediaProbeGate();
    const inspect = (manifestUrl, body, candidate) => {
      const probe = inspectManifest(manifestUrl, body, candidate);
      if (probe) probeGate.remember(manifestUrl, probe.status);
      return probe;
    };
    const stopFetchCapture = installFetchCapture(policy, inspect);
    const stopXhrCapture = installXhrCapture(policy, inspect);
    const stopFallbackProbe = installFallbackProbe({
      policy,
      originalFetch,
      probeGate,
      inspect
    });
    return () => {
      stopFetchCapture();
      stopXhrCapture();
      stopFallbackProbe();
      probeGate.clear();
    };
  }
  function installFetchCapture(policy, inspect) {
    const originalFetch = window.fetch;
    const fetchWrapper = async function(...args) {
      const url = requestUrl(args[0]);
      const response = await originalFetch.apply(this, args);
      if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return response;
      const finalUrl = response.url || url;
      const mimeType = response.headers.get("content-type");
      const candidate = reportMediaSource(finalUrl, mimeType);
      if (isManifestLike(finalUrl) || candidate?.kind === MEDIA_KINDS.HLS) {
        response.clone().text().then((body) => inspect(finalUrl, body, candidate)).catch(() => {
        });
      }
      return response;
    };
    window.fetch = fetchWrapper;
    return () => {
      if (window.fetch === fetchWrapper) window.fetch = originalFetch;
    };
  }
  function installXhrCapture(policy, inspect) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const openWrapper = function(method, url, ...rest) {
      this.__adsfriendly_url = requestUrl(url);
      return originalOpen.call(this, method, url, ...rest);
    };
    const sendWrapper = function(...args) {
      this.addEventListener("load", () => {
        if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
        const url = this.responseURL || this.__adsfriendly_url || "";
        const candidate = reportMediaSource(
          url,
          this.getResponseHeader("content-type")
        );
        if (!isManifestLike(url) && candidate?.kind !== MEDIA_KINDS.HLS) return;
        try {
          if (typeof this.responseText === "string")
            inspect(url, this.responseText, candidate);
        } catch {
        }
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
  function installFallbackProbe({ policy, originalFetch, probeGate, inspect }) {
    let stopped = false;
    const onProbeRequest = (messageEvent) => {
      if (stopped || messageEvent.source !== window || messageEvent.data?.source !== "adsfriendly-content" || messageEvent.data?.type !== "PROBE_HLS_MANIFEST" || !policy.can(CAPABILITIES.MEDIA_OBSERVE))
        return;
      const manifestUrl = probeGate.claim(messageEvent.data.manifestUrl);
      if (!manifestUrl) return;
      const candidate = createMediaCandidateFromSource({
        pageUrl: location.href,
        sourceUrl: manifestUrl,
        mimeType: "application/vnd.apple.mpegurl",
        title: document.title || null,
        detectedBy: MEDIA_DETECTION_SOURCES.NETWORK
      });
      originalFetch.call(window, manifestUrl, {
        credentials: "same-origin",
        cache: "default"
      }).then((response) => {
        if (!response.ok)
          throw new Error(`manifest_http_${response.status || "error"}`);
        return response.text();
      }).then((body) => inspect(manifestUrl, body, candidate)).catch((error) => {
        if (probeGate.state(manifestUrl) !== "pending") return;
        probeGate.remember(manifestUrl, "failed");
        reportProbeFailure(manifestUrl, candidate, probeErrorCode(error));
      });
    };
    window.addEventListener("message", onProbeRequest);
    return () => {
      stopped = true;
      window.removeEventListener("message", onProbeRequest);
    };
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
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate)
    });
    return candidate;
  }
  function inspectManifest(manifestUrl, body, candidate) {
    analyzeManifest(manifestUrl, body);
    let hlsCandidate = candidate;
    if (hlsCandidate?.kind !== MEDIA_KINDS.HLS && typeof body === "string" && body.replace(/^\uFEFF/, "").trimStart().startsWith("#EXTM3U")) {
      hlsCandidate = reportMediaSource(
        manifestUrl,
        "application/vnd.apple.mpegurl"
      );
    }
    if (hlsCandidate?.kind !== MEDIA_KINDS.HLS) return null;
    const probe = parseHlsManifest(manifestUrl, body);
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_PROBED, {
        mediaId: hlsCandidate.id,
        pageUrl: location.href,
        manifestUrl: hlsCandidate.manifestUrl,
        kind: MEDIA_KINDS.HLS,
        ...probe
      })
    });
    return probe;
  }
  function reportProbeFailure(manifestUrl, candidate, error) {
    if (candidate?.kind !== MEDIA_KINDS.HLS) return;
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_PROBED, {
        mediaId: candidate.id,
        pageUrl: location.href,
        manifestUrl,
        kind: MEDIA_KINDS.HLS,
        status: "failed",
        error
      })
    });
  }
  function probeErrorCode(error) {
    const message = error?.message || "";
    const httpMatch = /manifest_http_\d+/.exec(message);
    return httpMatch?.[0] || "fallback_fetch_blocked";
  }
  function requestUrl(input) {
    if (!input) return "";
    if (typeof input === "string") return input;
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.href;
    return input.toString();
  }
  function isManifestLike(url = "") {
    const normalized = url.toLowerCase();
    return normalized.includes(".m3u8") || normalized.includes(".mpd") || normalized.includes("player/v1/player");
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
