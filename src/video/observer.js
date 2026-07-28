import { accelerate, restore } from "./actions.js";
import { calculateAdScore } from "./scoring.js";
import { notifySpy } from "./spy-bridge.js";
export function scanAndObserveVideos() {
  document.querySelectorAll("video").forEach((video) => {
    if (video.dataset.observed) return;
    video.dataset.observed = "true";
    attach(video);
    checkAndExecute(video);
  });
}
export function checkAllVideos() {
  document.querySelectorAll("video").forEach(checkAndExecute);
}
function attach(video) {
  const observer = new MutationObserver(() => checkAndExecute(video));
  observer.observe(video, { attributes: true, attributeFilter: ["src"] });
  video.addEventListener("play", () => checkAndExecute(video));
  video.addEventListener("playing", () => checkAndExecute(video));
}
function checkAndExecute(video) {
  const score = calculateAdScore(video);
  if (score >= 0.8) {
    console.log(
      `[AdsFriendly Video] Neutralizing Ad (${(score * 100).toFixed(0)}%)`,
    );
    accelerate(video);
    notifySpy(true);
  } else restore(video);
}
