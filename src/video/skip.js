const SKIP_SELECTORS = [
  ".ytp-ad-skip-button",
  ".ytp-ad-skip-button-modern",
  ".ytp-ad-skip-button-container",
  ".videoAdUiSkipButton",
  ".fluid_ad_skip_button",
  'button[class*="skip"]',
  '[aria-label*="Skip ad"]',
];
export function autoSkip() {
  SKIP_SELECTORS.forEach((sel) => {
    const btn = document.querySelector(sel);
    clickIfVisible(btn);
  });
  document
    .querySelectorAll('button, div[role="button"], span[role="button"]')
    .forEach((btn) => {
      const txt = btn.textContent.toLowerCase();
      if (
        (txt.includes("skip") || txt.includes("bỏ qua")) &&
        (txt.includes("ad") || txt.includes("quảng")) &&
        isVisible(btn)
      )
        clickIfVisible(btn);
    });
}

function clickIfVisible(el) {
  if (!isVisible(el) || typeof el.click !== "function") return;
  el.click();
}

function isVisible(el) {
  if (!el) return false;
  return el.offsetParent !== null || el.getClientRects().length > 0;
}
