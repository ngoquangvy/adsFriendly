import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createDownloadsSection } from "../src/options/downloads-section.js";
import { createDownloadHistoryList } from "../src/options/downloads/history-list.js";

const require = createRequire(
  new URL("../packages/media-helper/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fixture(t) {
  const dom = new JSDOM(`<button id="btn-download-refresh"></button>
    <button id="btn-download-clear"></button>
    <select id="media-download-connections"><option>8</option><option>12</option></select>
    <div id="download-manager-status"></div><div id="download-job-manager"></div>`);
  const { window } = dom;
  const { document } = window;
  let active = true;
  let confirmation = true;
  let jobs = [];
  let custom = null;
  const messages = [],
    connections = [],
    errors = [];
  const capabilities = { "output.open": true, "output.reveal": true };
  window.confirm = () => confirmation;
  const section = createDownloadsSection({
    document,
    window,
    chrome: {
      runtime: {
        sendMessage: async (message) => {
          messages.push(message);
          if (custom) return custom(message);
          if (message.type === "GET_MEDIA_DOWNLOAD_JOBS")
            return { items: structuredClone(jobs) };
          if (message.type === "GET_MEDIA_HELPER_STATUS")
            return { status: "ready", capabilities };
          return {
            status:
              message.type.includes("REMOVE") || message.type.includes("CLEAR")
                ? "removed"
                : message.type.includes("OPEN") ||
                    message.type.includes("REVEAL")
                  ? "opened"
                  : "started",
          };
        },
      },
    },
    isActive: () => active,
    updateFilters: () => section.updateViewport(),
    saveConnections: (value) => connections.push(value),
    onError: (error) => errors.push(error),
  });
  t.after(() => {
    section.stop();
    dom.window.close();
  });
  return {
    document,
    window,
    section,
    messages,
    connections,
    errors,
    capabilities,
    setJobs: (value) => {
      jobs = value;
    },
    setActive: (value) => {
      active = value;
    },
    setConfirm: (value) => {
      confirmation = value;
    },
    setHandler: (value) => {
      custom = value;
    },
    status: () =>
      document.getElementById("download-manager-status").textContent,
    button: (label) =>
      [...document.querySelectorAll("button")].find(
        (node) => node.textContent === label,
      ),
  };
}

test("Downloads binding is idempotent, saves the global connection choice once and cleans up", async (t) => {
  const f = fixture(t);
  f.section.bind();
  f.section.bind();
  const select = f.document.getElementById("media-download-connections");
  select.value = "12";
  select.dispatchEvent(new f.window.Event("change"));
  await tick();
  assert.deepEqual(f.connections, [12]);
  f.section.stop();
  select.dispatchEvent(new f.window.Event("change"));
  f.document.getElementById("btn-download-refresh").click();
  await tick();
  assert.deepEqual(f.connections, [12]);
  assert.equal(f.messages.length, 0);
});

test("hidden Downloads performs no reads and late/older responses cannot overwrite current rows", async (t) => {
  const f = fixture(t);
  f.setActive(false);
  await f.section.render();
  f.section.scheduleRefresh();
  assert.equal(f.messages.length, 0);
  f.setActive(true);
  let first;
  let count = 0;
  f.setHandler((message) => {
    if (message.type === "GET_MEDIA_HELPER_STATUS")
      return { status: "ready", capabilities: {} };
    if (++count === 1)
      return new Promise((resolve) => {
        first = resolve;
      });
    return { items: [{ id: "new", title: "New result", status: "completed" }] };
  });
  const pending = f.section.render();
  await f.section.render();
  first({ items: [{ id: "old", title: "Old result", status: "completed" }] });
  await pending;
  assert.equal(
    f.document.querySelector(".download-history-item").dataset.jobId,
    "new",
  );
  let reject;
  f.setHandler(
    () =>
      new Promise((_, failure) => {
        reject = failure;
      }),
  );
  const failed = f.section.render();
  f.section.stop();
  const before = f.status();
  reject(new Error("late failure"));
  await failed;
  assert.equal(f.status(), before);
});

test("progress updates preserve action nodes, expanded errors and completed compact size", async (t) => {
  const f = fixture(t);
  const active = {
    id: "live",
    title: "Live",
    status: "downloading",
    progress: { downloadedBytes: 10, totalBytes: 100, resumable: true },
  };
  const failed = {
    id: "failed",
    title: "Broken",
    status: "failed",
    error: "Full detailed error",
  };
  const done = {
    id: "done",
    title: "Finished",
    status: "completed",
    outputPath: "C:/Downloads/finished.mp4",
    progress: {
      downloadedBytes: 10000,
      totalBytes: 10000,
      bytesPerSecond: 2000,
    },
  };
  f.setJobs([done, failed, active]);
  await f.section.render();
  assert.equal(
    f.document.querySelector(".download-history-item").dataset.jobId,
    "live",
  );
  const pause = f.button("Pause");
  assert.ok(pause);
  f.button("Show details").click();
  await tick();
  active.progress.downloadedBytes = 20;
  await f.section.render();
  assert.equal(f.button("Pause"), pause);
  assert.equal(
    f.document.querySelector('[data-job-id="failed"] .download-error-details')
      .hidden,
    false,
  );
  const completed = f.document.querySelector('[data-job-id="done"]');
  assert.equal(
    completed.querySelector(".download-progress-track").hidden,
    true,
  );
  assert.doesNotMatch(completed.textContent, /Speed|connections/);
  assert.match(completed.textContent, /KB/);
});

test("Open and Folder route the correct job and become usable again after success", async (t) => {
  const f = fixture(t);
  f.setJobs([
    {
      id: "done",
      title: "Done",
      status: "completed",
      outputPath: "C:/Downloads/file.mp4",
    },
  ]);
  await f.section.render();
  for (const [label, type] of [
    ["Open", "OPEN_MEDIA_DOWNLOAD_OUTPUT"],
    ["Folder", "REVEAL_MEDIA_DOWNLOAD_OUTPUT"],
  ]) {
    const button = f.button(label);
    button.click();
    await tick();
    await tick();
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, label);
    assert.ok(
      f.messages.some(
        (message) => message.type === type && message.jobId === "done",
      ),
    );
  }
});

test("Pause, Resume, Retry and Cancel dispatch through the existing job actions", async (t) => {
  const f = fixture(t);
  for (const [status, label, type] of [
    ["downloading", "Pause", "PAUSE_MEDIA_DOWNLOAD_JOB"],
    ["paused", "Resume", "RESUME_MEDIA_DOWNLOAD_JOB"],
    ["failed", "Retry", "RETRY_MEDIA_DOWNLOAD_JOB"],
    ["probing", "Cancel", "CANCEL_MEDIA_DOWNLOAD_JOB"],
  ]) {
    f.setJobs([
      {
        id: status,
        title: status,
        status,
        progress: { resumable: status !== "probing" },
      },
    ]);
    await f.section.render();
    const button = f.button(label);
    assert.ok(button, label);
    button.click();
    await tick();
    await tick();
    assert.ok(
      f.messages.some(
        (message) => message.type === type && message.jobId === status,
      ),
      type,
    );
  }
});

test("removing entries and clearing history require confirmation, never request deleting files", async (t) => {
  const f = fixture(t);
  f.section.bind();
  f.setJobs([{ id: "done", status: "completed", title: "Done" }]);
  await f.section.render();
  f.setConfirm(false);
  f.button("Remove").click();
  f.document.getElementById("btn-download-clear").click();
  await tick();
  assert.ok(!f.messages.some((message) => /REMOVE|CLEAR/.test(message.type)));
  f.setConfirm(true);
  f.button("Remove").click();
  await tick();
  await tick();
  f.document.getElementById("btn-download-clear").click();
  await tick();
  await tick();
  assert.ok(
    f.messages.some(
      (message) =>
        message.type === "REMOVE_MEDIA_DOWNLOAD_HISTORY" &&
        message.jobId === "done",
    ),
  );
  assert.ok(
    f.messages.some(
      (message) => message.type === "CLEAR_MEDIA_DOWNLOAD_HISTORY",
    ),
  );
  assert.ok(!f.messages.some((message) => /DELETE/.test(message.type)));
});

test("history scrolling counts visible rows and does not change delete targets", (t) => {
  const f = fixture(t);
  const list = createDownloadHistoryList({
    document: f.document,
    window: f.window,
    actionButton: () => f.document.createElement("button"),
  });
  list.render(
    Array.from({ length: 16 }, (_, index) => ({
      id: String(index),
      status: "completed",
    })),
    {},
  );
  list.updateViewport();
  const container = f.document.getElementById("download-job-manager");
  assert.ok(container.classList.contains("is-scrollable"));
  container.firstElementChild.hidden = true;
  list.updateViewport();
  assert.ok(!container.classList.contains("is-scrollable"));
  assert.equal(container.children[15].dataset.jobId, "15");
});

test("full errors copy without truncation and failed output actions recover their button", async (t) => {
  const f = fixture(t);
  const error = "Full details\n" + "segment diagnostic ".repeat(300);
  const copied = [];
  Object.defineProperty(f.window.navigator, "clipboard", {
    value: { writeText: async (text) => copied.push(text) },
  });
  f.setJobs([{ id: "broken", status: "failed", title: "Broken", error }]);
  await f.section.render();
  f.button("Copy error").click();
  await tick();
  assert.deepEqual(copied, [error]);
  f.setJobs([
    {
      id: "done",
      status: "completed",
      title: "Done",
      outputPath: "C:/Downloads/done.mp4",
    },
  ]);
  await f.section.render();
  const open = f.button("Open");
  f.setHandler(async (message) => {
    if (message.type === "OPEN_MEDIA_DOWNLOAD_OUTPUT")
      throw new Error("Native output unavailable");
    throw new Error("Unexpected refresh");
  });
  open.click();
  await tick();
  assert.equal(open.disabled, false);
  assert.equal(open.textContent, "Open");
  assert.match(f.status(), /Action failed.*Native output unavailable/);
});
