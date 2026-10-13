export const NAVIGATION_DIAGNOSTICS_SESSION_KEY =
  "adsfriendly.navigationDiagnostics";

const DEFAULT_CAPTURE_MS = 10 * 60 * 1000;
const MAX_CAPTURE_MS = 15 * 60 * 1000;
const BUFFER_TTL_MS = 5 * 60 * 1000;
const CAPTURE_TTL_MS = 60 * 60 * 1000;
const BUFFER_LIMIT = 120;
const CAPTURE_LIMIT = 500;

const ALLOWED_EVENT_TYPES = new Set([
  "tab_created",
  "navigation_target_created",
  "navigation_committed",
  "candidate_linked",
  "policy_decided",
  "enforcement_requested",
  "enforcement_completed",
  "tab_removed",
  "capture_triggered",
]);

export function normalizeNavigationDiagnosticEvent(
  event = {},
  now = Date.now(),
) {
  const normalized = {
    at: Number.isFinite(event.at) ? event.at : now,
    type: ALLOWED_EVENT_TYPES.has(event.type) ? event.type : "unknown",
  };
  for (const key of [
    "tabId",
    "sourceTabId",
    "openerTabId",
    "sourceFrameId",
    "revision",
  ]) {
    if (Number.isInteger(event[key])) normalized[key] = event[key];
  }
  Object.assign(normalized, normalizeNavigationAttributionFacts(event));
  for (const key of ["url", "sourceUrl", "targetUrl"]) {
    const safeUrl = summarizeNavigationDiagnosticUrl(event[key]);
    if (safeUrl) normalized[`${key}Host`] = safeUrl.host;
    if (key === "url" && safeUrl?.hasSearchQuery)
      normalized.searchQueryPresent = true;
  }
  for (const key of [
    "transitionType",
    "role",
    "decision",
    "reviewSurface",
    "action",
    "reason",
  ]) {
    if (typeof event[key] === "string" && event[key].length <= 80)
      normalized[key] = event[key];
  }
  if (Array.isArray(event.transitionQualifiers)) {
    normalized.transitionQualifiers = event.transitionQualifiers
      .filter((value) => typeof value === "string")
      .slice(0, 8);
  }
  if (Array.isArray(event.reasons)) {
    normalized.reasons = event.reasons
      .filter((value) => typeof value === "string")
      .slice(0, 12);
  }
  return normalized;
}

function summarizeNavigationDiagnosticUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return {
      host: url.host.slice(0, 255),
      hasSearchQuery: url.searchParams.has("q"),
    };
  } catch {
    return null;
  }
}

export function createNavigationDiagnostics({
  getStorage,
  now = () => Date.now(),
} = {}) {
  let writeQueue = Promise.resolve();

  const enqueue = (operation) => {
    const result = writeQueue.then(operation);
    writeQueue = result.catch(() => {});
    return result;
  };

  const readState = async () => {
    const storage = getStorage?.();
    if (!storage)
      return {
        events: [],
        captureUntil: 0,
        retainUntil: 0,
        captureReason: null,
      };
    const snapshot = await storage.get(NAVIGATION_DIAGNOSTICS_SESSION_KEY);
    const state = snapshot?.[NAVIGATION_DIAGNOSTICS_SESSION_KEY];
    return state && typeof state === "object"
      ? state
      : { events: [], captureUntil: 0, retainUntil: 0, captureReason: null };
  };

  const pruneEvents = (events, timestamp, extendedRetention) => {
    const ttl = extendedRetention ? CAPTURE_TTL_MS : BUFFER_TTL_MS;
    const limit = extendedRetention ? CAPTURE_LIMIT : BUFFER_LIMIT;
    return (Array.isArray(events) ? events : [])
      .filter(
        (event) =>
          Number.isFinite(event?.at) &&
          event.at >= timestamp - ttl &&
          event.at <= timestamp + 1000,
      )
      .slice(-limit);
  };

  const record = (event) =>
    enqueue(async () => {
      const timestamp = now();
      const state = await readState();
      const captureUntil =
        Number.isFinite(state.captureUntil) && state.captureUntil > timestamp
          ? state.captureUntil
          : 0;
      const retainUntil =
        Number.isFinite(state.retainUntil) && state.retainUntil > timestamp
          ? state.retainUntil
          : 0;
      if (!captureUntil && retainUntil) {
        return { status: "retained", count: state.events?.length || 0 };
      }
      const extendedRetention = captureUntil > timestamp;
      const events = pruneEvents(state.events, timestamp, extendedRetention);
      events.push(normalizeNavigationDiagnosticEvent(event, timestamp));
      const limit = extendedRetention ? CAPTURE_LIMIT : BUFFER_LIMIT;
      await getStorage()?.set({
        [NAVIGATION_DIAGNOSTICS_SESSION_KEY]: {
          events: events.slice(-limit),
          captureUntil,
          retainUntil,
          captureReason: extendedRetention
            ? state.captureReason || "developer"
            : null,
        },
      });
      return { status: "recorded", count: events.length };
    });

  const startCapture = ({
    durationMs = DEFAULT_CAPTURE_MS,
    reason = "developer",
  } = {}) =>
    enqueue(async () => {
      const timestamp = now();
      const duration = Math.min(
        MAX_CAPTURE_MS,
        Math.max(
          60_000,
          Number.isFinite(durationMs) ? durationMs : DEFAULT_CAPTURE_MS,
        ),
      );
      const state = await readState();
      const events = pruneEvents(state.events, timestamp, true);
      const captureUntil = timestamp + duration;
      events.push(
        normalizeNavigationDiagnosticEvent(
          { type: "capture_triggered", reason },
          timestamp,
        ),
      );
      await getStorage()?.set({
        [NAVIGATION_DIAGNOSTICS_SESSION_KEY]: {
          events: events.slice(-CAPTURE_LIMIT),
          captureUntil,
          retainUntil: captureUntil + CAPTURE_TTL_MS,
          captureReason: reason,
        },
      });
      return { status: "capturing", captureUntil };
    });

  const stopCapture = () =>
    enqueue(async () => {
      const timestamp = now();
      const state = await readState();
      const retainUntil =
        Number.isFinite(state.retainUntil) && state.retainUntil > timestamp
          ? state.retainUntil
          : timestamp + CAPTURE_TTL_MS;
      const events = pruneEvents(state.events, timestamp, true);
      await getStorage()?.set({
        [NAVIGATION_DIAGNOSTICS_SESSION_KEY]: {
          events: events.slice(-CAPTURE_LIMIT),
          captureUntil: 0,
          retainUntil,
          captureReason: state.captureReason || "developer",
        },
      });
      return { status: "stopped", count: events.length };
    });

  const getSnapshot = () =>
    enqueue(async () => {
      const timestamp = now();
      const state = await readState();
      const captureUntil =
        Number.isFinite(state.captureUntil) && state.captureUntil > timestamp
          ? state.captureUntil
          : 0;
      const retainUntil =
        Number.isFinite(state.retainUntil) && state.retainUntil > timestamp
          ? state.retainUntil
          : 0;
      const extendedRetention =
        captureUntil > timestamp || retainUntil > timestamp;
      const events = pruneEvents(state.events, timestamp, extendedRetention);
      return {
        events,
        captureUntil,
        retainedUntil: retainUntil,
        captureReason: extendedRetention
          ? state.captureReason || "developer"
          : null,
      };
    });

  const clear = () =>
    enqueue(async () => {
      await getStorage()?.remove(NAVIGATION_DIAGNOSTICS_SESSION_KEY);
      return { status: "cleared" };
    });

  return { record, startCapture, stopCapture, getSnapshot, clear };
}

export const navigationDiagnostics = createNavigationDiagnostics({
  getStorage: () => chrome.storage.session,
});
import { normalizeNavigationAttributionFacts } from "./attribution.js";
