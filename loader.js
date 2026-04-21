/**
 * Vanguard Loader (Content Script Context)
 * Injects the bundled engine into the Main World.
 * Role: Inject script into Main World + bootstrap engine
 */

(function () {
    const BRIDGE_SOURCE_ENGINE = 'adsfriendly-engine';
    const BRIDGE_SOURCE_BACKGROUND = 'adsfriendly-background';

    // 1. Initialise Brain in Content Script context (Access to chrome.storage)
    if (typeof BrainBridge !== 'undefined' && BrainBridge.init) {
        BrainBridge.init().catch(console.error);
    }

    /**
     * v16.14 TITAN MESSAGING RESILIENCE
     * Handles shaky extension connections with retry logic and lastError guards.
     */
    async function safeSend(message, retry = 3) {
        for (let i = 0; i < retry; i++) {
            try {
                if (!chrome.runtime?.id) return null;
                return await new Promise((resolve) => {
                    chrome.runtime.sendMessage(message, (response) => {
                        if (chrome.runtime.lastError) {
                            if (i === retry - 1) {
                                console.warn(`[Vanguard] Message failed after ${retry} attempts:`, chrome.runtime.lastError.message);
                            }
                            resolve(null);
                        } else {
                            resolve(response);
                        }
                    });
                });
            } catch (e) {
                if (i === retry - 1) console.error('[Vanguard] Critical safeSend Error:', e);
            }
            if (i < retry - 1) await new Promise((r) => setTimeout(r, 100 * (i + 1)));
        }
        return null;
    }

    function postToPage(message) {
        window.postMessage(message, '*');
    }

    // 2. Injected Main World Bridge (for Extension <-> Main World communication)
    window.addEventListener('message', async (e) => {
        const data = e.data;
        if (!data || data.source !== BRIDGE_SOURCE_ENGINE) return;

        switch (data.type) {
            case 'INITIAL_HANDSHAKE':
                safeSend({ type: 'INITIAL_HANDSHAKE' });
                break;
            case 'FORENSIC_MEMORY_FETCH': {
                const fetchRes = await safeSend({
                    type: 'FORENSIC_MEMORY_FETCH',
                    domain: data.domain,
                    instanceId: data.instanceId
                });
                postToPage({ type: 'FORENSIC_MEMORY_RESPONSE', state: fetchRes?.state || null, requestId: data.requestId });
                break;
            }
            case 'FORENSIC_MEMORY_COMMIT':
                safeSend({
                    type: 'FORENSIC_MEMORY_COMMIT',
                    update: data.update,
                    epoch: data.epoch
                });
                break;
            case 'FORENSIC_MEMORY_BATCH':
                safeSend({ type: 'FORENSIC_MEMORY_BATCH', batch: data.batch });
                break;
            case 'ACK_EPOCH_SYNC':
                safeSend({
                    type: 'ACK_EPOCH_SYNC',
                    epoch: data.epoch,
                    engine_v: data.engine_v,
                    schema_hash: data.schema_hash,
                    tabId: data.tabId
                });
                break;
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
                safeSend({ type: 'PROXY_TELEMETRY', payload: data.payload });
                break;
            case 'VANGUARD_READY':
                console.log('%c[Vanguard Loader] Engine handshake received. Main World is active.', 'color: #3b82f6;');
                break;
        }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || message.source !== BRIDGE_SOURCE_BACKGROUND) return false;

        if (message.type === 'EPOCH_UPDATE') {
            postToPage(message);
            sendResponse({ status: 'forwarded' });
        }

        return false;
    });

    // 3. Injection Logic (Optimized for MV3)
    function injectEngine() {
        if (!chrome.runtime?.id) return;
        if (document.querySelector('script[data-vanguard-engine]')) return;

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('dist/vanguard_main_world.js');
        script.dataset.vanguardEngine = 'active';

        (document.documentElement || document.head).appendChild(script);

        script.onload = () => {
            script.remove();
        };
    }

    injectEngine();
})();
