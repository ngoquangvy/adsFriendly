import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { getDownloadProgress } from "../src/downloads/progress.js";
import {
  getMediaJobProgress,
  formatMediaJobDetails,
  formatMediaJobTransferSummary,
} from "../src/media/download-job-view.js";
import {
  createDownloadEtaEstimator,
  formatDownloadEta,
} from "../src/downloads/eta.js";
import { createDownloadHistoryList } from "../src/options/downloads/history-list.js";
const require = createRequire(
  new URL("../packages/media-helper/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");

test("progress uses measured bytes, playback time or persisted resources without inventing a byte total", () => {
  assert.deepEqual(
    getDownloadProgress({ downloadedBytes: 25, totalBytes: 100 }),
    { percent: 25, basis: "bytes" },
  );
  assert.deepEqual(
    getDownloadProgress({
      downloadedBytes: 100,
      totalBytes: null,
      completedResources: 3,
      totalResources: 12,
    }),
    { percent: 25, basis: "resources" },
  );
  assert.deepEqual(
    getDownloadProgress({ processedSeconds: 30, duration: 120 }),
    { percent: 25, basis: "time" },
  );
  assert.equal(
    getDownloadProgress({ downloadedBytes: 10, totalBytes: 0 }).percent,
    null,
  );
  assert.equal(
    getDownloadProgress({ downloadedBytes: -1, totalBytes: 10 }).percent,
    0,
  );
  assert.equal(
    getDownloadProgress({ downloadedBytes: 11, totalBytes: 10 }).percent,
    100,
  );
  assert.equal(getDownloadProgress(null).percent, null);
  assert.equal(
    getMediaJobProgress({ totalBytes: 100, progress: { downloadedBytes: 25 } })
      .percent,
    25,
  );
  const hls = {
    status: "downloading",
    kind: "hls",
    progress: {
      downloadedBytes: 3e9,
      totalBytes: null,
      completedResources: 30,
      totalResources: 120,
    },
  };
  assert.match(formatMediaJobDetails(hls), /^25% · 30 \/ 120 resources/);
});

test("ETA uses a rolling average and publishes at most every three seconds, not every speed spike", () => {
  let now = 100000;
  const estimator = createDownloadEtaEstimator({ now: () => now });
  const progress = {
    phase: "downloading",
    downloadedBytes: 0,
    totalBytes: 10000,
    bytesPerSecond: 1e8,
  };
  assert.equal(estimator.update("job", progress).etaSeconds, null);
  now += 1000;
  progress.downloadedBytes = 100;
  assert.equal(estimator.update("job", progress).etaSeconds, null);
  now += 2000;
  progress.downloadedBytes = 300;
  const first = estimator.update("job", progress);
  assert.equal(first.etaSeconds, 97);
  now += 1000;
  progress.downloadedBytes = 4000;
  assert.deepEqual(estimator.update("job", progress), first);
  now += 2000;
  progress.downloadedBytes = 4100;
  const next = estimator.update("job", progress);
  assert.ok(next.etaSeconds < first.etaSeconds);
  assert.ok(next.etaSeconds > (10000 - 4100) / (4100 / 6));
  assert.equal(estimator.update("job", progress, "paused").etaSeconds, null);
  assert.equal(estimator.update("job", progress).etaSeconds, null);
});

test("HLS ETA excludes resumed resources and resets for retries, stage changes, unknown totals and long gaps", () => {
  let now = 100000;
  const estimator = createDownloadEtaEstimator({ now: () => now });
  const progress = {
    phase: "downloading",
    stage: "segment_download",
    downloadedBytes: 3e9,
    totalBytes: null,
    completedResources: 100,
    totalResources: 400,
  };
  estimator.update("hls", progress);
  now += 3000;
  progress.completedResources = 103;
  assert.equal(estimator.update("hls", progress).etaSeconds, 297);
  now += 3000;
  progress.completedResources = 10;
  assert.equal(estimator.update("hls", progress).etaSeconds, null);
  now += 3000;
  progress.completedResources = 13;
  assert.ok(estimator.update("hls", progress).etaSeconds > 0);
  now += 16000;
  assert.equal(estimator.update("hls", progress).etaSeconds, null);
  assert.equal(
    estimator.update("hls", { phase: "downloading", downloadedBytes: 1000 })
      .etaSeconds,
    null,
  );
  assert.equal(
    estimator.update("hls", progress, "finalizing").etaSeconds,
    null,
  );
});

test("ETA labels are compact, expire when stale, and the player summary includes the same percentage", () => {
  const etaUpdatedAt = Date.now();
  assert.equal(formatDownloadEta({ etaSeconds: 175, etaUpdatedAt }), "3 min");
  assert.equal(formatDownloadEta({ etaSeconds: 22, etaUpdatedAt }), "30 s");
  assert.equal(
    formatDownloadEta({ etaSeconds: 4400, etaUpdatedAt }),
    "1 h 15 min",
  );
  assert.equal(
    formatDownloadEta({ etaSeconds: 10, etaUpdatedAt: etaUpdatedAt - 13000 }),
    null,
  );
  const job = {
    status: "downloading",
    progress: {
      completedResources: 3,
      totalResources: 12,
      bytesPerSecond: 1024,
      etaSeconds: 175,
      etaUpdatedAt,
    },
  };
  assert.equal(formatMediaJobTransferSummary(job), "25% · 1 KB/s · 3 min");
  assert.match(formatMediaJobDetails(job), /25%.*3 min/);
  assert.doesNotMatch(
    formatMediaJobTransferSummary({ ...job, status: "pausing" }),
    /min/,
  );
});

test("real history presenter updates percentage and fill together, unknown progress is explicit and completed rows stay compact", (t) => {
  const dom = new JSDOM(
    '<div id="download-job-manager"></div><div id="download-manager-status"></div>',
  );
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const view = createDownloadHistoryList({
    document,
    window: dom.window,
    actionButton: (label) => {
      const b = document.createElement("button");
      b.textContent = label;
      return b;
    },
  });
  const job = {
    id: "hls",
    kind: "hls",
    status: "downloading",
    progress: {
      totalBytes: null,
      downloadedBytes: 1000,
      completedResources: 3,
      totalResources: 12,
    },
  };
  view.render([job]);
  const track = document.querySelector(".download-progress-track"),
    bar = track.firstElementChild;
  assert.equal(track.getAttribute("aria-valuenow"), "25");
  assert.equal(bar.style.width, "25%");
  assert.match(
    document.querySelector(".download-history-details").textContent,
    /^25%/,
  );
  job.progress.completedResources = 6;
  view.render([job]);
  assert.equal(track.firstElementChild, bar);
  assert.equal(bar.style.width, "50%");
  job.progress = { downloadedBytes: 1e6, totalBytes: null };
  view.render([job]);
  assert.equal(track.hasAttribute("aria-valuenow"), false);
  assert.ok(track.classList.contains("is-indeterminate"));
  assert.match(
    document.querySelector(".download-history-details").textContent,
    /Progress not yet available/,
  );
  job.status = "completed";
  view.render([job]);
  assert.equal(track.hidden, true);
});
