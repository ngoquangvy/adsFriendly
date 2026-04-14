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

// BLOCKING STRATEGIES
// We use a modular approach so we can easily add "Destruction Mode" later.
const BLOCKING_STRATEGIES = {
    STEALTH: (el) => {
        // Hide without changing layout to avoid detection
        if (el.style.opacity !== '0') {
            el.style.setProperty('opacity', '0', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
        }
    },
    DESTRUCTIVE: (el) => {
        // Placeholder for future aggressive removal
        // el.style.setProperty('display', 'none', 'important');
    }
};

const blockAds = () => {
    const adSelectors = [
        '[id*="google_ads"]',
        '[class*="adsbygoogle"]',
        '[class*="ad-container"]',
        '[class*="ad-box"]',
        '[id*="ad-"]',
        'ins.adsbygoogle',
        'iframe[src*="doubleclick"]',
        'a[href*="googleadservices.com"]',
        'img[src*="googleusercontent.com"][title]', // Banners often have titles
        'img[src*="googleusercontent.com"][alt*="ads"]',
        'div[class*="popup-ad"]',
        'div[id*="popup-ad"]'
    ];
    
    adSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            // Apply current active strategy: STEALTH
            BLOCKING_STRATEGIES.STEALTH(el);
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
