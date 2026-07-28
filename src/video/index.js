import { videoState } from "./state.js";
import { loadPatternsAndReputation } from "./patterns.js";
import { scanAndObserveVideos, checkAllVideos } from "./observer.js";
import { autoSkip } from "./skip.js";
import { accelerate } from "./actions.js";
import { calculateAdScore, isAdVideo } from "./scoring.js";
import { startSpyBridge } from "./spy-bridge.js";
function init() {
  if (videoState.initialized) return;
  videoState.initialized = true;
  window.AdsFriendlyVideoState = videoState;
  console.log("[AdsFriendly Video] Surgeon initialized.");
  loadPatternsAndReputation();
  scanAndObserveVideos();
  startBodyObserver();
  setInterval(autoSkip, 500);
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
    } else setTimeout(start, 50);
  };
  start();
}
init();
