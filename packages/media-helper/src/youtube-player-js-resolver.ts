import { Script } from "node:vm";
import { Platform, Player } from "youtubei.js";
import type { AdaptiveHttpTrack, DownloadCandidate } from "./download-types.js";

const PLAYER_EVALUATION_TIMEOUT_MS = 1_500;
const PLAYER_FETCH_TIMEOUT_MS = 12_000;
const playerCache = new Map<string, Promise<Player>>();

Platform.shim.eval = async (data) =>
  new Script(`(function(){${data.output}\n})()`).runInNewContext(
    Object.create(null),
    { timeout: PLAYER_EVALUATION_TIMEOUT_MS },
  );

export async function resolveYouTubePlayerTrack(
  track: AdaptiveHttpTrack,
  candidate: DownloadCandidate,
): Promise<AdaptiveHttpTrack> {
  if (track.urlResolution !== "n_transform_pending") return track;
  if (candidate.provider !== "youtube" || !candidate.playerUrl)
    throw new Error(
      "YouTube n transform requires the Player JS URL captured by the extension. Reload the video page and retry.",
    );
  const playerId = youtubePlayerId(candidate.playerUrl);
  if (!playerId)
    throw new Error("The captured YouTube Player JS URL is invalid.");
  const source = validatedGoogleVideoUrl(track.sourceUrl);
  const originalN = source.searchParams.get("n");
  if (!originalN) return { ...track, urlResolution: "resolved" };

  const player = await getPlayer(playerId);
  const resolved = validatedGoogleVideoUrl(await player.decipher(source.href));
  const resolvedN = resolved.searchParams.get("n");
  if (
    !resolvedN ||
    resolvedN === originalN ||
    resolvedN.startsWith("enhanced_except_")
  )
    throw new Error(
      `YouTube Player ${playerId} did not resolve the n challenge for itag ${track.itag || track.id}.`,
    );
  if (
    resolved.origin !== source.origin ||
    resolved.pathname !== source.pathname
  )
    throw new Error("YouTube Player JS returned an unexpected media endpoint.");
  return {
    ...track,
    sourceUrl: resolved.href,
    urlResolution: "resolved",
  };
}

export function youtubePlayerId(playerUrl: string): string | null {
  try {
    const url = new URL(playerUrl);
    if (!(
      url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")
    ))
      return null;
    return url.pathname.match(/^\/s\/player\/([^/]+)\//)?.[1] || null;
  } catch {
    return null;
  }
}

function getPlayer(playerId: string): Promise<Player> {
  let pending = playerCache.get(playerId);
  if (!pending) {
    pending = Player.create(undefined, boundedFetch, undefined, playerId).catch(
      (error) => {
        playerCache.delete(playerId);
        throw error;
      },
    );
    playerCache.set(playerId, pending);
  }
  return pending;
}

function boundedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const timeoutSignal = AbortSignal.timeout(PLAYER_FETCH_TIMEOUT_MS);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(input, { ...init, signal });
}

function validatedGoogleVideoUrl(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !(
      url.hostname === "googlevideo.com" ||
      url.hostname.endsWith(".googlevideo.com")
    ) ||
    url.pathname !== "/videoplayback"
  )
    throw new Error("YouTube track URL is not a Google Video playback URL.");
  return url;
}
