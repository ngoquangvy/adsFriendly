import { getDownloadProgress } from "./progress.js";

const WINDOW_MS = 30000,
  UPDATE_MS = 3000;

// One estimator at the owning background store, not one per UI surface. Uses
// actual byte/time/resource deltas, not the instantaneous reported transfer rate.
export function createDownloadEtaEstimator({ now = Date.now } = {}) {
  const entries = new Map();
  function update(id, progress, status = progress?.phase) {
    const time = now(),
      { basis } = getDownloadProgress(progress);
    const fields = {
      bytes: ["downloadedBytes", "totalBytes"],
      time: ["processedSeconds", "duration"],
      resources: ["completedResources", "totalResources"],
    }[basis];
    if (status !== "downloading" || !fields) {
      entries.delete(id);
      return { etaSeconds: null, etaUpdatedAt: null };
    }
    const done = Math.max(0, Number(progress[fields[0]])),
      total = Number(progress[fields[1]]);
    let entry = entries.get(id);
    if (
      !entry ||
      entry.basis !== basis ||
      entry.total !== total ||
      done < entry.done ||
      time - entry.lastSeen > 15000 ||
      entry.stage !== progress.stage
    ) {
      entry = {
        basis,
        total,
        stage: progress.stage,
        done,
        lastSeen: time,
        samples: [],
        lastUpdate: time,
        speed: null,
        eta: null,
      };
      entries.delete(id);
      entries.set(id, entry);
    }
    entry.lastSeen = time;
    entry.done = done;
    entry.samples.push({ time, done });
    while (
      entry.samples.length > 256 ||
      (entry.samples.length > 2 && entry.samples[1].time < time - WINDOW_MS)
    )
      entry.samples.shift();
    while (entries.size > 100) entries.delete(entries.keys().next().value);
    if (time - entry.lastUpdate >= UPDATE_MS) {
      const first = entry.samples[0],
        elapsed = (time - first.time) / 1000;
      const speed = elapsed >= 3 ? (done - first.done) / elapsed : 0;
      if (speed > 0) {
        entry.speed =
          entry.speed === null ? speed : entry.speed * 0.75 + speed * 0.25;
        entry.eta = Math.max(0, (total - done) / entry.speed);
      } else entry.eta = null;
      entry.lastUpdate = time;
    }
    return { etaSeconds: entry.eta, etaUpdatedAt: entry.lastUpdate };
  }
  return { update, forget: (id) => entries.delete(id) };
}

export function formatDownloadEta(progress, now = Date.now()) {
  const seconds = progress?.etaSeconds;
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    !Number.isFinite(progress.etaUpdatedAt) ||
    now - progress.etaUpdatedAt > 12000
  )
    return null;
  if (seconds < 60) return `${Math.max(10, Math.ceil(seconds / 10) * 10)} s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  const minutes = Math.ceil(seconds / 300) * 5;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}
