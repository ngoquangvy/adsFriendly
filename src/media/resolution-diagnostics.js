import {
  hasStrongDrmEvidence,
  isFfmpegCompatibleSampleAes,
  isWeakSampleAesSignal,
} from "./protection-policy.js";

export const MEDIA_RESOLUTION_STAGES = Object.freeze({
  NETWORK_OBSERVATION: "network_observation",
  MANIFEST_PROBE: "manifest_probe",
  CHILD_DISCOVERY: "child_discovery",
  CHILD_PROBE: "child_probe",
  SOURCE_MATCHING: "source_matching",
  PLAYER_DECRYPTION: "player_decryption",
  PLAYER_SEGMENT_RESOLUTION: "player_segment_resolution",
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
  [S.PLAYER_DECRYPTION]: stage(
    "Encrypted manifest + player Blob",
    "Parsed plaintext manifest",
  ),
  [S.PLAYER_SEGMENT_RESOLUTION]: stage(
    "SAMPLE-AES candidate + player playback",
    "Resolved media segment sequence",
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
  if (hasStrongDrmEvidence(target))
    return diagnostic(S.PLAYBACK_ONLY, D.BLOCKED, "drm_playback_only", {
      message: "Playback only · DRM protected",
    });
  if (
    target.probeStatus === "ready" &&
    isWeakSampleAesSignal(target) &&
    !isFfmpegCompatibleSampleAes(target)
  )
    return diagnostic(
      S.PLAYER_SEGMENT_RESOLUTION,
      D.WAITING,
      "sample_aes_player_segments_pending",
      {
        message: "Player URL resolution · waiting for resolved media segments",
      },
    );
  if (target.kind === "dash") return diagnoseDash(target);
  if (
    target.probeSource === "decrypted_blob" &&
    !(Number(target.manifestHandoff?.expiresAt) > Date.now())
  )
    return diagnostic(
      S.PLAYER_DECRYPTION,
      D.UNHANDLED,
      "decrypted_manifest_handoff_pending",
      {
        message:
          "Player decryption · manifest parsed · download handoff pending",
      },
    );
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

  const latestTargetProbe = latestProbeDiagnostic([target]);
  if (latestTargetProbe?.code?.startsWith("contextual_probe_")) {
    const described = describeProbeDiagnostic(latestTargetProbe);
    return diagnostic(S.MANIFEST_PROBE, described.status, described.code, {
      probeDiagnostic: latestTargetProbe,
      message: `Manifest probe · ${described.message}`,
    });
  }

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
  const latestChildProbe = latestProbeDiagnostic(children);
  if (latestChildProbe) {
    const described = describeProbeDiagnostic(latestChildProbe);
    return diagnostic(S.CHILD_PROBE, described.status, described.code, {
      ...facts,
      probeDiagnostic: latestChildProbe,
      message: `Child probe · ${described.message}`,
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

function latestProbeDiagnostic(items) {
  return items
    .flatMap((item) => item.probeDiagnostics || [item.probeDiagnostic])
    .filter(Boolean)
    .sort((left, right) => (right.observedAt || 0) - (left.observedAt || 0))[0];
}

function describeProbeDiagnostic(diagnostic) {
  const code = diagnostic.code || "probe_status_unknown";
  if (code === "iframe_probe_scheduled")
    return described(D.WAITING, code, "scheduled in player frame");
  if (code === "manifest_fetch_dispatched")
    return described(D.WAITING, code, "request sent · waiting for response");
  if (code === "contextual_probe_prepared")
    return described(
      D.WAITING,
      code,
      "Referer/Origin prepared · retry starting",
    );
  if (code === "contextual_manifest_fetch_dispatched")
    return described(
      D.WAITING,
      code,
      "contextual request sent · waiting for response",
    );
  if (code.startsWith("contextual_probe_"))
    return described(
      D.FAILED,
      code,
      `context setup failed · ${code.slice("contextual_probe_".length)}`,
    );
  if (code === "content_duplicate")
    return described(D.WAITING, code, "duplicate schedule skipped");
  if (code === "probe_gate_duplicate")
    return described(D.WAITING, code, "probe already in progress or completed");
  if (code === "manifest_probe_timeout")
    return described(D.FAILED, code, "timed out after 10s");
  if (/^manifest_http_\d+$/.test(code))
    return described(
      D.FAILED,
      code,
      `HTTP ${diagnostic.httpStatus || code.split("_").at(-1)}`,
    );
  if (code === "fallback_fetch_blocked")
    return described(D.FAILED, code, "request blocked by page/CORS");
  if (code === "manifest_body_received")
    return described(
      D.WAITING,
      code,
      `${formatBodySize(diagnostic.bodyBytes)} body received · ${diagnostic.bodyFormat || "unknown"} format · parser pending`,
    );
  if (code === "manifest_parsed_zero_segments")
    return described(
      D.UNHANDLED,
      code,
      `${formatBodySize(diagnostic.bodyBytes)} ${diagnostic.bodyFormat || "unknown"} parsed · 0 segments`,
    );
  if (code === "manifest_parsed_no_stream")
    return described(
      D.UNHANDLED,
      code,
      `${formatBodySize(diagnostic.bodyBytes)} body parsed · no playable stream`,
    );
  if (code === "manifest_unsupported")
    return described(D.UNHANDLED, code, "body received · format unsupported");
  if (code === "manifest_parsed")
    return described(
      D.WAITING,
      code,
      `${diagnostic.playlistType || "manifest"} parsed · ${diagnostic.segmentCount || 0} segments · matching pending`,
    );
  if (code === "decrypted_manifest_blob_observed")
    return described(
      D.WAITING,
      code,
      `player decrypted ${diagnostic.bodyFormat || "manifest"} · parser pending`,
    );
  if (code === "decrypted_manifest_parsed")
    return described(
      D.READY,
      code,
      `player-decrypted ${diagnostic.playlistType || "manifest"} parsed · ${diagnostic.segmentCount || 0} segments`,
    );
  if (code === "decrypted_manifest_zero_segments")
    return described(
      D.UNHANDLED,
      code,
      "player-decrypted manifest · 0 segments",
    );
  if (code === "decrypted_manifest_no_stream")
    return described(
      D.UNHANDLED,
      code,
      "player-decrypted manifest · no playable stream",
    );
  if (code === "decrypted_manifest_unsupported")
    return described(D.UNHANDLED, code, "player-decrypted format unsupported");
  if (code === "decrypted_manifest_parse_failed")
    return described(D.FAILED, code, "player-decrypted manifest parse failed");
  return described(
    diagnostic.phase === "failed" ? D.FAILED : D.WAITING,
    code,
    code.replaceAll("_", " "),
  );
}

function described(status, code, message) {
  return { status, code, message };
}

function formatBodySize(bytes) {
  if (!Number.isFinite(bytes)) return "Unknown-size";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
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
