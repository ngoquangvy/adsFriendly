import { parseHlsManifest } from "../media/hls-parser.js";
import { parseDashManifest } from "../media/dash-parser.js";
import { isUsableMediaProbe } from "../media/probe-gate.js";

const HANDOFF_PREFIX = "adsfriendly.mediaManifestHandoff.";
const MAX_HANDOFF_BYTES = 512 * 1024;
const MAX_HANDOFFS_PER_TAB = 2;
const MAX_HANDOFFS_TOTAL = 8;
const HANDOFF_TTL_MS = 15 * 60 * 1000;
let storageOperation = Promise.resolve();

export function startMediaManifestHandoffStore() {
  const onRemoved = (tabId) =>
    clearMediaManifestHandoffs(tabId).catch(() => {});
  chrome.tabs.onRemoved.addListener(onRemoved);
  return () => chrome.tabs.onRemoved.removeListener(onRemoved);
}

export async function saveMediaManifestHandoff(tabId, rawHandoff) {
  assertTabId(tabId);
  const handoff = normalizeMediaManifestHandoff(rawHandoff);
  return withStorageLock(async () => {
    const key = handoffKey(tabId);
    const snapshot = await chrome.storage.session.get(null);
    const records = [{ key, handoff }];
    for (const [storedKey, value] of Object.entries(snapshot)) {
      if (!storedKey.startsWith(HANDOFF_PREFIX)) continue;
      for (const storedHandoff of pruneHandoffs(value)) {
        if (storedKey === key && storedHandoff.mediaId === handoff.mediaId)
          continue;
        records.push({ key: storedKey, handoff: storedHandoff });
      }
    }
    records.sort(
      (left, right) =>
        Number(right.handoff.capturedAt) - Number(left.handoff.capturedAt),
    );
    const selected = [];
    const perTab = new Map();
    for (const record of records) {
      if (selected.length >= MAX_HANDOFFS_TOTAL) break;
      const count = perTab.get(record.key) || 0;
      if (count >= MAX_HANDOFFS_PER_TAB) continue;
      selected.push(record);
      perTab.set(record.key, count + 1);
    }
    const updates = {};
    for (const record of selected) {
      (updates[record.key] ||= []).push(record.handoff);
    }
    const storedKeys = Object.keys(snapshot).filter((storedKey) =>
      storedKey.startsWith(HANDOFF_PREFIX),
    );
    const removedKeys = storedKeys.filter((storedKey) => !updates[storedKey]);
    if (Object.keys(updates).length) await chrome.storage.session.set(updates);
    if (removedKeys.length) await chrome.storage.session.remove(removedKeys);
    return { status: "saved", handoff: publicHandoff(handoff) };
  });
}

export async function getMediaManifestHandoff(tabId, mediaId) {
  assertTabId(tabId);
  if (typeof mediaId !== "string" || !mediaId)
    return { status: "invalid_media" };
  return withStorageLock(async () => {
    const key = handoffKey(tabId);
    const snapshot = await chrome.storage.session.get(key);
    const stored = Array.isArray(snapshot[key]) ? snapshot[key] : [];
    const handoffs = pruneHandoffs(stored);
    if (handoffs.length !== stored.length) {
      if (handoffs.length)
        await chrome.storage.session.set({ [key]: handoffs });
      else await chrome.storage.session.remove(key);
    }
    const handoff = handoffs.find((item) => item.mediaId === mediaId);
    return handoff
      ? { status: "found", handoff: { ...handoff } }
      : { status: "not_found" };
  });
}

export async function clearMediaManifestHandoffs(tabId) {
  assertTabId(tabId);
  return withStorageLock(() =>
    chrome.storage.session.remove(handoffKey(tabId)),
  );
}

export function normalizeMediaManifestHandoff(value = {}, now = Date.now()) {
  const body = typeof value.body === "string" ? value.body : "";
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  if (!body || bodyBytes > MAX_HANDOFF_BYTES) {
    throw new Error(
      bodyBytes > MAX_HANDOFF_BYTES
        ? "Decrypted manifest exceeds the 512 KB handoff limit."
        : "Decrypted manifest body is empty.",
    );
  }
  const kind = value.kind === "dash" ? "dash" : "hls";
  const manifestUrl = requiredHttpUrl(value.manifestUrl);
  const parsed =
    kind === "dash"
      ? { kind, ...parseDashManifest(manifestUrl, body) }
      : { kind, ...parseHlsManifest(manifestUrl, body) };
  if (!isUsableMediaProbe(parsed)) {
    throw new Error("Decrypted manifest is not a usable media source.");
  }
  return Object.freeze({
    mediaId: requiredString(value.mediaId, "mediaId"),
    manifestUrl,
    kind,
    body,
    bodyBytes,
    revisionId: parsed.revisionId || null,
    playlistType: parsed.playlistType || null,
    streamType: parsed.streamType || null,
    capturedAt: now,
    expiresAt: now + HANDOFF_TTL_MS,
  });
}

function pruneHandoffs(value, now = Date.now()) {
  return (Array.isArray(value) ? value : [])
    .filter(
      (item) =>
        item && typeof item.body === "string" && Number(item.expiresAt) > now,
    )
    .slice(0, MAX_HANDOFFS_PER_TAB);
}

function publicHandoff(handoff) {
  const { body: _body, ...metadata } = handoff;
  return metadata;
}

function withStorageLock(operation) {
  const result = storageOperation.then(operation, operation);
  storageOperation = result.catch(() => {});
  return result;
}

function handoffKey(tabId) {
  return `${HANDOFF_PREFIX}${tabId}`;
}

function assertTabId(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0)
    throw new Error("A valid tab ID is required for manifest handoff.");
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Manifest handoff ${field} is required.`);
  return value;
}

function requiredHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.href;
  } catch {
    throw new Error("Manifest handoff URL must be HTTP(S).");
  }
}
