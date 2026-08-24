const MAX_PROBE_ATTEMPTS = 3;
const PROTECTED_QUERY_KEYS = Object.freeze([
  "access_token",
  "auth",
  "authorization",
  "expires",
  "expiry",
  "hash",
  "id",
  "jwt",
  "key",
  "policy",
  "session",
  "session_id",
  "sig",
  "signature",
  "token",
]);
const CONTROL_QUERY_KEYS = Object.freeze([
  "d",
  "decrypt",
  "encrypted",
  "encryption",
  "enc",
  "mode",
  "format",
  "output",
  "response",
  "type",
]);

const HLS_PROBE_ADAPTERS = Object.freeze([
  Object.freeze({
    id: "aesgcm-b65-query-mutation",
    evidence: Object.freeze(["enc_aesgcm", "ext_x_b65"]),
    matches(body) {
      const source = normalizeBody(body);
      return (
        source.startsWith("#EXTM3U") &&
        source.includes("#ENC-AESGCM;") &&
        source.includes("#EXT-X-B65:")
      );
    },
    attempts(manifestUrl) {
      const sourceUrl = new URL(manifestUrl);
      return mutationKeys(sourceUrl).map((removedQueryKey) => {
        const url = new URL(sourceUrl.href);
        url.searchParams.delete(removedQueryKey);
        return {
          url: url.href,
          adapterId: this.id,
          strategy: "remove_query_parameter",
          removedQueryKey,
          evidence: [...this.evidence],
        };
      });
    },
  }),
]);

export function createHlsProbeAttempts(manifestUrl, body) {
  let url;
  try {
    url = new URL(manifestUrl);
  } catch {
    return [];
  }
  if (!["http:", "https:"].includes(url.protocol)) return [];

  const attempts = [];
  for (const adapter of HLS_PROBE_ADAPTERS) {
    if (!adapter.matches(body)) continue;
    for (const attempt of adapter.attempts(url.href)) {
      if (
        attempt.url !== url.href &&
        !attempts.some((item) => item.url === attempt.url)
      ) {
        attempts.push(attempt);
      }
    }
  }
  return attempts.slice(0, MAX_PROBE_ATTEMPTS);
}

function mutationKeys(url) {
  const keys = [...new Set(url.searchParams.keys())].filter(
    (key) => key && !isProtectedQueryKey(key),
  );
  return keys.sort((left, right) => queryKeyRank(left) - queryKeyRank(right));
}

function isProtectedQueryKey(key) {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  return PROTECTED_QUERY_KEYS.some(
    (protectedKey) =>
      normalized === protectedKey || normalized.endsWith(`_${protectedKey}`),
  );
}

function queryKeyRank(key) {
  const preferred = CONTROL_QUERY_KEYS.indexOf(key.toLowerCase());
  return preferred === -1 ? CONTROL_QUERY_KEYS.length : preferred;
}

function normalizeBody(body) {
  return typeof body === "string"
    ? body.replace(/^\uFEFF/, "").trimStart()
    : "";
}
