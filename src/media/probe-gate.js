export function createMediaProbeGate({ maximumRemembered = 100 } = {}) {
  const states = new Map();

  return Object.freeze({
    claim(url) {
      const key = normalizeHttpMediaUrl(url);
      if (!key || states.has(key)) return null;
      remember(key, "pending");
      return key;
    },
    remember(url, state = "complete") {
      const key = normalizeHttpMediaUrl(url);
      if (!key) return null;
      remember(key, state);
      return key;
    },
    release(url) {
      const key = normalizeHttpMediaUrl(url);
      if (!key) return false;
      return states.delete(key);
    },
    state(url) {
      const key = normalizeHttpMediaUrl(url);
      return key ? states.get(key) || null : null;
    },
    clear() {
      states.clear();
    },
  });

  function remember(key, state) {
    states.delete(key);
    states.set(key, state);
    while (states.size > maximumRemembered) {
      states.delete(states.keys().next().value);
    }
  }
}

export function isUsableMediaProbe(probe = {}) {
  if (probe.status !== "ready") return false;
  if (probe.kind === "dash") {
    return Boolean(
      probe.variants?.length ||
      probe.audioTracks?.length ||
      ["vod", "live"].includes(probe.streamType),
    );
  }
  if (probe.playlistType === "master") {
    return Boolean(
      probe.variants?.length ||
      probe.iframeVariants?.length ||
      probe.audioTracks?.length ||
      probe.subtitles?.length,
    );
  }
  if (probe.playlistType !== "media") return false;
  return Boolean(
    probe.segmentCount > 0 ||
    probe.partialSegmentCount > 0 ||
    ["vod", "live"].includes(probe.streamType),
  );
}

export function normalizeHttpMediaUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
