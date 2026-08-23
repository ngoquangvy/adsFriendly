import {
  STATIC_AD_SELECTORS,
  DANGEROUS_SELECTOR_TAGS,
} from "./ad-selectors.js";
import {
  BLOCKING_STRATEGIES,
  captureInlineVisibility,
  restoreInlineVisibility,
} from "./actions.js";
import { showDomHiddenToast } from "./toast.js";
import { isExtensionContextInvalidated } from "../shared/extension-context.js";
const PROTECTED_SELECTOR =
  'nav, header, [role="navigation"], form, [data-testid*="login" i]';
const customRuleSnapshots = new Map();
const savedRuleApplications = new Map();
const suppressedCustomSelectors = new Set();
let initialCustomSelectors = null;
let savedRuleSummaryShown = false;

export async function blockAdsOnPage() {
  const hostname = location.hostname;
  let customSelectors = [];
  let blockedCount = 0;
  let resetHistory = { oldRules: [] };
  try {
    const result = await chrome.storage.local.get([
      "userCustomRules",
      "siteResetHistory",
    ]);
    customSelectors = result.userCustomRules?.[hostname] || [];
    resetHistory = result.siteResetHistory?.[hostname] || resetHistory;
  } catch (error) {
    if (isExtensionContextInvalidated(error)) throw error;
  }
  if (!initialCustomSelectors) {
    initialCustomSelectors = new Set(
      customSelectors
        .map((rule) => (typeof rule === "string" ? rule : rule.selector))
        .filter(Boolean),
    );
  }
  const isBlacklisted = (el) =>
    resetHistory.oldRules.some((oldRule) => {
      if (typeof oldRule === "string") return false;
      const f = oldRule.fingerprint;
      return (
        f &&
        ((el.id && el.id === f.id) ||
          (el.className &&
            el.className === f.className &&
            el.tagName.toLowerCase() === f.tag))
      );
    });
  const hide = (selector, preserveProtectedArea = false) =>
    document.querySelectorAll(selector).forEach((el) => {
      if (isBlacklisted(el)) return;
      if (preserveProtectedArea && el.closest(PROTECTED_SELECTOR)) return;
      BLOCKING_STRATEGIES.STEALTH(el);
      blockedCount++;
    });
  customSelectors.forEach((rule) => {
    const selector = typeof rule === "string" ? rule : rule.selector;
    if (
      !selector ||
      suppressedCustomSelectors.has(selector) ||
      DANGEROUS_SELECTOR_TAGS.includes(selector.toLowerCase().trim())
    )
      return;
    const snapshots = customRuleSnapshots.get(selector) || new Map();
    const matched = [];
    document.querySelectorAll(selector).forEach((element) => {
      if (isBlacklisted(element)) return;
      if (!snapshots.has(element)) {
        snapshots.set(element, captureInlineVisibility(element));
      }
      BLOCKING_STRATEGIES.STEALTH(element);
      matched.push(element);
      blockedCount++;
    });
    customRuleSnapshots.set(selector, snapshots);

    if (matched.length && initialCustomSelectors.has(selector))
      savedRuleApplications.set(selector, { rule, snapshots });
  });
  showSavedRuleSummary();
  STATIC_AD_SELECTORS.forEach((selector) => hide(selector, true));
  if (blockedCount > 0) {
    try {
      await chrome.runtime.sendMessage({
        type: "REPORT_AD_DENSITY",
        hostname,
        count: blockedCount,
      });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) throw error;
    }
    window.postMessage(
      {
        source: "adsfriendly-content",
        type: "AD_DENSITY_VALUE",
        value: blockedCount,
      },
      "*",
    );
  }
}

function showSavedRuleSummary() {
  if (savedRuleSummaryShown || !savedRuleApplications.size) return;
  savedRuleSummaryShown = true;
  const applications = [...savedRuleApplications.entries()];
  const hiddenElements = new Set();
  applications.forEach(([, { snapshots }]) =>
    snapshots.forEach((_, element) => hiddenElements.add(element)),
  );
  const target = hiddenElements.values().next().value;
  if (!target) return;

  showDomHiddenToast(
    {
      target,
      hiddenCount: hiddenElements.size,
      savedRuleCount: applications.length,
      isSavedRuleSummary: true,
      features: { tag: "page" },
      decision: {
        confidence: 1,
        reasons: ["saved_user_rules"],
      },
    },
    {
      onShow: restoreSavedRules,
    },
  );
}

async function restoreSavedRules() {
  const applications = [...savedRuleApplications.entries()];
  const selectors = new Set(applications.map(([selector]) => selector));
  const response = await chrome.runtime.sendMessage({
    type: "RESTORE_CUSTOM_RULES",
    hostname: location.hostname,
    selectors: [...selectors],
  });
  if (response?.status !== "saved")
    throw new Error(response?.error || "Could not restore hidden elements.");

  selectors.forEach((selector) => suppressedCustomSelectors.add(selector));
  applications.forEach(([selector, { snapshots }]) => {
    snapshots.forEach((snapshot, element) =>
      restoreInlineVisibility(element, snapshot),
    );
    customRuleSnapshots.delete(selector);
  });
  savedRuleApplications.clear();

  const fingerprints = applications
    .map(([, { rule }]) => (typeof rule === "string" ? null : rule.fingerprint))
    .filter(Boolean);
  fingerprints.forEach((fingerprint) =>
    chrome.runtime.sendMessage({
      type: "NEGATIVE_LEARNING",
      fingerprint,
    }),
  );
  chrome.runtime.sendMessage({
    type: "RECORD_TELEMETRY",
    event: {
      schema_version: "dataset.v1",
      sample_id: randomId(),
      unit: "dom_element",
      label: "content",
      label_source: "user_show",
      label_strength: "strong",
      site: {
        hostname: location.hostname,
        url: location.href.split("#")[0],
      },
      timestamp: Date.now(),
      context: {
        selectors: [...selectors],
        hidden_count: new Set(
          applications.flatMap(([, { snapshots }]) => [...snapshots.keys()]),
        ).size,
        surface: "saved_rule_summary_toast",
      },
      evidence: { fingerprints },
      feedback: {
        user_action: "show",
        correction: "false_positive",
        surface: "saved_rule_summary_toast",
      },
      action: "allow",
      outcome: "user_show",
    },
  });
  chrome.runtime.sendMessage({ type: "SYNC_LEARNING" });
}

function randomId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
