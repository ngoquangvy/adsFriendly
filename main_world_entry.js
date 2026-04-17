/**
 * Vanguard v9 - Main World Entry Point
 * Bundles all core modules into a single IIFE.
 */

// 1. Core Modules (Main World context dependencies)
import './core/modules/proxy_shield.js';
import './core/modules/xhr_radar.js';
import './core/modules/dom_vision.js';
import './core/modules/heuristics.js';
import './core/modules/danger_zone.js';
import './core/modules/playback_control.js';
import './core/modules/skip_engine.js';

// 2. Adapters Layer
import './core/adapters/base_adapter.js';
import './core/adapters/hls_adapter.js';
import './core/adapters/jw_adapter.js';
import './core/adapters/youtube_adapter.js';
import './core/adapters/dash_adapter.js';
import './core/adapters/custom_adapter.js';

// 3. Engine Layer
import './core/ad_detection.js';
import './core/strategy_engine.js';

// 4. Injection Guard & Bridge
(function() {
    // 🛡️ ENVIRONMENT GUARD: Sandbox & Cross-Origin Check
    try {
        if (window.top !== window.self) {
            // Check for sandboxing (may throw if cross-origin)
            if (window.frameElement && window.frameElement.hasAttribute("sandbox")) return;
            
            // Check origin parity
            if (window.location.origin !== window.top.location.origin) return;
        }
    } catch (e) { return; }

    if (window.__vanguard_injected) return;
    window.__vanguard_injected = true;

    console.log("%c[Vanguard v9] Engine Core Injected successfully.", "color: #10b981; font-weight: bold;");

    // Lifecycle: Notify loader.js
    window.postMessage({
        type: "VANGUARD_READY",
        timestamp: Date.now(),
        version: "9.0.0"
    }, "*");

    // Auto-attach to existing videos if any
    document.querySelectorAll('video').forEach(v => {
        if (window.AdsFriendlyStrategyEngine) {
            window.AdsFriendlyStrategyEngine.attachToVideo(v);
        }
    });
})();
