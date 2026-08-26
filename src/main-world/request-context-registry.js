import { normalizeMediaRequestContext } from "../media/contracts.js";

export function createRequestContextRegistry({
  maximumEntries = 64,
  maximumAgeMs = 60_000,
} = {}) {
  const contexts = new Map();

  return Object.freeze({
    remember(context, observedAt = Date.now()) {
      const normalized = normalizeMediaRequestContext({
        ...context,
        observedAt,
      });
      if (!normalized) return null;
      for (const value of [normalized.requestUrl, normalized.finalUrl]) {
        const key = normalizeHttpUrl(value);
        if (!key) continue;
        contexts.delete(key);
        contexts.set(key, normalized);
      }
      trim(observedAt);
      return { ...normalized };
    },
    find(url, now = Date.now()) {
      trim(now);
      const context = contexts.get(normalizeHttpUrl(url));
      return context ? { ...context } : null;
    },
    clear() {
      contexts.clear();
    },
  });

  function trim(now) {
    for (const [key, context] of contexts) {
      if (now - (context.observedAt || 0) > maximumAgeMs) contexts.delete(key);
    }
    while (contexts.size > maximumEntries) {
      contexts.delete(contexts.keys().next().value);
    }
  }
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
