import { DOWNLOAD_INTAKE_MESSAGES } from "../../downloads/intake-contract.js";
import { INTAKE_REASON_LABELS } from "../../downloads/intake-policy.js";
import { formatBytes } from "../../media/download-job-view.js";

// Observation-only controls. No transfer or browser-cancel action exists here.
export function createDownloadIntakePanel({
  document,
  chrome,
  isActive,
  getEnabled = () => false,
  saveEnabled,
}) {
  const $ = (id) => document.getElementById(id);
  const toggle = $("browser-download-observe");
  if (!toggle)
    return {
      bind() {},
      render: async () => {},
      scheduleRefresh() {},
      stop() {},
    };
  let disposed = false,
    revision = 0,
    timer = null,
    bound = false,
    busy = false;
  const status = $("browser-download-intake-status");
  function showError(error) {
    if (!disposed)
      status.textContent =
        error?.message || "Browser download observation unavailable.";
  }
  async function render() {
    if (disposed || !isActive()) return;
    const request = ++revision;
    toggle.checked = getEnabled();
    try {
      const snapshot = await chrome.runtime.sendMessage({
        type: DOWNLOAD_INTAKE_MESSAGES.GET,
      });
      if (disposed || !isActive() || request !== revision) return;
      const labels = {
        off: "Off · downloads continue in Chrome",
        starting: "Starting browser download observation…",
        observing: "Observation only · downloads stay in Chrome",
        permission_required:
          "Downloads permission required · downloads stay in Chrome",
      };
      status.textContent =
        (labels[snapshot?.status] ||
          "Observer unavailable · reload the extension") +
        (snapshot?.storageFailed ? " · Session storage unavailable" : "");
      const list = $("browser-download-observations");
      list.replaceChildren();
      const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
      $("browser-download-intake-clear").disabled = !items.length;
      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "empty-msg";
        empty.textContent =
          "No new browser downloads observed. Existing Chrome history is not scanned.";
        list.append(empty);
      }
      for (const item of items) {
        const row = document.createElement("article");
        row.className = "browser-download-observation";
        const title = document.createElement("strong");
        title.textContent = item.filename || "Unnamed file";
        const details = document.createElement("div");
        details.textContent = [
          item.host || "Browser-local source",
          item.totalBytes === null
            ? "Size unavailable"
            : formatBytes(item.totalBytes),
          item.state,
        ]
          .filter(Boolean)
          .join(" · ");
        const reason = document.createElement("small");
        reason.textContent =
          INTAKE_REASON_LABELS[item.assessment?.reason] ||
          "Request not verified · keep in Chrome";
        row.append(title, details, reason);
        list.append(row);
      }
    } catch (error) {
      if (request === revision && isActive()) showError(error);
    }
  }
  function scheduleRefresh() {
    if (disposed || !isActive() || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void render();
    }, 250);
  }
  async function change() {
    if (disposed || busy) return;
    busy = true;
    toggle.disabled = true;
    const wanted = toggle.checked;
    try {
      // Call directly in the click/change activation, before any settings await.
      if (
        wanted &&
        !(await chrome.permissions.request({ permissions: ["downloads"] }))
      ) {
        toggle.checked = getEnabled();
        status.textContent =
          "Permission not granted · downloads continue in Chrome";
        return;
      }
      if (disposed) return;
      await saveEnabled(wanted);
      await render();
    } catch (error) {
      toggle.checked = getEnabled();
      showError(error);
    } finally {
      busy = false;
      toggle.disabled = false;
    }
  }
  async function clear() {
    try {
      const result = await chrome.runtime.sendMessage({
        type: DOWNLOAD_INTAKE_MESSAGES.CLEAR,
      });
      if (result?.status !== "cleared")
        throw Error("Could not clear observation metadata.");
      await render();
    } catch (error) {
      showError(error);
    }
  }
  const refresh = () => {
    void render();
  };
  function bind() {
    if (disposed || bound) return;
    bound = true;
    toggle.addEventListener("change", change);
    $("browser-download-intake-refresh").addEventListener("click", refresh);
    $("browser-download-intake-clear").addEventListener("click", clear);
    chrome.permissions?.onAdded?.addListener(scheduleRefresh);
    chrome.permissions?.onRemoved?.addListener(scheduleRefresh);
  }
  function stop() {
    disposed = true;
    ++revision;
    clearTimeout(timer);
    toggle.removeEventListener("change", change);
    $("browser-download-intake-refresh").removeEventListener("click", refresh);
    $("browser-download-intake-clear").removeEventListener("click", clear);
    chrome.permissions?.onAdded?.removeListener(scheduleRefresh);
    chrome.permissions?.onRemoved?.removeListener(scheduleRefresh);
  }
  return { bind, render, scheduleRefresh, stop };
}
