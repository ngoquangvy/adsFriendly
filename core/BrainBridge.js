/**
 * AdsFriendly: BrainBridge (v5.0 - Server-Ready Architecture)
 * The authoritative bridge between client sensors and the underlying intelligence.
 * Orchestrates Data Intake, API Gateway Sync, and Rules Routing.
 */

// Cấp quyền gọi qua API Gateway nếu được inject chung môi trường
const gateway = typeof APIGateway !== 'undefined' ? APIGateway : null;
const EMPTY_STATE = Object.freeze({
    startTime: 0,
    lastSeen: 0,
    count: 0,
    intervalWindow: [],
    scoreWindow: [],
    types: [],
    seenTypes: [],
    isTrustedCDN: true,
    reputation: 0,
    confidence: 0,
    decisionScore: 0,
    lastActionTime: 0,
    isLocked: false,
    lastSpikeTime: 0,
    lastEventId: '',
    lastUrl: ''
});

const BrainBridge = {
    mode: 'VANGUARD_FORENSIC',
    _epoch: 0,
    _eventSeq: 0,
    _isSynced: false,

    async init() {
        this.initEpochSync();
        // Request initial state/epoch
        window.postMessage({ source: 'adsfriendly-engine', type: 'INITIAL_HANDSHAKE' }, "*");
    },

    // --- 🛡️ v16.14 TRANSPORT ENGINE ---

    async dispatch(partialEvent) {
        this._eventSeq++;
        const eventId = `${this._epoch}:${this._eventSeq}`;

        // 2. Minimum Meta Attachment
        const event = {
            ...partialEvent,
            eventId,
            epoch: this._epoch,
            timestamp: Date.now()
        };

        // 3. Normalize and Extract Domain (Safe Path)
        const url = this.standardizeUrl(event.url);
        event.url = url;

        // Trace Entry (Confirming Radar -> Bridge Signal)
        console.log("%c[TRACE EVENT]", "color:#f59e0b; font-weight:bold;", {
            eventId,
            epoch: this._epoch,
            url: partialEvent.url,
            type: partialEvent.type,
            method: partialEvent.method,
            timestamp: Date.now()
        });

        const domain = this.extractDomain(url);

        // 4. Sync State from Background (Atomic Fetch)
        const currentState = await this.fetchGlobalMemory(domain);

        // 5. Decision Pipeline
        if (window.Engine?.hub?.Orchestrator) {
            const { decision, stateUpdate } = await window.Engine.hub.Orchestrator.process(event, currentState);

            // 5. Atomic State Feedback to Background
            if (stateUpdate) {
                this.syncBehavior(stateUpdate);
            }

            if (gateway) {
                gateway.submitTelemetry({
                    type: 'FORENSIC_DECISION',
                    provider_type: 'VANGUARD_V16',
                    data: {
                        eventId: decision.eventId,
                        epoch: decision.epoch,
                        timestamp: decision.timestamp,
                        eventType: event.type,
                        method: event.method,
                        url: decision.url,
                        domain: decision.domain,
                        stateCount: currentState?.count || 0,
                        label_pred: decision.label_pred,
                        action: decision.action,
                        score: decision.score,
                        confidence: decision.confidence,
                        decisionPath: decision.decisionPath,
                        contributions: decision.contributions,
                        forensic: decision.forensic || null
                    }
                }).catch(() => { });
            }

            return decision;
        }

        return {
            eventId,
            epoch: this._epoch,
            timestamp: event.timestamp,
            action: 'ALLOW',
            label_pred: 'ERROR_NO_ORCHESTRATOR',
            score: 0,
            confidence: 0,
            domain
        };
    },

    standardizeUrl(input) {
        try {
            if (!input) return "";

            let raw = input;

            if (typeof input === 'object') {
                raw = input.url || input.href || input.toString?.() || "";
            }

            if (typeof raw !== 'string') return "";

            raw = raw.trim();

            // special protocol → giữ nguyên
            if (/^(data:|blob:|mailto:|tel:|sms:)/i.test(raw)) {
                return raw;
            }

            // fix space
            raw = raw.replace(/ /g, '%20');

            const base = window.location?.href || "https://fallback.local/";

            return new URL(raw, base).href;

        } catch (e) {
            return String(input || "");
        }
    },

    extractDomain(url) {
        try {
            if (!url) return 'unknown';

            if (/^(data:|blob:|mailto:|tel:|sms:)/i.test(url)) {
                return 'special-protocol';
            }

            const base = window.location?.href || "https://fallback.local/";
            const parsed = new URL(url, base);

            return parsed.hostname || 'unknown';

        } catch (e) {
            return 'unknown';
        }
    },

    async fetchGlobalMemory(domain) {
        return new Promise((resolve) => {
            const requestId = Math.random().toString(36).substring(2, 9);
            const handler = (e) => {
                if (e.data?.type === 'FORENSIC_MEMORY_RESPONSE' && e.data?.requestId === requestId) {
                    window.removeEventListener('message', handler);
                    resolve(e.data.state || { ...EMPTY_STATE, startTime: Date.now() });
                }
            };
            window.addEventListener('message', handler);
            window.postMessage({ source: 'adsfriendly-engine', type: 'FORENSIC_MEMORY_FETCH', domain, requestId }, "*");
            setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve({ ...EMPTY_STATE, startTime: Date.now() });
            }, 500);
        });
    },

    initEpochSync() {
        window.addEventListener('message', (e) => {
            if (e.data?.source !== 'adsfriendly-background') return;

            if (e.data.type === 'EPOCH_UPDATE') {
                const { epoch } = e.data;
                this._epoch = epoch;
                this._isSynced = true;
                this._eventSeq = 0; // Reset sequence on new epoch

                // Handshake ACK
                window.postMessage({
                    source: 'adsfriendly-engine',
                    type: 'ACK_EPOCH_SYNC',
                    epoch,
                    tabId: sessionStorage.getItem('__V_TAB_ID')
                }, "*");
            }
        });
    },

    syncBehavior(stateUpdate) {
        // Debounced or direct batching is handled in background, bridge just pushes
        window.postMessage({
            source: 'adsfriendly-engine',
            type: 'FORENSIC_MEMORY_COMMIT',
            update: stateUpdate,
            epoch: this._epoch
        }, "*");
    }
};
// Global Exposure
if (typeof window !== 'undefined') {
    BrainBridge.init();
    window.Engine = window.Engine || {};
    window.Engine.brainBridge = BrainBridge;
    window.BrainBridge = BrainBridge;
}

if (typeof window === 'undefined') {
    module.exports = BrainBridge;
}
