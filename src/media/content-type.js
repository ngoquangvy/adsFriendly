// Content type is independent of transport (direct/HLS/DASH/blob).
export const MEDIA_TYPES = Object.freeze([
  "audio",
  "video",
  "audio_video",
  "unknown",
]);
export const AUDIO_EXTENSIONS = Object.freeze([
  "mp3",
  "m4a",
  "ogg",
  "oga",
  "opus",
  "flac",
  "wav",
]);
const AUDIO_MIMES = Object.freeze({
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
});
export function sourceExtension(url) {
  try {
    return (
      new URL(url).pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ||
      ""
    );
  } catch {
    return "";
  }
}
export function sourceMime(value) {
  const mime = String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : "";
}
export function audioContainer(mime) {
  return AUDIO_MIMES[sourceMime(mime)] || null;
}
export function identifyMediaType({ sourceUrl, mimeType, elementType } = {}) {
  const mime = sourceMime(mimeType),
    ext = sourceExtension(sourceUrl);
  if (audioContainer(mime))
    return { mediaType: "audio", mediaTypeEvidence: "mime" };
  if (mime.startsWith("video/"))
    return { mediaType: "video", mediaTypeEvidence: "mime" };
  if (
    mime &&
    !["application/octet-stream", "binary/octet-stream"].includes(mime)
  )
    return { mediaType: "unknown", mediaTypeEvidence: "unknown" };
  if (elementType === "audio")
    return { mediaType: "audio", mediaTypeEvidence: "element" };
  if (AUDIO_EXTENSIONS.includes(ext))
    return { mediaType: "audio", mediaTypeEvidence: "extension" };
  if (/^(mp4|webm|m4v|mov)$/.test(ext))
    return { mediaType: "video", mediaTypeEvidence: "extension" };
  return { mediaType: "unknown", mediaTypeEvidence: "unknown" };
}
export function mergeMediaType(existing, candidate) {
  const rank = { unknown: 0, extension: 1, element: 2, mime: 3 };
  return (rank[existing?.mediaTypeEvidence] || 0) >
    (rank[candidate.mediaTypeEvidence] || 0)
    ? {
        mediaType: existing.mediaType,
        mediaTypeEvidence: existing.mediaTypeEvidence,
      }
    : {
        mediaType: candidate.mediaType,
        mediaTypeEvidence: candidate.mediaTypeEvidence,
      };
}
