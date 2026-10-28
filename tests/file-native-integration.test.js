import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createFileHandoff } from "../src/background/downloads/file-handoff.js";
import { normalizeDownloadIntake } from "../src/downloads/intake-contract.js";
import { sourceKey } from "../src/background/downloads/request-evidence.js";
import { ACTIONS as A } from "../src/runtime/action-catalog.js";
import { createAutomaticFileChecks } from "../src/background/downloads/auto-file-checks.js";

function event() {
  const items = new Set();
  return {
    addListener: (fn) => items.add(fn),
    removeListener: (fn) => items.delete(fn),
    emit: (value) => {
      for (const fn of items) fn(value);
    },
  };
}
async function signedFixture(t, expireAfterCheck = false) {
  const bytes = Buffer.alloc(9 * 1024 * 1024 + 5, 123),
    name = "adsfriendly-file-native-" + randomUUID() + ".zip";
  let expired = false;
  const server = createServer((req, res) => {
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    if (
      expired ||
      new URL(req.url, "http://localhost").searchParams.get("sig") !==
        "PRIVATE_SIGNED_NATIVE_FIXTURE"
    ) {
      res.writeHead(403).end();
      return;
    }
    const match = /bytes=(\d+)-(\d+)/.exec(req.headers.range || "");
    const start = match ? Number(match[1]) : 0,
      end = match ? Number(match[2]) : bytes.length - 1;
    res.statusCode = match ? 206 : 200;
    res.setHeader("ETag", '"native-fixture"');
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", end - start + 1);
    if (match)
      res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
    res.end(req.method === "HEAD" ? undefined : bytes.subarray(start, end + 1));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const children = [];
  t.after(async () => {
    for (const child of children) child.kill();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/fixture.zip?sig=PRIVATE_SIGNED_NATIVE_FIXTURE`;
  const item = {
    id: 7,
    url,
    finalUrl: url,
    filename: name,
    startTime: new Date().toISOString(),
    state: "in_progress",
    danger: "safe",
    totalBytes: bytes.length,
    paused: false,
    canResume: true,
  };
  const local = {},
    session = {},
    calls = [];
  const area = (data) => ({
    get: async () => structuredClone(data),
    set: async (values) => Object.assign(data, structuredClone(values)),
  });
  const chrome = {
    permissions: { contains: async () => true },
    storage: { local: area(local), session: area(session) },
    downloads: {
      onChanged: event(),
      search: async () => [{ ...item }],
      pause: async () => {
        calls.push("pause");
        item.paused = true;
      },
      resume: async () => {
        calls.push("resume");
        item.paused = false;
      },
      cancel: async () => {
        calls.push("cancel");
        item.state = "interrupted";
      },
    },
    runtime: {
      getManifest: () => ({ version: "fixture" }),
      connectNative: () => {
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(
              new URL(
                "../packages/media-helper/dist/host.cjs",
                import.meta.url,
              ),
            ),
            "chrome-extension://fixture/",
          ],
          {
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, ADSFRIENDLY_HELPER_ALLOW_PRIVATE: "1" },
          },
        );
        children.push(child);
        const onMessage = event(),
          onDisconnect = event();
        let buffer = Buffer.alloc(0);
        child.stdout.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (
            buffer.length >= 4 &&
            buffer.length >= buffer.readUInt32LE(0) + 4
          ) {
            const length = buffer.readUInt32LE(0);
            const message = JSON.parse(buffer.subarray(4, length + 4));
            buffer = buffer.subarray(length + 4);
            onMessage.emit(message);
          }
        });
        child.on("close", () => onDisconnect.emit());
        return {
          onMessage,
          onDisconnect,
          disconnect: () => child.stdin.end(),
          postMessage: (value) => {
            const data = Buffer.from(JSON.stringify(value)),
              framed = Buffer.alloc(data.length + 4);
            framed.writeUInt32LE(data.length);
            data.copy(framed, 4);
            child.stdin.write(framed);
          },
        };
      },
    },
  };
  const old = globalThis.chrome;
  globalThis.chrome = chrome;
  t.after(() => {
    globalThis.chrome = old;
  });
  let onRecord;
  const intake = {
    snapshot: () => ({
      status: "observing",
      items: [normalizeDownloadIntake(item)],
    }),
    subscribe(fn) {
      onRecord = fn;
      return () => {
        onRecord = null;
      };
    },
  };
  const coordinator = createFileHandoff({
    chrome,
    intake,
    evidence: {
      forDownload: async () => ({
        key: await sourceKey(url),
        etag: '"native-fixture"',
        size: bytes.length,
        mime: "application/zip",
      }),
    },
    settings: async () => ({ mediaDownloadConnections: 8 }),
  });
  const stop = coordinator.startFeature({ require() {}, can: () => true });
  const automatic = createAutomaticFileChecks({
    chrome,
    intake,
    handoff: coordinator,
  });
  const stopAuto = automatic.startFeature({ require() {} });
  t.after(async () => {
    stopAuto();
    await stop();
  });
  onRecord({ type: "create", id: 7, row: normalizeDownloadIntake(item) });
  for (
    let attempt = 0;
    attempt < 1000 && !(await automatic.snapshot()).offers.length;
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    (await automatic.snapshot()).offers.length,
    1,
    "automatic signed preflight did not produce an offer",
  );
  assert.deepEqual(calls, []);
  const checked = (await coordinator.snapshot()).checks[0];
  assert.doesNotMatch(
    JSON.stringify(await automatic.snapshot()),
    /PRIVATE_SIGNED_NATIVE_FIXTURE/,
  );
  expired = expireAfterCheck;
  const accepted = await coordinator.execute(A.BROWSER_FILE_ACCEPT, {
    browserId: 7,
    checkId: checked.checkId,
  });
  assert.equal(accepted.status, "transferring", accepted.error);
  assert.equal(calls[0], "pause");
  let completed;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const job = (await coordinator.snapshot()).fileTransfers[0];
    if (expireAfterCheck && job?.status === "returned_to_chrome") {
      assert.deepEqual(calls, ["pause", "resume"]);
      assert.match(job.error, /403/);
      assert.doesNotMatch(
        JSON.stringify(local) + JSON.stringify(session),
        /PRIVATE_SIGNED_NATIVE_FIXTURE/,
      );
      return;
    }
    if (job?.status === "completed") {
      completed = job;
      break;
    }
    if (
      job?.status === "returned_to_chrome" ||
      job?.status === "needs_browser_attention"
    )
      assert.fail(job.error);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(completed, "native file download timed out");
  assert.equal(basename(completed.outputPath), name);
  t.after(() => rm(completed.outputPath, { force: true }));
  assert.deepEqual(await readFile(completed.outputPath), bytes);
  assert.deepEqual(calls, ["pause", "cancel"]);
  assert.doesNotMatch(
    JSON.stringify(local) + JSON.stringify(session),
    /http:\/\/|native-fixture|PRIVATE_SIGNED_NATIVE_FIXTURE/,
  );
}
test("automatic signed preflight → real Helper → explicit acceptance → byte-exact output", (t) =>
  signedFixture(t));
test("signed URL expiring after verification returns ownership to Chrome, never cancels its copy", (t) =>
  signedFixture(t, true));
