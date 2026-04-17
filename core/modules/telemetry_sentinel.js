// core/modules/telemetry_sentinel.js
window.AdsFriendlyTelemetrySentinel = {
    diagnosticLog(video) {
        this.diagnosticCounter = (this.diagnosticCounter || 0) + 1;
        if (this.diagnosticCounter % 5 !== 0) return;

        const dangerZone = this.getDangerZoneInfo(video);
        const player = video.closest('#movie_player, .html5-video-player, #preroll-player, [class*="jw-flag-ads"], [class*="ad-"]');
        const skipBtn = this.findSkipButton(player || document);
        const adScore = this.calculateAdScore(video);

        console.groupCollapsed(`%c[AdsFriendly Diagnostic] ${new Date().toLocaleTimeString()} - Trust: ${this.siteTrustScore.toFixed(2)}`, 'color: #8b5cf6;');
        console.log('--- NETWORK (Genome Map) ---');
        console.log('In Danger Zone:', dangerZone ? 'YES' : 'NO');
        if (dangerZone) console.log('Zone Info:', dangerZone);
        
        console.log('--- DOM (Computer Vision) ---');
        console.log('Skip Button Found:', skipBtn ? 'YES' : 'NO');
        console.log('Player Ad-Class detected:', !!player);
        
        console.log('--- LOGIC (Decision Matrix) ---');
        console.log('Heuristic Ad Score:', adScore.toFixed(2));
        console.log('Playback Rate:', video.playbackRate);
        console.log('Current Time:', video.currentTime.toFixed(2));
        console.log('Is definitely ad (Score >= 0.8):', adScore >= 0.8);
        console.groupEnd();
        
        try {
            navigator.sendBeacon('http://localhost:3000/telemetry', JSON.stringify({
                identity: { site_domain: window.location.hostname },
                type: 'DEBUG_LOG',
                data: { 
                    url: window.location.href, 
                    state: { 
                        msg: 'VideoSurgeon Diagnostic Matrix', 
                        payload: {
                            dangerZone: dangerZone,
                            skipBtn: !!skipBtn,
                            adClass: !!player,
                            adScore: adScore.toFixed(2),
                            playRate: video.playbackRate,
                            time: video.currentTime.toFixed(2)
                        } 
                    } 
                }
            }));
        } catch (e) {}
    },

    async notifyBrainOfAdState(video) {
        if (!chrome.runtime || !chrome.runtime.id) return;
        const playerContainer = video.closest('[class*="player"]');
        if (playerContainer) {
            try {
                chrome.runtime.sendMessage({
                    type: 'SYNC_VIDEO_LEARNING',
                    hostname: window.location.hostname,
                    classes: playerContainer.className,
                    duration: video.duration
                });
            } catch (e) { }
        }
    },

    submitFinalTelemetry(video, zone, reason, drift = 0) {
        if (!zone || !video) return;

        const exitTriggerMap = {
            'Ad video reached the end': 'ZONE_END',
            'DOM and DangerZones agree: Ad is gone': 'ZONE_END',
            'DOM clear and DangerZone drift is low': 'UI_DISAPPEAR',
            'Element removed from DOM': 'UI_DISAPPEAR'
        };

        let trigger = 'USER_MANUAL';
        for (const key in exitTriggerMap) {
            if (reason.includes(key)) {
                trigger = exitTriggerMap[key];
                break;
            }
        }

        const clockDrift = drift > 0 ? drift : (trigger === 'UI_DISAPPEAR' ? (video.currentTime - zone.end) : 0);
        const isSuccess = !reason.includes('Critical execution error') && trigger !== 'USER_MANUAL';

        const telemetryPayload = {
            type: 'AD_SESSION_RESULT',
            provider_type: 'JSON_DEEP_SCAN', 
            data: {
                features: {
                    dna_keys: zone.metadata?.dna_keys || [],
                    discovery_depth: zone.metadata?.discovery_depth || 0,
                    time_unit_detected: zone.metadata?.time_unit_detected || 'unknown',
                    initial_confidence: zone.confidence || 0
                },
                labels: {
                    is_success: isSuccess, 
                    exit_trigger: trigger,
                    clock_drift: parseFloat(clockDrift.toFixed(3))
                }
            }
        };

        if (typeof BrainBridge !== 'undefined') {
            BrainBridge.recordDecision({
                site: window.location.hostname,
                type: 'AD_RESULT',
                is_success: isSuccess,
                drift: parseFloat(clockDrift.toFixed(3)),
                reason: reason,
                features: telemetryPayload.data.features
            });
        }

        if (typeof APIGateway !== 'undefined') {
            APIGateway.submitTelemetry(telemetryPayload);
        }
    }
};
