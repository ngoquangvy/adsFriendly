// core/modules/proxy_shield.js
/**
 * AdsFriendly: Proxy Shield (The Titanium Shell)
 * Spoofs Date, Performance, and AudioContext. Hides DOM footprints.
 */

// ── Mốc 1: The Proxy Veil (Function.prototype.toString Master Proxy) ──
(function installProxyVeil() {
    const spoofedFunctionMap = new WeakMap();
    const _realToString = Function.prototype.toString;

    function registerSpoof(fn, nativeString) {
        spoofedFunctionMap.set(fn, nativeString);
    }

    // Lưu tham chiếu Proxy trước khi đặt lên prototype (tránh lỗi self-reference)
    const proxyToString = new Proxy(_realToString, {
        apply(target, thisArg, args) {
            if (spoofedFunctionMap.has(thisArg)) {
                return spoofedFunctionMap.get(thisArg);
            }
            return target.apply(thisArg, args);
        }
    });

    Object.defineProperty(Function.prototype, 'toString', {
        value: proxyToString,
        writable: true, // Cho phép các thư viện khác shim/wrap mà không gây crash
        configurable: true
    });

    // Đăng ký chính Proxy bằng biến (không phải bằng Function.prototype.toString)
    spoofedFunctionMap.set(proxyToString, 'function toString() { [native code] }');
    window.__adsfriendly_registerSpoof = registerSpoof;
})();

// ── Mốc 2: Data-Layer Property Patch (No Override on getOwnPropertyDescriptor) ──
const _realGetDescriptor = Object.getOwnPropertyDescriptor.bind(Object);

function patchNative(obj, prop, spoofedFn, nativeLabel) {
    if (window.__adsfriendly_patched?.has(obj[prop])) return;

    try {
        const origDesc = _realGetDescriptor(obj, prop);
        if (!origDesc) return;

        // Ensure spoofedFn is registered for toString concealment
        if (typeof spoofedFn === 'function' && window.__adsfriendly_registerSpoof) {
            window.__adsfriendly_registerSpoof(spoofedFn, nativeLabel || `function ${prop}() { [native code] }`);
        }

        // Handle case where property is non-configurable but writable
        if (origDesc.configurable === false && origDesc.writable === true) {
            obj[prop] = spoofedFn;
            return;
        }

        if (origDesc.configurable === false && origDesc.writable === false) {
            return;
        }

        // Standard patch via Descriptor
        const newDesc = { ...origDesc };
        if ('get' in origDesc) {
            newDesc.get = spoofedFn;
        } else {
            newDesc.value = spoofedFn;
        }

        Object.defineProperty(obj, prop, newDesc);

        window.__adsfriendly_patched = window.__adsfriendly_patched || new Set();
        window.__adsfriendly_patched.add(spoofedFn);
    } catch (e) {
        console.warn(`[AdsFriendly Spy] Failed to patch ${prop}:`, e.message);
    }
}
const originalTimeout = window.setTimeout.bind(window);
const originalInterval = window.setInterval.bind(window);

let isAdMode = false;
let userVolume = 100;
let userWasMuted = false;
let hammerInterval = null;
const videoSnapshots = new WeakMap();

// v5.1: Full-Spectrum Relativity Engine (Spoofing everything time-related)
const originalDateNow = Date.now;
const originalDate = window.Date;

let lastRealDate = originalDateNow();
let virtualDate = lastRealDate;

// Core engine
function advanceVirtualTime() {
    const currentReal = originalDateNow();
    const delta = currentReal - lastRealDate;
    lastRealDate = currentReal;
    virtualDate += isAdMode ? delta * 16 : delta;
    return virtualDate;
}

// Date.now — dùng wrapper function an toàn từ User
const _spoofedDateNow = (function fixDateNow() {
    const RealDate = window.Date;
    if (typeof RealDate !== "function") return null;

    const wrapper = function now() {
        return advanceVirtualTime();
    };

    // Patch
    RealDate.now = wrapper;

    // Register for stealth
    window.__adsfriendly_registerSpoof?.(wrapper, 'function now() { [native code] }');

    return wrapper;
})();

// performance.now — dùng getter vì thay đổi theo isAdMode
const originalPerfNow = performance.now.bind(performance);
let lastRealPerf = originalPerfNow();
let virtualPerf = lastRealPerf;
let _spoofedPerfNow = () => {
    const currentReal = originalPerfNow();
    const delta = currentReal - lastRealPerf;
    lastRealPerf = currentReal;
    virtualPerf += isAdMode ? delta * 16 : delta;
    return virtualPerf;
};
patchNative(performance, 'now', () => _spoofedPerfNow(), 'function now() { [native code] }');

// v4.3: Diagnostic Sentinel State
let lastKnownState = {
    playbackRate: 1.0,
    isAdMode: false,
    lastUrlHost: window.location.hostname
};

// Monitor for anti-tamper resets (Site fighting back)
document.addEventListener('ratechange', (e) => {
    if (isAdMode && e.target.tagName === 'VIDEO') {
        const v = e.target;
        lastKnownState.playbackRate = v.playbackRate;

        if (v.playbackRate !== 16.0 && v.playbackRate !== 1.0) {
            console.warn(`%c[AdsFriendly Spy] Tamper Alert: Site set rate to ${v.playbackRate}. (Internal is 16.0)`, "color: #f59e0b;");
        }
    }
}, true);

// v5.2: Anti-Anti-Debug (Blind Console Strategy)
const _spoofedClear = function clear() { };
patchNative(console, 'clear', _spoofedClear, 'function clear() { [native code] }');

function getTrackedAdVideos() {
    const videos = Array.from(document.querySelectorAll('video'));
    return videos.filter(v => {
        const isYtAd = v.closest('.ad-showing, .ad-interrupting, .ytp-ad-player-overlay');
        const isSmall = v.offsetWidth > 0 && v.offsetWidth < 100;
        return isYtAd || isSmall || v.dataset.adsfriendlyAdActive === '1';
    });
}

function snapshotAudioState() {
    document.querySelectorAll('video').forEach(v => {
        if (!v.dataset.adsfriendlyAdActive) {
            videoSnapshots.set(v, {
                muted: v.muted,
                volume: v.volume
            });
        }
    });
}

function restoreAudioState() {
    document.querySelectorAll('video').forEach(v => {
        const snap = videoSnapshots.get(v);
        if (snap) {
            if (snap.muted === false && v.muted === true) {
                v.muted = false;
                v.volume = snap.volume;
            }
        }
    });
}

window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'adsfriendly-content') {
        if (event.data.type === 'SET_AD_MODE') {
            isAdMode = event.data.value;
            if (isAdMode) {
                if (typeof syncToLocalRadar === 'function') syncToLocalRadar('AD_MODE_STARTED', window.location.href, { state: '16x triggered' });
                snapshotAudioState();
                const executeStrike = () => {
                    if (!isAdMode) return;
                    try {
                        const activeVideos = getTrackedAdVideos();
                        activeVideos.forEach(v => {
                            if (!v || v.duration === 0) return;
                            if (!('adsfriendlyPrevMuted' in v.dataset)) v.dataset.adsfriendlyPrevMuted = v.muted ? '1' : '0';
                            v.muted = true;
                            v.dataset.adsfriendlySpyTouched = '1';
                        });
                    } catch (e) { }
                };
                executeStrike();
                if (hammerInterval) clearInterval(hammerInterval);
                hammerInterval = originalInterval(executeStrike, 250);
            } else {
                const pulseRestore = () => {
                    if (isAdMode) return;
                    restoreAudioState();
                    document.querySelectorAll('video[data-adsfriendly-spy-touched="1"]').forEach(v => {
                        if (v.playbackRate === 16) v.playbackRate = 1.0;
                        v.muted = v.dataset.adsfriendlyPrevMuted === '1';
                        delete v.dataset.adsfriendlySpyTouched;
                        delete v.dataset.adsfriendlyPrevMuted;
                    });
                };

                if (hammerInterval) {
                    clearInterval(hammerInterval);
                    hammerInterval = null;
                }

                [0, 100, 300, 600, 1000].forEach(delay => originalTimeout(pulseRestore, delay));
            }
        }
    }
});

function notifyContentScript(data) {
    window.postMessage({ source: 'adsfriendly-spy', ...data }, '*');
}
