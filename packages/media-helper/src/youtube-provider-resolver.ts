import { Constants, Innertube, Platform } from "youtubei.js";
import type {
  AdaptiveHttpTrack,
  DownloadCandidate,
  DownloadContext,
} from "./download-types.js";
import {
  YOUTUBE_WEB_PO_USER_AGENT,
  attachYouTubeWebPoToken,
  resolveYouTubeWebPoToken,
} from "./youtube-po-token-resolver.js";
import { resolveYouTubeExternalTracks } from "./youtube-external-provider.js";
import { preflightGoogleVideoTrack } from "./direct-http-adapter.js";
import { formatAudioLanguageLabel } from "../../../src/media/audio-language-label.js";

const RESPONSE_CACHE_MS = 5 * 60 * 1000;
const MAX_CACHE_ITEMS = 20;
const SOURCE_PREFLIGHT_CACHE_MS = 2 * 60 * 1000;
const SOURCE_PREFLIGHT_TIMEOUT_MS = 12_000;
const SOURCE_PREFLIGHT_CONCURRENCY = 4;
const responseCache = new Map<
  string,
  { expiresAt: number; formats: ProviderFormat[]; cpn: string }
>();
const sourcePreflightCache = new Map<
  string,
  { expiresAt: number; available: boolean }
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
  language?: string | null;
  audio_track?: {
    audio_is_default: boolean;
    display_name: string;
    id: string;
  };
  is_drc?: boolean;
  is_dubbed?: boolean;
  is_auto_dubbed?: boolean;
  is_descriptive?: boolean;
  is_secondary?: boolean;
  is_original?: boolean;
  audio_sample_rate?: number;
  audio_channels?: number;
  audio_quality?: string;
};

type ProviderProfile = {
  id: string;
  client: "YTMUSIC" | "MWEB" | "IOS" | "ANDROID" | "WEB";
  poToken: string | null;
  requestUserAgent: string | null;
  requestMode: "youtube_query_range" | "http_range";
  allowEquivalentVideo: boolean;
  strategyId: string;
  baseScore: number;
  playerRevisionId: string;
};

type ProviderResolutionOptions = {
  allowEquivalentVideo?: boolean;
  force?: boolean;
  strategyPreferences?: Record<string, number>;
  onStrategy?: DownloadContext["strategy"];
};

// YouTube.js intentionally ships without a JavaScript evaluator. Provider
// URLs may already be present while still carrying an unresolved `n` value,
// so Format.decipher() must be allowed to run for every selected format.
Platform.shim.eval = async (data) => new Function(data.output)();

export type YouTubeQualityPreflight = {
  status: "ready" | "unavailable";
  videoOptions: Array<{
    id: string;
    availability: "exact" | "equivalent";
    sourceLabel: string;
  }>;
  audioOption: {
    id: string;
    sourceLabel: string;
  } | null;
  audioOptions: Array<{
    id: string;
    sourceLabel: string;
    language: string | null;
    role: AdaptiveHttpTrack["audioRole"];
    isDefault: boolean;
  }>;
  reason: string | null;
};

export async function resolveYouTubeProviderTracks(
  tracks: AdaptiveHttpTrack[],
  candidate: DownloadCandidate,
  {
    allowEquivalentVideo = false,
    force = false,
    strategyPreferences = {},
    onStrategy,
  }: ProviderResolutionOptions = {},
): Promise<AdaptiveHttpTrack[]> {
  if (candidate.provider !== "youtube") return tracks;
  const pending = tracks.filter(
    (track) => force || track.urlResolution === "provider_client_pending",
  );
  if (!pending.length) return tracks;
  const videoId = youtubeVideoId(candidate.pageUrl);
  if (!videoId)
    throw new Error("YouTube provider resolution requires a valid video ID.");

  const failures: string[] = [];
  const profilePlan = await providerProfiles(
    videoId,
    allowEquivalentVideo,
    playerRevision(candidate.playerUrl),
  );
  failures.push(...profilePlan.failures);
  const profiles = [...profilePlan.profiles].sort(
    (left, right) =>
      right.baseScore +
      (strategyPreferences[right.strategyId] || 0) -
      (left.baseScore + (strategyPreferences[left.strategyId] || 0)),
  );
  for (const profile of profiles) {
    try {
      const { formats, session, cpn } = await loadProviderFormats(
        videoId,
        profile,
        {
          force,
        },
      );
      const resolved = await Promise.all(
        tracks.map((track) =>
          force || track.urlResolution === "provider_client_pending"
            ? resolveTrackFromFormats(track, formats, session, profile, cpn)
            : track,
        ),
      );
      if (
        resolved.every(
          (track) => track.urlResolution !== "provider_client_pending",
        )
      ) {
        reportProviderStrategy(onStrategy, profile, "success");
        return resolved;
      }
      reportProviderStrategy(onStrategy, profile, "rejected");
      failures.push(`${profile.id}: selected format unavailable`);
    } catch (error) {
      reportProviderStrategy(onStrategy, profile, "error");
      failures.push(`${profile.id}: ${messageOf(error)}`);
    }
  }
  const browserResolved = resolveFromBrowserCandidate(tracks, candidate);
  if (
    browserResolved.every(
      (track) => track.urlResolution !== "provider_client_pending",
    )
  ) {
    reportProviderFallback(
      onStrategy,
      "youtube_browser_handoff",
      "success",
      0.5,
    );
    return browserResolved;
  }
  reportProviderFallback(
    onStrategy,
    "youtube_browser_handoff",
    "rejected",
    0.5,
  );
  try {
    const externalResolved = await resolveYouTubeExternalTracks(
      tracks,
      candidate,
      { allowEquivalentVideo },
    );
    if (
      externalResolved.every(
        (track) => track.urlResolution !== "provider_client_pending",
      )
    ) {
      reportProviderFallback(
        onStrategy,
        "youtube_ytdlp_provider",
        "success",
        0.35,
      );
      return externalResolved;
    }
    reportProviderFallback(
      onStrategy,
      "youtube_ytdlp_provider",
      "rejected",
      0.35,
    );
    failures.push("yt_dlp: selected format unavailable");
  } catch (error) {
    reportProviderFallback(onStrategy, "youtube_ytdlp_provider", "error", 0.35);
    failures.push(`yt_dlp: ${messageOf(error)}`);
  }
  throw new Error(
    `YouTube could not expose the selected adaptive tracks through bounded provider clients (${failures.join("; ")}).`,
  );
}

function reportProviderStrategy(
  onStrategy: DownloadContext["strategy"] | undefined,
  profile: ProviderProfile,
  outcome: "success" | "rejected" | "error",
) {
  reportProviderFallback(
    onStrategy,
    profile.strategyId,
    outcome,
    profile.baseScore,
  );
}

function reportProviderFallback(
  onStrategy: DownloadContext["strategy"] | undefined,
  strategyId: string,
  outcome: "success" | "rejected" | "error",
  score: number,
) {
  onStrategy?.({
    resourceKind: "provider",
    resourceHost: "youtube.com",
    strategyId,
    outcome,
    httpStatus: null,
    score,
  });
}

function resolveFromBrowserCandidate(
  tracks: AdaptiveHttpTrack[],
  candidate: DownloadCandidate,
) {
  const observed = [...candidate.variants, ...candidate.audioTracks].filter(
    (track) => track.sourceUrl && track.urlResolution === "resolved",
  );
  return tracks.map((track) => {
    if (track.urlResolution !== "provider_client_pending") return track;
    const match = observed.find(
      (item) =>
        item.type === track.type &&
        (item.id === track.id ||
          (item.itag === track.itag &&
            (!track.audioTrackId || item.audioTrackId === track.audioTrackId))),
    );
    if (!match?.sourceUrl) return track;
    try {
      const sourceUrl = validatedGoogleVideoUrl(match.sourceUrl);
      return {
        ...track,
        ...match,
        sourceUrl,
        providerClient: "BROWSER",
        requestMode: match.requestMode || "http_range",
        urlResolution: "resolved" as const,
      };
    } catch {
      return track;
    }
  });
}

// This intentionally returns only a quality verdict. URLs and PO tokens remain
// in this process and are regenerated when the user actually starts a job.
export async function preflightYouTubeProviderQualities(
  candidate: DownloadCandidate,
): Promise<YouTubeQualityPreflight> {
  const videoId = youtubeVideoId(candidate.pageUrl);
  if (!videoId)
    return unavailableQualityPreflight("YouTube video ID is unavailable.");
  const plan = await providerProfiles(
    videoId,
    true,
    playerRevision(candidate.playerUrl),
  );
  if (!plan.profiles.length)
    return unavailableQualityPreflight(
      plan.failures.join("; ") || "No YouTube provider profile is available.",
    );
  const failures = [...plan.failures];
  for (const profile of plan.profiles) {
    try {
      const { formats, session, cpn } = await loadProviderFormats(
        videoId,
        profile,
      );
      const verdict = await inspectProviderQualityOptions(
        candidate,
        formats,
        session,
        profile,
        cpn,
        videoId,
      );
      if (verdict.status === "ready") return verdict;
      failures.push(`${profile.id}: ${verdict.reason}`);
    } catch (error) {
      failures.push(`${profile.id}: ${messageOf(error)}`);
    }
  }
  const browserTracks = resolveFromBrowserCandidate(
    [...candidate.variants, ...candidate.audioTracks],
    candidate,
  );
  const browserVerdict = await inspectResolvedQualityOptions(
    browserTracks,
    videoId,
    "browser",
  );
  if (browserVerdict.status === "ready") return browserVerdict;
  failures.push(`browser: ${browserVerdict.reason}`);
  try {
    const external = await resolveYouTubeExternalTracks(
      [...candidate.variants, ...candidate.audioTracks],
      candidate,
      { allowEquivalentVideo: true },
    );
    const verdict = await inspectResolvedQualityOptions(
      external,
      videoId,
      "yt_dlp",
    );
    if (verdict.status === "ready") return verdict;
    failures.push(`yt_dlp: ${verdict.reason}`);
  } catch (error) {
    failures.push(`yt_dlp: ${messageOf(error)}`);
  }
  return unavailableQualityPreflight(
    failures.join("; ") ||
      "No selected YouTube video or audio track is available through the provider profiles.",
  );
}

async function inspectResolvedQualityOptions(
  tracks: AdaptiveHttpTrack[],
  videoId: string,
  sourceId: string,
): Promise<YouTubeQualityPreflight> {
  const preflightSignal = AbortSignal.timeout(SOURCE_PREFLIGHT_TIMEOUT_MS);
  const resolvedCandidates = tracks.filter(
    (track) => track.sourceUrl && track.urlResolution === "resolved",
  );
  const checked = await boundedMap(
    resolvedCandidates,
    SOURCE_PREFLIGHT_CONCURRENCY,
    async (track) => ({
      track,
      available: await preflightResolvedTrack(
        track,
        videoId,
        sourceId,
        preflightSignal,
      ),
    }),
  );
  const resolved = checked
    .filter((item) => item.available)
    .map((item) => item.track);
  const audioTracks = resolved
    .filter((track) => track.type === "audio")
    .sort(compareAudioTracks);
  const audioOptions = audioTracks.map((track) => ({
    id: track.id,
    sourceLabel: audioSourceLabel(track, {
      itag: Number(track.itag),
      has_audio: true,
      has_video: false,
      mime_type: track.mimeType || "audio/mp4",
      bitrate: track.bandwidth || 0,
      language: track.language,
    }),
    language: track.language || null,
    role: track.audioRole || null,
    isDefault: track.audioIsDefault === true,
  }));
  const videoOptions = resolved
    .filter(
      (track) =>
        track.type === "video" &&
        (track.muxed === true || audioTracks.length > 0),
    )
    .map((track) => ({
      id: track.id,
      availability: "equivalent" as const,
      sourceLabel: [track.qualityLabel, track.mimeType]
        .filter(Boolean)
        .join(" · "),
    }));
  if (!videoOptions.length && !audioOptions.length)
    return unavailableQualityPreflight(
      "No selected format was resolved by the optional provider.",
    );
  return {
    status: "ready",
    videoOptions,
    audioOption: audioOptions[0]
      ? {
          id: audioOptions[0].id,
          sourceLabel: audioOptions[0].sourceLabel,
        }
      : null,
    audioOptions,
    reason: null,
  };
}

async function preflightResolvedTrack(
  track: AdaptiveHttpTrack,
  videoId: string,
  sourceId: string,
  signal: AbortSignal,
) {
  const cacheKey = [
    videoId,
    sourceId,
    track.itag || track.id,
    track.audioTrackId || "default",
  ].join(":");
  const cached = sourcePreflightCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.available;
  try {
    await preflightGoogleVideoTrack(track, signal);
    rememberSourcePreflight(cacheKey, true);
    return true;
  } catch {
    rememberSourcePreflight(cacheKey, false);
    return false;
  }
}

async function inspectProviderQualityOptions(
  candidate: DownloadCandidate,
  formats: ProviderFormat[],
  session: Innertube,
  profile: ProviderProfile,
  cpn: string,
  videoId: string,
): Promise<YouTubeQualityPreflight> {
  try {
    const preflightSignal = AbortSignal.timeout(
      SOURCE_PREFLIGHT_TIMEOUT_MS,
    );
    const audioCandidates = (candidate.audioTracks || [])
      .filter((track) => track.type === "audio")
      .map((track) => ({
        track,
        format: selectProviderFormat(track, formats, false),
      }))
      .filter((item) => item.format);
    const videoCandidates = candidate.variants.flatMap((track) => {
      if (track.type !== "video") return [];
      const exact = selectProviderFormat(track, formats, false);
      const replacement = exact || selectProviderFormat(track, formats, true);
      return replacement
        ? [{ track, format: replacement, exact: Boolean(exact) }]
        : [];
    });
    const checkedAudio = await boundedMap(
      audioCandidates,
      SOURCE_PREFLIGHT_CONCURRENCY,
      async (item) => ({
        ...item,
        resolved: await resolveAndPreflightProviderTrack(
          item.track,
          formats,
          session,
          profile,
          cpn,
          videoId,
          preflightSignal,
        ),
      }),
    );
    const audioOptions = checkedAudio.filter((item) => item.resolved);
    audioOptions.sort((left, right) =>
      compareAudioTracks(left.track, right.track),
    );
    const preferredAudio = audioOptions[0];
    const hasRequiredAudio = audioOptions.length > 0;
    const checkedVideo = await boundedMap(
      videoCandidates,
      SOURCE_PREFLIGHT_CONCURRENCY,
      async (item) => ({
        ...item,
        resolved: await resolveAndPreflightProviderTrack(
          item.track,
          formats,
          session,
          profile,
          cpn,
          videoId,
          preflightSignal,
        ),
      }),
    );
    const videoOptions = checkedVideo.flatMap(
      ({ track, format, exact, resolved }) =>
        resolved && (track.muxed || hasRequiredAudio)
          ? [
              {
                id: track.id,
                availability: exact
                  ? ("exact" as const)
                  : ("equivalent" as const),
                sourceLabel: sourceFormatLabel(format),
              },
            ]
          : [],
    );
    if (!videoOptions.length && !preferredAudio)
      return unavailableQualityPreflight(
        "No selected YouTube video or audio track is available through this provider profile.",
      );
    return {
      status: "ready",
      videoOptions,
      audioOption: preferredAudio
        ? {
            id: preferredAudio.track.id,
            sourceLabel: audioSourceLabel(
              preferredAudio.track,
              preferredAudio.format,
            ),
          }
        : null,
      audioOptions: audioOptions.map(({ track, format }) => ({
        id: track.id,
        sourceLabel: audioSourceLabel(track, format),
        language: track.language || format.language || null,
        role: track.audioRole || providerAudioRole(format),
        isDefault:
          track.audioIsDefault === true ||
          format.audio_track?.audio_is_default === true,
      })),
      reason: null,
    };
  } catch (error) {
    return unavailableQualityPreflight(messageOf(error));
  }
}

async function resolveAndPreflightProviderTrack(
  track: AdaptiveHttpTrack,
  formats: ProviderFormat[],
  session: Innertube,
  profile: ProviderProfile,
  cpn: string,
  videoId: string,
  signal: AbortSignal,
) {
  const format = selectProviderFormat(
    track,
    formats,
    profile.allowEquivalentVideo,
  );
  if (!format) return null;
  const cacheKey = [
    videoId,
    profile.id,
    profile.playerRevisionId,
    format.itag,
    format.audio_track?.id || "default",
  ].join(":");
  const cached = sourcePreflightCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now())
    return cached.available ? track : null;
  try {
    const resolved = await resolveTrackFromFormats(
      track,
      formats,
      session,
      profile,
      cpn,
    );
    if (!resolved.sourceUrl || resolved.urlResolution !== "resolved")
      throw new Error("Provider format URL is unresolved.");
    await preflightGoogleVideoTrack(resolved, signal);
    rememberSourcePreflight(cacheKey, true);
    return resolved;
  } catch {
    rememberSourcePreflight(cacheKey, false);
    return null;
  }
}

function rememberSourcePreflight(key: string, available: boolean) {
  sourcePreflightCache.set(key, {
    expiresAt: Date.now() + SOURCE_PREFLIGHT_CACHE_MS,
    available,
  });
  while (sourcePreflightCache.size > 100)
    sourcePreflightCache.delete(sourcePreflightCache.keys().next().value!);
}

async function boundedMap<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await mapper(values[index]);
      }
    }),
  );
  return results;
}

function unavailableQualityPreflight(reason: string): YouTubeQualityPreflight {
  return {
    status: "unavailable",
    videoOptions: [],
    audioOption: null,
    audioOptions: [],
    reason,
  };
}

async function resolveTrackFromFormats(
  track: AdaptiveHttpTrack,
  formats: ProviderFormat[],
  session: Innertube,
  profile: ProviderProfile,
  cpn: string,
): Promise<AdaptiveHttpTrack> {
  const format = selectProviderFormat(
    track,
    formats,
    profile.allowEquivalentVideo,
  );
  if (!format) return track;
  const rawUrl =
    typeof format.decipher === "function"
      ? await format.decipher(session.session.player)
      : typeof format.url === "string"
        ? format.url
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
    requestMode: profile.requestMode,
    requestCpn: cpn,
    language: format.language || track.language || null,
    audioTrackId: format.audio_track?.id || track.audioTrackId || null,
    audioTrackName:
      format.audio_track?.display_name || track.audioTrackName || null,
    audioRole: providerAudioRole(format) || track.audioRole || null,
    audioIsDefault:
      format.audio_track?.audio_is_default === true ||
      track.audioIsDefault === true,
    isDrc: format.is_drc === true || track.isDrc === true,
    audioSampleRate:
      positiveInteger(format.audio_sample_rate) ||
      track.audioSampleRate ||
      null,
    audioChannels:
      positiveInteger(format.audio_channels) || track.audioChannels || null,
    audioQuality: format.audio_quality || track.audioQuality || null,
  };
}

function selectProviderFormat(
  track: AdaptiveHttpTrack,
  formats: ProviderFormat[],
  allowEquivalentVideo: boolean,
) {
  const correctType = (item: ProviderFormat) =>
    track.type === "video" ? item.has_video : item.has_audio;
  const exact = formats
    .filter((item) => item.itag === Number(track.itag) && correctType(item))
    .sort(
      (left, right) =>
        providerAudioMatchScore(right, track) -
        providerAudioMatchScore(left, track),
    )[0];
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

function providerAudioMatchScore(
  format: ProviderFormat,
  track: AdaptiveHttpTrack,
) {
  if (track.type !== "audio") return 0;
  let score = 0;
  if (track.audioTrackId && format.audio_track?.id === track.audioTrackId)
    score += 100;
  if (track.language && format.language === track.language) score += 40;
  if (track.audioRole && providerAudioRole(format) === track.audioRole)
    score += 30;
  if (
    track.audioIsDefault === true &&
    format.audio_track?.audio_is_default === true
  )
    score += 10;
  if (track.isDrc === format.is_drc) score += 5;
  return score;
}

function providerAudioRole(
  format: ProviderFormat,
): AdaptiveHttpTrack["audioRole"] {
  if (format.is_original) return "original";
  if (format.is_auto_dubbed) return "auto_dubbed";
  if (format.is_dubbed) return "dubbed";
  if (format.is_descriptive) return "descriptive";
  if (format.is_secondary) return "secondary";
  return null;
}

function compareAudioTracks(left: AdaptiveHttpTrack, right: AdaptiveHttpTrack) {
  return (
    audioPreferenceScore(right) - audioPreferenceScore(left) ||
    (right.averageBandwidth || right.bandwidth || 0) -
      (left.averageBandwidth || left.bandwidth || 0) ||
    mp4AudioScore(right) - mp4AudioScore(left)
  );
}

function audioPreferenceScore(track: AdaptiveHttpTrack) {
  const role =
    {
      original: 50,
      secondary: 30,
      dubbed: 20,
      auto_dubbed: 10,
      descriptive: 5,
    }[track.audioRole || ""] || 25;
  return role + (track.audioIsDefault ? 4 : 0) - (track.isDrc ? 1 : 0);
}

function audioSourceLabel(track: AdaptiveHttpTrack, format: ProviderFormat) {
  const role = track.audioRole || providerAudioRole(format) || null;
  return [
    formatAudioLanguageLabel({
      language: track.language || format.language,
      name: track.audioTrackName || format.audio_track?.display_name,
      role,
      isDefault:
        track.audioIsDefault === true ||
        format.audio_track?.audio_is_default === true,
    }),
    audioBitrateLabel(
      format.average_bitrate ||
        format.bitrate ||
        track.averageBandwidth ||
        track.bandwidth,
    ),
    sourceFormatLabel(format),
    audioChannelsLabel(format.audio_channels || track.audioChannels),
    audioSampleRateLabel(format.audio_sample_rate || track.audioSampleRate),
  ]
    .filter(Boolean)
    .join(" · ");
}

function audioBitrateLabel(value: number | null | undefined) {
  const bitrate = positiveInteger(value);
  return bitrate ? `${Math.round(bitrate / 1000)} kbps` : null;
}

function audioChannelsLabel(value: number | null | undefined) {
  const channels = positiveInteger(value);
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  return channels ? `${channels} channels` : null;
}

function audioSampleRateLabel(value: number | null | undefined) {
  const rate = positiveInteger(value);
  if (!rate) return null;
  const khz = rate / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

function formatCompatibilityScore(
  format: ProviderFormat,
  requested: AdaptiveHttpTrack,
) {
  const targetContainer = cleanMimeType(requested.mimeType)?.split("/", 2)[1];
  const actualContainer = cleanMimeType(format.mime_type)?.split("/", 2)[1];
  return targetContainer && targetContainer === actualContainer ? 1 : 0;
}

function mp4AudioScore(track: AdaptiveHttpTrack) {
  return /\/(?:mp4|m4a)(?:$|;)/i.test(track.mimeType || "") ? 1 : 0;
}

function sourceFormatLabel(format: ProviderFormat) {
  const mime = String(format.mime_type || "").toLowerCase();
  const container = mime.includes("webm")
    ? "WebM"
    : mime.includes("ogg")
      ? "OGG"
      : "MP4";
  const codec = mime.includes("av01")
    ? "AV1"
    : mime.includes("vp9") || mime.includes("vp09")
      ? "VP9"
      : mime.includes("avc1") || mime.includes("avc3")
        ? "H.264"
        : mime.includes("opus")
          ? "Opus"
          : mime.includes("mp4a") || mime.includes("aac")
            ? "AAC"
            : null;
  return [format.quality_label, container, codec].filter(Boolean).join(" · ");
}

async function loadProviderFormats(
  videoId: string,
  profile: ProviderProfile,
  { force = false } = {},
) {
  // Keep each client/profile isolated. A PO-enabled Web response must never
  // reuse a URL/CPN pair obtained from the non-PO Web fallback, otherwise the
  // URL receives a token from a different provider context and GVS can return
  // 403 after the initial probe.
  const key = `${profile.id}:${profile.client}:${profile.playerRevisionId}:${videoId}`;
  const cached = responseCache.get(key);
  const session = await getSession();
  if (!force && cached && cached.expiresAt > Date.now())
    return { formats: cached.formats, session, cpn: cached.cpn };
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
    cpn: info.cpn,
  });
  while (responseCache.size > MAX_CACHE_ITEMS)
    responseCache.delete(responseCache.keys().next().value as string);
  return { formats, session, cpn: info.cpn };
}

async function providerProfiles(
  videoId: string,
  allowEquivalentVideo: boolean,
  playerRevisionId: string,
): Promise<{ profiles: ProviderProfile[]; failures: string[] }> {
  const profiles: ProviderProfile[] = [];
  const failures: string[] = [];
  const poPlans = [
    {
      id: "mweb_po",
      client: "MWEB" as const,
      strategyId: "youtube_mweb_po",
      baseScore: 1,
    },
    {
      id: "web_po",
      client: "WEB" as const,
      strategyId: "youtube_web_po",
      baseScore: 0.95,
    },
    {
      id: "web_remix_po",
      client: "YTMUSIC" as const,
      strategyId: "youtube_ytmusic_po",
      baseScore: 0.8,
    },
  ];
  for (const plan of poPlans) {
    try {
      profiles.push({
        ...plan,
        poToken: await resolveYouTubeWebPoToken(videoId, {
          profileId: plan.id,
          playerRevision: playerRevisionId,
        }),
        // Keep the request fingerprint identical to the environment that
        // minted the proof; mixing an iPad UA with a Web proof is rejected.
        requestUserAgent: YOUTUBE_WEB_PO_USER_AGENT,
        requestMode: "http_range",
        allowEquivalentVideo,
        playerRevisionId,
      });
    } catch (error) {
      failures.push(`${plan.id}: ${messageOf(error)}`);
    }
  }
  profiles.push(
    {
      id: "ios_direct",
      client: "IOS",
      poToken: null,
      requestUserAgent: Constants.CLIENTS.IOS.USER_AGENT,
      requestMode: "youtube_query_range",
      allowEquivalentVideo: false,
      strategyId: "youtube_mobile_direct",
      baseScore: 0.65,
      playerRevisionId,
    },
    {
      id: "android_direct",
      client: "ANDROID",
      poToken: null,
      requestUserAgent: Constants.CLIENTS.ANDROID.USER_AGENT,
      requestMode: "youtube_query_range",
      allowEquivalentVideo: false,
      strategyId: "youtube_mobile_direct",
      baseScore: 0.64,
      playerRevisionId,
    },
    {
      // The regular Web client is a deliberately bounded last resort. Some
      // channels expose a format set that is absent from the mobile clients;
      // youtubei still gives us a decipher callback for these URLs, while the
      // earlier profiles remain preferred because they are less challenge-
      // sensitive and do not need a page Player JS handoff.
      id: "web_direct",
      client: "WEB",
      poToken: null,
      requestUserAgent: YOUTUBE_WEB_PO_USER_AGENT,
      requestMode: "http_range",
      allowEquivalentVideo,
      strategyId: "youtube_web_direct",
      baseScore: 0.55,
      playerRevisionId,
    },
  );
  return { profiles, failures };
}

function playerRevision(value: string | null | undefined) {
  try {
    return (
      new URL(value || "").pathname.match(/^\/s\/player\/([^/]+)\//)?.[1] ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
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
