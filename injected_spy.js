/**
 * AdsFriendly: Injected Spy (Main World Context)
 * Used to intercept networking and timers that are invisible to Content Scripts.
 */
(function() {
    console.log('[AdsFriendly Spy] Injected and active.');

    const originalFetch = window.fetch;
    const originalXHR = XMLHttpRequest.prototype.send;
    const originalTimeout = window.setTimeout.bind(window);
    const originalInterval = window.setInterval.bind(window);

    let isAdMode = false;
    let userVolume = 100;
    let userWasMuted = false;
    let hammerInterval = null;
    const videoSnapshots = new WeakMap();

    function getTrackedAdVideos() {
        return Array.from(document.querySelectorAll('video[data-adsfriendly-ad-active="1"]'));
    }

    // v2.8.14: Smart Audio Memory (Respect user preference)
    function snapshotAudioState() {
        document.querySelectorAll('video').forEach(v => {
            // Only snapshot non-ad videos (likely the content/main video)
            if (!v.dataset.adsfriendlyAdActive) {
                videoSnapshots.set(v, {
                    muted: v.muted,
                    volume: v.volume
                });
            }
        });
    }

    function restoreAudioState() {
        document.querySelectorAll('video').forEach(v => {
            const snap = videoSnapshots.get(v);
            if (snap) {
                // Restoration Principle: Only unmute if it was UNMUTED by the user, but is now MUTED (likely by us/site)
                if (snap.muted === false && v.muted === true) {
                    console.log('[AdsFriendly Spy] Smart Audio: Restoring unmuted state for content video.');
                    v.muted = false;
                    v.volume = snap.volume;
                }
            }
        });
    }

    // 1. Networking Interception (Fetch)
    window.fetch = async function(...args) {
        const url = args[0] ? args[0].toString() : '';
        const response = await originalFetch(...args);
        
        if (url.includes('.m3u8') || url.includes('.mpd') || url.includes('player/v1/player')) {
            const clone = response.clone();
            clone.text().then(body => {
                analyzeManifest(url, body);
            }).catch(() => {});
        }
        return response;
    };

    // 2. Timer Manipulation (Accelerating the clock during ads)
    window.setTimeout = function(handler, timeout, ...args) {
        let finalTimeout = timeout;
        if (isAdMode && typeof timeout === 'number' && timeout > 50) {
            finalTimeout = timeout / 100; // 100x speed
        }
        return originalTimeout(handler, finalTimeout, ...args);
    };

    window.setInterval = function(handler, timeout, ...args) {
        let finalTimeout = timeout;
        if (isAdMode && typeof timeout === 'number' && timeout > 50) {
            finalTimeout = timeout / 100; // 100x speed
        }
        return originalInterval(handler, finalTimeout, ...args);
    };

    // 3. Deep Manifest & Network Analysis (Data Sentinel)
    function analyzeManifest(url, body) {
        const adMarkers = ['#EXT-X-DISCONTINUITY', '#EXT-X-CUE-OUT', 'adunit', 'vpaid', 'doubleclick', 'amazon-adsystem'];
        const hasAd = adMarkers.some(marker => body.includes(marker));

        if (hasAd) {
            // Extract Genome: Try to find durations or offsets
            const genome = {
                timestamp: Date.now(),
                url: url.split('?')[0],
                markers: adMarkers.filter(m => body.includes(m)),
                lengthHint: (body.match(/#EXTINF:([0-9.]+)/) || [])[1]
            };

            console.log('[AdsFriendly Sentinel] Ad Genome Extracted:', genome);
            notifyContentScript({ type: 'AD_GENOME_HARVEST', genome });
            notifyContentScript({ type: 'AD_MAP_DETECTED', url });
        }
    }

    // Monitor internal player variables (State Chronicler)
    setInterval(() => {
        const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
        if (player) {
            // Harvest hidden state variables
            const state = {
                adShowing: typeof player.isAdShowing === 'function' ? player.isAdShowing() : null,
                videoData: typeof player.getVideoData === 'function' ? { id: player.getVideoData().video_id, author: player.getVideoData().author } : null,
                presentState: player.getPresentingState ? player.getPresentingState() : null
            };
            
            if (state.adShowing) {
                notifyContentScript({ type: 'PLAYER_STATE_HARVEST', state });
            }
        }
    }, 2000);

    function notifyContentScript(data) {
        window.postMessage({ source: 'adsfriendly-spy', ...data }, '*');
    }

    // 4. Listen for control signals (Using CustomEvent for instant delivery)
    window.addEventListener('ADSFRIENDLY_ACTIVATE_SKIP', () => {
        if (!isAdMode) return; // PULSE GUARD: Don't hammer the main video!

        const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
        if (player) {
            console.log('[AdsFriendly Spy] API Bypass Triggered: Executing skip sequence...');
            
            try {
                player.focus();

                // 1. Persistent API Strike
                if (typeof player.skipAd === 'function') {
                    player.skipAd(true);
                }

                // 2. Internal Speed Hammer (Harder for YouTube to override)
                if (typeof player.setPlaybackRate === 'function') {
                    player.setPlaybackRate(16);
                    player.setVolume(0);
                }

                // 3. Fallback: Direct Video manipulation
                const video = player.querySelector('video');
                if (video) {
                    if (video.playbackRate < 16) video.playbackRate = 16;
                    video.muted = true;
                    
                    // If SSAI is blocking skipAd, try a targeted duration jump
                    // Note: Only jump if we are sure it's an ad segment (handled by content script state)
                }
            } catch (err) {
                console.error('[AdsFriendly Spy] Skip sequence failed:', err);
            }
        }
    });

    window.addEventListener('message', (event) => {
        if (event.data && event.data.source === 'adsfriendly-content') {
            if (event.data.type === 'SET_AD_MODE') {
                isAdMode = event.data.value;
                console.log('[AdsFriendly Spy] Ad mode changed:', isAdMode);
                
                const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
                
                if (isAdMode) {
                    // Start Ad Mode: Save volume if it's not already 0
                    if (player) {
                        if (typeof player.getVolume === 'function') {
                            const currentVol = player.getVolume();
                            if (currentVol > 0) userVolume = currentVol;
                        }
                        if (typeof player.isMuted === 'function') {
                            userWasMuted = player.isMuted();
                        }
                    }
                    
                    // v2.8.14: Take snapshot of all video states before hammering
                    snapshotAudioState();

                    // PERSISTENT SPEED HAMMER: 100ms Frequency
                    if (!hammerInterval) {
                        hammerInterval = originalInterval(() => {
                            if (!isAdMode) return;
                            try {
                                const activeVideos = getTrackedAdVideos();
                                
                                activeVideos.forEach(v => {
                                    if (!v || v.duration === 0) return;
                                     
                                    // 1. Force Speed
                                    if (v.playbackRate !== 16) v.playbackRate = 16;
                                    if (!('adsfriendlyPrevMuted' in v.dataset)) {
                                        v.dataset.adsfriendlyPrevMuted = v.muted ? '1' : '0';
                                    }
                                    v.muted = true;
                                    v.dataset.adsfriendlySpyTouched = '1';

                                    // 2. Instant Leap only when the stream is actually seekable.
                                    const canSeek = v.seekable && v.seekable.length > 0 && Number.isFinite(v.duration);
                                    if (canSeek && v.duration < 65) {
                                        v.currentTime = v.duration - 0.1;
                                    }
                                });

                                // YouTube API fallback
                                const playerShowingAd =
                                    player &&
                                    ((typeof player.isAdShowing === 'function' && player.isAdShowing()) ||
                                     player.classList.contains('ad-showing'));

                                if (playerShowingAd && typeof player.setPlaybackRate === 'function' && player.getPlaybackRate() !== 16) {
                                    player.setPlaybackRate(16);
                                    player.setVolume(0);
                                }
                            } catch (e) {}
                        }, 100);
                    }
                } else {
                    // STOP Ad Mode: RESTORE everything
                    if (hammerInterval) {
                        clearInterval(hammerInterval);
                        hammerInterval = null;
                    }

                    // v2.8.14: Recovery Pulse (Restore audio iteratively over 1s)
                    const pulseRestore = () => {
                        if (isAdMode) return;
                        
                        // 1. Restore generic videos based on snapshot (Smart Recovery)
                        restoreAudioState();

                        // 2. Fallback for videos we touched directly
                        document.querySelectorAll('video[data-adsfriendly-spy-touched="1"], video[data-adsfriendly-ad-active="1"]').forEach(v => {
                            if (v.playbackRate === 16) v.playbackRate = 1.0;
                            v.muted = v.dataset.adsfriendlyPrevMuted === '1';
                            delete v.dataset.adsfriendlySpyTouched;
                            delete v.dataset.adsfriendlyPrevMuted;
                        });

                        // 3. YouTube API Restoration
                        if (player) {
                            try {
                                if (!userWasMuted && typeof player.unMute === 'function') player.unMute();
                                if (userWasMuted && typeof player.mute === 'function') player.mute();
                                if (typeof player.setPlaybackRate === 'function') player.setPlaybackRate(1);
                                if (typeof player.setVolume === 'function') player.setVolume(userVolume);
                            } catch (e) {}
                        }
                    };

                    // Execute pulse at 0ms, 100ms, 300ms, 600ms, 1000ms
                    [0, 100, 300, 600, 1000].forEach(delay => originalTimeout(pulseRestore, delay));
                }
            }
        }
    });

})();
