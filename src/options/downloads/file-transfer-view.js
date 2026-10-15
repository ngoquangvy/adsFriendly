import { FILE_MESSAGES as M } from "../../downloads/file-contract.js";
import { formatBytes } from "../../media/download-job-view.js";
const ACTIVE = new Set(["pause_requested", "downloading", "returning"]);

// Stable keyed file rows and explicit user controls; no ownership logic.
export function createFileTransferView({
  document,
  window,
  chrome,
  refresh,
  onError,
}) {
  let disposed = false;
  function action(
    label,
    type,
    payload,
    { confirm = false, native = false } = {},
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary download-compact-action";
    button.textContent = label;
    button.onclick = async () => {
      if (disposed) return;
      if (
        confirm &&
        !window.confirm(
          "Transfer this checked file to Media Helper? Chrome will be paused as a fallback and cancelled only after Helper completes. If handoff fails, AdsFriendly will try to resume Chrome.",
        )
      )
        return;
      button.disabled = true;
      button.textContent = "Working…";
      try {
        if (
          native &&
          !(await chrome.permissions.request({
            permissions: ["nativeMessaging"],
          }))
        )
          throw Error("Helper connection permission was not granted.");
        const result = await chrome.runtime.sendMessage({ type, ...payload });
        if (
          ![
            "ready_for_handoff",
            "transferring",
            "returned_to_chrome",
            "opened",
          ].includes(result?.status)
        )
          throw Error(result?.error || "File action is unavailable.");
        if (!disposed) await refresh();
      } catch (error) {
        if (!disposed) {
          await refresh();
          onError(error);
        }
      } finally {
        if (!disposed && button.isConnected) {
          button.disabled = false;
          button.textContent = label;
        }
      }
    };
    return button;
  }
  function observation(row, item, snapshot) {
    let controls = row.querySelector(".file-check-controls");
    if (!controls) {
      controls = document.createElement("div");
      controls.className = "file-check-controls download-history-controls";
      row.append(controls);
    }
    const checked = snapshot.checks?.find(
      (check) => check.browserId === item.id,
    );
    const active = snapshot.fileTransfers?.find(
      (job) => job.browserId === item.id && ACTIVE.has(job.status),
    );
    const error = snapshot.checkErrors?.find(
      (entry) => entry.browserId === item.id,
    )?.error;
    const key = JSON.stringify([
      checked?.checkId,
      active?.id,
      item.assessment?.disposition,
      error,
    ]);
    if (controls.dataset.key === key) return;
    controls.dataset.key = key;
    controls.replaceChildren();
    if (active) {
      const text = document.createElement("small");
      text.textContent = "Managed below · Chrome retained as fallback";
      controls.append(text);
    } else if (item.assessment?.disposition === "needs_validation") {
      controls.append(
        checked
          ? action(
              "Transfer to Helper",
              M.ACCEPT,
              { browserId: item.id, checkId: checked.checkId },
              { confirm: true },
            )
          : action(
              "Check with Helper",
              M.CHECK,
              { browserId: item.id },
              { native: true },
            ),
      );
    }
    if (error) {
      const note = document.createElement("small");
      note.className = "file-transfer-error";
      note.textContent = error;
      controls.append(note);
    }
  }
  function render(snapshot) {
    const container = document.getElementById("browser-file-transfers");
    if (!container) return;
    const items = snapshot.fileTransfers || [];
    document.getElementById("browser-file-transfer-card").hidden =
      !items.length;
    const existing = new Map(
      [...container.children].map((row) => [row.dataset.jobId, row]),
    );
    const sorted = [...items].sort(
      (a, b) => Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status)),
    );
    const labels = {
      pause_requested: "Preparing handoff",
      downloading: "Downloading with Helper",
      completed: "Completed",
      returned_to_chrome: "Continued in Chrome",
      needs_browser_attention: "Check Chrome",
    };
    for (const [index, job] of sorted.entries()) {
      let row = existing.get(job.id);
      if (!row) {
        row = document.createElement("article");
        row.className = "download-history-item";
        row.dataset.jobId = job.id;
        for (const name of ["title", "details", "path", "note", "controls"]) {
          const node = document.createElement("div");
          node.className = "file-transfer-" + name;
          if (name === "path") node.classList.add("download-output-path");
          if (name === "controls")
            node.classList.add("download-history-controls");
          row.append(node);
        }
      }
      row.querySelector(".file-transfer-title").textContent = job.filename;
      const active = ACTIVE.has(job.status);
      row.querySelector(".file-transfer-details").textContent = [
        labels[job.status] || job.status,
        active
          ? `${formatBytes(job.progress?.downloadedBytes || 0)} / ${formatBytes(job.totalBytes)} · ${formatBytes(job.progress?.bytesPerSecond || 0)}/s`
          : formatBytes(job.totalBytes),
      ].join(" · ");
      const path = row.querySelector(".file-transfer-path");
      path.textContent = job.outputPath || job.error || "";
      path.title = path.textContent;
      row.querySelector(".file-transfer-note").textContent =
        job.outputPath && job.error ? job.error : "";
      const controls = row.querySelector(".file-transfer-controls");
      if (controls.dataset.status !== job.status) {
        controls.dataset.status = job.status;
        controls.replaceChildren();
        if (job.status === "downloading")
          controls.append(
            action("Return to Chrome", M.RETURN, { jobId: job.id }),
          );
        if (job.status === "completed" && job.outputPath) {
          controls.append(
            action("Open", M.OPEN, { jobId: job.id }),
            action("Folder", M.REVEAL, { jobId: job.id }),
          );
        }
      }
      if (container.children[index] !== row)
        container.insertBefore(row, container.children[index] || null);
      existing.delete(job.id);
    }
    for (const row of existing.values()) row.remove();
  }
  return {
    observation,
    render,
    stop() {
      disposed = true;
    },
  };
}
