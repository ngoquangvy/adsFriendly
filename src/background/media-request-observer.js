import { recordDiscoveredMedia, listDiscoveredMedia } from "./media-catalog.js";
import {
  createMediaCandidateFromSource,
  classifyMediaSource,
} from "../media/detection.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { chooseMediaTitle } from "../media/media-title.js";
import {
  createYouTubeAdaptiveCandidate,
  parseYouTubePlaybackTrack,
} from "../media/youtube-track-profile.js";
import { createMediaSizeProbe } from "./media-size-probe.js";

const mediaSizeProbe = createMediaSizeProbe();
const pendingSizeUpdates = new Set();

const OBSERVED_RESOURCE_TYPES = Object.freeze([
  "xmlhttprequest",
  "media",
  "other",
]);

export function startBackgroundMediaRequestObserver() {
  const onHeadersReceived = (details) => {
    const observation = createMediaRequestObservation(details);
    if (!observation) return;
    recordObservation(observation).catch((error) =>
      console.debug("[AdsFriendly Media] Request observation skipped", error),
    );
  };
  chrome.webRequest.onHeadersReceived.addListener(
    onHeadersReceived,
    { urls: ["<all_urls>"], types: [...OBSERVED_RESOURCE_TYPES] },
    ["responseHeaders"],
  );
  return () =>
    chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
}

export function createMediaRequestObservation(details = {}) {
  if (
    !Number.isInteger(details.tabId) ||
    details.tabId < 0 ||
    typeof details.url !== "string" ||
    !/^https?:/i.test(details.url) ||
    Number(details.statusCode) < 200 ||
    Number(details.statusCode) >= 400
  )
    return null;
  const mimeType = responseMimeType(details.responseHeaders);
  const contentLength = responseTotalBytes(details);
  const adaptiveTrack = parseYouTubePlaybackTrack(details.url, {
    mimeType,
    responseHeaders: details.responseHeaders,
  });
  const kind = adaptiveTrack?.type
    ? "adaptive"
    : classifyMediaSource(details.url, mimeType);
  if (!kind) return null;
  return Object.freeze({
    requestId: String(details.requestId || ""),
    tabId: details.tabId,
    frameId: Number.isInteger(details.frameId) ? details.frameId : -1,
    parentFrameId: Number.isInteger(details.parentFrameId)
      ? details.parentFrameId
      : -1,
    initiator: safeHttpOrigin(details.initiator),
    url: details.url,
    mimeType,
    contentLength,
    kind,
    adaptiveTrack,
    method: String(details.method || "GET").toUpperCase(),
    statusCode: Number(details.statusCode),
    fromCache: details.fromCache === true,
    observedAt: Number(details.timeStamp) || Date.now(),
    input: "chrome.webRequest.onHeadersReceived",
    output: "media.catalog.candidate",
  });
}

async function recordObservation(observation) {
  const tab = await chrome.tabs.get(observation.tabId);
  if (!tab?.url?.startsWith("http")) return;
  const frameContext = await resolveFrameContext(observation);
  const title = chooseMediaTitle(null, tab.title, tab.url);
  const candidate = observation.adaptiveTrack
    ? createYouTubeAdaptiveCandidate({
        pageUrl: tab.url,
        title,
        track: observation.adaptiveTrack,
      })
    : createMediaCandidateFromSource({
        pageUrl: tab.url,
        sourceUrl: observation.url,
        mimeType: observation.mimeType,
        contentLength:
          observation.kind === "direct" ? observation.contentLength : null,
        title,
        detectedBy: "network",
      });
  if (!candidate) return;
  candidate.requestContexts = [
    {
      requestUrl: observation.url,
      finalUrl: observation.url,
      documentUrl: frameContext.frameUrl,
      parentDocumentUrl: tab.url,
      referrer: frameContext.frameUrl,
      method: observation.method,
      credentials: "unknown",
      transport: "web_request",
      requiresBrowserSession: true,
      observedAt: observation.observedAt,
    },
  ];
  const result = await recordDiscoveredMedia(
    observation.tabId,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate, {
      frameId: frameContext.frameId,
      frameUrl: frameContext.frameUrl,
      observationInput: observation.input,
      observationOutput: observation.output,
    }),
  );
  if (
    result?.status === "recorded" &&
    candidate.kind === "direct" &&
    !result.item?.contentLength
  ) {
    probeMissingMediaSize({
      tabId: observation.tabId,
      candidate,
      frameId: frameContext.frameId,
      frameUrl: frameContext.frameUrl,
    });
  }
  if (
    result?.status !== "recorded" ||
    !["hls", "dash"].includes(candidate.kind) ||
    frameContext.frameId < 0
  )
    return;
  await chrome.tabs
    .sendMessage(
      observation.tabId,
      { type: "PROBE_OBSERVED_MEDIA", candidate },
      { frameId: frameContext.frameId },
    )
    .catch(() => {});
}

function probeMissingMediaSize({ tabId, candidate, frameId, frameUrl }) {
  const scopeKey = mediaProbeScope(tabId, candidate.pageUrl);
  const updateKey = `${scopeKey}:${candidate.id}`;
  if (pendingSizeUpdates.has(updateKey)) return;
  pendingSizeUpdates.add(updateKey);
  mediaSizeProbe
    .probe(candidate.sourceUrl, {
      scopeKey,
    })
    .then(async (probe) => {
      if (probe.status !== "resolved" || !probe.contentLength) return;
      if (!(await isCurrentTabPage(tabId, candidate.pageUrl))) return;
      await recordDiscoveredMedia(
        tabId,
        createRegisteredEvent(
          EVENTS.MEDIA_DISCOVERED,
          { ...candidate, contentLength: probe.contentLength },
          {
            frameId,
            frameUrl,
            observationInput: "media.size_probe.headers",
            observationOutput: "media.catalog.content_length",
          },
        ),
      );
    })
    .catch(() => {})
    .finally(() => pendingSizeUpdates.delete(updateKey));
}

function mediaProbeScope(tabId, pageUrl) {
  try {
    const url = new URL(pageUrl);
    // This key exists only in memory, so separate SPA media pages without
    // persisting search text or page query parameters into diagnostics.
    return `${tabId}:${url.href}`;
  } catch {
    return String(tabId);
  }
}

async function isCurrentTabPage(tabId, pageUrl) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const current = new URL(tab.url);
    const observed = new URL(pageUrl);
    current.hash = "";
    observed.hash = "";
    return current.href === observed.href;
  } catch {
    return false;
  }
}

async function resolveFrameContext(observation) {
  if (observation.frameId >= 0) {
    return {
      frameId: observation.frameId,
      frameUrl: observation.initiator,
    };
  }
  const snapshot = await listDiscoveredMedia(observation.tabId);
  const matches = snapshot.items.filter(
    (item) =>
      Number.isInteger(item.frameId) &&
      sameOrigin(item.frameUrl, observation.initiator),
  );
  const frameIds = [...new Set(matches.map((item) => item.frameId))];
  return frameIds.length === 1
    ? { frameId: frameIds[0], frameUrl: matches[0].frameUrl }
    : { frameId: -1, frameUrl: observation.initiator };
}

function responseMimeType(headers = []) {
  const header = headers.find(
    (item) => String(item?.name || "").toLowerCase() === "content-type",
  );
  return typeof header?.value === "string" ? header.value : null;
}

function responseTotalBytes(details = {}) {
  const headers = Array.isArray(details.responseHeaders)
    ? details.responseHeaders
    : [];
  const headerValue = (name) =>
    headers.find((item) => String(item?.name || "").toLowerCase() === name)
      ?.value;
  const status = Number(details.statusCode);
  const contentEncoding = String(headerValue("content-encoding") || "")
    .trim()
    .toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") return null;

  // For a partial response, Content-Length is only the current range. The
  // denominator in Content-Range is the total representation size.
  if (status === 206) {
    const total = String(headerValue("content-range") || "").match(
      /^\s*bytes\s+\d+-\d+\/(\d+)\s*$/i,
    )?.[1];
    return positiveSafeInteger(total);
  }

  if (status < 200 || status >= 300) return null;
  return positiveSafeInteger(headerValue("content-length"));
}

function positiveSafeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function safeHttpOrigin(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}
