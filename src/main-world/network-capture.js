import { analyzeManifest } from "./manifest-analyzer.js";
import { notifyContentScript } from "./bridge.js";
import { createMediaCandidateFromSource } from "../media/detection.js";
import { MEDIA_DETECTION_SOURCES, MEDIA_KINDS } from "../media/contracts.js";
import { parseHlsManifest } from "../media/hls-parser.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { CAPABILITIES } from "../runtime/feature-catalog.js";

export function installNetworkCapture(policy) {
  const stopFetchCapture = installFetchCapture(policy);
  const stopXhrCapture = installXhrCapture(policy);
  return () => {
    stopFetchCapture();
    stopXhrCapture();
  };
}

function installFetchCapture(policy) {
  const originalFetch = window.fetch;
  const fetchWrapper = async function (...args) {
    const url = requestUrl(args[0]);
    const response = await originalFetch.apply(this, args);
    if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return response;
    const finalUrl = response.url || url;
    const mimeType = response.headers.get("content-type");
    const candidate = reportMediaSource(finalUrl, mimeType);
    if (isManifestLike(finalUrl) || candidate?.kind === MEDIA_KINDS.HLS) {
      response
        .clone()
        .text()
        .then((body) => inspectManifest(finalUrl, body, candidate))
        .catch(() => {});
    }
    return response;
  };
  window.fetch = fetchWrapper;
  return () => {
    if (window.fetch === fetchWrapper) window.fetch = originalFetch;
  };
}

function installXhrCapture(policy) {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const openWrapper = function (method, url, ...rest) {
    this.__adsfriendly_url = requestUrl(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  const sendWrapper = function (...args) {
    this.addEventListener("load", () => {
      if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
      const url = this.responseURL || this.__adsfriendly_url || "";
      const candidate = reportMediaSource(
        url,
        this.getResponseHeader("content-type"),
      );
      if (!isManifestLike(url) && candidate?.kind !== MEDIA_KINDS.HLS) return;
      try {
        if (typeof this.responseText === "string")
          inspectManifest(url, this.responseText, candidate);
      } catch {}
    });
    return originalSend.apply(this, args);
  };
  XMLHttpRequest.prototype.open = openWrapper;
  XMLHttpRequest.prototype.send = sendWrapper;
  return () => {
    if (XMLHttpRequest.prototype.open === openWrapper)
      XMLHttpRequest.prototype.open = originalOpen;
    if (XMLHttpRequest.prototype.send === sendWrapper)
      XMLHttpRequest.prototype.send = originalSend;
  };
}

function reportMediaSource(sourceUrl, mimeType) {
  const candidate = createMediaCandidateFromSource({
    pageUrl: location.href,
    sourceUrl,
    mimeType,
    title: document.title || null,
    detectedBy: MEDIA_DETECTION_SOURCES.NETWORK,
  });
  if (!candidate) return null;
  notifyContentScript({
    type: "REGISTERED_EVENT",
    event: createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate),
  });
  return candidate;
}

function inspectManifest(manifestUrl, body, candidate) {
  analyzeManifest(manifestUrl, body);
  let hlsCandidate = candidate;
  if (
    hlsCandidate?.kind !== MEDIA_KINDS.HLS &&
    typeof body === "string" &&
    body
      .replace(/^\uFEFF/, "")
      .trimStart()
      .startsWith("#EXTM3U")
  ) {
    hlsCandidate = reportMediaSource(
      manifestUrl,
      "application/vnd.apple.mpegurl",
    );
  }
  if (hlsCandidate?.kind !== MEDIA_KINDS.HLS) return;
  const probe = parseHlsManifest(manifestUrl, body);
  notifyContentScript({
    type: "REGISTERED_EVENT",
    event: createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: hlsCandidate.id,
      pageUrl: location.href,
      manifestUrl: hlsCandidate.manifestUrl,
      kind: MEDIA_KINDS.HLS,
      ...probe,
    }),
  });
}

function requestUrl(input) {
  if (!input) return "";
  if (typeof input === "string") return input;
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return input.toString();
}

function isManifestLike(url = "") {
  const normalized = url.toLowerCase();
  return (
    normalized.includes(".m3u8") ||
    normalized.includes(".mpd") ||
    normalized.includes("player/v1/player")
  );
}
