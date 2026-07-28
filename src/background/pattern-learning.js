import {
  BASELINE_AD_PATTERNS,
  isProtectedPattern,
} from "../shared/ad-patterns.js";
export async function seedBaselinePatterns() {
  const result = await chrome.storage.local.get([
    "friendlyMode",
    "isEnabled",
    "globalAdPatterns",
  ]);
  if (!result.globalAdPatterns || result.globalAdPatterns.length === 0)
    await chrome.storage.local.set({ globalAdPatterns: BASELINE_AD_PATTERNS });
  if (result.friendlyMode === undefined)
    await chrome.storage.local.set({ friendlyMode: true });
  if (result.isEnabled === undefined)
    await chrome.storage.local.set({ isEnabled: true });
}
export async function handleNegativeLearning(fingerprint) {
  if (!fingerprint) return;
  const {
    safePatterns = [],
    infrastructurePatterns = [],
    globalAdPatterns = [],
  } = await chrome.storage.local.get([
    "safePatterns",
    "infrastructurePatterns",
    "globalAdPatterns",
  ]);
  const entry = {
    value: fingerprint.alt || fingerprint.title,
    type: fingerprint.alt ? "alt" : "title",
  };
  if (!entry.value) return;
  if (!safePatterns.some((p) => p.value === entry.value))
    safePatterns.push(entry);
  if (!infrastructurePatterns.some((p) => p.value === entry.value))
    infrastructurePatterns.push({ ...entry, timestamp: Date.now() });
  await chrome.storage.local.set({
    safePatterns,
    infrastructurePatterns,
    globalAdPatterns: globalAdPatterns.filter((p) => p.value !== entry.value),
  });
}
export async function synthesizeGlobalPatterns() {
  const { userCustomRules = {}, safePatterns = [] } =
    await chrome.storage.local.get(["userCustomRules", "safePatterns"]);
  const freq = {};
  const spread = {};
  const add = (domain, type, value) => {
    if (!value || value.length < 3) return;
    const key = `${type}:${value}`;
    freq[key] = (freq[key] || 0) + 1;
    (spread[key] ||= new Set()).add(domain);
  };
  Object.entries(userCustomRules).forEach(([domain, rules]) =>
    rules.forEach((rule) => {
      const f = rule?.fingerprint;
      if (!f) return;
      add(domain, "alt", f.alt);
      add(domain, "title", f.title);
      add(domain, "domain", f.linkDomain);
      add(domain, "class", f.className);
      add(domain, "id", f.id);
      add(domain, "srcHost", f.srcHost);
      (f.classTokens || []).forEach((token) =>
        add(domain, "classToken", token),
      );
      (f.idTokens || []).forEach((token) => add(domain, "idToken", token));
    }),
  );
  const safe = (type, value) =>
    safePatterns.some((p) => p.type === type && p.value === value);
  const globalAdPatterns = Object.entries(freq)
    .filter(
      ([key]) =>
        !isProtectedPattern(key.split(":")[1]) && spread[key].size >= 1,
    )
    .map(([key, count]) => {
      const [type, value] = key.split(":");
      let confidence = Math.min((count + spread[key].size * 2) / 10, 1);
      if (safe(type, value)) confidence *= 0.3;
      return { type, value, confidence };
    });
  await chrome.storage.local.set({ globalAdPatterns });
}
