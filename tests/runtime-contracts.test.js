import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS,
  getActionDefinition,
  getActionsForFeature,
} from "../src/runtime/action-catalog.js";
import { createActionBroker } from "../src/runtime/action-broker.js";
import { CAPABILITIES } from "../src/runtime/feature-catalog.js";
import {
  EVENTS,
  createRegisteredEvent,
  getEventDefinition,
} from "../src/runtime/event-catalog.js";
import { accelerate, restore } from "../src/video/actions.js";

test("action broker enforces the capability declared by the registry", async () => {
  const calls = [];
  const allowed = new Set([
    CAPABILITIES.VIDEO_USER_ACTION,
    CAPABILITIES.VIDEO_RESTORE_STATE,
  ]);
  const policy = {
    can: (capability) => allowed.has(capability),
    require(capability) {
      if (!this.can(capability)) throw new Error(`denied:${capability}`);
    },
  };
  const handlers = Object.fromEntries(
    getActionsForFeature("video.surgeon").map(({ id: actionId }) => [
      actionId,
      (payload) => calls.push([actionId, payload]),
    ]),
  );
  const broker = createActionBroker({
    featureId: "video.surgeon",
    policy,
    handlers,
  });

  await broker.execute(ACTIONS.VIDEO_ACCELERATE_USER, "video");
  assert.deepEqual(calls, [[ACTIONS.VIDEO_ACCELERATE_USER, "video"]]);
  await assert.rejects(
    broker.execute(ACTIONS.VIDEO_ACCELERATE_AUTOMATIC, "video"),
    /denied:video\.auto_action/,
  );
});

test("media download job creation is registered as a user action", () => {
  const action = getActionDefinition(ACTIONS.MEDIA_DOWNLOAD_CREATE);
  assert.equal(action.featureId, "background.media-download-jobs");
  assert.equal(action.capability, CAPABILITIES.MEDIA_NATIVE_DOWNLOAD);
  assert.equal(
    getActionDefinition(ACTIONS.MEDIA_DOWNLOAD_CANCEL).capability,
    CAPABILITIES.MEDIA_NATIVE_DOWNLOAD,
  );
  for (const actionId of [
    ACTIONS.MEDIA_DOWNLOAD_PAUSE,
    ACTIONS.MEDIA_DOWNLOAD_RESUME,
    ACTIONS.MEDIA_DOWNLOAD_RETRY,
    ACTIONS.MEDIA_DOWNLOAD_OPEN,
    ACTIONS.MEDIA_DOWNLOAD_REVEAL,
    ACTIONS.MEDIA_DOWNLOAD_CLEAR_HISTORY,
    ACTIONS.MEDIA_DOWNLOAD_REMOVE_HISTORY,
    ACTIONS.MEDIA_OUTPUT_CANARY,
    ACTIONS.MEDIA_OUTPUT_CAPTURE_START,
  ]) {
    assert.equal(
      getActionDefinition(actionId).capability,
      CAPABILITIES.MEDIA_NATIVE_DOWNLOAD,
    );
  }
});

test("action broker requires handlers for all actions owned by a feature", () => {
  assert.throws(
    () =>
      createActionBroker({
        featureId: "video.surgeon",
        policy: { can: () => true, require: () => true },
        handlers: {},
      }),
    /has no handler for registered action/,
  );
});

test("video playback restoration preserves the state from before an action", () => {
  const previousWindow = globalThis.window;
  const previousLog = console.log;
  globalThis.window = { postMessage() {} };
  console.log = () => {};
  const video = {
    src: "https://cdn.example/ad.mp4",
    playbackRate: 1.5,
    muted: true,
    closest: () => null,
  };
  try {
    accelerate(video);
    assert.equal(video.playbackRate, 16);
    restore(video);
    assert.equal(video.playbackRate, 1.5);
    assert.equal(video.muted, true);
  } finally {
    globalThis.window = previousWindow;
    console.log = previousLog;
  }
});

test("registered media events normalize a content-neutral candidate", () => {
  const event = createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, {
    id: "media-1",
    pageUrl: "https://video.example/watch",
    manifestUrl: "https://cdn.example/master.m3u8",
    kind: "hls",
    detectedBy: "network",
  });
  assert.equal(event.type, EVENTS.MEDIA_DISCOVERED);
  assert.equal(event.payload.drm, "none");
  assert.deepEqual(event.payload.variants, []);
  assert.equal(event.payload.probeStatus, "discovered");
});

test("registered media probe events normalize manifest metadata", () => {
  const event = createRegisteredEvent(EVENTS.MEDIA_PROBED, {
    mediaId: "media-1",
    pageUrl: "https://video.example/watch",
    manifestUrl: "https://cdn.example/master.m3u8",
    kind: "hls",
    status: "ready",
    playlistType: "master",
    variants: [{ id: "720p", bandwidth: 2_000_000 }],
    resolutionAttempt: {
      adapterId: "aesgcm-b65-query-mutation",
      strategy: "remove_query_parameter",
      removedQueryKey: "d",
      evidence: ["enc_aesgcm", "ext_x_b65"],
      queryValue: "must-not-survive-normalization",
    },
  });
  assert.equal(event.type, EVENTS.MEDIA_PROBED);
  assert.equal(event.payload.status, "ready");
  assert.equal(event.payload.variants[0].bandwidth, 2_000_000);
  assert.deepEqual(event.payload.resolutionAttempt, {
    adapterId: "aesgcm-b65-query-mutation",
    strategy: "remove_query_parameter",
    removedQueryKey: "d",
    evidence: ["enc_aesgcm", "ext_x_b65"],
  });
});

test("event registry rejects unknown or malformed media events", () => {
  assert.throws(
    () => getEventDefinition("media.not-registered"),
    /Unknown event/,
  );
  assert.throws(
    () =>
      createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, {
        id: "media-1",
        pageUrl: "https://video.example/watch",
        kind: "hls",
        detectedBy: "network",
      }),
    /needs sourceUrl or manifestUrl/,
  );
});
