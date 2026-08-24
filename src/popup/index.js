import { loadSettings, saveSettings } from "../runtime/settings-store.js";
import {
  CAPABILITIES,
  getCapabilitiesForMode,
} from "../runtime/feature-catalog.js";

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
setInterval(updateMediaCatalog, 1500);

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
  mediaList.replaceChildren();
  mediaList.hidden = true;
  mediaCount.textContent = "0";
  if (!settings.enabled) {
    mediaStatus.textContent = "Protection is off; media observation is paused.";
    return;
  }
  if (settings.protectionMode === "safe") {
    mediaStatus.textContent =
      "Switch to Assist or Auto, then reload the video page.";
    return;
  }
  if (!tab) {
    mediaStatus.textContent = "Open an HTTP video page to test detection.";
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_MEDIA_CATALOG",
      tabId: tab.id,
      pageUrl: tab.url,
    });
    const items = Array.isArray(response?.items) ? response.items : [];
    mediaCount.textContent = String(items.length);
    if (!items.length) {
      mediaStatus.textContent =
        response?.status === "capability_disabled"
          ? "Media observation is still starting. Reload the page once."
          : "No MP4, WebM, HLS, or DASH source detected yet.";
      return;
    }
    mediaStatus.textContent =
      "Read-only catalog · downloading is not enabled yet.";
    mediaList.hidden = false;
    items
      .slice(0, 8)
      .forEach((item) => mediaList.append(createMediaItem(item)));
  } catch (error) {
    mediaStatus.textContent = "Could not read the media catalog.";
    console.debug("[AdsFriendly Popup] Media catalog unavailable", error);
  }
}

function createMediaItem(item) {
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
  return row;
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
