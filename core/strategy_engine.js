/**
 * AdsFriendly: Strategy Engine v8 (Vanguard Adaptive Loop)
 *
 * 2. DECIDE — Strategy Selection (Scoring, Stickiness, Early Exit)
 * 3. ACT — Execution Layer (Guard, Jitter, Delay, Smooth)
 * 4. LEARN — Feedback + Adaptation (Severity, Dynamic Recovery, Decay)
 * 5. MEMORY — Site Learning (Similarity, Best Strategy)
 * 6. RUNTIME VALIDATION (2s Immuno-watch)
 */
window.AdsFriendlyStrategyEngine = {

    _defaultConfidence: { jump: 0.9, speed: 0.7, simulate: 0.5, interaction: 0.6, wait: 0.1 },

    SENSOR_SEVERITY: { TIME_DRIFT: 0.6, RATE_FORCED: 0.8, SEEK_BLOCKED: 1.0, HL_SEEK_BLOCKED: 1.0, EVENT_MISSING: 0.7 },

    // Learning Config
    CONFIDENCE_RECOVERY_BASE: 0.05,
    SOFT_WARN_DECAY_RATE: 0.1,
    EXPLORATION_BONUS: 0.05,
    EXPLORATION_WINDOW_MS: 30_000,
    VISIBILITY_STABLE_MS: 200,
    STRATEGY_STICKY_BIAS: 0.1,

    SAFE_MODE: { rate: 1.35, exitStableMs: 10_000, restoreMultiplier: 0.3 },

    _execGuard: {},
    _strategyBan: {},
    BAN_DECAY_RATE: 0.08,
    BAN_THRESHOLD: 1.0,

    _activeAdapters: new WeakMap(),
    _hysteresis: new WeakMap(),     // { lastStrategy, failTimestamps[], consecutiveFails }
    _siteMemory: {},                // { [memKey]: { [strategy]: score, lastTriedAt } }
    _prevRate: new WeakMap(),
    _runtimeValidation: new WeakMap(), // { strategy, appliedAt, softWarns, lastLearnAt }
    _visibilityState: new WeakMap(),
    _lastKnownFingerprints: {},
    _currentAdSignal: null,

    _setupNeuralBridge() {
        if (this._neuralBridgeInited) return;
        this._neuralBridgeInited = true;
        window.addEventListener("message", (e) => {
            if (e.data?.type === "VANGUARD_AD_SIGNAL") {
                this._currentAdSignal = e.data.payload;
                console.log("%c🔥 Ad detected (Network Signal):", "color: #ef4444; font-weight: bold;", this._currentAdSignal);
            }
        });
    },

    // ─────────────────────────────────────────────────────────────────
    // 8. Toàn bộ loop - TICK
    // ─────────────────────────────────────────────────────────────────
    attachToVideo(video) {
        this._setupNeuralBridge();
        if (this._activeAdapters.has(video)) return;
        const playerType = this._detectPlayerType(video);
        const adapter = this._createAdapter(playerType, video);
        adapter.attach();

        this._activeAdapters.set(video, { adapter, playerType, inSafeMode: false });
        this._hysteresis.set(video, { lastStrategy: null, failTimestamps: [] });
        this._prevRate.set(video, 1.0);
        this._runtimeValidation.set(video, { strategy: null, appliedAt: 0, softWarns: 0, lastLearnAt: Date.now() });

        this._startLoop(video);
    },

    _startLoop(video) {
        const tick = () => {
            if (!document.contains(video)) return;
            const entry = this._activeAdapters.get(video);
            if (entry) this._engineCycle(video, entry);
            document.hidden ? setTimeout(tick, 300) : requestAnimationFrame(tick);
        };
        tick();
    },

    /**
     * The Master Cycle: Sense → Decide → Act → Learn
     */
    _engineCycle(video, entry) {
        // --- 0. FAST PASS (Network Signal Supremacy) ---
        if (this._currentAdSignal) {
            // Signal Expiry: If sensors are 100% sure it's unknown content, clear signal
            const sensor = AdsFriendlyAdDetection.analyze(entry.adapter);
            if (sensor.adType === 'unknown' && sensor.confidence > 0.9) {
                console.log("%c[AdsFriendly Engine] Signal cleared by Sensor.", "color: #10b981;");
                this._currentAdSignal = null;
            } else {
                this._executeFastPass(video, this._currentAdSignal);
                return;
            }
        }

        // --- 1. SENSE (Ad Detection + Context) ---
        const detection = AdsFriendlyAdDetection.analyze(entry.adapter);
        const cb = detection.costBenefit;
        const hostname = window.location.hostname;
        const memKey = this._memKey(hostname, entry.playerType, video.duration);

        // --- 5. MEMORY & 4. LEARN (Periodic Updates) ---
        this._validateFingerprint(hostname, detection.fingerprint);
        this._learnCycle(video, memKey);

        // Not an ad or safe restore
        if (detection.adType === 'unknown' && detection.confidence < 0.3) {
            this._resetToSafeState(video, entry.adapter);
            return;
        }

        // 1.2 Dead Zone logic (Sense → Decision shortcut)
        if (cb.action === 'wait') { video.muted = true; return; }
        if (cb.action === 'safemode' || entry.inSafeMode) {
            this._handleSafeMode(video, entry, cb);
            return;
        }

        // --- 2. DECIDE (Strategy Selection) ---
        const strategy = this._decide(video, detection, memKey);
        
        // --- 3. ACT & 6. RUNTIME VALIDATION (Execute + Watch) ---
        this._act(video, strategy, entry.adapter, detection);

        // Notify content script of decision (Neural Bridge)
        this.notifyBrain({
            type: 'STRATEGY_DECISION',
            site: hostname,
            strategy,
            adType: detection.adType,
            confidence: detection.confidence,
            riskScore: detection.costBenefit.riskScore
        });
    },

    // ─────────────────────────────────────────────────────────────────
    // 2. DECIDE — Strategy Selection
    // ─────────────────────────────────────────────────────────────────
    _decide(video, detection, memKey) {
        const adapter = this._activeAdapters.get(video).adapter;
        const caps = adapter.getCapabilities();
        const mem  = this._getSiteMemory(memKey);
        const h    = this._hysteresis.get(video);
        const now  = Date.now();

        // 2.1 Per-strategy scoring
        const adTypeBoost = { ssai: { speed: 0.1, jump: 0.05 }, client: { jump: 0.1, speed: 0.05 }, overlay: { interaction: 0.15 } }[detection.adType] ?? {};
        
        const candidates = Object.entries(this._defaultConfidence)
            .map(([name, defConf]) => {
                let score = mem[name] ?? defConf;
                score += adTypeBoost[name] ?? 0;
                
                // 2.1 Exploration Bonus (+0.05 nếu >30s chưa thử)
                if (now - (mem.lastTried?.[name] ?? 0) > this.EXPLORATION_WINDOW_MS) score += this.EXPLORATION_BONUS;

                // 4.4 Strategy Stickiness
                if (h.lastStrategy === name) score += this.STRATEGY_STICKY_BIAS;

                return { name, score };
            })
            .filter(c => {
                const bKey = this._banKey(window.location.hostname);
                if (c.name === 'wait') return true;
                if (this._isBanned(bKey, c.name)) return false;
                if (c.name === 'jump' && !caps.canSeek) return false;
                if (c.name === 'speed' && !caps.canRateChange) return false;
                if (c.name === 'interaction' && !caps.supportsClickSim) return false;
                return true;
            })
            .sort((a, b) => b.score - a.score);

        // 2.3 Interaction trigger
        const skipBtn = document.querySelector('.ytp-skip-ad-button, .jw-skip, [class*="skip-ad"], .ytp-ad-skip-button-modern');
        if (skipBtn && this._isVisibleStable(skipBtn)) {
            const othersBanned = ['jump', 'speed', 'simulate'].every(s => this._isBanned(this._banKey(window.location.hostname), s));
            if (othersBanned) return 'interaction';
        }

        const picked = candidates[0]?.name ?? 'wait';
        mem.lastTried = mem.lastTried || {};
        mem.lastTried[picked] = now;
        return picked;
    },

    // ─────────────────────────────────────────────────────────────────
    // 3. ACT — Execution Layer
    // ─────────────────────────────────────────────────────────────────
    _act(video, strategy, adapter, detection) {
        const rv = this._runtimeValidation.get(video);
        
        // 6. RUNTIME VALIDATION (watch window)
        if (rv.strategy && rv.appliedAt > 0 && (Date.now() - rv.appliedAt < 2000)) {
            // If sensor fired during this window, Learn phase handles it via re-probing
            return; // Busy watching
        }

        // 3.3 Delayed execution (random 100–300ms)
        const delay = 100 + Math.random() * 200;
        setTimeout(() => {
            if (!document.contains(video)) return;
            this._executeGuarded(video, strategy, adapter, detection);
            rv.strategy = strategy;
            rv.appliedAt = Date.now();
        }, delay);
    },

    _executeGuarded(video, strategy, adapter, detection) {
        const risk = detection.costBenefit.riskScore;
        const caps = adapter.getCapabilities();

        // 3.1 Execution Guard (Cooldown = base × (1 + riskScore))
        if (strategy === 'jump' && this._canExecute('seek', 500, risk)) {
            const next = adapter.getNextContentTime?.();
            if (next != null) adapter.seek(next - 0.05); else this._probeNext(video, adapter, detection);
        }
        else if (strategy === 'speed' && this._canExecute('rate', 800, risk)) {
            // 3.2 Rate control (Target + Smooth + Jitter)
            let target = 2.0 + detection.confidence * ((caps.rateMax || 16) - 2);
            if (detection.costBenefit.mode === 'gentle') target = detection.costBenefit.suggestedRate;

            let smoothed = this._applySmoothing(video, target);
            // 3.2 Micro-jitter (±0.05)
            smoothed += (Math.random() * 0.1 - 0.05);
            
            adapter.setPlaybackRate(parseFloat(smoothed.toFixed(2)));
        }
        else if (strategy === 'interaction') {
            this._executeInteraction(adapter, detection);
        }

        this._hysteresis.get(video).lastStrategy = strategy;
    },

    _canExecute(k, base, risk) {
        const cd = base * (1 + risk);
        if (Date.now() - (this._execGuard[k] || 0) < cd) return false;
        this._execGuard[k] = Date.now();
        return true;
    },

    // ─────────────────────────────────────────────────────────────────
    // 4. LEARN — Feedback + Adaptation
    // ─────────────────────────────────────────────────────────────────
    _learnCycle(video, memKey) {
        const rv = this._runtimeValidation.get(video);
        const now = Date.now();
        const dt = (now - rv.lastLearnAt) / 1000;
        rv.lastLearnAt = now;

        // 4.1 Soft Fail Decay
        rv.softWarns = Math.max(0, rv.softWarns - this.SOFT_WARN_DECAY_RATE * dt);

        // 4.2 Confidence Recovery (Dynamic Recovery)
        this._applyRecovery(video, memKey, dt);
    },

    _applyRecovery(video, memKey, dt) {
        const mem = this._getSiteMemory(memKey);
        const h = this._hysteresis.get(video);
        if (Date.now() - (h.lastSensorTime || 0) < 3000) return; // Wait 3s after last sensor fire

        // Dynamic Recovery: rate = base * (1 - failureWeight)
        const total = (mem.successCount || 0) + (mem.failCount || 0) + 1;
        const failureWeight = Math.min(0.9, (mem.failCount || 0) / total * 2);
        const rate = this.CONFIDENCE_RECOVERY_BASE * (1 - failureWeight);

        for (const [s, def] of Object.entries(this._defaultConfidence)) {
            const curr = mem[s] ?? def;
            if (curr < def) mem[s] = Math.min(def, curr + rate * dt);
        }
    },

    onSensorEvent(video, event) {
        const entry = this._activeAdapters.get(video);
        const h = this._hysteresis.get(video);
        const rv = this._runtimeValidation.get(video);
        const severity = this.SENSOR_SEVERITY[event.type] || 0.5;

        h.lastSensorTime = Date.now();
        
        // 4.1 Feedback loop
        if (severity > 0.7) {
            // Hard fail → downgrade ngay
            this._probeNext(video, entry.adapter, entry.lastDetection);
        } else if (severity > 0) {
            // Soft fail → accumulate (3 warning → downgrade)
            rv.softWarns++;
            if (rv.softWarns >= 3) {
                this._probeNext(video, entry.adapter, entry.lastDetection);
                rv.softWarns = 0;
            }
        }

        // Adaptation
        const memKey = this._memKey(window.location.hostname, entry.playerType, video.duration);
        if (severity > 0) {
            this._adjustConfidence(memKey, rv.strategy, -0.3 * severity);
            this._banStrategy(this._banKey(window.location.hostname), rv.strategy);
            AdsFriendlyAdDetection.recordFailure(window.location.hostname);
            this.notifyBrain({ type: 'STRATEGY_FAILURE', site: window.location.hostname, severity, strategy: rv.strategy });
        } else {
            // Success event (like JWP_AD_SKIPPED)
            this._adjustConfidence(memKey, rv.strategy, 0.1);
            AdsFriendlyAdDetection.recordSuccess(window.location.hostname);
            this.notifyBrain({ type: 'STRATEGY_SUCCESS', site: window.location.hostname, strategy: rv.strategy });
        }
    },

    _executeFastPass(video, ad) {
        if (!video) return;
        
        // v13: Simplified Test Action (Direct Strike)
        if (video.playbackRate !== 16.0) {
            console.log("%c🔥 Strategy executed: fastPass (16x)", "color: #ef4444; font-weight: bold;");
            video.playbackRate = 16.0;
            video.muted = true;
        }

        // Check for manual "Bỏ qua" button (Neural Clicker)
        this._trySkip();
        
        // Auto-clear signal after some time or if duration is safe
        // (For now, keep it until sensors take over or ad ends)
    },

    _trySkip() {
        const buttons = document.querySelectorAll('button, div[role="button"], span');
        for (const btn of buttons) {
            const text = btn.innerText.toLowerCase();
            if (text.includes("bỏ qua") || text.includes("skip ad")) {
                btn.click();
            }
        }
    },

    notifyBrain(data) {
        window.postMessage({ source: 'adsfriendly-engine', ...data }, '*');
    },

    // ─────────────────────────────────────────────────────────────────
    // 5. MEMORY & 6. IMMUNE SYSTEM
    // ─────────────────────────────────────────────────────────────────
    _validateFingerprint(hostname, f) {
        if (!f || this._lastKnownFingerprints[hostname] === f.hash) return;
        
        // 5.2 Similarity-aware reset
        const sim = f.similarity ?? 0.5;
        for (const key of Object.keys(this._siteMemory)) {
            if (!key.startsWith(hostname)) continue;
            const mem = this._siteMemory[key];
            for (const s of Object.keys(this._defaultConfidence)) {
                 if (typeof mem[s] === 'number') mem[s] *= sim;
            }
            // bestStrategy +0.1 bonus check
            if (mem.bestStrategy) mem[mem.bestStrategy] += 0.1;
        }
        this._lastKnownFingerprints[hostname] = f.hash;
    },

    _probeNext(v, a, d) {
        const h = this._hysteresis.get(v);
        const now = Date.now();
        
        // 2.2 Early Exit (time-windowed)
        h.failTimestamps = (h.failTimestamps || []).filter(t => now - t < 3000);
        h.failTimestamps.push(now);

        if (h.failTimestamps.length >= 2 && (d.costBenefit.riskScore > 0.6)) {
             this._enterSafeMode(v, a);
             return;
        }

        // Fallback chain: Jump → Speed → Simulate → Interaction → Safe
        const chain = ['jump', 'speed', 'simulate', 'interaction'];
        const next = chain.find(s => s !== h.lastStrategy && !this._isBanned(this._banKey(window.location.hostname), s));
        if (next) this._act(v, next, a, d); else this._enterSafeMode(v, a);
    },

    // ─────────────────────────────────────────────────────────────────
    // HELPERS & MODES
    // ─────────────────────────────────────────────────────────────────
    _handleSafeMode(v, e, cb) {
        const smState = this._safeModeState.get(v) || { enteredAt: 0 };
        if (!e.inSafeMode) {
            this._enterSafeMode(v, e.adapter);
            smState.enteredAt = Date.now();
            this._safeModeState.set(v, smState);
        }

        // 7. SAFE MODE EXIT (stable ≥ 10s)
        const h = this._hysteresis.get(v);
        const stableTime = Date.now() - Math.max(smState.enteredAt, h.lastSensorTime || 0);
        if (stableTime > this.SAFE_MODE.exitStableMs) {
            e.inSafeMode = false;
            // Progressive re-probe: exit safe mode starts at low confidence
        } else {
            e.adapter.setPlaybackRate(this.SAFE_MODE.rate); v.muted = true;
        }
    },

    _enterSafeMode(v, a) {
        this._activeAdapters.get(v).inSafeMode = true;
        a.setPlaybackRate(this.SAFE_MODE.rate); v.muted = true;
    },

    _resetToSafeState(v, a) {
        if (v.playbackRate > 1.2) { a.setPlaybackRate(1.0); this._prevRate.set(v, 1.0); }
        this._activeAdapters.get(v).inSafeMode = false;
    },

    _applySmoothing(v, t) {
        const p = this._prevRate.get(v) || 1.0;
        const res = p + 0.25 * (t - p);
        this._prevRate.set(v, res);
        return res;
    },

    _isVisibleStable(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || window.getComputedStyle(el).display === 'none') { this._visibilityState.delete(el); return false; }
        const start = this._visibilityState.get(el);
        if (!start) { this._visibilityState.set(el, Date.now()); return false; }
        return (Date.now() - start) > this.VISIBILITY_STABLE_MS;
    },

    _banStrategy(k, s) { 
        this._strategyBan[k] = this._strategyBan[k] || {};
        const b = this._strategyBan[k][s] || { score: 0, lastAt: Date.now() };
        b.score = Math.min(3, b.score + 0.5); b.lastAt = Date.now();
        this._strategyBan[k][s] = b;
    },

    _isBanned(k, s) {
        const b = this._strategyBan[k]?.[s];
        if (!b) return false;
        const decay = (Date.now() - b.lastAt) / 1000 * this.BAN_DECAY_RATE;
        return (b.score - decay) >= this.BAN_THRESHOLD;
    },

    _detectPlayerType(v) { if (window.location.hostname.includes('youtube.com')) return 'youtube'; if (window.jwplayer?.()) return 'jwplayer'; return 'custom'; },
    _createAdapter(t, v) {
        const a = t === 'youtube' ? new window.AdsFriendlyYouTubeAdapter(v) : (t === 'jwplayer' ? new window.AdsFriendlyJWPlayerAdapter(window.jwplayer()) : new window.AdsFriendlyCustomPlayerAdapter(v));
        a.video?.addEventListener('ratechange', () => { if (a.video.playbackRate < 2 && a.isAd()) this.onSensorEvent(v, { type: 'RATE_FORCED' }); });
        a.video?.addEventListener('timeupdate', () => { /* drift logic already in sensor layer */ });
        a.onSensorEvent?.(ev => this.onSensorEvent(v, ev));
        return a;
    },

    _memKey(h, p, d) { return `${h}:${p}:${d < 15 ? 'bumper' : (d < 65 ? 'short' : 'long')}`; },
    _banKey(h) { return h; },
    _getSiteMemory(k) { return this._siteMemory[k] = this._siteMemory[k] || {}; },
    _adjustConfidence(k, s, d) { 
        const m = this._getSiteMemory(k); 
        m[s] = Math.min(2, Math.max(0.05, (m[s] ?? this._defaultConfidence[s] ?? 0.5) + d)); 
    }
};
