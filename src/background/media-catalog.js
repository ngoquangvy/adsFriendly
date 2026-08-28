import { createMediaCatalog } from "../media/catalog.js";
import {
  MEDIA_CATALOG_SESSION_PREFIX,
  mediaCatalogSessionKey,
} from "../media/storage-keys.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { isLikelyMediaSegment } from "../media/detection.js";

const catalog = createMediaCatalog();
const PLAYBACK_CHECKPOINT_INTERVAL_MS = 10_000;
const playbackCheckpointTimers = new Map();
let active = false;

export async function startBackgroundMediaCatalog() {
  await hydrateCatalog().catch(() => {});
  active = true;
  const onRemoved = (tabId) => clearTab(tabId).catch(() => {});
  const onUpdated = (tabId, changeInfo) => {
    if (!changeInfo.url) return;
    const currentPageUrl = catalog.list(tabId)[0]?.pageUrl;
    if (
      currentPageUrl &&
      sameDocumentExceptHash(currentPageUrl, changeInfo.url)
    )
      return;
    clearTab(tabId).catch(() => {});
  };
  chrome.tabs.onRemoved.addListener(onRemoved);
  chrome.tabs.onUpdated.addListener(onUpdated);
  return async () => {
    active = false;
    for (const timer of playbackCheckpointTimers.values()) clearTimeout(timer);
    playbackCheckpointTimers.clear();
    catalog.clearAll();
    chrome.tabs.onRemoved.removeListener(onRemoved);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    await clearSessionCatalog().catch(() => {});
  };
}

export async function recordDiscoveredMedia(tabId, event) {
  if (!active) return { status: "catalog_disabled" };
  const item = catalog.add(tabId, event);
  await persistTab(tabId).catch(() => {});
  return { status: "recorded", item };
}

export async function recordMediaProbe(tabId, event) {
  if (!active) return { status: "catalog_disabled" };
  const item = catalog.applyProbe(tabId, event);
  await persistTab(tabId).catch(() => {});
  return { status: "recorded", item };
}

export async function recordMediaProbeDiagnostic(tabId, event) {
  if (!active) return { status: "catalog_disabled" };
  const item = catalog.applyProbeDiagnostic(tabId, event);
  await persistTab(tabId).catch(() => {});
  return { status: "recorded", item };
}

export async function recordBlobSourceTrace(tabId, event) {
  if (!active) return { status: "catalog_disabled" };
  const item = catalog.applyBlobTrace(tabId, event);
  await persistTab(tabId).catch(() => {});
  return { status: "recorded", item };
}

export async function recordMediaManifestHandoff(tabId, event) {
  if (!active) return { status: "catalog_disabled" };
  const item = catalog.applyManifestHandoff(tabId, event);
  if (!item) return { status: "catalog_pending" };
  await persistTab(tabId).catch(() => {});
  return { status: "recorded", item };
}

export async function recordMediaEmeObservation(tabId, event) {
  if (!active) return { status: "catalog_disabled" };
  const items = catalog.applyEme(tabId, event);
  await persistTab(tabId).catch(() => {});
  return { status: "recorded", items };
}

export async function recordMediaPlaybackObservation(tabId, event) {
  if (!active) return { status: "catalog_disabled" };
  const session = catalog.applyPlayback(tabId, event);
  if (event?.payload?.trigger === "timeupdate")
    schedulePlaybackCheckpoint(tabId);
  else await flushPlaybackCheckpoint(tabId).catch(() => {});
  return { status: "recorded", session };
}

export async function listDiscoveredMedia(tabId, pageUrl = null) {
  if (!active) return { status: "catalog_disabled", items: [] };
  return { status: "ok", items: catalog.list(tabId, pageUrl) };
}

export async function listMediaPlaybackSessions(tabId, pageUrl = null) {
  if (!active) return { status: "catalog_disabled", sessions: [] };
  return { status: "ok", sessions: catalog.listSessions(tabId, pageUrl) };
}

async function hydrateCatalog() {
  const storage = chrome.storage.session;
  if (!storage) return;
  const snapshot = await storage.get(null);
  for (const [key, stored] of Object.entries(snapshot)) {
    if (!key.startsWith(MEDIA_CATALOG_SESSION_PREFIX)) continue;
    const { items, sessions } = normalizeStoredMediaCatalogSnapshot(stored);
    if (!items.length && !sessions.length) continue;
    const tabId = Number(key.slice(MEDIA_CATALOG_SESSION_PREFIX.length));
    if (!Number.isInteger(tabId)) continue;
    for (const item of items) {
      if (
        item.kind === "direct" &&
        isLikelyMediaSegment(item.sourceUrl, item.mimeType)
      )
        continue;
      const sources = item.detectionSources?.length
        ? item.detectionSources
        : [item.detectedBy];
      for (const detectedBy of sources) {
        try {
          catalog.add(tabId, {
            ...createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, {
              ...item,
              detectedBy,
            }),
            timestamp: item.lastSeenAt || Date.now(),
            metadata: {
              frameId: item.frameId ?? null,
              frameUrl: item.frameUrl || null,
              playerAdapter: item.playerAdapters?.[0] || null,
            },
          });
        } catch {}
      }
      for (const diagnostic of item.probeDiagnostics || []) {
        try {
          catalog.applyProbeDiagnostic(tabId, {
            ...createRegisteredEvent(EVENTS.MEDIA_PROBE_DIAGNOSTIC, diagnostic),
            timestamp: diagnostic.observedAt || item.lastSeenAt || Date.now(),
            metadata: {
              frameId: item.frameId ?? null,
              frameUrl: item.frameUrl || null,
            },
          });
        } catch {}
      }
      if (item.kind === "blob" && item.blobTrace) {
        try {
          catalog.applyBlobTrace(
            tabId,
            createRegisteredEvent(EVENTS.MEDIA_BLOB_TRACED, {
              mediaId: item.id,
              pageUrl: item.pageUrl,
              blobUrl: item.sourceUrl,
              ...item.blobTrace,
            }),
          );
        } catch {}
      }
      if (item.manifestHandoff) {
        try {
          catalog.applyManifestHandoff(
            tabId,
            createRegisteredEvent(EVENTS.MEDIA_MANIFEST_HANDOFF_READY, {
              ...item.manifestHandoff,
              mediaId: item.id,
              pageUrl: item.pageUrl,
              manifestUrl: item.manifestUrl,
              kind: item.kind,
            }),
          );
        } catch {}
      }
    }
    for (const session of sessions) {
      for (const point of session.timeline || []) {
        try {
          catalog.applyPlayback(tabId, {
            ...createRegisteredEvent(EVENTS.MEDIA_PLAYBACK_OBSERVED, {
              ...point,
              sessionId: session.id,
              pageUrl: session.pageUrl || stored.pageUrl,
            }),
            timestamp: point.observedAt || session.lastSeenAt || Date.now(),
            metadata: {
              frameId: session.frameId ?? null,
              frameUrl: session.frameUrl || null,
            },
          });
        } catch {}
      }
    }
    const cleanedItems = catalog.list(tabId);
    if (cleanedItems.length || catalog.listSessions(tabId).length)
      await storage.set({ [key]: catalog.snapshot(tabId) });
    else await storage.remove(key);
  }
}

export function normalizeStoredMediaCatalogSnapshot(stored) {
  return {
    items: Array.isArray(stored)
      ? stored
      : Array.isArray(stored?.items)
        ? stored.items
        : [],
    sessions: Array.isArray(stored?.sessions) ? stored.sessions : [],
  };
}

async function persistTab(tabId) {
  const storage = chrome.storage.session;
  if (!storage) return;
  const snapshot = catalog.snapshot(tabId);
  if (snapshot)
    await storage.set({ [mediaCatalogSessionKey(tabId)]: snapshot });
}

function schedulePlaybackCheckpoint(tabId) {
  if (playbackCheckpointTimers.has(tabId)) return;
  const timer = setTimeout(() => {
    playbackCheckpointTimers.delete(tabId);
    if (active) persistTab(tabId).catch(() => {});
  }, PLAYBACK_CHECKPOINT_INTERVAL_MS);
  playbackCheckpointTimers.set(tabId, timer);
}

async function flushPlaybackCheckpoint(tabId) {
  const timer = playbackCheckpointTimers.get(tabId);
  if (timer) clearTimeout(timer);
  playbackCheckpointTimers.delete(tabId);
  await persistTab(tabId);
}

async function clearTab(tabId) {
  const timer = playbackCheckpointTimers.get(tabId);
  if (timer) clearTimeout(timer);
  playbackCheckpointTimers.delete(tabId);
  catalog.clear(tabId);
  if (chrome.storage.session)
    await chrome.storage.session.remove(mediaCatalogSessionKey(tabId));
}

async function clearSessionCatalog() {
  const storage = chrome.storage.session;
  if (!storage) return;
  const snapshot = await storage.get(null);
  const keys = Object.keys(snapshot).filter((key) =>
    key.startsWith(MEDIA_CATALOG_SESSION_PREFIX),
  );
  if (keys.length) await storage.remove(keys);
}

function sameDocumentExceptHash(left, right) {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    leftUrl.hash = "";
    rightUrl.hash = "";
    return leftUrl.href === rightUrl.href;
  } catch {
    return left === right;
  }
}
