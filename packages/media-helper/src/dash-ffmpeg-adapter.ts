import { mkdir, rename, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parseDashManifest } from "../../../src/media/dash-parser.js";
import {
  availableOutputPath,
  fetchRemote,
  resolveOutputDirectory,
  sanitizeFilename,
  assertSafeRemoteUrl,
} from "./direct-http-adapter.js";
import {
  adaptiveOutputExtension,
  adaptiveRequestHeaders,
  emptyAdaptiveProgress,
  runAdaptiveFfmpeg,
} from "./adaptive-ffmpeg.js";
import type {
  DownloadAdapter,
  DownloadContext,
  DownloadJob,
  DownloadResult,
} from "./download-types.js";

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

export const dashFfmpegAdapter: DownloadAdapter = Object.freeze({
  id: "dash-ffmpeg",
  supports: (candidate) => candidate.kind === "dash" && !!candidate.manifestUrl,
  execute: downloadDash,
});

async function downloadDash(
  job: DownloadJob,
  context: DownloadContext,
): Promise<DownloadResult> {
  const manifestUrl = job.candidate.manifestUrl;
  if (!manifestUrl) throw new Error("DASH manifest URL is missing.");
  context.progress(emptyAdaptiveProgress("probing"));
  const finalManifestUrl = await preflightDash(
    job,
    manifestUrl,
    context.signal,
  );

  const outputDirectory = resolveOutputDirectory(job.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const extension = adaptiveOutputExtension(job);
  const filename = sanitizeFilename(
    job.candidate.title || "video",
    extension,
  ).replace(/\.[a-z0-9]{1,6}$/i, extension);
  const outputPath = await availableOutputPath(outputDirectory, filename);
  const partialPath = join(
    outputDirectory,
    `.${basename(outputPath, extname(outputPath))}.${safeId(job.jobId)}.part${extension}`,
  );
  await unlink(partialPath).catch(() => {});

  const result = await runAdaptiveFfmpeg(
    job,
    finalManifestUrl,
    partialPath,
    context,
    "DASH",
  );
  context.progress({
    phase: "finalizing",
    downloadedBytes: result.totalBytes || 0,
    totalBytes: result.totalBytes,
    bytesPerSecond: 0,
    resumable: false,
    resumedBytes: 0,
    processedSeconds: job.candidate.duration,
    duration: job.candidate.duration,
  });
  await rename(partialPath, outputPath);
  return { outputPath, totalBytes: result.totalBytes, resumedBytes: 0 };
}

async function preflightDash(
  job: DownloadJob,
  manifestUrl: string,
  signal: AbortSignal,
) {
  const response = await fetchRemote(manifestUrl, {
    method: "GET",
    headers: adaptiveRequestHeaders(job),
    signal,
  });
  if (!response.ok) {
    throw new Error(`DASH manifest returned HTTP ${response.status}.`);
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_MANIFEST_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("DASH manifest is too large.");
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error("DASH manifest is too large.");
  }
  const finalUrl = response.url || manifestUrl;
  const summary = parseDashManifest(finalUrl, body);
  if (summary.status !== "ready") {
    throw new Error("DASH endpoint did not return a usable MPD manifest.");
  }
  if (summary.streamType !== "vod") {
    throw new Error("Only completed DASH VOD manifests are supported.");
  }
  if (summary.drm !== "none" || summary.encryptionMethods.length) {
    throw new Error("Encrypted or DRM-protected DASH is not supported.");
  }
  if (!summary.variants.length && !summary.audioTracks.length) {
    throw new Error("DASH manifest exposed no media tracks.");
  }
  for (const resourceUrl of extractResourceUrls(body, finalUrl)) {
    await assertSafeRemoteUrl(resourceUrl);
  }
  return finalUrl;
}

function extractResourceUrls(body: string, manifestUrl: string) {
  const urls = [];
  for (const match of body.matchAll(
    /<BaseURL(?:\s[^>]*)?>([\s\S]*?)<\/BaseURL\s*>/gi,
  )) {
    const value = decodeXml(match[1].trim());
    if (!value) continue;
    const url = new URL(value, manifestUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error("DASH resources must use credential-free HTTP(S) URLs.");
    }
    urls.push(url.href);
  }
  for (const match of body.matchAll(
    /(?:media|initialization|sourceURL|(?:xlink:)?href)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi,
  )) {
    const value = decodeXml((match[1] || match[2] || "").trim());
    if (!value) continue;
    const url = new URL(value, manifestUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error("DASH resources must use credential-free HTTP(S) URLs.");
    }
    urls.push(url.href);
  }
  return [...new Set(urls)].slice(0, 200);
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function safeId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || "download";
}
