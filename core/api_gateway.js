const APIGateway = {
    serverUrl: 'http://localhost:3000',

    async _simulateLatency(ms = 300) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    },

    async fetchCloudRules(userToken = null) {
        try {
            await this._simulateLatency(500);
            return {
                globalPatterns: [
                    { type: 'video_source_marker', value: 'doubleclick.net' },
                    { type: 'video_source_marker', value: 'innovid.com' }
                ],
                trustScores: {
                    'youtube.com': 0.9,
                    'phimmoi.net': 0.1
                }
            };
        } catch (err) {
            console.error('[API Gateway] Cloud rules fetch failed:', err);
            return {
                globalPatterns: [],
                trustScores: {}
            };
        }
    },

    sessionId: Math.random().toString(36).substring(2, 15),

    buildTunnelPayload(payload) {
        const safePayload = payload && typeof payload === 'object' ? payload : {};
        const identity = {
            ...(safePayload.identity || {}),
            site_domain: safePayload.identity?.site_domain || window.location.hostname,
            session_id: safePayload.identity?.session_id || this.sessionId,
            provider_type: safePayload.provider_type || safePayload.identity?.provider_type || 'UNKNOWN'
        };

        return {
            ...safePayload,
            identity,
            provider_type: safePayload.provider_type || identity.provider_type,
            type: safePayload.type || 'UNKNOWN_TELEMETRY',
            data: safePayload.data && typeof safePayload.data === 'object' ? safePayload.data : {},
            timestamp: safePayload.timestamp || Date.now()
        };
    },

    async submitTelemetry(payload) {
        try {
            const fullPayload = this.buildTunnelPayload(payload);

            console.log('[TELEMETRY] sending', fullPayload);

            window.postMessage({
                source: 'adsfriendly-engine',
                type: 'SUBMIT_TELEMETRY',
                version: '2.1',
                timestamp: Date.now(),
                payload: fullPayload
            }, '*');

            return { success: true, tunneled: true, hasRecord: !!fullPayload.record };
        } catch (err) {
            console.warn('[API Gateway] Tunneling failed:', err.message);
            return { success: false, error: err.message, tunneled: false };
        }
    }
};

if (typeof window !== 'undefined') {
    window.APIGateway = APIGateway;
}

if (typeof module !== 'undefined') {
    module.exports = APIGateway;
}
