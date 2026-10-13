import {
  buildMediaDownloadIdentity,
  buildMediaDownloadSummary,
  findRelatedDownloadJobs,
  presentDownloadJob,
} from "../media/download-identity.js";
import { isMediaJobActive } from "../media/download-job-view.js";

// IO is injected so duplicate policy can be tested without Chrome or FFmpeg.
// No disk scans, file hashing, signed URLs, or tokens are persisted here.
export function createRecentDownloadService({
  listJobs,
  checkFile,
  now = () => Date.now(),
}) {
  const checks = new Map();
  const operations = new Map();
  const fileState = async (job, verify) => {
    if (job.status !== "completed") return "unchecked";
    if (!job.outputPath) return "missing";
    const key = `${job.id}|${job.outputPath}|${job.updatedAt}`;
    const cached = checks.get(key);
    if (!verify) return cached?.expiresAt > now() ? cached.status : "unchecked";
    let status;
    try {
      const result = await checkFile(job.outputPath);
      status = result?.status || "unchecked";
      const expectedSize = job.progress?.totalBytes;
      if (
        status === "available" &&
        expectedSize > 0 &&
        result.size !== expectedSize
      )
        status = "changed";
    } catch {
      status = "unchecked";
    }
    checks.set(key, { status, expiresAt: now() + 60_000 });
    while (checks.size > 128) checks.delete(checks.keys().next().value);
    return status;
  };
  const lookup = async (candidate, output, { verifyFile = false } = {}) => {
    const identity = await buildMediaDownloadIdentity(candidate, output);
    const jobs = await listJobs();
    // Session records from older builds retain candidate/output and can be
    // upgraded safely. Legacy persistent rows without those facts are not guessed.
    const compatible = await Promise.all(
      jobs.map(async (job) => {
        if (job.downloadIdentity || !job.candidate || !job.output) return job;
        try {
          return {
            ...job,
            downloadIdentity: await buildMediaDownloadIdentity(
              job.candidate,
              job.output,
            ),
            downloadSummary: buildMediaDownloadSummary(
              job.candidate,
              job.output,
            ),
          };
        } catch {
          return job;
        }
      }),
    );
    const exact =
      findRelatedDownloadJobs(compatible, identity, { now: now() })[0] || null;
    const related = findRelatedDownloadJobs(compatible, identity, {
      exact: false,
      now: now(),
    }).slice(0, 5);
    const selected = related[0] || null;
    const states = new Map(
      await Promise.all(
        [...new Set([exact, selected].filter(Boolean))].map(async (job) => [
          job.id,
          await fileState(job, verifyFile),
        ]),
      ),
    );
    return {
      status: "ok",
      identity,
      exactJob: exact ? presentDownloadJob(exact, states.get(exact.id)) : null,
      latestJob: selected
        ? presentDownloadJob(selected, states.get(selected.id))
        : null,
      relatedCount: related.length,
    };
  };
  const duplicate = async (candidate, output, repeatOf = null) => {
    const result = await lookup(candidate, output, { verifyFile: true });
    const job = result.exactJob;
    if (!job) return null;
    if (isMediaJobActive(job)) return { status: "already_downloading", job };
    if (["missing", "changed"].includes(job.fileStatus) || job.id === repeatOf)
      return null;
    return { status: "already_downloaded", job };
  };
  const withRequestLock = async (key, run) => {
    const previous = operations.get(key) || Promise.resolve();
    const operation = previous.catch(() => {}).then(run);
    operations.set(key, operation);
    try {
      return await operation;
    } finally {
      if (operations.get(key) === operation) operations.delete(key);
    }
  };
  return { lookup, duplicate, withRequestLock, clear: () => checks.clear() };
}
