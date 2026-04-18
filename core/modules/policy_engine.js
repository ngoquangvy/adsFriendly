// core/modules/policy_engine.js
/**
 * Vanguard Citadel - Policy Engine (Phase 1.2 Orchestrator)
 * Intelligence layer: Orchestrates Decider + Actor.
 */
const AdsFriendlyPolicyEngine = {
    /**
     * Composes the final policy result.
     * @param {Object} raw - Normalized network data.
     * @param {Object} extraction - Features + Context from SignalExtractor.
     * @param {number} score - Raw risk score.
     * @returns {Object} Final result: { score, label, action, flags, dna }
     */
    evaluate(raw, extraction, score) {
        // 1. Semantic Labeling
        const label = window.AdsFriendlyDecisionEngine.decide(score);

        // 2. Action Determination
        const action = window.AdsFriendlyActionEngine.act(label, extraction, score);

        // 3. Flag Synthesis
        const flags = [];
        if (extraction.context.isCDN) flags.push('CDN_MEDIA');
        if (extraction.context.trust > 0.5) flags.push('TRUSTED_SOURCE');

        return {
            score,
            label,
            action,
            flags,
            dna: extraction.features
        };
    }
};

if (typeof window !== 'undefined') {
    window.AdsFriendlyPolicyEngine = AdsFriendlyPolicyEngine;
}

export default AdsFriendlyPolicyEngine;
