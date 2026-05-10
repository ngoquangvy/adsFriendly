function asArray(value) {
    return Array.isArray(value) ? value : [];
}

const FeatureBuilder = {
    buildTrainingEnvelope(entry = {}) {
        const record = entry.record || {};
        return {
            identity: record.identity || {},
            subsystem: entry.routing?.subsystem || 'generic',
            observation: record.observation || {},
            meta_layer: entry.meta_layer || {},
            decision_layer: entry.decision_layer || {},
            labels: {
                entity: asArray(record.classification?.entity),
                context: asArray(record.classification?.context),
                behaviors: asArray(record.classification?.behaviors),
                media_roles: asArray(record.classification?.media_roles),
                risk: asArray(record.classification?.risk)
            },
            policy: {
                action: record.decision?.action || 'allow',
                reason: record.decision?.reason || null,
                actor: record.decision?.actor || 'system'
            },
            truth: {
                tier: entry.routing?.truth_tier || 'system_observed',
                structurally_valid: !!record.forensic?.valid,
                risk_flags: asArray(record.forensic?.risk_flags)
            }
        };
    }
};

module.exports = { FeatureBuilder };
