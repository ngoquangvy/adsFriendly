import {
  downloadJobKey,
  normalizeMediaDownloadJob,
} from "../media/download-job-contract.js";
import { createHlsDownloadPlan } from "../media/hls-download-plan.js";
import { downloadResourcesInParallel } from "../media/parallel-downloader.js";

const sourceElement = document.getElementById("source");
const statusElement = document.getElementById("status");
const progressElement = document.getElementById("progress");
const resourceProgress = document.getElementById("resource-progress");
const speedElement = document.getElementById("speed");
const qualityField = document.getElementById("quality-field");
const qualitySelect = document.getElementById("quality-select");
const concurrencySelect = document.getElementById("concurrency-select");
const startButton = document.getElementById("start-button");
const cancelButton = document.getElementById("cancel-button");

let job = null;
let plan = null;
let selectedVariant = null;
let planRequest = 0;
let downloadController = null;

initialize().catch((error) => showError(error));

qualitySelect.addEventListener("change", () => preparePlan());
startButton.addEventListener("click", () => startDownload());
cancelButton.addEventListener("click", () => {
  downloadController?.abort(
    new DOMException("Download cancelled by user.", "AbortError"),
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
    }),
  );
}

async function preparePlan() {
  const requestId = ++planRequest;
  plan = null;
  startButton.disabled = true;
  setStatus("Reading media playlist…");
  selectedVariant = selectedQualityVariant();
  const separateAudio = selectedVariant?.audioGroup
    ? job.candidate.audioTracks.some(
        (track) =>
          track.groupId === selectedVariant.audioGroup && Boolean(track.url),
      )
    : false;
  if (separateAudio) {
    setStatus("This quality uses a separate audio playlist.", "error");
    return;
  }
  const manifestUrl = selectedVariant?.url || job.candidate.manifestUrl;
  try {
    const response = await fetch(manifestUrl, {
      credentials: "include",
      cache: "no-store",
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
      `${plan.segmentCount} segments ready · output .${plan.outputExtension}`,
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
        resourceProgress.textContent = `${progress.writtenResources} / ${
          progress.totalResources
        } resources`;
        const seconds = Math.max((performance.now() - startedAt) / 1000, 0.1);
        speedElement.textContent = `${formatBytes(
          progress.downloadedBytes,
        )} · ${formatBytes(progress.downloadedBytes / seconds)}/s`;
        setStatus(
          progress.phase === "write"
            ? "Writing segments in playlist order…"
            : "Downloading parallel segment batch…",
        );
      },
    });
    await output.close();
    await chrome.storage.session.remove(downloadJobKey(job.id));
    progressElement.value = plan.resources.length;
    setStatus(
      `Saved ${formatBytes(result.downloadedBytes)} successfully.`,
      "success",
    );
  } catch (error) {
    if (!downloadController.signal.aborted) downloadController.abort(error);
    await output.abort(error).catch(() => {});
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
    cache: "no-store",
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
          accept: { [plan.outputMimeType]: [`.${plan.outputExtension}`] },
        },
      ],
    });
    const writable = await handle.createWritable();
    return {
      write: (bytes) => writable.write(bytes),
      close: () => writable.close(),
      abort: (reason) => writable.abort(reason),
    };
  }

  const parts = [];
  return {
    async write(bytes) {
      parts.push(bytes);
    },
    async close() {
      const url = URL.createObjectURL(
        new Blob(parts, { type: plan.outputMimeType }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    async abort() {
      parts.length = 0;
    },
  };
}

function selectedQualityVariant() {
  if (job.candidate.playlistType !== "master") return null;
  return (
    job.candidate.variants.find(
      (variant) => variant.id === qualitySelect.value,
    ) ||
    job.candidate.variants[0] ||
    null
  );
}

function suggestedConcurrency() {
  const cores = Number(navigator.hardwareConcurrency) || 4;
  if (cores >= 12) return "16";
  if (cores >= 8) return "12";
  return cores >= 4 ? "8" : "4";
}

function suggestedFilename() {
  const base = (job.candidate.title || "adsfriendly-video")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  const quality = selectedVariant?.resolution?.height
    ? `-${selectedVariant.resolution.height}p`
    : "";
  return `${base || "adsfriendly-video"}${quality}.${plan.outputExtension}`;
}

function compareVariantQuality(left, right) {
  return (
    (right.resolution?.height || 0) - (left.resolution?.height || 0) ||
    (right.averageBandwidth || right.bandwidth || 0) -
      (left.averageBandwidth || left.bandwidth || 0)
  );
}

function variantLabel(variant) {
  const height = variant.resolution?.height;
  const bandwidth = variant.averageBandwidth || variant.bandwidth;
  const quality = height ? `${height}p` : "Unknown quality";
  return Number.isFinite(bandwidth)
    ? `${quality} · ${(bandwidth / 1_000_000).toFixed(1)} Mbps`
    : quality;
}

function downloadReason(reason) {
  const messages = {
    live_not_supported: "Live HLS is not supported yet.",
    drm_suspected: "DRM-protected HLS cannot be downloaded.",
    encrypted_not_supported: "Encrypted HLS is not supported yet.",
    discontinuity_not_supported:
      "This playlist changes stream format at a discontinuity.",
    no_segments: "No downloadable media segments were found.",
    too_many_segments: "This playlist has too many segments for this version.",
  };
  return (
    messages[reason] || `Download preflight failed: ${reason || "unknown"}.`
  );
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
