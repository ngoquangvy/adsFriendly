import { normalizeRegisteredEvent } from "../runtime/event-catalog.js";
import { EVENTS } from "../runtime/event-catalog.js";
import {
  MEDIA_DETECTION_SOURCES,
  MEDIA_KINDS,
  MEDIA_PROBE_STATES,
  normalizeMediaCandidate,
} from "./contracts.js";
import { isLikelyMediaSegment } from "./detection.js";
import { resolveHlsSources } from "./hls-resolver.js";
import { isAcquirableAdaptiveTrack } from "./adaptive-track-policy.js";

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
      const adaptiveTracks =
        candidate.kind === MEDIA_KINDS.ADAPTIVE
          ? mergeAdaptiveTracks(existing, candidate)
          : null;
      const item = {
        ...(existing || {}),
        ...candidate,
        ...(preserveExistingProbe ? probeFields(existing) : {}),
        ...(adaptiveTracks || {}),
        acquisitionDiagnostic:
          candidate.acquisitionDiagnostic ||
          existing?.acquisitionDiagnostic ||
          null,
        duration: candidate.duration ?? existing?.duration ?? null,
        resolution: candidate.resolution ?? existing?.resolution ?? null,
        playback: candidate.playback || existing?.playback || null,
        requestContexts: mergeRequestContexts(
          existing?.requestContexts,
          candidate.requestContexts,
          now,
        ),
        probeCount: existing?.probeCount || 0,
        lastProbeAt: existing?.lastProbeAt || null,
        lastUsableProbeAt: existing?.lastUsableProbeAt || null,
        frameId: normalizedFrameId(event.metadata?.frameId, existing?.frameId),
        frameUrl:
          normalizedFrameUrl(event.metadata?.frameUrl) ||
          existing?.frameUrl ||
          null,
        playerAdapters: uniqueStrings([
          ...(existing?.playerAdapters || []),
          event.metadata?.playerAdapter,
        ]),
        detectionSources: uniqueStrings([
          ...(existing?.detectionSources || []),
          candidate.detectedBy,
        ]),
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
      };
      applyEmeToItem(item, tabCatalog.eme);
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
        lastUsableProbeAt:
          acceptProbe && probeQuality(probe) > 0
            ? event.timestamp
            : existing?.lastUsableProbeAt || existing?.lastProbeAt || null,
        frameId: normalizedFrameId(event.metadata?.frameId, existing?.frameId),
        frameUrl:
          normalizedFrameUrl(event.metadata?.frameUrl) ||
          existing?.frameUrl ||
          null,
        playerAdapters: [...(existing?.playerAdapters || [])],
        detectionSources: uniqueStrings([
          ...(existing?.detectionSources || []),
          MEDIA_DETECTION_SOURCES.NETWORK,
        ]),
        firstSeenAt: existing?.firstSeenAt || event.timestamp,
        lastSeenAt: event.timestamp,
      };
      applyEmeToItem(item, tabCatalog.eme);
      tabCatalog.items.set(probe.mediaId, item);
      trimOldest(tabCatalog.items, maximumPerTab);
      return cloneItem(item);
    },
    applyProbeDiagnostic(tabId, rawEvent) {
      assertTabId(tabId);
      const event = normalizeRegisteredEvent(rawEvent);
      if (event.type !== EVENTS.MEDIA_PROBE_DIAGNOSTIC) {
        throw new Error(
          `[MediaCatalog] Cannot apply probe diagnostic event "${event.type}".`,
        );
      }
      const diagnostic = event.payload;
      let tabCatalog = tabs.get(tabId);
      if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, diagnostic.pageUrl)) {
        tabs.delete(tabId);
        tabCatalog = null;
      }
      if (!tabCatalog) {
        tabCatalog = { pageUrl: diagnostic.pageUrl, items: new Map() };
        tabs.set(tabId, tabCatalog);
      }
      const existing = tabCatalog.items.get(diagnostic.mediaId);
      const base =
        existing ||
        normalizeMediaCandidate({
          id: diagnostic.mediaId,
          pageUrl: diagnostic.pageUrl,
          manifestUrl: diagnostic.manifestUrl,
          kind: diagnostic.kind,
          detectedBy: MEDIA_DETECTION_SOURCES.NETWORK,
        });
      const probeDiagnostics = mergeProbeDiagnostics(
        existing?.probeDiagnostics,
        diagnostic,
      );
      const item = {
        ...base,
        probeDiagnostic: probeDiagnostics[0] || null,
        probeDiagnostics,
        frameId: normalizedFrameId(event.metadata?.frameId, existing?.frameId),
        frameUrl:
          normalizedFrameUrl(event.metadata?.frameUrl) ||
          existing?.frameUrl ||
          null,
        playerAdapters: [...(existing?.playerAdapters || [])],
        detectionSources: uniqueStrings([
          ...(existing?.detectionSources || []),
          MEDIA_DETECTION_SOURCES.NETWORK,
        ]),
        probeCount: existing?.probeCount || 0,
        lastProbeAt: existing?.lastProbeAt || null,
        lastUsableProbeAt: existing?.lastUsableProbeAt || null,
        firstSeenAt: existing?.firstSeenAt || event.timestamp,
        lastSeenAt: event.timestamp,
      };
      applyEmeToItem(item, tabCatalog.eme);
      tabCatalog.items.set(diagnostic.mediaId, item);
      trimOldest(tabCatalog.items, maximumPerTab);
      return cloneItem(item);
    },
    applyBlobTrace(tabId, rawEvent) {
      assertTabId(tabId);
      const event = normalizeRegisteredEvent(rawEvent);
      if (event.type !== EVENTS.MEDIA_BLOB_TRACED) {
        throw new Error(
          `[MediaCatalog] Cannot apply blob trace event "${event.type}".`,
        );
      }
      const trace = event.payload;
      let tabCatalog = tabs.get(tabId);
      if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, trace.pageUrl)) {
        tabs.delete(tabId);
        tabCatalog = null;
      }
      if (!tabCatalog) {
        tabCatalog = { pageUrl: trace.pageUrl, items: new Map() };
        tabs.set(tabId, tabCatalog);
      }
      const existing = tabCatalog.items.get(trace.mediaId);
      const base =
        existing ||
        normalizeMediaCandidate({
          id: trace.mediaId,
          pageUrl: trace.pageUrl,
          sourceUrl: trace.blobUrl,
          kind: MEDIA_KINDS.BLOB,
          detectedBy: MEDIA_DETECTION_SOURCES.PLAYER,
        });
      const blobTrace = mergeBlobTrace(existing?.blobTrace, trace);
      const item = {
        ...base,
        blobTrace,
        frameId: normalizedFrameId(event.metadata?.frameId, existing?.frameId),
        frameUrl:
          normalizedFrameUrl(event.metadata?.frameUrl) ||
          existing?.frameUrl ||
          null,
        playerAdapters: [...(existing?.playerAdapters || [])],
        detectionSources: uniqueStrings([
          ...(existing?.detectionSources || []),
          MEDIA_DETECTION_SOURCES.PLAYER,
        ]),
        probeCount: existing?.probeCount || 0,
        lastProbeAt: existing?.lastProbeAt || null,
        lastUsableProbeAt: existing?.lastUsableProbeAt || null,
        firstSeenAt: existing?.firstSeenAt || event.timestamp,
        lastSeenAt: event.timestamp,
      };
      applyEmeToItem(item, tabCatalog.eme);
      tabCatalog.items.set(trace.mediaId, item);
      trimOldest(tabCatalog.items, maximumPerTab);
      return cloneItem(item);
    },
    applyManifestHandoff(tabId, rawEvent) {
      assertTabId(tabId);
      const event = normalizeRegisteredEvent(rawEvent);
      if (event.type !== EVENTS.MEDIA_MANIFEST_HANDOFF_READY) {
        throw new Error(
          `[MediaCatalog] Cannot apply manifest handoff event "${event.type}".`,
        );
      }
      const handoff = event.payload;
      const tabCatalog = tabs.get(tabId);
      if (!tabCatalog || !samePageUrl(tabCatalog.pageUrl, handoff.pageUrl))
        return null;
      const existing = tabCatalog.items.get(handoff.mediaId);
      if (!existing || existing.manifestUrl !== handoff.manifestUrl)
        return null;
      const item = {
        ...existing,
        manifestHandoff: { ...handoff },
        lastSeenAt: Math.max(existing.lastSeenAt || 0, event.timestamp),
      };
      tabCatalog.items.set(handoff.mediaId, item);
      return cloneItem(item);
    },
    applyEme(tabId, rawEvent) {
      assertTabId(tabId);
      const event = normalizeRegisteredEvent(rawEvent);
      if (event.type !== EVENTS.MEDIA_EME_OBSERVED) {
        throw new Error(
          `[MediaCatalog] Cannot apply EME event "${event.type}".`,
        );
      }
      const observation = event.payload;
      let tabCatalog = tabs.get(tabId);
      if (tabCatalog && !samePageUrl(tabCatalog.pageUrl, observation.pageUrl)) {
        tabs.delete(tabId);
        tabCatalog = null;
      }
      if (!tabCatalog) {
        tabCatalog = {
          pageUrl: observation.pageUrl,
          items: new Map(),
          eme: null,
        };
        tabs.set(tabId, tabCatalog);
      }
      tabCatalog.eme = mergeEmeMetadata(tabCatalog.eme, observation);
      for (const item of tabCatalog.items.values())
        applyEmeToItem(item, tabCatalog.eme);
      return [...tabCatalog.items.values()].map((item) => cloneItem(item));
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
      const blobResolutions = resolveBlobSources(items, resolutions);
      return items.map((item) =>
        cloneItem(
          item,
          blobResolutions.get(item.id) || resolutions.get(item.id),
        ),
      );
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
    bandwidth: item.bandwidth,
    averageBandwidth: item.averageBandwidth,
    targetDuration: item.targetDuration,
    segmentCount: item.segmentCount,
    partialSegmentCount: item.partialSegmentCount,
    skippedSegmentCount: item.skippedSegmentCount,
    lowLatency: item.lowLatency,
    mediaSequence: item.mediaSequence,
    discontinuitySequence: item.discontinuitySequence,
    revisionId: item.revisionId,
    probeSource: item.probeSource,
    manifestEnvelope: item.manifestEnvelope,
    resolutionAttempt: item.resolutionAttempt,
    encryptionMethods: item.encryptionMethods,
    encryptionKeyFormats: item.encryptionKeyFormats,
    encryptionScheme: item.encryptionScheme,
    drmSystem: item.drmSystem,
    drmEvidence: item.drmEvidence,
    eme: item.eme,
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
    bandwidth: probe.bandwidth,
    averageBandwidth: probe.averageBandwidth,
    targetDuration: probe.targetDuration,
    segmentCount: probe.segmentCount,
    partialSegmentCount: probe.partialSegmentCount,
    skippedSegmentCount: probe.skippedSegmentCount,
    lowLatency: probe.lowLatency,
    mediaSequence: probe.mediaSequence,
    discontinuitySequence: probe.discontinuitySequence,
    revisionId: probe.revisionId,
    probeSource: probe.probeSource,
    manifestEnvelope: probe.manifestEnvelope,
    resolutionAttempt: probe.resolutionAttempt,
    encryptionMethods: probe.encryptionMethods,
    encryptionKeyFormats: probe.encryptionKeyFormats,
    encryptionScheme: probe.encryptionScheme,
    drmSystem: probe.drmSystem,
    drmEvidence: probe.drmEvidence,
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
  const incomingContexts = Array.isArray(incoming)
    ? incoming
    : incoming
      ? [incoming]
      : [];
  for (const context of incomingContexts) {
    contexts.push({
      ...context,
      observedAt: context.observedAt || observedAt,
    });
  }
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

function mergeProbeDiagnostics(existing = [], incoming) {
  const unique = new Map();
  for (const diagnostic of [incoming, ...(existing || [])]) {
    if (!diagnostic) continue;
    const key = [
      diagnostic.phase,
      diagnostic.code,
      diagnostic.httpStatus,
      diagnostic.bodyBytes,
      diagnostic.playlistType,
      diagnostic.segmentCount,
    ].join("\n");
    if (!unique.has(key)) unique.set(key, { ...diagnostic });
  }
  return [...unique.values()]
    .sort((left, right) => (right.observedAt || 0) - (left.observedAt || 0))
    .slice(0, 8);
}

function mergeBlobTrace(existing, incoming) {
  return {
    blobUrl: incoming.blobUrl,
    sourceUrls: uniqueStrings([
      ...(existing?.sourceUrls || []),
      ...(incoming.sourceUrls || []),
    ]).slice(-32),
    candidateIds: uniqueStrings([
      ...(existing?.candidateIds || []),
      ...(incoming.candidateIds || []),
    ]).slice(-8),
    mimeTypes: uniqueStrings([
      ...(existing?.mimeTypes || []),
      ...(incoming.mimeTypes || []),
    ]).slice(-8),
    appendFormats: uniqueStrings([
      ...(existing?.appendFormats || []),
      ...(incoming.appendFormats || []),
    ]).slice(-4),
    appendCount: Math.max(
      existing?.appendCount || 0,
      incoming.appendCount || 0,
    ),
    totalAppendedBytes: Math.max(
      existing?.totalAppendedBytes || 0,
      incoming.totalAppendedBytes || 0,
    ),
    unclassifiedAppendCount: Math.max(
      existing?.unclassifiedAppendCount || 0,
      incoming.unclassifiedAppendCount || 0,
    ),
    observerStartedAt:
      existing?.observerStartedAt || incoming.observerStartedAt || null,
    observerDocumentState:
      existing?.observerDocumentState &&
      existing.observerDocumentState !== "unknown"
        ? existing.observerDocumentState
        : incoming.observerDocumentState || "unknown",
    observedAt: Math.max(existing?.observedAt || 0, incoming.observedAt || 0),
  };
}

function mergeEmeMetadata(existing, observation) {
  return {
    keySystems: uniqueStrings([
      ...(existing?.keySystems || []),
      observation.keySystem,
    ]).slice(0, 8),
    initDataTypes: uniqueStrings([
      ...(existing?.initDataTypes || []),
      observation.initDataType,
    ]).slice(0, 8),
    encryptionSchemes: uniqueStrings([
      ...(existing?.encryptionSchemes || []),
      ...(observation.encryptionSchemes || []),
    ]).slice(0, 8),
    keyStatuses: uniqueStrings([
      ...(existing?.keyStatuses || []),
      ...(observation.keyStatuses || []),
    ]).slice(0, 8),
    licenseStatus: observation.licenseStatus || existing?.licenseStatus || null,
    observedAt: Math.max(
      existing?.observedAt || 0,
      observation.observedAt || 0,
    ),
  };
}

function applyEmeToItem(item, eme) {
  if (!eme) return item;
  item.eme = mergeEmeMetadata(item.eme, {
    keySystem: null,
    initDataType: null,
    encryptionSchemes: eme.encryptionSchemes,
    keyStatuses: eme.keyStatuses,
    licenseStatus: eme.licenseStatus,
    observedAt: eme.observedAt,
  });
  item.eme.keySystems = uniqueStrings([
    ...(item.eme.keySystems || []),
    ...(eme.keySystems || []),
  ]).slice(0, 8);
  item.eme.initDataTypes = uniqueStrings([
    ...(item.eme.initDataTypes || []),
    ...(eme.initDataTypes || []),
  ]).slice(0, 8);
  const hasCdmEvidence =
    eme.keySystems?.length > 0 ||
    eme.keyStatuses?.length > 0 ||
    Boolean(eme.licenseStatus);
  if (item.drm === "suspected" && hasCdmEvidence) {
    item.drm = "confirmed";
    item.drmSystem = item.drmSystem || drmSystemFromKeySystems(eme.keySystems);
    item.drmEvidence = uniqueStrings([
      ...(item.drmEvidence || []),
      "eme-key-system-access",
    ]);
  }
  return item;
}

function drmSystemFromKeySystems(keySystems = []) {
  const value = keySystems.join(" ").toLowerCase();
  if (value.includes("widevine")) return "widevine";
  if (value.includes("playready")) return "playready";
  if (value.includes("apple") || value.includes("fairplay")) return "fairplay";
  if (value.includes("clearkey")) return "clearkey";
  return "unknown";
}

function resolveBlobSources(items, adaptiveResolutions) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const resolved = new Map();
  for (const blob of items.filter((item) => item.kind === MEDIA_KINDS.BLOB)) {
    const candidates = [];
    for (const candidateId of blob.blobTrace?.candidateIds || []) {
      let item = itemsById.get(candidateId);
      const adaptive = adaptiveResolutions.get(candidateId);
      if (adaptive?.selectedMediaId) {
        item = itemsById.get(adaptive.selectedMediaId) || item;
      }
      if (!item || item.kind === MEDIA_KINDS.BLOB) continue;
      candidates.push(item);
    }
    const uniqueCandidates = [
      ...new Map(candidates.map((item) => [item.id, item])).values(),
    ].sort(
      (left, right) => blobCandidateScore(right) - blobCandidateScore(left),
    );
    const selected = uniqueCandidates[0];
    if (!selected) continue;
    const selectedResolution = adaptiveResolutions.get(selected.id);
    resolved.set(blob.id, {
      parents: [],
      children: [],
      resolutionStatus: "resolved",
      resolvedMediaIds: uniqueCandidates.map((item) => item.id),
      selectedMediaId: selected.id,
      resolvedKind: selected.kind,
      resolvedStream: selected,
      resolvedRequestContext:
        selected.resolvedRequestContext ||
        selected.requestContexts?.[0] ||
        null,
      resolutionStrategy: selectedResolution?.resolutionStrategy || null,
      resolutionConfidence: selectedResolution?.resolutionConfidence ?? null,
      resolutionEvidence: [...(selectedResolution?.resolutionEvidence || [])],
    });
  }
  return resolved;
}

function blobCandidateScore(item) {
  if (["suspected", "confirmed"].includes(item.drm)) return -100;
  if (item.kind === MEDIA_KINDS.DIRECT) return 80;
  if (item.probeStatus !== MEDIA_PROBE_STATES.READY) return 10;
  if (item.streamType === "vod") return 70;
  if (item.streamType === "live") return 20;
  return 40;
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

function mergeAdaptiveTracks(existing, candidate) {
  const variants = mergeTrackList(existing?.variants, candidate.variants);
  const audioTracks = mergeTrackList(
    existing?.audioTracks,
    candidate.audioTracks,
  );
  const bestVideo = [...variants].sort(compareAdaptiveTrackQuality)[0] || null;
  const bestAudio =
    [...audioTracks].sort(compareAdaptiveTrackQuality)[0] || null;
  const playerUrl = candidate.playerUrl || existing?.playerUrl || null;
  const acquisitionCandidate = { ...candidate, playerUrl };
  const muxedReady = variants.some(
    (track) =>
      track.muxed === true &&
      isAcquirableAdaptiveTrack(acquisitionCandidate, track),
  );
  return {
    variants,
    audioTracks,
    sourceUrl:
      bestVideo?.sourceUrl ||
      existing?.sourceUrl ||
      candidate.sourceUrl ||
      bestAudio?.sourceUrl ||
      null,
    mimeType: bestVideo?.mimeType || candidate.mimeType || existing?.mimeType,
    resolution:
      bestVideo?.resolution || candidate.resolution || existing?.resolution,
    bandwidth:
      bestVideo?.bandwidth || candidate.bandwidth || existing?.bandwidth,
    averageBandwidth:
      bestVideo?.averageBandwidth ||
      candidate.averageBandwidth ||
      existing?.averageBandwidth,
    playerUrl,
    probeStatus:
      muxedReady ||
      (variants.some((track) =>
        isAcquirableAdaptiveTrack(acquisitionCandidate, track),
      ) &&
        audioTracks.some((track) =>
          isAcquirableAdaptiveTrack(acquisitionCandidate, track),
        ))
        ? MEDIA_PROBE_STATES.READY
        : MEDIA_PROBE_STATES.DISCOVERED,
    streamType: "vod",
  };
}

function mergeTrackList(existing = [], incoming = []) {
  const tracks = new Map();
  for (const track of [...(existing || []), ...(incoming || [])]) {
    if (!track || typeof track !== "object") continue;
    const key =
      track.id || `${track.type || "track"}:${track.itag || track.sourceUrl}`;
    const previous = tracks.get(key) || {};
    tracks.set(key, {
      ...previous,
      ...track,
      sourceUrl: track.sourceUrl || previous.sourceUrl || null,
      signatureCipher:
        track.signatureCipher || previous.signatureCipher || null,
      muxed: track.muxed === true || previous.muxed === true,
    });
  }
  return [...tracks.values()];
}

function compareAdaptiveTrackQuality(left, right) {
  return (
    (right.resolution?.height || right.height || 0) -
      (left.resolution?.height || left.height || 0) ||
    (right.averageBandwidth || right.bandwidth || 0) -
      (left.averageBandwidth || left.bandwidth || 0) ||
    (right.contentLength || 0) - (left.contentLength || 0)
  );
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
    playerAdapters: [...(item.playerAdapters || [])],
    encryptionMethods: [...(item.encryptionMethods || [])],
    encryptionKeyFormats: [...(item.encryptionKeyFormats || [])],
    drmEvidence: [...(item.drmEvidence || [])],
    eme: item.eme
      ? {
          ...item.eme,
          keySystems: [...(item.eme.keySystems || [])],
          initDataTypes: [...(item.eme.initDataTypes || [])],
          encryptionSchemes: [...(item.eme.encryptionSchemes || [])],
          keyStatuses: [...(item.eme.keyStatuses || [])],
        }
      : null,
    requestContexts: (item.requestContexts || []).map((context) => ({
      ...context,
    })),
    probeDiagnostic: item.probeDiagnostic ? { ...item.probeDiagnostic } : null,
    probeDiagnostics: (item.probeDiagnostics || []).map((diagnostic) => ({
      ...diagnostic,
    })),
    resolutionAttempt: item.resolutionAttempt
      ? {
          ...item.resolutionAttempt,
          evidence: [...(item.resolutionAttempt.evidence || [])],
        }
      : null,
    manifestEnvelope: item.manifestEnvelope
      ? {
          ...item.manifestEnvelope,
          evidence: [...(item.manifestEnvelope.evidence || [])],
        }
      : null,
    manifestHandoff: item.manifestHandoff ? { ...item.manifestHandoff } : null,
    blobTrace: item.blobTrace
      ? {
          ...item.blobTrace,
          sourceUrls: [...(item.blobTrace.sourceUrls || [])],
          candidateIds: [...(item.blobTrace.candidateIds || [])],
          mimeTypes: [...(item.blobTrace.mimeTypes || [])],
          appendFormats: [...(item.blobTrace.appendFormats || [])],
        }
      : null,
    parentManifestIds: [...(resolution?.parents || [])],
    childManifestIds: [...(resolution?.children || [])],
    resolutionStatus: resolution?.resolutionStatus || null,
    resolvedMediaIds: [...(resolution?.resolvedMediaIds || [])],
    selectedMediaId: resolution?.selectedMediaId || null,
    resolvedKind: resolution?.resolvedKind || null,
    resolvedStream: resolution?.resolvedStream
      ? {
          ...resolution.resolvedStream,
          resolution: resolution.resolvedStream.resolution
            ? { ...resolution.resolvedStream.resolution }
            : null,
          encryptionMethods: [
            ...(resolution.resolvedStream.encryptionMethods || []),
          ],
          encryptionKeyFormats: [
            ...(resolution.resolvedStream.encryptionKeyFormats || []),
          ],
          drmEvidence: [...(resolution.resolvedStream.drmEvidence || [])],
          resolutionEvidence: [
            ...(resolution.resolvedStream.resolutionEvidence || []),
          ],
        }
      : null,
    resolvedRequestContext: resolution?.resolvedRequestContext
      ? { ...resolution.resolvedRequestContext }
      : null,
    resolutionStrategy: resolution?.resolutionStrategy || null,
    resolutionConfidence: resolution?.resolutionConfidence ?? null,
    resolutionEvidence: [...(resolution?.resolutionEvidence || [])],
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

function normalizedFrameId(value, fallback = null) {
  return Number.isInteger(value) && value >= 0 ? value : (fallback ?? null);
}

function normalizedFrameUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
