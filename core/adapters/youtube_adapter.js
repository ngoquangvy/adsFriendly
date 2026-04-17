/**
 * AdsFriendly: YouTube Adapter
 * Hook vào YouTube's Internal Player API (window.yt, movie_player).
 * Không parse M3U8 — YouTube dùng DASH nội bộ với ad data trong API response.
 * Sensor: CSAI detection, ad-showing class, skip button DOM.
 */
class YouTubeAdapter extends window.AdsFriendlyBaseAdapter {
    constructor(video) {
        super(video);
        this._ytPlayer = null; // Reference đến movie_player object
        this._adClassObserver = null;
    }

    getCapabilities() {
        return {
            canSeek: true,
            canRateChange: true,
            hasAdEvent: false,  // YT doesn't expose clean ad events from content script
            hasTimeline: false,
            hasNativeAPI: !!this._ytPlayer
        };
    }

    attach() {
        // Lấy YouTube internal player object
        try {
            this._ytPlayer = document.getElementById('movie_player') 
                || document.querySelector('.html5-video-player');
        } catch (e) {}

        if (!this._ytPlayer) {
            this._emit('YT_PLAYER_NOT_FOUND');
            return;
        }

        // Observer theo dõi thay đổi class `.ad-showing`
        this._adClassObserver = new MutationObserver(() => {
            const isAdNow = this._ytPlayer.classList.contains('ad-showing')
                || this._ytPlayer.classList.contains('ad-interrupting');

            if (isAdNow) {
                this._emit('YT_AD_CLASS_DETECTED', {
                    classes: this._ytPlayer.className
                });
            }
        });

        this._adClassObserver.observe(this._ytPlayer, {
            attributes: true,
            attributeFilter: ['class']
        });

        this._emit('YT_ADAPTER_ATTACHED', {
            hasInternalAPI: typeof this._ytPlayer.isAdShowing === 'function'
        });
    }

    detach() {
        this._adClassObserver?.disconnect();
        this._adClassObserver = null;
        this._ytPlayer = null;
    }

    // ─── State ───
    isAd() {
        if (!this._ytPlayer) return false;

        // Method 1: YouTube internal API (nếu còn expose)
        if (typeof this._ytPlayer.isAdShowing === 'function') {
            try { return this._ytPlayer.isAdShowing(); } catch (e) {}
        }

        // Method 2: Class check
        return this._ytPlayer.classList.contains('ad-showing')
            || this._ytPlayer.classList.contains('ad-interrupting');
    }

    getCurrentTime() {
        // YouTube internal API chính xác hơn video.currentTime
        if (typeof this._ytPlayer?.getCurrentTime === 'function') {
            try { return this._ytPlayer.getCurrentTime(); } catch (e) {}
        }
        return super.getCurrentTime();
    }

    getDuration() {
        if (typeof this._ytPlayer?.getDuration === 'function') {
            try { return this._ytPlayer.getDuration(); } catch (e) {}
        }
        return super.getDuration();
    }

    seek(time) {
        // YouTube: seekTo(seconds, allowSeekAhead)
        if (typeof this._ytPlayer?.seekTo === 'function') {
            try {
                this._ytPlayer.seekTo(time, true);
                return;
            } catch (e) {
                this._emit('YT_SEEK_FAILED', { time, error: e.message });
            }
        }
        super.seek(time);
    }
}

window.AdsFriendlyYouTubeAdapter = YouTubeAdapter;
