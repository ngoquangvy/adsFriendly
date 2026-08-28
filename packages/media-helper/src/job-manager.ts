import {
  MEDIA_HELPER_EVENTS,
  normalizeHelperDownloadPayload,
} from "../../../src/media/helper-contract.js";
import { DownloadAdapterRegistry } from "./adapter-registry.js";
import type { DownloadJob } from "./download-types.js";

type Emit = (type: string, payload: Record<string, unknown>) => void;

export class DownloadJobManager {
  private readonly jobs = new Map<string, AbortController>();

  constructor(private readonly registry: DownloadAdapterRegistry) {}

  start(rawPayload: unknown, emit: Emit): DownloadJob {
    const job = normalizeHelperDownloadPayload(
      rawPayload as Record<string, unknown>,
    ) as DownloadJob;
    if (this.jobs.has(job.jobId)) {
      throw new Error(`Download job "${job.jobId}" is already running.`);
    }
    const adapter = this.registry.resolve(job.candidate);
    const controller = new AbortController();
    this.jobs.set(job.jobId, controller);
    emit(MEDIA_HELPER_EVENTS.DOWNLOAD_STARTED, {
      jobId: job.jobId,
      mediaId: job.candidate.id,
      adapterId: adapter.id,
    });
    void adapter
      .execute(job, {
        signal: controller.signal,
        progress: (progress) =>
          emit(MEDIA_HELPER_EVENTS.DOWNLOAD_PROGRESS, {
            jobId: job.jobId,
            mediaId: job.candidate.id,
            ...progress,
          }),
        strategy: (strategy) =>
          emit(MEDIA_HELPER_EVENTS.ACCESS_STRATEGY_RESULT, {
            jobId: job.jobId,
            mediaId: job.candidate.id,
            ...strategy,
          }),
      })
      .then((result) =>
        emit(MEDIA_HELPER_EVENTS.DOWNLOAD_COMPLETED, {
          jobId: job.jobId,
          mediaId: job.candidate.id,
          ...result,
        }),
      )
      .catch((error) => {
        if (controller.signal.aborted) {
          emit(MEDIA_HELPER_EVENTS.DOWNLOAD_CANCELLED, {
            jobId: job.jobId,
            mediaId: job.candidate.id,
          });
          return;
        }
        emit(MEDIA_HELPER_EVENTS.ERROR, {
          jobId: job.jobId,
          mediaId: job.candidate.id,
          code: "download_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => this.jobs.delete(job.jobId));
    return job;
  }

  cancel(jobId: string) {
    const controller = this.jobs.get(jobId);
    if (!controller) return false;
    controller.abort(new Error("Download cancelled by user."));
    return true;
  }

  cancelAll() {
    for (const controller of this.jobs.values()) {
      controller.abort(new Error("Native Messaging connection closed."));
    }
  }
}
