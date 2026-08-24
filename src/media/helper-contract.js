export const MEDIA_HELPER_PROTOCOL_VERSION = 1;
export const MEDIA_HELPER_HOST_NAME = "com.adsfriendly.media_helper";

export const MEDIA_HELPER_REQUESTS = Object.freeze({
  HELLO: "helper.hello",
  GET_CAPABILITIES: "helper.capabilities.get",
  DOWNLOAD_START: "download.start",
  DOWNLOAD_CANCEL: "download.cancel",
});

export const MEDIA_HELPER_EVENTS = Object.freeze({
  READY: "helper.ready",
  CAPABILITIES: "helper.capabilities",
  DOWNLOAD_PROGRESS: "download.progress",
  DOWNLOAD_COMPLETED: "download.completed",
  ERROR: "helper.error",
});

export const MEDIA_HELPER_CAPABILITIES = Object.freeze({
  HLS_VOD_DOWNLOAD: "download.hls_vod",
  FFMPEG_MUX: "mux.ffmpeg",
});

export function normalizeHelperRequest(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("[MediaHelperProtocol] Request must be an object.");
  }
  if (!Object.values(MEDIA_HELPER_REQUESTS).includes(value.type)) {
    throw new Error(
      `[MediaHelperProtocol] Unknown request type "${value.type || ""}".`,
    );
  }
  if (typeof value.requestId !== "string" || !value.requestId.trim()) {
    throw new Error("[MediaHelperProtocol] requestId is required.");
  }
  return {
    type: value.type,
    requestId: value.requestId.trim(),
    protocolVersion: normalizeProtocolVersion(value.protocolVersion),
    payload:
      value.payload &&
      typeof value.payload === "object" &&
      !Array.isArray(value.payload)
        ? { ...value.payload }
        : {},
  };
}

export function createHelperEvent(type, requestId, payload = {}) {
  if (!Object.values(MEDIA_HELPER_EVENTS).includes(type)) {
    throw new Error(`[MediaHelperProtocol] Unknown event type "${type}".`);
  }
  if (typeof requestId !== "string" || !requestId) {
    throw new Error("[MediaHelperProtocol] requestId is required.");
  }
  return {
    type,
    requestId,
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: payload && typeof payload === "object" ? payload : {},
  };
}

function normalizeProtocolVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("[MediaHelperProtocol] Invalid protocol version.");
  }
  return version;
}
