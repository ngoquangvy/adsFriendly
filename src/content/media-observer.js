import { createMediaCandidateFromSource } from "../media/detection.js";
import {
  MEDIA_DETECTION_SOURCES,
  normalizeMediaCandidate,
} from "../media/contracts.js";
import {
  EVENTS,
  createRegisteredEvent,
  normalizeRegisteredEvent,
} from "../runtime/event-catalog.js";
import { isExtensionContextInvalidated } from "../shared/extension-context.js";
import { createYouTubeCandidateFromObservedSource } from "../media/youtube-track-profile.js";

export function startMediaObserver() {
  let stopped = false;
  const reported = new Set();
  const pending = new Set();
  const retryCounts = new Map();
  const retryTimers = new Set();
  const probeTimers = new Set();
  const requestedProbes = new Set();
  const contextualProbeRetries = new Set();
  const videoListeners = new Map();
  const videoVisibilityObserver =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) =>
            entries.forEach((entry) => reportElementSource(entry.target)),
          { threshold: [0, 0.25, 0.6] },
        )
      : null;
  const aesKeyHandoffRequests = new Map();
  const youtubeMediaHandoffRequests = new Map();
  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") scanElement(mutation.target);
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) scanElement(node);
      }
    }
  });
  mutationObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["src", "type"],
    childList: true,
    subtree: true,
  });

  const onMainWorldMessage = (messageEvent) => {
    if (
      messageEvent.source === window &&
      messageEvent.data?.source === "adsfriendly-spy" &&
      messageEvent.data?.type === "YOUTUBE_MEDIA_HANDOFF_RESPONSE"
    ) {
      const pendingRequest = youtubeMediaHandoffRequests.get(
        messageEvent.data.requestId,
      );
      if (!pendingRequest) return;
      youtubeMediaHandoffRequests.delete(messageEvent.data.requestId);
      clearTimeout(pendingRequest.timeoutId);
      pendingRequest.resolve({
        status: "ready",
        handoff: messageEvent.data.handoff || null,
      });
      return;
    }
    if (
      messageEvent.source === window &&
      messageEvent.data?.source === "adsfriendly-spy" &&
      messageEvent.data?.type === "MEDIA_AES_KEY_HANDOFF_RESPONSE"
    ) {
      const pendingRequest = aesKeyHandoffRequests.get(
        messageEvent.data.requestId,
      );
      if (!pendingRequest) return;
      aesKeyHandoffRequests.delete(messageEvent.data.requestId);
      clearTimeout(pendingRequest.timeoutId);
      pendingRequest.resolve({
        status: "ready",
        requestedManifestUrl: messageEvent.data.requestedManifestUrl,
        keys: Array.isArray(messageEvent.data.keys)
          ? messageEvent.data.keys
          : [],
        diagnostic:
          messageEvent.data.diagnostic &&
          typeof messageEvent.data.diagnostic === "object"
            ? messageEvent.data.diagnostic
            : null,
      });
      return;
    }
    if (
      messageEvent.source === window &&
      messageEvent.data?.source === "adsfriendly-spy" &&
      messageEvent.data?.type === "MEDIA_PROBE_CONTEXT_REQUIRED"
    ) {
      retryProbeWithParentContext(messageEvent.data);
      return;
    }
    if (
      messageEvent.source === window &&
      messageEvent.data?.source === "adsfriendly-spy" &&
      messageEvent.data?.type === "MEDIA_DEBUG_MANIFEST_CAPTURE"
    ) {
      chrome.runtime
        .sendMessage({
          type: "SAVE_MEDIA_DEBUG_MANIFEST",
          capture: messageEvent.data.capture,
        })
        .catch(() => {});
      return;
    }
    if (
      messageEvent.source === window &&
      messageEvent.data?.source === "adsfriendly-spy" &&
      messageEvent.data?.type === "MEDIA_DECRYPTED_MANIFEST_READY"
    ) {
      saveDecryptedManifestHandoff(messageEvent.data.handoff);
      return;
    }
    if (
      messageEvent.source !== window ||
      messageEvent.data?.source !== "adsfriendly-spy" ||
      messageEvent.data?.type !== "REGISTERED_EVENT" ||
      ![
        EVENTS.MEDIA_DISCOVERED,
        EVENTS.MEDIA_PROBED,
        EVENTS.MEDIA_PROBE_DIAGNOSTIC,
        EVENTS.MEDIA_BLOB_TRACED,
        EVENTS.MEDIA_EME_OBSERVED,
      ].includes(messageEvent.data.event?.type)
    )
      return;
    try {
      reportEvent(normalizeRegisteredEvent(messageEvent.data.event));
    } catch {}
  };
  window.addEventListener("message", onMainWorldMessage);

  const onBackgroundMessage = (message, _sender, sendResponse) => {
    if (message?.type === "GET_MEDIA_AES_KEY_HANDOFF") {
      requestAesKeyHandoff(
        message.requestedManifestUrl,
        message.manifestUrls,
      ).then(sendResponse);
      return true;
    }
    if (message?.type === "GET_YOUTUBE_MEDIA_HANDOFF") {
      requestYouTubeMediaHandoff().then(sendResponse);
      return true;
    }
    if (message?.type !== "PROBE_OBSERVED_MEDIA") return undefined;
    try {
      scheduleManifestProbe(normalizeMediaCandidate(message.candidate));
    } catch (error) {
      console.debug("[AdsFriendly Media] Invalid observed media", error);
    }
    return undefined;
  };
  chrome.runtime.onMessage.addListener(onBackgroundMessage);

  const performanceObserver = startPerformanceObserver((entry) => {
    reportSource(entry.name, null, MEDIA_DETECTION_SOURCES.NETWORK);
  });

  scanElement(document.documentElement);
  performance
    .getEntriesByType("resource")
    .forEach((entry) => reportSource(entry.name, null, "network"));

  return () => {
    stopped = true;
    mutationObserver.disconnect();
    performanceObserver?.disconnect();
    window.removeEventListener("message", onMainWorldMessage);
    chrome.runtime.onMessage.removeListener(onBackgroundMessage);
    for (const [video, listener] of videoListeners) {
      video.removeEventListener("loadedmetadata", listener);
      video.removeEventListener("durationchange", listener);
      video.removeEventListener("play", listener);
      video.removeEventListener("pause", listener);
      video.removeEventListener("ended", listener);
    }
    videoListeners.clear();
    videoVisibilityObserver?.disconnect();
    reported.clear();
    pending.clear();
    retryCounts.clear();
    retryTimers.forEach(clearTimeout);
    retryTimers.clear();
    probeTimers.forEach(clearTimeout);
    probeTimers.clear();
    requestedProbes.clear();
    contextualProbeRetries.clear();
    for (const pendingRequest of aesKeyHandoffRequests.values()) {
      clearTimeout(pendingRequest.timeoutId);
      pendingRequest.resolve({ status: "stopped", keys: [] });
    }
    aesKeyHandoffRequests.clear();
    for (const pendingRequest of youtubeMediaHandoffRequests.values()) {
      clearTimeout(pendingRequest.timeoutId);
      pendingRequest.resolve({ status: "stopped", handoff: null });
    }
    youtubeMediaHandoffRequests.clear();
  };

  function requestAesKeyHandoff(requestedManifestUrl, manifestUrls) {
    if (
      typeof requestedManifestUrl !== "string" ||
      !/^https?:/i.test(requestedManifestUrl)
    ) {
      return Promise.resolve({ status: "invalid_manifest", keys: [] });
    }
    const requestId =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        aesKeyHandoffRequests.delete(requestId);
        resolve({ status: "timeout", keys: [] });
      }, 5000);
      aesKeyHandoffRequests.set(requestId, { resolve, timeoutId });
      window.postMessage(
        {
          source: "adsfriendly-content",
          type: "GET_MEDIA_AES_KEY_HANDOFF",
          requestId,
          requestedManifestUrl,
          manifestUrls,
        },
        "*",
      );
    });
  }

  function requestYouTubeMediaHandoff() {
    const requestId =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        youtubeMediaHandoffRequests.delete(requestId);
        resolve({ status: "timeout", handoff: null });
      }, 3000);
      youtubeMediaHandoffRequests.set(requestId, { resolve, timeoutId });
      window.postMessage(
        {
          source: "adsfriendly-content",
          type: "GET_YOUTUBE_MEDIA_HANDOFF",
          requestId,
        },
        "*",
      );
    });
  }

  function scanElement(element) {
    if (stopped || !element) return;
    if (element.matches?.("video")) observeVideo(element);
    if (element.matches?.("video, source")) reportElementSource(element);
    element.querySelectorAll?.("video").forEach(observeVideo);
    element
      .querySelectorAll?.("video, video source")
      .forEach(reportElementSource);
  }

  function observeVideo(video) {
    if (videoListeners.has(video)) return;
    const listener = () => {
      reportElementSource(video);
      video.querySelectorAll("source").forEach(reportElementSource);
    };
    videoListeners.set(video, listener);
    video.addEventListener("loadedmetadata", listener);
    video.addEventListener("durationchange", listener);
    video.addEventListener("play", listener);
    video.addEventListener("pause", listener);
    video.addEventListener("ended", listener);
    videoVisibilityObserver?.observe(video);
    listener();
  }

  function reportElementSource(element) {
    const sourceUrl =
      element.currentSrc || element.src || element.getAttribute?.("src");
    const mimeType =
      element.currentType || element.type || element.getAttribute?.("type");
    const duration =
      element.matches?.("video") && Number.isFinite(element.duration)
        ? element.duration
        : null;
    const resolution = element.matches?.("video")
      ? {
          width: Number(element.videoWidth) || null,
          height: Number(element.videoHeight) || null,
        }
      : null;
    const playback = element.matches?.("video")
      ? {
          playing: element.paused === false && element.ended !== true,
          visible: isVisibleVideo(element),
          muted: element.muted === true,
          currentTime: Number.isFinite(element.currentTime)
            ? element.currentTime
            : null,
          observedAt: Date.now(),
        }
      : null;
    reportSource(
      sourceUrl,
      mimeType,
      MEDIA_DETECTION_SOURCES.DOM,
      duration,
      resolution,
      playback,
    );
  }

  function reportSource(
    sourceUrl,
    mimeType,
    detectedBy,
    duration = null,
    resolution = null,
    playback = null,
  ) {
    const candidate =
      createYouTubeCandidateFromObservedSource({
        pageUrl: location.href,
        sourceUrl,
        mimeType,
        title: document.title || null,
      }) ||
      createMediaCandidateFromSource({
        pageUrl: location.href,
        sourceUrl,
        mimeType,
        title: document.title || null,
        duration,
        resolution,
        playback,
        detectedBy,
      });
    if (!candidate) return;
    reportEvent(createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  }

  function isVisibleVideo(video) {
    try {
      const rect = video.getBoundingClientRect();
      const viewportWidth =
        window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight =
        window.innerHeight || document.documentElement.clientHeight;
      const visibleWidth = Math.max(
        0,
        Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0),
      );
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0),
      );
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        visibleWidth * visibleHeight >= rect.width * rect.height * 0.25
      );
    } catch {
      return false;
    }
  }

  function reportEvent(event) {
    if (stopped) return;
    const reportKey = createMediaObserverReportKey(event);
    if (reported.has(reportKey) || pending.has(reportKey)) return;
    pending.add(reportKey);
    chrome.runtime
      .sendMessage({
        type:
          event.type === EVENTS.MEDIA_PROBED
            ? "MEDIA_PROBED"
            : event.type === EVENTS.MEDIA_PROBE_DIAGNOSTIC
              ? "MEDIA_PROBE_DIAGNOSTIC"
              : event.type === EVENTS.MEDIA_BLOB_TRACED
                ? "MEDIA_BLOB_TRACED"
                : event.type === EVENTS.MEDIA_EME_OBSERVED
                  ? "MEDIA_EME_OBSERVED"
                  : "MEDIA_DISCOVERED",
        event,
      })
      .then((response) => {
        pending.delete(reportKey);
        if (response?.status === "recorded") {
          reported.add(reportKey);
          retryCounts.delete(reportKey);
          if (event.type === EVENTS.MEDIA_DISCOVERED)
            scheduleManifestProbe(event.payload);
          return;
        }
        if (
          ["catalog_disabled", "capability_disabled"].includes(response?.status)
        ) {
          const retryCount = retryCounts.get(reportKey) || 0;
          if (retryCount >= 6) return;
          retryCounts.set(reportKey, retryCount + 1);
          const retryId = setTimeout(() => {
            retryTimers.delete(retryId);
            reportEvent(event);
          }, 500);
          retryTimers.add(retryId);
        }
      })
      .catch((error) => {
        pending.delete(reportKey);
        if (!isExtensionContextInvalidated(error))
          console.debug("[AdsFriendly Media] Catalog unavailable", error);
      });
  }

  function scheduleManifestProbe(candidate) {
    if (!["hls", "dash"].includes(candidate.kind) || !candidate.manifestUrl)
      return "invalid";
    if (requestedProbes.has(candidate.id)) {
      reportProbeDiagnostic(candidate, "skipped", "content_duplicate");
      return "duplicate";
    }
    requestedProbes.add(candidate.id);
    reportProbeDiagnostic(candidate, "scheduled", "iframe_probe_scheduled");
    // The browser/player gets the first chance to expose a successful response
    // or child playlist. Re-fetching signed manifests repeatedly can consume a
    // single-use token, so the active fallback is intentionally attempted once.
    for (const delay of [750]) {
      const timerId = setTimeout(() => {
        probeTimers.delete(timerId);
        if (stopped) return;
        window.postMessage(
          {
            source: "adsfriendly-content",
            type: "PROBE_MEDIA_MANIFEST",
            mediaId: candidate.id,
            kind: candidate.kind,
            manifestUrl: candidate.manifestUrl,
          },
          "*",
        );
      }, delay);
      probeTimers.add(timerId);
    }
    return "scheduled";
  }

  function reportProbeDiagnostic(candidate, phase, code) {
    reportEvent(
      createRegisteredEvent(EVENTS.MEDIA_PROBE_DIAGNOSTIC, {
        mediaId: candidate.id,
        pageUrl: location.href,
        manifestUrl: candidate.manifestUrl,
        kind: candidate.kind,
        phase,
        code,
        observedAt: Date.now(),
      }),
    );
  }

  function retryProbeWithParentContext({ mediaId, kind, manifestUrl }) {
    if (
      stopped ||
      !mediaId ||
      !manifestUrl ||
      contextualProbeRetries.has(mediaId) ||
      !document.referrer
    )
      return;
    contextualProbeRetries.add(mediaId);
    chrome.runtime
      .sendMessage({
        type: "PREPARE_MEDIA_CONTEXTUAL_PROBE",
        mediaId,
        manifestUrl,
        parentDocumentUrl: document.referrer,
        frameDocumentUrl: location.href,
      })
      .then((response) => {
        if (stopped) return;
        if (response?.status !== "prepared") {
          reportProbeDiagnostic(
            { id: mediaId, kind, manifestUrl },
            "failed",
            `contextual_probe_${response?.status || "failed"}`,
          );
          return;
        }
        reportProbeDiagnostic(
          { id: mediaId, kind, manifestUrl },
          "dispatched",
          "contextual_probe_prepared",
        );
        window.postMessage(
          {
            source: "adsfriendly-content",
            type: "PROBE_MEDIA_MANIFEST",
            mediaId,
            kind,
            manifestUrl,
            contextualRetry: true,
          },
          "*",
        );
      })
      .catch(() => {});
  }

  function saveDecryptedManifestHandoff(handoff, attempt = 0) {
    if (stopped || !handoff) return;
    chrome.runtime
      .sendMessage({
        type: "SAVE_DECRYPTED_MEDIA_MANIFEST",
        handoff,
      })
      .then((response) => {
        if (response?.status !== "catalog_pending" || attempt >= 4) return;
        const retryId = setTimeout(
          () => {
            retryTimers.delete(retryId);
            saveDecryptedManifestHandoff(handoff, attempt + 1);
          },
          100 * (attempt + 1),
        );
        retryTimers.add(retryId);
      })
      .catch(() => {});
  }
}

export function createMediaObserverReportKey(event) {
  const payload = event?.payload || {};
  const mediaId = payload.id || payload.mediaId || "unknown";
  if (event?.type === EVENTS.MEDIA_DISCOVERED) {
    const playbackKey = payload.playback
      ? `:${payload.playback.playing ? "playing" : "paused"}:${payload.playback.visible ? "visible" : "hidden"}`
      : "";
    if (payload.kind === "adaptive") {
      const videoTracks = (payload.variants || [])
        .map((track) => track.id || track.itag || track.sourceUrl)
        .filter(Boolean)
        .join(",");
      const audioTracks = (payload.audioTracks || [])
        .map((track) => track.id || track.itag || track.sourceUrl)
        .filter(Boolean)
        .join(",");
      const acquisition = payload.acquisitionDiagnostic;
      return `${event.type}:${mediaId}:${payload.detectedBy || "unknown"}:video=${videoTracks || "none"}:audio=${audioTracks || "none"}:stage=${acquisition?.stage || "none"}:direct=${acquisition?.directVideoCount || 0}+${acquisition?.directAudioCount || 0}${playbackKey}`;
    }
    const playbackDuration =
      payload.kind === "blob" && Number.isFinite(payload.duration)
        ? Math.round(payload.duration)
        : "unknown";
    return `${event.type}:${mediaId}:${payload.detectedBy || "unknown"}:${playbackDuration}:${payload.resolution?.width || 0}x${payload.resolution?.height || 0}${playbackKey}`;
  }
  if (event?.type === EVENTS.MEDIA_BLOB_TRACED) {
    return [
      event.type,
      mediaId,
      payload.sourceUrls?.length || 0,
      payload.candidateIds?.join(",") || "none",
      Math.floor((payload.appendCount || 0) / 10),
      payload.observerDocumentState || "unknown",
    ].join(":");
  }
  if (event?.type === EVENTS.MEDIA_EME_OBSERVED) {
    return [
      event.type,
      payload.keySystem || "unknown",
      payload.initDataType || "none",
      payload.licenseStatus || "none",
      ...(payload.keyStatuses || []),
    ].join(":");
  }
  if (event?.type === EVENTS.MEDIA_PROBE_DIAGNOSTIC) {
    return [
      event.type,
      mediaId,
      payload.phase || "unknown",
      payload.code || "unknown",
      payload.httpStatus ?? "none",
      payload.bodyBytes ?? "none",
      payload.playlistType || "none",
      payload.segmentCount ?? "none",
    ].join(":");
  }
  if (event?.type !== EVENTS.MEDIA_PROBED) {
    return `${event?.type || "unknown"}:${mediaId}`;
  }
  const segmentSignal =
    payload.streamType === "live"
      ? Number(payload.segmentCount > 0 || payload.partialSegmentCount > 0)
      : (payload.segmentCount ?? payload.partialSegmentCount ?? "none");
  return [
    event.type,
    mediaId,
    payload.status || "unknown",
    payload.error || "none",
    payload.playlistType || "unknown",
    payload.streamType || "unknown",
    payload.variants?.length || 0,
    segmentSignal,
    payload.drm || "none",
    payload.drmSystem || "none",
    payload.encryptionScheme || "none",
    (payload.encryptionMethods || []).join(","),
  ].join(":");
}

function startPerformanceObserver(onEntry) {
  if (typeof PerformanceObserver === "undefined") return null;
  try {
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach(onEntry);
    });
    observer.observe({ type: "resource", buffered: true });
    return observer;
  } catch {
    return null;
  }
}
