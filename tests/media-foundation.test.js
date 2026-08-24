import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMediaSource,
  createMediaCandidateFromSource,
} from "../src/media/detection.js";
import { createMediaCatalog } from "../src/media/catalog.js";
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
