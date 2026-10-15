import {
  FILE_HELPER_REQUESTS as R,
  FILE_HELPER_EVENTS as E,
  fileId,
} from "../../../src/downloads/file-contract.js";
import { prepareFile, downloadPreparedFile } from "./file-http-download.js";
import type { PreparedFile } from "./file-http-download.js";

type Emit = (type: string, payload: Record<string, unknown>) => void;
type FileEntry = {
  controller: AbortController;
  prepared?: PreparedFile;
  started: boolean;
  expires: number;
  timer?: NodeJS.Timeout;
};

// Generic files never enter the media candidate/adapter registry.
export class FileJobManager {
  private entries = new Map<string, FileEntry>();
  async handle(type: string, raw: Record<string, unknown>, emit: Emit) {
    const jobId = fileId(raw.jobId);
    if (type === R.FILE_CANCEL) {
      const entry = this.entries.get(jobId);
      if (entry) {
        entry.controller.abort();
        clearTimeout(entry.timer);
        if (!entry.started) this.entries.delete(jobId);
      }
      emit(E.FILE_CANCELLED, { jobId });
      return;
    }
    if (type === R.FILE_PREPARE) {
      if (this.entries.has(jobId) || this.entries.size >= 4)
        throw Error("File transfer is already active or the queue is full.");
      const entry: FileEntry = {
        controller: new AbortController(),
        started: false,
        expires: Date.now() + 60000,
      };
      this.entries.set(jobId, entry);
      try {
        entry.prepared = await prepareFile(
          raw,
          AbortSignal.any([
            entry.controller.signal,
            AbortSignal.timeout(15000),
          ]),
        );
        entry.controller.signal.throwIfAborted();
        entry.timer = setTimeout(() => {
          entry.controller.abort();
          this.entries.delete(jobId);
        }, 60000);
        entry.timer.unref();
        emit(E.FILE_PREPARED, {
          jobId,
          token: entry.prepared.token,
          filename: entry.prepared.filename,
          totalBytes: entry.prepared.request.expected.size,
        });
      } catch (error) {
        this.entries.delete(jobId);
        emit(E.FILE_FAILED, {
          jobId,
          stage: "preflight",
          message: safeFileFailure(error),
        });
      }
      return;
    }
    const entry = this.entries.get(jobId);
    if (
      type !== R.FILE_START ||
      !entry?.prepared ||
      entry.started ||
      entry.expires < Date.now() ||
      raw.token !== entry.prepared.token
    )
      throw Error("Prepared file transfer expired or mismatched.");
    entry.started = true;
    clearTimeout(entry.timer);
    emit(E.FILE_STARTED, { jobId });
    try {
      const result = await downloadPreparedFile(entry.prepared, {
        signal: entry.controller.signal,
        progress: (progress) => emit(E.FILE_PROGRESS, { jobId, ...progress }),
        strategy: () => {},
      });
      emit(E.FILE_COMPLETED, { jobId, ...result });
    } catch (error) {
      emit(entry.controller.signal.aborted ? E.FILE_CANCELLED : E.FILE_FAILED, {
        jobId,
        stage: "transfer",
        message: safeFileFailure(error),
      });
    } finally {
      this.entries.delete(jobId);
    }
  }
  cancelAll() {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
      entry.controller.abort();
    }
    this.entries.clear();
  }
}

// Network stacks can put signed URLs in errors. Only controlled diagnostics cross
// the boundary; filesystem/network codes are useful without exposing credentials.
function safeFileFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    /^(File |The file |Helper could |The source |Compressed HTTP |Downloaded file |A known |A strong |This file |Only credential|Range request for bytes |Range ended |Range exceeded |Private or local|Media server returned HTTP)/.test(
      message,
    )
  )
    return message.slice(0, 600);
  const code = (error as NodeJS.ErrnoException)?.code;
  return (
    "File transfer failed" +
    (code && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : "") +
    ". The source, network, or output folder may be unavailable."
  );
}
