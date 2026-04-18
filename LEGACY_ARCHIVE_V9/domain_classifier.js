/**
 * 🧠 Vanguard Domain Intelligence Layer
 * Role: Centralized classification for all network activity.
 */
const DomainClassifier = {
    classify(url) {
        const normalized = this.normalizeUrl(url);
        const domain = this.extractDomain(normalized);
        const u = normalized.toLowerCase();
        
        // 0. Request Type Steering (Higher priority)
        const type = this.classifyRequest(normalized);
        if (type === 'media') return 'media_cdn';
        if (type === 'ads') return 'ads_network';
        if (type === 'telemetry') return 'internal_stats';
        const adsRootDomains = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'googleads.g.doubleclick.net'];
        const isAdsRoot = adsRootDomains.some(d => domain.endsWith(d));
        const hasAdsPath = /pagead|viewthroughconversion|ad_type|adservice/.test(u);

        if (isAdsRoot || hasAdsPath) {
            return 'ads_network';
        }
        
        // 2. Pure Tracking & Analytics
        if (/analytics|collect|telemetry|metrics|ptracking|log_event|csi|ecatcher/.test(u) || domain.includes('analytics')) {
            return 'tracking';
        }
        
        // 3. Internal Platform Telemetry (Non-tracking stats)
        if (/\/stats\//.test(u) || u.includes('/qoe') || u.includes('/playback') || u.includes('/atp/')) {
            return 'internal_stats';
        }
        
        // 4. Media & Content Delivery
        if (/googlevideo.com|videoplayback|ytimg.com|akamaihd|vimeocdn/.test(u) || domain.includes('cdn')) {
            return 'media_cdn';
        }
            
        return 'unknown';
    },

    classifyRequest(url) {
        const u = url.toLowerCase();
        if (u.includes('googlevideo.com') || u.includes('videoplayback')) return 'media';
        if (u.includes('doubleclick.net') || u.includes('googlesyndication.com')) return 'ads';
        if (u.includes('youtube.com/api/stats') || u.includes('/ptracking') || u.includes('/log_event')) return 'telemetry';
        return 'unknown';
    },

    normalizeUrl(url) {
        try {
            if (typeof url !== 'string') return url;
            let u = url;
            if (u.startsWith('//')) u = window.location.protocol + u;
            if (u.startsWith('/')) u = window.location.origin + u;
            return u;
        } catch (e) { return url; }
    },

    extractDomain(url) {
        try {
            const normalized = this.normalizeUrl(url);
            return new URL(normalized).hostname;
        } catch (e) {
            return 'unknown';
        }
    }
};

if (typeof window !== 'undefined') {
    window.AdsFriendlyDomainClassifier = DomainClassifier;
}
