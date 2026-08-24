import { parseHlsAttributeList, parseHlsManifest } from "./hls-parser.js";

const MAX_DOWNLOAD_RESOURCES = 10_000;

export function createHlsDownloadPlan(manifestUrl, body) {
  const summary = parseHlsManifest(manifestUrl, body);
  if (summary.status !== "ready") {
    return unsupported(summary.error || "manifest_not_ready", summary);
  }
  if (summary.playlistType === "master") {
    return {
      status: "variant_required",
      reason: null,
      summary,
      resources: [],
    };
  }
  if (summary.streamType !== "vod")
    return unsupported("live_not_supported", summary);
  if (summary.drm !== "none") return unsupported("drm_suspected", summary);
  if (summary.encryptionMethods.length)
    return unsupported("encrypted_not_supported", summary);

  const lines = String(body)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const resources = [];
  let currentMap = null;
  let emittedMapKey = null;
  let pendingDuration = null;
  let pendingByteRange = null;
  let previousRangeUrl = null;
  let previousRangeEnd = 0;
  let discontinuityCount = 0;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("#EXT-X-MAP:")) {
      const attributes = parseHlsAttributeList(valueAfterColon(line));
      if (!attributes.URI) return unsupported("invalid_init_map", summary);
      const url = resolveUrl(attributes.URI, manifestUrl);
      currentMap = {
        kind: "init",
        url,
        byteRange: parseByteRange(attributes.BYTERANGE, 0),
        duration: 0,
      };
      continue;
    }
    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      pendingByteRange = valueAfterColon(line);
      continue;
    }
    if (line === "#EXT-X-DISCONTINUITY") {
      discontinuityCount += 1;
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      const value = Number(valueAfterColon(line).split(",", 1)[0]);
      pendingDuration = Number.isFinite(value) && value >= 0 ? value : 0;
      continue;
    }
    if (line.startsWith("#") || pendingDuration === null) continue;

    const url = resolveUrl(line, manifestUrl);
    if (currentMap) {
      const mapKey = resourceKey(currentMap);
      if (mapKey !== emittedMapKey) {
        resources.push({ ...currentMap, index: resources.length });
        emittedMapKey = mapKey;
      }
    }
    const implicitOffset = previousRangeUrl === url ? previousRangeEnd : 0;
    const byteRange = parseByteRange(pendingByteRange, implicitOffset);
    if (byteRange) {
      previousRangeUrl = url;
      previousRangeEnd = byteRange.offset + byteRange.length;
    } else {
      previousRangeUrl = null;
      previousRangeEnd = 0;
    }
    resources.push({
      index: resources.length,
      kind: "segment",
      url,
      byteRange,
      duration: pendingDuration,
    });
    if (resources.length > MAX_DOWNLOAD_RESOURCES)
      return unsupported("too_many_segments", summary);
    pendingDuration = null;
    pendingByteRange = null;
  }

  if (discontinuityCount)
    return unsupported("discontinuity_not_supported", summary);
  const segmentCount = resources.filter(
    (resource) => resource.kind === "segment",
  ).length;
  if (!segmentCount) return unsupported("no_segments", summary);
  const fragmentedMp4 = resources.some(
    (resource) =>
      resource.kind === "init" || /\.(m4s|mp4)(?:$|[?#])/i.test(resource.url),
  );
  return {
    status: "ready",
    reason: null,
    summary,
    resources,
    segmentCount,
    outputExtension: fragmentedMp4 ? "mp4" : "ts",
    outputMimeType: fragmentedMp4 ? "video/mp4" : "video/mp2t",
  };
}

function unsupported(reason, summary) {
  return { status: "unsupported", reason, summary, resources: [] };
}

function parseByteRange(value, implicitOffset) {
  if (!value) return null;
  const match = /^(\d+)(?:@(\d+))?$/.exec(String(value).trim());
  if (!match) throw new Error("[HLS Download] Invalid byte range.");
  const length = Number(match[1]);
  const offset = match[2] === undefined ? implicitOffset : Number(match[2]);
  if (!Number.isSafeInteger(length) || length <= 0)
    throw new Error("[HLS Download] Invalid byte-range length.");
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("[HLS Download] Invalid byte-range offset.");
  return { offset, length };
}

function valueAfterColon(line) {
  return line.slice(line.indexOf(":") + 1);
}

function resolveUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.href;
  } catch {
    throw new Error("[HLS Download] Resource URL must be HTTP(S).");
  }
}

function resourceKey(resource) {
  return `${resource.url}:${resource.byteRange?.offset ?? ""}:${
    resource.byteRange?.length ?? ""
  }`;
}
