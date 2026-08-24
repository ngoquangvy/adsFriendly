import { PROTECTION_MODES } from "./feature-catalog.js";

export const SETTINGS_KEY = "appSettings";

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  protectionMode: PROTECTION_MODES.SAFE,
  featureOverrides: Object.freeze({}),
});

export function normalizeSettings(value = {}) {
  const protectionMode = Object.values(PROTECTION_MODES).includes(
    value.protectionMode,
  )
    ? value.protectionMode
    : DEFAULT_SETTINGS.protectionMode;
  return {
    enabled: value.enabled !== false,
    protectionMode,
    featureOverrides:
      value.featureOverrides && typeof value.featureOverrides === "object"
        ? { ...value.featureOverrides }
        : {},
  };
}

export function migrateLegacySettings(stored = {}) {
  if (stored[SETTINGS_KEY]) return normalizeSettings(stored[SETTINGS_KEY]);
  const protectionMode =
    stored.friendlyMode === false
      ? PROTECTION_MODES.AUTO
      : PROTECTION_MODES.SAFE;
  return normalizeSettings({
    enabled: stored.isEnabled !== false,
    protectionMode,
  });
}

export async function loadSettings(storage = chrome.storage.local) {
  const stored = await storage.get([SETTINGS_KEY, "isEnabled", "friendlyMode"]);
  const settings = migrateLegacySettings(stored);
  if (!stored[SETTINGS_KEY]) await storage.set({ [SETTINGS_KEY]: settings });
  return settings;
}

export async function saveSettings(
  nextSettings,
  storage = chrome.storage.local,
) {
  const settings = normalizeSettings(nextSettings);
  const updates = {
    [SETTINGS_KEY]: settings,
    isEnabled: settings.enabled,
    friendlyMode: settings.protectionMode === PROTECTION_MODES.SAFE,
  };
  await storage.set(updates);
  const saved = await storage.get(Object.keys(updates));
  for (const [key, expected] of Object.entries(updates)) {
    if (JSON.stringify(saved[key]) !== JSON.stringify(expected))
      throw new Error(`Could not verify saved setting: ${key}.`);
  }
  return settings;
}

export function subscribeSettings(listener, storageArea = "local") {
  const onChanged = (changes, areaName) => {
    if (areaName !== storageArea || !changes[SETTINGS_KEY]) return;
    listener(normalizeSettings(changes[SETTINGS_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}
