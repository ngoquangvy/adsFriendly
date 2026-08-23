import { videoState } from "./state.js";
import { loadPatternsAndReputation } from "./patterns.js";
import {
  scanAndObserveVideos,
  checkAllVideos,
  setVideoPolicy,
} from "./observer.js";
import { autoSkip } from "./skip.js";
import { accelerate } from "./actions.js";
import { calculateAdScore, isAdVideo } from "./scoring.js";
import { startSpyBridge } from "./spy-bridge.js";
import { createMainController } from "../runtime/main-controller.js";

function startVideoSurgeon(policy) {
  if (videoState.initialized) return;
  videoState.initialized = true;
  setVideoPolicy(policy);
  window.AdsFriendlyVideoState = videoState;
  console.log("[AdsFriendly Video] Surgeon controlled by MainController.");
  loadPatternsAndReputation();
  scanAndObserveVideos();
  startBodyObserver();
  setInterval(() => autoSkip(policy), 500);
  startSpyBridge(checkAllVideos);
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "SYNC_LEARNING") loadPatternsAndReputation();
  });
  window.VideoSurgeon = {
    accelerate,
    calculateAdScore,
    isAdVideo,
    scanAndObserve: scanAndObserveVideos,
  };
}

function startBodyObserver() {
  const start = () => {
    if (document.body) {
      const observer = new MutationObserver(scanAndObserveVideos);
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      setTimeout(start, 50);
    }
  };
  start();
}

const controller = createMainController({
  context: "video",
  implementations: {
    "video.surgeon": ({ policy }) => startVideoSurgeon(policy),
  },
});

controller.start().catch((error) =>
  console.error("[AdsFriendly Video] MainController failed", error),
);
