import { ACTIONS } from "../runtime/action-catalog.js";
import { createActionBroker } from "../runtime/action-broker.js";
import {
  loadSettings,
  normalizeMediaDownloadConnections,
} from "../runtime/settings-store.js";
import {
  DOWNLOAD_JOB_MAX_AGE_MS,
  DOWNLOAD_JOB_PREFIX,
  downloadJobKey,
  getMediaDownloadAvailability,
  normalizeMediaDownloadJob,
} from "../media/download-job-contract.js";
import { listDiscoveredMedia } from "./media-catalog.js";
import {
  cancelMediaHelperDownload,
  clearMediaHelperDownloadHistory,
  getMediaHelperStatus,
  listMediaHelperDownloads,
  removeMediaHelperDownloadHistory,
  runMediaHelperOutputAction,
  startMediaHelperDownload,
  preflightMediaHelperYouTubeQualities,
  validateMediaHelperPlayerOutputCanary,
  appendMediaHelperPlayerOutputChunk,
  failMediaHelperPlayerOutputCapture,
  finishMediaHelperPlayerOutputCapture,
  startMediaHelperPlayerOutputCapture,
} from "./media-helper-bridge.js";
import { getMediaManifestHandoff } from "./media-manifest-handoff.js";
import { normalizeMediaDownloadOutput } from "../media/download-options.js";
import { hasYouTubeProviderPendingTracks } from "../media/adaptive-track-policy.js";
import { selectVisibleMediaItems } from "../media/catalog-view.js";

let broker = null;

export async function startMediaDownloadJobStore(policy) {
  await removeStaleJobs();
  broker = createActionBroker({
    featureId: "background.media-download-jobs",
    policy,
    handlers: {
      [ACTIONS.MEDIA_DOWNLOAD_CANCEL]: cancelJob,
      [ACTIONS.MEDIA_DOWNLOAD_CLEAR_HISTORY]: clearJobHistory,
      [ACTIONS.MEDIA_DOWNLOAD_CREATE]: createJob,
      [ACTIONS.MEDIA_DOWNLOAD_PREFLIGHT]: preflightJob,
      [ACTIONS.MEDIA_OUTPUT_CANARY]: validatePlayerOutput,
      [ACTIONS.MEDIA_OUTPUT_CAPTURE_START]: startPlayerOutputCapture,
      [ACTIONS.MEDIA_DOWNLOAD_PAUSE]: pauseJob,
      [ACTIONS.MEDIA_DOWNLOAD_OPEN]: openJobOutput,
      [ACTIONS.MEDIA_DOWNLOAD_REMOVE_HISTORY]: removeJobHistory,
      [ACTIONS.MEDIA_DOWNLOAD_REVEAL]: revealJobOutput,
      [ACTIONS.MEDIA_DOWNLOAD_RESUME]: resumeJob,
      [ACTIONS.MEDIA_DOWNLOAD_RETRY]: retryJob,
    },
  });
  return () => {
    broker = null;
  };
}

export async function requestMediaDownloadJob(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_DOWNLOAD_CREATE, payload);
}

export async function requestMediaDownloadQualityPreflight(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_DOWNLOAD_PREFLIGHT, payload);
}

export async function requestPlayerOutputCanary(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_OUTPUT_CANARY, payload);
}

export async function requestPlayerOutputCapture(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_OUTPUT_CAPTURE_START, payload);
}

export async function receivePlayerOutputCaptureChunk(payload, sender = {}) {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;
  if (!Number.isInteger(tabId)) return { status: "invalid_tab" };
  return appendMediaHelperPlayerOutputChunk(
    payload.captureId,
    {
      trackId: payload.trackId,
      sequence: payload.sequence,
      mimeType: payload.mimeType,
      appendFormat: payload.appendFormat,
      processedSeconds: payload.processedSeconds,
      duration: payload.duration,
      data: payload.data,
    },
    tabId,
    frameId,
  );
}

export async function receivePlayerOutputCaptureFinish(payload, sender = {}) {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;
  if (!Number.isInteger(tabId)) return { status: "invalid_tab" };
  return finishMediaHelperPlayerOutputCapture(
    payload.captureId,
    tabId,
    frameId,
  );
}

export async function receivePlayerOutputCaptureFailure(payload, sender = {}) {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;
  if (!Number.isInteger(tabId)) return { status: "invalid_tab" };
  return failMediaHelperPlayerOutputCapture(
    payload.captureId,
    typeof payload.error === "string" ? payload.error.slice(0, 1000) : null,
    tabId,
    frameId,
  );
}

export async function requestMediaDownloadCancel(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_DOWNLOAD_CANCEL, payload);
}

export async function requestMediaDownloadPause(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_DOWNLOAD_PAUSE, payload);
}

export async function requestMediaDownloadResume(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_DOWNLOAD_RESUME, payload);
}

export async function requestMediaDownloadRetry(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_DOWNLOAD_RETRY, payload);
}

export async function requestMediaDownloadOpen(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_DOWNLOAD_OPEN, payload);
}

export async function requestMediaDownloadReveal(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_DOWNLOAD_REVEAL, payload);
}

export async function requestMediaDownloadHistoryRemove(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_DOWNLOAD_REMOVE_HISTORY, payload);
}

export async function requestMediaDownloadHistoryClear() {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_DOWNLOAD_CLEAR_HISTORY, {});
}

export async function listMediaDownloadJobs() {
  return { status: "ok", items: await listMediaHelperDownloads() };
}

async function validatePlayerOutput({ tabId, mediaId } = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) return { status: "invalid_tab" };
  if (typeof mediaId !== "string" || !mediaId)
    return { status: "invalid_media" };
  const catalog = await listDiscoveredMedia(tabId);
  const candidate = findDownloadCandidate(catalog.items || [], mediaId);
  if (!candidate) return { status: "media_not_found" };
  if (!isPlayerOutputCanaryEligible(candidate)) {
    return {
      status: "not_eligible",
      reason: "No custom-protected player output was detected for this item.",
    };
  }
  let frames = [{ frameId: 0 }];
  try {
    frames = (await chrome.webNavigation?.getAllFrames?.({ tabId })) || frames;
  } catch {}
  const responses = await Promise.all(
    frames.slice(0, 24).map(async ({ frameId }) => {
      try {
        return frameId === 0
          ? await chrome.tabs.sendMessage(tabId, {
              type: "GET_PLAYER_OUTPUT_CANARY",
            })
          : await chrome.tabs.sendMessage(
              tabId,
              { type: "GET_PLAYER_OUTPUT_CANARY" },
              { frameId },
            );
      } catch {
        return null;
      }
    }),
  );
  const canary = responses
    .map((response) => response?.canary)
    .filter((value) => value?.status === "ready" && value.tracks?.length)
    .sort(
      (left, right) =>
        (Number(right.capturedBytes) || 0) - (Number(left.capturedBytes) || 0),
    )[0];
  if (!canary) {
    return {
      status: "reload_required",
      reason:
        "No bounded player-output sample is available yet. Reload the page, play the video briefly, then test again.",
    };
  }
  return validateMediaHelperPlayerOutputCanary(canary);
}

async function startPlayerOutputCapture({ tabId, mediaId } = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) return { status: "invalid_tab" };
  if (typeof mediaId !== "string" || !mediaId)
    return { status: "invalid_media" };
  const catalog = await listDiscoveredMedia(tabId);
  const candidate = findDownloadCandidate(catalog.items || [], mediaId);
  if (!candidate || !isPlayerOutputCanaryEligible(candidate)) {
    return {
      status: "not_eligible",
      reason: "No validated custom player output is available.",
    };
  }
  const helper = await getMediaHelperStatus({ force: true });
  if (helper.status !== "ready" || !helper.canCapturePlayerOutput) {
    return {
      status: "helper_update",
      reason: "Media Helper 0.24.0 or newer is required for player capture.",
    };
  }
  let frames = [{ frameId: 0 }];
  try {
    frames = (await chrome.webNavigation?.getAllFrames?.({ tabId })) || frames;
  } catch {}
  const preferredFrameId = Number.isInteger(candidate.frameId)
    ? candidate.frameId
    : null;
  const frameIds = [...new Set(frames.map((frame) => frame.frameId))].sort(
    (left, right) =>
      Number(right === preferredFrameId) - Number(left === preferredFrameId),
  );
  let sourceFrameId = null;
  for (const frameId of frameIds.slice(0, 24)) {
    try {
      const response =
        frameId === 0
          ? await chrome.tabs.sendMessage(tabId, {
              type: "GET_PLAYER_OUTPUT_CANARY",
            })
          : await chrome.tabs.sendMessage(
              tabId,
              { type: "GET_PLAYER_OUTPUT_CANARY" },
              { frameId },
            );
      if (
        response?.canary?.status === "ready" &&
        response.canary.tracks?.length
      ) {
        sourceFrameId = frameId;
        break;
      }
    } catch {}
  }
  if (!Number.isInteger(sourceFrameId)) {
    return {
      status: "reload_required",
      reason:
        "No continuous player-output start buffer is available. Reload the page and play briefly before capture.",
    };
  }
  const jobId = randomId();
  const stream = candidate.resolvedStream || candidate;
  const title = candidate.title || stream.title || "Player output video";
  await startMediaHelperPlayerOutputCapture({
    jobId,
    mediaId: candidate.id,
    title,
    duration: stream.duration,
    sourceTabId: tabId,
    sourceFrameId,
  });
  let result = null;
  try {
    result =
      sourceFrameId === 0
        ? await chrome.tabs.sendMessage(tabId, {
            type: "START_PLAYER_OUTPUT_CAPTURE",
            captureId: jobId,
          })
        : await chrome.tabs.sendMessage(
            tabId,
            { type: "START_PLAYER_OUTPUT_CAPTURE", captureId: jobId },
            { frameId: sourceFrameId },
          );
  } catch {}
  if (result?.status !== "started") {
    await failMediaHelperPlayerOutputCapture(
      jobId,
      result?.reason ||
        "Player output capture could not start in the media frame.",
      tabId,
      sourceFrameId,
    );
    return (
      result || {
        status: "capture_unavailable",
        reason: "The player frame did not expose a continuous start buffer.",
      }
    );
  }
  return { ...result, jobId, status: "started" };
}

function isPlayerOutputCanaryEligible(candidate) {
  if (candidate?.kind !== "blob") return false;
  if (!candidate.blobTrace?.appendFormats?.length) return false;
  const stream = candidate.resolvedStream || candidate;
  if (candidate.eme?.confirmed === true || stream.drm === "confirmed")
    return false;
  return (stream.encryptionKeyFormats || []).some((format) => {
    const value = String(format || "").toLowerCase();
    return (
      value &&
      value !== "identity" &&
      !value.includes("widevine") &&
      !value.includes("playready") &&
      !value.includes("fairplay")
    );
  });
}

async function createJob({ tabId, mediaId, connections, output } = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) return { status: "invalid_tab" };
  if (typeof mediaId !== "string" || !mediaId)
    return { status: "invalid_media" };
  const response = await listDiscoveredMedia(tabId);
  let candidate = findDownloadCandidate(response.items, mediaId);
  if (!candidate) return { status: "media_not_found" };
  if (candidate.kind === "hls" && candidate.selectedMediaId) {
    candidate =
      response.items.find((item) => item.id === candidate.selectedMediaId) ||
      candidate;
  }
  candidate = await attachFreshYouTubeBrowserHandoff(tabId, candidate);
  const availability = getMediaDownloadAvailability(candidate);
  if (!availability.supported)
    return { status: "unsupported", reason: availability.reason };
  const normalizedOutput = normalizeMediaDownloadOutput(output, candidate);
  const qualityCheck = await normalizeYouTubeQualityCheck(
    candidate,
    normalizedOutput,
  );
  if (qualityCheck.status !== "ready") return qualityCheck;
  const checkedOutput = qualityCheck.output;
  const helperFailure = await helperFailureFor(candidate, checkedOutput);
  if (helperFailure) return helperFailure;
  const handoffResult = await attachManifestHandoff(tabId, candidate);
  if (handoffResult.status !== "ready") return handoffResult;
  candidate = handoffResult.candidate;
  candidate = await attachAesKeyHandoff(tabId, candidate);
  const job = normalizeMediaDownloadJob({
    id: randomId(),
    createdAt: Date.now(),
    sourceTabId: tabId,
    output: checkedOutput,
    candidate,
  });
  const settings = await loadSettings();
  return startMediaHelperDownload(job, {
    connections: normalizeMediaDownloadConnections(
      connections ?? settings.mediaDownloadConnections,
    ),
  });
}

async function preflightJob({ tabId, mediaId } = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) return { status: "invalid_tab" };
  if (typeof mediaId !== "string" || !mediaId)
    return { status: "invalid_media" };
  const response = await listDiscoveredMedia(tabId);
  let candidate = findDownloadCandidate(response.items, mediaId);
  if (!candidate) return { status: "media_not_found" };
  candidate = await attachFreshYouTubeBrowserHandoff(tabId, candidate);
  return preflightMediaHelperYouTubeQualities(candidate);
}

async function normalizeYouTubeQualityCheck(candidate, output) {
  if (
    candidate.kind !== "adaptive" ||
    candidate.provider !== "youtube" ||
    !hasYouTubeProviderPendingTracks(candidate)
  )
    return { status: "ready", output };
  const result = await preflightMediaHelperYouTubeQualities(candidate);
  if (result.status !== "ready") {
    return {
      status: "quality_unavailable",
      reason:
        result.reason ||
        "No compatible YouTube quality is available through the current provider profile.",
    };
  }
  if (output.profileId === "audio-ogg") {
    const selectedAudio =
      result.audioOptions?.find((item) => item.id === output.audioTrackId) ||
      result.audioOption;
    if (!selectedAudio) {
      return {
        status: "quality_unavailable",
        reason:
          "No compatible YouTube audio track is available through the current provider profile.",
      };
    }
    return {
      status: "ready",
      output: {
        ...output,
        audioTrackId: selectedAudio.id,
        allowEquivalentVideo: false,
      },
    };
  }
  if (!result.videoOptions.length) {
    return {
      status: "quality_unavailable",
      reason:
        "No downloadable YouTube video quality is available through the current provider profile.",
    };
  }
  if (!output.videoTrackId) {
    return {
      status: "ready",
      output: {
        ...output,
        audioTrackId: result.audioOptions?.some(
          (item) => item.id === output.audioTrackId,
        )
          ? output.audioTrackId
          : result.audioOption?.id || null,
        allowEquivalentVideo: true,
      },
    };
  }
  const option = result.videoOptions.find(
    (item) => item.id === output.videoTrackId,
  );
  if (!option) {
    return {
      status: "quality_unavailable",
      reason:
        "The selected YouTube quality is not available through the current provider profile.",
    };
  }
  return {
    status: "ready",
    output: {
      ...output,
      audioTrackId: result.audioOptions?.some(
        (item) => item.id === output.audioTrackId,
      )
        ? output.audioTrackId
        : result.audioOption?.id || null,
      allowEquivalentVideo: option.availability === "equivalent",
    },
  };
}

async function cancelJob({ jobId } = {}) {
  if (typeof jobId !== "string" || !jobId) return { status: "invalid_job" };
  const state = await readJob(jobId);
  if (state?.kind === "player_output") {
    try {
      await chrome.tabs.sendMessage(
        state.sourceTabId,
        { type: "STOP_PLAYER_OUTPUT_CAPTURE", captureId: jobId },
        Number.isInteger(state.sourceFrameId)
          ? { frameId: state.sourceFrameId }
          : undefined,
      );
    } catch {}
  }
  return cancelMediaHelperDownload(jobId);
}

async function pauseJob({ jobId } = {}) {
  const state = await readJob(jobId);
  if (!state) return { status: "job_not_found" };
  if (state.progress?.resumable !== true)
    return {
      status: "pause_unsupported",
      reason: "This download adapter cannot resume partial data yet.",
    };
  return cancelMediaHelperDownload(jobId, { terminalStatus: "paused" });
}

async function resumeJob(payload = {}) {
  const state = await readJob(payload.jobId);
  if (!state) return { status: "job_not_found" };
  if (state.status !== "paused")
    return { status: "not_paused", reason: "Only a paused job can resume." };
  return restartJob(state, payload.connections);
}

async function retryJob(payload = {}) {
  const state = await readJob(payload.jobId);
  if (!state) return { status: "job_not_found" };
  if (!["cancelled", "failed"].includes(state.status)) {
    return {
      status: "retry_unavailable",
      reason: "Only a cancelled or failed job can be retried.",
    };
  }
  if (state.kind === "player_output") {
    return {
      status: "reload_required",
      reason: "Reload the video page and start a new player output capture.",
    };
  }
  return restartJob(state, payload.connections);
}

async function openJobOutput({ jobId } = {}) {
  return runJobOutputAction(jobId, "open");
}

async function revealJobOutput({ jobId } = {}) {
  return runJobOutputAction(jobId, "reveal");
}

async function runJobOutputAction(jobId, action) {
  const state = await readJob(jobId);
  if (!state?.outputPath)
    return {
      status: "output_not_found",
      reason: "This job has no saved output file.",
    };
  return runMediaHelperOutputAction(action, state.outputPath);
}

async function removeJobHistory({ jobId } = {}) {
  const state = await readJob(jobId);
  if (!state) return { status: "job_not_found" };
  if (
    [
      "starting",
      "probing",
      "downloading",
      "finalizing",
      "pausing",
      "cancelling",
    ].includes(state.status)
  ) {
    return {
      status: "job_active",
      reason: "Stop the active download before removing its history.",
    };
  }
  await removeMediaHelperDownloadHistory(jobId);
  return { status: "removed", jobId };
}

async function clearJobHistory() {
  const { removedCount } = await clearMediaHelperDownloadHistory();
  return { status: "removed", removedCount };
}

async function restartJob(state, requestedConnections) {
  let candidate = (await recoverCandidate(state)) || state.candidate;
  if (!candidate) {
    return {
      status: "media_not_found",
      reason:
        "The original media source is no longer available. Reopen its video page.",
    };
  }
  candidate = await attachFreshYouTubeBrowserHandoff(
    state.sourceTabId,
    candidate,
  );
  const handoffResult = await attachManifestHandoff(
    state.sourceTabId,
    candidate,
  );
  if (handoffResult.status !== "ready") return handoffResult;
  candidate = handoffResult.candidate;
  candidate = await attachAesKeyHandoff(state.sourceTabId, candidate);
  const helperFailure = await helperFailureFor(candidate, state.output);
  if (helperFailure) return helperFailure;
  const job = normalizeMediaDownloadJob({
    id: state.id,
    createdAt: Date.now(),
    sourceTabId: state.sourceTabId,
    output: state.output,
    candidate,
  });
  const settings = await loadSettings();
  return startMediaHelperDownload(job, {
    connections: normalizeMediaDownloadConnections(
      requestedConnections ?? settings.mediaDownloadConnections,
    ),
    attempt: Math.max(1, Number(state.attempt) || 1) + 1,
  });
}

async function attachFreshYouTubeBrowserHandoff(tabId, candidate) {
  if (
    candidate?.kind !== "adaptive" ||
    candidate?.provider !== "youtube" ||
    !Number.isInteger(tabId)
  )
    return candidate;
  let frames = [{ frameId: 0 }];
  try {
    frames = (await chrome.webNavigation?.getAllFrames?.({ tabId })) || frames;
  } catch {}
  const responses = await Promise.all(
    frames.slice(0, 24).map(async ({ frameId }) => {
      try {
        return frameId === 0
          ? await chrome.tabs.sendMessage(tabId, {
              type: "GET_YOUTUBE_MEDIA_HANDOFF",
            })
          : await chrome.tabs.sendMessage(
              tabId,
              { type: "GET_YOUTUBE_MEDIA_HANDOFF" },
              { frameId },
            );
      } catch {
        return null;
      }
    }),
  );
  const targetVideoId = youtubeVideoId(candidate.pageUrl);
  const fresh = responses
    .flatMap((response) => response?.handoff?.candidates || [])
    .find(
      (item) =>
        item?.kind === "adaptive" &&
        item?.provider === "youtube" &&
        (!targetVideoId || youtubeVideoId(item.pageUrl) === targetVideoId),
    );
  if (!fresh) return candidate;
  return {
    ...candidate,
    playerUrl: fresh.playerUrl || candidate.playerUrl,
    variants: mergeFreshTracks(candidate.variants, fresh.variants),
    audioTracks: mergeFreshTracks(candidate.audioTracks, fresh.audioTracks),
    acquisitionDiagnostic:
      fresh.acquisitionDiagnostic || candidate.acquisitionDiagnostic,
  };
}

function mergeFreshTracks(existing = [], fresh = []) {
  const freshById = new Map(fresh.map((track) => [track.id, track]));
  const merged = existing.map((track) => ({
    ...track,
    ...(freshById.get(track.id) || {}),
  }));
  const known = new Set(merged.map((track) => track.id));
  merged.push(...fresh.filter((track) => !known.has(track.id)));
  return merged;
}

function youtubeVideoId(value) {
  try {
    const url = new URL(value || "");
    if (url.hostname === "youtu.be") return url.pathname.slice(1) || null;
    if (/(^|\.)youtube\.com$/i.test(url.hostname))
      return (
        url.searchParams.get("v") ||
        url.pathname.match(/^\/shorts\/([^/]+)/)?.[1] ||
        null
      );
  } catch {}
  return null;
}

async function attachManifestHandoff(tabId, candidate) {
  if (candidate.probeSource !== "decrypted_blob")
    return { status: "ready", candidate };
  const response = await getMediaManifestHandoff(tabId, candidate.id);
  const handoff = response.handoff;
  if (
    response.status !== "found" ||
    handoff?.manifestUrl !== candidate.manifestUrl ||
    handoff?.kind !== candidate.kind ||
    (candidate.revisionId && handoff?.revisionId !== candidate.revisionId)
  ) {
    return {
      status: "manifest_handoff_expired",
      reason:
        "The decrypted manifest expired. Reload the video page and retry.",
    };
  }
  return {
    status: "ready",
    candidate: { ...candidate, manifestHandoff: handoff },
  };
}

async function attachAesKeyHandoff(tabId, candidate) {
  if (!shouldRequestAesKeyHandoff(candidate)) return candidate;
  try {
    const catalog = await listDiscoveredMedia(tabId);
    const targets = collectAesKeyHandoffTargets(candidate, catalog.items || []);
    const message = {
      type: "GET_MEDIA_AES_KEY_HANDOFF",
      requestedManifestUrl: candidate.manifestUrl,
      manifestUrls: targets.manifestUrls,
    };
    const keys = new Map();
    const diagnostics = [];
    const responses = await Promise.all(
      targets.frameIds.map(async (frameId) => {
        try {
          return frameId === null
            ? await chrome.tabs.sendMessage(tabId, message)
            : await chrome.tabs.sendMessage(tabId, message, { frameId });
        } catch {
          return null;
        }
      }),
    );
    for (const response of responses) {
      if (
        response?.status !== "ready" ||
        response.requestedManifestUrl !== candidate.manifestUrl
      ) {
        continue;
      }
      for (const key of response.keys || []) {
        if (key?.url) keys.set(key.url, key);
      }
      if (response.diagnostic) diagnostics.push(response.diagnostic);
    }
    const keyHandoffDiagnostic = aggregateAesKeyHandoffDiagnostics(
      targets,
      responses,
      diagnostics,
    );
    if (!keys.size) return { ...candidate, keyHandoffDiagnostic };
    return {
      ...candidate,
      keyHandoffDiagnostic,
      keyHandoff: {
        kind: "hls_aes_keys",
        manifestUrl: candidate.manifestUrl,
        keys: [...keys.values()].slice(0, 16),
      },
    };
  } catch {
    return candidate;
  }
}

export function shouldRequestAesKeyHandoff(candidate = {}) {
  // Encryption often appears only in a child media playlist. A selected master
  // can therefore have no encryptionMethods even though the Helper will later
  // descend into an AES-protected child. Querying the bounded browser handoff
  // for every user-requested HLS job avoids losing that key evidence.
  return candidate.kind === "hls";
}

function aggregateAesKeyHandoffDiagnostics(targets, responses, diagnostics) {
  const sums = (field) =>
    diagnostics.reduce((total, item) => total + (Number(item[field]) || 0), 0);
  return {
    framesQueried: targets.frameIds.length,
    framesResponded: responses.filter(Boolean).length,
    requestedManifestCount: diagnostics.length
      ? sums("requestedManifestCount")
      : targets.manifestUrls.length,
    matchedManifestCount: sums("matchedManifestCount"),
    relatedManifestCount: sums("relatedManifestCount"),
    relatedManifestBytes: sums("relatedManifestBytes"),
    childManifestCount: sums("childManifestCount"),
    keyDirectiveCount: sums("keyDirectiveCount"),
    unsupportedKeyDirectiveCount: sums("unsupportedKeyDirectiveCount"),
    segmentDirectiveCount: sums("segmentDirectiveCount"),
    encryptionMethods: [
      ...new Set(
        diagnostics.flatMap((item) =>
          Array.isArray(item.encryptionMethods) ? item.encryptionMethods : [],
        ),
      ),
    ].slice(0, 8),
    encryptionKeyFormats: [
      ...new Set(
        diagnostics.flatMap((item) =>
          Array.isArray(item.encryptionKeyFormats)
            ? item.encryptionKeyFormats
            : [],
        ),
      ),
    ].slice(0, 8),
    declaredKeyCount: sums("declaredKeyCount"),
    capturedKeyCount: sums("capturedKeyCount"),
    pageFetchAttemptCount: sums("pageFetchAttemptCount"),
    pageFetchSuccessCount: sums("pageFetchSuccessCount"),
    pageFetchStatuses: [
      ...new Set(
        diagnostics.flatMap((item) =>
          Array.isArray(item.pageFetchStatuses) ? item.pageFetchStatuses : [],
        ),
      ),
    ].slice(0, 8),
    pageFetchErrorCount: sums("pageFetchErrorCount"),
    pageManifestFetchAttemptCount: sums("pageManifestFetchAttemptCount"),
    pageManifestFetchSuccessCount: sums("pageManifestFetchSuccessCount"),
    pageManifestFetchStatuses: [
      ...new Set(
        diagnostics.flatMap((item) =>
          Array.isArray(item.pageManifestFetchStatuses)
            ? item.pageManifestFetchStatuses
            : [],
        ),
      ),
    ].slice(0, 8),
    pageManifestFetchErrorCount: sums("pageManifestFetchErrorCount"),
  };
}

export function collectAesKeyHandoffTargets(candidate, items = []) {
  const relatedIds = new Set([
    candidate.id,
    candidate.selectedMediaId,
    ...(candidate.parentManifestIds || []),
    ...(candidate.childManifestIds || []),
    ...(candidate.resolvedMediaIds || []),
  ]);
  const related = [candidate];
  for (const item of items) {
    if (
      relatedIds.has(item.id) ||
      (item.parentManifestIds || []).includes(candidate.id) ||
      (item.childManifestIds || []).includes(candidate.id) ||
      (item.resolvedMediaIds || []).includes(candidate.id)
    ) {
      related.push(item);
    }
  }
  const manifestUrls = uniqueHttpUrls(
    related.flatMap((item) => [
      item.manifestUrl,
      item.resolvedStream?.manifestUrl,
      ...(item.variants || []).map((variant) => variant.url),
    ]),
  ).slice(0, 16);
  const frameIds = [
    ...new Set(
      related
        .map((item) => item.frameId)
        .filter((frameId) => Number.isInteger(frameId) && frameId >= 0),
    ),
  ].slice(0, 8);
  return {
    manifestUrls,
    frameIds: frameIds.length ? frameIds : [null],
  };
}

function uniqueHttpUrls(values) {
  const urls = [];
  for (const value of values) {
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol)) urls.push(url.href);
    } catch {}
  }
  return [...new Set(urls)];
}

async function recoverCandidate(state) {
  if (!Number.isInteger(state.sourceTabId) || !state.mediaId) return null;
  const response = await listDiscoveredMedia(state.sourceTabId);
  return findDownloadCandidate(response.items, state.mediaId);
}

function findDownloadCandidate(items, mediaId) {
  return (
    items.find((item) => item.id === mediaId) ||
    selectVisibleMediaItems(items, Number.MAX_SAFE_INTEGER).find(
      (item) => item.id === mediaId,
    ) ||
    null
  );
}

async function helperFailureFor(candidate, output) {
  const helper = await getMediaHelperStatus({ force: true });
  if (helper.status !== "ready") {
    return {
      status: "helper_required",
      helper,
      reason: "Media Helper must be installed and available to download video.",
    };
  }
  if (output?.profileId !== "source" && output?.profileId !== "video-mp4") {
    if (!helper.canSelectContainer) {
      return {
        status: "helper_not_ready",
        helper,
        reason:
          "This Media Helper build cannot select a different output container yet.",
      };
    }
  }
  if (
    candidate.kind === "adaptive" &&
    candidate.acquisitionProfile === "youtube_player_js_challenge" &&
    !helper.canResolveYouTubePlayerJs
  ) {
    return {
      status: "helper_not_ready",
      helper,
      reason:
        "This Media Helper build cannot resolve YouTube Player JS challenges yet.",
    };
  }
  if (
    candidate.kind === "adaptive" &&
    hasYouTubeProviderPendingTracks(candidate) &&
    !helper.canResolveYouTubeProviderFormats
  ) {
    return {
      status: "helper_not_ready",
      helper,
      reason:
        "This Media Helper build cannot resolve YouTube adaptive quality tracks yet.",
    };
  }
  const capabilityReady =
    candidate.kind === "direct"
      ? helper.canDownloadDirect
      : candidate.kind === "hls"
        ? candidate.probeSource === "decrypted_blob"
          ? helper.canDownloadHls && helper.canDownloadDecryptedHls
          : helper.canDownloadHls
        : candidate.kind === "dash"
          ? helper.canDownloadDash
          : helper.canDownloadAdaptive;
  if (capabilityReady) return null;
  return {
    status: "helper_not_ready",
    helper,
    reason:
      candidate.kind === "direct"
        ? "This Media Helper build cannot download direct media yet."
        : candidate.kind === "hls"
          ? candidate.probeSource === "decrypted_blob"
            ? "This Media Helper build cannot accept a player-decrypted HLS manifest yet."
            : "This Media Helper build does not execute HLS downloads yet."
          : candidate.kind === "dash"
            ? "This Media Helper build does not execute DASH downloads yet."
            : "This Media Helper build cannot mux resolved adaptive tracks yet.",
  };
}

async function readJob(jobId) {
  if (typeof jobId !== "string" || !jobId) return null;
  const key = downloadJobKey(jobId);
  const sessionJob = (await chrome.storage.session.get(key))[key];
  if (sessionJob) return sessionJob;
  return (
    (await listMediaHelperDownloads()).find((item) => item.id === jobId) || null
  );
}

async function removeStaleJobs() {
  const snapshot = await chrome.storage.session.get(null);
  const cutoff = Date.now() - DOWNLOAD_JOB_MAX_AGE_MS;
  const staleKeys = Object.entries(snapshot)
    .filter(
      ([key, value]) =>
        key.startsWith(DOWNLOAD_JOB_PREFIX) &&
        (!Number.isFinite(value?.createdAt) || value.createdAt < cutoff),
    )
    .map(([key]) => key);
  if (staleKeys.length) await chrome.storage.session.remove(staleKeys);
}

function randomId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
