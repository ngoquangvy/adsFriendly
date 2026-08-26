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
  getMediaDownloadEstimate,
  getMediaDownloadProfiles,
} from "../media/download-options.js";
import {
  formatCompactMediaJobDetails,
  formatBytes,
  formatMediaJobDetails,
  getMediaJobPauseAvailability,
  getMediaJobPrimaryAction,
  isMediaJobActive,
  selectCompactMediaJobs,
} from "../media/download-job-view.js";
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
const mediaManagerLink = document.getElementById("media-manager-link");

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
  canDownloadDecryptedHls: false,
  canDownloadDash: false,
  canSelectContainer: false,
};
let activeMediaTabId = null;
let mediaRenderSignature = null;
let scheduledMediaRefresh = null;
let hasMediaDownloadJobs = false;
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

mediaManagerLink.addEventListener("click", () => {
  void chrome.tabs.create({
    url: chrome.runtime.getURL("options/options.html#downloads"),
  });
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
  const tab = await getActiveHttpTab();
  await renderMediaCatalog(tab);
  await updateMediaJobs();
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
  if (
    !visibleItems.length &&
    hasMediaDownloadJobs &&
    /Open an HTTP video page|No MP4, WebM, HLS, or DASH/i.test(status)
  ) {
    status = "No media on this tab · downloads remain available below.";
  }
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
  const actions = document.createElement("div");
  actions.className = "media-actions";
  if (
    ["direct", "hls", "dash"].includes(item.kind) ||
    (item.kind === "blob" && item.selectedMediaId)
  ) {
    const downloadItem = itemsById.get(item.selectedMediaId) || item;
    actions.append(createMediaDownloadControl(item, downloadItem, tab, helper));
  }
  const debugMediaId = debugCaptureMediaId(item);
  if (tab && debugMediaId)
    actions.append(createManifestSaveButton(item, tab, debugMediaId));
  if (actions.childElementCount) row.append(actions);
  return row;
}

function debugCaptureMediaId(item) {
  const handoff = item.resolvedStream?.manifestHandoff || item.manifestHandoff;
  if (Number(handoff?.expiresAt) > Date.now()) return null;
  const diagnostic =
    item.resolutionDiagnostic?.probeDiagnostic || item.probeDiagnostic;
  return [
    "manifest_parsed_no_stream",
    "manifest_parsed_zero_segments",
    "manifest_unsupported",
    "manifest_parse_failed",
    "decrypted_manifest_no_stream",
    "decrypted_manifest_zero_segments",
    "decrypted_manifest_unsupported",
    "decrypted_manifest_parse_failed",
  ].includes(diagnostic?.code)
    ? diagnostic.mediaId
    : null;
}

function createManifestSaveButton(item, tab, mediaId) {
  const button = document.createElement("button");
  button.className = "media-download media-debug-save";
  button.textContent = "Save manifest";
  button.title =
    "Save the temporary unresolved manifest locally for debugging.";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_MEDIA_DEBUG_MANIFEST",
        tabId: tab.id,
        mediaId,
      });
      if (response?.status !== "found" || !response.capture?.body)
        throw new Error("Temporary manifest expired. Reload the video page.");
      saveDebugManifestFile(response.capture, item);
      button.textContent = "Saved";
    } catch (error) {
      button.disabled = false;
      button.textContent = "Retry save";
      button.title = error?.message || String(error);
    }
  });
  return button;
}

function saveDebugManifestFile(capture, item) {
  const extension = capture.kind === "dash" ? "mpd" : "m3u8";
  const hostname = safeHostname(capture.manifestUrl) || "manifest";
  const timestamp = new Date(capture.capturedAt || Date.now())
    .toISOString()
    .replaceAll(":", "-");
  const filename = sanitizeFilename(
    `adsfriendly-debug-${hostname}-${item.id}-${timestamp}.${extension}`,
  );
  const blob = new Blob([capture.body], {
    type:
      capture.kind === "dash"
        ? "application/dash+xml"
        : "application/vnd.apple.mpegurl",
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

function safeHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function sanitizeFilename(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 180);
}

function createMediaDownloadControl(item, downloadItem, tab, helper) {
  const availability = getMediaDownloadAvailability(downloadItem);
  const control = document.createElement("div");
  control.className = "media-download-control";
  const profiles = getMediaDownloadProfiles(downloadItem, {
    canSelectContainer: helper.canSelectContainer === true,
  });
  const profileSelect = document.createElement("select");
  profileSelect.className = "media-download-profile";
  profileSelect.title = "Output format";
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.label;
    option.title = profile.description;
    profileSelect.append(option);
  }
  profileSelect.disabled = !availability.supported || profiles.length < 2;
  const estimate = getMediaDownloadEstimate(downloadItem, item);
  const estimateLabel = document.createElement("span");
  estimateLabel.className = "media-download-estimate";
  estimateLabel.textContent = formatDownloadEstimate(estimate);
  estimateLabel.title = formatDownloadEstimateTitle(estimate);
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
        connections: settings?.mediaDownloadConnections ?? 8,
        output: { profileId: profileSelect.value || profiles[0]?.id },
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
  if (availability.supported) control.append(estimateLabel);
  if (availability.supported && profiles.length) control.append(profileSelect);
  control.append(button);
  return control;
}

function formatDownloadEstimate(estimate) {
  const quality = estimate.resolution?.height
    ? `${estimate.resolution.height}p`
    : "Source quality";
  const size = estimate.estimatedBytes
    ? `Est. ${formatBytes(estimate.estimatedBytes)}`
    : "Size unavailable";
  return `${quality} · ${size}`;
}

function formatDownloadEstimateTitle(estimate) {
  if (!estimate.estimatedBytes) {
    return "The manifest does not expose enough bitrate data to estimate size before download.";
  }
  return "Estimated from manifest bitrate and duration. Final file size may differ.";
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
  if (item.kind === "hls")
    return (
      helper.canDownloadHls === true &&
      (item.probeSource !== "decrypted_blob" ||
        helper.canDownloadDecryptedHls === true)
    );
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
    await updateMediaJobs();
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
        canDownloadDecryptedHls: false,
        canDownloadDash: false,
        canSelectContainer: false,
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
  const visible = selectCompactMediaJobs(items, 3);
  hasMediaDownloadJobs = visible.length > 0;
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
  mediaManagerLink.hidden = visible.length === 0;
  if (
    visible.length &&
    mediaCount.textContent === "0" &&
    /Open an HTTP video page|No MP4, WebM, HLS, or DASH/i.test(
      mediaStatus.textContent,
    )
  ) {
    setText(
      mediaStatus,
      "No media on this tab · downloads remain available below.",
    );
  }
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
  const actions = document.createElement("div");
  actions.className = "media-job-actions";
  const errorDetails = document.createElement("pre");
  errorDetails.className = "media-job-error";
  errorDetails.hidden = true;
  copy.append(label, detail);
  row.append(copy, actions, errorDetails);
  return row;
}

function updateMediaJobItem(row, job) {
  row.dataset.jobId = job.id;
  const active = isMediaJobActive(job);
  row.classList.toggle("media-job-terminal", !active);
  setText(
    row.querySelector(".media-job-label"),
    job.title || String(job.kind || "media").toUpperCase(),
  );
  const detail = row.querySelector(".media-job-detail");
  setText(
    detail,
    active ? formatMediaJobDetails(job) : formatCompactMediaJobDetails(job),
  );
  detail.className = `media-details media-job-detail media-job-status-${
    job.status || "unknown"
  }`;
  detail.title = active ? "" : job.error || job.outputPath || "";
  const action = getMediaJobPrimaryAction(job);
  const pauseAvailability = getMediaJobPauseAvailability(job);
  const actions = row.querySelector(".media-job-actions");
  actions.replaceChildren();
  const errorDetails = row.querySelector(".media-job-error");
  const hasError = job.status === "failed" && Boolean(job.error);
  const errorExpanded = hasError && row.dataset.errorExpanded === "true";
  errorDetails.textContent = hasError ? job.error : "";
  errorDetails.hidden = !errorExpanded;
  if (action) {
    actions.append(
      createMediaJobAction(job, {
        label: action.label,
        messageType: action.messageType,
        actionType: action.type,
        title:
          action.type === "cancel" && pauseAvailability?.supported === false
            ? `${pauseAvailability.reason} Cancel is still available.`
            : "",
        danger: action.type === "cancel",
      }),
    );
  }
  if (job.status === "completed" && job.outputPath) {
    const outputActionsReady =
      mediaHelperStatus?.capabilities?.["output.open"] === true &&
      mediaHelperStatus?.capabilities?.["output.reveal"] === true;
    const open = createMediaJobAction(job, {
      label: "Open",
      messageType: "OPEN_MEDIA_DOWNLOAD_OUTPUT",
      actionType: "output",
      title: "Open downloaded video",
    });
    const folder = createMediaJobAction(job, {
      label: "Folder",
      messageType: "REVEAL_MEDIA_DOWNLOAD_OUTPUT",
      actionType: "output",
      title: "Open file location",
    });
    open.disabled = !outputActionsReady;
    folder.disabled = !outputActionsReady;
    if (!outputActionsReady) {
      open.title = folder.title =
        "Media Helper output actions are unavailable.";
    }
    actions.append(open, folder);
  }
  if (hasError) {
    const toggle = createLocalMediaJobAction(
      errorExpanded ? "Hide" : "Details",
      () => {
        const expanded = row.dataset.errorExpanded !== "true";
        row.dataset.errorExpanded = String(expanded);
        errorDetails.hidden = !expanded;
        toggle.textContent = expanded ? "Hide" : "Details";
        toggle.setAttribute("aria-expanded", String(expanded));
      },
    );
    toggle.setAttribute("aria-expanded", String(errorExpanded));
    const copy = createLocalMediaJobAction("Copy", async () => {
      await copyText(job.error);
      const original = copy.textContent;
      copy.textContent = "Copied";
      setTimeout(() => {
        copy.textContent = original;
      }, 1200);
    });
    actions.append(toggle, copy);
  }
}

function createLocalMediaJobAction(label, action) {
  const button = document.createElement("button");
  button.className = "media-download media-job-action";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    try {
      await action();
    } catch (error) {
      button.title = error?.message || String(error);
      button.textContent = "Failed";
    }
  });
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

function createMediaJobAction(
  job,
  { label, messageType, actionType, title = "", danger = false },
) {
  const button = document.createElement("button");
  button.className = "media-download media-job-action";
  button.classList.toggle("media-cancel", danger);
  button.textContent = label;
  button.title = title;
  button.dataset.jobId = job.id;
  button.dataset.messageType = messageType;
  button.dataset.actionType = actionType;
  button.addEventListener("click", () => runMediaJobAction(button));
  return button;
}

async function runMediaJobAction(button) {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent =
    button.dataset.actionType === "pause"
      ? "Pausing…"
      : button.dataset.actionType === "cancel"
        ? "Stopping…"
        : button.dataset.actionType === "output"
          ? "…"
          : "Starting…";
  try {
    const response = await chrome.runtime.sendMessage({
      type: button.dataset.messageType,
      jobId: button.dataset.jobId,
      connections: settings?.mediaDownloadConnections ?? 8,
    });
    if (
      !["started", "pausing", "cancelling", "opened"].includes(response?.status)
    ) {
      throw new Error(
        response?.reason || response?.error || "Job action failed.",
      );
    }
    if (response.status === "opened") button.textContent = originalLabel;
    await updateMediaJobs();
  } catch (error) {
    button.disabled = false;
    button.textContent =
      button.dataset.actionType === "output" ? originalLabel : "Retry action";
    button.title = error?.message || String(error);
  }
}

function downloadUnavailableLabel(reason = "") {
  if (reason.includes("DRM") || reason.includes("Playback only"))
    return "Playback only";
  if (reason.includes("Live")) return "Live";
  if (reason.includes("Encrypted")) return "Encrypted";
  if (
    reason.includes("waiting") ||
    reason.includes("not exposed") ||
    reason.includes("player-resolved")
  )
    return "Watching";
  if (reason.includes("no media")) return "No media";
  return "Unavailable";
}

async function getActiveHttpTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url?.startsWith("http") ? tab : null;
}
