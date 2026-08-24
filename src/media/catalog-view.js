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
          canDownloadHls: helper.canDownloadHls,
          error: helper.error,
        }
      : null,
    items: items.map(mediaRenderFacts),
  });
}

export function selectVisibleMediaItems(items = [], maximum = 8) {
  return [...items]
    .sort(
      (left, right) =>
        (right.firstSeenAt || 0) - (left.firstSeenAt || 0) ||
        String(left.id || "").localeCompare(String(right.id || "")),
    )
    .slice(0, maximum);
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
    drm: item.drm,
    encryptionMethods: item.encryptionMethods,
    variants: item.variants,
    audioTracks: item.audioTracks,
    subtitles: item.subtitles,
  };
}
