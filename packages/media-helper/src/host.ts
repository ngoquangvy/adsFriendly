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
import { DownloadAdapterRegistry } from "./adapter-registry.js";
import { directHttpAdapter } from "./direct-http-adapter.js";
import { hlsFfmpegAdapter } from "./hls-ffmpeg-adapter.js";
import { dashFfmpegAdapter } from "./dash-ffmpeg-adapter.js";
import { DownloadJobManager } from "./job-manager.js";
import { openManagedOutput, revealManagedOutput } from "./output-actions.js";

const HELPER_VERSION = "0.10.0";
const callerOrigin = process.argv[2] || null;
const reader = new NativeMessageReader();
const adapters = new DownloadAdapterRegistry([
  directHttpAdapter,
  hlsFfmpegAdapter,
  dashFfmpegAdapter,
]);
const jobs = new DownloadJobManager(adapters);

process.stdin.on("end", () => jobs.cancelAll());

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
    if (request.type === MEDIA_HELPER_REQUESTS.DOWNLOAD_START) {
      await jobs.start(request.payload, (type, payload) => {
        writeMessage(createHelperEvent(type, requestId, payload));
      });
      return;
    }
    if (request.type === MEDIA_HELPER_REQUESTS.DOWNLOAD_CANCEL) {
      const jobId = request.payload?.jobId;
      if (typeof jobId !== "string" || !jobId) {
        throw new Error("DOWNLOAD_CANCEL requires payload.jobId.");
      }
      if (!jobs.cancel(jobId)) {
        writeError(
          requestId,
          "job_not_found",
          new Error("Download job not found."),
        );
      }
      return;
    }
    if (
      request.type === MEDIA_HELPER_REQUESTS.OUTPUT_OPEN ||
      request.type === MEDIA_HELPER_REQUESTS.OUTPUT_REVEAL
    ) {
      const outputPath = request.payload?.outputPath;
      if (typeof outputPath !== "string" || !outputPath) {
        throw new Error("Output action requires payload.outputPath.");
      }
      if (request.type === MEDIA_HELPER_REQUESTS.OUTPUT_OPEN)
        await openManagedOutput(outputPath);
      else await revealManagedOutput(outputPath);
      writeMessage(
        createHelperEvent(MEDIA_HELPER_EVENTS.OUTPUT_OPENED, requestId, {
          action:
            request.type === MEDIA_HELPER_REQUESTS.OUTPUT_OPEN
              ? "open"
              : "reveal",
          outputPath,
        }),
      );
      return;
    }
    writeError(
      requestId,
      "not_implemented",
      new Error(`Unsupported Media Helper request: ${request.type}.`),
    );
  } catch (error) {
    writeError(requestId, "invalid_request", error);
  }
}

async function inspectCapabilities() {
  const ffmpeg = await detectExecutable("ffmpeg", ["-version"]);
  return {
    [MEDIA_HELPER_CAPABILITIES.DIRECT_HTTP_DOWNLOAD]: true,
    [MEDIA_HELPER_CAPABILITIES.HLS_VOD_DOWNLOAD]: ffmpeg.available,
    [MEDIA_HELPER_CAPABILITIES.HLS_PARALLEL_ACQUISITION]: ffmpeg.available,
    [MEDIA_HELPER_CAPABILITIES.HLS_DECRYPTED_MANIFEST]: ffmpeg.available,
    [MEDIA_HELPER_CAPABILITIES.OUTPUT_CONTAINER_SELECTION]: ffmpeg.available,
    [MEDIA_HELPER_CAPABILITIES.DASH_VOD_DOWNLOAD]: ffmpeg.available,
    [MEDIA_HELPER_CAPABILITIES.FFMPEG_MUX]: ffmpeg.available,
    [MEDIA_HELPER_CAPABILITIES.OUTPUT_OPEN]: true,
    [MEDIA_HELPER_CAPABILITIES.OUTPUT_REVEAL]: true,
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
