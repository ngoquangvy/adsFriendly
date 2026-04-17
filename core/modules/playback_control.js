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
        this.activeAds.add(video);
        this.notifyBrainOfAdState(video);

        // Notify spy to activate the Relativity Engine and hide DOM events
        this.notifySpy(true);

        // TODO: Vanguard - Show Ninja Overlay when Safe Harbor UI is ready
        // if (this.overlay) { ... }
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
        if (this.overlay) this.overlay.style.display = 'none';

        // 3. STOP Ad Mode in Spy (Main World context)
        this.activeAds.delete(video);
        this.notifySpy(false);
        this.lastClickTime = 0; // REFRESH: Ready for back-to-back ads

        // 4. Force playback resume (Double-tap for reliability)
        if (video.paused) {
            video.play().catch(() => { });
        }
    }
};
