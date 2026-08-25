const DRM_SCHEMES = [
  "widevine",
  "playready",
  "fairplay",
  "marlin",
  "clearkey",
  "edef8ba9",
  "9a04f079",
  "e2719d58",
  "94ce86fb",
];

export function parseDashManifest(manifestUrl, body) {
  try {
    const xml = String(body || "")
      .replace(/^\uFEFF/, "")
      .trim();
    const root = xml.match(/<MPD\b([^>]*)>/i);
    if (!root) return unsupported("not_dash_manifest");

    const rootAttributes = parseXmlAttributes(root[1]);
    const streamType =
      String(rootAttributes.type || "static").toLowerCase() === "dynamic"
        ? "live"
        : "vod";
    const duration = parseIsoDuration(rootAttributes.mediaPresentationDuration);
    const protectionSchemes = extractProtectionSchemes(xml);
    const drm = protectionSchemes.some((scheme) =>
      DRM_SCHEMES.some((name) => scheme.includes(name)),
    )
      ? "confirmed"
      : protectionSchemes.length
        ? "suspected"
        : "none";
    const tracks = extractTracks(xml);
    const variants = tracks.filter((track) => track.type === "video");
    const audioTracks = tracks.filter((track) => track.type === "audio");
    const subtitles = tracks.filter((track) => track.type === "text");

    return {
      kind: "dash",
      status: "ready",
      error: null,
      playlistType: "master",
      streamType,
      duration,
      variants,
      iframeVariants: [],
      audioTracks,
      subtitles,
      segmentCount: null,
      partialSegmentCount: null,
      skippedSegmentCount: null,
      lowLatency:
        streamType === "live" && /availabilityTimeOffset\s*=/i.test(xml),
      mediaSequence: null,
      discontinuitySequence: null,
      revisionId: revisionId(manifestUrl, xml),
      encryptionMethods: protectionSchemes,
      drm,
    };
  } catch (error) {
    return {
      ...unsupported("dash_parse_failed"),
      error: error?.message || "dash_parse_failed",
    };
  }
}

function extractTracks(xml) {
  const tracks = [];
  const adaptations = [
    ...xml.matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet\s*>/gi),
  ];
  for (const [, rawAttributes, content] of adaptations) {
    const adaptation = parseXmlAttributes(rawAttributes);
    const representations = [
      ...content.matchAll(/<Representation\b([^>]*?)(?:\/?>)/gi),
    ];
    if (!representations.length) {
      const track = normalizeTrack(adaptation, adaptation, tracks.length);
      if (track) tracks.push(track);
      continue;
    }
    for (const [, representationAttributes] of representations) {
      const representation = parseXmlAttributes(representationAttributes);
      const track = normalizeTrack(adaptation, representation, tracks.length);
      if (track) tracks.push(track);
    }
  }

  if (adaptations.length) return deduplicateTracks(tracks);
  for (const [, rawAttributes] of xml.matchAll(
    /<Representation\b([^>]*?)(?:\/?>)/gi,
  )) {
    const representation = parseXmlAttributes(rawAttributes);
    const track = normalizeTrack({}, representation, tracks.length);
    if (track) tracks.push(track);
  }
  return deduplicateTracks(tracks);
}

function normalizeTrack(adaptation, representation, index) {
  const mimeType = representation.mimeType || adaptation.mimeType || null;
  const contentType = String(
    adaptation.contentType || representation.contentType || mimeType || "",
  ).toLowerCase();
  const type = contentType.includes("video")
    ? "video"
    : contentType.includes("audio")
      ? "audio"
      : contentType.includes("text") ||
          contentType.includes("subtitle") ||
          contentType.includes("application")
        ? "text"
        : null;
  if (!type) return null;
  const width = positiveInteger(representation.width || adaptation.width);
  const height = positiveInteger(representation.height || adaptation.height);
  const bandwidth = positiveInteger(representation.bandwidth);
  return {
    id: representation.id || adaptation.id || `${type}-${index + 1}`,
    type,
    bandwidth,
    averageBandwidth: bandwidth,
    width,
    height,
    resolution: width || height ? { width, height } : null,
    codecs: representation.codecs || adaptation.codecs || null,
    mimeType,
    language: adaptation.lang || representation.lang || null,
    name: adaptation.label || representation.label || adaptation.lang || null,
  };
}

function deduplicateTracks(tracks) {
  const unique = new Map();
  for (const track of tracks) {
    const key = [
      track.type,
      track.id,
      track.bandwidth,
      track.width,
      track.height,
      track.language,
    ].join(":");
    unique.set(key, track);
  }
  return [...unique.values()].slice(0, 100);
}

function extractProtectionSchemes(xml) {
  return [
    ...new Set(
      [...xml.matchAll(/<ContentProtection\b([^>]*)>/gi)]
        .map((match) => parseXmlAttributes(match[1]).schemeIdUri)
        .filter(Boolean)
        .map((value) => String(value).toLowerCase().slice(0, 100)),
    ),
  ];
}

export function parseIsoDuration(value) {
  if (typeof value !== "string" || !value) return null;
  const match = value.match(
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
  );
  if (!match) return null;
  const seconds =
    Number(match[1] || 0) * 86_400 +
    Number(match[2] || 0) * 3_600 +
    Number(match[3] || 0) * 60 +
    Number(match[4] || 0);
  return Number.isFinite(seconds) ? seconds : null;
}

function parseXmlAttributes(value) {
  const attributes = {};
  for (const match of String(value || "").matchAll(
    /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
  )) {
    attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function decodeXml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function revisionId(url, body) {
  let hash = 2166136261;
  const input = `${url || ""}\n${body}`;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `dash-${(hash >>> 0).toString(36)}`;
}

function unsupported(error) {
  return {
    kind: "dash",
    status: "unsupported",
    error,
    playlistType: null,
    streamType: null,
    duration: null,
    variants: [],
    iframeVariants: [],
    audioTracks: [],
    subtitles: [],
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
