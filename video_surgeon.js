/**
 * AdsFriendly: Video Surgeon (Content Script Context)
 * Specialized module for neutralizing video ads via speed manipulation and auto-skipping.
 */
const VideoSurgeon = {
    activeAds: new Set(),
    isInitialized: false,

    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;
        console.log('[AdsFriendly Video] Surgeon initialized.');

        // 1. Auto-Skip Loop (Polling for dynamic skip buttons)
        setInterval(() => this.autoSkip(), 500);

        // 2. Continuous Health Check (Ensure ads are staying fast-forwarded)
        setInterval(() => this.reforceAdSpeed(), 1000);

        // 3. Hear from the Spy (Main World -> Content Script)
        window.addEventListener('message', (event) => {
            if (event.data && event.data.source === 'adsfriendly-spy') {
                if (event.data.type === 'AD_MAP_DETECTED') {
                    this.onAdDetected();
                }
            }
        });
    },

    onAdDetected() {
        console.log('[AdsFriendly Video] Ad signal confirmed. Searching for targets...');
        this.notifySpy(true); // Enable timer acceleration in main world
        this.neutralizeAll();
    },

    neutralizeAll() {
        const videos = document.querySelectorAll('video');
        videos.forEach(v => {
            if (this.isAdVideo(v)) {
                this.accelerate(v);
            }
        });
    },

    isAdVideo(video) {
        // AI Heuristic: Short videos with ad-like ancestors are likely ads
        const duration = video.duration;
        if (duration > 0 && duration < 62) { // Ads are usually < 60s
            const playerContainer = video.closest('[class*="player"], [class*="video-js"], [class*="jwplayer"]');
            if (playerContainer) {
                const classes = playerContainer.className.toLowerCase();
                if (classes.includes('ad-') || classes.includes('-ad')) return true;
            }
        }
        
        // Check for common YouTube ad classes
        if (window.location.hostname.includes('youtube.com')) {
            if (document.querySelector('.ad-showing, .ad-interrupting')) return true;
        }

        return false;
    },

    accelerate(video) {
        if (video.playbackRate === 16) return;
        
        console.log('[AdsFriendly Video] Accelerating target...', video.src);
        video.playbackRate = 16;
        video.muted = true;
        this.activeAds.add(video);

        // Learning: Store the player state in the brain later
        this.notifyBrainOfAdState(video);
    },

    reforceAdSpeed() {
        this.activeAds.forEach(video => {
            if (!video.isConnected) {
                this.activeAds.delete(video);
                return;
            }
            if (video.playbackRate < 16 && this.isAdVideo(video)) {
                video.playbackRate = 16;
            } else if (!this.isAdVideo(video)) {
                // Ad finished? Restore normal speed
                video.playbackRate = 1.0;
                this.activeAds.delete(video);
                this.notifySpy(false);
            }
        });
    },

    autoSkip() {
        const skipSelectors = [
            '.ytp-ad-skip-button', 
            '.ytp-ad-skip-button-modern', 
            '.videoAdUiSkipButton', 
            '.fluid_ad_skip_button',
            'button[class*="skip"]',
            '[aria-label*="Skip ad"]'
        ];
        
        skipSelectors.forEach(sel => {
            const btn = document.querySelector(sel);
            if (btn && btn.offsetParent !== null) { // Visible
                console.log('[AdsFriendly Video] Clicking skip button:', sel);
                btn.click();
            }
        });

        // Text search for "Skip"
        const allButtons = document.querySelectorAll('button, div[role="button"]');
        allButtons.forEach(btn => {
            const txt = btn.textContent.toLowerCase();
            if ((txt.includes('skip') || txt.includes('bỏ qua')) && txt.includes('ad')) {
                if (btn.offsetParent !== null) btn.click();
            }
        });
    },

    notifySpy(adMode) {
        window.postMessage({ source: 'adsfriendly-content', type: 'SET_AD_MODE', value: adMode }, '*');
    },

    async notifyBrainOfAdState(video) {
        const playerContainer = video.closest('[class*="player"]');
        if (playerContainer) {
            chrome.runtime.sendMessage({
                type: 'SYNC_VIDEO_LEARNING',
                hostname: window.location.hostname,
                classes: playerContainer.className,
                duration: video.duration
            });
        }
    }
};

// Auto-init for content script injection
if (typeof window !== 'undefined') {
    VideoSurgeon.init();
}
