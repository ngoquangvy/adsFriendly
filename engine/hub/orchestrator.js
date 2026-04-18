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
                    url, domain, label: 'SAFE', action: 'ALLOW', score: 0, 
                    confidence: 1.0, timestamp: now, flags: ['PLATFORM_WHITELIST'] 
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
            if (domainClass === 'media_cdn') {
                state.frequency = (state.frequency * 0.9) + 0.1;
                domainState.set(domain, state);

                const res = { 
                    url, domain, label: 'MEDIA_PASS', action: 'ALLOW', score: 0, 
                    confidence: 1.0, timestamp: now, meta: { isMedia: true } 
                };
                
                // Telemetry fallback for fast path
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

            const features = brain.Extractor.extract(cleanRaw, state);
            const rawScore = brain.Scoring.compute(features, brain.Weights);

            // 🕒 Score Decay & Smoothing
            state.lastScores = state.lastScores.map(s => s * 0.95);
            state.lastScores.push(rawScore);
            if (state.lastScores.length > 5) state.lastScores.shift();
            const smoothedScore = state.lastScores.reduce((a, b) => a + b, 0) / state.lastScores.length;
            
            // Reputation (Class-Aware)
            if (domainClass === 'ads_network') {
                state.reputation = state.reputation * 0.8 + smoothedScore * 0.2;
            } else {
                state.reputation = state.reputation * 0.95 + smoothedScore * 0.05;
            }

            // 5. Policy Decision (Source of Truth)
            const decision = policy.Runner.evaluate(smoothedScore, { 
                domainClass,
                session: features.session,
                pattern,
                burstDetected: state.frequency > 5
            });

            // --- 6. SMOOTHING LAYER (State Persistence) ---
            const highRiskRatio = state.lastScores.filter(s => s > 0.7).length / state.lastScores.length;
            
            // Only use persistent high_risk if consensus is strong
            let finalLabel = decision.label;
            if (highRiskRatio >= 0.6 && state.lastScores.length >= 5) {
                finalLabel = 'HIGH_RISK';
            } else if (smoothedScore < 0.2) {
                finalLabel = 'SAFE'; // Fast recovery
            }

            state.confirmedLabel = finalLabel;
            domainState.set(domain, state);
            this.purgeMemory(now, state.frequency > 5);

            // Calculate patternScore
            const patternScore = pattern ? (pattern.lastSeen - pattern.firstSeen) / 1000 : 0;

            // 3-Layer Telemetry Structure
            const finalRes = {
                timestamp: now,

                // 🔍 RAW (debuggable)
                raw: {
                    url: event.url,
                    method: event.method || 'GET',
                    type: event.type || 'unknown',
                    isError: event.isError || false
                },

                // 🧠 FEATURES (ML input)
                features: features.v2,

                // 🌐 CONTEXT (behavioral understanding)
                context: {
                    domain,
                    domainClass: features.domainClass,
                    session: features.session,
                    patternCount: pattern?.count || 0,
                    patternScore: parseFloat(patternScore.toFixed(2)),
                    frequency: parseFloat(state.frequency.toFixed(3)),
                    reputation: parseFloat(state.reputation.toFixed(3))
                },

                // 🎯 DECISION (output)
                decision: {
                    score: parseFloat(smoothedScore.toFixed(2)),
                    confidence: parseFloat((decision.confidence || 0).toFixed(2)),
                    label: state.confirmedLabel,
                    action: decision.action,
                    flags: decision.flags || []
                },

                // ⚡ META
                meta: {
                    isHighFrequency: state.frequency > 5
                }
            };

            if (window.Engine?.brainBridge) window.Engine.brainBridge.recordDecision(finalRes);
            return finalRes;
        } catch (e) {
            console.error('[Orchestrator] Kernel Panic:', e);
            return { error: e.message, score: 0, label: 'ERROR', action: 'ALLOW' };
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
