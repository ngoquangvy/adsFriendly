import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMediaSource,
  createMediaCandidateFromSource,
} from "../src/media/detection.js";
import { createMediaCatalog } from "../src/media/catalog.js";
import { EVENTS, createRegisteredEvent } from "../src/runtime/event-catalog.js";
import { createRequire } from "node:module";
import { startMediaObserver } from "../src/content/media-observer.js";
import {
  sourceDiagnostic,
  createSourceDiagnosticRecorder,
} from "../src/media/source-diagnostics.js";
import {
  formatMediaDetails,
  selectVisibleMediaItems,
} from "../src/media/catalog-view.js";
import {
  createMediaDownloadControl,
  downloadButtonPresentation,
} from "../src/media/ui/download-control.js";
import { createMediaSourceDiagnostics } from "../src/popup/media-source-diagnostics.js";
import { getMediaDownloadProfiles } from "../src/media/download-options.js";
import {
  startBackgroundMediaCatalog,
  recordMediaSourceDiagnostic,
  listDiscoveredMedia,
} from "../src/background/media-catalog.js";
const require = createRequire(
  new URL("../packages/media-helper/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");
const source = (extra = {}) =>
  createMediaCandidateFromSource({
    pageUrl: "https://page.example/",
    sourceUrl: "https://cdn.example/song.mp3?sig=PRIVATE",
    detectedBy: "dom",
    ...extra,
  });
test("audio types are orthogonal to transport and reject segments and non-media responses", () => {
  for (const ext of ["mp3", "m4a", "ogg", "oga", "opus", "flac", "wav"]) {
    const candidate = source({ sourceUrl: `https://cdn.example/song.${ext}` });
    assert.equal(candidate.kind, "direct");
    assert.equal(candidate.mediaType, "audio");
  }
  for (const mime of [
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/x-flac",
    "audio/wav",
    "audio/webm",
  ]) {
    assert.equal(
      source({
        sourceUrl: "https://cdn.example/play?token=PRIVATE",
        mimeType: mime,
      }).mediaType,
      "audio",
    );
  }
  assert.equal(source({ mimeType: "text/html" }), null);
  assert.equal(
    source({
      sourceUrl: "https://cdn.example/s.aac",
      mimeType: "audio/aac",
      elementType: "audio",
    }),
    null,
  );
  assert.equal(
    source({ sourceUrl: "https://cdn.example/s.m4s", mimeType: "audio/mp4" }),
    null,
  );
  assert.equal(
    source({ sourceUrl: "https://cdn.example/play", elementType: "audio" })
      .mediaType,
    "audio",
  );
  assert.equal(
    source({ sourceUrl: "blob:https://page.example/id", elementType: "audio" })
      .kind,
    "blob",
  );
  for (const ext of ["mp4", "webm", "mov", "m4v"])
    assert.equal(classifyMediaSource(`https://cdn.example/v.${ext}`), "direct");
  assert.equal(classifyMediaSource("https://cdn.example/index.m3u8"), "hls");
  assert.equal(classifyMediaSource("https://cdn.example/index.mpd"), "dash");
});
test("catalog preserves MIME evidence over weaker DOM updates and retains audio duration/size", () => {
  const catalog = createMediaCatalog();
  catalog.add(
    1,
    createRegisteredEvent(
      EVENTS.MEDIA_DISCOVERED,
      source({ mimeType: "audio/mpeg", contentLength: 8000000 }),
    ),
  );
  catalog.add(
    1,
    createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, source({ duration: 200 })),
  );
  const [item] = catalog.list(1);
  assert.equal(item.mediaType, "audio");
  assert.equal(item.mediaTypeEvidence, "mime");
  assert.equal(item.contentLength, 8000000);
  assert.equal(item.duration, 200);
  assert.equal(item.mimeType, "audio/mpeg");
});
test("audio UI reports measured size, duration and explicitly estimated bitrate, never video quality", async (t) => {
  const dom = new JSDOM(
    '<details id="media-source-diagnostics"><summary></summary><pre></pre><button></button></details>',
  );
  const beforeDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Object.defineProperty(globalThis, "document", {
    value: dom.window.document,
    configurable: true,
  });
  t.after(() => {
    dom.window.close();
    beforeDocument
      ? Object.defineProperty(globalThis, "document", beforeDocument)
      : delete globalThis.document;
  });
  const audio = source({
    contentLength: 8000000,
    duration: 200,
    playback: { playing: true },
  });
  assert.equal(formatMediaDetails(audio), "Direct audio · 3:20");
  assert.equal(getMediaDownloadProfiles(audio)[0].label, "Original · MP3");
  const helper = {
    status: "ready",
    canDownloadDirect: true,
    canDownloadDirectAudio: true,
  };
  const control = createMediaDownloadControl(audio, audio, { id: 1 }, helper);
  assert.match(control.textContent, /~320 kbps avg/);
  assert.doesNotMatch(control.textContent, /Source quality|360p|MKV/);
  assert.equal(
    downloadButtonPresentation(
      { supported: true },
      { ...helper, canDownloadDirectAudio: false },
      audio,
    ).disabled,
    true,
  );
  assert.equal(
    downloadButtonPresentation(
      { supported: true },
      { ...helper, canDownloadDirectAudio: false },
      source({ sourceUrl: "https://cdn.example/video.mp4" }),
    ).disabled,
    false,
  );
  const video = source({
    sourceUrl: "https://cdn.example/movie.mp4",
    contentLength: 9000000,
  });
  assert.equal(selectVisibleMediaItems([video, audio])[0].id, audio.id);
  let copied = "";
  const render = createMediaSourceDiagnostics({
    document: dom.window.document,
    clipboard: {
      writeText: async (value) => {
        copied = value;
      },
    },
  });
  render([
    {
      code: "audio_format_unknown",
      host: "cdn.example",
      secret: "PRIVATE_TOKEN",
      url: "https://private/token",
      count: 2,
    },
  ]);
  assert.match(
    dom.window.document.querySelector("pre").textContent,
    /audio_format_unknown/,
  );
  dom.window.document.querySelector("button").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.doesNotMatch(copied, /PRIVATE|private|https:/);
  assert.match(copied, /audio_format_unknown/);
  render([]);
  assert.equal(dom.window.document.querySelector("details").hidden, true);
});
test("unknown evidence is logged with bounded deduplication, TTL and no signed URL/body/title", () => {
  let now = 100;
  const recorder = createSourceDiagnosticRecorder({
    now: () => now,
    maxEntries: 2,
    maxTabs: 2,
    ttlMs: 1000,
  });
  const entry = sourceDiagnostic({
    sourceUrl: "https://cdn.example/play?token=PRIVATE",
    elementType: "audio",
    mimeType: "audio/custom",
    input: "network",
  });
  assert.equal(entry.code, "audio_mime_unsupported");
  recorder.record(
    1,
    { ...entry, url: "SECRET", title: "SECRET", body: "SECRET" },
    2,
  );
  recorder.record(1, entry, 2);
  assert.equal(recorder.list(1)[0].count, 2);
  assert.doesNotMatch(
    JSON.stringify(recorder.list(1)),
    /SECRET|PRIVATE|token|https:/,
  );
  recorder.record(1, { code: "source_missing" });
  recorder.record(1, { code: "size_unavailable" });
  assert.equal(recorder.list(1).length, 2);
  recorder.record(2, entry);
  recorder.record(3, entry);
  assert.equal(recorder.list(1).length, 0);
  now += 1000;
  assert.equal(recorder.list(3).length, 0);
  assert.throws(() => recorder.record(1, { code: "secret arbitrary error" }));
});
test("diagnostic intake verifies tab privacy, coalesces lookups and clears on navigation", async (t) => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const updates = new Set();
  let lookups = 0;
  const event = { addListener() {}, removeListener() {} };
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {},
      tabs: {
        get: async (id) => {
          lookups++;
          return { id, incognito: id === 2 };
        },
        onRemoved: event,
        onUpdated: {
          addListener: (fn) => updates.add(fn),
          removeListener: (fn) => updates.delete(fn),
        },
      },
    },
  });
  const stop = await startBackgroundMediaCatalog();
  t.after(async () => {
    await stop();
    before
      ? Object.defineProperty(globalThis, "chrome", before)
      : delete globalThis.chrome;
  });
  const gap = { code: "audio_format_unknown", host: "cdn.example" };
  await Promise.all([
    recordMediaSourceDiagnostic(1, gap, 0),
    recordMediaSourceDiagnostic(1, gap, 0),
  ]);
  assert.equal(lookups, 1);
  assert.equal((await listDiscoveredMedia(1)).sourceDiagnostics[0].count, 2);
  assert.equal(
    (await recordMediaSourceDiagnostic(2, gap, 0)).status,
    "ignored",
  );
  assert.deepEqual((await listDiscoveredMedia(2)).sourceDiagnostics, []);
  for (const listener of updates) listener(1, { url: "https://new.example/" });
  assert.deepEqual((await listDiscoveredMedia(1)).sourceDiagnostics, []);
});
test("real DOM observer handles audio metadata, source changes, detached players and video regression", async (t) => {
  const dom = new JSDOM(
    '<audio src="/song.mp3"></audio><video src="/movie.mp4"></video><audio id="unknown" src="/opaque" type="audio/custom"></audio><audio id="child"><source src="/child.m4a" type="audio/mp4"></audio>',
    { url: "https://page.example/" },
  );
  const saved = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    performance: { getEntriesByType: () => [] },
    chrome: {
      runtime: {
        onMessage: { addListener() {}, removeListener() {} },
        sendMessage: async ({ event }) => {
          messages.push(event);
          return { status: "recorded" };
        },
      },
    },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const messages = [];
  const stop = startMediaObserver();
  t.after(() => {
    stop();
    dom.window.close();
    for (const [key, descriptor] of saved)
      descriptor
        ? Object.defineProperty(globalThis, key, descriptor)
        : delete globalThis[key];
  });
  const audio = dom.window.document.querySelector("audio");
  Object.defineProperty(audio, "duration", { value: 180, configurable: true });
  audio.dispatchEvent(new dom.window.Event("loadedmetadata"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(
    messages.some(
      (e) =>
        e?.type === EVENTS.MEDIA_DISCOVERED &&
        e.payload.mediaType === "audio" &&
        e.payload.duration === 180,
    ),
  );
  assert.ok(
    messages.some(
      (e) =>
        e?.payload?.sourceUrl?.endsWith("child.m4a") &&
        e.payload.mediaType === "audio",
    ),
  );
  assert.ok(
    messages.some(
      (e) =>
        e?.type === EVENTS.MEDIA_DISCOVERED &&
        e.payload.sourceUrl.endsWith("movie.mp4") &&
        e.payload.mediaType === "video",
    ),
  );
  assert.ok(
    messages.some(
      (e) =>
        e?.type === EVENTS.MEDIA_SOURCE_DIAGNOSTIC &&
        e.payload.code === "audio_mime_unsupported",
    ),
  );
  Object.defineProperty(audio, "currentSrc", {
    value: "https://page.example/song.mp3",
    configurable: true,
  });
  audio.src = "/next.flac";
  audio.dispatchEvent(new dom.window.Event("loadedmetadata"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(messages.some((e) => e?.payload?.sourceUrl?.endsWith("next.flac")));
  assert.ok(
    !messages.some(
      (e) =>
        e?.payload?.sourceUrl?.endsWith("next.flac") &&
        e.payload.duration === 180,
    ),
  );
  audio.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const before = messages.length;
  audio.dispatchEvent(new dom.window.Event("play"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(messages.length, before);
  stop();
  dom.window.document
    .querySelector("video")
    .dispatchEvent(new dom.window.Event("play"));
  assert.equal(messages.length, before);
});
