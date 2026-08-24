import {
  MEDIA_HELPER_CAPABILITIES,
  MEDIA_HELPER_EVENTS,
  MEDIA_HELPER_HOST_NAME,
  MEDIA_HELPER_PROTOCOL_VERSION,
  MEDIA_HELPER_REQUESTS,
  normalizeHelperEvent,
} from "../media/helper-contract.js";

const DEFAULT_TIMEOUT_MS = 3000;
const STATUS_CACHE_MS = 15_000;
let cachedStatus = null;
let cachedAt = 0;
let statusPromise = null;

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
      canDownloadHls:
        capabilities[MEDIA_HELPER_CAPABILITIES.HLS_VOD_DOWNLOAD] === true,
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
    canDownloadHls: false,
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
