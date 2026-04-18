/**
 * AdsFriendly: Evaluator (v4.1)
 * The Decision Matrix engine. Separates complex evaluation logic from implementation.
 */
const NeuralEvaluator = {
    // SENSORS
    
    // 1. DOM Sensor: Highest fidelity for known buttons/classes
    evaluateDOM(player, skipButton) {
        let score = 0;
        let reasons = [];

        // Check for confirmed YouTube markers
        if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
            score += 0.9;
            reasons.push('Detected YouTube Ad-showing container classes.');
        }

        // Check for Skip Button
        if (skipButton) {
            score += 0.5;
            const opacity = parseFloat(getComputedStyle(skipButton).opacity);
            if (opacity === 1) {
                score += 0.4;
                reasons.push('Skip button is fully opaque (Ready).');
            } else {
                reasons.push(`Skip button exists but opacity is ${opacity} (Not Ready).`);
            }
        }

        return { score: Math.min(1.0, score), reasons };
    },

    // 2. Behavior Sensor: Monitors performance and playback fighting
    evaluateBehavior(video, siteTrust) {
        let score = 0;
        let reasons = [];

        // If video is short but site trust is medium-low
        if (video.duration > 0 && video.duration < 65 && siteTrust < 0.7) {
            score += 0.3;
            reasons.push('Short video duration on non-premium site.');
        }

        return { score, reasons };
    },

    // 3. Stream Sensor (Future: Manifest check)
    evaluateStream() {
        return { score: 0, reasons: ['Stream manifest analysis currently offline (v4.1) Vietnam server.'] };
    },

    // THE ARBITER
    arbitrate(domResults, behaviorResults, streamResults) {
        // Weighted average / Logic fusion
        // DOM has the highest weight if confidence is high
        let finalScore = domResults.score;
        
        // If DOM is unsure, boost with behavior if behavior is suspicious
        if (finalScore < 0.8 && behaviorResults.score > 0.3) {
            finalScore += behaviorResults.score * 0.5;
        }

        return {
            confidence: Math.min(1.0, finalScore),
            summary: domResults.reasons.concat(behaviorResults.reasons).concat(streamResults.reasons)
        };
    }
};

if (typeof window === 'undefined') {
    module.exports = NeuralEvaluator;
}
