import {
  formatMediaJobDetails,
  formatBytes,
  formatMediaJobStage,
  getMediaJobPauseAvailability,
  getMediaJobPrimaryAction,
  getMediaJobProgress,
} from "../../media/download-job-view.js";

export function isActiveDownload(job) {
  return [
    "starting",
    "probing",
    "downloading",
    "finalizing",
    "pausing",
    "cancelling",
  ].includes(job.status);
}

// Owns rows, focus/error expansion and viewport only. No Chrome/storage/native IO.
export function createDownloadHistoryList({ document, window, actionButton }) {
  const $ = (id) => document.getElementById(id);
  const navigator = window.navigator;
  const DOWNLOAD_HISTORY_VISIBLE_ITEMS = 15;
  const getComputedStyle = (node) => window.getComputedStyle(node);

  function render(jobs, helper) {
    const container = $("download-job-manager");
    if (!jobs.length) {
      const empty = document.createElement("div");
      empty.className = "empty-msg";
      empty.textContent = "No download history yet.";
      container.replaceChildren(empty);
      updateDownloadHistoryViewport(container);
      return;
    }
    container.querySelector(".empty-msg")?.remove();
    const existing = new Map(
      [...container.querySelectorAll(".download-history-item")].map((row) => [
        row.dataset.jobId,
        row,
      ]),
    );
    const visibleIds = new Set();
    const sorted = [...jobs].sort(
      (a, b) => Number(isActiveDownload(b)) - Number(isActiveDownload(a)),
    );
    for (const [index, job] of sorted.entries()) {
      visibleIds.add(job.id);
      const row = existing.get(job.id) || createDownloadHistoryItem();
      updateDownloadHistoryItem(row, job, helper);
      if (container.children[index] !== row)
        container.insertBefore(row, container.children[index] || null);
    }
    for (const [jobId, row] of existing)
      if (!visibleIds.has(jobId)) row.remove();
  }

  function updateDownloadHistoryViewport(container) {
    const rows = [
      ...container.querySelectorAll(".download-history-item"),
    ].filter((row) => !row.hidden);
    const scrollable = rows.length > DOWNLOAD_HISTORY_VISIBLE_ITEMS;
    container.classList.toggle("is-scrollable", scrollable);
    if (!scrollable) {
      container.style.removeProperty("max-height");
      return;
    }
    const visibleRows = rows.slice(0, DOWNLOAD_HISTORY_VISIBLE_ITEMS);
    const styles = getComputedStyle(container);
    const gap = Number.parseFloat(styles.rowGap || styles.gap) || 0;
    const height = visibleRows.reduce(
      (total, row) => total + row.getBoundingClientRect().height,
      gap * (visibleRows.length - 1),
    );
    container.style.maxHeight = `${Math.ceil(Math.min(height, window.innerHeight * 0.65))}px`;
  }

  function createDownloadHistoryItem() {
    const row = document.createElement("article");
    row.className = "download-history-item";
    const header = document.createElement("div");
    header.className = "download-history-header";
    const title = document.createElement("div");
    title.className = "download-history-title";
    const badge = document.createElement("span");
    badge.className = "download-status";
    header.append(title, badge);

    const progressTrack = document.createElement("div");
    progressTrack.className = "download-progress-track";
    const progressBar = document.createElement("div");
    progressBar.className = "download-progress-bar";
    progressTrack.append(progressBar);

    const details = document.createElement("div");
    details.className = "download-history-details";
    const output = document.createElement("div");
    output.className = "download-output-path";
    const errorDetails = document.createElement("pre");
    errorDetails.className = "download-error-details";
    errorDetails.hidden = true;

    const controls = document.createElement("div");
    controls.className = "download-history-controls";
    row.append(header, progressTrack, details, output, errorDetails, controls);
    return row;
  }

  function updateDownloadHistoryItem(row, job, helper) {
    row.dataset.jobId = job.id;
    row.dataset.status = job.status;
    row.dataset.searchText = [job.title, job.outputPath]
      .filter(Boolean)
      .join(" ");
    const active = isActiveDownload(job);
    row.classList.toggle("is-terminal", !active);
    const title = row.querySelector(".download-history-title");
    title.textContent =
      job.title || `${String(job.kind || "media").toUpperCase()} download`;
    title.title =
      job.outputPath ||
      job.candidate?.manifestUrl ||
      job.candidate?.sourceUrl ||
      "";
    const badge = row.querySelector(".download-status");
    badge.className = `download-status download-status-${job.status || "unknown"}`;
    badge.textContent = String(job.status || "unknown").toUpperCase();
    const progress = getMediaJobProgress(job);
    const progressTrack = row.querySelector(".download-progress-track");
    progressTrack.hidden = !active;
    row.querySelector(".download-progress-bar").style.width =
      `${progress.percent ?? 0}%`;
    const details = row.querySelector(".download-history-details");
    const completedSize =
      job.status === "completed" ? progress.totalBytes : null;
    details.hidden = !active && !completedSize;
    details.textContent = active
      ? formatMediaJobDetails(job)
      : completedSize
        ? [formatBytes(completedSize), job.downloadSummary?.qualityLabel]
            .filter(Boolean)
            .join(" · ")
        : "";
    const output = row.querySelector(".download-output-path");
    output.textContent =
      job.outputPath ||
      job.error ||
      (active ? formatMediaJobStage(job) : "No output file");
    output.title = output.textContent;
    const errorDetails = row.querySelector(".download-error-details");
    const hasError = job.status === "failed" && Boolean(job.error);
    const errorExpanded = hasError && row.dataset.errorExpanded === "true";
    errorDetails.textContent = hasError ? job.error : "";
    errorDetails.hidden = !errorExpanded;
    const controls = row.querySelector(".download-history-controls");
    const controlsKey = JSON.stringify([
      job.status,
      Boolean(job.outputPath),
      job.error,
      errorExpanded,
      job.historyOnly,
      job.progress?.resumable,
      helper?.capabilities?.["output.open"],
      helper?.capabilities?.["output.reveal"],
    ]);
    if (row.dataset.controlsKey === controlsKey) return;
    row.dataset.controlsKey = controlsKey;
    controls.replaceChildren();
    const primary = getMediaJobPrimaryAction(job);
    const pauseAvailability = getMediaJobPauseAvailability(job);
    if (pauseAvailability && !pauseAvailability.supported) {
      const unavailable = document.createElement("button");
      unavailable.className = "btn-secondary download-unavailable";
      unavailable.textContent = pauseAvailability.label;
      unavailable.title = pauseAvailability.reason;
      unavailable.disabled = true;
      controls.append(unavailable);
    }
    if (primary) {
      controls.append(
        actionButton(primary.label, primary.messageType, job.id, {
          danger: primary.type === "cancel",
          compact: !active,
        }),
      );
    }
    if (job.status === "completed" && job.outputPath) {
      const outputActionsReady =
        helper?.capabilities?.["output.open"] === true &&
        helper?.capabilities?.["output.reveal"] === true;
      const open = actionButton("Open", "OPEN_MEDIA_DOWNLOAD_OUTPUT", job.id, {
        compact: true,
      });
      const reveal = actionButton(
        "Folder",
        "REVEAL_MEDIA_DOWNLOAD_OUTPUT",
        job.id,
        { compact: true },
      );
      reveal.title = "Open file location";
      open.disabled = !outputActionsReady;
      reveal.disabled = !outputActionsReady;
      if (!outputActionsReady) {
        open.title = reveal.title =
          "Update Media Helper to use output actions.";
      }
      controls.append(open, reveal);
    }
    if (hasError) {
      const toggle = localDownloadButton(
        errorExpanded ? "Hide details" : "Show details",
        () => {
          const expanded = row.dataset.errorExpanded !== "true";
          row.dataset.errorExpanded = String(expanded);
          errorDetails.hidden = !expanded;
          toggle.textContent = expanded ? "Hide details" : "Show details";
          toggle.setAttribute("aria-expanded", String(expanded));
        },
      );
      toggle.setAttribute("aria-expanded", String(errorExpanded));
      const copy = localDownloadButton("Copy error", async () => {
        await copyText(job.error);
        const original = copy.textContent;
        copy.textContent = "Copied";
        window.setTimeout(() => {
          copy.textContent = original;
        }, 1200);
      });
      controls.append(toggle, copy);
    }
    if (
      ![
        "starting",
        "probing",
        "downloading",
        "finalizing",
        "pausing",
        "cancelling",
      ].includes(job.status)
    ) {
      controls.append(
        actionButton("Remove", "REMOVE_MEDIA_DOWNLOAD_HISTORY", job.id, {
          danger: true,
          compact: true,
        }),
      );
    }
  }

  function localDownloadButton(label, action) {
    const button = document.createElement("button");
    button.className = "btn-secondary download-compact-action";
    button.type = "button";
    button.textContent = label;
    button.onclick = async () => {
      try {
        await action();
      } catch (error) {
        $("download-manager-status").textContent =
          `Action failed · ${error.message}`;
        $("download-manager-status").style.color = "#f87171";
      }
    };
    return button;
  }

  async function copyText(value) {
    const text = String(value || "");
    if (!text) throw new Error("No error details to copy.");
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Could not copy the error details.");
  }

  return {
    render,
    updateViewport: () =>
      updateDownloadHistoryViewport($("download-job-manager")),
  };
}
