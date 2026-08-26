import { parseHlsAttributeList } from "../media/hls-parser.js";

const MAX_KEY_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_MANIFESTS = 16;
const MAX_MANIFEST_DEPTH = 3;
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
  const childManifestUrls = [];
  const text = String(body || "");
  if (!text.trimStart().startsWith("#EXTM3U")) return [];
  let keyDirectiveCount = 0;
  let unsupportedKeyDirectiveCount = 0;
  let segmentDirectiveCount = 0;
  const encryptionMethods = new Set();
  const encryptionKeyFormats = new Set();
  let expectsVariantUri = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("#EXTINF:")) segmentDirectiveCount += 1;
    if (expectsVariantUri && line && !line.startsWith("#")) {
      rememberHttpUrl(childManifestUrls, line, manifestUrl);
      expectsVariantUri = false;
    }
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      expectsVariantUri = true;
      continue;
    }
    if (
      line.startsWith("#EXT-X-I-FRAME-STREAM-INF:") ||
      line.startsWith("#EXT-X-MEDIA:")
    ) {
      const attributes = parseHlsAttributeList(
        line.slice(line.indexOf(":") + 1),
      );
      if (attributes.URI) {
        rememberHttpUrl(childManifestUrls, attributes.URI, manifestUrl);
      }
    }
    if (!line.startsWith("#EXT-X-KEY:")) continue;
    const attributes = parseHlsAttributeList(line.slice(line.indexOf(":") + 1));
    const method = String(attributes.METHOD || "")
      .trim()
      .toUpperCase();
    const keyFormat = String(attributes.KEYFORMAT || "identity")
      .trim()
      .toLowerCase();
    if (method === "NONE") continue;
    keyDirectiveCount += 1;
    if (method) encryptionMethods.add(method);
    if (keyFormat) encryptionKeyFormats.add(keyFormat);
    if (
      !attributes.URI ||
      !["AES-128", "SAMPLE-AES"].includes(method) ||
      !["", "identity"].includes(keyFormat)
    ) {
      unsupportedKeyDirectiveCount += 1;
      continue;
    }
    rememberHttpUrl(keyUrls, attributes.URI, manifestUrl);
  }
  prune(observedAt);
  manifests.set(manifestUrl, {
    keyUrls: [...new Set(keyUrls)].slice(0, MAX_KEYS_PER_MANIFEST),
    childManifestUrls: [...new Set(childManifestUrls)].slice(0, MAX_MANIFESTS),
    bodyBytes: new TextEncoder().encode(text).byteLength,
    keyDirectiveCount,
    unsupportedKeyDirectiveCount,
    segmentDirectiveCount,
    encryptionMethods: [...encryptionMethods].slice(0, 8),
    encryptionKeyFormats: [...encryptionKeyFormats].slice(0, 8),
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
  const diagnostic = {
    requestedManifestCount: urls.length,
    matchedManifestCount: urls.filter((url) => manifests.has(url)).length,
    relatedManifestCount: 0,
    relatedManifestBytes: 0,
    childManifestCount: 0,
    keyDirectiveCount: 0,
    unsupportedKeyDirectiveCount: 0,
    segmentDirectiveCount: 0,
    encryptionMethods: [],
    encryptionKeyFormats: [],
    declaredKeyCount: 0,
    capturedKeyCount: 0,
    pageManifestFetchAttemptCount: 0,
    pageManifestFetchSuccessCount: 0,
    pageManifestFetchStatuses: [],
    pageManifestFetchErrorCount: 0,
    pageFetchAttemptCount: 0,
    pageFetchSuccessCount: 0,
    pageFetchStatuses: [],
    pageFetchErrorCount: 0,
  };
  const relatedManifestUrls = await recoverRelatedManifestUrls(
    urls,
    fetchImpl,
    diagnostic,
  );
  diagnostic.matchedManifestCount = urls.filter((url) =>
    manifests.has(url),
  ).length;
  diagnostic.relatedManifestCount = relatedManifestUrls.length;
  const relatedEntries = relatedManifestUrls
    .map((url) => manifests.get(url))
    .filter(Boolean);
  diagnostic.relatedManifestBytes = relatedEntries.reduce(
    (total, entry) => total + (Number(entry.bodyBytes) || 0),
    0,
  );
  diagnostic.childManifestCount = new Set(
    relatedEntries.flatMap((entry) => entry.childManifestUrls || []),
  ).size;
  diagnostic.keyDirectiveCount = relatedEntries.reduce(
    (total, entry) => total + (Number(entry.keyDirectiveCount) || 0),
    0,
  );
  diagnostic.unsupportedKeyDirectiveCount = relatedEntries.reduce(
    (total, entry) => total + (Number(entry.unsupportedKeyDirectiveCount) || 0),
    0,
  );
  diagnostic.segmentDirectiveCount = relatedEntries.reduce(
    (total, entry) => total + (Number(entry.segmentDirectiveCount) || 0),
    0,
  );
  diagnostic.encryptionMethods = [
    ...new Set(
      relatedEntries.flatMap((entry) => entry.encryptionMethods || []),
    ),
  ].slice(0, 8);
  diagnostic.encryptionKeyFormats = [
    ...new Set(
      relatedEntries.flatMap((entry) => entry.encryptionKeyFormats || []),
    ),
  ].slice(0, 8);
  const declaredKeyUrls = [
    ...new Set(
      relatedManifestUrls.flatMap(
        (manifestUrl) => manifests.get(manifestUrl)?.keyUrls || [],
      ),
    ),
  ].slice(0, MAX_KEYS_PER_MANIFEST);
  diagnostic.declaredKeyCount = declaredKeyUrls.length;
  diagnostic.capturedKeyCount = declaredKeyUrls.filter((url) =>
    capturedKeys.has(url),
  ).length;
  if (typeof fetchImpl !== "function") {
    diagnostic.pageFetchErrorCount = declaredKeyUrls.filter(
      (url) => !capturedKeys.has(url),
    ).length;
    return {
      keys: getAesKeyHandoffs(relatedManifestUrls, observedAt),
      diagnostic,
    };
  }
  for (const keyUrl of declaredKeyUrls) {
    if (capturedKeys.has(keyUrl)) continue;
    diagnostic.pageFetchAttemptCount += 1;
    try {
      const response = await fetchImpl(keyUrl, browserFetchInit());
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
    keys: getAesKeyHandoffs(relatedManifestUrls, observedAt),
    diagnostic,
  };
}

async function recoverRelatedManifestUrls(urls, fetchImpl, diagnostic) {
  const queue = urls.map((url) => ({ url, depth: 0 }));
  const visited = new Set();
  while (queue.length && visited.size < MAX_MANIFESTS) {
    const current = queue.shift();
    if (!current || visited.has(current.url)) continue;
    visited.add(current.url);
    if (!manifests.has(current.url) && typeof fetchImpl === "function") {
      diagnostic.pageManifestFetchAttemptCount += 1;
      try {
        const response = await fetchImpl(current.url, browserFetchInit());
        if (Number.isInteger(response?.status)) {
          diagnostic.pageManifestFetchStatuses.push(response.status);
        }
        if (response?.ok) {
          const body = await readBoundedManifestBody(response);
          if (body !== null) {
            rememberHlsKeyUris(current.url, body);
            if (manifests.has(current.url)) {
              diagnostic.pageManifestFetchSuccessCount += 1;
            }
          }
        }
      } catch {
        diagnostic.pageManifestFetchErrorCount += 1;
      }
    }
    const entry = manifests.get(current.url);
    if (!entry || current.depth >= MAX_MANIFEST_DEPTH) continue;
    for (const childUrl of entry.childManifestUrls || []) {
      if (!visited.has(childUrl)) {
        queue.push({ url: childUrl, depth: current.depth + 1 });
      }
    }
  }
  return [...visited].filter((url) => manifests.has(url));
}

async function readBoundedManifestBody(response) {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > MAX_MANIFEST_BYTES) {
    await response.body?.cancel?.().catch(() => {});
    return null;
  }
  const body = await response.text();
  return new TextEncoder().encode(body).byteLength <= MAX_MANIFEST_BYTES
    ? body
    : null;
}

function browserFetchInit() {
  const init = {
    method: "GET",
    credentials: "include",
    cache: "default",
    redirect: "follow",
  };
  const pageUrl = globalThis.location?.href;
  if (/^https?:/i.test(pageUrl || "")) init.referrer = pageUrl;
  return init;
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

function rememberHttpUrl(output, value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (["http:", "https:"].includes(url.protocol)) output.push(url.href);
  } catch {}
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
