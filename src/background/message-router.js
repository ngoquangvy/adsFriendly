import { runtimeState } from "./state.js";
import {
  synthesizeGlobalPatterns,
  handleNegativeLearning,
} from "./pattern-learning.js";
import { handleLearnVideoAd, handleVideoLearning } from "./video-learning.js";
import {
  handleUserDecision,
  syncTrustedPath,
} from "../navigation/background/trusted-paths.js";
import { updateSiteReputation } from "./reputation.js";
import { flushTelemetry, recordTelemetry } from "./telemetry.js";
import { CAPABILITIES } from "../runtime/feature-catalog.js";

const MESSAGE_CAPABILITIES = Object.freeze({
  TRUSTED_CLICK: CAPABILITIES.NAVIGATION_INTENT,
  SYNC_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
  NEGATIVE_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
  USER_DECISION: CAPABILITIES.NAVIGATION_FEEDBACK,
  PATH_RESTORED: CAPABILITIES.NAVIGATION_FEEDBACK,
  RESTORE_GRAY_NAVIGATION: CAPABILITIES.NAVIGATION_FEEDBACK,
  BLOCK_GRAY_NAVIGATION: CAPABILITIES.NAVIGATION_FEEDBACK,
  LEARN_VIDEO_AD: CAPABILITIES.LEARNING_FEEDBACK,
  SYNC_VIDEO_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
  REPORT_AD_DENSITY: CAPABILITIES.CORE_MAINTENANCE,
  RECORD_TELEMETRY: CAPABILITIES.TELEMETRY_QUEUE,
  FLUSH_TELEMETRY: CAPABILITIES.TELEMETRY_QUEUE,
});

export function registerMessageRouter(policy) {
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
    route(message, sender)
      .then((r) => sendResponse(r || { status: "ok" }))
      .catch((err) => sendResponse({ status: "error", error: err.message }));
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
      tabId: sender?.tab?.id || null,
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
        surface: "navigation_toast",
      },
      feedback: {
        user_action: "restore",
        correction: "false_positive",
        surface: "navigation_toast",
      },
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
        surface: "navigation_toast",
      },
      feedback: {
        user_action: "block",
        surface: "navigation_toast",
      },
    });
    return handleUserDecision({ action: "BLACKLIST", domain: message.target });
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
