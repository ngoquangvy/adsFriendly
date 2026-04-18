/**
 * AdsFriendly: Playback Control Module
 * Handles video acceleration (16x) and restoration (1x).
 * Requires mixin: (none - standalone)
 */
window.AdsFriendlyPlaybackControl = {
    accelerate(video) {
        if (video.playbackRate >= 16) return;

        console.log('[AdsFriendly Video] Neutralizing Ad with Relativity Spoofer:', video.src || 'Dynamic Stream');
        video.dataset.adsfriendlyAdActive = '1';
        video.dataset.adsfriendlyPrevMuted = video.muted ? '1' : '0';
        video.playbackRate = 16;
        video.muted = true;

        if (typeof AdsFriendlySessionManager !== 'undefined' && AdsFriendlySessionManager.activeAds instanceof Set) {
            AdsFriendlySessionManager.activeAds.add(video);
        }

        if (typeof AdsFriendlyTelemetrySentinel !== 'undefined') {
            AdsFriendlyTelemetrySentinel.notifyBrainOfAdState(video);
        }

        // Notify spy to activate the Relativity Engine and hide DOM events
        if (typeof VideoSurgeon !== 'undefined') VideoSurgeon.notifySpy(true);
    },

    restore(video) {
        // v3.8: High-Precision Stealth Handover
        // Phục hồi playbackRate = 1.0 và muted/volume về trạng thái trước khi Ad xuất hiện.
        
        // 1. Reset speed and audio locally
        video.playbackRate = 1.0;
        
        if (video.dataset.adsfriendlyPrevMuted) {
            video.muted = video.dataset.adsfriendlyPrevMuted === '1';
        }

        // 2. Hide Overlay
        if (typeof AdsFriendlyDomVision !== 'undefined' && AdsFriendlyDomVision.overlay) {
            AdsFriendlyDomVision.overlay.style.display = 'none';
        }

        // 3. STOP Ad Mode in Spy (Main World context)
        if (typeof AdsFriendlySessionManager !== 'undefined' && AdsFriendlySessionManager.activeAds instanceof Set) {
            AdsFriendlySessionManager.activeAds.delete(video);
        }

        if (typeof VideoSurgeon !== 'undefined') VideoSurgeon.notifySpy(false);
        
        if (typeof AdsFriendlySkipEngine !== 'undefined') {
            AdsFriendlySkipEngine.lastClickTime = 0; // REFRESH: Ready for back-to-back ads
        }

        // 4. Force playback resume (Double-tap for reliability)
        if (video.paused) {
            video.play().catch(() => { });
        }
    }
};
