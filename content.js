    // Listen for clicks to track user intent
    document.addEventListener('mousedown', (event) => {
        if (event.isTrusted) {
            try {
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
                    chrome.runtime.sendMessage({ type: 'TRUSTED_CLICK' });
                }
            } catch (e) {}
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
        try {
            const result = await chrome.storage.local.get('userCustomRules');
            if (result && result.userCustomRules && result.userCustomRules[hostname]) {
                customSelectors = result.userCustomRules[hostname];
            }
        } catch (e) {}

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

        customSelectors.forEach(rule => {
            const selector = typeof rule === 'string' ? rule : rule.selector;
            if (dangerousTags.includes(selector.toLowerCase().trim())) return;
            adSelectors.push(selector);

            if (typeof rule === 'object' && rule.fingerprint) {
                const { tag, parentClass, parentId } = rule.fingerprint;
                let parent = null;
                if (parentId) parent = document.getElementById(parentId);
                else if (parentClass) parent = document.querySelector(`.${parentClass.split(' ')[0]}`);

                if (parent) {
                    parent.querySelectorAll(tag).forEach(sibling => {
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

    setInterval(async () => {
        try {
            const { friendlyMode, isEnabled, globalAdPatterns = [] } = await chrome.storage.local.get(['friendlyMode', 'isEnabled', 'globalAdPatterns']);
            if (isEnabled !== false && friendlyMode === false) {
                blockAds();

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

    try {
        chrome.storage.local.get(['friendlyMode', 'isEnabled'], (result) => {
            if (result && result.isEnabled !== false && result.friendlyMode === false) {
                blockAds();
            }
        });
    } catch (err) {}
