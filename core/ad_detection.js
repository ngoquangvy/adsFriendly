/**
 * AdsFriendly: Ad Detection Layer v5.0 (Vanguard Sense)
 *
 * SENSE Layer:
 * 1.1 Temporal Detection (SSAI logic)
 * 1.2 Time-to-impact (Remaining + Dead Zone v2)
 * 1.3 Context Risk Scoring
 */
window.AdsFriendlyAdDetection = {

    _segmentHistory: [],
    _HISTORY_WINDOW_MS: 60_000,
    _pastFailures: {},

    // Thresholds
    SKIP_WORTH_THRESHOLD_SEC: 8,
    SKIP_HIGH_VALUE_SEC: 20,

    /**
     * 8. Toàn bộ loop - TICK: Sense phase
     */
    analyze(adapter) {
        const video = adapter.video;
        const caps  = adapter.getCapabilities();
        
        // 1.1 SENSE - Collect Signals
        const signals = this._collectSignals(adapter, video, caps);
        this._updateSegmentHistory(video, signals);
        
        // 1.1 Temporal Detection
        const temporal = this._analyzeTemporalPattern(video, signals);
        
        // Final detection state
        const detection = this._classify(signals, temporal);

        // 1.2 & 1.3 Contextual analysis
        detection.costBenefit = this._calcCostBenefit(video, detection.confidence, detection.adType);
        detection.fingerprint = this._getFingerprint(adapter);

        return detection;
    },

    /**
     * 1.1 SENSE - Signals
     */
    _collectSignals(adapter, video, caps) {
        const src = video?.currentSrc || video?.src || '';
        return {
            hasDangerZone:     (typeof AdsFriendlyDangerZone !== 'undefined' && AdsFriendlyDangerZone.isInDangerZone(video)) ?? false,
            hasDiscontinuity:  !!(window._adsfriendlyLastM3U8?.includes('#EXT-X-DISCONTINUITY')),
            hasVastUrl:        /vast|vmap|\/ads\/|ad\./i.test(src),
            hasAdMarkerInUrl:  /\b(ads?|advert|preroll|midroll|postroll|sponsored)\b/i.test(src),
            hasTrackingPixel:  !!document.querySelector('img[src*="track"], img[src*="pixel"], img[src*="beacon"]'),
            hasAdClass:        ['#movie_player.ad-showing', '.html5-video-player.ad-showing', '.ad-interrupting', '[class*="ad-showing"]'].some(s => document.querySelector(s)),
            hasSkipButton:     !!document.querySelector('.ytp-skip-ad-button, .jw-skip, [class*="skip-ad"], .ytp-ad-skip-button-modern'),
            hasOverlayAd:      !!document.querySelector('.ytp-ad-overlay-container, [class*="ad-overlay"]'),
            isShortVideo:      video?.duration > 0 && video?.duration < 65,
            durationSec:       video?.duration ?? 0,
            isExternalSrc:     src && !src.startsWith('blob:') && !src.includes(window.location.hostname),
            srcDomain:         this._extractDomain(src),
            isUnseekable:      this._isUnseekable(video),
            hasNoControls:     video ? (!video.controls && !video.closest('[class*="controls"]')) : false,
            adapterSaysAd:     adapter.isAd?.() ?? false
        };
    },

    _isUnseekable(video) {
        if (!video) return false;
        try {
            const seekable = video.seekable;
            return (!seekable || seekable.length === 0) || (seekable.end(0) - seekable.start(0)) < 2.0;
        } catch { return true; }
    },

    _updateSegmentHistory(video, signals) {
        if (!signals.isShortVideo || !signals.isExternalSrc) return;
        this._segmentHistory.push({
            domain: signals.srcDomain, duration: signals.durationSec, timestamp: Date.now(),
            signals: signals
        });
        const now = Date.now();
        this._segmentHistory = this._segmentHistory.filter(e => now - e.timestamp < this._HISTORY_WINDOW_MS);
    },

    /**
     * 1.1 Temporal Detection
     * Rule: domain ≠ page + duration ổn định ±1s + ≥30% segment có tín hiệu ad
     */
    _analyzeTemporalPattern(video, signals) {
        const history = this._segmentHistory;
        if (history.length < 2) return { hasPattern: false };
        
        const pageDomain = window.location.hostname;
        const byDomain = {};
        for (const e of history) {
            if (e.domain === pageDomain) continue;
            byDomain[e.domain] = byDomain[e.domain] || [];
            byDomain[e.domain].push(e);
        }

        for (const [domain, entries] of Object.entries(byDomain)) {
            if (entries.length < 2) continue;
            
            const durs = entries.map(e => e.duration);
            const avg  = durs.reduce((a, b) => a + b, 0) / durs.length;
            
            // + duration ổn định ±1s
            const isStable = durs.every(d => Math.abs(d - avg) <= 1.0);
            if (!isStable) continue;

            // + ≥30% segment có tín hiệu ad
            const adSignalCount = entries.filter(e => 
                e.signals.hasAdMarkerInUrl || e.signals.hasTrackingPixel || 
                e.signals.hasVastUrl || e.signals.isUnseekable || e.signals.hasNoControls
            ).length;
            const adSignalRatio = adSignalCount / entries.length;

            if (adSignalRatio >= 0.3) {
                return { hasPattern: true, isFalsePositive: false, repeatCount: entries.length, patternType: avg < 10 ? 'bumper_ad' : 'mid_roll' };
            } else {
                // anti false-positive (CDN filter)
                return { hasPattern: true, isFalsePositive: true, patternType: 'cdn_chunk' };
            }
        }
        return { hasPattern: false };
    },

    /**
     * 1.2 Time-to-impact & Dead Zone v2
     */
    _calcCostBenefit(video, confidence, adType) {
        const dur = video?.duration ?? 0;
        const current = video?.currentTime ?? 0;
        if (dur <= 0) return { action: 'wait', riskScore: 1 };

        const remaining = Math.max(0, dur - current);

        // Zone: remaining < 4s → WAIT
        if (remaining < 4) return { action: 'wait', remaining, reason: 'near_end', riskScore: 0.9 };

        const hostname = window.location.hostname;
        const pastFails = this._pastFailures[hostname] ?? 0;

        // Zone: 4–6s
        if (remaining < 6) {
            const riskLow = (1 - confidence) < 0.3 && pastFails < 1;
            if (riskLow) {
                return { action: 'skip', mode: 'gentle', suggestedRate: 1.35, remaining, riskScore: 0.3 };
            } else {
                return { action: 'safemode', remaining, riskScore: 0.7 };
            }
        }

        // 1.3 Context Risk Score
        // riskScore = detectionConfidence + pastFailures + adTypeWeight
        const detectionRisk = (1 - confidence);
        const failRisk      = Math.min(0.4, pastFails * 0.15);
        const adTypeWeight  = { ssai: 0.05, client: 0.1, overlay: 0.2, unknown: 0.25 }[adType] ?? 0.2;
        
        const riskScore = Math.min(1.0, detectionRisk + failRisk + adTypeWeight);

        return {
            action: riskScore > 0.7 ? 'safemode' : 'skip',
            remaining,
            riskScore: parseFloat(riskScore.toFixed(3)),
            worthIt: (remaining / Math.max(0.01, riskScore * 10)) > 1.0
        };
    },

    _classify(s, temporal) {
        let adType = 'unknown';
        let confidence = 0;
        if (temporal.hasPattern && !temporal.isFalsePositive) {
            adType = 'ssai'; confidence = temporal.repeatCount >= 3 ? 0.95 : 0.85;
        } else if (s.hasDangerZone || s.hasDiscontinuity) {
            adType = 'ssai'; confidence = 0.90;
        } else if (s.hasVastUrl || s.hasSkipButton) {
            adType = 'client'; confidence = 0.85;
        } else if (s.hasOverlayAd) {
            adType = 'overlay'; confidence = 0.80;
        }

        // Heuristics
        if (s.isUnseekable && s.hasNoControls) confidence = Math.min(1.0, confidence + 0.15);
        if (s.hasAdClass) confidence = Math.min(1.0, confidence + 0.1);
        if (s.adapterSaysAd) confidence = Math.min(1.0, confidence + 0.1);

        return { adType, confidence: parseFloat(confidence.toFixed(3)), signals: s };
    },

    _getFingerprint(adapter) {
        const parts = [adapter.getCapabilities().hasNativeAPI ? 'native' : 'generic'];
        const player = document.querySelector('#movie_player, .html5-video-player, [class*="jw-wrapper"]');
        if (player) parts.push(player.tagName, player.children.length, player.className.substring(0, 50));
        const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => this._extractDomain(s.src)).filter(d => /ad|vast|ima/i.test(d)).sort();
        parts.push(scripts.join(','));

        const str = parts.join('|');
        let similarity = 1.0;
        if (this._prevFingerprintRaw) {
            const prev = this._prevFingerprintRaw.split('|');
            let m = 0;
            for (let i = 0; i < Math.min(parts.length, prev.length); i++) if (parts[i] === prev[i]) m++;
            similarity = m / Math.max(parts.length, prev.length);
        }
        this._prevFingerprintRaw = str;
        
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
        return { hash: Math.abs(hash).toString(36), similarity };
    },

    recordFailure(h) { this._pastFailures[h] = (this._pastFailures[h] ?? 0) + 1; },
    recordSuccess(h) { this._pastFailures[h] = Math.max(0, (this._pastFailures[h] ?? 0) - 0.5); },
    _extractDomain(s) { try { return new URL(s, location.href).hostname; } catch { return 'unknown'; } }
};
