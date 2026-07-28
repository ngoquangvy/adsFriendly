import { analyzeManifest } from "./manifest-analyzer.js";
export function installNetworkCapture() {
  installFetchCapture();
  installXhrCapture();
}
function installFetchCapture() {
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = requestUrl(args[0]);
    const response = await originalFetch.apply(this, args);
    if (isManifestLike(url))
      response
        .clone()
        .text()
        .then((body) => analyzeManifest(url, body))
        .catch(() => {});
    return response;
  };
}
function installXhrCapture() {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__adsfriendly_url = requestUrl(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      const url = this.__adsfriendly_url || "";
      if (!isManifestLike(url)) return;
      try {
        if (typeof this.responseText === "string")
          analyzeManifest(url, this.responseText);
      } catch {}
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
  return (
    url.includes(".m3u8") ||
    url.includes(".mpd") ||
    url.includes("player/v1/player")
  );
}
