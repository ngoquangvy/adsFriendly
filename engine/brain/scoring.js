// engine/brain/scoring.js
/**
 * 🧪 Scoring Engine (Experimental)
 * Role: Transforms feature vectors into normalized probability scores.
 */
const Scoring = {
    compute(features, weights) {
        let score = 0;
        const net = features.v2.network;
        
        if (net.isAdDomain) score += weights.NETWORK_AD_SCORE || 0.8;
        if (net.isTrackingDomain) score += weights.TELEMETRY_SCORE || 0.5;
        if (features.domainClass === 'internalTelemetry') score += 0.3;
        
        return Math.min(score, 1.0);
    }
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.brain = window.Engine.brain || {};
    window.Engine.brain.Scoring = Scoring;
}
