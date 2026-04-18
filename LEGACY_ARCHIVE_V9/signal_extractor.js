// core/modules/signal_extractor.js
/**
 * Vanguard Citadel - Signal Extractor v0.1 (Phase 1.2 Intelligence)
 * Extracts pure feature vector and contextual metadata.
 */
const AdsFriendlySignalExtractor = {
    /**
     * Distills a feature vector from normalized raw capture.
     * @param {Object} raw - The normalized network event.
     * @returns {Object} The feature vector and context.
     */
    extract(raw) {
        if (!raw || !raw.url) return { features: { adsLikelihood: 0, telemetryScore: 0, internalStatsScore: 0 }, context: { isCDN: false, trust: 0 } };

        const url = raw.url.toLowerCase();

        return {
            features: {
                adsLikelihood: this.checkAdsLikelihood(url),
                telemetryScore: this.checkTelemetryScore(url),
                internalStatsScore: this.checkInternalStatsScore(url),
                isShortBurst: this.checkShortBurst(raw)
            },
            context: {
                isCDN: url.includes('googlevideo.com') || url.includes('ytimg.com') || url.includes('videoplayback'),
                trust: url.includes('googlevideo.com') ? 0.8 : 0.0
            }
        };
    },

    checkAdsLikelihood(url) {
        if (/doubleclick|googlesyndication|adservice/.test(url)) return 1.0;
        if (/ads|adclick|pagead/.test(url)) return 0.5;
        return 0.0;
    },

    checkTelemetryScore(url) {
        if (/analytics|collect|telemetry/.test(url)) return 0.8;
        if (/metric|ptracking|log_event|csi|ecatcher/.test(url)) return 0.3;
        return 0.0;
    },

    checkInternalStatsScore(url) {
        if (/\/stats\//.test(url) || url.includes('/qoe') || url.includes('/playback')) return 1.0;
        return 0.0;
    },

    checkShortBurst(raw) {
        return raw.url.includes('generate_204') || raw.url.includes('ptracking') ? 1.0 : 0.0;
    }
};

if (typeof window !== 'undefined') {
    window.AdsFriendlySignalExtractor = AdsFriendlySignalExtractor;
}

// End of file
