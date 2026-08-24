export function createMediaProbeGate({ maximumRemembered = 100 } = {}) {
  const states = new Map();

  return Object.freeze({
    claim(url) {
      const key = normalizeHttpMediaUrl(url);
      if (!key || states.has(key)) return null;
      remember(key, "pending");
      return key;
    },
    remember(url, state = "complete") {
      const key = normalizeHttpMediaUrl(url);
      if (!key) return null;
      remember(key, state);
      return key;
    },
    state(url) {
      const key = normalizeHttpMediaUrl(url);
      return key ? states.get(key) || null : null;
    },
    clear() {
      states.clear();
    },
  });

  function remember(key, state) {
    states.delete(key);
    states.set(key, state);
    while (states.size > maximumRemembered) {
      states.delete(states.keys().next().value);
    }
  }
}

export function normalizeHttpMediaUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
