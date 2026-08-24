import {
  MEDIA_DETECTION_SOURCES,
  MEDIA_KINDS,
  normalizeMediaCandidate,
} from "./contracts.js";

const HLS_MIME_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);
const DASH_MIME_TYPES = new Set(["application/dash+xml"]);

export function classifyMediaSource(sourceUrl = "", mimeType = "") {
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

export function createMediaCandidateFromSource({
  pageUrl,
  sourceUrl,
  mimeType = null,
  title = null,
  detectedBy = MEDIA_DETECTION_SOURCES.DOM,
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
    drm: "none",
  });
}

export function stableMediaId(kind, sourceUrl) {
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
