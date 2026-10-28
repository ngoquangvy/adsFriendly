import test from "node:test";
import assert from "node:assert/strict";
import { buildMediaDownloadIdentity } from "../src/media/download-identity.js";
import { createRecentDownloadService } from "../src/background/recent-downloads.js";
const candidate = {
  kind: "direct",
  sourceUrl: "https://cdn.test/file.mp4",
  pageUrl: "https://page.test/",
};
const job = async (status = "completed") => ({
  id: "job-1",
  status,
  updatedAt: Date.now(),
  outputPath: "/managed/video.mp4",
  progress: { totalBytes: 100 },
  downloadIdentity: await buildMediaDownloadIdentity(candidate),
});
test("file check is on demand; missing/changed files do not block downloading again", async () => {
  const saved = await job();
  let calls = 0,
    status = "available",
    size = 100;
  const service = createRecentDownloadService({
    listJobs: async () => [saved],
    checkFile: async () => {
      calls++;
      return { status, size };
    },
  });
  assert.equal(
    (await service.lookup(candidate)).latestJob.fileStatus,
    "unchecked",
  );
  assert.equal(calls, 0);
  assert.equal(
    (await service.duplicate(candidate)).status,
    "already_downloaded",
  );
  assert.equal(
    (await service.lookup(candidate)).latestJob.fileStatus,
    "available",
  );
  assert.equal(await service.duplicate(candidate, null, "job-1"), null);
  status = "missing";
  assert.equal(await service.duplicate(candidate), null);
  status = "available";
  size = 50;
  assert.equal(await service.duplicate(candidate), null);
});
test("older helpers yield honest unchecked status rather than a false missing-file claim", async () => {
  const saved = await job();
  const service = createRecentDownloadService({
    listJobs: async () => [saved],
    checkFile: async () => ({ status: "unchecked" }),
  });
  assert.equal(
    (await service.duplicate(candidate)).job.fileStatus,
    "unchecked",
  );
});
test("active identical downloads cannot be bypassed by Download again", async () => {
  const saved = await job("downloading");
  const service = createRecentDownloadService({
    listJobs: async () => [saved],
    checkFile: async () => {
      throw new Error("Must not check an active job");
    },
  });
  assert.equal(
    (await service.duplicate(candidate, null, "job-1")).status,
    "already_downloading",
  );
});
test("concurrent start requests serialize by identity, without serializing different videos", async () => {
  const service = createRecentDownloadService({
    listJobs: async () => [],
    checkFile: async () => ({ status: "missing" }),
  });
  const events = [];
  let finish;
  const first = service.withRequestLock("same", async () => {
    events.push("first");
    await new Promise((resolve) => {
      finish = resolve;
    });
    events.push("done");
  });
  const second = service.withRequestLock("same", async () =>
    events.push("second"),
  );
  await service.withRequestLock("different", async () =>
    events.push("different"),
  );
  assert.deepEqual(events, ["first", "different"]);
  finish();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first", "different", "done", "second"]);
});

test("persistent identity works across tabs without exposing candidate URLs or browser secrets", async () => {
  const saved = {
    ...(await job()),
    sourceTabId: 99,
    candidate: { secret: "not-for-ui" },
  };
  const service = createRecentDownloadService({
    listJobs: async () => [saved],
    checkFile: async () => ({ status: "available", size: 100 }),
  });
  const result = await service.lookup({
    ...candidate,
    id: "new-session-id",
    sourceTabId: 7,
  });
  assert.equal(result.exactJob.id, saved.id);
  assert.equal(result.exactJob.candidate, undefined);
  assert.equal(JSON.stringify(result).includes("not-for-ui"), false);
});

test("a rejected start does not poison the request lock for subsequent attempts", async () => {
  const service = createRecentDownloadService({
    listJobs: async () => [],
    checkFile: async () => ({ status: "unchecked" }),
  });
  await assert.rejects(
    service.withRequestLock("same", async () => {
      throw new Error("rejected");
    }),
    /rejected/,
  );
  assert.equal(
    await service.withRequestLock("same", async () => "next"),
    "next",
  );
});
