import {
  DEFAULT_SETTINGS,
  normalizeSettings,
} from "../runtime/settings-store.js";

export const SETTINGS_PACKAGE_SCHEMA = "adsfriendly.settings-package.v1";
export const SETTINGS_PACKAGE_STATE_KEY = "settingsPackageState";
export const BUNDLED_SETTINGS_PACKAGE_PATH =
  "packages/default-settings-package.json";

const MAX_RULES = 5000;
const MAX_RULES_PER_SITE = 250;
const MAX_SELECTOR_LENGTH = 500;
const DANGEROUS_SELECTORS = new Set([
  "*",
  "html",
  "body",
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
]);
const VALID_RULE_LAYOUTS = new Set(["any", "compact", "wide"]);

export function createSettingsPackage(storageSnapshot = {}, metadata = {}) {
  const trustedPaths = Object.entries(storageSnapshot)
    .filter(([key, value]) => key.startsWith("p:") && value)
    .map(([, value]) => value);

  return normalizeSettingsPackage({
    schema_version: SETTINGS_PACKAGE_SCHEMA,
    metadata: {
      id: metadata.id || `local.${Date.now()}`,
      name: metadata.name || "AdsFriendly Settings",
      author: metadata.author || "AdsFriendly User",
      version: metadata.version || "1.0.0",
      description: metadata.description || "Exported AdsFriendly configuration",
      created_at: metadata.created_at || new Date().toISOString(),
    },
    settings: {
      app: storageSnapshot.appSettings || DEFAULT_SETTINGS,
      whitelist: storageSnapshot.whitelist || [],
      blacklist: storageSnapshot.blacklist || [],
      custom_rules: storageSnapshot.userCustomRules || {},
      trusted_paths: trustedPaths,
    },
  });
}

export function normalizeSettingsPackage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Settings package must be a JSON object.");
  }
  if (input.schema_version !== SETTINGS_PACKAGE_SCHEMA) {
    throw new Error(
      `Unsupported package schema: ${String(input.schema_version || "missing")}`,
    );
  }

  const metadata = normalizeMetadata(input.metadata);
  const rawSettings = input.settings || {};
  const customRules = normalizeCustomRules(rawSettings.custom_rules);
  const totalRules = Object.values(customRules).reduce(
    (count, rules) => count + rules.length,
    0,
  );
  if (totalRules > MAX_RULES) {
    throw new Error(`Package exceeds the ${MAX_RULES} rule limit.`);
  }

  return {
    schema_version: SETTINGS_PACKAGE_SCHEMA,
    metadata,
    settings: {
      app: normalizeSettings(rawSettings.app),
      whitelist: normalizeDomainList(rawSettings.whitelist, false),
      blacklist: normalizeDomainList(rawSettings.blacklist, true),
      custom_rules: customRules,
      trusted_paths: normalizeTrustedPaths(rawSettings.trusted_paths),
    },
  };
}

export function packageToStorage(packageInput) {
  const settingsPackage = normalizeSettingsPackage(packageInput);
  const appSettings = settingsPackage.settings.app;
  const updates = {
    appSettings,
    isEnabled: appSettings.enabled,
    friendlyMode: appSettings.protectionMode === "safe",
    whitelist: settingsPackage.settings.whitelist,
    blacklist: settingsPackage.settings.blacklist,
    userCustomRules: settingsPackage.settings.custom_rules,
  };
  for (const path of settingsPackage.settings.trusted_paths) {
    updates[`p:${path.source}>${path.target}`] = path;
  }
  return updates;
}

export async function replaceSettingsWithPackage(
  packageInput,
  storage = chrome.storage.local,
  source = "imported",
) {
  const settingsPackage = normalizeSettingsPackage(packageInput);
  const current = await storage.get(null);
  const oldPathKeys = Object.keys(current).filter((key) =>
    key.startsWith("p:"),
  );
  const updates = {
    ...packageToStorage(settingsPackage),
    [SETTINGS_PACKAGE_STATE_KEY]: {
      schema_version: "adsfriendly.settings-package-state.v1",
      initialized: true,
      source,
      package: settingsPackage.metadata,
      installed_at: Date.now(),
    },
  };
  await storage.set(updates);
  const saved = await storage.get(Object.keys(updates));
  for (const [key, expected] of Object.entries(updates)) {
    if (JSON.stringify(saved[key]) !== JSON.stringify(expected))
      throw new Error(`Could not verify imported setting: ${key}.`);
  }
  const obsoletePathKeys = oldPathKeys.filter((key) => !(key in updates));
  if (obsoletePathKeys.length) await storage.remove(obsoletePathKeys);
  return settingsPackage;
}

export function summarizeSettingsPackage(packageInput) {
  const settingsPackage = normalizeSettingsPackage(packageInput);
  return {
    name: settingsPackage.metadata.name,
    author: settingsPackage.metadata.author,
    version: settingsPackage.metadata.version,
    whitelistCount: settingsPackage.settings.whitelist.length,
    blacklistCount: settingsPackage.settings.blacklist.length,
    siteCount: Object.keys(settingsPackage.settings.custom_rules).length,
    ruleCount: Object.values(settingsPackage.settings.custom_rules).reduce(
      (count, rules) => count + rules.length,
      0,
    ),
    trustedPathCount: settingsPackage.settings.trusted_paths.length,
  };
}

export function hasMeaningfulExistingSettings(snapshot = {}) {
  const settings = normalizeSettings(snapshot.appSettings);
  const settingsDiffer =
    settings.enabled !== DEFAULT_SETTINGS.enabled ||
    settings.protectionMode !== DEFAULT_SETTINGS.protectionMode ||
    Object.keys(settings.featureOverrides).length > 0;
  return (
    settingsDiffer ||
    (snapshot.whitelist?.length || 0) > 0 ||
    (snapshot.blacklist?.length || 0) > 0 ||
    Object.keys(snapshot.userCustomRules || {}).length > 0 ||
    Object.keys(snapshot).some((key) => key.startsWith("p:"))
  );
}

function normalizeMetadata(metadata = {}) {
  return {
    id: cleanText(metadata.id || `package.${Date.now()}`, 120),
    name: cleanText(metadata.name || "AdsFriendly Settings", 120),
    author: cleanText(metadata.author || "Unknown", 120),
    version: cleanText(metadata.version || "1.0.0", 40),
    description: cleanText(metadata.description || "", 500),
    created_at: cleanText(metadata.created_at || new Date().toISOString(), 80),
  };
}

function normalizeDomainList(values, blacklist) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map(normalizeHostname)
        .filter(Boolean)
        .map((hostname) => (blacklist ? `||${hostname}^` : hostname)),
    ),
  ].slice(0, 2000);
}

function normalizeCustomRules(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [rawHostname, rawRules] of Object.entries(value)) {
    const hostname = normalizeHostname(rawHostname);
    if (!hostname || !Array.isArray(rawRules)) continue;
    const rules = rawRules
      .slice(0, MAX_RULES_PER_SITE)
      .map(normalizeRule)
      .filter(Boolean);
    if (rules.length) result[hostname] = dedupeRules(rules);
  }
  return result;
}

function normalizeRule(rule) {
  const rawSelector = typeof rule === "string" ? rule : rule?.selector;
  const selector = cleanText(rawSelector, MAX_SELECTOR_LENGTH);
  if (!isSafeSelector(selector)) return null;
  if (typeof rule === "string") return selector;
  const normalized = {
    selector,
    fingerprint: normalizeFingerprint(rule.fingerprint),
    confidence: clampNumber(rule.confidence, 0, 1, 0.8),
    source: cleanText(rule.source || "package", 80),
    layout: VALID_RULE_LAYOUTS.has(rule.layout) ? rule.layout : "any",
  };
  if (rule.isCorrection === true) normalized.isCorrection = true;
  return normalized;
}

function normalizeFingerprint(fingerprint) {
  if (!fingerprint || typeof fingerprint !== "object") return null;
  return {
    tag: cleanText(fingerprint.tag, 30) || null,
    id: cleanText(fingerprint.id, 160) || null,
    className: cleanText(fingerprint.className, 300) || null,
    alt: cleanText(fingerprint.alt, 300) || null,
    title: cleanText(fingerprint.title, 300) || null,
    linkDomain: normalizeHostname(fingerprint.linkDomain) || null,
    srcHost: normalizeHostname(fingerprint.srcHost) || null,
    idTokens: normalizeTokens(fingerprint.idTokens),
    classTokens: normalizeTokens(fingerprint.classTokens),
  };
}

function normalizeTrustedPaths(paths) {
  if (!Array.isArray(paths)) return [];
  const byKey = new Map();
  for (const raw of paths.slice(0, 2000)) {
    const source = normalizeHostname(raw?.source);
    const target = normalizeHostname(raw?.target);
    if (!source || !target || source === target) continue;
    byKey.set(`${source}>${target}`, {
      source,
      target,
      visits: Math.max(0, Math.min(999999, Number(raw.visits) || 0)),
      isManual: raw.isManual === true,
      lastUpdated: Number(raw.lastUpdated) || Date.now(),
    });
  }
  return [...byKey.values()];
}

function normalizeHostname(value) {
  const raw = String(value || "")
    .trim()
    .replace(/^\|\|/, "")
    .replace(/\^$/, "");
  if (!raw) return "";
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const hostname = parsed.hostname.toLowerCase();
    return /^[a-z0-9.-]+$/.test(hostname) ? hostname.slice(0, 253) : "";
  } catch {
    return "";
  }
}

function isSafeSelector(selector) {
  if (!selector || selector.length > MAX_SELECTOR_LENGTH) return false;
  const normalized = selector.toLowerCase().trim();
  if (DANGEROUS_SELECTORS.has(normalized)) return false;
  if (normalized.includes(":has(")) return false;
  try {
    if (typeof document !== "undefined") document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function dedupeRules(rules) {
  const seen = new Set();
  return rules.filter((rule) => {
    const selector = typeof rule === "string" ? rule : rule.selector;
    if (seen.has(selector)) return false;
    seen.add(selector);
    return true;
  });
}

function normalizeTokens(values) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.map((value) => cleanText(value, 80).toLowerCase()).filter(Boolean),
    ),
  ].slice(0, 40);
}

function cleanText(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
