function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function inferSubsystem(record = {}) {
    if (record.record_type === 'knowledge') return 'knowledge';

    const entityType = String(record.observation?.entity_type || '').toUpperCase();
    const labels = new Set(asArray(record.context?.labels));
    const mediaPresent = !!record.observation?.media_stub?.present;

    if (entityType === 'DOM_NODE' || entityType === 'POPUP' || entityType === 'IFRAME' || labels.has('USER_CLICK_FLOW')) {
        return 'interaction';
    }

    if (mediaPresent || entityType === 'MEDIA') {
        return 'media';
    }

    if (entityType === 'NAVIGATION') {
        return 'navigation';
    }

    if (entityType === 'SCRIPT' || entityType === 'XHR' || entityType === 'FETCH' || entityType === 'BEACON' || entityType === 'WEBSOCKET' || entityType === 'RESOURCE') {
        return 'network';
    }

    return 'generic';
}

function inferTruthTier(entry = {}) {
    const decisionActor = entry.record?.decision?.actor || 'system';
    const feedbackStrength = entry.record?.user_signals?.user_feedback_strength || 0;

    if (decisionActor === 'user' || decisionActor === 'user_rule' || decisionActor === 'user_explicit') {
        return 'human_confirmed';
    }

    if (feedbackStrength >= 0.8) {
        return 'human_signal';
    }

    if (entry.record?.forensic?.valid) {
        return 'system_verified';
    }

    return 'system_observed';
}

const LogRouter = {
    route(entry = {}) {
        const subsystem = inferSubsystem(entry.record || {});
        return {
            subsystem,
            record_type: entry.record?.record_type || 'event',
            truth_tier: inferTruthTier(entry),
            training_ready: !!entry.record?.forensic?.valid,
            labels_available: {
                entity: asArray(entry.record?.classification?.entity).length > 0,
                context: asArray(entry.record?.classification?.context).length > 0,
                behaviors: asArray(entry.record?.classification?.behaviors).length > 0,
                media_roles: asArray(entry.record?.classification?.media_roles).length > 0,
                risk: asArray(entry.record?.classification?.risk).length > 0,
                decision: !!entry.record?.decision?.action
            }
        };
    }
};

module.exports = { LogRouter };
