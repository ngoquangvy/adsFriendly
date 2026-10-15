import type { DownloadJob } from "./download-types.js";
import type { HttpTransferSource } from "./http-transfer-types.js";
import { createYouTubeHttpSource } from "./youtube-http-profile.js";

// Maps existing media jobs onto the provider-neutral HTTP transfer contract.
export function createMediaHttpSource(job: DownloadJob): HttpTransferSource {
  const url = job.candidate.sourceUrl;
  if (!url) throw new Error("Direct media URL is missing.");
  const youtube = job.candidate.provider === "youtube";
  const headers = {
    Accept: "*/*",
    ...(youtube
      ? {
          Origin: "https://www.youtube.com",
          Referer: "https://www.youtube.com",
        }
      : { Referer: job.candidate.pageUrl }),
    "User-Agent": job.browserUserAgent || "AdsFriendlyMediaHelper/0.11",
    ...(youtube ? { DNT: "?1" } : {}),
  };
  return createYouTubeHttpSource(job, headers) || { url, headers };
}
