import { spawn } from "node:child_process";
import process from "node:process";
import type { AdaptiveHttpTrack, DownloadCandidate } from "./download-types.js";

const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

type ExternalFormat = {
  format_id?: string;
  url?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  width?: number;
  fps?: number;
  tbr?: number;
  abr?: number;
  filesize?: number;
  filesize_approx?: number;
  format_note?: string;
  language?: string;
  audio_channels?: number;
  asr?: number;
  http_headers?: Record<string, string>;
};

export async function resolveYouTubeExternalTracks(
  tracks: AdaptiveHttpTrack[],
  candidate: DownloadCandidate,
  { allowEquivalentVideo = false } = {},
) {
  const executable = process.env.ADSFRIENDLY_YTDLP_PATH || "yt-dlp";
  const payload = await inspectWithYtDlp(executable, candidate.pageUrl);
  const formats = Array.isArray(payload?.formats)
    ? (payload.formats as ExternalFormat[])
    : [];
  if (!formats.length) throw new Error("yt-dlp returned no media formats");
  return tracks.map((track) => {
    if (track.urlResolution !== "provider_client_pending") return track;
    const format = selectExternalFormat(track, formats, allowEquivalentVideo);
    if (!format?.url) return track;
    const sourceUrl = validateGoogleVideoUrl(format.url);
    return {
      ...track,
      sourceUrl,
      contentLength:
        positiveInteger(format.filesize) ||
        positiveInteger(format.filesize_approx) ||
        track.contentLength,
      width: positiveInteger(format.width) || track.width,
      height: positiveInteger(format.height) || track.height,
      qualityLabel: format.format_note || track.qualityLabel,
      language: format.language || track.language || null,
      audioChannels:
        positiveInteger(format.audio_channels) || track.audioChannels || null,
      audioSampleRate:
        positiveInteger(format.asr) || track.audioSampleRate || null,
      requestUserAgent: format.http_headers?.["User-Agent"] || null,
      providerClient: "YT_DLP",
      requestMode: "http_range" as const,
      urlResolution: "resolved" as const,
    };
  });
}

function inspectWithYtDlp(executable: string, pageUrl: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "--dump-single-json",
        "--no-playlist",
        "--no-warnings",
        "--skip-download",
        "--no-config",
        pageUrl,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    const timeout = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_OUTPUT_BYTES) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      while (Buffer.concat(stderr).byteLength > 32 * 1024) stderr.shift();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        new Error(`optional yt-dlp provider unavailable: ${error.message}`),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (bytes > MAX_OUTPUT_BYTES) {
        reject(new Error("optional yt-dlp provider returned too much data"));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `optional yt-dlp provider failed${stderr.length ? `: ${Buffer.concat(stderr).toString("utf8").trim()}` : ""}`,
          ),
        );
        return;
      }
      try {
        const value = JSON.parse(Buffer.concat(stdout).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("invalid JSON object");
        resolve(value);
      } catch (error) {
        reject(
          new Error(
            `optional yt-dlp provider response is invalid: ${messageOf(error)}`,
          ),
        );
      }
    });
  });
}

function selectExternalFormat(
  track: AdaptiveHttpTrack,
  formats: ExternalFormat[],
  allowEquivalentVideo: boolean,
) {
  const typed = formats.filter((format) =>
    track.type === "video"
      ? format.vcodec && format.vcodec !== "none"
      : format.acodec &&
        format.acodec !== "none" &&
        (!format.vcodec || format.vcodec === "none"),
  );
  const exact = typed.filter(
    (format) => String(format.format_id || "") === String(track.itag || ""),
  );
  const candidates = exact.length
    ? exact
    : track.type === "video" && allowEquivalentVideo
      ? typed.filter((format) => format.height === track.height)
      : [];
  return candidates.sort(
    (left, right) =>
      languageScore(right, track) - languageScore(left, track) ||
      (right.tbr || right.abr || 0) - (left.tbr || left.abr || 0),
  )[0];
}

function languageScore(format: ExternalFormat, track: AdaptiveHttpTrack) {
  if (track.type !== "audio") return 0;
  return track.language && format.language === track.language ? 10 : 0;
}

function validateGoogleVideoUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname === "googlevideo.com" ||
      url.hostname.endsWith(".googlevideo.com")
    ) ||
    url.pathname !== "/videoplayback"
  )
    throw new Error("yt-dlp returned an unexpected media endpoint");
  return url.href;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
