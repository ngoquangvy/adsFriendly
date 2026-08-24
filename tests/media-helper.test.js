import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { endianness, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MEDIA_HELPER_EVENTS,
  MEDIA_HELPER_PROTOCOL_VERSION,
  MEDIA_HELPER_REQUESTS,
} from "../src/media/helper-contract.js";

test("built helper completes a framed Native Messaging handshake", async () => {
  const hostPath = fileURLToPath(
    new URL("../packages/media-helper/dist/host.cjs", import.meta.url),
  );
  const child = spawn(
    process.execPath,
    [hostPath, "chrome-extension://test/"],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const request = {
    type: MEDIA_HELPER_REQUESTS.HELLO,
    requestId: "hello-1",
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: { extensionVersion: "test" },
  };
  child.stdin.end(frame(request));
  const response = await readFrame(child.stdout);
  child.kill();

  assert.equal(response.type, MEDIA_HELPER_EVENTS.READY);
  assert.equal(response.requestId, "hello-1");
  assert.equal(response.protocolVersion, MEDIA_HELPER_PROTOCOL_VERSION);
  assert.equal(response.payload.callerOrigin, "chrome-extension://test/");
  assert.equal(typeof response.payload.capabilities, "object");
});

test("built helper downloads direct media with ranges, cancellation, and resume", async (t) => {
  const bytes = Buffer.alloc(12 * 1024 * 1024 + 37);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  const server = createRangeServer(bytes, 3);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const outputDirectory = await mkdtemp(join(tmpdir(), "adsfriendly-helper-"));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  const address = server.address();
  const sourceUrl = `http://127.0.0.1:${address.port}/sample.mp4`;
  const child = spawnHelper();
  t.after(() => child.kill());
  const frames = createFrameReader(child.stdout);

  child.stdin.write(
    frame(downloadRequest("download-1", sourceUrl, outputDirectory)),
  );
  await frames.next(
    (event) => event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_STARTED,
  );
  await frames.next(
    (event) =>
      event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS &&
      event.payload.downloadedBytes >= 8 * 1024 * 1024 &&
      event.payload.downloadedBytes < bytes.length,
  );
  child.stdin.write(
    frame({
      type: MEDIA_HELPER_REQUESTS.DOWNLOAD_CANCEL,
      requestId: "download-1",
      protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
      payload: { jobId: "download-1" },
    }),
  );
  await frames.next(
    (event) => event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_CANCELLED,
  );

  child.stdin.write(
    frame(downloadRequest("download-2", sourceUrl, outputDirectory)),
  );
  const resumed = await frames.next(
    (event) =>
      event.requestId === "download-2" &&
      event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS &&
      event.payload.resumedBytes > 0,
  );
  const completed = await frames.next(
    (event) =>
      event.requestId === "download-2" &&
      event.type === MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED,
  );
  assert.ok(resumed.payload.resumedBytes >= 4 * 1024 * 1024);
  assert.deepEqual(await readFile(completed.payload.outputPath), bytes);
});

function spawnHelper() {
  const hostPath = fileURLToPath(
    new URL("../packages/media-helper/dist/host.cjs", import.meta.url),
  );
  return spawn(process.execPath, [hostPath, "chrome-extension://test/"], {
    env: { ...process.env, ADSFRIENDLY_HELPER_ALLOW_PRIVATE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

function downloadRequest(jobId, sourceUrl, outputDirectory) {
  return {
    type: MEDIA_HELPER_REQUESTS.DOWNLOAD_START,
    requestId: jobId,
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: {
      jobId,
      connections: 2,
      outputDirectory,
      candidate: {
        id: "direct-test",
        kind: "direct",
        pageUrl: sourceUrl,
        sourceUrl,
        title: "sample",
        mimeType: "video/mp4",
      },
    },
  };
}

function createRangeServer(bytes, delayMs) {
  return createServer((request, response) => {
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Type", "video/mp4");
    response.setHeader("ETag", '"direct-test-v1"');
    if (request.method === "HEAD") {
      response.setHeader("Content-Length", bytes.length);
      response.end();
      return;
    }
    const match = request.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
    if (!match) {
      response.writeHead(200, { "Content-Length": bytes.length });
      response.end(bytes);
      return;
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), bytes.length - 1);
    response.writeHead(206, {
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
    });
    let offset = start;
    const send = () => {
      if (offset > end) {
        response.end();
        return;
      }
      const next = Math.min(end + 1, offset + 64 * 1024);
      if (!response.write(bytes.subarray(offset, next))) {
        response.once("drain", () => setTimeout(send, delayMs));
      } else {
        setTimeout(send, delayMs);
      }
      offset = next;
    };
    send();
  });
}

function createFrameReader(stream) {
  let pending = Buffer.alloc(0);
  const queued = [];
  const waiters = [];
  stream.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.byteLength >= 4) {
      const length = readLength(pending);
      if (pending.byteLength < length + 4) break;
      const event = JSON.parse(
        pending.subarray(4, length + 4).toString("utf8"),
      );
      pending = pending.subarray(length + 4);
      queued.push(event);
    }
    flush();
  });
  function flush() {
    for (let waiterIndex = 0; waiterIndex < waiters.length; waiterIndex++) {
      const waiter = waiters[waiterIndex];
      const eventIndex = queued.findIndex(waiter.predicate);
      if (eventIndex < 0) continue;
      waiters.splice(waiterIndex--, 1);
      waiter.resolve(queued.splice(eventIndex, 1)[0]);
    }
  }
  return {
    next(predicate) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out waiting for helper event. Queued: ${JSON.stringify(queued)}`,
              ),
            ),
          10_000,
        );
        waiters.push({
          predicate,
          resolve(value) {
            clearTimeout(timeout);
            resolve(value);
          },
        });
        flush();
      });
    },
  };
}

function frame(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const output = Buffer.allocUnsafe(body.byteLength + 4);
  writeLength(output, body.byteLength);
  body.copy(output, 4);
  return output;
}

function readFrame(stream) {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    stream.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.byteLength < 4) return;
      const length = readLength(pending);
      if (pending.byteLength < length + 4) return;
      resolve(JSON.parse(pending.subarray(4, length + 4).toString("utf8")));
    });
    stream.on("error", reject);
    stream.on("end", () =>
      reject(new Error("Helper exited without a response.")),
    );
  });
}

function readLength(buffer) {
  return endianness() === "BE"
    ? buffer.readUInt32BE(0)
    : buffer.readUInt32LE(0);
}

function writeLength(buffer, value) {
  if (endianness() === "BE") buffer.writeUInt32BE(value, 0);
  else buffer.writeUInt32LE(value, 0);
}
