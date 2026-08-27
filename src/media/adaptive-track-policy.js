export const ADAPTIVE_TRACK_RESOLUTION = Object.freeze({
  RESOLVED: "resolved",
  N_TRANSFORM_PENDING: "n_transform_pending",
  SIGNATURE_CIPHER_PENDING: "signature_cipher_pending",
  PROVIDER_CLIENT_PENDING: "provider_client_pending",
});

export function hasHttpAdaptiveTrackUrl(track) {
  try {
    return ["http:", "https:"].includes(
      new URL(track?.sourceUrl || track?.url).protocol,
    );
  } catch {
    return false;
  }
}

export function isYouTubeProviderResolvableTrack(candidate, track) {
  return (
    candidate?.provider === "youtube" &&
    track?.urlResolution ===
      ADAPTIVE_TRACK_RESOLUTION.PROVIDER_CLIENT_PENDING &&
    /^\d{1,6}$/.test(String(track?.itag || ""))
  );
}

export function isAcquirableAdaptiveTrack(candidate, track) {
  if (isYouTubeProviderResolvableTrack(candidate, track)) return true;
  if (!hasHttpAdaptiveTrackUrl(track)) return false;
  if (
    [
      ADAPTIVE_TRACK_RESOLUTION.N_TRANSFORM_PENDING,
      ADAPTIVE_TRACK_RESOLUTION.SIGNATURE_CIPHER_PENDING,
    ].includes(track?.urlResolution)
  )
    return Boolean(candidate?.playerUrl);
  return true;
}

export function hasYouTubeProviderPendingTracks(candidate) {
  return [
    ...(candidate?.variants || []),
    ...(candidate?.audioTracks || []),
  ].some((track) => isYouTubeProviderResolvableTrack(candidate, track));
}
