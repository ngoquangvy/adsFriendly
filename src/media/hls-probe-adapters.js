const HLS_PROBE_ADAPTERS = Object.freeze([
  Object.freeze({
    id: "aesgcm-b65-clear-variant",
    matches(body) {
      const source = normalizeBody(body);
      return (
        source.startsWith("#EXTM3U") &&
        source.includes("#ENC-AESGCM;") &&
        source.includes("#EXT-X-B65:")
      );
    },
    alternatives(manifestUrl) {
      const url = new URL(manifestUrl);
      if (url.searchParams.get("d") !== "1") return [];
      url.searchParams.delete("d");
      return [url.href];
    },
  }),
]);

export function createHlsProbeAlternatives(manifestUrl, body) {
  let url;
  try {
    url = new URL(manifestUrl);
  } catch {
    return [];
  }
  if (!["http:", "https:"].includes(url.protocol)) return [];

  const alternatives = [];
  for (const adapter of HLS_PROBE_ADAPTERS) {
    if (!adapter.matches(body)) continue;
    for (const value of adapter.alternatives(url.href)) {
      if (value !== url.href && !alternatives.includes(value)) {
        alternatives.push(value);
      }
    }
  }
  return alternatives.slice(0, 3);
}

function normalizeBody(body) {
  return typeof body === "string"
    ? body.replace(/^\uFEFF/, "").trimStart()
    : "";
}
