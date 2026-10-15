import { basename, extname } from "node:path";
import type { DownloadJob } from "./download-types.js";
import { sanitizeFilename } from "./output-paths.js";

// Media-only naming defaults must not be applied to future generic file jobs.
export function chooseMediaFilename(
  job: DownloadJob,
  probe: {
    url: string;
    contentDisposition: string | null;
    contentType: string | null;
  },
) {
  const disposition = dispositionFilename(probe.contentDisposition);
  const urlName = decodeURIComponentSafe(basename(new URL(probe.url).pathname));
  const extension = mediaExtension(
    urlName,
    job.candidate.mimeType || probe.contentType,
  );
  const titleName = job.candidate.title
    ? extname(job.candidate.title)
      ? job.candidate.title
      : `${job.candidate.title}${extension}`
    : null;
  const preferred =
    disposition || titleName || urlName || `video${extension || ".mp4"}`;
  return sanitizeFilename(preferred, extension || ".mp4");
}

function dispositionFilename(value: string | null) {
  if (!value) return null;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponentSafe(encoded.replace(/^"|"$/g, ""));
  return value.match(/filename="?([^";]+)"?/i)?.[1]?.trim() || null;
}

function mediaExtension(filename: string, mimeType: string | null) {
  const existing = extname(filename);
  if (/^\.[a-z0-9]{1,6}$/i.test(existing)) return existing;
  const type = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  return (
    (
      {
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "video/quicktime": ".mov",
        "audio/mp4": ".m4a",
        "audio/mpeg": ".mp3",
      } as Record<string, string>
    )[type || ""] || ".mp4"
  );
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
