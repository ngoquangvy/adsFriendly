// engine/hub/orchestrator.js
/**
 * 🧭 Vanguard Runtime Pipeline (Stable Contract)
 * raw_event -> feature_vector -> score -> decision
 */

const domainState = new Map(); // behavior memory
const patternMemory = new Map(); // pattern memory: key -> { count, firstSeen, lastSeen }
const noiseSuppressionMap = new Map(); // Step 3: Noise Suppression (403, Aborted)
const MAX_PATTERNS = 500;

const Orchestrator = {
    async process(event) {
        try {
            const brain = window.Engine.brain;
            const policy = window.Engine.policy;
            if (!brain || !brain.Classifier) throw new Error('Brain Infrastructure missing');

            // 1. Technical Normalization (Radar logic moved here)
            const url = this._normalize(event.url);
            const domain = brain.Classifier.extractDomain(url);
            const domainClass = brain.Classifier.classify(url);
            const now = Date.now();

            // --- 🛡️ LAYER 0: PLATFORM PROTECTION (Hard Early Return) ---
            const PROTECTED_DOMAINS = ['youtube.com', 'google.com', 'gstatic.com', 'googleusercontent.com'];
            const isProtected = PROTECTED_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`));
            
            if (isProtected && domainClass !== 'ads_network') {
                return {
                    schema_v: "14.0",
                    url, domain, 
                    label_pred: 'SAFE', 
                    label_true: 'INTERNAL',
                    action: 'ALLOW', 
                    score: 0, 
                    confidence: 1.0, 
                    features: {},
                    context: { domainClass: 'protected_platform' },
                    raw: { method: event.method ?? 'GET', type: event.type ?? 'unknown', isError: false },
                    timestamp: now, 
                    flags: ['PLATFORM_WHITELIST']
                };
            }

            // 2. Behavioral State Init
            let state = domainState.get(domain) || { 
                lastSeen: 0, 
                frequency: 0, 
                lastScores: [], 
                reputation: 0,
                confirmedLabel: 'SAFE' 
            };
            const timeDiff = (now - state.lastSeen) / 1000;
            if (timeDiff > 0) state.frequency = (state.frequency * 0.8) + (1 / timeDiff) * 0.2;
            state.lastSeen = now;

            // 3. Pattern Intelligence
            const normalizedPath = this._extractPath(url);
            const patternKey = `${domain}|${normalizedPath}|${event.type}`;
            this.updatePattern(patternKey, now);
            const pattern = patternMemory.get(patternKey);

            // 🚫 FAST PATH: Media Bypass (Business logic handled by Classifier)
            if (domainClass === 'media_cdn' || features.context.isPlayerContext) {
                state.frequency = (state.frequency * 0.9) + 0.1;
                domainState.set(domain, state);

                const res = {
                    schema_v: "15.0",
                    url, domain, 
                    label_pred: 'MEDIA_PASS', label_true: 'MEDIA',
                    action: 'ALLOW', score: 0, confidence: 1.0, 
                    features: {}, context: { domainClass: 'media_cdn' },
                    raw: { method: 'GET', type: 'media', isError: false },
                    timestamp: now
                };
                if (window.Engine?.brainBridge) window.Engine.brainBridge.recordDecision(res);
                return res;
            }

            // --- 4. ENGINE CORE (Scoring & Policy) ---
            const cleanRaw = {
                url, domain, domainClass,
                method: event.method || 'GET',
                type: event.type || 'unknown',
                stack: event.stack,
                frameType: window.top === window.self ? 'main' : 'iframe'
            };

            const featuresV15 = brain.Extractor.extract(cleanRaw, state);
            const rawScore = brain.Scoring.compute(featuresV15, brain.Weights);

            // 🕒 Reputation Smoothing (v15.0 Generalized)
            state.reputation = (state.reputation * 0.75) + (rawScore * 0.25);

            // 5. Policy Decision (Source of Truth)
            const decision = policy.Runner.evaluate(rawScore, { 
                domainClass,
                session: featuresV15.session,
                pattern,
                burstDetected: state.frequency > 5
            });

            // --- 6. SMOOTHING LAYER (State Persistence) ---
            state.confirmedLabel = decision.label;
            domainState.set(domain, state);
            this.purgeMemory(now, state.frequency > 5);

            // 🧬 Ground Truth Inference (for training & evaluation)
            const isHeuristicAd = featuresV15.v2.network.hasAdKeywords || domainClass === 'ads_network';

            const finalRes = {
                schema_v: "15.0",
                telemetry_schema_version: "v1.0",
                label: state.confirmedLabel || 'unknown',
                url: event.url || 'unknown',
                domain: domain || 'unknown',
                label_pred: state.confirmedLabel || 'unknown',
                label_true: isHeuristicAd ? 'ADS' : (featuresV15.context.isPlayerContext ? 'MEDIA' : 'UNKNOWN'),
                action: decision.action || 'ALLOW',
                score: parseFloat(rawScore.toFixed(3)),
                confidence: decision.confidence,
                flags: decision.flags || [],
                features: featuresV15.v2 || {},
                context: {
                    domainClass: featuresV15.domainClass || 'unknown',
                    session: featuresV15.session || 'default',
                    patternCount: pattern?.count || 0,
                    frequency: parseFloat(state.frequency.toFixed(3)) || 0,
                    reputation: parseFloat(state.reputation.toFixed(3)) || 0
                },
                raw: {
                    method: event.method || 'GET',
                    type: event.type || 'unknown',
                    isError: event.isError || false
                },
                timestamp: now
            };

            if (window.Engine?.brainBridge) window.Engine.brainBridge.recordDecision(finalRes);
            return finalRes;
        } catch (e) {
            console.error('[Orchestrator] Kernel Panic:', e);
            return { 
                schema_v: "14.0",
                url: event.url || 'unknown',
                domain: (new URL(event.url || 'http://unknown')).hostname,
                label_pred: 'ERROR', 
                label_true: 'UNKNOWN',
                action: 'ALLOW', 
                score: 0, confidence: 0, 
                timestamp: Date.now(), 
                error: e.message 
            };
        }
    },

    _normalize(url) {
        if (!url || typeof url !== 'string') return url;
        let u = url;
        if (u.startsWith('//')) u = window.location.protocol + u;
        if (u.startsWith('/')) u = window.location.origin + u;
        return u;
    },

    _extractPath(url) {
        try {
            return new URL(url).pathname;
        } catch (e) {
            return url.split('?')[0];
        }
    },

    updatePattern(key, now) {
        let p = patternMemory.get(key) || { count: 0, firstSeen: now, lastSeen: now };
        p.count++;
        p.lastSeen = now;
        patternMemory.set(key, p);
    },

    purgeMemory(now, burstDetected) {
        const ttl = burstDetected ? 120000 : 30000;
        if (patternMemory.size > MAX_PATTERNS) {
            const oldestKey = patternMemory.keys().next().value;
            patternMemory.delete(oldestKey);
        }
        for (const [key, p] of patternMemory) {
            if (now - p.lastSeen > ttl) patternMemory.delete(key);
        }
    }
};

// Global Exposure
if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.hub = window.Engine.hub || {};
    window.Engine.hub.Orchestrator = Orchestrator;
    window.__NEW_ENGINE__ = { enabled: true };
}
