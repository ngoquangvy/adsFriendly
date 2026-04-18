// core/modules/xhr_radar.js
/**
 * Vanguard Citadel - Pure Technical Sensor (v2.13.0)
 * Role: Transparently intercept network events and forward to Orchestrator.
 * NO BUSINESS LOGIC. NO BYPASSES.
 */

// 🧠 NATIVE PRESERVATION
const getNative = (obj, key, globalKey) => {
    if (!window[globalKey]) {
        window[globalKey] = obj[key];
    }
    return window[globalKey];
};

const nativeFetch = getNative(window, 'fetch', '__ADSFRIENDLY_NATIVE_FETCH__');
const nativeXHROpen = getNative(XMLHttpRequest.prototype, 'open', '__ADSFRIENDLY_NATIVE_XHR_OPEN__');
const nativeXHRSend = getNative(XMLHttpRequest.prototype, 'send', '__ADSFRIENDLY_NATIVE_XHR_SEND__');

// ⚙️ TECHNICAL HELPERS
const normalizeUrl = (url) => {
    try {
        if (typeof url !== 'string') return url;
        let u = url;
        if (u.startsWith('//')) u = window.location.protocol + u;
        if (u.startsWith('/')) u = window.location.origin + u;
        return u;
    } catch (e) { return url; }
};

if (window.__VANGUARD_RADAR_ACTIVE__) {
    console.warn('[Vanguard Radar] Already Active.');
} else {
    window.__VANGUARD_RADAR_ACTIVE__ = true;

    /**
     * Central dispatch to the Engine.
     */
    function dispatchToEngine(event) {
        console.log('[PROCESS] event', event);
        
        if (window.Engine?.hub?.Orchestrator) {
            window.Engine.hub.Orchestrator.process(event).then(res => {
                // Log the final decision from the Engine
                console.log('[ORCHESTRATOR] result', res);
                
                // Detailed diagnostic for developers
                if (res.label === 'HIGH_RISK' || Math.random() < 0.05) {
                    const color = res.action === 'BLOCK' ? '#ef4444' : '#3b82f6';
                    console.log(`%c[Vanguard] ${res.label} | ${res.action} | ${res.domain}`, `color: ${color}; font-weight: bold;`);
                }
            }).catch(err => {
                console.error('[Radar] Dispatch Error:', err);
            });
        }
    }

    // ⚡ PASSIVE OBSERVER: window.fetch
    window.fetch = function (...args) {
        let rawUrl;
        try {
            rawUrl = (args[0] instanceof Request) ? args[0].url : String(args[0]);
        } catch (e) { rawUrl = 'unknown'; }

        const url = normalizeUrl(rawUrl);
        const start = performance.now();
        const promise = nativeFetch.apply(this, args);

        console.log('[HOOK] captured', url);

        // Detached analysis to ensure zero impact on player/page
        queueMicrotask(() => {
            promise.then(res => {
                const stack = window.__ADSFRIENDLY_DEBUG__ ? new Error().stack : null;
                setTimeout(() => {
                    dispatchToEngine({ 
                        url, method: 'FETCH', type: 'fetch', 
                        stack, time: start, isError: !res.ok 
                    });
                }, 0);
            }).catch(err => {
                setTimeout(() => {
                    dispatchToEngine({ url, method: 'FETCH', type: 'fetch', time: start, isError: true });
                }, 0);
            });
        });

        return promise;
    };

    // ⚡ PASSIVE OBSERVER: XMLHttpRequest
    XMLHttpRequest.prototype.open = function (method, url) {
        this._vanguard_url = normalizeUrl(url);
        this._vanguard_method = method;
        return nativeXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        const url = this._vanguard_url;
        console.log('[HOOK] captured', url);
        
        queueMicrotask(() => {
            const onComplete = () => {
                const stack = window.__ADSFRIENDLY_DEBUG__ ? new Error().stack : null;
                setTimeout(() => {
                    dispatchToEngine({ 
                        url, method: this._vanguard_method, type: 'xhr', stack 
                    });
                }, 0);
            };

            const onError = () => {
                setTimeout(() => {
                    dispatchToEngine({ 
                        url, method: this._vanguard_method, type: 'xhr', isError: true
                    });
                }, 0);
            };

            this.addEventListener('load', onComplete);
            this.addEventListener('error', onError);
        });

        return nativeXHRSend.apply(this, args);
    };

    console.log('[Vanguard v2.13.0] Pure Radar Stable.');
}
