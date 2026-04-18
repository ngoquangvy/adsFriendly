/**
 * Vanguard Loader (Content Script Context)
 * Injects the bundled engine into the Main World.
 * Role: Inject script into Main World + bootstrap engine
 */

(function () {
    // 1. Initialise Brain in Content Script context (Access to chrome.storage)
    if (typeof BrainBridge !== 'undefined' && BrainBridge.init) {
        BrainBridge.init().catch(console.error);
    }

    // 2. Injected Main World Bridge (for Extension ↔ Main World communication)
    window.addEventListener("message", (e) => {
        const data = e.data;
        if (!data || data.source !== 'adsfriendly-engine') return;

        // Route to BrainBridge or APIGateway
        switch (data.type) {
            case 'STRATEGY_DECISION':
                if (typeof BrainBridge !== 'undefined') {
                    BrainBridge.recordDecision({
                        site: data.site,
                        adType: data.adType,
                        final_confidence: data.confidence,
                        reasoning: { strategy: data.strategy, riskScore: data.riskScore }
                    });
                }
                break;
            case 'LEARN_MARKER_CONFIRM':
                if (typeof BrainBridge !== 'undefined') {
                    BrainBridge.confirmLearnedMarker(data.selector, data.site);
                }
                break;
            case 'LEARN_MARKER_PENALIZE':
                if (typeof BrainBridge !== 'undefined') {
                    BrainBridge.penalizeMarker(data.selector);
                }
                break;
            case 'SUBMIT_TELEMETRY':
                // 🚀 Forward telemetry from Main World → Background (Service Worker)
                try {
                    chrome.runtime.sendMessage({
                        type: 'PROXY_TELEMETRY',
                        payload: data.payload
                    });
                } catch (e) {
                    console.warn('[Loader] Telemetry tunnel failed:', e.message);
                }
                break;
            case 'VANGUARD_READY':
                console.log("%c[Vanguard Loader] Engine handshake received. Main World is active.", "color: #3b82f6;");
                break;
        }
    });

    // 2. Injection Logic (Optimized for MV3)
    function injectEngine() {
        if (document.querySelector('script[data-vanguard-engine]')) return;

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('dist/vanguard_main_world.js');
        script.dataset.vanguardEngine = "active";

        // Inject as early as possible
        (document.documentElement || document.head).appendChild(script);

        script.onload = () => {
            script.remove(); // Cleanup DOM footprint while keeping script running in main world
        };
    }

    // Zero-latency trigger
    injectEngine();
})();
