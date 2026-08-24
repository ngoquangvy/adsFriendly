const MAX_MANIFEST_LENGTH = 2 * 1024 * 1024;
const MAX_LINES = 20_000;
const MAX_VARIANTS = 100;
const MAX_TRACKS = 100;

export function parseHlsManifest(manifestUrl, body) {
  const source = typeof body === "string" ? body.replace(/^\uFEFF/, "") : "";
  if (!source.trimStart().startsWith("#EXTM3U")) {
    return unsupported("not_hls_manifest");
  }
  if (source.length > MAX_MANIFEST_LENGTH) {
    return unsupported("manifest_too_large");
  }

  const lines = source.split(/\r?\n/).map((line) => line.trim());
  if (lines.length > MAX_LINES) return unsupported("too_many_manifest_lines");

  try {
    const variants = [];
    const iframeVariants = [];
    const audioTracks = [];
    const subtitles = [];
    const encryptionMethods = new Set();
    let pendingVariant = null;
    let pendingSegmentDuration = null;
    let segmentCount = 0;
    let partialSegmentCount = 0;
    let skippedSegmentCount = 0;
    let duration = 0;
    let targetDuration = null;
    let mediaSequence = null;
    let discontinuitySequence = null;
    let hasEndList = false;
    let declaredPlaylistType = null;
    let hasMediaEvidence = false;
    let hasLowLatencyTag = false;

    for (const line of lines) {
      if (!line) continue;
      if (pendingVariant && !line.startsWith("#")) {
        if (variants.length < MAX_VARIANTS) {
          variants.push(normalizeVariant(pendingVariant, line, manifestUrl));
        }
        pendingVariant = null;
        continue;
      }
      if (pendingSegmentDuration !== null && !line.startsWith("#")) {
        duration += pendingSegmentDuration;
        segmentCount += 1;
        pendingSegmentDuration = null;
        continue;
      }
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        pendingVariant = parseAttributeList(valueAfterColon(line));
        continue;
      }
      if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF:")) {
        const attributes = parseAttributeList(valueAfterColon(line));
        if (attributes.URI && iframeVariants.length < MAX_VARIANTS) {
          iframeVariants.push(
            normalizeVariant(attributes, attributes.URI, manifestUrl, true),
          );
        }
        continue;
      }
      if (line.startsWith("#EXT-X-MEDIA:")) {
        const track = normalizeTrack(
          parseAttributeList(valueAfterColon(line)),
          manifestUrl,
        );
        if (!track) continue;
        if (track.type === "audio" && audioTracks.length < MAX_TRACKS)
          audioTracks.push(track);
        if (track.type === "subtitles" && subtitles.length < MAX_TRACKS)
          subtitles.push(track);
        continue;
      }
      if (
        line.startsWith("#EXT-X-KEY:") ||
        line.startsWith("#EXT-X-SESSION-KEY:")
      ) {
        const method = parseAttributeList(valueAfterColon(line)).METHOD;
        if (method && method.toUpperCase() !== "NONE")
          encryptionMethods.add(method.toUpperCase());
        continue;
      }
      if (line.startsWith("#EXTINF:")) {
        const value = Number(valueAfterColon(line).split(",", 1)[0]);
        pendingSegmentDuration =
          Number.isFinite(value) && value >= 0 ? value : 0;
        hasMediaEvidence = true;
        continue;
      }
      if (line.startsWith("#EXT-X-PART:")) {
        partialSegmentCount += 1;
        hasMediaEvidence = true;
        hasLowLatencyTag = true;
        continue;
      }
      if (
        line.startsWith("#EXT-X-PART-INF:") ||
        line.startsWith("#EXT-X-SERVER-CONTROL:")
      ) {
        hasMediaEvidence = true;
        hasLowLatencyTag = true;
        continue;
      }
      if (line.startsWith("#EXT-X-PRELOAD-HINT:")) {
        const type = parseAttributeList(valueAfterColon(line)).TYPE;
        hasMediaEvidence = true;
        if (String(type || "").toUpperCase() === "PART")
          hasLowLatencyTag = true;
        continue;
      }
      if (line.startsWith("#EXT-X-SKIP:")) {
        const skipped = Number(
          parseAttributeList(valueAfterColon(line))["SKIPPED-SEGMENTS"],
        );
        if (Number.isInteger(skipped) && skipped >= 0)
          skippedSegmentCount = skipped;
        hasMediaEvidence = true;
        continue;
      }
      if (line.startsWith("#EXT-X-TARGETDURATION:")) {
        const value = Number(valueAfterColon(line));
        if (Number.isFinite(value) && value >= 0) targetDuration = value;
        hasMediaEvidence = true;
        continue;
      }
      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        mediaSequence = optionalNonNegativeInteger(valueAfterColon(line));
        hasMediaEvidence = true;
        continue;
      }
      if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) {
        discontinuitySequence = optionalNonNegativeInteger(
          valueAfterColon(line),
        );
        hasMediaEvidence = true;
        continue;
      }
      if (line.startsWith("#EXT-X-MAP:")) {
        hasMediaEvidence = true;
        continue;
      }
      if (line === "#EXT-X-ENDLIST") {
        hasEndList = true;
        hasMediaEvidence = true;
        continue;
      }
      if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
        declaredPlaylistType = valueAfterColon(line).toUpperCase();
        hasMediaEvidence = true;
      }
    }

    const hasMasterEvidence =
      variants.length > 0 ||
      iframeVariants.length > 0 ||
      ((audioTracks.length > 0 || subtitles.length > 0) && !hasMediaEvidence);
    const playlistType = hasMasterEvidence
      ? "master"
      : hasMediaEvidence
        ? "media"
        : "unknown";
    const streamType =
      playlistType === "master"
        ? null
        : playlistType === "unknown"
          ? "unknown"
          : hasEndList || declaredPlaylistType === "VOD"
            ? "vod"
            : segmentCount > 0 ||
                partialSegmentCount > 0 ||
                targetDuration !== null ||
                declaredPlaylistType === "EVENT"
              ? "live"
              : "unknown";
    const methods = [...encryptionMethods];
    return {
      status: "ready",
      error: null,
      playlistType,
      streamType,
      variants,
      iframeVariants,
      audioTracks,
      subtitles,
      duration: playlistType === "media" ? round(duration, 3) : null,
      targetDuration: playlistType === "media" ? targetDuration : null,
      segmentCount: playlistType === "media" ? segmentCount : null,
      partialSegmentCount:
        playlistType === "media" ? partialSegmentCount : null,
      skippedSegmentCount:
        playlistType === "media" ? skippedSegmentCount : null,
      lowLatency: playlistType === "media" && hasLowLatencyTag,
      mediaSequence: playlistType === "media" ? mediaSequence : null,
      discontinuitySequence:
        playlistType === "media" ? discontinuitySequence : null,
      revisionId: stableTextId(source),
      encryptionMethods: methods,
      drm: methods.some(isDrmLikeMethod) ? "suspected" : "none",
    };
  } catch (error) {
    return {
      ...unsupported("manifest_parse_failed"),
      status: "failed",
      error: error?.message || "Could not parse HLS manifest.",
    };
  }
}

export function parseHlsAttributeList(value = "") {
  return parseAttributeList(value);
}

function normalizeVariant(attributes, uri, manifestUrl, iframeOnly = false) {
  const bandwidth = optionalPositiveNumber(attributes.BANDWIDTH);
  const averageBandwidth = optionalPositiveNumber(
    attributes["AVERAGE-BANDWIDTH"],
  );
  return {
    id: stableVariantId(uri, bandwidth, attributes.RESOLUTION),
    url: resolveUrl(uri, manifestUrl),
    bandwidth,
    averageBandwidth,
    resolution: parseResolution(attributes.RESOLUTION),
    codecs: optionalText(attributes.CODECS),
    frameRate: optionalPositiveNumber(attributes["FRAME-RATE"]),
    audioGroup: optionalText(attributes.AUDIO),
    subtitlesGroup: optionalText(attributes.SUBTITLES),
    iframeOnly,
  };
}

function normalizeTrack(attributes, manifestUrl) {
  const type = String(attributes.TYPE || "").toLowerCase();
  if (!["audio", "subtitles"].includes(type)) return null;
  const name = optionalText(attributes.NAME);
  const groupId = optionalText(attributes["GROUP-ID"]);
  return {
    id: stableVariantId(attributes.URI || name || type, null, groupId),
    type,
    groupId,
    name,
    language: optionalText(attributes.LANGUAGE),
    url: attributes.URI ? resolveUrl(attributes.URI, manifestUrl) : null,
    default: yesNo(attributes.DEFAULT),
    autoselect: yesNo(attributes.AUTOSELECT),
    forced: yesNo(attributes.FORCED),
    channels: optionalText(attributes.CHANNELS),
  };
}

function parseAttributeList(value) {
  const attributes = {};
  let index = 0;
  while (index < value.length) {
    while (value[index] === "," || /\s/.test(value[index] || "")) index++;
    const equals = value.indexOf("=", index);
    if (equals < 0) break;
    const key = value.slice(index, equals).trim().toUpperCase();
    index = equals + 1;
    let parsed = "";
    if (value[index] === '"') {
      index++;
      while (index < value.length) {
        const character = value[index++];
        if (character === '"') break;
        parsed += character;
      }
    } else {
      const comma = value.indexOf(",", index);
      const end = comma < 0 ? value.length : comma;
      parsed = value.slice(index, end).trim();
      index = end;
    }
    if (key) attributes[key] = parsed;
    while (index < value.length && value[index] !== ",") index++;
    if (value[index] === ",") index++;
  }
  return attributes;
}

function parseResolution(value) {
  const match = /^(\d+)x(\d+)$/i.exec(String(value || "").trim());
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function unsupported(error) {
  return {
    status: "unsupported",
    error,
    playlistType: null,
    streamType: null,
    variants: [],
    iframeVariants: [],
    audioTracks: [],
    subtitles: [],
    duration: null,
    targetDuration: null,
    segmentCount: null,
    partialSegmentCount: null,
    skippedSegmentCount: null,
    lowLatency: false,
    mediaSequence: null,
    discontinuitySequence: null,
    revisionId: null,
    encryptionMethods: [],
    drm: "none",
  };
}

function isDrmLikeMethod(method) {
  return method.startsWith("SAMPLE-AES");
}

function valueAfterColon(line) {
  return line.slice(line.indexOf(":") + 1);
}

function resolveUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

function optionalPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function optionalText(value) {
  return typeof value === "string" && value ? value : null;
}

function yesNo(value) {
  return String(value || "").toUpperCase() === "YES";
}

function round(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function stableVariantId(...parts) {
  const input = parts.filter((part) => part !== null).join(":");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `stream-${(hash >>> 0).toString(36)}`;
}

function optionalNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function stableTextId(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `revision-${(hash >>> 0).toString(36)}`;
}
