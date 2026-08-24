export function createMediaCatalogViewSignature({
  tabId = null,
  status = "",
  helper = null,
  items = [],
} = {}) {
  return JSON.stringify({
    tabId,
    status,
    helper: helper
      ? {
          status: helper.status,
          helperVersion: helper.helperVersion,
          canDownloadDirect: helper.canDownloadDirect,
          canDownloadHls: helper.canDownloadHls,
          error: helper.error,
        }
      : null,
    items: items.map(mediaRenderFacts),
  });
}

export function selectVisibleMediaItems(items = [], maximum = 8) {
  const sorted = [...items].sort(
    (left, right) =>
      (right.firstSeenAt || 0) - (left.firstSeenAt || 0) ||
      String(left.id || "").localeCompare(String(right.id || "")),
  );
  const visible = [];
  const blobGroups = new Map();
  for (const item of sorted) {
    if (item.kind === "hls" && item.parentManifestIds?.length) continue;
    if (item.kind !== "blob") {
      visible.push(item);
      continue;
    }
    const key = `${item.pageUrl || ""}\n${item.title || "blob"}`;
    const existing = blobGroups.get(key);
    if (existing) {
      existing.relatedCount += 1;
      continue;
    }
    const grouped = { ...item, relatedCount: 1 };
    blobGroups.set(key, grouped);
    visible.push(grouped);
  }
  return visible.slice(0, maximum);
}

function mediaRenderFacts(item) {
  return {
    id: item.id,
    kind: item.kind,
    sourceUrl: item.sourceUrl,
    manifestUrl: item.manifestUrl,
    title: item.title,
    probeStatus: item.probeStatus,
    probeError: item.probeError,
    playlistType: item.playlistType,
    streamType: item.streamType,
    duration: item.duration,
    segmentCount: item.segmentCount,
    partialSegmentCount: item.partialSegmentCount,
    skippedSegmentCount: item.skippedSegmentCount,
    lowLatency: item.lowLatency,
    mediaSequence: item.mediaSequence,
    discontinuitySequence: item.discontinuitySequence,
    revisionId: item.revisionId,
    relatedCount: item.relatedCount,
    parentManifestIds: item.parentManifestIds,
    childManifestIds: item.childManifestIds,
    resolutionStatus: item.resolutionStatus,
    resolvedMediaIds: item.resolvedMediaIds,
    selectedMediaId: item.selectedMediaId,
    resolvedStream: item.resolvedStream,
    requiresBrowserSession:
      item.resolvedRequestContext?.requiresBrowserSession === true,
    drm: item.drm,
    encryptionMethods: item.encryptionMethods,
    variants: item.variants,
    iframeVariants: item.iframeVariants,
    audioTracks: item.audioTracks,
    subtitles: item.subtitles,
  };
}
