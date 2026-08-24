import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { endianness } from "node:os";
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
