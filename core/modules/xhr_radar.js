// core/modules/xhr_radar.js
/**
 * Vanguard Citadel - Coordinator v0 (Phase 1)
 * Orchestrates: RawLogger -> SignalExtractor -> ScoreEngine
 */
console.log('[Citadel Phase 1] Coordinator Active.');

const originalFetch = window.fetch;
const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;

function processEvent(event) {
    try {
        // 1. RAW Tier
        const raw = window.AdsFriendlyRawLogger.capture(event);

        // 2. SIGNAL Intelligence
        const extraction = window.AdsFriendlySignalExtractor.extract(raw);

        // 3. SCORE Math
        const score = window.AdsFriendlyScoreEngine.calculate(extraction.features, window.AdsFriendlyWeights);

        // 4. POLICY Logic
        const policy = window.AdsFriendlyPolicyEngine.evaluate(raw, extraction, score);

        // 5. PRESENTATION (Intelligence Format)
        const logColor = policy.action === 'TAG' ? '#ef4444' : (policy.action === 'LOG' ? '#f59e0b' : '#10b981');
        const debugMode = window.CITADEL_DEBUG || false;
        const flagStr = debugMode && policy.flags.length > 0 ? `| flags=${policy.flags.join(',')}` : '';
        
        if (score > 0.0 || extraction.context.isCDN) {
            console.log(
                `%c[Citadel] ${policy.label} | ${policy.action} | ${score.toFixed(2)} | URL: ${raw.url.split('?')[0]}${flagStr}`,
                `color: ${logColor}; font-weight: bold;`
            );
        }
    } catch (e) {
        console.error('[Citadel] Flow Error:', e);
    }
}

// Interceptor Hooks
window.fetch = async function (...args) {
    let url = (args[0] instanceof Request) ? args[0].url : args[0].toString();
    const response = await originalFetch(...args);
    
    processEvent({ url, method: 'FETCH', type: 'fetch' });
    
    return response;
};

XMLHttpRequest.prototype.open = function (method, url) {
    this._adsfriendly_url = url;
    this._adsfriendly_method = method;
    return originalXHROpen.apply(this, arguments);
};

XMLHttpRequest.prototype.send = function (body) {
    const url = this._adsfriendly_url;
    if (url) {
        this.addEventListener('load', () => {
            processEvent({ url, method: this._adsfriendly_method, type: 'xhr' });
        });
    }
    return originalXHRSend.apply(this, arguments);
};
