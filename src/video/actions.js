import { videoState } from "./state.js";
import { notifySpy } from "./spy-bridge.js";
export function accelerate(video) {
  if (video.playbackRate >= 16) return;
  console.log(
    "[AdsFriendly Video] Neutralizing Ad:",
    video.src || "Dynamic Stream",
  );
  if (!videoState.activeAds.has(video)) {
    videoState.playbackSnapshots.set(video, {
      playbackRate: video.playbackRate,
      muted: video.muted,
    });
  }
  video.playbackRate = 16;
  video.muted = true;
  videoState.activeAds.add(video);
  notifyBrainOfAdState(video);
}
export function restore(video) {
  if (!videoState.activeAds.has(video)) return;
  console.log("[AdsFriendly Video] Ad finished. Restoring content speed.");
  const snapshot = videoState.playbackSnapshots.get(video);
  video.playbackRate = snapshot?.playbackRate ?? 1;
  video.muted = snapshot?.muted ?? false;
  videoState.activeAds.delete(video);
  videoState.playbackSnapshots.delete(video);
  notifySpy(false);
}
function notifyBrainOfAdState(video) {
  const player = video.closest('[class*="player"]');
  if (!player) return;
  chrome.runtime.sendMessage({
    type: "SYNC_VIDEO_LEARNING",
    hostname: location.hostname,
    classes: player.className,
    duration: video.duration,
  });
}
