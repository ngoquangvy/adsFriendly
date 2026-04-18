// core/config/weights.js
/**
 * Vanguard Citadel - Scoring Weights Config (Phase 1)
 * Decouples feature values from their impact on final decision making.
 */
const SIGNAL_WEIGHTS = {
    adsLikelihood: 0.6,
    telemetryScore: 0.3,
    internalStatsScore: 0.05,
    isShortBurst: 0.1
};

if (typeof window !== 'undefined') {
    window.AdsFriendlyWeights = SIGNAL_WEIGHTS;
}
