// core/modules/xhr_radar.js
/**
 * AdsFriendly: XHR Radar (The Universal Genome Decoder)
 * Intercepts network payloads to detect DangerZones in M3U8 and JSON metadata.
 * REQUIRES: proxy_shield.js must be concatenated FIRST in the same IIFE scope.
 *   - Uses: originalInterval, isAdMode, lastKnownState, getTrackedAdVideos, syncToLocalRadar, notifyContentScript
 */
console.log('[AdsFriendly Spy] XHR Radar Active.');
const originalFetch = window.fetch;
const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;

// Capture Redirect Intent
window.addEventListener('beforeunload', () => {
    if (typeof isAdMode !== 'undefined' && isAdMode) {
         const payloadData = {
            reason: 'PAGE_UNLOAD_DURING_AD',
            finalRate: typeof lastKnownState !== 'undefined' ? lastKnownState.playbackRate : 1.0,
            activeVideos: typeof getTrackedAdVideos === 'function' ? getTrackedAdVideos().length : 0,
            url: window.location.href
        };

        try {
            localStorage.setItem('ADS_CRASH', JSON.stringify({
                timestamp: Date.now(),
                state: typeof lastKnownState !== 'undefined' ? lastKnownState : {},
                payload: payloadData
            }));
        } catch (e) {}

        if (typeof syncToLocalRadar === 'function') syncToLocalRadar('DIAGNOSTIC_REDIRECT', window.location.href, payloadData);
        console.log('%c[AdsFriendly Spy] Unload detected during Ad Mode. Recording state...', "color: #ef4444; font-weight: bold;");
        
        try {
            const beaconPayload = JSON.stringify({
                identity: {
                    site_domain: window.location.hostname || 'unknown-origin',
                    session_id: 'SPY_RADAR_BEACON',
                    provider_type: 'RAW_NETWORK'
                },
                type: 'DIAGNOSTIC_REDIRECT',
                data: payloadData,
                timestamp: Date.now()
            });
            navigator.sendBeacon('http://localhost:3000/telemetry', beaconPayload);
        } catch (e) {}
    }
});

if (typeof originalInterval !== 'undefined') {
    originalInterval(() => {
        if (typeof isAdMode !== 'undefined' && isAdMode && typeof syncToLocalRadar === 'function') {
            syncToLocalRadar('HEARTBEAT', window.location.href, {
                state: typeof lastKnownState !== 'undefined' ? lastKnownState : {},
                url: window.location.href
            });
        }
    }, 5000);
}

const METADATA_PATTERNS = [
    '.m3u8', '.mpd', '.m3u', '.ism', '.f4m',
    'youtubei/v1/player', 'player/v1/player', 
    '/manifest/', 'playlist', 'master', 'chunklist',
    'stream', 'api/v', 'v1/', 'v2/', 'v3/', 'metadata',
    'get_video_info', 'mediadata'
];

function isMetadata(url) {
    if (!url || typeof url !== 'string') return false;
    return METADATA_PATTERNS.some(p => url.includes(p));
}

// --- Universal Genome Decoder (DNA Distillation) ---
const AD_DNA_SEEDS = {
    'adPlacements': 0.9,
    'vast': 0.9,
    'vmap': 0.9,
    'adbreak': 0.9,
    'skipOffset': 0.7,
    'midroll': 0.7,
    'preroll': 0.7,
    'linear': 0.5
};
const AD_DNA_INDICATORS = ['.xml', '.vast', 'googlesyndication', 'doubleclick'];
const hlsTimelineState = new Map();

function mergeOverlappingZones(zones) {
    if (!zones.length) return [];
    zones.sort((a, b) => a.start - b.start);
    const merged = [zones[0]];
    for (let i = 1; i < zones.length; i++) {
        const last = merged[merged.length - 1];
        const current = zones[i];
        if (current.start <= last.end) {
            last.end = Math.max(last.end, current.end);
        } else {
            merged.push(current);
        }
    }
    return merged;
}

function discoverDangerZones(obj, depth = 0, parentObj = null) {
    if (depth > 10 || !obj || typeof obj !== 'object') return [];
    let zones = [];
    for (const key in obj) {
        const value = obj[key];
        let seedConfidence = AD_DNA_SEEDS[key] || 0;
        let isIndicator = typeof value === 'string' && AD_DNA_INDICATORS.some(ind => value.includes(ind));
        if (seedConfidence > 0 || isIndicator) {
            const candidateNumbers = [];
            const scanContexts = [obj];
            if (parentObj) scanContexts.push(parentObj);
            scanContexts.forEach(ctx => {
                for (const k in ctx) {
                    const val = parseFloat(ctx[k]);
                    if (!isNaN(val) && typeof ctx[k] !== 'boolean') {
                        candidateNumbers.push({ key: k.toLowerCase(), value: val });
                    }
                }
            });
            if (candidateNumbers.length > 0) {
                let start = null; let duration = null; let unitUsed = 'sec';
                candidateNumbers.forEach(n => {
                    if (n.value > 1000) unitUsed = 'ms';
                    const v = n.value > 1000 ? n.value / 1000 : n.value;
                    if (n.key.includes('offset') || n.key.includes('start') || n.key.includes('begin')) start = v;
                    else if (n.key.includes('duration') || n.key.includes('length') || n.key.includes('time')) duration = v;
                });
                if (start !== null) {
                    zones.push({
                        start: start,
                        end: start + (duration || 30),
                        confidence: seedConfidence || 0.5,
                        metadata: { dna_keys: [key], discovery_depth: depth, time_unit_detected: unitUsed }
                    });
                }
            }
        }
        if (value && typeof value === 'object') {
            zones = zones.concat(discoverDangerZones(value, depth + 1, obj));
        }
    }
    return zones;
}

function syncToLocalRadar(type, url, content) {
    if (!url || !content) return;
    
    const payload = { 
        source: 'adsfriendly-spy',
        type: 'DEBUG_LOG',
        logType: type,
        identity: {
            site_domain: window.location.hostname || 'unknown-origin',
            session_id: 'SPY_RADAR_DIRECT',
            provider_type: 'RAW_NETWORK'
        },
        data: {
            url: url,
            content: typeof content === 'object' ? content : content.toString() 
        },
        timestamp: Date.now()
    };

    window.postMessage(payload, '*');

    try {
        navigator.sendBeacon('http://localhost:3000/telemetry', JSON.stringify({
            identity: payload.identity,
            type: 'DEBUG_LOG',
            data: { url: url, state: { logType: type, payload: content } }
        }));
    } catch (e) {}
}

function logRadar(type, url, body) {
    const analysis = analyzeContent(url, body);
    
    window.adsFriendlySniffer = window.adsFriendlySniffer || [];
    window.adsFriendlySniffer.push({ type, url, analysis, content: body, time: new Date().toLocaleTimeString() });

    if (analysis.hasAd) {
        console.log(`%c[AdsFriendly Radar] ${analysis.format} HIT`, 'background: #ef4444; color: #fff; padding: 2px 5px; border-radius: 3px;', url.split('?')[0]);
        console.log(`%c[!] Bắt được dấu vết quảng cáo (${analysis.marker})`, "color: #ef4444; font-weight: bold;");
        if (analysis.zones && analysis.zones.length > 0) {
            console.log(`%c[Genome] Danger Zones:`, "color: #f59e0b;", analysis.zones);
            if (typeof notifyContentScript === 'function') notifyContentScript({ type: 'AD_MAP_DETECTED', provider: analysis.format, zones: analysis.zones });
        }
    }

    syncToLocalRadar(type, url, body);
}

function analyzeContent(url, body) {
    if (!body) return { hasAd: false, format: 'UNKNOWN', zones: [] };
    if (typeof body === 'object' || (typeof body === 'string' && body.trim().startsWith('{'))) {
        try {
            const json = typeof body === 'string' ? JSON.parse(body) : body;
            let zones = discoverDangerZones(json);
            const fuzzyBuffer = 0.5;
            zones = zones.map(z => ({ start: Math.max(0, z.start - fuzzyBuffer), end: z.end + fuzzyBuffer }));
            zones = mergeOverlappingZones(zones);
            return { hasAd: zones.length > 0, format: 'UNIVERSAL/JSON', zones, marker: zones.length > 0 ? 'GENOME_MATCH' : null };
        } catch (e) {}
    }
    if (typeof body === 'string' && body.includes('#EXTM3U')) {
        let mediaSeq = 0; let currentTime = 0; let zones = []; let inAdBlock = false; let adStart = 0;
        const fuzzyBuffer = 0.5;
        const lines = body.split('\n');
        lines.forEach(line => {
            if (line.includes('#EXT-X-MEDIA-SEQUENCE:')) mediaSeq = parseInt(line.split(':')[1]);
            else if (line.includes('#EXTINF:')) {
                const duration = parseFloat(line.split(':')[1]);
                if (!isNaN(duration)) currentTime += duration;
            } else if (line.includes('#EXT-X-DISCONTINUITY') || line.includes('#EXT-X-CUE-OUT')) {
                if (!inAdBlock) { inAdBlock = true; adStart = currentTime; }
                else { inAdBlock = false; zones.push({ start: Math.max(0, adStart - fuzzyBuffer), end: currentTime + fuzzyBuffer }); }
            }
        });
        if (inAdBlock) {
            zones.push({ start: Math.max(0, adStart - fuzzyBuffer), end: currentTime + 60 });
        }
        if (mediaSeq > 0) {
            const streamKey = url.split('?')[0];
            const state = hlsTimelineState.get(streamKey) || { firstSeq: mediaSeq, baseTime: 0, lastSeq: mediaSeq, lastManifestDuration: 0 };
            if (mediaSeq > state.lastSeq) {
                const avgSeg = state.lastManifestDuration / 10;
                const drift = (mediaSeq - state.lastSeq) * (avgSeg || 2); 
                state.baseTime += drift;
            }
            zones = zones.map(z => ({ start: z.start + state.baseTime, end: z.end + state.baseTime }));
            state.lastSeq = mediaSeq; state.lastManifestDuration = currentTime;
            hlsTimelineState.set(streamKey, state);
        }
        const hasAd = zones.length > 0 || body.includes('#EXT-X-CUE-OUT');
        return { hasAd, format: 'HLS/M3U8', zones, marker: zones.length > 0 ? 'DISCONTINUITY_SEQUENCE' : (hasAd ? 'CUE_MARKER' : null) };
    }
    return { hasAd: false, format: 'TEXT/OTHER', zones: [] };
}

window.fetch = async function(...args) {
    let url = (args[0] instanceof Request) ? args[0].url : args[0].toString();
    const response = await originalFetch(...args);
    if (isMetadata(url)) {
        const clone = response.clone();
        clone.text().then(body => logRadar("FETCH", url, body)).catch(() => {});
    }
    return response;
};

XMLHttpRequest.prototype.open = function(method, url) {
    this._adsfriendly_url = url;
    return originalXHROpen.apply(this, arguments);
};

XMLHttpRequest.prototype.send = function(body) {
    const url = this._adsfriendly_url;
    if (url && isMetadata(url)) {
        this.addEventListener('load', () => {
            const responseData = this.responseText;
            if (responseData) logRadar("XHR", url, responseData);
        });
    }
    return originalXHRSend.apply(this, arguments);
};

// Monitor internal player variables
if (typeof originalInterval !== 'undefined') {
    originalInterval(() => {
        const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
        if (player) {
            const state = {
                adShowing: typeof player.isAdShowing === 'function' ? player.isAdShowing() : null,
                videoData: typeof player.getVideoData === 'function' ? { id: player.getVideoData().video_id, author: player.getVideoData().author } : null,
                presentState: player.getPresentingState ? player.getPresentingState() : null
            };
            if (state.adShowing && typeof notifyContentScript === 'function') notifyContentScript({ type: 'PLAYER_STATE_HARVEST', state });
        }
    }, 2000);
}
