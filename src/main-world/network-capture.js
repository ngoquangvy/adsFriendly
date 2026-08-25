import { analyzeManifest } from "./manifest-analyzer.js";
import { notifyContentScript } from "./bridge.js";
import { createMediaCandidateFromSource } from "../media/detection.js";
import { MEDIA_DETECTION_SOURCES, MEDIA_KINDS } from "../media/contracts.js";
import { parseHlsManifest } from "../media/hls-parser.js";
import { createHlsProbeAttempts } from "../media/hls-probe-adapters.js";
import {
  createMediaProbeGate,
  isUsableMediaProbe,
} from "../media/probe-gate.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { CAPABILITIES } from "../runtime/feature-catalog.js";

export function installNetworkCapture(policy) {
  const originalFetch = window.fetch;
  const probeGate = createMediaProbeGate();
  const resolutionTasks = new Map();
  const inspect = (
    manifestUrl,
    body,
    candidate,
    requestContext = null,
    resolutionAttempt = null,
  ) => {
    const probe = inspectManifest(
      manifestUrl,
      body,
      candidate,
      requestContext,
      resolutionAttempt,
    );
    if (isUsableMediaProbe(probe)) probeGate.remember(manifestUrl, "ready");
    else probeGate.release(manifestUrl);
    return probe;
  };
  const resolveAttempts = (options) => {
    const existing = resolutionTasks.get(options.manifestUrl);
    if (existing) return existing;
    const task = tryHlsProbeAttempts({
      ...options,
      originalFetch,
      probeGate,
      inspect,
    }).finally(() => resolutionTasks.delete(options.manifestUrl));
    resolutionTasks.set(options.manifestUrl, task);
    return task;
  };
  const stopFetchCapture = installFetchCapture(
    policy,
    inspect,
    resolveAttempts,
  );
  const stopXhrCapture = installXhrCapture(policy, inspect, resolveAttempts);
  const stopFallbackProbe = installFallbackProbe({
    policy,
    originalFetch,
    probeGate,
    inspect,
    resolveAttempts,
  });
  return () => {
    stopFetchCapture();
    stopXhrCapture();
    stopFallbackProbe();
    resolutionTasks.clear();
    probeGate.clear();
  };
}

function installFetchCapture(policy, inspect, resolveAttempts) {
  const originalFetch = window.fetch;
  const fetchWrapper = async function (...args) {
    const url = requestUrl(args[0]);
    const response = await originalFetch.apply(this, args);
    if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return response;
    const finalUrl = response.url || url;
    const requestContext = createFetchRequestContext(args, url, finalUrl);
    const mimeType = response.headers.get("content-type");
    const candidate = reportMediaSource(finalUrl, mimeType);
    if (url && finalUrl !== url && candidate?.kind === MEDIA_KINDS.HLS) {
      reportMediaSource(url, mimeType);
    }
    if (isManifestLike(finalUrl) || candidate?.kind === MEDIA_KINDS.HLS) {
      response
        .clone()
        .text()
        .then((body) => {
          const primaryProbe = inspect(
            finalUrl,
            body,
            candidate,
            requestContext,
          );
          if (!isUsableMediaProbe(primaryProbe)) {
            resolveAttempts({
              manifestUrl: finalUrl,
              body,
              candidate,
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }
    return response;
  };
  window.fetch = fetchWrapper;
  return () => {
    if (window.fetch === fetchWrapper) window.fetch = originalFetch;
  };
}

function installXhrCapture(policy, inspect, resolveAttempts) {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const openWrapper = function (method, url, ...rest) {
    this.__adsfriendly_url = requestUrl(url);
    this.__adsfriendly_method = String(method || "GET").toUpperCase();
    return originalOpen.call(this, method, url, ...rest);
  };
  const sendWrapper = function (...args) {
    this.addEventListener("load", () => {
      if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
      const url = this.responseURL || this.__adsfriendly_url || "";
      const requestContext = createXhrRequestContext(this, url);
      const mimeType = this.getResponseHeader("content-type");
      const candidate = reportMediaSource(url, mimeType);
      if (
        this.__adsfriendly_url &&
        url !== this.__adsfriendly_url &&
        candidate?.kind === MEDIA_KINDS.HLS
      ) {
        reportMediaSource(this.__adsfriendly_url, mimeType);
      }
      if (!isManifestLike(url) && candidate?.kind !== MEDIA_KINDS.HLS) return;
      try {
        if (typeof this.responseText === "string") {
          const primaryProbe = inspect(
            url,
            this.responseText,
            candidate,
            requestContext,
          );
          if (!isUsableMediaProbe(primaryProbe)) {
            resolveAttempts({
              manifestUrl: url,
              body: this.responseText,
              candidate,
            }).catch(() => {});
          }
        }
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

function installFallbackProbe({
  policy,
  originalFetch,
  probeGate,
  inspect,
  resolveAttempts,
}) {
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
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`manifest_http_${response.status || "error"}`);
        const finalUrl = response.url || manifestUrl;
        const body = await response.text();
        const finalCandidate =
          finalUrl === manifestUrl
            ? candidate
            : reportMediaSource(
                finalUrl,
                response.headers.get("content-type"),
              ) || candidate;
        const primaryProbe = inspect(
          finalUrl,
          body,
          finalCandidate,
          createFallbackRequestContext(manifestUrl, finalUrl),
        );
        if (isUsableMediaProbe(primaryProbe)) return primaryProbe;

        return (
          (await resolveAttempts({
            manifestUrl: finalUrl,
            body,
            candidate: finalCandidate,
          })) || primaryProbe
        );
      })
      .catch((error) => {
        if (probeGate.state(manifestUrl) !== "pending") return;
        probeGate.release(manifestUrl);
        reportProbeFailure(manifestUrl, candidate, probeErrorCode(error));
      });
  };
  window.addEventListener("message", onProbeRequest);
  return () => {
    stopped = true;
    window.removeEventListener("message", onProbeRequest);
  };
}

export async function tryHlsProbeAttempts({
  manifestUrl,
  body,
  candidate,
  originalFetch,
  probeGate,
  inspect,
}) {
  for (const attempt of createHlsProbeAttempts(manifestUrl, body)) {
    try {
      const response = await originalFetch.call(window, attempt.url, {
        credentials: "same-origin",
        cache: "default",
      });
      if (!response.ok) continue;
      const finalUrl = response.url || attempt.url;
      const alternativeBody = await response.text();
      if (!isUsableMediaProbe(parseHlsManifest(finalUrl, alternativeBody))) {
        continue;
      }
      const alternativeCandidate =
        createMediaCandidateFromSource({
          pageUrl: location.href,
          sourceUrl: finalUrl,
          mimeType: response.headers.get("content-type"),
          title: document.title || null,
          detectedBy: MEDIA_DETECTION_SOURCES.NETWORK,
        }) || candidate;
      const alternativeProbe = inspect(
        finalUrl,
        alternativeBody,
        alternativeCandidate,
        createFallbackRequestContext(manifestUrl, finalUrl),
        attempt,
      );
      // TRAINING_BACKLOG: MEDIA_RESOLUTION_STRATEGY
      // Keep this session evidence structured; it is not a label by itself.
      if (isUsableMediaProbe(alternativeProbe)) {
        probeGate.remember(manifestUrl, "ready");
        return alternativeProbe;
      }
    } catch {}
  }
  return null;
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

function inspectManifest(
  manifestUrl,
  body,
  candidate,
  requestContext = null,
  resolutionAttempt = null,
) {
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
      requestContext,
      resolutionAttempt,
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
  const normalized = String(url || "").toLowerCase();
  return (
    normalized.includes(".m3u8") ||
    normalized.includes(".mpd") ||
    normalized.includes("player/v1/player")
  );
}

function createFetchRequestContext(args, originalUrl, finalUrl) {
  const input = args[0];
  const init =
    args[1] && typeof args[1] === "object" && !Array.isArray(args[1])
      ? args[1]
      : {};
  const request = input && typeof input === "object" ? input : {};
  const credentials = normalizeCredentials(
    init.credentials || request.credentials || "same-origin",
  );
  return requestContext({
    requestUrl: originalUrl,
    finalUrl,
    method: init.method || request.method || "GET",
    credentials,
    referrer: init.referrer || request.referrer || document.referrer,
    transport: "fetch",
  });
}

function createXhrRequestContext(xhr, finalUrl) {
  return requestContext({
    requestUrl: xhr.__adsfriendly_url,
    finalUrl,
    method: xhr.__adsfriendly_method || "GET",
    credentials: xhr.withCredentials ? "include" : "same-origin",
    referrer: document.referrer,
    transport: "xhr",
  });
}

function createFallbackRequestContext(manifestUrl, finalUrl = manifestUrl) {
  return requestContext({
    requestUrl: manifestUrl,
    finalUrl,
    method: "GET",
    credentials: "same-origin",
    referrer: document.referrer,
    transport: "fallback",
  });
}

function requestContext({
  requestUrl: sourceUrl,
  finalUrl,
  method,
  credentials,
  referrer,
  transport,
}) {
  const documentUrl = location.href;
  return {
    requestUrl: String(sourceUrl || ""),
    finalUrl: String(finalUrl || sourceUrl || ""),
    documentUrl,
    referrer: String(referrer || ""),
    method: String(method || "GET").toUpperCase(),
    credentials,
    transport,
    requiresBrowserSession:
      credentials === "include" ||
      (credentials === "same-origin" &&
        sameOrigin(finalUrl || sourceUrl, documentUrl)),
  };
}

function normalizeCredentials(value) {
  return ["omit", "same-origin", "include"].includes(value) ? value : "unknown";
}

function sameOrigin(left, right) {
  try {
    return new URL(left, right).origin === new URL(right).origin;
  } catch {
    return false;
  }
}
