// core/modules/xhr_radar.js
/**
 * Vanguard Citadel - Expert Sensor (v16.11 - Invulnerable Obsidian Final)
 * Role: Transparently intercept network events with stratified sampling and timeout-safety.
 */

const getNative = (obj, key, globalKey) => {
    if (!window[globalKey]) {
        window[globalKey] = obj[key];
    }
    return window[globalKey];
};

const nativeFetch = getNative(window, 'fetch', '__V_NATIVE_FETCH__');
const nativeXHROpen = getNative(XMLHttpRequest.prototype, 'open', '__V_NATIVE_XHR_OPEN__');
const nativeXHRSend = getNative(XMLHttpRequest.prototype, 'send', '__V_NATIVE_XHR_SEND__');
const nativeSendBeacon = getNative(navigator, 'sendBeacon', '__V_NATIVE_BEACON__');

const localDomainStats = new Map(); // domain -> { count, lastRisk }

let auditStats = { total: 0, media: 0, ads: 0, missed: 0, other: 0 };
function updateAudit(res = {}) {
    auditStats.total++;
    const label = res?.label_pred || 'UNKNOWN';
    if (label === 'MEDIA_PASS') auditStats.media++;
    else if (label === 'HIGH_RISK') auditStats.ads++;
    else auditStats.other++;
    
    // Feedback to local stats for stratified sampling
    if (res.domain) {
        const stats = localDomainStats.get(res.domain) || { count: 0, lastRisk: 0 };
        stats.lastRisk = res.score || 0;
        localDomainStats.set(res.domain, stats);
    }

    if (auditStats.total % 20 === 0) {
        console.log(`%c📡 [Radar v16.11] Scanned: ${auditStats.total} | Media: ${auditStats.media} | Ads: ${auditStats.ads}`, "color: #10b981; font-weight: bold;");
    }
}

const safeURL = (url, base = window.location?.href) => {
    try {
        if (!url) return null;
        return new URL(url, base);
    } catch (e) { return null; }
};

const normalizeUrl = (input) => {
    if (!input) return "";
    
    // 1. Request Object
    if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
    
    // 2. URL Object
    if (input instanceof URL) return input.href;
    
    // 3. String or Generic Object
    let raw = input;
    if (typeof input === 'object') raw = input.url || input.href || "";
    
    const parsed = safeURL(raw);
    return parsed ? parsed.href : String(raw);
};

if (window.__VANGUARD_RADAR_ACTIVE__) { } else {
    window.__VANGUARD_RADAR_ACTIVE__ = true;
    window.__V_LAST_INTERACTION = Date.now();
    ['click', 'scroll', 'keypress', 'touchstart'].forEach(ev => {
        window.addEventListener(ev, () => { window.__V_LAST_INTERACTION = Date.now(); }, { passive: true });
    });

    function _generateUUIDFallback() {
        return `${Date.now()}-${performance.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }

    const persistentTabId = (() => {
        let id = sessionStorage.getItem('__V_TAB_ID');
        if (!id) {
            id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : _generateUUIDFallback();
            sessionStorage.setItem('__V_TAB_ID', id);
        }
        return id;
    })();

    const tabInstanceId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : _generateUUIDFallback();

    function dispatchToEngine(event) {
        // v16.14 Forensic Meta (Simplified Radar Path)
        event.sensorTimestamp = Date.now();

        const bridge = window.Engine?.brainBridge;
        if (!bridge) return 'MISSING_BRIDGE';

        // sampling logic (Early Guard)
        // Note: Statistics moved to background, Radar uses local sampling or Bridge advice
        const rate = 0.8; // Default sampling, Bridge can override
        if (Math.random() > rate) {
            auditStats.missed++;
            return 'SKIPPED';
        }

        // DISPATCH VIA BRIDGE (ASYNC)
        bridge.dispatch(event).then(res => {
            if (res) updateAudit(res);
        }).catch(err => console.error('[Radar] Dispatch Error:', err));

        return 'SAMPLED';
    }

    // ⚡ Hook: window.fetch (Early-Guard v16.13)
    window.fetch = function(...args) {
        let rawUrl;
        try { rawUrl = (args[0] instanceof Request) ? args[0].url : String(args[0]); } catch (e) { rawUrl = 'unknown'; }
        const url = normalizeUrl(rawUrl);
        const promise = nativeFetch.apply(this, args);
        
        const partialEvent = { url, method: 'FETCH', type: 'fetch' };
        const status = dispatchToEngine(partialEvent);

        if (status === 'SAMPLED') {
            promise.then(async (res) => {
                let size = -1;
                try {
                    const cl = res.headers.get('content-length');
                    if (cl) size = parseInt(cl, 10);
                    else if (res.ok && res.status !== 206) size = await probeSizeSafe(res);
                } catch (e) {}
                
                // Update specific forensic signals after body/headers available
                dispatchToEngine({ 
                    ...partialEvent,
                    responseSize: size, isError: !res.ok,
                    isCrossOrigin: (() => {
                        const parsed = safeURL(url);
                        return parsed ? !window.location.hostname.includes(parsed.hostname) : false;
                    })()
                });
            }).catch(() => {});
        }
        return promise;
    };

    // ⚡ Hook: XMLHttpRequest
    XMLHttpRequest.prototype.open = function(m, u) { 
        this._v_url = normalizeUrl(u); 
        this._v_method = m; 
        return nativeXHROpen.apply(this, arguments); 
    };
    XMLHttpRequest.prototype.send = function(...args) {
        const partialEvent = { url: this._v_url, method: this._v_method, type: 'xhr' };
        const status = dispatchToEngine(partialEvent);

        if (status === 'SAMPLED') {
            const cb = () => {
                let size = -1;
                try {
                    const cl = this.getResponseHeader('Content-Length');
                    if (cl) size = parseInt(cl, 10);
                } catch (e) {}
                
                dispatchToEngine({ 
                    ...partialEvent,
                    responseSize: size,
                    isCrossOrigin: (() => {
                        const parsed = safeURL(this._v_url);
                        return parsed ? !window.location.hostname.includes(parsed.hostname) : false;
                    })()
                });
            };
            this.addEventListener('load', cb); 
            this.addEventListener('error', cb);
        }
        return nativeXHRSend.apply(this, args);
    };

    // ⚡ Hook: navigator.sendBeacon
    if (nativeSendBeacon) {
        navigator.sendBeacon = function(u, d) {
            const res = nativeSendBeacon.apply(this, arguments);
            dispatchToEngine({ 
                url: normalizeUrl(u), method: 'POST', type: 'beacon',
                isCrossOrigin: (() => {
                    const parsed = safeURL(u);
                    return parsed ? !window.location.hostname.includes(parsed.hostname) : false;
                })()
            });
            return res;
        };
    }

    // ⚡ Hook: DOM Setters
    const hookProperty = (proto, prop) => {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc) return;
        Object.defineProperty(proto, prop, {
            set: function(v) {
                const res = desc.set.call(this, v);
                const u = normalizeUrl(v);
                dispatchToEngine({ 
                    url: u, method: 'GET', type: this.tagName?.toLowerCase() || 'element',
                    isCrossOrigin: (() => {
                        const parsed = safeURL(u);
                        return parsed ? !window.location.hostname.includes(parsed.hostname) : false;
                    })()
                });
                return res;
            },
            get: function() { return desc.get.call(this); }, configurable: true
        });
    };

    hookProperty(HTMLImageElement.prototype, 'src');
    hookProperty(HTMLScriptElement.prototype, 'src');
    hookProperty(HTMLIFrameElement.prototype, 'src');

    console.log("%c[Vanguard Radar v16.11] Invulnerable Forensic Sensing Active.", "color: #3b82f6; font-weight: bold;");
}
