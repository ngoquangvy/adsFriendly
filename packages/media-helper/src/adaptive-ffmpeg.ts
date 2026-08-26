import { spawn } from "node:child_process";
import { stat, unlink } from "node:fs/promises";
import type {
  DownloadContext,
  DownloadJob,
  DownloadProgress,
} from "./download-types.js";

const PROGRESS_INTERVAL_MS = 200;
const FFMPEG_START_TIMEOUT_MS = configuredTimeout(
  "ADSFRIENDLY_HELPER_FFMPEG_START_TIMEOUT_MS",
  30_000,
);
const COMPATIBILITY_TIMEOUT_MS = configuredTimeout(
  "ADSFRIENDLY_HELPER_COMPATIBILITY_TIMEOUT_MS",
  20_000,
);

export async function runAdaptiveFfmpeg(
  job: DownloadJob,
  manifestUrl: string,
  partialPath: string,
  context: DownloadContext,
  formatName: string,
) {
  if (context.signal.aborted) {
    throw context.signal.reason || new Error("Download cancelled.");
  }
  context.progress(emptyAdaptiveProgress("probing", "ffmpeg_start"));
  const headers = adaptiveRequestHeaders(job);
  const outputSpec = adaptiveOutputSpec(job);
  const networkInput = /^https?:\/\//i.test(manifestUrl);
  const args = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-stats_period",
    "0.2",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto",
    ...(networkInput
      ? [
          "-user_agent",
          headers["User-Agent"],
          "-headers",
          `Referer: ${headers.Referer}\r\nOrigin: ${headers.Origin}\r\n`,
        ]
      : []),
    "-allowed_extensions",
    "ALL",
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
    ...(outputSpec.container === "mp4" ? ["-movflags", "+faststart"] : []),
    "-max_muxing_queue_size",
    "4096",
    "-progress",
    "pipe:1",
    "-f",
    outputSpec.muxer,
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
  let startupError: Error | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    startupError = new Error(
      `FFmpeg did not begin receiving media within ${Math.round(FFMPEG_START_TIMEOUT_MS / 1000)} seconds. The browser session, key, or media URL may not be available to the Helper.`,
    );
    child.kill();
  }, FFMPEG_START_TIMEOUT_MS);
  const duration = job.candidate.duration;
  const abort = () => child.kill();
  context.signal.addEventListener("abort", abort, { once: true });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-32_000);
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
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
        (Number(values.out_time_us) || Number(values.out_time_ms) || 0) /
          1_000_000,
      );
      lastBytes = downloadedBytes;
      lastAt = now;
      lastProgressAt = now;
      context.progress({
        phase: networkInput ? "downloading" : "finalizing",
        stage: networkInput ? undefined : "local_processing",
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
  }).finally(() => {
    if (startupTimer) clearTimeout(startupTimer);
    context.signal.removeEventListener("abort", abort);
  });

  if (context.signal.aborted) {
    await unlink(partialPath).catch(() => {});
    throw context.signal.reason || new Error("Download cancelled.");
  }
  if (startupError) {
    await unlink(partialPath).catch(() => {});
    throw startupError;
  }
  if (exitCode !== 0) {
    await unlink(partialPath).catch(() => {});
    const detail = stderr.trim().split(/\r?\n/).slice(-3).join(" ");
    throw new Error(
      `FFmpeg could not download this ${formatName} stream${detail ? `: ${detail}` : "."}`,
    );
  }
  const output = await stat(partialPath);
  if (!output.size) throw new Error("FFmpeg produced an empty media file.");
  return { totalBytes: output.size };
}

export function adaptiveOutputExtension(job: DownloadJob) {
  return adaptiveOutputSpec(job).extension;
}

function adaptiveOutputSpec(job: DownloadJob) {
  if (job.output.container === "mkv") {
    return { container: "mkv", extension: ".mkv", muxer: "matroska" };
  }
  return { container: "mp4", extension: ".mp4", muxer: "mp4" };
}

export function adaptiveRequestHeaders(job: DownloadJob) {
  const preferred =
    job.candidate.requestContext?.referrer ||
    job.candidate.requestContext?.documentUrl ||
    job.candidate.pageUrl;
  let referer = job.candidate.pageUrl;
  try {
    const parsed = new URL(preferred);
    if (["http:", "https:"].includes(parsed.protocol)) referer = parsed.href;
  } catch {}
  let origin = "null";
  try {
    origin = new URL(referer).origin;
  } catch {}
  return {
    Referer: referer.replace(/[\r\n]/g, ""),
    Origin: origin.replace(/[\r\n]/g, ""),
    "User-Agent": "AdsFriendlyMediaHelper/0.4",
  };
}

export function emptyAdaptiveProgress(
  phase: DownloadProgress["phase"],
  stage?: DownloadProgress["stage"],
): DownloadProgress {
  return {
    phase,
    stage,
    downloadedBytes: 0,
    totalBytes: null,
    bytesPerSecond: 0,
    resumable: false,
    resumedBytes: 0,
    processedSeconds: 0,
    duration: null,
  };
}

export async function verifyAdaptiveInput(
  manifestPath: string,
  signal: AbortSignal,
  formatName: string,
) {
  if (signal.aborted) {
    throw signal.reason || new Error("Compatibility check cancelled.");
  }
  const child = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "warning",
      "-protocol_whitelist",
      "file,crypto,data",
      "-allowed_extensions",
      "ALL",
      "-i",
      manifestPath,
      "-map",
      "0:v:0?",
      "-map",
      "0:a:0?",
      "-t",
      "1",
      "-c",
      "copy",
      "-f",
      "null",
      "-",
    ],
    {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  let timeoutError: Error | null = null;
  const abort = () => child.kill();
  signal.addEventListener("abort", abort, { once: true });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-32_000);
  });
  const timer = setTimeout(() => {
    timeoutError = new Error(
      `${formatName} compatibility check timed out after ${Math.round(COMPATIBILITY_TIMEOUT_MS / 1000)} seconds.`,
    );
    child.kill();
  }, COMPATIBILITY_TIMEOUT_MS);
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? -1));
  }).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  });
  if (signal.aborted) {
    throw signal.reason || new Error("Compatibility check cancelled.");
  }
  if (timeoutError) throw timeoutError;
  if (exitCode !== 0) {
    const detail = stderr.trim().split(/\r?\n/).slice(-12).join("\n");
    throw new Error(
      `${formatName} compatibility check failed${detail ? `:\n${detail}` : "."}`,
    );
  }
}

function configuredTimeout(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 100 && value <= 120_000
    ? Math.round(value)
    : fallback;
}
