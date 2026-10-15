import type { AdaptiveHttpTrack, DownloadJob } from "./download-types.js";
import { assertSafeRemoteUrl, fetchRemote } from "./http-remote.js";
import type { HttpTransferSource } from "./http-transfer-types.js";

export function createYouTubeHttpSource(
  job: DownloadJob,
  headers: Record<string, string>,
): HttpTransferSource | null {
  const sourceUrl = job.candidate.sourceUrl;
  if (!sourceUrl || !isGoogleVideoUrl(sourceUrl)) return null;
  return {
    url: sourceUrl,
    headers,
    preferRangeProbe: true,
    verifyRangeSupport: false,
    rangeSizeHint:
      positiveInteger(job.candidate.contentLength) ||
      positiveInteger(new URL(sourceUrl).searchParams.get("clen")),
    rangeRequest(url, range, etag) {
      const queryUrl = youtubeQueryRangeUrl(
        url,
        job.candidate.requestCpn,
        range.start,
        range.end,
        job.candidate.requestMode === "youtube_query_range",
      );
      return {
        url: queryUrl || url,
        headers: queryUrl
          ? headers
          : {
              ...headers,
              Range: `bytes=${range.start}-${range.end}`,
              ...(etag ? { "If-Range": etag } : {}),
            },
        acceptsFullResponse: Boolean(queryUrl),
      };
    },
    async afterProbe(probe, signal) {
      if (probe.acceptsRanges && probe.totalBytes)
        await probeGoogleVideoContinuation(
          job,
          sourceUrl,
          probe.totalBytes,
          headers,
          signal,
        );
    },
    probeFailure: (url, status) =>
      mediaProbeFailure(url, status, job.candidate.requestMode || "http-range"),
    rangeFailure: (url, status, range, request) =>
      rangeFailureMessage(
        url,
        status,
        range,
        request.acceptsFullResponse ? "youtube-query-range" : "http-range",
      ),
  };
}

const GOOGLEVIDEO_CONTINUATION_OFFSET = 1024 * 1024;
const YOUTUBE_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface ByteRange {
  index: number;
  start: number;
  end: number;
  length: number;
}

export async function probeGoogleVideoContinuation(
  job: DownloadJob,
  sourceUrl: string,
  totalBytes: number,
  headers: Record<string, string>,
  signal: AbortSignal,
) {
  const offset = Math.min(
    GOOGLEVIDEO_CONTINUATION_OFFSET,
    Math.max(0, totalBytes - 1),
  );
  if (offset <= 0) return;
  const queryRange = youtubeQueryRangeUrl(
    sourceUrl,
    job.candidate.requestCpn,
    offset,
    offset,
    job.candidate.requestMode === "youtube_query_range",
  );
  const response = await fetchRemote(
    queryRange || sourceUrl,
    queryRange
      ? { headers, signal }
      : { headers: { ...headers, Range: `bytes=${offset}-${offset}` }, signal },
  );
  if (!response.ok || (response.status !== 206 && totalBytes > 1)) {
    await response.body?.cancel().catch(() => {});
    throw new Error(
      `GoogleVideo continuation preflight rejected byte ${offset} (HTTP ${response.status}). ` +
        "The first byte worked, but this provider URL cannot continue reliably. " +
        `Diagnostics: ${googleVideoDiagnostics(
          queryRange || sourceUrl,
          { index: 1, start: offset, end: offset, length: 1 },
          job.candidate.requestMode || "http-range",
        )}.`,
    );
  }
  await response.body?.cancel().catch(() => {});
}

/**
 * Verifies a resolved GoogleVideo track without downloading media. Both
 * positions must return a byte range so a cold-start URL cannot be presented
 * as downloadable after only accepting the first probe.
 */
export async function preflightGoogleVideoTrack(
  track: AdaptiveHttpTrack,
  signal: AbortSignal,
) {
  if (!track.sourceUrl || !isGoogleVideoUrl(track.sourceUrl))
    throw new Error("Resolved GoogleVideo URL is unavailable.");
  await assertSafeRemoteUrl(track.sourceUrl);
  const headers = {
    Accept: "*/*",
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com",
    "User-Agent": track.requestUserAgent || YOUTUBE_BROWSER_USER_AGENT,
    DNT: "?1",
  };
  const firstUrl = youtubeQueryRangeUrl(
    track.sourceUrl,
    track.requestCpn,
    0,
    0,
    track.requestMode === "youtube_query_range",
  );
  const first = await fetchRemote(firstUrl || track.sourceUrl, {
    headers: firstUrl ? headers : { ...headers, Range: "bytes=0-0" },
    signal,
  });
  const contentRange = first.headers.get("content-range");
  const rangeTotal = contentRange?.match(/\/(\d+)$/)?.[1] || null;
  const declaredUrlSize = positiveInteger(
    new URL(track.sourceUrl).searchParams.get("clen"),
  );
  const totalBytes =
    positiveInteger(rangeTotal) ||
    positiveInteger(track.contentLength) ||
    declaredUrlSize;
  const firstAccepted = first.ok && (first.status === 206 || totalBytes === 1);
  await first.body?.cancel().catch(() => {});
  if (!firstAccepted)
    throw new Error(
      `GoogleVideo rejected the first-byte preflight (HTTP ${first.status}).`,
    );
  if (!totalBytes)
    throw new Error("GoogleVideo preflight did not declare a track size.");
  const offset = Math.min(
    GOOGLEVIDEO_CONTINUATION_OFFSET,
    Math.max(0, totalBytes - 1),
  );
  if (offset > 0) {
    const continuationUrl = youtubeQueryRangeUrl(
      track.sourceUrl,
      track.requestCpn,
      offset,
      offset,
      track.requestMode === "youtube_query_range",
    );
    const continuation = await fetchRemote(continuationUrl || track.sourceUrl, {
      headers: continuationUrl
        ? headers
        : { ...headers, Range: `bytes=${offset}-${offset}` },
      signal,
    });
    const accepted = continuation.ok && continuation.status === 206;
    await continuation.body?.cancel().catch(() => {});
    if (!accepted)
      throw new Error(
        `GoogleVideo rejected the continuation preflight at byte ${offset} (HTTP ${continuation.status}).`,
      );
  }
  return { totalBytes };
}

export function mediaProbeFailure(url: string, status: number, mode: string) {
  if (status === 403 && isGoogleVideoUrl(url)) {
    return (
      `GoogleVideo probe rejected HTTP 403 before byte transfer. ` +
      "The provider URL, client profile, or proof-of-origin token was rejected. " +
      `Diagnostics: ${googleVideoDiagnostics(url, { index: 0, start: 0, end: 0, length: 1 }, mode)}.`
    );
  }
  return `Media server returned HTTP ${status} during the initial probe.`;
}

export function rangeFailureMessage(
  url: string,
  status: number,
  range: ByteRange,
  mode = "http-range",
) {
  if (status === 403 && isGoogleVideoUrl(url)) {
    return (
      `GoogleVideo rejected bytes ${range.start}-${range.end} after accepting the initial probe (HTTP 403). ` +
      "This stream requires a valid GVS Proof-of-Origin token or a fresh provider URL. " +
      `Diagnostics: ${googleVideoDiagnostics(url, range, mode)}.`
    );
  }
  return `Range request for bytes ${range.start}-${range.end} returned HTTP ${status}.`;
}

function googleVideoDiagnostics(value: string, range: ByteRange, mode: string) {
  try {
    const url = new URL(value);
    const expire = positiveInteger(url.searchParams.get("expire"));
    const secondsUntilExpiry = expire
      ? Math.round(expire - Date.now() / 1000)
      : null;
    const values = [
      `host=${url.hostname}`,
      `itag=${url.searchParams.get("itag") || "unknown"}`,
      `client=${url.searchParams.get("c") || "unknown"}`,
      `po=${url.searchParams.has("pot") ? "present" : "absent"}`,
      `signature=${url.searchParams.has("sig") || url.searchParams.has("lsig") ? "present" : "absent"}`,
      `expiry=${secondsUntilExpiry === null ? "unknown" : `${secondsUntilExpiry}s`}`,
      `declaredSize=${url.searchParams.get("clen") || "unknown"}`,
      `rangeSize=${range.length}`,
      `mode=${mode}`,
      `cpn=${url.searchParams.has("cpn") ? "present" : "absent"}`,
    ];
    return values.join(", ");
  } catch {
    return `rangeSize=${range.length}, url=invalid`;
  }
}

export function isGoogleVideoUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === "googlevideo.com" || hostname.endsWith(".googlevideo.com")
    );
  } catch {
    return false;
  }
}

export function youtubeQueryRangeUrl(
  value: string,
  cpn: string | null | undefined,
  start: number,
  end: number,
  enabled: boolean,
) {
  if (
    !enabled ||
    !cpn ||
    !/^[A-Za-z0-9_-]{8,64}$/.test(cpn) ||
    !isGoogleVideoUrl(value)
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    url.searchParams.set("cpn", cpn);
    url.searchParams.set("range", `${start}-${end}`);
    return url.href;
  } catch {
    return null;
  }
}

function positiveInteger(value: string | number | null | undefined) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
