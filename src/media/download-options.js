import { isAcquirableAdaptiveTrack } from "./adaptive-track-policy.js";
import { formatAudioLanguageLabel } from "./audio-language-label.js";

export const MEDIA_OUTPUT_CONTAINERS = Object.freeze({
  SOURCE: "source",
  MP4: "mp4",
  MKV: "mkv",
  OGG: "ogg",
});

export function getMediaDownloadProfiles(
  candidate = {},
  { canSelectContainer = true } = {},
) {
  if (candidate.kind === "direct") {
    const container = classifyDirectMediaContainer(candidate);
    return [
      Object.freeze({
        id: "source",
        container: MEDIA_OUTPUT_CONTAINERS.SOURCE,
        extension: container ? `.${container}` : null,
        label: `Original${container ? ` · ${container.toUpperCase()}` : ""}`,
        description: "Download the original file without conversion.",
      }),
    ];
  }
  if (!["hls", "dash", "adaptive"].includes(candidate.kind)) return [];
  const profiles = [];
  if (candidate.kind !== "adaptive" || (candidate.variants || []).length) {
    profiles.push(
      Object.freeze({
        id: "video-mp4",
        container: MEDIA_OUTPUT_CONTAINERS.MP4,
        extension: ".mp4",
        label: "MP4 · compatible",
        description: "Best compatibility for browsers, phones, and TVs.",
      }),
    );
  }
  if (
    candidate.provider === "youtube" &&
    (candidate.audioTracks || []).length
  ) {
    profiles.push(
      Object.freeze({
        id: "audio-ogg",
        container: MEDIA_OUTPUT_CONTAINERS.OGG,
        extension: ".ogg",
        label: "Audio · OGG",
        description:
          "Download the best available YouTube audio as an OGG file.",
      }),
    );
  }
  if (
    canSelectContainer &&
    (candidate.kind !== "adaptive" || (candidate.variants || []).length)
  ) {
    profiles.push(
      Object.freeze({
        id: "video-mkv",
        container: MEDIA_OUTPUT_CONTAINERS.MKV,
        extension: ".mkv",
        label: "MKV · flexible",
        description: "Keeps more source codecs without re-encoding.",
      }),
    );
  }
  return profiles;
}

export function normalizeMediaDownloadOutput(value, candidate = {}) {
  const profiles = getMediaDownloadProfiles(candidate);
  if (!profiles.length)
    throw new Error("[MediaDownload] No output format is available.");
  const requested =
    typeof value?.profileId === "string" ? value.profileId : profiles[0].id;
  const profile = profiles.find((item) => item.id === requested);
  if (!profile) {
    throw new Error(
      `[MediaDownload] Output profile "${requested}" is not supported for ${candidate.kind || "this media"}.`,
    );
  }
  const normalized = {
    profileId: profile.id,
    container: profile.container,
    extension: profile.extension,
    videoTrackId: normalizeVideoTrackId(value?.videoTrackId, candidate),
  };
  // Keep the output contract compact for direct/HLS/DASH jobs. Adaptive jobs
  // may explicitly opt into a provider-equivalent YouTube quality after the
  // popup preflight and the background re-check.
  if (candidate.kind === "adaptive") {
    normalized.allowEquivalentVideo = value?.allowEquivalentVideo === true;
    if ((candidate.audioTracks || []).length) {
      normalized.audioTrackId = normalizeAudioTrackId(
        value?.audioTrackId,
        candidate,
      );
    }
  }
  return normalized;
}

export function getMediaAudioTrackOptions(candidate = {}) {
  if (candidate.kind !== "adaptive") return [];
  return uniqueObjects(candidate.audioTracks || [])
    .filter((track) => isAcquirableAdaptiveTrack(candidate, track))
    .sort(compareAudioPreference)
    .map((track) =>
      Object.freeze({
        id: track.id,
        label: audioTrackLabel(track),
        language: track.language || null,
        role: track.audioRole || null,
        isOriginal: track.audioRole === "original",
        isDefault: track.audioIsDefault === true,
        estimatedBytes: positiveInteger(track.contentLength),
      }),
    );
}

export function getMediaVideoQualityOptions(candidate = {}) {
  if (candidate.kind !== "adaptive") return [];
  const hasSeparateAudio = (candidate.audioTracks || []).some((track) =>
    isAcquirableAdaptiveTrack(candidate, track),
  );
  return uniqueObjects(candidate.variants || [])
    .filter(
      (track) =>
        isAcquirableAdaptiveTrack(candidate, track) &&
        (track.muxed === true || hasSeparateAudio),
    )
    .sort(compareVideoQuality)
    .map((track) =>
      Object.freeze({
        id: track.id,
        label: videoQualityLabel(track),
        groupLabel: videoQualityGroupLabel(track),
        optionLabel: videoQualityOptionLabel(track),
        height: positiveInteger(track.resolution?.height || track.height),
        muxed: track.muxed === true,
        estimatedBytes: positiveInteger(track.contentLength),
      }),
    );
}

function normalizeVideoTrackId(value, candidate) {
  if (candidate.kind !== "adaptive") return null;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string")
    throw new Error("[MediaDownload] Invalid video quality selection.");
  const track = (candidate.variants || []).find(
    (item) => item?.id === value && isAcquirableAdaptiveTrack(candidate, item),
  );
  if (!track || (track.muxed !== true && !(candidate.audioTracks || []).length))
    throw new Error(
      "[MediaDownload] Selected video quality is no longer downloadable.",
    );
  return value;
}

function normalizeAudioTrackId(value, candidate) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string")
    throw new Error("[MediaDownload] Invalid audio track selection.");
  const track = (candidate.audioTracks || []).find(
    (item) => item?.id === value && isAcquirableAdaptiveTrack(candidate, item),
  );
  if (!track)
    throw new Error(
      "[MediaDownload] Selected audio track is no longer downloadable.",
    );
  return value;
}

function compareVideoQuality(left, right) {
  return (
    (right.resolution?.height || right.height || 0) -
      (left.resolution?.height || left.height || 0) ||
    qualityFps(right) - qualityFps(left) ||
    videoCompatibilityScore(right) - videoCompatibilityScore(left) ||
    (right.averageBandwidth || right.bandwidth || 0) -
      (left.averageBandwidth || left.bandwidth || 0)
  );
}

function videoQualityLabel(track) {
  return [videoQualityGroupLabel(track), videoQualityOptionLabel(track)]
    .filter(Boolean)
    .join(" · ");
}

function videoQualityGroupLabel(track) {
  const quality =
    track.qualityLabel ||
    (track.resolution?.height || track.height
      ? `${track.resolution?.height || track.height}p`
      : "Source quality");
  return quality;
}

function videoQualityOptionLabel(track) {
  const format = String(track.mimeType || "").includes("webm")
    ? "WebM"
    : String(track.mimeType || "").includes("mp4")
      ? "MP4"
      : null;
  const codec = codecLabel(track.codecs);
  return [format, codec, track.muxed === true ? "audio included" : null]
    .filter(Boolean)
    .join(" · ");
}

function qualityFps(track) {
  const explicit = positiveInteger(track.fps);
  if (explicit) return explicit;
  return (
    positiveInteger(String(track.qualityLabel || "").match(/p(\d+)$/i)?.[1]) ||
    0
  );
}

function videoCompatibilityScore(track) {
  const mime = String(track.mimeType || "").toLowerCase();
  const codec = String(track.codecs || "").toLowerCase();
  if (
    mime.includes("mp4") &&
    (codec.includes("avc1") || codec.includes("avc3"))
  )
    return 40;
  if (mime.includes("mp4") && codec.includes("av01")) return 30;
  if (
    mime.includes("webm") &&
    (codec.includes("vp9") || codec.includes("vp09"))
  )
    return 20;
  if (mime.includes("mp4")) return 10;
  return 0;
}

function codecLabel(value) {
  const codec = String(value || "").toLowerCase();
  if (codec.includes("avc1") || codec.includes("avc3")) return "H.264";
  if (codec.includes("av01")) return "AV1";
  if (codec.includes("vp9") || codec.includes("vp09")) return "VP9";
  if (codec.includes("hev1") || codec.includes("hvc1")) return "HEVC";
  if (codec.includes("mp4a") || codec.includes("aac")) return "AAC";
  if (codec.includes("opus")) return "Opus";
  if (codec.includes("vorbis")) return "Vorbis";
  return null;
}

export function classifyDirectMediaContainer(candidate = {}) {
  const mime = String(candidate.mimeType || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const byMime = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
  }[mime];
  if (byMime) return byMime;
  try {
    const path = new URL(candidate.sourceUrl).pathname;
    const extension = path.match(/\.([a-z0-9]{2,6})$/i)?.[1]?.toLowerCase();
    return extension || null;
  } catch {
    return null;
  }
}

export function getMediaDownloadEstimate(
  candidate = {},
  displayItem = null,
  { videoTrackId = null, audioTrackId = null, audioOnly = false } = {},
) {
  const presentation = displayItem || candidate;
  const resolved = presentation.resolvedStream || candidate.resolvedStream;
  const allVariants = uniqueObjects([
    ...(candidate.variants || []),
    ...(presentation.variants || []),
  ]);
  const variants = (
    candidate.kind === "adaptive"
      ? allVariants.filter((track) =>
          isAcquirableAdaptiveTrack(candidate, track),
        )
      : allVariants
  ).sort(compareBandwidth);
  const selectedVariant = audioOnly
    ? null
    : variants.find((variant) => variant.id === videoTrackId) ||
      variants[0] ||
      null;
  const resolution =
    resolved?.resolution ||
    (candidate.kind === "adaptive" ? selectedVariant?.resolution : null) ||
    candidate.resolution ||
    presentation.resolution ||
    selectedVariant?.resolution ||
    null;
  const duration = firstPositiveNumber(
    resolved?.duration,
    candidate.duration,
    presentation.duration,
  );
  let bandwidth = firstPositiveNumber(
    audioOnly ? null : resolved?.bandwidth,
    resolved?.bandwidth,
    candidate.kind === "adaptive" ? selectedVariant?.averageBandwidth : null,
    candidate.kind === "adaptive" ? selectedVariant?.bandwidth : null,
    candidate.averageBandwidth,
    candidate.bandwidth,
    selectedVariant?.averageBandwidth,
    selectedVariant?.bandwidth,
  );
  if (
    ["dash", "adaptive"].includes(candidate.kind) &&
    bandwidth &&
    selectedVariant?.muxed !== true
  ) {
    const audioBandwidth = [...(candidate.audioTracks || [])]
      .filter(
        (track) =>
          (candidate.kind !== "adaptive" ||
            isAcquirableAdaptiveTrack(candidate, track)) &&
          (!audioTrackId || track.id === audioTrackId),
      )
      .map((track) =>
        firstPositiveNumber(track.averageBandwidth, track.bandwidth),
      )
      .filter(Boolean)
      .sort((left, right) => right - left)[0];
    if (audioBandwidth) bandwidth += audioBandwidth;
  }
  if (audioOnly) {
    bandwidth = firstPositiveNumber(
      ...(candidate.audioTracks || [])
        .filter((track) => !audioTrackId || track.id === audioTrackId)
        .map((track) => track.averageBandwidth || track.bandwidth),
    );
  }
  const adaptiveBytes =
    candidate.kind === "adaptive"
      ? adaptiveContentLength(
          candidate,
          selectedVariant,
          audioOnly,
          audioTrackId,
        )
      : null;
  const estimatedBytes =
    adaptiveBytes ||
    (duration && bandwidth ? Math.round((duration * bandwidth) / 8) : null);
  return Object.freeze({
    resolution: resolution
      ? {
          width: positiveInteger(resolution.width),
          height: positiveInteger(resolution.height),
        }
      : null,
    duration,
    bandwidth,
    estimatedBytes,
    basis: estimatedBytes
      ? candidate.kind === "adaptive"
        ? adaptiveBytes
          ? "track_content_length"
          : "track_bitrate"
        : "manifest_bandwidth"
      : null,
  });
}

function adaptiveContentLength(
  candidate,
  selectedVariant = null,
  audioOnly = false,
  audioTrackId = null,
) {
  if (audioOnly) {
    const audio = [...(candidate.audioTracks || [])]
      .filter(
        (track) =>
          isAcquirableAdaptiveTrack(candidate, track) &&
          (!audioTrackId || track.id === audioTrackId),
      )
      .sort(compareAudioPreference)[0]?.contentLength;
    const total = Number(audio) || 0;
    return Number.isSafeInteger(total) && total > 0 ? total : null;
  }
  const video =
    selectedVariant?.contentLength ||
    [...(candidate.variants || [])].sort(compareBandwidth)[0]?.contentLength;
  if (selectedVariant?.muxed === true) {
    const total = Number(video) || 0;
    return Number.isSafeInteger(total) && total > 0 ? total : null;
  }
  const audio = [...(candidate.audioTracks || [])]
    .filter(
      (track) =>
        isAcquirableAdaptiveTrack(candidate, track) &&
        (!audioTrackId || track.id === audioTrackId),
    )
    .sort(compareAudioPreference)[0]?.contentLength;
  const total = (Number(video) || 0) + (Number(audio) || 0);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

function compareAudioPreference(left, right) {
  return (
    audioRoleScore(right) - audioRoleScore(left) ||
    Number(right.audioIsDefault === true) -
      Number(left.audioIsDefault === true) ||
    Number(left.isDrc === true) - Number(right.isDrc === true) ||
    compareBandwidth(left, right) ||
    mp4AudioScore(right) - mp4AudioScore(left)
  );
}

function audioRoleScore(track) {
  return (
    {
      original: 50,
      secondary: 30,
      dubbed: 20,
      auto_dubbed: 10,
      descriptive: 5,
    }[track.audioRole] || 25
  );
}

function audioTrackLabel(track) {
  const language = formatAudioLanguageLabel({
    language: track.language,
    name: track.audioTrackName,
    role: track.audioRole,
    isDefault: track.audioIsDefault === true,
  });
  const codec = codecLabel(track.codecs);
  const bitrate = audioBitrateLabel(
    firstPositiveNumber(track.averageBandwidth, track.bandwidth),
  );
  return [
    language,
    bitrate,
    codec,
    audioChannelsLabel(track.audioChannels),
    audioSampleRateLabel(track.audioSampleRate),
    track.isDrc ? "DRC" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function audioBitrateLabel(value) {
  const bitrate = positiveInteger(value);
  return bitrate ? `${Math.round(bitrate / 1000)} kbps` : null;
}

function audioChannelsLabel(value) {
  const channels = positiveInteger(value);
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  return channels ? `${channels} channels` : null;
}

function audioSampleRateLabel(value) {
  const rate = positiveInteger(value);
  if (!rate) return null;
  const khz = rate / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

function mp4AudioScore(track) {
  return /\/(?:mp4|m4a)(?:$|;)/i.test(track.mimeType || "") ? 1 : 0;
}

function compareBandwidth(left, right) {
  return (
    (firstPositiveNumber(right.averageBandwidth, right.bandwidth) || 0) -
      (firstPositiveNumber(left.averageBandwidth, left.bandwidth) || 0) ||
    (right.resolution?.height || 0) - (left.resolution?.height || 0)
  );
}

function uniqueObjects(items) {
  const unique = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    unique.set(
      item.id ||
        `${item.url || ""}:${item.bandwidth || ""}:${item.resolution?.height || ""}`,
      item,
    );
  }
  return [...unique.values()];
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
