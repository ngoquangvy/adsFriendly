import { runtimeState } from "./state.js";
import {
  synthesizeGlobalPatterns,
  handleNegativeLearning,
} from "./pattern-learning.js";
import { handleLearnVideoAd, handleVideoLearning } from "./video-learning.js";
import {
  handleUserDecision,
  removeTrustedPath,
  syncTrustedPath,
} from "../navigation/background/trusted-paths.js";
import {
  getPrefilledSearchNavigation,
  PREFILLED_SEARCH_TRUST_TARGET,
} from "../navigation/shared/search-navigation.js";
import { updateSiteReputation } from "./reputation.js";
import { flushTelemetry, recordTelemetry } from "./telemetry.js";
import { CAPABILITIES } from "../runtime/feature-catalog.js";
import {
  allowUserOpenedNavigation,
  deliverPendingNavigationReview,
  showAllowedSearchNavigation,
} from "../navigation/background/guard.js";
import {
  getSettingsMutationStore,
  getStorageHealth,
} from "./settings-mutations.js";
import { addDomTrainingSample } from "../storage/training-store.js";
import {
  listDiscoveredMedia,
  listMediaPlaybackSessions,
  recordBlobSourceTrace,
  recordDiscoveredMedia,
  recordMediaProbe,
  recordMediaProbeDiagnostic,
  recordMediaEmeObservation,
  recordMediaPlaybackObservation,
  recordMediaManifestHandoff,
} from "./media-catalog.js";
import {
  listMediaDownloadJobs,
  requestMediaDownloadCancel,
  requestMediaDownloadHistoryClear,
  requestMediaDownloadJob,
  requestMediaDownloadQualityPreflight,
  requestPlayerOutputCanary,
  receivePlayerOutputCaptureChunk,
  receivePlayerOutputCaptureFailure,
  receivePlayerOutputCaptureFinish,
  requestPlayerOutputCapture,
  requestMediaDownloadHistoryRemove,
  requestMediaDownloadOpen,
  requestMediaDownloadPause,
  requestMediaDownloadResume,
  requestMediaDownloadRetry,
  requestMediaDownloadReveal,
} from "./media-download-jobs.js";
import { getMediaHelperStatus } from "./media-helper-bridge.js";
import { prepareMediaProbeReferer } from "./media-probe-context.js";
import {
  getMediaDebugCapture,
  saveMediaDebugCapture,
} from "./media-debug-capture.js";
import { saveMediaManifestHandoff } from "./media-manifest-handoff.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { chooseMediaTitle } from "../media/media-title.js";

const MESSAGE_CAPABILITIES = Object.freeze({
  TRUSTED_CLICK: CAPABILITIES.NAVIGATION_INTENT,
  SYNC_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
  NEGATIVE_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
  USER_DECISION: CAPABILITIES.NAVIGATION_FEEDBACK,
  PATH_RESTORED: CAPABILITIES.NAVIGATION_FEEDBACK,
  RESTORE_GRAY_NAVIGATION: CAPABILITIES.NAVIGATION_FEEDBACK,
  BLOCK_GRAY_NAVIGATION: CAPABILITIES.NAVIGATION_FEEDBACK,
  KEEP_REVIEWED_TAB: CAPABILITIES.NAVIGATION_FEEDBACK,
  BLOCK_REVIEWED_TAB: CAPABILITIES.NAVIGATION_FEEDBACK,
  OPEN_BLOCKED_NAVIGATION: CAPABILITIES.NAVIGATION_FEEDBACK,
  ALLOW_BLOCKED_SOURCE: CAPABILITIES.NAVIGATION_FEEDBACK,
  BLOCK_ALLOWED_SEARCH_SOURCE: CAPABILITIES.NAVIGATION_FEEDBACK,
  NAVIGATION_TOAST_READY: CAPABILITIES.NAVIGATION_FEEDBACK,
  LEARN_VIDEO_AD: CAPABILITIES.LEARNING_FEEDBACK,
  SYNC_VIDEO_LEARNING: CAPABILITIES.LEARNING_FEEDBACK,
  REPORT_AD_DENSITY: CAPABILITIES.CORE_MAINTENANCE,
  RECORD_TELEMETRY: CAPABILITIES.TELEMETRY_QUEUE,
  FLUSH_TELEMETRY: CAPABILITIES.TELEMETRY_QUEUE,
  UPSERT_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
  REMOVE_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
  RESTORE_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
  RESET_CUSTOM_RULES: CAPABILITIES.CORE_MAINTENANCE,
  UPSERT_ELEMENT_EXCEPTIONS: CAPABILITIES.CORE_MAINTENANCE,
  REMOVE_ELEMENT_EXCEPTIONS: CAPABILITIES.CORE_MAINTENANCE,
  RESET_ELEMENT_DECISIONS: CAPABILITIES.CORE_MAINTENANCE,
  SAVE_DOMAIN_DECISION: CAPABILITIES.CORE_MAINTENANCE,
  REMOVE_DOMAIN_DECISION: CAPABILITIES.CORE_MAINTENANCE,
  GET_STORAGE_HEALTH: CAPABILITIES.CORE_MAINTENANCE,
  RECORD_DOM_SAMPLE: CAPABILITIES.LEARNING_FEEDBACK,
  MEDIA_DISCOVERED: CAPABILITIES.MEDIA_CATALOG,
  MEDIA_PROBED: CAPABILITIES.MEDIA_CATALOG,
  MEDIA_PROBE_DIAGNOSTIC: CAPABILITIES.MEDIA_CATALOG,
  MEDIA_BLOB_TRACED: CAPABILITIES.MEDIA_CATALOG,
  MEDIA_EME_OBSERVED: CAPABILITIES.MEDIA_CATALOG,
  MEDIA_PLAYBACK_OBSERVED: CAPABILITIES.MEDIA_CATALOG,
  PREPARE_MEDIA_CONTEXTUAL_PROBE: CAPABILITIES.MEDIA_CATALOG,
  GET_MEDIA_CATALOG: CAPABILITIES.MEDIA_CATALOG,
  GET_MEDIA_SESSIONS: CAPABILITIES.MEDIA_CATALOG,
  SAVE_MEDIA_DEBUG_MANIFEST: CAPABILITIES.MEDIA_CATALOG,
  GET_MEDIA_DEBUG_MANIFEST: CAPABILITIES.MEDIA_CATALOG,
  SAVE_DECRYPTED_MEDIA_MANIFEST: CAPABILITIES.MEDIA_CATALOG,
  GET_MEDIA_HELPER_STATUS: CAPABILITIES.MEDIA_DOWNLOAD,
  PREFLIGHT_MEDIA_DOWNLOAD_QUALITIES: CAPABILITIES.MEDIA_DOWNLOAD,
  VALIDATE_PLAYER_OUTPUT_CANARY: CAPABILITIES.MEDIA_DOWNLOAD,
  START_PLAYER_OUTPUT_CAPTURE: CAPABILITIES.MEDIA_DOWNLOAD,
  PLAYER_OUTPUT_CAPTURE_CHUNK: CAPABILITIES.MEDIA_DOWNLOAD,
  PLAYER_OUTPUT_CAPTURE_FINISH: CAPABILITIES.MEDIA_DOWNLOAD,
  PLAYER_OUTPUT_CAPTURE_FAILED: CAPABILITIES.MEDIA_DOWNLOAD,
  CREATE_MEDIA_DOWNLOAD_JOB: CAPABILITIES.MEDIA_DOWNLOAD,
  CANCEL_MEDIA_DOWNLOAD_JOB: CAPABILITIES.MEDIA_DOWNLOAD,
  PAUSE_MEDIA_DOWNLOAD_JOB: CAPABILITIES.MEDIA_DOWNLOAD,
  OPEN_MEDIA_DOWNLOAD_OUTPUT: CAPABILITIES.MEDIA_DOWNLOAD,
  REVEAL_MEDIA_DOWNLOAD_OUTPUT: CAPABILITIES.MEDIA_DOWNLOAD,
  REMOVE_MEDIA_DOWNLOAD_HISTORY: CAPABILITIES.MEDIA_DOWNLOAD,
  CLEAR_MEDIA_DOWNLOAD_HISTORY: CAPABILITIES.MEDIA_DOWNLOAD,
  RESUME_MEDIA_DOWNLOAD_JOB: CAPABILITIES.MEDIA_DOWNLOAD,
  RETRY_MEDIA_DOWNLOAD_JOB: CAPABILITIES.MEDIA_DOWNLOAD,
  GET_MEDIA_DOWNLOAD_JOBS: CAPABILITIES.MEDIA_DOWNLOAD,
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
      sourceUrl: message.sourceUrl || sender?.tab?.url || null,
      intentKind: message.intentKind || "navigation",
      intentReasons: Array.isArray(message.intentReasons)
        ? message.intentReasons
        : [],
      tabId: sender?.tab?.id || null,
    };
    return;
  }
  if (message.type === "NAVIGATION_TOAST_READY") {
    if (!sender?.tab?.id) return { status: "ignored" };
    const delivered = await deliverPendingNavigationReview(sender.tab.id);
    return { status: delivered ? "delivered" : "ready" };
  }
  if (message.type === "SYNC_LEARNING") return synthesizeGlobalPatterns();
  if (message.type === "UPSERT_CUSTOM_RULES")
    return getSettingsMutationStore().upsertCustomRules(
      message.hostname,
      message.rules,
    );
  if (message.type === "REMOVE_CUSTOM_RULES")
    return getSettingsMutationStore().removeCustomRules(
      message.hostname,
      message.selectors,
    );
  if (message.type === "RESTORE_CUSTOM_RULES")
    return getSettingsMutationStore().restoreCustomRules(
      message.hostname,
      message.selectors,
    );
  if (message.type === "RESET_CUSTOM_RULES")
    return getSettingsMutationStore().resetCustomRules(message.hostname);
  if (message.type === "UPSERT_ELEMENT_EXCEPTIONS")
    return getSettingsMutationStore().upsertElementExceptions(
      message.hostname,
      message.rules,
    );
  if (message.type === "REMOVE_ELEMENT_EXCEPTIONS")
    return getSettingsMutationStore().removeElementExceptions(
      message.hostname,
      message.ids,
    );
  if (message.type === "RESET_ELEMENT_DECISIONS")
    return getSettingsMutationStore().resetElementDecisions(message.hostname);
  if (message.type === "SAVE_DOMAIN_DECISION")
    return getSettingsMutationStore().saveDomainDecision(
      message.action,
      message.domain,
    );
  if (message.type === "REMOVE_DOMAIN_DECISION")
    return getSettingsMutationStore().removeDomainDecision(
      message.listName,
      message.domain,
    );
  if (message.type === "GET_STORAGE_HEALTH") return getStorageHealth();
  if (message.type === "RECORD_DOM_SAMPLE") {
    await addDomTrainingSample(message.sample);
    return { status: "saved" };
  }
  if (message.type === "MEDIA_DISCOVERED") {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return { status: "ignored" };
    return recordDiscoveredMedia(tabId, {
      ...message.event,
      payload: {
        ...message.event?.payload,
        pageUrl: sender.tab.url || message.event?.payload?.pageUrl,
        title: chooseMediaTitle(
          message.event?.payload?.title,
          sender.tab.title,
          sender.tab.url,
        ),
      },
      metadata: {
        ...message.event?.metadata,
        frameId: sender.frameId ?? null,
        frameUrl: message.event?.payload?.pageUrl || null,
      },
    });
  }
  if (message.type === "MEDIA_PROBED") {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return { status: "ignored" };
    return recordMediaProbe(tabId, {
      ...message.event,
      payload: {
        ...message.event?.payload,
        pageUrl: sender.tab.url || message.event?.payload?.pageUrl,
      },
      metadata: {
        ...message.event?.metadata,
        frameId: sender.frameId ?? null,
        frameUrl: message.event?.payload?.pageUrl || null,
      },
    });
  }
  if (message.type === "MEDIA_PROBE_DIAGNOSTIC") {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return { status: "ignored" };
    return recordMediaProbeDiagnostic(tabId, {
      ...message.event,
      payload: {
        ...message.event?.payload,
        pageUrl: sender.tab.url || message.event?.payload?.pageUrl,
      },
      metadata: {
        ...message.event?.metadata,
        frameId: sender.frameId ?? null,
        frameUrl: message.event?.payload?.pageUrl || null,
      },
    });
  }
  if (message.type === "MEDIA_BLOB_TRACED") {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return { status: "ignored" };
    return recordBlobSourceTrace(tabId, {
      ...message.event,
      payload: {
        ...message.event?.payload,
        pageUrl: sender.tab.url || message.event?.payload?.pageUrl,
      },
      metadata: {
        ...message.event?.metadata,
        frameId: sender.frameId ?? null,
        frameUrl: message.event?.payload?.pageUrl || null,
      },
    });
  }
  if (message.type === "MEDIA_EME_OBSERVED") {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return { status: "ignored" };
    return recordMediaEmeObservation(tabId, {
      ...message.event,
      payload: {
        ...message.event?.payload,
        pageUrl: sender.tab.url || message.event?.payload?.pageUrl,
      },
      metadata: {
        ...message.event?.metadata,
        frameId: sender.frameId ?? null,
        frameUrl: message.event?.payload?.pageUrl || null,
      },
    });
  }
  if (message.type === "MEDIA_PLAYBACK_OBSERVED") {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return { status: "ignored" };
    return recordMediaPlaybackObservation(tabId, {
      ...message.event,
      payload: {
        ...message.event?.payload,
        pageUrl: sender.tab.url || message.event?.payload?.pageUrl,
      },
      metadata: {
        ...message.event?.metadata,
        frameId: sender.frameId ?? null,
        frameUrl: message.event?.payload?.pageUrl || null,
      },
    });
  }
  if (message.type === "PREPARE_MEDIA_CONTEXTUAL_PROBE") {
    const tabId = sender?.tab?.id;
    const frameId = sender?.frameId;
    if (!Number.isInteger(tabId) || !Number.isInteger(frameId))
      return { status: "ignored" };
    if (!sameOrigin(message.parentDocumentUrl, sender.tab.url))
      return { status: "invalid_parent" };
    const snapshot = await listDiscoveredMedia(tabId);
    const candidate = snapshot.items.find(
      (item) =>
        item.id === message.mediaId &&
        item.manifestUrl === message.manifestUrl &&
        item.frameId === frameId,
    );
    if (!candidate) return { status: "unknown_media" };
    if (
      candidate.frameUrl &&
      !sameOrigin(message.frameDocumentUrl, candidate.frameUrl)
    )
      return { status: "invalid_frame" };
    return prepareMediaProbeReferer({
      tabId,
      manifestUrl: candidate.manifestUrl,
      parentDocumentUrl: message.parentDocumentUrl,
      frameDocumentUrl: candidate.frameUrl || message.frameDocumentUrl,
    });
  }
  if (message.type === "GET_MEDIA_CATALOG") {
    if (!Number.isInteger(message.tabId)) return { status: "invalid_tab" };
    return listDiscoveredMedia(message.tabId, message.pageUrl || null);
  }
  if (message.type === "GET_MEDIA_SESSIONS") {
    if (!Number.isInteger(message.tabId)) return { status: "invalid_tab" };
    return listMediaPlaybackSessions(message.tabId, message.pageUrl || null);
  }
  if (message.type === "SAVE_MEDIA_DEBUG_MANIFEST") {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return { status: "ignored" };
    return saveMediaDebugCapture(tabId, message.capture);
  }
  if (message.type === "GET_MEDIA_DEBUG_MANIFEST") {
    if (!isExtensionPageSender(sender)) return { status: "forbidden" };
    if (!Number.isInteger(message.tabId)) return { status: "invalid_tab" };
    return getMediaDebugCapture(message.tabId, message.mediaId);
  }
  if (message.type === "SAVE_DECRYPTED_MEDIA_MANIFEST") {
    const tabId = sender?.tab?.id;
    const frameId = sender?.frameId;
    if (!Number.isInteger(tabId) || !Number.isInteger(frameId))
      return { status: "ignored" };
    const snapshot = await listDiscoveredMedia(tabId);
    const candidate = snapshot.items.find(
      (item) =>
        item.id === message.handoff?.mediaId &&
        item.manifestUrl === message.handoff?.manifestUrl &&
        item.kind === message.handoff?.kind &&
        item.probeSource === "decrypted_blob" &&
        item.frameId === frameId,
    );
    if (!candidate) return { status: "catalog_pending" };
    const saved = await saveMediaManifestHandoff(tabId, message.handoff);
    const recorded = await recordMediaManifestHandoff(
      tabId,
      createRegisteredEvent(EVENTS.MEDIA_MANIFEST_HANDOFF_READY, {
        ...saved.handoff,
        pageUrl: candidate.pageUrl,
      }),
    );
    return recorded.status === "recorded"
      ? { status: "saved", handoff: saved.handoff }
      : recorded;
  }
  if (message.type === "GET_MEDIA_HELPER_STATUS") {
    return getMediaHelperStatus({ force: message.force === true });
  }
  if (message.type === "CREATE_MEDIA_DOWNLOAD_JOB")
    return requestMediaDownloadJob({
      tabId: message.tabId,
      mediaId: message.mediaId,
      connections: message.connections,
      output: message.output,
    });
  if (message.type === "PREFLIGHT_MEDIA_DOWNLOAD_QUALITIES")
    return requestMediaDownloadQualityPreflight({
      tabId: message.tabId,
      mediaId: message.mediaId,
    });
  if (message.type === "VALIDATE_PLAYER_OUTPUT_CANARY")
    return requestPlayerOutputCanary({
      tabId: message.tabId,
      mediaId: message.mediaId,
    });
  if (message.type === "START_PLAYER_OUTPUT_CAPTURE")
    return requestPlayerOutputCapture({
      tabId: message.tabId,
      mediaId: message.mediaId,
    });
  if (message.type === "PLAYER_OUTPUT_CAPTURE_CHUNK")
    return receivePlayerOutputCaptureChunk(message, sender);
  if (message.type === "PLAYER_OUTPUT_CAPTURE_FINISH")
    return receivePlayerOutputCaptureFinish(message, sender);
  if (message.type === "PLAYER_OUTPUT_CAPTURE_FAILED")
    return receivePlayerOutputCaptureFailure(message, sender);
  if (message.type === "CANCEL_MEDIA_DOWNLOAD_JOB")
    return requestMediaDownloadCancel({ jobId: message.jobId });
  if (message.type === "PAUSE_MEDIA_DOWNLOAD_JOB")
    return requestMediaDownloadPause({ jobId: message.jobId });
  if (message.type === "RESUME_MEDIA_DOWNLOAD_JOB")
    return requestMediaDownloadResume({
      jobId: message.jobId,
      connections: message.connections,
    });
  if (message.type === "RETRY_MEDIA_DOWNLOAD_JOB")
    return requestMediaDownloadRetry({
      jobId: message.jobId,
      connections: message.connections,
    });
  if (message.type === "OPEN_MEDIA_DOWNLOAD_OUTPUT")
    return requestMediaDownloadOpen({ jobId: message.jobId });
  if (message.type === "REVEAL_MEDIA_DOWNLOAD_OUTPUT")
    return requestMediaDownloadReveal({ jobId: message.jobId });
  if (message.type === "REMOVE_MEDIA_DOWNLOAD_HISTORY")
    return requestMediaDownloadHistoryRemove({ jobId: message.jobId });
  if (message.type === "CLEAR_MEDIA_DOWNLOAD_HISTORY")
    return requestMediaDownloadHistoryClear();
  if (message.type === "GET_MEDIA_DOWNLOAD_JOBS")
    return listMediaDownloadJobs();
  if (message.type === "NEGATIVE_LEARNING")
    return handleNegativeLearning(message.fingerprint);
  if (message.type === "USER_DECISION") return handleUserDecision(message);
  if (message.type === "PATH_RESTORED")
    return syncTrustedPath(message.source, message.target, true);
  if (message.type === "RESTORE_GRAY_NAVIGATION") {
    await syncTrustedPath(message.source, message.target, true);
    await recordTelemetryBestEffort({
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
    await handleUserDecision({
      action: "BLACKLIST",
      domain: message.target,
      url: message.url,
      source: message.source,
    });
    await recordTelemetryBestEffort({
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
    return { status: "saved" };
  }
  if (message.type === "KEEP_REVIEWED_TAB") {
    await syncTrustedPath(message.source, message.target, true);
    await recordTelemetryBestEffort({
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
        surface: "navigation_toast",
      },
      feedback: {
        user_action: "keep",
        correction: "false_positive",
        surface: "navigation_toast",
      },
    });
    return { status: "saved" };
  }
  if (message.type === "BLOCK_REVIEWED_TAB") {
    await handleUserDecision({
      action: "BLACKLIST",
      domain: message.target,
      url: message.url,
      source: message.source,
    });
    await recordTelemetryBestEffort({
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
        surface: "navigation_toast",
      },
      feedback: {
        user_action: "block",
        surface: "navigation_toast",
      },
    });
    if (Number.isInteger(message.tabId)) {
      try {
        await chrome.tabs.remove(message.tabId);
      } catch {}
    }
    return { status: "saved" };
  }
  if (message.type === "OPEN_BLOCKED_NAVIGATION") {
    let targetUrl;
    try {
      targetUrl = new URL(message.url);
    } catch {
      return { status: "invalid_url" };
    }
    if (!/^https?:$/.test(targetUrl.protocol)) return { status: "invalid_url" };
    allowUserOpenedNavigation(targetUrl.href);
    await chrome.tabs.create(tabCreateProperties(targetUrl.href, sender));
    return { status: "opened" };
  }
  if (message.type === "ALLOW_BLOCKED_SOURCE") {
    const source = senderSourceHostname(sender);
    const search = getPrefilledSearchNavigation(message.url);
    if (!source || !search) return { status: "invalid_navigation" };
    await syncTrustedPath(source, PREFILLED_SEARCH_TRUST_TARGET, true);
    allowUserOpenedNavigation(message.url);
    const tab = await chrome.tabs.create(
      tabCreateProperties(message.url, sender),
    );
    await showAllowedSearchNavigation({
      tabId: tab.id,
      url: message.url,
      source,
      target: PREFILLED_SEARCH_TRUST_TARGET,
    });
    return { status: "allowed" };
  }
  if (message.type === "BLOCK_ALLOWED_SEARCH_SOURCE") {
    const source = String(message.source || "").toLowerCase();
    const search = getPrefilledSearchNavigation(sender?.tab?.url);
    if (!source || !search) return { status: "invalid_navigation" };
    await removeTrustedPath(source, PREFILLED_SEARCH_TRUST_TARGET);
    return { status: "saved" };
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

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function isExtensionPageSender(sender) {
  const baseUrl = chrome.runtime.getURL("");
  return (
    sender?.id === chrome.runtime.id &&
    typeof sender.url === "string" &&
    sender.url.startsWith(baseUrl)
  );
}

function senderSourceHostname(sender) {
  try {
    return new URL(sender?.tab?.url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function tabCreateProperties(url, sender) {
  const properties = { url, active: true };
  if (Number.isInteger(sender?.tab?.id)) {
    properties.openerTabId = sender.tab.id;
  }
  return properties;
}

async function recordTelemetryBestEffort(event) {
  try {
    return await recordTelemetry(event);
  } catch (error) {
    console.warn("[AdsFriendly] Telemetry skipped:", error.message);
    return { status: "skipped", error: error.message };
  }
}
