import { normalizeMediaDownloadOutput } from "./download-options.js";
import { isRegisteredMediaAccessStrategy } from "./access-strategy-catalog.js";

export const MEDIA_HELPER_PROTOCOL_VERSION = 3;
export const MEDIA_HELPER_HOST_NAME = "com.adsfriendly.media_helper";

export const MEDIA_HELPER_REQUESTS = Object.freeze({
  HELLO: "helper.hello",
  GET_CAPABILITIES: "helper.capabilities.get",
  DOWNLOAD_START: "download.start",
  DOWNLOAD_CANCEL: "download.cancel",
  OUTPUT_OPEN: "output.open",
  OUTPUT_REVEAL: "output.reveal",
});

export const MEDIA_HELPER_EVENTS = Object.freeze({
  READY: "helper.ready",
  CAPABILITIES: "helper.capabilities",
  DOWNLOAD_STARTED: "download.started",
  DOWNLOAD_PROGRESS: "download.progress",
  ACCESS_STRATEGY_RESULT: "media.access_strategy_result",
  DOWNLOAD_COMPLETED: "download.completed",
  DOWNLOAD_CANCELLED: "download.cancelled",
  OUTPUT_OPENED: "output.opened",
  ERROR: "helper.error",
});

export const MEDIA_HELPER_CAPABILITIES = Object.freeze({
  DIRECT_HTTP_DOWNLOAD: "download.direct_http",
  HLS_VOD_DOWNLOAD: "download.hls_vod",
  HLS_PARALLEL_ACQUISITION: "download.hls_parallel_acquisition",
  HLS_DECRYPTED_MANIFEST: "download.hls_decrypted_manifest",
  OUTPUT_CONTAINER_SELECTION: "output.container_selection",
  DASH_VOD_DOWNLOAD: "download.dash_vod",
  FFMPEG_MUX: "mux.ffmpeg",
  OUTPUT_OPEN: "output.open",
  OUTPUT_REVEAL: "output.reveal",
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
  if (
    !Object.values({ DIRECT: "direct", HLS: "hls", DASH: "dash" }).includes(
      kind,
    )
  ) {
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
    browserUserAgent: normalizeUserAgent(value.browserUserAgent),
    accessStrategyPreferences: normalizeAccessStrategyPreferences(
      value.accessStrategyPreferences,
    ),
    outputDirectory: optionalString(value.outputDirectory),
    output: normalizeMediaDownloadOutput(value.output, candidate),
    candidate: {
      id: requiredString(candidate.id, "candidate.id"),
      kind,
      pageUrl: requiredHttpUrl(candidate.pageUrl, "candidate.pageUrl"),
      sourceUrl: kind === "direct" ? sourceUrl : null,
      manifestUrl: ["hls", "dash"].includes(kind) ? sourceUrl : null,
      title: optionalString(candidate.title),
      mimeType: optionalString(candidate.mimeType),
      duration: ["hls", "dash"].includes(kind)
        ? optionalNonNegativeNumber(candidate.duration)
        : null,
      segmentCount:
        kind === "hls"
          ? optionalNonNegativeInteger(candidate.segmentCount)
          : null,
      requestContext: ["hls", "dash"].includes(kind)
        ? normalizeHelperRequestContext(candidate.requestContext)
        : null,
      manifestHandoff:
        kind === "hls"
          ? normalizeHelperManifestHandoff(candidate.manifestHandoff, sourceUrl)
          : null,
      keyHandoff:
        kind === "hls"
          ? normalizeHelperKeyHandoff(candidate.keyHandoff, sourceUrl)
          : null,
      keyHandoffDiagnostic:
        kind === "hls"
          ? normalizeHelperKeyHandoffDiagnostic(candidate.keyHandoffDiagnostic)
          : null,
    },
  };
}

function normalizeHelperKeyHandoffDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const count = (field) =>
    Math.max(0, Math.min(1000, Math.trunc(Number(value[field]) || 0)));
  return {
    framesQueried: count("framesQueried"),
    framesResponded: count("framesResponded"),
    requestedManifestCount: count("requestedManifestCount"),
    matchedManifestCount: count("matchedManifestCount"),
    declaredKeyCount: count("declaredKeyCount"),
    capturedKeyCount: count("capturedKeyCount"),
    pageFetchAttemptCount: count("pageFetchAttemptCount"),
    pageFetchSuccessCount: count("pageFetchSuccessCount"),
    pageFetchStatuses: [
      ...new Set(
        Array.isArray(value.pageFetchStatuses) ? value.pageFetchStatuses : [],
      ),
    ]
      .map(Number)
      .filter(
        (status) => Number.isInteger(status) && status >= 0 && status <= 599,
      )
      .slice(0, 8),
    pageFetchErrorCount: count("pageFetchErrorCount"),
  };
}

function normalizeHelperKeyHandoff(value, manifestUrl) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.kind !== "hls_aes_keys" || value.manifestUrl !== manifestUrl) {
    throw new Error(
      "[MediaHelperProtocol] AES key handoff does not match the candidate.",
    );
  }
  const keys = Array.isArray(value.keys)
    ? value.keys
        .slice(0, 16)
        .map((item) => normalizeHelperKeyEntry(item))
        .filter(Boolean)
    : [];
  return keys.length ? { kind: "hls_aes_keys", manifestUrl, keys } : null;
}

function normalizeHelperKeyEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const url = requiredHttpUrl(value.url, "candidate.keyHandoff.keys.url");
  const data = optionalString(value.data);
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  let bytes = null;
  try {
    bytes = atob(data).length;
  } catch {
    return null;
  }
  return bytes > 0 && bytes <= 64 * 1024 ? { url, data, bytes } : null;
}

function normalizeUserAgent(value) {
  if (typeof value !== "string") return null;
  const userAgent = value.replace(/[\r\n]/g, "").trim();
  return userAgent ? userAgent.slice(0, 512) : null;
}

function normalizeAccessStrategyPreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [hostname, rawStrategies] of Object.entries(value).slice(0, 100)) {
    if (
      !/^[a-z0-9.-]{1,253}$/i.test(hostname) ||
      !rawStrategies ||
      typeof rawStrategies !== "object" ||
      Array.isArray(rawStrategies)
    ) {
      continue;
    }
    output[hostname.toLowerCase()] = Object.fromEntries(
      Object.entries(rawStrategies)
        .filter(
          ([strategyId, score]) =>
            /^[a-z0-9_]{1,64}$/i.test(strategyId) &&
            isRegisteredMediaAccessStrategy(strategyId) &&
            Number.isFinite(Number(score)),
        )
        .slice(0, 8)
        .map(([strategyId, score]) => [
          strategyId,
          Math.max(-5, Math.min(10, Number(score))),
        ]),
    );
  }
  return output;
}

function normalizeHelperManifestHandoff(value, manifestUrl) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = typeof value.body === "string" ? value.body : "";
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  if (!body || bodyBytes > 512 * 1024) {
    throw new Error(
      "[MediaHelperProtocol] Decrypted manifest handoff is invalid.",
    );
  }
  const handoffUrl = requiredHttpUrl(
    value.manifestUrl,
    "candidate.manifestHandoff.manifestUrl",
  );
  if (handoffUrl !== manifestUrl || value.kind !== "hls") {
    throw new Error(
      "[MediaHelperProtocol] Decrypted manifest handoff does not match the candidate.",
    );
  }
  return {
    kind: "hls",
    manifestUrl: handoffUrl,
    body,
    bodyBytes,
    revisionId: optionalString(value.revisionId),
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

function optionalNonNegativeNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error("[MediaHelperProtocol] Expected a non-negative number.");
  }
  return number;
}

function optionalNonNegativeInteger(value) {
  const number = optionalNonNegativeNumber(value);
  if (number === null) return null;
  if (!Number.isInteger(number)) {
    throw new Error("[MediaHelperProtocol] Expected a non-negative integer.");
  }
  return number;
}

function normalizeHelperRequestContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    requestUrl: optionalString(value.requestUrl),
    finalUrl: optionalString(value.finalUrl),
    documentUrl: optionalString(value.documentUrl),
    parentDocumentUrl: optionalString(value.parentDocumentUrl),
    referrer: optionalString(value.referrer),
    method: optionalString(value.method) || "GET",
    credentials: ["omit", "same-origin", "include", "unknown"].includes(
      value.credentials,
    )
      ? value.credentials
      : "unknown",
    requiresBrowserSession: value.requiresBrowserSession === true,
  };
}
