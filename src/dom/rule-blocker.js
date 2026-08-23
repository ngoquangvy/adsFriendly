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
const notifiedCustomSelectors = new Set();
const customRuleSnapshots = new Map();

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

    if (matched.length && !notifiedCustomSelectors.has(selector)) {
      notifiedCustomSelectors.add(selector);
      const element = matched[0];
      showDomHiddenToast(
        {
          target: element,
          selector,
          features: { tag: element.tagName.toLowerCase() },
          decision: {
            confidence: typeof rule === "string" ? 0.8 : rule.confidence || 0.8,
            reasons: ["saved_user_rule"],
          },
        },
        {
          onShow: () => restoreSavedRule(selector, rule, snapshots),
        },
      );
    }
  });
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

async function restoreSavedRule(selector, rule, snapshots) {
  snapshots.forEach((snapshot, element) =>
    restoreInlineVisibility(element, snapshot),
  );
  customRuleSnapshots.delete(selector);

  const { userCustomRules = {} } =
    await chrome.storage.local.get("userCustomRules");
  const rules = userCustomRules[location.hostname] || [];
  const remaining = rules.filter((entry) =>
    typeof entry === "string"
      ? entry !== selector
      : entry.selector !== selector,
  );
  if (remaining.length) userCustomRules[location.hostname] = remaining;
  else delete userCustomRules[location.hostname];
  await chrome.storage.local.set({ userCustomRules });

  if (typeof rule !== "string" && rule.fingerprint) {
    chrome.runtime.sendMessage({
      type: "NEGATIVE_LEARNING",
      fingerprint: rule.fingerprint,
    });
  }
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
      context: { selector, surface: "saved_rule_toast" },
      evidence: {
        fingerprint: typeof rule === "string" ? null : rule.fingerprint,
      },
      feedback: {
        user_action: "show",
        correction: "false_positive",
        surface: "saved_rule_toast",
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
