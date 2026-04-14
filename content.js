// Content Script for Smart BlockAd

// Listen for clicks to track user intent
document.addEventListener('mousedown', (event) => {
  if (event.isTrusted) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        // Notify background script that a trusted user interaction occurred
        chrome.runtime.sendMessage({ type: 'TRUSTED_CLICK' });
      }
    } catch (e) {
      // Ignored: extension context invalidated
    }
  }
}, true); // Use capture phase to ensure we catch it before other scripts

// Cosmetic Filtering: Periodically check for common ad elements and hide them
const blockAds = () => {
    const adSelectors = [
        '[id*="google_ads"]',
        '[class*="adsbygoogle"]',
        '[class*="ad-container"]',
        '[id*="ad-"]',
        'ins.adsbygoogle',
        'iframe[src*="doubleclick"]'
    ];
    
    adSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            if (el.style.display !== 'none') {
                el.style.setProperty('display', 'none', 'important');
            }
        });
    });
};

// Run blocking periodically ONLY if 'Friendly Mode' is OFF
setInterval(async () => {
    try {
        const { friendlyMode, isEnabled } = await chrome.storage.local.get(['friendlyMode', 'isEnabled']);
        if (isEnabled !== false && friendlyMode === false) {
            blockAds();
        }
    } catch (err) {
        // Extension context invalidated - safe to ignore
    }
}, 2000);

// Initial check
try {
    chrome.storage.local.get(['friendlyMode', 'isEnabled'], (result) => {
        if (result && result.isEnabled !== false && result.friendlyMode === false) {
            blockAds();
        }
    });
} catch (err) {
    // Extension context invalidated
}
