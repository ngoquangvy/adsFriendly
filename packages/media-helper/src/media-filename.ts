import { basename, extname } from "node:path";
import type { DownloadJob } from "./download-types.js";
import { sanitizeFilename } from "./output-paths.js";
import {
  audioContainer,
  AUDIO_EXTENSIONS,
  sourceMime,
} from "../../../src/media/content-type.js";

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
  const audioExtension =
    audioContainer(probe.contentType) || audioContainer(job.candidate.mimeType);
  if (
    job.candidate.mediaType === "audio" ||
    audioExtension ||
    AUDIO_EXTENSIONS.includes(extname(urlName).slice(1).toLowerCase())
  ) {
    const responseMime = sourceMime(probe.contentType);
    if (
      responseMime &&
      !audioContainer(responseMime) &&
      !["application/octet-stream", "binary/octet-stream"].includes(
        responseMime,
      )
    )
      throw Error(
        "Audio source returned a non-audio response. No file was downloaded.",
      );
    const extension =
      audioExtension ||
      (AUDIO_EXTENSIONS.includes(extname(urlName).slice(1).toLowerCase())
        ? extname(urlName).slice(1).toLowerCase()
        : null);
    if (!extension)
      throw Error(
        "Audio container is unknown. Keep this source in the browser; no video extension will be guessed.",
      );
    const suffix = `.${extension}`;
    const raw = disposition || job.candidate.title || urlName || "audio";
    const existing = extname(raw);
    const stem =
      AUDIO_EXTENSIONS.includes(existing.slice(1).toLowerCase()) ||
      /^\.(webm|mp4)$/i.test(existing)
        ? raw.slice(0, -existing.length)
        : raw;
    return `${sanitizeFilename(stem, "", "audio").slice(0, 180 - suffix.length)}${suffix}`;
  }
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
