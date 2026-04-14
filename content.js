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
        'ins.adsbygoogle', 'iframe[src*="doubleclick"]',
        'a[href*="googleadservices.com"]',
        'a[href*="utm_"]', 'a[href*="clickid="]', 'a[href*="aff_id="]',
        'a[href*="javascript:hide_"]',
        'img[src*="googleusercontent.com"][title]',
        'img[src*="googleusercontent.com"][alt*="bet"]',
        'img[src*="googleusercontent.com"][alt*="win"]',
        'div[class*="popup-ad"]', 'div[id*="popup-ad"]'
    ];

    // Handle User Custom Rules (Support both strings and objects)
    const dangerousTags = ['div', 'span', 'p', 'a', 'li', 'ul', 'img', 'section'];

    customSelectors.forEach(rule => {
        const selector = typeof rule === 'string' ? rule : rule.selector;
        
        // Safety: skip if selector is just a single dangerous tag
        if (dangerousTags.includes(selector.toLowerCase().trim())) {
            return;
        }

        adSelectors.push(selector);

        // Pattern Matching: If it's an object with a fingerprint, find similar siblings
        if (typeof rule === 'object' && rule.fingerprint) {
            const { tag, parentClass, parentId } = rule.fingerprint;
            let parent = null;
            if (parentId) parent = document.getElementById(parentId);
            else if (parentClass) parent = document.querySelector(`.${parentClass.split(' ')[0]}`);

            if (parent) {
                parent.querySelectorAll(tag).forEach(sibling => {
                    // If sibling matches the fingerprint's class signature, mark it for hiding
                    if (!rule.fingerprint.className || sibling.className === rule.fingerprint.className) {
                        BLOCKING_STRATEGIES.STEALTH(sibling);
                    }
                });
            }
        }
    });

    adSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            BLOCKING_STRATEGIES.STEALTH(el);
        });
    });
};

// Run blocking periodically ONLY if 'Friendly Mode' is OFF
setInterval(async () => {
    try {
        const { friendlyMode, isEnabled, globalAdPatterns = [] } = await chrome.storage.local.get(['friendlyMode', 'isEnabled', 'globalAdPatterns']);
        if (isEnabled !== false && friendlyMode === false) {
            blockAds();

            // 3. AI Predictive Blocking (The Brain)
            if (globalAdPatterns.length > 0) {
                const elements = document.querySelectorAll('img, div, a');
                elements.forEach(el => {
                    // Skip if already hidden or is a UI element
                    if (el.style.opacity === '0' || (el.id && el.id.includes('adsfriendly'))) return;

                    let score = 0;
                    let matchDetails = [];
                    const calculateScore = (target) => {
                        let s = 0;
                        globalAdPatterns.forEach(pattern => {
                            if (pattern.type === 'alt' && target.alt === pattern.value) { s += pattern.confidence; matchDetails.push(`alt='${pattern.value}'`); }
                            if (pattern.type === 'title' && target.title === pattern.value) { s += pattern.confidence; matchDetails.push(`title='${pattern.value}'`); }
                            if (pattern.type === 'domain') {
                                const link = target.closest('a');
                                if (link && link.href && link.href.includes(pattern.value)) { s += pattern.confidence; matchDetails.push(`domain='${pattern.value}'`); }
                            }
                        });
                        return s;
                    };

                    score = calculateScore(el);

                    // Deep Reflex: Cluster Scoring (Check children)
                    if (score < 0.7 && el.children.length > 0) {
                        let childAdCount = 0;
                        const children = el.querySelectorAll('img, a');
                        children.forEach(child => {
                            if (calculateScore(child) >= 0.7) childAdCount++;
                        });
                        
                        // If more than 50% of identifiable children are ads, zap the cluster
                        if (children.length >= 2 && childAdCount / children.length >= 0.6) {
                            score = 1.0; 
                            matchDetails.push("Ad Cluster identified via children analysis");
                        }
                    }

                    // Same-Origin Shield: If it leads to the same domain, it's likely a legit UI feature
                    const link = el.closest('a');
                    if (link && link.href) {
                        try {
                            const url = new URL(link.href);
                            if (url.hostname === window.location.hostname) {
                                score -= 1.0; // Penalty for same-domain links
                            }
                        } catch (e) {}
                    }

                    if (score >= 0.8) {
                        console.log(`%c[AdsFriendly AI] Hiding predicted ad (%c${(score*100).toFixed(0)}% confidence%c) Reason: ${matchDetails.join(', ')}`, "color: #10b981; font-weight: bold;", "color: #fbd38d;", "color: #10b981;", el);
                        BLOCKING_STRATEGIES.STEALTH(el);
                    }
                });
            }
        }
    } catch (err) {}
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
