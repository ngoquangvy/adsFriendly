import { Innertube } from "youtubei.js";
import type { AdaptiveHttpTrack, DownloadCandidate } from "./download-types.js";

const PROVIDER_CLIENTS = ["IOS", "ANDROID"] as const;
const RESPONSE_CACHE_MS = 5 * 60 * 1000;
const MAX_CACHE_ITEMS = 20;
const responseCache = new Map<
  string,
  { expiresAt: number; formats: ProviderFormat[] }
>();
let sessionPromise: Promise<Innertube> | null = null;

type ProviderFormat = {
  itag: number;
  url?: string;
  has_video: boolean;
  has_audio: boolean;
  mime_type: string;
  content_length?: number;
  bitrate: number;
  average_bitrate?: number;
  width?: number;
  height?: number;
  quality_label?: string;
};

export async function resolveYouTubeProviderTracks(
  tracks: AdaptiveHttpTrack[],
  candidate: DownloadCandidate,
): Promise<AdaptiveHttpTrack[]> {
  if (candidate.provider !== "youtube") return tracks;
  const pending = tracks.filter(
    (track) => track.urlResolution === "provider_client_pending",
  );
  if (!pending.length) return tracks;
  const videoId = youtubeVideoId(candidate.pageUrl);
  if (!videoId)
    throw new Error("YouTube provider resolution requires a valid video ID.");

  const failures: string[] = [];
  for (const client of PROVIDER_CLIENTS) {
    try {
      const formats = await loadProviderFormats(videoId, client);
      const resolved = tracks.map((track) =>
        track.urlResolution === "provider_client_pending"
          ? resolveTrackFromFormats(track, formats)
          : track,
      );
      if (
        resolved.every(
          (track) => track.urlResolution !== "provider_client_pending",
        )
      )
        return resolved;
      failures.push(`${client}: selected itag unavailable`);
    } catch (error) {
      failures.push(`${client}: ${messageOf(error)}`);
    }
  }
  throw new Error(
    `YouTube could not expose the selected adaptive tracks through bounded provider clients (${failures.join("; ")}).`,
  );
}

function resolveTrackFromFormats(
  track: AdaptiveHttpTrack,
  formats: ProviderFormat[],
): AdaptiveHttpTrack {
  const itag = Number(track.itag);
  const format = formats.find(
    (item) =>
      item.itag === itag &&
      (track.type === "video" ? item.has_video : item.has_audio) &&
      typeof item.url === "string",
  );
  if (!format?.url) return track;
  const sourceUrl = validatedGoogleVideoUrl(format.url);
  return {
    ...track,
    sourceUrl,
    mimeType: cleanMimeType(format.mime_type) || track.mimeType,
    contentLength:
      positiveInteger(format.content_length) || track.contentLength,
    bandwidth: positiveInteger(format.bitrate) || track.bandwidth,
    averageBandwidth:
      positiveInteger(format.average_bitrate) || track.averageBandwidth,
    width: positiveInteger(format.width) || track.width,
    height: positiveInteger(format.height) || track.height,
    qualityLabel: format.quality_label || track.qualityLabel,
    urlResolution: "resolved",
    signatureCipher: null,
  };
}

async function loadProviderFormats(
  videoId: string,
  client: (typeof PROVIDER_CLIENTS)[number],
): Promise<ProviderFormat[]> {
  const key = `${client}:${videoId}`;
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.formats;
  const session = await getSession();
  const info = await session.getBasicInfo(videoId, { client });
  if (info.playability_status?.status !== "OK")
    throw new Error(
      `playability ${info.playability_status?.status || "unknown"}`,
    );
  const formats = [
    ...(info.streaming_data?.formats || []),
    ...(info.streaming_data?.adaptive_formats || []),
  ] as ProviderFormat[];
  if (!formats.length) throw new Error("no streaming formats");
  responseCache.set(key, {
    expiresAt: Date.now() + RESPONSE_CACHE_MS,
    formats,
  });
  while (responseCache.size > MAX_CACHE_ITEMS)
    responseCache.delete(responseCache.keys().next().value as string);
  return formats;
}

function getSession() {
  if (!sessionPromise) {
    sessionPromise = Innertube.create({
      retrieve_player: true,
      generate_session_locally: true,
      enable_session_cache: true,
    }).catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    if (!(
      url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")
    ))
      return null;
    if (url.pathname === "/watch")
      return safeVideoId(url.searchParams.get("v"));
    return safeVideoId(
      url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i)?.[1],
    );
  } catch {
    return null;
  }
}

function safeVideoId(value: string | null | undefined) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{6,64}$/.test(value)
    ? value
    : null;
}

function validatedGoogleVideoUrl(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !(
      url.hostname === "googlevideo.com" ||
      url.hostname.endsWith(".googlevideo.com")
    ) ||
    url.pathname !== "/videoplayback"
  )
    throw new Error("Provider returned an unexpected media endpoint.");
  return url.href;
}

function cleanMimeType(value: string | null | undefined) {
  const mime = String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  return /^(?:video|audio)\/[a-z0-9.+-]+$/.test(mime) ? mime : null;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
