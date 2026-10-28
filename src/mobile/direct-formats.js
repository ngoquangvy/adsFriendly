// The native iOS/Android readers consume this generated allowlist, not their
// own lists of file extensions. No playlist is treated as a finished media file.
export const MOBILE_DIRECT_FORMATS = Object.freeze([
  { extension: "mp3", mime: ["audio/mpeg", "audio/mp3"] },
  { extension: "m4a", mime: ["audio/mp4"] },
  { extension: "ogg", mime: ["audio/ogg"] },
  { extension: "opus", mime: ["audio/opus"] },
  { extension: "flac", mime: ["audio/flac", "audio/x-flac"] },
  { extension: "wav", mime: ["audio/wav", "audio/x-wav", "audio/wave"] },
  { extension: "mp4", mime: ["video/mp4"] },
  { extension: "webm", mime: ["video/webm", "audio/webm"] },
  { extension: "mov", mime: ["video/quicktime"] },
  { extension: "mkv", mime: ["video/x-matroska"] },
]);
