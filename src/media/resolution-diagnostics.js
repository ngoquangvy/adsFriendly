export const MEDIA_RESOLUTION_STAGES = Object.freeze({
  NETWORK_OBSERVATION: "network_observation",
  MANIFEST_PROBE: "manifest_probe",
  CHILD_DISCOVERY: "child_discovery",
  CHILD_PROBE: "child_probe",
  SOURCE_MATCHING: "source_matching",
  DOWNLOAD_READY: "download_ready",
  PLAYBACK_ONLY: "playback_only",
});

export const MEDIA_RESOLUTION_DIAGNOSTIC_STATES = Object.freeze({
  WAITING: "waiting",
  FAILED: "failed",
  UNHANDLED: "unhandled",
  READY: "ready",
  BLOCKED: "blocked",
});

const S = MEDIA_RESOLUTION_STAGES;
const D = MEDIA_RESOLUTION_DIAGNOSTIC_STATES;

export const MEDIA_RESOLUTION_STAGE_CATALOG = Object.freeze({
  [S.NETWORK_OBSERVATION]: stage("Browser media request", "Catalog candidate"),
  [S.MANIFEST_PROBE]: stage("Manifest candidate", "Parsed manifest"),
  [S.CHILD_DISCOVERY]: stage(
    "Master or playback request",
    "Observed child playlist",
  ),
  [S.CHILD_PROBE]: stage("Observed child playlist", "Playable child stream"),
  [S.SOURCE_MATCHING]: stage(
    "Playable child stream + player context",
    "Selected media source",
  ),
  [S.DOWNLOAD_READY]: stage("Selected media source", "Download plan input"),
  [S.PLAYBACK_ONLY]: stage("Protected media metadata", "Playback-only result"),
});

export function diagnoseMediaResolution(item, items = []) {
  const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
  const target =
    item.kind === "blob" && item.selectedMediaId
      ? byId.get(item.selectedMediaId) || item.resolvedStream || item
      : item;
  if (target.kind === "direct")
    return diagnostic(S.DOWNLOAD_READY, D.READY, "direct_ready", {
      message: "Download ready · direct media",
    });
  if (target.kind === "blob")
    return diagnostic(S.NETWORK_OBSERVATION, D.WAITING, "blob_source_missing", {
      message: "Network observation · Blob found · source request missing",
    });
  if (!["hls", "dash"].includes(target.kind))
    return diagnostic(S.NETWORK_OBSERVATION, D.UNHANDLED, "media_unhandled", {
      message: "Network observation · media type not handled",
    });
  if (["suspected", "confirmed"].includes(target.drm))
    return diagnostic(S.PLAYBACK_ONLY, D.BLOCKED, "drm_playback_only", {
      message: "Playback only · DRM protected",
    });
  if (target.kind === "dash") return diagnoseDash(target);
  if (
    target.resolutionStatus === "resolved" ||
    (target.probeStatus === "ready" &&
      target.playlistType === "media" &&
      target.streamType === "vod" &&
      target.segmentCount > 0)
  )
    return diagnostic(S.DOWNLOAD_READY, D.READY, "hls_ready", {
      message: "Download ready · HLS VOD resolved",
    });

  if (target.probeStatus === "unsupported")
    return diagnostic(
      S.MANIFEST_PROBE,
      D.UNHANDLED,
      "hls_manifest_unsupported",
      { message: "Manifest probe · HLS format not handled" },
    );

  const children = findObservedChildren(target, items);
  const readyChildren = children.filter(isUsableChild);
  const failedChildren = children.filter(
    (candidate) => candidate.probeStatus === "failed",
  );
  const facts = {
    observedChildCount: children.length,
    readyChildCount: readyChildren.length,
    failedChildCount: failedChildren.length,
    masterProbeStatus: target.probeStatus || "discovered",
    masterProbeError: target.probeError || null,
  };

  if (!children.length) {
    const masterFailure = formatProbeFailure(target);
    if (target.probeStatus !== "failed" && target.playlistType !== "master") {
      return diagnostic(S.MANIFEST_PROBE, D.WAITING, "hls_probe_pending", {
        ...facts,
        message: "Manifest probe · HLS response not parsed yet",
      });
    }
    return diagnostic(
      S.CHILD_DISCOVERY,
      target.probeStatus === "failed" ? D.FAILED : D.WAITING,
      target.probeStatus === "failed"
        ? "master_failed_child_not_observed"
        : "child_request_not_observed",
      {
        ...facts,
        message: `Child discovery · 0 child playlists${masterFailure ? ` · ${masterFailure}` : ""}`,
      },
    );
  }
  if (readyChildren.length && !target.selectedMediaId) {
    return diagnostic(S.SOURCE_MATCHING, D.WAITING, "child_ready_not_matched", {
      ...facts,
      message: `Source matching · ${readyChildren.length} child ready · not linked to player`,
    });
  }
  if (failedChildren.length === children.length) {
    return diagnostic(S.CHILD_PROBE, D.FAILED, "child_probe_failed", {
      ...facts,
      message: `Child probe · ${failedChildren.length} failed · ${formatProbeFailure(failedChildren[0]) || "request rejected"}`,
    });
  }
  return diagnostic(S.CHILD_PROBE, D.WAITING, "child_observed_probe_pending", {
    ...facts,
    message: `Child probe · ${children.length} observed · manifest not parsed`,
  });
}

function diagnoseDash(item) {
  if (item.probeStatus === "failed")
    return diagnostic(S.MANIFEST_PROBE, D.FAILED, "dash_probe_failed", {
      message: `Manifest probe · DASH failed${item.probeError ? ` · ${item.probeError}` : ""}`,
    });
  if (item.probeStatus !== "ready")
    return diagnostic(S.MANIFEST_PROBE, D.WAITING, "dash_probe_pending", {
      message: "Manifest probe · DASH tracks not parsed",
    });
  return diagnostic(S.DOWNLOAD_READY, D.READY, "dash_ready", {
    message: "Download ready · DASH tracks resolved",
  });
}

function findObservedChildren(parent, items) {
  const explicitIds = new Set(parent.childManifestIds || []);
  return items.filter((candidate) => {
    if (candidate.kind !== "hls" || candidate.id === parent.id) return false;
    if (
      explicitIds.has(candidate.id) ||
      candidate.parentManifestIds?.includes(parent.id)
    )
      return true;
    if (!sameFrame(parent, candidate)) return false;
    const parentAt = parent.firstSeenAt || parent.lastSeenAt;
    const childAt = candidate.firstSeenAt || candidate.lastSeenAt;
    return (
      Number.isFinite(parentAt) &&
      Number.isFinite(childAt) &&
      Math.abs(parentAt - childAt) <= 60_000
    );
  });
}

function isUsableChild(item) {
  return (
    item.probeStatus === "ready" &&
    item.playlistType === "media" &&
    ["vod", "live"].includes(item.streamType) &&
    (item.segmentCount > 0 || item.partialSegmentCount > 0)
  );
}

function sameFrame(left, right) {
  return (
    Number.isInteger(left.frameId) &&
    Number.isInteger(right.frameId) &&
    left.frameId === right.frameId
  );
}

function formatProbeFailure(item) {
  if (item.probeError === "manifest_http_403") return "master probe 403";
  if (item.probeError === "fallback_fetch_blocked")
    return "probe blocked by page/CORS";
  if (item.probeStatus === "failed") return "manifest probe failed";
  return null;
}

function diagnostic(stage, status, code, facts = {}) {
  const contract = MEDIA_RESOLUTION_STAGE_CATALOG[stage];
  return Object.freeze({
    stage,
    status,
    code,
    input: contract.input,
    output: contract.output,
    ...facts,
  });
}

function stage(input, output) {
  return Object.freeze({ input, output });
}
