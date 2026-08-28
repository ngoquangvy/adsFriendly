export const MEDIA_ACCESS_STRATEGIES = Object.freeze({
  CAPTURED_REFERER_ORIGIN: "captured_referer_origin",
  CAPTURED_REFERER: "captured_referer",
  DOCUMENT_REFERER: "document_referer",
  PARENT_REFERER: "parent_referer",
  PAGE_REFERER: "page_referer",
  BROWSER_KEY_HANDOFF: "browser_key_handoff",
  YOUTUBE_MWEB_PO: "youtube_mweb_po",
  YOUTUBE_WEB_PO: "youtube_web_po",
  YOUTUBE_YTMUSIC_PO: "youtube_ytmusic_po",
  YOUTUBE_MOBILE_DIRECT: "youtube_mobile_direct",
  YOUTUBE_WEB_DIRECT: "youtube_web_direct",
  YOUTUBE_BROWSER_HANDOFF: "youtube_browser_handoff",
  YOUTUBE_YTDLP_PROVIDER: "youtube_ytdlp_provider",
});

export const MEDIA_ACCESS_STRATEGY_CATALOG = Object.freeze([
  strategy(MEDIA_ACCESS_STRATEGIES.BROWSER_KEY_HANDOFF, "key", 1.2),
  strategy(MEDIA_ACCESS_STRATEGIES.CAPTURED_REFERER_ORIGIN, "http", 0.92),
  strategy(MEDIA_ACCESS_STRATEGIES.CAPTURED_REFERER, "http", 0.9),
  strategy(MEDIA_ACCESS_STRATEGIES.DOCUMENT_REFERER, "http", 0.82),
  strategy(MEDIA_ACCESS_STRATEGIES.PARENT_REFERER, "http", 0.72),
  strategy(MEDIA_ACCESS_STRATEGIES.PAGE_REFERER, "http", 0.72),
  strategy(MEDIA_ACCESS_STRATEGIES.YOUTUBE_MWEB_PO, "provider", 1.0),
  strategy(MEDIA_ACCESS_STRATEGIES.YOUTUBE_WEB_PO, "provider", 0.95),
  strategy(MEDIA_ACCESS_STRATEGIES.YOUTUBE_YTMUSIC_PO, "provider", 0.8),
  strategy(MEDIA_ACCESS_STRATEGIES.YOUTUBE_MOBILE_DIRECT, "provider", 0.65),
  strategy(MEDIA_ACCESS_STRATEGIES.YOUTUBE_WEB_DIRECT, "provider", 0.55),
  strategy(MEDIA_ACCESS_STRATEGIES.YOUTUBE_BROWSER_HANDOFF, "provider", 0.5),
  strategy(MEDIA_ACCESS_STRATEGIES.YOUTUBE_YTDLP_PROVIDER, "provider", 0.35),
]);

const STRATEGY_BY_ID = new Map(
  MEDIA_ACCESS_STRATEGY_CATALOG.map((definition) => [
    definition.id,
    definition,
  ]),
);

export function getMediaAccessStrategy(strategyId) {
  const definition = STRATEGY_BY_ID.get(strategyId);
  if (!definition) {
    throw new Error(
      `[MediaAccess] Unknown strategy "${strategyId || ""}". Register it in access-strategy-catalog.js before use.`,
    );
  }
  return definition;
}

export function isRegisteredMediaAccessStrategy(strategyId) {
  return STRATEGY_BY_ID.has(strategyId);
}

function strategy(id, resourceKind, baseScore) {
  return Object.freeze({ id, resourceKind, baseScore });
}
