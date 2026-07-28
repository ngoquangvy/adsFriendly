const VALID_UNITS = new Set([
  "video_instance",
  "dom_element",
  "media_request",
  "manifest",
  "segment",
  "ui_overlay",
  "navigation",
  "page_context",
  "feedback",
  "unknown",
]);

const VALID_LABELS = new Set([
  "ad",
  "content",
  "tracker",
  "sponsor",
  "unknown",
  "false_positive",
  "false_negative",
]);

export function normalizeEvent(input) {
  const raw =
    input?.data && typeof input.data === "object" ? input.data : input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Payload must be a JSON object" };
  }

  const now = Date.now();
  const site = normalizeSite(raw.site, raw);
  const unit = VALID_UNITS.has(raw.unit)
    ? raw.unit
    : raw.event_type || "unknown";
  const label = VALID_LABELS.has(raw.label) ? raw.label : "unknown";

  const event = {
    schema_version: String(raw.schema_version || raw.schema_v || "dataset.v1"),
    sample_id: String(raw.sample_id || raw.eventId || cryptoRandomId()),
    unit: VALID_UNITS.has(unit) ? unit : "unknown",
    label,
    label_source: String(raw.label_source || raw.source_of_label || "unknown"),
    label_strength: String(raw.label_strength || "unknown"),
    ad_type: raw.ad_type || "unknown",
    site,
    timestamp: Number(raw.timestamp || now),
    identity: sanitizeObject(raw.identity || {}),
    sync: sanitizeObject(raw.sync || {}),
    context: sanitizeObject(raw.context || {}),
    evidence: sanitizeObject(raw.evidence || raw.features || {}),
    feedback: sanitizeObject(raw.feedback || null),
    action: raw.action || null,
    outcome: raw.outcome || null,
    model: sanitizeObject(raw.model || raw.decision || {}),
  };

  if (!event.site.hostname || event.site.hostname === "unknown") {
    return { ok: false, error: "Missing site.hostname/domain" };
  }

  return { ok: true, event };
}

export function normalizeBatch(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.events)
      ? payload.events
      : [payload];
  const accepted = [];
  const rejected = [];

  for (const item of items) {
    const result = normalizeEvent(item);
    if (result.ok) accepted.push(result.event);
    else
      rejected.push({ error: result.error, raw: item, timestamp: Date.now() });
  }

  return { accepted, rejected };
}

function normalizeSite(site, raw) {
  const hostname =
    site?.hostname ||
    site?.domain ||
    raw.domain ||
    raw.hostname ||
    raw.identity?.site_domain ||
    "unknown";
  return {
    hostname: sanitizeHostname(hostname),
    url: sanitizeUrl(site?.url || raw.url || ""),
  };
}

function sanitizeHostname(value) {
  return (
    String(value || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, "")
      .slice(0, 253) || "unknown"
  );
}

function sanitizeUrl(value) {
  try {
    const parsed = new URL(String(value));
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|key|auth|session|password|email|user|uid|id$/i.test(key))
        parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.href.slice(0, 2048);
  } catch {
    return "";
  }
}

function sanitizeObject(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.slice(0, 2048);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => sanitizeObject(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 80)
        .map(([key, item]) => [
          String(key).slice(0, 80),
          sanitizeObject(item, depth + 1),
        ]),
    );
  }
  return String(value);
}

function cryptoRandomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
