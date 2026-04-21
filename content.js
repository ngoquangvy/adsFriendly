(function () {
    // Note: Engine injection and page bridge live in loader.js.
    // content.js focuses on in-page blocking and UX hooks only.

    // 2. Main Blocking Logic (Asynchronous)
    (async function () {
        // GLOBAL GOVERNANCE: Check status before moving an inch
        const { isEnabled, friendlyMode } = await chrome.storage.local.get(['isEnabled', 'friendlyMode']);
        if (isEnabled === false) return;

        // YouTube Specialized Neutralization (v2.7 - Tube Surgeon)
        const neutralizeYouTubeUI = () => {
            if (window.location.hostname !== 'www.youtube.com') return;

            const adSelectors = [
                'ytd-masthead-ad-v3-renderer', // Homepage Big Masthead
                'ytd-promoted-video-renderer', // Search Results Promoted Video
                'ytd-display-ad-renderer',      // Sidebar Display Ads
                'ytd-ad-slot-renderer',         // New Ad containers
                'ytd-promoted-sparkles-web-renderer', // Top of results UI
                '#masthead-ad',                 // Legacy Masthead
                '.ytd-video-masthead-ad-v3-renderer',
                '.ytd-promoted-video-renderer'
            ];

            adSelectors.forEach(sel => {
                const elements = document.querySelectorAll(sel);
                elements.forEach(el => {
                    if (el.style.display !== 'none') {
                        el.style.setProperty('display', 'none', 'important');
                        console.log(`[AdsFriendly AI] YouTube UI Ad Neutralized: ${sel}`);
                    }
                });
            });

            // Heuristic: Hide anything with "Sponsored" or "quang cao" label in video titles
            const cards = document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer');
            cards.forEach(card => {
                const label = card.innerText.trim().toLowerCase();
                if (label.includes('sponsored') || label.includes('duoc tai tro') || label.includes('quang cao')) {
                    if (card.style.display !== 'none') {
                        card.style.setProperty('display', 'none', 'important');
                        console.log('[AdsFriendly AI] YouTube Promoted Video hidden.');
                    }
                }
            });
        };

        // Run YT neutralization periodically (YouTube is heavy SPA)
        setInterval(neutralizeYouTubeUI, 2000);

        let lastTrustedClick = 0;

        // Listen for clicks to track user intent (v2.6 Intent Lock)
        document.addEventListener('mousedown', (event) => {
            if (event.isTrusted) {
                try {
                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
                        // Capture the intended destination
                        const link = event.target.closest('a');
                        const intentUrl = link ? link.href : null;

                        chrome.runtime.sendMessage({
                            type: 'TRUSTED_CLICK',
                            intentUrl: intentUrl
                        });
                    }
                } catch (e) { }
            }
        }, true);

        const BLOCKING_STRATEGIES = {
            STEALTH: (el) => {
                if (el.style.opacity !== '0') {
                    el.style.setProperty('opacity', '0', 'important');
                    el.style.setProperty('visibility', 'hidden', 'important');
                    el.style.setProperty('pointer-events', 'none', 'important');
                }
            }
        };

        const blockAds = async () => {
            const hostname = window.location.hostname;
            let customSelectors = [];
            let blockedCount = 0;
            let resetHistory = { oldRules: [] };

            try {
                const result = await chrome.storage.local.get(['userCustomRules', 'siteResetHistory']);
                if (result && result.userCustomRules && result.userCustomRules[hostname]) {
                    customSelectors = result.userCustomRules[hostname];
                }
                if (result && result.siteResetHistory && result.siteResetHistory[hostname]) {
                    resetHistory = result.siteResetHistory[hostname];
                }
            } catch (e) { }

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

            const dangerousTags = ['div', 'span', 'p', 'a', 'li', 'ul', 'img', 'section'];

            const isBlacklisted = (el) => {
                return resetHistory.oldRules.some(oldRule => {
                    if (typeof oldRule === 'string') return false;
                    const oldF = oldRule.fingerprint;
                    if (!oldF) return false;
                    return (el.id && el.id === oldF.id) ||
                        (el.className && el.className === oldF.className && el.tagName.toLowerCase() === oldF.tag);
                });
            };

            customSelectors.forEach(rule => {
                const selector = typeof rule === 'string' ? rule : rule.selector;
                if (dangerousTags.includes(selector.toLowerCase().trim())) return;

                document.querySelectorAll(selector).forEach(el => {
                    if (isBlacklisted(el)) return;
                    BLOCKING_STRATEGIES.STEALTH(el);
                    blockedCount++;
                });
            });

            adSelectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(el => {
                    if (isBlacklisted(el)) return;
                    BLOCKING_STRATEGIES.STEALTH(el);
                    blockedCount++;
                });
            });

            // Report density to background and other modules
            if (blockedCount > 0) {
                chrome.runtime.sendMessage({ type: 'REPORT_AD_DENSITY', hostname, count: blockedCount });
                window.postMessage({ source: 'adsfriendly-content', type: 'AD_DENSITY_VALUE', value: blockedCount }, '*');
            }
        };

        // Initial block
        blockAds();

        setInterval(async () => {
            try {
                const { friendlyMode, isEnabled, globalAdPatterns = [] } = await chrome.storage.local.get(['friendlyMode', 'isEnabled', 'globalAdPatterns']);
                if (isEnabled === false || friendlyMode === true) return;

                // 1. Static Blocking
                blockAds();

                // 2. High-Confidence AI Perception (Only in Full AI Mode)
                if (globalAdPatterns.length > 0) {
                    const elements = document.querySelectorAll('img, div, a');
                    elements.forEach(el => {
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

                        if (score < 0.7 && el.children.length > 0) {
                            let childAdCount = 0;
                            const children = el.querySelectorAll('img, a');
                            children.forEach(child => {
                                if (calculateScore(child) >= 0.7) childAdCount++;
                            });
                            if (children.length >= 2 && childAdCount / children.length >= 0.6) {
                                score = 1.0;
                                matchDetails.push("Ad Cluster identified via children analysis");
                            }
                        }

                        const link = el.closest('a');
                        if (link && link.href) {
                            try {
                                const url = new URL(link.href);
                                if (url.hostname === window.location.hostname) {
                                    score -= 1.0;
                                }
                            } catch (e) { }
                        }

                        if (score >= 0.8) {
                            console.log(`%c[AdsFriendly AI] Hiding predicted ad (%c${(score * 100).toFixed(0)}% confidence%c) Reason: ${matchDetails.join(', ')}`, "color: #10b981; font-weight: bold;", "color: #fbd38d;", "color: #10b981;", el);
                            BLOCKING_STRATEGIES.STEALTH(el);
                        }
                    });
                }
            } catch (err) { }
        }, 2000);
    })();
})();
