var AdsFriendlyDownload = (() => {
  // src/media/download-job-contract.js
  var DOWNLOAD_JOB_PREFIX = "adsfriendly.mediaDownloadJob.";
  var DOWNLOAD_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
  function normalizeMediaDownloadJob(value = {}) {
    const candidate = value.candidate;
    if (!candidate || candidate.kind !== "hls") {
      throw new Error("[MediaDownload] Only HLS candidates are supported.");
    }
    return {
      id: requiredString(value.id, "id"),
      createdAt: finiteNumber(value.createdAt, "createdAt"),
      sourceTabId: nonNegativeInteger(value.sourceTabId, "sourceTabId"),
      candidate: {
        id: requiredString(candidate.id, "candidate.id"),
        pageUrl: requiredString(candidate.pageUrl, "candidate.pageUrl"),
        manifestUrl: requiredHttpUrl(
          candidate.manifestUrl,
          "candidate.manifestUrl"
        ),
        kind: "hls",
        title: optionalString(candidate.title),
        probeStatus: candidate.probeStatus,
        playlistType: candidate.playlistType,
        streamType: candidate.streamType,
        drm: candidate.drm || "none",
        encryptionMethods: stringArray(candidate.encryptionMethods),
        variants: objectArray(candidate.variants),
        audioTracks: objectArray(candidate.audioTracks),
        subtitles: objectArray(candidate.subtitles),
        duration: optionalFiniteNumber(candidate.duration),
        segmentCount: optionalNonNegativeInteger(candidate.segmentCount)
      }
    };
  }
  function downloadJobKey(jobId) {
    return `${DOWNLOAD_JOB_PREFIX}${requiredString(jobId, "jobId")}`;
  }
  function requiredString(value, field) {
    if (typeof value !== "string" || !value.trim())
      throw new Error(`[MediaDownload] ${field} is required.`);
    return value;
  }
  function requiredHttpUrl(value, field) {
    const url = requiredString(value, field);
    try {
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
    } catch {
      throw new Error(`[MediaDownload] ${field} must be an HTTP(S) URL.`);
    }
    return url;
  }
  function finiteNumber(value, field) {
    const number = Number(value);
    if (!Number.isFinite(number))
      throw new Error(`[MediaDownload] ${field} must be finite.`);
    return number;
  }
  function nonNegativeInteger(value, field) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0)
      throw new Error(`[MediaDownload] ${field} must be non-negative.`);
    return number;
  }
  function optionalString(value) {
    return typeof value === "string" && value ? value : null;
  }
  function optionalFiniteNumber(value) {
    if (value === null || value === void 0) return null;
    return finiteNumber(value, "optional number");
  }
  function optionalNonNegativeInteger(value) {
    if (value === null || value === void 0) return null;
    return nonNegativeInteger(value, "optional integer");
  }
  function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, 20) : [];
  }
  function objectArray(value) {
    return Array.isArray(value) ? value.filter((item) => item && typeof item === "object").slice(0, 100).map((item) => ({ ...item })) : [];
  }

  // src/media/hls-parser.js
  var MAX_MANIFEST_LENGTH = 2 * 1024 * 1024;
  var MAX_LINES = 2e4;
  var MAX_VARIANTS = 100;
  var MAX_TRACKS = 100;
  function parseHlsManifest(manifestUrl, body) {
    const source = typeof body === "string" ? body.replace(/^\uFEFF/, "") : "";
    if (!source.trimStart().startsWith("#EXTM3U")) {
      return unsupported("not_hls_manifest");
    }
    if (source.length > MAX_MANIFEST_LENGTH) {
      return unsupported("manifest_too_large");
    }
    const lines = source.split(/\r?\n/).map((line) => line.trim());
    if (lines.length > MAX_LINES) return unsupported("too_many_manifest_lines");
    try {
      const variants = [];
      const audioTracks = [];
      const subtitles = [];
      const encryptionMethods = /* @__PURE__ */ new Set();
      let pendingVariant = null;
      let segmentCount = 0;
      let duration = 0;
      let targetDuration = null;
      let hasEndList = false;
      let declaredPlaylistType = null;
      for (const line of lines) {
        if (!line) continue;
        if (pendingVariant && !line.startsWith("#")) {
          if (variants.length < MAX_VARIANTS) {
            variants.push(normalizeVariant(pendingVariant, line, manifestUrl));
          }
          pendingVariant = null;
          continue;
        }
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          pendingVariant = parseAttributeList(valueAfterColon(line));
          continue;
        }
        if (line.startsWith("#EXT-X-MEDIA:")) {
          const track = normalizeTrack(
            parseAttributeList(valueAfterColon(line)),
            manifestUrl
          );
          if (!track) continue;
          if (track.type === "audio" && audioTracks.length < MAX_TRACKS)
            audioTracks.push(track);
          if (track.type === "subtitles" && subtitles.length < MAX_TRACKS)
            subtitles.push(track);
          continue;
        }
        if (line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-SESSION-KEY:")) {
          const method = parseAttributeList(valueAfterColon(line)).METHOD;
          if (method && method.toUpperCase() !== "NONE")
            encryptionMethods.add(method.toUpperCase());
          continue;
        }
        if (line.startsWith("#EXTINF:")) {
          const value = Number(valueAfterColon(line).split(",", 1)[0]);
          if (Number.isFinite(value) && value >= 0) duration += value;
          segmentCount += 1;
          continue;
        }
        if (line.startsWith("#EXT-X-TARGETDURATION:")) {
          const value = Number(valueAfterColon(line));
          if (Number.isFinite(value) && value >= 0) targetDuration = value;
          continue;
        }
        if (line === "#EXT-X-ENDLIST") {
          hasEndList = true;
          continue;
        }
        if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
          declaredPlaylistType = valueAfterColon(line).toUpperCase();
        }
      }
      const playlistType = variants.length ? "master" : "media";
      const streamType = playlistType === "master" ? null : hasEndList || declaredPlaylistType === "VOD" ? "vod" : "live";
      const methods = [...encryptionMethods];
      return {
        status: "ready",
        error: null,
        playlistType,
        streamType,
        variants,
        audioTracks,
        subtitles,
        duration: playlistType === "media" ? round(duration, 3) : null,
        targetDuration: playlistType === "media" ? targetDuration : null,
        segmentCount: playlistType === "media" ? segmentCount : null,
        encryptionMethods: methods,
        drm: methods.some(isDrmLikeMethod) ? "suspected" : "none"
      };
    } catch (error) {
      return {
        ...unsupported("manifest_parse_failed"),
        status: "failed",
        error: error?.message || "Could not parse HLS manifest."
      };
    }
  }
  function parseHlsAttributeList(value = "") {
    return parseAttributeList(value);
  }
  function normalizeVariant(attributes, uri, manifestUrl) {
    const bandwidth = optionalPositiveNumber(attributes.BANDWIDTH);
    const averageBandwidth = optionalPositiveNumber(
      attributes["AVERAGE-BANDWIDTH"]
    );
    return {
      id: stableVariantId(uri, bandwidth, attributes.RESOLUTION),
      url: resolveUrl(uri, manifestUrl),
      bandwidth,
      averageBandwidth,
      resolution: parseResolution(attributes.RESOLUTION),
      codecs: optionalText(attributes.CODECS),
      frameRate: optionalPositiveNumber(attributes["FRAME-RATE"]),
      audioGroup: optionalText(attributes.AUDIO),
      subtitlesGroup: optionalText(attributes.SUBTITLES)
    };
  }
  function normalizeTrack(attributes, manifestUrl) {
    const type = String(attributes.TYPE || "").toLowerCase();
    if (!["audio", "subtitles"].includes(type)) return null;
    const name = optionalText(attributes.NAME);
    const groupId = optionalText(attributes["GROUP-ID"]);
    return {
      id: stableVariantId(attributes.URI || name || type, null, groupId),
      type,
      groupId,
      name,
      language: optionalText(attributes.LANGUAGE),
      url: attributes.URI ? resolveUrl(attributes.URI, manifestUrl) : null,
      default: yesNo(attributes.DEFAULT),
      autoselect: yesNo(attributes.AUTOSELECT),
      forced: yesNo(attributes.FORCED),
      channels: optionalText(attributes.CHANNELS)
    };
  }
  function parseAttributeList(value) {
    const attributes = {};
    let index = 0;
    while (index < value.length) {
      while (value[index] === "," || /\s/.test(value[index] || "")) index++;
      const equals = value.indexOf("=", index);
      if (equals < 0) break;
      const key = value.slice(index, equals).trim().toUpperCase();
      index = equals + 1;
      let parsed = "";
      if (value[index] === '"') {
        index++;
        while (index < value.length) {
          const character = value[index++];
          if (character === '"') break;
          parsed += character;
        }
      } else {
        const comma = value.indexOf(",", index);
        const end = comma < 0 ? value.length : comma;
        parsed = value.slice(index, end).trim();
        index = end;
      }
      if (key) attributes[key] = parsed;
      while (index < value.length && value[index] !== ",") index++;
      if (value[index] === ",") index++;
    }
    return attributes;
  }
  function parseResolution(value) {
    const match = /^(\d+)x(\d+)$/i.exec(String(value || "").trim());
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  function unsupported(error) {
    return {
      status: "unsupported",
      error,
      playlistType: null,
      streamType: null,
      variants: [],
      audioTracks: [],
      subtitles: [],
      duration: null,
      targetDuration: null,
      segmentCount: null,
      encryptionMethods: [],
      drm: "none"
    };
  }
  function isDrmLikeMethod(method) {
    return method.startsWith("SAMPLE-AES");
  }
  function valueAfterColon(line) {
    return line.slice(line.indexOf(":") + 1);
  }
  function resolveUrl(value, baseUrl) {
    try {
      return new URL(value, baseUrl).href;
    } catch {
      return value;
    }
  }
  function optionalPositiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }
  function optionalText(value) {
    return typeof value === "string" && value ? value : null;
  }
  function yesNo(value) {
    return String(value || "").toUpperCase() === "YES";
  }
  function round(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }
  function stableVariantId(...parts) {
    const input = parts.filter((part) => part !== null).join(":");
    let hash = 2166136261;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `stream-${(hash >>> 0).toString(36)}`;
  }

  // src/media/hls-download-plan.js
  var MAX_DOWNLOAD_RESOURCES = 1e4;
  function createHlsDownloadPlan(manifestUrl, body) {
    const summary = parseHlsManifest(manifestUrl, body);
    if (summary.status !== "ready") {
      return unsupported2(summary.error || "manifest_not_ready", summary);
    }
    if (summary.playlistType === "master") {
      return {
        status: "variant_required",
        reason: null,
        summary,
        resources: []
      };
    }
    if (summary.streamType !== "vod")
      return unsupported2("live_not_supported", summary);
    if (summary.drm !== "none") return unsupported2("drm_suspected", summary);
    if (summary.encryptionMethods.length)
      return unsupported2("encrypted_not_supported", summary);
    const lines = String(body).replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim());
    const resources = [];
    let currentMap = null;
    let emittedMapKey = null;
    let pendingDuration = null;
    let pendingByteRange = null;
    let previousRangeUrl = null;
    let previousRangeEnd = 0;
    let discontinuityCount = 0;
    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith("#EXT-X-MAP:")) {
        const attributes = parseHlsAttributeList(valueAfterColon2(line));
        if (!attributes.URI) return unsupported2("invalid_init_map", summary);
        const url2 = resolveUrl2(attributes.URI, manifestUrl);
        currentMap = {
          kind: "init",
          url: url2,
          byteRange: parseByteRange(attributes.BYTERANGE, 0),
          duration: 0
        };
        continue;
      }
      if (line.startsWith("#EXT-X-BYTERANGE:")) {
        pendingByteRange = valueAfterColon2(line);
        continue;
      }
      if (line === "#EXT-X-DISCONTINUITY") {
        discontinuityCount += 1;
        continue;
      }
      if (line.startsWith("#EXTINF:")) {
        const value = Number(valueAfterColon2(line).split(",", 1)[0]);
        pendingDuration = Number.isFinite(value) && value >= 0 ? value : 0;
        continue;
      }
      if (line.startsWith("#") || pendingDuration === null) continue;
      const url = resolveUrl2(line, manifestUrl);
      if (currentMap) {
        const mapKey = resourceKey(currentMap);
        if (mapKey !== emittedMapKey) {
          resources.push({ ...currentMap, index: resources.length });
          emittedMapKey = mapKey;
        }
      }
      const implicitOffset = previousRangeUrl === url ? previousRangeEnd : 0;
      const byteRange = parseByteRange(pendingByteRange, implicitOffset);
      if (byteRange) {
        previousRangeUrl = url;
        previousRangeEnd = byteRange.offset + byteRange.length;
      } else {
        previousRangeUrl = null;
        previousRangeEnd = 0;
      }
      resources.push({
        index: resources.length,
        kind: "segment",
        url,
        byteRange,
        duration: pendingDuration
      });
      if (resources.length > MAX_DOWNLOAD_RESOURCES)
        return unsupported2("too_many_segments", summary);
      pendingDuration = null;
      pendingByteRange = null;
    }
    if (discontinuityCount)
      return unsupported2("discontinuity_not_supported", summary);
    const segmentCount = resources.filter(
      (resource) => resource.kind === "segment"
    ).length;
    if (!segmentCount) return unsupported2("no_segments", summary);
    const fragmentedMp4 = resources.some(
      (resource) => resource.kind === "init" || /\.(m4s|mp4)(?:$|[?#])/i.test(resource.url)
    );
    return {
      status: "ready",
      reason: null,
      summary,
      resources,
      segmentCount,
      outputExtension: fragmentedMp4 ? "mp4" : "ts",
      outputMimeType: fragmentedMp4 ? "video/mp4" : "video/mp2t"
    };
  }
  function unsupported2(reason, summary) {
    return { status: "unsupported", reason, summary, resources: [] };
  }
  function parseByteRange(value, implicitOffset) {
    if (!value) return null;
    const match = /^(\d+)(?:@(\d+))?$/.exec(String(value).trim());
    if (!match) throw new Error("[HLS Download] Invalid byte range.");
    const length = Number(match[1]);
    const offset = match[2] === void 0 ? implicitOffset : Number(match[2]);
    if (!Number.isSafeInteger(length) || length <= 0)
      throw new Error("[HLS Download] Invalid byte-range length.");
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error("[HLS Download] Invalid byte-range offset.");
    return { offset, length };
  }
  function valueAfterColon2(line) {
    return line.slice(line.indexOf(":") + 1);
  }
  function resolveUrl2(value, baseUrl) {
    try {
      const url = new URL(value, baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      return url.href;
    } catch {
      throw new Error("[HLS Download] Resource URL must be HTTP(S).");
    }
  }
  function resourceKey(resource) {
    return `${resource.url}:${resource.byteRange?.offset ?? ""}:${resource.byteRange?.length ?? ""}`;
  }

  // src/media/parallel-downloader.js
  var MAX_CONCURRENCY = 16;
  async function downloadResourcesInParallel(resources, {
    concurrency = 8,
    retries = 2,
    fetchResource,
    writeResource,
    onProgress = () => {
    },
    signal = null,
    retryDelay = defaultRetryDelay
  } = {}) {
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
    for (let start = 0; start < resources.length; start += workerCount) {
      throwIfAborted(signal);
      const batch = resources.slice(start, start + workerCount);
      const results = await Promise.all(
        batch.map(async (resource) => {
          const bytes = await fetchWithRetry(resource, {
            retries,
            fetchResource,
            signal,
            retryDelay
          });
          fetchedResources += 1;
          downloadedBytes += bytes.byteLength;
          onProgress({
            phase: "download",
            fetchedResources,
            writtenResources,
            totalResources: resources.length,
            downloadedBytes
          });
          return { resource, bytes };
        })
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
          downloadedBytes
        });
      }
    }
    return { downloadedBytes, fetchedResources, writtenResources };
  }
  async function fetchWithRetry(resource, { retries, fetchResource, signal, retryDelay }) {
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
        { once: true }
      );
    });
  }

  // src/download/index.js
  var sourceElement = document.getElementById("source");
  var statusElement = document.getElementById("status");
  var progressElement = document.getElementById("progress");
  var resourceProgress = document.getElementById("resource-progress");
  var speedElement = document.getElementById("speed");
  var qualityField = document.getElementById("quality-field");
  var qualitySelect = document.getElementById("quality-select");
  var concurrencySelect = document.getElementById("concurrency-select");
  var startButton = document.getElementById("start-button");
  var cancelButton = document.getElementById("cancel-button");
  var job = null;
  var plan = null;
  var selectedVariant = null;
  var planRequest = 0;
  var downloadController = null;
  initialize().catch((error) => showError(error));
  qualitySelect.addEventListener("change", () => preparePlan());
  startButton.addEventListener("click", () => startDownload());
  cancelButton.addEventListener("click", () => {
    downloadController?.abort(
      new DOMException("Download cancelled by user.", "AbortError")
    );
  });
  async function initialize() {
    const jobId = new URLSearchParams(location.search).get("job");
    if (!jobId) throw new Error("Missing download job ID.");
    const key = downloadJobKey(jobId);
    const snapshot = await chrome.storage.session.get(key);
    job = normalizeMediaDownloadJob(snapshot[key]);
    sourceElement.textContent = job.candidate.manifestUrl;
    sourceElement.title = job.candidate.manifestUrl;
    concurrencySelect.value = suggestedConcurrency();
    configureVariants();
    await preparePlan();
  }
  function configureVariants() {
    const variants = [...job.candidate.variants].sort(compareVariantQuality);
    if (job.candidate.playlistType !== "master" || !variants.length) return;
    qualityField.hidden = false;
    qualitySelect.replaceChildren(
      ...variants.map((variant) => {
        const option = document.createElement("option");
        option.value = variant.id;
        option.textContent = variantLabel(variant);
        return option;
      })
    );
  }
  async function preparePlan() {
    const requestId = ++planRequest;
    plan = null;
    startButton.disabled = true;
    setStatus("Reading media playlist\u2026");
    selectedVariant = selectedQualityVariant();
    const separateAudio = selectedVariant?.audioGroup ? job.candidate.audioTracks.some(
      (track) => track.groupId === selectedVariant.audioGroup && Boolean(track.url)
    ) : false;
    if (separateAudio) {
      setStatus("This quality uses a separate audio playlist.", "error");
      return;
    }
    const manifestUrl = selectedVariant?.url || job.candidate.manifestUrl;
    try {
      const response = await fetch(manifestUrl, {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) throw httpError(response.status);
      const body = await response.text();
      if (requestId !== planRequest) return;
      const nextPlan = createHlsDownloadPlan(response.url || manifestUrl, body);
      if (nextPlan.status !== "ready") {
        setStatus(downloadReason(nextPlan.reason), "error");
        return;
      }
      plan = nextPlan;
      progressElement.max = plan.resources.length;
      progressElement.value = 0;
      resourceProgress.textContent = `0 / ${plan.resources.length} resources`;
      setStatus(
        `${plan.segmentCount} segments ready \xB7 output .${plan.outputExtension}`
      );
      startButton.disabled = false;
    } catch (error) {
      if (requestId !== planRequest) return;
      showError(error);
    }
  }
  async function startDownload() {
    if (!plan || downloadController) return;
    let output = null;
    try {
      output = await createOutputSink(suggestedFilename());
    } catch (error) {
      if (error?.name !== "AbortError") showError(error);
      return;
    }
    downloadController = new AbortController();
    startButton.disabled = true;
    cancelButton.disabled = false;
    qualitySelect.disabled = true;
    concurrencySelect.disabled = true;
    const startedAt = performance.now();
    try {
      const result = await downloadResourcesInParallel(plan.resources, {
        concurrency: Number(concurrencySelect.value),
        retries: 2,
        signal: downloadController.signal,
        fetchResource: fetchBinaryResource,
        writeResource: output.write,
        onProgress(progress) {
          progressElement.value = progress.writtenResources;
          resourceProgress.textContent = `${progress.writtenResources} / ${progress.totalResources} resources`;
          const seconds = Math.max((performance.now() - startedAt) / 1e3, 0.1);
          speedElement.textContent = `${formatBytes(
            progress.downloadedBytes
          )} \xB7 ${formatBytes(progress.downloadedBytes / seconds)}/s`;
          setStatus(
            progress.phase === "write" ? "Writing segments in playlist order\u2026" : "Downloading parallel segment batch\u2026"
          );
        }
      });
      await output.close();
      await chrome.storage.session.remove(downloadJobKey(job.id));
      progressElement.value = plan.resources.length;
      setStatus(
        `Saved ${formatBytes(result.downloadedBytes)} successfully.`,
        "success"
      );
    } catch (error) {
      if (!downloadController.signal.aborted) downloadController.abort(error);
      await output.abort(error).catch(() => {
      });
      if (error?.name === "AbortError")
        setStatus("Download cancelled. You can start again.", "error");
      else showError(error);
    } finally {
      downloadController = null;
      startButton.disabled = !plan;
      cancelButton.disabled = true;
      qualitySelect.disabled = false;
      concurrencySelect.disabled = false;
    }
  }
  async function fetchBinaryResource(resource, signal) {
    const headers = new Headers();
    if (resource.byteRange) {
      const { offset, length } = resource.byteRange;
      headers.set("Range", `bytes=${offset}-${offset + length - 1}`);
    }
    const response = await fetch(resource.url, {
      headers,
      signal,
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) throw httpError(response.status);
    if (resource.byteRange && response.status !== 206) {
      const error = new Error("Server ignored the required byte-range request.");
      error.retryable = false;
      throw error;
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  async function createOutputSink(filename) {
    if (typeof globalThis.showSaveFilePicker === "function") {
      const handle = await globalThis.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "Video file",
            accept: { [plan.outputMimeType]: [`.${plan.outputExtension}`] }
          }
        ]
      });
      const writable = await handle.createWritable();
      return {
        write: (bytes) => writable.write(bytes),
        close: () => writable.close(),
        abort: (reason) => writable.abort(reason)
      };
    }
    const parts = [];
    return {
      async write(bytes) {
        parts.push(bytes);
      },
      async close() {
        const url = URL.createObjectURL(
          new Blob(parts, { type: plan.outputMimeType })
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 6e4);
      },
      async abort() {
        parts.length = 0;
      }
    };
  }
  function selectedQualityVariant() {
    if (job.candidate.playlistType !== "master") return null;
    return job.candidate.variants.find(
      (variant) => variant.id === qualitySelect.value
    ) || job.candidate.variants[0] || null;
  }
  function suggestedConcurrency() {
    const cores = Number(navigator.hardwareConcurrency) || 4;
    if (cores >= 12) return "16";
    if (cores >= 8) return "12";
    return cores >= 4 ? "8" : "4";
  }
  function suggestedFilename() {
    const base = (job.candidate.title || "adsfriendly-video").replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
    const quality = selectedVariant?.resolution?.height ? `-${selectedVariant.resolution.height}p` : "";
    return `${base || "adsfriendly-video"}${quality}.${plan.outputExtension}`;
  }
  function compareVariantQuality(left, right) {
    return (right.resolution?.height || 0) - (left.resolution?.height || 0) || (right.averageBandwidth || right.bandwidth || 0) - (left.averageBandwidth || left.bandwidth || 0);
  }
  function variantLabel(variant) {
    const height = variant.resolution?.height;
    const bandwidth = variant.averageBandwidth || variant.bandwidth;
    const quality = height ? `${height}p` : "Unknown quality";
    return Number.isFinite(bandwidth) ? `${quality} \xB7 ${(bandwidth / 1e6).toFixed(1)} Mbps` : quality;
  }
  function downloadReason(reason) {
    const messages = {
      live_not_supported: "Live HLS is not supported yet.",
      drm_suspected: "DRM-protected HLS cannot be downloaded.",
      encrypted_not_supported: "Encrypted HLS is not supported yet.",
      discontinuity_not_supported: "This playlist changes stream format at a discontinuity.",
      no_segments: "No downloadable media segments were found.",
      too_many_segments: "This playlist has too many segments for this version."
    };
    return messages[reason] || `Download preflight failed: ${reason || "unknown"}.`;
  }
  function httpError(status) {
    const error = new Error(`Media server returned HTTP ${status}.`);
    error.retryable = status === 408 || status === 429 || status >= 500;
    return error;
  }
  function formatBytes(value) {
    if (!Number.isFinite(value) || value <= 0) return "0 MB";
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
  }
  function setStatus(message, type = "") {
    statusElement.textContent = message;
    statusElement.className = `status${type ? ` ${type}` : ""}`;
  }
  function showError(error) {
    console.error("[AdsFriendly Download]", error);
    setStatus(error?.message || String(error), "error");
  }
})();
