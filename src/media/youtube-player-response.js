import {
  MEDIA_DETECTION_SOURCES,
  MEDIA_KINDS,
  MEDIA_PROBE_STATES,
  normalizeMediaCandidate,
} from "./contracts.js";
import { stableMediaId } from "./detection.js";
import {
  createYouTubeAdaptiveCandidate,
  isYouTubePage,
  parseYouTubePlaybackTrack,
  youtubeVideoId,
} from "./youtube-track-profile.js";

export const YOUTUBE_PLAYER_STAGES = Object.freeze({
  RESOLVED_TRACKS: "resolved_tracks",
  PARTIAL_RESOLVED_TRACKS: "partial_resolved_tracks",
  N_TRANSFORM_PENDING: "n_transform_pending",
  SIGNATURE_CIPHER_PENDING: "signature_cipher_pending",
  SABR_RESOLVER_PENDING: "sabr_resolver_pending",
  FORMAT_URLS_MISSING: "format_urls_missing",
  STREAMING_DATA_MISSING: "streaming_data_missing",
  PLAYABILITY_BLOCKED: "playability_blocked",
});

export function parseYouTubePlayerResponse(
  response,
  { pageUrl, title = null, input = "player_response", playerUrl = null } = {},
) {
  if (!response || typeof response !== "object" || !isYouTubePage(pageUrl))
    return null;
  const pageVideoId = youtubeVideoId(pageUrl);
  const responseVideoId = safeToken(response.videoDetails?.videoId, 64);
  if (!pageVideoId || (responseVideoId && responseVideoId !== pageVideoId))
    return null;

  const streamingData = objectValue(response.streamingData);
  const formats = [
    ...arrayValue(streamingData?.formats),
    ...arrayValue(streamingData?.adaptiveFormats),
  ].slice(0, 100);
  const descriptors = formats.map(normalizeFormatDescriptor).filter(Boolean);
  const directCandidates = [];
  const playerChallengeCandidates = [];
  let signatureCipherCount = 0;
  let nTransformCount = 0;

  for (const format of formats) {
    const signatureCipher =
      typeof format?.signatureCipher === "string"
        ? format.signatureCipher
        : typeof format?.cipher === "string"
          ? format.cipher
          : null;
    if (signatureCipher) {
      signatureCipherCount += 1;
      const cipherTrack = parseSignatureCipherTrack(signatureCipher, {
        mimeType: format.mimeType,
      });
      if (cipherTrack) {
        const track = {
          ...enrichResolvedTrack(cipherTrack.track, format),
          urlResolution: "signature_cipher_pending",
          signatureCipher: cipherTrack.signatureCipher,
        };
        const candidate = createYouTubeAdaptiveCandidate({
          pageUrl,
          title: response.videoDetails?.title || title,
          track,
          playerUrl,
        });
        if (candidate) playerChallengeCandidates.push(candidate);
      }
      continue;
    }
    if (typeof format?.url !== "string") continue;
    let sourceUrl;
    try {
      sourceUrl = new URL(format.url);
    } catch {
      continue;
    }
    if (sourceUrl.searchParams.has("n")) {
      nTransformCount += 1;
      const parsedTrack = parseYouTubePlaybackTrack(sourceUrl.href, {
        mimeType: format.mimeType,
      });
      if (parsedTrack) {
        const track = {
          ...enrichResolvedTrack(parsedTrack, format),
          urlResolution: "n_transform_pending",
        };
        const candidate = createYouTubeAdaptiveCandidate({
          pageUrl,
          title: response.videoDetails?.title || title,
          track,
          playerUrl,
        });
        if (candidate) playerChallengeCandidates.push(candidate);
      }
      continue;
    }
    const parsedTrack = parseYouTubePlaybackTrack(sourceUrl.href, {
      mimeType: format.mimeType,
    });
    if (!parsedTrack) continue;
    const track = enrichResolvedTrack(parsedTrack, format);
    const candidate = createYouTubeAdaptiveCandidate({
      pageUrl,
      title: response.videoDetails?.title || title,
      track,
      playerUrl,
    });
    if (candidate) directCandidates.push(candidate);
  }

  const playabilityStatus = safeToken(response.playabilityStatus?.status, 40);
  const serverAbrStreamingUrl = safeGoogleVideoUrl(
    streamingData?.serverAbrStreamingUrl,
  );
  const hlsManifestAvailable = isHttpUrl(streamingData?.hlsManifestUrl);
  const dashManifestAvailable = isHttpUrl(streamingData?.dashManifestUrl);
  const directVideoCount = directCandidates.filter(
    (candidate) => candidate.variants.length,
  ).length;
  const directAudioCount = directCandidates.filter(
    (candidate) => candidate.audioTracks.length,
  ).length;
  const stage = selectPlayerStage({
    streamingData,
    playabilityStatus,
    directVideoCount,
    directAudioCount,
    signatureCipherCount,
    nTransformCount,
    serverAbrStreamingUrl,
    descriptorCount: descriptors.length,
  });
  const diagnostic = Object.freeze({
    provider: "youtube",
    input: safeToken(input, 60) || "player_response",
    stage,
    descriptorCount: descriptors.length,
    videoDescriptorCount: descriptors.filter((track) => track.type === "video")
      .length,
    audioDescriptorCount: descriptors.filter((track) => track.type === "audio")
      .length,
    directVideoCount,
    directAudioCount,
    signatureCipherCount,
    nTransformCount,
    serverAbrAvailable: Boolean(serverAbrStreamingUrl),
    hlsManifestAvailable,
    dashManifestAvailable,
    playabilityStatus,
    playerUrlAvailable: Boolean(playerUrl),
  });
  const diagnosticCandidate = createPlayerDiagnosticCandidate({
    pageUrl,
    title: response.videoDetails?.title || title,
    duration: positiveNumber(response.videoDetails?.lengthSeconds),
    serverAbrStreamingUrl,
    descriptors,
    diagnostic,
    playerUrl,
  });

  return Object.freeze({
    candidates: [
      diagnosticCandidate,
      ...directCandidates,
      ...playerChallengeCandidates,
    ],
    diagnostic,
    manifests: Object.freeze({
      hls: hlsManifestAvailable ? streamingData.hlsManifestUrl : null,
      dash: dashManifestAvailable ? streamingData.dashManifestUrl : null,
    }),
  });
}

function parseSignatureCipherTrack(value, { mimeType = null } = {}) {
  if (typeof value !== "string" || !value || value.length > 12_000) return null;
  const params = new URLSearchParams(value);
  const sourceUrl = params.get("url");
  const signature = params.get("s");
  const signatureParameter = params.get("sp") || "signature";
  if (
    !sourceUrl ||
    !signature ||
    signature.length > 4_096 ||
    !/^[a-zA-Z0-9_.-]{1,40}$/.test(signatureParameter)
  )
    return null;
  const track = parseYouTubePlaybackTrack(sourceUrl, { mimeType });
  if (!track) return null;
  return {
    track,
    signatureCipher: new URLSearchParams({
      url: track.sourceUrl,
      sp: signatureParameter,
      s: signature,
    }).toString(),
  };
}

function createPlayerDiagnosticCandidate({
  pageUrl,
  title,
  duration,
  serverAbrStreamingUrl,
  descriptors,
  diagnostic,
  playerUrl,
}) {
  const videoId = youtubeVideoId(pageUrl);
  return normalizeMediaCandidate({
    id: stableMediaId(MEDIA_KINDS.ADAPTIVE, `youtube:${videoId}`),
    pageUrl,
    sourceUrl: serverAbrStreamingUrl || pageUrl,
    kind: MEDIA_KINDS.ADAPTIVE,
    title,
    duration,
    variants: descriptors.filter((track) => track.type === "video"),
    audioTracks: descriptors.filter((track) => track.type === "audio"),
    detectedBy: MEDIA_DETECTION_SOURCES.PLAYER,
    provider: "youtube",
    acquisitionProfile: "youtube_player_response",
    acquisitionDiagnostic: diagnostic,
    playerUrl,
    probeStatus: MEDIA_PROBE_STATES.DISCOVERED,
    probeError: diagnostic.stage,
    streamType: "vod",
  });
}

function normalizeFormatDescriptor(format) {
  if (!format || typeof format !== "object") return null;
  const mimeType = cleanMimeType(format.mimeType);
  const type = mimeType?.startsWith("video/")
    ? "video"
    : mimeType?.startsWith("audio/")
      ? "audio"
      : null;
  const itag = safeToken(String(format.itag || ""), 24);
  if (!type || !itag) return null;
  const width = positiveInteger(format.width);
  const height = positiveInteger(format.height);
  const bitrate = positiveInteger(format.bitrate);
  const averageBandwidth = positiveInteger(format.averageBitrate) || bitrate;
  return {
    id: `youtube-${type}-${itag}`,
    type,
    itag,
    sourceUrl: null,
    mimeType,
    codecs: parseCodecs(format.mimeType),
    bandwidth: bitrate,
    averageBandwidth,
    contentLength: positiveInteger(format.contentLength),
    width,
    height,
    resolution: width && height ? { width, height } : null,
    qualityLabel: safeToken(format.qualityLabel || format.quality, 40),
    fps: positiveInteger(format.fps),
  };
}

function enrichResolvedTrack(track, format) {
  const descriptor = normalizeFormatDescriptor(format);
  return {
    ...track,
    contentLength: descriptor?.contentLength || track.contentLength,
    width: descriptor?.width || track.width,
    height: descriptor?.height || track.height,
    resolution: descriptor?.resolution || track.resolution,
    qualityLabel: descriptor?.qualityLabel || track.qualityLabel,
    bandwidth: descriptor?.bandwidth || track.bandwidth,
    averageBandwidth: descriptor?.averageBandwidth || track.averageBandwidth,
    fps: descriptor?.fps || null,
    duration: positiveNumber(format.approxDurationMs) / 1000 || track.duration,
  };
}

function selectPlayerStage({
  streamingData,
  playabilityStatus,
  directVideoCount,
  directAudioCount,
  signatureCipherCount,
  nTransformCount,
  serverAbrStreamingUrl,
  descriptorCount,
}) {
  if (playabilityStatus && playabilityStatus !== "OK")
    return YOUTUBE_PLAYER_STAGES.PLAYABILITY_BLOCKED;
  if (!streamingData) return YOUTUBE_PLAYER_STAGES.STREAMING_DATA_MISSING;
  if (directVideoCount && directAudioCount)
    return YOUTUBE_PLAYER_STAGES.RESOLVED_TRACKS;
  if (directVideoCount || directAudioCount)
    return YOUTUBE_PLAYER_STAGES.PARTIAL_RESOLVED_TRACKS;
  if (nTransformCount) return YOUTUBE_PLAYER_STAGES.N_TRANSFORM_PENDING;
  if (signatureCipherCount)
    return YOUTUBE_PLAYER_STAGES.SIGNATURE_CIPHER_PENDING;
  if (serverAbrStreamingUrl) return YOUTUBE_PLAYER_STAGES.SABR_RESOLVER_PENDING;
  if (descriptorCount) return YOUTUBE_PLAYER_STAGES.FORMAT_URLS_MISSING;
  return YOUTUBE_PLAYER_STAGES.STREAMING_DATA_MISSING;
}

function safeGoogleVideoUrl(value) {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !(
        url.hostname === "googlevideo.com" ||
        url.hostname.endsWith(".googlevideo.com")
      ) ||
      url.pathname !== "/videoplayback"
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function cleanMimeType(value) {
  const mimeType = String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  return /^(?:video|audio)\/[a-z0-9.+-]+$/.test(mimeType) ? mimeType : null;
}

function parseCodecs(value) {
  return (
    String(value || "")
      .match(/codecs\s*=\s*["']?([^"';]+)/i)?.[1]
      ?.trim() || null
  );
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function safeToken(value, maximum) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return token && token.length <= maximum ? token : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
