// engine/hub/orchestrator.js
/**
 * 🧭 Vanguard Runtime Pipeline (v16.14 - Titan Final Edition)
 * Architecture: Deterministic Forensic Black-Box with Atomic Epochs & Scoped Identity.
 */

// --- 🛠️ INTERNAL HELPERS ---
function deepSort(obj) {
    if (Array.isArray(obj)) return obj.map(deepSort);
    if (obj !== null && typeof obj === "object") {
        return Object.keys(obj).sort().reduce((acc, key) => {
            acc[key] = deepSort(obj[key]);
            return acc;
        }, {});
    }
    return obj;
}

function deepFreeze(obj) {
    Object.getOwnPropertyNames(obj).forEach((prop) => {
        if (obj[prop] !== null && (typeof obj[prop] === "object" || typeof obj[prop] === "function") && !Object.isFrozen(obj[prop])) {
            deepFreeze(obj[prop]);
        }
    });
    return Object.freeze(obj);
}

function generateStableHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash) + str.charCodeAt(i);
    return (hash >>> 0).toString(16);
}

// --- 🏛️ ARCHITECTURAL ANCHORS ---
let FROZEN_SCHEMA = null;
let SCHEMA_HASH = 'pending';
let STABLE_HASH = 'pending';
const ENGINE_VERSION = "v16.14";

/** 🛡️ v16.14 NULL SAFETY CONTRACT: Never return null out of the engine */
const TITAN_NULL_RESULT = (reason, domain = 'unknown', event = {}) => ({
    eventId: event.eventId || '',
    epoch: event.epoch || 0,
    engine_v: ENGINE_VERSION,
    label_pred: 'SKIPPED',
    action: 'ALLOW',
    score: 0,
    confidence: 0,
    isDeterministic: true,
    skipReason: reason,
    domain,
    timestamp: event.timestamp || Date.now()
});

const Orchestrator = {
    _initSchema() {
        if (FROZEN_SCHEMA) return;
        const brain = window.Engine?.brain;
        if (!brain || !brain.RAW_SCHEMA) return;

        // 1. Immutable Forensic Anchoring
        const raw = JSON.parse(JSON.stringify(brain.RAW_SCHEMA)); 
        FROZEN_SCHEMA = deepFreeze(deepSort(raw));
        
        // 2. Deterministic Versioning
        SCHEMA_HASH = generateStableHash(JSON.stringify(FROZEN_SCHEMA));
        STABLE_HASH = generateStableHash(JSON.stringify(FROZEN_SCHEMA.STABLE));
        
        console.log(`%c[TITAN] Engine Ready | ${ENGINE_VERSION} | Hash: ${SCHEMA_HASH}`, "color: #10b981; font-weight: bold;");
    },

    async process(event, inputState = null) {
        this._initSchema();
        const startTimestamp = Date.now();
        const now = Date.now();

        try {
            const brain = window.Engine.brain;
            const bridge = window.Engine.brainBridge;
            if (!brain || !brain.Classifier || !brain.Scoring || !bridge) throw new Error('Expert Infrastructure missing');

            const url = this._normalize(event.url);
            if (!url) return { decision: TITAN_NULL_RESULT('MALFORMED_URL', 'unknown', event), stateUpdate: null };
            
            const domain = brain.Classifier.extractDomain(url);
            const domainClass = brain.Classifier.classify(url);
            const nowVal = Date.now(); // Renamed to avoid shadowed now if needed, or just use 'now'
            const newType = event.type || 'unknown';

            // --- 🕵️ LAYER 0: CONTEXT AGGREGATION ---
            const label_hints = {
                isVideoPlaying: typeof document !== 'undefined' ? Array.from(document.querySelectorAll('video')).some(v => !v.paused && !v.ended) : false,
                userInteracted: (now - (window.__V_LAST_INTERACTION || 0)) < 5000,
                visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'visible'
            };

            // --- 🛡️ LAYER 1: PLATFORM PROTECTION ---
            const PROTECTED_DOMAINS = ['youtube.com', 'google.com', 'gstatic.com', 'googleusercontent.com'];
            if (PROTECTED_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`)) && domainClass !== 'ads_network') {
                return {
                    decision: {
                        eventId: event.eventId || '',
                        epoch: event.epoch || 0,
                        engine_v: ENGINE_VERSION,
                        action: 'ALLOW',
                        label_pred: 'SAFE',
                        score: 0,
                        confidence: 1.0,
                        timestamp: event.timestamp || now,
                        isDeterministic: true,
                        url,
                        domain,
                        decisionPath: {
                            triggeredRules: [],
                            gatesPassed: [],
                            blockedBy: [],
                            finalDecisionReason: 'protected_domain',
                            dominantContribution: 'none',
                            causalChain: 'protected_domain'
                        },
                        contributions: {}
                    },
                    stateUpdate: {
                        domain,
                        updates: {
                            lastSeen: now,
                            count: (inputState?.count || 0) + 1,
                            decisionScore: 0,
                            confidence: 1.0,
                            scoreWindow: [...(inputState?.scoreWindow || []), 0].slice(-5),
                            intervalWindow: [...(inputState?.intervalWindow || []), 0].slice(-5),
                            types: Array.from(new Set([...(inputState?.types || []), event.type || 'unknown'])),
                            seenTypes: Array.from(new Set([...(inputState?.seenTypes || []), event.type || 'unknown'])),
                            lastActionTime: inputState?.lastActionTime || 0,
                            lastEventId: event.eventId || '',
                            lastSpikeTime: inputState?.lastSpikeTime || 0,
                            lastUrl: url
                        }
                    }
                };
            }

            // --- 🔄 STATE INITIALIZATION (Stateless v16.14) ---
            let state = inputState;
            if (!state) {
                state = {
                    startTime: now,
                    lastSeen: 0,
                    count: 0,
                    intervalWindow: [], 
                    scoreWindow: [],       
                    types: [],
                    seenTypes: [],
                    isTrustedCDN: true,
                    reputation: 0,
                    confidence: 0,
                    decisionScore: 0, 
                    lastActionTime: 0,
                    isLocked: false,
                    lastSpikeTime: 0,
                    lastEventId: '',
                    lastUrl: ''
                };
            }
            
            // Normalize types into Sets for logic (Internal only)
            const internalTypes = new Set(state.types || []);
            const internalSeenTypes = new Set(state.seenTypes || []);

            // --- 🛡️ DUPLICATE COMMIT GUARD ---
            const currentEventId = event.eventId;
            if (currentEventId && state.lastEventId === currentEventId) {
                return { decision: TITAN_NULL_RESULT('DUPLICATE_COMMIT', domain, event), stateUpdate: null };
            }
            
            // Tracking Update
            const interval = state.lastSeen > 0 ? now - state.lastSeen : 0;
            const updatedLastSeen = now;
            const updatedCount = (state.count || 0) + 1;
            if (newType) internalTypes.add(newType);

            // --- 🚀 PHASE 2: FORENSIC ANALYSIS ---
            const featuresTitan = brain.Extractor.extract({ ...event, url, domain, domainClass }, { ...state, types: internalTypes });
            const analysis = brain.Scoring.compute(featuresTitan.v2, { ...state, types: internalTypes }, label_hints, FROZEN_SCHEMA);
            
            const currentScore = analysis.score;
            const currentConfidence = analysis.confidence;
            const prevScore = state.decisionScore || 0;
            const prevConfidence = state.confidence || 0;
            const isKnownAdEndpoint = domainClass === 'ads_network' &&
                /doubleclick|pagead|gampad|adview|output=xml_vast|videoplayfailed|video_ad_loaded|ad_break|preroll/i.test(url);
            
            // A. Decision Inertia & Spike
            let decisionScore = (0.7 * prevScore) + (0.3 * currentScore);
            const highRiskIdx = (state.scoreWindow || []).map((s, i) => s > 0.6 ? i : -1).filter(i => i !== -1);
            const hasCluster = highRiskIdx.some((idx, i) => i > 0 && (idx - highRiskIdx[i-1] <= 2));
            const isSpikeOverride = (currentScore - prevScore > 0.5) && highRiskIdx.length >= 2 && hasCluster;
            
            let finalDecisionReason = 'inertia';
            if (isSpikeOverride) {
                decisionScore = currentScore;
                finalDecisionReason = 'spike_override';
            }
            if (isKnownAdEndpoint && currentScore >= 0.4) {
                decisionScore = Math.max(decisionScore, currentScore);
                finalDecisionReason = 'ad_fast_path';
            }

            // B. Path Reconstruction
            const triggeredRules = [];
            if (isSpikeOverride) triggeredRules.push('spike');
            if (isKnownAdEndpoint) triggeredRules.push('ad_fast_path');
            if (!internalSeenTypes.has(newType) && (newType === 'script' || newType === 'iframe') && decisionScore > 0.4) triggeredRules.push('type_violation');
            
            const gatesPassed = [];
            if (decisionScore > 0.6) gatesPassed.push('score > 0.6');
            if (currentConfidence > 0.5) gatesPassed.push('confidence > 0.5');

            // Hierarchical Decision
            let label = 'SAFE';
            if (decisionScore > 0.6 && currentConfidence > 0.5) label = 'HIGH_RISK';
            else if (decisionScore > 0.3 && currentConfidence > 0.4) label = 'SUSPICIOUS';
            else if (analysis.metrics.isTrustedMedia) label = 'MEDIA_PASS';

            let action = (label === 'HIGH_RISK') ? 'TAG' : 'ALLOW';
            if (label === 'HIGH_RISK' && analysis.metrics.isTrustedMedia) action = 'ALLOW';

            // --- 🔒 PHASE 3: COOLDOWN & BYPASS ---
            const inCooldown = (now - (state.lastActionTime || 0) < 1000);
            const isCritical = (decisionScore > 0.85 && currentConfidence > 0.6 && !analysis.metrics.isTrustedMedia);
            
            const skipAction = inCooldown && !isCritical;
            let blockedBy = [];
            if (skipAction) {
                blockedBy.push('cooldown');
                if (isCritical) finalDecisionReason = 'critical_bypass';
            }

            const effectiveLabel = skipAction ? (state.lockedLabel || label) : label;
            const effectiveAction = skipAction ? (state.lockedAction || action) : action;

            let updatedLastActionTime = state.lastActionTime;
            if (!skipAction && label !== state.lockedLabel) {
                 updatedLastActionTime = now;
            }

            // Noise-Suppressed Normalization
            const rawContribs = { ...analysis.contributions };
            if (isSpikeOverride) rawContribs.spike = 0.5;
            
            const contribSum = Object.values(rawContribs).reduce((a, b) => a + b, 0);
            const normalizedContributions = {};
            const epsilon = 0.0001;
            let isNoSignal = false;
            let dominantContribution = 'none';
            
            if (contribSum >= epsilon) {
                let maxVal = -1;
                for (const [k, v] of Object.entries(rawContribs)) {
                    normalizedContributions[k] = parseFloat((v / contribSum).toFixed(3));
                    if (v > maxVal) { maxVal = v; dominantContribution = k; }
                }
            } else {
                isNoSignal = true;
                for (const k in rawContribs) normalizedContributions[k] = 0;
            }

            // Causal Chain Construction (v16.14 Storytelling)
            const causalChain = [];
            if (triggeredRules.length > 0) causalChain.push(triggeredRules.join(' + '));
            if (isSpikeOverride) causalChain.push('spike_reflex');
            if (isCritical) causalChain.push('critical_bypass');
            causalChain.push(label.toLowerCase());

            // Jitter Detection (Score Variance)
            const scoreWindow = [...(state.scoreWindow || []), currentScore].slice(-5);
            const intervalWindow = [...(state.intervalWindow || []), interval].slice(-5);
            const avg = scoreWindow.reduce((a, b) => a + b, 0) / scoreWindow.length;
            const variance = scoreWindow.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / scoreWindow.length;

            internalSeenTypes.add(newType);

            const processingLag = Math.min(5000, Math.max(0, Date.now() - startTimestamp));
            
            const diff = currentConfidence - prevConfidence;
            const confidenceTrend = Math.abs(diff) < 0.02 ? 'stable' : (diff > 0 ? 'increase' : 'decrease');

            // --- 📦 PURE OUTPUT CONTRACT ---
            return {
                decision: {
                    eventId: event.eventId || '',
                    epoch: event.epoch || 0,
                    engine_v: ENGINE_VERSION,
                    schema_hash: SCHEMA_HASH,
                    stable_hash: STABLE_HASH,
                    url, domain,
                    label_pred: effectiveLabel,
                    action: effectiveAction,
                    score: parseFloat(decisionScore.toFixed(3)),
                    confidence: parseFloat(currentConfidence.toFixed(2)),
                    confidenceTrend,
                    isDeterministic: true,
                    isNoSignal,
                    processingLag,
                    decisionVariance: parseFloat(variance.toFixed(5)),
                    decisionPath: { 
                        triggeredRules, gatesPassed, blockedBy, finalDecisionReason, 
                        dominantContribution, causalChain: causalChain.join(' → ')
                    },
                    contributions: normalizedContributions,
                    forensic: {
                        triggeredRules,
                        gatesPassed,
                        confidenceBands: {
                            current: parseFloat(currentConfidence.toFixed(2)),
                            previous: parseFloat(prevConfidence.toFixed(2)),
                            trend: confidenceTrend
                        },
                        featureAttribution: normalizedContributions
                    },
                    timestamp: now
                },
                stateUpdate: {
                    domain,
                    updates: {
                        lastSeen: updatedLastSeen,
                        count: updatedCount,
                        decisionScore,
                        confidence: currentConfidence,
                        scoreWindow,
                        intervalWindow,
                        types: Array.from(internalTypes),
                        seenTypes: Array.from(internalSeenTypes),
                        lastActionTime: updatedLastActionTime,
                        lockedLabel: effectiveLabel,
                        lockedAction: effectiveAction,
                        lastEventId: currentEventId,
                        lastSpikeTime: isSpikeOverride ? now : (state.lastSpikeTime || 0),
                        lastUrl: url
                    }
                }
            };

        } catch (e) {
            console.error('[Orchestrator] Titan Error:', e);
            return { decision: TITAN_NULL_RESULT('RUNTIME_ERROR', 'unknown', event), stateUpdate: null };
        }
    },

    _safeURL(url, base = (typeof window !== 'undefined' ? window.location?.href : undefined)) {
        try {
            if (!url) return null;
            return new URL(url, base);
        } catch (e) {
            return null;
        }
    },

    _normalize(input) {
        if (!input) return "";

        // 1. String-level normalization
        if (typeof input === 'string') {
            const parsed = this._safeURL(input);
            return parsed ? parsed.href : input; 
        }

        // 2. URL Object
        if (input instanceof URL) return input.href;

        // 3. Request/Object extraction
        if (typeof input === 'object') {
            const raw = input.url || input.href || "";
            if (!raw) return "";
            const parsed = this._safeURL(raw);
            return parsed ? parsed.href : String(raw);
        }

        return String(input);
    }
};

if (typeof window !== 'undefined') {
    window.Engine = window.Engine || {};
    window.Engine.hub = { Orchestrator };
}
