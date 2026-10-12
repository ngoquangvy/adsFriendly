import { classifyNavigationIntent } from "../navigation/shared/intent-classifier.js";

export function httpUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}
export function sameHostFamily(left, right) {
  const a = httpUrl(left)?.hostname,
    b = httpUrl(right)?.hostname;
  return !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a));
}
export function exactDestination(left, right) {
  const a = httpUrl(left),
    b = httpUrl(right);
  if (!a || !b) return false;
  a.hash = "";
  b.hash = "";
  return a.href === b.href;
}
export function explicitNavigation(details = {}) {
  return (
    [
      "typed",
      "generated",
      "keyword",
      "keyword_generated",
      "auto_bookmark",
    ].includes(details.transitionType) ||
    (details.transitionQualifiers || []).includes("from_address_bar")
  );
}
export function navigationDecision({
  sourceUrl,
  targetUrl,
  enabled = true,
  sourcePolicy = "default",
  blocked = false,
  allowed = false,
  knownAd = false,
  intent = null,
  trustedPath = false,
  now = Date.now(),
}) {
  if (!enabled || !httpUrl(targetUrl))
    return { action: "allow", reason: "disabled_or_non_http" };
  if (blocked) return { action: "block", reason: "remembered_block" };
  if (allowed || sourcePolicy === "allow")
    return { action: "allow", reason: "explicit_allow" };
  const classification = classifyNavigationIntent({
    intentUrl: targetUrl,
    sourceUrl,
  });
  if (knownAd || classification.likelyAd)
    return {
      action: "review",
      reason: "advertising_signals",
      reasons: classification.reasons,
    };
  if (sameHostFamily(sourceUrl, targetUrl))
    return { action: "allow", reason: "same_host_family", keepTracking: true };
  if (
    intent &&
    now - intent.time < 2500 &&
    exactDestination(intent.url, targetUrl)
  )
    return { action: "allow", reason: "exact_clicked_link" };
  if (trustedPath && sourcePolicy !== "block")
    return { action: "allow", reason: "manual_trusted_path" };
  return { action: "review", reason: "unmatched_web_created_tab" };
}

// A bounded event tracker. Only web-linked tabs are candidates; address-bar
// commits supersede pending decisions and invalidate asynchronous evaluation.
export function createNavigationTracker({
  now = Date.now,
  ttl = 30000,
  maxEntries = 100,
} = {}) {
  const candidates = new Map(),
    userContexts = new Map(),
    once = new Map(),
    handled = new Map();
  let sequence = 0;
  function prune() {
    for (const map of [candidates, userContexts, once, handled]) {
      for (const [key, value] of map)
        if (value.expiresAt <= now()) map.delete(key);
      while (map.size > maxEntries) map.delete(map.keys().next().value);
    }
  }
  return {
    link(tabId, sourceTabId) {
      prune();
      if (
        tabId === sourceTabId ||
        userContexts.has(tabId) ||
        handled.has(tabId)
      )
        return null;
      let value = candidates.get(tabId);
      if (!value) {
        value = {
          sourceTabId,
          createdAt: now(),
          expiresAt: now() + ttl,
          epoch: ++sequence,
        };
        candidates.set(tabId, value);
      }
      return value;
    },
    candidate(tabId) {
      prune();
      return candidates.get(tabId);
    },
    commit(details) {
      prune();
      if (explicitNavigation(details)) {
        candidates.delete(details.tabId);
        userContexts.set(details.tabId, {
          url: details.url,
          expiresAt: now() + 10000,
        });
        return "user";
      }
      const user = userContexts.get(details.tabId);
      if (user && sameHostFamily(user.url, details.url)) return "user";
      // Do not assign an old opener to a tab now controlled by the user.
      if (user) {
        candidates.delete(details.tabId);
        return "user";
      }
      return "web";
    },
    finish(tabId) {
      candidates.delete(tabId);
      handled.set(tabId, { expiresAt: now() + ttl });
    },
    current(tabId, candidate) {
      prune();
      return candidates.get(tabId) === candidate;
    },
    grantOnce(url) {
      prune();
      if (!httpUrl(url))
        throw new Error("Only HTTP(S) destinations can be opened.");
      const token = ++sequence;
      once.set(token, { url, expiresAt: now() + 5000 });
      return token;
    },
    consumeOnce(url) {
      const tabId = arguments[1];
      prune();
      for (const [token, ticket] of once) {
        if (tabId !== undefined && ticket.tabId !== tabId) continue;
        if (exactDestination(ticket.url, url)) {
          once.delete(token);
          return true;
        }
      }
      return false;
    },
    bindOnce(token, tabId) {
      const ticket = once.get(token);
      if (ticket) ticket.tabId = tabId;
    },
    revokeOnce(token) {
      once.delete(token);
    },
    remove(tabId) {
      candidates.delete(tabId);
      userContexts.delete(tabId);
      handled.delete(tabId);
    },
    prune,
  };
}
