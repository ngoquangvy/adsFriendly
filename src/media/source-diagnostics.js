import {
  sourceMime,
  sourceExtension,
  AUDIO_EXTENSIONS,
  audioContainer,
} from "./content-type.js";
export const SOURCE_DIAGNOSTIC_CODES = Object.freeze([
  "source_missing",
  "source_unclassified",
  "audio_mime_unsupported",
  "audio_response_conflict",
  "media_segment",
  "blob_source_unresolved",
  "size_unavailable",
  "audio_format_unknown",
  "response_rejected",
]);
export function normalizeSourceDiagnostic(value = {}) {
  if (!SOURCE_DIAGNOSTIC_CODES.includes(value.code))
    throw Error("Unknown source diagnostic.");
  return {
    code: value.code,
    input: ["dom", "network", "size_probe"].includes(value.input)
      ? value.input
      : "dom",
    host: /^[a-z0-9.-]{1,253}$/i.test(value.host || "")
      ? value.host.toLowerCase()
      : "",
    mime: sourceMime(value.mime).slice(0, 100),
    extension: /^[a-z0-9]{1,8}$/.test(value.extension || "")
      ? value.extension
      : "",
    httpStatus:
      Number.isInteger(value.httpStatus) &&
      value.httpStatus >= 100 &&
      value.httpStatus <= 599
        ? value.httpStatus
        : null,
  };
}
// No URL/path/query, title, body, free-form error or media bytes enter this log.
export function sourceDiagnostic({
  sourceUrl,
  mimeType,
  elementType,
  kind,
  input = "dom",
}) {
  const mime = sourceMime(mimeType),
    extension = sourceExtension(sourceUrl);
  const audio =
    elementType === "audio" ||
    mime.startsWith("audio/") ||
    AUDIO_EXTENSIONS.includes(extension);
  if (input !== "dom" && !audio) return null;
  let code = !sourceUrl
    ? "source_missing"
    : kind === "blob"
      ? "blob_source_unresolved"
      : !kind
        ? "source_unclassified"
        : null;
  if (
    kind === "direct" &&
    audio &&
    !audioContainer(mime) &&
    !AUDIO_EXTENSIONS.includes(extension)
  )
    code = "audio_format_unknown";
  if (!kind && audio && /\.(aac|m4s|cmfa)(?:[?#]|$)/i.test(sourceUrl || ""))
    code = "media_segment";
  else if (!kind && audio && mime.startsWith("audio/"))
    code = "audio_mime_unsupported";
  else if (!kind && audio && mime && !/octet-stream$/.test(mime))
    code = "audio_response_conflict";
  if (!code) return null;
  let host = "";
  try {
    host = new URL(sourceUrl).hostname;
  } catch {}
  return normalizeSourceDiagnostic({ code, input, host, mime, extension });
}
export function createSourceDiagnosticRecorder({
  now = Date.now,
  maxTabs = 20,
  maxEntries = 50,
  ttlMs = 15 * 60000,
} = {}) {
  const tabs = new Map();
  function prune() {
    for (const [id, entries] of tabs) {
      for (const [key, row] of entries)
        if (now() - row.lastSeenAt >= ttlMs) entries.delete(key);
      if (!entries.size) tabs.delete(id);
    }
  }
  return {
    record(tabId, value, frameId = -1) {
      if (!Number.isInteger(tabId) || tabId < 0) return;
      const safe = normalizeSourceDiagnostic(value);
      prune();
      const entries = tabs.get(tabId) || new Map();
      const frame = Number.isInteger(frameId) ? frameId : -1;
      const key = JSON.stringify([safe, frame]);
      const previous = entries.get(key);
      entries.delete(key);
      entries.set(key, {
        ...safe,
        frameId: frame,
        count: Math.min(9999, (previous?.count || 0) + 1),
        firstSeenAt: previous?.firstSeenAt || now(),
        lastSeenAt: now(),
      });
      while (entries.size > maxEntries)
        entries.delete(entries.keys().next().value);
      tabs.delete(tabId);
      tabs.set(tabId, entries);
      while (tabs.size > maxTabs) tabs.delete(tabs.keys().next().value);
    },
    list(tabId) {
      prune();
      return [...(tabs.get(tabId)?.values() || [])].map((row) => ({ ...row }));
    },
    clear(tabId) {
      tabs.delete(tabId);
    },
    clearAll() {
      tabs.clear();
    },
  };
}
