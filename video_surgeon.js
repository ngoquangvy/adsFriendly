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
        console.log('[AdsFriendly Video] Surgeon v1.9.2 (Reputation AI) initialized.');

        this.currentAdDensity = 0;
        this.siteTrustScore = 0.5;

        // 1. Initial Scan & Load
        this.loadPatternsAndReputation();
        this.scanAndObserve();

        // 2. Monitoring (Safe check for document.body)
        const startObserving = () => {
            if (document.body) {
                const bodyObserver = new MutationObserver(() => this.scanAndObserve());
                bodyObserver.observe(document.body, { childList: true, subtree: true });
            } else {
                setTimeout(startObserving, 50);
            }
        };
        startObserving();

        // 3. Loops
        setInterval(() => this.autoSkip(), 500);

        // 4. Message Bus
        window.addEventListener('message', (event) => {
            if (event.data && event.data.source === 'adsfriendly-spy') {
                if (event.data.type === 'AD_MAP_DETECTED') this.onAdDetected();
            }
            if (event.data && event.data.source === 'adsfriendly-content') {
                if (event.data.type === 'AD_DENSITY_VALUE') {
                    this.currentAdDensity = event.data.value;
                }
            }
        });

        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'SYNC_LEARNING') this.loadPatternsAndReputation();
        });
    },

    async loadPatternsAndReputation() {
        try {
            const { globalAdPatterns = [], siteReputation = {} } = await chrome.storage.local.get(['globalAdPatterns', 'siteReputation']);
            this.cachedPatterns = globalAdPatterns;
            const rep = siteReputation[window.location.hostname];
            if (rep) this.siteTrustScore = rep.trustScore;
            console.log(`[AdsFriendly Video] Brain Synced. Site Trust: ${this.siteTrustScore.toFixed(2)}`);
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
        const score = this.calculateAdScore(video);
        if (score >= 0.8) {
            console.log(`%c[AdsFriendly Video] Neutralizing Ad (%c${(score*100).toFixed(0)}% confidence%c) Site Trust: ${this.siteTrustScore.toFixed(2)}`, "color: #a855f7; font-weight: bold;", "color: #fbd38d;", "color: #a855f7;");
            this.accelerate(video);
            this.notifySpy(true);
        } else {
            this.restore(video);
        }
    },

    calculateAdScore(video) {
        let score = 0;
        const src = video.currentSrc || video.src || '';
        if (!src) return 0;

        // 1. Learned Patterns (High weight)
        if (this.cachedPatterns) {
            this.cachedPatterns.forEach(p => {
                if (p.type === 'video_source_marker' && src.includes(p.value)) score += 0.8;
                if (p.type === 'video_marker' && video.closest(p.value)) score += 0.6;
            });
        }

        // 2. Location Reputation (Crucial)
        // If site trust is low, we are more suspicious
        if (this.siteTrustScore < 0.3) score += 0.3;
        if (this.siteTrustScore > 0.8) score -= 0.6;

        // 3. Ad Density (Current page environment)
        if (this.currentAdDensity > 5) score += 0.2;
        if (this.currentAdDensity > 15) score += 0.4;

        // 4. Technical Heuristics
        const isExternal = !src.startsWith('blob:') && !src.includes(window.location.hostname);
        if (isExternal) {
            score += 0.3;
            if (src.includes('githubusercontent.com') || src.includes('github.io')) score += 0.2;
            if (src.toLowerCase().endsWith('.mp4')) score += 0.2;
        }

        // 5. Short Duration
        if (video.duration > 0 && video.duration < 65) score += 0.2;
        if (video.duration > 300) score -= 1.0; // Long videos are likely content

        return Math.min(1.0, score);
    },

    onAdDetected() {
        this.notifySpy(true);
        const videos = document.querySelectorAll('video');
        videos.forEach(v => this.checkAndExecute(v));
    },

    isAdVideo(video) {
        return this.calculateAdScore(video) >= 0.8;
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
