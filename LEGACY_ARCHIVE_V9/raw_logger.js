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
        const url = event.url;
        const normalized = window.AdsFriendlyDomainClassifier ? window.AdsFriendlyDomainClassifier.normalizeUrl(url) : url;
        const domain = this.extractDomain(normalized);
        
        let domainClass = window.AdsFriendlyDomainClassifier ? window.AdsFriendlyDomainClassifier.classify(normalized) : 'unknown';

        // 🛡️ LAYER 1 SEMANTIC GUARD: 
        // If the domain identity is lost (unknown), we MUST treat the class as unknown.
        // This prevents path-based keywords from flagging isolated/sandboxed traffic as HIGH_RISK.
        if (!domain || domain === 'unknown') {
            domainClass = 'unknown';
        }

        return {
            url: normalized,
            normalizedPath: this.normalizePath(normalized),
            domain: domain,
            domainClass: domainClass,
            type: domainClass,
            method: event.method || 'GET',
            type_native: event.type || 'unknown',
            size: event.size || 0,
            timestamp: Date.now(),
            frameType: window.top === window.self ? 'main' : 'iframe',
            initiator: {
                type: 'origin',
                value: window.location.hostname
            },
            initiatorHint: {
                type: 'stack',
                value: this.extractStackHint(event.stack),
                confidence: 0.3
            }
        };
    },

    normalizePath(url) {
        try {
            const u = new URL(url);
            return u.pathname;
        } catch (e) {
            return url.split('?')[0];
        }
    },

    extractDomain(url) {
        try {
            let u = url;
            if (u.startsWith('//')) u = 'https:' + u;
            if (!u.startsWith('http')) u = 'https://' + u;
            return new URL(u).hostname;
        } catch (e) {
            return 'unknown';
        }
    },

    extractStackHint(stack) {
        if (!stack) return 'direct/media';
        // Simple regex to find the first script name that isn't internal chrome-extension
        const lines = typeof stack === 'string' ? stack.split('\n') : [];
        for (let line of lines) {
            if (line.includes('http') && !line.includes('chrome-extension')) {
                const match = line.match(/\/([^\/\?#]+)\.?/);
                if (match) return match[1];
            }
        }
        return 'unknown';
    }
};

if (typeof window !== 'undefined') {
    window.AdsFriendlyRawLogger = AdsFriendlyRawLogger;
}

// End of file
