/**
 * AdsFriendly: Video Surgeon (Content Script Context)
 * Core Orchestrator - Delegates all logic to specialized modules.
 * 
 * Module Dependencies (loaded via manifest.json before this file):
 *   - core/modules/dom_vision.js       → findSkipButton, pierceShadow, generateSelector, createNeutralizeOverlay
 *   - core/modules/heuristics.js       → calculateAdScore, getSourceDomain, getVideoSourceStats
 *   - core/modules/trusted_clicker.js  → dispatchHighFidelityClick
 *   - core/modules/danger_zone.js      → dangerZones, onAdMapDetected, getDangerZoneInfo, isInDangerZone
 *   - core/modules/playback_control.js → accelerate, restore
 *   - core/modules/skip_engine.js      → autoSkip, rely, verifyAndLearn
 *   - core/modules/session_manager.js  → startAdSession, endAdSession, monitorAdSession
 *   - core/modules/telemetry_sentinel.js → diagnosticLog, notifyBrainOfAdState, submitFinalTelemetry
 */
const VideoSurgeon = {
    // ─── State Properties ───
    activeAds: new Set(),
    lastClickTime: 0,
    isInitialized: false,

    // v2.8.20: Session Logic Properties
    isAdSessionActive: false,
    trackedAdElement: null,
    adMonitorInterval: null,
    sessionStartTime: 0,
    activeSessionZone: null, // Capture zone info for telemetry

    // ─── Orchestrator Init ───
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
        this._initMessageBus();

        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'SYNC_LEARNING') this.loadPatternsAndReputation();
        });
    },

    // ─── Message Bus (Centralized Event Router) ───
    _initMessageBus() {
        window.addEventListener('message', (event) => {
            if (event.data && event.data.source === 'adsfriendly-spy') {
                if (event.data.type === 'AD_MAP_DETECTED') {
                    this.onAdMapDetected(event.data);
                }

                // v4.7: Diagnostic Relay (Log Exhaust Pipe)
                if (event.data.type === 'DEBUG_LOG') {
                    if (chrome.runtime && chrome.runtime.id) {
                        chrome.runtime.sendMessage(event.data).catch(() => {});
                    }
                }

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

            // v4.8: Developer Backdoor (Show logs in main console - No source check for convenience)
            if (event.data && event.data.type === 'SHOW_ADS_LOGS') {
                console.log('[AdsFriendly] 🚪 Nhận lệnh SHOW_ADS_LOGS. Đang kiểm tra Chrome Runtime...');
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
                    chrome.storage.local.get(['crash_log_phimmoichill'], (res) => {
                        console.log('%c[AdsFriendly AI] 📂 DUMP FULL JSON:', 'color: #8b5cf6; font-weight: bold;');
                        if (res.crash_log_phimmoichill && res.crash_log_phimmoichill.length > 0) {
                            console.log(JSON.stringify(res.crash_log_phimmoichill, null, 2));
                        } else {
                            console.log('%c > Hiện chưa có dữ liệu log (Mảng rỗng hoặc chưa lưu).', 'color: #94a3b8;');
                        }
                    });
                } else {
                    console.error('[AdsFriendly] ❌ Mất kết nối với Extension (Chrome Runtime invalid). Vui lòng F5 lại trang web!');
                }
            }
        });
    },

    // ─── Core Decision Engine (checkAndExecute) ───
    async checkAndExecute(video) {
        try {
            const hostname = window.location.hostname;
            const src = video.currentSrc || video.src || '';

            // EMERGENCY SHIELD (v2.8.13): Long content protection
            if (video.duration > 300) {
                this.restore(video);
                delete video.dataset.accelerated;
                return;
            }

            const player = video.closest('#movie_player, .html5-video-player, #preroll-player, [class*="jw-flag-ads"], [class*="ad-"]');
            const sourceDomain = this.getSourceDomain(src);
            const sourceStats = await this.getVideoSourceStats();
            const skipBtn = this.findSkipButton(player || document);

            // 1. First Principle: Source Disparity (Domain check)
            const isExternal = src && !src.startsWith('blob:') && !src.includes(hostname);
            const isShort = video.duration > 0 && video.duration < 65;

            let isConfirmedCountdown = false;
            if (player) {
                const playerText = player.innerText;
                // v2.8.13: Tightened regex to only match active "skip" signals
                isConfirmedCountdown = /((skip|bỏ qua).*\d)|(\d.*(skip|bỏ qua))|skip|bỏ qua/i.test(playerText);
            }

            const playerStateText = player ? `${player.id || ''} ${player.className || ''}`.toLowerCase() : '';
            const playerLooksLikeAd = /preroll|ad-showing|jw-flag-ads|ad-break|ad-/.test(playerStateText);
            const isNearEnd = video.duration > 0 && Number.isFinite(video.duration) && video.currentTime >= (video.duration - 0.5);
            if (video.dataset.accelerated && isNearEnd && !skipBtn && !playerLooksLikeAd && !isConfirmedCountdown) {
                this.restore(video);
                delete video.dataset.accelerated;
                return;
            }

            // 3. Absolute Justice Logic: Behavior Supremacy
            const adHeuristic = (isConfirmedCountdown && isExternal) || (isExternal && isShort);
            const heuristicScore = this.calculateAdScore(video);
            let historyBias = 0;
            if (sourceStats && sourceStats[sourceDomain]) {
                const stats = sourceStats[sourceDomain];
                if (stats.adCount > (stats.contentCount || 0) * 2) historyBias = 0.4;
                if (stats.contentCount > (stats.adCount || 0) * 2) historyBias = -0.4;
            }
            const finalHeuristicScore = heuristicScore + historyBias;

            const isDefinitelyAd = Boolean(
                skipBtn ||
                isConfirmedCountdown ||
                adHeuristic ||
                this.isInDangerZone(video) || // v3.2: Predictive Timing Supremacy
                (player && player.id.includes('preroll')) ||
                finalHeuristicScore >= 0.8
            );

            if (isDefinitelyAd) {
                // v2.8.20: Optimized Ad Session Entry
                if (!this.isAdSessionActive || (this.trackedAdElement !== video && video.duration < 65)) {
                    this.startAdSession(video);
                }
            } else if (this.isAdSessionActive && this.trackedAdElement === video) {
                this.endAdSession('Heuristic: No longer identified as ad');
            } else if (!this.isAdSessionActive) {
                this.restore(video);

                // If it played for a while and wasn't flagged, it's content
                if (video.currentTime > 300 && !video.dataset.reportedContent) {
                    chrome.runtime.sendMessage({ type: 'REPORT_VIDEO_DECISION', data: { domain: sourceDomain, type: 'CONTENT' } });
                    video.dataset.reportedContent = 'true';
                }
            }
        } catch (err) {
            console.error('[AdsFriendly AI] Critical Surgeon Error - Recovering Speed:', err);
            this.endAdSession('Critical execution error');
        }
    },

    // ─── Utility Functions (Kept in Orchestrator) ───
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

                // StrategyEngine: detect player type & attach adapter
                if (typeof AdsFriendlyStrategyEngine !== 'undefined') {
                    AdsFriendlyStrategyEngine.attachToVideo(v);
                }
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

    onAdDetected() {
        this.notifySpy(true);
        const videos = document.querySelectorAll('video');
        videos.forEach(v => this.checkAndExecute(v));
    },

    isAdVideo(video) {
        return this.calculateAdScore(video) >= 0.8;
    },

    notifySpy(adMode) {
        window.postMessage({ source: 'adsfriendly-content', type: 'SET_AD_MODE', value: adMode }, '*');
    }
};

// ─── Module Assembly (Mixin Injection) ───
if (typeof window !== 'undefined') {
    // Phase 1: DOM & Heuristics
    Object.assign(VideoSurgeon, window.AdsFriendlyDomVision || {});
    Object.assign(VideoSurgeon, window.AdsFriendlyHeuristics || {});
    // Phase 2: DangerZone & Playback
    Object.assign(VideoSurgeon, window.AdsFriendlyDangerZone || {});
    Object.assign(VideoSurgeon, window.AdsFriendlyPlaybackControl || {});
    // Phase 3: Skip & Click
    Object.assign(VideoSurgeon, window.AdsFriendlySkipEngine || {});
    Object.assign(VideoSurgeon, window.AdsFriendlyTrustedClicker || {});
    // Phase 4: Session & Telemetry
    Object.assign(VideoSurgeon, window.AdsFriendlySessionManager || {});
    Object.assign(VideoSurgeon, window.AdsFriendlyTelemetrySentinel || {});

    VideoSurgeon.init();
}
