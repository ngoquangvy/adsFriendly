// engine/hub/runtime_pipeline.js
const PIPELINE_EMPTY_STATE = Object.freeze({
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

const createPipelineMessageId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2);
};

const RuntimePipeline = {
    _initDone: false,

    init() {
        if (this._initDone) return;
        this._initDone = true;

        window.addEventListener('message', async (e) => {
            const data = e.data;
            if (!data || data.source !== 'adsfriendly-engine' || data.type !== 'PIPELINE_EVENT') return;

            const { requestId, event } = data;
            const result = await this.process(event);

            window.postMessage({
                source: 'adsfriendly-engine',
                type: 'PIPELINE_RESULT',
                requestId,
                result
            }, '*');
        });
    },

    async process(event) {
        const timestamp = Date.now();

        // ✅ HANDLE QUEUED STATUS: Events from BrainBridge queue
        if (event?.action === 'QUEUED') {
            console.debug('[Pipeline] Event queued in BrainBridge, will process when synced');
            return {
                eventId: event.eventId,
                action: 'queued',
                reason: event.reason,
                skipReason: 'EVENT_IN_BRIDGE_QUEUE',
                timestamp
            };
        }

        // ✅ SCHEMA VALIDATION: Check if event has required fields
        const eventValidation = this.validateEventSchema(event);
        if (!eventValidation.isValid) {
            console.error('[Pipeline] Event schema invalid:', eventValidation.errors, event);
            return this.fallback(event || {}, `SCHEMA_ERROR:${eventValidation.errors[0]}`);
        }

        const domain = event?.domain || 'unknown';
        const pipelineEvent = {
            ...event,
            trace: {
                ...(event?.trace || {}),
                pipeline_received_ts: timestamp
            }
        };

        let currentState;
        try {
            currentState = await this.fetchGlobalMemory(domain);
        } catch (_) {
            return this.fallback(pipelineEvent, 'MEMORY_FETCH_ERROR');
        }

        if (!window.Engine?.hub?.Orchestrator?.process) {
            return this.fallback(pipelineEvent, 'ERROR_NO_ORCHESTRATOR');
        }

        try {
            const { decision, stateUpdate } = await window.Engine.hub.Orchestrator.process(pipelineEvent, currentState);
            const telemetryEvent = {
                ...pipelineEvent,
                trace: {
                    ...(pipelineEvent.trace || {}),
                    orchestrator_ts: Date.now()
                }
            };
            const telemetryPayload = this.buildTelemetryPayload(telemetryEvent, currentState, decision);

            if (stateUpdate) {
                this.syncBehavior(stateUpdate, pipelineEvent.epoch, telemetryPayload.record, decision, currentState);
            }

            this.emitTelemetry(telemetryPayload);
            return decision || this.fallback(pipelineEvent, 'EMPTY_DECISION');
        } catch (_) {
            return this.fallback(pipelineEvent, 'ORCHESTRATOR_ERROR');
        }
    },

    async fetchGlobalMemory(domain) {
        return new Promise((resolve) => {
            const requestId = createPipelineMessageId();
            const timeout = setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve({ ...PIPELINE_EMPTY_STATE, startTime: Date.now() });
            }, 300);

            const handler = (e) => {
                if (e.data?.type !== 'FORENSIC_MEMORY_RESPONSE' || e.data?.requestId !== requestId) return;

                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                resolve(e.data.state || { ...PIPELINE_EMPTY_STATE, startTime: Date.now() });
            };

            window.addEventListener('message', handler);
            window.postMessage({
                source: 'adsfriendly-engine',
                type: 'FORENSIC_MEMORY_FETCH',
                domain,
                requestId
            }, '*');
        });
    },

    syncBehavior(stateUpdate, epoch, record = {}, decision = {}, currentState = {}) {
        window.postMessage({
            source: 'adsfriendly-engine',
            type: 'FORENSIC_MEMORY_COMMIT',
            update: stateUpdate,
            epoch,
            verificationEnvelope: {
                record,
                stateSnapshot: currentState,
                decision: {
                    eventId: decision?.eventId || '',
                    epoch: decision?.epoch || epoch || 0,
                    timestamp: decision?.timestamp || Date.now(),
                    schema_hash: decision?.schema_hash || null,
                    decisionPath: decision?.decisionPath || null
                }
            }
        }, '*');
    },

    buildTelemetryPayload(event, currentState, decision) {
        const recordFactory = window.Engine?.shared?.RecordFactory;
        return recordFactory?.buildTelemetryPayload({ event, currentState, decision }) || {
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
                reason: decision.reason,
                label_pred: decision.label_pred,
                action: decision.action,
                score: decision.score,
                confidence: decision.confidence,
                decisionPath: decision.decisionPath,
                contributions: decision.contributions,
                forensic: decision.forensic || null
            }
        };
    },

    emitTelemetry(payload) {
        window.postMessage({
            source: 'adsfriendly-engine',
            type: 'SUBMIT_TELEMETRY',
            payload
        }, '*');
    },

    validateEventSchema(event) {
        const errors = [];
        if (!event) errors.push('event_null');
        if (!event?.url) errors.push('url_missing');
        if (!event?.requestId) errors.push('requestId_missing');
        if (!event?.type) errors.push('type_missing');
        if (!event?.phase) errors.push('phase_missing');
        if (!event?.eventId) errors.push('eventId_missing');
        return { isValid: errors.length === 0, errors };
    },

    fallback(event = {}, label = 'FALLBACK') {
        return {
            eventId: event.eventId || '',
            epoch: event.epoch || 0,
            timestamp: event.timestamp || Date.now(),
            action: 'allow',
            reason: label,
            score: 0,
            confidence: 0,
            url: event.url,
            domain: event.domain || 'unknown',
            decisionPath: {
                triggeredRules: [],
                gatesPassed: [],
                blockedBy: [],
                finalDecisionReason: label.toLowerCase(),
                dominantContribution: 'none',
                causalChain: label.toLowerCase()
            },
            contributions: {},
            forensic: null
        };
    }
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.hub = window.Engine.hub || {};
    window.Engine.hub.RuntimePipeline = RuntimePipeline;
    RuntimePipeline.init();
}

if (typeof module !== 'undefined') {
    module.exports = RuntimePipeline;
}
