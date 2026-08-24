import { analyzeManifest } from "./manifest-analyzer.js";
import { notifyContentScript } from "./bridge.js";
import { createMediaCandidateFromSource } from "../media/detection.js";
import { MEDIA_DETECTION_SOURCES, MEDIA_KINDS } from "../media/contracts.js";
import { parseHlsManifest } from "../media/hls-parser.js";
import { createMediaProbeGate } from "../media/probe-gate.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { CAPABILITIES } from "../runtime/feature-catalog.js";

export function installNetworkCapture(policy) {
  const originalFetch = window.fetch;
  const probeGate = createMediaProbeGate();
  const inspect = (manifestUrl, body, candidate) => {
    const probe = inspectManifest(manifestUrl, body, candidate);
    if (probe) probeGate.remember(manifestUrl, probe.status);
    return probe;
  };
  const stopFetchCapture = installFetchCapture(policy, inspect);
  const stopXhrCapture = installXhrCapture(policy, inspect);
  const stopFallbackProbe = installFallbackProbe({
    policy,
    originalFetch,
    probeGate,
    inspect,
  });
  return () => {
    stopFetchCapture();
    stopXhrCapture();
    stopFallbackProbe();
    probeGate.clear();
  };
}

function installFetchCapture(policy, inspect) {
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
        .then((body) => inspect(finalUrl, body, candidate))
        .catch(() => {});
    }
    return response;
  };
  window.fetch = fetchWrapper;
  return () => {
    if (window.fetch === fetchWrapper) window.fetch = originalFetch;
  };
}

function installXhrCapture(policy, inspect) {
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
          inspect(url, this.responseText, candidate);
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

function installFallbackProbe({ policy, originalFetch, probeGate, inspect }) {
  let stopped = false;
  const onProbeRequest = (messageEvent) => {
    if (
      stopped ||
      messageEvent.source !== window ||
      messageEvent.data?.source !== "adsfriendly-content" ||
      messageEvent.data?.type !== "PROBE_HLS_MANIFEST" ||
      !policy.can(CAPABILITIES.MEDIA_OBSERVE)
    )
      return;
    const manifestUrl = probeGate.claim(messageEvent.data.manifestUrl);
    if (!manifestUrl) return;
    const candidate = createMediaCandidateFromSource({
      pageUrl: location.href,
      sourceUrl: manifestUrl,
      mimeType: "application/vnd.apple.mpegurl",
      title: document.title || null,
      detectedBy: MEDIA_DETECTION_SOURCES.NETWORK,
    });
    originalFetch
      .call(window, manifestUrl, {
        credentials: "same-origin",
        cache: "default",
      })
      .then((response) => {
        if (!response.ok)
          throw new Error(`manifest_http_${response.status || "error"}`);
        return response.text();
      })
      .then((body) => inspect(manifestUrl, body, candidate))
      .catch((error) => {
        if (probeGate.state(manifestUrl) !== "pending") return;
        probeGate.remember(manifestUrl, "failed");
        reportProbeFailure(manifestUrl, candidate, probeErrorCode(error));
      });
  };
  window.addEventListener("message", onProbeRequest);
  return () => {
    stopped = true;
    window.removeEventListener("message", onProbeRequest);
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
  if (hlsCandidate?.kind !== MEDIA_KINDS.HLS) return null;
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
  return probe;
}

function reportProbeFailure(manifestUrl, candidate, error) {
  if (candidate?.kind !== MEDIA_KINDS.HLS) return;
  notifyContentScript({
    type: "REGISTERED_EVENT",
    event: createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: candidate.id,
      pageUrl: location.href,
      manifestUrl,
      kind: MEDIA_KINDS.HLS,
      status: "failed",
      error,
    }),
  });
}

function probeErrorCode(error) {
  const message = error?.message || "";
  const httpMatch = /manifest_http_\d+/.exec(message);
  return httpMatch?.[0] || "fallback_fetch_blocked";
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
