import { loadSettings, saveSettings } from "../runtime/settings-store.js";
import {
  BUNDLED_SETTINGS_PACKAGE_PATH,
  SETTINGS_PACKAGE_STATE_KEY,
  createSettingsPackage,
  normalizeSettingsPackage,
  replaceSettingsWithPackage,
  summarizeSettingsPackage,
} from "../settings-package/schema.js";

const $ = (id) => document.getElementById(id);
const whitelistEl = $("whitelist-list");
const blacklistEl = $("blacklist-list");
const domSamplesEl = $("dom-samples-container");
const packageStatusEl = $("package-status");
let currentSnapshot = {};
let storageRefreshTimer = null;

initialize().catch((error) => showPackageStatus(error.message, true));

async function initialize() {
  bindStaticActions();
  chrome.storage.onChanged.addListener(handleStorageChange);
  window.addEventListener("unload", () =>
    chrome.storage.onChanged.removeListener(handleStorageChange),
  );
  await loadPage();
}

function handleStorageChange(changes, areaName) {
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
  $("btn-reset").onclick = factoryReset;
  bindFeedbackForm();
}

async function loadPage() {
  currentSnapshot = await chrome.storage.local.get(null);
  const settings = await loadSettings();
  currentSnapshot.appSettings = settings;
  $("settings-enabled").checked = settings.enabled;
  $("settings-mode").value = settings.protectionMode;

  renderPackageStatus();
  renderDomainList(currentSnapshot.whitelist || [], whitelistEl, "whitelist");
  renderDomainList(currentSnapshot.blacklist || [], blacklistEl, "blacklist");
  renderCustomRules();
  renderNavigationLogs(currentSnapshot.blockedLogs || []);
  renderLearnedPaths();
  renderDomSamples();
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
  const { whitelist = [], blacklist = [] } = await chrome.storage.local.get([
    "whitelist",
    "blacklist",
  ]);
  if (type === "whitelist") {
    const nextWhitelist = [...new Set([...whitelist, hostname])];
    const nextBlacklist = blacklist.filter(
      (value) => normalizeHostname(value) !== hostname,
    );
    await chrome.storage.local.set({
      whitelist: nextWhitelist,
      blacklist: nextBlacklist,
    });
  } else {
    const rule = `||${hostname}^`;
    const nextBlacklist = [...new Set([...blacklist, rule])];
    const nextWhitelist = whitelist.filter(
      (value) => normalizeHostname(value) !== hostname,
    );
    await chrome.storage.local.set({
      whitelist: nextWhitelist,
      blacklist: nextBlacklist,
    });
  }
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
      const current = await chrome.storage.local.get(type);
      const updated = [...(current[type] || [])];
      updated.splice(Number(button.dataset.index), 1);
      await chrome.storage.local.set({ [type]: updated });
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
          return `
            <div style="display:flex; justify-content:space-between; gap:0.75rem; padding:8px 0; border-top:1px solid rgba(255,255,255,0.05); font-size:0.75rem;">
              <div style="min-width:0">
                <code style="word-break:break-all; color:#93c5fd">${safeText(selector)}</code>
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
      const rules = structuredClone(currentSnapshot.userCustomRules || {});
      rules[button.dataset.host].splice(Number(button.dataset.index), 1);
      if (!rules[button.dataset.host].length) delete rules[button.dataset.host];
      await chrome.storage.local.set({ userCustomRules: rules });
      await loadPage();
    };
  });
  container.querySelectorAll(".reset-site-rules").forEach((button) => {
    button.onclick = async () => {
      const hostname = button.dataset.host;
      if (!confirm(`Remove all packaged and personal rules for ${hostname}?`))
        return;
      const rules = structuredClone(currentSnapshot.userCustomRules || {});
      const removed = rules[hostname] || [];
      delete rules[hostname];
      const siteResetHistory = structuredClone(
        currentSnapshot.siteResetHistory || {},
      );
      siteResetHistory[hostname] = { oldRules: removed, timestamp: Date.now() };
      await chrome.storage.local.set({
        userCustomRules: rules,
        siteResetHistory,
      });
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
  const { domTrainingSamples = [] } =
    await chrome.storage.local.get("domTrainingSamples");
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
  const { domTrainingSamples = [] } =
    await chrome.storage.local.get("domTrainingSamples");
  if (!domTrainingSamples.length) return alert("No DOM samples to export yet.");
  downloadText(
    "adsfriendly-dom-samples.jsonl",
    domTrainingSamples.map((sample) => JSON.stringify(sample)).join("\n"),
    "application/jsonl",
  );
}

async function clearDomSamples() {
  if (!confirm("Clear all local DOM training samples?")) return;
  await chrome.storage.local.set({ domTrainingSamples: [] });
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
