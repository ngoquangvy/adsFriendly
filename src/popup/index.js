import { loadSettings, saveSettings } from "../runtime/settings-store.js";
import {
  CAPABILITIES,
  getCapabilitiesForMode,
} from "../runtime/feature-catalog.js";
import {
  DOWNLOAD_JOB_PREFIX,
  getMediaDownloadAvailability,
} from "../media/download-job-contract.js";
import {
  createMediaCatalogViewSignature,
  formatMediaDetails,
  formatMediaHelperSummary,
  formatMediaName,
  getMediaCatalogDownloadState,
  helperSetupPresentation,
  selectVisibleMediaItems,
} from "../media/catalog-view.js";
import { mediaCatalogSessionKey } from "../media/storage-keys.js";

const blockedCountElement = document.getElementById("blocked-count");
const statusToggle = document.getElementById("status-toggle");
const modeSelect = document.getElementById("protection-mode-select");
const modeDescription = document.getElementById("mode-description");
const mediaCount = document.getElementById("media-count");
const mediaStatus = document.getElementById("media-status");
const mediaHelperAction = document.getElementById("media-helper-action");
const mediaList = document.getElementById("media-list");
const mediaJobList = document.getElementById("media-job-list");

const MODE_DESCRIPTIONS = Object.freeze({
  safe: "Verified rules; no predictive DOM actions",
  assist: "Detect and ask before hiding",
  auto: "Allow registered automatic actions",
});

let settings = null;
let mediaRefreshInFlight = false;
let mediaHelperStatus = {
  status: "checking",
  canDownloadDirect: false,
  canDownloadHls: false,
  canDownloadDash: false,
};
let activeMediaTabId = null;
let mediaRenderSignature = null;
let scheduledMediaRefresh = null;
initialize().catch((error) =>
  console.error("[AdsFriendly Popup] initialization failed", error),
);

statusToggle.addEventListener("change", async () => {
  settings = await saveSettings({
    ...settings,
    enabled: statusToggle.checked,
  });
  await renderMode();
  await updateMediaCatalog();
});

modeSelect.addEventListener("change", async () => {
  settings = await saveSettings({
    ...settings,
    protectionMode: modeSelect.value,
  });
  await renderMode();
  await updateMediaCatalog();
});

mediaHelperAction.addEventListener("click", async () => {
  mediaHelperAction.disabled = true;
  await setupMediaHelper(mediaHelperAction, mediaHelperStatus);
});

document.getElementById("settings-btn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document
  .getElementById("magic-wand-btn")
  .addEventListener("click", async () => {
    if (
      !settings.enabled ||
      !getCapabilitiesForMode(settings.protectionMode).includes(
        CAPABILITIES.DOM_MANUAL_PICKER,
      )
    ) {
      alert("Manual picker is disabled by the current protection policy.");
      return;
    }
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" });
      window.close();
    } catch (error) {
      console.error("Could not start picker:", error);
    }
  });

document
  .getElementById("reset-rules-btn")
  .addEventListener("click", async () => {
    const button = document.getElementById("reset-rules-btn");
    await runRuleButtonAction(button, "Resetting…", async () => {
      const tab = await getActiveHttpTab();
      if (!tab) return false;
      const hostname = new URL(tab.url).hostname;
      const { userCustomRules = {} } =
        await chrome.storage.local.get("userCustomRules");
      const selectors = (userCustomRules[hostname] || [])
        .map((rule) => (typeof rule === "string" ? rule : rule?.selector))
        .filter(Boolean);
      if (!selectors.length) return false;
      const response = await chrome.runtime.sendMessage({
        type: "REMOVE_CUSTOM_RULES",
        hostname,
        selectors,
      });
      if (response?.status !== "saved")
        throw new Error(response?.error || "Could not remove site rules.");
      await chrome.tabs.reload(tab.id);
      window.close();
    });
  });

document.getElementById("undo-btn").addEventListener("click", async () => {
  const button = document.getElementById("undo-btn");
  await runRuleButtonAction(button, "Restoring…", async () => {
    const tab = await getActiveHttpTab();
    if (!tab) return false;
    const hostname = new URL(tab.url).hostname;
    const { userCustomRules = {} } =
      await chrome.storage.local.get("userCustomRules");
    const rules = userCustomRules[hostname];
    if (!rules?.length) return false;
    const undoneRule = rules.at(-1);
    const selector =
      typeof undoneRule === "string" ? undoneRule : undoneRule?.selector;
    const response = await chrome.runtime.sendMessage({
      type: "RESTORE_CUSTOM_RULES",
      hostname,
      selectors: [selector],
    });
    if (response?.status !== "saved")
      throw new Error(response?.error || "Could not restore the last rule.");
    if (undoneRule?.fingerprint) {
      await chrome.runtime.sendMessage({
        type: "NEGATIVE_LEARNING",
        fingerprint: undoneRule.fingerprint,
      });
    }
    await chrome.tabs.reload(tab.id);
    window.close();
  });
});

async function runRuleButtonAction(button, workingText, action) {
  button.dataset.originalHtml ||= button.innerHTML;
  button.disabled = true;
  button.textContent = workingText;
  button.title = "";
  try {
    const completed = await action();
    if (completed === false) {
      button.disabled = false;
      button.innerHTML = button.dataset.originalHtml;
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = "Failed · Retry";
    button.title = error?.message || String(error);
  }
}

setInterval(updateBlockedCount, 1000);
setInterval(updateMediaCatalog, 10_000);
chrome.storage.onChanged.addListener(onMediaStorageChanged);

async function initialize() {
  settings = await loadSettings();
  await render();
}

async function render() {
  statusToggle.checked = settings.enabled;
  modeSelect.value = settings.protectionMode;
  await updateBlockedCount();
  await renderMode();
  await updateMediaJobs();
  const tab = await getActiveHttpTab();
  await renderMediaCatalog(tab);
  if (!tab) return;
  const hostname = new URL(tab.url).hostname;
  const { userCustomRules = {} } =
    await chrome.storage.local.get("userCustomRules");
  document.getElementById("undo-section").style.display =
    userCustomRules[hostname]?.length > 0 ? "block" : "none";
}

async function renderMode() {
  modeSelect.disabled = !settings.enabled;
  modeDescription.textContent = settings.enabled
    ? MODE_DESCRIPTIONS[settings.protectionMode]
    : "All protection features are disabled";
}

async function updateBlockedCount() {
  const { blockedCount = 0 } = await chrome.storage.local.get("blockedCount");
  blockedCountElement.textContent = blockedCount;
}

async function updateMediaCatalog() {
  if (!settings || mediaRefreshInFlight) return;
  mediaRefreshInFlight = true;
  try {
    await renderMediaCatalog(await getActiveHttpTab());
  } finally {
    mediaRefreshInFlight = false;
  }
}

async function renderMediaCatalog(tab) {
  activeMediaTabId = tab?.id ?? null;
  if (!settings.enabled) {
    commitMediaCatalog({
      status: "Protection is off; media observation is paused.",
    });
    return;
  }
  if (settings.protectionMode === "safe") {
    commitMediaCatalog({
      status: "Switch to Assist or Auto, then reload the video page.",
    });
    return;
  }
  if (!tab) {
    commitMediaCatalog({
      status: "Open an HTTP video page to test detection.",
    });
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_MEDIA_CATALOG",
      tabId: tab.id,
      pageUrl: tab.url,
    });
    const items = Array.isArray(response?.items) ? response.items : [];
    if (!items.length) {
      commitMediaCatalog({
        tab,
        status:
          response?.status === "capability_disabled"
            ? "Media observation is still starting. Reload the page once."
            : "No MP4, WebM, HLS, or DASH source detected yet.",
      });
      return;
    }
    mediaHelperStatus = await readMediaHelperStatus();
    const downloadState = getMediaCatalogDownloadState(items);
    commitMediaCatalog({
      tab,
      status: formatMediaHelperSummary(mediaHelperStatus, downloadState),
      items,
      helper: mediaHelperStatus,
    });
  } catch (error) {
    setText(mediaStatus, "Could not refresh media · showing previous results.");
    console.debug("[AdsFriendly Popup] Media catalog unavailable", error);
  }
}

function commitMediaCatalog({ status, items = [], tab = null, helper = null }) {
  const visibleItems = selectVisibleMediaItems(items);
  const downloadState = getMediaCatalogDownloadState(items);
  const signature = createMediaCatalogViewSignature({
    tabId: tab?.id ?? null,
    status,
    helper,
    items: visibleItems,
  });

  setText(mediaCount, String(visibleItems.length));
  setText(mediaStatus, status);
  renderMediaHelperAction(helper, downloadState);
  if (signature === mediaRenderSignature) return;

  const fragment = document.createDocumentFragment();
  const itemsById = new Map(items.map((item) => [item.id, item]));
  for (const item of visibleItems) {
    fragment.append(createMediaItem(item, tab, helper, itemsById));
  }
  mediaList.replaceChildren(fragment);
  mediaList.hidden = visibleItems.length === 0;
  mediaRenderSignature = signature;
}

function renderMediaHelperAction(helper, downloadState) {
  const presentation = helperSetupPresentation(helper, {
    hasDownloadableMedia: downloadState.downloadableCount > 0,
  });
  mediaHelperAction.hidden = !presentation;
  if (!presentation) return;
  mediaHelperAction.disabled = false;
  mediaHelperAction.textContent = presentation.label;
  mediaHelperAction.title = presentation.title;
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function onMediaStorageChanged(changes, areaName) {
  if (areaName !== "session") return;
  if (Object.keys(changes).some((key) => key.startsWith(DOWNLOAD_JOB_PREFIX))) {
    void updateMediaJobs();
  }
  if (!Number.isInteger(activeMediaTabId)) return;
  const key = mediaCatalogSessionKey(activeMediaTabId);
  if (!(key in changes)) return;
  clearTimeout(scheduledMediaRefresh);
  scheduledMediaRefresh = setTimeout(() => {
    scheduledMediaRefresh = null;
    updateMediaCatalog();
  }, 120);
}

function createMediaItem(item, tab, helper, itemsById) {
  const row = document.createElement("div");
  row.className = "media-item";
  const kind = document.createElement("span");
  kind.className = "media-kind";
  kind.textContent = String(item.kind || "media").toUpperCase();
  const copy = document.createElement("div");
  copy.className = "media-copy";
  const name = document.createElement("span");
  name.className = "media-name";
  const sourceUrl =
    item.resolvedStream?.manifestUrl ||
    item.resolvedStream?.sourceUrl ||
    item.manifestUrl ||
    item.sourceUrl ||
    "";
  name.textContent = formatMediaName(item);
  name.title = sourceUrl;
  const details = document.createElement("span");
  details.className = "media-details";
  details.textContent = formatMediaDetails(item);
  copy.append(name, details);
  row.append(kind, copy);
  if (
    ["direct", "hls", "dash"].includes(item.kind) ||
    (item.kind === "blob" && item.selectedMediaId)
  ) {
    const downloadItem = itemsById.get(item.selectedMediaId) || item;
    row.append(createMediaDownloadButton(item, downloadItem, tab, helper));
  }
  return row;
}

function createMediaDownloadButton(item, downloadItem, tab, helper) {
  const availability = getMediaDownloadAvailability(downloadItem);
  const button = document.createElement("button");
  button.className = "media-download";
  const presentation = downloadButtonPresentation(
    availability,
    helper,
    downloadItem,
  );
  button.disabled = presentation.disabled;
  button.textContent = presentation.label;
  button.title = presentation.title;
  button.addEventListener("click", async () => {
    button.disabled = true;
    if (helper.status !== "ready" || !helperCanDownload(downloadItem, helper)) {
      await setupMediaHelper(button, helper);
      return;
    }
    button.textContent = "Starting…";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "CREATE_MEDIA_DOWNLOAD_JOB",
        tabId: tab.id,
        mediaId: downloadItem.id,
      });
      if (response?.status !== "started")
        throw new Error(
          response?.reason ||
            response?.error ||
            "Could not start the helper download job.",
        );
      button.textContent = "Started";
      await updateMediaJobs();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Retry";
      button.title = error?.message || String(error);
    }
  });
  return button;
}

function downloadButtonPresentation(availability, helper, item) {
  if (!availability.supported) {
    return {
      disabled: true,
      label: downloadUnavailableLabel(availability.reason),
      title: availability.reason,
    };
  }
  if (helper.status === "permission_required") {
    return {
      disabled: false,
      label: "Set up",
      title: "Enable the optional Media Helper connection to download video.",
    };
  }
  if (helper.status === "not_installed") {
    return {
      disabled: false,
      label: "Install",
      title: "Media Helper is required for video downloads.",
    };
  }
  if (helper.status === "ready" && !helperCanDownload(item, helper)) {
    return {
      disabled: true,
      label: "Helper update",
      title: `The installed Media Helper does not support ${item.kind.toUpperCase()} downloads yet.`,
    };
  }
  if (helper.status !== "ready") {
    return {
      disabled: false,
      label: "Retry",
      title: helper.error || "Could not connect to Media Helper.",
    };
  }
  return {
    disabled: false,
    label: "Download",
    title: "Download with AdsFriendly Media Helper.",
  };
}

function helperCanDownload(item, helper) {
  if (item.kind === "direct") return helper.canDownloadDirect === true;
  if (item.kind === "hls") return helper.canDownloadHls === true;
  return helper.canDownloadDash === true;
}

async function setupMediaHelper(button, helper) {
  try {
    if (helper.status === "permission_required") {
      button.textContent = "Allowing…";
      const granted = await chrome.permissions.request({
        permissions: ["nativeMessaging"],
      });
      if (!granted) {
        button.disabled = false;
        button.textContent = "Allow helper connection";
        button.title = "Media Helper permission was not granted.";
        return;
      }
    } else if (helper.status === "not_installed") {
      alert(
        "AdsFriendly Media Helper is not installed or registered. Install the Windows helper, then reopen this popup.",
      );
      button.disabled = false;
      button.textContent = "Install";
      return;
    }
    button.textContent = "Checking…";
    mediaHelperStatus = await readMediaHelperStatus(true);
    await renderMediaCatalog(await getActiveHttpTab());
  } catch (error) {
    button.disabled = false;
    button.textContent = "Retry";
    button.title = error?.message || String(error);
  }
}

async function readMediaHelperStatus(force = false) {
  const response = await chrome.runtime.sendMessage({
    type: "GET_MEDIA_HELPER_STATUS",
    force,
  });
  return response?.status
    ? response
    : {
        status: "unavailable",
        canDownloadDirect: false,
        canDownloadHls: false,
        canDownloadDash: false,
        error: response?.error || "Could not read Media Helper status.",
      };
}

async function updateMediaJobs() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_MEDIA_DOWNLOAD_JOBS",
    });
    renderMediaJobs(Array.isArray(response?.items) ? response.items : []);
  } catch (error) {
    console.debug("[AdsFriendly Popup] Download jobs unavailable", error);
  }
}

function renderMediaJobs(items) {
  const visible = items.slice(0, 4);
  const existing = new Map(
    [...mediaJobList.children].map((row) => [row.dataset.jobId, row]),
  );
  const visibleIds = new Set();
  for (const item of visible) {
    visibleIds.add(item.id);
    const row = existing.get(item.id) || createMediaJobItem();
    updateMediaJobItem(row, item);
    mediaJobList.append(row);
  }
  for (const [jobId, row] of existing) {
    if (!visibleIds.has(jobId)) row.remove();
  }
  mediaJobList.hidden = visible.length === 0;
}

function createMediaJobItem() {
  const row = document.createElement("div");
  row.className = "media-job";
  const copy = document.createElement("div");
  copy.className = "media-job-copy";
  const label = document.createElement("span");
  label.className = "media-name media-job-label";
  const detail = document.createElement("span");
  detail.className = "media-details media-job-detail";
  copy.append(label, detail);
  row.append(copy);
  return row;
}

function updateMediaJobItem(row, job) {
  row.dataset.jobId = job.id;
  setText(
    row.querySelector(".media-job-label"),
    job.title || String(job.kind || "media").toUpperCase(),
  );
  setText(row.querySelector(".media-job-detail"), mediaJobDetails(job));
  let cancel = row.querySelector(".media-cancel");
  if (
    ["starting", "probing", "downloading", "finalizing"].includes(job.status)
  ) {
    if (!cancel) {
      cancel = document.createElement("button");
      cancel.className = "media-download media-cancel";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", async () => {
        cancel.disabled = true;
        cancel.textContent = "Stopping…";
        await chrome.runtime.sendMessage({
          type: "CANCEL_MEDIA_DOWNLOAD_JOB",
          jobId: cancel.dataset.jobId,
        });
        await updateMediaJobs();
      });
      row.append(cancel);
    }
    cancel.dataset.jobId = job.id;
  } else {
    cancel?.remove();
  }
}

function mediaJobDetails(job) {
  if (job.status === "completed")
    return `Completed · ${job.outputPath || "saved"}`;
  if (job.status === "failed")
    return `Failed · ${job.error || "unknown error"}`;
  if (job.status === "cancelled")
    return "Cancelled · resume available on retry";
  if (job.status === "cancelling") return "Stopping…";
  const downloaded = job.progress?.downloadedBytes;
  const total = job.progress?.totalBytes;
  const processedSeconds = job.progress?.processedSeconds;
  const duration = job.progress?.duration;
  if (
    Number.isFinite(processedSeconds) &&
    Number.isFinite(duration) &&
    duration > 0
  ) {
    const percent = Math.min(
      100,
      Math.round((processedSeconds / duration) * 100),
    );
    const size = Number.isFinite(downloaded)
      ? ` · ${formatBytes(downloaded)}`
      : "";
    return `${percent}% · ${formatDuration(processedSeconds)} / ${formatDuration(duration)}${size}`;
  }
  if (Number.isFinite(downloaded) && Number.isFinite(total) && total > 0) {
    const percent = Math.min(100, Math.round((downloaded / total) * 100));
    const speed = Number.isFinite(job.progress?.bytesPerSecond)
      ? ` · ${formatBytes(job.progress.bytesPerSecond)}/s`
      : "";
    return `${percent}% · ${formatBytes(downloaded)} / ${formatBytes(total)}${speed}`;
  }
  return `${job.status || "starting"}…`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

function downloadUnavailableLabel(reason = "") {
  if (reason.includes("DRM")) return "DRM";
  if (reason.includes("Live")) return "Live";
  if (reason.includes("Encrypted")) return "Encrypted";
  if (reason.includes("waiting") || reason.includes("not exposed"))
    return "Waiting";
  if (reason.includes("no media")) return "No media";
  return "Unavailable";
}

async function getActiveHttpTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url?.startsWith("http") ? tab : null;
}
