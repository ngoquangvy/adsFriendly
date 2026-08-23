var AdsFriendlyPicker = (() => {
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
    feature("background.settings-package-seed", "background", C.CORE_MAINTENANCE),
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

  // src/picker/index.js
  function startPickerController(policy) {
    (function() {
      let isActive = false;
      let hoveredElement = null;
      let selectedItems = [];
      let overlays = [];
      let activeOverlay = null;
      let controlPanel = null;
      const GENERIC_CLASSES = [
        "lazyloaded",
        "ls-is-cached",
        "active",
        "show",
        "showing",
        "visible",
        "container",
        "inner",
        "wrapper",
        "img-responsive",
        "swiper-wrapper",
        "swiper-slide",
        "swiper-container",
        "owl-stage",
        "owl-item",
        "slick-track",
        "slick-slide",
        "carousel-inner"
      ];
      const STRUCTURAL_TAGS = [
        "html",
        "body",
        "header",
        "footer",
        "nav",
        "main",
        "section",
        "article",
        "aside"
      ];
      const createUI = () => {
        if (activeOverlay) return;
        activeOverlay = document.createElement("div");
        activeOverlay.id = "adsfriendly-picker-active-overlay";
        activeOverlay.style.cssText = `
            position: fixed;
            pointer-events: none;
            z-index: 2147483647;
            background: rgba(16, 185, 129, 0.2);
            outline: 2px solid #10b981;
            box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
            transition: all 0.1s ease;
            display: none;
            border-radius: 4px;
        `;
        document.body.appendChild(activeOverlay);
        controlPanel = document.createElement("div");
        controlPanel.id = "adsfriendly-picker-panel";
        controlPanel.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            background: #1e293b;
            color: white;
            padding: 10px 16px;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            display: none;
            flex-direction: row;
            align-items: center;
            gap: 15px;
            font-family: system-ui, -apple-system, sans-serif;
            border: 1px solid rgba(255,255,255,0.1);
            pointer-events: auto;
        `;
        document.body.appendChild(controlPanel);
        updatePanelUI();
      };
      const updatePanelUI = (errorMsg = null) => {
        if (!controlPanel) return;
        const count = selectedItems.length;
        const color = errorMsg ? "#ef4444" : "#10b981";
        let videoContext = false;
        if (hoveredElement) {
          videoContext = hoveredElement.tagName === "VIDEO" || hoveredElement.querySelector("video") || hoveredElement.closest(".jw-video, .video-js, .fluid_player_instance");
        }
        controlPanel.innerHTML = `
            <div style="font-weight: bold; font-size: 1rem; color: ${color};">${errorMsg ? "!" : videoContext ? "VIDEO" : "TARGET"}</div>
            <div style="display: flex; flex-direction: column;">
                <div style="font-weight: bold; font-size: 0.85rem; color: ${errorMsg ? "#f87171" : "white"};">${errorMsg || (videoContext ? "Video Player Detected" : count > 0 ? `${count} Ads Marked` : "Select Ads to Zap")}</div>
                <div style="font-size: 0.7rem; color: #94a3b8;">${errorMsg ? "Please select a smaller area" : videoContext ? "Is this a Video Ad? Mark it to Neutralize." : count > 0 ? "Press <b>Enter</b> to Zap all, <b>Esc</b> to Cancel" : "Click to mark, Scroll to expand"}</div>
            </div>
            <div style="display: flex; gap: 8px;">
                ${videoContext ? `<button id="neutralize-video-btn" style="background: #a855f7; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: bold;">Neutralize</button>` : ""}
                ${count > 0 && !errorMsg ? `<button id="zap-confirm-btn" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: bold;">Zap All</button>` : ""}
            </div>
        `;
        const zapBtn = document.getElementById("zap-confirm-btn");
        if (zapBtn) zapBtn.onclick = confirmAllZaps;
        const neuBtn = document.getElementById("neutralize-video-btn");
        if (neuBtn) neuBtn.onclick = handleNeutralizeVideo;
      };
      const handleNeutralizeVideo = async () => {
        if (!hoveredElement) return;
        const video = hoveredElement.tagName === "VIDEO" ? hoveredElement : hoveredElement.querySelector("video") || hoveredElement.closest("div").querySelector("video");
        if (video) {
          console.log(
            "[AdsFriendly Picker] Neutralizing Video Ad manually:",
            video.currentSrc
          );
          if (typeof VideoSurgeon !== "undefined") {
            VideoSurgeon.accelerate(video);
          }
          chrome.runtime.sendMessage({
            type: "LEARN_VIDEO_AD",
            hostname: window.location.hostname,
            src: video.currentSrc || video.src,
            classes: video.className + " " + (video.parentElement ? video.parentElement.className : "")
          });
          updatePanelUI("Video Neutralized! (Learning pattern...)");
          setTimeout(() => stopPicker(), 1500);
        }
      };
      const startPicker = async () => {
        if (isActive) return;
        isActive = true;
        createUI();
        activeOverlay.style.display = "block";
        controlPanel.style.display = "flex";
        selectedItems = [];
        clearOverlays();
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("click", handleClick, true);
        document.addEventListener("scroll", handleScroll, true);
        document.addEventListener("keydown", handleKeyDown);
        console.log(
          "%c[AdsFriendly AI] Starting Picker - Predictive Scan initiated...",
          "color: #10b981; font-weight: bold;"
        );
        const { globalAdPatterns = [] } = await chrome.storage.local.get("globalAdPatterns");
        if (globalAdPatterns.length > 0) {
          const elements = document.querySelectorAll(
            'img, a, div[style*="background-image"], [href*="http"]'
          );
          let autoMarkedCount = 0;
          elements.forEach((el) => {
            if (STRUCTURAL_TAGS.includes(el.tagName.toLowerCase())) return;
            let score = 0;
            let reasons = [];
            globalAdPatterns.forEach((p) => {
              if (p.type === "alt" && el.alt === p.value) {
                score += p.confidence;
                reasons.push(`alt='${p.value}'`);
              }
              if (p.type === "title" && el.title === p.value) {
                score += p.confidence;
                reasons.push(`title='${p.value}'`);
              }
              if (p.type === "domain") {
                const link = el.closest("a");
                if (link && link.href && link.href.includes(p.value)) {
                  score += p.confidence;
                  reasons.push(`domain='${p.value}'`);
                }
              }
            });
            if (score >= 0.9) {
              markElement(el);
              autoMarkedCount++;
              console.log(
                `[AdsFriendly AI] Auto-marked element: %o
Confidence: ${(score * 100).toFixed(1)}%
Reason: ${reasons.join(", ")}`,
                el
              );
            }
          });
          if (autoMarkedCount > 0) {
            console.log(
              `[AdsFriendly AI] Auto-marked ${autoMarkedCount} high-confidence ads.`
            );
            updatePanelUI();
          }
        }
      };
      const stopPicker = () => {
        isActive = false;
        if (activeOverlay) activeOverlay.style.display = "none";
        if (controlPanel) controlPanel.style.display = "none";
        clearOverlays();
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("click", handleClick, true);
        document.removeEventListener("scroll", handleScroll, true);
        document.removeEventListener("keydown", handleKeyDown);
      };
      const clearOverlays = () => {
        overlays.forEach((o) => o.remove());
        overlays = [];
      };
      const handleMouseMove = (e) => {
        if (!isActive) return;
        let el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && STRUCTURAL_TAGS.includes(el.tagName.toLowerCase())) {
          return;
        }
        if (el && el !== activeOverlay && !controlPanel.contains(el) && !isOverlay(el)) {
          updateSelection(el);
        }
      };
      const isOverlay = (el) => el.id && (el.id.includes("overlay") || el.id.includes("panel"));
      const updateSelection = (el) => {
        const findMeaningfulParent = (curr, depth = 0) => {
          if (!curr || curr === document.body || depth > 3) return curr;
          const r = curr.getBoundingClientRect();
          if (r.width > 25 && r.height > 25) return curr;
          return findMeaningfulParent(curr.parentElement, depth + 1);
        };
        let target = findMeaningfulParent(el);
        const isAdRelated = (node) => {
          if (node.tagName === "IMG" || node.tagName === "A") return true;
          if (node.tagName === "BR" || node.tagName === "CENTER") return true;
          if (node.id && /ad|pop|banner|promo/i.test(node.id)) return true;
          return false;
        };
        const isExclusiveAdWrapper = (container) => {
          if (!container || container === document.body) return false;
          const text = container.innerText.trim();
          if (text.length > 50) return false;
          const children = Array.from(container.children);
          if (children.length === 0) return false;
          return children.every(
            (child) => isAdRelated(child) || isExclusiveAdWrapper(child)
          );
        };
        const promoteToWrapper = (curr, depth = 0) => {
          if (!curr || curr.parentElement === document.body || depth > 3)
            return curr;
          const parent = curr.parentElement;
          if (isExclusiveAdWrapper(parent)) {
            const rect2 = parent.getBoundingClientRect();
            if (rect2.width * rect2.height < window.innerWidth * window.innerHeight * 0.35) {
              return promoteToWrapper(parent, depth + 1);
            }
          }
          return curr;
        };
        target = promoteToWrapper(target);
        hoveredElement = target;
        const selector = generateSelector(target);
        const validation = validateSelector(selector);
        const rect = target.getBoundingClientRect();
        activeOverlay.style.top = rect.top + "px";
        activeOverlay.style.left = rect.left + "px";
        activeOverlay.style.width = rect.width + "px";
        activeOverlay.style.height = rect.height + "px";
        if (!validation.valid) {
          activeOverlay.style.background = "rgba(239, 68, 68, 0.3)";
          activeOverlay.style.outlineColor = "#ef4444";
          activeOverlay.style.boxShadow = "0 0 20px rgba(239, 68, 68, 0.5)";
          updatePanelUI(`DANGEROUS: ${validation.reason}`);
        } else {
          activeOverlay.style.background = "rgba(16, 185, 129, 0.2)";
          activeOverlay.style.outlineColor = "#10b981";
          activeOverlay.style.boxShadow = "0 0 15px rgba(16, 185, 129, 0.4)";
          updatePanelUI();
        }
        const panelHeight = controlPanel.offsetHeight || 50;
        let panelTop = rect.top - panelHeight - 12;
        if (panelTop < 12) panelTop = rect.bottom + 12;
        controlPanel.style.top = panelTop + "px";
        controlPanel.style.left = Math.max(
          12,
          Math.min(window.innerWidth - controlPanel.offsetWidth - 12, rect.left)
        ) + "px";
      };
      const handleClick = (e) => {
        if (!isActive || !hoveredElement) return;
        const selector = generateSelector(hoveredElement);
        const validation = validateSelector(selector);
        if (!validation.valid) {
          console.warn(
            "[AdsFriendly Picker] Blocked dangerous selection:",
            validation.reason
          );
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && !selectedItems.some((item) => item.element === el)) {
          markElement(el, selector);
        }
      };
      const markElement = (el, selector) => {
        if (!selector) return;
        const fingerprint = generateFingerprint(el);
        selectedItems.push({ element: el, selector, fingerprint });
        const rect = el.getBoundingClientRect();
        const pOverlay = document.createElement("div");
        pOverlay.style.cssText = `
            position: fixed;
            top: ${rect.top}px;
            left: ${rect.left}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            background: rgba(16, 185, 129, 0.3);
            border: 2px solid #10b981;
            pointer-events: none;
            z-index: 2147483646;
            border-radius: 4px;
        `;
        document.body.appendChild(pOverlay);
        overlays.push(pOverlay);
        updatePanelUI();
      };
      const handleScroll = (e) => {
        if (!isActive || !hoveredElement) return;
        e.preventDefault();
        if (e.deltaY < 0 && hoveredElement.parentElement && hoveredElement.parentElement !== document.body) {
          updateSelection(hoveredElement.parentElement);
        }
      };
      const handleKeyDown = (e) => {
        if (e.key === "Escape") stopPicker();
        if (e.key === "Enter" && selectedItems.length > 0) confirmAllZaps();
      };
      const confirmAllZaps = async () => {
        const hostname = window.location.hostname;
        const { userCustomRules = {}, siteResetHistory = {} } = await chrome.storage.local.get(["userCustomRules", "siteResetHistory"]);
        if (!userCustomRules[hostname]) userCustomRules[hostname] = [];
        let addedCount = 0;
        const resetData = siteResetHistory[hostname];
        const isCorrectionLoop = !!resetData;
        selectedItems.forEach((item) => {
          const validation = validateSelector(item.selector);
          if (!validation.valid) {
            console.error(
              "[AdsFriendly Picker] Skipping dangerous rule:",
              item.selector,
              validation.reason
            );
            return;
          }
          let finalSelector = item.selector;
          if (isCorrectionLoop && resetData.oldRules) {
            console.log(
              `%c[AdsFriendly AI] Differential Analysis triggered for ${hostname}`,
              "color: #a855f7; font-weight: bold;"
            );
            resetData.oldRules.forEach((oldRule) => {
              const oldF = typeof oldRule === "string" ? null : oldRule.fingerprint;
              if (oldF && oldF.tag === item.fingerprint.tag) {
                const delta = findFingerprintDelta(oldF, item.fingerprint);
                if (delta) {
                  console.log("[AdsFriendly AI] Found learning delta:", delta);
                  if (delta.type === "dataAttr") {
                    finalSelector = `${item.selector.split(" > ").pop()}[${delta.key}="${delta.value}"]`;
                  } else if (delta.type === "class" && delta.value) {
                    finalSelector = `${item.selector.split(" > ").pop()}.${delta.value.split(" ")[0]}`;
                  }
                }
              }
            });
          }
          const ruleObject = {
            selector: finalSelector,
            fingerprint: item.fingerprint,
            timestamp: Date.now(),
            timesZapped: 1,
            confidence: isCorrectionLoop ? 1 : 0.8,
            isCorrection: isCorrectionLoop
          };
          if (isCorrectionLoop) {
            console.log(
              `%c[AdsFriendly AI] Correction learned: ${finalSelector}`,
              "color: #10b981; font-weight: bold;"
            );
          }
          const existingIndex = userCustomRules[hostname].findIndex(
            (r) => typeof r === "string" ? r === finalSelector : r.selector === finalSelector
          );
          if (existingIndex > -1)
            userCustomRules[hostname][existingIndex] = ruleObject;
          else userCustomRules[hostname].push(ruleObject);
          item.element.style.opacity = "0";
          item.element.style.pointerEvents = "none";
          addedCount++;
        });
        if (addedCount > 0) {
          await chrome.storage.local.set({ userCustomRules });
          chrome.runtime.sendMessage({ type: "SYNC_LEARNING" });
        }
        stopPicker();
      };
      const generateSelector = (el) => {
        const tag = el.tagName.toLowerCase();
        const structuralTags = [
          "div",
          "span",
          "p",
          "a",
          "li",
          "ul",
          "img",
          "section",
          "article",
          "main",
          "aside"
        ];
        const isSafeId = (id) => id && !GENERIC_CLASSES.some((gc) => id.includes(gc)) && !/[0-9]{5,}/.test(id);
        const isSafeClass = (cls) => cls && typeof cls === "string" && cls.split(/\s+/).some((c) => c && !GENERIC_CLASSES.includes(c) && !/[0-9]{5,}/.test(c));
        if (tag === "a" && el.href && el.href.includes("javascript:")) {
          if (isSafeId(el.id)) return `#${el.id}`;
          if (el.parentElement && isSafeId(el.parentElement.id))
            return `#${el.parentElement.id} > ${tag}`;
          const jsMatch = el.href.match(/javascript:([a-zA-Z0-9_]+)/);
          if (jsMatch && jsMatch[1].length > 3) {
            return `${tag}[href*="${jsMatch[1]}"]`;
          }
        }
        const adKeywords = ["quangcao", "catfish", "ads", "popup", "banner"];
        if (el.id && adKeywords.some((k) => el.id.toLowerCase().includes(k)))
          return `#${el.id}`;
        if (isSafeId(el.id)) return `#${el.id}`;
        const buildPath = (curr, depth = 0) => {
          if (!curr || curr === document.body || depth > 2) return "";
          let part = curr.tagName.toLowerCase();
          if (curr.id && adKeywords.some((k) => curr.id.toLowerCase().includes(k)))
            return `#${curr.id} ${part}`.trim();
          if (isSafeId(curr.id)) return `#${curr.id} ${part}`.trim();
          if (curr.className && typeof curr.className === "string") {
            const validClass = curr.className.split(/\s+/).find(
              (c) => c && !GENERIC_CLASSES.includes(c) && !/[0-9]{5,}/.test(c)
            );
            if (validClass) part = `.${validClass}`;
          }
          const parentPart = buildPath(curr.parentElement, depth + 1);
          return (parentPart ? parentPart + " > " : "") + part;
        };
        const path = buildPath(el);
        if (!path || structuralTags.includes(path.split(" > ").pop())) {
          const rect = el.getBoundingClientRect();
          if (rect.width * rect.height > 1e4 || structuralTags.includes(tag)) {
            return null;
          }
          return tag;
        }
        return path;
      };
      const validateSelector = (selector) => {
        if (!selector) return { valid: false, reason: "No selector generated" };
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length > 5)
            return {
              valid: false,
              reason: `Matches too many elements (${matches.length})`
            };
          let totalArea = 0;
          const viewportArea = window.innerWidth * window.innerHeight;
          matches.forEach((m) => {
            const r = m.getBoundingClientRect();
            totalArea += r.width * r.height;
          });
          if (totalArea > viewportArea * 0.35)
            return { valid: false, reason: "Selector area is too large (>35%)" };
          return { valid: true };
        } catch (e) {
          return { valid: false, reason: "Invalid selector logic" };
        }
      };
      const generateFingerprint = (el) => {
        const cleanId = (id) => id && !/(_[a-z0-9]{1,3}_|[0-9]{5,})/.test(id) ? id : null;
        const cleanClass = (cls) => {
          if (!cls || typeof cls !== "string") return null;
          return cls.split(/\s+/).filter((c) => !/(active|hover|focus|selected|clicked)/.test(c)).join(" ");
        };
        let linkDomain = null;
        const link = el.closest("a");
        if (link && link.href) {
          try {
            const url = new URL(link.href);
            if (url.hostname !== window.location.hostname) {
              linkDomain = url.hostname.split(".").slice(-2).join(".");
            }
          } catch (e) {
          }
        }
        const dataAttrs = {};
        if (el.attributes) {
          Array.from(el.attributes).forEach((attr) => {
            if (attr.name.startsWith("data-") && attr.value.length < 50) {
              dataAttrs[attr.name] = attr.value;
            }
          });
        }
        return {
          tag: el.tagName.toLowerCase(),
          className: cleanClass(el.className),
          parentId: el.parentElement ? cleanId(el.parentElement.id) : null,
          parentClass: el.parentElement ? cleanClass(el.parentElement.className) : null,
          alt: el.alt || null,
          title: el.title || null,
          linkDomain,
          childCount: el.children ? el.children.length : 0,
          dataAttrs
        };
      };
      const findFingerprintDelta = (oldF, newF) => {
        if (!oldF || !newF) return null;
        for (const key in newF.dataAttrs) {
          if (!oldF.dataAttrs || oldF.dataAttrs[key] !== newF.dataAttrs[key]) {
            return { type: "dataAttr", key, value: newF.dataAttrs[key] };
          }
        }
        if (newF.className !== oldF.className)
          return { type: "class", value: newF.className };
        if (newF.childCount !== oldF.childCount)
          return { type: "childCount", value: newF.childCount };
        return null;
      };
      chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "START_PICKER" && policy.can(CAPABILITIES.DOM_MANUAL_PICKER))
          startPicker();
      });
    })();
  }
  var controller = createMainController({
    context: "picker",
    implementations: {
      "picker.controller": ({ policy }) => startPickerController(policy)
    }
  });
  controller.start().catch(
    (error) => console.error("[AdsFriendly Picker] MainController failed", error)
  );
})();
