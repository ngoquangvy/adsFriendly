var AdsFriendlyVideo = (() => {
  // src/video/state.js
  var videoState = {
    activeAds: /* @__PURE__ */ new Set(),
    cachedPatterns: [],
    currentAdDensity: 0,
    siteTrustScore: 0.5,
    initialized: false
  };

  // src/shared/pattern-store.js
  var VIDEO_PATTERN_TYPES = /* @__PURE__ */ new Set([
    "video_source_marker",
    "video_marker"
  ]);
  async function getGlobalPatterns() {
    const { globalAdPatterns = [] } = await chrome.storage.local.get("globalAdPatterns");
    return Array.isArray(globalAdPatterns) ? globalAdPatterns : [];
  }
  async function getVideoPatterns() {
    return (await getGlobalPatterns()).filter(
      (pattern) => VIDEO_PATTERN_TYPES.has(pattern?.type)
    );
  }

  // src/video/patterns.js
  async function loadPatternsAndReputation() {
    try {
      const { siteReputation = {} } = await chrome.storage.local.get("siteReputation");
      videoState.cachedPatterns = await getVideoPatterns();
      const rep = siteReputation[location.hostname];
      if (rep) videoState.siteTrustScore = rep.trustScore;
      console.log(
        `[AdsFriendly Video] Brain Synced. Site Trust: ${videoState.siteTrustScore.toFixed(2)}`
      );
    } catch {
    }
  }

  // src/video/spy-bridge.js
  function notifySpy(adMode) {
    window.postMessage(
      { source: "adsfriendly-content", type: "SET_AD_MODE", value: adMode },
      "*"
    );
  }
  function startSpyBridge(onAdDetected) {
    window.addEventListener("message", (event) => {
      if (event.data?.source === "adsfriendly-spy" && event.data.type === "AD_MAP_DETECTED")
        onAdDetected();
      if (event.data?.source === "adsfriendly-content" && event.data.type === "AD_DENSITY_VALUE" && window.AdsFriendlyVideoState)
        window.AdsFriendlyVideoState.currentAdDensity = event.data.value;
    });
  }

  // src/video/actions.js
  function accelerate(video) {
    if (video.playbackRate >= 16) return;
    console.log(
      "[AdsFriendly Video] Neutralizing Ad:",
      video.src || "Dynamic Stream"
    );
    video.playbackRate = 16;
    video.muted = true;
    videoState.activeAds.add(video);
    notifyBrainOfAdState(video);
  }
  function restore(video) {
    if (!videoState.activeAds.has(video)) return;
    console.log("[AdsFriendly Video] Ad finished. Restoring content speed.");
    video.playbackRate = 1;
    video.muted = false;
    videoState.activeAds.delete(video);
    notifySpy(false);
  }
  function notifyBrainOfAdState(video) {
    const player = video.closest('[class*="player"]');
    if (!player) return;
    chrome.runtime.sendMessage({
      type: "SYNC_VIDEO_LEARNING",
      hostname: location.hostname,
      classes: player.className,
      duration: video.duration
    });
  }

  // src/video/scoring.js
  function calculateAdScore(video) {
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
  function isAdVideo(video) {
    return calculateAdScore(video) >= 0.8;
  }

  // src/video/observer.js
  function scanAndObserveVideos() {
    document.querySelectorAll("video").forEach((video) => {
      if (video.dataset.observed) return;
      video.dataset.observed = "true";
      attach(video);
      checkAndExecute(video);
    });
  }
  function checkAllVideos() {
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
        `[AdsFriendly Video] Neutralizing Ad (${(score * 100).toFixed(0)}%)`
      );
      accelerate(video);
      notifySpy(true);
    } else restore(video);
  }

  // src/video/skip.js
  var SKIP_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-container",
    ".videoAdUiSkipButton",
    ".fluid_ad_skip_button",
    'button[class*="skip"]',
    '[aria-label*="Skip ad"]'
  ];
  function autoSkip() {
    SKIP_SELECTORS.forEach((sel) => {
      const btn = document.querySelector(sel);
      clickIfVisible(btn);
    });
    document.querySelectorAll('button, div[role="button"], span[role="button"]').forEach((btn) => {
      const txt = btn.textContent.toLowerCase();
      if ((txt.includes("skip") || txt.includes("b\u1ECF qua")) && (txt.includes("ad") || txt.includes("qu\u1EA3ng")) && isVisible(btn))
        clickIfVisible(btn);
    });
  }
  function clickIfVisible(el) {
    if (!isVisible(el) || typeof el.click !== "function") return;
    el.click();
  }
  function isVisible(el) {
    if (!el) return false;
    return el.offsetParent !== null || el.getClientRects().length > 0;
  }

  // src/video/index.js
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
      scanAndObserve: scanAndObserveVideos
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
})();
