import { calculateAdScore } from "./scoring.js";
import { notifySpy } from "./spy-bridge.js";
import { ACTIONS } from "../runtime/action-catalog.js";

let videoActions = null;
const attachments = new Map();

export function setVideoActions(actions) {
  videoActions = actions;
}

export function scanAndObserveVideos() {
  document.querySelectorAll("video").forEach((video) => {
    if (video.dataset.adsfriendlyVideoObserved) return;
    video.dataset.adsfriendlyVideoObserved = "true";
    attach(video);
    checkAndExecute(video);
  });
}

export function checkAllVideos() {
  document.querySelectorAll("video").forEach(checkAndExecute);
}

export function stopObservingVideos() {
  for (const [video, attachment] of attachments) {
    attachment.observer.disconnect();
    video.removeEventListener("play", attachment.onPlayback);
    video.removeEventListener("playing", attachment.onPlayback);
    delete video.dataset.adsfriendlyVideoObserved;
  }
  attachments.clear();
  videoActions = null;
}

function attach(video) {
  const observer = new MutationObserver(() => checkAndExecute(video));
  observer.observe(video, { attributes: true, attributeFilter: ["src"] });
  const onPlayback = () => checkAndExecute(video);
  video.addEventListener("play", onPlayback);
  video.addEventListener("playing", onPlayback);
  attachments.set(video, { observer, onPlayback });
}

function checkAndExecute(video) {
  const score = calculateAdScore(video);
  if (score >= 0.8 && videoActions?.can(ACTIONS.VIDEO_ACCELERATE_AUTOMATIC)) {
    console.log(
      `[AdsFriendly Video] Neutralizing Ad (${(score * 100).toFixed(0)}%)`,
    );
    execute(ACTIONS.VIDEO_ACCELERATE_AUTOMATIC, video);
    notifySpy(true);
  } else {
    execute(ACTIONS.VIDEO_RESTORE_PLAYBACK, video);
    notifySpy(false);
  }
}

function execute(actionId, video) {
  if (!videoActions?.can(actionId)) return;
  videoActions
    .execute(actionId, video)
    .catch((error) =>
      console.error(`[AdsFriendly Video] Action ${actionId} failed`, error),
    );
}
