/**
 * Vanguard v2.13.0 - Pure Engine Entry Point
 * Consolidates all modern modules into a single unified bundle.
 * NO LEGACY DEPENDENCIES.
 */

// 1. Foundation Layer (Messaging Tunnel)
import './core/api_gateway.js';
import './core/BrainBridge.js';

// 2. Intelligence Layer (Brain)
import './engine/brain/classifier.js';
import './engine/brain/weights.js';
import './engine/brain/extractor.js';
import './engine/brain/scoring.js';

// 3. Authority Layer (Policy)
import './engine/policy/runner.js';

// 4. Orchestration Layer (Hub)
import './engine/hub/orchestrator.js';

// 5. Sensor Layer (Radar Hook)
import './core/modules/xhr_radar.js';

// 🚀 INITIALIZATION GUARD
(function () {
    try {
        if (window.__VANGUARD_CORE_ACTIVE__) return;
        
        // Environment Check (Security)
        if (window.top !== window.self) {
            if (window.frameElement && window.frameElement.hasAttribute("sandbox")) return;
        }

        window.__VANGUARD_CORE_ACTIVE__ = true;
        
        console.log("%c[Vanguard v2.13.0] Pure Engine Initialized successfully.", "color: #3b82f6; font-weight: bold;");

        // Notify session
        window.VanguardSessionId = Math.random().toString(36).substring(2, 15);

        // Lifecycle: Notify loader.js
        window.postMessage({
            type: "VANGUARD_READY",
            version: "2.13.0",
            timestamp: Date.now()
        }, "*");

    } catch (e) {
        console.error('[Vanguard] Startup Failure:', e);
    }
})();
