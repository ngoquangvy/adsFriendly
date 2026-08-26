import { CAPABILITIES } from "../runtime/feature-catalog.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { parseYouTubePlayerResponse } from "../media/youtube-player-response.js";
import { createMediaCandidateFromSource } from "../media/detection.js";
import { MEDIA_DETECTION_SOURCES } from "../media/contracts.js";
import { isYouTubePage } from "../media/youtube-track-profile.js";
import { notifyContentScript } from "./bridge.js";
import { rememberMediaObservation } from "./media-observation-ledger.js";

const PLAYER_API_PATH = "/youtubei/v1/player";
const PLAYER_SCAN_INTERVAL_MS = 1_500;
const MAXIMUM_FINGERPRINTS = 50;

export function installYouTubePlayerResponseAdapter(policy) {
  if (!isYouTubePage(location.href)) return () => {};
  const fingerprints = new Set();
  const report = (response, input) => {
    if (!policy.can(CAPABILITIES.MEDIA_OBSERVE)) return null;
    const observation = parseYouTubePlayerResponse(response, {
      pageUrl: location.href,
      title: document.title || null,
      input,
      playerUrl: findYouTubePlayerUrl(),
    });
    if (!observation) return null;
    const fingerprint = observationFingerprint(observation);
    if (fingerprints.has(fingerprint)) return observation;
    fingerprints.add(fingerprint);
    while (fingerprints.size > MAXIMUM_FINGERPRINTS)
      fingerprints.delete(fingerprints.values().next().value);
    for (const candidate of observation.candidates) reportCandidate(candidate);
    reportManifest(observation.manifests.hls, "application/vnd.apple.mpegurl");
    reportManifest(observation.manifests.dash, "application/dash+xml");
    return observation;
  };

  const stopFetch = installPlayerFetchCapture(report);
  const stopXhr = installPlayerXhrCapture(report);
  const scan = () => scanPlayerState(report);
  const scanTimer = setInterval(scan, PLAYER_SCAN_INTERVAL_MS);
  const navigationEvents = [
    "yt-navigate-finish",
    "yt-page-data-updated",
    "yt-player-updated",
  ];
  navigationEvents.forEach((eventName) =>
    window.addEventListener(eventName, scan, true),
  );
  queueMicrotask(scan);

  return () => {
    stopFetch();
    stopXhr();
    clearInterval(scanTimer);
    navigationEvents.forEach((eventName) =>
      window.removeEventListener(eventName, scan, true),
    );
    fingerprints.clear();
  };
}

export function scanPlayerState(report) {
  const initialResponse = objectValue(window.ytInitialPlayerResponse);
  if (initialResponse) report(initialResponse, "ytInitialPlayerResponse");

  const configuredResponse = parseJsonObject(
    window.ytplayer?.config?.args?.raw_player_response,
  );
  if (configuredResponse)
    report(configuredResponse, "ytplayer.config.raw_player_response");

  const player = document.querySelector("#movie_player");
  try {
    if (typeof player?.getPlayerResponse === "function")
      report(player.getPlayerResponse(), "movie_player.getPlayerResponse");
  } catch {}
}

export function findYouTubePlayerUrl({
  windowObject = window,
  documentObject = document,
} = {}) {
  const candidates = [];
  try {
    if (typeof windowObject.ytcfg?.get === "function")
      candidates.push(windowObject.ytcfg.get("PLAYER_JS_URL"));
  } catch {}
  candidates.push(
    windowObject.ytplayer?.config?.assets?.js,
    windowObject.ytplayer?.web_player_context_config?.jsUrl,
  );
  try {
    candidates.push(
      ...[...documentObject.querySelectorAll('script[src*="/s/player/"]')].map(
        (script) => script.src,
      ),
    );
  } catch {}
  for (const candidate of candidates) {
    const normalized = normalizePlayerUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function installPlayerFetchCapture(report) {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== "function") return () => {};
  const wrapper = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = response.url || requestUrl(args[0]);
    if (isPlayerApiUrl(url)) {
      response
        .clone()
        .json()
        .then((body) => report(body, "youtubei.fetch"))
        .catch(() => {});
    }
    return response;
  };
  window.fetch = wrapper;
  return () => {
    if (window.fetch === wrapper) window.fetch = originalFetch;
  };
}

function installPlayerXhrCapture(report) {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const openWrapper = function (method, url, ...rest) {
    this.__adsfriendly_youtube_player_url = requestUrl(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  const sendWrapper = function (...args) {
    if (isPlayerApiUrl(this.__adsfriendly_youtube_player_url)) {
      this.addEventListener("load", () => {
        const body = xhrJsonObject(this);
        if (body) report(body, "youtubei.xhr");
      });
    }
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

function reportCandidate(candidate) {
  rememberMediaObservation(candidate);
  notifyContentScript({
    type: "REGISTERED_EVENT",
    event: createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate, {
      playerAdapter: "youtube_player_response",
      observationInput: candidate.acquisitionDiagnostic?.input,
      observationOutput: "media.catalog.adaptive_candidate",
    }),
  });
}

function reportManifest(sourceUrl, mimeType) {
  if (!sourceUrl) return;
  const candidate = createMediaCandidateFromSource({
    pageUrl: location.href,
    sourceUrl,
    mimeType,
    title: document.title || null,
    detectedBy: MEDIA_DETECTION_SOURCES.PLAYER,
  });
  if (candidate) reportCandidate(candidate);
}

function observationFingerprint(observation) {
  const diagnostic = observation.diagnostic;
  const sources = observation.candidates
    .flatMap((candidate) => [
      ...(candidate.variants || []),
      ...(candidate.audioTracks || []),
    ])
    .map((track) => track.sourceUrl)
    .filter(Boolean)
    .sort()
    .join("|");
  return [
    diagnostic.stage,
    diagnostic.descriptorCount,
    diagnostic.directVideoCount,
    diagnostic.directAudioCount,
    diagnostic.signatureCipherCount,
    diagnostic.nTransformCount,
    sources,
  ].join(":");
}

function xhrJsonObject(xhr) {
  if (xhr.responseType === "json") return objectValue(xhr.response);
  if (!xhr.responseType || xhr.responseType === "text")
    return parseJsonObject(xhr.responseText);
  return null;
}

function parseJsonObject(value) {
  if (typeof value !== "string" || value.length > 10_000_000) return null;
  try {
    return objectValue(JSON.parse(value));
  } catch {
    return null;
  }
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function isPlayerApiUrl(value) {
  try {
    const url = new URL(value, "https://www.youtube.com/");
    return isYouTubePage(url.href) && url.pathname === PLAYER_API_PATH;
  } catch {
    return false;
  }
}

function requestUrl(input) {
  if (!input) return "";
  if (typeof input === "string") return input;
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return typeof input?.url === "string" ? input.url : String(input);
}

function normalizePlayerUrl(value) {
  try {
    const url = new URL(value, "https://www.youtube.com/");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !(
        url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")
      ) ||
      !/^\/s\/player\/[^/]+\//.test(url.pathname) ||
      !url.pathname.endsWith(".js")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
