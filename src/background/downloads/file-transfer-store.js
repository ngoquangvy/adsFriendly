import { FILE_TRANSFER_KEY } from "../../downloads/file-contract.js";
const active = new Set(["pause_requested", "downloading", "returning"]);
export const isFileTransferActive = (row) => active.has(row?.status);

// Local journal contains lifecycle/recovery metadata; progress is session-only.
// Source URLs/prepared tokens/native payloads are never accepted by this store.
export function createFileTransferStore(chrome) {
  const jobs = new Map();
  let chain = Promise.resolve(),
    timer = null,
    revision = 0;
  function project(row) {
    return {
      id: String(row.id),
      browserId: Number(row.browserId),
      sourceKey: String(row.sourceKey || ""),
      browserStartTime: String(row.browserStartTime || ""),
      filename: String(row.filename || "File").slice(0, 180),
      status: String(row.status),
      createdAt: Number(row.createdAt) || Date.now(),
      totalBytes: Number(row.totalBytes) || null,
      outputPath: row.outputPath || null,
      error: row.error
        ? String(row.error)
            .replace(/https?:\/\/\S+/g, "[source]")
            .slice(0, 600)
        : null,
      ownedPause: row.ownedPause === true,
    };
  }
  async function load() {
    const saved = await chrome.storage.local.get(FILE_TRANSFER_KEY);
    for (const row of (saved?.[FILE_TRANSFER_KEY]?.items || []).slice(-100)) {
      if (typeof row?.id !== "string" || !Number.isInteger(row.browserId))
        continue;
      jobs.set(row.id, project(row));
    }
  }
  function list() {
    return [...jobs.values()].reverse().map((row) => ({
      ...row,
      progress: row.progress ? { ...row.progress } : null,
    }));
  }
  function publish(lifecycle = false) {
    clearTimeout(timer);
    timer = null;
    const snapshot = { version: 1, revision: ++revision, items: list() };
    const journal = { version: 1, items: [...jobs.values()].map(project) };
    chain = chain
      .catch(() => {})
      .then(async () => {
        if (lifecycle)
          await chrome.storage.local.set({ [FILE_TRANSFER_KEY]: journal });
        await chrome.storage.session.set({ [FILE_TRANSFER_KEY]: snapshot });
      });
    return chain;
  }
  function put(row) {
    jobs.set(row.id, { ...jobs.get(row.id), ...project(row) });
    while (jobs.size > 100) {
      const removable = [...jobs.values()].find(
        (item) => !isFileTransferActive(item),
      );
      if (!removable) break;
      jobs.delete(removable.id);
    }
    return publish(true);
  }
  function progress(id, value) {
    const row = jobs.get(id);
    if (!row) return;
    row.progress = {
      downloadedBytes: Number(value.downloadedBytes) || 0,
      totalBytes: row.totalBytes,
      bytesPerSecond: Number(value.bytesPerSecond) || 0,
    };
    if (!timer)
      timer = setTimeout(() => {
        void publish().catch(() => {});
      }, 500);
  }
  return {
    load,
    list,
    get: (id) => jobs.get(id),
    put,
    progress,
    notify: () => publish(),
    flush: () => chain,
    stop() {
      clearTimeout(timer);
    },
  };
}
