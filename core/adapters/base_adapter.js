/**
 * AdsFriendly: BaseAdapter
 * Lớp cơ sở - định nghĩa API chung cho mọi adapter.
 * Các adapter con phải override: isAd(), attach(), detach()
 */
class BaseAdapter {
    constructor(video) {
        this.video = video;
        this._sensorCallback = null; // Sensor hook để báo cáo về strategy_engine
    }

    // ─── Playback API ───
    getCurrentTime() {
        return this.video?.currentTime ?? 0;
    }

    seek(time) {
        if (!this.video) return;
        this.video.currentTime = time;
    }

    setPlaybackRate(rate) {
        if (!this.video) return;
        this.video.playbackRate = rate;
    }

    getDuration() {
        return this.video?.duration ?? 0;
    }

    play() {
        return this.video?.play().catch(() => {});
    }

    pause() {
        this.video?.pause();
    }

    // ─── State API (Override in subclass) ───
    isAd() {
        return false;
    }

    getNextContentTime() {
        return null;
    }

    getState() {
        return {
            currentTime: this.getCurrentTime(),
            duration: this.getDuration(),
            playbackRate: this.video?.playbackRate ?? 1,
            isAd: this.isAd(),
            nextContentTime: this.getNextContentTime()
        };
    }

    // ─── Capabilities API (deeper — Strategy Engine + ExecutionGuard reads this) ───
    getCapabilities() {
        return {
            // Seek ability
            canSeek:          true,
            seekGranularity:  'fine',    // 'fine' | 'coarse' | 'none'
            seekCooldownMs:   500,       // Minimum ms between seeks

            // Rate change
            canRateChange:    true,
            rateMax:          16,        // Max safe playbackRate (2 | 4 | 16)
            rateCooldownMs:   800,       // Minimum ms between rate changes

            // Ad signals
            hasAdEvent:       false,     // Player fires native ad start/complete events
            hasAdSignal:      false,     // Any reliable ad signal available
            hasTimeline:      false,     // Has parsed ad timeline (HLS/DASH)
            hasNativeAPI:     false,     // Has native player JS API

            // Interaction
            supportsClickSim: true,      // Can simulate click events
            requiresTrusted:  false      // Site requires isTrusted = true
        };
    },

    // ─── Lifecycle Hooks ───
    attach() {
        // Override: listen to player-specific events
    }

    detach() {
        // Override: remove listeners, cleanup
    }

    // ─── Sensor Hook (gắn callback để báo về StrategyEngine) ───
    onSensorEvent(callback) {
        this._sensorCallback = callback;
    }

    _emit(eventType, detail = {}) {
        if (typeof this._sensorCallback === 'function') {
            this._sensorCallback({ type: eventType, adapter: this.constructor.name, ...detail });
        }
    }
}

// Export ra window để các adapter con kế thừa
window.AdsFriendlyBaseAdapter = BaseAdapter;
