/**
 * AdsFriendly: BrainBridge
 * Transport-only bridge between capture sensors and the runtime pipeline.
 * Queue / retry / timeout behavior is limited to transport resilience.
 */
const createMessageId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2);
};

const BrainBridge = {
    mode: 'VANGUARD_FORENSIC',
    _epoch: 0,
    _eventSeq: 0,
    _isSynced: false,
    _initDone: false,
    _epochListenerBound: false,
    _lastHandshakeAt: 0,
    _eventQueue: [],          // ✅ Queue events while waiting for sync
    _retryAttempts: {},       // ✅ Track retry attempts per requestId
    _maxRetries: 2,           // ✅ Max retry attempts for pipeline timeout
    _maxQueueSize: 100,       // ✅ Prevent memory leak

    async init() {
        if (this._initDone) return;
        this._initDone = true;
        if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem('__V_TAB_ID')) {
            sessionStorage.setItem('__V_TAB_ID', `tabinst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        }
        this.initEpochSync();
        this.requestHandshake();
    },

    async dispatch(partialEvent) {
        this._eventSeq++;
        const eventId = `${this._epoch}:${this._eventSeq}`;
        const now = Date.now();

        // ✅ Schema validation: Check required fields
        const validation = this.validateEvent(partialEvent);
        if (!validation.isValid) {
            console.warn('[BrainBridge] Schema validation failed:', validation.errors, partialEvent);
            return this._fallback(eventId, now, 'unknown', `SCHEMA_ERROR:${validation.errors[0]}`);
        }

        // ✅ Backward compat: If partialEvent already has action: 'queued', return as-is
        if (partialEvent.action === 'queued' || partialEvent.action === 'QUEUED') {
            return partialEvent;
        }

        const url = this.standardizeUrl(partialEvent.url);
        const domainRaw = this.extractDomain(url);
        const domain = this.normalizeDomain(domainRaw);

        // ✅ Queue events while waiting for sync (instead of immediate fallback)
        if (!this._isSynced) {
            this.requestHandshake();
            if (this._eventQueue.length < this._maxQueueSize) {
                this._eventQueue.push({ partialEvent, url, domain, domainRaw, eventId, timestamp: now });
                return { eventId, action: 'queued', reason: 'WAIT_SYNC' };
            }
            return this._fallback(eventId, now, domain, 'QUEUE_FULL');
        }

        const event = {
            ...partialEvent,
            eventId,
            epoch: this._epoch,
            timestamp: now,
            trace: {
                ...(partialEvent.trace || {}),
                bridge_ts: now
            },
            url,
            domain,
            domainRaw
        };

        return this.requestPipeline(event, now, domain);
    },

    normalizeDomain(domain) {
        const normalizer = this.getUrlNormalizer();
        return normalizer.normalizeDomain(domain);
    },

    standardizeUrl(input) {
        const normalizer = this.getUrlNormalizer();
        return normalizer.standardizeUrl(input, window.location?.href);
    },

    extractDomain(url) {
        const normalizer = this.getUrlNormalizer();
        return normalizer.extractDomain(url, window.location?.href);
    },

    validateEvent(event) {
        const errors = [];
        if (!event) errors.push('event_null');
        if (!event?.url) errors.push('url_missing');
        if (typeof event?.requestId !== 'string') errors.push('requestId_invalid');
        if (!event?.type) errors.push('type_missing');
        if (!event?.phase) errors.push('phase_missing');
        return { isValid: errors.length === 0, errors };
    },

    async requestPipeline(event, timestamp, domain, retryCount = 0) {
        return new Promise((resolve) => {
            const requestId = createMessageId();
            // ✅ Increased timeout from 1000ms → 2000ms
            const timeout = setTimeout(() => {
                window.removeEventListener('message', handler);
                
                // ✅ Retry mechanism: up to 2 retries
                if (retryCount < this._maxRetries) {
                    console.warn(`[BrainBridge] Pipeline timeout, retrying (attempt ${retryCount + 2}/${this._maxRetries + 1})`);
                    this.requestPipeline(event, timestamp, domain, retryCount + 1)
                        .then(resolve)
                        .catch(() => resolve(this._fallback(event.eventId, timestamp, domain, `PIPELINE_TIMEOUT_RETRY_${retryCount + 1}`)));
                } else {
                    // ✅ Log fallback event for tracking
                    console.error(`[BrainBridge] ❌ Pipeline timeout after ${this._maxRetries + 1} attempts, eventId: ${event.eventId}`);
                    resolve(this._fallback(event.eventId, timestamp, domain, 'PIPELINE_TIMEOUT_MAX_RETRIES'));
                }
            }, 2000);

            const handler = (e) => {
                if (e.data?.source !== 'adsfriendly-engine' ||
                    e.data?.type !== 'PIPELINE_RESULT' ||
                    e.data?.requestId !== requestId) {
                    return;
                }

                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                resolve(e.data.result || this._fallback(event.eventId, timestamp, domain, 'EMPTY_PIPELINE_RESULT'));
            };

            window.addEventListener('message', handler);
            window.postMessage({
                source: 'adsfriendly-engine',
                type: 'PIPELINE_EVENT',
                event,
                requestId
            }, '*');
        });
    },

    getUrlNormalizer() {
        return window.Engine?.shared?.UrlNormalizer || {
            normalizeDomain(domain) {
                if (!domain) return 'unknown';
                return String(domain).toLowerCase().replace(/\.+$/, '') || 'unknown';
            },
            standardizeUrl(input, baseHref = '') {
                try {
                    if (!input) return '';
                    return new URL(String(input).trim(), baseHref || 'https://fallback.local/').href;
                } catch (_) {
                    return String(input || '');
                }
            },
            extractDomain(url, baseHref = '') {
                try {
                    if (!url) return 'unknown';
                    if (/^(data:|blob:|mailto:|tel:|sms:)/i.test(url)) return 'special-protocol';
                    return new URL(url, baseHref || 'https://fallback.local/').hostname || 'unknown';
                } catch (_) {
                    return 'unknown';
                }
            }
        };
    },

    requestHandshake() {
        const now = Date.now();
        if (now - this._lastHandshakeAt < 250) return;
        this._lastHandshakeAt = now;
        window.postMessage({ source: 'adsfriendly-engine', type: 'INITIAL_HANDSHAKE' }, '*');
    },

    initEpochSync() {
        if (this._epochListenerBound) return;
        this._epochListenerBound = true;

        window.addEventListener('message', (e) => {
            if (e.data?.source !== 'adsfriendly-background') return;
            if (e.data.type !== 'EPOCH_UPDATE') return;

            const nextEpoch = Number.isFinite(e.data.epoch) ? e.data.epoch : 0;
            if (nextEpoch <= 0) return;

            this._epoch = nextEpoch;
            this._isSynced = true;
            this._eventSeq = 0;

            window.postMessage({
                source: 'adsfriendly-engine',
                type: 'ACK_EPOCH_SYNC',
                epoch: this._epoch,
                tabId: sessionStorage.getItem('__V_TAB_ID')
            }, '*');

            // ✅ Process queued events
            this._processEventQueue();
        });
    },

    _processEventQueue() {
        const queuedEvents = this._eventQueue.splice(0, this._eventQueue.length);
        console.log(`[BrainBridge] Processing ${queuedEvents.length} queued events`);
        
        queuedEvents.forEach(queued => {
            const event = {
                ...queued.partialEvent,
                eventId: queued.eventId,
                epoch: this._epoch,
                timestamp: queued.timestamp,
                trace: {
                    ...(queued.partialEvent.trace || {}),
                    bridge_ts: queued.timestamp,
                    queued_duration_ms: Date.now() - queued.timestamp
                },
                url: queued.url,
                domain: queued.domain,
                domainRaw: queued.domainRaw
            };
            this.requestPipeline(event, queued.timestamp, queued.domain).catch(err => {
                console.error('[BrainBridge] Error processing queued event:', err);
            });
        });
    },

    _fallback(eventId, timestamp, domain = 'unknown', label = 'FALLBACK') {
        // ✅ Log fallback events for debugging
        if (label && !label.includes('QUEUE') && !label.includes('queue')) {
            console.debug(`[BrainBridge] Fallback: ${label}, eventId: ${eventId}, domain: ${domain}`);
        }
        return {
            eventId,
            epoch: this._epoch,
            timestamp,
            action: 'allow',
            reason: label,
            score: 0,
            confidence: 0,
            domain,
            decisionPath: {
                triggeredRules: [],
                gatesPassed: [],
                blockedBy: [],
                finalDecisionReason: label.toLowerCase(),
                dominantContribution: 'none',
                causalChain: label.toLowerCase()
            },
            contributions: {},
            forensic: null
        };
    }
};

if (typeof window !== 'undefined') {
    BrainBridge.init();
    window.Engine = window.Engine || {};
    window.Engine.brainBridge = BrainBridge;
    window.BrainBridge = BrainBridge;
}

if (typeof window === 'undefined' && typeof module !== 'undefined') {
    module.exports = BrainBridge;
}
