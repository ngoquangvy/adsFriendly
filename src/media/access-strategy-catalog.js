export const MEDIA_ACCESS_STRATEGIES = Object.freeze({
  CAPTURED_REFERER_ORIGIN: "captured_referer_origin",
  CAPTURED_REFERER: "captured_referer",
  DOCUMENT_REFERER: "document_referer",
  PARENT_REFERER: "parent_referer",
  PAGE_REFERER: "page_referer",
  BROWSER_KEY_HANDOFF: "browser_key_handoff",
});

export const MEDIA_ACCESS_STRATEGY_CATALOG = Object.freeze([
  strategy(MEDIA_ACCESS_STRATEGIES.BROWSER_KEY_HANDOFF, "key", 1.2),
  strategy(MEDIA_ACCESS_STRATEGIES.CAPTURED_REFERER_ORIGIN, "http", 0.92),
  strategy(MEDIA_ACCESS_STRATEGIES.CAPTURED_REFERER, "http", 0.9),
  strategy(MEDIA_ACCESS_STRATEGIES.DOCUMENT_REFERER, "http", 0.82),
  strategy(MEDIA_ACCESS_STRATEGIES.PARENT_REFERER, "http", 0.72),
  strategy(MEDIA_ACCESS_STRATEGIES.PAGE_REFERER, "http", 0.72),
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
