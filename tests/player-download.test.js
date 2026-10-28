import test from "node:test";
import assert from "node:assert/strict";
import { resolvePlayerDownloadTarget } from "../src/media/player-download-target.js";
import { readPlayerSource } from "../src/media/player-download-target.js";
import { downloadButtonPresentation } from "../src/media/ui/download-control.js";
import { playerDownloadPosition } from "../src/media/player-download-position.js";
import { createPlayerDownloadAttention } from "../src/media/ui/player-download-attention.js";
import {
  startBackgroundMediaCatalog,
  recordDiscoveredMedia,
  listDiscoveredMedia,
  preferDiscoveredMedia,
} from "../src/background/media-catalog.js";
import { createRegisteredEvent, EVENTS } from "../src/runtime/event-catalog.js";
import {
  createMediaCandidateFromSource,
  stableMediaId,
} from "../src/media/detection.js";

const pageUrl = "https://video.example/watch";

function attentionFixture() {
  let now = 0,
    sequence = 0;
  const timers = new Map();
  const notices = [];
  const attention = createPlayerDownloadAttention({
    onNotice: (value) => notices.push(value),
    setTimer: (run, delay) => {
      const id = ++sequence;
      timers.set(id, { run, at: now + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    attention,
    timers,
    notices,
    tick(delta) {
      now += delta;
      for (const [id, task] of [...timers])
        if (task.at <= now) {
          timers.delete(id);
          task.run();
        }
    },
  };
}

test("launcher brightens once for three seconds; repeated position/progress updates do not restart the notice", () => {
  const { attention, timers, notices, tick } = attentionFixture();
  attention.setVisible(true);
  tick(2_999);
  attention.setVisible(true);
  attention.setVisible(true);
  assert.deepEqual(notices, [true]);
  assert.equal(timers.size, 1);
  tick(1);
  assert.deepEqual(notices, [true, false]);
  attention.setVisible(true);
  assert.equal(timers.size, 0);
});

test("hidden-to-visible starts a fresh notice and a cancelled old deadline cannot fade the new appearance", () => {
  const { attention, timers, notices, tick } = attentionFixture();
  attention.setVisible(true);
  const old = [...timers.values()][0].run;
  tick(1_000);
  attention.setVisible(false);
  assert.equal(timers.size, 0);
  attention.setVisible(true);
  old();
  assert.equal(notices.at(-1), true);
  tick(2_999);
  assert.equal(notices.at(-1), true);
  tick(1);
  assert.equal(notices.at(-1), false);
});

test("new video resets attention; removing/stopping the overlay cancels timers and further notices", () => {
  const { attention, timers, notices } = attentionFixture();
  attention.setVisible(true);
  attention.reset();
  attention.setVisible(true);
  assert.equal(timers.size, 1);
  const pending = [...timers.values()][0].run;
  attention.dispose();
  assert.equal(timers.size, 0);
  assert.equal(notices.at(-1), false);
  const count = notices.length;
  pending();
  attention.setVisible(true);
  assert.equal(notices.length, count);
});

test("download launcher sits 70 percent outside the top edge and remains horizontally centered", () => {
  const position = playerDownloadPosition(
    { top: 100, left: 40, width: 640 },
    1280,
    40,
  );
  assert.equal(position.top, 72);
  assert.equal(position.width, 300);
  assert.equal(position.left, 210);
});

test("launcher stays accessible at the viewport edge/fullscreen and respects touch-control height", () => {
  assert.equal(
    playerDownloadPosition({ top: 0, left: 0, width: 1280 }, 1280, 40).top,
    8,
  );
  assert.equal(
    playerDownloadPosition({ top: -50, left: 0, width: 640 }, 1280, 40).top,
    8,
  );
  const mobile = playerDownloadPosition(
    { top: 100, left: 0, width: 390 },
    390,
    48,
  );
  assert.equal(mobile.top, 100 - 48 * 0.7);
  assert.equal(mobile.left, 45);
});

test("shared download controls retain unavailable and helper setup states in the popup", () => {
  assert.equal(
    downloadButtonPresentation(
      { supported: false, reason: "DRM confirmed" },
      {},
      {},
    ).label,
    "Playback only",
  );
  assert.equal(
    downloadButtonPresentation(
      { supported: false, reason: "Manifest waiting" },
      {},
      {},
    ).label,
    "Watching",
  );
  assert.equal(
    downloadButtonPresentation(
      { supported: true },
      { status: "permission_required" },
      { kind: "direct" },
    ).label,
    "Set up",
  );
});

test("source changes cannot retain an old currentSrc on a failed new load", () => {
  const video = {
    currentSrc: "https://cdn.example/old.mp4",
    src: "blob:https://video.example/new",
    getAttribute: () => "blob:https://video.example/new",
    networkState: 2,
  };
  assert.equal(readPlayerSource(video), video.src);
  assert.equal(readPlayerSource({ ...video, error: { code: 4 } }), "");
  assert.equal(readPlayerSource({ ...video, networkState: 3 }), "");
  assert.equal(
    readPlayerSource({ ...video, getAttribute: () => null }),
    video.currentSrc,
  );
});

test("unloaded video with a single source child remains linked to its catalog source", () => {
  const main = direct("main");
  const video = {
    src: "",
    currentSrc: "",
    readyState: 0,
    networkState: 1,
    getAttribute: () => null,
    querySelectorAll: () => [{ src: main.sourceUrl }],
  };
  const source = readPlayerSource(video);
  assert.equal(source, main.sourceUrl);
  assert.equal(
    resolvePlayerDownloadTarget({
      sourceUrl: source,
      pageUrl,
      frameId: 0,
      items: [main],
    }).candidate.id,
    main.id,
  );
  assert.equal(
    readPlayerSource({
      ...video,
      querySelectorAll: () => [
        { src: main.sourceUrl },
        { src: "https://cdn.example/other.mp4" },
      ],
    }),
    "",
  );
});

test("preferred player selection is session-only, tab scoped, and clears on navigation", async () => {
  const previousChrome = globalThis.chrome;
  const data = {};
  const hooks = {};
  const event = (name) => ({
    addListener(fn) {
      hooks[name] = fn;
    },
    removeListener() {},
  });
  globalThis.chrome = {
    storage: {
      session: {
        get: async () => ({ ...data }),
        set: async (values) => Object.assign(data, values),
        remove: async (keys) => {
          for (const key of [].concat(keys)) delete data[key];
        },
      },
    },
    tabs: { onRemoved: event("removed"), onUpdated: event("updated") },
  };
  let stop;
  try {
    stop = await startBackgroundMediaCatalog();
    const candidate = createMediaCandidateFromSource({
      pageUrl,
      sourceUrl: "https://cdn.example/main.mp4",
    });
    await recordDiscoveredMedia(
      7,
      createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate),
    );
    await preferDiscoveredMedia(7, candidate.id);
    assert.equal((await listDiscoveredMedia(7)).preferredMediaId, candidate.id);
    assert.equal((await listDiscoveredMedia(8)).preferredMediaId, null);
    assert.equal(Object.values(data)[0].preferredMediaId, candidate.id);
    hooks.updated(7, { url: "https://video.example/other" });
    assert.equal((await listDiscoveredMedia(7)).preferredMediaId, null);
  } finally {
    if (stop) await stop();
    globalThis.chrome = previousChrome;
  }
});
const direct = (name, frameId = 0) => ({
  ...createMediaCandidateFromSource({
    pageUrl,
    sourceUrl: `https://cdn.example/${name}.mp4`,
  }),
  frameId,
});
test("player target selects its exact source despite many larger or playing previews", () => {
  const main = direct("main");
  const ad = {
    ...direct("ad"),
    contentLength: 999999999,
    playback: { playing: true },
  };
  const result = resolvePlayerDownloadTarget({
    sourceUrl: main.sourceUrl,
    pageUrl,
    frameId: 0,
    items: [ad, main],
  });
  assert.equal(result.candidate.id, main.id);
});
test("player target rejects other frames and unresolved blob sources", () => {
  const other = direct("main", 3);
  assert.equal(
    resolvePlayerDownloadTarget({
      sourceUrl: other.sourceUrl,
      pageUrl,
      frameId: 0,
      items: [other],
    }),
    null,
  );
  assert.equal(
    resolvePlayerDownloadTarget({
      sourceUrl: "blob:unrelated",
      pageUrl,
      frameId: 0,
      items: [direct("main")],
    }),
    null,
  );
});
test("player target follows explicit blob lineage but hides protected media", () => {
  const main = direct("main");
  const blob = {
    ...createMediaCandidateFromSource({
      pageUrl,
      sourceUrl: "blob:https://video.example/player",
    }),
    frameId: 0,
    selectedMediaId: main.id,
  };
  assert.equal(
    resolvePlayerDownloadTarget({
      sourceUrl: blob.sourceUrl,
      pageUrl,
      frameId: 0,
      items: [main, blob],
    }).candidate.id,
    main.id,
  );
  assert.equal(
    resolvePlayerDownloadTarget({
      sourceUrl: main.sourceUrl,
      pageUrl,
      frameId: 0,
      items: [{ ...main, drm: "confirmed" }],
    }),
    null,
  );
});
