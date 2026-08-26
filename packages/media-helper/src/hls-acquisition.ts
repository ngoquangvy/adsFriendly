import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  parseHlsAttributeList,
  parseHlsManifest,
} from "../../../src/media/hls-parser.js";
import { downloadResourcesInParallel } from "../../../src/media/parallel-downloader.js";
import { hasStrongDrmEvidence } from "../../../src/media/protection-policy.js";
import { fetchRemote } from "./direct-http-adapter.js";
import {
  adaptiveRequestHeaders,
  emptyAdaptiveProgress,
  verifyAdaptiveInput,
} from "./adaptive-ffmpeg.js";
import type {
  DownloadContext,
  DownloadJob,
  DownloadProgress,
} from "./download-types.js";

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 256 * 1024 * 1024;
const MAX_KEY_BYTES = 64 * 1024;
const MAX_RESOURCES = 10_000;
const MAX_MASTER_DEPTH = 4;
const MAX_CANARIES = 32;
const CANONICAL_SEGMENT_EXTENSIONS = new Map([
  [".ts", ".ts"],
  [".m2ts", ".ts"],
  [".mts", ".ts"],
  [".aac", ".aac"],
  [".mp3", ".mp3"],
  [".ac3", ".ac3"],
  [".eac3", ".eac3"],
  [".ec3", ".ec3"],
  [".vtt", ".vtt"],
  [".webvtt", ".vtt"],
]);

export interface HlsAcquisitionResource {
  id: string;
  kind: "key" | "init" | "segment";
  url: string;
  localName: string;
  byteRange: { offset: number; length: number } | null;
}

export interface HlsAcquisitionPlan {
  manifestUrl: string;
  body: string;
  localManifestBody: string;
  canaries: Array<{
    manifestBody: string;
    resources: HlsAcquisitionResource[];
  }>;
  resources: HlsAcquisitionResource[];
  canaryResources: HlsAcquisitionResource[];
  segmentCount: number;
}

export async function resolveHlsMediaPlaylist(
  job: DownloadJob,
  rootUrl: string,
  signal: AbortSignal,
  inlineRootBody: string | null,
  onStage: (stage: DownloadProgress["stage"]) => void,
) {
  let manifestUrl = rootUrl;
  let inlineBody = inlineRootBody;
  for (let depth = 0; depth <= MAX_MASTER_DEPTH; depth++) {
    onStage("manifest_fetch");
    const body =
      inlineBody !== null
        ? inlineBody
        : await fetchManifest(job, manifestUrl, signal);
    inlineBody = null;
    const summary = parseHlsManifest(manifestUrl, body);
    if (summary.status !== "ready" || summary.playlistType === "unknown") {
      throw new Error("HLS endpoint did not return a usable playlist.");
    }
    if (hasStrongDrmEvidence(summary)) {
      throw new Error("DRM-protected HLS is playback only.");
    }
    if (!supportsEncryption(summary)) {
      throw new Error(
        "HLS encryption is not supported by the acquisition pipeline.",
      );
    }
    if (summary.playlistType === "media") {
      if (summary.streamType !== "vod" || !summary.segmentCount) {
        throw new Error("Only completed HLS VOD playlists are supported.");
      }
      if (summary.lowLatency) {
        throw new Error("Low-latency HLS acquisition is not supported yet.");
      }
      return { manifestUrl, body, summary };
    }

    const variant = chooseVariant(summary.variants);
    if (!variant?.url) throw new Error("HLS master has no media variant.");
    if (
      variant.audioGroup &&
      summary.audioTracks.some(
        (track) => track.groupId === variant.audioGroup && track.url,
      )
    ) {
      throw new Error(
        "HLS with a separate audio playlist is not supported by the acquisition pipeline yet.",
      );
    }
    manifestUrl = variant.url;
  }
  throw new Error("HLS master nesting is too deep.");
}

export function createHlsAcquisitionPlan(
  manifestUrl: string,
  body: string,
): HlsAcquisitionPlan {
  const summary = parseHlsManifest(manifestUrl, body);
  if (
    summary.status !== "ready" ||
    summary.playlistType !== "media" ||
    summary.streamType !== "vod"
  ) {
    throw new Error("HLS acquisition requires a completed media playlist.");
  }

  const resources: HlsAcquisitionResource[] = [];
  const byKey = new Map<string, HlsAcquisitionResource>();
  const outputLines: string[] = [];
  const headerLines: string[] = [];
  let currentKey: HlsAcquisitionResource | null = null;
  let currentKeyLine: string | null = null;
  let currentMap: HlsAcquisitionResource | null = null;
  let currentMapLine: string | null = null;
  let pendingDurationLine: string | null = null;
  let pendingByteRange: string | null = null;
  let previousRangeUrl: string | null = null;
  let previousRangeEnd = 0;
  let previousMapRangeUrl: string | null = null;
  let previousMapRangeEnd = 0;
  let mediaSequence = 0;
  let discontinuitySequence = 0;
  let segmentIndex = 0;
  let discontinuityIndex = 0;
  const canaryDescriptors: Array<{
    key: HlsAcquisitionResource | null;
    keyLine: string | null;
    map: HlsAcquisitionResource | null;
    mapLine: string | null;
    durationLine: string;
    segment: HlsAcquisitionResource;
    mediaSequence: number;
    discontinuitySequence: number;
  }> = [];
  const canaryEpochs = new Set<string>();

  const register = (
    kind: HlsAcquisitionResource["kind"],
    url: string,
    byteRange: HlsAcquisitionResource["byteRange"] = null,
    localExtension: string | null = null,
  ) => {
    const key = `${kind}:${url}:${byteRange?.offset ?? ""}:${byteRange?.length ?? ""}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    if (resources.length >= MAX_RESOURCES) {
      throw new Error("HLS playlist references too many resources.");
    }
    const resource: HlsAcquisitionResource = {
      id: stableId(key),
      kind,
      url,
      localName: `${String(resources.length).padStart(5, "0")}-${kind}-${stableId(key)}${localExtension || resourceExtension(url, kind)}`,
      byteRange,
    };
    resources.push(resource);
    byKey.set(key, resource);
    return resource;
  };

  for (const rawLine of String(body)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      outputLines.push(rawLine);
      continue;
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      const attributes = parseHlsAttributeList(valueAfterColon(line));
      if (String(attributes.METHOD || "").toUpperCase() === "NONE") {
        currentKey = null;
        currentKeyLine = rawLine;
        outputLines.push(rawLine);
        continue;
      }
      if (!attributes.URI) throw new Error("Encrypted HLS key URI is missing.");
      currentKey = register("key", resolveHttpUrl(attributes.URI, manifestUrl));
      currentKeyLine = replaceAttributeUri(rawLine, currentKey.localName);
      outputLines.push(currentKeyLine);
      continue;
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const attributes = parseHlsAttributeList(valueAfterColon(line));
      if (!attributes.URI) throw new Error("HLS init segment URI is missing.");
      const mapUrl = resolveHttpUrl(attributes.URI, manifestUrl);
      const byteRange = parseByteRange(
        attributes.BYTERANGE,
        previousMapRangeUrl === mapUrl ? previousMapRangeEnd : 0,
      );
      if (byteRange) {
        previousMapRangeUrl = mapUrl;
        previousMapRangeEnd = byteRange.offset + byteRange.length;
      } else {
        previousMapRangeUrl = null;
        previousMapRangeEnd = 0;
      }
      currentMap = register("init", mapUrl, byteRange);
      currentMapLine = stripByteRange(
        replaceAttributeUri(rawLine, currentMap.localName),
      );
      outputLines.push(currentMapLine);
      continue;
    }
    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      pendingByteRange = valueAfterColon(line);
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      pendingDurationLine = rawLine;
      outputLines.push(rawLine);
      continue;
    }
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      const value = Number(valueAfterColon(line));
      mediaSequence = Number.isSafeInteger(value) && value >= 0 ? value : 0;
      outputLines.push(rawLine);
      if (isCanaryHeader(line)) headerLines.push(rawLine);
      continue;
    }
    if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) {
      const value = Number(valueAfterColon(line));
      discontinuitySequence =
        Number.isSafeInteger(value) && value >= 0 ? value : 0;
      outputLines.push(rawLine);
      if (isCanaryHeader(line)) headerLines.push(rawLine);
      continue;
    }
    if (line === "#EXT-X-DISCONTINUITY") {
      discontinuityIndex += 1;
      outputLines.push(rawLine);
      continue;
    }
    if (!line.startsWith("#") && pendingDurationLine) {
      const url = resolveHttpUrl(line, manifestUrl);
      const implicitOffset = previousRangeUrl === url ? previousRangeEnd : 0;
      const byteRange = parseByteRange(pendingByteRange, implicitOffset);
      if (byteRange) {
        previousRangeUrl = url;
        previousRangeEnd = byteRange.offset + byteRange.length;
      } else {
        previousRangeUrl = null;
        previousRangeEnd = 0;
      }
      const segment = register(
        "segment",
        url,
        byteRange,
        segmentExtension(url, Boolean(currentMap)),
      );
      outputLines.push(segment.localName);
      const epoch = [
        stableId(currentKeyLine || "no-key"),
        stableId(currentMapLine || "no-map"),
        discontinuityIndex,
      ].join(":");
      if (!canaryEpochs.has(epoch)) {
        if (canaryDescriptors.length >= MAX_CANARIES) {
          throw new Error(
            "HLS playlist has too many key or format epochs to validate safely.",
          );
        }
        canaryEpochs.add(epoch);
        canaryDescriptors.push({
          key: currentKey,
          keyLine: currentKeyLine,
          map: currentMap,
          mapLine: currentMapLine,
          durationLine: pendingDurationLine,
          segment,
          mediaSequence: mediaSequence + segmentIndex,
          discontinuitySequence: discontinuitySequence + discontinuityIndex,
        });
      }
      segmentIndex += 1;
      pendingDurationLine = null;
      pendingByteRange = null;
      continue;
    }
    outputLines.push(rawLine);
    if (isCanaryHeader(line)) headerLines.push(rawLine);
  }

  const segments = resources.filter((item) => item.kind === "segment");
  if (!canaryDescriptors.length || !segments.length) {
    throw new Error("HLS media playlist has no downloadable segments.");
  }
  const canaryResources = canaryDescriptors
    .flatMap(({ key, map, segment }) => [key, map, segment])
    .filter(
      (item, index, items): item is HlsAcquisitionResource =>
        Boolean(item) && items.indexOf(item) === index,
    );
  const sharedCanaryHeaders = headerLines.filter(
    (line) =>
      line.trim() !== "#EXTM3U" &&
      !line.startsWith("#EXT-X-MEDIA-SEQUENCE:") &&
      !line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:"),
  );
  const canaries = canaryDescriptors.map((descriptor) => ({
    resources: [descriptor.key, descriptor.map, descriptor.segment].filter(
      (item, index, items): item is HlsAcquisitionResource =>
        Boolean(item) && items.indexOf(item) === index,
    ),
    manifestBody: [
      "#EXTM3U",
      ...sharedCanaryHeaders,
      `#EXT-X-MEDIA-SEQUENCE:${descriptor.mediaSequence}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${descriptor.discontinuitySequence}`,
      descriptor.keyLine,
      descriptor.mapLine,
      descriptor.durationLine,
      descriptor.segment.localName,
      "#EXT-X-ENDLIST",
    ]
      .filter(Boolean)
      .join("\n"),
  }));

  return {
    manifestUrl,
    body,
    localManifestBody: outputLines.join("\n"),
    canaries,
    resources,
    canaryResources,
    segmentCount: segments.length,
  };
}

export async function acquireHlsPlan(
  plan: HlsAcquisitionPlan,
  job: DownloadJob,
  context: DownloadContext,
  cacheDirectory: string,
) {
  await mkdir(cacheDirectory, { recursive: true });
  context.progress(emptyAdaptiveProgress("probing", "compatibility_check"));
  await acquireResources(
    plan.canaryResources,
    job,
    context,
    cacheDirectory,
    "probing",
  );
  for (let index = 0; index < plan.canaries.length; index++) {
    const canaryPath = join(
      cacheDirectory,
      `canary-${String(index).padStart(3, "0")}.m3u8`,
    );
    await writeFile(canaryPath, plan.canaries[index].manifestBody, "utf8");
    await verifyAdaptiveInput(canaryPath, context.signal, "HLS");
  }

  const resumedBytes = await cachedBytes(plan.resources, cacheDirectory);
  context.progress({
    ...emptyAdaptiveProgress("downloading", "segment_download"),
    downloadedBytes: resumedBytes,
    resumable: true,
    resumedBytes,
  });
  await acquireResources(
    plan.resources,
    job,
    context,
    cacheDirectory,
    "downloading",
  );
  context.progress(emptyAdaptiveProgress("probing", "local_assembly"));
  const manifestPath = join(cacheDirectory, "manifest.m3u8");
  await writeFile(manifestPath, plan.localManifestBody, "utf8");
  return { manifestPath, resumedBytes };
}

export async function removeHlsCache(cacheDirectory: string) {
  await rm(cacheDirectory, { recursive: true, force: true });
}

export function hlsCacheDirectory(outputDirectory: string, job: DownloadJob) {
  return join(
    outputDirectory,
    ".adsfriendly-cache",
    createHash("sha256")
      .update(`${job.jobId}:${job.candidate.manifestUrl}`)
      .digest("hex")
      .slice(0, 20),
  );
}

async function acquireResources(
  resources: HlsAcquisitionResource[],
  job: DownloadJob,
  context: DownloadContext,
  cacheDirectory: string,
  phase: "probing" | "downloading",
) {
  const pending: HlsAcquisitionResource[] = [];
  let resumedBytes = 0;
  for (const resource of resources) {
    const existing = await stat(join(cacheDirectory, resource.localName)).catch(
      () => null,
    );
    if (existing?.isFile() && existing.size > 0) resumedBytes += existing.size;
    else pending.push(resource);
  }
  if (!pending.length) return;
  const startedAt = Date.now();
  await downloadResourcesInParallel(pending, {
    concurrency: job.connections,
    retries: 2,
    signal: context.signal,
    writeInOrder: false,
    fetchResource: (resource: HlsAcquisitionResource, signal: AbortSignal) =>
      fetchResource(job, resource, signal),
    writeResource: async (
      bytes: Uint8Array,
      resource: HlsAcquisitionResource,
    ) => {
      const finalPath = join(cacheDirectory, resource.localName);
      const partialPath = `${finalPath}.part`;
      await writeFile(partialPath, bytes);
      await rename(partialPath, finalPath);
    },
    onProgress: (progress: { downloadedBytes: number }) => {
      if (phase === "probing") {
        context.progress({
          ...emptyAdaptiveProgress("probing", "compatibility_check"),
          downloadedBytes: resumedBytes + progress.downloadedBytes,
          resumedBytes,
          resumable: true,
        });
        return;
      }
      const downloadedBytes = resumedBytes + progress.downloadedBytes;
      context.progress({
        ...emptyAdaptiveProgress("downloading", "segment_download"),
        downloadedBytes,
        bytesPerSecond: Math.round(
          progress.downloadedBytes /
            Math.max(0.001, (Date.now() - startedAt) / 1000),
        ),
        resumedBytes,
        resumable: true,
      });
    },
  });
}

async function fetchResource(
  job: DownloadJob,
  resource: HlsAcquisitionResource,
  signal: AbortSignal,
) {
  const headers = {
    ...adaptiveRequestHeaders(job),
    ...(resource.byteRange
      ? {
          Range: `bytes=${resource.byteRange.offset}-${resource.byteRange.offset + resource.byteRange.length - 1}`,
        }
      : {}),
  };
  const response = await fetchRemote(resource.url, { headers, signal });
  const expectedStatus = resource.byteRange ? 206 : 200;
  if (!response.ok || (resource.byteRange && response.status !== 206)) {
    await response.body?.cancel().catch(() => {});
    throw new Error(
      `${resource.kind} request returned HTTP ${response.status}; expected ${expectedStatus}.`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  const maximum = resource.kind === "key" ? MAX_KEY_BYTES : MAX_RESOURCE_BYTES;
  if (Number.isFinite(declaredLength) && declaredLength > maximum) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`${resource.kind} resource is unexpectedly large.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > maximum) {
    throw new Error(`${resource.kind} resource has an invalid size.`);
  }
  if (resource.byteRange && bytes.byteLength !== resource.byteRange.length) {
    throw new Error(`${resource.kind} byte range returned the wrong length.`);
  }
  if (looksLikeHtml(bytes)) {
    throw new Error(
      `${resource.kind} request returned HTML instead of media data. Browser session access may be required.`,
    );
  }
  return bytes;
}

async function fetchManifest(
  job: DownloadJob,
  manifestUrl: string,
  signal: AbortSignal,
) {
  const response = await fetchRemote(manifestUrl, {
    headers: adaptiveRequestHeaders(job),
    signal,
  });
  if (!response.ok) {
    throw new Error(`HLS manifest returned HTTP ${response.status}.`);
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_MANIFEST_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("HLS manifest is too large.");
  }
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error("HLS manifest is too large.");
  }
  return body;
}

function chooseVariant(variants: Array<Record<string, any>>) {
  return [...variants]
    .filter((variant) => !variant.iframeOnly && variant.url)
    .sort(
      (left, right) =>
        Number(right.averageBandwidth || right.bandwidth || 0) -
        Number(left.averageBandwidth || left.bandwidth || 0),
    )[0];
}

function supportsEncryption(summary: ReturnType<typeof parseHlsManifest>) {
  if (!summary.encryptionMethods.length) return true;
  return summary.encryptionMethods.every(
    (method) => method === "AES-128" || method.startsWith("SAMPLE-AES"),
  );
}

function replaceAttributeUri(line: string, value: string) {
  if (!/(?:^|[:,])URI="[^"]+"/i.test(line)) {
    throw new Error("HLS resource URI must be quoted.");
  }
  return line.replace(/URI="[^"]+"/i, `URI="${value}"`);
}

function stripByteRange(line: string) {
  return line.replace(/,?BYTERANGE="[^"]+"/i, "").replace(/:,/, ":");
}

function parseByteRange(
  value: string | undefined | null,
  implicitOffset: number,
) {
  if (!value) return null;
  const match = /^(\d+)(?:@(\d+))?$/.exec(String(value).trim());
  if (!match) throw new Error("HLS byte range is invalid.");
  const length = Number(match[1]);
  const offset = match[2] === undefined ? implicitOffset : Number(match[2]);
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new Error("HLS byte-range length is invalid.");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("HLS byte-range offset is invalid.");
  }
  return { offset, length };
}

function resolveHttpUrl(value: string, baseUrl: string) {
  const url = new URL(value, baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("HLS resources must use HTTP(S).");
  }
  return url.href;
}

function resourceExtension(url: string, kind: HlsAcquisitionResource["kind"]) {
  if (kind === "key") return ".key";
  if (kind === "init") return ".mp4";
  return segmentExtension(url, false);
}

function segmentExtension(url: string, hasInitMap: boolean) {
  if (hasInitMap) return ".m4s";
  const extension = extname(new URL(url).pathname).toLowerCase();
  return CANONICAL_SEGMENT_EXTENSIONS.get(extension) || ".ts";
}

function stableId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function valueAfterColon(line: string) {
  return line.slice(line.indexOf(":") + 1);
}

function isCanaryHeader(line: string) {
  return (
    line === "#EXTM3U" ||
    line === "#EXT-X-INDEPENDENT-SEGMENTS" ||
    line.startsWith("#EXT-X-VERSION:") ||
    line.startsWith("#EXT-X-TARGETDURATION:") ||
    line.startsWith("#EXT-X-MEDIA-SEQUENCE:") ||
    line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")
  );
}

function looksLikeHtml(bytes: Uint8Array) {
  const prefix = Buffer.from(bytes.subarray(0, 256))
    .toString("utf8")
    .trimStart()
    .toLowerCase();
  return prefix.startsWith("<!doctype html") || prefix.startsWith("<html");
}

async function cachedBytes(
  resources: HlsAcquisitionResource[],
  cacheDirectory: string,
) {
  let total = 0;
  for (const resource of resources) {
    const existing = await stat(join(cacheDirectory, resource.localName)).catch(
      () => null,
    );
    if (existing?.isFile()) total += existing.size;
  }
  return total;
}
