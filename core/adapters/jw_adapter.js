/**
 * AdsFriendly: JW Player Adapter
 * Hook vào JW Player API native thay vì can thiệp vào video element.
 * Sensor: báo cáo adStart, adComplete, adSkipped, seekBlocked.
 */
class JWPlayerAdapter extends window.AdsFriendlyBaseAdapter {
    constructor(playerInstance) {
        super(null); // JW Player quản lý video element nội bộ
        this.player = playerInstance;
        this._isAd = false;
        this._adMeta = null;
        this._listeners = [];
    }

    getCapabilities() {
        return {
            canSeek: true,
            canRateChange: typeof this.player.setPlaybackRate === 'function',
            hasAdEvent: true,    // JW natively fires adStarted / adComplete
            hasTimeline: false,
            hasNativeAPI: true
        };
    }

    attach() {
        // Lấy video element thực từ JW Player container
        try {
            const container = this.player.getContainer?.();
            this.video = container?.querySelector('video') ?? null;
        } catch (e) {}

        // Đăng ký JW Player events
        this._on('adStarted', (e) => {
            this._isAd = true;
            this._adMeta = e;
            this._emit('JW_AD_STARTED', { tag: e?.tag, client: e?.client });
        });

        this._on('adComplete', (e) => {
            this._isAd = false;
            this._adMeta = null;
            this._emit('JW_AD_COMPLETE');
        });

        this._on('adSkipped', () => {
            this._isAd = false;
            this._emit('JW_AD_SKIPPED');
        });

        this._on('adError', (e) => {
            // Sensor: lỗi ad - có thể đây là trang đang dùng fallback
            this._emit('JW_AD_ERROR', { code: e?.code, message: e?.message });
        });

        // Phát hiện seek bị chặn bởi JW
        this._on('seek', (e) => {
            if (this._isAd) {
                this._emit('JW_SEEK_DURING_AD', { offset: e?.offset });
            }
        });

        this._emit('JW_ADAPTER_ATTACHED', { version: this.player.version });
    }

    detach() {
        // Remove tất cả listener đã đăng ký
        this._listeners.forEach(({ event, fn }) => {
            try { this.player.off(event, fn); } catch (e) {}
        });
        this._listeners = [];
        this._isAd = false;
    }

    // ─── Playback API (override sang JW native) ───
    getCurrentTime() {
        try { return this.player.getPosition?.() ?? 0; } catch { return 0; }
    }

    seek(time) {
        try { this.player.seek?.(time); } catch (e) {
            this._emit('JW_SEEK_FAILED', { time, error: e.message });
        }
    }

    getDuration() {
        try { return this.player.getDuration?.() ?? 0; } catch { return 0; }
    }

    setPlaybackRate(rate) {
        try { this.player.setPlaybackRate?.(rate); } catch (e) {
            // JW Player đôi khi không expose setPlaybackRate → fallback sang video element
            if (this.video) this.video.playbackRate = rate;
        }
    }

    // ─── State ───
    isAd() {
        return this._isAd;
    }

    getState() {
        return {
            ...super.getState(),
            jwState: this.player.getState?.(),
            adMeta: this._adMeta
        };
    }

    // ─── Helper: đăng ký event với cleanup tracking ───
    _on(event, fn) {
        try {
            this.player.on(event, fn);
            this._listeners.push({ event, fn });
        } catch (e) {}
    }
}

window.AdsFriendlyJWPlayerAdapter = JWPlayerAdapter;
