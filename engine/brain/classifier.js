// engine/brain/classifier.js
/**
 * 🧠 Vanguard Business Intelligence Layer
 * Role: Unified classification for the entire engine.
 * Moved from legacy core/modules/domain_classifier.js
 */
const Classifier = {
    classify(url) {
        if (!url || typeof url !== 'string') return 'unknown';
        const u = url.toLowerCase();
        const domain = this.extractDomain(u);
        
        // 1. Media & Content Delivery (High Priority Fast Path)
        if (u.includes('googlevideo.com') || u.includes('videoplayback') || u.includes('ytimg.com')) {
            return 'media_cdn';
        }

        // 2. Ads & Tracking Networks
        const adsPattern = /doubleclick\.net|googlesyndication\.com|googleadservices\.com|googleads\.g\.doubleclick\.net|pagead|viewthroughconversion|ad_type|adservice/;
        if (adsPattern.test(u)) {
            return 'ads_network';
        }
        
        // 3. Analytics & Telemetry
        if (/analytics|collect|telemetry|metrics|ptracking|log_event|csi|ecatcher/.test(u) || domain.includes('analytics')) {
            return 'tracking';
        }
        
        // 4. Internal Platform Telemetry (Non-tracking stats)
        if (/\/stats\//.test(u) || u.includes('/qoe') || u.includes('/playback') || u.includes('/atp/')) {
            return 'internal_stats';
        }
            
        return 'unknown';
    },

    extractDomain(url) {
        try {
            return new URL(url).hostname;
        } catch (e) {
            return 'unknown';
        }
    }
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.brain = window.Engine.brain || {};
    window.Engine.brain.Classifier = Classifier;
}
