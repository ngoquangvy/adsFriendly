const MAX_CONCURRENCY = 16;

export async function downloadResourcesInParallel(
  resources,
  {
    concurrency = 8,
    retries = 2,
    fetchResource,
    writeResource,
    onProgress = () => {},
    signal = null,
    retryDelay = defaultRetryDelay,
    writeInOrder = true,
  } = {},
) {
  if (!Array.isArray(resources) || !resources.length)
    throw new Error("[ParallelDownload] No resources to download.");
  if (typeof fetchResource !== "function")
    throw new Error("[ParallelDownload] fetchResource is required.");
  if (typeof writeResource !== "function")
    throw new Error("[ParallelDownload] writeResource is required.");

  const workerCount = clampConcurrency(concurrency);
  let fetchedResources = 0;
  let writtenResources = 0;
  let downloadedBytes = 0;

  if (!writeInOrder) {
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(workerCount, resources.length) },
      async () => {
        while (true) {
          throwIfAborted(signal);
          const index = nextIndex;
          nextIndex += 1;
          if (index >= resources.length) return;
          const resource = resources[index];
          const bytes = await fetchWithRetry(resource, {
            retries,
            fetchResource,
            signal,
            retryDelay,
          });
          fetchedResources += 1;
          downloadedBytes += bytes.byteLength;
          onProgress({
            phase: "download",
            fetchedResources,
            writtenResources,
            totalResources: resources.length,
            downloadedBytes,
          });
          throwIfAborted(signal);
          await writeResource(bytes, resource);
          writtenResources += 1;
          onProgress({
            phase: "write",
            fetchedResources,
            writtenResources,
            totalResources: resources.length,
            downloadedBytes,
          });
        }
      },
    );
    await Promise.all(workers);
    return { downloadedBytes, fetchedResources, writtenResources };
  }

  for (let start = 0; start < resources.length; start += workerCount) {
    throwIfAborted(signal);
    const batch = resources.slice(start, start + workerCount);
    const results = await Promise.all(
      batch.map(async (resource) => {
        const bytes = await fetchWithRetry(resource, {
          retries,
          fetchResource,
          signal,
          retryDelay,
        });
        fetchedResources += 1;
        downloadedBytes += bytes.byteLength;
        onProgress({
          phase: "download",
          fetchedResources,
          writtenResources,
          totalResources: resources.length,
          downloadedBytes,
        });
        return { resource, bytes };
      }),
    );

    for (const { resource, bytes } of results) {
      throwIfAborted(signal);
      await writeResource(bytes, resource);
      writtenResources += 1;
      onProgress({
        phase: "write",
        fetchedResources,
        writtenResources,
        totalResources: resources.length,
        downloadedBytes,
      });
    }
  }

  return { downloadedBytes, fetchedResources, writtenResources };
}

async function fetchWithRetry(
  resource,
  { retries, fetchResource, signal, retryDelay },
) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted(signal);
    try {
      return toUint8Array(await fetchResource(resource, signal));
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      if (error?.retryable === false) throw error;
      lastError = error;
      if (attempt < retries) await retryDelay(attempt + 1, signal);
    }
  }
  throw lastError || new Error("[ParallelDownload] Resource failed.");
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("[ParallelDownload] Fetcher must return binary data.");
}

function clampConcurrency(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return 8;
  return Math.min(MAX_CONCURRENCY, Math.max(1, number));
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason || new DOMException("Download cancelled.", "AbortError");
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function defaultRetryDelay(attempt, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, 300 * 3 ** (attempt - 1));
    if (!signal) return;
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason || new DOMException("Cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}
