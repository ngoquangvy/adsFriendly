import { analyzeManifest } from "./manifest-analyzer.js";
import { notifyContentScript } from "./bridge.js";
import { createMediaCandidateFromSource } from "../media/detection.js";
import { MEDIA_DETECTION_SOURCES, MEDIA_KINDS } from "../media/contracts.js";
import { parseHlsManifest } from "../media/hls-parser.js";
import { parseDashManifest } from "../media/dash-parser.js";
import { createHlsProbeAttempts } from "../media/hls-probe-adapters.js";
import {
  createMediaProbeGate,
  isUsableMediaProbe,
} from "../media/probe-gate.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { CAPABILITIES } from "../runtime/feature-catalog.js";
import { createRequestContextRegistry } from "./request-context-registry.js";
import {
  clearMediaObservations,
  rememberMediaObservation,
} from "./media-observation-ledger.js";

export function installNetworkCapture(policy) {
  const originalFetch = window.fetch;
  const probeGate = createMediaProbeGate();
  const requestContexts = createRequestContextRegistry();
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
      requestContexts,
    }).finally(() => resolutionTasks.delete(options.manifestUrl));
    resolutionTasks.set(options.manifestUrl, task);
    return task;
  };
  const stopFetchCapture = installFetchCapture(
    policy,
    inspect,
    resolveAttempts,
    requestContexts,
  );
  const stopXhrCapture = installXhrCapture(
    policy,
    inspect,
    resolveAttempts,
    requestContexts,
  );
  const stopFallbackProbe = installFallbackProbe({
    policy,
    originalFetch,
    probeGate,
    inspect,
    resolveAttempts,
    requestContexts,
  });
  return () => {
    stopFetchCapture();
    stopXhrCapture();
    stopFallbackProbe();
    resolutionTasks.clear();
    probeGate.clear();
    requestContexts.clear();
    clearMediaObservations();
  };
}

function installFetchCapture(
  policy,
  inspect,
  resolveAttempts,
  requestContexts,
) {
  const originalFetch = window.fetch;
  const fetchWrapper = async function (...args) {
    const url = requestUrl(args[0]);
    if (isManifestLike(url)) {
      requestContexts.remember(createFetchRequestContext(args, url, url));
    }
    const response = await originalFetch.apply(this, args);
    if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return response;
    const finalUrl = response.url || url;
    const requestContext = createFetchRequestContext(args, url, finalUrl);
    requestContexts.remember(requestContext);
    const mimeType = response.headers.get("content-type");
    const candidate = reportMediaSource(finalUrl, mimeType);
    if (
      url &&
      finalUrl !== url &&
      [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(candidate?.kind)
    ) {
      reportMediaSource(url, mimeType);
    }
    if (
      isManifestLike(finalUrl) ||
      [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(candidate?.kind)
    ) {
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
          if (
            primaryProbe?.kind === MEDIA_KINDS.HLS &&
            !isUsableMediaProbe(primaryProbe)
          ) {
            resolveAttempts({
              manifestUrl: finalUrl,
              body,
              candidate,
              requestContext,
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

function installXhrCapture(policy, inspect, resolveAttempts, requestContexts) {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const openWrapper = function (method, url, ...rest) {
    this.__adsfriendly_url = requestUrl(url);
    this.__adsfriendly_method = String(method || "GET").toUpperCase();
    return originalOpen.call(this, method, url, ...rest);
  };
  const sendWrapper = function (...args) {
    if (isManifestLike(this.__adsfriendly_url)) {
      requestContexts.remember(
        createXhrRequestContext(this, this.__adsfriendly_url || ""),
      );
    }
    this.addEventListener("load", () => {
      if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
      const url = this.responseURL || this.__adsfriendly_url || "";
      const requestContext = createXhrRequestContext(this, url);
      requestContexts.remember(requestContext);
      const mimeType = this.getResponseHeader("content-type");
      const candidate = reportMediaSource(url, mimeType);
      if (
        this.__adsfriendly_url &&
        url !== this.__adsfriendly_url &&
        [MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(candidate?.kind)
      ) {
        reportMediaSource(this.__adsfriendly_url, mimeType);
      }
      if (
        !isManifestLike(url) &&
        ![MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(candidate?.kind)
      )
        return;
      readXhrResponseBody(this)
        .then((body) => {
          if (typeof body !== "string") return;
          const primaryProbe = inspect(url, body, candidate, requestContext);
          if (
            primaryProbe?.kind === MEDIA_KINDS.HLS &&
            !isUsableMediaProbe(primaryProbe)
          ) {
            resolveAttempts({
              manifestUrl: url,
              body,
              candidate,
              requestContext,
            }).catch(() => {});
          }
        })
        .catch(() => {});
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

export async function readXhrResponseBody(xhr) {
  const responseType = String(xhr?.responseType || "").toLowerCase();
  if (!responseType || responseType === "text") {
    return typeof xhr?.responseText === "string" ? xhr.responseText : null;
  }
  if (responseType === "arraybuffer" && xhr?.response instanceof ArrayBuffer) {
    return new TextDecoder().decode(xhr.response);
  }
  if (responseType === "blob" && xhr?.response instanceof Blob) {
    return xhr.response.text();
  }
  return null;
}

function installFallbackProbe({
  policy,
  originalFetch,
  probeGate,
  inspect,
  resolveAttempts,
  requestContexts,
}) {
  let stopped = false;
  const onProbeRequest = (messageEvent) => {
    if (
      stopped ||
      messageEvent.source !== window ||
      messageEvent.data?.source !== "adsfriendly-content" ||
      !["PROBE_HLS_MANIFEST", "PROBE_MEDIA_MANIFEST"].includes(
        messageEvent.data?.type,
      ) ||
      !policy.can(CAPABILITIES.MEDIA_OBSERVE)
    )
      return;
    const manifestUrl = probeGate.claim(messageEvent.data.manifestUrl);
    if (!manifestUrl) return;
    const requestedKind =
      messageEvent.data.kind === MEDIA_KINDS.DASH
        ? MEDIA_KINDS.DASH
        : MEDIA_KINDS.HLS;
    const candidate = createMediaCandidateFromSource({
      pageUrl: location.href,
      sourceUrl: manifestUrl,
      mimeType:
        requestedKind === MEDIA_KINDS.DASH
          ? "application/dash+xml"
          : "application/vnd.apple.mpegurl",
      title: document.title || null,
      detectedBy: MEDIA_DETECTION_SOURCES.NETWORK,
    });
    const observedRequestContext = requestContexts.find(manifestUrl);
    originalFetch
      .call(
        window,
        manifestUrl,
        createContextualProbeInit(observedRequestContext),
      )
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
          createFallbackRequestContext(
            manifestUrl,
            finalUrl,
            observedRequestContext,
          ),
        );
        if (
          requestedKind === MEDIA_KINDS.DASH ||
          isUsableMediaProbe(primaryProbe)
        )
          return primaryProbe;

        return (
          (await resolveAttempts({
            manifestUrl: finalUrl,
            body,
            candidate: finalCandidate,
            requestContext: observedRequestContext,
          })) || primaryProbe
        );
      })
      .catch((error) => {
        if (probeGate.state(manifestUrl) !== "pending") return;
        probeGate.release(manifestUrl);
        const errorCode = probeErrorCode(error);
        reportProbeFailure(manifestUrl, candidate, errorCode);
        if (
          errorCode === "manifest_http_403" &&
          messageEvent.data.contextualRetry !== true
        ) {
          notifyContentScript({
            type: "MEDIA_PROBE_CONTEXT_REQUIRED",
            mediaId: candidate.id,
            kind: candidate.kind,
            manifestUrl,
          });
        }
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
  requestContext = null,
}) {
  for (const attempt of createHlsProbeAttempts(manifestUrl, body)) {
    try {
      const response = await originalFetch.call(
        window,
        attempt.url,
        createContextualProbeInit(requestContext),
      );
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
        createFallbackRequestContext(manifestUrl, finalUrl, requestContext),
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
  rememberMediaObservation(candidate);
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
  let manifestCandidate = candidate;
  if (
    ![MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(manifestCandidate?.kind) &&
    typeof body === "string" &&
    body
      .replace(/^\uFEFF/, "")
      .trimStart()
      .startsWith("#EXTM3U")
  ) {
    manifestCandidate = reportMediaSource(
      manifestUrl,
      "application/vnd.apple.mpegurl",
    );
  }
  if (
    manifestCandidate?.kind !== MEDIA_KINDS.DASH &&
    typeof body === "string" &&
    /^\s*(?:<\?xml[^>]*>\s*)?<MPD\b/i.test(body.replace(/^\uFEFF/, ""))
  ) {
    manifestCandidate = reportMediaSource(manifestUrl, "application/dash+xml");
  }
  if (![MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(manifestCandidate?.kind))
    return null;
  const parsedProbe =
    manifestCandidate.kind === MEDIA_KINDS.DASH
      ? parseDashManifest(manifestUrl, body)
      : parseHlsManifest(manifestUrl, body);
  const probe = { kind: manifestCandidate.kind, ...parsedProbe };
  notifyContentScript({
    type: "REGISTERED_EVENT",
    event: createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: manifestCandidate.id,
      pageUrl: location.href,
      manifestUrl: manifestCandidate.manifestUrl,
      kind: manifestCandidate.kind,
      ...probe,
      requestContext,
      resolutionAttempt,
    }),
  });
  return probe;
}

function reportProbeFailure(manifestUrl, candidate, error) {
  if (![MEDIA_KINDS.HLS, MEDIA_KINDS.DASH].includes(candidate?.kind)) return;
  notifyContentScript({
    type: "REGISTERED_EVENT",
    event: createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: candidate.id,
      pageUrl: location.href,
      manifestUrl,
      kind: candidate.kind,
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
    referrer: init.referrer || request.referrer || location.href,
    transport: "fetch",
  });
}

function createXhrRequestContext(xhr, finalUrl) {
  return requestContext({
    requestUrl: xhr.__adsfriendly_url,
    finalUrl,
    method: xhr.__adsfriendly_method || "GET",
    credentials: xhr.withCredentials ? "include" : "same-origin",
    referrer: location.href,
    transport: "xhr",
  });
}

function createFallbackRequestContext(
  manifestUrl,
  finalUrl = manifestUrl,
  observedContext = null,
) {
  return requestContext({
    requestUrl: manifestUrl,
    finalUrl,
    method: "GET",
    credentials: observedContext?.credentials || "same-origin",
    referrer:
      observedContext?.referrer ||
      observedContext?.documentUrl ||
      location.href,
    transport: "fallback",
  });
}

export function createContextualProbeInit(
  observedContext,
  currentDocumentUrl = globalThis.location?.href || "",
) {
  const credentials = ["omit", "same-origin", "include"].includes(
    observedContext?.credentials,
  )
    ? observedContext.credentials
    : "same-origin";
  const init = { credentials, cache: "default" };
  const referrer = [
    observedContext?.referrer,
    observedContext?.documentUrl,
    currentDocumentUrl,
  ].find((value) => sameOrigin(value, currentDocumentUrl));
  if (referrer) init.referrer = referrer;
  return init;
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
    parentDocumentUrl: String(document.referrer || ""),
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
