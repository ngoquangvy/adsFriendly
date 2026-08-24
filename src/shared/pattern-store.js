export const DOM_PATTERN_TYPES = new Set([
  "alt",
  "title",
  "domain",
  "class",
  "id",
  "srcHost",
  "classToken",
  "idToken",
]);
export const VIDEO_PATTERN_TYPES = new Set([
  "video_source_marker",
  "video_marker",
]);

export async function getGlobalPatterns() {
  const { globalAdPatterns = [] } =
    await chrome.storage.local.get("globalAdPatterns");
  return Array.isArray(globalAdPatterns) ? globalAdPatterns : [];
}

export async function getDomPatterns() {
  return (await getGlobalPatterns()).filter((pattern) =>
    DOM_PATTERN_TYPES.has(pattern?.type),
  );
}

export async function getVideoPatterns() {
  return (await getGlobalPatterns()).filter((pattern) =>
    VIDEO_PATTERN_TYPES.has(pattern?.type),
  );
}

export async function upsertGlobalPattern(nextPattern, merge) {
  if (!nextPattern?.type || !nextPattern.value) return;
  const globalAdPatterns = await getGlobalPatterns();
  const existing = globalAdPatterns.find(
    (pattern) =>
      pattern.type === nextPattern.type && pattern.value === nextPattern.value,
  );
  if (existing) {
    Object.assign(existing, merge ? merge(existing, nextPattern) : nextPattern);
  } else {
    globalAdPatterns.push(nextPattern);
  }
  await chrome.storage.local.set({ globalAdPatterns });
}
