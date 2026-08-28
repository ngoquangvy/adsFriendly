import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type CanaryTrack = {
  id: string;
  mimeType: string | null;
  appendFormats: string[];
  chunks: string[];
};

export async function validatePlayerOutputCanary(payload: {
  tracks: CanaryTrack[];
}) {
  const directory = await mkdtemp(path.join(tmpdir(), "adsfriendly-canary-"));
  try {
    const tracks = [];
    for (const [index, track] of payload.tracks.entries()) {
      const bytes = Buffer.concat(
        track.chunks.map((chunk) => Buffer.from(chunk, "base64")),
      );
      const format = track.appendFormats[0] || formatFromMime(track.mimeType);
      const filePath = path.join(
        directory,
        `track-${index + 1}${extensionFor(format)}`,
      );
      await writeFile(filePath, bytes);
      tracks.push(await probeTrack(track, filePath, format, bytes.length));
    }
    const hasVideo = tracks.some((track) =>
      track.streamTypes.includes("video"),
    );
    const hasAudio = tracks.some((track) =>
      track.streamTypes.includes("audio"),
    );
    const recognized = tracks.some((track) => track.status === "recognized");
    const timeline = compareTrackTimelines(tracks);
    return {
      status: recognized ? "ready" : "unrecognized",
      hasVideo,
      hasAudio,
      timeline,
      tracks,
      reason: recognized
        ? null
        : "FFprobe could not recognize a complete media stream in the bounded player-output sample.",
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

function compareTrackTimelines(
  tracks: Array<{ streamTypes: string[]; startTimes: string[] }>,
) {
  const videoStart = firstFiniteStart(tracks, "video");
  const audioStart = firstFiniteStart(tracks, "audio");
  if (videoStart === null || audioStart === null) {
    return {
      status: "unknown",
      videoStart,
      audioStart,
      deltaSeconds: null,
    };
  }
  const deltaSeconds = Math.abs(videoStart - audioStart);
  return {
    status: deltaSeconds <= 2 ? "aligned" : "misaligned",
    videoStart,
    audioStart,
    deltaSeconds,
  };
}

function firstFiniteStart(
  tracks: Array<{ streamTypes: string[]; startTimes: string[] }>,
  streamType: string,
) {
  for (const track of tracks) {
    if (!track.streamTypes.includes(streamType)) continue;
    for (const value of track.startTimes) {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }
  return null;
}

async function probeTrack(
  track: CanaryTrack,
  filePath: string,
  format: string | null,
  capturedBytes: number,
) {
  try {
    const output = await runFfprobe(filePath);
    const streams = Array.isArray(output.streams) ? output.streams : [];
    return {
      id: track.id,
      mimeType: track.mimeType,
      format,
      capturedBytes,
      status: streams.length ? "recognized" : "unrecognized",
      streamTypes: uniqueStrings(streams.map((stream) => stream.codec_type)),
      codecs: uniqueStrings(streams.map((stream) => stream.codec_name)),
      startTimes: uniqueStrings(streams.map((stream) => stream.start_time)),
      diagnostic: streams.length ? null : "No streams reported by FFprobe.",
    };
  } catch (error) {
    return {
      id: track.id,
      mimeType: track.mimeType,
      format,
      capturedBytes,
      status: "unrecognized",
      streamTypes: [],
      codecs: [],
      startTimes: [],
      diagnostic: messageOf(error).slice(0, 1200),
    };
  }
}

function runFfprobe(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("FFprobe timed out while checking player output."));
    }, 12_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            Buffer.concat(stderr).toString("utf8").trim() ||
              `FFprobe exited with code ${code}.`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch {
        reject(new Error("FFprobe returned invalid JSON."));
      }
    });
  });
}

function formatFromMime(mimeType: string | null) {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("webm")) return "webm";
  if (value.includes("mp2t")) return "mpeg-ts";
  if (value.includes("aac")) return "aac-adts";
  if (value.includes("mp4")) return "iso-bmff";
  return null;
}

function extensionFor(format: string | null) {
  if (format === "webm") return ".webm";
  if (format === "mpeg-ts") return ".ts";
  if (format === "aac-adts") return ".aac";
  return ".mp4";
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

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
