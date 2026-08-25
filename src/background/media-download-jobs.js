import { ACTIONS } from "../runtime/action-catalog.js";
import { createActionBroker } from "../runtime/action-broker.js";
import {
  DOWNLOAD_JOB_MAX_AGE_MS,
  DOWNLOAD_JOB_PREFIX,
  getMediaDownloadAvailability,
  normalizeMediaDownloadJob,
} from "../media/download-job-contract.js";
import { listDiscoveredMedia } from "./media-catalog.js";
import {
  cancelMediaHelperDownload,
  getMediaHelperStatus,
  listMediaHelperDownloads,
  startMediaHelperDownload,
} from "./media-helper-bridge.js";

let broker = null;

export async function startMediaDownloadJobStore(policy) {
  await removeStaleJobs();
  broker = createActionBroker({
    featureId: "background.media-download-jobs",
    policy,
    handlers: {
      [ACTIONS.MEDIA_DOWNLOAD_CANCEL]: cancelJob,
      [ACTIONS.MEDIA_DOWNLOAD_CREATE]: createJob,
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

export async function requestMediaDownloadCancel(payload) {
  if (!broker) return { status: "download_disabled" };
  return broker.execute(ACTIONS.MEDIA_DOWNLOAD_CANCEL, payload);
}

export async function listMediaDownloadJobs() {
  return { status: "ok", items: await listMediaHelperDownloads() };
}

async function createJob({ tabId, mediaId } = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) return { status: "invalid_tab" };
  if (typeof mediaId !== "string" || !mediaId)
    return { status: "invalid_media" };
  const response = await listDiscoveredMedia(tabId);
  let candidate = response.items.find((item) => item.id === mediaId);
  if (!candidate) return { status: "media_not_found" };
  if (candidate.kind === "hls" && candidate.selectedMediaId) {
    candidate =
      response.items.find((item) => item.id === candidate.selectedMediaId) ||
      candidate;
  }
  const availability = getMediaDownloadAvailability(candidate);
  if (!availability.supported)
    return { status: "unsupported", reason: availability.reason };
  const helper = await getMediaHelperStatus({ force: true });
  if (helper.status !== "ready") {
    return {
      status: "helper_required",
      helper,
      reason: "Media Helper must be installed and available to download video.",
    };
  }
  const capabilityReady =
    candidate.kind === "direct"
      ? helper.canDownloadDirect
      : candidate.kind === "hls"
        ? helper.canDownloadHls
        : helper.canDownloadDash;
  if (!capabilityReady) {
    return {
      status: "helper_not_ready",
      helper,
      reason:
        candidate.kind === "direct"
          ? "This Media Helper build cannot download direct media yet."
          : candidate.kind === "hls"
            ? "This Media Helper build does not execute HLS downloads yet."
            : "This Media Helper build does not execute DASH downloads yet.",
    };
  }
  const job = normalizeMediaDownloadJob({
    id: randomId(),
    createdAt: Date.now(),
    sourceTabId: tabId,
    candidate,
  });
  return startMediaHelperDownload(job, { connections: 8 });
}

async function cancelJob({ jobId } = {}) {
  if (typeof jobId !== "string" || !jobId) return { status: "invalid_job" };
  return cancelMediaHelperDownload(jobId);
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
