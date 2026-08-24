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
      ["master", "media"],
      "playlistType",
    ),
    streamType: optionalEnumValue(
      value.streamType,
      ["vod", "live"],
      "streamType",
    ),
    duration: optionalFiniteNumber(value.duration),
    targetDuration: optionalFiniteNumber(value.targetDuration),
    segmentCount: optionalNonNegativeInteger(value.segmentCount),
    encryptionMethods: normalizeStrings(value.encryptionMethods),
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
      ["master", "media"],
      "playlistType",
    ),
    streamType: optionalEnumValue(
      value.streamType,
      ["vod", "live"],
      "streamType",
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
      "drm",
    ),
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
