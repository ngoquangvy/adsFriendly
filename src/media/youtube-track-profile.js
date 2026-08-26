import {
  MEDIA_DETECTION_SOURCES,
  MEDIA_KINDS,
  MEDIA_PROBE_STATES,
  normalizeMediaCandidate,
} from "./contracts.js";
import { stableMediaId } from "./detection.js";

const YOUTUBE_PAGE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

export function parseYouTubePlaybackTrack(
  sourceUrl,
  { mimeType = null, responseHeaders = [] } = {},
) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !isGoogleVideoHost(url.hostname) ||
    url.pathname !== "/videoplayback"
  ) {
    return null;
  }

  const declaredMime = cleanMimeType(url.searchParams.get("mime") || mimeType);
  const responseMime = cleanMimeType(mimeType);
  const effectiveMime = declaredMime || responseMime;
  const type = effectiveMime?.startsWith("video/")
    ? "video"
    : effectiveMime?.startsWith("audio/")
      ? "audio"
      : null;
  const itag = safeToken(url.searchParams.get("itag"), 24);
  if (!type || !itag) return null;

  const normalizedUrl = new URL(url);
  // YouTube issues byte-window requests during playback. The signature-bearing
  // URL is already resolved by the browser; only remove the observed window so
  // the Helper can make its own bounded Range requests.
  normalizedUrl.searchParams.delete("range");

  const size = parseSize(url.searchParams.get("size"));
  const duration = positiveNumber(url.searchParams.get("dur"));
  const contentLength =
    positiveInteger(url.searchParams.get("clen")) ||
    contentRangeTotal(responseHeaders) ||
    positiveInteger(headerValue(responseHeaders, "content-length"));
  const bitrate = positiveInteger(url.searchParams.get("bitrate"));
  const codecs = parseCodecs(url.searchParams.get("mime"));
  const assetToken =
    safeToken(url.searchParams.get("id"), 180) ||
    safeToken(url.searchParams.get("docid"), 64) ||
    null;

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
    qualityLabel:
      safeToken(url.searchParams.get("quality_label"), 40) ||
      safeToken(url.searchParams.get("quality"), 40),
    observedAt: Date.now(),
  });
}

export function createYouTubeAdaptiveCandidate({
  pageUrl,
  title = null,
  track,
  playerUrl = null,
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
    acquisitionProfile:
      track.urlResolution === "n_transform_pending"
        ? "youtube_player_js_challenge"
        : "youtube_resolved_tracks",
    playerUrl,
  });
}

export function createYouTubeCandidateFromObservedSource({
  pageUrl,
  sourceUrl,
  title = null,
  mimeType = null,
  responseHeaders = [],
}) {
  const track = parseYouTubePlaybackTrack(sourceUrl, {
    mimeType,
    responseHeaders,
  });
  if (!track) return null;
  return createYouTubeAdaptiveCandidate({ pageUrl, title, track });
}

export function isYouTubePage(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      YOUTUBE_PAGE_HOSTS.has(hostname) || hostname.endsWith(".youtube.com")
    );
  } catch {
    return false;
  }
}

export function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    if (!isYouTubePage(url.href)) return null;
    if (url.pathname === "/watch")
      return safeToken(url.searchParams.get("v"), 64);
    const shortMatch = url.pathname.match(
      /^\/(?:shorts|embed|live)\/([^/?#]+)/i,
    );
    return shortMatch ? safeToken(shortMatch[1], 64) : null;
  } catch {
    return null;
  }
}

function isGoogleVideoHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "googlevideo.com" || normalized.endsWith(".googlevideo.com")
  );
}

function cleanMimeType(value) {
  const normalized = String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
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
    (item) => String(item?.name || "").toLowerCase() === name,
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
