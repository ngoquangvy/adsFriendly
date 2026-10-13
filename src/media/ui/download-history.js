import { formatBytes, isMediaJobActive } from "../download-job-view.js";

// Shared by the extension popup and the player overlay. No download/file IO
// lives in the presenter; actions remain explicit user gestures.
export function downloadHistoryView(job, exact = true) {
  if (!job) return null;
  const active = isMediaJobActive(job);
  const missing = ["missing", "changed"].includes(job.fileStatus);
  if (!active && job.status !== "completed") return null;
  return {
    active,
    missing,
    status: active ? "Downloading" : "Completed",
    detail: active
      ? exact
        ? "This selection is already downloading."
        : "Another selection is downloading."
      : missing
        ? "Saved file is missing or has changed. You can download it again."
        : job.fileStatus === "unchecked"
          ? "Downloaded recently · file not checked"
          : exact
            ? "Downloaded recently"
            : "Another selection was downloaded recently",
    size: job.progress?.totalBytes || job.progress?.downloadedBytes || 0,
    canOpen: !active && !missing && Boolean(job.outputPath),
    canRepeat: exact && !active,
  };
}

export function createDownloadHistoryCard(
  job,
  { exact = true, open, folder, repeat, options, manager } = {},
) {
  const view = downloadHistoryView(job, exact);
  if (!view) return null;
  const card = document.createElement("div");
  card.className = "media-download-history";
  card.setAttribute("role", "status");
  const status = document.createElement("strong");
  status.textContent = view.status;
  const detail = document.createElement("span");
  detail.textContent = view.detail;
  const metadata = document.createElement("span");
  metadata.textContent = [
    view.size ? formatBytes(view.size) : null,
    job.summary?.qualityLabel,
    job.summary?.profileLabel,
    job.summary?.audioLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  card.append(status, detail, metadata);
  const actions = document.createElement("div");
  actions.className = "media-download-history-actions";
  const action = (label, run) => {
    if (!run) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
      button.disabled = true;
      try {
        await run(event);
      } catch (error) {
        detail.textContent = error?.message || "Action failed. Try again.";
      } finally {
        button.disabled = false;
      }
    });
    actions.append(button);
  };
  if (view.canOpen) {
    action("Open", open);
    action("Folder", folder);
  }
  if (view.canRepeat)
    action(view.missing ? "Download" : "Download again", repeat);
  if (view.active) action("View download", manager);
  action("Change options", options);
  card.append(actions);
  return card;
}
