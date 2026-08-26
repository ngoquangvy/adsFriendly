import { mkdir, rename, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join } from "node:path";
import { parseHlsManifest } from "../../../src/media/hls-parser.js";
import { hasStrongDrmEvidence } from "../../../src/media/protection-policy.js";
import {
  assertSafeRemoteUrl,
  availableOutputPath,
  fetchRemote,
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
  adaptiveRequestHeaders,
  emptyAdaptiveProgress,
  runAdaptiveFfmpeg,
} from "./adaptive-ffmpeg.js";

const MAX_MANIFESTS = 32;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_RESOURCE_URLS = 10_000;
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
  context.progress(emptyAdaptiveProgress("probing", "manifest_fetch"));
  const finalManifestUrl = await withPreflightTimeout(
    context.signal,
    (signal) =>
      preflightManifestTree(
        job,
        manifestUrl,
        signal,
        context,
        job.candidate.manifestHandoff?.body || null,
      ),
  );

  context.progress(emptyAdaptiveProgress("probing", "output_prepare"));
  const outputDirectory = resolveOutputDirectory(job.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const filename = chooseFilename(job);
  const outputPath = await availableOutputPath(outputDirectory, filename);
  const partialPath = join(
    outputDirectory,
    `.${basename(outputPath, extname(outputPath))}.${safeId(job.jobId)}.part${adaptiveOutputExtension(job)}`,
  );
  await unlink(partialPath).catch(() => {});

  let ffmpegInput = finalManifestUrl;
  let closeTemporaryManifest: (() => Promise<void>) | null = null;
  if (job.candidate.manifestHandoff?.body) {
    const temporaryManifest = await serveTemporaryManifest(
      absolutizeHlsManifest(
        job.candidate.manifestHandoff.body,
        job.candidate.manifestHandoff.manifestUrl,
      ),
    );
    ffmpegInput = temporaryManifest.url;
    closeTemporaryManifest = temporaryManifest.close;
  }
  const result = await runAdaptiveFfmpeg(
    job,
    ffmpegInput,
    partialPath,
    context,
    "HLS",
  ).finally(() => closeTemporaryManifest?.());
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

async function serveTemporaryManifest(body: string) {
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/manifest.m3u8") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": "application/vnd.apple.mpegurl",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body, "utf8"),
    });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Could not open the temporary manifest handoff.");
  }
  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}/manifest.m3u8`,
    close: () =>
      new Promise<void>((resolve) => {
        if (closed) return resolve();
        closed = true;
        server.close(() => resolve());
      }),
  };
}

async function preflightManifestTree(
  job: DownloadJob,
  rootUrl: string,
  signal: AbortSignal,
  context: DownloadContext,
  inlineRootBody: string | null = null,
) {
  const queue = [rootUrl];
  const visited = new Set<string>();
  const checkedResources = new Set<string>();
  const checkedHosts = new Set<string>();
  let mediaPlaylistCount = 0;
  let finalRootUrl = rootUrl;

  while (queue.length) {
    if (visited.size >= MAX_MANIFESTS) {
      throw new Error("HLS manifest tree is too large.");
    }
    const requestedUrl = queue.shift()!;
    if (visited.has(requestedUrl)) continue;
    visited.add(requestedUrl);
    context.progress(emptyAdaptiveProgress("probing", "manifest_fetch"));
    let body: string;
    let baseUrl = requestedUrl;
    if (requestedUrl === rootUrl && inlineRootBody !== null) {
      body = inlineRootBody;
    } else {
      const response = await waitForAbort(
        fetchRemote(requestedUrl, {
          method: "GET",
          headers: adaptiveRequestHeaders(job),
          signal,
        }),
        signal,
      );
      if (!response.ok) {
        throw new Error(`HLS manifest returned HTTP ${response.status}.`);
      }
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_MANIFEST_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw new Error("HLS manifest is too large.");
      }
      body = await response.text();
      baseUrl = response.url || requestedUrl;
    }
    if (Buffer.byteLength(body, "utf8") > MAX_MANIFEST_BYTES) {
      throw new Error("HLS manifest is too large.");
    }
    if (requestedUrl === rootUrl) finalRootUrl = baseUrl;
    const summary = parseHlsManifest(baseUrl, body);
    if (summary.status !== "ready" || summary.playlistType === "unknown") {
      throw new Error("HLS endpoint did not return a usable playlist.");
    }
    if (hasStrongDrmEvidence(summary)) {
      throw new Error("DRM-protected HLS is playback only.");
    }
    if (!supportsEncryption(summary)) {
      throw new Error(
        "Only unencrypted HLS, AES-128 identity keys, or SAMPLE-AES without confirmed DRM are supported.",
      );
    }

    context.progress(emptyAdaptiveProgress("probing", "resource_check"));
    for (const keyResource of extractKeyResources(body, baseUrl)) {
      await validateResource(
        keyResource,
        checkedResources,
        checkedHosts,
        signal,
      );
    }
    if (summary.playlistType === "master") {
      const references = extractMasterReferences(body, baseUrl);
      if (!references.length)
        throw new Error("HLS master has no media variants.");
      for (const reference of references) {
        await validateResource(
          reference,
          checkedResources,
          checkedHosts,
          signal,
        );
        if (!visited.has(reference)) queue.push(reference);
      }
      continue;
    }

    if (summary.streamType !== "vod" || !summary.segmentCount) {
      throw new Error("Only completed HLS VOD playlists are supported.");
    }
    mediaPlaylistCount += 1;
    for (const resource of extractMediaResources(body, baseUrl)) {
      await validateResource(resource, checkedResources, checkedHosts, signal);
    }
  }

  if (!mediaPlaylistCount)
    throw new Error("HLS master exposed no VOD playlist.");
  return finalRootUrl;
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

async function validateResource(
  value: string,
  checked: Set<string>,
  checkedHosts: Set<string>,
  signal: AbortSignal,
) {
  if (checked.has(value)) return;
  if (checked.size >= MAX_RESOURCE_URLS) {
    throw new Error("HLS playlist references too many resources.");
  }
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Only credential-free HTTP(S) HLS resources are allowed.");
  }
  if (!checkedHosts.has(url.hostname)) {
    await waitForAbort(assertSafeRemoteUrl(url.href), signal);
    checkedHosts.add(url.hostname);
  }
  checked.add(value);
}

function extractMasterReferences(body: string, baseUrl: string) {
  const references: string[] = [];
  let pendingVariant = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pendingVariant = true;
      continue;
    }
    if (pendingVariant && !line.startsWith("#")) {
      references.push(resolveHttpUrl(line, baseUrl));
      pendingVariant = false;
      continue;
    }
    if (
      line.startsWith("#EXT-X-MEDIA:") ||
      line.startsWith("#EXT-X-I-FRAME-STREAM-INF:")
    ) {
      const uri = attributeUri(line);
      if (uri) references.push(resolveHttpUrl(uri, baseUrl));
    }
  }
  return [...new Set(references)];
}

function extractMediaResources(body: string, baseUrl: string) {
  const resources: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith("#")) {
      resources.push(resolveHttpUrl(line, baseUrl));
      continue;
    }
    if (
      line.startsWith("#EXT-X-MAP:") ||
      line.startsWith("#EXT-X-PART:") ||
      line.startsWith("#EXT-X-PRELOAD-HINT:")
    ) {
      const uri = attributeUri(line);
      if (uri) resources.push(resolveHttpUrl(uri, baseUrl));
    }
  }
  return [...new Set(resources)];
}

function extractKeyResources(body: string, baseUrl: string) {
  const resources: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (
      !line.startsWith("#EXT-X-KEY:") &&
      !line.startsWith("#EXT-X-SESSION-KEY:")
    )
      continue;
    const method = line.match(/(?:^|[:,])METHOD=([^,]+)/i)?.[1]?.trim();
    if (!method || method.toUpperCase() === "NONE") continue;
    const uri = attributeUri(line);
    if (!uri) throw new Error("Encrypted HLS key URI is missing.");
    resources.push(resolveHttpUrl(uri, baseUrl));
  }
  return [...new Set(resources)];
}

function supportsEncryption(summary: ReturnType<typeof parseHlsManifest>) {
  if (!summary.encryptionMethods.length) return true;
  const supportedMethods = summary.encryptionMethods.every(
    (method) => method === "AES-128" || method.startsWith("SAMPLE-AES"),
  );
  if (!supportedMethods) return false;
  if (
    summary.encryptionMethods.some((method) => method.startsWith("SAMPLE-AES"))
  )
    return true;
  return summary.encryptionKeyFormats.every((format) => format === "identity");
}

function attributeUri(line: string) {
  return line.match(/(?:^|[:,])URI="([^"]+)"/i)?.[1] || null;
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
    `HLS preflight timed out after ${formatTimeoutSeconds(HLS_PREFLIGHT_TIMEOUT_MS)} seconds while reading manifests or checking media resources.`,
  );
  const timer = setTimeout(
    () => controller.abort(timeoutError),
    HLS_PREFLIGHT_TIMEOUT_MS,
  );
  try {
    return await operation(controller.signal);
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
