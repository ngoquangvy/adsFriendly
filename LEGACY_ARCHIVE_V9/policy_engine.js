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
        let calibratedScore = score;
        const domainClass = raw.domainClass || 'unknown';

        // Layer 1: Score calibration - Aggressive Unknown Shield
        if (domainClass === 'unknown') {
            calibratedScore = Math.min(calibratedScore * 0.5, 0.45);
        }

        // 1. Semantic Labeling
        let label = window.AdsFriendlyDecisionEngine.decide(calibratedScore);

        // 2. Action Determination
        let action = window.AdsFriendlyActionEngine.act(label, extraction, calibratedScore);

        // 🛡️ LAYER 2 SEMANTIC GUARD:
        // Combined with Layer 1, this ensures unidentified sources NEVER trigger TAG/BLOCK actions.
        // Even if strong regex patterns match in the path, confidence is limited for unknown domains.
        if (domainClass === 'unknown') {
            if (label === 'HIGH_RISK') label = 'SUSPICIOUS';
            if (action !== 'ALLOW') action = 'LOG';
        }

        // 3. Flag Synthesis
        const flags = [];
        if (extraction.context.isCDN) flags.push('CDN_MEDIA');
        if (extraction.context.trust > 0.5) flags.push('TRUSTED_SOURCE');
        if (domainClass === 'unknown') flags.push('UNKNOWN_SHIELD_ACTIVE');

        return {
            score: calibratedScore,
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

// End of file
