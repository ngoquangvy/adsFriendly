import { mkdir, rename, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  acquireHlsPlan,
  createHlsAcquisitionPlan,
  hlsCacheDirectory,
  removeHlsCache,
  resolveHlsMediaPlaylist,
} from "./hls-acquisition.js";
import {
  availableOutputPath,
  resolveOutputDirectory,
  sanitizeFilename,
} from "./direct-http-adapter.js";
import type {
  DownloadAdapter,
  DownloadContext,
  DownloadJob,
  DownloadResult,
} from "./download-types.js";
import {
  adaptiveOutputExtension,
  emptyAdaptiveProgress,
  runAdaptiveFfmpeg,
} from "./adaptive-ffmpeg.js";

const HLS_PREFLIGHT_TIMEOUT_MS = configuredTimeout(
  "ADSFRIENDLY_HELPER_HLS_PREFLIGHT_TIMEOUT_MS",
  30_000,
);

export const hlsFfmpegAdapter: DownloadAdapter = Object.freeze({
  id: "hls-ffmpeg",
  supports: (candidate) => candidate.kind === "hls" && !!candidate.manifestUrl,
  execute: downloadHls,
});

async function downloadHls(
  job: DownloadJob,
  context: DownloadContext,
): Promise<DownloadResult> {
  const manifestUrl = job.candidate.manifestUrl;
  if (!manifestUrl) throw new Error("HLS manifest URL is missing.");

  const outputDirectory = resolveOutputDirectory(job.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const cacheDirectory = hlsCacheDirectory(outputDirectory, job);
  const resolved = await withPreflightTimeout(context.signal, (signal) =>
    resolveHlsMediaPlaylist(
      job,
      manifestUrl,
      signal,
      job.candidate.manifestHandoff?.body || null,
      (stage) => context.progress(emptyAdaptiveProgress("probing", stage)),
    ),
  );
  const plan = createHlsAcquisitionPlan(resolved.manifestUrl, resolved.body);
  const acquisition = await acquireHlsPlan(plan, job, context, cacheDirectory);

  context.progress(emptyAdaptiveProgress("probing", "output_prepare"));
  const filename = chooseFilename(job);
  const outputPath = await availableOutputPath(outputDirectory, filename);
  const partialPath = join(
    outputDirectory,
    `.${basename(outputPath, extname(outputPath))}.${safeId(job.jobId)}.part${adaptiveOutputExtension(job)}`,
  );
  await unlink(partialPath).catch(() => {});

  const result = await runAdaptiveFfmpeg(
    job,
    acquisition.manifestPath,
    partialPath,
    context,
    "local HLS",
  );
  context.progress({
    phase: "finalizing",
    downloadedBytes: result.totalBytes || 0,
    totalBytes: result.totalBytes,
    bytesPerSecond: 0,
    resumable: false,
    resumedBytes: acquisition.resumedBytes,
    processedSeconds: job.candidate.duration,
    duration: job.candidate.duration,
  });
  await rename(partialPath, outputPath);
  await removeHlsCache(cacheDirectory);
  return {
    outputPath,
    totalBytes: result.totalBytes,
    resumedBytes: acquisition.resumedBytes,
  };
}

export function absolutizeHlsManifest(body: string, baseUrl: string) {
  return body
    .split(/\r?\n/)
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return rawLine;
      if (!line.startsWith("#")) return resolveHttpUrl(line, baseUrl);
      return rawLine.replace(
        /URI="([^"]+)"/gi,
        (_match, value) => `URI="${resolveHttpUrl(value, baseUrl)}"`,
      );
    })
    .join("\n");
}

function resolveHttpUrl(value: string, baseUrl: string) {
  const url = new URL(value, baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("HLS resources must use HTTP(S).");
  }
  return url.href;
}

function chooseFilename(job: DownloadJob) {
  const title = job.candidate.title || "video";
  const extension = adaptiveOutputExtension(job);
  return sanitizeFilename(title, extension).replace(
    /\.[a-z0-9]{1,6}$/i,
    extension,
  );
}

function safeId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || "download";
}

async function withPreflightTimeout<T>(
  parentSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const forwardAbort = () =>
    controller.abort(
      parentSignal.reason || new Error("Download cancelled by user."),
    );
  if (parentSignal.aborted) forwardAbort();
  else parentSignal.addEventListener("abort", forwardAbort, { once: true });
  const timeoutError = new Error(
    `HLS preflight timed out after ${formatTimeoutSeconds(HLS_PREFLIGHT_TIMEOUT_MS)} seconds while reading manifests.`,
  );
  const timer = setTimeout(
    () => controller.abort(timeoutError),
    HLS_PREFLIGHT_TIMEOUT_MS,
  );
  try {
    return await waitForAbort(operation(controller.signal), controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason || error;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", forwardAbort);
  }
}

function waitForAbort<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason || new Error("Download operation was cancelled."),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason || new Error("Download operation was cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function configuredTimeout(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 100 && value <= 120_000
    ? Math.round(value)
    : fallback;
}

function formatTimeoutSeconds(milliseconds: number) {
  return Number((milliseconds / 1000).toFixed(1));
}
