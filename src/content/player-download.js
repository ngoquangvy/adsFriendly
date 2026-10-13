import {
  resolvePlayerDownloadTarget,
  readPlayerSource as playerSource,
} from "../media/player-download-target.js";
import { createMediaDownloadControl } from "../media/ui/download-control.js";
import { playerDownloadPosition } from "../media/player-download-position.js";
import { createPlayerDownloadAttention } from "../media/ui/player-download-attention.js";
import { formatBytes, isMediaJobActive } from "../media/download-job-view.js";
import { loadSettings } from "../runtime/settings-store.js";
import { MEDIA_CATALOG_SESSION_PREFIX } from "../media/storage-keys.js";
import { DOWNLOAD_JOB_PREFIX } from "../media/download-job-contract.js";

export function startPlayerDownload({ shadowMode = "closed" } = {}) {
  const players = new Map();
  const preflightCache = new Map();
  let stopped = false;
  let refreshing = false;
  let refreshingJobs = false;
  let snapshot = null;
  let chosenVideo = null;
  let nextOverlay = 0;
  let openEntry = null;
  const make = (video) => {
    const host = document.createElement("div");
    host.hidden = true;
    host.id = `adsfriendly-player-download-${nextOverlay++}`;
    host.dataset.adsfriendlyUi = "player-download";
    const shadow = host.attachShadow({ mode: shadowMode });
    shadow.innerHTML = `<style>
      :host{position:fixed;z-index:2147483646;display:block;font:13px system-ui;color:#e2e8f0;pointer-events:none}:host([hidden]){display:none!important}
      *{box-sizing:border-box}button,select{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.65}
      .launcher{display:flex;align-items:center;gap:2px;width:max-content;margin:auto;padding:2px;border:1px solid #64748b;background:#172033ed;border-radius:18px;box-shadow:0 2px 6px #0005;pointer-events:auto;opacity:.4;transition:opacity .3s ease}
      :host([data-notice]) .launcher,:host([data-open]) .launcher,.launcher:hover,.launcher:has(:focus-visible){opacity:1}.launcher:hover .dismiss,.launcher:has(:focus-visible) .dismiss{opacity:1}.launch{display:flex;align-items:center;gap:6px;min-height:28px;border:0;background:transparent;color:#e2e8f0;border-radius:14px;padding:2px 8px 2px 3px;font-size:12px}.launch:hover{background:#334155}.brand{display:block;width:24px;height:24px;border-radius:6px;pointer-events:none}
      .dismiss,.close{display:grid;place-items:center;flex-shrink:0;width:28px;height:28px;border:1px solid #475569;background:#1e293b;color:#cbd5e1;border-radius:50%;font-size:18px;line-height:1;opacity:.7;transition:opacity .15s ease,background .15s ease}.dismiss{margin-right:2px}.dismiss:hover,.dismiss:focus-visible,.close:hover,.close:focus-visible{opacity:1;background:#475569;color:#fff}.launch:focus-visible,.dismiss:focus-visible,.close:focus-visible{outline:2px solid #86efac;outline-offset:2px}
      @media(hover:none){.dismiss,.close{opacity:1}.launch,.dismiss,.close{min-height:36px}.dismiss,.close{min-width:36px}}@media(prefers-reduced-motion:reduce){.launcher,.dismiss,.close{transition:none}}
      .panel{pointer-events:auto;margin-top:6px;background:#0f172af5;border:1px solid #475569;border-radius:12px;padding:12px;box-shadow:0 6px 24px #0007;max-height:300px;overflow:auto}
      [hidden]{display:none!important}.heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
      .media-download-control{display:flex;flex-direction:column;gap:8px}.media-download-profile{width:100%;background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:6px;padding:7px;font-size:12px}.media-download{background:#166534;color:#dcfce7;border:1px solid #22c55e;border-radius:6px;padding:7px}.media-download-estimate{font-size:12px;color:#93c5fd}.manager{margin-top:8px;background:transparent;color:#93c5fd;border:0;padding:4px 0;font-size:12px}
      .quick-open{border:0;background:transparent;color:#86efac;padding:4px;font-size:12px;border-radius:8px}.quick-open:hover{background:#334155}.media-download-history{display:flex;flex-direction:column;gap:6px;font-size:12px}.media-download-history strong{color:#86efac}.media-download-history-actions{display:flex;flex-wrap:wrap;gap:6px}.media-download-history-actions button{border:1px solid #475569;border-radius:6px;background:#1e293b;color:#e2e8f0;padding:6px;font-size:12px}
    </style><div class="launcher"><button class="launch" type="button" title="AdsFriendly · Download this video" aria-label="Download this video" aria-expanded="false"><img class="brand" alt="" aria-hidden="true"><span class="launch-label">↓ Download</span></button><button class="quick-open" hidden type="button" title="Open downloaded file">Open</button><button class="dismiss" type="button" title="Hide this button for this video · downloads keep running" aria-label="Hide download button for this video">×</button></div><section class="panel" hidden aria-label="Video download options"><div class="heading"><span class="title"></span><button class="close" type="button" title="Close download options" aria-label="Close download options">×</button></div><div class="controls"></div><button class="manager">Download Manager</button></section>`;
    shadow.querySelector(".brand").src =
      chrome.runtime.getURL("icons/icon48.png");
    const entry = {
      video,
      host,
      shadow,
      target: null,
      source: null,
      controlKey: null,
      opening: false,
      dismissedSource: null,
      controller: null,
      output: null,
      context: null,
      revision: 0,
      checkedCompletion: null,
      contextRequest: 0,
      attention: createPlayerDownloadAttention({
        onNotice: (active) => host.toggleAttribute("data-notice", active),
      }),
    };
    shadow
      .querySelector(".quick-open")
      .addEventListener("click", async (event) => {
        if (!event.isTrusted) return;
        const job = entry.context?.latestJob;
        if (!job || entry.source !== playerSource(video)) return;
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const result = await chrome.runtime.sendMessage({
            type: "OPEN_MEDIA_DOWNLOAD_OUTPUT",
            jobId: job.id,
          });
          if (result?.status !== "opened")
            button.title = result?.error || "Could not open saved file.";
        } catch (error) {
          button.title = error?.message || "Could not open saved file.";
        } finally {
          button.disabled = false;
        }
      });
    shadow
      .querySelector(".launch")
      .addEventListener("click", () => void toggle(entry));
    shadow.querySelector(".close").addEventListener("click", () => {
      close(entry);
      shadow.querySelector(".launch").focus({ preventScroll: true });
    });
    shadow.querySelector(".dismiss").addEventListener("click", () => {
      entry.dismissedSource = entry.source;
      close(entry);
      position();
      video.focus({ preventScroll: true });
    });
    shadow
      .querySelector(".manager")
      .addEventListener("click", () => void openManager());
    shadow.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(entry);
        shadow.querySelector(".launch").focus();
      }
    });
    players.set(video, entry);
    document.documentElement.append(host);
    return entry;
  };
  function close(entry) {
    entry.host.removeAttribute("data-open");
    entry.shadow.querySelector(".panel").hidden = true;
    entry.shadow
      .querySelector(".launch")
      .setAttribute("aria-expanded", "false");
    if (openEntry === entry) openEntry = null;
  }
  async function openManager() {
    await chrome.runtime
      .sendMessage({ type: "OPEN_PLAYER_DOWNLOAD_MANAGER" })
      .catch(() => {});
  }
  async function toggle(entry) {
    if (entry.opening) return;
    if (openEntry === entry) {
      close(entry);
      return;
    }
    if (openEntry) close(openEntry);
    entry.opening = true;
    const expectedSource = entry.source;
    try {
      const helper = await chrome.runtime.sendMessage({
        type: "GET_MEDIA_HELPER_STATUS",
      });
      if (
        stopped ||
        entry.dismissedSource === expectedSource ||
        !entry.video.isConnected ||
        expectedSource !== playerSource(entry.video)
      )
        return;
      const { presentation, candidate } = entry.target;
      await chrome.runtime.sendMessage({
        type: "SELECT_PLAYER_MEDIA",
        sourceUrl: expectedSource,
      });
      const { mediaDownloadUiPreferences = {} } =
        await chrome.storage.local.get("mediaDownloadUiPreferences");
      const settings = await loadSettings();
      if (
        stopped ||
        entry.dismissedSource === expectedSource ||
        expectedSource !== playerSource(entry.video) ||
        candidate.id !== entry.target?.candidate.id
      )
        return;
      const control = createMediaDownloadControl(
        presentation,
        candidate,
        snapshot.tab,
        helper || {},
        {
          settings,
          qualityPreflightCache: preflightCache,
          initialSelection: mediaDownloadUiPreferences,
          onController: (controller) => {
            entry.controller = controller;
          },
          onOutputChange: (output) => {
            if (
              entry.source !== expectedSource ||
              candidate.id !== entry.target?.candidate.id
            )
              return;
            entry.output = output;
            entry.revision++;
            void refreshEntryJobs(entry, true);
          },
          openManager,
          onSelectionChange: (preference) =>
            void chrome.storage.local
              .set({ mediaDownloadUiPreferences: preference })
              .catch(() => {}),
          setupMediaHelper: async (button) => {
            await openManager();
            button.disabled = false;
            button.textContent = "Set up helper";
          },
          onStarted: async () => {
            if (
              stopped ||
              entry.source !== expectedSource ||
              candidate.id !== entry.target?.candidate.id
            )
              return;
            entry.shadow.querySelector(".launch-label").textContent =
              "↓ Started";
            await refreshJobs();
          },
        },
      );
      entry.shadow.querySelector(".controls").replaceChildren(control);
      entry.shadow.querySelector(".title").textContent =
        presentation.title || "Download video";
      entry.shadow.querySelector(".panel").hidden = false;
      entry.host.setAttribute("data-open", "");
      entry.shadow
        .querySelector(".launch")
        .setAttribute("aria-expanded", "true");
      openEntry = entry;
      await refreshEntryJobs(entry, true);
      position();
    } catch (error) {
      entry.shadow.querySelector(".launch").title =
        error?.message || "Could not open download options. Try again.";
    } finally {
      entry.opening = false;
    }
  }
  function position() {
    if (document.hidden) return;
    const eligible = [...players.values()].filter((entry) => {
      const rect = entry.video.getBoundingClientRect();
      return (
        entry.video.isConnected &&
        rect.width >= 240 &&
        rect.height >= 120 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth &&
        getComputedStyle(entry.video).visibility !== "hidden" &&
        !entry.video.closest(
          '[data-ad],.ima-ad-container,.vast-ad,[aria-label="Advertisement"]',
        )
      );
    });
    const primary =
      eligible.find((entry) => entry.video === chosenVideo) ||
      eligible.sort((a, b) => {
        const ar = a.video.getBoundingClientRect();
        const br = b.video.getBoundingClientRect();
        return (
          br.width * br.height - ar.width * ar.height ||
          (Number.isFinite(b.video.duration) ? b.video.duration : 0) -
            (Number.isFinite(a.video.duration) ? a.video.duration : 0)
        );
      })[0];
    for (const entry of players.values()) {
      const rect = entry.video.getBoundingClientRect();
      const visible =
        entry === primary &&
        entry.target &&
        entry.dismissedSource !== entry.source &&
        rect.width >= 240 &&
        rect.height >= 120 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth &&
        getComputedStyle(entry.video).visibility !== "hidden";
      entry.host.hidden = !visible;
      entry.attention.setVisible(visible);
      if (!visible) {
        close(entry);
        continue;
      }
      const { width, left, top } = playerDownloadPosition(
        rect,
        innerWidth,
        entry.shadow.querySelector(".launcher").getBoundingClientRect().height,
      );
      entry.host.style.width = `${width}px`;
      entry.host.style.left = `${left}px`;
      entry.host.style.top = `${top}px`;
      const container = document.fullscreenElement || document.documentElement;
      if (!container.contains(entry.host) && !container.matches("video"))
        container.append(entry.host);
    }
  }
  async function refreshJobs() {
    if (
      stopped ||
      refreshingJobs ||
      document.hidden ||
      ![...players.values()].some((entry) => !entry.host.hidden)
    )
      return;
    refreshingJobs = true;
    try {
      await Promise.all(
        [...players.values()]
          .filter((entry) => !entry.host.hidden)
          .map((entry) => refreshEntryJobs(entry)),
      );
    } finally {
      refreshingJobs = false;
    }
  }
  async function refreshEntryJobs(entry, verifyFile = false) {
    const source = entry.source;
    const revision = entry.revision;
    if (!entry.target || stopped) return;
    const request = ++entry.contextRequest;
    let response = await chrome.runtime
      .sendMessage({
        type: "GET_PLAYER_DOWNLOAD_CONTEXT",
        sourceUrl: source,
        output: entry.output || {},
        verifyFile,
      })
      .catch(() => null);
    if (
      stopped ||
      request !== entry.contextRequest ||
      source !== playerSource(entry.video) ||
      source !== entry.source ||
      revision !== entry.revision ||
      response?.status !== "ok"
    )
      return;
    const completedJob =
      response.latestJob?.status === "completed" ? response.latestJob : null;
    const completionKey = completedJob
      ? `${completedJob.id}|${completedJob.updatedAt}`
      : null;
    if (
      !verifyFile &&
      completedJob?.fileStatus === "unchecked" &&
      completionKey !== entry.checkedCompletion
    ) {
      entry.checkedCompletion = completionKey;
      const checked = await chrome.runtime
        .sendMessage({
          type: "GET_PLAYER_DOWNLOAD_CONTEXT",
          sourceUrl: source,
          output: entry.output || {},
          verifyFile: true,
        })
        .catch(() => null);
      if (
        stopped ||
        request !== entry.contextRequest ||
        source !== playerSource(entry.video) ||
        source !== entry.source ||
        revision !== entry.revision
      )
        return;
      if (checked?.status === "ok") response = checked;
    }
    entry.context = response;
    const job = response.latestJob;
    const completed =
      job?.status === "completed" &&
      !["missing", "changed"].includes(job.fileStatus);
    entry.shadow.querySelector(".launch-label").textContent =
      job && isMediaJobActive(job)
        ? `↓ ${formatBytes(job.progress?.bytesPerSecond || 0)}/s`
        : completed
          ? "✓ Completed"
          : "↓ Download";
    entry.shadow.querySelector(".quick-open").hidden =
      !completed || !job.outputPath;
    entry.controller?.setHistory(response);
  }
  async function refresh() {
    if (stopped || refreshing || document.hidden) return;
    refreshing = true;
    try {
      const videos = [...document.querySelectorAll("video")];
      for (const [video, entry] of players)
        if (!videos.includes(video)) {
          entry.attention.dispose();
          close(entry);
          entry.host.remove();
          players.delete(video);
        }
      if (!videos.length) return;
      snapshot = await chrome.runtime.sendMessage({
        type: "GET_PLAYER_MEDIA_CONTEXT",
      });
      if (stopped) return;
      for (const video of videos) {
        const source = playerSource(video);
        const target = resolvePlayerDownloadTarget({
          sourceUrl: source,
          pageUrl: location.href,
          frameId: snapshot.frameId,
          items: snapshot.items,
        });
        let entry = players.get(video) || make(video);
        if (!target) {
          if (entry) {
            entry.target = null;
            entry.host.hidden = true;
            entry.attention.setVisible(false);
            close(entry);
          }
          continue;
        }
        if (
          source !== entry.source ||
          target.candidate.id !== entry.target?.candidate.id
        ) {
          close(entry);
          entry.attention.reset();
          if (source !== entry.source) entry.dismissedSource = null;
          entry.shadow.querySelector(".launch-label").textContent =
            "↓ Download";
          entry.shadow.querySelector(".quick-open").hidden = true;
          entry.controller = null;
          entry.context = null;
          entry.output = null;
          entry.checkedCompletion = null;
          entry.revision++;
        }
        entry.source = source;
        entry.target = target;
      }
      position();
      // Content scripts cannot rely on trusted-context-only session storage
      // events. Use the existing bounded poll to read progress via background.
      await refreshJobs();
    } catch {
    } finally {
      refreshing = false;
    }
  }
  const timer = setInterval(() => void refresh(), 2_000);
  const onStorage = (changes, area) => {
    if (area === "session") {
      if (
        Object.keys(changes).some((key) =>
          key.startsWith(MEDIA_CATALOG_SESSION_PREFIX),
        )
      )
        void refresh();
      if (
        Object.keys(changes).some((key) => key.startsWith(DOWNLOAD_JOB_PREFIX))
      )
        void refreshJobs();
    }
  };
  const onViewport = () => position();
  const onVisibility = () => {
    if (document.hidden) {
      for (const entry of players.values()) entry.attention.setVisible(false);
    } else {
      position();
      void refresh();
    }
  };
  const onMedia = () => {
    for (const entry of players.values())
      if (entry.source !== playerSource(entry.video)) {
        entry.target = null;
        entry.host.hidden = true;
        entry.attention.setVisible(false);
        close(entry);
      }
    void refresh();
  };
  const onPointer = (event) => {
    if (!event.isTrusted) return;
    const container = event.target.closest?.("video,.video-js,[data-player]");
    const video = container?.matches("video")
      ? container
      : container?.querySelector("video");
    if (video) {
      chosenVideo = video;
      position();
    }
  };
  chrome.storage.onChanged.addListener(onStorage);
  window.addEventListener("scroll", onViewport, true);
  window.addEventListener("resize", onViewport);
  document.addEventListener("fullscreenchange", onViewport);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("play", onMedia, true);
  document.addEventListener("loadstart", onMedia, true);
  document.addEventListener("emptied", onMedia, true);
  document.addEventListener("pointerdown", onPointer, true);
  void refresh();
  return () => {
    stopped = true;
    clearInterval(timer);
    chrome.storage.onChanged.removeListener(onStorage);
    window.removeEventListener("scroll", onViewport, true);
    window.removeEventListener("resize", onViewport);
    document.removeEventListener("fullscreenchange", onViewport);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("play", onMedia, true);
    document.removeEventListener("loadstart", onMedia, true);
    document.removeEventListener("emptied", onMedia, true);
    document.removeEventListener("pointerdown", onPointer, true);
    for (const entry of players.values()) {
      entry.attention.dispose();
      entry.host.remove();
    }
    players.clear();
  };
}
