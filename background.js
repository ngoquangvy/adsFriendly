var AdsFriendlyBackground = (() => {
  // src/background/state.js
  var runtimeState = {
    lastTrustedClick: {
      timestamp: 0,
      intentUrl: null,
      sourceUrl: null,
      intentKind: "navigation",
      intentReasons: [],
      tabId: null
    }
  };

  // src/shared/ad-patterns.js
  var BASELINE_AD_PATTERNS = [
    { type: "alt", value: "Ad", confidence: 0.9 },
    { type: "alt", value: "Advertisement", confidence: 0.9 },
    { type: "alt", value: "Sponsored", confidence: 0.9 },
    { type: "alt", value: "Promoted", confidence: 0.9 },
    { type: "title", value: "Ads by Google", confidence: 1 },
    { type: "domain", value: "taboola.com", confidence: 1 },
    { type: "domain", value: "outbrain.com", confidence: 1 },
    { type: "domain", value: "mgid.com", confidence: 1 },
    { type: "domain", value: "adnxs.com", confidence: 1 }
  ];
  var PROTECTED_KEYWORDS = [
    "messenger",
    "chat",
    "inbox",
    "cart",
    "checkout",
    "search",
    "account",
    "login",
    "social",
    "notification",
    "swiper",
    "carousel",
    "slick",
    "owl-",
    "slide"
  ];
  function isProtectedPattern(value = "") {
    return PROTECTED_KEYWORDS.some((kw) => value.toLowerCase().includes(kw));
  }

  // src/background/pattern-learning.js
  async function seedBaselinePatterns() {
    const result = await chrome.storage.local.get(["globalAdPatterns"]);
    if (!result.globalAdPatterns || result.globalAdPatterns.length === 0)
      await chrome.storage.local.set({ globalAdPatterns: BASELINE_AD_PATTERNS });
  }
  async function handleNegativeLearning(fingerprint) {
    if (!fingerprint) return;
    const {
      safePatterns = [],
      infrastructurePatterns = [],
      globalAdPatterns = []
    } = await chrome.storage.local.get([
      "safePatterns",
      "infrastructurePatterns",
      "globalAdPatterns"
    ]);
    const entry = {
      value: fingerprint.alt || fingerprint.title,
      type: fingerprint.alt ? "alt" : "title"
    };
    if (!entry.value) return;
    if (!safePatterns.some((p) => p.value === entry.value))
      safePatterns.push(entry);
    if (!infrastructurePatterns.some((p) => p.value === entry.value))
      infrastructurePatterns.push({ ...entry, timestamp: Date.now() });
    await chrome.storage.local.set({
      safePatterns,
      infrastructurePatterns,
      globalAdPatterns: globalAdPatterns.filter((p) => p.value !== entry.value)
    });
  }
  async function synthesizeGlobalPatterns() {
    const { userCustomRules = {}, safePatterns = [] } = await chrome.storage.local.get(["userCustomRules", "safePatterns"]);
    const freq = {};
    const spread = {};
    const add = (domain, type, value) => {
      if (!value || value.length < 3) return;
      const key = `${type}:${value}`;
      freq[key] = (freq[key] || 0) + 1;
      (spread[key] ||= /* @__PURE__ */ new Set()).add(domain);
    };
    Object.entries(userCustomRules).forEach(
      ([domain, rules]) => rules.forEach((rule) => {
        const f = rule?.fingerprint;
        if (!f) return;
        add(domain, "alt", f.alt);
        add(domain, "title", f.title);
        add(domain, "domain", f.linkDomain);
        add(domain, "class", f.className);
        add(domain, "id", f.id);
        add(domain, "srcHost", f.srcHost);
        (f.classTokens || []).forEach(
          (token) => add(domain, "classToken", token)
        );
        (f.idTokens || []).forEach((token) => add(domain, "idToken", token));
      })
    );
    const safe = (type, value) => safePatterns.some((p) => p.type === type && p.value === value);
    const globalAdPatterns = Object.entries(freq).filter(
      ([key]) => !isProtectedPattern(key.split(":")[1]) && spread[key].size >= 1
    ).map(([key, count]) => {
      const [type, value] = key.split(":");
      let confidence = Math.min((count + spread[key].size * 2) / 10, 1);
      if (safe(type, value)) confidence *= 0.3;
      return { type, value, confidence };
    });
    await chrome.storage.local.set({ globalAdPatterns });
  }

  // src/shared/pattern-store.js
  async function getGlobalPatterns() {
    const { globalAdPatterns = [] } = await chrome.storage.local.get("globalAdPatterns");
    return Array.isArray(globalAdPatterns) ? globalAdPatterns : [];
  }
  async function upsertGlobalPattern(nextPattern, merge) {
    if (!nextPattern?.type || !nextPattern.value) return;
    const globalAdPatterns = await getGlobalPatterns();
    const existing = globalAdPatterns.find(
      (pattern) => pattern.type === nextPattern.type && pattern.value === nextPattern.value
    );
    if (existing) {
      Object.assign(existing, merge ? merge(existing, nextPattern) : nextPattern);
    } else {
      globalAdPatterns.push(nextPattern);
    }
    await chrome.storage.local.set({ globalAdPatterns });
  }

  // src/background/video-learning.js
  async function handleLearnVideoAd(data) {
    const { src, hostname } = data;
    if (!src) return;
    let value = src;
    try {
      const url = new URL(src);
      value = url.hostname.includes("github") || url.hostname.includes("s3") || url.hostname.includes("cdn") ? url.hostname : url.hostname + (url.pathname.split("/")[1] ? "/" + url.pathname.split("/")[1] : "");
    } catch {
      value = src.split("?")[0].substring(0, 50);
    }
    await upsertGlobalPattern(
      {
        type: "video_source_marker",
        value,
        confidence: 1,
        source: hostname
      },
      () => ({ confidence: 1, source: hostname })
    );
  }
  async function handleVideoLearning(data) {
    const classList = (data.classes || "").split(" ").filter(
      (token) => token.includes("ad") || token.includes("player") || token.includes("video")
    );
    if (!classList.length) return;
    await Promise.all(
      classList.map(
        (cls) => upsertGlobalPattern(
          {
            type: "video_marker",
            value: `.${cls}`,
            confidence: 0.5,
            source: data.hostname
          },
          (existing) => ({
            confidence: Math.min(1, (existing.confidence || 0) + 0.1),
            source: data.hostname
          })
        )
      )
    );
  }

  // src/navigation/background/trusted-paths.js
  async function syncTrustedPath(source, target, isManual = false) {
    if (!source || !target || source === target) return;
    const key = `p:${source}>${target}`;
    const current = await chrome.storage.local.get([key]);
    const entry = current[key] || {
      source,
      target,
      visits: 0,
      isManual: false,
      lastUpdated: Date.now()
    };
    entry.visits++;
    if (isManual) {
      entry.isManual = true;
      entry.visits = Math.max(entry.visits, 99);
    }
    entry.lastUpdated = Date.now();
    await chrome.storage.local.set({ [key]: entry });
  }
  async function getTrustedPath(source, target) {
    const key = `p:${source}>${target}`;
    return (await chrome.storage.local.get([key]))[key] || null;
  }
  async function handleUserDecision(message) {
    const { action, domain } = message;
    if (action === "WHITELIST") {
      const { whitelist = [] } = await chrome.storage.local.get(["whitelist"]);
      if (!whitelist.includes(domain)) {
        whitelist.push(domain);
        await chrome.storage.local.set({ whitelist });
      }
    }
    if (action === "BLACKLIST") {
      const { blacklist = [] } = await chrome.storage.local.get(["blacklist"]);
      const rule = `||${domain}^`;
      if (!blacklist.includes(rule)) {
        blacklist.push(rule);
        await chrome.storage.local.set({ blacklist });
      }
    }
  }

  // src/background/reputation.js
  async function updateSiteReputation(hostname, blockedCount) {
    const { siteReputation = {} } = await chrome.storage.local.get("siteReputation");
    const data = siteReputation[hostname] ||= {
      trustScore: 0.5,
      blockActivity: 0
    };
    data.blockActivity = Math.max(data.blockActivity, blockedCount);
    if (blockedCount > 10) data.trustScore = Math.max(0, data.trustScore - 0.05);
    else if (blockedCount <= 1)
      data.trustScore = Math.min(1, data.trustScore + 0.01);
    await chrome.storage.local.set({ siteReputation });
  }
  async function getDynamicTrustWindow(hostname) {
    const { siteReputation = {} } = await chrome.storage.local.get("siteReputation");
    return siteReputation[hostname]?.blockedAdCount > 10 ? 500 : 2e3;
  }
  async function cleanupStaleMemory() {
    const { siteResetHistory = {} } = await chrome.storage.local.get("siteResetHistory");
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1e3;
    let changed = false;
    for (const host in siteResetHistory)
      if (siteResetHistory[host].timestamp < cutoff) {
        delete siteResetHistory[host];
        changed = true;
      }
    if (changed) await chrome.storage.local.set({ siteResetHistory });
  }

  // src/background/telemetry.js
  var QUEUE_KEY = "afsTelemetryQueue";
  var ENABLED_KEY = "afsTelemetryEnabled";
  var ENDPOINT_KEY = "afsTelemetryEndpoint";
  var CLIENT_ID_KEY = "adsFriendlyClientId";
  var DEFAULT_ENDPOINT = "http://127.0.0.1:3000/api/ingest";
  var MAX_QUEUE = 1e3;
  var BATCH_SIZE = 50;
  var flushInFlight = false;
  async function recordTelemetry(raw = {}) {
    const event = await buildEvent(raw);
    const { [QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(QUEUE_KEY);
    queue.push(event);
    await chrome.storage.local.set({ [QUEUE_KEY]: queue.slice(-MAX_QUEUE) });
    flushTelemetry();
    return event;
  }
  async function flushTelemetry() {
    if (flushInFlight) return { status: "busy" };
    flushInFlight = true;
    try {
      const {
        [ENABLED_KEY]: enabled = true,
        [ENDPOINT_KEY]: endpoint = DEFAULT_ENDPOINT,
        [QUEUE_KEY]: queue = []
      } = await chrome.storage.local.get([ENABLED_KEY, ENDPOINT_KEY, QUEUE_KEY]);
      if (enabled === false || !queue.length) return { status: "skipped" };
      const batch = queue.slice(0, BATCH_SIZE);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch })
      });
      if (!response.ok && response.status !== 207) {
        return { status: "server_error", statusCode: response.status };
      }
      await chrome.storage.local.set({ [QUEUE_KEY]: queue.slice(batch.length) });
      if (queue.length > batch.length) setTimeout(flushTelemetry, 100);
      return { status: "flushed", count: batch.length };
    } catch (error) {
      return { status: "offline", error: error.message };
    } finally {
      flushInFlight = false;
    }
  }
  function startTelemetryFlush() {
    chrome.runtime.onStartup.addListener(flushTelemetry);
    chrome.runtime.onInstalled.addListener(flushTelemetry);
    const intervalId = setInterval(flushTelemetry, 6e4);
    return () => {
      clearInterval(intervalId);
      chrome.runtime.onStartup.removeListener(flushTelemetry);
      chrome.runtime.onInstalled.removeListener(flushTelemetry);
    };
  }
  async function buildEvent(raw) {
    const now = Date.now();
    const clientId = await getClientId();
    const site = normalizeSite(raw.site, raw);
    const labelSource = raw.label_source || "heuristic_weak";
    return {
      schema_version: raw.schema_version || "dataset.v1",
      sample_id: raw.sample_id || randomId(),
      unit: raw.unit || "unknown",
      label: raw.label || "unknown",
      label_source: labelSource,
      label_strength: raw.label_strength || inferLabelStrength(labelSource),
      ad_type: raw.ad_type || "unknown",
      site,
      timestamp: raw.timestamp || now,
      identity: {
        client_id: clientId,
        platform: "chrome_extension",
        app: "adsfriendly",
        schema: "identity.v1",
        ...raw.identity || {}
      },
      sync: {
        scope: raw.sync?.scope || "user",
        status: "queued",
        client_time: now,
        ...raw.sync || {}
      },
      context: raw.context || {},
      evidence: raw.evidence || {},
      feedback: raw.feedback || null,
      action: raw.action || null,
      outcome: raw.outcome || null,
      model: raw.model || {}
    };
  }
  async function getClientId() {
    const result = await chrome.storage.local.get(CLIENT_ID_KEY);
    if (result[CLIENT_ID_KEY]) return result[CLIENT_ID_KEY];
    const clientId = randomId();
    await chrome.storage.local.set({ [CLIENT_ID_KEY]: clientId });
    return clientId;
  }
  function normalizeSite(site, raw) {
    const url = site?.url || raw.url || raw.pageUrl || raw.sourceUrl || "";
    return {
      hostname: sanitizeHostname(site?.hostname || raw.hostname || raw.domain) || hostFromUrl(url || raw.targetUrl),
      url: sanitizeUrl(url)
    };
  }
  function inferLabelStrength(labelSource) {
    if (/^user_|restore|undo|allow|block/i.test(labelSource)) return "strong";
    if (/heuristic|rule|model/i.test(labelSource)) return "weak";
    return "unknown";
  }
  function hostFromUrl(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "unknown";
    }
  }
  function sanitizeHostname(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 253);
  }
  function sanitizeUrl(url) {
    try {
      const parsed = new URL(url);
      parsed.username = "";
      parsed.password = "";
      parsed.hash = "";
      for (const key of [...parsed.searchParams.keys()]) {
        if (/token|key|auth|session|password|email|user|uid|id$/i.test(key)) {
          parsed.searchParams.set(key, "[redacted]");
        }
      }
      return parsed.href.slice(0, 2048);
    } catch {
      return "";
    }
  }
  function randomId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // src/runtime/feature-catalog.js
  var PROTECTION_MODES = Object.freeze({
    SAFE: "safe",
    ASSIST: "assist",
    AUTO: "auto"
  });
  var CAPABILITIES = Object.freeze({
    CORE_MESSAGING: "core.messaging",
    CORE_MAINTENANCE: "core.maintenance",
    NAVIGATION_GUARD: "navigation.guard",
    NAVIGATION_REVERSE_POPUNDER: "navigation.reverse_popunder",
    NAVIGATION_INTENT: "navigation.intent",
    NAVIGATION_FEEDBACK: "navigation.feedback",
    DOM_STATIC_RULES: "dom.static_rules",
    DOM_OBSERVE: "dom.observe",
    DOM_SUGGEST: "dom.suggest",
    DOM_AUTO_HIDE: "dom.auto_hide",
    DOM_MANUAL_PICKER: "dom.manual_picker",
    LEARNING_SEED: "learning.seed",
    LEARNING_FEEDBACK: "learning.feedback",
    LEARNING_APPLY: "learning.apply_patterns",
    TELEMETRY_QUEUE: "telemetry.queue",
    MEDIA_OBSERVE: "media.observe",
    VIDEO_OBSERVE: "video.observe",
    VIDEO_AUTO_ACTION: "video.auto_action"
  });
  var C = CAPABILITIES;
  var MODE_CAPABILITIES = Object.freeze({
    [PROTECTION_MODES.SAFE]: Object.freeze([
      C.CORE_MESSAGING,
      C.CORE_MAINTENANCE,
      C.NAVIGATION_GUARD,
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.DOM_STATIC_RULES,
      C.DOM_MANUAL_PICKER,
      C.LEARNING_SEED,
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    [PROTECTION_MODES.ASSIST]: Object.freeze([
      C.CORE_MESSAGING,
      C.CORE_MAINTENANCE,
      C.NAVIGATION_GUARD,
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.DOM_STATIC_RULES,
      C.DOM_OBSERVE,
      C.DOM_SUGGEST,
      C.DOM_MANUAL_PICKER,
      C.LEARNING_SEED,
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE,
      C.MEDIA_OBSERVE,
      C.VIDEO_OBSERVE
    ]),
    [PROTECTION_MODES.AUTO]: Object.freeze([
      C.CORE_MESSAGING,
      C.CORE_MAINTENANCE,
      C.NAVIGATION_GUARD,
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.DOM_STATIC_RULES,
      C.DOM_OBSERVE,
      C.DOM_SUGGEST,
      C.DOM_AUTO_HIDE,
      C.DOM_MANUAL_PICKER,
      C.LEARNING_SEED,
      C.LEARNING_FEEDBACK,
      C.LEARNING_APPLY,
      C.TELEMETRY_QUEUE,
      C.MEDIA_OBSERVE,
      C.VIDEO_OBSERVE,
      C.VIDEO_AUTO_ACTION
    ])
  });
  var FEATURE_CATALOG = Object.freeze([
    feature("background.message-router", "background", C.CORE_MESSAGING, [
      C.CORE_MAINTENANCE,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("background.navigation-guard", "background", C.NAVIGATION_GUARD, [
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("background.telemetry-flush", "background", C.TELEMETRY_QUEUE),
    feature("background.memory-cleanup", "background", C.CORE_MAINTENANCE),
    feature("background.pattern-seed", "background", C.LEARNING_SEED),
    feature("content.spy-injector", "content", C.MEDIA_OBSERVE),
    feature("content.youtube-cleaner", "content", C.DOM_STATIC_RULES),
    feature("content.navigation-intent", "content", C.NAVIGATION_INTENT),
    feature("content.navigation-toast", "content", C.NAVIGATION_FEEDBACK),
    feature("content.dom-static-blocker", "content", C.DOM_STATIC_RULES, [
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("content.dom-candidate-collector", "content", C.DOM_OBSERVE, [
      C.DOM_SUGGEST,
      C.DOM_AUTO_HIDE,
      C.LEARNING_FEEDBACK
    ]),
    feature("content.dom-learned-blocker", "content", C.LEARNING_APPLY, [
      C.DOM_AUTO_HIDE
    ]),
    feature("video.surgeon", "video", C.VIDEO_OBSERVE, [C.VIDEO_AUTO_ACTION]),
    feature("picker.controller", "picker", C.DOM_MANUAL_PICKER, [
      C.LEARNING_FEEDBACK
    ]),
    feature("main-world.network-capture", "main-world", C.MEDIA_OBSERVE),
    feature("main-world.timer-control", "main-world", C.VIDEO_AUTO_ACTION)
  ]);
  var CAPABILITY_SET = new Set(Object.values(CAPABILITIES));
  var FEATURE_BY_ID = new Map(FEATURE_CATALOG.map((item) => [item.id, item]));
  validateCatalog();
  function getFeatureDefinition(featureId) {
    const definition = FEATURE_BY_ID.get(featureId);
    if (!definition) {
      throw new Error(
        `[FeatureRegistry] Unknown feature "${featureId}". Register it in feature-catalog.js before use.`
      );
    }
    return definition;
  }
  function getFeaturesForContext(context) {
    return FEATURE_CATALOG.filter(
      (featureItem) => featureItem.context === context
    );
  }
  function assertRegisteredCapability(capability) {
    if (!CAPABILITY_SET.has(capability)) {
      throw new Error(
        `[FeatureRegistry] Unknown capability "${capability}". Register it in feature-catalog.js before use.`
      );
    }
    return capability;
  }
  function getCapabilitiesForMode(mode) {
    const capabilities = MODE_CAPABILITIES[mode];
    if (!capabilities) {
      throw new Error(`[FeatureRegistry] Unknown protection mode "${mode}".`);
    }
    return capabilities;
  }
  function feature(id, context, startCapability, extraCapabilities = []) {
    return Object.freeze({
      id,
      context,
      startCapability,
      capabilities: Object.freeze([startCapability, ...extraCapabilities])
    });
  }
  function validateCatalog() {
    const ids = /* @__PURE__ */ new Set();
    for (const definition of FEATURE_CATALOG) {
      if (ids.has(definition.id)) {
        throw new Error(
          `[FeatureRegistry] Duplicate feature "${definition.id}".`
        );
      }
      ids.add(definition.id);
      for (const capability of definition.capabilities) {
        assertRegisteredCapability(capability);
      }
    }
    for (const [mode, capabilities] of Object.entries(MODE_CAPABILITIES)) {
      for (const capability of capabilities) {
        if (!CAPABILITY_SET.has(capability)) {
          throw new Error(
            `[FeatureRegistry] Mode "${mode}" uses unregistered capability "${capability}".`
          );
        }
      }
    }
  }

  // src/background/message-router.js
  var MESSAGE_CAPABILITIES = Object.freeze({
    TRUSTED_CLICK: CAPABILITIES.NAVIGATION_INTENT,
    SYNC_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
    NEGATIVE_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
    USER_DECISION: CAPABILITIES.NAVIGATION_FEEDBACK,
    PATH_RESTORED: CAPABILITIES.NAVIGATION_FEEDBACK,
    RESTORE_GRAY_NAVIGATION: CAPABILITIES.NAVIGATION_FEEDBACK,
    BLOCK_GRAY_NAVIGATION: CAPABILITIES.NAVIGATION_FEEDBACK,
    KEEP_REVIEWED_TAB: CAPABILITIES.NAVIGATION_FEEDBACK,
    BLOCK_REVIEWED_TAB: CAPABILITIES.NAVIGATION_FEEDBACK,
    LEARN_VIDEO_AD: CAPABILITIES.LEARNING_FEEDBACK,
    SYNC_VIDEO_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
    REPORT_AD_DENSITY: CAPABILITIES.CORE_MAINTENANCE,
    RECORD_TELEMETRY: CAPABILITIES.TELEMETRY_QUEUE,
    FLUSH_TELEMETRY: CAPABILITIES.TELEMETRY_QUEUE
  });
  function registerMessageRouter(policy) {
    const onMessage = (message, sender, sendResponse) => {
      if (!policy.can(CAPABILITIES.CORE_MESSAGING)) {
        sendResponse({ status: "disabled" });
        return false;
      }
      const capability = MESSAGE_CAPABILITIES[message?.type];
      if (capability && !policy.can(capability)) {
        sendResponse({ status: "capability_disabled" });
        return false;
      }
      route(message, sender).then((r) => sendResponse(r || { status: "ok" })).catch((err) => sendResponse({ status: "error", error: err.message }));
      return true;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }
  async function route(message, sender) {
    if (!message) return { status: "ignored" };
    if (message.type === "TRUSTED_CLICK") {
      runtimeState.lastTrustedClick = {
        timestamp: Date.now(),
        intentUrl: message.intentUrl,
        sourceUrl: message.sourceUrl || sender?.tab?.url || null,
        intentKind: message.intentKind || "navigation",
        intentReasons: Array.isArray(message.intentReasons) ? message.intentReasons : [],
        tabId: sender?.tab?.id || null
      };
      return;
    }
    if (message.type === "SYNC_LEARNING") return synthesizeGlobalPatterns();
    if (message.type === "NEGATIVE_LEARNING")
      return handleNegativeLearning(message.fingerprint);
    if (message.type === "USER_DECISION") return handleUserDecision(message);
    if (message.type === "PATH_RESTORED")
      return syncTrustedPath(message.source, message.target, true);
    if (message.type === "RESTORE_GRAY_NAVIGATION") {
      await syncTrustedPath(message.source, message.target, true);
      await recordTelemetry({
        unit: "navigation",
        label: "false_positive",
        label_source: "user_restore",
        label_strength: "strong",
        ad_type: "popunder",
        targetUrl: message.url,
        sourceUrl: `https://${message.source}/`,
        action: "restore",
        outcome: "user_opened_gray_navigation",
        context: {
          source_host: message.source,
          target_host: message.target,
          surface: "navigation_toast"
        },
        feedback: {
          user_action: "restore",
          correction: "false_positive",
          surface: "navigation_toast"
        }
      });
      await chrome.tabs.create({ url: message.url, active: true });
      return;
    }
    if (message.type === "BLOCK_GRAY_NAVIGATION") {
      await recordTelemetry({
        unit: "navigation",
        label: "ad",
        label_source: "user_block",
        label_strength: "strong",
        ad_type: "popunder",
        targetUrl: message.url,
        sourceUrl: `https://${message.source}/`,
        action: "block",
        outcome: "user_blocked_gray_navigation",
        context: {
          source_host: message.source,
          target_host: message.target,
          surface: "navigation_toast"
        },
        feedback: {
          user_action: "block",
          surface: "navigation_toast"
        }
      });
      return handleUserDecision({ action: "BLACKLIST", domain: message.target });
    }
    if (message.type === "KEEP_REVIEWED_TAB") {
      await syncTrustedPath(message.source, message.target, true);
      await recordTelemetry({
        unit: "navigation",
        label: "false_positive",
        label_source: "user_keep",
        label_strength: "strong",
        ad_type: "popunder",
        targetUrl: message.url,
        sourceUrl: `https://${message.source}/`,
        action: "allow",
        outcome: "user_kept_reviewed_tab",
        context: {
          source_host: message.source,
          target_host: message.target,
          surface: "navigation_toast"
        },
        feedback: {
          user_action: "keep",
          correction: "false_positive",
          surface: "navigation_toast"
        }
      });
      return;
    }
    if (message.type === "BLOCK_REVIEWED_TAB") {
      await recordTelemetry({
        unit: "navigation",
        label: "ad",
        label_source: "user_block",
        label_strength: "strong",
        ad_type: "popunder",
        targetUrl: message.url,
        sourceUrl: `https://${message.source}/`,
        action: "block",
        outcome: "user_blocked_reviewed_tab",
        context: {
          source_host: message.source,
          target_host: message.target,
          surface: "navigation_toast"
        },
        feedback: {
          user_action: "block",
          surface: "navigation_toast"
        }
      });
      await handleUserDecision({ action: "BLACKLIST", domain: message.target });
      if (Number.isInteger(message.tabId)) {
        try {
          await chrome.tabs.remove(message.tabId);
        } catch {
        }
      }
      return;
    }
    if (message.type === "LEARN_VIDEO_AD") return handleLearnVideoAd(message);
    if (message.type === "SYNC_VIDEO_LEARNING")
      return handleVideoLearning(message);
    if (message.type === "REPORT_AD_DENSITY")
      return updateSiteReputation(message.hostname, message.count);
    if (message.type === "RECORD_TELEMETRY")
      return recordTelemetry(message.event || message);
    if (message.type === "FLUSH_TELEMETRY") return flushTelemetry();
    if (message.type === "TOGGLE_STATUS")
      console.log("Protection status:", message.isEnabled);
    return { status: "ignored" };
  }

  // src/shared/url.js
  function parseUrl(value, base) {
    try {
      return new URL(value, base);
    } catch {
      return null;
    }
  }
  function sameHostnameOrSubdomain(hostname, parent) {
    if (!hostname || !parent) return false;
    const h = hostname.toLowerCase();
    const p = parent.toLowerCase();
    return h === p || h.endsWith(`.${p}`);
  }

  // src/background/logs.js
  async function logBlockedNavigation(url, source) {
    const { blockedLogs = [] } = await chrome.storage.local.get(["blockedLogs"]);
    await chrome.storage.local.set({
      blockedLogs: [{ url, source, timestamp: Date.now() }, ...blockedLogs].slice(
        0,
        20
      )
    });
    await recordTelemetry({
      unit: "navigation",
      label: "ad",
      label_source: "heuristic_block",
      label_strength: "weak",
      ad_type: "popunder",
      targetUrl: url,
      sourceUrl: `https://${source}/`,
      action: "block",
      outcome: "auto_blocked_navigation",
      context: {
        source_host: source,
        target_host: safeHost(url),
        surface: "navigation_guard"
      }
    });
  }
  function safeHost(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "unknown";
    }
  }

  // src/navigation/background/new-tab-policy.js
  var NEW_TAB_DECISIONS = Object.freeze({
    ALLOW: "allow",
    CLOSE: "close",
    VERIFY: "verify"
  });
  var NEW_TAB_REVIEW_SURFACES = Object.freeze({
    FULL_PAGE: "full_page",
    TOAST: "toast"
  });
  function decideNewTabNavigation({
    sameSite = false,
    trustedInitiator = false,
    trustedTarget = false,
    whitelisted = false,
    blacklisted = false,
    intentMatched = false,
    trustedPath = false,
    promotionalIntent = false
  } = {}) {
    if (sameSite || trustedInitiator || trustedTarget || whitelisted || !promotionalIntent && intentMatched || !promotionalIntent && trustedPath)
      return NEW_TAB_DECISIONS.ALLOW;
    if (blacklisted) return NEW_TAB_DECISIONS.CLOSE;
    return NEW_TAB_DECISIONS.VERIFY;
  }
  function shouldKeepTrackingNewTab({ sameSite = false } = {}) {
    return sameSite;
  }
  function chooseNewTabReviewSurface({
    promotionalIntent = false,
    targetLikelyAd = false
  } = {}) {
    return promotionalIntent || targetLikelyAd ? NEW_TAB_REVIEW_SURFACES.FULL_PAGE : NEW_TAB_REVIEW_SURFACES.TOAST;
  }

  // src/navigation/background/reverse-popunder.js
  var REVERSE_POPUNDER_WINDOW_MS = 7e3;
  function isSelfCloneNavigation(originalUrl, cloneUrl) {
    const original = parseUrl(originalUrl);
    const clone = parseUrl(cloneUrl);
    if (!isHttpUrl(original) || !isHttpUrl(clone)) return false;
    return original.hostname.toLowerCase() === clone.hostname.toLowerCase() && normalizePath(original.pathname) === normalizePath(clone.pathname);
  }
  function isReversePopunderSequence({
    originalUrl,
    cloneUrl,
    redirectedUrl,
    elapsedMs
  }) {
    if (elapsedMs < 0 || elapsedMs > REVERSE_POPUNDER_WINDOW_MS) return false;
    if (!isSelfCloneNavigation(originalUrl, cloneUrl)) return false;
    const original = parseUrl(originalUrl);
    const redirected = parseUrl(redirectedUrl);
    if (!isHttpUrl(redirected)) return false;
    return !(sameHostnameOrSubdomain(original.hostname, redirected.hostname) || sameHostnameOrSubdomain(redirected.hostname, original.hostname));
  }
  function isHttpUrl(url) {
    return url?.protocol === "http:" || url?.protocol === "https:";
  }
  function normalizePath(pathname) {
    const normalized = pathname.replace(/\/+$/, "");
    return normalized || "/";
  }

  // src/navigation/shared/intent-classifier.js
  var STRONG_TRACKING_KEYS = /* @__PURE__ */ new Set([
    "adid",
    "aff_id",
    "affiliate",
    "bannerid",
    "clickid",
    "gclid",
    "pop_id",
    "popunder",
    "zoneid"
  ]);
  var PROMOTIONAL_TOKEN_RE = /(^|[^a-z0-9])(?:ad|ads|advert|banner|casino|hitclub|promo|sponsor|bet)([^a-z0-9]|$)/i;
  function classifyNavigationIntent({
    intentUrl,
    sourceUrl,
    evidence = ""
  } = {}) {
    const intent = parseUrl(intentUrl);
    const source = parseUrl(sourceUrl);
    const promotionalEvidence = PROMOTIONAL_TOKEN_RE.test(evidence);
    if (!intent || !/^https?:$/.test(intent.protocol)) {
      return {
        likelyAd: promotionalEvidence,
        reasons: promotionalEvidence ? ["promotional_element_or_destination"] : []
      };
    }
    const external = !source || !(sameHostnameOrSubdomain(intent.hostname, source.hostname) || sameHostnameOrSubdomain(source.hostname, intent.hostname));
    if (!external) return { likelyAd: false, reasons: [] };
    const keys = [...intent.searchParams.keys()].map((key) => key.toLowerCase());
    const strongTracking = keys.some((key) => STRONG_TRACKING_KEYS.has(key));
    const marketingCount = keys.filter((key) => key.startsWith("utm_")).length;
    const tokenEvidence = `${intent.hostname} ${intent.pathname} ${evidence}`;
    const promotionalToken = PROMOTIONAL_TOKEN_RE.test(tokenEvidence);
    const reasons = [];
    if (strongTracking) reasons.push("strong_tracking_parameter");
    if (marketingCount >= 2) reasons.push("multiple_campaign_parameters");
    if (promotionalToken) reasons.push("promotional_element_or_destination");
    return {
      likelyAd: reasons.length > 0,
      reasons
    };
  }

  // src/navigation/background/guard.js
  var TRUSTED_INITIATORS = [
    "google.com",
    "bing.com",
    "duckduckgo.com",
    "yahoo.com",
    "search.yahoo.com",
    "github.com",
    "microsoft.com",
    "login.microsoftonline.com",
    "live.com",
    "apple.com",
    "appleid.apple.com",
    "facebook.com",
    "accounts.facebook.com",
    "cloudflare.com",
    "challenges.cloudflare.com"
  ];
  var TRUSTED_TARGETS = [
    ...TRUSTED_INITIATORS,
    "paypal.com",
    "stripe.com",
    "checkout.stripe.com",
    "pay.google.com",
    "payments.google.com",
    "shop.app",
    "klarna.com",
    "adyen.com",
    "authorize.net"
  ];
  var pendingTabs = /* @__PURE__ */ new Map();
  var handledTabs = /* @__PURE__ */ new Map();
  var reverseCandidatesBySource = /* @__PURE__ */ new Map();
  var reverseCandidatesByClone = /* @__PURE__ */ new Map();
  var navigationPolicy = null;
  function registerNavigationGuard(policy) {
    navigationPolicy = policy;
    const onCreatedNavigationTarget = (details) => {
      trackReverseCandidate({
        sourceTabId: details.sourceTabId,
        cloneTabId: details.tabId,
        cloneUrl: details.url
      }).catch(logReversePopunderError);
      evaluateNewTab({
        sourceTabId: details.sourceTabId,
        tabId: details.tabId,
        url: details.url
      });
    };
    const onCreated = (tab) => {
      const sourceTabId = tab.openerTabId || getRecentUserGestureSourceTabId(2500);
      if (!sourceTabId || !tab.id) return;
      pendingTabs.set(tab.id, {
        sourceTabId,
        createdAt: Date.now(),
        hasRealOpener: !!tab.openerTabId
      });
      trackReverseCandidate({
        sourceTabId,
        cloneTabId: tab.id,
        cloneUrl: tab.pendingUrl || tab.url
      }).catch(logReversePopunderError);
      setTimeout(
        () => pendingTabs.delete(tab.id),
        tab.openerTabId ? 1e4 : REVERSE_POPUNDER_WINDOW_MS + 500
      );
      const initialUrl = tab.pendingUrl || tab.url;
      if (initialUrl && !isBlankUrl(initialUrl)) {
        evaluateNewTab({ sourceTabId, tabId: tab.id, url: initialUrl });
      }
    };
    const onUpdated = (tabId, changeInfo) => {
      if (!changeInfo.url || isBlankUrl(changeInfo.url)) return;
      observeReverseNavigation(tabId, changeInfo.url);
      const pending = pendingTabs.get(tabId);
      if (!pending) return;
      if (isExpiredFallbackPending(pending)) {
        pendingTabs.delete(tabId);
        return;
      }
      evaluateNewTab({
        sourceTabId: pending.sourceTabId,
        tabId,
        url: changeInfo.url
      });
    };
    const onCommitted = (details) => {
      if (details.frameId !== 0 || isBlankUrl(details.url)) return;
      observeReverseNavigation(details.tabId, details.url);
      const pending = pendingTabs.get(details.tabId);
      if (!pending) return;
      if (isExpiredFallbackPending(pending)) {
        pendingTabs.delete(details.tabId);
        return;
      }
      evaluateNewTab({
        sourceTabId: pending.sourceTabId,
        tabId: details.tabId,
        url: details.url
      });
    };
    chrome.webNavigation.onCreatedNavigationTarget.addListener(
      onCreatedNavigationTarget
    );
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    return () => {
      chrome.webNavigation.onCreatedNavigationTarget.removeListener(
        onCreatedNavigationTarget
      );
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      pendingTabs.clear();
      reverseCandidatesBySource.clear();
      reverseCandidatesByClone.clear();
      navigationPolicy = null;
    };
  }
  function getRecentUserGestureSourceTabId(windowMs) {
    const click = runtimeState.lastTrustedClick;
    if (!click.tabId || !click.sourceUrl || Date.now() - click.timestamp >= windowMs)
      return null;
    return click.tabId;
  }
  function isExpiredFallbackPending(pending) {
    return !pending.hasRealOpener && Date.now() - pending.createdAt > REVERSE_POPUNDER_WINDOW_MS;
  }
  async function trackReverseCandidate({ sourceTabId, cloneTabId, cloneUrl }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_REVERSE_POPUNDER) || !sourceTabId || !cloneTabId)
      return;
    let candidate = reverseCandidatesBySource.get(sourceTabId);
    if (candidate && candidate.cloneTabId !== cloneTabId) {
      cleanupReverseCandidate(candidate);
      candidate = null;
    }
    if (!candidate) {
      candidate = {
        sourceTabId,
        cloneTabId,
        originalUrl: getRecentSourceUrl(sourceTabId),
        cloneUrl: null,
        redirectedUrl: null,
        createdAt: Date.now(),
        handling: false
      };
      reverseCandidatesBySource.set(sourceTabId, candidate);
      reverseCandidatesByClone.set(cloneTabId, candidate);
      setTimeout(
        () => cleanupReverseCandidate(candidate),
        REVERSE_POPUNDER_WINDOW_MS + 500
      );
    }
    if (!candidate.originalUrl) {
      try {
        const sourceTab = await chrome.tabs.get(sourceTabId);
        if (sourceTab?.url?.startsWith("http")) {
          candidate.originalUrl = sourceTab.url;
        }
      } catch {
      }
    }
    if (cloneUrl && !isBlankUrl(cloneUrl)) candidate.cloneUrl = cloneUrl;
    maybeHandleReversePopunder(candidate).catch(logReversePopunderError);
  }
  function observeReverseNavigation(tabId, url) {
    const cloneCandidate = reverseCandidatesByClone.get(tabId);
    if (cloneCandidate) {
      cloneCandidate.cloneUrl = url;
      maybeHandleReversePopunder(cloneCandidate).catch(logReversePopunderError);
    }
    const sourceCandidate = reverseCandidatesBySource.get(tabId);
    if (sourceCandidate) {
      sourceCandidate.redirectedUrl = url;
      maybeHandleReversePopunder(sourceCandidate).catch(logReversePopunderError);
    }
  }
  async function maybeHandleReversePopunder(candidate) {
    if (candidate.handling || !candidate.originalUrl || !candidate.cloneUrl || !candidate.redirectedUrl)
      return;
    const elapsedMs = Date.now() - candidate.createdAt;
    if (!isReversePopunderSequence({
      originalUrl: candidate.originalUrl,
      cloneUrl: candidate.cloneUrl,
      redirectedUrl: candidate.redirectedUrl,
      elapsedMs
    }))
      return;
    candidate.handling = true;
    if (await isAllowedReverseRedirect(candidate)) {
      cleanupReverseCandidate(candidate);
      return;
    }
    const sourceHost = new URL(candidate.originalUrl).hostname;
    await logBlockedNavigationIfAllowed(candidate.redirectedUrl, sourceHost);
    try {
      const cloneTab = await chrome.tabs.get(candidate.cloneTabId);
      if (!cloneTab?.url || !isSelfCloneNavigation(candidate.originalUrl, cloneTab.url))
        throw new Error("clone gone");
      await chrome.tabs.update(candidate.cloneTabId, { active: true });
      await chrome.tabs.remove(candidate.sourceTabId);
    } catch {
      try {
        await chrome.tabs.update(candidate.sourceTabId, {
          url: candidate.originalUrl
        });
      } catch {
      }
    } finally {
      pendingTabs.delete(candidate.cloneTabId);
      handledTabs.set(candidate.sourceTabId, Date.now());
      cleanupReverseCandidate(candidate);
    }
  }
  async function isAllowedReverseRedirect(candidate) {
    const original = new URL(candidate.originalUrl);
    const redirected = new URL(candidate.redirectedUrl);
    if (isTrustedTarget(redirected.hostname)) return true;
    const { whitelist = [] } = await chrome.storage.local.get("whitelist");
    if (whitelist.includes(redirected.hostname)) return true;
    const trustWindow = await getDynamicTrustWindow(original.hostname);
    if (hasMatchingIntent(candidate.sourceTabId, redirected.hostname, trustWindow))
      return true;
    const path = await getTrustedPath(original.hostname, redirected.hostname);
    return !isPromotionalIntent(candidate.sourceTabId) && !!path && (path.isManual || path.visits >= 3);
  }
  function getRecentSourceUrl(sourceTabId) {
    const click = runtimeState.lastTrustedClick;
    if (click.tabId === sourceTabId && click.sourceUrl?.startsWith("http") && Date.now() - click.timestamp < 2e3)
      return click.sourceUrl;
    return null;
  }
  function cleanupReverseCandidate(candidate) {
    if (reverseCandidatesBySource.get(candidate.sourceTabId) === candidate) {
      reverseCandidatesBySource.delete(candidate.sourceTabId);
    }
    if (reverseCandidatesByClone.get(candidate.cloneTabId) === candidate) {
      reverseCandidatesByClone.delete(candidate.cloneTabId);
    }
  }
  function logReversePopunderError(error) {
    console.error("Reverse pop-under guard failed:", error);
  }
  async function evaluateNewTab({ sourceTabId, tabId, url }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_GUARD)) return;
    if (!sourceTabId || !tabId || !url || isBlankUrl(url)) return;
    if (handledTabs.has(tabId)) return;
    let shouldFinalize = false;
    try {
      const { whitelist = [], blacklist = [] } = await chrome.storage.local.get([
        "whitelist",
        "blacklist"
      ]);
      const sourceTab = await chrome.tabs.get(sourceTabId);
      const capturedSourceUrl = reverseCandidatesBySource.get(sourceTabId)?.originalUrl || sourceTab?.url;
      if (!capturedSourceUrl?.startsWith("http")) return;
      const sourceUrl = new URL(capturedSourceUrl);
      const targetUrl = new URL(url);
      const targetDomain = targetUrl.hostname;
      const sameSite = sameHostnameOrSubdomain(sourceUrl.hostname, targetDomain) || sameHostnameOrSubdomain(targetDomain, sourceUrl.hostname);
      if (shouldKeepTrackingNewTab({ sameSite })) return;
      const trustWindow = await getDynamicTrustWindow(sourceUrl.hostname);
      let intentMatched = hasMatchingIntent(
        sourceTabId,
        targetDomain,
        trustWindow
      );
      const path = await getTrustedPath(sourceUrl.hostname, targetDomain);
      const promotionalIntent = isPromotionalIntent(sourceTabId);
      const decision = decideNewTabNavigation({
        sameSite,
        trustedInitiator: isTrustedInitiator(sourceUrl.hostname),
        trustedTarget: isTrustedTarget(targetDomain),
        whitelisted: whitelist.includes(targetDomain),
        blacklisted: isBlacklistedTarget(targetDomain, blacklist),
        intentMatched,
        trustedPath: !!path && (path.isManual || path.visits >= 3),
        promotionalIntent
      });
      if (decision === NEW_TAB_DECISIONS.ALLOW) {
        shouldFinalize = true;
        if (intentMatched) syncTrustedPath(sourceUrl.hostname, targetDomain);
        return;
      }
      if (decision === NEW_TAB_DECISIONS.CLOSE) {
        shouldFinalize = true;
        await logBlockedNavigationIfAllowed(url, sourceUrl.hostname);
        return closeTabQuietly(tabId);
      }
      await delay(180);
      intentMatched = hasMatchingIntent(sourceTabId, targetDomain, trustWindow);
      if (intentMatched) {
        shouldFinalize = true;
        syncTrustedPath(sourceUrl.hostname, targetDomain);
        return;
      }
      const targetClassification = classifyNavigationIntent({
        intentUrl: url,
        sourceUrl: capturedSourceUrl
      });
      const reviewSurface = chooseNewTabReviewSurface({
        promotionalIntent: promotionalIntent || isPromotionalIntent(sourceTabId),
        targetLikelyAd: targetClassification.likelyAd
      });
      shouldFinalize = true;
      if (reviewSurface === NEW_TAB_REVIEW_SURFACES.FULL_PAGE) {
        return redirectToBlockedPage(tabId, url, sourceUrl.hostname);
      }
      const toastShown = await showNavigationReviewToast({
        sourceTabId,
        tabId,
        url,
        source: sourceUrl.hostname,
        target: targetDomain
      });
      if (toastShown) return;
      return redirectToBlockedPage(tabId, url, sourceUrl.hostname);
    } catch (err) {
      console.error("Error evaluating navigation:", err);
    } finally {
      if (shouldFinalize) {
        pendingTabs.delete(tabId);
        handledTabs.set(tabId, Date.now());
        setTimeout(() => handledTabs.delete(tabId), 15e3);
      }
    }
  }
  function hasMatchingIntent(sourceTabId, targetDomain, trustWindow) {
    const click = runtimeState.lastTrustedClick;
    if (click.tabId !== sourceTabId) return false;
    const intent = parseUrl(click.intentUrl);
    if (isPromotionalIntent(sourceTabId)) return false;
    const timeSinceClick = Date.now() - click.timestamp;
    return timeSinceClick >= 0 && timeSinceClick < trustWindow && !!intent && (sameHostnameOrSubdomain(targetDomain, intent.hostname) || sameHostnameOrSubdomain(intent.hostname, targetDomain));
  }
  async function showNavigationReviewToast({
    sourceTabId,
    tabId,
    url,
    source,
    target
  }) {
    if (!navigationPolicy?.can(CAPABILITIES.NAVIGATION_FEEDBACK)) return false;
    const message = {
      type: "SHOW_GRAY_NAVIGATION",
      tabId,
      url,
      source,
      target
    };
    for (const destinationTabId of [tabId, sourceTabId]) {
      if (!destinationTabId) continue;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await chrome.tabs.sendMessage(destinationTabId, message);
          return true;
        } catch {
          if (attempt === 0) await delay(180);
        }
      }
    }
    return false;
  }
  function isPromotionalIntent(sourceTabId) {
    const click = runtimeState.lastTrustedClick;
    if (click.tabId !== sourceTabId) return false;
    const classification = classifyNavigationIntent({
      intentUrl: click.intentUrl,
      sourceUrl: click.sourceUrl,
      evidence: click.intentKind === "promotional" ? "promo" : ""
    });
    return click.intentKind === "promotional" || classification.likelyAd;
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function redirectToBlockedPage(tabId, url, source) {
    await logBlockedNavigationIfAllowed(url, source);
    await chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL(
        `ui/blocked.html?url=${encodeURIComponent(url)}&source=${encodeURIComponent(source)}`
      )
    });
  }
  async function logBlockedNavigationIfAllowed(url, source) {
    if (navigationPolicy?.can(CAPABILITIES.TELEMETRY_QUEUE)) {
      await logBlockedNavigation(url, source);
    }
  }
  async function closeTabQuietly(tabId) {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      try {
        await chrome.tabs.update(tabId, { url: "about:blank" });
      } catch {
      }
    }
  }
  function isBlankUrl(url) {
    return !url || url === "about:blank" || url.startsWith("about:") || url.startsWith("chrome:");
  }
  function isTrustedInitiator(hostname) {
    return hostMatchesAny(hostname, TRUSTED_INITIATORS) || isGoogleHost(hostname);
  }
  function isTrustedTarget(hostname) {
    return hostMatchesAny(hostname, TRUSTED_TARGETS) || isGoogleHost(hostname);
  }
  function isBlacklistedTarget(hostname, blacklist = []) {
    const normalized = hostname.toLowerCase();
    return blacklist.some((entry) => {
      const value = String(entry || "").replace(/^\|\|/, "").replace(/\^$/, "").toLowerCase();
      return normalized === value || normalized.endsWith(`.${value}`);
    });
  }
  function hostMatchesAny(hostname, domains) {
    const normalized = hostname.toLowerCase();
    return domains.some(
      (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
    );
  }
  function isGoogleHost(hostname) {
    return /^(.+\.)?google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(
      hostname.toLowerCase()
    );
  }

  // src/runtime/settings-store.js
  var SETTINGS_KEY = "appSettings";
  var DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    protectionMode: PROTECTION_MODES.SAFE,
    featureOverrides: Object.freeze({})
  });
  function normalizeSettings(value = {}) {
    const protectionMode = Object.values(PROTECTION_MODES).includes(
      value.protectionMode
    ) ? value.protectionMode : DEFAULT_SETTINGS.protectionMode;
    return {
      enabled: value.enabled !== false,
      protectionMode,
      featureOverrides: value.featureOverrides && typeof value.featureOverrides === "object" ? { ...value.featureOverrides } : {}
    };
  }
  function migrateLegacySettings(stored = {}) {
    if (stored[SETTINGS_KEY]) return normalizeSettings(stored[SETTINGS_KEY]);
    const protectionMode = stored.friendlyMode === false ? PROTECTION_MODES.AUTO : PROTECTION_MODES.SAFE;
    return normalizeSettings({
      enabled: stored.isEnabled !== false,
      protectionMode
    });
  }
  async function loadSettings(storage = chrome.storage.local) {
    const stored = await storage.get([SETTINGS_KEY, "isEnabled", "friendlyMode"]);
    const settings = migrateLegacySettings(stored);
    if (!stored[SETTINGS_KEY]) await storage.set({ [SETTINGS_KEY]: settings });
    return settings;
  }
  function subscribeSettings(listener, storageArea = "local") {
    const onChanged = (changes, areaName) => {
      if (areaName !== storageArea || !changes[SETTINGS_KEY]) return;
      listener(normalizeSettings(changes[SETTINGS_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }

  // src/runtime/main-controller.js
  function createMainController({
    context,
    implementations,
    initialSettings = null,
    watchSettings = true,
    settingsLoader = loadSettings,
    settingsSubscriber = subscribeSettings,
    logger = console
  }) {
    const catalogFeatures = getFeaturesForContext(context);
    validateImplementations(context, catalogFeatures, implementations);
    let settings = normalizeSettings(initialSettings || DEFAULT_SETTINGS);
    let unsubscribe = null;
    let started = false;
    const lifecycles = /* @__PURE__ */ new Map();
    const listeners = /* @__PURE__ */ new Set();
    const controller2 = {
      context,
      async start() {
        if (started) return controller2;
        started = true;
        if (!initialSettings) settings = await settingsLoader();
        await reconcile();
        if (watchSettings) {
          unsubscribe = settingsSubscriber((nextSettings) => {
            controller2.updateSettings(nextSettings).catch(
              (error) => logger.error(`[MainController:${context}] reconcile failed`, error)
            );
          });
        }
        notify();
        return controller2;
      },
      async updateSettings(nextSettings) {
        settings = normalizeSettings(nextSettings);
        if (started) await reconcile();
        notify();
        return controller2.snapshot();
      },
      snapshot() {
        return {
          context,
          settings: { ...settings, featureOverrides: { ...settings.featureOverrides } },
          activeFeatures: [...lifecycles.entries()].filter(([, lifecycle]) => lifecycle.active).map(([featureId]) => featureId)
        };
      },
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async stop() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        for (const [featureId, lifecycle] of lifecycles) {
          await stopLifecycle(featureId, lifecycle);
        }
        lifecycles.clear();
        started = false;
      }
    };
    async function reconcile() {
      validateFeatureOverrides(settings.featureOverrides);
      for (const definition of catalogFeatures) {
        const desired = shouldStartFeature(definition, settings);
        const lifecycle = lifecycles.get(definition.id);
        if (desired && !lifecycle?.active) {
          const policy = createFeaturePolicy(definition, () => settings);
          if (lifecycle?.started && !lifecycle.cleanup) {
            lifecycle.active = true;
            continue;
          }
          const result = implementations[definition.id]({
            controller: controller2,
            feature: definition,
            policy
          });
          const cleanup = isPromiseLike(result) ? await result : result;
          lifecycles.set(definition.id, {
            active: true,
            started: true,
            cleanup: typeof cleanup === "function" ? cleanup : null
          });
        } else if (!desired && lifecycle?.active) {
          if (lifecycle.cleanup) {
            await stopLifecycle(definition.id, lifecycle);
            lifecycles.delete(definition.id);
          } else {
            lifecycle.active = false;
          }
        }
      }
    }
    async function stopLifecycle(featureId, lifecycle) {
      if (!lifecycle.cleanup) {
        lifecycle.active = false;
        return;
      }
      try {
        await lifecycle.cleanup();
      } catch (error) {
        logger.error(`[MainController:${context}] failed to stop ${featureId}`, error);
      }
      lifecycle.active = false;
    }
    function notify() {
      const snapshot = controller2.snapshot();
      for (const listener of listeners) listener(snapshot);
    }
    return controller2;
  }
  function createFeaturePolicy(definitionOrId, readSettings) {
    const definition = typeof definitionOrId === "string" ? getFeatureDefinition(definitionOrId) : definitionOrId;
    const declared = new Set(definition.capabilities);
    function assertAllowed(capability) {
      assertRegisteredCapability(capability);
      if (!declared.has(capability)) {
        throw new Error(
          `[FeatureRegistry] Feature "${definition.id}" tried to use undeclared capability "${capability}". Add it to that feature in feature-catalog.js.`
        );
      }
    }
    return Object.freeze({
      featureId: definition.id,
      can(capability) {
        assertAllowed(capability);
        const settings = readSettings();
        if (!settings.enabled) return false;
        return getCapabilitiesForMode(settings.protectionMode).includes(capability);
      },
      require(capability) {
        if (!this.can(capability)) {
          const settings = readSettings();
          throw new Error(
            `[FeatureRegistry] Capability "${capability}" is disabled for feature "${definition.id}" in mode "${settings.protectionMode}".`
          );
        }
        return true;
      }
    });
  }
  function shouldStartFeature(definition, settings) {
    const override = settings.featureOverrides?.[definition.id];
    if (override === false || !settings.enabled) return false;
    return getCapabilitiesForMode(settings.protectionMode).includes(
      definition.startCapability
    );
  }
  function validateFeatureOverrides(featureOverrides = {}) {
    for (const featureId of Object.keys(featureOverrides)) {
      getFeatureDefinition(featureId);
    }
  }
  function isPromiseLike(value) {
    return value && typeof value.then === "function";
  }
  function validateImplementations(context, catalogFeatures, implementations) {
    const expected = new Set(catalogFeatures.map((feature2) => feature2.id));
    for (const featureId of Object.keys(implementations)) {
      const definition = getFeatureDefinition(featureId);
      if (definition.context !== context) {
        throw new Error(
          `[FeatureRegistry] Feature "${featureId}" belongs to context "${definition.context}", not "${context}".`
        );
      }
    }
    for (const featureId of expected) {
      if (typeof implementations[featureId] !== "function") {
        throw new Error(
          `[FeatureRegistry] Feature "${featureId}" is registered for context "${context}" but has no implementation in its main feature list.`
        );
      }
    }
  }

  // src/background/index.js
  var controller = createMainController({
    context: "background",
    initialSettings: DEFAULT_SETTINGS,
    implementations: {
      "background.message-router": ({ policy }) => registerMessageRouter(policy),
      "background.navigation-guard": ({ policy }) => registerNavigationGuard(policy),
      "background.telemetry-flush": () => startTelemetryFlush(),
      "background.memory-cleanup": () => {
        chrome.runtime.onStartup.addListener(cleanupStaleMemory);
        cleanupStaleMemory();
        return () => chrome.runtime.onStartup.removeListener(cleanupStaleMemory);
      },
      "background.pattern-seed": () => {
        chrome.runtime.onInstalled.addListener(seedBaselinePatterns);
        seedBaselinePatterns();
        return () => chrome.runtime.onInstalled.removeListener(seedBaselinePatterns);
      }
    }
  });
  controller.start().then(() => loadSettings()).then((settings) => controller.updateSettings(settings)).catch(
    (error) => console.error("[AdsFriendly Background] MainController failed", error)
  );
})();
