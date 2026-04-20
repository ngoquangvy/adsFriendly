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

const nativeFetch = getNative(window, 'fetch', '__V_NATIVE_FETCH__');
const nativeXHROpen = getNative(XMLHttpRequest.prototype, 'open', '__V_NATIVE_XHR_OPEN__');
const nativeXHRSend = getNative(XMLHttpRequest.prototype, 'send', '__V_NATIVE_XHR_SEND__');
const nativeSendBeacon = getNative(navigator, 'sendBeacon', '__V_NATIVE_BEACON__');

// --- 📊 RADAR AUDIT SYSTEM ---
let auditStats = { total: 0, media: 0, ads: 0, missed: 0, other: 0 };
function updateAudit(res = {}) {
    auditStats.total++;
    const label = res.label_pred || res.label || 'UNKNOWN';
    
    if (label === 'MEDIA_PASS') auditStats.media++;
    else if (label === 'HIGH_RISK') auditStats.ads++;
    else auditStats.other++;

    // Shadow Audit: Track ads identified heuristic-ly but not by model
    if (res.label_true === 'ADS' && label !== 'HIGH_RISK') {
        auditStats.missed++;
    }

    if (auditStats.total % 20 === 0) {
        console.log(`%c📡 [Radar Audit] Scanned: ${auditStats.total} | Media: ${auditStats.media} | Ads: ${auditStats.ads} | Missed: ${auditStats.missed} | Other: ${auditStats.other}`, "color: #10b981; font-weight: bold;");
    }
}

// ⚙️ TECHNICAL HELPERS
const normalizeUrl = (url) => {
    try {
        if (!url || typeof url !== 'string') return url;
        let u = url;
        if (u.startsWith('//')) u = window.location.protocol + u;
        if (u.startsWith('/')) u = window.location.origin + u;
        return u;
    } catch (e) { return url; }
};

if (window.__VANGUARD_RADAR_ACTIVE__) {
    // Already active
} else {
    window.__VANGUARD_RADAR_ACTIVE__ = true;

    let traceMode = false;
    window.Vanguard = window.Vanguard || {};
    window.Vanguard.trace = function() {
        traceMode = !traceMode;
        console.log(`%c[Radar Trace] ${traceMode ? 'ON - Visible Other traffic' : 'OFF - Minimal Logging'}`, "color: #fbbf24; font-weight: bold;");
        return `Trace mode: ${traceMode}`;
    };

    function dispatchToEngine(event) {
        // --- TRANSPARENCY PATCH v15.0: Non-blocking async dispatch ---
        queueMicrotask(() => {
            if (window.Engine?.hub?.Orchestrator) {
                window.Engine.hub.Orchestrator.process(event).then(res => {
                    updateAudit(res);
                    const label = res.label_pred || res.label || 'UNKNOWN';

                    if (label === 'HIGH_RISK') {
                        console.log(`%c[Vanguard] 🛡️ BLOCK | ${res.domain} | Flags: ${res.flags?.join(', ')}`, `color: #ef4444; font-weight: bold;`);
                    } else if (traceMode && label !== 'MEDIA_PASS') {
                        console.log(`%c🔍 [Radar Trace] OTHER | ${event.type.toUpperCase()} | ${event.url.substring(0, 80)}`, "color: #94a3b8;");
                    }
                }).catch(err => console.error('[Radar] Dispatch Error:', err));
            }
        });
    }

    // ⚡ Hook: window.fetch
    window.fetch = function(...args) {
        let rawUrl;
        try { rawUrl = (args[0] instanceof Request) ? args[0].url : String(args[0]); } catch (e) { rawUrl = 'unknown'; }
        const url = normalizeUrl(rawUrl);
        const promise = nativeFetch.apply(this, args);
        promise.then(res => dispatchToEngine({ url, method: 'FETCH', type: 'fetch', isError: !res.ok })).catch(() => {});
        return promise;
    };

    // ⚡ Hook: XMLHttpRequest
    XMLHttpRequest.prototype.open = function(m, u) { this._v_url = normalizeUrl(u); this._v_method = m; return nativeXHROpen.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function(...args) {
        const cb = () => dispatchToEngine({ url: this._v_url, method: this._v_method, type: 'xhr' });
        this.addEventListener('load', cb); this.addEventListener('error', cb);
        return nativeXHRSend.apply(this, args);
    };

    // ⚡ Hook: navigator.sendBeacon
    if (nativeSendBeacon) {
        navigator.sendBeacon = function(u, d) {
            const res = nativeSendBeacon.apply(this, arguments);
            dispatchToEngine({ url: normalizeUrl(u), method: 'POST', type: 'beacon' });
            return res;
        };
    }

    // ⚡ Hook: DOM Setters (Pixels, Scripts, IFrames)
    const hookProperty = (proto, prop) => {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc) return;
        Object.defineProperty(proto, prop, {
            set: function(v) {
                const res = desc.set.call(this, v);
                const u = normalizeUrl(v);
                dispatchToEngine({ url: u, method: 'GET', type: this.tagName?.toLowerCase() || 'element' });
                return res;
            },
            get: function() { return desc.get.call(this); }, configurable: true
        });
    };

    hookProperty(HTMLImageElement.prototype, 'src');
    hookProperty(HTMLScriptElement.prototype, 'src');
    hookProperty(HTMLIFrameElement.prototype, 'src');

    console.log("%c[Vanguard Radar] Wide-Spectrum Monitoring Active.", "color: #3b82f6; font-weight: bold;");
}

    console.log("%c[Vanguard Radar] Wide-Spectrum Monitoring Active.", "color: #3b82f6; font-weight: bold;");
}
