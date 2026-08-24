import { createMediaCandidateFromSource } from "../media/detection.js";
import { MEDIA_DETECTION_SOURCES } from "../media/contracts.js";
import {
  EVENTS,
  createRegisteredEvent,
  normalizeRegisteredEvent,
} from "../runtime/event-catalog.js";
import { isExtensionContextInvalidated } from "../shared/extension-context.js";

export function startMediaObserver() {
  let stopped = false;
  const reported = new Set();
  const pending = new Set();
  const retryCounts = new Map();
  const retryTimers = new Set();
  const videoListeners = new Map();
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
      messageEvent.source !== window ||
      messageEvent.data?.source !== "adsfriendly-spy" ||
      messageEvent.data?.type !== "REGISTERED_EVENT" ||
      messageEvent.data.event?.type !== EVENTS.MEDIA_DISCOVERED
    )
      return;
    try {
      reportEvent(normalizeRegisteredEvent(messageEvent.data.event));
    } catch {}
  };
  window.addEventListener("message", onMainWorldMessage);

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
    for (const [video, listener] of videoListeners) {
      video.removeEventListener("loadedmetadata", listener);
      video.removeEventListener("durationchange", listener);
      video.removeEventListener("play", listener);
    }
    videoListeners.clear();
    reported.clear();
    pending.clear();
    retryCounts.clear();
    retryTimers.forEach(clearTimeout);
    retryTimers.clear();
  };

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
    listener();
  }

  function reportElementSource(element) {
    const sourceUrl =
      element.currentSrc || element.src || element.getAttribute?.("src");
    const mimeType =
      element.currentType || element.type || element.getAttribute?.("type");
    reportSource(sourceUrl, mimeType, MEDIA_DETECTION_SOURCES.DOM);
  }

  function reportSource(sourceUrl, mimeType, detectedBy) {
    const candidate = createMediaCandidateFromSource({
      pageUrl: location.href,
      sourceUrl,
      mimeType,
      title: document.title || null,
      detectedBy,
    });
    if (!candidate) return;
    reportEvent(createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  }

  function reportEvent(event) {
    if (stopped) return;
    const reportKey = `${event.payload.id}:${event.payload.detectedBy}`;
    if (reported.has(reportKey) || pending.has(reportKey)) return;
    pending.add(reportKey);
    chrome.runtime
      .sendMessage({ type: "MEDIA_DISCOVERED", event })
      .then((response) => {
        pending.delete(reportKey);
        if (response?.status === "recorded") {
          reported.add(reportKey);
          retryCounts.delete(reportKey);
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
