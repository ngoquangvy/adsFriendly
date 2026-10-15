import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, mkdir, stat, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { normalizeFilePayload } from "../../../src/downloads/file-contract.js";
import { probeHttpSource } from "./http-probe.js";
import { fetchRemote } from "./http-remote.js";
import { downloadRanges } from "./http-transfer.js";
import {
  availableOutputPath,
  resolveOutputDirectory,
  sanitizeFilename,
} from "./output-paths.js";
import type {
  HttpTransferSource,
  SourceProbe,
  ByteRange,
} from "./http-transfer-types.js";
import type { DownloadContext, DownloadResult } from "./download-types.js";

export type FileRequest = ReturnType<typeof normalizeFilePayload>;
export type PreparedFile = {
  request: FileRequest;
  source: HttpTransferSource;
  probe: SourceProbe & { totalBytes: number };
  directory: string;
  filename: string;
  token: string;
};

function validate(response: Response, range: ByteRange, request: FileRequest) {
  const expected = `bytes ${range.start}-${range.end}/${request.expected.size}`;
  if (
    response.status !== 206 ||
    response.headers.get("content-range") !== expected
  )
    throw Error("File range identity did not match the requested bytes.");
  if (response.headers.get("etag") !== request.expected.etag)
    throw Error("The file changed after it was observed in Chrome.");
  const encoding = response.headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity")
    throw Error("Compressed HTTP transfer cannot be handed off safely.");
}

export async function prepareFile(
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedFile> {
  const request = normalizeFilePayload(raw);
  const source: HttpTransferSource = {
    url: request.url,
    headers: {
      Accept: "*/*",
      "Accept-Encoding": "identity",
      ...(request.userAgent ? { "User-Agent": request.userAgent } : {}),
      ...(request.referrer ? { Referer: request.referrer } : {}),
    },
    validateRangeResponse: (response, range) =>
      validate(response, range, request),
  };
  const probe = await probeHttpSource(source, signal);
  if (
    probe.totalBytes !== request.expected.size ||
    probe.etag !== request.expected.etag ||
    !probe.acceptsRanges
  )
    throw Error("Helper could not verify the same resumable file as Chrome.");
  if (
    /^(text\/html|application\/(vnd.apple.mpegurl|x-mpegurl|dash\+xml))/i.test(
      probe.contentType || "",
    )
  )
    throw Error(
      "The source returned a page or media manifest, not a direct file.",
    );
  // Verify actual GET bytes and the validator, not HEAD alone.
  const response = await fetchRemote(probe.url, {
    headers: { ...source.headers, Range: "bytes=0-0" },
    signal,
  });
  try {
    validate(response, { index: 0, start: 0, end: 0, length: 1 }, request);
  } finally {
    await response.body?.cancel().catch(() => {});
  }
  const directory = resolveOutputDirectory(null);
  await mkdir(directory, { recursive: true });
  // This policy belongs to generic files: never invent an MP4 extension/title.
  const extension = extname(request.filename).toLowerCase();
  const stem = request.filename.slice(0, -extension.length);
  const filename =
    sanitizeFilename(stem, "", "file").slice(0, 180 - extension.length) +
    extension;
  return {
    request,
    source,
    probe: probe as SourceProbe & { totalBytes: number },
    directory,
    filename,
    token: randomUUID(),
  };
}

export async function downloadPreparedFile(
  prepared: PreparedFile,
  context: DownloadContext,
): Promise<DownloadResult> {
  const { request, source, probe, directory, filename } = prepared;
  const partialPath = join(directory, `${filename}.${request.jobId}.file.part`);
  const metadataPath = partialPath + ".json";
  try {
    const result = await downloadRanges({
      source,
      context,
      probe,
      partialPath,
      metadataPath,
      connections: request.connections,
    });
    context.signal.throwIfAborted();
    const size = await stat(partialPath);
    if (size.size !== request.expected.size)
      throw Error("Downloaded file size did not match Chrome.");
    const outputPath = await publishFile(partialPath, directory, filename);
    await unlink(partialPath).catch(() => {});
    await unlink(metadataPath).catch(() => {});
    return { outputPath, ...result };
  } catch (error) {
    // The browser is the resume fallback for this workflow. Abandoned generic
    // transfer data must not accumulate as multi-GB files in Downloads.
    await unlink(partialPath).catch(() => {});
    await unlink(metadataPath).catch(() => {});
    throw error;
  }
}

// Exclusive publication: two different sources may finish with the same name.
// A check-then-rename can overwrite another completed file. Hard links are cheap
// on supported filesystems; COPYFILE_EXCL is the safe fallback elsewhere.
async function publishFile(
  partialPath: string,
  directory: string,
  filename: string,
) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const outputPath = await availableOutputPath(directory, filename);
    try {
      try {
        await link(partialPath, outputPath);
      } catch (error) {
        if (
          !["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(
            (error as NodeJS.ErrnoException).code || "",
          )
        )
          throw error;
        await copyFile(partialPath, outputPath, constants.COPYFILE_EXCL);
      }
      return outputPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw Error(
    "File output name could not be reserved without overwriting another file.",
  );
}
