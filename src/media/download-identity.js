import {
  normalizeMediaDownloadOutput,
  getMediaVideoQualityOptions,
  getMediaAudioTrackOptions,
  getMediaDownloadProfiles,
} from "./download-options.js";
import { facebookMediaAssetKey } from "./catalog-view.js";
import { isMediaJobActive } from "./download-job-view.js";

export const DOWNLOAD_IDENTITY_SCHEMA = "download-identity.v1";
export const RECENT_DOWNLOAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Conservative identity: known provider IDs survive signed URL rotation. Generic
// sources retain their query/path semantics; never guess by title, size or page.
function sourceIdentity(candidate) {
  if (candidate.provider === "youtube" && candidate.kind === "adaptive") {
    for (const value of [candidate.pageUrl, candidate.sourceUrl]) {
      try {
        const url = new URL(value);
        if (!/(^|\.)youtube\.com$/.test(url.hostname)) continue;
        const id =
          url.searchParams.get("v") ||
          url.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
        if (id) return { asset: `youtube:${id}`, representation: "adaptive" };
      } catch {}
    }
  }
  if (candidate.provider === "facebook" && candidate.kind === "adaptive") {
    const id = facebookMediaAssetKey(candidate);
    if (id) return { asset: id, representation: "adaptive" };
  }
  const url = new URL(candidate.manifestUrl || candidate.sourceUrl);
  if (!/^https?:$/.test(url.protocol))
    throw new Error("HTTP media source required.");
  url.hash = "";
  for (const key of ["range", "bytestart", "byteend"])
    url.searchParams.delete(key);
  url.searchParams.sort();
  // This documented source shape carries the video ID in both directory and
  // filename. Only its two authorization path components are excluded; semantic
  // language/quality parameters remain part of the representation identity.
  if (
    candidate.kind === "direct" &&
    /^s\d+\.pornone\.com$/.test(url.hostname)
  ) {
    const match = url.pathname.match(
      /^\/vid2\/[^/]+\/\d+\/[^/]+\/(\d+)\/(\d+_[^/]+\.mp4)$/,
    );
    if (match && match[2].startsWith(`${match[1]}_`))
      return {
        asset: `pornone:${match[1]}`,
        representation: `${match[2]}${url.search}`,
      };
  }
  return { asset: `${candidate.kind}:${url.href}`, representation: "source" };
}

function trackIdentity(track, candidate) {
  if (!track) return null;
  const facts = {
    itag: track.itag || null,
    codec: track.codecs || track.mimeType || null,
    width: track.width || track.resolution?.width || null,
    height: track.height || track.resolution?.height || null,
    fps: track.frameRate || track.fps || null,
    bitrate: track.averageBandwidth || track.bandwidth || null,
    audioTrackId: track.audioTrackId || null,
    language: track.language || null,
    role: track.audioRole || null,
    sampleRate: track.audioSampleRate || null,
    channels: track.audioChannels || null,
    muxed: track.muxed === true,
    drc: track.isDrc === true,
  };
  if (
    candidate.provider === "facebook" &&
    facebookMediaAssetKey(candidate) &&
    facebookMediaAssetKey({
      ...candidate,
      sourceUrl: track.sourceUrl || track.url,
    }) === facebookMediaAssetKey(candidate)
  ) {
    try {
      const source = new URL(track.sourceUrl || track.url);
      // CDN host/authentication may rotate. Keep the path and representation
      // envelope; they distinguish renditions even when dimensions are absent.
      facts.source = `${source.pathname}|${source.searchParams.get("efg") || ""}`;
    } catch {
      facts.source = track.sourceUrl || track.url || track.id;
    }
  } else if (candidate.provider !== "youtube")
    facts.source = track.sourceUrl || track.url || track.id;
  // Missing itag on a provider track must not collapse distinct descriptors.
  else if (!facts.itag) facts.id = track.id;
  return facts;
}

async function digest(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function buildMediaDownloadIdentity(candidate, value) {
  const output = normalizeMediaDownloadOutput(value, candidate);
  const audioOnly = output.profileId === "audio-ogg";
  const source = sourceIdentity(candidate);
  const tracks = (values) =>
    values
      .map((track) => JSON.stringify(trackIdentity(track, candidate)))
      .sort();
  const selection = {
    profile: output.profileId,
    representation: source.representation,
    video: audioOnly
      ? null
      : output.videoTrackId
        ? trackIdentity(
            candidate.variants?.find(
              (track) => track.id === output.videoTrackId,
            ),
            candidate,
          )
        : candidate.kind === "adaptive"
          ? { auto: tracks(candidate.variants || []) }
          : "source",
    audio: output.audioTrackId
      ? trackIdentity(
          candidate.audioTracks?.find(
            (track) => track.id === output.audioTrackId,
          ),
          candidate,
        )
      : candidate.kind === "adaptive"
        ? { auto: tracks(candidate.audioTracks || []) }
        : "included",
  };
  const [assetKey, selectionKey] = await Promise.all([
    digest(source.asset),
    digest(selection),
  ]);
  return Object.freeze({
    schema: DOWNLOAD_IDENTITY_SCHEMA,
    assetKey,
    selectionKey,
    requestKey: await digest([assetKey, selectionKey]),
  });
}

export function buildMediaDownloadSummary(candidate, value) {
  const output = normalizeMediaDownloadOutput(value, candidate);
  const quality = getMediaVideoQualityOptions(candidate).find(
    (item) => item.id === output.videoTrackId,
  );
  const audio = getMediaAudioTrackOptions(candidate).find(
    (item) => item.id === output.audioTrackId,
  );
  const height = candidate.resolution?.height;
  return {
    profileLabel:
      getMediaDownloadProfiles(candidate).find(
        (item) => item.id === output.profileId,
      )?.label || output.profileId,
    qualityLabel:
      output.profileId === "audio-ogg" || candidate.mediaType === "audio"
        ? "Audio only"
        : quality?.label ||
          (candidate.kind === "adaptive"
            ? "Auto quality"
            : height
              ? `${height}p`
              : "Source quality"),
    audioLabel: audio?.label || null,
  };
}

export function normalizeDownloadIdentity(value) {
  return value?.schema === DOWNLOAD_IDENTITY_SCHEMA &&
    [value.assetKey, value.selectionKey, value.requestKey].every(
      (key) => typeof key === "string" && /^[a-f0-9]{64}$/.test(key),
    )
    ? {
        schema: DOWNLOAD_IDENTITY_SCHEMA,
        assetKey: value.assetKey,
        selectionKey: value.selectionKey,
        requestKey: value.requestKey,
      }
    : null;
}

export function findRelatedDownloadJobs(
  jobs,
  identity,
  { exact = true, now = Date.now() } = {},
) {
  const normalized = normalizeDownloadIdentity(identity);
  if (!normalized) return [];
  return jobs
    .filter((job) => {
      const saved = normalizeDownloadIdentity(job.downloadIdentity);
      if (
        !saved ||
        saved.assetKey !== normalized.assetKey ||
        (exact && saved.requestKey !== normalized.requestKey)
      )
        return false;
      return (
        isMediaJobActive(job) ||
        (job.status === "completed" &&
          Number(job.updatedAt) >= now - RECENT_DOWNLOAD_WINDOW_MS)
      );
    })
    .sort(
      (a, b) =>
        Number(isMediaJobActive(b)) - Number(isMediaJobActive(a)) ||
        (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
    );
}

export function presentDownloadJob(job, fileStatus = "unchecked") {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    title: job.title,
    updatedAt: job.updatedAt,
    progress: job.progress ? { ...job.progress } : null,
    outputPath: job.outputPath || null,
    output: job.output || null,
    summary: job.downloadSummary || null,
    fileStatus,
  };
}
