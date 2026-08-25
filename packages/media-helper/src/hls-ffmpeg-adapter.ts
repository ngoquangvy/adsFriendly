import { spawn } from "node:child_process";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parseHlsManifest } from "../../../src/media/hls-parser.js";
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
  DownloadProgress,
  DownloadResult,
} from "./download-types.js";

const MAX_MANIFESTS = 32;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_RESOURCE_URLS = 10_000;
const PROGRESS_INTERVAL_MS = 200;

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
  context.progress(emptyProgress("probing"));
  const finalManifestUrl = await preflightManifestTree(
    job,
    manifestUrl,
    context.signal,
  );

  const outputDirectory = resolveOutputDirectory(job.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const filename = chooseFilename(job);
  const outputPath = await availableOutputPath(outputDirectory, filename);
  const partialPath = join(
    outputDirectory,
    `.${basename(outputPath, extname(outputPath))}.${safeId(job.jobId)}.part.mp4`,
  );
  await unlink(partialPath).catch(() => {});

  const result = await runFfmpeg(job, finalManifestUrl, partialPath, context);
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

async function preflightManifestTree(
  job: DownloadJob,
  rootUrl: string,
  signal: AbortSignal,
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
    const response = await fetchRemote(requestedUrl, {
      method: "GET",
      headers: requestHeaders(job),
      signal,
    });
    if (!response.ok) {
      throw new Error(`HLS manifest returned HTTP ${response.status}.`);
    }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_MANIFEST_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw new Error("HLS manifest is too large.");
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_MANIFEST_BYTES) {
      throw new Error("HLS manifest is too large.");
    }
    if (requestedUrl === rootUrl) finalRootUrl = response.url || requestedUrl;
    const summary = parseHlsManifest(response.url || requestedUrl, body);
    if (summary.status !== "ready" || summary.playlistType === "unknown") {
      throw new Error("HLS endpoint did not return a usable playlist.");
    }
    if (summary.drm !== "none" || summary.encryptionMethods.length) {
      throw new Error("Encrypted or DRM-protected HLS is not supported.");
    }

    const baseUrl = response.url || requestedUrl;
    if (summary.playlistType === "master") {
      const references = extractMasterReferences(body, baseUrl);
      if (!references.length) throw new Error("HLS master has no media variants.");
      for (const reference of references) {
        await validateResource(reference, checkedResources, checkedHosts);
        if (!visited.has(reference)) queue.push(reference);
      }
      continue;
    }

    if (summary.streamType !== "vod" || !summary.segmentCount) {
      throw new Error("Only completed HLS VOD playlists are supported.");
    }
    mediaPlaylistCount += 1;
    for (const resource of extractMediaResources(body, baseUrl)) {
      await validateResource(resource, checkedResources, checkedHosts);
    }
  }

  if (!mediaPlaylistCount) throw new Error("HLS master exposed no VOD playlist.");
  return finalRootUrl;
}

async function validateResource(
  value: string,
  checked: Set<string>,
  checkedHosts: Set<string>,
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
    await assertSafeRemoteUrl(url.href);
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

async function runFfmpeg(
  job: DownloadJob,
  manifestUrl: string,
  partialPath: string,
  context: DownloadContext,
) {
  if (context.signal.aborted) {
    throw context.signal.reason || new Error("Download cancelled.");
  }
  const headers = requestHeaders(job);
  const args = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-stats_period",
    "0.2",
    "-protocol_whitelist",
    "http,https,tcp,tls,crypto",
    "-user_agent",
    headers["User-Agent"],
    "-headers",
    `Referer: ${headers.Referer}\r\n`,
    "-i",
    manifestUrl,
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    "-movflags",
    "+faststart",
    "-max_muxing_queue_size",
    "4096",
    "-progress",
    "pipe:1",
    "-f",
    "mp4",
    "-y",
    partialPath,
  ];
  const child = spawn("ffmpeg", args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let lastBytes = 0;
  let lastAt = Date.now();
  let lastProgressAt = 0;
  const duration = job.candidate.duration;
  const abort = () => child.kill();
  context.signal.addEventListener("abort", abort, { once: true });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-32_000);
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    const blocks = stdout.split(/progress=(?:continue|end)\r?\n/);
    stdout = blocks.pop() || "";
    for (const block of blocks) {
      const values = Object.fromEntries(
        block
          .split(/\r?\n/)
          .map((line) => line.split("=", 2))
          .filter(([key, value]) => key && value !== undefined),
      );
      const now = Date.now();
      if (now - lastProgressAt < PROGRESS_INTERVAL_MS) continue;
      const downloadedBytes = Math.max(0, Number(values.total_size) || 0);
      const elapsed = Math.max(0.001, (now - lastAt) / 1000);
      const bytesPerSecond = Math.max(
        0,
        Math.round((downloadedBytes - lastBytes) / elapsed),
      );
      const processedSeconds = Math.max(
        0,
        (Number(values.out_time_us) || Number(values.out_time_ms) || 0) / 1_000_000,
      );
      lastBytes = downloadedBytes;
      lastAt = now;
      lastProgressAt = now;
      context.progress({
        phase: "downloading",
        downloadedBytes,
        totalBytes: null,
        bytesPerSecond,
        resumable: false,
        resumedBytes: 0,
        processedSeconds,
        duration,
      });
    }
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? -1));
  }).finally(() => context.signal.removeEventListener("abort", abort));

  if (context.signal.aborted) {
    await unlink(partialPath).catch(() => {});
    throw context.signal.reason || new Error("Download cancelled.");
  }
  if (exitCode !== 0) {
    await unlink(partialPath).catch(() => {});
    const detail = stderr.trim().split(/\r?\n/).slice(-3).join(" ");
    throw new Error(`FFmpeg could not download this HLS stream${detail ? `: ${detail}` : "."}`);
  }
  const output = await stat(partialPath);
  if (!output.size) throw new Error("FFmpeg produced an empty media file.");
  return { totalBytes: output.size };
}

function requestHeaders(job: DownloadJob) {
  const preferred =
    job.candidate.requestContext?.referrer ||
    job.candidate.requestContext?.documentUrl ||
    job.candidate.pageUrl;
  let referer = job.candidate.pageUrl;
  try {
    const parsed = new URL(preferred);
    if (["http:", "https:"].includes(parsed.protocol)) referer = parsed.href;
  } catch {}
  return {
    Referer: referer.replace(/[\r\n]/g, ""),
    "User-Agent": "AdsFriendlyMediaHelper/0.3",
  };
}

function chooseFilename(job: DownloadJob) {
  const title = job.candidate.title || "video";
  return sanitizeFilename(title, ".mp4").replace(/\.[a-z0-9]{1,6}$/i, ".mp4");
}

function safeId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || "download";
}

function emptyProgress(phase: DownloadProgress["phase"]): DownloadProgress {
  return {
    phase,
    downloadedBytes: 0,
    totalBytes: null,
    bytesPerSecond: 0,
    resumable: false,
    resumedBytes: 0,
    processedSeconds: 0,
    duration: null,
  };
}
