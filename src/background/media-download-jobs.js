import { ACTIONS } from "../runtime/action-catalog.js";
import { createActionBroker } from "../runtime/action-broker.js";
import {
  DOWNLOAD_JOB_MAX_AGE_MS,
  DOWNLOAD_JOB_PREFIX,
  downloadJobKey,
  getMediaDownloadAvailability,
  normalizeMediaDownloadJob,
} from "../media/download-job-contract.js";
import { listDiscoveredMedia } from "./media-catalog.js";

let broker = null;

export async function startMediaDownloadJobStore(policy) {
  await removeStaleJobs();
  broker = createActionBroker({
    featureId: "background.media-download-jobs",
    policy,
    handlers: {
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

async function createJob({ tabId, mediaId } = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) return { status: "invalid_tab" };
  if (typeof mediaId !== "string" || !mediaId)
    return { status: "invalid_media" };
  const response = await listDiscoveredMedia(tabId);
  const candidate = response.items.find((item) => item.id === mediaId);
  if (!candidate) return { status: "media_not_found" };
  const availability = getMediaDownloadAvailability(candidate);
  if (!availability.supported)
    return { status: "unsupported", reason: availability.reason };

  const job = normalizeMediaDownloadJob({
    id: randomId(),
    createdAt: Date.now(),
    sourceTabId: tabId,
    candidate,
  });
  await chrome.storage.session.set({ [downloadJobKey(job.id)]: job });
  return { status: "created", jobId: job.id };
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
