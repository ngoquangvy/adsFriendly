var AdsFriendlyMainWorld = (() => {
  // src/main-world/bridge.js
  function notifyContentScript(data) {
    window.postMessage({ source: "adsfriendly-spy", ...data }, "*");
  }
  function onContentMessage(handler) {
    window.addEventListener("message", (event) => {
      if (event.data?.source === "adsfriendly-content") handler(event.data);
    });
  }

  // src/main-world/manifest-analyzer.js
  var AD_MARKERS = [
    "#EXT-X-CUE-OUT",
    "#EXT-X-DATERANGE",
    "adunit",
    "vpaid",
    "doubleclick"
  ];
  function analyzeManifest(url, body) {
    if (!AD_MARKERS.some((marker) => body.includes(marker))) return;
    console.log("[AdsFriendly Spy] Ad segment detected in manifest:", url);
    notifyContentScript({ type: "AD_MAP_DETECTED", url });
  }

  // src/main-world/network-capture.js
  function installNetworkCapture() {
    installFetchCapture();
    installXhrCapture();
  }
  function installFetchCapture() {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = requestUrl(args[0]);
      const response = await originalFetch.apply(this, args);
      if (isManifestLike(url))
        response.clone().text().then((body) => analyzeManifest(url, body)).catch(() => {
        });
      return response;
    };
  }
  function installXhrCapture() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__adsfriendly_url = requestUrl(url);
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      this.addEventListener("load", () => {
        const url = this.__adsfriendly_url || "";
        if (!isManifestLike(url)) return;
        try {
          if (typeof this.responseText === "string")
            analyzeManifest(url, this.responseText);
        } catch {
        }
      });
      return originalSend.apply(this, args);
    };
  }
  function requestUrl(input) {
    if (!input) return "";
    if (typeof input === "string") return input;
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.href;
    return input.toString();
  }
  function isManifestLike(url = "") {
    return url.includes(".m3u8") || url.includes(".mpd") || url.includes("player/v1/player");
  }

  // src/main-world/timer-control.js
  var isAdMode = false;
  function setAdMode(value) {
    isAdMode = !!value;
    console.log("[AdsFriendly Spy] Ad mode changed:", isAdMode);
  }
  function installTimerControl() {
    const originalTimeout = window.setTimeout;
    const originalInterval = window.setInterval;
    window.setTimeout = (handler, timeout, ...args) => originalTimeout(handler, scaled(timeout), ...args);
    window.setInterval = (handler, timeout, ...args) => originalInterval(handler, scaled(timeout), ...args);
  }
  function scaled(timeout) {
    return isAdMode && typeof timeout === "number" && timeout > 50 ? timeout / 100 : timeout;
  }

  // src/main-world/index.js
  console.log("[AdsFriendly Spy] Injected and active.");
  installNetworkCapture();
  installTimerControl();
  onContentMessage((message) => {
    if (message.type === "SET_AD_MODE") setAdMode(message.value);
  });
})();
