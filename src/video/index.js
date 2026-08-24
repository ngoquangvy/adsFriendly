import { videoState } from "./state.js";
import { loadPatternsAndReputation } from "./patterns.js";
import {
  scanAndObserveVideos,
  checkAllVideos,
  setVideoActions,
  stopObservingVideos,
} from "./observer.js";
import { skipVisibleAds } from "./skip.js";
import { accelerate, restore } from "./actions.js";
import { calculateAdScore, isAdVideo } from "./scoring.js";
import { startSpyBridge } from "./spy-bridge.js";
import { createMainController } from "../runtime/main-controller.js";
import { ACTIONS } from "../runtime/action-catalog.js";
import { createActionBroker } from "../runtime/action-broker.js";

function startVideoSurgeon(policy) {
  if (videoState.initialized) return;
  videoState.initialized = true;
  const actions = createActionBroker({
    featureId: "video.surgeon",
    policy,
    handlers: {
      [ACTIONS.VIDEO_ACCELERATE_AUTOMATIC]: accelerate,
      [ACTIONS.VIDEO_ACCELERATE_USER]: accelerate,
      [ACTIONS.VIDEO_RESTORE_PLAYBACK]: restore,
      [ACTIONS.VIDEO_SKIP_AUTOMATIC]: skipVisibleAds,
    },
  });
  setVideoActions(actions);
  window.AdsFriendlyVideoState = videoState;
  console.log("[AdsFriendly Video] Surgeon controlled by MainController.");
  loadPatternsAndReputation();
  scanAndObserveVideos();
  const stopBodyObserver = startBodyObserver();
  const skipIntervalId = setInterval(() => {
    if (!actions.can(ACTIONS.VIDEO_SKIP_AUTOMATIC)) return;
    actions
      .execute(ACTIONS.VIDEO_SKIP_AUTOMATIC)
      .catch((error) =>
        console.error("[AdsFriendly Video] Auto-skip failed", error),
      );
  }, 500);
  const stopSpyBridge = startSpyBridge(checkAllVideos);
  const onRuntimeMessage = (message) => {
    if (message.type === "SYNC_LEARNING") loadPatternsAndReputation();
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  const publicApi = {
    accelerate: (video) =>
      actions.execute(ACTIONS.VIDEO_ACCELERATE_USER, video),
    calculateAdScore,
    isAdVideo,
    scanAndObserve: scanAndObserveVideos,
  };
  window.VideoSurgeon = publicApi;

  return async () => {
    clearInterval(skipIntervalId);
    stopBodyObserver();
    stopSpyBridge();
    stopObservingVideos();
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    await Promise.all(
      [...videoState.activeAds].map((video) =>
        actions.execute(ACTIONS.VIDEO_RESTORE_PLAYBACK, video),
      ),
    );
    if (window.VideoSurgeon === publicApi) delete window.VideoSurgeon;
    if (window.AdsFriendlyVideoState === videoState)
      delete window.AdsFriendlyVideoState;
    videoState.initialized = false;
  };
}

function startBodyObserver() {
  let stopped = false;
  let observer = null;
  let retryId = null;
  const start = () => {
    if (stopped) return;
    if (document.body) {
      observer = new MutationObserver(scanAndObserveVideos);
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      retryId = setTimeout(start, 50);
    }
  };
  start();
  return () => {
    stopped = true;
    if (retryId) clearTimeout(retryId);
    observer?.disconnect();
  };
}

const controller = createMainController({
  context: "video",
  implementations: {
    "video.surgeon": ({ policy }) => startVideoSurgeon(policy),
  },
});

controller
  .start()
  .catch((error) =>
    console.error("[AdsFriendly Video] MainController failed", error),
  );
