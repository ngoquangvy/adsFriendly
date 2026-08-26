import {
  MEDIA_HELPER_CAPABILITIES,
  MEDIA_HELPER_EVENTS,
  MEDIA_HELPER_HOST_NAME,
  MEDIA_HELPER_PROTOCOL_VERSION,
  MEDIA_HELPER_REQUESTS,
  normalizeHelperEvent,
} from "../media/helper-contract.js";
import {
  DOWNLOAD_HISTORY_KEY,
  DOWNLOAD_JOB_PREFIX,
  downloadJobKey,
  normalizeMediaDownloadJob,
} from "../media/download-job-contract.js";
import { formatAesKeyHandoffDiagnostic } from "../media/key-handoff-diagnostics.js";
import {
  getMediaAccessStrategyPreferences,
  recordMediaAccessStrategyResult,
} from "./media-access-strategy-memory.js";

const DEFAULT_TIMEOUT_MS = 8000;
const STATUS_CACHE_MS = 15_000;
const FAILED_STATUS_CACHE_MS = 2_000;
let cachedStatus = null;
let cachedAt = 0;
let statusPromise = null;
const activePorts = new Map();
let historyWriteChain = Promise.resolve();

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
  const cacheDuration =
    cachedStatus?.status === MEDIA_HELPER_STATES.READY
      ? STATUS_CACHE_MS
      : FAILED_STATUS_CACHE_MS;
  if (!force && cachedStatus && Date.now() - cachedAt < cacheDuration) {
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
      canAcquireHlsInParallel:
        capabilities[MEDIA_HELPER_CAPABILITIES.HLS_PARALLEL_ACQUISITION] ===
        true,
      canDownloadDecryptedHls:
        capabilities[MEDIA_HELPER_CAPABILITIES.HLS_DECRYPTED_MANIFEST] === true,
      canSelectContainer:
        capabilities[MEDIA_HELPER_CAPABILITIES.OUTPUT_CONTAINER_SELECTION] ===
        true,
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
  { connections = 8, attempt = 1 } = {},
) {
  if (!(await hasNativeMessagingPermission())) {
    throw new Error("Native Messaging permission is required.");
  }
  const job = normalizeMediaDownloadJob(rawJob);
  const previousConnection = activePorts.get(job.id);
  if (previousConnection && !previousConnection.terminal)
    throw new Error("Download job is already active.");
  if (previousConnection) {
    activePorts.delete(job.id);
    previousConnection.port.disconnect();
  }
  const requestId = randomId();
  const accessStrategyPreferences =
    await getMediaAccessStrategyPreferences().catch(() => ({}));
  const port = chrome.runtime.connectNative(MEDIA_HELPER_HOST_NAME);
  const state = {
    id: job.id,
    mediaId: job.candidate.id,
    kind: job.candidate.kind,
    title: job.candidate.title,
    output: job.output,
    sourceTabId: job.sourceTabId,
    candidate: withoutSensitiveHandoffs(job.candidate),
    connections,
    attempt,
    createdAt: job.createdAt,
    updatedAt: Date.now(),
    status: "starting",
    progress: null,
    outputPath: null,
    error: null,
  };
  await removeHistoryEntry(job.id);
  const connection = {
    port,
    requestId,
    terminal: false,
    terminalStatus: "cancelled",
    queue: Promise.resolve(),
  };
  activePorts.set(job.id, connection);
  await persistJobState(state);

  port.onMessage.addListener((rawEvent) => {
    if (activePorts.get(job.id) !== connection) return;
    connection.queue = connection.queue.then(() =>
      handleJobEvent(job.id, requestId, rawEvent),
    );
  });
  port.onDisconnect.addListener(() => {
    if (activePorts.get(job.id) !== connection) return;
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
      output: job.output,
      browserUserAgent: globalThis.navigator?.userAgent || null,
      accessStrategyPreferences,
      candidate: job.candidate,
    },
  });
  return { status: "started", jobId: job.id };
}

function withoutSensitiveHandoffs(candidate) {
  const { keyHandoff: _keyHandoff, ...publicCandidate } = candidate;
  if (!publicCandidate.manifestHandoff) return publicCandidate;
  const { body: _body, ...manifestHandoff } = publicCandidate.manifestHandoff;
  return { ...publicCandidate, manifestHandoff };
}

export async function cancelMediaHelperDownload(
  jobId,
  { terminalStatus = "cancelled" } = {},
) {
  const connection = activePorts.get(jobId);
  if (!connection) return { status: "not_running" };
  connection.terminalStatus =
    terminalStatus === "paused" ? "paused" : "cancelled";
  connection.port.postMessage({
    type: MEDIA_HELPER_REQUESTS.DOWNLOAD_CANCEL,
    requestId: connection.requestId,
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: { jobId },
  });
  const status =
    connection.terminalStatus === "paused" ? "pausing" : "cancelling";
  await updateJobState(jobId, { status });
  return { status, jobId };
}

export async function listMediaHelperDownloads() {
  const [snapshot, local] = await Promise.all([
    chrome.storage.session.get(null),
    chrome.storage.local.get(DOWNLOAD_HISTORY_KEY),
  ]);
  const sessionJobs = Object.entries(snapshot)
    .filter(([key]) => key.startsWith(DOWNLOAD_JOB_PREFIX))
    .map(([, value]) => value)
    .filter((value) => value && typeof value === "object");
  const history = Array.isArray(local[DOWNLOAD_HISTORY_KEY])
    ? local[DOWNLOAD_HISTORY_KEY]
    : [];
  const merged = new Map(
    history
      .filter((value) => value && typeof value === "object" && value.id)
      .map((value) => [value.id, { ...value, historyOnly: true }]),
  );
  for (const job of sessionJobs) merged.set(job.id, job);
  return [...merged.values()].sort(
    (a, b) =>
      (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
  );
}

export async function removeMediaHelperDownloadHistory(jobId) {
  await Promise.all([
    chrome.storage.session.remove(downloadJobKey(jobId)),
    removeHistoryEntry(jobId),
  ]);
}

export async function clearMediaHelperDownloadHistory() {
  const snapshot = await chrome.storage.session.get(null);
  const terminalKeys = Object.entries(snapshot)
    .filter(
      ([key, value]) =>
        key.startsWith(DOWNLOAD_JOB_PREFIX) &&
        ![
          "starting",
          "probing",
          "downloading",
          "finalizing",
          "pausing",
          "cancelling",
        ].includes(value?.status),
    )
    .map(([key]) => key);
  await Promise.all([
    terminalKeys.length
      ? chrome.storage.session.remove(terminalKeys)
      : Promise.resolve(),
    updateHistory(() => []),
  ]);
  return { removedCount: terminalKeys.length };
}

export async function runMediaHelperOutputAction(action, outputPath) {
  if (!(await hasNativeMessagingPermission())) {
    throw new Error("Native Messaging permission is required.");
  }
  const type =
    action === "open"
      ? MEDIA_HELPER_REQUESTS.OUTPUT_OPEN
      : action === "reveal"
        ? MEDIA_HELPER_REQUESTS.OUTPUT_REVEAL
        : null;
  if (!type) throw new Error("Unknown Media Helper output action.");
  const requestId = randomId();
  const response = normalizeHelperEvent(
    await withTimeout(
      chrome.runtime.sendNativeMessage(MEDIA_HELPER_HOST_NAME, {
        type,
        requestId,
        protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
        payload: { outputPath },
      }),
      DEFAULT_TIMEOUT_MS,
    ),
  );
  if (response.requestId !== requestId)
    throw new Error("Media Helper returned a mismatched request ID.");
  if (response.type === MEDIA_HELPER_EVENTS.ERROR)
    throw new Error(
      response.payload.message || "Media Helper output action failed.",
    );
  if (response.type !== MEDIA_HELPER_EVENTS.OUTPUT_OPENED)
    throw new Error(`Unexpected Media Helper event: ${response.type}.`);
  return { status: "opened", action, outputPath };
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
    if (event.type === MEDIA_HELPER_EVENTS.ACCESS_STRATEGY_RESULT) {
      await recordMediaAccessStrategyResult(event.payload);
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
      const terminalStatus =
        activePorts.get(jobId)?.terminalStatus === "paused"
          ? "paused"
          : "cancelled";
      markTerminal(jobId);
      await updateJobState(jobId, { status: terminalStatus });
      activePorts.get(jobId)?.port.disconnect();
      return;
    }
    if (event.type === MEDIA_HELPER_EVENTS.ERROR) {
      markTerminal(jobId);
      const message = await appendStoredKeyCaptureDiagnostic(
        jobId,
        event.payload.message || "Media Helper download failed.",
      );
      await updateJobState(jobId, {
        status: "failed",
        error: message,
      });
      activePorts.get(jobId)?.port.disconnect();
    }
  } catch (error) {
    markTerminal(jobId);
    await updateJobState(jobId, { status: "failed", error: messageOf(error) });
    activePorts.get(jobId)?.port.disconnect();
  }
}

async function appendStoredKeyCaptureDiagnostic(jobId, message) {
  if (
    !/no captured browser key was available/i.test(message) ||
    /Browser capture:/i.test(message)
  ) {
    return message;
  }
  const key = downloadJobKey(jobId);
  const state = (await chrome.storage.session.get(key))[key];
  const detail = formatAesKeyHandoffDiagnostic(
    state?.candidate?.keyHandoffDiagnostic,
  );
  return detail ? `${message}${detail}` : message;
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
  const next = { ...current, ...changes, updatedAt: Date.now() };
  await persistJobState(next);
  if (["completed", "failed", "cancelled", "paused"].includes(next.status))
    await persistHistoryEntry(next);
}

async function persistHistoryEntry(state) {
  const safeState = {
    id: state.id,
    mediaId: state.mediaId,
    kind: state.kind,
    title: state.title,
    sourceTabId: state.sourceTabId,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    status: state.status,
    progress: state.progress ? { ...state.progress } : null,
    outputPath: state.outputPath,
    error: state.error,
    connections: state.connections,
    attempt: state.attempt,
  };
  return updateHistory((history) =>
    [safeState, ...history.filter((item) => item?.id !== state.id)].slice(
      0,
      100,
    ),
  );
}

async function removeHistoryEntry(jobId) {
  return updateHistory((history) =>
    history.filter((item) => item?.id !== jobId),
  );
}

function updateHistory(mutate) {
  const operation = historyWriteChain.then(async () => {
    const local = await chrome.storage.local.get(DOWNLOAD_HISTORY_KEY);
    const history = Array.isArray(local[DOWNLOAD_HISTORY_KEY])
      ? local[DOWNLOAD_HISTORY_KEY]
      : [];
    const next = mutate(history);
    if (JSON.stringify(next) === JSON.stringify(history)) return;
    await chrome.storage.local.set({ [DOWNLOAD_HISTORY_KEY]: next });
  });
  historyWriteChain = operation.catch(() => {});
  return operation;
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
    canAcquireHlsInParallel: false,
    canDownloadDecryptedHls: false,
    canSelectContainer: false,
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
