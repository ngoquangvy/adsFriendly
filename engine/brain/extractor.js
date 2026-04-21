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
        
        // --- 1. MEDIA & HLS FRAGMENT DETECTION (v16.0) ---
        const isMediaBase =
            url.includes('.m3u8') ||
            url.includes('.ts') ||         // 🔥 QUAN TRỌNG (HLS segment)
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

        // --- 2. V16.4 WEAK SIGNAL SYNTHESIS VECTOR ---
        const unified = {
            // STATIC / PATTERN
            url,
            isAdPattern: domainClass === 'ads_network' || this.checkAdKeywords(url),
            isMedia: isMediaBase || isHLS,
            isUnknownDomain: domainClass === 'unknown',
            responseSize: Number.isFinite(event.responseSize) ? event.responseSize : -1,
            isCrossOrigin: Boolean(event.isCrossOrigin),
            
            // EVENT LEVEL
            type: event.type || 'unknown',
            
            // FORENSIC SIGNAL SYNTHESIS (v16.4)
            cv: this.calculateCV(state.intervalWindow), 
            entropy: this.calculateEntropy(url),
            interactionGap: this.calculateInteractionGap(),
            
            // BEHAVIORAL
            frequency: state.frequency || 0,
            sessionCount: state.count || 0,
            reputation: state.reputation || 0,
            typeDiversity: state.types ? state.types.size : 0
        };

        return { v2: unified, domainClass };
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

    calculateInteractionGap() {
        if (typeof window === 'undefined') return 10000;
        const lastAction = window.__V_LAST_INTERACTION || 0;
        return (Date.now() - lastAction) / 1000; // in seconds
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
