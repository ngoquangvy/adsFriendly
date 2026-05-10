// engine/brain/extractor.js
/**
 * 🧪 Feature + Heuristic Layer (Experimental)
 * Logic for distilling raw data into feature vectors.
 */
const Extractor = {
    extract(event, state) {
        const url = (event.url || '').toLowerCase();
        const domain = event.domain || '';
        const domainClass = event.domainClass || 'unknown';
        const pageHost = typeof window !== 'undefined' ? window.location.hostname : '';

        // --- 1. MEDIA & HLS FRAGMENT DETECTION (v16.0) ---
        const isMediaBase =
            url.includes('.m3u8') ||
            url.includes('.ts') ||
            url.includes('.mp4') ||
            url.includes('.webm') ||
            url.includes('videoplayback') ||
            url.includes('mime=video') ||
            url.includes('mime%3dvideo') ||
            url.includes('mime=audio') ||
            url.includes('mime%3daudio') ||
            url.includes('/video') ||
            url.includes('/stream') ||
            domain.includes('cdn') ||
            domain.includes('video');

        const isHLS =
            url.includes('/hls') ||
            url.includes('-hls-') ||
            url.includes('/seg') ||
            url.match(/_\d+p/); // e.g., 160p, 720p

        // --- 2. FORENSIC SIGNAL SYNTHESIS (v16.32) ---
        const stats = this.calculateStructureMetrics(url);
        const marketingParams = ['utm_', 'clickid', 'gclid', 'fbclid', 'aff_id', 'affiliate', 'campaign'];
        const isMarketing = marketingParams.some(p => url.includes(p) || (event.href && event.href.includes(p)));

        const contextScore = event.context ? this.calculateContextScore(event.context) : 0;

        // Disparity Analysis (Cross-Origin Hook)
        const isUrlCrossOrigin = event.isCrossOrigin || (domain && pageHost && !pageHost.includes(domain));
        const hrefDomain = event.href && event.href.startsWith('http') ? new URL(event.href, window.location.href).hostname : null;
        const isHrefCrossOrigin = hrefDomain && pageHost && !pageHost.includes(hrefDomain);
        const sourceDisparity = (domain && hrefDomain && domain !== hrefDomain);

        // ✅ READ SEMANTIC ROLES FROM RADAR
        const isSemanticMedia = event.context?.resourceClass === 'video_stream' || event.context?.transport?.isChunked;
        const isSemanticAd = event.context?.subClass?.isAd || event.context?.resourceClass === 'ad_service' || event.context?.resourceClass === 'tracking_pixel';

        const unified = {
            // BEHAVIORAL & CONTEXT
            url,
            isAdPattern: isSemanticAd || domainClass === 'ads_network' || this.checkAdKeywords(url) || contextScore > 0.5,
            isMedia: isSemanticMedia || isMediaBase || isHLS,
            isMarketing,
            contextScore,

            // DISPARITY SIGNALS
            isCrossOrigin: isUrlCrossOrigin,
            isHrefCrossOrigin: !!isHrefCrossOrigin,
            sourceDisparity: !!sourceDisparity,

            // STRUCTURAL FORENSICS
            slashCount: stats.slashCount,
            maxSegmentLength: stats.maxSegmentLength,
            isSpecialProtocol: /^(data:|blob:|mailto:|tel:|sms:)/i.test(url) || domain === 'special-protocol',

            // EVENT LEVEL
            type: event.type || 'unknown',

            // DYNAMIC SIGNALS
            cv: this.calculateCV(state.intervalWindow),
            entropy: this.calculateEntropy(url),
            interactionGap: this.calculateInteractionGap(event),

            // REPUTATION
            frequency: state.frequency || 0,
            sessionCount: state.count || 0,
            reputation: state.reputation || 0
        };

        return { v2: unified, domainClass };
    },

    calculateContextScore(context) {
        const adKeywords = ['ad-', 'banner', 'promo', 'sponsor', 'overlay', 'popup', 'container-ad'];
        let score = 0;
        const raw = `${context.id} ${context.className} ${context.parentClass} ${context.parentId}`.toLowerCase();
        adKeywords.forEach(kw => {
            if (raw.includes(kw)) score += 0.4;
        });
        return Math.min(score, 1.0);
    },

    calculateStructureMetrics(url) {
        try {
            // Use segments from path only, avoiding query for slashCount consistency
            const path = url.split('?')[0];
            const segments = path.split('/');

            return {
                slashCount: segments.length - 1,
                maxSegmentLength: segments.reduce((max, s) => Math.max(max, s.length), 0),
                fingerprint: url.substring(0, 150) // Simple truncation for fingerprinting
            };
        } catch (e) {
            return { slashCount: 0, maxSegmentLength: 0, fingerprint: 'error' };
        }
    },

    getSessionContext() {
        return window.VanguardSessionId || 'default-session';
    },

    calculateEntropy(url) {
        try {
            const path = new URL(url).pathname;
            if (!path || path.length < 5) return 0;
            // Shanon Entropy approximation for obfuscation detection
            const freq = {};
            for (let char of path) freq[char] = (freq[char] || 0) + 1;
            let entropy = 0;
            for (let char in freq) {
                const p = freq[char] / path.length;
                entropy -= p * Math.log2(p);
            }
            return entropy / 8; // Normalized
        } catch (e) { return 0; }
    },

    calculateCV(intervals) {
        if (!intervals || intervals.length < 3) return 1.0; // Not enough data
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        if (mean === 0) return 0;
        const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
        const stdDev = Math.sqrt(variance);
        return stdDev / mean; // Coefficient of Variation
    },

    calculateInteractionGap(event) {
        // Use event-specific temporal tracking if available
        if (event && event.context && event.context.interactionAge !== undefined) {
            if (event.context.interactionAge === -1) return 10000; // No prior interaction
            return event.context.interactionAge / 1000; // Convert ms to seconds
        }

        // Fallback for older events or environments
        if (typeof window === 'undefined') return 10000;
        const lastAction = window.__V_LAST_INTERACTION || 0;
        return (Date.now() - lastAction) / 1000;
    },

    isThirdParty(domain) {
        try {
            const host = window.location.hostname;
            if (!domain || domain === 'unknown' || !host) return false;
            return !host.includes(domain) && !domain.includes(host);
        } catch (e) { return false; }
    },

    checkAdKeywords(url) {
        const adKeywords = [
            '/ads/', '/bid/', '/vast/', '/vpaid/', 'pixel', 'tracking', '/popunder',
            '/pop-under', 'deliver_ads', 'banner', 'sponsor', 'ad_type', 'adservice'
        ];
        const u = url.toLowerCase();
        return adKeywords.some(kw => u.includes(kw));
    }
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.brain = window.Engine.brain || {};
    window.Engine.brain.Extractor = Extractor;
}
