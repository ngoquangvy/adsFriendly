import { videoState } from "./state.js";
export function calculateAdScore(video) {
  let score = 0;
  const src = video.currentSrc || video.src || "";
  if (!src) return 0;
  videoState.cachedPatterns.forEach((p) => {
    if (p.type === "video_source_marker" && src.includes(p.value)) score += 0.8;
    if (p.type === "video_marker" && video.closest(p.value)) score += 0.6;
  });
  if (videoState.siteTrustScore < 0.3) score += 0.3;
  if (videoState.siteTrustScore > 0.8) score -= 0.6;
  if (videoState.currentAdDensity > 5) score += 0.2;
  if (videoState.currentAdDensity > 15) score += 0.4;
  const external = !src.startsWith("blob:") && !src.includes(location.hostname);
  if (external) {
    score += 0.3;
    if (src.includes("githubusercontent.com") || src.includes("github.io"))
      score += 0.2;
    if (src.toLowerCase().endsWith(".mp4")) score += 0.2;
  }
  if (video.duration > 0 && video.duration < 65) score += 0.2;
  if (video.duration > 300) score -= 1;
  return Math.min(1, score);
}
export function isAdVideo(video) {
  return calculateAdScore(video) >= 0.8;
}
