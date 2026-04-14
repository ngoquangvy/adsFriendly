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
        console.log('[AdsFriendly Video] Surgeon v1.8.1 (Surgical Strike) initialized.');

        // 1. Initial Scan & Pattern Load
        this.loadPatterns();
        this.scanAndObserve();

        // 2. Continuous Monitoring (Catch new videos)
        const bodyObserver = new MutationObserver(() => this.scanAndObserve());
        bodyObserver.observe(document.body, { childList: true, subtree: true });

        // 3. Auto-Skip Loop
        setInterval(() => this.autoSkip(), 500);

        // 4. Hear from the Spy & Background Brain
        window.addEventListener('message', (event) => {
            if (event.data && event.data.source === 'adsfriendly-spy') {
                if (event.data.type === 'AD_MAP_DETECTED') {
                    this.onAdDetected();
                }
            }
        });

        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'SYNC_LEARNING') {
                this.loadPatterns();
            }
        });
    },

    async loadPatterns() {
        try {
            const { globalAdPatterns = [] } = await chrome.storage.local.get('globalAdPatterns');
            this.cachedPatterns = globalAdPatterns;
            console.log('[AdsFriendly Video] AI Patterns loaded:', this.cachedPatterns.length);
        } catch (e) {}
    },

    scanAndObserve() {
        const videos = document.querySelectorAll('video');
        videos.forEach(v => {
            if (!v.dataset.observed) {
                v.dataset.observed = 'true';
                this.attachSourceObserver(v);
                this.checkAndExecute(v);
            }
        });
    },

    attachSourceObserver(video) {
        // Watch for src changes (Zero-latency detection)
        const observer = new MutationObserver(() => this.checkAndExecute(video));
        observer.observe(video, { attributes: true, attributeFilter: ['src'] });
        
        // Also listen for play events
        video.addEventListener('play', () => this.checkAndExecute(video));
        video.addEventListener('playing', () => this.checkAndExecute(video));
    },

    checkAndExecute(video) {
        if (this.isAdVideo(video)) {
            this.accelerate(video);
            this.notifySpy(true);
        } else {
            this.restore(video);
        }
    },

    onAdDetected() {
        this.notifySpy(true);
        const videos = document.querySelectorAll('video');
        videos.forEach(v => this.checkAndExecute(v));
    },

    isAdVideo(video) {
        const src = video.currentSrc || video.src || '';
        if (!src) return false;

        // 0. AI Brain Check (Learned Patterns)
        if (this.cachedPatterns && this.cachedPatterns.length > 0) {
            for (const p of this.cachedPatterns) {
                if (p.type === 'video_source_marker' && src.includes(p.value)) return true;
                if (p.type === 'video_marker' && video.closest(p.value)) return true;
            }
        }

        // 1. Masked Ad Hosts (GitHub etc)
        if (src.includes('githubusercontent.com') || src.includes('github.io')) return true;
        
        // 2. Aggressive External MP4 Heuristic
        const isExternal = !src.startsWith('blob:') && !src.includes(window.location.hostname);
        if (isExternal && src.toLowerCase().endsWith('.mp4')) {
            // High suspicion: External hard-linked MP4 on a streaming site is almost always an ad
            return true;
        }

        // 3. YouTube/JW Specifics
        if (window.location.hostname.includes('youtube.com')) {
            if (document.querySelector('.ad-showing, .ad-interrupting')) return true;
        }
        
        if (video.className.includes('jw-video')) {
            // If JW is playing something that isn't a blob, it's highly likely a pre-roll ad
            if (!src.startsWith('blob:') && isExternal) return true;
        }

        // 4. Duration Check (Secondary signal)
        if (video.duration > 0 && video.duration < 65) { 
            const playerContainer = video.closest('[class*="player"], [class*="video-js"], [class*="jwplayer"]');
            if (playerContainer && (playerContainer.className.includes('ad-') || playerContainer.className.includes('-ad'))) return true;
        }

        return false;
    },

    accelerate(video) {
        if (video.playbackRate >= 16) return;
        
        console.log('[AdsFriendly Video] Neutralizing Ad:', video.src || 'Dynamic Stream');
        video.playbackRate = 16;
        video.muted = true;
        this.activeAds.add(video);
        this.notifyBrainOfAdState(video);
    },

    restore(video) {
        if (this.activeAds.has(video)) {
            console.log('[AdsFriendly Video] Ad finished. Restoring content speed.');
            video.playbackRate = 1.0;
            video.muted = false;
            this.activeAds.delete(video);
            this.notifySpy(false);
        }
    },

    autoSkip() {
        const skipSelectors = [
            '.ytp-ad-skip-button', 
            '.ytp-ad-skip-button-modern', 
            '.ytp-ad-skip-button-container',
            '.videoAdUiSkipButton', 
            '.fluid_ad_skip_button',
            'button[class*="skip"]',
            '[aria-label*="Skip ad"]'
        ];
        
        skipSelectors.forEach(sel => {
            const btn = document.querySelector(sel);
            if (btn && btn.offsetParent !== null) {
                btn.click();
            }
        });

        // Text search for "Skip"
        const allButtons = document.querySelectorAll('button, div[role="button"], span[role="button"]');
        allButtons.forEach(btn => {
            const txt = btn.textContent.toLowerCase();
            if ((txt.includes('skip') || txt.includes('bỏ qua')) && (txt.includes('ad') || txt.includes('quảng'))) {
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
