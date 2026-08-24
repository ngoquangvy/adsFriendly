import { normalizeRegisteredEvent } from "../runtime/event-catalog.js";
import { EVENTS } from "../runtime/event-catalog.js";
import {
  MEDIA_DETECTION_SOURCES,
  MEDIA_PROBE_STATES,
  normalizeMediaCandidate,
} from "./contracts.js";
import { isLikelyMediaSegment } from "./detection.js";
import { resolveHlsSources } from "./hls-resolver.js";

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
        requestContexts:
          existing?.requestContexts || candidate.requestContexts || [],
        probeCount: existing?.probeCount || 0,
        lastProbeAt: existing?.lastProbeAt || null,
        lastUsableProbeAt: existing?.lastUsableProbeAt || null,
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
      const acceptProbe =
        !existing || probeQuality(probe) >= probeQuality(existing);
      const acceptedProbe = acceptProbe
        ? probeFieldsFromProbe(probe)
        : probeFields(existing);
      const item = {
        ...base,
        ...acceptedProbe,
        requestContexts: mergeRequestContexts(
          existing?.requestContexts,
          probe.requestContext,
          event.timestamp,
        ),
        probeCount: (existing?.probeCount || 0) + 1,
        lastProbeAt: event.timestamp,
        lastUsableProbeAt: acceptProbe
          ? event.timestamp
          : existing?.lastUsableProbeAt || existing?.lastProbeAt || null,
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
      const resolutions = resolveHlsSources(items);
      return items.map((item) => cloneItem(item, resolutions.get(item.id)));
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
    mediaSequence: item.mediaSequence,
    discontinuitySequence: item.discontinuitySequence,
    revisionId: item.revisionId,
    encryptionMethods: item.encryptionMethods,
  };
}

function probeFieldsFromProbe(probe) {
  return {
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
    mediaSequence: probe.mediaSequence,
    discontinuitySequence: probe.discontinuitySequence,
    revisionId: probe.revisionId,
    encryptionMethods: probe.encryptionMethods,
  };
}

function probeQuality(value) {
  const status = value.probeStatus || value.status;
  if (status !== MEDIA_PROBE_STATES.READY) return 0;
  if (value.playlistType === "unknown") return 1;
  if (value.playlistType === "master") return value.variants?.length ? 4 : 2;
  if (value.playlistType !== "media") return 1;
  if (value.streamType === "vod" && value.segmentCount > 0) return 5;
  if (
    value.streamType === "live" &&
    (value.segmentCount > 0 || value.partialSegmentCount > 0)
  )
    return 4;
  return 2;
}

function mergeRequestContexts(existing = [], incoming, observedAt) {
  const contexts = [...(existing || [])];
  if (incoming) contexts.push({ ...incoming, observedAt });
  const unique = new Map();
  for (const context of contexts) {
    const key = [
      context.requestUrl,
      context.finalUrl,
      context.documentUrl,
      context.transport,
      context.credentials,
    ].join("\n");
    unique.set(key, context);
  }
  return [...unique.values()]
    .sort((left, right) => (right.observedAt || 0) - (left.observedAt || 0))
    .slice(0, 8);
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

function cloneItem(item, resolution = null) {
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
    requestContexts: (item.requestContexts || []).map((context) => ({
      ...context,
    })),
    parentManifestIds: [...(resolution?.parents || [])],
    childManifestIds: [...(resolution?.children || [])],
    resolutionStatus: resolution?.resolutionStatus || null,
    resolvedMediaIds: [...(resolution?.resolvedMediaIds || [])],
    selectedMediaId: resolution?.selectedMediaId || null,
    resolvedStream: resolution?.resolvedStream
      ? {
          ...resolution.resolvedStream,
          resolution: resolution.resolvedStream.resolution
            ? { ...resolution.resolvedStream.resolution }
            : null,
          encryptionMethods: [
            ...(resolution.resolvedStream.encryptionMethods || []),
          ],
        }
      : null,
    resolvedRequestContext: resolution?.resolvedRequestContext
      ? { ...resolution.resolvedRequestContext }
      : null,
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
