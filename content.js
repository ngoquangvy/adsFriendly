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

const SYSTEM_WHITELIST = ['cloudflare.com', 'google.com', 'github.com', 'dash.cloudflare.com', 'stackexchange.com', 'stackoverflow.com'];

const blockAds = async () => {
    const hostname = window.location.hostname;
    const isSystemSafe = SYSTEM_WHITELIST.some(domain => hostname.includes(domain));
    
    let customSelectors = [];
    try {
        const result = await chrome.storage.local.get('userCustomRules');
        if (result && result.userCustomRules && result.userCustomRules[hostname]) {
            customSelectors = result.userCustomRules[hostname];
        }
    } catch (e) {}

    // 1. Generalized Ad Selectors + User Custom Selectors
    const adSelectors = [
        '[id*="google_ads"]', '[class*="adsbygoogle"]',
        '[class*="ad-container"]', '[class*="ad-box"]', '[id*="ad-"]',
        'ins.adsbygoogle', 'iframe[src*="doubleclick"]',
        'a[href*="googleadservices.com"]',
        'a[href*="utm_"]', 'a[href*="clickid="]', 'a[href*="aff_id="]',
        'a[href*="javascript:hide_"]',
        'img[src*="googleusercontent.com"][title]',
        'img[src*="googleusercontent.com"][alt*="bet"]',
        'img[src*="googleusercontent.com"][alt*="win"]',
        'div[class*="popup-ad"]', 'div[id*="popup-ad"]',
        ...customSelectors
    ];

    // Add greedy selectors ONLY if not on a system-critical page
    if (!isSystemSafe) {
        adSelectors.push('[class*="banner"]', '[id*="banner"]');
    }
    
    adSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            BLOCKING_STRATEGIES.STEALTH(el);
        });
    });

    // 2. Invisible Overlay Shield (Heuristic for click-jackers)
    // SKIP if on a system-critical page to protect sidebars and challenge modals
    if (!isSystemSafe) {
        const fixedElements = document.querySelectorAll('div, a');
        fixedElements.forEach(el => {
            // Safety: Skip system elements and interactive forms
            const id = el.id || '';
            const className = typeof el.className === 'string' ? el.className : '';
            if (id.includes('cf-') || className.includes('cf-') || id.includes('turnstile') || el.querySelector('form, input, select')) {
                return;
            }

            const style = window.getComputedStyle(el);
            if (style.position === 'fixed' || style.position === 'absolute') {
                const zIndex = parseInt(style.zIndex);
                if (zIndex > 990) {
                    const rect = el.getBoundingClientRect();
                    const vWidth = window.innerWidth;
                    const vHeight = window.innerHeight;
                    
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
    }
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
