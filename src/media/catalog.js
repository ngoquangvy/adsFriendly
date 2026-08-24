import { normalizeRegisteredEvent } from "../runtime/event-catalog.js";
import { EVENTS } from "../runtime/event-catalog.js";
import {
  MEDIA_DETECTION_SOURCES,
  MEDIA_PROBE_STATES,
  normalizeMediaCandidate,
} from "./contracts.js";
import { isLikelyMediaSegment } from "./detection.js";

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
      if (
        candidate.kind === "direct" &&
        isLikelyMediaSegment(candidate.sourceUrl, candidate.mimeType)
      )
        return null;
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
      const preserveExistingProbe =
        existing &&
        existing.probeStatus !== MEDIA_PROBE_STATES.DISCOVERED &&
        candidate.probeStatus === MEDIA_PROBE_STATES.DISCOVERED;
      const item = {
        ...(existing || {}),
        ...candidate,
        ...(preserveExistingProbe ? probeFields(existing) : {}),
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
    applyProbe(tabId, rawEvent) {
      assertTabId(tabId);
      const event = normalizeRegisteredEvent(rawEvent);
      if (event.type !== EVENTS.MEDIA_PROBED) {
        throw new Error(
          `[MediaCatalog] Cannot apply probe event "${event.type}".`,
        );
      }
      const probe = event.payload;
      let tabCatalog = tabs.get(tabId);
      if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, probe.pageUrl)) {
        tabs.delete(tabId);
        tabCatalog = null;
      }
      if (!tabCatalog) {
        tabCatalog = { pageUrl: probe.pageUrl, items: new Map() };
        tabs.set(tabId, tabCatalog);
      }

      const existing = tabCatalog.items.get(probe.mediaId);
      const base =
        existing ||
        normalizeMediaCandidate({
          id: probe.mediaId,
          pageUrl: probe.pageUrl,
          manifestUrl: probe.manifestUrl,
          kind: probe.kind,
          detectedBy: MEDIA_DETECTION_SOURCES.NETWORK,
        });
      const item = {
        ...base,
        variants: probe.variants,
        iframeVariants: probe.iframeVariants,
        audioTracks: probe.audioTracks,
        subtitles: probe.subtitles,
        drm: probe.drm,
        probeStatus: probe.status,
        probeError: probe.error,
        playlistType: probe.playlistType,
        streamType: probe.streamType,
        duration: probe.duration,
        targetDuration: probe.targetDuration,
        segmentCount: probe.segmentCount,
        partialSegmentCount: probe.partialSegmentCount,
        skippedSegmentCount: probe.skippedSegmentCount,
        lowLatency: probe.lowLatency,
        encryptionMethods: probe.encryptionMethods,
        detectionSources: uniqueStrings([
          ...(existing?.detectionSources || []),
          MEDIA_DETECTION_SOURCES.NETWORK,
        ]),
        firstSeenAt: existing?.firstSeenAt || event.timestamp,
        lastSeenAt: event.timestamp,
      };
      tabCatalog.items.set(probe.mediaId, item);
      trimOldest(tabCatalog.items, maximumPerTab);
      return cloneItem(item);
    },
    list(tabId, pageUrl = null) {
      assertTabId(tabId);
      const tabCatalog = tabs.get(tabId);
      if (!tabCatalog || (pageUrl && !samePageUrl(tabCatalog.pageUrl, pageUrl)))
        return [];
      const items = [...tabCatalog.items.values()].sort(
        (left, right) => right.lastSeenAt - left.lastSeenAt,
      );
      const relationships = linkManifestItems(items);
      return items.map((item) => cloneItem(item, relationships.get(item.id)));
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

function probeFields(item) {
  return {
    variants: item.variants,
    iframeVariants: item.iframeVariants,
    audioTracks: item.audioTracks,
    subtitles: item.subtitles,
    drm: item.drm,
    probeStatus: item.probeStatus,
    probeError: item.probeError,
    playlistType: item.playlistType,
    streamType: item.streamType,
    duration: item.duration,
    targetDuration: item.targetDuration,
    segmentCount: item.segmentCount,
    partialSegmentCount: item.partialSegmentCount,
    skippedSegmentCount: item.skippedSegmentCount,
    lowLatency: item.lowLatency,
    encryptionMethods: item.encryptionMethods,
  };
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

function cloneItem(item, relationships = null) {
  return {
    ...item,
    variants: item.variants.map((variant) => ({
      ...variant,
      resolution: variant.resolution ? { ...variant.resolution } : null,
    })),
    iframeVariants: item.iframeVariants.map((variant) => ({
      ...variant,
      resolution: variant.resolution ? { ...variant.resolution } : null,
    })),
    audioTracks: item.audioTracks.map((track) => ({ ...track })),
    subtitles: item.subtitles.map((track) => ({ ...track })),
    detectionSources: [...item.detectionSources],
    encryptionMethods: [...(item.encryptionMethods || [])],
    parentManifestIds: [...(relationships?.parents || [])],
    childManifestIds: [...(relationships?.children || [])],
  };
}

function linkManifestItems(items) {
  const relationships = new Map(
    items.map((item) => [item.id, { parents: new Set(), children: new Set() }]),
  );
  const byManifestUrl = new Map(
    items
      .filter((item) => item.kind === "hls" && item.manifestUrl)
      .map((item) => [item.manifestUrl, item]),
  );
  for (const parent of items) {
    if (parent.kind !== "hls" || parent.playlistType !== "master") continue;
    const childUrls = [
      ...(parent.variants || []).map((variant) => variant.url),
      ...(parent.audioTracks || []).map((track) => track.url),
      ...(parent.subtitles || []).map((track) => track.url),
    ].filter(Boolean);
    for (const childUrl of childUrls) {
      const child = byManifestUrl.get(childUrl);
      if (!child || child.id === parent.id) continue;
      relationships.get(parent.id).children.add(child.id);
      relationships.get(child.id).parents.add(parent.id);
    }
  }
  return relationships;
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
