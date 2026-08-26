const DEBUG_CAPTURE_PREFIX = "adsfriendly.mediaDebugCaptures.";
const MAX_CAPTURE_BYTES = 512 * 1024;
const MAX_CAPTURES_PER_TAB = 3;
const CAPTURE_TTL_MS = 15 * 60 * 1000;

export function startMediaDebugCaptureStore() {
  const onRemoved = (tabId) => clearMediaDebugCaptures(tabId).catch(() => {});
  chrome.tabs.onRemoved.addListener(onRemoved);
  return () => chrome.tabs.onRemoved.removeListener(onRemoved);
}

export async function saveMediaDebugCapture(tabId, rawCapture) {
  assertTabId(tabId);
  const capture = normalizeDebugCapture(rawCapture);
  const key = debugCaptureKey(tabId);
  const snapshot = await chrome.storage.session.get(key);
  const captures = pruneCaptures(snapshot[key]);
  const next = [
    capture,
    ...captures.filter((item) => item.mediaId !== capture.mediaId),
  ].slice(0, MAX_CAPTURES_PER_TAB);
  await chrome.storage.session.set({ [key]: next });
  return { status: "saved", capture: publicCapture(capture) };
}

export async function getMediaDebugCapture(tabId, mediaId) {
  assertTabId(tabId);
  if (typeof mediaId !== "string" || !mediaId)
    return { status: "invalid_media" };
  const key = debugCaptureKey(tabId);
  const snapshot = await chrome.storage.session.get(key);
  const stored = Array.isArray(snapshot[key]) ? snapshot[key] : [];
  const captures = pruneCaptures(stored);
  if (captures.length !== stored.length) {
    if (captures.length) await chrome.storage.session.set({ [key]: captures });
    else await chrome.storage.session.remove(key);
  }
  const capture = captures.find((item) => item.mediaId === mediaId);
  return capture
    ? { status: "found", capture: { ...capture } }
    : { status: "not_found" };
}

export async function clearMediaDebugCaptures(tabId) {
  assertTabId(tabId);
  await chrome.storage.session.remove(debugCaptureKey(tabId));
}

export function normalizeDebugCapture(value = {}, now = Date.now()) {
  const body = typeof value.body === "string" ? value.body : "";
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  if (!body || bodyBytes > MAX_CAPTURE_BYTES) {
    throw new Error(
      bodyBytes > MAX_CAPTURE_BYTES
        ? "Debug manifest exceeds the 512 KB session limit."
        : "Debug manifest body is empty.",
    );
  }
  return Object.freeze({
    mediaId: requiredString(value.mediaId, "mediaId"),
    manifestUrl: requiredHttpUrl(value.manifestUrl),
    kind: ["hls", "dash"].includes(value.kind) ? value.kind : "hls",
    body,
    bodyBytes,
    bodyFormat: ["hls", "dash", "unknown"].includes(value.bodyFormat)
      ? value.bodyFormat
      : "unknown",
    reason: requiredString(value.reason, "reason").slice(0, 100),
    capturedAt: now,
    expiresAt: now + CAPTURE_TTL_MS,
  });
}

function pruneCaptures(value, now = Date.now()) {
  return (Array.isArray(value) ? value : [])
    .filter(
      (item) =>
        item && typeof item.body === "string" && Number(item.expiresAt) > now,
    )
    .slice(0, MAX_CAPTURES_PER_TAB);
}

function publicCapture(capture) {
  const { body: _body, ...metadata } = capture;
  return metadata;
}

function debugCaptureKey(tabId) {
  return `${DEBUG_CAPTURE_PREFIX}${tabId}`;
}

function assertTabId(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0)
    throw new Error("A valid tab ID is required for debug capture.");
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Debug capture ${field} is required.`);
  return value;
}

function requiredHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.href;
  } catch {
    throw new Error("Debug capture manifestUrl must be HTTP(S).");
  }
}
