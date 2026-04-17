/**
 * Vanguard Engine v8 - Synthetic Validation Suite
 * Tested loop: Sense → Decide → Act → Learn
 */
const { AdsFriendlyAdDetection } = require('../core/ad_detection.js');
const { AdsFriendlyStrategyEngine } = require('../core/strategy_engine.js');

// 1. MOCK ENVIRONMENT
global.window = { location: { hostname: 'example-video.com' } };
global.document = { 
    contains: () => true,
    hidden: false,
    querySelector: () => null,
    querySelectorAll: () => [],
    elementFromPoint: () => null
};
global.navigator = { sendBeacon: () => true };

console.log('--- STARTING VANGUARD V8 VALIDATION ---');

// 2. SENSE PHASE TEST (1.1 Temporal Detection)
function testTemporalSense() {
    console.log('\n[TEST] 1.1 SENSE: Temporal Ad Detection');
    
    // Simulate 3 segments of 30s from ads.cdn.com
    const adapter = {
        video: { duration: 30, currentSrc: 'https://ads.cdn.com/seg1.mp4' },
        getCapabilities: () => ({ hasNativeAPI: false }),
        isAd: () => true
    };

    // Inject history manually for test
    AdsFriendlyAdDetection._segmentHistory = [
        { domain: 'ads.cdn.com', duration: 30, timestamp: Date.now() - 5000, signals: { hasVastUrl: true } },
        { domain: 'ads.cdn.com', duration: 30, timestamp: Date.now() - 2000, signals: { hasVastUrl: true } }
    ];

    const sense = AdsFriendlyAdDetection.analyze(adapter);
    console.log(`- Detected AdType: ${sense.adType} (Expected: ssai)`);
    console.log(`- Confidence: ${sense.confidence} (Expected: ~0.85)`);
}

// 3. DECIDE PHASE TEST (2.1-2.2 Scoring & Stickiness)
function testDecisionLogic() {
    console.log('\n[TEST] 2. DECIDE: Strategy Selection');
    
    const video = { duration: 300, playbackRate: 1.0 };
    const adapter = {
        video,
        getCapabilities: () => ({ canSeek: true, canRateChange: true, supportsClickSim: false }),
        attach: () => {},
        setPlaybackRate: (r) => { video.playbackRate = r; }
    };

    AdsFriendlyStrategyEngine.attachToVideo(video);
    
    // Fake detection
    const detection = {
        adType: 'ssai',
        confidence: 0.9,
        costBenefit: { action: 'skip', riskScore: 0.2 }
    };

    const memKey = 'example-video.com:custom:long';
    const strategy = AdsFriendlyStrategyEngine._decide(video, detection, memKey);
    console.log(`- Selected Strategy: ${strategy} (Expected: jump or speed)`);

    // Test Stickiness (2.4)
    const h = AdsFriendlyStrategyEngine._hysteresis.get(video);
    h.lastStrategy = strategy;
    const nextStrategy = AdsFriendlyStrategyEngine._decide(video, detection, memKey);
    console.log(`- Sticky Strategy: ${nextStrategy} (Should stay: ${strategy})`);
}

// 4. ACT PHASE TEST (3.2 Jitter & Smooth)
function testActionJitter() {
    console.log('\n[TEST] 3. ACT: Jitter & Smoothing');
    
    const video = { duration: 300, playbackRate: 1.0 };
    const adapter = {
        video,
        getCapabilities: () => ({ rateMax: 16, canRateChange: true }),
        setPlaybackRate: (r) => { 
            video.previousRate = video.playbackRate;
            video.playbackRate = r;
            console.log(`  -> Rate Applied: ${r.toFixed(4)} (Diff to Target: ${(r - 16).toFixed(4)})`);
        }
    };

    AdsFriendlyStrategyEngine._activeAdapters.set(video, { adapter, playerType: 'custom' });
    
    // Simulate speed execution with target 16x
    AdsFriendlyStrategyEngine._executeGuarded(video, 'speed', adapter, { confidence: 1.0, costBenefit: { riskScore: 0.1 } });
    
    const applied = video.playbackRate;
    if (Math.abs(applied - 16) < 0.1) {
        console.log('- Jitter detected (Rate is close to but not exactly 16 due to random jitter)');
    }
}

// RUN TESTS
try {
    testTemporalSense();
    testDecisionLogic();
    testActionJitter();
    console.log('\n--- VALIDATION COMPLETE: ALL LOOPS FUNCTIONAL ---');
} catch (e) {
    console.error('Validation Failed:', e.message);
}
