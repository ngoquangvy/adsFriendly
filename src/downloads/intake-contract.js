export const DOWNLOAD_OBSERVER_FEATURE = "background.browser-download-observer";
export const DOWNLOAD_INTAKE_KEY = "browserDownloadIntake.v1";
export const DOWNLOAD_INTAKE_MESSAGES = Object.freeze({
  GET: "GET_BROWSER_DOWNLOAD_INTAKE",
  CLEAR: "CLEAR_BROWSER_DOWNLOAD_INTAKE",
});
export const INTAKE_LIMIT = 50;
export const INTAKE_MAX_AGE_MS = 60 * 60 * 1000;

export function sourceFacts(value) {
  try {
    const url = new URL(value);
    return {
      protocol: url.protocol,
      host: url.hostname,
      credentialed: Boolean(url.username || url.password),
      authorizationHints: [...url.searchParams.keys()].some(
        (key) =>
          /(^|[_-])(token|sig|signature|auth|expire|expires|policy|key|jwt|credential)([_-]|$)/i.test(
            key,
          ) || /^(X-Amz-|X-Goog-)/i.test(key),
      ),
    };
  } catch {
    return {
      protocol: "unknown",
      host: "",
      credentialed: false,
      authorizationHints: false,
    };
  }
}

// Deliberately loses URL/path/query, absolute filenames and extension identities.
// DownloadItem does not expose HTTP method, cookies or replayability.
export function normalizeDownloadIntake(item, now = Date.now()) {
  if (
    !Number.isInteger(item?.id) ||
    item.id < 0 ||
    item.incognito ||
    item.byExtensionId
  )
    return null;
  const original = sourceFacts(item.url);
  const final = sourceFacts(item.finalUrl || item.url);
  return {
    id: item.id,
    filename:
      String(item.filename || "")
        .split(/[\\/]/)
        .pop()
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, 180) || "Unnamed file",
    host: final.host,
    protocol: final.protocol,
    credentialed: original.credentialed || final.credentialed,
    authorizationHints: original.authorizationHints || final.authorizationHints,
    mime: String(item.mime || "")
      .split(";")[0]
      .slice(0, 100),
    totalBytes: size(item.totalBytes),
    state: ["in_progress", "complete", "interrupted"].includes(item.state)
      ? item.state
      : "unknown",
    danger: String(item.danger || "unknown").slice(0, 64),
    paused: item.paused === true,
    observedAt: now,
    method: "unknown",
  };
}

export function applyDownloadDelta(record, delta) {
  const next = { ...record };
  for (const key of [
    "state",
    "danger",
    "paused",
    "totalBytes",
    "mime",
    "filename",
  ])
    if (delta[key] && Object.hasOwn(delta[key], "current")) {
      const value = delta[key].current;
      if (key === "totalBytes") next[key] = size(value);
      else if (key === "paused") next[key] = value === true;
      else if (key === "filename")
        next[key] =
          String(value || "")
            .split(/[\\/]/)
            .pop()
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .slice(0, 180) || "Unnamed file";
      else next[key] = String(value || "unknown").slice(0, 100);
    }
  if (delta.finalUrl?.current || delta.url?.current) {
    const facts = sourceFacts(delta.finalUrl?.current || delta.url.current);
    next.host = facts.host;
    next.protocol = facts.protocol;
    next.credentialed ||= facts.credentialed;
    next.authorizationHints ||= facts.authorizationHints;
  }
  return next;
}

export function restoreDownloadIntake(value, now = Date.now()) {
  if (value?.version !== 1 || !Array.isArray(value.items)) return [];
  return value.items.slice(0, INTAKE_LIMIT).flatMap((row) => {
    if (
      !Number.isInteger(row?.id) ||
      !Number.isFinite(row.observedAt) ||
      row.observedAt > now ||
      now - row.observedAt > INTAKE_MAX_AGE_MS
    )
      return [];
    const normalized = normalizeDownloadIntake(
      {
        ...row,
        url: `${row.protocol}//${row.host}/`,
        incognito: false,
        byExtensionId: null,
      },
      row.observedAt,
    );
    if (!normalized) return [];
    normalized.authorizationHints = row.authorizationHints === true;
    normalized.credentialed = row.credentialed === true;
    return [normalized];
  });
}

function size(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
