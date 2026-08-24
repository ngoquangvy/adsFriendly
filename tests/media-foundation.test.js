import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMediaSource,
  createMediaCandidateFromSource,
  isLikelyMediaSegment,
} from "../src/media/detection.js";
import { createMediaCatalog } from "../src/media/catalog.js";
import {
  parseHlsAttributeList,
  parseHlsManifest,
} from "../src/media/hls-parser.js";
import {
  createMediaProbeGate,
  isUsableMediaProbe,
  normalizeHttpMediaUrl,
} from "../src/media/probe-gate.js";
import { createMediaObserverReportKey } from "../src/content/media-observer.js";
import { createHlsDownloadPlan } from "../src/media/hls-download-plan.js";
import { downloadResourcesInParallel } from "../src/media/parallel-downloader.js";
import {
  getMediaDownloadAvailability,
  normalizeMediaDownloadJob,
} from "../src/media/download-job-contract.js";
import {
  createMediaCatalogViewSignature,
  selectVisibleMediaItems,
} from "../src/media/catalog-view.js";
import { EVENTS, createRegisteredEvent } from "../src/runtime/event-catalog.js";
import { normalizeMediaRequestContext } from "../src/media/contracts.js";

test("classifies direct, HLS, DASH, and blob media without treating segments as videos", () => {
  assert.equal(
    classifyMediaSource("https://cdn.example/movie.mp4?token=1"),
    "direct",
  );
  assert.equal(
    classifyMediaSource("https://cdn.example/master.M3U8#live"),
    "hls",
  );
  assert.equal(
    classifyMediaSource("/manifest", "application/dash+xml"),
    "dash",
  );
  assert.equal(classifyMediaSource("blob:https://video.example/id"), "blob");
  assert.equal(classifyMediaSource("https://cdn.example/segment.ts"), null);
  assert.equal(
    classifyMediaSource("https://cdn.example/random.ts", "video/mp2t"),
    null,
  );
  assert.equal(
    classifyMediaSource("https://cdn.example/42.m4s", "video/mp4"),
    null,
  );
  assert.equal(
    classifyMediaSource("https://cdn.example/no-extension", "video/mp2t"),
    null,
  );
  assert.equal(
    isLikelyMediaSegment("https://cdn.example/movie.mp4", "video/mp4"),
    false,
  );
});

test("catalog ignores a forged DIRECT candidate that is actually an HLS segment", () => {
  const catalog = createMediaCatalog();
  const event = createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, {
    id: "segment-1",
    pageUrl: "https://video.example/watch",
    sourceUrl: "https://cdn.example/random.ts",
    kind: "direct",
    mimeType: "video/mp2t",
    detectedBy: "network",
  });
  assert.equal(catalog.add(5, event), null);
  assert.deepEqual(catalog.list(5), []);
});

test("creates a stable content-neutral candidate from a relative source", () => {
  const candidate = createMediaCandidateFromSource({
    pageUrl: "https://video.example/watch/1",
    sourceUrl: "/media/master.m3u8?token=abc",
    detectedBy: "dom",
    title: "Example video",
  });
  assert.equal(candidate.kind, "hls");
  assert.equal(
    candidate.manifestUrl,
    "https://video.example/media/master.m3u8?token=abc",
  );
  assert.equal(candidate.sourceUrl, null);
  assert.match(candidate.id, /^media-/);
});

test("catalog merges detection sources and resets when the tab navigates", () => {
  const catalog = createMediaCatalog();
  const baseCandidate = createMediaCandidateFromSource({
    pageUrl: "https://video.example/watch/1",
    sourceUrl: "https://cdn.example/movie.mp4",
    detectedBy: "dom",
  });
  catalog.add(
    10,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, baseCandidate),
  );
  catalog.add(
    10,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, {
      ...baseCandidate,
      detectedBy: "network",
    }),
  );
  const merged = catalog.list(10);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].detectionSources, ["dom", "network"]);

  const nextPageCandidate = createMediaCandidateFromSource({
    pageUrl: "https://video.example/watch/2",
    sourceUrl: "https://cdn.example/next.webm",
    detectedBy: "dom",
  });
  catalog.add(
    10,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, nextPageCandidate),
  );
  assert.deepEqual(
    catalog.list(10).map((item) => item.id),
    [nextPageCandidate.id],
  );
});

test("catalog is bounded per tab", () => {
  const catalog = createMediaCatalog({ maximumPerTab: 2 });
  for (let index = 0; index < 3; index++) {
    const candidate = createMediaCandidateFromSource({
      pageUrl: "https://video.example/watch",
      sourceUrl: `https://cdn.example/video-${index}.mp4`,
      detectedBy: "network",
    });
    const event = createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate);
    event.timestamp += index;
    catalog.add(1, event);
  }
  assert.equal(catalog.list(1).length, 2);
});

test("parses an HLS master playlist with relative variants and media tracks", () => {
  const result = parseHlsManifest(
    "https://cdn.example/path/master.m3u8?token=abc",
    `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English, Stereo",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Tiếng Việt",LANGUAGE="vi",URI="../subs/vi.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5200000,AVERAGE-BANDWIDTH=4800000,RESOLUTION=1920x1080,FRAME-RATE=59.94,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio",SUBTITLES="subs"
video/1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
video/720.m3u8`,
  );

  assert.equal(result.status, "ready");
  assert.equal(result.playlistType, "master");
  assert.equal(result.streamType, null);
  assert.equal(result.variants.length, 2);
  assert.deepEqual(result.variants[0].resolution, {
    width: 1920,
    height: 1080,
  });
  assert.equal(result.variants[0].codecs, "avc1.640028,mp4a.40.2");
  assert.equal(
    result.variants[0].url,
    "https://cdn.example/path/video/1080.m3u8",
  );
  assert.equal(result.audioTracks[0].name, "English, Stereo");
  assert.equal(result.subtitles[0].url, "https://cdn.example/subs/vi.m3u8");
});

test("parses VOD duration and distinguishes encryption from suspected DRM", () => {
  const result = parseHlsManifest(
    "https://cdn.example/vod/index.m3u8",
    `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:9.5,
segment-1.ts
#EXTINF:10.25,
segment-2.ts
#EXT-X-ENDLIST`,
  );

  assert.equal(result.playlistType, "media");
  assert.equal(result.streamType, "vod");
  assert.equal(result.duration, 19.75);
  assert.equal(result.targetDuration, 10);
  assert.equal(result.segmentCount, 2);
  assert.deepEqual(result.encryptionMethods, ["AES-128"]);
  assert.equal(result.drm, "none");

  const sampleAes = parseHlsManifest(
    "https://cdn.example/live/index.m3u8",
    '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n#EXTINF:6,\na.ts',
  );
  assert.equal(sampleAes.streamType, "live");
  assert.equal(sampleAes.drm, "suspected");
});

test("HLS attribute parsing preserves quoted commas", () => {
  assert.deepEqual(
    parseHlsAttributeList('NAME="English, Stereo",LANGUAGE=en,DEFAULT=YES'),
    { NAME: "English, Stereo", LANGUAGE: "en", DEFAULT: "YES" },
  );
});

test("empty HLS envelopes remain unknown instead of being mislabeled live", () => {
  const result = parseHlsManifest(
    "https://embed.example/token",
    "#EXTM3U\n#EXT-X-VERSION:7\n",
  );
  assert.equal(result.status, "ready");
  assert.equal(result.playlistType, "unknown");
  assert.equal(result.streamType, "unknown");
  assert.equal(result.segmentCount, null);
  assert.match(
    getMediaDownloadAvailability({
      kind: "hls",
      probeStatus: "ready",
      drm: "none",
      encryptionMethods: [],
      ...result,
    }).reason,
    /not exposed/,
  );
});

test("parses low-latency HLS parts without inventing full segments", () => {
  const result = parseHlsManifest(
    "https://cdn.example/live/token",
    `#EXTM3U
#EXT-X-VERSION:9
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:120
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.5
#EXT-X-PART-INF:PART-TARGET=0.5
#EXT-X-PART:DURATION=0.5,URI="part-120.0.m4s"
#EXT-X-PART:DURATION=0.5,URI="part-120.1.m4s"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="part-120.2.m4s"`,
  );
  assert.equal(result.playlistType, "media");
  assert.equal(result.streamType, "live");
  assert.equal(result.lowLatency, true);
  assert.equal(result.segmentCount, 0);
  assert.equal(result.partialSegmentCount, 2);
  assert.equal(result.mediaSequence, 120);
  assert.match(result.revisionId, /^revision-/);
});

test("recognizes iframe-only master playlists without treating them as live", () => {
  const result = parseHlsManifest(
    "https://cdn.example/master.m3u8",
    `#EXTM3U
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=250000,RESOLUTION=1280x720,URI="iframe/720.m3u8"`,
  );
  assert.equal(result.playlistType, "master");
  assert.equal(result.streamType, null);
  assert.equal(result.variants.length, 0);
  assert.equal(result.iframeVariants.length, 1);
  assert.equal(
    result.iframeVariants[0].url,
    "https://cdn.example/iframe/720.m3u8",
  );
});

test("catalog applies a manifest probe even if discovery arrives late", () => {
  const catalog = createMediaCatalog();
  const event = createRegisteredEvent(EVENTS.MEDIA_PROBED, {
    mediaId: "media-hls",
    pageUrl: "https://video.example/watch",
    manifestUrl: "https://cdn.example/master.m3u8",
    kind: "hls",
    status: "ready",
    playlistType: "master",
    variants: [
      {
        id: "1080p",
        url: "https://cdn.example/1080.m3u8",
        resolution: { width: 1920, height: 1080 },
      },
    ],
  });
  const item = catalog.applyProbe(11, event);

  assert.equal(item.probeStatus, "ready");
  assert.equal(item.variants[0].resolution.height, 1080);
  assert.deepEqual(item.detectionSources, ["network"]);

  const lateDiscovery = createMediaCandidateFromSource({
    pageUrl: "https://video.example/watch",
    sourceUrl: "https://cdn.example/master.m3u8",
    detectedBy: "dom",
  });
  lateDiscovery.id = "media-hls";
  catalog.add(
    11,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, lateDiscovery),
  );
  const preserved = catalog.list(11)[0];
  assert.equal(preserved.probeStatus, "ready");
  assert.equal(preserved.variants[0].resolution.height, 1080);
  assert.deepEqual(preserved.detectionSources, ["network", "dom"]);
});

test("catalog links a discovered child playlist back to its HLS master", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const master = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://cdn.example/master.m3u8",
    detectedBy: "network",
  });
  const child = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://cdn.example/720.m3u8",
    detectedBy: "network",
  });
  catalog.add(12, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, master));
  catalog.add(12, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, child));
  catalog.applyProbe(
    12,
    createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: master.id,
      pageUrl,
      manifestUrl: master.manifestUrl,
      kind: "hls",
      status: "ready",
      playlistType: "master",
      variants: [{ id: "720p", url: child.manifestUrl }],
    }),
  );
  const items = catalog.list(12);
  const linkedMaster = items.find((item) => item.id === master.id);
  const linkedChild = items.find((item) => item.id === child.id);
  assert.deepEqual(linkedMaster.childManifestIds, [child.id]);
  assert.deepEqual(linkedChild.parentManifestIds, [master.id]);
});

test("resolver selects the best discovered VOD variant and groups child rows", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const manifest = (sourceUrl) =>
    createMediaCandidateFromSource({
      pageUrl,
      sourceUrl,
      detectedBy: "network",
    });
  const master = manifest("https://cdn.example/master.m3u8");
  const child720 = manifest("https://cdn.example/720.m3u8");
  const child1080 = manifest("https://cdn.example/1080.m3u8");
  for (const candidate of [master, child720, child1080]) {
    catalog.add(13, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  }
  catalog.applyProbe(
    13,
    createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: master.id,
      pageUrl,
      manifestUrl: master.manifestUrl,
      kind: "hls",
      status: "ready",
      playlistType: "master",
      variants: [
        {
          id: "720p",
          url: child720.manifestUrl,
          resolution: { width: 1280, height: 720 },
          bandwidth: 2_000_000,
        },
        {
          id: "1080p",
          url: child1080.manifestUrl,
          resolution: { width: 1920, height: 1080 },
          bandwidth: 5_000_000,
        },
      ],
    }),
  );
  for (const [candidate, segmentCount] of [
    [child720, 200],
    [child1080, 300],
  ]) {
    catalog.applyProbe(
      13,
      createRegisteredEvent(EVENTS.MEDIA_PROBED, {
        mediaId: candidate.id,
        pageUrl,
        manifestUrl: candidate.manifestUrl,
        kind: "hls",
        status: "ready",
        playlistType: "media",
        streamType: "vod",
        segmentCount,
      }),
    );
  }
  const items = catalog.list(13);
  const resolvedMaster = items.find((item) => item.id === master.id);
  assert.equal(resolvedMaster.resolutionStatus, "resolved");
  assert.equal(resolvedMaster.selectedMediaId, child1080.id);
  assert.equal(resolvedMaster.resolvedStream.resolution.height, 1080);
  assert.equal(resolvedMaster.resolvedStream.segmentCount, 300);
  assert.deepEqual(
    selectVisibleMediaItems(items).map((item) => item.id),
    [master.id],
  );
});

test("resolver follows a token endpoint redirect to the final media playlist", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const token = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://embed.example/player/token",
    mimeType: "application/vnd.apple.mpegurl",
    detectedBy: "network",
  });
  const media = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://cdn.example/session/media.m3u8",
    detectedBy: "network",
  });
  for (const candidate of [token, media]) {
    catalog.add(15, createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate));
  }
  catalog.applyProbe(
    15,
    createRegisteredEvent(EVENTS.MEDIA_PROBED, {
      mediaId: media.id,
      pageUrl,
      manifestUrl: media.manifestUrl,
      kind: "hls",
      status: "ready",
      playlistType: "media",
      streamType: "vod",
      segmentCount: 24,
      requestContext: {
        requestUrl: token.manifestUrl,
        finalUrl: media.manifestUrl,
        documentUrl: "https://embed.example/player",
        credentials: "include",
        transport: "fetch",
        requiresBrowserSession: true,
      },
    }),
  );

  const items = catalog.list(15);
  const resolvedToken = items.find((item) => item.id === token.id);
  assert.equal(resolvedToken.resolutionStatus, "resolved");
  assert.equal(resolvedToken.selectedMediaId, media.id);
  assert.equal(resolvedToken.resolvedStream.segmentCount, 24);
  assert.equal(
    resolvedToken.resolvedRequestContext.finalUrl,
    media.manifestUrl,
  );
  assert.deepEqual(
    selectVisibleMediaItems(items).map((item) => item.id),
    [token.id],
  );
});

test("catalog keeps a usable VOD snapshot when a later HLS envelope is empty", () => {
  const catalog = createMediaCatalog();
  const pageUrl = "https://video.example/watch";
  const candidate = createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: "https://cdn.example/token",
    mimeType: "application/vnd.apple.mpegurl",
    detectedBy: "network",
  });
  const usable = createRegisteredEvent(EVENTS.MEDIA_PROBED, {
    mediaId: candidate.id,
    pageUrl,
    manifestUrl: candidate.manifestUrl,
    kind: "hls",
    status: "ready",
    playlistType: "media",
    streamType: "vod",
    segmentCount: 42,
    revisionId: "revision-usable",
    requestContext: {
      requestUrl: candidate.manifestUrl,
      finalUrl: candidate.manifestUrl,
      documentUrl: "https://embed.example/player",
      credentials: "same-origin",
      transport: "fetch",
      requiresBrowserSession: true,
    },
  });
  usable.timestamp = 100;
  catalog.applyProbe(14, usable);
  const empty = createRegisteredEvent(EVENTS.MEDIA_PROBED, {
    mediaId: candidate.id,
    pageUrl,
    manifestUrl: candidate.manifestUrl,
    kind: "hls",
    status: "ready",
    playlistType: "unknown",
    streamType: "unknown",
    revisionId: "revision-empty",
  });
  empty.timestamp = 200;
  catalog.applyProbe(14, empty);
  const item = catalog.list(14)[0];
  assert.equal(item.streamType, "vod");
  assert.equal(item.segmentCount, 42);
  assert.equal(item.revisionId, "revision-usable");
  assert.equal(item.probeCount, 2);
  assert.equal(item.resolvedRequestContext.requiresBrowserSession, true);
});

test("request context keeps routing facts but discards headers and cookies", () => {
  const context = normalizeMediaRequestContext({
    requestUrl: "https://cdn.example/token",
    finalUrl: "https://cdn.example/master.m3u8",
    documentUrl: "https://embed.example/player",
    method: "get",
    credentials: "include",
    transport: "fetch",
    requiresBrowserSession: true,
    headers: { Cookie: "secret", Authorization: "secret" },
  });
  assert.equal(context.method, "GET");
  assert.equal(context.credentials, "include");
  assert.equal(context.requiresBrowserSession, true);
  assert.equal("headers" in context, false);
  assert.equal("cookie" in context, false);
});

test("fallback probe gate accepts HTTP manifests once and stays bounded", () => {
  const gate = createMediaProbeGate({ maximumRemembered: 2 });
  assert.equal(
    gate.claim("https://cdn.example/master.m3u8"),
    "https://cdn.example/master.m3u8",
  );
  assert.equal(gate.claim("https://cdn.example/master.m3u8"), null);
  assert.equal(gate.release("https://cdn.example/master.m3u8"), true);
  assert.equal(
    gate.claim("https://cdn.example/master.m3u8"),
    "https://cdn.example/master.m3u8",
  );
  gate.remember("https://cdn.example/one.m3u8", "ready");
  gate.remember("https://cdn.example/two.m3u8", "ready");
  assert.equal(gate.state("https://cdn.example/master.m3u8"), null);
  assert.equal(gate.state("https://cdn.example/two.m3u8"), "ready");
  assert.equal(normalizeHttpMediaUrl("blob:https://video.example/id"), null);
  assert.equal(normalizeHttpMediaUrl("javascript:alert(1)"), null);
});

test("unknown HLS probes remain retryable while populated playlists complete", () => {
  assert.equal(
    isUsableMediaProbe({
      status: "ready",
      playlistType: "unknown",
      streamType: "unknown",
    }),
    false,
  );
  assert.equal(
    isUsableMediaProbe({
      status: "ready",
      playlistType: "media",
      streamType: "vod",
      segmentCount: 1726,
    }),
    true,
  );
});

test("media observer accepts a resolved VOD after an unknown probe", () => {
  const shared = {
    mediaId: "media-hls-token",
    status: "ready",
    playlistType: "unknown",
    streamType: "unknown",
  };
  const waitingKey = createMediaObserverReportKey({
    type: EVENTS.MEDIA_PROBED,
    payload: shared,
  });
  const resolvedKey = createMediaObserverReportKey({
    type: EVENTS.MEDIA_PROBED,
    payload: {
      ...shared,
      playlistType: "media",
      streamType: "vod",
      segmentCount: 1726,
    },
  });
  assert.notEqual(waitingKey, resolvedKey);
});

test("builds an ordered HLS VOD download plan with init and byte ranges", () => {
  const plan = createHlsDownloadPlan(
    "https://cdn.example/video/playlist.m3u8",
    `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6,
#EXT-X-BYTERANGE:1000@0
media.mp4
#EXTINF:5.5,
#EXT-X-BYTERANGE:800
media.mp4
#EXT-X-ENDLIST`,
  );
  assert.equal(plan.status, "ready");
  assert.equal(plan.outputExtension, "mp4");
  assert.equal(plan.segmentCount, 2);
  assert.deepEqual(
    plan.resources.map((item) => [item.kind, item.byteRange]),
    [
      ["init", null],
      ["segment", { offset: 0, length: 1000 }],
      ["segment", { offset: 1000, length: 800 }],
    ],
  );
});

test("download plan rejects live, encrypted, and discontinuous playlists", () => {
  assert.equal(
    createHlsDownloadPlan(
      "https://cdn.example/live.m3u8",
      "#EXTM3U\n#EXTINF:6,\na.ts",
    ).reason,
    "live_not_supported",
  );
  assert.equal(
    createHlsDownloadPlan(
      "https://cdn.example/encrypted.m3u8",
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST',
    ).reason,
    "encrypted_not_supported",
  );
  assert.equal(
    createHlsDownloadPlan(
      "https://cdn.example/discontinuous.m3u8",
      "#EXTM3U\n#EXTINF:6,\na.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:6,\nb.ts\n#EXT-X-ENDLIST",
    ).reason,
    "discontinuity_not_supported",
  );
});

test("parallel downloader bounds concurrency, retries, and writes in order", async () => {
  const resources = Array.from({ length: 7 }, (_, index) => ({ index }));
  const attempts = new Map();
  const written = [];
  let active = 0;
  let maximumActive = 0;
  const result = await downloadResourcesInParallel(resources, {
    concurrency: 3,
    retries: 1,
    retryDelay: async () => {},
    async fetchResource(resource) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      const count = (attempts.get(resource.index) || 0) + 1;
      attempts.set(resource.index, count);
      if (resource.index === 2 && count === 1) throw new Error("retry");
      return Uint8Array.of(resource.index);
    },
    async writeResource(bytes) {
      written.push(bytes[0]);
    },
  });
  assert.equal(maximumActive, 3);
  assert.equal(attempts.get(2), 2);
  assert.deepEqual(written, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(result.downloadedBytes, 7);
});

test("download availability blocks DRM and live HLS before job creation", () => {
  const base = {
    kind: "hls",
    probeStatus: "ready",
    playlistType: "media",
    streamType: "vod",
    drm: "none",
    encryptionMethods: [],
    segmentCount: 1,
  };
  assert.equal(getMediaDownloadAvailability(base).supported, true);
  assert.match(
    getMediaDownloadAvailability({ ...base, drm: "suspected" }).reason,
    /DRM/,
  );
  assert.match(
    getMediaDownloadAvailability({ ...base, streamType: "live" }).reason,
    /Live/,
  );
});

test("direct downloads require a valid HTTP source and normalize independently of HLS", () => {
  const candidate = {
    id: "direct-1",
    kind: "direct",
    pageUrl: "https://video.example/watch",
    sourceUrl: "https://cdn.example/movie.mp4",
    title: "Movie",
    mimeType: "video/mp4",
  };
  assert.equal(getMediaDownloadAvailability(candidate).supported, true);
  assert.equal(
    getMediaDownloadAvailability({ ...candidate, sourceUrl: "blob:test" })
      .supported,
    false,
  );
  const job = normalizeMediaDownloadJob({
    id: "job-1",
    createdAt: 1,
    sourceTabId: 7,
    candidate,
  });
  assert.equal(job.candidate.kind, "direct");
  assert.equal(job.candidate.sourceUrl, candidate.sourceUrl);
});

test("media popup signature ignores heartbeat timestamps but detects visible changes", () => {
  const base = {
    tabId: 4,
    status: "Media Helper ready.",
    helper: { status: "ready", helperVersion: "1.0.0", canDownloadHls: true },
    items: [
      {
        id: "media-1",
        kind: "hls",
        manifestUrl: "https://cdn.example/index.m3u8",
        probeStatus: "ready",
        streamType: "vod",
        lastSeenAt: 1,
      },
    ],
  };
  const initial = createMediaCatalogViewSignature(base);
  assert.equal(
    createMediaCatalogViewSignature({
      ...base,
      items: [{ ...base.items[0], lastSeenAt: 999 }],
    }),
    initial,
  );
  assert.notEqual(
    createMediaCatalogViewSignature({
      ...base,
      items: [{ ...base.items[0], probeStatus: "failed" }],
    }),
    initial,
  );
});

test("media popup keeps rows stable when heartbeat order changes", () => {
  const older = { id: "older", firstSeenAt: 10, lastSeenAt: 1000 };
  const newer = { id: "newer", firstSeenAt: 20, lastSeenAt: 50 };
  assert.deepEqual(
    selectVisibleMediaItems([older, newer]).map((item) => item.id),
    ["newer", "older"],
  );
  assert.deepEqual(
    selectVisibleMediaItems([
      { ...newer, lastSeenAt: 5000 },
      { ...older, lastSeenAt: 6000 },
    ]).map((item) => item.id),
    ["newer", "older"],
  );
});

test("media popup groups duplicate unresolved blobs from one player", () => {
  const items = selectVisibleMediaItems([
    {
      id: "blob-1",
      kind: "blob",
      pageUrl: "https://video.example/watch",
      title: "Player",
      firstSeenAt: 10,
    },
    {
      id: "blob-2",
      kind: "blob",
      pageUrl: "https://video.example/watch",
      title: "Player",
      firstSeenAt: 20,
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "blob-2");
  assert.equal(items[0].relatedCount, 2);
});
