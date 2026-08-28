import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  availableOutputPath,
  resolveOutputDirectory,
  sanitizeFilename,
} from "./direct-http-adapter.js";
import { MEDIA_HELPER_EVENTS } from "../../../src/media/helper-contract.js";

type Emit = (type: string, payload: Record<string, unknown>) => void;
type StartPayload = {
  jobId: string;
  mediaId: string;
  title: string;
  duration: number | null;
  outputDirectory: string | null;
};
type ChunkPayload = {
  jobId: string;
  trackId: string;
  sequence: number;
  mimeType: string | null;
  appendFormat: string | null;
  processedSeconds: number | null;
  duration: number | null;
  data: string;
  bytes: number;
};
type TrackState = {
  id: string;
  path: string;
  mimeType: string | null;
  appendFormat: string | null;
  nextSequence: number;
  bytes: number;
};
type Session = {
  jobId: string;
  mediaId: string;
  title: string;
  duration: number | null;
  outputDirectory: string;
  cacheDirectory: string;
  outputPath: string;
  partialPath: string;
  tracks: Map<string, TrackState>;
  totalBytes: number;
  startedAt: number;
  emit: Emit;
  queue: Promise<void>;
  ending: boolean;
};

const MAX_TRACKS = 4;
const MAX_CAPTURE_BYTES = 20 * 1024 * 1024 * 1024;

export class PlayerOutputCaptureManager {
  private readonly sessions = new Map<string, Session>();

  async start(payload: StartPayload, emit: Emit) {
    if (this.sessions.has(payload.jobId))
      throw new Error(
        `Player output capture "${payload.jobId}" already exists.`,
      );
    const outputDirectory = resolveOutputDirectory(payload.outputDirectory);
    await mkdir(outputDirectory, { recursive: true });
    const filename = sanitizeFilename(payload.title, ".mp4").replace(
      /\.[a-z0-9]{1,6}$/i,
      ".mp4",
    );
    const outputPath = await availableOutputPath(outputDirectory, filename);
    const cacheDirectory = await mkdtemp(
      join(outputDirectory, ".adsfriendly-player-output-"),
    );
    const session: Session = {
      jobId: payload.jobId,
      mediaId: payload.mediaId,
      title: payload.title,
      duration: payload.duration,
      outputDirectory,
      cacheDirectory,
      outputPath,
      partialPath: `${outputPath}.${safeId(payload.jobId)}.part.mp4`,
      tracks: new Map(),
      totalBytes: 0,
      startedAt: Date.now(),
      emit,
      queue: Promise.resolve(),
      ending: false,
    };
    this.sessions.set(payload.jobId, session);
    emit(MEDIA_HELPER_EVENTS.DOWNLOAD_STARTED, {
      jobId: payload.jobId,
      mediaId: payload.mediaId,
      adapterId: "player-output-capture",
    });
  }

  async append(payload: ChunkPayload) {
    const session = this.requireSession(payload.jobId);
    if (session.ending) throw new Error("Player output capture is finalizing.");
    const operation = session.queue.then(() =>
      this.appendNow(session, payload),
    );
    session.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    await operation;
  }

  async finish(jobId: string) {
    const session = this.requireSession(jobId);
    if (session.ending) return;
    session.ending = true;
    try {
      await session.queue;
      session.emit(MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS, {
        jobId,
        mediaId: session.mediaId,
        phase: "finalizing",
        stage: "player_output_probe",
        downloadedBytes: session.totalBytes,
        totalBytes: session.totalBytes,
        bytesPerSecond: captureSpeed(session),
        processedSeconds: session.duration,
        duration: session.duration,
        resumable: false,
      });
      const tracks = await Promise.all(
        [...session.tracks.values()].map(probeTrack),
      );
      const video = tracks.find((track) => track.streamTypes.includes("video"));
      const audio = tracks.find((track) => track.streamTypes.includes("audio"));
      if (!video || !audio) {
        throw new Error(
          `Player output capture is incomplete: ${video ? "audio" : audio ? "video" : "video and audio"} track missing.`,
        );
      }
      ensureTimelineCompatible(video, audio);
      session.emit(MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS, {
        jobId,
        mediaId: session.mediaId,
        phase: "finalizing",
        stage: "player_output_remux",
        downloadedBytes: session.totalBytes,
        totalBytes: session.totalBytes,
        bytesPerSecond: captureSpeed(session),
        processedSeconds: session.duration,
        duration: session.duration,
        resumable: false,
      });
      await remuxTracks(video, audio, session.partialPath);
      await rename(session.partialPath, session.outputPath);
      const outputSize = (await stat(session.outputPath)).size;
      session.emit(MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED, {
        jobId,
        mediaId: session.mediaId,
        outputPath: session.outputPath,
        downloadedBytes: outputSize,
        totalBytes: outputSize,
        bytesPerSecond: captureSpeed(session),
      });
    } catch (error) {
      await rm(session.partialPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      this.sessions.delete(jobId);
      await rm(session.cacheDirectory, { recursive: true, force: true }).catch(
        () => {},
      );
    }
  }

  async cancel(jobId: string) {
    const session = this.sessions.get(jobId);
    if (!session) return false;
    session.ending = true;
    await session.queue.catch(() => {});
    this.sessions.delete(jobId);
    await Promise.all([
      rm(session.cacheDirectory, { recursive: true, force: true }).catch(
        () => {},
      ),
      rm(session.partialPath, { force: true }).catch(() => {}),
    ]);
    session.emit(MEDIA_HELPER_EVENTS.DOWNLOAD_CANCELLED, {
      jobId,
      mediaId: session.mediaId,
    });
    return true;
  }

  async cancelAll() {
    await Promise.all(
      [...this.sessions.keys()].map((jobId) => this.cancel(jobId)),
    );
  }

  private requireSession(jobId: string) {
    const session = this.sessions.get(jobId);
    if (!session) throw new Error("Player output capture session not found.");
    return session;
  }

  private async appendNow(session: Session, payload: ChunkPayload) {
    let track = session.tracks.get(payload.trackId);
    if (!track) {
      if (session.tracks.size >= MAX_TRACKS)
        throw new Error("Player output exposed too many SourceBuffers.");
      if (payload.sequence !== 0)
        throw new Error(
          `Player output track ${payload.trackId} began at sequence ${payload.sequence}; reload and capture from the start.`,
        );
      track = {
        id: payload.trackId,
        path: join(
          session.cacheDirectory,
          `${safeId(payload.trackId)}${extensionFor(payload.appendFormat, payload.mimeType)}`,
        ),
        mimeType: payload.mimeType,
        appendFormat: payload.appendFormat,
        nextSequence: 0,
        bytes: 0,
      };
      session.tracks.set(payload.trackId, track);
    }
    if (payload.sequence !== track.nextSequence) {
      throw new Error(
        `Player output track ${payload.trackId} has a sequence gap: expected ${track.nextSequence}, received ${payload.sequence}.`,
      );
    }
    if (session.totalBytes + payload.bytes > MAX_CAPTURE_BYTES)
      throw new Error("Player output capture exceeded the 20 GB safety limit.");
    await appendFile(track.path, Buffer.from(payload.data, "base64"));
    track.nextSequence += 1;
    track.bytes += payload.bytes;
    session.totalBytes += payload.bytes;
    if (Number.isFinite(payload.duration)) session.duration = payload.duration;
    session.emit(MEDIA_HELPER_EVENTS.PLAYER_OUTPUT_CHUNK_ACCEPTED, {
      jobId: session.jobId,
      mediaId: session.mediaId,
      trackId: payload.trackId,
      sequence: payload.sequence,
      phase: "downloading",
      stage: "player_output_capture",
      downloadedBytes: session.totalBytes,
      totalBytes: null,
      bytesPerSecond: captureSpeed(session),
      processedSeconds: payload.processedSeconds,
      duration: session.duration,
      resumable: false,
    });
  }
}

async function probeTrack(track: TrackState) {
  const output = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-of",
    "json",
    track.path,
  ]);
  const parsed = JSON.parse(output.stdout || "{}");
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  if (!streams.length)
    throw new Error(
      `FFprobe did not recognize player output track ${track.id}.`,
    );
  return {
    ...track,
    streamTypes: uniqueStrings(streams.map((stream: any) => stream.codec_type)),
    startTimes: streams
      .map((stream: any) => Number(stream.start_time))
      .filter(Number.isFinite),
  };
}

function ensureTimelineCompatible(
  video: { startTimes: number[] },
  audio: { startTimes: number[] },
) {
  const videoStart = video.startTimes[0];
  const audioStart = audio.startTimes[0];
  if (!Number.isFinite(videoStart) || !Number.isFinite(audioStart)) return;
  const delta = Math.abs(videoStart - audioStart);
  if (delta > 2)
    throw new Error(
      `Player output audio/video timestamps differ by ${delta.toFixed(3)} seconds.`,
    );
}

async function remuxTracks(
  video: { path: string },
  audio: { path: string },
  outputPath: string,
) {
  const sameInput = video.path === audio.path;
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", video.path];
  if (!sameInput) args.push("-i", audio.path);
  args.push(
    "-map",
    "0:v:0",
    "-map",
    sameInput ? "0:a:0" : "1:a:0",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  );
  await runProcess("ffmpeg", args, 5 * 60 * 1000);
}

function runProcess(command: string, args: string[], timeoutMs = 30_000) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) resolve(output);
      else
        reject(
          new Error(
            output.stderr.trim() || `${command} exited with code ${code}.`,
          ),
        );
    });
  });
}

function extensionFor(format: string | null, mimeType: string | null) {
  const mime = String(mimeType || "").toLowerCase();
  if (format === "webm" || mime.includes("webm")) return ".webm";
  if (format === "mpeg-ts" || mime.includes("mp2t")) return ".ts";
  if (format === "aac-adts" || mime.includes("aac")) return ".aac";
  return ".mp4";
}

function captureSpeed(session: Session) {
  return Math.round(
    session.totalBytes /
      Math.max(0.001, (Date.now() - session.startedAt) / 1000),
  );
}

function safeId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "track";
}

function uniqueStrings(values: unknown[]) {
  return [
    ...new Set(
      values.filter(
        (value): value is string => typeof value === "string" && Boolean(value),
      ),
    ),
  ];
}
