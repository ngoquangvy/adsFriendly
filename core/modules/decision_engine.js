// core/modules/decision_engine.js
/**
 * Vanguard Citadel - Decision Engine (Phase 1.2)
 * PURE SEMANTIC LABELING: Maps raw score to system verdict.
 */
const AdsFriendlyDecisionEngine = {
    /**
     * Decides the semantic label based on numeric risk score.
     * @param {number} score - The numeric risk score.
     * @returns {string} The decision label (SAFE, SUSPICIOUS, HIGH_RISK).
     */
    decide(score) {
        if (score >= 0.6) return 'HIGH_RISK';
        if (score >= 0.3) return 'SUSPICIOUS';
        return 'SAFE';
    }
};

if (typeof window !== 'undefined') {
    window.AdsFriendlyDecisionEngine = AdsFriendlyDecisionEngine;
}

export default AdsFriendlyDecisionEngine;
