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
        writable: false,
        configurable: true // Giữ true để tránh xung đột với Polyfill/thư viện bên ngoài
    });

    // Đăng ký chính Proxy bằng biến (không phải bằng Function.prototype.toString)
    spoofedFunctionMap.set(proxyToString, 'function toString() { [native code] }');
    window.__adsfriendly_registerSpoof = registerSpoof;
})();

// ── Mốc 2: Data-Layer Property Patch (No Override on getOwnPropertyDescriptor) ──
const _realGetDescriptor = Object.getOwnPropertyDescriptor.bind(Object);

function patchNative(obj, prop, spoofedFn, nativeLabel) {
    const origDesc = _realGetDescriptor(obj, prop);
    if (!origDesc) return;
    
    // Nếu là accessor descriptor — dùng getter
    if ('get' in origDesc) {
        Object.defineProperty(obj, prop, {
            get: spoofedFn,
            set: origDesc.set,
            enumerable: origDesc.enumerable,
            configurable: origDesc.configurable
        });
    } else {
        // Value descriptor — clone từ native
        const newDesc = Object.assign({}, origDesc);
        newDesc.value = spoofedFn;
        Object.defineProperty(obj, prop, newDesc);
    }
    
    window.__adsfriendly_registerSpoof?.(spoofedFn, nativeLabel || `function ${prop}() { [native code] }`);
}

console.log('[AdsFriendly Spy] Proxy Shield Active.');
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

// Constructor override (survives 'new Date()')
function SpoofedDate(...args) {
    if (!(this instanceof SpoofedDate)) {
         return new originalDate(advanceVirtualTime()).toString();
    }
    if (args.length === 0) {
         return new originalDate(advanceVirtualTime());
    }
    return new originalDate(...args);
}

// Date.now — dùng getter vì thay đổi theo isAdMode
let _spoofedDateNow = () => advanceVirtualTime();
patchNative(Date, 'now', () => _spoofedDateNow(), 'function now() { [native code] }');

SpoofedDate.parse = originalDate.parse;
SpoofedDate.UTC = originalDate.UTC;
SpoofedDate.prototype = originalDate.prototype;
SpoofedDate.toString = () => "function Date() { [native code] }";
window.__adsfriendly_registerSpoof?.(SpoofedDate, 'function Date() { [native code] }');

window.Date = SpoofedDate;

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
const _spoofedClear = function clear() {};
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
                    } catch (e) {}
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
