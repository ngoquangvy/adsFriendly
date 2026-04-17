/**
 * AdsFriendly: Skip Engine Module
 * Handles autoSkip logic, text-based button discovery, and selector learning.
 */
window.AdsFriendlySkipEngine = {
    autoSkip() {
        const skipSelectors = [
            ...this.learnedSelectors,      // Prioritize locally learned patterns
            '.jw-skip',
            '.jw-skip-button',
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
        const video = document.querySelector('video[data-adsfriendly-ad-active="1"]') || document.querySelector('video');
        if (video && video.playbackRate > 1 && !hasKnownSkipButton()) {
            // v3.6: SSAI Defense - If we are in a Genome-detected DangerZone, STAY in ad mode
            if (this.isInDangerZone(video)) {
                return; // Guard active: The AI says this is still DNA-level ad content
            }
            
            // v4.5: Heuristic Shield - If AI score is high, it's a heuristically identified ad
            if (this.calculateAdScore(video) >= 0.8) {
                return; // Guard active: AI confidently identified this without DOM markers
            }

            // Second check: Is the ad overlay actually gone?
            if (!isAdShowingNow() && !this.isAdSessionActive) {
                console.log('[AdsFriendly AI] Sanity Guard: No ad detected but speed is high. Restoring...');
                this.restore(video);
                return;
            }
        }

        const tryUltimateClick = (btn, method, isDiscovery = false) => {
            const style = getComputedStyle(btn);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && btn.getClientRects().length > 0;
            const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('disabled');

            if (isVisible && !isDisabled) {
                // Click Throttling (v2.8.22): Optimized to 400ms for high-frequency environments
                const now = Date.now();
                if (now - this.lastClickTime < 400) return true; // Already handled recently

                this.lastClickTime = now; // Set ONLY when we are actually proceeding to dispatch

                if (isDiscovery && typeof this.verifyAndLearn === 'function') {
                    this.verifyAndLearn(btn, video);
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

    rely(video) {
        // High-Precision Skipsequence: Unified scanning for ad-removal
        this.autoSkip();
    },

    async verifyAndLearn(btn, video) {
        if (!chrome.runtime || !chrome.runtime.id) return;

        const selector = this.generateSelector(btn);
        if (!selector) return;

        // console.log(`[AdsFriendly AI] Discovery Phase: Verifying potential marker: ${selector}`);

        if (!video) {
            video = btn.closest('[class*="player"], video, #movie_player, .html5-video-player')?.querySelector('video')
                || btn.querySelector('video')
                || document.querySelector('video[data-adsfriendly-ad-active="1"]');
        }

        if (!video) {
            console.warn('[AdsFriendly AI] Cannot verify: no video element found');
            return;
        }

        const oldSrc = video.currentSrc;
        const oldDuration = video.duration;
        const oldParent = video.parentElement;

        setTimeout(async () => {
            const isVideoGone = !document.contains(video) && !document.contains(oldParent);
            const isSourceChanged = video.currentSrc !== oldSrc && video.currentSrc !== '';
            const isDurationChanged = video.duration !== oldDuration && video.duration > 0 && oldDuration > 0;
            const isNearEnd = video.currentTime >= (video.duration - 0.5);

            if (isVideoGone || isSourceChanged || isDurationChanged || isNearEnd) {
                console.log('%c[AdsFriendly AI] Verification SUCCESS: Ad skipped/ended.', 'color: #22c55e; font-weight: bold;');
                await BrainBridge.confirmLearnedMarker(selector, window.location.hostname);
            } else {
                const stillShowingAd = document.querySelector('#movie_player.ad-showing, .ad-interrupting, [class*="ad-showing"]');
                if (stillShowingAd) {
                    console.warn('[AdsFriendly AI] Verification FAILED: Ad still showing.');
                    await BrainBridge.penalizeMarker(selector);
                } else {
                    console.log('[AdsFriendly AI] Verification INCONCLUSIVE: No clear outcome.');
                }
            }
        }, 1500);
    }
};
