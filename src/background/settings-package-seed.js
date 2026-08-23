import {
  BUNDLED_SETTINGS_PACKAGE_PATH,
  SETTINGS_PACKAGE_STATE_KEY,
  hasMeaningfulExistingSettings,
  normalizeSettingsPackage,
  replaceSettingsWithPackage,
} from "../settings-package/schema.js";

export async function initializeBundledSettingsPackage(
  storage = chrome.storage.local,
  fetchPackage = loadBundledSettingsPackage,
) {
  const snapshot = await storage.get(null);
  if (snapshot[SETTINGS_PACKAGE_STATE_KEY]?.initialized) {
    return { status: "already_initialized" };
  }

  if (hasMeaningfulExistingSettings(snapshot)) {
    await storage.set({
      [SETTINGS_PACKAGE_STATE_KEY]: {
        schema_version: "adsfriendly.settings-package-state.v1",
        initialized: true,
        source: "existing_settings",
        package: null,
        installed_at: Date.now(),
      },
    });
    return { status: "preserved_existing_settings" };
  }

  const settingsPackage = await fetchPackage();
  await replaceSettingsWithPackage(settingsPackage, storage, "bundled");
  return { status: "installed_bundled_package" };
}

export async function loadBundledSettingsPackage() {
  const response = await fetch(
    chrome.runtime.getURL(BUNDLED_SETTINGS_PACKAGE_PATH),
  );
  if (!response.ok) {
    throw new Error(`Could not load bundled settings (${response.status}).`);
  }
  return normalizeSettingsPackage(await response.json());
}
