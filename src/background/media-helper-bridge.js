import {
  MEDIA_HELPER_CAPABILITIES,
  MEDIA_HELPER_EVENTS,
  MEDIA_HELPER_HOST_NAME,
  MEDIA_HELPER_PROTOCOL_VERSION,
  MEDIA_HELPER_REQUESTS,
  normalizeHelperEvent,
} from "../media/helper-contract.js";
import {
  DOWNLOAD_JOB_PREFIX,
  downloadJobKey,
  normalizeMediaDownloadJob,
} from "../media/download-job-contract.js";

const DEFAULT_TIMEOUT_MS = 3000;
const STATUS_CACHE_MS = 15_000;
let cachedStatus = null;
let cachedAt = 0;
let statusPromise = null;
const activePorts = new Map();

export const MEDIA_HELPER_STATES = Object.freeze({
  PERMISSION_REQUIRED: "permission_required",
  NOT_INSTALLED: "not_installed",
  READY: "ready",
  INCOMPATIBLE: "incompatible",
  UNAVAILABLE: "unavailable",
});

export async function getMediaHelperStatus({
  force = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!force && cachedStatus && Date.now() - cachedAt < STATUS_CACHE_MS) {
    return cachedStatus;
  }
  if (!force && statusPromise) return statusPromise;
  statusPromise = probeMediaHelperStatus(timeoutMs);
  try {
    cachedStatus = await statusPromise;
    cachedAt = Date.now();
    return cachedStatus;
  } finally {
    statusPromise = null;
  }
}

async function probeMediaHelperStatus(timeoutMs) {
  if (!(await hasNativeMessagingPermission())) {
    return helperStatus(MEDIA_HELPER_STATES.PERMISSION_REQUIRED);
  }

  const requestId = randomId();
  try {
    const response = normalizeHelperEvent(
      await withTimeout(
        chrome.runtime.sendNativeMessage(MEDIA_HELPER_HOST_NAME, {
          type: MEDIA_HELPER_REQUESTS.HELLO,
          requestId,
          protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
          payload: { extensionVersion: chrome.runtime.getManifest().version },
        }),
        timeoutMs,
      ),
    );
    if (response.requestId !== requestId) {
      throw new Error("Media Helper returned a mismatched request ID.");
    }
    if (response.protocolVersion !== MEDIA_HELPER_PROTOCOL_VERSION) {
      return helperStatus(MEDIA_HELPER_STATES.INCOMPATIBLE, {
        error: `Protocol ${response.protocolVersion} is not supported.`,
      });
    }
    if (response.type === MEDIA_HELPER_EVENTS.ERROR) {
      return helperStatus(MEDIA_HELPER_STATES.UNAVAILABLE, {
        error: response.payload.message || "Media Helper reported an error.",
      });
    }
    if (response.type !== MEDIA_HELPER_EVENTS.READY) {
      throw new Error(`Unexpected Media Helper event: ${response.type}.`);
    }
    const capabilities = normalizeCapabilities(response.payload.capabilities);
    return helperStatus(MEDIA_HELPER_STATES.READY, {
      helperVersion: stringOrNull(response.payload.helperVersion),
      capabilities,
      canDownloadDirect:
        capabilities[MEDIA_HELPER_CAPABILITIES.DIRECT_HTTP_DOWNLOAD] === true,
      canDownloadHls:
        capabilities[MEDIA_HELPER_CAPABILITIES.HLS_VOD_DOWNLOAD] === true,
      canDownloadDash:
        capabilities[MEDIA_HELPER_CAPABILITIES.DASH_VOD_DOWNLOAD] === true,
      canMuxWithFfmpeg:
        capabilities[MEDIA_HELPER_CAPABILITIES.FFMPEG_MUX] === true,
    });
  } catch (error) {
    const message = messageOf(error);
    return helperStatus(classifyNativeMessagingError(message), {
      error: message,
    });
  }
}

export async function startMediaHelperDownload(
  rawJob,
  { connections = 8 } = {},
) {
  if (!(await hasNativeMessagingPermission())) {
    throw new Error("Native Messaging permission is required.");
  }
  const job = normalizeMediaDownloadJob(rawJob);
  if (activePorts.has(job.id))
    throw new Error("Download job is already active.");
  const requestId = randomId();
  const port = chrome.runtime.connectNative(MEDIA_HELPER_HOST_NAME);
  const state = {
    id: job.id,
    mediaId: job.candidate.id,
    kind: job.candidate.kind,
    title: job.candidate.title,
    sourceTabId: job.sourceTabId,
    createdAt: job.createdAt,
    updatedAt: Date.now(),
    status: "starting",
    progress: null,
    outputPath: null,
    error: null,
  };
  activePorts.set(job.id, {
    port,
    requestId,
    terminal: false,
    queue: Promise.resolve(),
  });
  await persistJobState(state);

  port.onMessage.addListener((rawEvent) => {
    const connection = activePorts.get(job.id);
    if (!connection) return;
    connection.queue = connection.queue.then(() =>
      handleJobEvent(job.id, requestId, rawEvent),
    );
  });
  port.onDisconnect.addListener(() => {
    const connection = activePorts.get(job.id);
    if (!connection) return;
    const message =
      chrome.runtime.lastError?.message || "Media Helper disconnected.";
    void connection.queue
      .finally(async () => {
        activePorts.delete(job.id);
        if (!connection.terminal) {
          await updateJobState(job.id, { status: "failed", error: message });
        }
      })
      .catch(() => {});
  });
  port.postMessage({
    type: MEDIA_HELPER_REQUESTS.DOWNLOAD_START,
    requestId,
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: {
      jobId: job.id,
      connections,
      candidate: job.candidate,
    },
  });
  return { status: "started", jobId: job.id };
}

export async function cancelMediaHelperDownload(jobId) {
  const connection = activePorts.get(jobId);
  if (!connection) return { status: "not_running" };
  connection.port.postMessage({
    type: MEDIA_HELPER_REQUESTS.DOWNLOAD_CANCEL,
    requestId: connection.requestId,
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: { jobId },
  });
  await updateJobState(jobId, { status: "cancelling" });
  return { status: "cancelling", jobId };
}

export async function listMediaHelperDownloads() {
  const snapshot = await chrome.storage.session.get(null);
  return Object.entries(snapshot)
    .filter(([key]) => key.startsWith(DOWNLOAD_JOB_PREFIX))
    .map(([, value]) => value)
    .filter((value) => value && typeof value === "object")
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function handleJobEvent(jobId, requestId, rawEvent) {
  try {
    const event = normalizeHelperEvent(rawEvent);
    if (event.requestId !== requestId) return;
    if (event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_STARTED) {
      await updateJobState(jobId, { status: "probing" });
      return;
    }
    if (event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS) {
      await updateJobState(jobId, {
        status: event.payload.phase || "downloading",
        progress: { ...event.payload },
      });
      return;
    }
    if (event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED) {
      markTerminal(jobId);
      await updateJobState(jobId, {
        status: "completed",
        progress: { ...event.payload, phase: "completed" },
        outputPath: event.payload.outputPath || null,
      });
      activePorts.get(jobId)?.port.disconnect();
      return;
    }
    if (event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_CANCELLED) {
      markTerminal(jobId);
      await updateJobState(jobId, { status: "cancelled" });
      activePorts.get(jobId)?.port.disconnect();
      return;
    }
    if (event.type === MEDIA_HELPER_EVENTS.ERROR) {
      markTerminal(jobId);
      await updateJobState(jobId, {
        status: "failed",
        error: event.payload.message || "Media Helper download failed.",
      });
      activePorts.get(jobId)?.port.disconnect();
    }
  } catch (error) {
    markTerminal(jobId);
    await updateJobState(jobId, { status: "failed", error: messageOf(error) });
    activePorts.get(jobId)?.port.disconnect();
  }
}

function markTerminal(jobId) {
  const connection = activePorts.get(jobId);
  if (connection) connection.terminal = true;
}

async function persistJobState(state) {
  await chrome.storage.session.set({ [downloadJobKey(state.id)]: state });
}

async function updateJobState(jobId, changes) {
  const key = downloadJobKey(jobId);
  const current = (await chrome.storage.session.get(key))[key];
  if (!current) return;
  await persistJobState({ ...current, ...changes, updatedAt: Date.now() });
}

export function classifyNativeMessagingError(message = "") {
  if (
    /host.*not found|specified native messaging host not found|not registered/i.test(
      message,
    )
  ) {
    return MEDIA_HELPER_STATES.NOT_INSTALLED;
  }
  if (/protocol|incompatible/i.test(message)) {
    return MEDIA_HELPER_STATES.INCOMPATIBLE;
  }
  return MEDIA_HELPER_STATES.UNAVAILABLE;
}

async function hasNativeMessagingPermission() {
  if (!chrome.permissions?.contains) return false;
  return chrome.permissions.contains({ permissions: ["nativeMessaging"] });
}

function normalizeCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, enabled]) => typeof enabled === "boolean"),
  );
}

function helperStatus(status, details = {}) {
  return {
    status,
    installed: status === MEDIA_HELPER_STATES.READY,
    canDownloadDirect: false,
    canDownloadHls: false,
    canDownloadDash: false,
    canMuxWithFfmpeg: false,
    helperVersion: null,
    capabilities: {},
    error: null,
    ...details,
  };
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Media Helper handshake timed out.")),
      timeoutMs,
    );
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function randomId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
