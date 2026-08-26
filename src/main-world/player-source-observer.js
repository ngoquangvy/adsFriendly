import { notifyContentScript } from "./bridge.js";
import { rememberMediaObservation } from "./media-observation-ledger.js";
import { createMediaCandidateFromSource } from "../media/detection.js";
import { MEDIA_DETECTION_SOURCES } from "../media/contracts.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { CAPABILITIES } from "../runtime/feature-catalog.js";

const SCAN_DELAYS_MS = Object.freeze([0, 300, 1_000, 3_000, 8_000, 15_000]);
const JW_EVENTS = Object.freeze([
  "ready",
  "playlist",
  "playlistItem",
  "levels",
  "levelsChanged",
  "firstFrame",
  "play",
]);

export function installPlayerSourceObserver(policy) {
  const timers = new Set();
  const observedPlayers = new WeakSet();
  const cleanups = [];
  let stopped = false;
  let mutationTimer = null;
  const stopFactoryWatch = watchJwPlayerFactory(() => scheduleScan(0));

  for (const delay of SCAN_DELAYS_MS) {
    scheduleScan(delay);
  }
  const mutationObserver =
    typeof MutationObserver === "function"
      ? new MutationObserver((mutations) => {
          if (!mutations.some(containsPossiblePlayer)) return;
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes || []) {
              if (node?.nodeType !== 1 || !node.matches?.("script")) continue;
              const onLoad = () => scheduleScan(0);
              node.addEventListener("load", onLoad, { once: true });
              cleanups.push(() => node.removeEventListener("load", onLoad));
            }
          }
          clearTimeout(mutationTimer);
          mutationTimer = setTimeout(scan, 100);
        })
      : null;
  mutationObserver?.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
    timers.clear();
    clearTimeout(mutationTimer);
    mutationObserver?.disconnect();
    stopFactoryWatch();
    for (const cleanup of cleanups.reverse()) cleanup();
  };

  function scheduleScan(delay) {
    if (stopped) return;
    const timerId = setTimeout(() => {
      timers.delete(timerId);
      scan();
    }, delay);
    timers.add(timerId);
  }

  function scan() {
    if (stopped || !policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
    const factory = globalThis.jwplayer;
    if (typeof factory !== "function") return;
    const players = [];
    addPlayer(players, () => factory());
    document
      .querySelectorAll?.(".jwplayer[id], [data-jwplayer-id][id]")
      .forEach((element) => addPlayer(players, () => factory(element.id)));
    for (const player of players) observePlayer(player);
  }

  function observePlayer(player) {
    reportPlayer(player);
    if (observedPlayers.has(player)) return;
    observedPlayers.add(player);
    if (typeof player.on !== "function") return;
    for (const eventName of JW_EVENTS) {
      const listener = () => reportPlayer(player);
      try {
        player.on(eventName, listener);
        cleanups.push(() => {
          try {
            player.off?.(eventName, listener);
          } catch {}
        });
      } catch {}
    }
  }

  function reportPlayer(player) {
    if (stopped || !policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
    for (const source of extractJwPlayerSources(player)) {
      const candidate = createMediaCandidateFromSource({
        pageUrl: location.href,
        sourceUrl: source.url,
        mimeType: source.mimeType,
        title: source.title || document.title || null,
        detectedBy: MEDIA_DETECTION_SOURCES.PLAYER,
      });
      if (!candidate) continue;
      rememberMediaObservation(candidate);
      notifyContentScript({
        type: "REGISTERED_EVENT",
        event: createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate, {
          playerAdapter: "jwplayer",
        }),
      });
    }
  }
}

export function extractJwPlayerSources(player) {
  if (!player || typeof player !== "object") return [];
  const items = [];
  try {
    const current = player.getPlaylistItem?.();
    if (current) items.push(current);
  } catch {}
  try {
    const playlist = player.getPlaylist?.();
    if (Array.isArray(playlist)) items.push(...playlist);
  } catch {}

  const sources = [];
  for (const item of items) {
    const title = safeString(item?.title);
    addSource(sources, item?.file, item?.type, title, item?.label);
    for (const source of Array.isArray(item?.sources) ? item.sources : []) {
      addSource(
        sources,
        source?.file || source?.src,
        source?.type,
        title,
        source?.label,
      );
    }
  }
  return [
    ...new Map(sources.map((source) => [source.url, source])).values(),
  ];
}

function addPlayer(players, readPlayer) {
  try {
    const player = readPlayer();
    if (player && typeof player === "object" && !players.includes(player)) {
      players.push(player);
    }
  } catch {}
}

function addSource(sources, value, mimeType, title, label) {
  if (typeof value !== "string" || !value.trim()) return;
  try {
    const url = new URL(value, location.href);
    if (!["http:", "https:"].includes(url.protocol)) return;
    sources.push({
      url: url.href,
      mimeType: safeString(mimeType),
      title,
      label: safeString(label),
    });
  } catch {}
}

function safeString(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 200)
    : null;
}

function containsPossiblePlayer(mutation) {
  return [...(mutation.addedNodes || [])].some(
    (node) =>
      node?.nodeType === 1 &&
      (node.matches?.("script, .jwplayer, [data-jwplayer-id]") ||
        node.querySelector?.(".jwplayer, [data-jwplayer-id]")),
  );
}

function watchJwPlayerFactory(onAvailable) {
  const target = globalThis;
  const existing = Object.getOwnPropertyDescriptor(target, "jwplayer");
  if (existing || !Object.isExtensible(target)) return () => {};
  let active = true;
  const getter = () => undefined;
  const setter = (value) => {
    active = false;
    Object.defineProperty(target, "jwplayer", {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
    if (typeof value === "function") onAvailable();
  };
  try {
    Object.defineProperty(target, "jwplayer", {
      configurable: true,
      enumerable: true,
      get: getter,
      set: setter,
    });
  } catch {
    return () => {};
  }
  return () => {
    if (!active) return;
    const current = Object.getOwnPropertyDescriptor(target, "jwplayer");
    if (current?.get === getter && current?.set === setter) {
      delete target.jwplayer;
    }
  };
}
