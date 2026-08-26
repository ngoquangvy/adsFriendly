import { parseHlsAttributeList } from "../media/hls-parser.js";

const MAX_KEY_BYTES = 64 * 1024;
const MAX_MANIFESTS = 16;
const MAX_KEYS_PER_MANIFEST = 16;
const MAXIMUM_AGE_MS = 10 * 60 * 1000;
const manifests = new Map();
const capturedKeys = new Map();

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
  return [...manifests.get(manifestUrl).keyUrls];
}

export function mayCaptureAesKey(url) {
  prune(Date.now());
  return [...manifests.values()].some((item) => item.keyUrls.includes(url));
}

export async function captureFetchAesKey(url, response) {
  if (!mayCaptureAesKey(url) || !response?.ok) return false;
  const bytes = new Uint8Array(await response.clone().arrayBuffer());
  return rememberKey(url, bytes);
}

export async function captureXhrAesKey(url, xhr) {
  if (!mayCaptureAesKey(url) || Number(xhr?.status) >= 400) return false;
  const responseType = String(xhr?.responseType || "").toLowerCase();
  let bytes = null;
  if (responseType === "arraybuffer" && xhr.response instanceof ArrayBuffer) {
    bytes = new Uint8Array(xhr.response);
  } else if (responseType === "blob" && xhr.response instanceof Blob) {
    bytes = new Uint8Array(await xhr.response.arrayBuffer());
  } else if (!responseType || responseType === "text") {
    bytes = new TextEncoder().encode(String(xhr.responseText || ""));
  }
  return bytes ? rememberKey(url, bytes) : false;
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

export function clearAesKeyHandoffs() {
  manifests.clear();
  capturedKeys.clear();
}

function rememberKey(url, bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.byteLength ||
    bytes.byteLength > MAX_KEY_BYTES
  ) {
    return false;
  }
  capturedKeys.set(url, {
    url,
    data: bytesToBase64(bytes),
    bytes: bytes.byteLength,
    capturedAt: Date.now(),
  });
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
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
