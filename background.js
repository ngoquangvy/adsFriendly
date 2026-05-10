// Vanguard v16.13 - Reality Anchor (Titanium Production Edition)
// Centralized Behavioral Memory Hub (Background)
try {
    importScripts('engine/forensic/verifier.js');
} catch (err) {
    console.warn('[Verifier] importScripts failed:', err?.message || err);
}

const domainBehaviorCache = new Map();
const entityBehaviorCache = new Map(); // Entity-level aggregation
const lockRegistry = new Map(); 
const lockQueueDepth = new Map();
const LRU_MAX_DOMAINS = 500;
const MEMORY_TTL = 15 * 60 * 1000; 
let lastTrustedClick = { timestamp: 0, intentUrl: null };

function getVerifier() {
    return self?.Engine?.forensic?.Verifier || self?.VanguardVerifier || {
        verifyCommitMessage() {
            return {
                ok: false,
                status: 'rejected',
                stage: 'commit',
                profile: 'fallback',
                reason: 'NO_VERIFIER',
                riskFlags: ['NO_VERIFIER'],
                failures: ['NO_VERIFIER'],
                event: {}
            };
        },
        verifyTelemetryPayload() {
            return {
                ok: false,
                status: 'rejected',
                stage: 'telemetry',
                profile: 'fallback',
                reason: 'NO_VERIFIER',
                riskFlags: ['NO_VERIFIER'],
                failures: ['NO_VERIFIER'],
                event: {}
            };
        }
    };
}

function createEmptyDomainState(now = Date.now()) {
    return {
        startTime: now,
        firstSeenGlobal: now,
        lastActive: now,
        lastAccess: now,
        lastSeen: 0,
        count: 0,
        scoreWindow: [],
        intervalWindow: [],
        types: [],
        seenTypes: [],
        scriptIframeCounter: 0,
        nextForgivenessAllowed: 0,
        slotReservedAt: 0,
        isTrustedCDN: true,
        reputation: 0,
        confidence: 0,
        decisionScore: 0,
        lastActionTime: 0,
        isLocked: false,
        lastSpikeTime: 0,
        lastEventId: '',
        lastUrl: '',
        lastRisk: 0,
        lastConfidence: 0
    };
}

function normalizeDomain(domain, types = []) {
    if (!domain) return { domain: '', entity: '' };
    
    // Entity Extraction (Paranoid Production v16.13)
    const parts = domain.split('.');
    const entity = parts.slice(-2).join('.'); // e.g. "xhcdn.com"
    
    // Whitelisted CDN Normalization
    const looksLikeCDN = /\d+|cdn|edge|cache/.test(domain);
    const hasAdKeyword = /ads|track|bid|click/.test(domain);
    const isMediaPattern = /\.(mp4|m3u8|ts|chunk|frag)/.test(domain); 
    
    const hasScriptIframe = types.some(t => t === 'script' || t === 'iframe');

    let normalized = domain;
    if (looksLikeCDN && !hasAdKeyword && isMediaPattern && !hasScriptIframe) {
        if (domain.includes('googlevideo.com')) normalized = 'googlevideo.com';
        else if (domain.includes('cloudfront.net')) normalized = 'cloudfront.net';
        else if (domain.includes('akamai')) normalized = 'akamai.net';
        else normalized = entity;
    }
    return { domain: normalized, entity };
}

async function withLock(domain, fn) {
    const { domain: norm } = normalizeDomain(domain);
    const depth = lockQueueDepth.get(norm) || 0;
    if (depth > 50) return await fn(true); 

    lockQueueDepth.set(norm, depth + 1);
    const prev = lockRegistry.get(norm) || Promise.resolve();
    let release;
    const next = new Promise(r => (release = r));
    lockRegistry.set(norm, prev.then(() => next));

    try {
        await prev;
        return await fn(false);
    } finally {
        release();
        lockQueueDepth.set(norm, Math.max(0, (lockQueueDepth.get(norm) || 1) - 1));
        if (lockRegistry.get(norm) === next) {
            lockRegistry.delete(norm);
            lockQueueDepth.delete(norm);
        }
    }
}

function updateAtomicState(domainName, updates = {}, isOverflow = false) {
    const { domain: norm, entity } = normalizeDomain(domainName, updates.allTypes);
    const now = Date.now();
    
    // 1. Domain State Substitution
    const oldState = domainBehaviorCache.get(norm) || createEmptyDomainState(now);

    const state = { ...oldState, lastAccess: now, lastActive: now };
    state.count++;

    // Type Guard & Forgiveness (Aligned)
    const currentTypes = updates.type ? [updates.type] : [];
    const hasTypeViolation = currentTypes.some(t => t === 'script' || t === 'iframe');
    
    if (hasTypeViolation) {
        state.isTrustedCDN = false;
        state.scriptIframeCounter = 0;
        state.nextForgivenessAllowed = now + 60000;
    } else {
        state.scriptIframeCounter++;
        if (state.scriptIframeCounter >= 20 && !state.isTrustedCDN && now > state.nextForgivenessAllowed) {
            state.isTrustedCDN = true; 
        }
    }

    // Temporal Update (Negative Guard)
    const interval = Math.max(0, updates.interval !== undefined ? updates.interval : (state.lastSeen ? now - state.lastSeen : 0));

    // Forensic Windows (v16.13 Aligned Sync)
    if (updates.score !== undefined) {
        state.lastRisk = updates.score;
        state.lastConfidence = updates.confidence || 0;
        state.scoreWindow.push(updates.score);
        state.intervalWindow.push(interval);
        if (state.scoreWindow.length > 5) {
            state.scoreWindow.shift();
            state.intervalWindow.shift();
        }
    }
    state.lastSeen = now;
    if (updates.type && !state.types.includes(updates.type)) state.types.push(updates.type);

    // 2. Conservative Entity Propagation (v16.13 Titanium)
    if (entity && entity !== norm) {
        const oldEntityState = entityBehaviorCache.get(entity) || { risk: 0, confidence: 0, count: 0 };
        const entityUpdates = { ...oldEntityState };
        
        // Paranoid Check: Only propagate if child is credible
        const isCredible = state.lastConfidence > 0.5 && state.count >= 3;
        const isFastPath = hasTypeViolation && state.count >= 3;

        if (isCredible || isFastPath) {
            entityUpdates.risk = Math.max(entityUpdates.risk, state.lastRisk);
            entityUpdates.confidence = Math.min(entityUpdates.confidence || 1.0, state.lastConfidence);
            entityUpdates.count++;
            entityBehaviorCache.set(entity, entityUpdates);
            state.entityRisk = entityUpdates.risk; // Mirror sync
        }
    }

    // LRU Eviction
    if (domainBehaviorCache.size > LRU_MAX_DOMAINS) {
        const oldestEntry = [...domainBehaviorCache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)[0];
        if (oldestEntry) domainBehaviorCache.delete(oldestEntry[0]);
    }

    domainBehaviorCache.set(norm, state);
    return state;
}

// TTL Cleanup
setInterval(() => {
    const now = Date.now();
    for (const [domain, state] of domainBehaviorCache) {
        if (now - state.lastActive > MEMORY_TTL) {
            domainBehaviorCache.delete(domain);
        }
    }
}, 60000);

// v16.14 Titan Final - Global Epoch Manager
let globalEpoch = 1;
const tabRegistry = new Map(); // tabId -> { lastSeen, instanceId, status }
const ACK_TIMEOUT = 500;
const MIN_ACK_RATIO = 0.6;
let epochAckTracker = null;
const recentTelemetryLedger = new Map();
const MAX_RECENT_EVENTS_PER_TAB = 120;
const RECENT_TELEMETRY_WINDOW_MS = 15000;

function expectedAckCount(tracker) {
    return Math.max(1, (tracker?.acks || 0) + (tracker?.pending?.size || 0));
}

function canMessageTab(tab) {
    if (!tab?.id) return false;
    if (!tab.url) return false;
    return /^https?:/i.test(tab.url);
}

function safeSendTabMessage(tabId, message) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, message, () => {
            if (chrome.runtime.lastError) {
                const errorMessage = chrome.runtime.lastError.message || '';
                const isMissingReceiver = errorMessage.includes('Receiving end does not exist');
                const isBlockedContext = errorMessage.includes('The tab was closed') || errorMessage.includes('No tab with id');

                if (!isMissingReceiver && !isBlockedContext) {
                    console.warn(`[Vanguard] Tab message failed for tab ${tabId}:`, errorMessage);
                }
                resolve(false);
                return;
            }
            resolve(true);
        });
    });
}

async function broadcastEpoch() {
    const now = Date.now();
    const activeTabs = Array.from(tabRegistry.entries())
        .filter(([_, t]) => now - t.lastSeen < 5000);
    
    globalEpoch++;
    const targetTabIds = new Set(activeTabs.map(([tabId]) => tabId));
    const expectedCount = Math.max(1, targetTabIds.size);
    
    console.log(`%c[EPOCH] Broadcasting v${globalEpoch} | Expected: ${expectedCount}`, "color: #3b82f6;");

    const message = {
        source: 'adsfriendly-background',
        type: 'EPOCH_UPDATE',
        epoch: globalEpoch,
        engine_v: "v16.14" // Hardcoded for now, should be from constant
    };

    // Parallel Dispatch
    const ackPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => {
            const ackCount = epochAckTracker?.acks || 0;
            console.warn(`%c[QUORUM] Timeout reached. Proceeding with ${ackCount}/${expectedCount} ACKs`, "color: #f59e0b;");
            epochAckTracker = null;
            resolve();
        }, ACK_TIMEOUT);

        epochAckTracker = {
            epoch: globalEpoch,
            acks: 0,
            pending: targetTabIds,
            resolve: () => {
                clearTimeout(timeout);
                const ackCount = epochAckTracker?.acks || 0;
                console.log(`%c[QUORUM] Reached with ${ackCount}/${expectedCount} ACKs`, "color: #10b981;");
                epochAckTracker = null;
                resolve();
            }
        };

        chrome.tabs.query({}, (tabs) => {
            tabs.filter(canMessageTab).forEach(tab => {
                safeSendTabMessage(tab.id, message);
            });
        });
    });

    return ackPromise;
}

function createBackgroundRecordId(prefix = 'bg') {
    return `${prefix}:${globalEpoch}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function extractDomainFromUrl(url) {
    try {
        return new URL(url).hostname || '';
    } catch (_) {
        return '';
    }
}

function ruleMatchesDomain(domain, entry) {
    if (!domain || !entry) return false;
    const pattern = String(entry).replace(/^\|\|/, '').replace(/\^$/, '');
    return domain === pattern || domain.endsWith('.' + pattern);
}

function rememberRecentTelemetry(tabId, record) {
    if (!tabId || !record?.identity?.timestamp) return;
    const current = recentTelemetryLedger.get(tabId) || [];
    const timestamp = record.identity.timestamp;
    const summarized = {
        event_id: record.identity.event_id || '',
        timestamp,
        domain: record.observation?.domain || record.identity.page_domain || '',
        entity_type: record.observation?.entity_type || 'RESOURCE',
        request_ids: record.correlations?.related_request_ids || []
    };
    const next = [...current, summarized]
        .filter(item => (timestamp - item.timestamp) <= RECENT_TELEMETRY_WINDOW_MS)
        .slice(-MAX_RECENT_EVENTS_PER_TAB);
    recentTelemetryLedger.set(tabId, next.slice(-MAX_RECENT_EVENTS_PER_TAB));
}

function buildCorrelationSnapshot(tabId, timestamp) {
    const items = recentTelemetryLedger.get(tabId) || [];
    const nearby = items.filter(item => Math.abs(timestamp - item.timestamp) <= 8000);
    return {
        related_event_ids: nearby.map(item => item.event_id).filter(Boolean).slice(-12),
        related_request_ids: nearby.flatMap(item => item.request_ids || []).filter(Boolean).slice(-12),
        related_domains: Array.from(new Set(nearby.map(item => item.domain).filter(Boolean))).slice(-8),
        parent_entity_id: null,
        dom_node_ref: null,
        dom_selector_hash: null,
        initiator_chain: Array.from(new Set(nearby.map(item => item.entity_type).filter(Boolean))).slice(-8),
        timing_window_ms: 8000
    };
}

async function getKnowledgeSnapshot(pageDomain, targetDomain = pageDomain) {
    const { whitelist = [], blacklist = [], friendlyMode = true, userCustomRules = {} } =
        await chrome.storage.local.get(['whitelist', 'blacklist', 'friendlyMode', 'userCustomRules']);

    const normalizedPage = pageDomain || '';
    const normalizedTarget = targetDomain || normalizedPage;
    const customRuleCount = Array.isArray(userCustomRules[normalizedPage]) ? userCustomRules[normalizedPage].length : 0;

    return {
        trusted_site: whitelist.includes(normalizedTarget) || whitelist.includes(normalizedPage),
        blocked_site: blacklist.some(entry => ruleMatchesDomain(normalizedTarget, entry)),
        learned_workflow: null,
        prior_user_decision: null,
        decision_source: null,
        user_feedback_strength: 0,
        custom_rule_count: customRuleCount,
        friendly_mode: friendlyMode
    };
}

function buildFallbackRecordFromPayload(payload, sender) {
    const data = payload?.data || {};
    const now = Date.now();
    const pageUrl = sender?.tab?.url || null;
    const pageDomain = extractDomainFromUrl(pageUrl || data.url || '');
    return {
        record_type: 'event',
        schema_version: 'v1',
        identity: {
            event_id: data.eventId || createBackgroundRecordId('legacy'),
            epoch: data.epoch || globalEpoch,
            timestamp: data.timestamp || now,
            tab_instance_id: null,
            session_id: null,
            page_url: pageUrl,
            page_domain: pageDomain,
            top_frame_domain: pageDomain
        },
        source: {
            sensor: 'legacy',
            bridge: 'loader',
            pipeline: 'background'
        },
        observation: {
            entity_type: data.eventType || 'RESOURCE',
            raw_url: data.url || null,
            normalized_url: data.url || null,
            domain: data.domain || pageDomain,
            method: data.method || null,
            phase: null,
            status_code: null,
            response_size: null,
            resource_type: data.eventType || null,
            initiator_type: null,
            frame_depth: null,
            visible: null,
            raw_attributes: {},
            media_stub: { present: false, media_url: null, player_hint: null, duration: null, autoplay: null, muted: null }
        },
        context: {
            labels: [],
            interaction_id: null,
            trusted_click: false,
            visibility_state: null,
            has_active_video: false,
            page_mode: 'generic_page',
            workflow_id: null
        },
        user_signals: {
            trusted_site: null,
            blocked_site: null,
            learned_workflow: null,
            prior_user_decision: null,
            decision_source: null,
            user_feedback_strength: 0
        },
        correlations: {
            related_event_ids: [],
            related_request_ids: [],
            related_domains: [],
            parent_entity_id: null,
            dom_node_ref: null,
            dom_selector_hash: null,
            initiator_chain: [],
            timing_window_ms: 0
        },
        classification: {
            entity: [],
            context: [],
            behaviors: [],
            media_roles: [],
            risk: [],
            confidence: data.confidence || 0,
            label_strength: 'unknown'
        },
        decision: {
            action: data.action || 'allow',
            reason: data.reason || data.label_pred || null,
            confidence: data.confidence || 0,
            actor: 'system'
        },
        forensic: {
            trace: { radar_ts: null, bridge_ts: null, orchestrator_ts: null, background_ts: null },
            valid: null,
            risk_flags: [],
            schema_hash: null
        },
        extensions: {
            legacy: payload || {}
        }
    };
}

async function enrichTelemetryPayload(payload, sender) {
    const record = payload?.record ? structuredClone(payload.record) : buildFallbackRecordFromPayload(payload, sender);
    const backgroundTimestamp = Date.now();
    const pageDomain = record.identity?.page_domain || extractDomainFromUrl(record.identity?.page_url || sender?.tab?.url || '');
    const targetDomain = record.observation?.domain || pageDomain;
    const knowledgeSnapshot = await getKnowledgeSnapshot(pageDomain, targetDomain);
    const correlationSnapshot = buildCorrelationSnapshot(sender?.tab?.id, record.identity?.timestamp || backgroundTimestamp);

    record.identity = {
        ...record.identity,
        page_url: record.identity?.page_url || sender?.tab?.url || null,
        page_domain: pageDomain,
        top_frame_domain: record.identity?.top_frame_domain || pageDomain
    };
    record.user_signals = {
        ...record.user_signals,
        trusted_site: knowledgeSnapshot.trusted_site,
        blocked_site: knowledgeSnapshot.blocked_site,
        learned_workflow: knowledgeSnapshot.learned_workflow,
        prior_user_decision: knowledgeSnapshot.prior_user_decision,
        decision_source: knowledgeSnapshot.decision_source,
        user_feedback_strength: knowledgeSnapshot.user_feedback_strength
    };
    record.correlations = {
        ...correlationSnapshot,
        ...record.correlations,
        related_event_ids: Array.from(new Set([...(record.correlations?.related_event_ids || []), ...correlationSnapshot.related_event_ids])).slice(-12),
        related_request_ids: Array.from(new Set([...(record.correlations?.related_request_ids || []), ...correlationSnapshot.related_request_ids])).slice(-12),
        related_domains: Array.from(new Set([...(record.correlations?.related_domains || []), ...correlationSnapshot.related_domains])).slice(-8),
        initiator_chain: Array.from(new Set([...(record.correlations?.initiator_chain || []), ...correlationSnapshot.initiator_chain])).slice(-8),
        timing_window_ms: Math.max(record.correlations?.timing_window_ms || 0, correlationSnapshot.timing_window_ms || 0)
    };
    record.forensic = {
        ...record.forensic,
        trace: {
            ...(record.forensic?.trace || {}),
            background_ts: backgroundTimestamp
        }
    };
    record.extensions = {
        ...(record.extensions || {}),
        background: {
            tab_id: sender?.tab?.id || null,
            frame_id: sender?.frameId ?? null,
            custom_rule_count: knowledgeSnapshot.custom_rule_count,
            friendly_mode: knowledgeSnapshot.friendly_mode
        }
    };

    const metaLayer = {
        source: record.source || {},
        context: record.context || {},
        user_signals: record.user_signals || {},
        correlations: record.correlations || {},
        forensic: {
            trace: record.forensic?.trace || {},
            valid: record.forensic?.valid ?? null,
            risk_flags: record.forensic?.risk_flags || []
        },
        knowledge_snapshot: knowledgeSnapshot
    };

    const decisionLayer = {
        classification: record.classification || {},
        decision: record.decision || {},
        extensions: {
            legacy: record.extensions?.legacy || {},
            background: record.extensions?.background || {}
        }
    };

    const enrichedPayload = {
        ...payload,
        record,
        meta_layer: metaLayer,
        decision_layer: decisionLayer,
        knowledge_snapshot: knowledgeSnapshot,
        timestamp: backgroundTimestamp
    };
    return enrichedPayload;
}

function applyVerificationToPayload(payload, verification) {
    const nextPayload = {
        ...payload,
        record: {
            ...(payload.record || {}),
            forensic: {
                ...((payload.record || {}).forensic || {}),
                valid: verification.ok,
                risk_flags: verification.riskFlags || []
            }
        },
        meta_layer: {
            ...(payload.meta_layer || {}),
            forensic: {
                ...((payload.meta_layer || {}).forensic || {}),
                valid: verification.ok,
                risk_flags: verification.riskFlags || []
            }
        }
    };

    return nextPayload;
}

function rejectEvent(stage, verification, context = {}) {
    console.warn(`[Verifier] Dropped ${stage}: ${verification.reason}`, {
        riskFlags: verification.riskFlags || [],
        tabId: context.tabId || null,
        eventId: verification.event?.eventId || null,
        profile: verification.profile || 'unknown'
    });

    // Send to Rejected Sink on Telemetry Server
    fetch('http://localhost:3000/telemetry/rejected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            stage,
            reason: verification.reason,
            riskFlags: verification.riskFlags || [],
            event: verification.event || context.payload || {}
        })
    }).catch(() => {}); // Fire and forget

    return {
        status: 'dropped',
        stage,
        reason: verification.reason,
        riskFlags: verification.riskFlags || [],
        eventId: verification.event?.eventId || null
    };
}

function verifyEvent(stage, subject, context = {}) {
    const verifier = getVerifier();
    if (stage === 'commit') {
        return verifier.verifyCommitMessage(subject, context);
    }
    return verifier.verifyTelemetryPayload(subject, context);
}

async function acceptAndProxyTelemetry(payload, sender = null) {
    const enrichedPayload = await enrichTelemetryPayload(payload, sender);
    const tabId = sender?.tab?.id || null;
    const expectedTabInstanceId = tabRegistry.get(tabId)?.instanceId || null;
    const verification = verifyEvent('telemetry', enrichedPayload, {
        expectedEpoch: globalEpoch,
        expectedTabInstanceId
    });

    if (!verification.ok) {
        return rejectEvent('telemetry', verification, { tabId });
    }

    const verifiedPayload = applyVerificationToPayload(enrichedPayload, verification);
    rememberRecentTelemetry(tabId, verifiedPayload.record);
    return proxyTelemetry(verifiedPayload);
}

async function applyStateIfValid(message, sender) {
    const tabId = sender?.tab?.id || null;
    const expectedTabInstanceId = tabRegistry.get(tabId)?.instanceId || null;
    const verification = verifyEvent('commit', message, {
        expectedEpoch: globalEpoch,
        expectedTabInstanceId
    });

    if (!verification.ok) {
        return rejectEvent('commit', verification, { tabId });
    }

    const update = message.update;
    if (update && update.domain) {
        await withLock(update.domain, async () => {
            const norm = normalizeDomain(update.domain, update.updates?.types || []).domain;
            const oldState = domainBehaviorCache.get(norm) || createEmptyDomainState();
            const newState = { ...oldState, ...update.updates, lastAccess: Date.now(), lastActive: Date.now() };
            domainBehaviorCache.set(norm, newState);
        });
    }

    return {
        status: 'ok',
        verification
    };
}

function buildLegacySignalPayload(message, sender) {
    const timestamp = Date.now();
    const signalType = message.signalType || 'LEGACY_SIGNAL';
    const payload = message.payload || {};
    const pageUrl = sender?.tab?.url || null;
    const pageDomain = extractDomainFromUrl(pageUrl || payload.site || '');
    const isKnowledgeSignal = signalType === 'LEARN_MARKER_CONFIRM' || signalType === 'LEARN_MARKER_PENALIZE';

    return {
        type: isKnowledgeSignal ? 'LEGACY_MARKER_FEEDBACK' : 'LEGACY_STRATEGY_DECISION',
        provider_type: 'VANGUARD_LEGACY',
        data: {
            signalType,
            site: payload.site || pageDomain,
            selector: payload.selector || null,
            adType: payload.adType || null,
            strategy: payload.strategy || null,
            riskScore: Number.isFinite(payload.riskScore) ? payload.riskScore : 0,
            confidence: Number.isFinite(payload.confidence) ? payload.confidence : 0
        },
        record: {
            record_type: isKnowledgeSignal ? 'knowledge' : 'event',
            schema_version: 'v1',
            identity: {
                event_id: createBackgroundRecordId('legacy'),
                epoch: globalEpoch,
                timestamp,
                tab_instance_id: null,
                session_id: null,
                page_url: pageUrl,
                page_domain: pageDomain,
                top_frame_domain: pageDomain
            },
            source: {
                sensor: 'legacy_engine',
                bridge: 'loader',
                pipeline: 'background'
            },
            observation: {
                entity_type: isKnowledgeSignal ? 'KNOWLEDGE' : 'RESOURCE',
                raw_url: pageUrl,
                normalized_url: pageUrl,
                domain: payload.site || pageDomain,
                method: null,
                phase: isKnowledgeSignal ? 'knowledge_feedback' : 'legacy_decision',
                status_code: null,
                response_size: null,
                resource_type: signalType,
                initiator_type: 'legacy_engine',
                frame_depth: null,
                visible: null,
                raw_attributes: {
                    selector: payload.selector || null
                },
                media_stub: { present: false, media_url: null, player_hint: null, duration: null, autoplay: null, muted: null }
            },
            context: {
                labels: [],
                interaction_id: null,
                trusted_click: false,
                visibility_state: null,
                has_active_video: false,
                page_mode: 'generic_page',
                workflow_id: null
            },
            user_signals: {
                trusted_site: null,
                blocked_site: null,
                learned_workflow: null,
                prior_user_decision: null,
                decision_source: 'legacy_engine',
                user_feedback_strength: isKnowledgeSignal ? 0.8 : 0
            },
            correlations: {
                related_event_ids: [],
                related_request_ids: [],
                related_domains: [],
                parent_entity_id: null,
                dom_node_ref: payload.selector || null,
                dom_selector_hash: payload.selector || null,
                initiator_chain: ['legacy_engine'],
                timing_window_ms: 0
            },
            classification: {
                entity: [],
                context: [],
                behaviors: [],
                media_roles: [],
                risk: [],
                confidence: Number.isFinite(payload.confidence) ? payload.confidence : 0,
                label_strength: isKnowledgeSignal ? 'strong' : 'weak'
            },
            decision: {
                action: isKnowledgeSignal ? 'monitor' : 'allow',
                reason: signalType,
                confidence: Number.isFinite(payload.confidence) ? payload.confidence : 0,
                actor: 'legacy_engine'
            },
            forensic: {
                trace: {
                    radar_ts: null,
                    bridge_ts: null,
                    orchestrator_ts: timestamp,
                    background_ts: null
                },
                valid: null,
                risk_flags: ['LEGACY_SIGNAL'],
                schema_hash: null
            },
            extensions: {
                legacy: payload
            }
        }
    };
}

function buildUserActionRecord(message, sender) {
    const timestamp = message.timestamp || Date.now();
    const pageUrl = message.pageUrl || sender?.tab?.url || null;
    const pageDomain = message.pageDomain || extractDomainFromUrl(pageUrl || '');
    const targetDomains = Array.from(new Set((message.targets || []).flatMap(target => target.linkedDomains || []).filter(Boolean)));
    const correlations = buildCorrelationSnapshot(sender?.tab?.id, timestamp);
    return {
        type: 'USER_ACTION_RECORD',
        provider_type: 'VANGUARD_V16',
        data: {
            action: message.actionKind || 'USER_ACTION',
            pageDomain,
            pageUrl,
            selectedCount: Array.isArray(message.targets) ? message.targets.length : 0,
            learnedDomains: message.learnedDomains || [],
            isCorrectionLoop: !!message.isCorrectionLoop
        },
        record: {
            record_type: 'event',
            schema_version: 'v1',
            identity: {
                event_id: createBackgroundRecordId('user'),
                epoch: globalEpoch,
                timestamp,
                tab_instance_id: null,
                session_id: null,
                page_url: pageUrl,
                page_domain: pageDomain,
                top_frame_domain: pageDomain
            },
            source: {
                sensor: 'picker',
                bridge: 'chrome.runtime',
                pipeline: 'background'
            },
            observation: {
                entity_type: 'DOM_NODE',
                raw_url: pageUrl,
                normalized_url: pageUrl,
                domain: pageDomain,
                method: 'USER_ACTION',
                phase: 'manual_feedback',
                status_code: null,
                response_size: null,
                resource_type: 'dom_selection',
                initiator_type: 'picker',
                frame_depth: null,
                visible: true,
                raw_attributes: {
                    target_count: Array.isArray(message.targets) ? message.targets.length : 0,
                    correction_loop: !!message.isCorrectionLoop
                },
                media_stub: { present: false, media_url: null, player_hint: null, duration: null, autoplay: null, muted: null }
            },
            context: {
                labels: ['USER_CLICK_FLOW'],
                interaction_id: null,
                trusted_click: true,
                visibility_state: 'visible',
                has_active_video: false,
                page_mode: 'generic_page',
                workflow_id: null
            },
            user_signals: {
                trusted_site: null,
                blocked_site: null,
                learned_workflow: null,
                prior_user_decision: 'block',
                decision_source: 'explicit_picker',
                user_feedback_strength: 1
            },
            correlations: {
                ...correlations,
                related_domains: Array.from(new Set([...(correlations.related_domains || []), ...targetDomains])).slice(-12),
                dom_selector_hash: message.targets?.[0]?.selector || null
            },
            classification: {
                entity: ['DOM_NODE'],
                context: ['USER_CLICK_FLOW'],
                behaviors: [],
                media_roles: [],
                risk: [],
                confidence: 1,
                label_strength: 'strong'
            },
            decision: {
                action: 'block',
                reason: 'USER_DOM_BLOCK',
                confidence: 1,
                actor: 'user'
            },
            forensic: {
                trace: { radar_ts: null, bridge_ts: null, orchestrator_ts: null, background_ts: timestamp },
                valid: true,
                risk_flags: [],
                schema_hash: null
            },
            extensions: {
                dom_targets: message.targets || [],
                learned_domains: message.learnedDomains || []
            }
        }
    };
}

async function emitKnowledgeRecord(params = {}) {
    const timestamp = params.timestamp || Date.now();
    const payload = {
        type: 'KNOWLEDGE_RECORD',
        provider_type: 'VANGUARD_V16',
        data: {
            knowledgeType: params.knowledgeType,
            subject: params.subject || null,
            source: params.source || 'system',
            metadata: params.metadata || {}
        },
        record: {
            record_type: 'knowledge',
            schema_version: 'v1',
            identity: {
                event_id: createBackgroundRecordId('knowledge'),
                epoch: globalEpoch,
                timestamp,
                tab_instance_id: null,
                session_id: null,
                page_url: null,
                page_domain: params.pageDomain || null,
                top_frame_domain: params.pageDomain || null
            },
            source: {
                sensor: params.sensor || 'background',
                bridge: 'background',
                pipeline: 'background'
            },
            observation: {
                entity_type: 'KNOWLEDGE',
                raw_url: null,
                normalized_url: null,
                domain: params.targetDomain || params.pageDomain || null,
                method: null,
                phase: 'knowledge_mutation',
                status_code: null,
                response_size: null,
                resource_type: params.knowledgeType || null,
                initiator_type: params.source || 'system',
                frame_depth: null,
                visible: null,
                raw_attributes: params.metadata || {},
                media_stub: { present: false, media_url: null, player_hint: null, duration: null, autoplay: null, muted: null }
            },
            context: {
                labels: [],
                interaction_id: null,
                trusted_click: false,
                visibility_state: null,
                has_active_video: false,
                page_mode: 'generic_page',
                workflow_id: null
            },
            user_signals: {
                trusted_site: null,
                blocked_site: null,
                learned_workflow: params.knowledgeType === 'learned_workflow' ? params.subject : null,
                prior_user_decision: params.metadata?.action || null,
                decision_source: params.source || 'system',
                user_feedback_strength: params.source === 'user_explicit' ? 1 : 0.6
            },
            correlations: {
                related_event_ids: [],
                related_request_ids: [],
                related_domains: [],
                parent_entity_id: null,
                dom_node_ref: null,
                dom_selector_hash: null,
                initiator_chain: [],
                timing_window_ms: 0
            },
            classification: {
                entity: ['KNOWLEDGE'],
                context: [],
                behaviors: [],
                media_roles: [],
                risk: [],
                confidence: params.source === 'user_explicit' ? 1 : 0.6,
                label_strength: params.source === 'user_explicit' ? 'strong' : 'weak'
            },
            decision: {
                action: 'record',
                reason: params.knowledgeType || 'knowledge_update',
                confidence: params.source === 'user_explicit' ? 1 : 0.6,
                actor: params.source || 'system'
            },
            forensic: {
                trace: { radar_ts: null, bridge_ts: null, orchestrator_ts: null, background_ts: timestamp },
                valid: true,
                risk_flags: [],
                schema_hash: null
            },
            extensions: {
                knowledge: params
            }
        }
    };

    try {
        await acceptAndProxyTelemetry(payload, null);
    } catch (_) { }
}

 chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 🛡️ v16.14 LISTENER GUARD: Reject invalid contexts
    if (!message || !sender?.tab) return false;

    const now = Date.now();
    const tabId = sender.tab.id;

    if (message.type === 'FORENSIC_MEMORY_COMMIT') {
        const { epoch } = message;
        if (epoch && epoch !== globalEpoch) {
            sendResponse({ status: 'dropped', reason: 'STALE_EPOCH' });
            return false;
        }

        applyStateIfValid(message, sender)
            .then(sendResponse)
            .catch(err => sendResponse({ status: 'error', reason: err.message }));
        return true;
    }

    if (message.type === 'FORENSIC_MEMORY_FETCH') {
        const norm = normalizeDomain(message.domain).domain;
        const state = domainBehaviorCache.get(norm) || createEmptyDomainState();
        sendResponse({ state, requestId: message.requestId });
        return false;
    }

    if (message.type === 'ACK_EPOCH_SYNC') {
        if (message.epoch === globalEpoch) {
            const tab = tabRegistry.get(tabId);
            if (tab) {
                tab.status = 'SYNCED';
                tab.instanceId = message.tabId || tab.instanceId || null;
                tab.lastSeen = now;
            }
        }
        return false;
    }

    if (message.type === 'INITIAL_HANDSHAKE') {
        const prev = tabRegistry.get(tabId) || {};
        tabRegistry.set(tabId, { ...prev, lastSeen: now, status: 'HANDSHAKE' });
        safeSendTabMessage(tabId, {
            source: 'adsfriendly-background',
            type: 'EPOCH_UPDATE',
            epoch: globalEpoch,
            engine_v: "v16.14"
        });
        return false;
    }
    
    // --- Legacy / Other Handlers ---
    if (message.type === 'TRUSTED_CLICK') {
        lastTrustedClick = { timestamp: Date.now(), intentUrl: message.intentUrl };
    } else if (message.type === 'TOGGLE_STATUS') {
        console.log("Protection status:", message.isEnabled);
    } else if (message.type === 'SYNC_LEARNING') {
        synthesizeGlobalPatterns()
            .then(() => sendResponse({ status: 'ok' }))
            .catch(err => {
                console.error("Learning error:", err);
                sendResponse({ status: 'error' });
            });
        return true;
    } else if (message.type === 'NEGATIVE_LEARNING') {
        handleNegativeLearning(message.fingerprint)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(err => console.error("Negative learning error:", err));
        return true;
    } else if (message.type === 'USER_DECISION') {
        handleUserDecision(message, sender)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(err => sendResponse({ status: 'error', error: err.message }));
        return true;
    } else if (message.type === 'LOG_USER_ACTION') {
        const payload = buildUserActionRecord(message, sender);
        acceptAndProxyTelemetry(payload, sender)
            .then((result) => sendResponse(result?.status === 'dropped' ? result : { status: 'ok', result }))
            .catch(err => sendResponse({ status: 'error', error: err.message }));
        return true;
    } else if (message.type === 'LEGACY_ENGINE_SIGNAL') {
        const payload = buildLegacySignalPayload(message, sender);
        acceptAndProxyTelemetry(payload, sender)
            .then((result) => sendResponse(result?.status === 'dropped' ? result : { status: 'ok', result }))
            .catch(err => sendResponse({ status: 'error', error: err.message }));
        return true;
    } else if (message.type === 'PATH_RESTORED') {
        syncTrustedPath(message.source, message.target, true)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(err => sendResponse({ status: 'error' }));
        return true;
    } else if (message.type === 'LEARN_VIDEO_AD') {
        handleLearnVideoAd(message)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(() => sendResponse({ status: 'error' }));
        return true;
    } else if (message.type === 'SYNC_VIDEO_LEARNING') {
        handleVideoLearning(message)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(() => sendResponse({ status: 'error' }));
        return true;
    } else if (message.type === 'REPORT_AD_DENSITY') {
        updateSiteReputation(message.hostname, message.count)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(() => sendResponse({ status: 'error' }));
        return true;
    } else if (message.type === 'LEARN_DOMAINS') {
        handleLearnDomains(message.domains)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(() => sendResponse({ status: 'error' }));
        return true;
    } else if (message.type === 'LOG_NEURAL_DECISION') {
        handleNeuralLogging(message.entry)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(() => sendResponse({ status: 'error' }));
        return true;
    } else if (message.type === 'REPORT_VIDEO_DECISION') {
        handleReportVideoDecision(message.data)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(() => sendResponse({ status: 'error' }));
        return true;
    } else if (message.type === 'GET_VIDEO_SOURCE_STATS') {
        chrome.storage.local.get(['globalAdPatterns']).then(data => {
            const stats = {};
            const patterns = data.globalAdPatterns || [];
            patterns.forEach(p => {
                if (p.type === 'reputation') stats[p.value] = p;
            });
            sendResponse(stats);
        });
        return true;
    } else if (message.type === 'DEBUG_LOG') {
        handleDiagnosticLogging(message)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(() => sendResponse({ status: 'error' }));
        return true;
    } else if (message.type === 'PROXY_TELEMETRY') {
        acceptAndProxyTelemetry(message.payload, sender)
            .then((result) => sendResponse(result?.status === 'dropped' ? result : { status: 'ok', result }))
            .catch((err) => sendResponse({ status: 'error', error: err.message }));
        return true;
    }
});

async function handleDiagnosticLogging(payload) {
  const { crash_log_phimmoichill = [] } = await chrome.storage.local.get(['crash_log_phimmoichill']);

  const entry = {
    type: payload.logType,
    domain: payload.identity?.site_domain || 'unknown',
    url: payload.data?.url || 'unknown',
    details: payload.data?.content || {},
    timestamp: payload.timestamp || Date.now()
  };

  // FIFO: Newest first, limit to 10
  crash_log_phimmoichill.unshift(entry);
  if (crash_log_phimmoichill.length > 10) crash_log_phimmoichill.length = 10;

  await chrome.storage.local.set({ crash_log_phimmoichill });
  console.log(`[AdsFriendly Background] 📝 Diagnostic Logged: ${entry.type} on ${entry.domain}`);
}

async function handleNeuralLogging(entry) {
  const { neuroLogs = [] } = await chrome.storage.local.get(['neuroLogs']);
  neuroLogs.unshift({
    ...entry,
    timestamp: Date.now()
  });

  // Prune to 50 logs
  if (neuroLogs.length > 50) neuroLogs.length = 50;
  await chrome.storage.local.set({ neuroLogs });
}

async function updateSiteReputation(hostname, blockedCount) {
  const { siteReputation = {} } = await chrome.storage.local.get('siteReputation');
  if (!siteReputation[hostname]) {
    siteReputation[hostname] = { trustScore: 0.5, blockActivity: 0 };
  }

  const data = siteReputation[hostname];
  data.blockActivity = Math.max(data.blockActivity, blockedCount);

  // If a site has more than 10 blocks, it starts losing trust
  if (blockedCount > 10) {
    data.trustScore = Math.max(0, data.trustScore - 0.05);
  } else if (blockedCount <= 1) {
    data.trustScore = Math.min(1, data.trustScore + 0.01);
  }

  await chrome.storage.local.set({ siteReputation });
}

async function cleanupStaleMemory() {
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const { siteResetHistory = {} } = await chrome.storage.local.get('siteResetHistory');

  let changed = false;
  for (const hostname in siteResetHistory) {
    if (now - siteResetHistory[hostname].timestamp > THIRTY_DAYS) {
      delete siteResetHistory[hostname];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ siteResetHistory });
    console.log('[AdsFriendly Background] Stale behavioral memory cleaned up.');
  }
}

// Trigger cleanup on Startup
chrome.runtime.onStartup.addListener(cleanupStaleMemory);
// Also run it now if just installed or updated
cleanupStaleMemory();

async function handleLearnVideoAd(data) {
  const { src, hostname } = data;
  if (!src) return;

  let patternValue = src;
  try {
    const url = new URL(src);
    // If it's a known cloud host, learn the domain. If it's a specific path, find the pattern.
    if (url.hostname.includes('github') || url.hostname.includes('s3') || url.hostname.includes('cdn')) {
      patternValue = url.hostname;
    } else {
      // Take the domain + first part of path
      const pathParts = url.pathname.split('/');
      patternValue = url.hostname + (pathParts[1] ? '/' + pathParts[1] : '');
    }
  } catch (e) {
    // Fallback to substring if not a valid URL
    patternValue = src.split('?')[0].substring(0, 50);
  }

  const { globalAdPatterns = [] } = await chrome.storage.local.get(['globalAdPatterns']);

  const existing = globalAdPatterns.find(p => p.type === 'video_source_marker' && p.value === patternValue);

  if (existing) {
    existing.confidence = 1.0; // User manual mark is definitive
  } else {
    globalAdPatterns.push({
      type: 'video_source_marker',
      value: patternValue,
      confidence: 1.0,
      source: hostname
    });
  }

  await chrome.storage.local.set({ globalAdPatterns });
}

async function handleLearnDomains(domains) {
  if (!domains || !Array.isArray(domains)) return;

  const { globalAdPatterns = [] } = await chrome.storage.local.get(['globalAdPatterns']);
  let changed = false;

  domains.forEach(domain => {
    // Sanitize: Ignore very common domains or invalid ones
    if (domain.length < 4 || domain.includes('google.com') || domain.includes('facebook.com')) return;

    const existing = globalAdPatterns.find(p => p.type === 'domain' && p.value === domain);
    if (!existing) {
      console.log(`%c[AdsFriendly AI] Neural Learning: Blacklisting ad-domain from user zap: ${domain}`, "color: #10b981; font-weight: bold;");
      globalAdPatterns.push({
        type: 'domain',
        value: domain,
        confidence: 1.0, // Definitive user signal
        timestamp: Date.now()
      });
      changed = true;
    }
  });

  if (changed) {
    await chrome.storage.local.set({ globalAdPatterns });
  }
}

async function handleVideoLearning(data) {
  const { classes, hostname } = data;
  if (!classes) return;

  // Filter relevant architectural classes
  const classList = classes.split(' ').filter(c =>
    (c.includes('ad') || c.includes('player') || c.includes('video')) && !c.includes('content')
  );

  if (classList.length === 0) return;

  const { globalAdPatterns = [] } = await chrome.storage.local.get(['globalAdPatterns']);

  classList.forEach(cls => {
    const normalizedCls = cls.replace(/-\d+$/, '-*').replace(/:\d+$/, ':*');
    const patternValue = `.${normalizedCls}`;

    const existing = globalAdPatterns.find(p => p.type === 'video_marker' && p.value === patternValue);

    if (existing) {
      existing.confidence = Math.min(1.0, existing.confidence + 0.1);
      existing.lastSeen = Date.now();
    } else {
      globalAdPatterns.push({
        type: 'video_marker',
        value: patternValue,
        confidence: 0.5,
        source: hostname,
        lastSeen: Date.now()
      });
    }
  });

  await chrome.storage.local.set({ globalAdPatterns: globalAdPatterns.slice(-200) });
}

// v2.8.12: Neural Fusion (Unified Brain)
async function handleReportVideoDecision(data) {
  const { domain, type } = data; // type: 'AD' or 'CONTENT'
  if (!domain || domain === 'unknown') return;

  const { globalAdPatterns = [] } = await chrome.storage.local.get(['globalAdPatterns']);

  let existing = globalAdPatterns.find(p => p.type === 'reputation' && p.value === domain);

  if (!existing) {
    existing = {
      type: 'reputation',
      value: domain,
      adCount: 0,
      contentCount: 0,
      lastSeen: Date.now()
    };
    globalAdPatterns.push(existing);
  }

  if (type === 'AD') existing.adCount++;
  else if (type === 'CONTENT') existing.contentCount++;

  existing.lastSeen = Date.now();

  // Cap at reasonable limits to prevent overflow
  if (existing.adCount > 100) existing.adCount = 100;
  if (existing.contentCount > 100) existing.contentCount = 100;

  await chrome.storage.local.set({ globalAdPatterns: globalAdPatterns.slice(-300) });
}

const PROTECTED_KEYWORDS = [
  'messenger', 'chat', 'inbox', 'cart', 'checkout', 'search', 'account', 'login', 'social', 'notification',
  'swiper', 'carousel', 'slick', 'owl-', 'slide'
];

async function handleNegativeLearning(fingerprint) {
  if (!fingerprint) return;
  const { safePatterns = [], infrastructurePatterns = [] } = await chrome.storage.local.get(['safePatterns', 'infrastructurePatterns']);

  const entry = { value: fingerprint.alt || fingerprint.title, type: fingerprint.alt ? 'alt' : 'title' };
  if (!entry.value) return;

  // Add to safe patterns (Potential Infrastructure)
  if (!safePatterns.some(p => p.value === entry.value)) {
    safePatterns.push(entry);
  }

  // Explicitly track recently undone parents for refinement
  if (!infrastructurePatterns.some(p => p.value === entry.value)) {
    infrastructurePatterns.push({ ...entry, timestamp: Date.now() });
  }

  await chrome.storage.local.set({ safePatterns, infrastructurePatterns });

  // Clean up global patterns
  const { globalAdPatterns = [] } = await chrome.storage.local.get('globalAdPatterns');
  const filtered = globalAdPatterns.filter(p => p.value !== entry.value);
  await chrome.storage.local.set({ globalAdPatterns: filtered });

  console.log("Deep Reflex: Root element marked as Infrastructure candidate.", entry.value);
}

/**
 * The 'Brain': Aggregates local custom rules into global patterns
 */
async function synthesizeGlobalPatterns() {
  const { userCustomRules = {} } = await chrome.storage.local.get('userCustomRules');
  const { safePatterns = [] } = await chrome.storage.local.get('safePatterns');
  const attrFrequency = {};
  const domainSpread = {}; // How many domains use this pattern

  // Scan all rules across all domains
  Object.entries(userCustomRules).forEach(([domain, rules]) => {
    rules.forEach(rule => {
      if (rule && rule.fingerprint) {
        const { alt, title, linkDomain } = rule.fingerprint;
        const process = (type, val) => {
          if (!val || val.length < 3) return;
          const key = `${type}:${val}`;
          attrFrequency[key] = (attrFrequency[key] || 0) + 1;
          if (!domainSpread[key]) domainSpread[key] = new Set();
          domainSpread[key].add(domain);
        };
        process('alt', alt);
        process('title', title);
        process('domain', linkDomain);
      }
    });
  });

  const isSafe = (type, val) => safePatterns.some(p => p.type === type && p.value === val);
  const isProtected = (val) => PROTECTED_KEYWORDS.some(kw => val.toLowerCase().includes(kw));

  // Synthesize: Ad Patterns = (High Frequency + Low Undo Rate)
  const globalPatterns = Object.entries(attrFrequency)
    .filter(([key, count]) => {
      const [type, value] = key.split(':');
      const spread = domainSpread[key].size;

      // Deep Reflex: Even if it's 'Safe' (Undone before), 
      // if it's being specifically zapped AGAIN as a child, 
      // it overrides the safety for that specific pattern.
      // (Handled by verifying current userCustomRules state)
      return !isProtected(value) && spread >= 1;
    })
    .map(([key, count]) => {
      const [type, value] = key.split(':');
      const spread = domainSpread[key].size;

      // Boost confidence if it's frequently zapped despite common safe ancestors
      let confidence = Math.min((count + (spread * 2)) / 10, 1.0);

      // Penalty if it was explicitly marked safe
      if (isSafe(type, value)) confidence *= 0.3;

      return { type, value, confidence };
    });

  await chrome.storage.local.set({ globalAdPatterns: globalPatterns });
  console.log("Deep Reflex: Brain synthesize complete. Active patterns:", globalPatterns.length);
}

// Layer 2: In-page Blocking (DNR Ruleset)
async function toggleInPageBlocking(enabled) {
  try {
    if (enabled) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ["ruleset_1"]
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ["ruleset_1"]
      });
    }
    console.log("DNR Ruleset updated:", enabled);
  } catch (err) {
    console.error("DNR update error:", err);
  }
}

// Auto-off: No longer used on startup to persist user choice
// Reset ONLY on first installation if not set
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get(['friendlyMode', 'isEnabled', 'globalAdPatterns']);

  // Seed the "Basic Brain" (Global Ad Patterns) for Public Baseline v1.0
  if (!result.globalAdPatterns || result.globalAdPatterns.length === 0) {
    const baselineSeeds = [
      { type: 'alt', value: 'Ad', confidence: 0.9 },
      { type: 'alt', value: 'Advertisement', confidence: 0.9 },
      { type: 'alt', value: 'Sponsored', confidence: 0.9 },
      { type: 'alt', value: 'Promoted', confidence: 0.9 },
      { type: 'title', value: 'Ads by Google', confidence: 1.0 },
      { type: 'domain', value: 'taboola.com', confidence: 1.0 },
      { type: 'domain', value: 'outbrain.com', confidence: 1.0 },
      { type: 'domain', value: 'mgid.com', confidence: 1.0 },
      { type: 'domain', value: 'adnxs.com', confidence: 1.0 }
    ];
    await chrome.storage.local.set({ globalAdPatterns: baselineSeeds });
    console.log('[AdsFriendly AI] Basic Brain seeded with baseline patterns for public release.');
  }

  if (result.friendlyMode === undefined) {
    await chrome.storage.local.set({ friendlyMode: true });
    toggleInPageBlocking(false);
  }

  if (result.isEnabled === undefined) {
    await chrome.storage.local.set({ isEnabled: true });
  }
});

// Separate handler for cleaner async/await
async function handleUserDecision(message, sender = null) {
  const { action, domain } = message;

  if (action === 'WHITELIST') {
    const { whitelist = [] } = await chrome.storage.local.get(['whitelist']);
    if (!whitelist.includes(domain)) {
      whitelist.push(domain);
      await chrome.storage.local.set({ whitelist });
    }
    emitKnowledgeRecord({
      knowledgeType: 'trusted_site',
      subject: { domain },
      source: 'user_explicit',
      sensor: 'blocked_ui',
      pageDomain: domain,
      targetDomain: domain,
      metadata: { action: 'WHITELIST', senderTabId: sender?.tab?.id || null }
    });
  } else if (action === 'BLACKLIST') {
    const { blacklist = [] } = await chrome.storage.local.get(['blacklist']);
    const standardRule = `||${domain}^`;
    if (!blacklist.includes(standardRule)) {
      blacklist.push(standardRule);
      await chrome.storage.local.set({ blacklist });
    }
    emitKnowledgeRecord({
      knowledgeType: 'blocked_site',
      subject: { domain, rule: standardRule },
      source: 'user_explicit',
      sensor: 'blocked_ui',
      pageDomain: domain,
      targetDomain: domain,
      metadata: { action: 'BLACKLIST', senderTabId: sender?.tab?.id || null }
    });
  }
}

/**
 * Deep Pulse: Workflow Learning Engine
 */
async function syncTrustedPath(source, target, isManual = false) {
  if (!source || !target || source === target) return;
  const shardKey = `p:${source}>${target}`;

  const result = await chrome.storage.local.get([shardKey]);
  const entry = result[shardKey] || { source, target, visits: 0, isManual: false, lastUpdated: Date.now() };

  entry.visits++;
  if (isManual) {
    entry.isManual = true;
    entry.visits = Math.max(entry.visits, 99); // Immediate trust threshold
  }
  entry.lastUpdated = Date.now();

  await chrome.storage.local.set({ [shardKey]: entry });
  console.log(`[AdsFriendly Pulse] Path learned: ${source} -> ${target} (Visits: ${entry.visits}, Manual: ${entry.isManual})`);
  if (entry.isManual || entry.visits === 1 || entry.visits === 3) {
    emitKnowledgeRecord({
      knowledgeType: 'learned_workflow',
      subject: { source, target, visits: entry.visits, isManual: entry.isManual },
      source: isManual ? 'user_explicit' : 'behavioral_learning',
      sensor: 'deep_pulse',
      pageDomain: source,
      targetDomain: target,
      metadata: { shardKey, visits: entry.visits, isManual: entry.isManual }
    });
  }
}

async function logBlockedNavigation(url, source) {
  const { blockedLogs = [] } = await chrome.storage.local.get(['blockedLogs']);
  const entry = { url, source, timestamp: Date.now() };

  // Keep only last 20 events
  const updated = [entry, ...blockedLogs].slice(0, 20);
  await chrome.storage.local.set({ blockedLogs: updated });
}

// Helper to update badge
async function updateBadge() {
  const { blockedCount = 0 } = await chrome.storage.local.get(['blockedCount']);
  if (blockedCount > 0) {
    chrome.action.setBadgeText({ text: blockedCount.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#FF4D4C' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Helper to increment blocked count
async function proxyTelemetry(payload) {
    // 🚩 EGRESS LOG: Cửa ra cuối cùng trước khi về Server
    console.log("%c[Vanguard Egress] 🚀 Sending data to Servermock...", "color: #f59e0b; font-weight: bold;");
    console.log("Payload Payload:", payload);

    try {
        const response = await fetch('http://localhost:3000/telemetry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const body = await response.json().catch(() => ({
            success: response.ok,
            parse_error: true
        }));
        return {
            success: response.ok,
            status: response.status,
            body
        };
    } catch (err) {
        console.error("Telemetry failed:", err);
        return {
            success: false,
            status: 0,
            error: err.message
        };
    }
}

async function incrementBlockedCount() {
  const result = await chrome.storage.local.get(['blockedCount']);
  const count = (result.blockedCount || 0) + 1;
  await chrome.storage.local.set({ blockedCount: count });
  updateBadge();
}

// Core System Whitelist (Total Immunity - Optional SOFT usage)
const CORE_SYSTEM_DOMAINS = ['cloudflare.com', 'google.com', 'github.com', 'stackexchange.com', 'stackoverflow.com'];
function isCoreSystem(hostname) {
  return CORE_SYSTEM_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
}

// Helper to analyze if an URL is a stealth ad/pop-under
function isSuspiciousURL(url, globalPatterns = []) {
  try {
    const u = new URL(url);
    // 1. Parameter patterns
    const suspiciousParams = ['utm_', 'aff_', 'clickid', 'pop_', 'bannerid', 'zoneid'];
    if (suspiciousParams.some(p => u.search.includes(p))) return true;

    // 2. Domain Match with AI Brain
    const domainMatch = globalPatterns.some(p => p.type === 'domain' && u.hostname.includes(p.value));
    if (domainMatch) return true;

    return false;
  } catch (e) { return false; }
}

// Get Dynamic Trust Window based on site reputation
async function getDynamicTrustWindow(hostname) {
  const { siteReputation = {} } = await chrome.storage.local.get('siteReputation');
  const rep = siteReputation[hostname];
  if (rep && rep.blockedAdCount > 10) return 500; // Strict for ad-heavy sites
  return 2000; // Default
}

// Listen for new tab creation (v2.6 Intent Lock Core)
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  const { sourceTabId, tabId, url } = details;
  try {
    const { isEnabled, globalAdPatterns = [], blacklist = [] } = await chrome.storage.local.get(['isEnabled', 'globalAdPatterns', 'blacklist']);
    if (isEnabled === false) return;

    const sourceTab = await chrome.tabs.get(sourceTabId);
    if (!sourceTab || !sourceTab.url || !sourceTab.url.startsWith('http')) return;

    const sourceUrl = new URL(sourceTab.url);
    const targetUrl = new URL(url);
    const targetDomain = targetUrl.hostname;

    // v4.4 SILENT BLACKLIST KILLER
    // If domain is already blacklisted (or ends with blacklisted pattern), kill silently
    const isBlacklisted = blacklist.some(entry => {
      const pattern = entry.replace(/^\|\|/, '').replace(/\^$/, '');
      return targetDomain === pattern || targetDomain.endsWith('.' + pattern);
    });

    if (isBlacklisted) {
      console.log(`%c[AdsFriendly AI] Silent Kill: Blacklisted domain ${targetDomain} neutralized.`, "color: #ef4444; font-weight: bold;");
      await incrementBlockedCount();
      await logBlockedNavigation(url, sourceUrl.hostname);
      chrome.tabs.remove(tabId); // Direct closure for blacklist
      return;
    }

    if (sourceUrl.hostname === targetDomain) return;

    // v2.5 MUST-KILL Check: If the URL is suspicious, kill it
    if (isSuspiciousURL(url, globalAdPatterns)) {
      console.log(`%c[AdsFriendly AI] Stealth Pop-under neutralized: ${targetDomain}`, "color: #ef4444; font-weight: bold;");
      await logBlockedNavigation(url, sourceUrl.hostname);
      const blockedUrl = chrome.runtime.getURL(`ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(sourceUrl.hostname)}`);
      chrome.tabs.update(tabId, { url: blockedUrl });
      return;
    }

    // v2.6 Intent Lock Core: Is this tab what the user actually clicked?
    let isIntentMatched = false;
    if (lastTrustedClick.intentUrl) {
      try {
        const intentUrl = new URL(lastTrustedClick.intentUrl);
        // Match if same domain or subdomain
        if (targetDomain === intentUrl.hostname || targetDomain.endsWith('.' + intentUrl.hostname)) {
          isIntentMatched = true;
        }
      } catch (e) { }
    }

    // 1. Deep Pulse: Check Sharded Trusted Path
    const shardKey = `p:${sourceUrl.hostname}>${targetDomain}`;
    const pulseResult = await chrome.storage.local.get([shardKey]);
    const path = pulseResult[shardKey];

    if (path && (path.isManual || path.visits >= 3)) return;

    // 2. Check Whitelist
    const { whitelist = [] } = await chrome.storage.local.get(['whitelist']);
    if (whitelist.includes(targetDomain)) return;

    // 3. Evaluation: Intent and Dynamic Trust Window
    const trustWindow = await getDynamicTrustWindow(sourceUrl.hostname);
    const timeSinceClick = Date.now() - lastTrustedClick.timestamp;

    // If intent doesn't match AND it's a cross-domain navigation, it's a Click-jack
    if (!isIntentMatched && timeSinceClick < trustWindow) {
      console.log(`%c[AdsFriendly AI] Click-jack detected! Destination ${targetDomain} does not match intent.`, "color: #f59e0b; font-weight: bold;");
      await logBlockedNavigation(url, sourceUrl.hostname);
      const blockedUrl = chrome.runtime.getURL(`ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(sourceUrl.hostname)}`);
      chrome.tabs.update(tabId, { url: blockedUrl });
      return;
    }

    if (timeSinceClick > trustWindow) {
      console.log(`[AdsFriendly AI] Blocked unauthorized new tab: ${targetDomain}`);
      await logBlockedNavigation(url, sourceUrl.hostname);
      const blockedUrl = chrome.runtime.getURL(`ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(sourceUrl.hostname)}`);
      chrome.tabs.update(tabId, { url: blockedUrl });
    } else {
      syncTrustedPath(sourceUrl.hostname, targetDomain);
    }
  } catch (err) {
    console.error("Error evaluating navigation:", err);
  }
});

// Tab-under prevention
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // If the "opener" tab changes its URL immediately after opening a popup
  // This logic can be expanded to detect tab-under specifically
});
