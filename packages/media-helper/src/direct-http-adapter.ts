import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import type {
  DownloadAdapter,
  DownloadContext,
  DownloadJob,
  DownloadProgress,
  DownloadResult,
} from "./download-types.js";

const MIN_RANGE_BYTES = 4 * 1024 * 1024;
const MAX_RANGE_BYTES = 32 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 180;
const MAX_RETRIES = 2;

interface SourceProbe {
  url: string;
  totalBytes: number | null;
  acceptsRanges: boolean;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  contentDisposition: string | null;
}

interface ByteRange {
  index: number;
  start: number;
  end: number;
  length: number;
}

interface ResumeMetadata {
  version: 1;
  urlHash: string;
  totalBytes: number;
  etag: string | null;
  lastModified: string | null;
  ranges: Array<{ start: number; end: number }>;
  completed: number[];
}

export const directHttpAdapter: DownloadAdapter = Object.freeze({
  id: "direct-http",
  supports: (candidate) => candidate.kind === "direct" && !!candidate.sourceUrl,
  execute: downloadDirectHttp,
});

async function downloadDirectHttp(
  job: DownloadJob,
  context: DownloadContext,
): Promise<DownloadResult> {
  context.progress(emptyProgress("probing"));
  const probe = await probeSource(job, context.signal);
  const outputDirectory = resolveOutputDirectory(job.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const filename = chooseFilename(job, probe);
  const stableId = createHash("sha256")
    .update(probe.url)
    .digest("hex")
    .slice(0, 12);
  const partialPath = join(outputDirectory, `${filename}.${stableId}.part`);
  const metadataPath = `${partialPath}.json`;

  let result: { totalBytes: number | null; resumedBytes: number };
  if (probe.acceptsRanges && Number.isSafeInteger(probe.totalBytes)) {
    result = await downloadRanges({
      job,
      context,
      probe: probe as SourceProbe & { totalBytes: number },
      partialPath,
      metadataPath,
    });
  } else {
    result = await downloadSequential({ job, context, probe, partialPath });
  }

  context.progress({
    phase: "finalizing",
    downloadedBytes: result.totalBytes || 0,
    totalBytes: result.totalBytes,
    bytesPerSecond: 0,
    resumable: probe.acceptsRanges,
    resumedBytes: result.resumedBytes,
  });
  const outputPath = await availableOutputPath(outputDirectory, filename);
  await rename(partialPath, outputPath);
  await unlink(metadataPath).catch(() => {});
  return { outputPath, ...result };
}

async function probeSource(
  job: DownloadJob,
  signal: AbortSignal,
): Promise<SourceProbe> {
  const sourceUrl = job.candidate.sourceUrl;
  if (!sourceUrl) throw new Error("Direct media URL is missing.");
  await assertSafeRemoteUrl(sourceUrl);
  const headers = requestHeaders(job);
  let response = await fetchRemote(sourceUrl, {
    method: "HEAD",
    headers,
    signal,
  });
  if (
    !response.ok ||
    !positiveInteger(response.headers.get("content-length"))
  ) {
    response = await fetchRemote(sourceUrl, {
      headers: { ...headers, Range: "bytes=0-0" },
      signal,
    });
  }
  if (!response.ok) {
    throw new Error(`Media server returned HTTP ${response.status}.`);
  }
  await assertSafeRemoteUrl(response.url);
  const contentRange = response.headers.get("content-range");
  const rangeTotal = contentRange?.match(/\/(\d+)$/)?.[1] || null;
  const totalBytes =
    positiveInteger(rangeTotal) ||
    positiveInteger(response.headers.get("content-length"));
  const acceptsRanges =
    response.status === 206 ||
    response.headers.get("accept-ranges")?.toLowerCase() === "bytes";
  await response.body?.cancel().catch(() => {});
  return {
    url: response.url || sourceUrl,
    totalBytes,
    acceptsRanges,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    contentType: response.headers.get("content-type"),
    contentDisposition: response.headers.get("content-disposition"),
  };
}

async function downloadRanges({
  job,
  context,
  probe,
  partialPath,
  metadataPath,
}: {
  job: DownloadJob;
  context: DownloadContext;
  probe: SourceProbe & { totalBytes: number };
  partialPath: string;
  metadataPath: string;
}) {
  const ranges = buildRanges(probe.totalBytes, job.connections);
  const metadata = expectedMetadata(probe, ranges);
  const completed = await preparePartialFile(
    partialPath,
    metadataPath,
    metadata,
  );
  const resumedBytes = [...completed].reduce(
    (sum, index) => sum + ranges[index].length,
    0,
  );
  const currentBytes = new Map<number, number>();
  let networkBytes = 0;
  let lastProgressAt = 0;
  const startedAt = Date.now();
  let persistChain = Promise.resolve();

  const emitProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    const inFlightBytes = [...currentBytes.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    const completedBytes = [...completed].reduce(
      (sum, index) => sum + ranges[index].length,
      0,
    );
    context.progress({
      phase: "downloading",
      downloadedBytes: Math.min(
        probe.totalBytes,
        completedBytes + inFlightBytes,
      ),
      totalBytes: probe.totalBytes,
      bytesPerSecond: Math.round(
        networkBytes / Math.max(0.001, (now - startedAt) / 1000),
      ),
      resumable: true,
      resumedBytes,
    });
  };
  emitProgress(true);

  const pending = ranges.filter((range) => !completed.has(range.index));
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < pending.length) {
      const range = pending[nextIndex++];
      await downloadRangeWithRetry({
        job,
        context,
        probe,
        range,
        partialPath,
        onBytes(bytes) {
          const previous = currentBytes.get(range.index) || 0;
          currentBytes.set(range.index, bytes);
          networkBytes += Math.max(0, bytes - previous);
          emitProgress();
        },
      });
      currentBytes.delete(range.index);
      completed.add(range.index);
      persistChain = persistChain.then(() =>
        writeFile(
          metadataPath,
          JSON.stringify({ ...metadata, completed: [...completed].sort() }),
          "utf8",
        ),
      );
      await persistChain;
      emitProgress(true);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(job.connections, pending.length || 1) },
      worker,
    ),
  );
  await persistChain;
  return { totalBytes: probe.totalBytes, resumedBytes };
}

async function downloadRangeWithRetry({
  job,
  context,
  probe,
  range,
  partialPath,
  onBytes,
}: {
  job: DownloadJob;
  context: DownloadContext;
  probe: SourceProbe;
  range: ByteRange;
  partialPath: string;
  onBytes(bytes: number): void;
}) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      onBytes(0);
      const response = await fetchRemote(probe.url, {
        headers: {
          ...requestHeaders(job),
          Range: `bytes=${range.start}-${range.end}`,
          ...(probe.etag ? { "If-Range": probe.etag } : {}),
        },
        signal: context.signal,
      });
      if (response.status !== 206 || !response.body) {
        throw new Error(`Range request returned HTTP ${response.status}.`);
      }
      const handle = await open(partialPath, "r+");
      try {
        const reader = response.body.getReader();
        let written = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const buffer = Buffer.from(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          );
          await writeAll(handle, buffer, range.start + written);
          written += buffer.byteLength;
          if (written > range.length)
            throw new Error("Range exceeded its declared size.");
          onBytes(written);
        }
        if (written !== range.length) {
          throw new Error(
            `Range ended at ${written} of ${range.length} bytes.`,
          );
        }
        return;
      } finally {
        await handle.close();
      }
    } catch (error) {
      lastError = error;
      if (context.signal.aborted) throw error;
      if (attempt < MAX_RETRIES)
        await abortableDelay(250 * 2 ** attempt, context.signal);
    }
  }
  throw lastError;
}

async function downloadSequential({
  job,
  context,
  probe,
  partialPath,
}: {
  job: DownloadJob;
  context: DownloadContext;
  probe: SourceProbe;
  partialPath: string;
}) {
  const response = await fetchRemote(probe.url, {
    headers: requestHeaders(job),
    signal: context.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Media server returned HTTP ${response.status}.`);
  }
  const handle = await open(partialPath, "w");
  const startedAt = Date.now();
  let downloadedBytes = 0;
  let lastProgressAt = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      );
      await writeAll(handle, buffer, downloadedBytes);
      downloadedBytes += buffer.byteLength;
      const now = Date.now();
      if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        lastProgressAt = now;
        context.progress({
          phase: "downloading",
          downloadedBytes,
          totalBytes: probe.totalBytes,
          bytesPerSecond: Math.round(
            downloadedBytes / Math.max(0.001, (now - startedAt) / 1000),
          ),
          resumable: false,
          resumedBytes: 0,
        });
      }
    }
  } finally {
    await handle.close();
  }
  return { totalBytes: probe.totalBytes || downloadedBytes, resumedBytes: 0 };
}

async function preparePartialFile(
  partialPath: string,
  metadataPath: string,
  expected: ResumeMetadata,
) {
  const existing = await readResumeMetadata(metadataPath);
  const partial = await stat(partialPath).catch(() => null);
  if (
    existing &&
    partial?.isFile() &&
    partial.size === expected.totalBytes &&
    metadataMatches(existing, expected)
  ) {
    return new Set(
      existing.completed.filter(
        (index) =>
          Number.isInteger(index) &&
          index >= 0 &&
          index < expected.ranges.length,
      ),
    );
  }
  await unlink(partialPath).catch(() => {});
  await unlink(metadataPath).catch(() => {});
  const handle = await open(partialPath, "w+");
  try {
    await handle.truncate(expected.totalBytes);
  } finally {
    await handle.close();
  }
  await writeFile(metadataPath, JSON.stringify(expected), "utf8");
  return new Set<number>();
}

async function readResumeMetadata(
  path: string,
): Promise<ResumeMetadata | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function metadataMatches(left: ResumeMetadata, right: ResumeMetadata) {
  return (
    left.version === right.version &&
    left.urlHash === right.urlHash &&
    left.totalBytes === right.totalBytes &&
    left.etag === right.etag &&
    left.lastModified === right.lastModified &&
    JSON.stringify(left.ranges) === JSON.stringify(right.ranges)
  );
}

function expectedMetadata(
  probe: SourceProbe & { totalBytes: number },
  ranges: ByteRange[],
): ResumeMetadata {
  return {
    version: 1,
    urlHash: createHash("sha256").update(probe.url).digest("hex"),
    totalBytes: probe.totalBytes,
    etag: probe.etag,
    lastModified: probe.lastModified,
    ranges: ranges.map(({ start, end }) => ({ start, end })),
    completed: [],
  };
}

function buildRanges(totalBytes: number, connections: number): ByteRange[] {
  const desired = Math.ceil(totalBytes / Math.max(1, connections * 4));
  const chunkSize = Math.max(
    MIN_RANGE_BYTES,
    Math.min(MAX_RANGE_BYTES, desired),
  );
  const ranges: ByteRange[] = [];
  for (
    let start = 0, index = 0;
    start < totalBytes;
    start += chunkSize, index++
  ) {
    const end = Math.min(totalBytes - 1, start + chunkSize - 1);
    ranges.push({ index, start, end, length: end - start + 1 });
  }
  return ranges;
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  buffer: Buffer,
  position: number,
) {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.byteLength - offset,
      position + offset,
    );
    if (!bytesWritten) throw new Error("Could not write media bytes to disk.");
    offset += bytesWritten;
  }
}

function requestHeaders(job: DownloadJob) {
  return {
    Referer: job.candidate.pageUrl,
    "User-Agent": "AdsFriendlyMediaHelper/0.4",
  };
}

export function resolveOutputDirectory(value: string | null) {
  if (!value) return join(homedir(), "Downloads", "AdsFriendly");
  if (!isAbsolute(value)) throw new Error("Output directory must be absolute.");
  return value;
}

function chooseFilename(job: DownloadJob, probe: SourceProbe) {
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

export function sanitizeFilename(value: string, fallbackExtension: string) {
  let name = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 180);
  if (!name || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) {
    name = `video${fallbackExtension}`;
  }
  if (!extname(name)) name += fallbackExtension;
  return name;
}

export async function availableOutputPath(directory: string, filename: string) {
  const extension = extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  for (let index = 0; index < 1000; index++) {
    const candidate = join(
      directory,
      index ? `${stem} (${index})${extension}` : filename,
    );
    if (!(await stat(candidate).catch(() => null))) return candidate;
  }
  throw new Error("Could not choose an available output filename.");
}

export async function assertSafeRemoteUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Only credential-free HTTP(S) media URLs are allowed.");
  }
  if (process.env.ADSFRIENDLY_HELPER_ALLOW_PRIVATE === "1") return;
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error("Private or local network media URLs are blocked.");
  }
}

export async function fetchRemote(value: string, init: RequestInit) {
  let url = new URL(value);
  for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
    await assertSafeRemoteUrl(url.href);
    const response = await fetch(url, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location) throw new Error("Media redirect omitted its destination.");
    url = new URL(location, url);
  }
  throw new Error("Media source redirected too many times.");
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  )
    return true;
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const [, a, b] = match.map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function positiveInteger(value: string | null | undefined) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason || new Error("Download cancelled."));
      },
      { once: true },
    );
  });
}

function emptyProgress(phase: DownloadProgress["phase"]): DownloadProgress {
  return {
    phase,
    downloadedBytes: 0,
    totalBytes: null,
    bytesPerSecond: 0,
    resumable: false,
    resumedBytes: 0,
  };
}
