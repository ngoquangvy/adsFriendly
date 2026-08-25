export const DOWNLOAD_JOB_PREFIX = "adsfriendly.mediaDownloadJob.";
export const DOWNLOAD_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function normalizeMediaDownloadJob(value = {}) {
  const candidate = value.candidate;
  if (!candidate || !["direct", "hls", "dash"].includes(candidate.kind)) {
    throw new Error("[MediaDownload] Direct, HLS, or DASH candidate required.");
  }
  const shared = {
    id: requiredString(candidate.id, "candidate.id"),
    pageUrl: requiredHttpUrl(candidate.pageUrl, "candidate.pageUrl"),
    kind: candidate.kind,
    title: optionalString(candidate.title),
    mimeType: optionalString(candidate.mimeType),
    drm: candidate.drm || "none",
  };
  return {
    id: requiredString(value.id, "id"),
    createdAt: finiteNumber(value.createdAt, "createdAt"),
    sourceTabId: nonNegativeInteger(value.sourceTabId, "sourceTabId"),
    candidate:
      candidate.kind === "direct"
        ? {
            ...shared,
            sourceUrl: requiredHttpUrl(
              candidate.sourceUrl,
              "candidate.sourceUrl",
            ),
          }
        : {
            ...shared,
            manifestUrl: requiredHttpUrl(
              candidate.manifestUrl,
              "candidate.manifestUrl",
            ),
            probeStatus: candidate.probeStatus,
            playlistType: candidate.playlistType,
            streamType: candidate.streamType,
            drm: candidate.drm || "none",
            encryptionMethods: stringArray(candidate.encryptionMethods),
            variants: objectArray(candidate.variants),
            iframeVariants: objectArray(candidate.iframeVariants),
            audioTracks: objectArray(candidate.audioTracks),
            subtitles: objectArray(candidate.subtitles),
            duration: optionalFiniteNumber(candidate.duration),
            segmentCount: optionalNonNegativeInteger(candidate.segmentCount),
            partialSegmentCount: optionalNonNegativeInteger(
              candidate.partialSegmentCount,
            ),
            skippedSegmentCount: optionalNonNegativeInteger(
              candidate.skippedSegmentCount,
            ),
            lowLatency: candidate.lowLatency === true,
            requestContext: normalizeDownloadRequestContext(
              candidate.resolvedRequestContext || candidate.requestContext,
            ),
          },
  };
}

export function downloadJobKey(jobId) {
  return `${DOWNLOAD_JOB_PREFIX}${requiredString(jobId, "jobId")}`;
}

export function getMediaDownloadAvailability(candidate = {}) {
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
      reason: "This media type is not supported yet.",
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
      reason: "HLS endpoint has not exposed a media playlist yet.",
    };
  if (candidate.playlistType === "media" && candidate.streamType === "unknown")
    return {
      supported: false,
      reason: "HLS media playlist is waiting for segments.",
    };
  if (candidate.playlistType === "media" && candidate.streamType === "live")
    return { supported: false, reason: "Live HLS is not supported yet." };
  if (
    candidate.playlistType === "media" &&
    candidate.streamType === "vod" &&
    !candidate.segmentCount
  )
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
  if (value === null || value === undefined) return null;
  return finiteNumber(value, "optional number");
}

function optionalNonNegativeInteger(value) {
  if (value === null || value === undefined) return null;
  return nonNegativeInteger(value, "optional integer");
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").slice(0, 20)
    : [];
}

function objectArray(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => item && typeof item === "object")
        .slice(0, 100)
        .map((item) => ({ ...item }))
    : [];
}

function normalizeDownloadRequestContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    requestUrl: optionalString(value.requestUrl),
    finalUrl: optionalString(value.finalUrl),
    documentUrl: optionalString(value.documentUrl),
    referrer: optionalString(value.referrer),
    method: typeof value.method === "string" ? value.method : "GET",
    credentials: ["omit", "same-origin", "include", "unknown"].includes(
      value.credentials,
    )
      ? value.credentials
      : "unknown",
    requiresBrowserSession: value.requiresBrowserSession === true,
  };
}
