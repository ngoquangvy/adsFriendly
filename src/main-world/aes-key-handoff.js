import { parseHlsAttributeList } from "../media/hls-parser.js";

const MAX_KEY_BYTES = 64 * 1024;
const MAX_MANIFESTS = 16;
const MAX_KEYS_PER_MANIFEST = 16;
const MAXIMUM_AGE_MS = 10 * 60 * 1000;
const RECENT_RESPONSE_MAXIMUM_AGE_MS = 15 * 1000;
const MAX_RECENT_RESPONSES = 32;
const manifests = new Map();
const capturedKeys = new Map();
const recentKeySizedResponses = new Map();
let pendingManifestInspections = 0;

export function beginHlsManifestInspection() {
  pendingManifestInspections += 1;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pendingManifestInspections = Math.max(0, pendingManifestInspections - 1);
  };
}

export function rememberHlsKeyUris(manifestUrl, body, observedAt = Date.now()) {
  const keyUrls = [];
  for (const rawLine of String(body || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("#EXT-X-KEY:")) continue;
    const attributes = parseHlsAttributeList(line.slice(line.indexOf(":") + 1));
    const method = String(attributes.METHOD || "").toUpperCase();
    const keyFormat = String(attributes.KEYFORMAT || "identity").toLowerCase();
    if (
      !attributes.URI ||
      method === "NONE" ||
      !["AES-128", "SAMPLE-AES"].includes(method) ||
      !["", "identity"].includes(keyFormat)
    ) {
      continue;
    }
    try {
      const url = new URL(attributes.URI, manifestUrl);
      if (["http:", "https:"].includes(url.protocol)) keyUrls.push(url.href);
    } catch {}
  }
  if (!keyUrls.length) return [];
  prune(observedAt);
  manifests.set(manifestUrl, {
    keyUrls: [...new Set(keyUrls)].slice(0, MAX_KEYS_PER_MANIFEST),
    observedAt,
  });
  while (manifests.size > MAX_MANIFESTS) {
    manifests.delete(manifests.keys().next().value);
  }
  for (const url of manifests.get(manifestUrl).keyUrls) {
    const recent = recentKeySizedResponses.get(url);
    if (recent) rememberKey(url, recent.bytes, recent.capturedAt);
  }
  return [...manifests.get(manifestUrl).keyUrls];
}

export function mayCaptureAesKey(url) {
  prune(Date.now());
  return [...manifests.values()].some((item) => item.keyUrls.includes(url));
}

export async function captureFetchAesKey(url, response) {
  const declaredKey = mayCaptureAesKey(url);
  if (!response?.ok || !mayInspectResponse(response, declaredKey)) {
    return false;
  }
  const bytes = await readActualAesKeyBytes(response);
  if (!bytes) return false;
  if (declaredKey || mayCaptureAesKey(url)) return rememberKey(url, bytes);
  return rememberRecentKeySizedResponse(url, bytes);
}

export async function captureXhrAesKey(url, xhr) {
  if (Number(xhr?.status) >= 400) return false;
  const declaredKey = mayCaptureAesKey(url);
  const responseType = String(xhr?.responseType || "").toLowerCase();
  let bytes = null;
  if (responseType === "arraybuffer" && xhr.response instanceof ArrayBuffer) {
    bytes = new Uint8Array(xhr.response);
  } else if (responseType === "blob" && xhr.response instanceof Blob) {
    bytes = new Uint8Array(await xhr.response.arrayBuffer());
  } else if (declaredKey && (!responseType || responseType === "text")) {
    bytes = new TextEncoder().encode(String(xhr.responseText || ""));
  }
  if (!bytes) return false;
  return declaredKey || mayCaptureAesKey(url)
    ? rememberKey(url, bytes)
    : rememberRecentKeySizedResponse(url, bytes);
}

export function getAesKeyHandoff(manifestUrl, observedAt = Date.now()) {
  prune(observedAt);
  const manifest = manifests.get(manifestUrl);
  if (!manifest) return [];
  return manifest.keyUrls
    .map((url) => capturedKeys.get(url))
    .filter(Boolean)
    .map((item) => ({ ...item }));
}

export function getAesKeyHandoffs(manifestUrls, observedAt = Date.now()) {
  const keys = new Map();
  for (const manifestUrl of normalizeManifestUrls(manifestUrls)) {
    for (const key of getAesKeyHandoff(manifestUrl, observedAt)) {
      keys.set(key.url, key);
    }
  }
  return [...keys.values()].slice(0, MAX_KEYS_PER_MANIFEST);
}

export async function recoverAesKeyHandoffs(
  manifestUrls,
  fetchImpl = globalThis.fetch,
  observedAt = Date.now(),
) {
  const urls = normalizeManifestUrls(manifestUrls);
  prune(observedAt);
  const declaredKeyUrls = [
    ...new Set(
      urls.flatMap((manifestUrl) => manifests.get(manifestUrl)?.keyUrls || []),
    ),
  ].slice(0, MAX_KEYS_PER_MANIFEST);
  const diagnostic = {
    requestedManifestCount: urls.length,
    matchedManifestCount: urls.filter((url) => manifests.has(url)).length,
    declaredKeyCount: declaredKeyUrls.length,
    capturedKeyCount: declaredKeyUrls.filter((url) => capturedKeys.has(url))
      .length,
    pageFetchAttemptCount: 0,
    pageFetchSuccessCount: 0,
    pageFetchStatuses: [],
    pageFetchErrorCount: 0,
  };
  if (typeof fetchImpl !== "function") {
    diagnostic.pageFetchErrorCount = declaredKeyUrls.filter(
      (url) => !capturedKeys.has(url),
    ).length;
    return { keys: getAesKeyHandoffs(urls, observedAt), diagnostic };
  }
  for (const keyUrl of declaredKeyUrls) {
    if (capturedKeys.has(keyUrl)) continue;
    diagnostic.pageFetchAttemptCount += 1;
    try {
      const init = {
        method: "GET",
        credentials: "include",
        cache: "default",
        redirect: "follow",
      };
      const pageUrl = globalThis.location?.href;
      if (/^https?:/i.test(pageUrl || "")) init.referrer = pageUrl;
      const response = await fetchImpl(keyUrl, init);
      if (Number.isInteger(response?.status)) {
        diagnostic.pageFetchStatuses.push(response.status);
      }
      if (!response?.ok) continue;
      const bytes = await readActualAesKeyBytes(response);
      if (bytes && rememberKey(keyUrl, bytes)) {
        diagnostic.pageFetchSuccessCount += 1;
      }
    } catch {
      diagnostic.pageFetchErrorCount += 1;
    }
  }
  diagnostic.capturedKeyCount = declaredKeyUrls.filter((url) =>
    capturedKeys.has(url),
  ).length;
  return {
    keys: getAesKeyHandoffs(urls, observedAt),
    diagnostic,
  };
}

export function clearAesKeyHandoffs() {
  manifests.clear();
  capturedKeys.clear();
  recentKeySizedResponses.clear();
  pendingManifestInspections = 0;
}

function rememberKey(url, bytes, capturedAt = Date.now()) {
  if (!(bytes instanceof Uint8Array) || !isAesKeySize(bytes.byteLength)) {
    return false;
  }
  capturedKeys.set(url, {
    url,
    data: bytesToBase64(bytes),
    bytes: bytes.byteLength,
    capturedAt,
  });
  recentKeySizedResponses.delete(url);
  return true;
}

function rememberRecentKeySizedResponse(url, bytes, capturedAt = Date.now()) {
  if (!(bytes instanceof Uint8Array) || !isAesKeySize(bytes.byteLength)) {
    return false;
  }
  recentKeySizedResponses.set(url, { bytes: bytes.slice(), capturedAt });
  while (recentKeySizedResponses.size > MAX_RECENT_RESPONSES) {
    recentKeySizedResponses.delete(recentKeySizedResponses.keys().next().value);
  }
  return true;
}

function prune(now) {
  const cutoff = now - MAXIMUM_AGE_MS;
  for (const [url, item] of manifests) {
    if (item.observedAt < cutoff) manifests.delete(url);
  }
  for (const [url, item] of capturedKeys) {
    if (item.capturedAt < cutoff) capturedKeys.delete(url);
  }
  const recentCutoff = now - RECENT_RESPONSE_MAXIMUM_AGE_MS;
  for (const [url, item] of recentKeySizedResponses) {
    if (item.capturedAt < recentCutoff) recentKeySizedResponses.delete(url);
  }
}

function mayInspectResponse(response, declaredKey) {
  if (declaredKey) return true;
  const lengthHeader = response.headers?.get?.("content-length");
  const length =
    typeof lengthHeader === "string" && lengthHeader.trim()
      ? Number(lengthHeader)
      : null;
  const mimeType = String(response.headers?.get?.("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const plausibleBinary = !(
    mimeType.startsWith("text/") ||
    mimeType.startsWith("image/") ||
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("video/") ||
    mimeType.includes("json") ||
    mimeType.includes("mpegurl")
  );
  if (!plausibleBinary) return false;
  if (Number.isFinite(length)) return isAesKeySize(length);
  return pendingManifestInspections > 0;
}

async function readActualAesKeyBytes(response) {
  const clone = response.clone();
  const reader = clone.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await clone.arrayBuffer());
    return isAesKeySize(bytes.byteLength) ? bytes : null;
  }
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      byteLength += chunk.byteLength;
      if (byteLength > 32) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  if (!isAesKeySize(byteLength)) return null;
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isAesKeySize(value) {
  return [16, 24, 32].includes(value) && value <= MAX_KEY_BYTES;
}

function normalizeManifestUrls(values) {
  const urls = [];
  for (const value of Array.isArray(values) ? values.slice(0, 16) : [values]) {
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol)) urls.push(url.href);
    } catch {}
  }
  return [...new Set(urls)];
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
