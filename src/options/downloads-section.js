import {
  createDownloadHistoryList,
  isActiveDownload,
} from "./downloads/history-list.js";

// One instance per Settings document. Owns subscriptions/actions, never protection policy.
export function createDownloadsSection({
  document,
  window,
  chrome,
  isActive,
  updateFilters,
  saveConnections,
  onError,
}) {
  const $ = (id) => document.getElementById(id);
  const confirm = (message) => window.confirm(message);
  let disposed = false;
  let downloadRenderRevision = 0;
  let downloadRefreshTimer = null;
  const bindings = [];
  const historyList = createDownloadHistoryList({
    document,
    window,
    actionButton: downloadActionButton,
  });

  function bind() {
    if (disposed || bindings.length) return;
    for (const [id, event, action] of [
      ["btn-download-refresh", "click", renderDownloads],
      ["btn-download-clear", "click", clearDownloadHistory],
      [
        "media-download-connections",
        "change",
        () =>
          saveConnections(Number($("media-download-connections").value || 8)),
      ],
    ]) {
      const handler = () => {
        if (!disposed)
          void Promise.resolve()
            .then(() => {
              if (!disposed) return action();
            })
            .catch(onError);
      };
      $(id).addEventListener(event, handler);
      bindings.push(() => $(id).removeEventListener(event, handler));
    }
  }

  function scheduleDownloadRefresh() {
    if (!isActive() || disposed) return;
    if (downloadRefreshTimer) return;
    downloadRefreshTimer = setTimeout(() => {
      downloadRefreshTimer = null;
      if (isActive()) void renderDownloads();
    }, 250);
  }

  async function renderDownloads() {
    if (!isActive() || disposed) return;
    const revision = ++downloadRenderRevision;
    const container = $("download-job-manager");
    const status = $("download-manager-status");
    if (!container || !status) return;
    try {
      const [jobsResponse, helper] = await Promise.all([
        chrome.runtime.sendMessage({ type: "GET_MEDIA_DOWNLOAD_JOBS" }),
        chrome.runtime.sendMessage({ type: "GET_MEDIA_HELPER_STATUS" }),
      ]);
      if (revision !== downloadRenderRevision || !isActive() || disposed)
        return;
      const jobs = Array.isArray(jobsResponse?.items) ? jobsResponse.items : [];
      const activeCount = jobs.filter((job) =>
        [
          "starting",
          "probing",
          "downloading",
          "finalizing",
          "pausing",
          "cancelling",
        ].includes(job.status),
      ).length;
      status.textContent = `${jobs.length} jobs · ${activeCount} active · ${
        helper?.status === "ready"
          ? `Media Helper ${helper.helperVersion || "ready"}`
          : "Media Helper unavailable"
      }`;
      status.style.color = helper?.status === "ready" ? "#94a3b8" : "#f59e0b";
      $("btn-download-clear").disabled = !jobs.some(
        (job) => !isActiveDownload(job),
      );
      historyList.render(jobs, helper);
      updateFilters();
    } catch (error) {
      if (disposed || !isActive() || revision !== downloadRenderRevision)
        return;
      status.textContent = `Downloads unavailable · ${error.message}`;
      status.style.color = "#f87171";
    }
  }

  function downloadActionButton(
    label,
    messageType,
    jobId,
    { danger = false, compact = false } = {},
  ) {
    const button = document.createElement("button");
    button.className = danger
      ? "btn-secondary download-danger"
      : "btn-secondary";
    if (compact) button.classList.add("download-compact-action");
    button.textContent = label;
    button.onclick = async () => {
      if (disposed) return;
      if (
        messageType === "REMOVE_MEDIA_DOWNLOAD_HISTORY" &&
        !confirm("Remove this history entry? The downloaded file will be kept.")
      )
        return;
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "Working…";
      try {
        const response = await chrome.runtime.sendMessage({
          type: messageType,
          jobId,
          connections: Number($("media-download-connections").value || 8),
        });
        if (
          !["started", "pausing", "cancelling", "opened", "removed"].includes(
            response?.status,
          )
        )
          throw new Error(
            response?.reason || response?.error || "Download action failed.",
          );
        await renderDownloads();
      } catch (error) {
        if (disposed) return;
        $("download-manager-status").textContent =
          `Action failed · ${error.message}`;
        $("download-manager-status").style.color = "#f87171";
      } finally {
        // Open/Folder do not change the job status, so the row keeps its nodes.
        // Restore the button even when a successful action did not rebuild it.
        if (!disposed && button.isConnected) {
          button.disabled = false;
          button.textContent = original;
        }
      }
    };
    return button;
  }

  async function clearDownloadHistory() {
    if (
      !confirm(
        "Clear all finished download history? Downloaded files will be kept.",
      )
    )
      return;
    const response = await chrome.runtime.sendMessage({
      type: "CLEAR_MEDIA_DOWNLOAD_HISTORY",
    });
    if (response?.status !== "removed") {
      $("download-manager-status").textContent =
        `Could not clear history · ${response?.reason || response?.error || "unknown error"}`;
      $("download-manager-status").style.color = "#f87171";
      return;
    }
    await renderDownloads();
  }

  function stop() {
    disposed = true;
    ++downloadRenderRevision;
    clearTimeout(downloadRefreshTimer);
    for (const unbind of bindings.splice(0)) unbind();
  }

  return {
    bind,
    render: renderDownloads,
    scheduleRefresh: scheduleDownloadRefresh,
    updateViewport: historyList.updateViewport,
    stop,
  };
}
