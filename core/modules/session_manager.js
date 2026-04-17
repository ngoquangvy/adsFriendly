// core/modules/session_manager.js
/**
 * AdsFriendly: Session Manager Module
 * Manages the full lifecycle of an ad session.
 * Requires mixin (via Object.assign before VideoSurgeon.init()):
 *   - dom_vision:          findSkipButton()
 *   - heuristics:          calculateAdScore()
 *   - danger_zone:         getDangerZoneInfo()
 *   - playback_control:    accelerate(), restore()
 *   - skip_engine:         autoSkip()
 *   - telemetry_sentinel:  diagnosticLog(), submitFinalTelemetry()
 */
window.AdsFriendlySessionManager = {
    startAdSession(video) {
        if (this.isAdSessionActive && this.trackedAdElement === video) return;

        if (this.isAdSessionActive) {
            this.endAdSession('Context switch to new ad element');
        }

        console.log('%c[AdsFriendly AI] Ad Session Started:', 'color: #10b981; font-weight: bold;', video.src || 'Dynamic Stream');

        this.isAdSessionActive = true;
        this.trackedAdElement = video;
        this.sessionStartTime = Date.now();
        this.activeSessionZone = this.getDangerZoneInfo(video);

        video.dataset.adsfriendlyAdActive = '1';
        video.dataset.adsfriendlyPrevMuted = video.muted ? '1' : '0';

        this.notifySpy(true);
        this.accelerate(video);

        if (this.adMonitorInterval) clearInterval(this.adMonitorInterval);
        this.adMonitorInterval = setInterval(() => this.monitorAdSession(), 200);
    },

    endAdSession(reason, drift = 0) {
        if (!this.isAdSessionActive) return;

        console.log(`%c[AdsFriendly AI] Ad Session Ended: ${reason}`, 'color: #f59e0b; font-weight: bold;');

        const video = this.trackedAdElement;
        const zone = this.activeSessionZone;
        
        this.submitFinalTelemetry(video, zone, reason, drift);

        this.isAdSessionActive = false;
        this.trackedAdElement = null;
        this.activeSessionZone = null;
        if (this.adMonitorInterval) {
            clearInterval(this.adMonitorInterval);
            this.adMonitorInterval = null;
        }

        this.notifySpy(false);
        if (this.overlay) this.overlay.style.display = 'none';

        if (video) {
            console.log('[AdsFriendly AI] Executing Stealth Handover for:', video.currentSrc || 'Dynamic Stream');
            this.restore(video);
            const markers = ['adsfriendlyAdActive', 'adsfriendlySpyTouched', 'adsfriendlyPrevMuted', 'accelerated', 'reportedContent'];
            markers.forEach(m => delete video.dataset[m]);

            if (video.paused) {
                video.play().catch(() => {
                    setTimeout(() => video.play().catch(() => {}), 100);
                });
            }
        }

        this.activeAds.clear();
        this.lastClickTime = 0;
    },

    monitorAdSession() {
        if (!this.isAdSessionActive || !this.trackedAdElement) return;

        const video = this.trackedAdElement;

        if (!document.contains(video)) {
            this.endAdSession('Element removed from DOM');
            return;
        }

        const player = video.closest('#movie_player, .html5-video-player, #preroll-player, [class*="jw-flag-ads"], [class*="ad-"]');
        const skipBtn = this.findSkipButton(player || document);

        const playerStateText = player ? `${player.id || ''} ${player.className || ''}`.toLowerCase() : '';
        const playerLooksLikeAd = /preroll|ad-showing|jw-flag-ads|ad-break|ad-/.test(playerStateText);

        let hasAdText = false;
        if (player) {
            hasAdText = /((skip|bỏ qua).*\d)|(\d.*(skip|bỏ qua))|skip|bỏ qua/i.test(player.innerText);
        }

        const isAdShowingNow = Boolean(skipBtn || playerLooksLikeAd || hasAdText);
        
        if (isAdShowingNow) {
            if (skipBtn) this.autoSkip(); 
            return;
        }

        const dangerZone = this.getDangerZoneInfo(video);
        if (!dangerZone) {
            if (this.calculateAdScore(video) >= 0.8 && video.duration < 65) {
                return;
            }
            if (Date.now() - this.sessionStartTime > 1000) {
                this.endAdSession('DOM and DangerZones agree: Ad is gone');
            }
        } else {
            const remaining = dangerZone.end - video.currentTime;
            if (remaining <= 2.0) {
                this.endAdSession(`DOM clear and DangerZone drift is low (${remaining.toFixed(1)}s)`, remaining);
            } else {
                console.log(`%c[AdsFriendly AI] SSAI Shield: DOM is clear but DangerZone remains (${remaining.toFixed(1)}s). Staying in Ad Mode.`, "color: #ef4444;");
            }
        }

        this.diagnosticLog(video);

        if (video.ended || video.currentTime >= (video.duration - 0.2)) {
            this.endAdSession('Ad video reached the end');
        }
    }
};
