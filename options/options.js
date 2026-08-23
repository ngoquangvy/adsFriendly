// Logic for AdsFriendly Options Page

const whitelistEl = document.getElementById("whitelist-list");
const blacklistEl = document.getElementById("blacklist-list");
const resetBtn = document.getElementById("btn-reset");
const domSamplesEl = document.getElementById("dom-samples-container");
const domRefreshBtn = document.getElementById("btn-dom-refresh");
const domExportBtn = document.getElementById("btn-dom-export");
const domClearBtn = document.getElementById("btn-dom-clear");

async function loadLists() {
  const {
    whitelist = [],
    blacklist = [],
    blockedLogs = [],
  } = await chrome.storage.local.get(["whitelist", "blacklist", "blockedLogs"]);

  renderList(whitelist, whitelistEl, "WHITELIST");
  renderList(blacklist, blacklistEl, "BLACKLIST");
  renderCustomRules();
  renderNavigationLogs(blockedLogs);
  renderLearnedPaths();
  renderDomSamples();
}

const renderNavigationLogs = (logs) => {
  const container = document.getElementById("blocked-logs-container");
  if (logs.length === 0) {
    container.innerHTML =
      '<div class="empty-msg">Clean history. No suspicious navigations blocked recently.</div>';
    return;
  }

  container.innerHTML = logs
    .map(
      (log) => `
        <div class="item" style="flex-direction: column; align-items: flex-start; gap: 4px;">
            <div style="font-size: 0.8rem; color: #fbd38d; font-weight: bold;">Blocked Navigation</div>
            <div style="font-family: monospace; font-size: 0.75rem; word-break: break-all;">Target: ${log.url}</div>
            <div style="font-size: 0.7rem; color: #64748b;">Source: ${log.source} • ${new Date(log.timestamp).toLocaleString()}</div>
        </div>
    `,
    )
    .join("");
};

const renderLearnedPaths = async () => {
  const container = document.getElementById("learned-paths-container");
  const allStorage = await chrome.storage.local.get(null);
  const pulseKeys = Object.keys(allStorage).filter((key) =>
    key.startsWith("p:"),
  );

  if (pulseKeys.length === 0) {
    container.innerHTML =
      '<div class="empty-msg">No learned workflows yet.</div>';
    return;
  }

  container.innerHTML = pulseKeys
    .map((key) => {
      const path = allStorage[key];
      const trustBadge = path.isManual
        ? `<span style="background: rgba(168, 85, 247, 0.2); color: #a855f7; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: bold;">MANUAL TRUST</span>`
        : `<span style="background: rgba(34, 197, 94, 0.2); color: #22c55e; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem;">Natural Habit (${path.visits} visits)</span>`;

      return `
            <div class="item">
                <div>
                    <div style="font-size: 0.85rem; font-weight: bold;">${path.source} → ${path.target}</div>
                    <div style="margin-top: 4px;">${trustBadge}</div>
                </div>
            </div>
        `;
    })
    .join("");
};

const renderCustomRules = () => {
  const container = document.getElementById("custom-rules-container");
  if (!container) return;
  chrome.storage.local.get("userCustomRules", (result) => {
    const rules = result.userCustomRules || {};
    const hostnames = Object.keys(rules);

    if (hostnames.length === 0) {
      container.innerHTML = `<p style="color: #64748b; font-size: 0.8rem; font-style: italic;">No custom rules found yet.</p>`;
      return;
    }

    container.innerHTML = hostnames
      .map((hostname) => {
        const domainRules = rules[hostname];
        const detailsHtml = domainRules
          .map((rule, idx) => {
            const selector = typeof rule === "string" ? rule : rule.selector;
            const fingerprint =
              typeof rule === "object" && rule.fingerprint
                ? JSON.stringify(rule.fingerprint).replace(/"/g, "")
                : "Simple Selector";
            return `
                    <div style="padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.05); font-size: 0.75rem;">
                        <span style="color: #60a5fa;">#${idx + 1}:</span> <code style="background: rgba(0,0,0,0.2); padding: 2px 4px;">${selector}</code>
                        <div style="color: #64748b; margin-top: 2px; font-style: italic;">Signal: ${fingerprint}</div>
                    </div>
                `;
          })
          .join("");

        return `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div style="font-weight: bold; font-size: 0.95rem; color: #e2e8f0;">${hostname}</div>
                            <div style="font-size: 0.75rem; color: #64748b;">${domainRules.length} technical rules active</div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="toggle-details" style="background: rgba(255,255,255,0.05); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">Show Details</button>
                            <button class="btn-delete-rule" data-hostname="${hostname}" style="background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">Reset Site</button>
                        </div>
                    </div>
                    <div class="details-pane" style="display: none; margin-top: 12px; padding-top: 8px;">
                        ${detailsHtml}
                    </div>
                </div>
            `;
      })
      .join("");

    // Listeners for Delete
    document.querySelectorAll(".btn-delete-rule").forEach((btn) => {
      btn.onclick = async (e) => {
        const hostname = e.target.getAttribute("data-hostname");
        if (confirm(`Wipe all memory for ${hostname}?`)) {
          const currentRules = rules[hostname];
          const { siteResetHistory = {} } =
            await chrome.storage.local.get("siteResetHistory");

          // Archive the "mistake"
          siteResetHistory[hostname] = {
            oldRules: currentRules,
            timestamp: Date.now(),
          };

          delete rules[hostname];
          await chrome.storage.local.set({
            userCustomRules: rules,
            siteResetHistory: siteResetHistory,
          });
          renderCustomRules();
        }
      };
    });

    // Listeners for Toggle
    document.querySelectorAll(".toggle-details").forEach((btn) => {
      btn.onclick = (e) => {
        const pane = e.target.closest("div").parentElement.nextElementSibling;
        const isHidden = pane.style.display === "none";
        pane.style.display = isHidden ? "block" : "none";
        e.target.textContent = isHidden ? "Hide Details" : "Show Details";
      };
    });
  });
};

const safeText = (value) => {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const formatPct = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
};

const renderDomSamples = async () => {
  if (!domSamplesEl) return;

  const { domTrainingSamples = [] } =
    await chrome.storage.local.get("domTrainingSamples");
  if (!Array.isArray(domTrainingSamples) || domTrainingSamples.length === 0) {
    domSamplesEl.innerHTML = '<div class="empty-msg">No DOM samples yet.</div>';
    return;
  }

  const latestSamples = [...domTrainingSamples]
    .sort((a, b) => (b.captured_at || 0) - (a.captured_at || 0))
    .slice(0, 80);

  domSamplesEl.innerHTML = latestSamples
    .map((sample) => {
      const features = sample.evidence?.features || {};
      const reasons = sample.evidence?.reasons || [];
      const selector =
        sample.element?.selector ||
        sample.element?.path ||
        features.selector ||
        "unknown selector";
      const label = sample.label || "unknown";
      const labelSource = sample.label_source || "unknown";
      const action = sample.action || sample.outcome || "observe";
      const site =
        sample.site?.hostname ||
        sample.context?.page_host ||
        sample.site?.url ||
        sample.context?.url ||
        "unknown site";
      const confidence =
        sample.context?.confidence ??
        sample.outcome?.confidence ??
        sample.evidence?.confidence;
      const capturedAtMs = sample.captured_at || sample.timestamp;
      const capturedAt = capturedAtMs
        ? new Date(capturedAtMs).toLocaleString()
        : "unknown time";
      const featureSummary = [
        features.tag ? `tag:${features.tag}` : "",
        features.id ? `id:${features.id}` : "",
        features.className ? `class:${features.className}` : "",
        features.srcHost ? `src:${features.srcHost}` : "",
        features.hrefHost ? `href:${features.hrefHost}` : "",
        features.areaRatio ? `area:${formatPct(features.areaRatio)}` : "",
      ].filter(Boolean);

      const reasonChips = reasons
        .slice(0, 8)
        .map((reason) => `<span class="sample-chip">${safeText(reason)}</span>`)
        .join("");
      const featureChips = featureSummary
        .slice(0, 8)
        .map(
          (feature) => `<span class="sample-chip">${safeText(feature)}</span>`,
        )
        .join("");

      return `
            <div class="item sample-row">
                <div style="display: flex; width: 100%; justify-content: space-between; gap: 0.75rem;">
                    <div style="font-weight: 700; color: ${label === "ad" ? "#f87171" : "#22c55e"};">${safeText(label.toUpperCase())}</div>
                    <div style="font-size: 0.72rem; color: #64748b;">${safeText(capturedAt)}</div>
                </div>
                <div style="font-family: monospace; font-size: 0.76rem; word-break: break-all; color: #e2e8f0;">${safeText(selector)}</div>
                <div style="font-size: 0.72rem; color: #94a3b8; word-break: break-all;">${safeText(site)} | ${safeText(labelSource)} | ${safeText(action)} | ${formatPct(confidence)}</div>
                <div class="sample-meta">${reasonChips || '<span class="sample-chip">no reasons</span>'}</div>
                <div class="sample-meta">${featureChips || '<span class="sample-chip">no feature summary</span>'}</div>
            </div>
        `;
    })
    .join("");
};

const exportDomSamples = async () => {
  const { domTrainingSamples = [] } =
    await chrome.storage.local.get("domTrainingSamples");
  if (!Array.isArray(domTrainingSamples) || domTrainingSamples.length === 0) {
    alert("No DOM samples to export yet.");
    return;
  }

  const jsonl = domTrainingSamples
    .map((sample) => JSON.stringify(sample))
    .join("\n");
  const blob = new Blob([jsonl], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "adsfriendly-dom-samples.jsonl";
  link.click();
  URL.revokeObjectURL(url);
};

const clearDomSamples = async () => {
  if (!confirm("Clear all local DOM training samples?")) return;
  await chrome.storage.local.set({ domTrainingSamples: [] });
  renderDomSamples();
};

function renderList(list, element, type) {
  if (list.length === 0) {
    element.innerHTML = '<div class="empty-msg">No sites added yet</div>';
    return;
  }

  element.innerHTML = "";
  list.forEach((domain) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
            <span>${domain}</span>
            <button class="btn-delete" data-domain="${domain}" data-type="${type}">
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
        `;
    element.appendChild(item);
  });

  element.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.onclick = async () => {
      const ruleOrDomain = btn.getAttribute("data-domain");
      const typ = btn.getAttribute("data-type").toLowerCase();
      const data = await chrome.storage.local.get([typ]);
      const updated = data[typ].filter((d) => d !== ruleOrDomain);
      await chrome.storage.local.set({ [typ]: updated });
      loadLists();
    };
  });
}

resetBtn.onclick = async () => {
  if (
    confirm("DANGER: Wipe EVERYTHING? (Whitelist, Rules, AI Memory, History)")
  ) {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      appSettings: {
        enabled: true,
        protectionMode: "safe",
        featureOverrides: {},
      },
      isEnabled: true,
      friendlyMode: true,
      blockedCount: 0,
    });
    chrome.action.setBadgeText({ text: "" });
    loadLists();
  }
};

// Feedback Logic
const feedbackForm = document.getElementById("feedback-form");
const fbStatus = document.getElementById("fb-status");
const fbSubmit = document.getElementById("fb-submit");
const COOLDOWN_MS = 3600000;

if (feedbackForm) {
  feedbackForm.onsubmit = async (e) => {
    e.preventDefault();
    const body = document.getElementById("fb-body").value.trim();
    const rating = document.querySelector('input[name="rating"]:checked').value;

    if (body.length < 1) {
      fbStatus.style.display = "block";
      fbStatus.style.color = "var(--danger)";
      fbStatus.textContent = "Please enter your feedback.";
      return;
    }

    if (!confirm("Send your feedback?")) return;

    const { lastFeedbackTime = 0 } = await chrome.storage.local.get([
      "lastFeedbackTime",
    ]);
    if (Date.now() - lastFeedbackTime < COOLDOWN_MS) {
      fbStatus.style.display = "block";
      fbStatus.textContent = "Please wait a bit before sending feedback again.";
      return;
    }

    // RESTORED: Production Cloudflare Worker URL
    const WORKER_URL =
      "https://telegarmworker.ngoquangvy97.workers.dev/adsfriendly";

    fbSubmit.disabled = true;
    fbStatus.style.display = "block";
    fbStatus.style.color = "#94a3b8";
    fbStatus.textContent = "Sending...";

    try {
      await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, rating: parseInt(rating) }),
      });
      fbStatus.style.color = "#22c55e";
      fbStatus.textContent = "Sent successfully. Thank you!";
      feedbackForm.reset();
      await chrome.storage.local.set({ lastFeedbackTime: Date.now() });
    } catch (err) {
      fbStatus.style.color = "var(--danger)";
      fbStatus.textContent = "Error: " + err.message;
    } finally {
      fbSubmit.disabled = false;
    }
  };
}

if (domRefreshBtn) {
  domRefreshBtn.onclick = renderDomSamples;
}

if (domExportBtn) {
  domExportBtn.onclick = exportDomSamples;
}

if (domClearBtn) {
  domClearBtn.onclick = clearDomSamples;
}

loadLists();
