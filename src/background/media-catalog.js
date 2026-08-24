import { createMediaCatalog } from "../media/catalog.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";

const SESSION_PREFIX = "adsfriendly.mediaCatalog.";
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

export async function listDiscoveredMedia(tabId, pageUrl = null) {
  if (!active) return { status: "catalog_disabled", items: [] };
  return { status: "ok", items: catalog.list(tabId, pageUrl) };
}

async function hydrateCatalog() {
  const storage = chrome.storage.session;
  if (!storage) return;
  const snapshot = await storage.get(null);
  for (const [key, items] of Object.entries(snapshot)) {
    if (!key.startsWith(SESSION_PREFIX) || !Array.isArray(items)) continue;
    const tabId = Number(key.slice(SESSION_PREFIX.length));
    if (!Number.isInteger(tabId)) continue;
    for (const item of items) {
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
    }
  }
}

async function persistTab(tabId) {
  const storage = chrome.storage.session;
  if (!storage) return;
  await storage.set({ [sessionKey(tabId)]: catalog.list(tabId) });
}

async function clearTab(tabId) {
  catalog.clear(tabId);
  if (chrome.storage.session)
    await chrome.storage.session.remove(sessionKey(tabId));
}

async function clearSessionCatalog() {
  const storage = chrome.storage.session;
  if (!storage) return;
  const snapshot = await storage.get(null);
  const keys = Object.keys(snapshot).filter((key) =>
    key.startsWith(SESSION_PREFIX),
  );
  if (keys.length) await storage.remove(keys);
}

function sessionKey(tabId) {
  return `${SESSION_PREFIX}${tabId}`;
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
