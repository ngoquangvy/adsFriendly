// engine/forensic/verifier.js
(function (root) {
    const LEDGER_TTL_MS = 2 * 60 * 1000;

    function asObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function asString(value, fallback = '') {
        return typeof value === 'string' ? value : fallback;
    }

    function asNumber(value, fallback = 0) {
        return Number.isFinite(value) ? value : fallback;
    }

    function stableHash(input) {
        const text = typeof input === 'string' ? input : JSON.stringify(input);
        let hash = 5381;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) + hash) + text.charCodeAt(i);
        }
        return (hash >>> 0).toString(16);
    }

    function normalizeRecord(recordLike = {}) {
        const record = asObject(recordLike);
        const identity = asObject(record.identity);
        const observation = asObject(record.observation);
        const forensic = asObject(record.forensic);
        const trace = asObject(forensic.trace);

        return {
            record,
            recordType: asString(record.record_type, 'event'),
            source: asObject(record.source),
            identity: {
                eventId: asString(identity.event_id, ''),
                epoch: asNumber(identity.epoch, 0),
                timestamp: asNumber(identity.timestamp, 0),
                tabInstanceId: identity.tab_instance_id ?? null,
                sessionId: identity.session_id ?? null,
                pageDomain: identity.page_domain ?? null
            },
            observation: {
                domain: observation.domain ?? null,
                entityType: asString(observation.entity_type, 'RESOURCE'),
                phase: observation.phase ?? null
            },
            classification: asObject(record.classification),
            decision: asObject(record.decision),
            forensic: {
                schemaHash: forensic.schema_hash ?? null,
                valid: typeof forensic.valid === 'boolean' ? forensic.valid : null,
                riskFlags: asArray(forensic.risk_flags),
                trace: {
                    radar_ts: asNumber(trace.radar_ts, 0) || null,
                    bridge_ts: asNumber(trace.bridge_ts, 0) || null,
                    orchestrator_ts: asNumber(trace.orchestrator_ts, 0) || null,
                    background_ts: asNumber(trace.background_ts, 0) || null
                }
            },
            extensions: asObject(record.extensions)
        };
    }

    const Verifier = {
        _ledger: new Map(),

        _cleanup(now = Date.now()) {
            for (const [eventId, entry] of this._ledger.entries()) {
                if ((now - (entry.lastSeen || 0)) > LEDGER_TTL_MS) {
                    this._ledger.delete(eventId);
                }
            }
        },

        _resolveProfile(normalized, stage) {
            const recordType = normalized.recordType;
            const sensor = asString(normalized.source.sensor, '');
            const pipeline = asString(normalized.source.pipeline, '');

            if (recordType === 'knowledge') {
                return {
                    name: 'knowledge',
                    requiresCommitStage: false,
                    requireTabInstance: false,
                    requiredTrace: stage === 'telemetry' ? ['background_ts'] : []
                };
            }

            if (sensor === 'picker' || sensor === 'blocked_ui') {
                return {
                    name: 'user_action',
                    requiresCommitStage: false,
                    requireTabInstance: false,
                    requiredTrace: stage === 'telemetry' ? ['background_ts'] : []
                };
            }

            if (sensor === 'legacy_engine' || sensor === 'legacy') {
                return {
                    name: 'legacy_compat',
                    requiresCommitStage: false,
                    requireTabInstance: false,
                    requiredTrace: stage === 'telemetry' ? ['background_ts'] : []
                };
            }

            if (pipeline === 'RuntimePipeline' || sensor === 'xhr_radar') {
                return {
                    name: 'runtime_network',
                    requiresCommitStage: stage === 'telemetry',
                    requireTabInstance: true,
                    requiredTrace: stage === 'commit'
                        ? ['radar_ts', 'bridge_ts', 'orchestrator_ts']
                        : ['radar_ts', 'bridge_ts', 'orchestrator_ts', 'background_ts']
                };
            }

            return {
                name: 'generic',
                requiresCommitStage: false,
                requireTabInstance: false,
                requiredTrace: stage === 'telemetry' ? ['background_ts'] : []
            };
        },

        _buildSnapshot(normalized, stage, context, profile, riskFlags) {
            return {
                eventId: normalized.identity.eventId,
                epoch: normalized.identity.epoch,
                timestamp: normalized.identity.timestamp,
                tabInstanceId: normalized.identity.tabInstanceId,
                stage,
                profile: profile.name,
                schemaHash: normalized.forensic.schemaHash,
                domain: normalized.observation.domain,
                trace: normalized.forensic.trace,
                decisionPath: normalized.extensions?.legacy?.decision_path || null,
                stateSnapshot: asObject(context.stateSnapshot),
                riskFlags: [...riskFlags],
                schema_hash: normalized.forensic.schemaHash || null
            };
        },

        _registerStage(normalized, stage, context, profile, riskFlags) {
            const now = Date.now();
            const entry = this._ledger.get(normalized.identity.eventId) || {
                stages: new Set(),
                epoch: normalized.identity.epoch,
                timestamp: normalized.identity.timestamp,
                tabInstanceId: normalized.identity.tabInstanceId,
                profile: profile.name,
                schemaHash: normalized.forensic.schemaHash,
                trace: normalized.forensic.trace,
                stateSnapshot: asObject(context.stateSnapshot),
                lastSeen: now
            };

            entry.stages.add(stage);
            entry.epoch = normalized.identity.epoch;
            entry.timestamp = normalized.identity.timestamp;
            entry.tabInstanceId = normalized.identity.tabInstanceId;
            entry.profile = profile.name;
            entry.schemaHash = normalized.forensic.schemaHash || entry.schemaHash;
            entry.trace = { ...(entry.trace || {}), ...normalized.forensic.trace };
            entry.stateSnapshot = Object.keys(asObject(context.stateSnapshot)).length > 0
                ? asObject(context.stateSnapshot)
                : entry.stateSnapshot;
            entry.lastSeen = now;
            entry.riskFlags = [...riskFlags];
            this._ledger.set(normalized.identity.eventId, entry);
        },

        _verifyRecord(recordLike, stage, context = {}) {
            const now = Date.now();
            this._cleanup(now);

            const normalized = normalizeRecord(recordLike);
            const profile = this._resolveProfile(normalized, stage);
            const riskFlags = new Set(normalized.forensic.riskFlags);
            const failures = [];
            const eventId = normalized.identity.eventId;
            const existing = eventId ? this._ledger.get(eventId) : null;

            if (!eventId) {
                riskFlags.add('MISSING_EVENT_ID');
                failures.push('MISSING_EVENT_ID');
            }

            if (!normalized.identity.epoch) {
                riskFlags.add('MISSING_EPOCH');
                failures.push('MISSING_EPOCH');
            }

            if (!normalized.identity.timestamp) {
                riskFlags.add('MISSING_TIMESTAMP');
                failures.push('MISSING_TIMESTAMP');
            }

            if (context.expectedEpoch && normalized.identity.epoch !== context.expectedEpoch) {
                riskFlags.add('EPOCH_DRIFT');
                failures.push('EPOCH_DRIFT');
            }

            if (profile.requireTabInstance && !normalized.identity.tabInstanceId) {
                riskFlags.add('MISSING_TAB_INSTANCE');
                failures.push('MISSING_TAB_INSTANCE');
            }

            if (context.expectedTabInstanceId && normalized.identity.tabInstanceId && normalized.identity.tabInstanceId !== context.expectedTabInstanceId) {
                riskFlags.add('STATE_LEAK');
                failures.push('STATE_LEAK');
            }

            for (const traceKey of profile.requiredTrace) {
                if (!normalized.forensic.trace[traceKey]) {
                    riskFlags.add(`TRACE_${traceKey.toUpperCase()}_MISSING`);
                    failures.push(`TRACE_${traceKey.toUpperCase()}_MISSING`);
                }
            }

            const { radar_ts, bridge_ts, orchestrator_ts, background_ts } = normalized.forensic.trace;
            if (radar_ts && bridge_ts && radar_ts > bridge_ts) {
                riskFlags.add('ORDER_BREAK');
                failures.push('ORDER_BREAK');
            }
            if (bridge_ts && orchestrator_ts && bridge_ts > orchestrator_ts) {
                riskFlags.add('ORDER_BREAK');
                failures.push('ORDER_BREAK');
            }
            if (stage === 'telemetry' && orchestrator_ts && background_ts && orchestrator_ts > background_ts) {
                riskFlags.add('ORDER_BREAK');
                failures.push('ORDER_BREAK');
            }

            if (eventId && existing?.stages?.has(stage)) {
                riskFlags.add('DUPLICATE_EVENT');
                failures.push('DUPLICATE_EVENT');
            }

            if (profile.requiresCommitStage && stage === 'telemetry' && !existing?.stages?.has('commit')) {
                riskFlags.add('ORDER_BREAK');
                failures.push('ORDER_BREAK');
            }

            if (eventId && existing && existing.epoch !== normalized.identity.epoch) {
                riskFlags.add('EPOCH_DRIFT');
                failures.push('EPOCH_DRIFT');
            }

            const ok = failures.length === 0;
            const orderedRiskFlags = Array.from(riskFlags);
            const snapshot = this._buildSnapshot(normalized, stage, context, profile, orderedRiskFlags);

            if (ok) {
                this._registerStage(normalized, stage, context, profile, orderedRiskFlags);
            }

            return {
                ok,
                status: ok ? 'accepted' : 'rejected',
                stage,
                profile: profile.name,
                reason: ok ? 'VERIFIED' : failures[0],
                riskFlags: orderedRiskFlags,
                failures,
                event: snapshot
            };
        },

        verifyCommitMessage(message = {}, context = {}) {
            const envelope = asObject(message.verificationEnvelope);
            const record = envelope.record || message.record || {};
            return this._verifyRecord(record, 'commit', {
                expectedEpoch: context.expectedEpoch,
                expectedTabInstanceId: context.expectedTabInstanceId,
                stateSnapshot: envelope.stateSnapshot || message.update?.updates || {}
            });
        },

        verifyTelemetryPayload(payload = {}, context = {}) {
            const record = payload.record || {};
            return this._verifyRecord(record, 'telemetry', {
                expectedEpoch: context.expectedEpoch,
                expectedTabInstanceId: context.expectedTabInstanceId,
                stateSnapshot: payload.decision_layer?.extensions?.legacy || {}
            });
        }
    };

    root.Engine = root.Engine || {};
    root.Engine.forensic = root.Engine.forensic || {};
    root.Engine.forensic.Verifier = Verifier;
    root.VanguardVerifier = Verifier;

    if (typeof module !== 'undefined') {
        module.exports = Verifier;
    }
})(typeof self !== 'undefined' ? self : globalThis);
