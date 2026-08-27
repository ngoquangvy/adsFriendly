import { Innertube } from "youtubei.js";
import type { AdaptiveHttpTrack, DownloadCandidate } from "./download-types.js";
import {
  YOUTUBE_WEB_PO_USER_AGENT,
  attachYouTubeWebPoToken,
  resolveYouTubeWebPoToken,
} from "./youtube-po-token-resolver.js";

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
  decipher?: (player: unknown) => Promise<string>;
};

type ProviderProfile = {
  id: string;
  client: "YTMUSIC" | "IOS" | "ANDROID";
  poToken: string | null;
  requestUserAgent: string | null;
  allowEquivalentVideo: boolean;
};

export type YouTubeQualityPreflight = {
  status: "ready" | "unavailable";
  videoOptions: Array<{
    id: string;
    availability: "exact" | "equivalent";
    sourceLabel: string;
  }>;
  reason: string | null;
};

export async function resolveYouTubeProviderTracks(
  tracks: AdaptiveHttpTrack[],
  candidate: DownloadCandidate,
  { allowEquivalentVideo = false } = {},
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
  const profilePlan = await providerProfiles(videoId, allowEquivalentVideo);
  failures.push(...profilePlan.failures);
  const profiles = profilePlan.profiles;
  for (const profile of profiles) {
    try {
      const { formats, session } = await loadProviderFormats(videoId, profile);
      const resolved = await Promise.all(
        tracks.map((track) =>
          track.urlResolution === "provider_client_pending"
            ? resolveTrackFromFormats(track, formats, session, profile)
            : track,
        ),
      );
      if (
        resolved.every(
          (track) => track.urlResolution !== "provider_client_pending",
        )
      )
        return resolved;
      failures.push(`${profile.id}: selected format unavailable`);
    } catch (error) {
      failures.push(`${profile.id}: ${messageOf(error)}`);
    }
  }
  throw new Error(
    `YouTube could not expose the selected adaptive tracks through bounded provider clients (${failures.join("; ")}).`,
  );
}

// This intentionally returns only a quality verdict. URLs and PO tokens remain
// in this process and are regenerated when the user actually starts a job.
export async function preflightYouTubeProviderQualities(
  candidate: DownloadCandidate,
): Promise<YouTubeQualityPreflight> {
  const videoId = youtubeVideoId(candidate.pageUrl);
  if (!videoId)
    return unavailableQualityPreflight("YouTube video ID is unavailable.");
  const plan = await providerProfiles(videoId, true);
  const profile = plan.profiles.find((item) => item.poToken);
  if (!profile)
    return unavailableQualityPreflight(
      plan.failures.join("; ") ||
        "A token-capable YouTube profile is unavailable.",
    );
  try {
    const { formats } = await loadProviderFormats(videoId, profile);
    const preferredAudio = selectPreferredAudioTrack(candidate.audioTracks);
    const hasRequiredAudio = !preferredAudio
      ? true
      : Boolean(selectProviderFormat(preferredAudio, formats, false));
    const videoOptions = candidate.variants.flatMap((track) => {
      if (track.type !== "video") return [];
      const exact = selectProviderFormat(track, formats, false);
      const replacement = exact || selectProviderFormat(track, formats, true);
      if (!replacement || (!track.muxed && !hasRequiredAudio)) return [];
      return [
        {
          id: track.id,
          availability: exact ? "exact" : "equivalent",
          sourceLabel: sourceFormatLabel(replacement),
        },
      ];
    });
    if (!videoOptions.length)
      return unavailableQualityPreflight(
        "No selected YouTube quality is available through the token-capable profile.",
      );
    return { status: "ready", videoOptions, reason: null };
  } catch (error) {
    return unavailableQualityPreflight(messageOf(error));
  }
}

function unavailableQualityPreflight(reason: string): YouTubeQualityPreflight {
  return { status: "unavailable", videoOptions: [], reason };
}

async function resolveTrackFromFormats(
  track: AdaptiveHttpTrack,
  formats: ProviderFormat[],
  session: Innertube,
  profile: ProviderProfile,
): Promise<AdaptiveHttpTrack> {
  const format = selectProviderFormat(
    track,
    formats,
    profile.allowEquivalentVideo,
  );
  if (!format) return track;
  const rawUrl =
    typeof format.url === "string"
      ? format.url
      : typeof format.decipher === "function"
        ? await format.decipher(session.session.player)
        : null;
  if (!rawUrl) return track;
  const sourceUrl = profile.poToken
    ? attachYouTubeWebPoToken(rawUrl, profile.poToken)
    : validatedGoogleVideoUrl(rawUrl);
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
    requestUserAgent: profile.requestUserAgent,
    providerClient: profile.client,
  };
}

function selectProviderFormat(
  track: AdaptiveHttpTrack,
  formats: ProviderFormat[],
  allowEquivalentVideo: boolean,
) {
  const correctType = (item: ProviderFormat) =>
    track.type === "video" ? item.has_video : item.has_audio;
  const exact = formats.find(
    (item) => item.itag === Number(track.itag) && correctType(item),
  );
  if (exact || track.type !== "video" || !allowEquivalentVideo) return exact;
  const equivalents = formats.filter(
    (item) =>
      correctType(item) &&
      ((track.qualityLabel && item.quality_label === track.qualityLabel) ||
        (track.height && item.height === track.height)),
  );
  return equivalents.sort(
    (left, right) =>
      formatCompatibilityScore(right, track) -
        formatCompatibilityScore(left, track) ||
      (right.average_bitrate || right.bitrate || 0) -
        (left.average_bitrate || left.bitrate || 0),
  )[0];
}

function formatCompatibilityScore(
  format: ProviderFormat,
  requested: AdaptiveHttpTrack,
) {
  const targetContainer = cleanMimeType(requested.mimeType)?.split("/", 2)[1];
  const actualContainer = cleanMimeType(format.mime_type)?.split("/", 2)[1];
  return targetContainer && targetContainer === actualContainer ? 1 : 0;
}

function selectPreferredAudioTrack(tracks: AdaptiveHttpTrack[]) {
  return [...(tracks || [])]
    .filter((track) => track.type === "audio")
    .sort(
      (left, right) =>
        mp4AudioScore(right) - mp4AudioScore(left) ||
        (right.averageBandwidth || right.bandwidth || 0) -
          (left.averageBandwidth || left.bandwidth || 0),
    )[0];
}

function mp4AudioScore(track: AdaptiveHttpTrack) {
  return /\/(?:mp4|m4a)(?:$|;)/i.test(track.mimeType || "") ? 1 : 0;
}

function sourceFormatLabel(format: ProviderFormat) {
  const mime = String(format.mime_type || "").toLowerCase();
  const container = mime.includes("video/webm") ? "WebM" : "MP4";
  const codec = mime.includes("av01")
    ? "AV1"
    : mime.includes("vp9") || mime.includes("vp09")
      ? "VP9"
      : mime.includes("avc1") || mime.includes("avc3")
        ? "H.264"
        : null;
  return [format.quality_label, container, codec].filter(Boolean).join(" · ");
}

async function loadProviderFormats(videoId: string, profile: ProviderProfile) {
  const key = `${profile.client}:${videoId}`;
  const cached = responseCache.get(key);
  const session = await getSession();
  if (cached && cached.expiresAt > Date.now())
    return { formats: cached.formats, session };
  const info = await session.getBasicInfo(videoId, {
    client: profile.client,
    ...(profile.poToken ? { po_token: profile.poToken } : {}),
  });
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
  return { formats, session };
}

async function providerProfiles(
  videoId: string,
  allowEquivalentVideo: boolean,
): Promise<{ profiles: ProviderProfile[]; failures: string[] }> {
  const profiles: ProviderProfile[] = [];
  const failures: string[] = [];
  try {
    profiles.push({
      id: "web_remix_po",
      client: "YTMUSIC",
      poToken: await resolveYouTubeWebPoToken(videoId),
      requestUserAgent: YOUTUBE_WEB_PO_USER_AGENT,
      allowEquivalentVideo,
    });
  } catch (error) {
    failures.push(`web_remix_po: ${messageOf(error)}`);
  }
  profiles.push(
    {
      id: "ios_direct",
      client: "IOS",
      poToken: null,
      requestUserAgent: null,
      allowEquivalentVideo: false,
    },
    {
      id: "android_direct",
      client: "ANDROID",
      poToken: null,
      requestUserAgent: null,
      allowEquivalentVideo: false,
    },
  );
  return { profiles, failures };
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
