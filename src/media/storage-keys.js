export const MEDIA_CATALOG_SESSION_PREFIX = "adsfriendly.mediaCatalog.";

export function mediaCatalogSessionKey(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("[MediaCatalog] A valid tab ID is required.");
  }
  return `${MEDIA_CATALOG_SESSION_PREFIX}${tabId}`;
}
