import * as schema from "../settings-package/schema.js";
import { normalizeSettings } from "../runtime/settings-store.js";
import { classifyNavigationIntent } from "../navigation/shared/intent-classifier.js";
import {
  getResponsiveLayout,
  ruleMatchesResponsiveLayout,
} from "../dom/layout-context.js";
import {
  buildDomSelector,
  extractDomFeatures,
  isReusableDomSelector,
} from "../dom/features.js";
import {
  createElementException,
  matchesElementException,
} from "../dom/element-exceptions.js";
import * as navigation from "./navigation.js";
import { createHiddenElements } from "./dom-state.js";
import { createReviewQueue } from "./review-queue.js";

const extensionApi = globalThis.browser || globalThis.chrome;
export function safeDomSelector(selector) {
  return (
    isReusableDomSelector(selector) &&
    selector.length <= 500 &&
    !selector.includes(":has(") &&
    ![
      "head",
      "header",
      "nav",
      "main",
      "form",
      "div",
      "span",
      "p",
      "a",
      "li",
      "ul",
      "img",
      "section",
      "iframe",
      "video",
    ].includes(selector.trim().toLowerCase())
  );
}
export function iosFeatureEnabled(settings, featureId) {
  return (
    settings?.enabled !== false &&
    settings?.featureOverrides?.[featureId] !== false
  );
}
export function callApi(object, method, ...args) {
  return new Promise((resolve, reject) => {
    try {
      object[method](...args, (result) => {
        const error = extensionApi?.runtime?.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}
export function storageAdapter(area = extensionApi.storage.local) {
  return Object.fromEntries(
    ["get", "set", "remove"].map((method) => [
      method,
      (...args) => callApi(area, method, ...args),
    ]),
  );
}
let tail = Promise.resolve();
export function serialMutation(operation) {
  const result = tail.then(operation);
  tail = result.catch(() => {});
  return result;
}
const backupKey = "afsPackageBackup";
const managedKeys = [
  "appSettings",
  "isEnabled",
  "friendlyMode",
  "whitelist",
  "blacklist",
  "userCustomRules",
  "userElementExceptions",
  "settingsPackageState",
  "afsAllowedPopupHosts",
  "afsBlockedPopupHosts",
  "afsAllowedDomSelectors",
];
const managed = (key) => managedKeys.includes(key) || key.startsWith("p:");
function managedSnapshot(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => managed(key)),
  );
}
async function restoreSnapshot(snapshot, storage) {
  const current = await storage.get(null);
  await storage.set(snapshot);
  const obsolete = Object.keys(current).filter(
    (key) => managed(key) && !(key in snapshot),
  );
  if (obsolete.length) await storage.remove(obsolete);
  const saved = managedSnapshot(await storage.get(null));
  for (const [key, value] of Object.entries(snapshot)) {
    if (JSON.stringify(saved[key]) !== JSON.stringify(value))
      throw new Error("Could not verify restored settings: " + key);
  }
}
export async function importPackage(input, storage = storageAdapter()) {
  if (new TextEncoder().encode(JSON.stringify(input)).length > 2 * 1024 * 1024)
    throw new Error("Package exceeds 2 MB.");
  const normalized = schema.normalizeSettingsPackage(input);
  return serialMutation(async () => {
    const current = await storage.get(null);
    const before = managedSnapshot(current);
    await storage.set({
      [backupKey]: { savedAt: Date.now(), snapshot: before },
    });
    try {
      await schema.replaceSettingsWithPackage(normalized, storage, "imported");
      // Legacy popup decisions must not override the newly imported package.
      await storage.set({
        afsAllowedPopupHosts: {},
        afsBlockedPopupHosts: {},
        afsAllowedDomSelectors: {},
      });
    } catch (error) {
      await restoreSnapshot(before, storage);
      if (current[backupKey]) await storage.set({ [backupKey]: current[backupKey] });
      else await storage.remove(backupKey);
      throw error;
    }
    return schema.summarizeSettingsPackage(normalized);
  });
}
export function undoImport(storage = storageAdapter()) {
  return serialMutation(async () => {
    const data = await storage.get(backupKey);
    const backup = data[backupKey];
    if (!backup?.snapshot) throw new Error("No import to undo.");
    await restoreSnapshot(backup.snapshot, storage);
    await storage.remove(backupKey);
  });
}
function callbackResult(promise, callback) {
  promise.then(
    (result) => callback(null, result),
    (error) => callback(error),
  );
}
async function loadBundled() {
  const response = await fetch(
    extensionApi.runtime.getURL(schema.BUNDLED_SETTINGS_PACKAGE_PATH),
  );
  if (!response.ok)
    throw new Error(`Cannot load bundled package (${response.status}).`);
  return schema.normalizeSettingsPackage(await response.json());
}
async function initialize(storage) {
  const data = await storage.get(null);
  if (data[schema.SETTINGS_PACKAGE_STATE_KEY]?.initialized)
    return "already_initialized";
  if (
    schema.hasMeaningfulExistingSettings(data) ||
    Object.keys(data.afsAllowedPopupHosts || {}).length ||
    Object.keys(data.afsBlockedPopupHosts || {}).length
  ) {
    await storage.set({
      [schema.SETTINGS_PACKAGE_STATE_KEY]: {
        initialized: true,
        source: "existing_settings",
        installed_at: Date.now(),
      },
    });
    return "preserved_existing_settings";
  }
  await schema.replaceSettingsWithPackage(
    await loadBundled(),
    storage,
    "bundled",
  );
  return "installed_bundled_package";
}
if (typeof window !== "undefined") {
  window.AFSettingsPackage = {
    normalize: schema.normalizeSettingsPackage,
    normalizeApp: normalizeSettings,
    normalizeHost(value) {
      try {
        return new URL(
          String(value || "")
            .replace(/^\|\|/, "")
            .replace(/\^$/, "")
            .replace(/^(?![a-z]+:\/\/)/, "https://"),
        ).hostname;
      } catch {
        return "";
      }
    },
    summarize: schema.summarizeSettingsPackage,
    packageToStorage: schema.packageToStorage,
    initialize(area, callback) {
      callbackResult(
        serialMutation(() => initialize(storageAdapter(area))),
        callback,
      );
    },
    install(input, area, source, callback) {
      callbackResult(
        importPackage(input, storageAdapter(area)).then(() =>
          schema.normalizeSettingsPackage(input),
        ),
        callback,
      );
    },
  };
  window.AFShared = {
    ...schema,
    ...navigation,
    safeDomSelector,
    iosFeatureEnabled,
    createHiddenElements,
    createReviewQueue,
    callApi,
    storageAdapter,
    serialMutation,
    importPackage,
    undoImport,
    classifyNavigationIntent,
    getResponsiveLayout,
    ruleMatchesResponsiveLayout,
    buildDomSelector,
    extractDomFeatures,
    isReusableDomSelector,
    createElementException,
    matchesElementException,
  };
}
