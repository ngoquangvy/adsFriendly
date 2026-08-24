import { loadSettings, saveSettings } from "../runtime/settings-store.js";
import {
  CAPABILITIES,
  getCapabilitiesForMode,
} from "../runtime/feature-catalog.js";
import { getMediaDownloadAvailability } from "../media/download-job-contract.js";
import {
  createMediaCatalogViewSignature,
  selectVisibleMediaItems,
} from "../media/catalog-view.js";
import { mediaCatalogSessionKey } from "../media/storage-keys.js";

const blockedCountElement = document.getElementById("blocked-count");
const statusToggle = document.getElementById("status-toggle");
const modeSelect = document.getElementById("protection-mode-select");
const modeDescription = document.getElementById("mode-description");
const mediaCount = document.getElementById("media-count");
const mediaStatus = document.getElementById("media-status");
const mediaList = document.getElementById("media-list");

const MODE_DESCRIPTIONS = Object.freeze({
  safe: "Verified rules; no predictive DOM actions",
  assist: "Detect and ask before hiding",
  auto: "Allow registered automatic actions",
});

let settings = null;
let mediaRefreshInFlight = false;
let mediaHelperStatus = { status: "checking", canDownloadHls: false };
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
    commitMediaCatalog({
      tab,
      status: helperSummary(mediaHelperStatus),
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
  const signature = createMediaCatalogViewSignature({
    tabId: tab?.id ?? null,
    status,
    helper,
    items: visibleItems,
  });

  setText(mediaCount, String(items.length));
  setText(mediaStatus, status);
  if (signature === mediaRenderSignature) return;

  const fragment = document.createDocumentFragment();
  for (const item of visibleItems) {
    fragment.append(createMediaItem(item, tab, helper));
  }
  mediaList.replaceChildren(fragment);
  mediaList.hidden = visibleItems.length === 0;
  mediaRenderSignature = signature;
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function onMediaStorageChanged(changes, areaName) {
  if (areaName !== "session" || !Number.isInteger(activeMediaTabId)) return;
  const key = mediaCatalogSessionKey(activeMediaTabId);
  if (!(key in changes)) return;
  clearTimeout(scheduledMediaRefresh);
  scheduledMediaRefresh = setTimeout(() => {
    scheduledMediaRefresh = null;
    updateMediaCatalog();
  }, 120);
}

function createMediaItem(item, tab, helper) {
  const row = document.createElement("div");
  row.className = "media-item";
  const kind = document.createElement("span");
  kind.className = "media-kind";
  kind.textContent = String(item.kind || "media").toUpperCase();
  const copy = document.createElement("div");
  copy.className = "media-copy";
  const name = document.createElement("span");
  name.className = "media-name";
  const sourceUrl = item.manifestUrl || item.sourceUrl || "";
  name.textContent = mediaDisplayName(item, sourceUrl);
  name.title = sourceUrl;
  const details = document.createElement("span");
  details.className = "media-details";
  details.textContent = mediaDetails(item);
  copy.append(name, details);
  row.append(kind, copy);
  if (item.kind === "hls")
    row.append(createMediaDownloadButton(item, tab, helper));
  return row;
}

function createMediaDownloadButton(item, tab, helper) {
  const availability = getMediaDownloadAvailability(item);
  const button = document.createElement("button");
  button.className = "media-download";
  const presentation = downloadButtonPresentation(availability, helper);
  button.disabled = presentation.disabled;
  button.textContent = presentation.label;
  button.title = presentation.title;
  button.addEventListener("click", async () => {
    button.disabled = true;
    if (helper.status !== "ready" || !helper.canDownloadHls) {
      await setupMediaHelper(button, helper);
      return;
    }
    button.textContent = "Starting…";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "CREATE_MEDIA_DOWNLOAD_JOB",
        tabId: tab.id,
        mediaId: item.id,
      });
      if (response?.status !== "started")
        throw new Error(
          response?.reason ||
            response?.error ||
            "Could not start the helper download job.",
        );
      button.textContent = "Started";
    } catch (error) {
      button.disabled = false;
      button.textContent = "Retry";
      button.title = error?.message || String(error);
    }
  });
  return button;
}

function downloadButtonPresentation(availability, helper) {
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
  if (helper.status === "ready" && !helper.canDownloadHls) {
    return {
      disabled: true,
      label: "Helper update",
      title: "The installed Media Helper does not support HLS downloads yet.",
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

async function setupMediaHelper(button, helper) {
  try {
    if (helper.status === "permission_required") {
      button.textContent = "Allowing…";
      const granted = await chrome.permissions.request({
        permissions: ["nativeMessaging"],
      });
      if (!granted) {
        button.disabled = false;
        button.textContent = "Set up";
        button.title = "Media Helper permission was not granted.";
        return;
      }
    } else if (helper.status === "not_installed") {
      alert(
        "AdsFriendly Media Helper is not installed. The installer will be added after the native downloader is implemented.",
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
        canDownloadHls: false,
        error: response?.error || "Could not read Media Helper status.",
      };
}

function helperSummary(helper) {
  if (helper.status === "permission_required")
    return "Media found · set up Media Helper to download.";
  if (helper.status === "not_installed")
    return "Media found · Media Helper is not installed.";
  if (helper.status === "ready" && helper.canDownloadHls)
    return `Media Helper ${helper.helperVersion || ""} ready.`.trim();
  if (helper.status === "ready")
    return "Media Helper connected · downloader update required.";
  if (helper.status === "incompatible")
    return "Media Helper version is incompatible.";
  return "Media found · Media Helper is unavailable.";
}

function downloadUnavailableLabel(reason = "") {
  if (reason.includes("DRM")) return "DRM";
  if (reason.includes("Live")) return "Live";
  if (reason.includes("Encrypted")) return "Encrypted";
  return "Unavailable";
}

function mediaDetails(item) {
  if (item.kind === "blob") return "Blob only · source not resolved yet";
  if (item.kind === "direct") return "Direct video file";
  if (item.kind === "dash") return "DASH found · parser comes next";
  if (item.kind !== "hls") return "Media source found";

  if (item.probeStatus === "failed")
    return item.probeError === "fallback_fetch_blocked"
      ? "HLS · page/CORS blocked manifest reading"
      : "HLS · manifest request or parse failed";
  if (item.probeStatus === "unsupported")
    return "HLS · manifest format not supported";
  if (item.probeStatus !== "ready")
    return "HLS manifest found · reading qualities";

  const facts = [];
  if (item.playlistType === "master") {
    const qualityLabels = [...(item.variants || [])]
      .sort(compareVariantQuality)
      .map(variantLabel)
      .filter(
        (label, index, labels) => label && labels.indexOf(label) === index,
      )
      .slice(0, 4);
    facts.push(
      qualityLabels.length
        ? qualityLabels.join(" · ")
        : `${item.variants?.length || 0} stream variants`,
    );
  } else {
    facts.push(item.streamType === "live" ? "Live stream" : "VOD stream");
    if (Number.isFinite(item.duration) && item.duration > 0)
      facts.push(formatDuration(item.duration));
    if (Number.isInteger(item.segmentCount))
      facts.push(`${item.segmentCount} segments`);
  }
  if (item.audioTracks?.length) facts.push(`${item.audioTracks.length} audio`);
  if (item.subtitles?.length) facts.push(`${item.subtitles.length} subtitles`);
  if (item.drm === "suspected") facts.push("DRM suspected");
  else if (item.encryptionMethods?.length) facts.push("Encrypted");
  return facts.filter(Boolean).join(" · ") || "HLS manifest ready";
}

function compareVariantQuality(left, right) {
  return (
    (right.resolution?.height || 0) - (left.resolution?.height || 0) ||
    (right.averageBandwidth || right.bandwidth || 0) -
      (left.averageBandwidth || left.bandwidth || 0)
  );
}

function variantLabel(variant) {
  if (variant.resolution?.height) return `${variant.resolution.height}p`;
  const bandwidth = variant.averageBandwidth || variant.bandwidth;
  if (!Number.isFinite(bandwidth)) return null;
  return bandwidth >= 1_000_000
    ? `${(bandwidth / 1_000_000).toFixed(1)} Mbps`
    : `${Math.round(bandwidth / 1000)} Kbps`;
}

function formatDuration(seconds) {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours)
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds,
    ).padStart(2, "0")}`;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function mediaDisplayName(item, sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol === "blob:") return item.title || "Blob media stream";
    const file = url.pathname.split("/").filter(Boolean).at(-1);
    return file ? `${url.hostname} · ${file}` : url.hostname;
  } catch {
    return item.title || sourceUrl || "Unknown media";
  }
}

async function getActiveHttpTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url?.startsWith("http") ? tab : null;
}
