import { spawn } from "node:child_process";
import process from "node:process";
import {
  MEDIA_HELPER_CAPABILITIES,
  MEDIA_HELPER_EVENTS,
  MEDIA_HELPER_PROTOCOL_VERSION,
  MEDIA_HELPER_REQUESTS,
  createHelperEvent,
  normalizeHelperRequest,
} from "../../../src/media/helper-contract.js";
import {
  NativeMessageReader,
  encodeNativeMessage,
} from "./native-messaging.js";

const HELPER_VERSION = "0.1.0";
const callerOrigin = process.argv[2] || null;
const reader = new NativeMessageReader();

process.stdin.on("data", (chunk: Buffer) => {
  try {
    for (const message of reader.push(chunk)) void handleMessage(message);
  } catch (error) {
    writeError("unknown", "invalid_frame", error);
  }
});

process.stdin.on("error", (error) => {
  process.stderr.write(
    `[AdsFriendly Media Helper] stdin failed: ${messageOf(error)}\n`,
  );
  process.exitCode = 1;
});

async function handleMessage(rawMessage: unknown): Promise<void> {
  let requestId = "unknown";
  try {
    const request = normalizeHelperRequest(rawMessage);
    requestId = request.requestId;
    if (request.protocolVersion !== MEDIA_HELPER_PROTOCOL_VERSION) {
      writeError(
        requestId,
        "incompatible_protocol",
        new Error(
          `Expected protocol ${MEDIA_HELPER_PROTOCOL_VERSION}, received ${request.protocolVersion}.`,
        ),
      );
      return;
    }
    if (request.type === MEDIA_HELPER_REQUESTS.HELLO) {
      writeMessage(
        createHelperEvent(MEDIA_HELPER_EVENTS.READY, requestId, {
          helperVersion: HELPER_VERSION,
          callerOrigin,
          capabilities: await inspectCapabilities(),
        }),
      );
      return;
    }
    if (request.type === MEDIA_HELPER_REQUESTS.GET_CAPABILITIES) {
      writeMessage(
        createHelperEvent(
          MEDIA_HELPER_EVENTS.CAPABILITIES,
          requestId,
          await inspectCapabilities(),
        ),
      );
      return;
    }
    writeError(
      requestId,
      "not_implemented",
      new Error(
        "Download execution will be added after the helper handshake is integrated.",
      ),
    );
  } catch (error) {
    writeError(requestId, "invalid_request", error);
  }
}

async function inspectCapabilities() {
  const ffmpeg = await detectExecutable("ffmpeg", ["-version"]);
  return {
    [MEDIA_HELPER_CAPABILITIES.HLS_VOD_DOWNLOAD]: false,
    [MEDIA_HELPER_CAPABILITIES.FFMPEG_MUX]: ffmpeg.available,
    ffmpeg,
  };
}

function detectExecutable(command: string, args: string[]) {
  return new Promise<{ available: boolean; version: string | null }>(
    (resolve) => {
      const child = spawn(command, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const chunks: Buffer[] = [];
      const timeout = setTimeout(() => child.kill(), 1500);
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("error", () => {
        clearTimeout(timeout);
        resolve({ available: false, version: null });
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        const firstLine = Buffer.concat(chunks)
          .toString("utf8")
          .split(/\r?\n/, 1)[0]
          ?.trim();
        resolve({ available: code === 0, version: firstLine || null });
      });
    },
  );
}

function writeError(requestId: string, code: string, error: unknown): void {
  writeMessage(
    createHelperEvent(MEDIA_HELPER_EVENTS.ERROR, requestId, {
      code,
      message: messageOf(error),
    }),
  );
}

function writeMessage(message: unknown): void {
  process.stdout.write(encodeNativeMessage(message));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
