var AdsFriendlyPopup = (() => {
  // src/runtime/feature-catalog.js
  var PROTECTION_MODES = Object.freeze({
    SAFE: "safe",
    ASSIST: "assist",
    AUTO: "auto"
  });
  var CAPABILITY_TRIGGERS = Object.freeze({
    CORE: "core",
    PASSIVE: "passive",
    USER: "user",
    SUGGESTION: "suggestion",
    AUTOMATIC: "automatic",
    STORAGE: "storage"
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
    MEDIA_CATALOG: "media.catalog",
    MEDIA_DOWNLOAD: "media.download",
    VIDEO_OBSERVE: "video.observe",
    VIDEO_RESTORE_STATE: "video.restore_state",
    VIDEO_USER_ACTION: "video.user_action",
    VIDEO_AUTO_ACTION: "video.auto_action"
  });
  var C = CAPABILITIES;
  var T = CAPABILITY_TRIGGERS;
  var MODE_RANK = Object.freeze({
    [PROTECTION_MODES.SAFE]: 0,
    [PROTECTION_MODES.ASSIST]: 1,
    [PROTECTION_MODES.AUTO]: 2
  });
  var CAPABILITY_CATALOG = Object.freeze({
    [C.CORE_MESSAGING]: capability(C.CORE_MESSAGING, "safe", T.CORE, {
      availableWhenDisabled: true
    }),
    [C.CORE_MAINTENANCE]: capability(C.CORE_MAINTENANCE, "safe", T.CORE, {
      availableWhenDisabled: true
    }),
    [C.NAVIGATION_GUARD]: capability(C.NAVIGATION_GUARD, "safe", T.AUTOMATIC),
    [C.NAVIGATION_REVERSE_POPUNDER]: capability(
      C.NAVIGATION_REVERSE_POPUNDER,
      "safe",
      T.AUTOMATIC
    ),
    [C.NAVIGATION_INTENT]: capability(C.NAVIGATION_INTENT, "safe", T.PASSIVE),
    [C.NAVIGATION_FEEDBACK]: capability(C.NAVIGATION_FEEDBACK, "safe", T.USER),
    [C.DOM_STATIC_RULES]: capability(C.DOM_STATIC_RULES, "safe", T.AUTOMATIC),
    [C.DOM_OBSERVE]: capability(C.DOM_OBSERVE, "assist", T.PASSIVE),
    [C.DOM_SUGGEST]: capability(C.DOM_SUGGEST, "assist", T.SUGGESTION),
    [C.DOM_AUTO_HIDE]: capability(C.DOM_AUTO_HIDE, "auto", T.AUTOMATIC),
    [C.DOM_MANUAL_PICKER]: capability(C.DOM_MANUAL_PICKER, "safe", T.USER),
    [C.LEARNING_SEED]: capability(C.LEARNING_SEED, "safe", T.STORAGE),
    [C.LEARNING_FEEDBACK]: capability(C.LEARNING_FEEDBACK, "safe", T.USER),
    [C.LEARNING_APPLY]: capability(C.LEARNING_APPLY, "auto", T.AUTOMATIC),
    [C.TELEMETRY_QUEUE]: capability(C.TELEMETRY_QUEUE, "safe", T.STORAGE),
    [C.MEDIA_OBSERVE]: capability(C.MEDIA_OBSERVE, "assist", T.PASSIVE),
    [C.MEDIA_CATALOG]: capability(C.MEDIA_CATALOG, "assist", T.PASSIVE),
    [C.MEDIA_DOWNLOAD]: capability(C.MEDIA_DOWNLOAD, "assist", T.USER, {
      browserPermissions: ["storage", "tabs"]
    }),
    [C.VIDEO_OBSERVE]: capability(C.VIDEO_OBSERVE, "assist", T.PASSIVE),
    [C.VIDEO_RESTORE_STATE]: capability(C.VIDEO_RESTORE_STATE, "safe", T.CORE, {
      availableWhenDisabled: true
    }),
    [C.VIDEO_USER_ACTION]: capability(C.VIDEO_USER_ACTION, "assist", T.USER),
    [C.VIDEO_AUTO_ACTION]: capability(C.VIDEO_AUTO_ACTION, "auto", T.AUTOMATIC)
  });
  var FEATURE_CATALOG = Object.freeze([
    feature("background.message-router", "background", C.CORE_MESSAGING, [
      C.CORE_MAINTENANCE,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE,
      C.MEDIA_CATALOG,
      C.MEDIA_DOWNLOAD
    ]),
    feature("background.media-catalog", "background", C.MEDIA_CATALOG),
    feature("background.media-download-jobs", "background", C.MEDIA_DOWNLOAD),
    feature("background.navigation-guard", "background", C.NAVIGATION_GUARD, [
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("background.telemetry-flush", "background", C.TELEMETRY_QUEUE),
    feature("background.memory-cleanup", "background", C.CORE_MAINTENANCE),
    feature("background.pattern-seed", "background", C.LEARNING_SEED),
    feature(
      "background.training-store-migration",
      "background",
      C.CORE_MAINTENANCE
    ),
    feature("background.settings-package-seed", "background", C.CORE_MAINTENANCE),
    feature("content.media-observer", "content", C.MEDIA_OBSERVE, [
      C.MEDIA_CATALOG
    ]),
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
    feature("media-frame.observer", "media-frame", C.MEDIA_OBSERVE, [
      C.MEDIA_CATALOG
    ]),
    feature("video.surgeon", "video", C.VIDEO_OBSERVE, [
      C.VIDEO_RESTORE_STATE,
      C.VIDEO_USER_ACTION,
      C.VIDEO_AUTO_ACTION
    ]),
    feature("picker.controller", "picker", C.DOM_MANUAL_PICKER, [
      C.LEARNING_FEEDBACK
    ]),
    feature("main-world.network-capture", "main-world", C.MEDIA_OBSERVE),
    feature("main-world.timer-control", "main-world", C.VIDEO_AUTO_ACTION)
  ]);
  var CAPABILITY_SET = new Set(Object.values(CAPABILITIES));
  var FEATURE_BY_ID = new Map(FEATURE_CATALOG.map((item) => [item.id, item]));
  validateCatalog();
  var MODE_CAPABILITIES = Object.freeze(
    Object.fromEntries(
      Object.values(PROTECTION_MODES).map((mode) => [
        mode,
        Object.freeze(resolveCapabilitiesForMode(mode))
      ])
    )
  );
  function assertRegisteredCapability(capabilityId) {
    if (!CAPABILITY_SET.has(capabilityId) || !CAPABILITY_CATALOG[capabilityId]) {
      throw new Error(
        `[FeatureRegistry] Unknown capability "${capabilityId}". Register it in feature-catalog.js before use.`
      );
    }
    return capabilityId;
  }
  function getCapabilitiesForMode(mode) {
    assertProtectionMode(mode);
    return MODE_CAPABILITIES[mode];
  }
  function capability(id, minMode, trigger, { availableWhenDisabled = false, browserPermissions = [] } = {}) {
    return Object.freeze({
      id,
      minMode,
      trigger,
      availableWhenDisabled,
      browserPermissions: Object.freeze([...browserPermissions])
    });
  }
  function feature(id, context, startCapability, extraCapabilities = []) {
    return Object.freeze({
      id,
      context,
      startCapability,
      capabilities: Object.freeze([startCapability, ...extraCapabilities])
    });
  }
  function resolveCapabilitiesForMode(mode) {
    assertProtectionMode(mode);
    return Object.values(CAPABILITY_CATALOG).filter((definition) => MODE_RANK[mode] >= MODE_RANK[definition.minMode]).map((definition) => definition.id);
  }
  function assertProtectionMode(mode) {
    if (!(mode in MODE_RANK)) {
      throw new Error(`[FeatureRegistry] Unknown protection mode "${mode}".`);
    }
  }
  function validateCatalog() {
    const capabilityIds = Object.values(CAPABILITIES);
    if (new Set(capabilityIds).size !== capabilityIds.length) {
      throw new Error("[FeatureRegistry] Duplicate capability ID.");
    }
    for (const capabilityId of capabilityIds) {
      const definition = CAPABILITY_CATALOG[capabilityId];
      if (!definition || definition.id !== capabilityId) {
        throw new Error(
          `[FeatureRegistry] Capability "${capabilityId}" has no metadata definition.`
        );
      }
      assertProtectionMode(definition.minMode);
      if (!Object.values(CAPABILITY_TRIGGERS).includes(definition.trigger)) {
        throw new Error(
          `[FeatureRegistry] Capability "${capabilityId}" has unknown trigger "${definition.trigger}".`
        );
      }
    }
    const ids = /* @__PURE__ */ new Set();
    for (const definition of FEATURE_CATALOG) {
      if (ids.has(definition.id)) {
        throw new Error(
          `[FeatureRegistry] Duplicate feature "${definition.id}".`
        );
      }
      ids.add(definition.id);
      if (new Set(definition.capabilities).size !== definition.capabilities.length) {
        throw new Error(
          `[FeatureRegistry] Feature "${definition.id}" declares a capability more than once.`
        );
      }
      for (const capabilityId of definition.capabilities) {
        assertRegisteredCapability(capabilityId);
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
    const settings2 = migrateLegacySettings(stored);
    if (!stored[SETTINGS_KEY]) await storage.set({ [SETTINGS_KEY]: settings2 });
    return settings2;
  }
  async function saveSettings(nextSettings, storage = chrome.storage.local) {
    const settings2 = normalizeSettings(nextSettings);
    const updates = {
      [SETTINGS_KEY]: settings2,
      isEnabled: settings2.enabled,
      friendlyMode: settings2.protectionMode === PROTECTION_MODES.SAFE
    };
    await storage.set(updates);
    const saved = await storage.get(Object.keys(updates));
    for (const [key, expected] of Object.entries(updates)) {
      if (JSON.stringify(saved[key]) !== JSON.stringify(expected))
        throw new Error(`Could not verify saved setting: ${key}.`);
    }
    return settings2;
  }

  // src/media/download-job-contract.js
  var DOWNLOAD_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
  function getMediaDownloadAvailability(candidate = {}) {
    if (candidate.kind !== "hls")
      return { supported: false, reason: "Only HLS is supported for now." };
    if (candidate.probeStatus !== "ready")
      return { supported: false, reason: "Manifest is not ready." };
    if (candidate.drm === "suspected" || candidate.drm === "confirmed")
      return { supported: false, reason: "DRM-protected stream." };
    if (candidate.encryptionMethods?.length)
      return { supported: false, reason: "Encrypted HLS is not supported yet." };
    if (candidate.playlistType === "media" && candidate.streamType !== "vod")
      return { supported: false, reason: "Live HLS is not supported yet." };
    if (candidate.playlistType === "master" && !candidate.variants?.length)
      return { supported: false, reason: "No quality variants found." };
    if (!["master", "media"].includes(candidate.playlistType))
      return { supported: false, reason: "Unknown HLS playlist type." };
    return { supported: true, reason: null };
  }

  // src/popup/index.js
  var blockedCountElement = document.getElementById("blocked-count");
  var statusToggle = document.getElementById("status-toggle");
  var modeSelect = document.getElementById("protection-mode-select");
  var modeDescription = document.getElementById("mode-description");
  var mediaCount = document.getElementById("media-count");
  var mediaStatus = document.getElementById("media-status");
  var mediaList = document.getElementById("media-list");
  var MODE_DESCRIPTIONS = Object.freeze({
    safe: "Verified rules; no predictive DOM actions",
    assist: "Detect and ask before hiding",
    auto: "Allow registered automatic actions"
  });
  var settings = null;
  var mediaRefreshInFlight = false;
  initialize().catch(
    (error) => console.error("[AdsFriendly Popup] initialization failed", error)
  );
  statusToggle.addEventListener("change", async () => {
    settings = await saveSettings({
      ...settings,
      enabled: statusToggle.checked
    });
    await renderMode();
    await updateMediaCatalog();
  });
  modeSelect.addEventListener("change", async () => {
    settings = await saveSettings({
      ...settings,
      protectionMode: modeSelect.value
    });
    await renderMode();
    await updateMediaCatalog();
  });
  document.getElementById("settings-btn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById("magic-wand-btn").addEventListener("click", async () => {
    if (!settings.enabled || !getCapabilitiesForMode(settings.protectionMode).includes(
      CAPABILITIES.DOM_MANUAL_PICKER
    )) {
      alert("Manual picker is disabled by the current protection policy.");
      return;
    }
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!tab) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" });
      window.close();
    } catch (error) {
      console.error("Could not start picker:", error);
    }
  });
  document.getElementById("reset-rules-btn").addEventListener("click", async () => {
    const button = document.getElementById("reset-rules-btn");
    await runRuleButtonAction(button, "Resetting\u2026", async () => {
      const tab = await getActiveHttpTab();
      if (!tab) return false;
      const hostname = new URL(tab.url).hostname;
      const { userCustomRules = {} } = await chrome.storage.local.get("userCustomRules");
      const selectors = (userCustomRules[hostname] || []).map((rule) => typeof rule === "string" ? rule : rule?.selector).filter(Boolean);
      if (!selectors.length) return false;
      const response = await chrome.runtime.sendMessage({
        type: "REMOVE_CUSTOM_RULES",
        hostname,
        selectors
      });
      if (response?.status !== "saved")
        throw new Error(response?.error || "Could not remove site rules.");
      await chrome.tabs.reload(tab.id);
      window.close();
    });
  });
  document.getElementById("undo-btn").addEventListener("click", async () => {
    const button = document.getElementById("undo-btn");
    await runRuleButtonAction(button, "Restoring\u2026", async () => {
      const tab = await getActiveHttpTab();
      if (!tab) return false;
      const hostname = new URL(tab.url).hostname;
      const { userCustomRules = {} } = await chrome.storage.local.get("userCustomRules");
      const rules = userCustomRules[hostname];
      if (!rules?.length) return false;
      const undoneRule = rules.at(-1);
      const selector = typeof undoneRule === "string" ? undoneRule : undoneRule?.selector;
      const response = await chrome.runtime.sendMessage({
        type: "RESTORE_CUSTOM_RULES",
        hostname,
        selectors: [selector]
      });
      if (response?.status !== "saved")
        throw new Error(response?.error || "Could not restore the last rule.");
      if (undoneRule?.fingerprint) {
        await chrome.runtime.sendMessage({
          type: "NEGATIVE_LEARNING",
          fingerprint: undoneRule.fingerprint
        });
      }
      await chrome.tabs.reload(tab.id);
      window.close();
    });
  });
  async function runRuleButtonAction(button, workingText, action) {
    button.dataset.originalHtml ||= button.innerHTML;
    button.disabled = true;
    button.textContent = workingText;
    button.title = "";
    try {
      const completed = await action();
      if (completed === false) {
        button.disabled = false;
        button.innerHTML = button.dataset.originalHtml;
      }
    } catch (error) {
      button.disabled = false;
      button.textContent = "Failed \xB7 Retry";
      button.title = error?.message || String(error);
    }
  }
  setInterval(updateBlockedCount, 1e3);
  setInterval(updateMediaCatalog, 1500);
  async function initialize() {
    settings = await loadSettings();
    await render();
  }
  async function render() {
    statusToggle.checked = settings.enabled;
    modeSelect.value = settings.protectionMode;
    await updateBlockedCount();
    await renderMode();
    const tab = await getActiveHttpTab();
    await renderMediaCatalog(tab);
    if (!tab) return;
    const hostname = new URL(tab.url).hostname;
    const { userCustomRules = {} } = await chrome.storage.local.get("userCustomRules");
    document.getElementById("undo-section").style.display = userCustomRules[hostname]?.length > 0 ? "block" : "none";
  }
  async function renderMode() {
    modeSelect.disabled = !settings.enabled;
    modeDescription.textContent = settings.enabled ? MODE_DESCRIPTIONS[settings.protectionMode] : "All protection features are disabled";
  }
  async function updateBlockedCount() {
    const { blockedCount = 0 } = await chrome.storage.local.get("blockedCount");
    blockedCountElement.textContent = blockedCount;
  }
  async function updateMediaCatalog() {
    if (!settings || mediaRefreshInFlight) return;
    mediaRefreshInFlight = true;
    try {
      await renderMediaCatalog(await getActiveHttpTab());
    } finally {
      mediaRefreshInFlight = false;
    }
  }
  async function renderMediaCatalog(tab) {
    mediaList.replaceChildren();
    mediaList.hidden = true;
    mediaCount.textContent = "0";
    if (!settings.enabled) {
      mediaStatus.textContent = "Protection is off; media observation is paused.";
      return;
    }
    if (settings.protectionMode === "safe") {
      mediaStatus.textContent = "Switch to Assist or Auto, then reload the video page.";
      return;
    }
    if (!tab) {
      mediaStatus.textContent = "Open an HTTP video page to test detection.";
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_MEDIA_CATALOG",
        tabId: tab.id,
        pageUrl: tab.url
      });
      const items = Array.isArray(response?.items) ? response.items : [];
      mediaCount.textContent = String(items.length);
      if (!items.length) {
        mediaStatus.textContent = response?.status === "capability_disabled" ? "Media observation is still starting. Reload the page once." : "No MP4, WebM, HLS, or DASH source detected yet.";
        return;
      }
      mediaStatus.textContent = "HLS VOD download preview \xB7 max 16 connections.";
      mediaList.hidden = false;
      items.slice(0, 8).forEach((item) => mediaList.append(createMediaItem(item, tab)));
    } catch (error) {
      mediaStatus.textContent = "Could not read the media catalog.";
      console.debug("[AdsFriendly Popup] Media catalog unavailable", error);
    }
  }
  function createMediaItem(item, tab) {
    const row = document.createElement("div");
    row.className = "media-item";
    const kind = document.createElement("span");
    kind.className = "media-kind";
    kind.textContent = String(item.kind || "media").toUpperCase();
    const copy = document.createElement("div");
    copy.className = "media-copy";
    const name = document.createElement("span");
    name.className = "media-name";
    const sourceUrl = item.manifestUrl || item.sourceUrl || "";
    name.textContent = mediaDisplayName(item, sourceUrl);
    name.title = sourceUrl;
    const details = document.createElement("span");
    details.className = "media-details";
    details.textContent = mediaDetails(item);
    copy.append(name, details);
    row.append(kind, copy);
    if (item.kind === "hls") row.append(createMediaDownloadButton(item, tab));
    return row;
  }
  function createMediaDownloadButton(item, tab) {
    const availability = getMediaDownloadAvailability(item);
    const button = document.createElement("button");
    button.className = "media-download";
    button.disabled = !availability.supported;
    button.textContent = availability.supported ? "Download" : downloadUnavailableLabel(availability.reason);
    button.title = availability.reason || "Open the HLS download page.";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Opening\u2026";
      try {
        const response = await chrome.runtime.sendMessage({
          type: "CREATE_MEDIA_DOWNLOAD_JOB",
          tabId: tab.id,
          mediaId: item.id
        });
        if (response?.status !== "created")
          throw new Error(
            response?.reason || response?.error || "Could not create download job."
          );
        await chrome.tabs.create({
          url: chrome.runtime.getURL(
            `download/download.html?job=${encodeURIComponent(response.jobId)}`
          ),
          active: true
        });
        window.close();
      } catch (error) {
        button.disabled = false;
        button.textContent = "Retry";
        button.title = error?.message || String(error);
      }
    });
    return button;
  }
  function downloadUnavailableLabel(reason = "") {
    if (reason.includes("DRM")) return "DRM";
    if (reason.includes("Live")) return "Live";
    if (reason.includes("Encrypted")) return "Encrypted";
    return "Unavailable";
  }
  function mediaDetails(item) {
    if (item.kind === "blob") return "Blob only \xB7 source not resolved yet";
    if (item.kind === "direct") return "Direct video file";
    if (item.kind === "dash") return "DASH found \xB7 parser comes next";
    if (item.kind !== "hls") return "Media source found";
    if (item.probeStatus === "failed")
      return item.probeError === "fallback_fetch_blocked" ? "HLS \xB7 page/CORS blocked manifest reading" : "HLS \xB7 manifest request or parse failed";
    if (item.probeStatus === "unsupported")
      return "HLS \xB7 manifest format not supported";
    if (item.probeStatus !== "ready")
      return "HLS manifest found \xB7 reading qualities";
    const facts = [];
    if (item.playlistType === "master") {
      const qualityLabels = [...item.variants || []].sort(compareVariantQuality).map(variantLabel).filter(
        (label, index, labels) => label && labels.indexOf(label) === index
      ).slice(0, 4);
      facts.push(
        qualityLabels.length ? qualityLabels.join(" \xB7 ") : `${item.variants?.length || 0} stream variants`
      );
    } else {
      facts.push(item.streamType === "live" ? "Live stream" : "VOD stream");
      if (Number.isFinite(item.duration) && item.duration > 0)
        facts.push(formatDuration(item.duration));
      if (Number.isInteger(item.segmentCount))
        facts.push(`${item.segmentCount} segments`);
    }
    if (item.audioTracks?.length) facts.push(`${item.audioTracks.length} audio`);
    if (item.subtitles?.length) facts.push(`${item.subtitles.length} subtitles`);
    if (item.drm === "suspected") facts.push("DRM suspected");
    else if (item.encryptionMethods?.length) facts.push("Encrypted");
    return facts.filter(Boolean).join(" \xB7 ") || "HLS manifest ready";
  }
  function compareVariantQuality(left, right) {
    return (right.resolution?.height || 0) - (left.resolution?.height || 0) || (right.averageBandwidth || right.bandwidth || 0) - (left.averageBandwidth || left.bandwidth || 0);
  }
  function variantLabel(variant) {
    if (variant.resolution?.height) return `${variant.resolution.height}p`;
    const bandwidth = variant.averageBandwidth || variant.bandwidth;
    if (!Number.isFinite(bandwidth)) return null;
    return bandwidth >= 1e6 ? `${(bandwidth / 1e6).toFixed(1)} Mbps` : `${Math.round(bandwidth / 1e3)} Kbps`;
  }
  function formatDuration(seconds) {
    const rounded = Math.round(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor(rounded % 3600 / 60);
    const remainingSeconds = rounded % 60;
    if (hours)
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(
        remainingSeconds
      ).padStart(2, "0")}`;
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  function mediaDisplayName(item, sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (url.protocol === "blob:") return item.title || "Blob media stream";
      const file = url.pathname.split("/").filter(Boolean).at(-1);
      return file ? `${url.hostname} \xB7 ${file}` : url.hostname;
    } catch {
      return item.title || sourceUrl || "Unknown media";
    }
  }
  async function getActiveHttpTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url?.startsWith("http") ? tab : null;
  }
})();
