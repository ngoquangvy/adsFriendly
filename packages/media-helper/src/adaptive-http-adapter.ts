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
import { resolveYouTubeProviderTracks } from "./youtube-provider-resolver.js";

export const adaptiveHttpAdapter: DownloadAdapter = Object.freeze({
  id: "adaptive-http",
  supports: (candidate) => candidate.kind === "adaptive",
  execute: downloadAdaptiveHttp,
});

async function downloadAdaptiveHttp(
  job: DownloadJob,
  context: DownloadContext,
): Promise<DownloadResult> {
  if (job.output.profileId === "audio-ogg")
    return downloadAudioOnly(job, context);
  const requestedVideo = job.output.videoTrackId
    ? job.candidate.variants.find(
        (track) => track.id === job.output.videoTrackId,
      ) || null
    : null;
  if (job.output.videoTrackId && !requestedVideo)
    throw new Error("The selected video quality is no longer available.");
  const separateVideo = selectTrack(
    job.candidate.variants.filter((track) => !track.muxed),
    "video",
    job,
  );
  const muxedVideo = selectTrack(
    job.candidate.variants.filter((track) => track.muxed),
    "video",
    job,
  );
  let audio = selectTrack(job.candidate.audioTracks, "audio", job);
  let video =
    requestedVideo || (separateVideo && audio ? separateVideo : muxedVideo);
  if (!video)
    throw new Error(
      "A muxed track or resolved adaptive video and audio tracks are required.",
    );
  if (video.muxed) audio = null;
  else if (!audio)
    throw new Error(
      "The selected video quality requires a separate audio track that is not available.",
    );
  if (
    video.urlResolution === "provider_client_pending" ||
    audio?.urlResolution === "provider_client_pending"
  ) {
    context.progress({
      phase: "probing",
      stage: "provider_resolution",
      downloadedBytes: 0,
      totalBytes: null,
      bytesPerSecond: 0,
      resumable: false,
      resumedBytes: 0,
      duration: job.candidate.duration,
    });
    const resolved = await resolveYouTubeProviderTracks(
      [video, ...(audio ? [audio] : [])],
      job.candidate,
      {
        allowEquivalentVideo:
          job.output.allowEquivalentVideo === true || !job.output.videoTrackId,
        force: true,
      },
    );
    video = resolved[0];
    audio = resolved[1] || null;
  }
  if (
    video.urlResolution !== "resolved" ||
    (audio && audio.urlResolution !== "resolved")
  ) {
    context.progress({
      phase: "probing",
      stage: "compatibility_check",
      downloadedBytes: 0,
      totalBytes:
        video.contentLength && audio?.contentLength
          ? video.contentLength + audio.contentLength
          : video.muxed
            ? video.contentLength
            : null,
      bytesPerSecond: 0,
      resumable: false,
      resumedBytes: 0,
      duration: job.candidate.duration,
    });
    const resolved = await Promise.all([
      resolveYouTubePlayerTrack(video, job.candidate),
      ...(audio ? [resolveYouTubePlayerTrack(audio, job.candidate)] : []),
    ]);
    video = resolved[0];
    audio = resolved[1] || null;
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
  const expectedTransferCount = video.muxed ? 1 : 2;
  const update = (key: string, value: DownloadProgress) => {
    progress.set(key, value);
    const values = [...progress.values()];
    const downloadedBytes = values.reduce(
      (total, item) => total + (item.downloadedBytes || 0),
      0,
    );
    const knownTotals = values.map((item) => item.totalBytes);
    const totalBytes =
      values.length === expectedTransferCount &&
      knownTotals.every(Number.isFinite)
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
    if (video.muxed) {
      const muxedResult = await downloadAdaptiveTrack(
        job,
        video,
        "muxed-track",
        cacheDirectory,
        job.connections,
        childContext(context, (value) => update("muxed", value)),
        {
          allowEquivalentVideo:
            job.output.allowEquivalentVideo === true ||
            !job.output.videoTrackId,
        },
      );
      context.progress({
        phase: "finalizing",
        stage: "local_processing",
        downloadedBytes: muxedResult.totalBytes || 0,
        totalBytes: muxedResult.totalBytes,
        bytesPerSecond: 0,
        resumable: false,
        resumedBytes: 0,
        duration: job.candidate.duration,
      });
      if (extension === ".mp4" && /video\/mp4/i.test(video.mimeType || "")) {
        await rename(muxedResult.outputPath, outputPath);
      } else {
        await remuxTrack(
          muxedResult.outputPath,
          partialPath,
          job,
          context.signal,
        );
        await rename(partialPath, outputPath);
      }
      const output = await stat(outputPath);
      return { outputPath, totalBytes: output.size, resumedBytes: 0 };
    }
    if (!audio) throw new Error("Resolved adaptive audio track is required.");
    const transferController = linkedAbortController(context.signal);
    const transferContext = (key: string) =>
      childContext({ ...context, signal: transferController.signal }, (value) =>
        update(key, value),
      );
    const downloadVideo = () =>
      downloadAdaptiveTrack(
        job,
        video,
        "video-track",
        cacheDirectory,
        videoConnections,
        transferContext("video"),
        {
          allowEquivalentVideo:
            job.output.allowEquivalentVideo === true ||
            !job.output.videoTrackId,
        },
      );
    const downloadAudio = () =>
      downloadAdaptiveTrack(
        job,
        audio,
        "audio-track",
        cacheDirectory,
        audioConnections,
        transferContext("audio"),
        { allowEquivalentVideo: false },
      );
    let videoResult;
    let audioResult;
    if (job.connections === 1) {
      videoResult = await downloadVideo();
      audioResult = await downloadAudio();
    } else {
      const transfers = [downloadVideo(), downloadAudio()] as const;
      try {
        [videoResult, audioResult] = await Promise.all(transfers);
      } catch (error) {
        transferController.abort(error);
        await Promise.allSettled(transfers);
        throw error;
      }
    }
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

async function downloadAudioOnly(
  job: DownloadJob,
  context: DownloadContext,
): Promise<DownloadResult> {
  let audio = selectTrack(
    job.candidate.audioTracks.filter(
      (track) =>
        !job.output.audioTrackId || track.id === job.output.audioTrackId,
    ),
    "audio",
    job,
  );
  if (!audio)
    throw new Error("A downloadable YouTube audio track is required.");
  if (audio.urlResolution === "provider_client_pending") {
    context.progress({
      phase: "probing",
      stage: "provider_resolution",
      downloadedBytes: 0,
      totalBytes: audio.contentLength,
      bytesPerSecond: 0,
      resumable: false,
      resumedBytes: 0,
      duration: job.candidate.duration,
    });
    audio = (
      await resolveYouTubeProviderTracks([audio], job.candidate, {
        allowEquivalentVideo: false,
        force: true,
      })
    )[0];
  }
  if (!audio.sourceUrl || audio.urlResolution !== "resolved")
    throw new Error("YouTube audio track could not be resolved.");

  const outputDirectory = resolveOutputDirectory(job.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const filename = sanitizeFilename(
    job.candidate.title || "audio",
    ".ogg",
  ).replace(/\.[a-z0-9]{1,6}$/i, ".ogg");
  const outputPath = await availableOutputPath(outputDirectory, filename);
  const partialPath = `${outputPath}.${safeId(job.jobId)}.part.ogg`;
  const cacheDirectory = await mkdtemp(
    join(outputDirectory, ".adsfriendly-audio-"),
  );
  try {
    const audioResult = await downloadAdaptiveTrack(
      job,
      audio,
      "audio-track",
      cacheDirectory,
      job.connections,
      childContext(context, (value) =>
        context.progress({
          ...value,
          duration: job.candidate.duration,
        }),
      ),
      { allowEquivalentVideo: false },
    );
    context.progress({
      phase: "finalizing",
      stage: "local_processing",
      downloadedBytes: audioResult.totalBytes || 0,
      totalBytes: audioResult.totalBytes,
      bytesPerSecond: 0,
      resumable: false,
      resumedBytes: 0,
      duration: job.candidate.duration,
    });
    await transcodeAudioToOgg(
      audioResult.outputPath,
      partialPath,
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

async function downloadAdaptiveTrack(
  job: DownloadJob,
  track: AdaptiveHttpTrack,
  title: string,
  outputDirectory: string,
  connections: number,
  context: DownloadContext,
  { allowEquivalentVideo = false } = {},
) {
  try {
    return await downloadDirectHttp(
      directTrackJob(job, track, title, outputDirectory, connections),
      context,
    );
  } catch (error) {
    if (
      job.candidate.provider === "youtube" &&
      isGoogleVideoRangeFailure(error) &&
      track.itag
    ) {
      let freshTrack: AdaptiveHttpTrack | null = null;
      try {
        // GoogleVideo URLs can accept the first probe and reject later byte
        // windows when their proof-of-origin binding is stale. Refresh the
        // provider response once, then retry only this track. This keeps the
        // normal multi-connection downloader unchanged and bounds retries.
        [freshTrack] = await resolveYouTubeProviderTracks(
          [track],
          job.candidate,
          { allowEquivalentVideo, force: true },
        );
        if (freshTrack?.sourceUrl) {
          return await downloadDirectHttp(
            directTrackJob(
              job,
              freshTrack,
              title,
              outputDirectory,
              connections,
            ),
            context,
          );
        }
      } catch (refreshError) {
        error = new Error(
          `${messageOf(error)}; initial ${providerTrackDiagnostic(track)}; fresh ${providerTrackDiagnostic(freshTrack)} retry failed: ${messageOf(refreshError)}`,
        );
      }
    }
    const provider = job.candidate.provider === "youtube" ? "YouTube " : "";
    throw new Error(
      `${provider}${track.type} track (${adaptiveTrackLabel(track)}) failed: ${messageOf(error)}`,
    );
  }
}

function providerTrackDiagnostic(track: AdaptiveHttpTrack | null | undefined) {
  return [
    `client=${track?.providerClient || "unknown"}`,
    `ua=${track?.requestUserAgent ? "provider" : "browser/default"}`,
    `itag=${track?.itag || "unknown"}`,
  ].join(", ");
}

function isGoogleVideoRangeFailure(error: unknown) {
  return /GoogleVideo rejected bytes \d+-\d+ after accepting the initial probe/i.test(
    messageOf(error),
  );
}

function adaptiveTrackLabel(track: AdaptiveHttpTrack) {
  const values = [
    track.qualityLabel,
    track.itag ? `itag ${track.itag}` : null,
  ].filter(Boolean);
  return values.join(" · ") || "unknown format";
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function selectTrack(
  tracks: AdaptiveHttpTrack[],
  type: "video" | "audio",
  job: DownloadJob,
) {
  const preferMp4 = job.output.container !== "mkv";
  return [...(tracks || [])]
    .filter(
      (track) =>
        track.type === type &&
        (track.sourceUrl || track.urlResolution === "provider_client_pending"),
    )
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
  if (!track.sourceUrl)
    throw new Error("Adaptive provider resolution did not return a media URL.");
  return {
    ...job,
    browserUserAgent: track.requestUserAgent || job.browserUserAgent,
    jobId: `${job.jobId}-${track.type}`,
    connections,
    outputDirectory,
    output: {
      profileId: "source",
      container: "source",
      extension: null,
      videoTrackId: null,
      allowEquivalentVideo: false,
    },
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

function linkedAbortController(parent: AbortSignal) {
  const controller = new AbortController();
  if (parent.aborted) controller.abort(parent.reason);
  else
    parent.addEventListener("abort", () => controller.abort(parent.reason), {
      once: true,
    });
  return controller;
}

function remuxTrack(
  inputPath: string,
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
      inputPath,
      "-map",
      "0:v:0?",
      "-map",
      "0:a:0?",
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
            `FFmpeg could not remux the muxed adaptive track${detail ? `: ${detail}` : "."}`,
          ),
        );
      }
    });
  });
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

function transcodeAudioToOgg(
  inputPath: string,
  outputPath: string,
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
      inputPath,
      "-vn",
      "-c:a",
      "libopus",
      "-b:a",
      "160k",
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
            `FFmpeg could not convert audio to OGG${detail ? `: ${detail}` : "."}`,
          ),
        );
      }
    });
  });
}

function safeId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "").slice(0, 48) || "download";
}
