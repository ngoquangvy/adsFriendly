// core/modules/action_engine.js
/**
 * Vanguard Citadel - Action Engine (Phase 1.2)
 * PURE BEHAVIORAL DETERMINATION: Maps verdict + context to system response.
 */
const AdsFriendlyActionEngine = {
    /**
     * Determines the final system action based on label priority and context.
     * @param {string} label - The decision from DecisionEngine.
     * @param {Object} extraction - The full extraction (features + context).
     * @param {number} score - Raw risk score.
     * @returns {string} The action (ALLOW, TAG, LOG, BLOCK).
     */
    act(label, extraction, score) {
        const { context } = extraction;

        // 🛡️ Rule 1: HIGH_RISK verdict is IMMUTABLE (NEVER override)
        if (label === 'HIGH_RISK') {
            return 'TAG';
        }

        // 🛡️ Rule 2: CDN Context Override
        // Only applies if the score is below the high-risk threshold (0.6)
        if (context.isCDN && score < 0.6) {
            return 'ALLOW';
        }

        // 🛡️ Default Hierarchy
        if (label === 'SUSPICIOUS') return 'LOG';
        
        return 'ALLOW';
    }
};

if (typeof window !== 'undefined') {
    window.AdsFriendlyActionEngine = AdsFriendlyActionEngine;
}

export default AdsFriendlyActionEngine;
