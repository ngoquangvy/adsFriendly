export const FILE_HELPER_REQUESTS = Object.freeze({
  FILE_PREPARE: "file.prepare",
  FILE_START: "file.start",
  FILE_CANCEL: "file.cancel",
});
export const FILE_HELPER_EVENTS = Object.freeze({
  FILE_PREPARED: "file.prepared",
  FILE_STARTED: "file.started",
  FILE_PROGRESS: "file.progress",
  FILE_COMPLETED: "file.completed",
  FILE_CANCELLED: "file.cancelled",
  FILE_FAILED: "file.failed",
});
export const FILE_HTTP_CAPABILITY = "download.file_http";
export const FILE_TRANSFER_KEY = "browserFileTransfers.v1";
export const FILE_MESSAGES = Object.freeze({
  CHECK: "CHECK_BROWSER_FILE",
  ACCEPT: "ACCEPT_BROWSER_FILE",
  RETURN: "RETURN_BROWSER_FILE",
  OPEN: "OPEN_BROWSER_FILE",
  REVEAL: "REVEAL_BROWSER_FILE",
});
export const FILE_EXTENSIONS = Object.freeze([
  "zip",
  "7z",
  "rar",
  "gz",
  "tar",
  "pdf",
  "txt",
  "csv",
  "json",
  "xml",
  "epub",
  "mp4",
  "mkv",
  "webm",
  "mov",
  "mp3",
  "m4a",
  "ogg",
  "oga",
  "opus",
  "flac",
  "wav",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
]);

export function normalizeFilePayload(value) {
  if (!value || typeof value !== "object")
    throw Error("File request required.");
  const jobId = fileId(value.jobId);
  let url;
  try {
    url = new URL(value.url);
  } catch {
    throw Error("File URL is invalid.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("Only credential-free HTTP(S) files are supported.");
  const filename =
    String(value.filename || "")
      .split(/[\\/]/)
      .pop() || "";
  const extension = filename.split(".").pop().toLowerCase();
  if (!FILE_EXTENSIONS.includes(extension))
    throw Error("This file type must stay in Chrome.");
  if (!Number.isSafeInteger(value.expected?.size) || value.expected.size <= 0)
    throw Error("A known file size is required.");
  const etag = String(value.expected?.etag || "");
  if (!/^"[^"\r\n]{1,200}"$/.test(etag))
    throw Error("A strong file validator is required.");
  const connections = Number(value.connections ?? 8);
  if (![4, 8, 12, 16].includes(connections))
    throw Error("Invalid connection count.");
  const userAgent = String(value.userAgent || "").slice(0, 500);
  if (/[\r\n]/.test(userAgent)) throw Error("Invalid browser agent.");
  let referrer = null;
  try {
    const source = new URL(value.referrer);
    if (["http:", "https:"].includes(source.protocol))
      referrer = source.origin + "/";
  } catch {}
  return {
    jobId,
    url: url.href,
    filename,
    connections,
    userAgent,
    referrer,
    expected: {
      size: value.expected.size,
      etag,
      mime: String(value.expected.mime || "")
        .split(";")[0]
        .slice(0, 100),
    },
  };
}

export function fileId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(value))
    throw Error("Invalid file job ID.");
  return value;
}
