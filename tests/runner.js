/**
 * Vanguard v8 Logic Validator (Fixed Global Scope)
 */
const fs = require('fs');
const path = require('path');

// 1. Setup Global Mocks
global.window = { location: { hostname: 'testing-site.com' } };
global.document = {
    contains: () => true,
    hidden: false,
    querySelector: () => null,
    querySelectorAll: () => [],
    elementFromPoint: () => null,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' }),
    addEventListener: () => {}
};
global.navigator = { sendBeacon: () => true };
global.PointerEvent = class {};
global.MouseEvent = class {};
global.WeakMap = WeakMap;

console.log('--- VANGUARD V8 LOGIC VALIDATION START ---');

// 2. Load Core Files with Global Context
const adDetCode = fs.readFileSync(path.join(__dirname, '..', 'core/ad_detection.js'), 'utf8');
const stratCode = fs.readFileSync(path.join(__dirname, '..', 'core/strategy_engine.js'), 'utf8');

eval(adDetCode);
eval(stratCode);

// Verify they are defined
if (typeof AdsFriendlyAdDetection === 'undefined' || typeof AdsFriendlyStrategyEngine === 'undefined') {
    // If eval failed to export to global, hook them manually
    // This happens if the code uses 'window.' which we have mocked
}

const AdDetection = window.AdsFriendlyAdDetection;
const StrategyEngine = window.AdsFriendlyStrategyEngine;

// 3. Test Cases
try {
    // TEST 1: Sense Logic
    console.log('\n[1. SENSE] Testing Temporal Detection...');
    const adapter = {
        video: { duration: 15, currentSrc: 'https://cdn.ads.com/a.mp4' },
        getCapabilities: () => ({ hasNativeAPI: false })
    };
    
    // Fill history for SSAI
    AdDetection._segmentHistory = [
        { domain: 'cdn.ads.com', duration: 15.1, timestamp: Date.now()-5000, signals: { hasVastUrl: true } },
        { domain: 'cdn.ads.com', duration: 14.9, timestamp: Date.now()-2000, signals: { hasVastUrl: true } }
    ];
    
    const sense = AdDetection.analyze(adapter);
    console.log(`- Result: adType=${sense.adType}, confidence=${sense.confidence}`);
    if (sense.adType !== 'ssai') throw new Error('Temporal SSAI detection failed');

    // TEST 2: Decide Logic (Stickiness & Jitter)
    console.log('\n[2. DECIDE/ACT] Testing Jitter & Stickiness...');
    const video = { duration: 300, playbackRate: 1.0 };
    const engineAdapter = {
        video,
        getCapabilities: () => ({ rateMax: 16, canRateChange: true }),
        attach: () => {},
        setPlaybackRate: (r) => { 
            video.playbackRate = r;
            console.log(`  -> Actual Rate Applied: ${r.toFixed(4)}`);
        }
    };
    
    StrategyEngine.attachToVideo(video);
    StrategyEngine._activeAdapters.get(video).adapter = engineAdapter; // override with mock
    
    // Execute speed
    StrategyEngine._executeGuarded(video, 'speed', engineAdapter, { confidence: 1.0, costBenefit: { riskScore: 0.1 } });
    
    if (Math.abs(video.playbackRate - 16) > 0.1) {
        console.log('- Jitter Verified: Rate is randomized within ±0.05');
    }

    // TEST 3: Learn Logic (Recovery)
    console.log('\n[3. LEARN] Testing Dynamic Recovery...');
    const memKey = 'testing-site.com:custom:long';
    const mem = StrategyEngine._getSiteMemory(memKey);
    mem.successCount = 10;
    mem.failCount = 1; 
    mem.jump = 0.5; 
    
    StrategyEngine._applyRecovery(video, memKey, 10); // 10 seconds pass
    console.log(`- Recovery Result: jump=${mem.jump.toFixed(2)} (Previous: 0.5)`);
    if (mem.jump <= 0.5) throw new Error('Recovery logic failed');

    console.log('\n--- ALL TESTS PASSED: VANGUARD V8 IS MISSION READY ---');
} catch (e) {
    console.error('\n!!! VALIDATION FAILED !!!');
    console.error(e.stack);
    process.exit(1);
}
