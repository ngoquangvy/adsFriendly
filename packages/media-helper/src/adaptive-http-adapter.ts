import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  availableOutputPath,
  downloadDirectHttp,
  resolveOutputDirectory,
  sanitizeFilename,
} from "./direct-http-adapter.js";
import type {
  AdaptiveHttpTrack,
  DownloadAdapter,
  DownloadContext,
  DownloadJob,
  DownloadProgress,
  DownloadResult,
} from "./download-types.js";
import { resolveYouTubePlayerTrack } from "./youtube-player-js-resolver.js";

export const adaptiveHttpAdapter: DownloadAdapter = Object.freeze({
  id: "adaptive-http",
  supports: (candidate) => candidate.kind === "adaptive",
  execute: downloadAdaptiveHttp,
});

async function downloadAdaptiveHttp(
  job: DownloadJob,
  context: DownloadContext,
): Promise<DownloadResult> {
  let video = selectTrack(job.candidate.variants, "video", job);
  let audio = selectTrack(job.candidate.audioTracks, "audio", job);
  if (!video || !audio) {
    throw new Error("Resolved adaptive video and audio tracks are required.");
  }
  if (
    video.urlResolution === "n_transform_pending" ||
    audio.urlResolution === "n_transform_pending"
  ) {
    context.progress({
      phase: "probing",
      stage: "compatibility_check",
      downloadedBytes: 0,
      totalBytes:
        video.contentLength && audio.contentLength
          ? video.contentLength + audio.contentLength
          : null,
      bytesPerSecond: 0,
      resumable: false,
      resumedBytes: 0,
      duration: job.candidate.duration,
    });
    [video, audio] = await Promise.all([
      resolveYouTubePlayerTrack(video, job.candidate),
      resolveYouTubePlayerTrack(audio, job.candidate),
    ]);
  }

  const outputDirectory = resolveOutputDirectory(job.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const extension = job.output.container === "mkv" ? ".mkv" : ".mp4";
  const filename = sanitizeFilename(
    job.candidate.title || "video",
    extension,
  ).replace(/\.[a-z0-9]{1,6}$/i, extension);
  const outputPath = await availableOutputPath(outputDirectory, filename);
  const partialPath = `${outputPath}.${safeId(job.jobId)}.part${extension}`;
  const cacheDirectory = await mkdtemp(
    join(outputDirectory, ".adsfriendly-adaptive-"),
  );
  const progress = new Map<string, DownloadProgress>();
  const startedAt = Date.now();
  const audioConnections = job.connections >= 4 ? 2 : 1;
  const videoConnections = Math.max(1, job.connections - audioConnections);
  const update = (key: string, value: DownloadProgress) => {
    progress.set(key, value);
    const values = [...progress.values()];
    const downloadedBytes = values.reduce(
      (total, item) => total + (item.downloadedBytes || 0),
      0,
    );
    const knownTotals = values.map((item) => item.totalBytes);
    const totalBytes =
      values.length === 2 && knownTotals.every(Number.isFinite)
        ? knownTotals.reduce((total, value) => total + Number(value), 0)
        : null;
    context.progress({
      phase: values.some((item) => item.phase === "downloading")
        ? "downloading"
        : "probing",
      stage: "segment_download",
      downloadedBytes,
      totalBytes,
      bytesPerSecond: Math.round(
        downloadedBytes / Math.max(0.001, (Date.now() - startedAt) / 1000),
      ),
      // The first adapter version uses an isolated cache per attempt. Keep the
      // UI honest until that cache receives a stable resume contract.
      resumable: false,
      resumedBytes: 0,
      duration: job.candidate.duration,
    });
  };

  try {
    await unlink(partialPath).catch(() => {});
    const downloadVideo = () =>
      downloadDirectHttp(
        directTrackJob(
          job,
          video,
          "video-track",
          cacheDirectory,
          videoConnections,
        ),
        childContext(context, (value) => update("video", value)),
      );
    const downloadAudio = () =>
      downloadDirectHttp(
        directTrackJob(
          job,
          audio,
          "audio-track",
          cacheDirectory,
          audioConnections,
        ),
        childContext(context, (value) => update("audio", value)),
      );
    const [videoResult, audioResult] =
      job.connections === 1
        ? [await downloadVideo(), await downloadAudio()]
        : await Promise.all([downloadVideo(), downloadAudio()]);
    context.progress({
      phase: "finalizing",
      stage: "local_processing",
      downloadedBytes:
        (videoResult.totalBytes || 0) + (audioResult.totalBytes || 0),
      totalBytes:
        videoResult.totalBytes !== null && audioResult.totalBytes !== null
          ? videoResult.totalBytes + audioResult.totalBytes
          : null,
      bytesPerSecond: 0,
      resumable: false,
      resumedBytes: 0,
      duration: job.candidate.duration,
    });
    await muxTracks(
      videoResult.outputPath,
      audioResult.outputPath,
      partialPath,
      job,
      context.signal,
    );
    await rename(partialPath, outputPath);
    const output = await stat(outputPath);
    return { outputPath, totalBytes: output.size, resumedBytes: 0 };
  } finally {
    await unlink(partialPath).catch(() => {});
    await rm(cacheDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

function selectTrack(
  tracks: AdaptiveHttpTrack[],
  type: "video" | "audio",
  job: DownloadJob,
) {
  const preferMp4 = job.output.container !== "mkv";
  return [...(tracks || [])]
    .filter((track) => track.type === type && track.sourceUrl)
    .sort(
      (left, right) =>
        (preferMp4 ? mp4Score(right) - mp4Score(left) : 0) ||
        (right.height || 0) - (left.height || 0) ||
        (right.averageBandwidth || right.bandwidth || 0) -
          (left.averageBandwidth || left.bandwidth || 0) ||
        (right.contentLength || 0) - (left.contentLength || 0),
    )[0];
}

function mp4Score(track: AdaptiveHttpTrack) {
  return /\/(?:mp4|m4a)(?:$|;)/i.test(track.mimeType || "") ? 1 : 0;
}

function directTrackJob(
  job: DownloadJob,
  track: AdaptiveHttpTrack,
  title: string,
  outputDirectory: string,
  connections: number,
): DownloadJob {
  return {
    ...job,
    jobId: `${job.jobId}-${track.type}`,
    connections,
    outputDirectory,
    output: { profileId: "source", container: "source", extension: null },
    candidate: {
      ...job.candidate,
      kind: "direct",
      sourceUrl: track.sourceUrl,
      manifestUrl: null,
      title,
      mimeType: track.mimeType,
      variants: [],
      audioTracks: [],
    },
  };
}

function childContext(
  parent: DownloadContext,
  progress: (value: DownloadProgress) => void,
): DownloadContext {
  return { signal: parent.signal, progress, strategy: parent.strategy };
}

function muxTracks(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  job: DownloadJob,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "warning",
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c",
      "copy",
      ...(job.output.container === "mkv" ? [] : ["-movflags", "+faststart"]),
      outputPath,
    ];
    const child = spawn("ffmpeg", args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const errors: Buffer[] = [];
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk: Buffer) => {
      errors.push(chunk);
      while (Buffer.concat(errors).byteLength > 64 * 1024) errors.shift();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        reject(signal.reason || new Error("Download cancelled."));
        return;
      }
      if (code === 0) resolve();
      else {
        const detail = Buffer.concat(errors).toString("utf8").trim();
        reject(
          new Error(
            `FFmpeg could not mux the resolved video and audio tracks${detail ? `: ${detail}` : "."}`,
          ),
        );
      }
    });
  });
}

function safeId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || "download";
}
