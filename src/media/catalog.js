import { normalizeRegisteredEvent } from "../runtime/event-catalog.js";
import { EVENTS } from "../runtime/event-catalog.js";

export function createMediaCatalog({ maximumPerTab = 50 } = {}) {
  const tabs = new Map();

  return Object.freeze({
    add(tabId, rawEvent) {
      assertTabId(tabId);
      const event = normalizeRegisteredEvent(rawEvent);
      if (event.type !== EVENTS.MEDIA_DISCOVERED) {
        throw new Error(`[MediaCatalog] Cannot add event "${event.type}".`);
      }
      const candidate = event.payload;
      let tabCatalog = tabs.get(tabId);
      if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, candidate.pageUrl)) {
        tabs.delete(tabId);
        tabCatalog = null;
      }
      if (!tabCatalog) {
        tabCatalog = { pageUrl: candidate.pageUrl, items: new Map() };
        tabs.set(tabId, tabCatalog);
      }

      const now = event.timestamp;
      const existing = tabCatalog.items.get(candidate.id);
      const item = {
        ...(existing || {}),
        ...candidate,
        detectionSources: uniqueStrings([
          ...(existing?.detectionSources || []),
          candidate.detectedBy,
        ]),
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
      };
      tabCatalog.items.set(candidate.id, item);
      trimOldest(tabCatalog.items, maximumPerTab);
      return cloneItem(item);
    },
    list(tabId, pageUrl = null) {
      assertTabId(tabId);
      const tabCatalog = tabs.get(tabId);
      if (!tabCatalog || (pageUrl && !samePageUrl(tabCatalog.pageUrl, pageUrl)))
        return [];
      return [...tabCatalog.items.values()]
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
        .map(cloneItem);
    },
    clear(tabId) {
      assertTabId(tabId);
      tabs.delete(tabId);
    },
    clearAll() {
      tabs.clear();
    },
  });
}

function trimOldest(items, maximum) {
  while (items.size > maximum) {
    let oldestId = null;
    let oldestTimestamp = Infinity;
    for (const [id, item] of items) {
      if (item.lastSeenAt < oldestTimestamp) {
        oldestId = id;
        oldestTimestamp = item.lastSeenAt;
      }
    }
    if (!oldestId) return;
    items.delete(oldestId);
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function cloneItem(item) {
  return {
    ...item,
    variants: item.variants.map((variant) => ({ ...variant })),
    audioTracks: item.audioTracks.map((track) => ({ ...track })),
    subtitles: item.subtitles.map((track) => ({ ...track })),
    detectionSources: [...item.detectionSources],
  };
}

function assertTabId(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("[MediaCatalog] A valid tab ID is required.");
  }
}

function samePageUrl(left, right) {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    leftUrl.hash = "";
    rightUrl.hash = "";
    return leftUrl.href === rightUrl.href;
  } catch {
    return left === right;
  }
}
