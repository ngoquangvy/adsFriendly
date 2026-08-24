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
  };
  if (!candidate.sourceUrl && !candidate.manifestUrl) {
    throw new Error(
      "[MediaContract] A media candidate needs sourceUrl or manifestUrl.",
    );
  }
  return candidate;
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

function normalizeArray(value) {
  return Array.isArray(value) ? value.map((item) => ({ ...item })) : [];
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error("[MediaContract] Timeline values must be finite numbers.");
  }
  return number;
}
