// core/modules/score_engine.js
/**
 * Vanguard Citadel - Pure Math Score Engine (Phase 1)
 * CALCULATES ONLY. No business logic, no if/else branches.
 */
const AdsFriendlyScoreEngine = {
    /**
     * Calculates the final risk score using a weighted sum of input features.
     * @param {Object} features - The feature vector from SignalExtractor.
     * @param {Object} weights - The configuration weights.
     * @returns {number} The calculated score (sum of feature * weight).
     */
    calculate(features, weights) {
        let score = 0;
        for (const key in features) {
            if (weights[key] !== undefined) {
                score += features[key] * weights[key];
            }
        }
        return parseFloat(score.toFixed(4));
    }
};

if (typeof window !== 'undefined') {
    window.AdsFriendlyScoreEngine = AdsFriendlyScoreEngine;
}

export default AdsFriendlyScoreEngine;
