// core/modules/xhr_radar.js
/**
 * Vanguard Radar (Clean Sensor Mode)
 * Role: ONLY capture, normalize & dispatch raw events.
 * 
 * ✅ DO: Capture events, normalize URLs, attach raw metadata
 * ❌ DON'T: Enrich context, classify URLs, manage state
 * 
 * Context enrichment happens in:
 *   - engine/brain/event_classifier.js (semantic roles)
 *   - engine/hub/session_manager.js (interaction IDs)
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

const createRequestId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2);
};

// ✅ Minimal audit (debug only)
let auditStats = { total: 0, failed: 0, queued: 0 };

function updateAudit(res = {}) {
    auditStats.total++;
    if (res.action === 'queued' || res.action === 'QUEUED') auditStats.queued++;
    if (res.reason?.includes('FALLBACK') || res.reason?.includes('ERROR')) auditStats.failed++;
    
    if (auditStats.total % 50 === 0) {
        console.log(
            `%c📡 [Radar] ${auditStats.total} events (${auditStats.queued} queued, ${auditStats.failed} fallback)`,
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
        if (typeof input.url === 'string') return input.url;
        if (typeof input.href === 'string') return input.href;
        if (typeof input.toString === 'function' && input.toString !== Object.prototype.toString) {
            return String(input.toString());
        }
        return "";
    }

    return String(input).trim();
};

const getInteractionId = () => window.__V_INTERACTION_ID;
if (typeof window.__V_INTERACTION_ID === 'undefined') {
    window.__V_INTERACTION_ID = null; // Set by session_manager.js
}

// ✅ HELPERS: Malformed URL tracking
const createSyntheticUrl = (source, errorType) => {
    return `radar://unknown/${source}/${errorType}/${Date.now()}`;
};

const isSyntheticUrl = (value) => typeof value === 'string' && value.startsWith('radar://');

const createMalformedMeta = (isMalformed, reason = null) => ({
    isMalformed,
    reason: isMalformed ? (reason || 'unknown') : 'ok'
});

const tryCatch = (fn, source, fallback = null) => {
    try {
        return { value: fn(), error: null };
    } catch (err) {
        return { value: fallback, error: `${source}:${err.message}` };
    }
};

if (!window.__VANGUARD_RADAR_ACTIVE__) {
    window.__VANGUARD_RADAR_ACTIVE__ = true;

    function dispatchToEngine(event) {
        // ✅ RAW METADATA ONLY
        event.sensorTimestamp = Date.now();
        if (typeof event.rawUrl === 'undefined') {
            event.rawUrl = event.url;
        }

        // ✅ STRICT VALIDATION: requestId MUST be provided by capture layer
        if (!event.requestId) {
            console.error(
                '[Radar] ❌ CRITICAL: Missing requestId - flow correlation broken!\n' +
                'Caller must generate requestId in capture layer.\n' +
                'Event type:', event.type, 'URL:', event.url?.slice(0, 50)
            );
            return;
        }

        // ✅ INTERACTION REFERENCE: Read from session manager (no write)
        event.interactionId = getInteractionId?.() || 'autonomous';

        // ✅ ENSURE CONTEXT EXISTS
        event.context = event.context || {};

        const bridge = window.Engine?.brainBridge;
        if (!bridge) {
            console.warn('[Radar] ⚠️  BrainBridge not yet initialized, event may be lost');
            return;
        }

        // debug full sampling
        const rate = 1.0;
        if (Math.random() > rate) return;

        console.log("[RADAR → SEND]", {
            url: event.url,
            type: event.type,
            method: event.method,
            requestId: event.requestId,
            interactionId: event.interactionId
        });

        bridge.dispatch(event)
            .then(res => res && updateAudit(res))
            .catch(err => console.error('[Radar] Dispatch Error:', err));

        return 'SAMPLED';
    }

    // ⚡ FETCH
    window.fetch = function (...args) {
        // ✅ SAFE EXTRACTION: Track errors
        const extraction = tryCatch(
            () => (args[0] instanceof Request) ? args[0].url : String(args[0]),
            'fetch_extract'
        );

        let rawUrl = extraction.value;
        let extractionError = extraction.error;

        const url = normalizeUrl(rawUrl);
        const isMalformed = !url;

        if (isMalformed ) {
            rawUrl = rawUrl || createSyntheticUrl('fetch', extractionError || 'empty');
        }

        const reqId = createRequestId();
        const method = (() => {
            if (args[0] instanceof Request && args[0].method) return args[0].method;
            if (args[1] && typeof args[1].method === 'string') return args[1].method;
            return 'GET';
        })();
        const finalUrl = url || rawUrl;
        const baseEvent = {
            url: finalUrl,
            rawUrl: rawUrl || finalUrl,
            method,
            type: 'fetch',
            phase: 'request',
            requestId: reqId,
            malformed: createMalformedMeta(isMalformed && !isSyntheticUrl(finalUrl), extractionError || 'empty')
        };

        dispatchToEngine(baseEvent);

        let promise;
        try {
            promise = nativeFetch.apply(this, args);
        } catch (err) {
            dispatchToEngine({
                ...baseEvent,
                phase: 'response',
                isError: true,
                errorType: `fetch_throw:${err.message || 'unknown'}`
            });
            throw err;
        }

        promise.then(res => {
            let size = -1;
            try {
                const cl = res.headers.get('content-length');
                if (cl) size = parseInt(cl, 10);
            } catch { }

            dispatchToEngine({
                ...baseEvent,
                phase: 'response',
                responseSize: size,
                responseStatus: res.status,
                isError: !res.ok
            });
        }).catch((err) => {
            dispatchToEngine({
                ...baseEvent,
                phase: 'response',
                isError: true,
                errorType: `fetch_reject:${err?.message || 'unknown'}`
            });
        });

        return promise;
    };

    // ⚡ XHR
    XMLHttpRequest.prototype.open = function (m, u) {
        const normalized = normalizeUrl(u);
        this._v_url = normalized || createSyntheticUrl('xhr_open', !u ? 'empty_url' : 'normalize_failed');
        this._v_raw_url = typeof u === 'undefined' ? '' : String(u);
        this._v_method = m;
        this._v_url_malformed = !normalized;
        return nativeXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        const reqId = createRequestId();
        const isMalformedXhr = this._v_url_malformed && !isSyntheticUrl(this._v_url);
        const reasonXhr = this._v_url_malformed ? 'normalize_failed' : null;
        const baseEvent = {
            url: this._v_url,
            rawUrl: this._v_raw_url || this._v_url,
            method: this._v_method,
            type: 'xhr',
            phase: 'request',
            requestId: reqId,
            malformed: createMalformedMeta(isMalformedXhr, reasonXhr)
        };

        dispatchToEngine(baseEvent);

        const cb = (phase) => {
            let size = -1;
            try {
                const cl = this.getResponseHeader('Content-Length');
                if (cl) size = parseInt(cl, 10);
            } catch { }

            dispatchToEngine({
                ...baseEvent,
                phase: 'response',
                responseSize: size,
                responseStatus: this.status || 0,
                isError: phase === 'error' || (this.status >= 400 && this.status !== 0)
            });
        };

        this.addEventListener('load', () => cb('load'), { once: true });
        this.addEventListener('error', () => cb('error'), { once: true });

        return nativeXHRSend.apply(this, args);
    };

    // ⚡ BEACON
    if (nativeSendBeacon) {
        navigator.sendBeacon = function (u, d) {
            const url = normalizeUrl(u);
            const isMalformed = !url;
            const finalUrl = url || createSyntheticUrl('beacon', !u ? 'empty_url' : 'normalize_failed');
            const isMalformedBe = isMalformed && !isSyntheticUrl(finalUrl);
            const reasonBe = isMalformedBe ? (url ? 'normalize_failed' : 'empty') : null;

            const reqId = createRequestId();
            const res = nativeSendBeacon.apply(this, arguments);

            dispatchToEngine({
                url: finalUrl,
                rawUrl: typeof u === 'undefined' ? '' : String(u),
                method: 'POST',
                type: 'beacon',
                phase: 'request',
                requestId: reqId,
                malformed: createMalformedMeta(isMalformedBe, reasonBe)
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

                const tag = this.tagName?.toLowerCase() || 'element';
                const parentAnchor = this.closest ? this.closest('a') : null;
                const reqId = createRequestId();

                // ✅ SAFE EXTRACTION with error tracking
                const extraction = tryCatch(
                    () => normalizeUrl(v),
                    `dom_${prop}`
                );

                const url = extraction.value;
                const isMalformed = !url;
                const finalUrl = url || createSyntheticUrl('dom_set', extraction.error || 'empty');

                const malformedDom = createMalformedMeta(isMalformed && !isSyntheticUrl(finalUrl), extraction.error || 'empty');
                dispatchToEngine({
                    url: finalUrl,
                    rawUrl: typeof v === 'undefined' ? '' : String(v),
                    method: 'GET',
                    type: tag,
                    phase: 'dom_set',
                    requestId: reqId,
                    malformed: malformedDom,
                    context: {
                        tagName: tag,
                        id: this.id || '',
                        className: this.className || '',
                        parentHref: parentAnchor?.href || null,
                        isVideoElement: tag === 'video',
                        isImage: tag === 'img',
                        isScript: tag === 'script',
                        isIframe: tag === 'iframe'
                    }
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
        const target = e.target instanceof Element ? e.target : null;
        const a = target ? target.closest('a') : null;
        if (a?.href) {
            // ✅ Session Manager sets interactionId (capture phase)
            // ✅ Radar dispatches click event for audit
            // Ensure we attach a unique requestId for traceability between stages
            const reqId = createRequestId();
            dispatchToEngine({
                url: normalizeUrl(a.href),
                rawUrl: a.href,
                method: 'CLICK',
                type: 'navigation',
                requestId: reqId,
                context: {
                    tagName: 'a',
                    text: a.innerText?.slice(0, 30) || '',
                    isUserInitiated: true
                },
                phase: 'user_interaction'
            });
        }
    }, { capture: false, passive: true }); // ← Bubble phase (AFTER session manager capture)

    console.log("%c[Vanguard Radar ACTIVE - Clean Sensor Mode]", "color:#3b82f6;font-weight:bold;");
}
