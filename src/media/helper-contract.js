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
  DOWNLOAD_STARTED: "download.started",
  DOWNLOAD_PROGRESS: "download.progress",
  DOWNLOAD_COMPLETED: "download.completed",
  DOWNLOAD_CANCELLED: "download.cancelled",
  ERROR: "helper.error",
});

export const MEDIA_HELPER_CAPABILITIES = Object.freeze({
  DIRECT_HTTP_DOWNLOAD: "download.direct_http",
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

export function normalizeHelperEvent(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("[MediaHelperProtocol] Event must be an object.");
  }
  if (!Object.values(MEDIA_HELPER_EVENTS).includes(value.type)) {
    throw new Error(
      `[MediaHelperProtocol] Unknown event type "${value.type || ""}".`,
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

export function normalizeHelperDownloadPayload(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "[MediaHelperProtocol] Download payload must be an object.",
    );
  }
  const candidate = value.candidate;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("[MediaHelperProtocol] Download candidate is required.");
  }
  const kind = candidate.kind;
  if (!Object.values({ DIRECT: "direct", HLS: "hls" }).includes(kind)) {
    throw new Error(
      `[MediaHelperProtocol] Unsupported media kind "${kind || ""}".`,
    );
  }
  const sourceUrl = requiredHttpUrl(
    kind === "direct" ? candidate.sourceUrl : candidate.manifestUrl,
    kind === "direct" ? "candidate.sourceUrl" : "candidate.manifestUrl",
  );
  const connections = Number(value.connections ?? 8);
  if (!Number.isInteger(connections) || connections < 1 || connections > 16) {
    throw new Error("[MediaHelperProtocol] connections must be from 1 to 16.");
  }
  return {
    jobId: requiredString(value.jobId, "jobId"),
    connections,
    outputDirectory: optionalString(value.outputDirectory),
    candidate: {
      id: requiredString(candidate.id, "candidate.id"),
      kind,
      pageUrl: requiredHttpUrl(candidate.pageUrl, "candidate.pageUrl"),
      sourceUrl: kind === "direct" ? sourceUrl : null,
      manifestUrl: kind === "hls" ? sourceUrl : null,
      title: optionalString(candidate.title),
      mimeType: optionalString(candidate.mimeType),
    },
  };
}

function normalizeProtocolVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("[MediaHelperProtocol] Invalid protocol version.");
  }
  return version;
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[MediaHelperProtocol] ${field} is required.`);
  }
  return value.trim();
}

function requiredHttpUrl(value, field) {
  const raw = requiredString(value, field);
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.href;
  } catch {
    throw new Error(`[MediaHelperProtocol] ${field} must be an HTTP(S) URL.`);
  }
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
