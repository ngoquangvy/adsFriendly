import { recordDiscoveredMedia, listDiscoveredMedia } from "./media-catalog.js";
import {
  createMediaCandidateFromSource,
  classifyMediaSource,
} from "../media/detection.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";

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
  const kind = classifyMediaSource(details.url, mimeType);
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
    kind,
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
  const candidate = createMediaCandidateFromSource({
    pageUrl: tab.url,
    sourceUrl: observation.url,
    mimeType: observation.mimeType,
    title: tab.title || null,
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
