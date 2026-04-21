// engine/brain/scoring.js
/**
 * Vanguard Forensic Scoring Engine (v16.14 - Titan Final Edition)
 * Focus: Structural Schema Integrity & Mathematical Determinism.
 */

const RAW_SCHEMA = {
    STABLE: {
        weights: {
            cv_burst: 0.4,
            entropy_burst: 0.3,
            interaction_gap: 0.3,
            diversity: 0.3,
            reputation_scale: 1.2,
            ad_pattern: 0.4,
            iframe: 0.6,
            script: 0.4,
            script_unknown: 0.4,
            media_trust_multiplier: 0.1,
            media_trust_extended_multiplier: 0.2
        },
        logic_ratios: {
            stability: 0.35,
            strength: 0.35,
            sufficiency: 0.20,
            temporalConsistency: 0.10
        }
    },
    TUNING: {
        thresholds: {
            cv_trigger: 0.15,
            entropy_trigger: 0.6,
            interaction_gap_trigger: 10,
            diversity_trigger: 2,
            reputation_safe: 0.5,
            session_warmup: 4,
            media_session_warmup: 8,
            media_min_size: 100000,
            burst_critical: 5,
            stability_window: 5,
            stability_multiplier: 10,
            interaction_window: 5000
        },
        context_booster: {
            video: 0.05,
            interaction: 0.05
        }
    }
};

const Scoring = {
    calculateVariance(arr) {
        if (!arr || arr.length < 2) return 0;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
        return variance;
    },

    safeVariance(arr) {
        const v = this.calculateVariance(arr);
        const clamped = Math.min(v, 1000);
        return Math.max(clamped, 1);
    },

    compute(f, state, label_hints = {}, schemaOverride = null) {
        // Sử dụng schema override nếu có (trong replay), ngược lại dùng RAW_SCHEMA
        const S = schemaOverride || RAW_SCHEMA;
        const W = S.STABLE.weights;
        const T = S.TUNING.thresholds;
        const R = S.STABLE.logic_ratios;
        const C = S.TUNING.context_booster;

        // --- 0. SAFE ZONE (Probe Phase) ---
        let riskScore = 0;
        const now = Date.now();
        const currentUrl = typeof f.url === 'string' ? f.url.toLowerCase() : '';
        const isFragment = currentUrl.includes('.ts') ||
                           currentUrl.includes('chunk') ||
                           currentUrl.includes('frag') ||
                           currentUrl.includes('.m3u8') ||
                           currentUrl.includes('.mp4') ||
                           currentUrl.includes('videoplayback') ||
                           currentUrl.includes('mime=video') ||
                           currentUrl.includes('mime%3dvideo') ||
                           currentUrl.includes('mime=audio') ||
                           currentUrl.includes('mime%3daudio');

        const isTrustedMedia = f.isMedia &&
                               (f.type === 'xhr' || f.type === 'fetch') &&
                               (f.responseSize > T.media_min_size || (f.responseSize === -1 && isFragment)) &&
                               !f.isAdPattern;

        if (f.sessionCount <= T.session_warmup) {
            const warmupStructural = Math.min(
                (f.isAdPattern ? W.ad_pattern : 0) +
                (f.type === 'iframe' ? W.iframe : 0) +
                (f.type === 'script' ? W.script : 0) +
                ((f.type === 'script' && f.isUnknownDomain) ? W.script_unknown : 0),
                1
            );

            return {
            score: warmupStructural,
            confidence: isTrustedMedia ? 0.35 : (warmupStructural >= 0.6 ? 0.7 : warmupStructural >= 0.4 ? 0.45 : 0),
            contributions: { cv: 0, entropy: 0, interactionGap: 0, diversity: 0, structural: warmupStructural, mediaBackoff: isTrustedMedia ? 1 : 0 },
            metrics: { stability: 1, strength: 0, sufficiency: 0, temporalConsistency: 1, burst: 0, isTrustedMedia, boosterConfidence: 0 }
        };
        }

        // --- 1. WEAK SIGNAL SYNTHESIS (Forensic Tier) ---
        if (f.cv < T.cv_trigger) riskScore += W.cv_burst;
        if (f.entropy > T.entropy_trigger) riskScore += W.entropy_burst;
        if (f.interactionGap > T.interaction_gap_trigger && f.isUnknownDomain) riskScore += W.interaction_gap;
        if (f.typeDiversity > T.diversity_trigger) riskScore += W.diversity;

        // --- 2. REPUTATION CONSISTENCY ---
        if (f.reputation > T.reputation_safe) riskScore *= W.reputation_scale;

        // --- 3. STRUCTURAL SIGNALS ---
        if (f.isAdPattern) riskScore += W.ad_pattern;
        if (f.type === 'iframe') riskScore += W.iframe;
        if (f.type === 'script') {
            riskScore += W.script;
            if (f.isUnknownDomain) riskScore += W.script_unknown;
        }

        // --- 4. HARDENED MEDIA TRUST (Aligned) ---
        if (isTrustedMedia) {
            riskScore *= W.media_trust_multiplier;
            if (f.sessionCount > T.media_session_warmup) riskScore *= W.media_trust_extended_multiplier;
        }

        riskScore = Math.min(Math.max(riskScore, 0), 1.0);

        // --- 5. ADAPTIVE ANALYTICS ---
        const stability = 1 - Math.min(this.calculateVariance(state.scoreWindow.slice(-T.stability_window)) * T.stability_multiplier, 1);
        let typeWeight = 1.0;
        if (f.type === 'script') typeWeight = 1.4;
        else if (f.type === 'iframe') typeWeight = 1.5;

        const stabilityEffective = stability * (1 - riskScore) * typeWeight;
        
        const elapsed = (now - state.startTime) / 1000;
        const burstScore = state.count / Math.max(elapsed, 1);
        const shortDecay = Math.exp(-elapsed / 30);
        const longDecay = Math.exp(-elapsed / 300);
        const burstEffective = burstScore * (0.2 * longDecay + 0.8 * shortDecay);
        
        const baseStrength = (f.isAdPattern || f.isMedia ? 0.5 : 0) + 
                             ((f.type === 'iframe' || f.type === 'script') && riskScore > 0.6 ? 0.3 : 0);
        const strengthEffective = baseStrength + (burstEffective > T.burst_critical ? 0.2 : 0);
        
        const sufficiency = Math.min(f.sessionCount / 5, 1);
        const tVariance = this.safeVariance(state.intervalWindow);
        const temporalConsistency = 1 / (1 + Math.log(1 + tVariance));

        let confidence = (R.stability * stabilityEffective) + 
                         (R.strength * Math.min(strengthEffective, 1)) + 
                         (R.sufficiency * sufficiency) + 
                         (R.temporalConsistency * temporalConsistency);

        // --- 6. ALIGNED CONTEXT BOOSTER ---
        let boosterConfidence = 0;
        if (label_hints.isVideoPlaying && isTrustedMedia) {
            boosterConfidence += C.video;
        }
        if (label_hints.userInteracted && (isTrustedMedia || riskScore < 0.3)) {
            boosterConfidence += C.interaction;
        }

        const finalConfidence = Math.min(Math.max(confidence + boosterConfidence, 0), 1.0);

        return {
            score: riskScore,
            confidence: finalConfidence,
            contributions: {
                cv: f.cv < T.cv_trigger ? W.cv_burst : 0,
                entropy: f.entropy > T.entropy_trigger ? W.entropy_burst : 0,
                interactionGap: (f.interactionGap > T.interaction_gap_trigger && f.isUnknownDomain) ? W.interaction_gap : 0,
                diversity: f.typeDiversity > T.diversity_trigger ? W.diversity : 0,
                structural: (f.isAdPattern ? W.ad_pattern : 0) + (f.type === 'iframe' ? W.iframe : 0) + (f.type === 'script' ? W.script : 0),
                mediaBackoff: isTrustedMedia ? (riskScore * (1 - W.media_trust_multiplier)) : 0
            },
            metrics: {
                stability: stabilityEffective,
                strength: strengthEffective,
                sufficiency,
                temporalConsistency,
                burst: burstEffective,
                isTrustedMedia,
                boosterConfidence
            }
        };
    }
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.brain = window.Engine.brain || {};
    window.Engine.brain.Scoring = Scoring;
    window.Engine.brain.RAW_SCHEMA = RAW_SCHEMA;
}
