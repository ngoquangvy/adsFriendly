export const MEDIA_OUTPUT_CONTAINERS = Object.freeze({
  SOURCE: "source",
  MP4: "mp4",
  MKV: "mkv",
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
  const profiles = [
    Object.freeze({
      id: "video-mp4",
      container: MEDIA_OUTPUT_CONTAINERS.MP4,
      extension: ".mp4",
      label: "MP4 · compatible",
      description: "Best compatibility for browsers, phones, and TVs.",
    }),
  ];
  if (canSelectContainer) {
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
  return {
    profileId: profile.id,
    container: profile.container,
    extension: profile.extension,
    videoTrackId: normalizeVideoTrackId(value?.videoTrackId, candidate),
  };
}

export function getMediaVideoQualityOptions(candidate = {}) {
  if (candidate.kind !== "adaptive") return [];
  const hasSeparateAudio = (candidate.audioTracks || []).some(
    (track) => track?.sourceUrl,
  );
  return uniqueObjects(candidate.variants || [])
    .filter(
      (track) => track?.sourceUrl && (track.muxed === true || hasSeparateAudio),
    )
    .sort(compareVideoQuality)
    .map((track) =>
      Object.freeze({
        id: track.id,
        label: videoQualityLabel(track),
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
    (item) => item?.id === value && item?.sourceUrl,
  );
  if (!track || (track.muxed !== true && !(candidate.audioTracks || []).length))
    throw new Error(
      "[MediaDownload] Selected video quality is no longer downloadable.",
    );
  return value;
}

function compareVideoQuality(left, right) {
  return (
    (right.resolution?.height || right.height || 0) -
      (left.resolution?.height || left.height || 0) ||
    (right.averageBandwidth || right.bandwidth || 0) -
      (left.averageBandwidth || left.bandwidth || 0)
  );
}

function videoQualityLabel(track) {
  const quality =
    track.qualityLabel ||
    (track.resolution?.height || track.height
      ? `${track.resolution?.height || track.height}p`
      : "Source quality");
  const format = String(track.mimeType || "").includes("webm")
    ? "WebM"
    : String(track.mimeType || "").includes("mp4")
      ? "MP4"
      : null;
  return [quality, format, track.muxed === true ? "audio included" : null]
    .filter(Boolean)
    .join(" · ");
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
  { videoTrackId = null } = {},
) {
  const presentation = displayItem || candidate;
  const resolved = presentation.resolvedStream || candidate.resolvedStream;
  const variants = uniqueObjects([
    ...(candidate.variants || []),
    ...(presentation.variants || []),
  ]).sort(compareBandwidth);
  const selectedVariant =
    variants.find((variant) => variant.id === videoTrackId) ||
    variants[0] ||
    null;
  const resolution =
    resolved?.resolution ||
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
    resolved?.bandwidth,
    candidate.averageBandwidth,
    candidate.bandwidth,
    selectedVariant?.averageBandwidth,
    selectedVariant?.bandwidth,
  );
  if (["dash", "adaptive"].includes(candidate.kind) && bandwidth) {
    const audioBandwidth = [...(candidate.audioTracks || [])]
      .map((track) =>
        firstPositiveNumber(track.averageBandwidth, track.bandwidth),
      )
      .filter(Boolean)
      .sort((left, right) => right - left)[0];
    if (audioBandwidth) bandwidth += audioBandwidth;
  }
  const estimatedBytes =
    candidate.kind === "adaptive"
      ? adaptiveContentLength(candidate, selectedVariant)
      : duration && bandwidth
        ? Math.round((duration * bandwidth) / 8)
        : null;
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
        ? "track_content_length"
        : "manifest_bandwidth"
      : null,
  });
}

function adaptiveContentLength(candidate, selectedVariant = null) {
  const video =
    selectedVariant?.contentLength ||
    [...(candidate.variants || [])].sort(compareBandwidth)[0]?.contentLength;
  if (selectedVariant?.muxed === true) {
    const total = Number(video) || 0;
    return Number.isSafeInteger(total) && total > 0 ? total : null;
  }
  const audio = [...(candidate.audioTracks || [])].sort(compareBandwidth)[0]
    ?.contentLength;
  const total = (Number(video) || 0) + (Number(audio) || 0);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
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
