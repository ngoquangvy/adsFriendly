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
  if (!["hls", "dash"].includes(candidate.kind)) return [];
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
  };
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
