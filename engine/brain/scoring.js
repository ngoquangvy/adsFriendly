// engine/brain/scoring.js
/**
 * 🧪 Scoring Engine (Experimental)
 * Role: Transforms feature vectors into normalized probability scores.
 */
const Scoring = {
    compute(features, weights) {
        let score = 0;
        const net = features.v2.network;
        const ctx = features.context;
        
        // 1. BASE: Domain Classification (Weight: 0.3)
        let baseScore = 0;
        if (net.isAdDomain) baseScore = 0.85;
        else if (net.isTrackingDomain) baseScore = 0.6;
        else if (net.isMediaCDN) baseScore = 0.0;
        else baseScore = 0.1; // Default floor for UNKNOWN
        
        // 2. SEMANTIC: URL Keyword Analysis (Weight: 0.4)
        let semanticScore = net.hasAdKeywords ? 0.9 : 0.0;
        if (net.entropyScore > 0.4) semanticScore += 0.2; // Obfuscation boost
        
        // 3. CONTEXT: Structural Risk (Weight: 0.3)
        let contextScore = 0;
        if (net.isThirdParty) {
            if (ctx.isIframe) contextScore = 1.0; // High risk: Third-party iframe
            else if (ctx.isScript) contextScore = 0.8; // High risk: Third-party script
            else contextScore = 0.4; // Medium risk: Third-party images/xhr
        }

        // --- FINAL WEIGHTED SUM ---
        score = (baseScore * 0.3) + (Math.min(semanticScore, 1.0) * 0.4) + (contextScore * 0.3);
        
        // Safety Override: Protect known media contexts
        if (ctx.isPlayerContext && !net.isAdDomain) score *= 0.5;

        return Math.min(score, 1.0);
    }
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.brain = window.Engine.brain || {};
    window.Engine.brain.Scoring = Scoring;
}
