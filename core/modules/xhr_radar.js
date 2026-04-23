// core/modules/xhr_radar.js
/**
 * Vanguard Radar (Clean Sensor Mode)
 * Role: ONLY capture & dispatch events. No logic, no state.
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

// ✅ Minimal audit (debug only)
let auditStats = { total: 0, media: 0, ads: 0, other: 0, missed: 0 };

function updateAudit(res = {}) {
    auditStats.total++;

    const label = res?.label_pred || 'UNKNOWN';

    if (label === 'MEDIA_PASS') auditStats.media++;
    else if (label === 'HIGH_RISK') auditStats.ads++;
    else auditStats.other++;

    if (auditStats.total % 20 === 0) {
        console.log(
            `%c📡 [Radar] ${auditStats.total} events | Media: ${auditStats.media} | Ads: ${auditStats.ads}`,
            "color:#10b981;font-weight:bold;"
        );
    }
}

// ✅ RAW normalize only (NO parsing)
const normalizeUrl = (input) => {
    if (!input) return "";

    if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
    if (input instanceof URL) return input.href;

    if (typeof input === 'object') {
        return String(input.url || input.href || input.toString?.() || "");
    }

    return String(input).trim();
};

if (!window.__VANGUARD_RADAR_ACTIVE__) {
    window.__VANGUARD_RADAR_ACTIVE__ = true;

    function dispatchToEngine(event) {
        event.sensorTimestamp = Date.now();
        event.rawUrl = event.url;

        const bridge = window.Engine?.brainBridge;
        if (!bridge) return;

        // ✅ FULL sampling for debug
        const rate = 1.0;
        if (Math.random() > rate) {
            auditStats.missed++;
            return;
        }

        bridge.dispatch(event)
            .then(res => res && updateAudit(res))
            .catch(err => console.error('[Radar] Dispatch Error:', err));
    }

    // ⚡ FETCH
    window.fetch = function (...args) {
        let rawUrl;
        try {
            rawUrl = (args[0] instanceof Request) ? args[0].url : String(args[0]);
        } catch {
            rawUrl = 'unknown';
        }

        const url = normalizeUrl(rawUrl);
        const promise = nativeFetch.apply(this, args);

        const baseEvent = { url, method: 'FETCH', type: 'fetch' };
        dispatchToEngine(baseEvent);

        promise.then(res => {
            let size = -1;
            try {
                const cl = res.headers.get('content-length');
                if (cl) size = parseInt(cl, 10);
            } catch { }

            dispatchToEngine({
                ...baseEvent,
                responseSize: size,
                isError: !res.ok
            });
        }).catch(() => { });

        return promise;
    };

    // ⚡ XHR
    XMLHttpRequest.prototype.open = function (m, u) {
        this._v_url = normalizeUrl(u);
        this._v_method = m;
        return nativeXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        const baseEvent = {
            url: this._v_url,
            method: this._v_method,
            type: 'xhr'
        };

        dispatchToEngine(baseEvent);

        const cb = () => {
            let size = -1;
            try {
                const cl = this.getResponseHeader('Content-Length');
                if (cl) size = parseInt(cl, 10);
            } catch { }

            dispatchToEngine({
                ...baseEvent,
                responseSize: size
            });
        };

        this.addEventListener('load', cb);
        this.addEventListener('error', cb);

        return nativeXHRSend.apply(this, args);
    };

    // ⚡ BEACON
    if (nativeSendBeacon) {
        navigator.sendBeacon = function (u, d) {
            const res = nativeSendBeacon.apply(this, arguments);

            dispatchToEngine({
                url: normalizeUrl(u),
                method: 'POST',
                type: 'beacon'
            });

            return res;
        };
    }

    // ⚡ DOM hooks (LIGHT)
    const hookProperty = (proto, prop) => {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc) return;

        Object.defineProperty(proto, prop, {
            set: function (v) {
                const res = desc.set.call(this, v);

                dispatchToEngine({
                    url: normalizeUrl(v),
                    method: 'GET',
                    type: this.tagName?.toLowerCase() || 'element'
                });

                return res;
            },
            get: function () { return desc.get.call(this); },
            configurable: true
        });
    };

    hookProperty(HTMLImageElement.prototype, 'src');
    hookProperty(HTMLScriptElement.prototype, 'src');
    hookProperty(HTMLIFrameElement.prototype, 'src');

    // ⚡ CLICK
    window.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (a?.href) {
            dispatchToEngine({
                url: normalizeUrl(a.href),
                method: 'CLICK',
                type: 'navigation'
            });
        }
    }, { capture: true, passive: true });

    console.log("%c[Vanguard Radar CLEAN ACTIVE]", "color:#3b82f6;font-weight:bold;");
}