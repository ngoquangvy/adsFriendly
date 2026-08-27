import { getMediaDownloadAvailability } from "./download-job-contract.js";
import {
  hasStrongDrmEvidence,
  hasUnsupportedHlsKeyFormat,
  isFfmpegCompatibleSampleAes,
  isWeakSampleAesSignal,
} from "./protection-policy.js";
import { diagnoseMediaResolution } from "./resolution-diagnostics.js";
import {
  hasYouTubeProviderPendingTracks,
  isAcquirableAdaptiveTrack,
} from "./adaptive-track-policy.js";

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
          canDownloadDecryptedHls: helper.canDownloadDecryptedHls,
          canSelectContainer: helper.canSelectContainer,
          canDownloadDash: helper.canDownloadDash,
          canDownloadAdaptive: helper.canDownloadAdaptive,
          canResolveYouTubePlayerJs: helper.canResolveYouTubePlayerJs,
          canResolveYouTubeProviderFormats:
            helper.canResolveYouTubeProviderFormats,
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
  for (const blob of diagnosedItems.filter(
    (item) => item.kind === "blob" && item.selectedMediaId,
  )) {
    for (const source of diagnosedItems) {
      if (
        source.kind !== "blob" &&
        samePlaybackFrame(blob, source) &&
        (source.selectedMediaId === blob.selectedMediaId ||
          source.resolvedMediaIds?.includes(blob.selectedMediaId) ||
          (blob.resolvedMediaIds || []).some((id) =>
            source.resolvedMediaIds?.includes(id),
          ))
      ) {
        blobResolvedSourceIds.add(source.id);
      }
    }
  }
  const sorted = [...diagnosedItems].sort(
    (left, right) =>
      (right.firstSeenAt || 0) - (left.firstSeenAt || 0) ||
      String(left.id || "").localeCompare(String(right.id || "")),
  );
  const visible = [];
  const adaptivePages = new Set(
    diagnosedItems
      .filter((item) => item.kind === "adaptive")
      .map((item) => item.pageUrl),
  );
  const blobGroups = new Map();
  const resolvedBlobGroupKeys = resolvedBlobGroupKeysByPage(diagnosedItems);
  for (const item of sorted) {
    if (item.kind === "blob" && adaptivePages.has(item.pageUrl)) continue;
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
    if (!["direct", "hls", "dash", "adaptive"].includes(candidate.kind))
      continue;
    candidates.set(candidate.id, candidate);
  }
  const availability = [...candidates.values()].map((candidate) => ({
    candidate,
    ...getMediaDownloadAvailability(candidate),
  }));
  const diagnostic = mediaDownloadDiagnostic(items, availability);
  return {
    candidateCount: availability.length,
    downloadableCount: availability.filter((item) => item.supported).length,
    drmBlockedCount: availability.filter((item) =>
      String(item.reason || "").includes("DRM"),
    ).length,
    unavailableCount: availability.filter((item) => !item.supported).length,
    ...(diagnostic
      ? {
          diagnosticCode: diagnostic.code,
          diagnosticMessage: diagnostic.message,
        }
      : {}),
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
    if (downloadState.diagnosticMessage) return downloadState.diagnosticMessage;
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
      helper.canDownloadDash ||
      helper.canDownloadAdaptive)
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

function mediaDownloadDiagnostic(items, availability) {
  const adaptive = items.find(
    (item) => item.kind === "adaptive" && item.provider === "youtube",
  );
  if (adaptive) {
    const acquisitionDiagnostic = adaptive.acquisitionDiagnostic;
    const acquisitionMessage = youtubeAcquisitionMessage(acquisitionDiagnostic);
    const videoCount = (adaptive.variants || []).filter((track) =>
      isAcquirableAdaptiveTrack(adaptive, track),
    ).length;
    const audioCount = (adaptive.audioTracks || []).filter((track) =>
      isAcquirableAdaptiveTrack(adaptive, track),
    ).length;
    const muxedVideoCount = (adaptive.variants || []).filter(
      (track) =>
        track.muxed === true && isAcquirableAdaptiveTrack(adaptive, track),
    ).length;
    if (
      muxedVideoCount &&
      ["n_transform_pending", "signature_cipher_pending"].includes(
        acquisitionDiagnostic?.stage,
      ) &&
      !adaptive.playerUrl
    )
      return {
        code: "youtube_player_js_url_missing",
        message:
          "YouTube muxed track found · waiting for the Player JS URL required to resolve it.",
      };
    if (!videoCount && !audioCount && acquisitionMessage)
      return {
        code: `youtube_${acquisitionDiagnostic.stage}`,
        message: acquisitionMessage,
      };
    if (!videoCount && !audioCount)
      return {
        code: "youtube_tracks_empty",
        message:
          "YouTube player found · no resolved video or audio track was captured.",
      };
    if (!videoCount)
      return {
        code: "youtube_video_pending",
        message: `YouTube audio captured (${audioCount}) · waiting for a video track.`,
      };
    if (!audioCount && !muxedVideoCount)
      return {
        code: "youtube_audio_pending",
        message: `YouTube video captured (${videoCount}) · waiting for an audio track.`,
      };
    const entry = availability.find(
      (item) => item.candidate.id === adaptive.id,
    );
    if (entry && !entry.supported)
      return {
        code: "youtube_tracks_unavailable",
        message: `YouTube tracks captured · ${entry.reason}`,
      };
  }

  const youtubeBlob = items.find(
    (item) => item.kind === "blob" && isYouTubeUrl(item.pageUrl),
  );
  if (youtubeBlob)
    return {
      code: "youtube_network_track_missing",
      message:
        "YouTube Blob player found · no googlevideo playback URL was visible to webRequest, page hooks, or Resource Timing.",
    };
  return null;
}

export function formatMediaDetails(item) {
  if (item.kind === "blob" && item.selectedMediaId)
    return resolvedBlobDetails(item);
  if (item.kind === "blob")
    return (
      item.resolutionDiagnostic?.message ||
      (isYouTubeUrl(item.pageUrl)
        ? "Network observation · Blob found · webRequest/page hook/resource timing source missing"
        : null) ||
      (item.relatedCount > 1
        ? `${item.relatedCount} Blob signals · tracing source buffers`
        : item.blobTrace?.appendCount
          ? `${item.blobTrace.appendCount} buffers observed · matching source`
          : "Blob signal · tracing source buffers")
    );
  if (item.kind === "direct") return "Direct video file";
  if (item.kind === "adaptive") return adaptiveDetails(item);
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
    return (
      item.resolutionDiagnostic?.message ||
      "HLS endpoint · watching for a playable stream"
    );

  const facts = [];
  if (item.probeSource === "decrypted_blob") facts.push("Player decrypted");
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

function isYouTubeUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
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
    if (item.kind === "adaptive")
      return (
        readableMediaTitle(item.title) ||
        (item.provider === "youtube" ? "YouTube video" : "Adaptive video")
      );
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
  if (stream.probeSource === "decrypted_blob") facts.push("Player decrypted");
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

function adaptiveDetails(item) {
  const facts = [item.provider === "youtube" ? "YouTube" : "Adaptive media"];
  const videos = (item.variants || []).filter((track) =>
    isAcquirableAdaptiveTrack(item, track),
  );
  const audio = (item.audioTracks || []).filter((track) =>
    isAcquirableAdaptiveTrack(item, track),
  );
  const muxed = videos.some((track) => track.muxed === true);
  const acquisition = item.acquisitionDiagnostic;
  if (!videos.length && !audio.length && acquisition) {
    facts.push(playerAcquisitionLabel(acquisition));
    if (acquisition.descriptorCount)
      facts.push(`${acquisition.descriptorCount} format descriptors`);
    facts.push("direct track URLs unavailable");
    return facts.join(" · ");
  }
  if (videos.length) {
    const best = [...videos].sort(compareVariantQuality)[0];
    facts.push(
      best.resolution?.height
        ? `${best.resolution.height}p`
        : `${videos.length} video track${videos.length === 1 ? "" : "s"}`,
    );
  } else {
    facts.push("waiting for video track");
  }
  facts.push(
    audio.length
      ? `${audio.length} audio`
      : muxed
        ? "audio included"
        : "waiting for audio track",
  );
  if (Number.isFinite(item.duration) && item.duration > 0)
    facts.push(formatDuration(item.duration));
  if (acquisition?.stage === "n_transform_pending")
    facts.push("Helper resolves n");
  if (acquisition?.stage === "signature_cipher_pending")
    facts.push("Helper resolves signature");
  if (hasYouTubeProviderPendingTracks(item))
    facts.push("Helper resolves qualities");
  return facts.join(" · ");
}

function youtubeAcquisitionMessage(diagnostic) {
  if (!diagnostic?.stage) return null;
  const descriptors = diagnostic.descriptorCount
    ? ` · ${diagnostic.descriptorCount} format descriptors`
    : "";
  switch (diagnostic.stage) {
    case "sabr_resolver_pending":
      return `YouTube player response found · SABR endpoint observed${descriptors} · resolver pending.`;
    case "n_transform_pending":
      return `YouTube player response found${descriptors} · n parameter transform pending.`;
    case "signature_cipher_pending":
      return `YouTube player response found${descriptors} · signature decipher pending.`;
    case "format_urls_missing":
      return `YouTube player response found${descriptors} · format URLs are not exposed.`;
    case "streaming_data_missing":
      return "YouTube player response found · streamingData is missing.";
    case "playability_blocked":
      return `YouTube playback is unavailable (${diagnostic.playabilityStatus || "unknown"}).`;
    default:
      return null;
  }
}

function playerAcquisitionLabel(diagnostic) {
  switch (diagnostic.stage) {
    case "sabr_resolver_pending":
      return "Player response · SABR";
    case "n_transform_pending":
      return "Player response · n transform pending";
    case "signature_cipher_pending":
      return "Player response · signature pending";
    case "playability_blocked":
      return `Playback ${diagnostic.playabilityStatus || "blocked"}`;
    default:
      return "Player response";
  }
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
  if (hasStrongDrmEvidence(item)) {
    facts.push(
      `DRM suspected${item.drmSystem ? ` · ${formatDrmSystem(item.drmSystem)}` : ""}`,
      "Playback only",
    );
    return;
  }
  if (hasUnsupportedHlsKeyFormat(item)) {
    const format = item.encryptionKeyFormats
      .map((value) => String(value || "").trim())
      .find((value) => value && value.toLowerCase() !== "identity");
    facts.push(
      `Custom protected HLS${format ? ` · ${format}` : ""}`,
      "Playback only",
    );
    return;
  }
  if (isWeakSampleAesSignal(item)) {
    facts.push(
      isFfmpegCompatibleSampleAes(item)
        ? "Encrypted HLS · SAMPLE-AES · Helper compatible"
        : "SAMPLE-AES signal · DRM not confirmed",
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
    provider: item.provider,
    acquisitionProfile: item.acquisitionProfile,
    probeStatus: item.probeStatus,
    probeError: item.probeError,
    probeDiagnostic: item.probeDiagnostic,
    playlistType: item.playlistType,
    streamType: item.streamType,
    duration: item.duration,
    resolution: item.resolution,
    bandwidth: item.bandwidth,
    averageBandwidth: item.averageBandwidth,
    segmentCount: item.segmentCount,
    partialSegmentCount: item.partialSegmentCount,
    skippedSegmentCount: item.skippedSegmentCount,
    lowLatency: item.lowLatency,
    mediaSequence: item.mediaSequence,
    discontinuitySequence: item.discontinuitySequence,
    revisionId: item.revisionId,
    probeSource: item.probeSource,
    manifestEnvelope: item.manifestEnvelope,
    manifestHandoff: item.manifestHandoff,
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

function samePlaybackFrame(left, right) {
  if (Number.isInteger(left.frameId) && Number.isInteger(right.frameId))
    return left.frameId === right.frameId;
  return Boolean(
    left.frameUrl && right.frameUrl && left.frameUrl === right.frameUrl,
  );
}
