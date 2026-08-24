export function resolveHlsSources(items = []) {
  const annotations = new Map(
    items.map((item) => [
      item.id,
      {
        parents: new Set(),
        children: new Set(),
        edges: [],
      },
    ]),
  );
  const byManifestUrl = new Map(
    items
      .filter((item) => item.kind === "hls" && item.manifestUrl)
      .map((item) => [normalizeUrl(item.manifestUrl), item]),
  );

  for (const parent of items) {
    if (parent.kind !== "hls") continue;
    if (parent.playlistType === "master") {
      addEdges(parent, parent.variants, "variant");
      addEdges(parent, parent.audioTracks, "audio");
      addEdges(parent, parent.subtitles, "subtitles");
    }
    for (const context of parent.requestContexts || []) {
      const source = byManifestUrl.get(normalizeUrl(context.requestUrl));
      if (source && source.id !== parent.id) {
        connect(source, parent, "redirect", null);
      }
    }
  }

  const resolved = new Map();
  for (const item of items) {
    const relation = annotations.get(item.id);
    if (item.kind !== "hls") {
      resolved.set(item.id, emptyResolution(relation));
      continue;
    }
    const streams = collectMediaStreams(item, annotations, items);
    const selected = streams.sort(compareResolvedStreams)[0] || null;
    resolved.set(item.id, {
      parents: relation.parents,
      children: relation.children,
      resolutionStatus: resolutionStatus(item, selected),
      resolvedMediaIds: [...new Set(streams.map((stream) => stream.item.id))],
      selectedMediaId: selected?.item.id || null,
      resolvedStream: selected ? summarizeStream(selected) : null,
      resolvedRequestContext: selected
        ? chooseRequestContext(selected.item.requestContexts)
        : chooseRequestContext(item.requestContexts),
    });
  }
  return resolved;

  function addEdges(parent, entries = [], kind) {
    for (const entry of entries || []) {
      const child = byManifestUrl.get(normalizeUrl(entry.url));
      if (child && child.id !== parent.id) connect(parent, child, kind, entry);
    }
  }

  function connect(parent, child, kind, metadata) {
    const parentRelation = annotations.get(parent.id);
    const childRelation = annotations.get(child.id);
    if (!parentRelation || !childRelation) return;
    if (
      parentRelation.edges.some(
        (edge) => edge.childId === child.id && edge.kind === kind,
      )
    )
      return;
    parentRelation.children.add(child.id);
    childRelation.parents.add(parent.id);
    parentRelation.edges.push({ childId: child.id, kind, metadata });
  }
}

export function chooseRequestContext(contexts = []) {
  return (
    [...contexts]
      .filter((context) => context && typeof context === "object")
      .sort(
        (left, right) =>
          Number(right.requiresBrowserSession) -
            Number(left.requiresBrowserSession) ||
          (right.observedAt || 0) - (left.observedAt || 0),
      )[0] || null
  );
}

function collectMediaStreams(root, annotations, items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const streams = [];
  const visited = new Set();

  const visit = (item, quality = null) => {
    const visitKey = `${item.id}:${quality?.height || 0}:${quality?.bandwidth || 0}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    if (item.playlistType === "media") {
      streams.push({ item, quality, readiness: mediaReadiness(item) });
      return;
    }
    for (const edge of annotations.get(item.id)?.edges || []) {
      if (!["variant", "redirect"].includes(edge.kind)) continue;
      const child = byId.get(edge.childId);
      if (!child) continue;
      visit(
        child,
        edge.kind === "variant" ? variantQuality(edge.metadata) : quality,
      );
    }
  };

  visit(root);
  return streams;
}

function mediaReadiness(item) {
  if (
    ["suspected", "confirmed"].includes(item.drm) ||
    item.encryptionMethods?.length
  )
    return "protected";
  if (item.streamType === "vod" && item.segmentCount > 0) return "vod";
  if (
    item.streamType === "live" &&
    (item.segmentCount > 0 || item.partialSegmentCount > 0)
  )
    return "live";
  return "waiting";
}

function resolutionStatus(item, selected) {
  if (selected?.readiness === "vod")
    return selected.item.id === item.id ? "ready" : "resolved";
  if (selected?.readiness === "live") return "live";
  if (selected?.readiness === "protected") return "protected";
  return "waiting";
}

function compareResolvedStreams(left, right) {
  const readinessRank = { vod: 4, live: 3, protected: 2, waiting: 1 };
  return (
    (readinessRank[right.readiness] || 0) -
      (readinessRank[left.readiness] || 0) ||
    (right.quality?.height || 0) - (left.quality?.height || 0) ||
    (right.quality?.bandwidth || 0) - (left.quality?.bandwidth || 0) ||
    (right.item.segmentCount || 0) - (left.item.segmentCount || 0)
  );
}

function summarizeStream(stream) {
  const { item, quality, readiness } = stream;
  return {
    id: item.id,
    manifestUrl: item.manifestUrl,
    readiness,
    streamType: item.streamType,
    duration: item.duration,
    segmentCount: item.segmentCount,
    partialSegmentCount: item.partialSegmentCount,
    lowLatency: item.lowLatency === true,
    drm: item.drm,
    encryptionMethods: [...(item.encryptionMethods || [])],
    resolution: quality?.resolution || null,
    bandwidth: quality?.bandwidth || null,
  };
}

function variantQuality(variant = {}) {
  return {
    resolution: variant.resolution || null,
    height: variant.resolution?.height || 0,
    bandwidth: variant.averageBandwidth || variant.bandwidth || 0,
  };
}

function emptyResolution(relation) {
  return {
    parents: relation.parents,
    children: relation.children,
    resolutionStatus: null,
    resolvedMediaIds: [],
    selectedMediaId: null,
    resolvedStream: null,
    resolvedRequestContext: null,
  };
}

function normalizeUrl(value) {
  try {
    return new URL(value).href;
  } catch {
    return typeof value === "string" ? value : "";
  }
}
