// engine/brain/extractor.js
/**
 * 🧪 Feature + Heuristic Layer (Experimental)
 * Logic for distilling raw data into feature vectors.
 */
const Extractor = {
    extract(event, state) {
        const url = event.url.toLowerCase();
        const domain = event.domain || '';
        const domainClass = event.domainClass || 'unknown';
        
        // 1. Feature Vector V2 (Consolidated Intelligence)
        const v2 = {
            network: {
                isAdDomain: domainClass === 'ads_network',
                isTrackingDomain: domainClass === 'tracking',
                isMediaCDN: domainClass === 'media_cdn',
                isCorsError: event.isError === true,
                entropyScore: this.calculateEntropy(url)
            },
            context: {
                isYoutube: domain.includes('youtube.com') || domain.includes('googlevideo.com'),
                isIframe: event.frameType === 'iframe',
                isPlayerContext: url.includes('videoplayback') || url.includes('/watch'),
                session: this.getSessionContext()
            }
        };

        // 2. Compatibility Layer (Legacy Parity)
        const v1 = {
            adsEndpointMatch: v2.network.isAdDomain ? 1 : 0,
            trackingMatch: (v2.network.isTrackingDomain ? 1 : 0) + (v2.network.isCorsError ? 0.3 : 0),
            statsEndpoint: domainClass === 'internal_stats' ? 1 : 0,
            mediaCdnMatch: v2.network.isMediaCDN ? 1 : 0
        };

        return { v1, v2, domainClass };
    },

    getSessionContext() {
        return window.VanguardSessionId || 'default-session';
    },

    calculateEntropy(url) {
        try {
            const path = new URL(url).pathname;
            if (!path || path.length < 5) return 0;
            const matches = path.match(/[0-9_\-\.\%]/g);
            return matches ? matches.length / path.length : 0;
        } catch (e) { return 0; }
    }
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.brain = window.Engine.brain || {};
    window.Engine.brain.Extractor = Extractor;
}
