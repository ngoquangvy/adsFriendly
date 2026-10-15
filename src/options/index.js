import { loadSettings, saveSettings } from "../runtime/settings-store.js";
import { createSettingsNavigation } from "./section-navigation.js";
import { createDownloadsSection } from "./downloads-section.js";
import { createSettingsListFilters } from "./list-filters.js";
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

const $ = (id) => document.getElementById(id);
const whitelistEl = $("whitelist-list");
const blacklistEl = $("blacklist-list");
const domSamplesEl = $("dom-samples-container");
const packageStatusEl = $("package-status");
let currentSnapshot = {};
let storageRefreshTimer = null;
let settingsNavigation = null;
let listFilters = null;
let pageLoaded = false;
let disposed = false;
let expandedRuleHost = null;
let handledElementLink = null;
const downloadsSection = createDownloadsSection({
  document,
  window,
  chrome,
  isActive: () => settingsNavigation?.isActive("downloads") === true,
  updateFilters: () => listFilters?.update(),
  saveConnections: saveDownloadConnections,
  onError: (error) => showPackageStatus(error.message, true),
});

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
  downloadsSection.bind();
  listFilters = createSettingsListFilters(document, () => {
    if (settingsNavigation?.isActive("downloads"))
      downloadsSection.updateViewport();
  });
  settingsNavigation = createSettingsNavigation({
    document,
    window,
    onActivate: () => {
      if (pageLoaded)
        void renderActiveSection().catch((error) =>
          showPackageStatus(error.message, true),
        );
    },
  });
  $("settings-version").textContent =
    `· ${chrome.runtime.getManifest().version}`;
  chrome.storage.onChanged.addListener(handleStorageChange);
  window.addEventListener("unload", () => {
    disposed = true;
    settingsNavigation.stop();
    listFilters.stop();
    clearTimeout(storageRefreshTimer);
    downloadsSection.stop();
    chrome.storage.onChanged.removeListener(handleStorageChange);
  });
  await loadPage();
}

// Only the visible page performs expensive/native/IndexedDB reads. Downloads
// and diagnostic capture themselves keep running independently in background.
const sectionRenderers = Object.freeze({
  protection: () => {},
  packages: renderPackageStatus,
  sites: () => {
    renderDomainList(currentSnapshot.whitelist || [], whitelistEl, "whitelist");
    renderDomainList(currentSnapshot.blacklist || [], blacklistEl, "blacklist");
    renderCustomRules();
    renderLearnedPaths();
  },
  downloads: downloadsSection.render,
  activity: () => renderNavigationLogs(currentSnapshot.blockedLogs || []),
  advanced: async () => {
    await renderStorageHealth();
    if (!settingsNavigation.isActive("advanced") || disposed) return;
    if ($("training-details").open) await renderDomSamples();
    if ($("diagnostics-details").open) await renderNavigationDiagnostics();
  },
});

async function renderActiveSection() {
  if (disposed || !pageLoaded) return;
  const section = settingsNavigation.current();
  await sectionRenderers[section]();
  if (disposed || section !== settingsNavigation.current()) return;
  listFilters.update();
  const elementLink =
    section === "sites" && location.hash === "#element-decisions"
      ? location.href
      : null;
  if (elementLink && elementLink !== handledElementLink) {
    const site = new URLSearchParams(location.search).get("site");
    const siteCard = site
      ? [...document.querySelectorAll(".rule-site")].find(
          (card) => card.dataset.host === site,
        )
      : null;
    if (siteCard) expandRuleSite(siteCard.dataset.host);
    siteCard?.scrollIntoView({ block: "nearest" });
  }
  handledElementLink = elementLink;
}

function handleStorageChange(changes, areaName) {
  if (
    areaName === "session" &&
    Object.keys(changes).some((key) => key.startsWith(DOWNLOAD_JOB_PREFIX))
  ) {
    downloadsSection.scheduleRefresh();
    return;
  }
  if (areaName === "local" && DOWNLOAD_HISTORY_KEY in changes) {
    downloadsSection.scheduleRefresh();
  }
  if (areaName !== "local") return;
  const keys = Object.keys(changes);
  const affectsSettings = keys.some(
    (key) =>
      [
        "appSettings",
        "blockedLogs",
        "whitelist",
        "blacklist",
        "userCustomRules",
        "userElementExceptions",
        SETTINGS_PACKAGE_STATE_KEY,
      ].includes(key) || key.startsWith("p:"),
  );
  if (!affectsSettings) return;
  clearTimeout(storageRefreshTimer);
  storageRefreshTimer = setTimeout(() => {
    loadPage().catch((error) => showPackageStatus(error.message, true));
  }, 80);
}

function bindStaticActions() {
  document.querySelector(".skip-link").onclick = (event) => {
    event.preventDefault();
    $("settings-main").focus();
  };
  $("training-details").addEventListener("toggle", () => {
    if ($("training-details").open && settingsNavigation?.isActive("advanced"))
      void renderDomSamples();
  });
  $("diagnostics-details").addEventListener("toggle", () => {
    if (
      $("diagnostics-details").open &&
      settingsNavigation?.isActive("advanced")
    )
      void renderNavigationDiagnostics();
  });
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
  $("btn-nav-diagnostics-start").onclick = startNavigationDiagnostics;
  $("btn-nav-diagnostics-stop").onclick = stopNavigationDiagnostics;
  $("btn-nav-diagnostics-refresh").onclick = renderNavigationDiagnostics;
  $("btn-nav-diagnostics-export").onclick = exportNavigationDiagnostics;
  $("btn-nav-diagnostics-clear").onclick = clearNavigationDiagnostics;
  $("btn-reset").onclick = factoryReset;
  bindFeedbackForm();
}

async function renderNavigationDiagnostics() {
  if (
    disposed ||
    !settingsNavigation?.isActive("advanced") ||
    !$("diagnostics-details").open
  )
    return;
  const status = $("nav-diagnostics-status");
  const preview = $("nav-diagnostics-preview");
  if (!status || !preview) return;
  try {
    const snapshot = await chrome.runtime.sendMessage({
      type: "GET_NAVIGATION_DIAGNOSTICS",
    });
    if (!Array.isArray(snapshot?.events))
      throw new Error(snapshot?.error || "Trace is unavailable.");
    status.textContent = snapshot.captureUntil
      ? snapshot.events.length +
        " events · capture active until " +
        new Date(snapshot.captureUntil).toLocaleTimeString()
      : snapshot.events.length + " recent events · session-only buffer";
    preview.textContent = JSON.stringify(snapshot.events, null, 2);
    status.style.color = "";
  } catch (error) {
    status.textContent = "Diagnostics unavailable · " + error.message;
    status.style.color = "#f87171";
  }
}

async function startNavigationDiagnostics() {
  await runNavigationDiagnosticsAction("btn-nav-diagnostics-start", {
    type: "START_NAVIGATION_DIAGNOSTICS",
    durationMs: 10 * 60 * 1000,
  });
}

async function stopNavigationDiagnostics() {
  await runNavigationDiagnosticsAction("btn-nav-diagnostics-stop", {
    type: "STOP_NAVIGATION_DIAGNOSTICS",
  });
}

async function clearNavigationDiagnostics() {
  if (!confirm("Clear the session navigation trace?")) return;
  await runNavigationDiagnosticsAction("btn-nav-diagnostics-clear", {
    type: "CLEAR_NAVIGATION_DIAGNOSTICS",
  });
}

async function exportNavigationDiagnostics() {
  const button = $("btn-nav-diagnostics-export");
  button.disabled = true;
  try {
    const snapshot = await requestNavigationDiagnostics({
      type: "GET_NAVIGATION_DIAGNOSTICS",
    });
    if (!Array.isArray(snapshot?.events))
      throw new Error("The recorder returned no trace to export.");
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "adsfriendly-navigation-trace-" + Date.now() + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    showNavigationDiagnosticsError(error);
  } finally {
    button.disabled = false;
  }
}

async function runNavigationDiagnosticsAction(buttonId, message) {
  const button = $(buttonId);
  button.disabled = true;
  try {
    await requestNavigationDiagnostics(message);
    await renderNavigationDiagnostics();
  } catch (error) {
    showNavigationDiagnosticsError(error);
  } finally {
    button.disabled = false;
  }
}

async function requestNavigationDiagnostics(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (
    response?.status === "ignored" ||
    response?.status === "disabled" ||
    response?.status === "capability_disabled" ||
    response?.status === "error"
  ) {
    throw new Error(response.error || "The background rejected this action.");
  }
  return response;
}

function showNavigationDiagnosticsError(error) {
  const status = $("nav-diagnostics-status");
  status.textContent = "Diagnostics action failed · " + error.message;
  status.style.color = "#f87171";
}

async function saveDownloadConnections(connections) {
  const settings = await saveSettings({
    ...(currentSnapshot.appSettings || {}),
    mediaDownloadConnections: connections,
  });
  currentSnapshot.appSettings = settings;
}

async function loadPage() {
  currentSnapshot = await chrome.storage.local.get(null);
  const settings = await loadSettings();
  currentSnapshot.appSettings = settings;
  $("settings-enabled").checked = settings.enabled;
  $("settings-mode").value = settings.protectionMode;
  $("media-download-connections").value = String(
    settings.mediaDownloadConnections,
  );

  renderProtectionSummary(settings);
  pageLoaded = true;
  await renderActiveSection();
}

function renderProtectionSummary(settings) {
  const modeLabels = { safe: "Safe", assist: "Assist", auto: "Auto" };
  const descriptions = {
    safe: "Conservative protection using navigation safeguards, static rules and your saved decisions.",
    assist:
      "Safe protection, with page suggestions you can review. Media tools are enabled.",
    auto: "Assist protection, with eligible automatic hiding and video actions.",
  };
  $("protection-status").textContent = settings.enabled
    ? `${modeLabels[settings.protectionMode]} · On`
    : "Protection off";
  $("protection-status").classList.toggle("is-disabled", !settings.enabled);
  $("protection-mode-description").textContent =
    descriptions[settings.protectionMode];
  const whitelist = currentSnapshot.whitelist?.length || 0;
  const blacklist = currentSnapshot.blacklist?.length || 0;
  const rules = currentSnapshot.userCustomRules || {};
  const exceptions = currentSnapshot.userElementExceptions || {};
  $("allowed-count").textContent = $("whitelist-count").textContent = whitelist;
  $("blocked-sites-count").textContent = $("blacklist-count").textContent =
    blacklist;
  $("page-decisions-count").textContent = [
    ...Object.values(rules),
    ...Object.values(exceptions),
  ].reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
  $("rule-sites-count").textContent =
    `${new Set([...Object.keys(rules), ...Object.keys(exceptions)]).size} sites`;
  $("workflow-count").textContent = Object.keys(currentSnapshot).filter((key) =>
    key.startsWith("p:"),
  ).length;
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
    `${summary.siteCount} sites · ${summary.ruleCount} hidden · ` +
      `${summary.exceptionCount} not ads · ` +
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
  showSettingsNotice("Protection settings saved.");
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
        `${summary.ruleCount} hidden rules and ${summary.exceptionCount} not-ad decisions across ${summary.siteCount} sites\n` +
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
  showSettingsNotice(
    `Added ${hostname} to ${type === "whitelist" ? "allowed" : "blocked"} sites.`,
  );
}

function renderDomainList(list, element, type) {
  if (!list.length) {
    element.innerHTML = '<div class="empty-msg">No sites added yet</div>';
    return;
  }
  element.innerHTML = list
    .map(
      (domain, index) => `
        <div class="item" data-search-text="${safeText(domain)}">
          <span>${safeText(domain)}</span>
          <button class="btn-delete" data-index="${index}" title="Remove" aria-label="Remove ${safeText(domain)}">
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
  const exceptionsByHost = currentSnapshot.userElementExceptions || {};
  const hostnames = [
    ...new Set([...Object.keys(rulesByHost), ...Object.keys(exceptionsByHost)]),
  ].sort();
  if (!hostnames.length) {
    container.innerHTML =
      '<div class="empty-msg">No page element decisions found yet.</div>';
    return;
  }

  container.innerHTML = hostnames
    .map((hostname) => {
      const rules = rulesByHost[hostname] || [];
      const exceptions = exceptionsByHost[hostname] || [];
      const hiddenDetails = rules
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
                <span class="sample-chip" style="margin-right:6px; color:#fca5a5">HIDDEN</span>
                <code style="word-break:break-all; color:#93c5fd">${safeText(selector)}</code>
                <span class="sample-chip" style="margin-left:6px">${safeText(layout.toUpperCase())}</span>
                <div style="color:#64748b; margin-top:3px; word-break:break-all">${safeText(fingerprint)}</div>
              </div>
              <button class="btn-delete-rule-item btn-delete" data-host="${safeText(hostname)}" data-index="${index}" title="Delete rule">Delete</button>
            </div>`;
        })
        .join("");
      const exceptionDetails = exceptions
        .map((rule) => {
          const fingerprint = rule?.fingerprint
            ? JSON.stringify(rule.fingerprint)
            : "Fingerprint unavailable";
          return `
            <div style="display:flex; justify-content:space-between; gap:0.75rem; padding:8px 0; border-top:1px solid rgba(255,255,255,0.05); font-size:0.75rem;">
              <div style="min-width:0">
                <span class="sample-chip" style="margin-right:6px; color:#86efac">NOT AD</span>
                <code style="word-break:break-all; color:#93c5fd">${safeText(rule.selector)}</code>
                <span class="sample-chip" style="margin-left:6px">${safeText((rule.layout || "any").toUpperCase())}</span>
                <div style="color:#64748b; margin-top:3px; word-break:break-all">${safeText(fingerprint)}</div>
              </div>
              <button class="btn-delete-exception-item btn-delete" data-host="${safeText(hostname)}" data-id="${safeText(rule.id)}" title="Forget decision">Forget</button>
            </div>`;
        })
        .join("");
      const details = `${hiddenDetails}${exceptionDetails}`;
      return `
        <div class="rule-site" data-host="${safeText(hostname)}" data-search-text="${safeText([hostname, ...rules.map((rule) => (typeof rule === "string" ? rule : rule.selector)), ...exceptions.map((rule) => rule.selector)].join(" "))}" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); padding:12px; border-radius:12px; margin-bottom:10px;">
          <div class="rule-header">
            <div>
              <div style="font-weight:bold; color:#e2e8f0">${safeText(hostname)}</div>
              <div style="font-size:0.75rem; color:#64748b">${rules.length} hidden · ${exceptions.length} not ads</div>
            </div>
            <div class="rule-actions">
              <button class="toggle-details btn-secondary" aria-expanded="false">Details</button>
              <button class="reset-site-rules btn-secondary" data-host="${safeText(hostname)}">Reset site</button>
            </div>
          </div>
          <div class="details-pane" style="display:none; margin-top:10px">${details}</div>
        </div>`;
    })
    .join("");

  container.querySelectorAll(".toggle-details").forEach((button) => {
    button.onclick = () => {
      const host = button.closest(".rule-site").dataset.host;
      expandRuleSite(expandedRuleHost === host ? null : host);
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
  container.querySelectorAll(".btn-delete-exception-item").forEach((button) => {
    button.onclick = async () => {
      const response = await chrome.runtime.sendMessage({
        type: "REMOVE_ELEMENT_EXCEPTIONS",
        hostname: button.dataset.host,
        ids: [button.dataset.id],
      });
      if (response?.status !== "saved")
        throw new Error(response?.error || "Could not forget decision.");
      await loadPage();
    };
  });
  container.querySelectorAll(".reset-site-rules").forEach((button) => {
    button.onclick = async () => {
      const hostname = button.dataset.host;
      if (!confirm(`Remove all hidden and not-ad decisions for ${hostname}?`))
        return;
      const response = await chrome.runtime.sendMessage({
        type: "RESET_ELEMENT_DECISIONS",
        hostname,
      });
      if (response?.status !== "saved")
        throw new Error(response?.error || "Could not reset site rules.");
      await loadPage();
    };
  });
  expandRuleSite(expandedRuleHost);
}

function expandRuleSite(host) {
  expandedRuleHost = host;
  for (const card of document.querySelectorAll(".rule-site")) {
    const expanded = card.dataset.host === host;
    const button = card.querySelector(".toggle-details");
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? "Hide details" : "Details";
    card.querySelector(".details-pane").style.display = expanded
      ? "block"
      : "none";
  }
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
      <div class="item" data-search-text="${safeText(`${path.source} ${path.target}`)}">
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
      <div class="item" data-search-text="${safeText(`${log.url} ${log.source}`)}" style="flex-direction:column; align-items:flex-start; gap:4px">
        <div style="font-size:0.8rem; color:#fbd38d; font-weight:bold">Blocked Navigation</div>
        <div style="font-family:monospace; font-size:0.75rem; word-break:break-all">Target: ${safeText(log.url)}</div>
        <div style="font-size:0.7rem; color:#64748b">Source: ${safeText(log.source)} · ${safeText(new Date(log.timestamp).toLocaleString())}</div>
      </div>`,
    )
    .join("");
}

async function renderDomSamples() {
  if (
    disposed ||
    !settingsNavigation?.isActive("advanced") ||
    !$("training-details").open
  )
    return;
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
      "Reset local settings, personal decisions, training data and stored history, then restore the bundled Settings Package? Downloaded files are kept. Active downloads are not cancelled.",
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
  if (error) showSettingsNotice(message, true);
}

function showSettingsNotice(message, error = false) {
  const notice = $("settings-notice");
  notice.hidden = !message;
  notice.textContent = message;
  notice.classList.toggle("is-error", error);
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
