const EMPTY_TRACE = Object.freeze({
    radar_ts: null,
    bridge_ts: null,
    orchestrator_ts: null,
    background_ts: null
});

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function asNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function deriveFallbackRecord(payload, receivedAt) {
    const safePayload = asObject(payload);
    const data = asObject(safePayload.data);
    const identity = asObject(safePayload.identity);
    const pageDomain = asString(identity.site_domain || data.domain || 'unknown', 'unknown');

    return {
        record_type: 'event',
        schema_version: 'v1',
        identity: {
            event_id: asString(data.eventId, `legacy:${receivedAt}`),
            epoch: asNumber(data.epoch, 0),
            timestamp: asNumber(data.timestamp, receivedAt),
            tab_instance_id: null,
            session_id: asString(identity.session_id, ''),
            page_url: null,
            page_domain: pageDomain,
            top_frame_domain: pageDomain
        },
        source: {
            sensor: 'legacy',
            bridge: 'legacy',
            pipeline: 'legacy'
        },
        observation: {
            entity_type: asString(data.eventType, 'RESOURCE'),
            raw_url: data.url || null,
            normalized_url: data.url || null,
            domain: asString(data.domain || pageDomain, pageDomain),
            method: data.method || null,
            phase: null,
            status_code: null,
            response_size: null,
            resource_type: data.eventType || null,
            initiator_type: null,
            frame_depth: null,
            visible: null,
            raw_attributes: {},
            media_stub: {
                present: false,
                media_url: null,
                player_hint: null,
                duration: null,
                autoplay: null,
                muted: null
            }
        },
        context: {
            labels: [],
            interaction_id: null,
            trusted_click: false,
            visibility_state: null,
            has_active_video: false,
            page_mode: 'generic_page',
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
            related_request_ids: [],
            related_domains: [],
            parent_entity_id: null,
            dom_node_ref: null,
            dom_selector_hash: null,
            initiator_chain: [],
            timing_window_ms: 0
        },
        classification: {
            entity: [],
            context: [],
            behaviors: [],
            media_roles: [],
            risk: [],
            confidence: asNumber(data.confidence, 0),
            label_strength: 'legacy'
        },
        decision: {
            action: asString(data.action, 'allow'),
            reason: asString(data.reason || data.label_pred, 'legacy'),
            confidence: asNumber(data.confidence, 0),
            actor: 'system'
        },
        forensic: {
            trace: { ...EMPTY_TRACE },
            valid: false,
            risk_flags: ['LEGACY_RECONSTRUCTED'],
            schema_hash: null
        },
        extensions: {
            legacy: safePayload
        }
    };
}

function normalizeRecord(record, payload, receivedAt) {
    const safeRecord = Object.keys(asObject(record)).length > 0 ? asObject(record) : deriveFallbackRecord(payload, receivedAt);
    const riskFlags = new Set(asArray(safeRecord.forensic?.risk_flags));
    const recordType = asString(safeRecord.record_type, 'event');
    const identity = asObject(safeRecord.identity);
    const observation = asObject(safeRecord.observation);

    const normalized = {
        record_type: recordType || 'event',
        schema_version: asString(safeRecord.schema_version, 'v1') || 'v1',
        identity: {
            event_id: asString(identity.event_id, `${recordType}:${receivedAt}`),
            epoch: asNumber(identity.epoch, 0),
            timestamp: asNumber(identity.timestamp, receivedAt),
            tab_instance_id: identity.tab_instance_id ?? null,
            session_id: identity.session_id ?? null,
            page_url: identity.page_url ?? null,
            page_domain: identity.page_domain ?? observation.domain ?? 'unknown',
            top_frame_domain: identity.top_frame_domain ?? identity.page_domain ?? observation.domain ?? 'unknown'
        },
        source: {
            sensor: asString(safeRecord.source?.sensor, 'unknown'),
            bridge: asString(safeRecord.source?.bridge, 'unknown'),
            pipeline: asString(safeRecord.source?.pipeline, 'unknown')
        },
        observation: {
            entity_type: asString(observation.entity_type, 'RESOURCE'),
            raw_url: observation.raw_url ?? null,
            normalized_url: observation.normalized_url ?? observation.raw_url ?? null,
            domain: observation.domain ?? identity.page_domain ?? 'unknown',
            method: observation.method ?? null,
            phase: observation.phase ?? null,
            status_code: Number.isFinite(observation.status_code) ? observation.status_code : null,
            response_size: Number.isFinite(observation.response_size) ? observation.response_size : null,
            resource_type: observation.resource_type ?? null,
            initiator_type: observation.initiator_type ?? null,
            frame_depth: Number.isFinite(observation.frame_depth) ? observation.frame_depth : null,
            visible: typeof observation.visible === 'boolean' ? observation.visible : null,
            raw_attributes: asObject(observation.raw_attributes),
            media_stub: {
                present: !!observation.media_stub?.present,
                media_url: observation.media_stub?.media_url ?? null,
                player_hint: observation.media_stub?.player_hint ?? null,
                duration: Number.isFinite(observation.media_stub?.duration) ? observation.media_stub.duration : null,
                autoplay: typeof observation.media_stub?.autoplay === 'boolean' ? observation.media_stub.autoplay : null,
                muted: typeof observation.media_stub?.muted === 'boolean' ? observation.media_stub.muted : null
            }
        },
        context: {
            labels: asArray(safeRecord.context?.labels),
            interaction_id: safeRecord.context?.interaction_id ?? null,
            trusted_click: !!safeRecord.context?.trusted_click,
            visibility_state: safeRecord.context?.visibility_state ?? null,
            has_active_video: !!safeRecord.context?.has_active_video,
            page_mode: safeRecord.context?.page_mode ?? 'generic_page',
            workflow_id: safeRecord.context?.workflow_id ?? null
        },
        user_signals: {
            trusted_site: safeRecord.user_signals?.trusted_site ?? null,
            blocked_site: safeRecord.user_signals?.blocked_site ?? null,
            learned_workflow: safeRecord.user_signals?.learned_workflow ?? null,
            prior_user_decision: safeRecord.user_signals?.prior_user_decision ?? null,
            decision_source: safeRecord.user_signals?.decision_source ?? null,
            user_feedback_strength: asNumber(safeRecord.user_signals?.user_feedback_strength, 0)
        },
        correlations: {
            related_event_ids: asArray(safeRecord.correlations?.related_event_ids),
            related_request_ids: asArray(safeRecord.correlations?.related_request_ids),
            related_domains: asArray(safeRecord.correlations?.related_domains),
            parent_entity_id: safeRecord.correlations?.parent_entity_id ?? null,
            dom_node_ref: safeRecord.correlations?.dom_node_ref ?? null,
            dom_selector_hash: safeRecord.correlations?.dom_selector_hash ?? null,
            initiator_chain: asArray(safeRecord.correlations?.initiator_chain),
            timing_window_ms: asNumber(safeRecord.correlations?.timing_window_ms, 0)
        },
        classification: {
            entity: asArray(safeRecord.classification?.entity),
            context: asArray(safeRecord.classification?.context),
            behaviors: asArray(safeRecord.classification?.behaviors),
            media_roles: asArray(safeRecord.classification?.media_roles),
            risk: asArray(safeRecord.classification?.risk),
            confidence: asNumber(safeRecord.classification?.confidence, 0),
            label_strength: asString(safeRecord.classification?.label_strength, 'unknown')
        },
        decision: {
            action: asString(safeRecord.decision?.action, 'allow'),
            reason: safeRecord.decision?.reason ?? null,
            confidence: asNumber(safeRecord.decision?.confidence, 0),
            actor: asString(safeRecord.decision?.actor, 'system')
        },
        forensic: {
            trace: {
                ...EMPTY_TRACE,
                ...asObject(safeRecord.forensic?.trace)
            },
            valid: typeof safeRecord.forensic?.valid === 'boolean' ? safeRecord.forensic.valid : null,
            risk_flags: asArray(safeRecord.forensic?.risk_flags),
            schema_hash: safeRecord.forensic?.schema_hash ?? null
        },
        extensions: asObject(safeRecord.extensions)
    };

    if (!identity.event_id) riskFlags.add('MISSING_EVENT_ID');
    if (!Number.isFinite(identity.epoch) || identity.epoch <= 0) riskFlags.add('MISSING_EPOCH');
    if (!Number.isFinite(identity.timestamp) || identity.timestamp <= 0) riskFlags.add('MISSING_TIMESTAMP');
    if (!safeRecord.record_type) riskFlags.add('RECORD_REPAIRED');
    if (recordType === 'event' && !normalized.forensic.trace.background_ts) riskFlags.add('TRACE_BACKGROUND_MISSING');
    if (recordType === 'event' && !normalized.forensic.trace.bridge_ts) riskFlags.add('TRACE_BRIDGE_MISSING');

    normalized.forensic.risk_flags = Array.from(riskFlags);
    if (typeof normalized.forensic.valid !== 'boolean') {
        normalized.forensic.valid = !riskFlags.has('MISSING_EVENT_ID') && !riskFlags.has('MISSING_EPOCH') && !riskFlags.has('MISSING_TIMESTAMP');
    }

    return normalized;
}

function deriveMetaLayer(payload, record, receivedAt) {
    const safePayload = asObject(payload);
    const existing = asObject(safePayload.meta_layer);
    return {
        source: existing.source || record.source,
        context: existing.context || record.context,
        user_signals: existing.user_signals || record.user_signals,
        correlations: existing.correlations || record.correlations,
        forensic: existing.forensic || {
            trace: record.forensic.trace,
            valid: record.forensic.valid,
            risk_flags: record.forensic.risk_flags
        },
        knowledge_snapshot: existing.knowledge_snapshot || asObject(safePayload.knowledge_snapshot),
        ingest_received_at: receivedAt
    };
}

function deriveDecisionLayer(payload, record) {
    const safePayload = asObject(payload);
    const existing = asObject(safePayload.decision_layer);
    return {
        classification: existing.classification || record.classification,
        decision: existing.decision || record.decision,
        extensions: existing.extensions || {
            legacy: asObject(record.extensions?.legacy),
            background: asObject(record.extensions?.background)
        }
    };
}

const SchemaValidator = {
    normalizePayload(payload, meta = {}) {
        const receivedAt = asNumber(meta.receivedAt, Date.now());
        const safePayload = asObject(payload);
        const record = normalizeRecord(safePayload.record, safePayload, receivedAt);
        const metaLayer = deriveMetaLayer(safePayload, record, receivedAt);
        const decisionLayer = deriveDecisionLayer(safePayload, record);

        return {
            ...safePayload,
            type: asString(safePayload.type, 'UNKNOWN_TELEMETRY'),
            provider_type: asString(safePayload.provider_type || safePayload.identity?.provider_type, 'UNKNOWN'),
            identity: {
                site_domain: safePayload.identity?.site_domain || record.identity.page_domain || 'unknown',
                session_id: safePayload.identity?.session_id || record.identity.session_id || null,
                provider_type: asString(safePayload.provider_type || safePayload.identity?.provider_type, 'UNKNOWN')
            },
            data: asObject(safePayload.data),
            record,
            meta_layer: metaLayer,
            decision_layer: decisionLayer,
            ingest: {
                received_at: receivedAt,
                remote_address: meta.remoteAddress || null,
                schema_version: record.schema_version,
                structural_valid: record.forensic.valid
            },
            timestamp: asNumber(safePayload.timestamp, receivedAt)
        };
    }
};

module.exports = { SchemaValidator };
