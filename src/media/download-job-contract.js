import { normalizeMediaDownloadOutput } from "./download-options.js";
import {
  hasStrongDrmEvidence,
  hasUnsupportedHlsKeyFormat,
  isFfmpegCompatibleSampleAes,
  isWeakSampleAesSignal,
} from "./protection-policy.js";
import { normalizeAesKeyHandoffDiagnostic } from "./key-handoff-diagnostics.js";

export const DOWNLOAD_JOB_PREFIX = "adsfriendly.mediaDownloadJob.";
export const DOWNLOAD_HISTORY_KEY = "mediaDownloadHistory";
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
    drmSystem: candidate.drmSystem || null,
    drmEvidence: stringArray(candidate.drmEvidence),
    encryptionScheme: candidate.encryptionScheme || "none",
  };
  return {
    id: requiredString(value.id, "id"),
    createdAt: finiteNumber(value.createdAt, "createdAt"),
    sourceTabId: nonNegativeInteger(value.sourceTabId, "sourceTabId"),
    output: normalizeMediaDownloadOutput(value.output, candidate),
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
            encryptionKeyFormats: stringArray(candidate.encryptionKeyFormats),
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
            probeSource:
              candidate.probeSource === "decrypted_blob"
                ? "decrypted_blob"
                : candidate.probeSource || null,
            manifestHandoff: normalizeDownloadManifestHandoff(
              candidate.manifestHandoff,
              candidate,
            ),
            keyHandoff: normalizeAesKeyHandoff(candidate.keyHandoff, candidate),
            keyHandoffDiagnostic: normalizeAesKeyHandoffDiagnostic(
              candidate.keyHandoffDiagnostic,
            ),
            requestContext: normalizeDownloadRequestContext(
              candidate.resolvedRequestContext || candidate.requestContext,
            ),
          },
  };
}

function normalizeAesKeyHandoff(value, candidate) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.manifestUrl !== candidate.manifestUrl) {
    throw new Error("[MediaDownload] AES key handoff does not match manifest.");
  }
  const keys = Array.isArray(value.keys)
    ? value.keys
        .slice(0, 16)
        .map((item) => normalizeAesKeyEntry(item))
        .filter(Boolean)
    : [];
  return keys.length
    ? { kind: "hls_aes_keys", manifestUrl: candidate.manifestUrl, keys }
    : null;
}

function normalizeAesKeyEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const url = requiredHttpUrl(value.url, "candidate.keyHandoff.keys.url");
  const data = optionalString(value.data);
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  let bytes = null;
  try {
    bytes = atob(data).length;
  } catch {
    return null;
  }
  if (!bytes || bytes > 64 * 1024) return null;
  return { url, data, bytes };
}

function normalizeDownloadManifestHandoff(value, candidate) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = typeof value.body === "string" ? value.body : "";
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  if (!body || bodyBytes > 512 * 1024)
    throw new Error("[MediaDownload] Invalid decrypted manifest handoff.");
  const manifestUrl = requiredHttpUrl(
    value.manifestUrl,
    "candidate.manifestHandoff.manifestUrl",
  );
  if (
    manifestUrl !== candidate.manifestUrl ||
    value.kind !== candidate.kind ||
    Number(value.expiresAt) <= Date.now()
  ) {
    throw new Error("[MediaDownload] Decrypted manifest handoff expired.");
  }
  return {
    kind: value.kind,
    manifestUrl,
    body,
    bodyBytes,
    revisionId: optionalString(value.revisionId),
    expiresAt: Number(value.expiresAt),
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
  if (candidate.kind !== "hls")
    return {
      supported: false,
      reason: "This media type is not supported yet.",
    };
  if (candidate.probeStatus !== "ready")
    return { supported: false, reason: "Manifest is not ready." };
  if (
    candidate.probeSource === "decrypted_blob" &&
    !hasCurrentManifestHandoff(candidate)
  )
    return {
      supported: false,
      reason:
        "Player-decrypted manifest found; secure download handoff is not ready yet.",
    };
  if (hasStrongDrmEvidence(candidate))
    return { supported: false, reason: drmPlaybackOnlyReason(candidate) };
  if (hasUnsupportedHlsKeyFormat(candidate))
    return {
      supported: false,
      reason: customHlsPlaybackOnlyReason(candidate),
    };
  if (
    isWeakSampleAesSignal(candidate) &&
    !isFfmpegCompatibleSampleAes(candidate)
  )
    return {
      supported: false,
      reason:
        "SAMPLE-AES signal needs player-resolved segments before download.",
    };
  if (
    candidate.encryptionMethods?.length &&
    !isDownloadableHlsEncryption(candidate)
  )
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

function hasCurrentManifestHandoff(candidate) {
  return (
    candidate.manifestHandoff?.mediaId === candidate.id &&
    candidate.manifestHandoff?.manifestUrl === candidate.manifestUrl &&
    Number(candidate.manifestHandoff?.expiresAt) > Date.now()
  );
}

function isDownloadableHlsEncryption(candidate) {
  if (isFfmpegCompatibleSampleAes(candidate)) return true;
  const methods = candidate.encryptionMethods || [];
  const formats = candidate.encryptionKeyFormats || [];
  return (
    methods.length > 0 &&
    methods.every((method) => String(method).toUpperCase() === "AES-128") &&
    formats.every((format) => String(format).toLowerCase() === "identity")
  );
}

function drmPlaybackOnlyReason(candidate) {
  const state = candidate.drm === "confirmed" ? "confirmed" : "suspected";
  const system = candidate.drmSystem
    ? ` · ${formatDrmSystem(candidate.drmSystem)}`
    : "";
  return `DRM ${state}${system} · Playback only.`;
}

function customHlsPlaybackOnlyReason(candidate) {
  const format = (candidate.encryptionKeyFormats || [])
    .map((value) => String(value || "").trim())
    .find((value) => value && value.toLowerCase() !== "identity");
  return `Custom protected HLS${format ? ` · ${format}` : ""} · Playback only.`;
}

function formatDrmSystem(value) {
  return value === "widevine"
    ? "Widevine"
    : value === "playready"
      ? "PlayReady"
      : value === "fairplay"
        ? "FairPlay"
        : value === "clearkey"
          ? "Clear Key"
          : "Unknown system";
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
    parentDocumentUrl: optionalString(value.parentDocumentUrl),
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
