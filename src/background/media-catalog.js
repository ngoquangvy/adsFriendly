import { createMediaCatalog } from "../media/catalog.js";
import {
  MEDIA_CATALOG_SESSION_PREFIX,
  mediaCatalogSessionKey,
} from "../media/storage-keys.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { isLikelyMediaSegment } from "../media/detection.js";

const catalog = createMediaCatalog();
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

export async function recordBlobSourceTrace(tabId, event) {
  if (!active) return { status: "catalog_disabled" };
  const item = catalog.applyBlobTrace(tabId, event);
  await persistTab(tabId).catch(() => {});
  return { status: "recorded", item };
}

export async function recordMediaEmeObservation(tabId, event) {
  if (!active) return { status: "catalog_disabled" };
  const items = catalog.applyEme(tabId, event);
  await persistTab(tabId).catch(() => {});
  return { status: "recorded", items };
}

export async function listDiscoveredMedia(tabId, pageUrl = null) {
  if (!active) return { status: "catalog_disabled", items: [] };
  return { status: "ok", items: catalog.list(tabId, pageUrl) };
}

async function hydrateCatalog() {
  const storage = chrome.storage.session;
  if (!storage) return;
  const snapshot = await storage.get(null);
  for (const [key, items] of Object.entries(snapshot)) {
    if (!key.startsWith(MEDIA_CATALOG_SESSION_PREFIX) || !Array.isArray(items))
      continue;
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
    }
    const cleanedItems = catalog.list(tabId);
    if (cleanedItems.length) await storage.set({ [key]: cleanedItems });
    else await storage.remove(key);
  }
}

async function persistTab(tabId) {
  const storage = chrome.storage.session;
  if (!storage) return;
  await storage.set({ [mediaCatalogSessionKey(tabId)]: catalog.list(tabId) });
}

async function clearTab(tabId) {
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
