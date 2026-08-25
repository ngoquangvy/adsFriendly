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

export function helperSetupPresentation(helper) {
  if (!helper || helper.status === "ready") return null;
  if (helper.status === "permission_required") {
    return {
      label: "Allow helper connection",
      title: "Allow AdsFriendly to communicate with the installed Media Helper.",
    };
  }
  if (helper.status === "not_installed") {
    return {
      label: "Install helper",
      title: "Media Helper is not installed or registered for this browser.",
    };
  }
  return {
    label: "Retry helper",
    title: helper.error || "Check the Media Helper connection again.",
  };
}

export function formatMediaDetails(item) {
  if (item.kind === "blob")
    return item.relatedCount > 1
      ? `${item.relatedCount} Blob signals · tracing one source`
      : "Blob signal · tracing network source";
  if (item.kind === "direct") return "Direct video file";
  if (item.kind === "dash") return "DASH found · parser comes next";
  if (item.kind !== "hls") return "Media source found";

  if (
    item.resolvedStream &&
    item.selectedMediaId &&
    item.selectedMediaId !== item.id
  )
    return resolvedHlsDetails(item);

  if (item.probeStatus === "failed")
    return item.probeError === "fallback_fetch_blocked"
      ? "HLS · page/CORS blocked manifest reading"
      : "HLS · manifest request or parse failed";
  if (item.probeStatus === "unsupported")
    return "HLS · manifest format not supported";
  if (item.probeStatus !== "ready")
    return "HLS manifest found · reading qualities";
  if (item.playlistType === "unknown")
    return "HLS endpoint · waiting for media playlist";

  const facts = [];
  if (item.playlistType === "master") {
    const qualityLabels = [...(item.variants || [])]
      .sort(compareVariantQuality)
      .map(variantLabel)
      .filter(
        (label, index, labels) => label && labels.indexOf(label) === index,
      )
      .slice(0, 4);
    facts.push(
      qualityLabels.length
        ? qualityLabels.join(" · ")
        : item.iframeVariants?.length
          ? `${item.iframeVariants.length} preview streams · waiting for primary stream`
          : "Master playlist · waiting for quality streams",
    );
    if (item.childManifestIds?.length)
      facts.push(`${item.childManifestIds.length} active child streams`);
  } else {
    if (item.streamType === "unknown")
      return "HLS media playlist · waiting for segments";
    const streamLabel =
      item.streamType === "live"
        ? item.lowLatency
          ? "Low-latency live"
          : "Live stream"
        : "VOD stream";
    facts.push(
      item.parentManifestIds?.length ? `Variant ${streamLabel}` : streamLabel,
    );
    if (Number.isFinite(item.duration) && item.duration > 0)
      facts.push(formatDuration(item.duration));
    if (Number.isInteger(item.segmentCount) && item.segmentCount > 0)
      facts.push(`${item.segmentCount} segments`);
    if (
      Number.isInteger(item.partialSegmentCount) &&
      item.partialSegmentCount > 0
    )
      facts.push(`${item.partialSegmentCount} parts`);
    if (
      Number.isInteger(item.skippedSegmentCount) &&
      item.skippedSegmentCount > 0
    )
      facts.push(`${item.skippedSegmentCount} skipped`);
    if (
      item.streamType === "live" &&
      !item.segmentCount &&
      !item.partialSegmentCount
    )
      facts.push("waiting for segments");
  }
  if (item.audioTracks?.length) facts.push(`${item.audioTracks.length} audio`);
  if (item.subtitles?.length) facts.push(`${item.subtitles.length} subtitles`);
  if (item.drm === "suspected") facts.push("DRM suspected");
  else if (item.encryptionMethods?.length) facts.push("Encrypted");
  return facts.filter(Boolean).join(" · ") || "HLS manifest ready";
}

function resolvedHlsDetails(item) {
  const stream = item.resolvedStream;
  const facts = ["Resolved"];
  if (stream.resolution?.height) facts.push(`${stream.resolution.height}p`);
  else if (stream.bandwidth)
    facts.push(
      stream.bandwidth >= 1_000_000
        ? `${(stream.bandwidth / 1_000_000).toFixed(1)} Mbps`
        : `${Math.round(stream.bandwidth / 1000)} Kbps`,
    );
  facts.push(stream.streamType === "vod" ? "VOD" : "Live");
  if (Number.isFinite(stream.duration) && stream.duration > 0)
    facts.push(formatDuration(stream.duration));
  if (stream.segmentCount > 0) facts.push(`${stream.segmentCount} segments`);
  if (stream.partialSegmentCount > 0)
    facts.push(`${stream.partialSegmentCount} parts`);
  if (["suspected", "confirmed"].includes(stream.drm)) facts.push("DRM");
  else if (stream.encryptionMethods?.length) facts.push("Encrypted");
  if (item.resolvedRequestContext?.requiresBrowserSession)
    facts.push("browser session");
  return facts.join(" · ");
}

function compareVariantQuality(left, right) {
  return (
    (right.resolution?.height || 0) - (left.resolution?.height || 0) ||
    (right.averageBandwidth || right.bandwidth || 0) -
      (left.averageBandwidth || left.bandwidth || 0)
  );
}

function variantLabel(variant) {
  if (variant.resolution?.height) return `${variant.resolution.height}p`;
  const bandwidth = variant.averageBandwidth || variant.bandwidth;
  if (!Number.isFinite(bandwidth)) return null;
  return bandwidth >= 1_000_000
    ? `${(bandwidth / 1_000_000).toFixed(1)} Mbps`
    : `${Math.round(bandwidth / 1000)} Kbps`;
}

function formatDuration(seconds) {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours)
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds,
    ).padStart(2, "0")}`;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
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
