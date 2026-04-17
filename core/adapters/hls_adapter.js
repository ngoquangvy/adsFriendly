/**
 * AdsFriendly: HLS Adapter (hls.js / Native HLS)
 * Phân tích M3U8 để build timeline quảng cáo chính xác.
 * Sensor: báo cáo khi parse thất bại, gặp SSAI ẩn, hoặc seek bị chặn.
 */
class HLSAdapter extends window.AdsFriendlyBaseAdapter {
    constructor(video) {
        super(video);
        this.segments = [];     // Timeline: [{start, end, isAd}]
        this._hlsInstance = null; // hls.js native instance nếu có
        this._attached = false;
    }

    getCapabilities() {
        return {
            canSeek: true,
            canRateChange: true,
            hasAdEvent: !!this._hlsInstance,  // true if hls.js instance found
            hasTimeline: this.segments.length > 0,
            hasNativeAPI: !!this._hlsInstance
        };
    }

    attach() {
        if (this._attached) return;
        this._attached = true;

        // Ưu tiên dùng hls.js instance nếu trang đang dùng nó
        try {
            this._hlsInstance = this._detectHlsJsInstance();
        } catch (e) {}

        if (this._hlsInstance) {
            this._attachViaHlsJs();
        } else {
            // Fallback: parse M3U8 thủ công từ network (xhr_radar đã capture)
            this._parseFromVideoSrc();
        }

        // Lắng nghe sự kiện hls.js native nếu có
        this.video.addEventListener('timeupdate', () => this._onTimeUpdate());
    }

    detach() {
        this._attached = false;
        this.segments = [];
        this._hlsInstance = null;
    }

    // ─── Detect hls.js instance gắn vào video element ───
    _detectHlsJsInstance() {
        // hls.js thường lưu instance trên element hoặc window
        return this.video._hls
            || this.video.__hls
            || window.Hls?.instances?.find?.(h => h.media === this.video)
            || null;
    }

    _attachViaHlsJs() {
        const hls = this._hlsInstance;

        // hls.js events - báo cáo Ad break chính xác
        hls.on?.('hlsFragChanged', (event, data) => {
            const frag = data?.frag;
            if (!frag) return;
            const isLikelyAd = frag.tagList?.some(tag =>
                tag[0]?.includes('CUE') || tag[0]?.includes('DISCONTINUITY')
            );
            if (isLikelyAd) {
                this._emit('HLS_AD_FRAGMENT_DETECTED', { fragStart: frag.start, fragDuration: frag.duration });
            }
        });

        this._emit('HLS_JS_INSTANCE_ATTACHED');
    }

    // ─── Parse M3U8 thủ công ───
    async _parseFromVideoSrc() {
        const src = this.video.currentSrc || this.video.src;
        if (!src || src.startsWith('blob:') || !src.includes('.m3u8')) {
            this._emit('HLS_PARSE_SKIP', { reason: 'not_m3u8_src', src });
            return;
        }

        try {
            const res = await fetch(src, { credentials: 'include' });
            const text = await res.text();
            this.segments = this._parseSegments(text);
            this._emit('HLS_TIMELINE_BUILT', { segmentCount: this.segments.length });
        } catch (e) {
            // Sensor: báo cáo parse thất bại (CORS hoặc CSP block)
            this._emit('HLS_PARSE_FAILED', { reason: e.message, src });
        }
    }

    _parseSegments(m3u8Text) {
        const lines = m3u8Text.split('\n');
        let time = 0;
        const segments = [];
        let inAdBlock = false;
        const FUZZY = 0.3;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Marker quảng cáo SSAI
            if (line.includes('#EXT-X-CUE-OUT') || line.includes('#EXT-X-DISCONTINUITY')) {
                inAdBlock = true;
            }
            if (line.includes('#EXT-X-CUE-IN')) {
                inAdBlock = false;
            }

            if (line.startsWith('#EXTINF:')) {
                const duration = parseFloat(line.split(':')[1]);
                if (!isNaN(duration)) {
                    // Heuristic: đoạn ngắn bất thường < 10s trong stream dài = khả năng ad
                    const isAdByHeuristic = duration < 10 && segments.length > 0;
                    segments.push({
                        start: Math.max(0, time - FUZZY),
                        end: time + duration + FUZZY,
                        isAd: inAdBlock || isAdByHeuristic
                    });
                    time += duration;
                }
            }
        }

        return segments;
    }

    // ─── State ───
    isAd() {
        const t = this.getCurrentTime();
        const seg = this.segments.find(s => t >= s.start && t < s.end);
        return seg?.isAd ?? false;
    }

    getNextContentTime() {
        const t = this.getCurrentTime();
        for (const seg of this.segments) {
            if (t >= seg.start && t < seg.end && seg.isAd) {
                return seg.end;
            }
        }
        return null;
    }

    _onTimeUpdate() {
        // Sensor: theo dõi seek bị reset (site chống seek)
        const expected = this._lastExpectedTime;
        const actual = this.getCurrentTime();
        if (expected !== undefined && Math.abs(actual - expected) > 2.0 && this.isAd()) {
            this._emit('HLS_SEEK_BLOCKED', { expected, actual });
        }
        this._lastExpectedTime = actual;
    }
}

window.AdsFriendlyHLSAdapter = HLSAdapter;
