export const MEDIA_RESOLUTION_STRATEGIES = Object.freeze({
  CAPTURED_RESPONSE: "captured_response",
  OBSERVED_CHILD: "observed_child",
  PLAYER_API: "player_api",
  CONTEXTUAL_PROBE: "contextual_probe",
  BOUNDED_URL_ADAPTER: "bounded_url_adapter",
});

const S = MEDIA_RESOLUTION_STRATEGIES;

export const MEDIA_RESOLUTION_STRATEGY_CATALOG = Object.freeze([
  strategy(S.CAPTURED_RESPONSE, 100, 0, "passive"),
  strategy(S.OBSERVED_CHILD, 90, 0, "passive"),
  strategy(S.PLAYER_API, 80, 0, "passive"),
  strategy(S.CONTEXTUAL_PROBE, 60, 1, "active"),
  strategy(S.BOUNDED_URL_ADAPTER, 40, 3, "active"),
]);

const STRATEGY_BY_ID = new Map(
  MEDIA_RESOLUTION_STRATEGY_CATALOG.map((definition) => [
    definition.id,
    definition,
  ]),
);

validateCatalog();

export function getMediaResolutionStrategy(strategyId) {
  const definition = STRATEGY_BY_ID.get(strategyId);
  if (!definition) {
    throw new Error(
      `[MediaResolution] Unknown strategy "${strategyId}". Register it in resolution-strategy-catalog.js before use.`,
    );
  }
  return definition;
}

export function findPassiveHlsChildMatches(
  items = [],
  { maximumAgeMs = 60_000 } = {},
) {
  const playerCandidateIds = new Set(
    items
      .filter((item) => item.kind === "blob")
      .flatMap((item) => item.blobTrace?.candidateIds || []),
  );
  const children = items.filter(isUsableMediaPlaylist);
  const matches = [];

  for (const parent of items.filter(needsPassiveChild)) {
    const ranked = children
      .filter((child) => child.id !== parent.id)
      .map((child) =>
        passiveMatch(parent, child, playerCandidateIds, maximumAgeMs),
      )
      .filter(Boolean)
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          (right.child.duration || 0) - (left.child.duration || 0) ||
          (right.child.lastSeenAt || 0) - (left.child.lastSeenAt || 0),
      );
    const selected = ranked[0];
    if (!selected || selected.confidence < 0.8) continue;
    const alternative = ranked[1];
    if (
      alternative &&
      selected.confidence - alternative.confidence < 0.08 &&
      !selected.evidence.includes("player-linked")
    ) {
      continue;
    }
    matches.push({
      parentId: parent.id,
      childId: selected.child.id,
      strategyId: S.OBSERVED_CHILD,
      confidence: selected.confidence,
      evidence: selected.evidence,
    });
  }
  return matches;
}

function passiveMatch(parent, child, playerCandidateIds, maximumAgeMs) {
  if (!sameFrame(parent, child) || !sameOrigin(parent, child)) return null;
  const age = observationDistance(parent, child);
  if (!Number.isFinite(age) || age > maximumAgeMs) return null;

  const evidence = ["same-frame", "same-origin"];
  let confidence = 0.65;
  if (age <= 15_000) {
    confidence += 0.1;
    evidence.push("nearby-observation");
  }
  if (sharedPathPrefix(parent.manifestUrl, child.manifestUrl)) {
    confidence += 0.1;
    evidence.push("shared-path");
  }
  if (
    playerCandidateIds.has(child.id) ||
    child.detectionSources?.includes("player")
  ) {
    confidence += 0.15;
    evidence.push("player-linked");
  }
  if (Number.isFinite(child.duration) && child.duration >= 60) {
    confidence += 0.05;
    evidence.push("content-duration");
  }
  return {
    child,
    confidence: Math.min(1, Number(confidence.toFixed(2))),
    evidence,
  };
}

function needsPassiveChild(item) {
  if (item.kind !== "hls") return false;
  if (isUsableMediaPlaylist(item)) return false;
  return (
    item.probeStatus === "discovered" ||
    item.probeStatus === "failed" ||
    item.playlistType === "unknown" ||
    (item.playlistType === "master" && !item.variants?.length)
  );
}

function isUsableMediaPlaylist(item) {
  return (
    item.kind === "hls" &&
    item.probeStatus === "ready" &&
    item.playlistType === "media" &&
    ["vod", "live"].includes(item.streamType) &&
    ((item.segmentCount || 0) > 0 || (item.partialSegmentCount || 0) > 0)
  );
}

function sameFrame(left, right) {
  if (Number.isInteger(left.frameId) && Number.isInteger(right.frameId)) {
    return left.frameId === right.frameId;
  }
  const leftUrl = normalizedDocumentUrl(left.frameUrl);
  const rightUrl = normalizedDocumentUrl(right.frameUrl);
  return Boolean(leftUrl && rightUrl && leftUrl === rightUrl);
}

function sameOrigin(left, right) {
  try {
    return new URL(left.manifestUrl).origin === new URL(right.manifestUrl).origin;
  } catch {
    return false;
  }
}

function observationDistance(left, right) {
  const leftAt = left.firstSeenAt || left.lastSeenAt;
  const rightAt = right.firstSeenAt || right.lastSeenAt;
  return Number.isFinite(leftAt) && Number.isFinite(rightAt)
    ? Math.abs(leftAt - rightAt)
    : Infinity;
}

function sharedPathPrefix(left, right) {
  try {
    const leftParts = new URL(left).pathname.split("/").filter(Boolean);
    const rightParts = new URL(right).pathname.split("/").filter(Boolean);
    let shared = 0;
    while (
      shared < leftParts.length &&
      shared < rightParts.length &&
      leftParts[shared] === rightParts[shared]
    ) {
      shared += 1;
    }
    return shared >= 2;
  } catch {
    return false;
  }
}

function normalizedDocumentUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function strategy(id, priority, maximumExtraRequests, trigger) {
  return Object.freeze({ id, priority, maximumExtraRequests, trigger });
}

function validateCatalog() {
  const ids = Object.values(MEDIA_RESOLUTION_STRATEGIES);
  if (new Set(ids).size !== ids.length) {
    throw new Error("[MediaResolution] Duplicate strategy ID.");
  }
  for (const id of ids) {
    const definition = STRATEGY_BY_ID.get(id);
    if (!definition || definition.id !== id) {
      throw new Error(`[MediaResolution] Strategy "${id}" is not registered.`);
    }
  }
}
