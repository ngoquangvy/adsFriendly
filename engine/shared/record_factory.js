// engine/shared/record_factory.js
const RISK_MAP = Object.freeze({
    SAFE: ['SAFE'],
    SUSPICIOUS: ['SUSPICIOUS'],
    HIGH_RISK: ['HIGH_RISK'],
    MALICIOUS: ['MALICIOUS'],
    MEDIA_PASS: ['SAFE']
});

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

const RecordFactory = {
    mapEntityType(event = {}) {
        const type = String(event.type || '').toLowerCase();
        if (type === 'xhr') return 'XHR';
        if (type === 'fetch') return 'FETCH';
        if (type === 'script') return 'SCRIPT';
        if (type === 'iframe') return 'IFRAME';
        if (type === 'navigation') return 'NAVIGATION';
        if (type === 'beacon') return 'BEACON';
        if (type === 'websocket') return 'WEBSOCKET';
        if (type === 'popup') return 'POPUP';
        if (type === 'video' || event.context?.isVideoElement) return 'MEDIA';
        if (type === 'img' || type === 'image') return 'IMAGE';
        return 'RESOURCE';
    },

    buildContextLabels(event = {}) {
        const labels = new Set();
        if (event.interactionId && event.interactionId !== 'autonomous') labels.add('USER_CLICK_FLOW');
        if (event.context?.isUserInitiated) labels.add('USER_CLICK_FLOW');
        if (!event.context?.isUserInitiated && ['xhr', 'fetch', 'beacon'].includes(String(event.type || '').toLowerCase())) {
            labels.add('BACKGROUND_ACTIVITY');
        }
        if (event.context?.isTracking) labels.add('PASSIVE_TRACKING');
        if (event.context?.isVideoElement) labels.add('MEDIA_STREAM');
        return Array.from(labels);
    },

    buildMediaStub(event = {}) {
        const normalizedUrl = String(event.url || '');
        const looksLikeMedia = /(\.m3u8|\.mp4|\.webm|\.ts|videoplayback|googlevideo|mime=video|mime=audio)/i.test(normalizedUrl);
        return {
            present: !!(event.context?.isVideoElement || looksLikeMedia),
            media_url: looksLikeMedia ? normalizedUrl : null,
            player_hint: event.context?.isVideoElement ? 'html5_video' : null,
            duration: null,
            autoplay: null,
            muted: null
        };
    },

    buildClassification(event = {}, decision = {}) {
        const entity = this.mapEntityType(event);
        return {
            entity: [entity],
            context: this.buildContextLabels(event),
            behaviors: [],
            media_roles: [],
            risk: RISK_MAP[decision.label_pred] ? [...RISK_MAP[decision.label_pred]] : [],
            confidence: Number.isFinite(decision.confidence) ? decision.confidence : 0,
            label_strength: 'weak'
        };
    },

    buildEventRecord({ event = {}, currentState = {}, decision = {} } = {}) {
        const now = Date.now();
        const mediaStub = this.buildMediaStub(event);
        const pageUrl = typeof window !== 'undefined' ? window.location?.href || null : null;
        const pageDomain = typeof window !== 'undefined' ? window.location?.hostname || null : null;

        return {
            record_type: 'event',
            schema_version: 'v1',
            identity: {
                event_id: decision.eventId || event.eventId || '',
                epoch: decision.epoch || event.epoch || 0,
                timestamp: decision.timestamp || event.timestamp || now,
                tab_instance_id: typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('__V_TAB_ID') : null,
                session_id: typeof window !== 'undefined' ? window.VanguardSessionId || null : null,
                page_url: pageUrl,
                page_domain: pageDomain,
                top_frame_domain: pageDomain
            },
            source: {
                sensor: 'xhr_radar',
                bridge: 'BrainBridge',
                pipeline: 'RuntimePipeline'
            },
            observation: {
                entity_type: this.mapEntityType(event),
                raw_url: event.rawUrl || event.url || null,
                normalized_url: event.url || null,
                domain: event.domain || null,
                method: event.method || null,
                phase: event.phase || null,
                status_code: Number.isFinite(event.responseStatus) ? event.responseStatus : null,
                response_size: Number.isFinite(event.responseSize) ? event.responseSize : null,
                resource_type: event.type || null,
                initiator_type: event.context?.tagName || null,
                frame_depth: null,
                visible: typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : null,
                raw_attributes: {
                    malformed: event.malformed || null,
                    extraction_error: event.extractionError || null
                },
                media_stub: mediaStub
            },
            context: {
                labels: this.buildContextLabels(event),
                interaction_id: event.interactionId || null,
                trusted_click: !!event.context?.isUserInitiated,
                visibility_state: typeof document !== 'undefined' ? document.visibilityState : null,
                has_active_video: typeof document !== 'undefined' ? !!document.querySelector('video') : false,
                page_mode: mediaStub.present ? 'video_page' : 'generic_page',
                workflow_id: null
            },
            user_signals: {
                trusted_site: null,
                blocked_site: null,
                learned_workflow: null,
                prior_user_decision: null,
                decision_source: null,
                user_feedback_strength: 0
            },
            correlations: {
                related_event_ids: [],
                related_request_ids: [event.requestId || null].filter(Boolean),
                related_domains: [],
                parent_entity_id: null,
                dom_node_ref: null,
                dom_selector_hash: null,
                initiator_chain: [],
                timing_window_ms: 0
            },
            classification: this.buildClassification(event, decision),
            decision: {
                action: decision.action || 'allow',
                reason: decision.decisionPath?.causalChain || decision.reason || decision.label_pred || null,
                confidence: Number.isFinite(decision.confidence) ? decision.confidence : 0,
                actor: 'system'
            },
            forensic: {
                trace: {
                    radar_ts: event.sensorTimestamp || null,
                    bridge_ts: event.trace?.bridge_ts || null,
                    orchestrator_ts: event.trace?.orchestrator_ts || event.trace?.pipeline_received_ts || null,
                    background_ts: null
                },
                valid: null,
                risk_flags: [],
                schema_hash: decision.schema_hash || null
            },
            extensions: {
                legacy: {
                    label_pred: decision.label_pred || null,
                    state_count: currentState?.count || 0,
                    decision_path: decision.decisionPath || null,
                    contributions: decision.contributions || {}
                },
                feature_vector: decision.raw_features || null,
                payload_analysis: event.payload_analysis || null,
                media_context: event.media_context || null,
                dom_context: event.context || {}
            }
        };
    },

    buildTelemetryPayload({ event = {}, currentState = {}, decision = {} } = {}) {
        const record = this.buildEventRecord({ event, currentState, decision });
        return {
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
            },
            record
        };
    }
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.shared = window.Engine.shared || {};
    window.Engine.shared.RecordFactory = RecordFactory;
}

if (typeof module !== 'undefined') {
    module.exports = RecordFactory;
}
