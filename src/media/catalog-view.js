import { getMediaDownloadAvailability } from "./download-job-contract.js";
import { diagnoseMediaResolution } from "./resolution-diagnostics.js";

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
          canDownloadDash: helper.canDownloadDash,
          error: helper.error,
        }
      : null,
    items: items.map(mediaRenderFacts),
  });
}

export function selectVisibleMediaItems(items = [], maximum = 8) {
  const diagnosedItems = items.map((item) => ({
    ...item,
    resolutionDiagnostic: diagnoseMediaResolution(item, items),
  }));
  const blobResolvedSourceIds = new Set(
    diagnosedItems
      .filter((item) => item.kind === "blob" && item.selectedMediaId)
      .flatMap((item) => [
        item.selectedMediaId,
        ...(item.resolvedMediaIds || []),
        ...(item.blobTrace?.candidateIds || []),
      ])
      .filter(Boolean),
  );
  const sorted = [...diagnosedItems].sort(
    (left, right) =>
      (right.firstSeenAt || 0) - (left.firstSeenAt || 0) ||
      String(left.id || "").localeCompare(String(right.id || "")),
  );
  const visible = [];
  const blobGroups = new Map();
  const resolvedBlobGroupKeys = resolvedBlobGroupKeysByPage(diagnosedItems);
  for (const item of sorted) {
    if (item.kind !== "blob" && blobResolvedSourceIds.has(item.id)) continue;
    if (item.kind === "hls" && item.parentManifestIds?.length) continue;
    if (item.kind !== "blob") {
      visible.push(item);
      continue;
    }
    const key = blobGroupKey(item, resolvedBlobGroupKeys);
    const existing = blobGroups.get(key);
    if (existing) {
      existing.relatedCount += 1;
      if (item.selectedMediaId && !existing.selectedMediaId) {
        const resolved = { ...item, relatedCount: existing.relatedCount };
        blobGroups.set(key, resolved);
        const visibleIndex = visible.indexOf(existing);
        if (visibleIndex >= 0) visible[visibleIndex] = resolved;
      }
      continue;
    }
    const grouped = { ...item, relatedCount: 1 };
    blobGroups.set(key, grouped);
    visible.push(grouped);
  }
  return visible.slice(0, maximum);
}

export function getMediaCatalogDownloadState(items = []) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const candidates = new Map();
  for (const item of selectVisibleMediaItems(items, Number.MAX_SAFE_INTEGER)) {
    const candidate = item.selectedMediaId
      ? itemsById.get(item.selectedMediaId) || item.resolvedStream || item
      : item;
    if (!["direct", "hls", "dash"].includes(candidate.kind)) continue;
    candidates.set(candidate.id, candidate);
  }
  const availability = [...candidates.values()].map((candidate) => ({
    candidate,
    ...getMediaDownloadAvailability(candidate),
  }));
  return {
    candidateCount: availability.length,
    downloadableCount: availability.filter((item) => item.supported).length,
    drmBlockedCount: availability.filter((item) =>
      String(item.reason || "").includes("DRM"),
    ).length,
    unavailableCount: availability.filter((item) => !item.supported).length,
  };
}

export function helperSetupPresentation(
  helper,
  { hasDownloadableMedia = true } = {},
) {
  if (!hasDownloadableMedia || !helper || helper.status === "ready")
    return null;
  if (helper.status === "permission_required") {
    return {
      label: "Allow helper connection",
      title:
        "Allow AdsFriendly to communicate with the installed Media Helper.",
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

export function formatMediaHelperSummary(helper, downloadState) {
  if (!downloadState.downloadableCount) {
    if (downloadState.drmBlockedCount)
      return "Media found · DRM stream is playback only.";
    return "Media found · no downloadable source is ready yet.";
  }
  if (helper.status === "permission_required")
    return "Media found · allow Media Helper connection to download.";
  if (helper.status === "not_installed")
    return "Media found · Media Helper is not installed.";
  if (
    helper.status === "ready" &&
    (helper.canDownloadDirect ||
      helper.canDownloadHls ||
      helper.canDownloadDash)
  )
    return `Media Helper ${helper.helperVersion || ""} ready.`.trim();
  if (helper.status === "ready")
    return "Media Helper connected · downloader update required.";
  if (helper.status === "incompatible")
    return "Media Helper version is incompatible.";
  if (/timed out/i.test(helper.error || ""))
    return "Media found · Media Helper took too long to start.";
  if (/exited|disconnected/i.test(helper.error || ""))
    return "Media found · Media Helper exited during startup.";
  return "Media found · Media Helper connection failed.";
}

export function formatMediaDetails(item) {
  if (item.kind === "blob" && item.selectedMediaId)
    return resolvedBlobDetails(item);
  if (item.kind === "blob")
    return (
      item.resolutionDiagnostic?.message ||
      (item.relatedCount > 1
        ? `${item.relatedCount} Blob signals · tracing source buffers`
        : item.blobTrace?.appendCount
          ? `${item.blobTrace.appendCount} buffers observed · matching source`
          : "Blob signal · tracing source buffers")
    );
  if (item.kind === "direct") return "Direct video file";
  if (item.kind === "dash") return dashDetails(item);
  if (item.kind !== "hls") return "Media source found";

  if (
    item.resolvedStream &&
    item.selectedMediaId &&
    item.selectedMediaId !== item.id
  )
    return resolvedHlsDetails(item);

  if (item.probeStatus === "failed")
    return (
      item.resolutionDiagnostic?.message ||
      "Manifest probe · HLS request failed"
    );
  if (item.probeStatus === "unsupported")
    return "HLS · manifest format not supported";
  if (item.probeStatus !== "ready")
    return (
      item.resolutionDiagnostic?.message ||
      "Manifest probe · HLS response not parsed yet"
    );
  if (item.playlistType === "unknown")
    return "HLS endpoint · watching for a playable stream";

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
  appendProtectionFacts(facts, item);
  return facts.filter(Boolean).join(" · ") || "HLS manifest ready";
}

export function formatMediaName(item) {
  const sourceUrl =
    item.resolvedStream?.manifestUrl ||
    item.resolvedStream?.sourceUrl ||
    item.manifestUrl ||
    item.sourceUrl ||
    "";
  try {
    const url = new URL(sourceUrl);
    if (item.kind === "blob") {
      const title = readableMediaTitle(item.title);
      if (title) return title;
      if (["http:", "https:"].includes(url.protocol))
        return `${url.hostname} · ${String(item.resolvedKind || "media").toUpperCase()} source`;
      return "Blob media stream";
    }
    const file = url.pathname.split("/").filter(Boolean).at(-1);
    if (item.kind === "hls" && file?.length > 48 && /^[a-z0-9_-]+$/i.test(file))
      return `${url.hostname} · tokenized playlist`;
    return file ? `${url.hostname} · ${file}` : url.hostname;
  } catch {
    return readableMediaTitle(item.title) || sourceUrl || "Unknown media";
  }
}

function resolvedBlobDetails(item) {
  const stream = item.resolvedStream || {};
  const kind = String(
    item.resolvedKind || stream.kind || "media",
  ).toUpperCase();
  const facts = [`Blob resolved to ${kind}`];
  if (
    item.resolutionDiagnostic?.message &&
    !["ready", "blocked"].includes(item.resolutionDiagnostic.status)
  ) {
    facts.push(item.resolutionDiagnostic.message);
    return facts.join(" · ");
  }
  if (stream.resolution?.height) facts.push(`${stream.resolution.height}p`);
  if (Number.isFinite(stream.duration) && stream.duration > 0)
    facts.push(formatDuration(stream.duration));
  appendProtectionFacts(facts, stream);
  return facts.join(" · ");
}

function dashDetails(item) {
  if (item.probeStatus === "failed") return "DASH manifest request failed";
  if (item.probeStatus === "unsupported") return "DASH manifest not supported";
  if (item.probeStatus !== "ready")
    return "DASH manifest found · reading tracks";
  const facts = [item.streamType === "live" ? "Live DASH" : "DASH VOD"];
  if (Number.isFinite(item.duration) && item.duration > 0)
    facts.push(formatDuration(item.duration));
  const qualities = [...(item.variants || [])]
    .sort(compareVariantQuality)
    .map(variantLabel)
    .filter((label, index, labels) => label && labels.indexOf(label) === index)
    .slice(0, 4);
  if (qualities.length) facts.push(qualities.join(" · "));
  if (item.audioTracks?.length) facts.push(`${item.audioTracks.length} audio`);
  if (item.subtitles?.length) facts.push(`${item.subtitles.length} subtitles`);
  appendProtectionFacts(facts, item);
  return facts.join(" · ");
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
  appendProtectionFacts(facts, stream);
  if (item.resolvedRequestContext?.requiresBrowserSession)
    facts.push("browser session");
  return facts.join(" · ");
}

function appendProtectionFacts(facts, item) {
  if (item.drm === "confirmed") {
    facts.push(
      `DRM confirmed${item.drmSystem ? ` · ${formatDrmSystem(item.drmSystem)}` : ""}`,
      "Playback only",
    );
    return;
  }
  if (item.drm === "suspected") {
    facts.push(
      item.encryptionScheme === "sample-aes"
        ? "DRM suspected · SAMPLE-AES"
        : "DRM suspected",
      "Playback only",
    );
    return;
  }
  if (item.encryptionScheme === "aes-128") {
    facts.push("Encrypted HLS · AES-128");
    return;
  }
  if (item.encryptionMethods?.length) facts.push("Encrypted");
}

function formatDrmSystem(value) {
  return value === "widevine"
    ? "Widevine"
    : value === "playready"
      ? "PlayReady"
      : value === "fairplay"
        ? "FairPlay"
        : value === "clearkey"
          ? "Clear Key"
          : "Unknown system";
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

function readableMediaTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title || title.length > 160) return null;
  if (/^[a-f0-9]{24,}$/i.test(title)) return null;
  return title;
}

function resolvedBlobGroupKeysByPage(items) {
  const byPage = new Map();
  for (const item of items) {
    if (item.kind !== "blob" || !item.selectedMediaId) continue;
    const pageUrl = item.pageUrl || "";
    const matches = byPage.get(pageUrl) || [];
    matches.push(item);
    byPage.set(pageUrl, matches);
  }
  return new Map(
    [...byPage].flatMap(([pageUrl, matches]) =>
      matches.length === 1
        ? [[pageUrl, `${pageUrl}\n${blobTitleKey(matches[0].title)}`]]
        : [],
    ),
  );
}

function blobGroupKey(item, resolvedGroupKeys) {
  const pageUrl = item.pageUrl || "";
  if (!item.selectedMediaId && isGenericBlobTitle(item.title)) {
    const resolvedKey = resolvedGroupKeys.get(pageUrl);
    if (resolvedKey) return resolvedKey;
  }
  return `${pageUrl}\n${blobTitleKey(item.title)}`;
}

function blobTitleKey(value) {
  return readableMediaTitle(value)?.toLowerCase() || "blob";
}

function isGenericBlobTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";
  return (
    !readableMediaTitle(title) ||
    /^(blob|blob media stream|media stream)$/i.test(title)
  );
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
    resolutionStrategy: item.resolutionStrategy,
    resolutionConfidence: item.resolutionConfidence,
    resolvedMediaIds: item.resolvedMediaIds,
    selectedMediaId: item.selectedMediaId,
    resolvedStream: item.resolvedStream,
    resolvedKind: item.resolvedKind,
    blobTrace: item.blobTrace,
    requiresBrowserSession:
      item.resolvedRequestContext?.requiresBrowserSession === true,
    drm: item.drm,
    drmSystem: item.drmSystem,
    drmEvidence: item.drmEvidence,
    eme: item.eme,
    encryptionScheme: item.encryptionScheme,
    encryptionKeyFormats: item.encryptionKeyFormats,
    encryptionMethods: item.encryptionMethods,
    variants: item.variants,
    iframeVariants: item.iframeVariants,
    audioTracks: item.audioTracks,
    subtitles: item.subtitles,
    resolutionDiagnostic: item.resolutionDiagnostic,
  };
}
