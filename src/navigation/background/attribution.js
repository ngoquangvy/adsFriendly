import { isWebNavigationTarget } from "./new-tab-policy.js";

export const NAVIGATION_CONTEXT_SCHEMA = "navigation-context.v1";
export const ATTRIBUTION_EVIDENCE = Object.freeze({
  WEB_TARGET: "web_navigation_target",
  OPENER: "opener_tab",
  RECENT_CLICK: "recent_click_timing",
  REVERSE_SEQUENCE: "observed_clone_and_source_redirect",
});
const EVIDENCE_RANK = Object.freeze({
  [ATTRIBUTION_EVIDENCE.RECENT_CLICK]: 1,
  [ATTRIBUTION_EVIDENCE.OPENER]: 2,
  [ATTRIBUTION_EVIDENCE.WEB_TARGET]: 3,
  [ATTRIBUTION_EVIDENCE.REVERSE_SEQUENCE]: 3,
});
function sameIntentUrl(left, right) {
  try {
    const a = new URL(left),
      b = new URL(right);
    a.hash = "";
    b.hash = "";
    return a.href === b.href;
  } catch {
    return false;
  }
}

// Volatile, bounded correlation state. No URLs or click intent are persisted.
// A context snapshot belongs to one navigation, never to the latest global click.
export function createNavigationAttribution({
  now = () => Date.now(),
  maximum = 256,
} = {}) {
  const contexts = new Map();
  const intents = new Map();
  let nextId = 0;
  const prune = () => {
    const timestamp = now();
    for (const [id, context] of contexts)
      if (context.expiresAt <= timestamp) contexts.delete(id);
    for (const [id, intent] of intents)
      if (timestamp - intent.timestamp > 2500) intents.delete(id);
    while (contexts.size > maximum)
      contexts.delete(contexts.keys().next().value);
    while (intents.size > maximum) intents.delete(intents.keys().next().value);
  };
  const rememberIntent = (click) => {
    prune();
    if (
      !Number.isInteger(click?.tabId) ||
      !isWebNavigationTarget(click.sourceUrl)
    )
      return;
    const intent = Object.freeze({
      tabId: click.tabId,
      sourceFrameId: Number.isInteger(click.sourceFrameId)
        ? click.sourceFrameId
        : null,
      timestamp: now(),
      sourceUrl: click.sourceUrl,
      intentUrl: isWebNavigationTarget(click.intentUrl)
        ? click.intentUrl
        : null,
      intentKind:
        click.intentKind === "promotional" ? "promotional" : "navigation",
      intentReasons: Object.freeze(
        (Array.isArray(click.intentReasons) ? click.intentReasons : [])
          .filter((value) => typeof value === "string")
          .slice(0, 12),
      ),
    });
    const key = `${intent.tabId}:${intent.sourceFrameId}`;
    intents.delete(key);
    intents.set(key, intent);
    prune();
    return intent;
  };
  const getIntent = (sourceTabId, sourceFrameId = null) => {
    prune();
    const intent = Number.isInteger(sourceFrameId)
      ? intents.get(`${sourceTabId}:${sourceFrameId}`)
      : [...intents.values()]
          .filter((item) => item.tabId === sourceTabId)
          .at(-1);
    if (!intent || now() < intent.timestamp) return null;
    if (
      Number.isInteger(sourceFrameId) &&
      intent.sourceFrameId !== sourceFrameId
    )
      return null;
    return intent;
  };
  const latestIntent = () => {
    prune();
    return (
      [...intents.values()]
        .filter((intent) => intent.timestamp <= now())
        .at(-1) || null
    );
  };
  const get = (tabId) => {
    prune();
    return contexts.get(tabId) || null;
  };
  const link = ({
    targetTabId,
    sourceTabId,
    sourceFrameId = null,
    sourceUrl = null,
    targetUrl = null,
    evidence,
    origin = "website",
  }) => {
    prune();
    if (!Number.isInteger(targetTabId)) return null;
    if (
      origin === "website" &&
      (!Number.isInteger(sourceTabId) || !EVIDENCE_RANK[evidence])
    )
      return null;
    const previous = contexts.get(targetTabId);
    const rank = EVIDENCE_RANK[evidence] || 0;
    // Late/opener events must not downgrade a browser-owned or confirmed context.
    if (
      previous &&
      ((previous.origin !== "website" && previous.targetUrl === targetUrl) ||
        rank < previous.rank)
    )
      return previous;
    if (
      previous &&
      previous.sourceTabId === sourceTabId &&
      previous.rank === rank &&
      previous.targetUrl === targetUrl
    )
      return previous;
    const sameSource = Boolean(
      previous &&
      previous.sourceTabId === sourceTabId &&
      (previous.targetUrl === targetUrl ||
        rank > previous.rank ||
        !previous.targetUrl ||
        previous.targetUrl === "about:blank"),
    );
    const intent = sameSource
      ? Number.isInteger(sourceFrameId) &&
        previous.intent?.sourceFrameId !== sourceFrameId
        ? null
        : previous.intent
      : getIntent(sourceTabId, sourceFrameId);
    const intentAssociation = !intent
      ? "none"
      : (sameSource && previous.intentAssociation === "matched_link") ||
          sameIntentUrl(intent.intentUrl, targetUrl)
        ? "matched_link"
        : !intent.intentUrl &&
            Number.isInteger(sourceFrameId) &&
            intent.sourceFrameId === sourceFrameId &&
            now() - intent.timestamp <= 500
          ? "frame_temporal"
          : "temporal_only";
    const context = Object.freeze({
      schema: NAVIGATION_CONTEXT_SCHEMA,
      navigationId: sameSource
        ? previous.navigationId
        : `nav-${now().toString(36)}-${++nextId}`,
      targetTabId,
      sourceTabId: sourceTabId ?? null,
      sourceFrameId,
      sourceUrl:
        sourceUrl ||
        intent?.sourceUrl ||
        (sameSource ? previous.sourceUrl : null),
      targetUrl,
      origin,
      rank,
      attribution:
        origin !== "website" || rank >= 3
          ? "confirmed"
          : rank === 2
            ? "probable"
            : "unconfirmed",
      evidence: Object.freeze([
        ...new Set(
          [...(sameSource ? previous.evidence : []), evidence].filter(Boolean),
        ),
      ]),
      intent: intent || null,
      intentAssociation,
      createdAt: sameSource ? previous.createdAt : now(),
      expiresAt: sameSource ? previous.expiresAt : now() + 10_000,
      revision: (previous?.revision || 0) + 1,
    });
    contexts.set(targetTabId, context);
    prune();
    return context;
  };
  const isCurrent = (context) => {
    const current = get(context?.targetTabId);
    return Boolean(
      current &&
      current.navigationId === context.navigationId &&
      current.revision === context.revision,
    );
  };
  const retarget = (context, targetUrl) => {
    if (!isCurrent(context)) return null;
    if (context.targetUrl === targetUrl) return context;
    const updated = Object.freeze({
      ...context,
      targetUrl,
      revision: context.revision + 1,
    });
    contexts.set(context.targetTabId, updated);
    return updated;
  };
  const invalidate = (tabId) => {
    contexts.delete(tabId);
  };
  const removeTab = (tabId) => {
    contexts.delete(tabId);
    for (const [key, intent] of intents)
      if (intent.tabId === tabId) intents.delete(key);
    for (const [target, context] of contexts)
      if (context.sourceTabId === tabId) contexts.delete(target);
  };
  return {
    rememberIntent,
    getIntent,
    latestIntent,
    get,
    link,
    retarget,
    isCurrent,
    invalidate,
    removeTab,
    clear: () => {
      contexts.clear();
      intents.clear();
    },
  };
}

export const navigationAttribution = createNavigationAttribution();

// Explicit allowlist projection for trace/training. Raw context is never exported.
export function navigationAttributionFacts(context) {
  return context
    ? normalizeNavigationAttributionFacts({
        navigationSchema: context.schema,
        navigationId: context.navigationId,
        attribution: context.attribution,
        origin: context.origin,
        sourceFrameId: context.sourceFrameId,
        revision: context.revision,
        attributionEvidence: context.evidence,
        intentAssociation: context.intentAssociation,
      })
    : {};
}

export function normalizeNavigationAttributionFacts(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const facts = {};
  if (value.navigationSchema === NAVIGATION_CONTEXT_SCHEMA)
    facts.navigationSchema = value.navigationSchema;
  if (/^nav-[a-z0-9-]{1,80}$/.test(value.navigationId || ""))
    facts.navigationId = value.navigationId;
  if (["confirmed", "probable", "unconfirmed"].includes(value.attribution))
    facts.attribution = value.attribution;
  if (["extension", "browser-ui", "website", "unknown"].includes(value.origin))
    facts.origin = value.origin;
  for (const key of ["sourceFrameId", "revision"])
    if (Number.isInteger(value[key]) && value[key] >= 0)
      facts[key] = value[key];
  if (
    ["none", "matched_link", "frame_temporal", "temporal_only"].includes(
      value.intentAssociation,
    )
  )
    facts.intentAssociation = value.intentAssociation;
  if (Array.isArray(value.attributionEvidence))
    facts.attributionEvidence = value.attributionEvidence
      .filter((item) =>
        [
          ...Object.values(ATTRIBUTION_EVIDENCE),
          "registered_extension_action",
        ].includes(item),
      )
      .slice(0, 8);
  return facts;
}
