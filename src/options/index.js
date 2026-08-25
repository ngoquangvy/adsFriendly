import { loadSettings, saveSettings } from "../runtime/settings-store.js";
import {
  BUNDLED_SETTINGS_PACKAGE_PATH,
  SETTINGS_PACKAGE_STATE_KEY,
  createSettingsPackage,
  normalizeSettingsPackage,
  replaceSettingsWithPackage,
  summarizeSettingsPackage,
} from "../settings-package/schema.js";
import {
  clearAllTrainingData,
  clearDomTrainingSamples,
  listDomTrainingSamples,
} from "../storage/training-store.js";
import {
  DOWNLOAD_HISTORY_KEY,
  DOWNLOAD_JOB_PREFIX,
} from "../media/download-job-contract.js";
import {
  formatMediaJobDetails,
  getMediaJobPrimaryAction,
  getMediaJobProgress,
} from "../media/download-job-view.js";

const $ = (id) => document.getElementById(id);
const whitelistEl = $("whitelist-list");
const blacklistEl = $("blacklist-list");
const domSamplesEl = $("dom-samples-container");
const packageStatusEl = $("package-status");
let currentSnapshot = {};
let storageRefreshTimer = null;
let downloadRefreshTimer = null;

initialize().catch((error) => showPackageStatus(error.message, true));
window.addEventListener("unhandledrejection", (event) => {
  showPackageStatus(
    event.reason?.message || String(event.reason || "Settings action failed."),
    true,
  );
  event.preventDefault();
});

async function initialize() {
  bindStaticActions();
  chrome.storage.onChanged.addListener(handleStorageChange);
  window.addEventListener("unload", () =>
    chrome.storage.onChanged.removeListener(handleStorageChange),
  );
  await loadPage();
  await renderDownloads();
  if (location.hash === "#downloads")
    $("downloads").scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleStorageChange(changes, areaName) {
  if (
    areaName === "session" &&
    Object.keys(changes).some((key) => key.startsWith(DOWNLOAD_JOB_PREFIX))
  ) {
    scheduleDownloadRefresh();
    return;
  }
  if (areaName === "local" && DOWNLOAD_HISTORY_KEY in changes) {
    scheduleDownloadRefresh();
  }
  if (areaName !== "local") return;
  const keys = Object.keys(changes);
  const affectsSettings = keys.some(
    (key) =>
      [
        "appSettings",
        "whitelist",
        "blacklist",
        "userCustomRules",
        SETTINGS_PACKAGE_STATE_KEY,
      ].includes(key) || key.startsWith("p:"),
  );
  if (!affectsSettings) return;
  clearTimeout(storageRefreshTimer);
  storageRefreshTimer = setTimeout(() => {
    loadPage().catch((error) => showPackageStatus(error.message, true));
  }, 80);
}

function scheduleDownloadRefresh() {
  if (downloadRefreshTimer) return;
  downloadRefreshTimer = setTimeout(() => {
    downloadRefreshTimer = null;
    void renderDownloads();
  }, 250);
}

function bindStaticActions() {
  $("btn-package-export").onclick = exportSettingsPackage;
  $("btn-package-import").onclick = () => $("package-file-input").click();
  $("package-file-input").onchange = importSettingsPackage;
  $("btn-package-default").onclick = restoreBundledDefault;
  $("settings-mode").onchange = saveProtectionControls;
  $("settings-enabled").onchange = saveProtectionControls;
  $("btn-whitelist-add").onclick = () => addDomain("whitelist");
  $("btn-blacklist-add").onclick = () => addDomain("blacklist");
  $("whitelist-input").onkeydown = (event) => {
    if (event.key === "Enter") addDomain("whitelist");
  };
  $("blacklist-input").onkeydown = (event) => {
    if (event.key === "Enter") addDomain("blacklist");
  };
  $("btn-dom-refresh").onclick = renderDomSamples;
  $("btn-dom-export").onclick = exportDomSamples;
  $("btn-dom-clear").onclick = clearDomSamples;
  $("btn-download-refresh").onclick = renderDownloads;
  $("btn-reset").onclick = factoryReset;
  bindFeedbackForm();
}

async function renderDownloads() {
  const container = $("download-job-manager");
  const status = $("download-manager-status");
  if (!container || !status) return;
  try {
    const [jobsResponse, helper] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_MEDIA_DOWNLOAD_JOBS" }),
      chrome.runtime.sendMessage({ type: "GET_MEDIA_HELPER_STATUS" }),
    ]);
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
    if (!jobs.length) {
      const empty = document.createElement("div");
      empty.className = "empty-msg";
      empty.textContent = "No download history yet.";
      container.replaceChildren(empty);
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
    for (const job of jobs) {
      visibleIds.add(job.id);
      const row = existing.get(job.id) || createDownloadHistoryItem();
      updateDownloadHistoryItem(row, job, helper);
      container.append(row);
    }
    for (const [jobId, row] of existing) {
      if (!visibleIds.has(jobId)) row.remove();
    }
  } catch (error) {
    status.textContent = `Downloads unavailable · ${error.message}`;
    status.style.color = "#f87171";
  }
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

  const controls = document.createElement("div");
  controls.className = "download-history-controls";
  row.append(header, progressTrack, details, output, controls);
  return row;
}

function updateDownloadHistoryItem(row, job, helper) {
  row.dataset.jobId = job.id;
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
  row.querySelector(".download-progress-bar").style.width =
    `${progress.percent ?? 0}%`;
  row.querySelector(".download-history-details").textContent =
    formatMediaJobDetails(job);
  row.querySelector(".download-output-path").textContent =
    job.outputPath || "Output file not created yet";
  const controls = row.querySelector(".download-history-controls");
  const selectedConnections = Number(
    controls.querySelector(".download-connections")?.value,
  );
  controls.replaceChildren();
  const connections = document.createElement("select");
  connections.className = "field-select download-connections";
  connections.title = "Parallel connections used for retry or resume";
  for (const value of [4, 8, 12, 16]) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value} connections`;
    option.selected =
      value ===
      (Number.isInteger(selectedConnections)
        ? selectedConnections
        : progress.connections);
    connections.append(option);
  }
  const primary = getMediaJobPrimaryAction(job);
  connections.disabled = !primary || ["pause", "cancel"].includes(primary.type);
  controls.append(connections);
  if (primary) {
    controls.append(
      downloadActionButton(
        primary.label,
        primary.messageType,
        job.id,
        connections,
        {
          danger: primary.type === "cancel",
        },
      ),
    );
  }
  if (job.status === "completed" && job.outputPath) {
    const outputActionsReady =
      helper?.capabilities?.["output.open"] === true &&
      helper?.capabilities?.["output.reveal"] === true;
    const open = downloadActionButton(
      "Open",
      "OPEN_MEDIA_DOWNLOAD_OUTPUT",
      job.id,
      connections,
    );
    const reveal = downloadActionButton(
      "Open location",
      "REVEAL_MEDIA_DOWNLOAD_OUTPUT",
      job.id,
      connections,
    );
    open.disabled = !outputActionsReady;
    reveal.disabled = !outputActionsReady;
    if (!outputActionsReady) {
      open.title = reveal.title = "Update Media Helper to use output actions.";
    }
    controls.append(open, reveal);
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
      downloadActionButton(
        "Remove history",
        "REMOVE_MEDIA_DOWNLOAD_HISTORY",
        job.id,
        connections,
        { danger: true },
      ),
    );
  }
}

function downloadActionButton(
  label,
  messageType,
  jobId,
  connections,
  { danger = false } = {},
) {
  const button = document.createElement("button");
  button.className = danger ? "btn-secondary download-danger" : "btn-secondary";
  button.textContent = label;
  button.onclick = async () => {
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
        connections: Number(connections.value),
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
      button.disabled = false;
      button.textContent = original;
      $("download-manager-status").textContent =
        `Action failed · ${error.message}`;
      $("download-manager-status").style.color = "#f87171";
    }
  };
  return button;
}

async function loadPage() {
  currentSnapshot = await chrome.storage.local.get(null);
  const settings = await loadSettings();
  currentSnapshot.appSettings = settings;
  $("settings-enabled").checked = settings.enabled;
  $("settings-mode").value = settings.protectionMode;

  renderPackageStatus();
  renderStorageHealth();
  renderDomainList(currentSnapshot.whitelist || [], whitelistEl, "whitelist");
  renderDomainList(currentSnapshot.blacklist || [], blacklistEl, "blacklist");
  renderCustomRules();
  renderNavigationLogs(currentSnapshot.blockedLogs || []);
  renderLearnedPaths();
  renderDomSamples();
}

async function renderStorageHealth() {
  const element = $("storage-health");
  try {
    const health = await chrome.runtime.sendMessage({
      type: "GET_STORAGE_HEALTH",
    });
    if (health?.status !== "ok")
      throw new Error(health?.error || "Storage health check failed.");
    const size = Number.isFinite(health.bytesInUse)
      ? `${(health.bytesInUse / 1048576).toFixed(2)} MiB settings`
      : "settings storage ready";
    element.textContent = `${size} · training database separate · ${
      health.unlimited
        ? "large-dataset storage enabled"
        : "storage limit active"
    }`;
    element.style.color = health.unlimited ? "#22c55e" : "#f59e0b";
  } catch (error) {
    element.textContent = `Storage unavailable · ${error.message}`;
    element.style.color = "#f87171";
  }
}

function renderPackageStatus() {
  const settingsPackage = createSettingsPackage(currentSnapshot, {
    name: $("package-name").value || "My AdsFriendly Settings",
    author: $("package-author").value || "AdsFriendly User",
  });
  const summary = summarizeSettingsPackage(settingsPackage);
  const state = currentSnapshot[SETTINGS_PACKAGE_STATE_KEY];
  const metadata = state?.package;
  if (metadata) {
    $("package-name").value = metadata.name || $("package-name").value;
    $("package-author").value = metadata.author || $("package-author").value;
  }
  $("package-source").textContent = String(
    state?.source || "local",
  ).toUpperCase();
  showPackageStatus(
    `${summary.siteCount} sites · ${summary.ruleCount} element rules · ` +
      `${summary.whitelistCount} trusted · ${summary.blacklistCount} blocked · ` +
      `${summary.trustedPathCount} workflows`,
  );
}

async function saveProtectionControls() {
  await saveSettings({
    ...(currentSnapshot.appSettings || {}),
    enabled: $("settings-enabled").checked,
    protectionMode: $("settings-mode").value,
  });
  await loadPage();
}

async function exportSettingsPackage() {
  const snapshot = await chrome.storage.local.get(null);
  const settingsPackage = createSettingsPackage(snapshot, {
    id: `user.${Date.now()}`,
    name: $("package-name").value,
    author: $("package-author").value,
    version: "1.0.0",
  });
  downloadText(
    `${slug(settingsPackage.metadata.name)}.afsettings.json`,
    JSON.stringify(settingsPackage, null, 2),
    "application/json",
  );
  showPackageStatus("Settings package exported.");
}

async function importSettingsPackage(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const settingsPackage = normalizeSettingsPackage(
      JSON.parse(await file.text()),
    );
    const summary = summarizeSettingsPackage(settingsPackage);
    const accepted = confirm(
      `Install “${summary.name}” by ${summary.author}?\n\n` +
        `${summary.ruleCount} element rules across ${summary.siteCount} sites\n` +
        `${summary.whitelistCount} trusted domains\n` +
        `${summary.blacklistCount} blocked domains\n` +
        `${summary.trustedPathCount} trusted workflows\n\n` +
        "This replaces the current shareable settings. Diagnostics and training samples are preserved.",
    );
    if (!accepted) return;
    await replaceSettingsWithPackage(
      settingsPackage,
      chrome.storage.local,
      "imported",
    );
    await loadPage();
    showPackageStatus(`Installed “${summary.name}”.`);
  } catch (error) {
    showPackageStatus(`Import failed: ${error.message}`, true);
  }
}

async function restoreBundledDefault() {
  if (
    !confirm(
      "Replace current shareable settings with the bundled default package?",
    )
  ) {
    return;
  }
  try {
    const settingsPackage = await loadBundledPackage();
    await replaceSettingsWithPackage(
      settingsPackage,
      chrome.storage.local,
      "bundled",
    );
    await loadPage();
    showPackageStatus("Bundled default settings restored.");
  } catch (error) {
    showPackageStatus(`Could not restore default: ${error.message}`, true);
  }
}

async function loadBundledPackage() {
  const response = await fetch(
    chrome.runtime.getURL(BUNDLED_SETTINGS_PACKAGE_PATH),
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return normalizeSettingsPackage(await response.json());
}

async function addDomain(type) {
  const input = $(`${type}-input`);
  const hostname = normalizeHostname(input.value);
  if (!hostname) {
    alert("Enter a valid hostname, for example: example.com");
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "SAVE_DOMAIN_DECISION",
    action: type === "whitelist" ? "WHITELIST" : "BLACKLIST",
    domain: hostname,
  });
  if (response?.status !== "saved")
    throw new Error(response?.error || "Could not save domain.");
  input.value = "";
  await loadPage();
}

function renderDomainList(list, element, type) {
  if (!list.length) {
    element.innerHTML = '<div class="empty-msg">No sites added yet</div>';
    return;
  }
  element.innerHTML = list
    .map(
      (domain, index) => `
        <div class="item">
          <span>${safeText(domain)}</span>
          <button class="btn-delete" data-index="${index}" title="Remove">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>`,
    )
    .join("");
  element.querySelectorAll(".btn-delete").forEach((button) => {
    button.onclick = async () => {
      const domain = list[Number(button.dataset.index)];
      const response = await chrome.runtime.sendMessage({
        type: "REMOVE_DOMAIN_DECISION",
        listName: type,
        domain,
      });
      if (response?.status !== "saved")
        throw new Error(response?.error || "Could not remove domain.");
      await loadPage();
    };
  });
}

function renderCustomRules() {
  const container = $("custom-rules-container");
  const rulesByHost = currentSnapshot.userCustomRules || {};
  const hostnames = Object.keys(rulesByHost).sort();
  if (!hostnames.length) {
    container.innerHTML =
      '<div class="empty-msg">No custom rules found yet.</div>';
    return;
  }

  container.innerHTML = hostnames
    .map((hostname) => {
      const rules = rulesByHost[hostname] || [];
      const details = rules
        .map((rule, index) => {
          const selector = typeof rule === "string" ? rule : rule.selector;
          const fingerprint =
            typeof rule === "object" && rule.fingerprint
              ? JSON.stringify(rule.fingerprint)
              : "Simple selector";
          const layout =
            typeof rule === "object" ? rule.layout || "any" : "any";
          return `
            <div style="display:flex; justify-content:space-between; gap:0.75rem; padding:8px 0; border-top:1px solid rgba(255,255,255,0.05); font-size:0.75rem;">
              <div style="min-width:0">
                <code style="word-break:break-all; color:#93c5fd">${safeText(selector)}</code>
                <span class="sample-chip" style="margin-left:6px">${safeText(layout.toUpperCase())}</span>
                <div style="color:#64748b; margin-top:3px; word-break:break-all">${safeText(fingerprint)}</div>
              </div>
              <button class="btn-delete-rule-item btn-delete" data-host="${safeText(hostname)}" data-index="${index}" title="Delete rule">Delete</button>
            </div>`;
        })
        .join("");
      return `
        <div class="rule-site" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); padding:12px; border-radius:12px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem">
            <div>
              <div style="font-weight:bold; color:#e2e8f0">${safeText(hostname)}</div>
              <div style="font-size:0.75rem; color:#64748b">${rules.length} active rules</div>
            </div>
            <div style="display:flex; gap:8px">
              <button class="toggle-details btn-secondary">Details</button>
              <button class="reset-site-rules btn-secondary" data-host="${safeText(hostname)}">Reset site</button>
            </div>
          </div>
          <div class="details-pane" style="display:none; margin-top:10px">${details}</div>
        </div>`;
    })
    .join("");

  container.querySelectorAll(".toggle-details").forEach((button) => {
    button.onclick = () => {
      const pane = button.closest(".rule-site").querySelector(".details-pane");
      pane.style.display = pane.style.display === "none" ? "block" : "none";
    };
  });
  container.querySelectorAll(".btn-delete-rule-item").forEach((button) => {
    button.onclick = async () => {
      const rule =
        currentSnapshot.userCustomRules?.[button.dataset.host]?.[
          Number(button.dataset.index)
        ];
      const selector = typeof rule === "string" ? rule : rule?.selector;
      const response = await chrome.runtime.sendMessage({
        type: "REMOVE_CUSTOM_RULES",
        hostname: button.dataset.host,
        selectors: [selector],
      });
      if (response?.status !== "saved")
        throw new Error(response?.error || "Could not delete rule.");
      await loadPage();
    };
  });
  container.querySelectorAll(".reset-site-rules").forEach((button) => {
    button.onclick = async () => {
      const hostname = button.dataset.host;
      if (!confirm(`Remove all packaged and personal rules for ${hostname}?`))
        return;
      const response = await chrome.runtime.sendMessage({
        type: "RESET_CUSTOM_RULES",
        hostname,
      });
      if (response?.status !== "saved")
        throw new Error(response?.error || "Could not reset site rules.");
      await loadPage();
    };
  });
}

function renderLearnedPaths() {
  const container = $("learned-paths-container");
  const entries = Object.entries(currentSnapshot)
    .filter(([key]) => key.startsWith("p:"))
    .sort(([, a], [, b]) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
  if (!entries.length) {
    container.innerHTML =
      '<div class="empty-msg">No learned workflows yet.</div>';
    return;
  }
  container.innerHTML = entries
    .map(
      ([key, path]) => `
      <div class="item">
        <div>
          <div style="font-size:0.85rem; font-weight:bold">${safeText(path.source)} → ${safeText(path.target)}</div>
          <div style="font-size:0.7rem; color:${path.isManual ? "#a855f7" : "#22c55e"}">${path.isManual ? "MANUAL TRUST" : `Natural habit (${Number(path.visits) || 0} visits)`}</div>
        </div>
        <button class="btn-delete delete-path" data-key="${safeText(key)}">Delete</button>
      </div>`,
    )
    .join("");
  container.querySelectorAll(".delete-path").forEach((button) => {
    button.onclick = async () => {
      await chrome.storage.local.remove(button.dataset.key);
      await loadPage();
    };
  });
}

function renderNavigationLogs(logs) {
  const container = $("blocked-logs-container");
  if (!logs.length) {
    container.innerHTML =
      '<div class="empty-msg">Clean history. No suspicious navigations blocked recently.</div>';
    return;
  }
  container.innerHTML = logs
    .slice(0, 20)
    .map(
      (log) => `
      <div class="item" style="flex-direction:column; align-items:flex-start; gap:4px">
        <div style="font-size:0.8rem; color:#fbd38d; font-weight:bold">Blocked Navigation</div>
        <div style="font-family:monospace; font-size:0.75rem; word-break:break-all">Target: ${safeText(log.url)}</div>
        <div style="font-size:0.7rem; color:#64748b">Source: ${safeText(log.source)} · ${safeText(new Date(log.timestamp).toLocaleString())}</div>
      </div>`,
    )
    .join("");
}

async function renderDomSamples() {
  if (!domSamplesEl) return;
  const domTrainingSamples = await listDomTrainingSamples(80);
  if (!domTrainingSamples.length) {
    domSamplesEl.innerHTML = '<div class="empty-msg">No DOM samples yet.</div>';
    return;
  }
  domSamplesEl.innerHTML = [...domTrainingSamples]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, 80)
    .map((sample) => {
      const features = sample.evidence?.features || {};
      const reasons = sample.evidence?.reasons || [];
      const selector = sample.context?.selector || "unknown selector";
      const confidence = sample.context?.confidence;
      return `
        <div class="item sample-row">
          <div style="display:flex; width:100%; justify-content:space-between">
            <strong style="color:${sample.label === "ad" ? "#f87171" : "#22c55e"}">${safeText(String(sample.label || "unknown").toUpperCase())}</strong>
            <span style="font-size:0.72rem; color:#64748b">${safeText(new Date(sample.timestamp).toLocaleString())}</span>
          </div>
          <div style="font-family:monospace; font-size:0.76rem; word-break:break-all">${safeText(selector)}</div>
          <div style="font-size:0.72rem; color:#94a3b8">${safeText(sample.site?.hostname)} · ${safeText(sample.label_source)} · ${formatPct(confidence)}</div>
          <div class="sample-meta">${
            reasons
              .slice(0, 8)
              .map(
                (reason) =>
                  `<span class="sample-chip">${safeText(reason)}</span>`,
              )
              .join("") || '<span class="sample-chip">no reasons</span>'
          }</div>
          <div class="sample-meta">${[
            features.tag,
            features.id,
            features.className,
            features.hrefHost,
          ]
            .filter(Boolean)
            .slice(0, 6)
            .map(
              (value) => `<span class="sample-chip">${safeText(value)}</span>`,
            )
            .join("")}</div>
        </div>`;
    })
    .join("");
}

async function exportDomSamples() {
  const domTrainingSamples = await listDomTrainingSamples(5000);
  if (!domTrainingSamples.length) return alert("No DOM samples to export yet.");
  downloadText(
    "adsfriendly-dom-samples.jsonl",
    domTrainingSamples.map((sample) => JSON.stringify(sample)).join("\n"),
    "application/jsonl",
  );
}

async function clearDomSamples() {
  if (!confirm("Clear all local DOM training samples?")) return;
  await clearDomTrainingSamples();
  await renderDomSamples();
}

async function factoryReset() {
  if (
    !confirm(
      "Factory reset all memory and restore the bundled Settings Package?",
    )
  ) {
    return;
  }
  const bundled = await loadBundledPackage();
  await chrome.storage.local.clear();
  await clearAllTrainingData();
  await replaceSettingsWithPackage(bundled, chrome.storage.local, "bundled");
  await chrome.storage.local.set({ blockedCount: 0 });
  await chrome.action.setBadgeText({ text: "" });
  await loadPage();
}

function bindFeedbackForm() {
  const form = $("feedback-form");
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const status = $("fb-status");
    const submit = $("fb-submit");
    const body = $("fb-body").value.trim();
    const rating = document.querySelector(
      'input[name="rating"]:checked',
    )?.value;
    const { lastFeedbackTime = 0 } =
      await chrome.storage.local.get("lastFeedbackTime");
    if (Date.now() - lastFeedbackTime < 3600000) {
      return showFeedbackStatus(
        "Please wait before sending feedback again.",
        true,
      );
    }
    if (!body || !confirm("Send your feedback?")) return;
    submit.disabled = true;
    showFeedbackStatus("Sending…");
    try {
      await fetch(
        "https://telegarmworker.ngoquangvy97.workers.dev/adsfriendly",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, rating: Number(rating) || 5 }),
        },
      );
      await chrome.storage.local.set({ lastFeedbackTime: Date.now() });
      form.reset();
      showFeedbackStatus("Sent successfully. Thank you!");
    } catch (error) {
      showFeedbackStatus(`Error: ${error.message}`, true);
    } finally {
      submit.disabled = false;
    }

    function showFeedbackStatus(message, error = false) {
      status.style.display = "block";
      status.style.color = error ? "var(--danger)" : "#22c55e";
      status.textContent = message;
    }
  };
}

function showPackageStatus(message, error = false) {
  packageStatusEl.textContent = message;
  packageStatusEl.style.color = error ? "#f87171" : "#94a3b8";
}

function downloadText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function normalizeHostname(value) {
  const raw = String(value || "")
    .trim()
    .replace(/^\|\|/, "")
    .replace(/\^$/, "");
  try {
    const hostname = new URL(
      raw.includes("://") ? raw : `https://${raw}`,
    ).hostname.toLowerCase();
    return /^[a-z0-9.-]+$/.test(hostname) ? hostname : "";
  } catch {
    return "";
  }
}

function safeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPct(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "n/a";
}

function slug(value) {
  return (
    String(value || "adsfriendly-settings")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "adsfriendly-settings"
  );
}
