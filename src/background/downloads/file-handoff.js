import { normalizeDownloadIntake } from "../../downloads/intake-contract.js";
import { assessDownloadIntake } from "../../downloads/intake-policy.js";
import { FILE_EXTENSIONS } from "../../downloads/file-contract.js";
import { createActionBroker } from "../../runtime/action-broker.js";
import { ACTIONS as A } from "../../runtime/action-catalog.js";
import { loadSettings } from "../../runtime/settings-store.js";
import { createFileTransferStore } from "./file-transfer-store.js";
import { prepareFileHelper } from "./file-helper-client.js";
import { sourceKey } from "./request-evidence.js";
import { runMediaHelperOutputAction } from "../media-helper-bridge.js";

// A per-download state machine. Chrome is retained paused until a verified
// Helper completion, so failure can resume the original request rather than replay it.
export function createFileHandoff({
  chrome,
  intake,
  evidence,
  prepare = (payload, onProgress, signal) =>
    prepareFileHelper(chrome, payload, onProgress, signal),
  store = createFileTransferStore(chrome),
  settings = () => loadSettings(chrome.storage.local),
  outputAction = runMediaHelperOutputAction,
}) {
  const tickets = new Map(),
    running = new Map(),
    locks = new Set(),
    sources = new Map(),
    errors = new Map();
  const checking = new Map();
  let changesAttached = false;
  let broker = null,
    ready = Promise.resolve(),
    stopped = false,
    generation = 0;
  async function getItem(id) {
    const rows = await chrome.downloads.search({ id });
    if (rows.length !== 1)
      throw Error("The Chrome download is no longer available.");
    return rows[0];
  }
  async function verify(id) {
    if (
      intake.snapshot().status !== "observing" ||
      !intake.snapshot().items.some((row) => row.id === id)
    )
      throw Error("Enable observation and start a new Chrome download first.");
    const item = await getItem(id);
    const row = normalizeDownloadIntake(item);
    if (!row || assessDownloadIntake(row).disposition !== "needs_validation")
      throw Error(
        "This source must stay in Chrome (state, safety, session URL or source type).",
      );
    if (!FILE_EXTENSIONS.includes(row.filename.split(".").pop().toLowerCase()))
      throw Error("This file type must stay in Chrome.");
    return { item, row };
  }
  function disposeTicket(id) {
    const ticket = tickets.get(id);
    if (!ticket) return;
    clearTimeout(ticket.timer);
    ticket.client.close();
    tickets.delete(id);
    if (sources.get(ticket.key) === id) sources.delete(ticket.key);
  }
  async function check({ browserId }) {
    await ready;
    if (stopped || !Number.isInteger(browserId))
      throw Error("Invalid browser download.");
    if (locks.has(browserId) || running.has(browserId))
      throw Error("This file is already being checked or transferred.");
    if (locks.size + tickets.size + running.size >= 3)
      throw Error("Finish or return a transfer before checking another file.");
    const epoch = generation;
    locks.add(browserId);
    const checkController = new AbortController();
    checking.set(browserId, checkController);
    disposeTicket(browserId);
    errors.delete(browserId);
    let reserved = null;
    try {
      const { item, row } = await verify(browserId);
      const proof = await evidence.forDownload(item);
      if (sources.has(proof.key))
        throw Error("This source is already checked or transferring.");
      reserved = proof.key;
      sources.set(proof.key, browserId);
      if (row.totalBytes !== null && row.totalBytes !== proof.size)
        throw Error("Chrome file size changed; keep it in Chrome.");
      const jobId = crypto.randomUUID(),
        config = await settings();
      const client = await prepare(
        {
          jobId,
          url: item.finalUrl || item.url,
          filename: row.filename,
          expected: { size: proof.size, etag: proof.etag, mime: proof.mime },
          connections: config.mediaDownloadConnections,
          referrer: item.referrer,
          userAgent: globalThis.navigator?.userAgent || "",
        },
        (progress) => store.progress(jobId, progress),
        checkController.signal,
      );
      if (
        epoch !== generation ||
        stopped ||
        intake.snapshot().status !== "observing"
      ) {
        client.close();
        throw Error("Browser observation was stopped.");
      }
      const ticket = {
        browserId,
        jobId,
        key: proof.key,
        checkId: crypto.randomUUID(),
        client,
        browserStartTime: item.startTime,
        filename: client.filename,
        totalBytes: proof.size,
        expiresAt: Date.now() + 30000,
        timer: null,
      };
      ticket.timer = setTimeout(() => {
        disposeTicket(browserId);
        void store.notify().catch(() => {});
      }, 30000);
      tickets.set(browserId, ticket);
      await store.notify();
      return { status: "ready_for_handoff" };
    } catch (error) {
      disposeTicket(browserId);
      if (reserved && sources.get(reserved) === browserId)
        sources.delete(reserved);
      if (epoch === generation) errors.set(browserId, safeMessage(error));
      while (errors.size > 50) errors.delete(errors.keys().next().value);
      throw error;
    } finally {
      checking.delete(browserId);
      locks.delete(browserId);
    }
  }
  async function accept({ browserId, checkId }) {
    await ready;
    if (locks.has(browserId) || running.has(browserId))
      throw Error("A transfer is already active.");
    const ticket = tickets.get(browserId);
    if (!ticket || ticket.checkId !== checkId || ticket.expiresAt < Date.now())
      throw Error("The file check expired. Check again.");
    if (ticket.client.isReady?.() === false) {
      disposeTicket(browserId);
      throw Error(
        "Helper disconnected. Check the file again before transferring.",
      );
    }
    locks.add(browserId);
    const epoch = generation;
    let pauseAttempted = false;
    function requireCurrentCheck() {
      if (
        stopped ||
        epoch !== generation ||
        intake.snapshot().status !== "observing" ||
        tickets.get(browserId) !== ticket ||
        ticket.client.isReady?.() === false
      )
        throw Error("File handoff was stopped. Keep this download in Chrome.");
    }
    try {
      const { item } = await verify(browserId);
      if (!changesAttached) {
        try {
          chrome.downloads.onChanged.addListener(onChanged);
          changesAttached = true;
        } catch {
          throw Error(
            "Chrome download changes cannot be monitored; keep the file in Chrome.",
          );
        }
      }
      if (
        item.startTime !== ticket.browserStartTime ||
        (await sourceKey(item.finalUrl || item.url)) !== ticket.key
      )
        throw Error("The Chrome source changed. Check it again.");
      // Journal first; a worker restart can restore only this explicitly owned pause.
      const job = {
        id: ticket.jobId,
        browserId,
        sourceKey: ticket.key,
        browserStartTime: item.startTime,
        filename: ticket.filename,
        totalBytes: ticket.totalBytes,
        createdAt: Date.now(),
        status: "pause_requested",
        ownedPause: true,
      };
      await store.put(job);
      requireCurrentCheck();
      pauseAttempted = true;
      await chrome.downloads.pause(browserId);
      requireCurrentCheck();
      const after = await getItem(browserId);
      if (
        after.state !== "in_progress" ||
        !after.paused ||
        after.canResume !== true ||
        after.danger !== "safe"
      )
        throw Error(
          "Chrome cannot preserve a resumable fallback for this file.",
        );
      await store.put({ ...job, status: "downloading" });
      clearTimeout(ticket.timer);
      tickets.delete(browserId);
      running.set(browserId, { ticket, job, promise: null });
      const operation = finish(ticket, job);
      running.get(browserId).promise = operation;
      return { status: "transferring" };
    } catch (error) {
      disposeTicket(browserId);
      const record = store.get(ticket.jobId);
      if (pauseAttempted)
        await restoreChrome(
          record || { browserId, ...ticket },
          safeMessage(error),
        );
      else if (record?.ownedPause)
        await store.put({
          ...record,
          status: "returned_to_chrome",
          ownedPause: false,
          error: safeMessage(error),
        });
      throw error;
    } finally {
      locks.delete(browserId);
    }
  }
  async function finish(ticket, job) {
    let completed = null;
    try {
      const result = await ticket.client.start();
      if (
        result.totalBytes !== job.totalBytes ||
        typeof result.outputPath !== "string"
      )
        throw Error("Helper completion did not match the checked file.");
      completed = {
        ...job,
        status: "completed",
        ownedPause: true,
        outputPath: result.outputPath,
      };
      // Persist the verified output BEFORE discarding Chrome's fallback. Keep
      // pause ownership until cleanup is recorded, including across a restart.
      await store.put(completed);
      let warning = null;
      try {
        const current = await getItem(job.browserId);
        if (
          current.startTime !== job.browserStartTime ||
          (await sourceKey(current.finalUrl || current.url)) !== job.sourceKey
        )
          throw Error("Chrome source changed.");
        if (current.state === "in_progress" && current.paused)
          await chrome.downloads.cancel(job.browserId);
        else if (current.state === "complete")
          warning = "Chrome also completed its copy.";
      } catch {
        warning =
          "File completed. Check the original Chrome download; it could not be closed automatically.";
      }
      await store.put({
        ...completed,
        ownedPause: false,
        error: warning,
      });
    } catch (error) {
      // A storage outage must not create an unhandled background rejection.
      // restoreChrome resumes first; its in-memory record still retains output.
      await restoreChrome(completed || job, safeMessage(error)).catch(() => {});
    } finally {
      ticket.client.close();
      running.delete(job.browserId);
      sources.delete(ticket.key);
    }
  }
  async function restoreChrome(job, reason) {
    let error = reason,
      status = "returned_to_chrome";
    try {
      const item = await getItem(job.browserId);
      if (
        item.startTime !== job.browserStartTime ||
        (await sourceKey(item.finalUrl || item.url)) !== job.sourceKey
      )
        throw Error(
          "The original Chrome download identity is no longer available.",
        );
      if (item.danger !== "safe")
        throw Error("Check the download safety state in Chrome.");
      if (item.state === "in_progress" && item.paused)
        await chrome.downloads.resume(job.browserId);
      else if (item.state !== "in_progress" && item.state !== "complete")
        throw Error("Resume this download manually in Chrome.");
    } catch {
      status = "needs_browser_attention";
      error = reason + " Resume the original download manually in Chrome.";
    }
    await store.put({
      ...job,
      status:
        job.status === "completed" && job.outputPath ? "completed" : status,
      error,
      ownedPause: false,
    });
  }
  async function returnToChrome({ jobId }) {
    await ready;
    const job = store.get(jobId),
      entry = job && running.get(job.browserId);
    if (!entry) throw Error("No active file transfer was found.");
    entry.ticket.client.close();
    await entry.promise;
    return { status: "returned_to_chrome" };
  }
  async function recover() {
    await store.load();
    await Promise.all(
      store
        .list()
        .filter((row) => row.ownedPause)
        .map((row) => restoreChrome(row, "Helper connection ended.")),
    );
  }
  async function output({ jobId, action }) {
    const job = store.get(jobId);
    if (job?.status !== "completed" || !job.outputPath)
      throw Error("Completed file not found.");
    await outputAction(action, job.outputPath);
    return { status: "opened" };
  }
  function startFeature(policy) {
    stopped = false;
    ready = recover().catch(() => {});
    broker = createActionBroker({
      featureId: "background.browser-file-handoff",
      policy,
      handlers: {
        [A.BROWSER_FILE_CHECK]: check,
        [A.BROWSER_FILE_ACCEPT]: accept,
        [A.BROWSER_FILE_RETURN]: returnToChrome,
        [A.BROWSER_FILE_OPEN]: (payload) =>
          output({ ...payload, action: "open" }),
        [A.BROWSER_FILE_REVEAL]: (payload) =>
          output({ ...payload, action: "reveal" }),
      },
    });
    chrome.permissions?.onRemoved?.addListener(onPermissionRemoved);
    return async () => {
      stopped = true;
      if (changesAttached)
        chrome.downloads?.onChanged?.removeListener(onChanged);
      changesAttached = false;
      chrome.permissions?.onRemoved?.removeListener(onPermissionRemoved);
      await returnAll();
      broker = null;
      store.stop();
    };
  }
  const onChanged = (delta) => {
    const entry = running.get(delta.id);
    if (
      entry &&
      (delta.paused?.current === false ||
        delta.state?.current === "complete" ||
        delta.error?.current === "USER_CANCELED" ||
        (delta.danger?.current && delta.danger.current !== "safe"))
    )
      entry.ticket.client.close();
  };
  const onPermissionRemoved = (change) => {
    if (
      change.permissions?.some((name) =>
        ["downloads", "nativeMessaging"].includes(name),
      )
    )
      void returnAll().catch(() => {});
  };
  async function returnAll() {
    ++generation;
    errors.clear();
    for (const controller of checking.values()) controller.abort();
    for (const id of [...tickets.keys()]) disposeTicket(id);
    for (const entry of running.values()) entry.ticket.client.close();
    await Promise.allSettled(
      [...running.values()].map((entry) => entry.promise),
    );
  }
  async function snapshot() {
    await ready;
    return {
      checks: [...tickets.values()].map(
        ({ browserId, checkId, expiresAt }) => ({
          browserId,
          checkId,
          expiresAt,
        }),
      ),
      checkErrors: [...errors]
        .slice(-50)
        .map(([browserId, error]) => ({ browserId, error })),
      fileTransfers: store.list(),
    };
  }
  return {
    startFeature,
    snapshot,
    returnAll,
    execute: async (action, payload) => {
      if (!broker) return { status: "unavailable" };
      try {
        return await broker.execute(action, payload);
      } catch (error) {
        return { status: "error", error: safeMessage(error) };
      }
    },
  };
}
function safeMessage(error) {
  return String(error?.message || "File handoff failed.")
    .replace(/https?:\/\/\S+/g, "[source]")
    .slice(0, 600);
}
