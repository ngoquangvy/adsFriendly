const ACTIVE_STATUSES = new Set([
  "starting",
  "probing",
  "downloading",
  "finalizing",
]);

export function getMediaJobProgress(job = {}) {
  const progress = job.progress || {};
  const downloadedBytes = finiteOrNull(progress.downloadedBytes);
  const totalBytes = finiteOrNull(progress.totalBytes);
  const processedSeconds = finiteOrNull(progress.processedSeconds);
  const duration = finiteOrNull(progress.duration);
  let percent = null;
  if (duration > 0 && processedSeconds !== null) {
    percent = Math.min(100, Math.round((processedSeconds / duration) * 100));
  } else if (totalBytes > 0 && downloadedBytes !== null) {
    percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
  }
  return {
    percent,
    downloadedBytes,
    totalBytes,
    bytesPerSecond: finiteOrNull(progress.bytesPerSecond),
    processedSeconds,
    duration,
    resumedBytes: finiteOrNull(progress.resumedBytes),
    resumable: progress.resumable === true,
    connections: normalizeConnections(job.connections),
  };
}

export function getMediaJobPrimaryAction(job = {}) {
  if (job.historyOnly === true) return null;
  if (job.status === "paused")
    return {
      type: "resume",
      label: "Resume",
      messageType: "RESUME_MEDIA_DOWNLOAD_JOB",
    };
  if (["cancelled", "failed"].includes(job.status))
    return {
      type: "retry",
      label: "Retry",
      messageType: "RETRY_MEDIA_DOWNLOAD_JOB",
    };
  if (!ACTIVE_STATUSES.has(job.status)) return null;
  if (job.progress?.resumable === true)
    return {
      type: "pause",
      label: "Pause",
      messageType: "PAUSE_MEDIA_DOWNLOAD_JOB",
    };
  return {
    type: "cancel",
    label: "Cancel",
    messageType: "CANCEL_MEDIA_DOWNLOAD_JOB",
  };
}

export function formatMediaJobDetails(job = {}) {
  const progress = getMediaJobProgress(job);
  const connectionFact = `${progress.connections} connections`;
  if (job.status === "completed") {
    const size = progress.totalBytes ?? progress.downloadedBytes;
    return [
      "Completed",
      size !== null ? formatBytes(size) : null,
      connectionFact,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (job.status === "failed")
    return ["Failed", job.error || "unknown error", connectionFact]
      .filter(Boolean)
      .join(" · ");
  if (["cancelled", "paused"].includes(job.status)) {
    return [
      job.status === "paused" ? "Paused" : "Cancelled",
      progress.downloadedBytes !== null
        ? `${formatBytes(progress.downloadedBytes)} downloaded`
        : null,
      progress.resumable ? "partial data kept" : null,
      connectionFact,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (job.status === "cancelling") return `Stopping · ${connectionFact}`;
  if (job.status === "pausing") return `Pausing · ${connectionFact}`;

  const facts = [];
  if (progress.percent !== null) facts.push(`${progress.percent}%`);
  if (progress.duration > 0 && progress.processedSeconds !== null) {
    facts.push(
      `${formatDuration(progress.processedSeconds)} / ${formatDuration(progress.duration)}`,
    );
  }
  if (progress.downloadedBytes !== null) {
    facts.push(
      progress.totalBytes > 0
        ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
        : formatBytes(progress.downloadedBytes),
    );
  }
  if (progress.bytesPerSecond > 0)
    facts.push(`${formatBytes(progress.bytesPerSecond)}/s`);
  if (progress.resumedBytes > 0)
    facts.push(`resumed ${formatBytes(progress.resumedBytes)}`);
  facts.push(connectionFact);
  if (facts.length === 1) facts.unshift(capitalize(job.status || "starting"));
  return facts.join(" · ");
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeConnections(value) {
  const connections = Number(value);
  return Number.isInteger(connections) && connections > 0 ? connections : 8;
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Starting";
}
