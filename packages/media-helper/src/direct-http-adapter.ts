import { createHash } from "node:crypto";
import { mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  DownloadAdapter,
  DownloadContext,
  DownloadJob,
  DownloadProgress,
  DownloadResult,
} from "./download-types.js";
import type { SourceProbe } from "./http-transfer-types.js";
import { probeHttpSource } from "./http-probe.js";
import { downloadRanges, downloadSequential } from "./http-transfer.js";
import { createMediaHttpSource } from "./media-http-source.js";
import { chooseMediaFilename } from "./media-filename.js";
import { availableOutputPath, resolveOutputDirectory } from "./output-paths.js";

// Compatibility facade for existing adapter consumers. New code imports the owner.
export { assertSafeRemoteUrl, fetchRemote } from "./http-remote.js";
export {
  availableOutputPath,
  resolveOutputDirectory,
  sanitizeFilename,
} from "./output-paths.js";
export { preflightGoogleVideoTrack } from "./youtube-http-profile.js";

export const directHttpAdapter: DownloadAdapter = Object.freeze({
  id: "direct-http",
  supports: (candidate: DownloadJob["candidate"]) =>
    candidate.kind === "direct" && !!candidate.sourceUrl,
  execute: downloadDirectHttp,
});

export async function downloadDirectHttp(
  job: DownloadJob,
  context: DownloadContext,
): Promise<DownloadResult> {
  context.progress(emptyProgress("probing"));
  const source = createMediaHttpSource(job);
  const probe = await probeHttpSource(source, context.signal);
  const outputDirectory = resolveOutputDirectory(job.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const filename = chooseMediaFilename(job, probe);
  const stableId = createHash("sha256")
    .update(probe.url)
    .digest("hex")
    .slice(0, 12);
  const partialPath = join(outputDirectory, `${filename}.${stableId}.part`);
  const metadataPath = `${partialPath}.json`;

  let result: { totalBytes: number | null; resumedBytes: number };
  if (probe.acceptsRanges && Number.isSafeInteger(probe.totalBytes)) {
    result = await downloadRanges({
      source,
      connections: job.connections,
      context,
      probe: probe as SourceProbe & { totalBytes: number },
      partialPath,
      metadataPath,
    });
  } else {
    result = await downloadSequential({ source, context, probe, partialPath });
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
