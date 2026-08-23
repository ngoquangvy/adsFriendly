import { CAPABILITIES } from "../runtime/feature-catalog.js";

const SKIP_SELECTORS = [
  ".ytp-ad-skip-button",
  ".ytp-ad-skip-button-modern",
  ".ytp-ad-skip-button-container",
  ".videoAdUiSkipButton",
  ".fluid_ad_skip_button",
  'button[class*="skip"]',
  '[aria-label*="Skip ad"]',
];

export function autoSkip(policy) {
  if (!policy?.can(CAPABILITIES.VIDEO_AUTO_ACTION)) return;
  SKIP_SELECTORS.forEach((selector) => {
    const button = document.querySelector(selector);
    clickIfVisible(button);
  });
  document
    .querySelectorAll('button, div[role="button"], span[role="button"]')
    .forEach((button) => {
      const text = button.textContent.toLowerCase();
      if (
        (text.includes("skip") || text.includes("bỏ qua")) &&
        (text.includes("ad") || text.includes("quảng")) &&
        isVisible(button)
      ) {
        clickIfVisible(button);
      }
    });
}

function clickIfVisible(element) {
  if (!isVisible(element) || typeof element.click !== "function") return;
  element.click();
}

function isVisible(element) {
  if (!element) return false;
  return element.offsetParent !== null || element.getClientRects().length > 0;
}
