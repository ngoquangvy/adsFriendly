// engine/policy/runner.js
/**
 * ⚖️ Decision Layer (Versioned Rules)
 * Maps scores and contexts to specific actions based on active policy.
 */
const Runner = {
    evaluate(score, context) {
        const { domainClass, pattern, patternScore, burstDetected } = context;
        
        // --- 1. TECHNICAL HARD RULES (Bypass) ---
        if (domainClass === 'media_cdn') {
            return {
                score: 0, confidence: 1.0, label: 'SAFE', action: 'ALLOW',
                flags: ['MEDIA_SAFETY_BYPASS']
            };
        }

        // --- 2. BUSINESS HARD RULES (Boost) ---
        if (domainClass === 'ads_network') {
            const boostRes = {
                score: parseFloat(score.toFixed(2)),
                confidence: 0.9,
                label: 'HIGH_RISK',
                action: 'TAG',
                flags: ['DOMAIN_AWARENESS_BOOST']
            };
            console.log('[Runner] Boost Match:', { score, domainClass, label: 'HIGH_RISK' });
            return boostRes;
        }

        // --- 3. AI / BEHAVIORAL DECISION ---
        let confidence = score;
        if (domainClass === 'unknown') confidence = Math.min(confidence * 0.5, 0.45);

        let label = 'SAFE';
        let action = 'ALLOW';
        const flags = [];

        // (A) Suspicious Patterns
        if (confidence > 0.6 && pattern.count >= 3 && (pattern.lastSeen - pattern.firstSeen) < 5000) {
            label = 'SUSPICIOUS';
            action = 'TAG'; 
            flags.push('SOFT_BURST_DETECTED');
        }

        // (B) Unknown Safety Override
        if (domainClass === 'unknown' && label === 'HIGH_RISK') {
            label = 'SUSPICIOUS';
            action = 'LOG';
            flags.push('UNKNOWN_SAFETY_OVERRIDE');
        }

        const finalResult = {
            score: parseFloat(score.toFixed(2)),
            confidence: parseFloat(confidence.toFixed(2)),
            label,
            action,
            flags
        };

        console.log('[Runner] Evaluation:', { score, domainClass, label: finalResult.label });
        return finalResult;
    }
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.policy = window.Engine.policy || {};
    window.Engine.policy.Runner = Runner;
}
