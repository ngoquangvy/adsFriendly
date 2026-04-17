/**
 * AdsFriendly: Custom Player Adapter (Generic Fallback)
 * Dùng khi không detect được player type cụ thể.
 * Dựa hoàn toàn vào:
 *   - DOM class patterns (ad-showing, preroll, jw-flag-ads...)
 *   - Heuristics từ heuristics.js (calculateAdScore)
 *   - DangerZone map từ xhr_radar.js
 * Sensor: báo cáo confidence thấp, cần human confirm.
 */
class CustomPlayerAdapter extends window.AdsFriendlyBaseAdapter {
    constructor(video) {
        super(video);
        this._domObserver = null;
        this._lastAdScore = 0;
    }

    attach() {
        // Quan sát thay đổi DOM xung quanh player
        const player = this.video.closest(
            '[class*="player"], [id*="player"], [class*="ad"], #movie_player'
        );

        if (player) {
            this._domObserver = new MutationObserver(() => this._onPlayerChange(player));
            this._domObserver.observe(player, { attributes: true, childList: true, subtree: true });
        }

        // Quan sát thay đổi src của video
        const srcObserver = new MutationObserver(() => {
            this._emit('CUSTOM_VIDEO_SRC_CHANGED', { src: this.video.currentSrc });
        });
        srcObserver.observe(this.video, { attributes: true, attributeFilter: ['src'] });

        this._emit('CUSTOM_ADAPTER_ATTACHED', {
            hasPlayer: !!player,
            playerClass: player?.className ?? 'none'
        });
    }

    detach() {
        this._domObserver?.disconnect();
        this._domObserver = null;
    }

    _onPlayerChange(player) {
        const txt = `${player.id} ${player.className}`.toLowerCase();
        const hasAdSignal = /preroll|ad-showing|jw-flag-ads|ad-break|advertising/.test(txt);
        if (hasAdSignal) {
            this._emit('CUSTOM_AD_CLASS_DETECTED', { text: txt });
        }
    }

    // ─── State (Heuristic-based) ───
    isAd() {
        const video = this.video;
        if (!video) return false;

        // Signal 1: DOM class
        const player = video.closest('[class*="player"], [id*="player"]');
        if (player) {
            const classText = `${player.id} ${player.className}`.toLowerCase();
            if (/preroll|ad-showing|jw-flag-ads|ad-break/.test(classText)) return true;
        }

        // Signal 2: Video duration (ngắn < 65s = đáng ngờ)
        const isShort = video.duration > 0 && video.duration < 65;
        // Signal 3: External src
        const isExternal = video.currentSrc
            && !video.currentSrc.startsWith('blob:')
            && !video.currentSrc.includes(window.location.hostname);

        return isShort && isExternal;
    }

    getNextContentTime() {
        // Custom player không biết timeline chính xác
        // Trả về duration (end of ad) như một safe fallback
        if (this.isAd() && this.getDuration() > 0) {
            return this.getDuration();
        }
        return null;
    }
}

window.AdsFriendlyCustomPlayerAdapter = CustomPlayerAdapter;
