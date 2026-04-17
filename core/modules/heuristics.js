// core/modules/heuristics.js
window.AdsFriendlyHeuristics = {
    cachedPatterns: [],
    siteTrustScore: 0.5,
    currentAdDensity: 0,

    calculateAdScore(video) {
        let score = 0;
        const src = video.currentSrc || video.src || '';
        if (!src) return 0;

        // 1. URL Pattern Intelligence (v2.8.6)
        if (src.includes('raw.githubusercontent') || src.includes('.xml') || src.includes('vast')) {
            if (video.duration > 0 && video.duration < 65) return 1.0;
            score += 0.5;
        }

        // 2. Learned Patterns
        if (AdsFriendlyHeuristics.cachedPatterns) {
            AdsFriendlyHeuristics.cachedPatterns.forEach(p => {
                if (p.type === 'video_source_marker' && src.includes(p.value)) score += 0.8;
                if (p.type === 'video_marker' && video.closest(p.value)) score += 0.6;
            });
        }

        // 2. Location Reputation (Crucial)
        // If site trust is low, we are more suspicious
        if (AdsFriendlyHeuristics.siteTrustScore < 0.3) score += 0.3;
        if (AdsFriendlyHeuristics.siteTrustScore > 0.8) score -= 0.6;

        // 3. Ad Density (Current page environment)
        if (AdsFriendlyHeuristics.currentAdDensity > 5) score += 0.2;
        if (AdsFriendlyHeuristics.currentAdDensity > 15) score += 0.4;

        // 4. Technical Heuristics
        const isExternal = !src.startsWith('blob:') && !src.includes(window.location.hostname);
        if (isExternal) {
            score += 0.3;
            if (src.includes('githubusercontent.com') || src.includes('github.io')) score += 0.2;
            if (src.toLowerCase().endsWith('.mp4')) score += 0.2;
        }

        // 5. Short Duration
        if (video.duration > 0 && video.duration < 65) score += 0.2;
        if (video.duration > 300) score -= 1.0; // Long videos are likely content

        return Math.min(1.0, score);
    },

    getSourceDomain(src) {
        if (!src) return 'unknown';
        try {
            return new URL(src, window.location.href).hostname || 'unknown';
        } catch (e) {
            return 'unknown';
        }
    },

    async getVideoSourceStats() {
        if (!chrome.runtime || !chrome.runtime.id) return {};
        try {
            return await new Promise(resolve => {
                chrome.runtime.sendMessage({ type: 'GET_VIDEO_SOURCE_STATS' }, response => {
                    resolve(response || {});
                });
            });
        } catch (e) {
            return {};
        }
    }
};
