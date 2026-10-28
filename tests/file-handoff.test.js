import test from "node:test";
import assert from "node:assert/strict";
import { createFileHandoff } from "../src/background/downloads/file-handoff.js";
import {
  sourceKey,
  createDownloadRequestEvidence,
} from "../src/background/downloads/request-evidence.js";
import { FILE_TRANSFER_KEY } from "../src/downloads/file-contract.js";
import { ACTIONS as A } from "../src/runtime/action-catalog.js";
import { normalizeDownloadIntake } from "../src/downloads/intake-contract.js";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function event() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    emit: (value) => {
      for (const fn of listeners) fn(value);
    },
  };
}
async function fixture(
  t,
  {
    journal = [],
    proofError = false,
    preparedError = false,
    signed = false,
  } = {},
) {
  const url =
      "https://cdn.example/fixture.zip" +
      (signed ? "?sig=SECRET_SIGNED_TOKEN" : ""),
    key = await sourceKey(url);
  const item = {
    id: 1,
    url,
    finalUrl: url,
    filename: "C:/Downloads/fixture.zip",
    startTime: new Date().toISOString(),
    state: "in_progress",
    danger: "safe",
    paused: false,
    canResume: true,
    totalBytes: 100,
  };
  const local = { [FILE_TRANSFER_KEY]: { items: journal } },
    session = {},
    calls = [],
    clients = [];
  let failNextLocalWrite = false;
  const area = (data) => ({
    get: async () => structuredClone(data),
    set: async (values) => {
      if (data === local && failNextLocalWrite) {
        failNextLocalWrite = false;
        throw Error("Storage unavailable.");
      }
      Object.assign(data, structuredClone(values));
    },
  });
  const changed = event();
  let permission = true,
    observing = true,
    pauseResumable = true,
    helperDelay = null;
  const chrome = {
    permissions: { contains: async () => permission },
    runtime: {},
    storage: { local: area(local), session: area(session) },
    downloads: {
      onChanged: changed,
      search: async ({ id }) => {
        calls.push("search:" + id);
        return id === item.id ? [{ ...item }] : [];
      },
      pause: async (id) => {
        calls.push("pause:" + id);
        item.paused = true;
        item.canResume = pauseResumable;
      },
      resume: async (id) => {
        calls.push("resume:" + id);
        item.paused = false;
      },
      cancel: async (id) => {
        assert.ok(local[FILE_TRANSFER_KEY].items.some((job) => job.outputPath));
        calls.push("cancel:" + id);
        item.state = "interrupted";
      },
    },
  };
  const old = globalThis.chrome;
  globalThis.chrome = chrome;
  const coordinator = createFileHandoff({
    chrome,
    intake: {
      snapshot: () => ({
        status: observing ? "observing" : "off",
        items: [normalizeDownloadIntake(item)],
      }),
    },
    evidence: {
      forDownload: async () => {
        if (proofError) throw Error("No matching GET request.");
        return {
          key,
          method: "GET",
          size: 100,
          etag: '"fixture"',
          mime: "application/zip",
        };
      },
    },
    settings: async () => ({ mediaDownloadConnections: 8 }),
    outputAction: async (action, path) => calls.push(action + ":" + path),
    prepare: async (payload, onProgress) => {
      calls.push("prepare");
      assert.equal(payload.expected.etag, '"fixture"');
      if (preparedError) throw Error("HTTP 403");
      if (helperDelay) await helperDelay;
      let resolve, reject;
      const client = {
        filename: "fixture.zip",
        totalBytes: 100,
        start() {
          calls.push("helper:start");
          onProgress({ downloadedBytes: 50, bytesPerSecond: 100 });
          return new Promise((done, fail) => {
            resolve = done;
            reject = fail;
          });
        },
        close() {
          calls.push("helper:close");
          reject?.(Error("Helper connection closed."));
        },
        complete: () =>
          resolve({
            totalBytes: 100,
            outputPath: "C:/Downloads/AdsFriendly/fixture.zip",
          }),
        fail: () => reject(Error("Range returned HTTP 403")),
      };
      clients.push(client);
      return client;
    },
  });
  const stop = coordinator.startFeature({ require() {}, can: () => true });
  t.after(async () => {
    await stop();
    globalThis.chrome = old;
  });
  return {
    coordinator,
    item,
    key,
    calls,
    clients,
    changed,
    local,
    session,
    chrome,
    failNextLocalWrite: () => {
      failNextLocalWrite = true;
    },
    permit: (value) => {
      permission = value;
    },
    observe: (value) => {
      observing = value;
    },
    pauseResumable: (value) => {
      pauseResumable = value;
    },
    delay: (value) => {
      helperDelay = value;
    },
    check: () => coordinator.execute(A.BROWSER_FILE_CHECK, { browserId: 1 }),
    async accept() {
      const { checks } = await coordinator.snapshot();
      return coordinator.execute(A.BROWSER_FILE_ACCEPT, {
        browserId: 1,
        checkId: checks[0]?.checkId,
      });
    },
  };
}

test("check is read-only; accept pauses once and cancels Chrome only after verified Helper completion", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.check()).status, "ready_for_handoff");
  assert.ok(!f.calls.some((call) => /pause:|cancel:|resume:/.test(call)));
  assert.equal((await f.accept()).status, "transferring");
  assert.deepEqual(
    f.calls.filter((call) => /pause:|cancel:/.test(call)),
    ["pause:1"],
  );
  assert.equal((await f.accept()).status, "error");
  f.clients[0].complete();
  await t.waitFor(() => assert.ok(f.calls.includes("cancel:1")), {
    timeout: 2000,
  });
  assert.equal(f.calls.filter((call) => call === "pause:1").length, 1);
  assert.equal(f.calls.filter((call) => call === "cancel:1").length, 1);
  const { fileTransfers } = await f.coordinator.snapshot();
  assert.equal(fileTransfers[0].status, "completed");
  assert.equal(
    fileTransfers[0].outputPath,
    "C:/Downloads/AdsFriendly/fixture.zip",
  );
  assert.doesNotMatch(JSON.stringify(f.local), /https:\/\/|token|signature/);
});

test("signed preflight remains memory-only and cannot pause before acceptance; automatic cleanup cannot close a manual ticket", async (t) => {
  const f = await fixture(t, { signed: true });
  const before = Date.now();
  assert.equal((await f.check()).status, "ready_for_handoff");
  let snapshot = await f.coordinator.snapshot();
  assert.ok(snapshot.checks[0].expiresAt <= before + 11000);
  assert.doesNotMatch(
    JSON.stringify(snapshot) +
      JSON.stringify(f.local) +
      JSON.stringify(f.session),
    /SECRET_SIGNED_TOKEN|sig=/,
  );
  f.coordinator.discardCheck(1, true);
  assert.equal((await f.coordinator.snapshot()).checks.length, 1);
  assert.ok(!f.calls.some((call) => /pause:|cancel:/.test(call)));
});

test("Chrome completing during signed preflight closes the prepared session and cannot produce a stale offer", async (t) => {
  const f = await fixture(t, { signed: true });
  let release;
  f.delay(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const result = f.check();
  await tick();
  f.item.state = "complete";
  release();
  assert.equal((await result).status, "error");
  assert.equal((await f.coordinator.snapshot()).checks.length, 0);
  assert.ok(f.calls.includes("helper:close"));
  assert.ok(!f.calls.some((call) => /pause:|cancel:/.test(call)));
});

test("failed preflight or missing method proof never pauses/cancels Chrome", async (t) => {
  for (const options of [
    { proofError: true },
    { preparedError: true },
    { signed: true, preparedError: true },
  ]) {
    const f = await fixture(t, options);
    assert.equal((await f.check()).status, "error");
    assert.ok(
      !f.calls.some((call) => /pause:|cancel:|helper:start/.test(call)),
    );
  }
});

test("Helper failure/disconnect restores the original Chrome request, never replays URL or cancels it", async (t) => {
  const f = await fixture(t);
  await f.check();
  await f.accept();
  f.clients[0].fail();
  await tick();
  await tick();
  assert.ok(f.calls.includes("resume:1"));
  assert.ok(!f.calls.includes("cancel:1"));
  const [job] = (await f.coordinator.snapshot()).fileTransfers;
  assert.equal(job.status, "returned_to_chrome");
});

test("completion journal failure keeps the verified file and resumes Chrome without cancellation", async (t) => {
  const f = await fixture(t);
  await f.check();
  await f.accept();
  f.failNextLocalWrite();
  f.clients[0].complete();
  await tick();
  await tick();
  assert.ok(!f.calls.includes("cancel:1"));
  assert.ok(f.calls.includes("resume:1"));
  const [job] = (await f.coordinator.snapshot()).fileTransfers;
  assert.equal(job.status, "completed");
  assert.equal(job.outputPath, "C:/Downloads/AdsFriendly/fixture.zip");
  assert.match(job.error, /Storage unavailable/);
});

test("Chrome that cannot preserve resume, a completed source, and denied native permission are not transferred", async (t) => {
  const f = await fixture(t);
  await f.check();
  f.pauseResumable(false);
  assert.equal((await f.accept()).status, "error");
  assert.ok(f.calls.includes("resume:1"));
  assert.ok(!f.calls.includes("helper:start"));
  f.item.state = "complete";
  assert.equal((await f.check()).status, "error");
  f.item.state = "in_progress";
  f.permit(false);
  assert.equal((await f.check()).status, "error");
});

test("pending checks and active transfers are closed when observation stops; duplicate checks coalesce by lock", async (t) => {
  const f = await fixture(t);
  let release;
  f.delay(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const first = f.check();
  await tick();
  assert.equal((await f.check()).status, "error");
  f.observe(false);
  await f.coordinator.returnAll();
  release();
  assert.equal((await first).status, "error");
  assert.ok(!f.calls.includes("pause:1"));
});

test("stopping observation during the pause journal cannot pause or resume a stale Chrome request", async (t) => {
  const f = await fixture(t);
  await f.check();
  const set = f.chrome.storage.local.set;
  f.chrome.storage.local.set = async (values) => {
    if (
      values[FILE_TRANSFER_KEY]?.items.some(
        (job) => job.status === "pause_requested",
      )
    ) {
      f.observe(false);
      await f.coordinator.returnAll();
    }
    await set(values);
  };
  assert.equal((await f.accept()).status, "error");
  assert.ok(!f.calls.some((call) => /pause:|cancel:|resume:/.test(call)));
});

test("restart recovery resumes only the journaled source identity, never a different Chrome download", async (t) => {
  const f = await fixture(t);
  await f.check();
  await f.accept();
  const job = (await f.coordinator.snapshot()).fileTransfers[0];
  const matching = { ...job, status: "downloading", ownedPause: true };
  const second = await fixture(t, { journal: [matching] });
  second.item.startTime = job.browserStartTime;
  second.item.paused = true;
  await tick();
  await second.coordinator.snapshot();
  assert.ok(second.calls.includes("resume:1"));
  const third = await fixture(t, {
    journal: [{ ...matching, sourceKey: "wrong" }],
  });
  third.item.paused = true;
  await third.coordinator.snapshot();
  assert.ok(!third.calls.includes("resume:1"));
  assert.equal(
    (await third.coordinator.snapshot()).fileTransfers[0].status,
    "needs_browser_attention",
  );
});

test("request evidence requires an exact source, timing, GET, strong ETag and total size without retaining URLs", async () => {
  const received = event();
  const now = Date.now(),
    url = "https://cdn.example/file.zip";
  const evidence = createDownloadRequestEvidence({
    chrome: { webRequest: { onHeadersReceived: received } },
    now: () => now,
  });
  evidence.start();
  const details = {
    url,
    statusCode: 200,
    method: "GET",
    timeStamp: now,
    responseHeaders: [
      { name: "Content-Type", value: "application/zip" },
      { name: "Content-Length", value: "100" },
      { name: "ETag", value: '"fixture"' },
    ],
  };
  received.emit(details);
  const item = { url, startTime: new Date(now).toISOString() };
  const proof = await evidence.forDownload(item);
  assert.equal(proof.method, "GET");
  assert.equal(proof.size, 100);
  assert.doesNotMatch(JSON.stringify(proof), /https:\/\//);
  received.emit({ ...details, method: "POST" });
  await assert.rejects(evidence.forDownload(item), /matching GET/);
  evidence.stop();
  await assert.rejects(evidence.forDownload(item));
});
