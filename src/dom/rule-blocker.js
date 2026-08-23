import {
  STATIC_AD_SELECTORS,
  DANGEROUS_SELECTOR_TAGS,
} from "./ad-selectors.js";
import { BLOCKING_STRATEGIES } from "./actions.js";
import { isExtensionContextInvalidated } from "../shared/extension-context.js";
const PROTECTED_SELECTOR =
  'nav, header, [role="navigation"], form, [data-testid*="login" i]';

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
    hide(selector);
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
