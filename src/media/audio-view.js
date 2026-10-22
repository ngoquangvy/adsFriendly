import { formatBytes } from "./download-job-view.js";
// A file-wide average includes container overhead; never call it encoder bitrate.
export function directAudioMetadata(item = {}) {
  const duration =
    Number.isFinite(item.duration) && item.duration > 0 ? item.duration : null;
  const bytes =
    Number.isSafeInteger(item.contentLength) && item.contentLength > 0
      ? item.contentLength
      : null;
  return {
    duration,
    bytes,
    averageKbps:
      duration && bytes ? Math.round((bytes * 8) / duration / 1000) : null,
  };
}
export function formatDirectAudioEstimate(item) {
  const { bytes, averageKbps } = directAudioMetadata(item);
  return [
    averageKbps ? `~${averageKbps} kbps avg` : null,
    bytes ? formatBytes(bytes) : "Size unavailable",
  ]
    .filter(Boolean)
    .join(" · ");
}
export function formatDirectAudioDetails(item) {
  const { duration } = directAudioMetadata(item);
  const time = duration
    ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`
    : null;
  return ["Direct audio", time].filter(Boolean).join(" · ");
}
