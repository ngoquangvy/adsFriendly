// core/modules/raw_logger.js
/**
 * Vanguard Citadel - Raw Logger (Phase 1)
 * Captures and normalizes network events. No analysis, no regex.
 */
const AdsFriendlyRawLogger = {
    /**
     * Normalizes a raw network event into a standard core schema.
     * @param {Object} event - The raw event from proxies.
     * @returns {Object} The normalized event.
     */
    capture(event) {
        return {
            url: event.url,
            method: event.method || 'GET',
            type: event.type || 'unknown',
            timestamp: Date.now(),
            frameType: window.top === window.self ? 'main' : 'iframe'
        };
    }
};

if (typeof window !== 'undefined') {
    window.AdsFriendlyRawLogger = AdsFriendlyRawLogger;
}

export default AdsFriendlyRawLogger;
