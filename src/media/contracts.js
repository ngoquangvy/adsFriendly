export const MEDIA_KINDS = Object.freeze({
  DIRECT: "direct",
  HLS: "hls",
  DASH: "dash",
  BLOB: "blob",
});

export const MEDIA_DETECTION_SOURCES = Object.freeze({
  DOM: "dom",
  NETWORK: "network",
  PLAYER: "player",
});

export const DRM_STATES = Object.freeze({
  NONE: "none",
  SUSPECTED: "suspected",
  CONFIRMED: "confirmed",
});

export const ENCRYPTION_SCHEMES = Object.freeze({
  NONE: "none",
  AES_128: "aes-128",
  SAMPLE_AES: "sample-aes",
  CENC: "cenc",
  CBCS: "cbcs",
  UNKNOWN: "unknown",
});

export const DRM_SYSTEMS = Object.freeze({
  WIDEVINE: "widevine",
  PLAYREADY: "playready",
  FAIRPLAY: "fairplay",
  CLEARKEY: "clearkey",
  UNKNOWN: "unknown",
});

export const MEDIA_PROBE_STATES = Object.freeze({
  DISCOVERED: "discovered",
  READY: "ready",
  UNSUPPORTED: "unsupported",
  FAILED: "failed",
});

export function normalizeMediaCandidate(value = {}) {
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
      "detectedBy",
    ),
    drm: enumValue(
      value.drm || DRM_STATES.NONE,
      Object.values(DRM_STATES),
      "drm",
    ),
    probeStatus: enumValue(
      value.probeStatus || MEDIA_PROBE_STATES.DISCOVERED,
      Object.values(MEDIA_PROBE_STATES),
      "probeStatus",
    ),
    probeError: optionalString(value.probeError),
    playlistType: optionalEnumValue(
      value.playlistType,
      ["master", "media", "unknown"],
      "playlistType",
    ),
    streamType: optionalEnumValue(
      value.streamType,
      ["vod", "live", "unknown"],
      "streamType",
    ),
    duration: optionalFiniteNumber(value.duration),
    targetDuration: optionalFiniteNumber(value.targetDuration),
    segmentCount: optionalNonNegativeInteger(value.segmentCount),
    partialSegmentCount: optionalNonNegativeInteger(value.partialSegmentCount),
    skippedSegmentCount: optionalNonNegativeInteger(value.skippedSegmentCount),
    lowLatency: value.lowLatency === true,
    mediaSequence: optionalNonNegativeInteger(value.mediaSequence),
    discontinuitySequence: optionalNonNegativeInteger(
      value.discontinuitySequence,
    ),
    revisionId: optionalString(value.revisionId),
    requestContexts: normalizeRequestContexts(value.requestContexts),
    resolutionAttempt: normalizeMediaResolutionAttempt(value.resolutionAttempt),
    encryptionMethods: normalizeStrings(value.encryptionMethods),
    encryptionScheme: normalizeEncryptionScheme(value.encryptionScheme),
    encryptionKeyFormats: normalizeStrings(value.encryptionKeyFormats).slice(
      0,
      20,
    ),
    drmSystem: normalizeDrmSystem(value.drmSystem),
    drmEvidence: normalizeStrings(value.drmEvidence).slice(0, 20),
    eme: normalizeEmeMetadata(value.eme),
  };
  if (!candidate.sourceUrl && !candidate.manifestUrl) {
    throw new Error(
      "[MediaContract] A media candidate needs sourceUrl or manifestUrl.",
    );
  }
  return candidate;
}

export function normalizeMediaProbe(value = {}) {
  const kind = enumValue(
    value.kind,
    [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH],
    "kind",
  );
  const probeStatus = enumValue(
    value.status,
    [
      MEDIA_PROBE_STATES.READY,
      MEDIA_PROBE_STATES.UNSUPPORTED,
      MEDIA_PROBE_STATES.FAILED,
    ],
    "status",
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
      "playlistType",
    ),
    streamType: optionalEnumValue(
      value.streamType,
      ["vod", "live", "unknown"],
      "streamType",
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
      value.discontinuitySequence,
    ),
    revisionId: optionalString(value.revisionId),
    requestContext: normalizeMediaRequestContext(value.requestContext),
    resolutionAttempt: normalizeMediaResolutionAttempt(value.resolutionAttempt),
    encryptionMethods: normalizeStrings(value.encryptionMethods),
    encryptionScheme: normalizeEncryptionScheme(value.encryptionScheme),
    encryptionKeyFormats: normalizeStrings(value.encryptionKeyFormats).slice(
      0,
      20,
    ),
    drmSystem: normalizeDrmSystem(value.drmSystem),
    drmEvidence: normalizeStrings(value.drmEvidence).slice(0, 20),
    eme: normalizeEmeMetadata(value.eme),
    drm: enumValue(
      value.drm || DRM_STATES.NONE,
      Object.values(DRM_STATES),
      "drm",
    ),
  };
}

export function normalizeEmeObservation(value = {}) {
  return {
    pageUrl: requiredString(value.pageUrl, "pageUrl"),
    keySystem: normalizeKeySystem(value.keySystem),
    initDataType: safeMetadataString(value.initDataType),
    encryptionSchemes: normalizeStrings(value.encryptionSchemes)
      .map(normalizeObservedEncryptionScheme)
      .filter(Boolean)
      .slice(0, 8),
    keyStatuses: normalizeStrings(value.keyStatuses)
      .map((status) => status.toLowerCase())
      .filter((status) =>
        [
          "usable",
          "expired",
          "released",
          "output-restricted",
          "output-downscaled",
          "status-pending",
          "internal-error",
        ].includes(status),
      )
      .slice(0, 8),
    licenseStatus: optionalEnumValue(
      value.licenseStatus,
      ["requested", "updated", "usable", "restricted", "expired", "error"],
      "licenseStatus",
    ),
    observedAt: optionalFiniteNumber(value.observedAt) || Date.now(),
  };
}

export function normalizeEmeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    keySystems: normalizeStrings(value.keySystems)
      .map(normalizeKeySystem)
      .filter(Boolean)
      .slice(0, 8),
    initDataTypes: normalizeStrings(value.initDataTypes)
      .map(safeMetadataString)
      .filter(Boolean)
      .slice(0, 8),
    encryptionSchemes: normalizeStrings(value.encryptionSchemes)
      .map(normalizeObservedEncryptionScheme)
      .filter(Boolean)
      .slice(0, 8),
    keyStatuses: normalizeStrings(value.keyStatuses)
      .map((status) => status.toLowerCase())
      .filter(Boolean)
      .slice(0, 8),
    licenseStatus: optionalString(value.licenseStatus),
    observedAt: optionalFiniteNumber(value.observedAt) || null,
  };
}

export function normalizeBlobSourceTrace(value = {}) {
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
    totalAppendedBytes:
      optionalNonNegativeInteger(value.totalAppendedBytes) || 0,
    observedAt: optionalFiniteNumber(value.observedAt) || Date.now(),
  };
}

export function normalizeMediaResolutionAttempt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const strategy = optionalEnumValue(
    value.strategy,
    ["remove_query_parameter"],
    "resolutionAttempt.strategy",
  );
  if (!strategy) return null;
  return {
    adapterId: optionalString(value.adapterId)?.slice(0, 100) || null,
    strategy,
    removedQueryKey:
      optionalString(value.removedQueryKey)?.slice(0, 100) || null,
    evidence: normalizeStrings(value.evidence).slice(0, 20),
  };
}

export function normalizeMediaRequestContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const credentials = optionalEnumValue(
    value.credentials,
    ["omit", "same-origin", "include", "unknown"],
    "requestContext.credentials",
  );
  const transport = optionalEnumValue(
    value.transport,
    ["fetch", "xhr", "fallback"],
    "requestContext.transport",
  );
  return {
    requestUrl: optionalString(value.requestUrl),
    finalUrl: optionalString(value.finalUrl),
    documentUrl: optionalString(value.documentUrl),
    referrer: optionalString(value.referrer),
    method:
      typeof value.method === "string" && value.method
        ? value.method.toUpperCase().slice(0, 12)
        : "GET",
    credentials: credentials || "unknown",
    transport,
    requiresBrowserSession: value.requiresBrowserSession === true,
    observedAt: optionalFiniteNumber(value.observedAt),
  };
}

export function normalizeVideoAdEvidence(value = {}) {
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("[MediaContract] confidence must be between 0 and 1.");
  }
  return {
    mediaId: requiredString(value.mediaId, "mediaId"),
    startTime: optionalFiniteNumber(value.startTime),
    endTime: optionalFiniteNumber(value.endTime),
    signals: Array.isArray(value.signals)
      ? value.signals.filter((signal) => typeof signal === "string")
      : [],
    confidence,
    label: enumValue(
      value.label || "unknown",
      ["ad", "content", "unknown"],
      "label",
    ),
    labelSource: enumValue(
      value.labelSource,
      ["user", "manifest", "heuristic", "model"],
      "labelSource",
    ),
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
      `[MediaContract] ${field} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value;
}

function optionalEnumValue(value, allowed, field) {
  if (value === null || value === undefined || value === "") return null;
  return enumValue(value, allowed, field);
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value.slice(0, 100).map((item) => ({ ...item }))
    : [];
}

function normalizeStrings(value) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .slice(0, 100)
            .filter((item) => typeof item === "string" && item)
            .map((item) => item.slice(0, 100)),
        ),
      ]
    : [];
}

function normalizeEncryptionScheme(value) {
  return enumValue(
    value || ENCRYPTION_SCHEMES.NONE,
    Object.values(ENCRYPTION_SCHEMES),
    "encryptionScheme",
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
  if (value === null || value === undefined || value === "") return null;
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
    } catch {}
  }
  return [...new Set(urls)];
}

function normalizeRequestContexts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map(normalizeMediaRequestContext).filter(Boolean);
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error("[MediaContract] Timeline values must be finite numbers.");
  }
  return number;
}

function optionalNonNegativeInteger(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error("[MediaContract] Expected a non-negative integer.");
  }
  return number;
}
