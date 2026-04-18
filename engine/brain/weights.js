// engine/brain/weights.js
/**
 * 🧪 Weights Configuration (Experimental)
 */
const Weights = {
    NETWORK_AD_SCORE: 0.8,
    DOM_AD_SCORE: 0.6,
    HEURISTIC_SCORE: 0.4
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.brain = window.Engine.brain || {};
    window.Engine.brain.Weights = Weights;
}
