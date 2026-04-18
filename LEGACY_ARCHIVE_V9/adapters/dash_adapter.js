/**
 * AdsFriendly: MPEG-DASH Adapter (Skeleton)
 * Dùng cho các trang stream DASH (.mpd): VTV Go, FPT Play, Loklok...
 * Sensor: detect MPD manifest, report ad period.
 * TODO: Full implementation khi có trang cụ thể cần xử lý.
 */
class DASHAdapter extends window.AdsFriendlyBaseAdapter {
    constructor(video) {
        super(video);
        this._dashInstance = null; // dash.js player instance
        this._adPeriods = [];      // [{start, end}] từ MPD manifest
    }

    attach() {
        // Detect dash.js instance
        try {
            this._dashInstance = this._detectDashJsInstance();
        } catch (e) {}

        if (this._dashInstance) {
            this._attachViaDashJs();
        } else {
            // Fallback: parse MPD từ src
            this._parseFromMPD();
        }
    }

    detach() {
        this._dashInstance = null;
        this._adPeriods = [];
    }

    _detectDashJsInstance() {
        // dash.js thường lưu instance trên window hoặc video element
        return window.dashjs?.MediaPlayer?.instances?.[0]
            || this.video._dash
            || null;
    }

    _attachViaDashJs() {
        const dash = this._dashInstance;

        try {
            // dash.js event: AD period detection
            dash.on?.('playbackStarted', () => {
                this._emit('DASH_PLAYBACK_STARTED');
            });

            // TODO: DASH Period events khi implement đầy đủ
            this._emit('DASH_JS_INSTANCE_ATTACHED');
        } catch (e) {
            this._emit('DASH_ATTACH_FAILED', { error: e.message });
        }
    }

    async _parseFromMPD() {
        const src = this.video.currentSrc || this.video.src;
        if (!src?.includes('.mpd')) {
            this._emit('DASH_PARSE_SKIP', { reason: 'not_mpd_src' });
            return;
        }

        try {
            const res = await fetch(src, { credentials: 'include' });
            const text = await res.text();
            this._parseMPDPeriods(text);
            this._emit('DASH_MPD_PARSED', { periodCount: this._adPeriods.length });
        } catch (e) {
            // Sensor: CORS block trên MPD file
            this._emit('DASH_MPD_FETCH_FAILED', { reason: e.message, src });
        }
    }

    _parseMPDPeriods(mpdText) {
        // TODO: Parse XML periods, detect AdaptationSet với role=advertisement
        // Tạm thời dùng regex đơn giản để detect các period có ID liên quan ad
        const adPeriodRegex = /<Period[^>]*id="([^"]*ad[^"]*)"[^>]*start="([^"]*)"[^>]*duration="([^"]*)"/gi;
        let match;
        while ((match = adPeriodRegex.exec(mpdText)) !== null) {
            const start = this._parseDuration(match[2]);
            const duration = this._parseDuration(match[3]);
            this._adPeriods.push({ start, end: start + duration });
        }
    }

    // Parse ISO 8601 duration: PT30S, PT1M30S
    _parseDuration(str) {
        if (!str) return 0;
        const m = str.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
        if (!m) return parseFloat(str) || 0;
        return (parseFloat(m[1] || 0) * 3600)
            + (parseFloat(m[2] || 0) * 60)
            + parseFloat(m[3] || 0);
    }

    // ─── State ───
    isAd() {
        const t = this.getCurrentTime();
        return this._adPeriods.some(p => t >= p.start && t < p.end);
    }

    getNextContentTime() {
        const t = this.getCurrentTime();
        const period = this._adPeriods.find(p => t >= p.start && t < p.end);
        return period?.end ?? null;
    }
}

window.AdsFriendlyDASHAdapter = DASHAdapter;
