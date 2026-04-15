/**
 * AdsFriendly: Video Surgeon (Content Script Context)
 * Specialized module for neutralizing video ads via speed manipulation and auto-skipping.
 */
const VideoSurgeon = {
    activeAds: new Set(),
    lastClickTime: 0,
    isInitialized: false,

    async init() {
        if (this.isInitialized) return;

        // GLOBAL GOVERNANCE: Check if AI Mode is ACTIVE (Full AI = false, Friendly = true)
        const { isEnabled, friendlyMode } = await chrome.storage.local.get(['isEnabled', 'friendlyMode']);

        // If extension is OFF OR in Friendly Mode (true), stay dormant for aggressive features
        if (isEnabled === false || friendlyMode === true) {
            console.log('[AdsFriendly Video] Dormant Mode: Extension is disabled or in Standard (Friendly) mode.');
            return;
        }

        // Defensive check: Is extension still valid?
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;

        this.isInitialized = true;
        this.createNeutralizeOverlay();
        console.log('[AdsFriendly Video] Fusion Surgeon v3.0 (Federated Brain) initialized.');

        await BrainBridge.init();
        this.currentAdDensity = 0;

        // Load discovered markers into the skip list
        const learned = await BrainBridge.getDiscoveredMarkers();
        if (learned && learned.length > 0) {
            console.log('[AdsFriendly Video] Evolving skip list with', learned.length, 'learned patterns.');
            this.learnedSelectors = learned;
        } else {
            this.learnedSelectors = [];
        }

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

                // DATA SENTINEL: Harvest ad signatures and player states
                if (event.data.type === 'AD_GENOME_HARVEST' || event.data.type === 'PLAYER_STATE_HARVEST') {
                    BrainBridge.recordIntelligence(event.data);
                }
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

    createNeutralizeOverlay() {
        if (document.getElementById('adsfriendly-neutralize-overlay')) return;
        if (!document.body) {
            setTimeout(() => this.createNeutralizeOverlay(), 50);
            return;
        }

        this.overlay = document.createElement('div');
        this.overlay.id = 'adsfriendly-neutralize-overlay';
        this.overlay.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 24px; font-weight: bold; margin-bottom: 8px;">AdsFriendly AI</div>
                <div style="font-size: 14px; opacity: 0.8;">Neutralizing Ad...</div>
                <div style="margin-top: 15px; width: 40px; height: 40px; border: 3px solid #22c55e; border-top-color: transparent; border-radius: 50%; animation: adsfriendly-spin 1s linear infinite; margin-left: auto; margin-right: auto;"></div>
            </div>
            <style>
                #adsfriendly-neutralize-overlay {
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.9); backdrop-filter: blur(15px);
                    z-index: 1000; display: none; align-items: center; justify-content: center;
                    color: #22c55e; font-family: sans-serif; pointer-events: none;
                }
                @keyframes adsfriendly-spin { to { transform: rotate(360deg); } }
            </style>
        `;
        document.body.appendChild(this.overlay);
    },

    async loadPatternsAndReputation() {
        try {
            const { globalAdPatterns = [], siteReputation = {} } = await chrome.storage.local.get(['globalAdPatterns', 'siteReputation']);
            this.cachedPatterns = globalAdPatterns;
            const rep = siteReputation[window.location.hostname];
            if (rep) this.siteTrustScore = rep.trustScore;
            console.log(`[AdsFriendly Video] Brain Synced. Site Trust: ${this.siteTrustScore.toFixed(2)}`);
        } catch (e) { }
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

    async checkAndExecute(video) {
        try {
            const hostname = window.location.hostname;
            const src = video.currentSrc || video.src || '';
            
            // EMERGENCY SHIELD (v2.8.13): Long content protection
            // If it's a movie (> 5 mins), it is IMMUNE to ad-acceleration logic.
            if (video.duration > 300) {
                this.restore(video);
                delete video.dataset.accelerated;
                return;
            }

            const player = video.closest('#movie_player, .html5-video-player, #preroll-player, [class*="jw-flag-ads"], [class*="ad-"]');
            
            // v2.8.11: Fetch Source Trust from the Brain
            const sourceDomain = src ? new URL(src).hostname : 'unknown';
            const sourceStats = await new Promise(resolve => {
                chrome.runtime.sendMessage({ type: 'GET_VIDEO_SOURCE_STATS' }, resolve);
            });

            // 1. First Principle: Source Disparity (Domain check)
            const isExternal = src && !src.startsWith('blob:') && !src.includes(hostname);
            const isShort = video.duration > 0 && video.duration < 65;
            
            // 2. Interaction Principle: Search for Skip UI specifically in proximity
            const skipBtn = document.querySelector('#preroll-player-skip, .jw-skip, .ytp-skip-ad-button, .ytp-ad-skip-button');
            
            let isConfirmedCountdown = false;
            if (player) {
                const playerText = player.innerText;
                // v2.8.13: Tightened regex to only match active "skip" signals
                isConfirmedCountdown = /((skip|bỏ qua).*\d)|(\d.*(skip|bỏ qua))|skip|bỏ qua/i.test(playerText);
            }

            // 3. Absolute Justice Logic: Behavior Supremacy
            const adHeuristic = (isConfirmedCountdown && isExternal) || (isExternal && isShort);
            
            // Integrate Source History (v2.8.12: Neural Fusion)
            let historyPenalty = 0;
            if (sourceStats && sourceStats[sourceDomain]) {
                const stats = sourceStats[sourceDomain];
                if (stats.adCount > (stats.contentCount || 0) * 2) historyPenalty = 0.4;
                if (stats.contentCount > (stats.adCount || 0) * 2) historyPenalty = -0.4;
            }

            const isDefinitelyAd = skipBtn || isConfirmedCountdown || (adHeuristic) || (player && player.id.includes('preroll'));

            if (isDefinitelyAd) {
                if (!video.dataset.accelerated) {
                    console.log('%c[AdsFriendly AI] Neutralizing confirmed ad from:', sourceDomain);
                    this.notifySpy(true);
                    this.accelerate(video);
                    video.dataset.accelerated = 'true';
                    
                    // Learn as we go
                    chrome.runtime.sendMessage({ type: 'REPORT_VIDEO_DECISION', data: { domain: sourceDomain, type: 'AD' } });
                }
                this.rely(video);
            } else {
                this.restore(video);
                
                // If it played for a while and wasn't flagged, it's content
                if (video.currentTime > 300 && !video.dataset.reportedContent) {
                    chrome.runtime.sendMessage({ type: 'REPORT_VIDEO_DECISION', data: { domain: sourceDomain, type: 'CONTENT' } });
                    video.dataset.reportedContent = 'true';
                }
                delete video.dataset.accelerated;
            }
        } catch (err) {
            console.error('[AdsFriendly AI] Critical Surgeon Error - Recovering Speed:', err);
            this.restore(video);
        }
    },

    rely(video) {
        // High-Precision Skipsequence: Unified scanning for ad-removal
        this.autoSkip();
    },

    calculateAdScore(video) {
        let score = 0;
        const src = video.currentSrc || video.src || '';
        if (!src) return 0;

        // 1. URL Pattern Intelligence (v2.8.6)
        if (src.includes('raw.githubusercontent') || src.includes('.xml') || src.includes('vast')) {
            if (video.duration > 0 && video.duration < 65) return 1.0;
            score += 0.5;
        }

        // 2. Learned Patterns
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
        video.dataset.adsfriendlyAdActive = '1';
        video.dataset.adsfriendlyPrevMuted = video.muted ? '1' : '0';
        video.playbackRate = 16;
        video.muted = true;
        this.activeAds.add(video);
        this.notifyBrainOfAdState(video);

        // Show Ninja Overlay over the player
        if (this.overlay) {
            const player = document.getElementById('movie_player') || video.parentElement;
            if (player && !player.contains(this.overlay)) {
                player.appendChild(this.overlay);
            }
            this.overlay.style.display = 'flex';
        }
    },

    restore(video) {
        if (this.activeAds.has(video)) {
            console.log('[AdsFriendly Video] Ad finished. Executing High-Precision Stealth Handover.');

            // Hide Overlay
            if (this.overlay) this.overlay.style.display = 'none';

            // 1. Reset speed and audio locally (Content Script context)
            video.playbackRate = 1.0;
            video.muted = video.dataset.adsfriendlyPrevMuted === '1';
            delete video.dataset.adsfriendlyAdActive;
            delete video.dataset.adsfriendlyPrevMuted;

            // 2. STOP Ad Mode in Spy (Main World context) - This restores Volume and Speed Hammer
            this.activeAds.delete(video);
            this.notifySpy(false);
            this.lastClickTime = 0; // REFRESH: Ready for back-to-back ads

            // 3. Force playback resume
            if (video.paused) {
                video.play().catch(() => { });
            }
        }
    },

    autoSkip() {
        const skipSelectors = [
            ...this.learnedSelectors,      // Prioritize locally learned patterns
            '.ytp-skip-ad-button',         // Modern YouTube
            '[id^="skip-button:"]',        // Dynamic colon-IDs (e.g., skip-button:q)
            '.ytp-ad-skip-button',         // Legacy YouTube
            '.ytp-ad-skip-button-modern',
            '.videoAdUiSkipButton',
            'button[class*="skip"]'
        ];

        const hasKnownSkipButton = () => skipSelectors.some(sel => this.pierceShadow(document, sel));
        const isAdShowingNow = () => Boolean(
            document.querySelector('#movie_player.ad-showing, .html5-video-player.ad-showing, .ad-showing, .ad-interrupting, .ytp-ad-player-overlay')
        );

        // SANITY GUARD: If we are in 16x speed but no skip button found
        const video = document.querySelector('video');
        if (video && video.playbackRate > 1 && !hasKnownSkipButton()) {
            // Second check: Is the ad overlay actually gone?
            if (!isAdShowingNow()) {
                console.log('[AdsFriendly AI] Sanity Guard: No ad detected but speed is high. Restoring...');
                this.restore(video);
                return;
            }
        }

        const tryUltimateClick = (btn, method, isDiscovery = false) => {
            const style = getComputedStyle(btn);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && btn.getClientRects().length > 0;

            if (isVisible) {
                // Click Throttling: Only click once every 2 seconds
                const now = Date.now();
                if (now - this.lastClickTime < 2000) return true;
                this.lastClickTime = now;

                if (isDiscovery) {
                    this.verifyAndLearn(btn);
                }

                this.dispatchHighFidelityClick(btn, method);
                return true;
            }
            return false;
        };

        // 1. Selector search (Ordered by Trust + Shadow Piercing)
        for (const sel of skipSelectors) {
            const btn = this.pierceShadow(document, sel);
            if (btn && tryUltimateClick(btn, `selector (${sel})`)) return;
        }

        // 2. Text search fallback (The Discovery Phase - Optimized for modern minimalist UI)
        // Optimization: Only scan within the player context or the body/document if player not found
        const searchRoot = document.querySelector('#movie_player, .html5-video-player') || document.body || document;
        if (!searchRoot) return; // Ultra-defensive

        const allElements = searchRoot.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]');
        for (const el of allElements) {
            const txt = (el.textContent || "").toLowerCase().trim();
            const identity = (el.className + ' ' + el.id).toLowerCase();

            // If it says "Skip" and has ad-related metadata in classes/id
            if ((txt.includes('skip') || txt.includes('bỏ qua')) &&
                (txt.length < 15) && // Minimalist skip buttons are short
                (identity.includes('ad') || identity.includes('skip') || identity.includes('suggest'))) {

                if (tryUltimateClick(el, 'discovery (text-match)', true)) return;
            }
        }
    },

    dispatchHighFidelityClick(el, method) {
        const rect = el.getBoundingClientRect();

        // Humanized Jitter: Click within the inner 40% of the button, randomized
        const x = rect.left + (rect.width * (0.3 + Math.random() * 0.4));
        const y = rect.top + (rect.height * (0.3 + Math.random() * 0.4));

        console.log(`[AdsFriendly AI] Humanized High-Fidelity Click for ${method} at (${Math.round(x)}, ${Math.round(y)})`);

        const opts = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            buttons: 1
        };

        // 1. WAKE-UP Protocol (Hover)
        el.dispatchEvent(new MouseEvent('mouseenter', opts));
        el.dispatchEvent(new MouseEvent('mouseover', opts));

        // 2. Instant Execution (No more human delay for Full AI mode)
        if (!chrome.runtime || !chrome.runtime.id) return;

        // 3. POINTER Chain
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));

        // 4. FINAL CLICK
        el.dispatchEvent(new MouseEvent('click', opts));
        if (typeof el.click === 'function') el.click();

        // 5. KEYBOARD Fallback
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));

        // 6. NUCLEAR API BYPASS
        window.dispatchEvent(new CustomEvent('ADSFRIENDLY_ACTIVATE_SKIP'));

        console.log('%c[AdsFriendly AI v2.8.5] Zero-Latency Skip & API Bypass dispatched!', 'color: #22c55e; font-weight: bold;');
    },

    pierceShadow(root, selector) {
        const element = root.querySelector(selector);
        if (element) return element;

        const shadows = root.querySelectorAll('*');
        for (const el of shadows) {
            if (el.shadowRoot) {
                const found = this.pierceShadow(el.shadowRoot, selector);
                if (found) return found;
            }
        }
        return null;
    },

    async verifyAndLearn(btn) {
        if (!chrome.runtime || !chrome.runtime.id) return;

        const selector = this.generateSelector(btn);
        if (!selector) return;

        console.log(`[AdsFriendly AI] Discovery Phase: Verifying potential marker: ${selector}`);

        // Wait for YouTube state transition (Watchdog)
        setTimeout(async () => {
            const stillShowingAd = document.querySelector('#movie_player.ad-showing, .ad-interrupting');
            if (!stillShowingAd) {
                console.log('%c[AdsFriendly AI] Verification SUCCESS: New pattern confirmed.', 'color: #22c55e; font-weight: bold;');
                await BrainBridge.confirmLearnedMarker(selector, window.location.hostname);
            } else {
                console.warn('[AdsFriendly AI] Verification FAILED: Potential Honeypot or Invalid Marker.');
                await BrainBridge.penalizeMarker(selector);
            }
        }, 1000); // 1s buffer for YouTube player state refresh
    },

    generateSelector(el) {
        if (el.id && !/\d{4,}/.test(el.id)) return `#${el.id}`;

        const classes = Array.from(el.classList)
            .filter(c => !/\d{4,}/.test(c)) // Filter out dynamic hashes
            .filter(c => !c.includes('hover') && !c.includes('focus'))
            .join('.');

        return classes ? `.${classes}` : null;
    },

    notifySpy(adMode) {
        window.postMessage({ source: 'adsfriendly-content', type: 'SET_AD_MODE', value: adMode }, '*');
    },

    async notifyBrainOfAdState(video) {
        if (!chrome.runtime || !chrome.runtime.id) return; // Context Guard
        const playerContainer = video.closest('[class*="player"]');
        if (playerContainer) {
            try {
                chrome.runtime.sendMessage({
                    type: 'SYNC_VIDEO_LEARNING',
                    hostname: window.location.hostname,
                    classes: playerContainer.className,
                    duration: video.duration
                });
            } catch (e) { }
        }
    }
};

// Auto-init for content script injection
if (typeof window !== 'undefined') {
    VideoSurgeon.init();
}
