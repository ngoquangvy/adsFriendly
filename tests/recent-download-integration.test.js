import test from "node:test";
import assert from "node:assert/strict";
import {
  startBackgroundMediaCatalog,
  recordDiscoveredMedia,
} from "../src/background/media-catalog.js";
import {
  startMediaDownloadJobStore,
  requestMediaDownloadJob,
  requestMediaDownloadContext,
} from "../src/background/media-download-jobs.js";
import { EVENTS, createRegisteredEvent } from "../src/runtime/event-catalog.js";
import { createMediaCandidateFromSource } from "../src/media/detection.js";
import {
  createHelperEvent,
  MEDIA_HELPER_EVENTS,
  MEDIA_HELPER_CAPABILITIES,
  MEDIA_HELPER_REQUESTS,
} from "../src/media/helper-contract.js";
import {
  DOWNLOAD_HISTORY_KEY,
  downloadJobKey,
} from "../src/media/download-job-contract.js";

test("registered download action deduplicates concurrent starts and keeps safe completion identity across tabs/session records", async () => {
  const previousChrome = globalThis.chrome;
  const local = { appSettings: { enabled: true, protectionMode: "assist" } };
  const session = {};
  const area = (data) => ({
    get: async (key) =>
      key == null
        ? { ...data }
        : typeof key === "string"
          ? { [key]: data[key] }
          : Object.fromEntries(key.map((item) => [item, data[item]])),
    set: async (values) => Object.assign(data, values),
    remove: async (keys) => {
      for (const key of [].concat(keys)) delete data[key];
    },
  });
  const event = () => ({ addListener() {}, removeListener() {} });
  const ports = [];
  globalThis.chrome = {
    storage: { local: area(local), session: area(session) },
    permissions: { contains: async () => true },
    tabs: { onRemoved: event(), onUpdated: event() },
    runtime: {
      getManifest: () => ({ version: "test" }),
      sendNativeMessage: async (_host, request) =>
        createHelperEvent(
          request.type === MEDIA_HELPER_REQUESTS.OUTPUT_STAT
            ? MEDIA_HELPER_EVENTS.OUTPUT_STAT
            : MEDIA_HELPER_EVENTS.READY,
          request.requestId,
          request.type === MEDIA_HELPER_REQUESTS.OUTPUT_STAT
            ? { status: "available", size: 100 }
            : {
                helperVersion: "0.24.2",
                capabilities: {
                  [MEDIA_HELPER_CAPABILITIES.DIRECT_HTTP_DOWNLOAD]: true,
                  [MEDIA_HELPER_CAPABILITIES.OUTPUT_STAT]: true,
                },
              },
        ),
      connectNative: () => {
        const port = {
          onMessage: {
            addListener(fn) {
              port.receive = fn;
            },
          },
          onDisconnect: {
            addListener(fn) {
              port.disconnected = fn;
            },
          },
          postMessage(message) {
            port.request = message;
          },
          disconnect() {
            port.disconnected?.();
          },
        };
        ports.push(port);
        return port;
      },
    },
  };
  let stopCatalog, stopJobs;
  try {
    stopCatalog = await startBackgroundMediaCatalog();
    stopJobs = await startMediaDownloadJobStore({
      require() {},
      can: () => true,
    });
    const candidate = createMediaCandidateFromSource({
      pageUrl: "https://page.test/watch",
      sourceUrl: "https://cdn.test/video.mp4?token=private",
      contentLength: 100,
    });
    for (const tabId of [7, 8])
      await recordDiscoveredMedia(
        tabId,
        createRegisteredEvent(EVENTS.MEDIA_DISCOVERED, candidate),
      );
    const request = { tabId: 7, mediaId: candidate.id };
    const results = await Promise.all([
      requestMediaDownloadJob(request),
      requestMediaDownloadJob({ ...request, tabId: 8 }),
    ]);
    assert.deepEqual(
      results.map((result) => result.status).sort(),
      ["already_downloading", "started"],
    );
    assert.equal(ports.length, 1);
    const jobId = results.find((result) => result.status === "started").jobId;
    const port = ports[0];
    port.receive(
      createHelperEvent(
        MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
        port.request.requestId,
        {
          outputPath: "C:\\Users\\Test\\Downloads\\video.mp4",
          totalBytes: 100,
        },
      ),
    );
    for (
      let attempt = 0;
      attempt < 50 &&
      !local[DOWNLOAD_HISTORY_KEY]?.some((item) => item.id === jobId);
      attempt++
    )
      await new Promise(setImmediate);
    const history = local[DOWNLOAD_HISTORY_KEY];
    assert.equal(history[0].status, "completed");
    assert.equal(history[0].candidate, undefined);
    assert.equal(JSON.stringify(history).includes("private"), false);
    assert.equal(typeof history[0].downloadIdentity.requestKey, "string");
    delete session[downloadJobKey(jobId)];
    const result = await requestMediaDownloadContext({
      ...request,
      tabId: 8,
      verifyFile: true,
    });
    assert.equal(result.exactJob.id, jobId);
    assert.equal(result.exactJob.fileStatus, "available");
    assert.equal(
      (await requestMediaDownloadJob(request)).status,
      "already_downloaded",
    );
    assert.equal(ports.length, 1);
    const repeated = await requestMediaDownloadJob({
      ...request,
      repeatOf: jobId,
    });
    assert.equal(repeated.status, "started");
    assert.notEqual(repeated.jobId, jobId);
    assert.equal(ports.length, 2);
    ports[1].receive(
      createHelperEvent(
        MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
        ports[1].request.requestId,
        {
          outputPath: "C:\\Users\\Test\\Downloads\\video (2).mp4",
          totalBytes: 100,
        },
      ),
    );
    for (
      let attempt = 0;
      attempt < 50 && local[DOWNLOAD_HISTORY_KEY]?.length !== 2;
      attempt++
    )
      await new Promise(setImmediate);
    await new Promise(setImmediate);
  } finally {
    stopJobs?.();
    if (stopCatalog) await stopCatalog();
    globalThis.chrome = previousChrome;
  }
});
