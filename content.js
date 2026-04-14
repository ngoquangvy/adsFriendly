// Content Script for Smart BlockAd

// Listen for clicks to track user intent
document.addEventListener('mousedown', (event) => {
  if (event.isTrusted) {
    // Notify background script that a trusted user interaction occurred
    chrome.runtime.sendMessage({ type: 'TRUSTED_CLICK' });
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

// Run blocking periodically (or use MutationObserver for better performance)
setInterval(blockAds, 2000);
blockAds();
