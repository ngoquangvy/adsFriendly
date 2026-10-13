const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_PER_SCOPE = 8;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CACHE_ENTRIES = 256;
const DEFAULT_MAX_SCOPES = 64;
const DEFAULT_MAX_QUEUED = 16;

/**
 * Reads only response metadata for direct media URLs. URLs and results stay in
 * memory; response bodies are never consumed.
 */
export function createMediaSizeProbe({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  maxPerScope = DEFAULT_MAX_PER_SCOPE,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
  maxScopes = DEFAULT_MAX_SCOPES,
  maxQueued = DEFAULT_MAX_QUEUED,
} = {}) {
  if (typeof fetchImpl !== "function")
    throw new TypeError("Media size probe requires fetch().");

  const cache = new Map();
  const inFlight = new Map();
  const scopeUrls = new Map();
  const waiters = [];
  let active = 0;

  return Object.freeze({
    probe(rawUrl, { scopeKey = "default" } = {}) {
      const url = validDirectUrl(rawUrl);
      if (!url) return Promise.resolve(result("skipped", "invalid_url"));

      const cached = cache.get(url);
      if (cached && now() - cached.at < cacheTtlMs) {
        cache.delete(url);
        cache.set(url, cached);
        return Promise.resolve(cached.value);
      }
      cache.delete(url);
      if (inFlight.has(url)) return inFlight.get(url);

      pruneExpired(now());
      const scopedUrls = scopeUrls.get(scopeKey)?.urls || new Set();
      if (!scopedUrls.has(url)) {
        if (scopedUrls.size >= maxPerScope)
          return Promise.resolve(result("skipped", "scope_limit"));
        scopedUrls.add(url);
        scopeUrls.set(scopeKey, { urls: scopedUrls, at: now() });
      }
      if (active >= maxConcurrent && waiters.length >= maxQueued)
        return Promise.resolve(result("skipped", "queue_limit"));

      const operation = runQueued(async () => {
        const value = await probeResponseMetadata(url, fetchImpl, timeoutMs);
        cache.set(url, { at: now(), value });
        trimCache();
        return value;
      });
      inFlight.set(url, operation);
      operation.finally(() => inFlight.delete(url));
      return operation;
    },
  });

  function pruneExpired(timestamp) {
    for (const [key, entry] of cache) {
      if (timestamp - entry.at >= cacheTtlMs) cache.delete(key);
    }
    for (const [key, entry] of scopeUrls) {
      if (timestamp - entry.at >= cacheTtlMs) scopeUrls.delete(key);
    }
    if (scopeUrls.size >= maxScopes) {
      const oldest = [...scopeUrls.entries()].sort(
        (left, right) => left[1].at - right[1].at,
      );
      for (const [key] of oldest.slice(0, scopeUrls.size - maxScopes + 1))
        scopeUrls.delete(key);
    }
  }

  function trimCache() {
    while (cache.size > maxCacheEntries)
      cache.delete(cache.keys().next().value);
  }

  async function runQueued(task) {
    if (active >= maxConcurrent) {
      await new Promise((resolve) => waiters.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active -= 1;
    }
  }
}

async function probeResponseMetadata(url, fetchImpl, timeoutMs) {
  const head = await requestHeadersOnly(
    fetchImpl,
    url,
    "HEAD",
    null,
    timeoutMs,
  );
  const headSize = totalBytes(head);
  if (headSize) return result("resolved", null, headSize, "HEAD", head.status);

  const range = await requestHeadersOnly(
    fetchImpl,
    url,
    "GET",
    "bytes=0-0",
    timeoutMs,
  );
  const rangeSize = totalBytes(range);
  if (rangeSize)
    return result("resolved", null, rangeSize, "GET_RANGE", range.status);
  if (head.error || range.error)
    return result("unavailable", "request_failed", null, null, range.status);
  return result("unavailable", "size_header_missing", null, null, range.status);
}

async function requestHeadersOnly(fetchImpl, url, method, range, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      ...(range ? { headers: { Range: range } } : {}),
    });
    const metadata = {
      status: Number(response.status) || 0,
      headers: response.headers,
      error: false,
    };
    if (method !== "HEAD") {
      // Some servers ignore Range and start streaming the whole file. Cancel as
      // soon as headers arrive; we need only Content-Range/Content-Length.
      await response.body?.cancel().catch(() => {});
    }
    return metadata;
  } catch {
    return { status: 0, headers: null, error: true };
  } finally {
    clearTimeout(timeout);
  }
}

function totalBytes(response) {
  if (
    !response ||
    response.error ||
    response.status < 200 ||
    response.status >= 300
  )
    return null;
  const headers = response.headers;
  const encoding = String(headers?.get?.("content-encoding") || "")
    .trim()
    .toLowerCase();
  if (encoding && encoding !== "identity") return null;

  if (response.status === 206) {
    const total = String(headers?.get?.("content-range") || "").match(
      /^\s*bytes\s+\d+-\d+\/(\d+)\s*$/i,
    )?.[1];
    return positiveSafeInteger(total);
  }
  return positiveSafeInteger(headers?.get?.("content-length"));
}

function validDirectUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function positiveSafeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function result(
  status,
  reason,
  contentLength = null,
  method = null,
  httpStatus = null,
) {
  return Object.freeze({ status, reason, contentLength, method, httpStatus });
}
