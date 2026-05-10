// engine/shared/url_normalizer.js
const UrlNormalizer = {
    normalizeDomain(domain) {
        if (!domain) return 'unknown';
        return String(domain).toLowerCase().replace(/\.+$/, '') || 'unknown';
    },

    standardizeUrl(input, baseHref = '') {
        try {
            if (!input) return '';

            let raw = input;
            if (typeof input === 'object') {
                if (typeof input.url === 'string') raw = input.url;
                else if (typeof input.href === 'string') raw = input.href;
                else if (typeof input.toString === 'function' && input.toString !== Object.prototype.toString) raw = input.toString();
                else raw = '';
            }

            if (typeof raw !== 'string') return '';

            raw = raw.trim();
            if (/^(data:|blob:|mailto:|tel:|sms:)/i.test(raw)) {
                return raw;
            }

            raw = raw.replace(/ /g, '%20');
            if (raw.length > 4096) {
                raw = raw.slice(0, 4096);
            }

            return new URL(raw, baseHref || 'https://fallback.local/').href;
        } catch (_) {
            return String(input || '');
        }
    },

    extractDomain(url, baseHref = '') {
        try {
            if (!url) return 'unknown';
            if (/^(data:|blob:|mailto:|tel:|sms:)/i.test(url)) {
                return 'special-protocol';
            }

            const parsed = new URL(url, baseHref || 'https://fallback.local/');
            return parsed.hostname || 'unknown';
        } catch (_) {
            return 'unknown';
        }
    }
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.shared = window.Engine.shared || {};
    window.Engine.shared.UrlNormalizer = UrlNormalizer;
}

if (typeof module !== 'undefined') {
    module.exports = UrlNormalizer;
}
