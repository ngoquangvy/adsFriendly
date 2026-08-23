import {
  deleteTelemetryEvents,
  enqueueTelemetryEvent,
  listTelemetryBatch,
} from "../storage/training-store.js";

const ENABLED_KEY = "afsTelemetryEnabled";
const ENDPOINT_KEY = "afsTelemetryEndpoint";
const CLIENT_ID_KEY = "adsFriendlyClientId";
const DEFAULT_ENDPOINT = "http://127.0.0.1:3000/api/ingest";
const BATCH_SIZE = 50;

let flushInFlight = false;

export async function recordTelemetry(raw = {}) {
  const event = await buildEvent(raw);
  await enqueueTelemetryEvent(event);
  flushTelemetry();
  return event;
}

export async function flushTelemetry() {
  if (flushInFlight) return { status: "busy" };
  flushInFlight = true;
  try {
    const {
      [ENABLED_KEY]: enabled = true,
      [ENDPOINT_KEY]: endpoint = DEFAULT_ENDPOINT,
    } = await chrome.storage.local.get([ENABLED_KEY, ENDPOINT_KEY]);
    const queue = await listTelemetryBatch(BATCH_SIZE);
    if (enabled === false || !queue.length) return { status: "skipped" };

    const batch = queue.slice(0, BATCH_SIZE);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: batch }),
    });
    if (!response.ok && response.status !== 207) {
      return { status: "server_error", statusCode: response.status };
    }

    await deleteTelemetryEvents(batch.map((event) => event.sample_id));
    if (queue.length === BATCH_SIZE) setTimeout(flushTelemetry, 100);
    return { status: "flushed", count: batch.length };
  } catch (error) {
    return { status: "offline", error: error.message };
  } finally {
    flushInFlight = false;
  }
}

export function startTelemetryFlush() {
  chrome.runtime.onStartup.addListener(flushTelemetry);
  chrome.runtime.onInstalled.addListener(flushTelemetry);
  const intervalId = setInterval(flushTelemetry, 60000);
  return () => {
    clearInterval(intervalId);
    chrome.runtime.onStartup.removeListener(flushTelemetry);
    chrome.runtime.onInstalled.removeListener(flushTelemetry);
  };
}

async function buildEvent(raw) {
  const now = Date.now();
  const clientId = await getClientId();
  const site = normalizeSite(raw.site, raw);
  const labelSource = raw.label_source || "heuristic_weak";
  return {
    schema_version: raw.schema_version || "dataset.v1",
    sample_id: raw.sample_id || randomId(),
    unit: raw.unit || "unknown",
    label: raw.label || "unknown",
    label_source: labelSource,
    label_strength: raw.label_strength || inferLabelStrength(labelSource),
    ad_type: raw.ad_type || "unknown",
    site,
    timestamp: raw.timestamp || now,
    identity: {
      client_id: clientId,
      platform: "chrome_extension",
      app: "adsfriendly",
      schema: "identity.v1",
      ...(raw.identity || {}),
    },
    sync: {
      scope: raw.sync?.scope || "user",
      status: "queued",
      client_time: now,
      ...(raw.sync || {}),
    },
    context: raw.context || {},
    evidence: raw.evidence || {},
    feedback: raw.feedback || null,
    action: raw.action || null,
    outcome: raw.outcome || null,
    model: raw.model || {},
  };
}

async function getClientId() {
  const result = await chrome.storage.local.get(CLIENT_ID_KEY);
  if (result[CLIENT_ID_KEY]) return result[CLIENT_ID_KEY];
  const clientId = randomId();
  await chrome.storage.local.set({ [CLIENT_ID_KEY]: clientId });
  return clientId;
}

function normalizeSite(site, raw) {
  const url = site?.url || raw.url || raw.pageUrl || raw.sourceUrl || "";
  return {
    hostname:
      sanitizeHostname(site?.hostname || raw.hostname || raw.domain) ||
      hostFromUrl(url || raw.targetUrl),
    url: sanitizeUrl(url),
  };
}

function inferLabelStrength(labelSource) {
  if (/^user_|restore|undo|allow|block/i.test(labelSource)) return "strong";
  if (/heuristic|rule|model/i.test(labelSource)) return "weak";
  return "unknown";
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
}

function sanitizeHostname(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "")
    .slice(0, 253);
}

function sanitizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|key|auth|session|password|email|user|uid|id$/i.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    return parsed.href.slice(0, 2048);
  } catch {
    return "";
  }
}

function randomId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
