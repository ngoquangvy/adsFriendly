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
    // 1. Generalized Ad Selectors (Based on common patterns, not site-specific)
    const adSelectors = [
        '[id*="google_ads"]', '[class*="adsbygoogle"]',
        '[class*="ad-container"]', '[class*="ad-box"]', '[id*="ad-"]',
        '[class*="banner"]', '[id*="banner"]',
        'ins.adsbygoogle', 'iframe[src*="doubleclick"]',
        'a[href*="googleadservices.com"]',
        'a[href*="utm_"]', 'a[href*="clickid="]', 'a[href*="aff_id="]', // Universal tracking
        'a[href*="javascript:hide_"]', // Catfish/Banners close functions
        'img[src*="googleusercontent.com"][title]',
        'img[src*="googleusercontent.com"][alt*="bet"]',
        'img[src*="googleusercontent.com"][alt*="win"]',
        'div[class*="popup-ad"]', 'div[id*="popup-ad"]'
    ];
    
    adSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            BLOCKING_STRATEGIES.STEALTH(el);
        });
    });

    // 2. Invisible Overlay Shield (Heuristic for click-jackers)
    const fixedElements = document.querySelectorAll('div, a');
    fixedElements.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'absolute') {
            const zIndex = parseInt(style.zIndex);
            if (zIndex > 990) {
                const rect = el.getBoundingClientRect();
                const vWidth = window.innerWidth;
                const vHeight = window.innerHeight;
                
                // If it covers more than 50% of the viewport and is nearly transparent
                // it's likely a pop-under trigger overlay
                if (rect.width > vWidth * 0.5 && rect.height > vHeight * 0.5) {
                    const bgColor = style.backgroundColor;
                    const isTransparent = bgColor.includes('rgba') && bgColor.endsWith(' 0)') || bgColor === 'transparent';
                    
                    if (isTransparent || parseFloat(style.opacity) < 0.1) {
                        BLOCKING_STRATEGIES.STEALTH(el);
                    }
                }
            }
        }
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
