import { spawn } from "node:child_process";
import { stat, unlink } from "node:fs/promises";
import type {
  DownloadContext,
  DownloadJob,
  DownloadProgress,
} from "./download-types.js";

const PROGRESS_INTERVAL_MS = 200;

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
  const headers = adaptiveRequestHeaders(job);
  const args = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-stats_period",
    "0.2",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto",
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
        (Number(values.out_time_us) || Number(values.out_time_ms) || 0) /
          1_000_000,
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
    throw new Error(
      `FFmpeg could not download this ${formatName} stream${detail ? `: ${detail}` : "."}`,
    );
  }
  const output = await stat(partialPath);
  if (!output.size) throw new Error("FFmpeg produced an empty media file.");
  return { totalBytes: output.size };
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
  return {
    Referer: referer.replace(/[\r\n]/g, ""),
    "User-Agent": "AdsFriendlyMediaHelper/0.4",
  };
}

export function emptyAdaptiveProgress(
  phase: DownloadProgress["phase"],
): DownloadProgress {
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
