import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMediaSource,
  createMediaCandidateFromSource,
} from "../src/media/detection.js";
import { createMediaCatalog } from "../src/media/catalog.js";
import {
  parseHlsAttributeList,
  parseHlsManifest,
} from "../src/media/hls-parser.js";
import { EVENTS, createRegisteredEvent } from "../src/runtime/event-catalog.js";

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
