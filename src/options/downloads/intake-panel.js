import { DOWNLOAD_INTAKE_MESSAGES } from "../../downloads/intake-contract.js";
import {
  describeDownloadIntake,
  describeDownloadObserver,
  buildDownloadIntakeDiagnosticReport,
} from "../../downloads/intake-diagnostics.js";
import { formatBytes } from "../../media/download-job-view.js";
import { createFileTransferView } from "./file-transfer-view.js";

// Observation presentation delegates explicit transfer controls to a separate
// view. Chrome ownership decisions remain in the background coordinator.
export function createDownloadIntakePanel({
  document,
  window = document.defaultView,
  chrome,
  isActive,
  getEnabled = () => false,
  saveEnabled,
  getAutoCheckEnabled = () => false,
  saveAutoCheckEnabled = async () => {},
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
  const copy = $("browser-download-intake-copy");
  const autoToggle = $("browser-file-auto-check");
  let lastSnapshot = null;
  const files = createFileTransferView({
    document,
    window,
    chrome,
    refresh: render,
    onError: showError,
  });
  function showError(error) {
    if (!disposed)
      status.textContent =
        error?.message || "Browser download observation unavailable.";
  }
  async function render() {
    if (disposed || !isActive()) return;
    const request = ++revision;
    toggle.checked = getEnabled();
    if (autoToggle) autoToggle.checked = getAutoCheckEnabled();
    try {
      const snapshot = await chrome.runtime.sendMessage({
        type: DOWNLOAD_INTAKE_MESSAGES.GET,
      });
      if (disposed || !isActive() || request !== revision) return;
      lastSnapshot = snapshot || { status: "unavailable" };
      if (copy) copy.disabled = false;
      const observer = describeDownloadObserver(lastSnapshot);
      status.textContent = observer.label;
      const list = $("browser-download-observations");
      const existing = new Map(
        [...list.querySelectorAll(".browser-download-observation")].map(
          (row) => [Number(row.dataset.browserId), row],
        ),
      );
      list.querySelector(".empty-msg")?.remove();
      const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
      $("browser-download-intake-clear").disabled = !items.length;
      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "empty-msg";
        empty.textContent = observer.empty;
        list.append(empty);
      }
      for (const [index, item] of items.entries()) {
        let row = existing.get(item.id);
        if (!row) {
          row = document.createElement("article");
          row.className = "browser-download-observation";
          row.dataset.browserId = item.id;
          row.append(
            document.createElement("strong"),
            Object.assign(document.createElement("span"), {
              className: "browser-download-detection",
            }),
            document.createElement("div"),
            document.createElement("small"),
          );
        }
        const title = row.querySelector("strong");
        title.textContent = item.filename || "Unnamed file";
        const details = row.querySelector("div");
        details.textContent = [
          item.host || "Browser-local source",
          item.totalBytes === null
            ? "Size unavailable"
            : formatBytes(item.totalBytes),
          item.state,
        ]
          .filter(Boolean)
          .join(" · ");
        const reason = row.querySelector("small");
        const diagnostic = describeDownloadIntake(item, snapshot);
        row.dataset.detection = diagnostic.code;
        const detection = row.querySelector(".browser-download-detection");
        detection.textContent = diagnostic.label;
        detection.dataset.tone = diagnostic.tone;
        reason.textContent = diagnostic.detail;
        files.observation(row, item, snapshot);
        if (list.children[index] !== row)
          list.insertBefore(row, list.children[index] || null);
        existing.delete(item.id);
      }
      for (const row of existing.values()) row.remove();
      files.render(snapshot);
    } catch (error) {
      if (request === revision && isActive()) {
        lastSnapshot = null;
        if (copy) copy.disabled = true;
        showError(error);
      }
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
  async function changeAutomaticChecks() {
    if (disposed || !autoToggle || autoToggle.disabled) return;
    const wanted = autoToggle.checked;
    autoToggle.disabled = true;
    try {
      if (
        wanted &&
        !(await chrome.permissions.request({
          permissions: ["downloads", "nativeMessaging"],
        }))
      )
        throw Error("Helper permission not granted. Downloads stay in Chrome.");
      if (disposed) return;
      // Observation remains a separate explicit switch; importing this setting
      // cannot grant permission or scan old Chrome history.
      await saveAutoCheckEnabled(wanted);
      await render();
    } catch (error) {
      autoToggle.checked = getAutoCheckEnabled();
      showError(error);
    } finally {
      autoToggle.disabled = false;
    }
  }
  async function copyDiagnostics() {
    if (disposed || !lastSnapshot || !isActive()) return;
    try {
      const report = JSON.stringify(
        buildDownloadIntakeDiagnosticReport(lastSnapshot),
        null,
        2,
      );
      if (window.navigator.clipboard?.writeText)
        await window.navigator.clipboard.writeText(report);
      else {
        const field = document.createElement("textarea");
        field.value = report;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        try {
          field.select();
          if (!document.execCommand("copy"))
            throw Error("Could not copy diagnostics.");
        } finally {
          field.remove();
        }
      }
      if (!disposed)
        status.textContent =
          "Diagnostics copied · includes filenames and hosts, not source URLs or tokens.";
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
    copy?.addEventListener("click", copyDiagnostics);
    autoToggle?.addEventListener("change", changeAutomaticChecks);
    chrome.permissions?.onAdded?.addListener(scheduleRefresh);
    chrome.permissions?.onRemoved?.addListener(scheduleRefresh);
  }
  function stop() {
    disposed = true;
    files.stop();
    ++revision;
    clearTimeout(timer);
    toggle.removeEventListener("change", change);
    $("browser-download-intake-refresh").removeEventListener("click", refresh);
    $("browser-download-intake-clear").removeEventListener("click", clear);
    copy?.removeEventListener("click", copyDiagnostics);
    autoToggle?.removeEventListener("change", changeAutomaticChecks);
    chrome.permissions?.onAdded?.removeListener(scheduleRefresh);
    chrome.permissions?.onRemoved?.removeListener(scheduleRefresh);
  }
  return { bind, render, scheduleRefresh, stop };
}
