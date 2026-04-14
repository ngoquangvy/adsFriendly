/**
 * AdsFriendly: Injected Spy (Main World Context)
 * Used to intercept networking and timers that are invisible to Content Scripts.
 */
(function() {
    console.log('[AdsFriendly Spy] Injected and active.');

    const originalFetch = window.fetch;
    const originalXHR = XMLHttpRequest.prototype.send;
    const originalTimeout = window.setTimeout;
    const originalInterval = window.setInterval;

    let isAdMode = false;

    // 1. Networking Interception (Fetch)
    window.fetch = async function(...args) {
        const url = args[0] ? args[0].toString() : '';
        const response = await originalFetch(...args);
        
        if (url.includes('.m3u8') || url.includes('.mpd') || url.includes('player/v1/player')) {
            const clone = response.clone();
            clone.text().then(body => {
                analyzeManifest(url, body);
            }).catch(() => {});
        }
        return response;
    };

    // 2. Timer Manipulation (Accelerating the clock during ads)
    window.setTimeout = function(handler, timeout, ...args) {
        let finalTimeout = timeout;
        if (isAdMode && typeof timeout === 'number' && timeout > 50) {
            finalTimeout = timeout / 100; // 100x speed
        }
        return originalTimeout(handler, finalTimeout, ...args);
    };

    window.setInterval = function(handler, timeout, ...args) {
        let finalTimeout = timeout;
        if (isAdMode && typeof timeout === 'number' && timeout > 50) {
            finalTimeout = timeout / 100; // 100x speed
        }
        return originalInterval(handler, finalTimeout, ...args);
    };

    // 3. Manifest Analysis
    function analyzeManifest(url, body) {
        const adMarkers = ['#EXT-X-DISCONTINUITY', '#EXT-X-CUE-OUT', 'adunit', 'vpaid', 'doubleclick'];
        const hasAd = adMarkers.some(marker => body.includes(marker));

        if (hasAd) {
            console.log('[AdsFriendly Spy] Ad segment detected in manifest:', url);
            notifyContentScript({ type: 'AD_MAP_DETECTED', url });
        }
    }

    function notifyContentScript(data) {
        window.postMessage({ source: 'adsfriendly-spy', ...data }, '*');
    }

    // 4. Listen for control signals from Content Script
    window.addEventListener('message', (event) => {
        if (event.data && event.data.source === 'adsfriendly-content') {
            if (event.data.type === 'SET_AD_MODE') {
                isAdMode = event.data.value;
                console.log('[AdsFriendly Spy] Ad mode changed:', isAdMode);
            }
        }
    });

})();
