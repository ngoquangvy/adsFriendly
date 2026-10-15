import { createHash } from "node:crypto";
import { open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import type { DownloadContext } from "./download-types.js";
import type {
  ByteRange,
  HttpTransferSource,
  SourceProbe,
} from "./http-transfer-types.js";
import { rangeRequest, probeFailure } from "./http-transfer-types.js";
import { fetchRemote } from "./http-remote.js";

const MIN_RANGE_BYTES = 4 * 1024 * 1024;
const MAX_RANGE_BYTES = 32 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 180;
const MAX_RETRIES = 2;
interface ResumeMetadata {
  version: 1;
  urlHash: string;
  totalBytes: number;
  etag: string | null;
  lastModified: string | null;
  ranges: Array<{ start: number; end: number }>;
  completed: number[];
}

export async function downloadRanges({
  source,
  context,
  probe,
  partialPath,
  metadataPath,
  connections,
}: {
  source: HttpTransferSource;
  context: DownloadContext;
  probe: SourceProbe & { totalBytes: number };
  partialPath: string;
  metadataPath: string;
  connections: number;
}) {
  const ranges = buildRanges(probe.totalBytes, connections);
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
        source,
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
    Array.from({ length: Math.min(connections, pending.length || 1) }, worker),
  );
  await persistChain;
  return { totalBytes: probe.totalBytes, resumedBytes };
}

async function downloadRangeWithRetry({
  source,
  context,
  probe,
  range,
  partialPath,
  onBytes,
}: {
  source: HttpTransferSource;
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
      const request = rangeRequest(source, probe.url, range, probe.etag);
      const response = await fetchRemote(request.url, {
        headers: request.headers,
        signal: context.signal,
      });
      if (
        (!request.acceptsFullResponse && response.status !== 206) ||
        !response.ok ||
        !response.body
      ) {
        throw new Error(
          source.rangeFailure?.(probe.url, response.status, range, request) ||
            `Range request for bytes ${range.start}-${range.end} returned HTTP ${response.status}.`,
        );
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
          if (written + buffer.byteLength > range.length) {
            throw new Error("Range exceeded its declared size.");
          }
          await writeAll(handle, buffer, range.start + written);
          written += buffer.byteLength;
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

export async function downloadSequential({
  source,
  context,
  probe,
  partialPath,
}: {
  source: HttpTransferSource;
  context: DownloadContext;
  probe: SourceProbe;
  partialPath: string;
}) {
  const response = await fetchRemote(probe.url, {
    headers: source.headers,
    signal: context.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(probeFailure(source, probe.url, response.status));
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
