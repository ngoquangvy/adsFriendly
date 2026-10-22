import {
  MEDIA_DETECTION_SOURCES,
  MEDIA_KINDS,
  normalizeMediaCandidate,
} from "./contracts.js";
import {
  AUDIO_EXTENSIONS,
  audioContainer,
  sourceExtension,
  sourceMime,
  identifyMediaType,
} from "./content-type.js";

const HLS_MIME_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);
const DASH_MIME_TYPES = new Set(["application/dash+xml"]);
const SEGMENT_MIME_TYPES = new Set([
  "video/mp2t",
  "video/iso.segment",
  "audio/aac",
  "audio/aacp",
]);
const SEGMENT_PATH_PATTERN = /\.(?:ts|m2ts|m4s|cmfv|cmfa|aac)$/i;

export function classifyMediaSource(
  sourceUrl = "",
  mimeType = "",
  elementType = null,
) {
  const normalizedUrl = String(sourceUrl).trim().toLowerCase();
  const normalizedMime = String(mimeType).split(";")[0].trim().toLowerCase();
  const path = normalizedUrl.split(/[?#]/)[0];

  if (normalizedUrl.startsWith("blob:")) return MEDIA_KINDS.BLOB;
  if (path.endsWith(".m3u8") || HLS_MIME_TYPES.has(normalizedMime))
    return MEDIA_KINDS.HLS;
  if (path.endsWith(".mpd") || DASH_MIME_TYPES.has(normalizedMime))
    return MEDIA_KINDS.DASH;
  if (isLikelyMediaSegment(normalizedUrl, normalizedMime)) return null;
  if (audioContainer(normalizedMime)) return MEDIA_KINDS.DIRECT;
  if (
    AUDIO_EXTENSIONS.includes(sourceExtension(sourceUrl)) ||
    elementType === "audio"
  ) {
    const mime = sourceMime(mimeType);
    if (
      !mime ||
      ["application/octet-stream", "binary/octet-stream"].includes(mime)
    )
      return /^https?:/i.test(sourceUrl) ? MEDIA_KINDS.DIRECT : null;
    return null;
  }
  if (/\.(mp4|webm|m4v|mov)$/.test(path) || normalizedMime.startsWith("video/"))
    return MEDIA_KINDS.DIRECT;
  return null;
}

export function isLikelyMediaSegment(sourceUrl = "", mimeType = "") {
  const normalizedUrl = String(sourceUrl).trim().toLowerCase();
  const normalizedMime = String(mimeType).split(";", 1)[0].trim().toLowerCase();
  const path = normalizedUrl.split(/[?#]/, 1)[0];
  return (
    SEGMENT_PATH_PATTERN.test(path) || SEGMENT_MIME_TYPES.has(normalizedMime)
  );
}

export function createMediaCandidateFromSource({
  pageUrl,
  sourceUrl,
  mimeType = null,
  title = null,
  duration = null,
  contentLength = null,
  resolution = null,
  playback = null,
  detectedBy = MEDIA_DETECTION_SOURCES.DOM,
  elementType = null,
}) {
  const absoluteSourceUrl = resolveSourceUrl(sourceUrl, pageUrl);
  const kind = classifyMediaSource(absoluteSourceUrl, mimeType, elementType);
  if (!kind) return null;
  const isManifest = [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(kind);
  return normalizeMediaCandidate({
    id: stableMediaId(kind, absoluteSourceUrl),
    pageUrl,
    sourceUrl: isManifest ? null : absoluteSourceUrl,
    manifestUrl: isManifest ? absoluteSourceUrl : null,
    kind,
    ...identifyMediaType({
      sourceUrl: absoluteSourceUrl,
      mimeType,
      elementType,
    }),
    title,
    mimeType,
    duration,
    contentLength: kind === MEDIA_KINDS.DIRECT ? contentLength : null,
    resolution,
    playback,
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
