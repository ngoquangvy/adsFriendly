import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../packages/media-helper/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");

// Runs the real Settings controller in a disposable DOM with in-memory Chrome
// APIs. Never opens native outputs, deletes real data or submits feedback.
test("Settings controller saves modes, keeps filtered delete targets and lazily reads active pages", async () => {
  const html = await readFile(
    new URL("../options/options.html", import.meta.url),
    "utf8",
  );
  const bundle = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/options/index.js", import.meta.url)),
    ],
    bundle: true,
    write: false,
    format: "iife",
    logLevel: "silent",
  });
  const dom = new JSDOM(html, {
    url: "https://fixture.test/options/options.html",
    runScripts: "outside-only",
  });
  const { window } = dom;
  const { document } = window;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const listeners = new Set();
  const messages = [];
  const store = {
    appSettings: {
      enabled: true,
      protectionMode: "assist",
      featureOverrides: { "dom.auto_hide": false },
    },
    whitelist: ["one.example", "two.example"],
    blacklist: ["ads.example"],
    userCustomRules: { "one.example": [".banner"] },
    userElementExceptions: {},
    blockedLogs: [],
  };
  const jobs = [
    {
      id: "active",
      title: "Demo video",
      status: "downloading",
      progress: {
        downloadedBytes: 10,
        totalBytes: 100,
        bytesPerSecond: 100,
        resumable: true,
      },
    },
  ];
  window.chrome = {
    permissions: { request: async () => true },
    storage: {
      local: {
        get: async (key) =>
          key == null
            ? structuredClone(store)
            : typeof key === "string"
              ? { [key]: structuredClone(store[key]) }
              : Object.fromEntries(
                  key.map((item) => [item, structuredClone(store[item])]),
                ),
        set: async (values) => {
          Object.assign(store, structuredClone(values));
        },
        remove: async (keys) => {
          for (const key of [].concat(keys)) delete store[key];
        },
      },
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
    runtime: {
      getManifest: () => ({ version: "test" }),
      sendMessage: async (message) => {
        messages.push(message);
        if (message.type === "GET_MEDIA_DOWNLOAD_JOBS")
          return { items: structuredClone(jobs) };
        if (message.type === "GET_BROWSER_DOWNLOAD_INTAKE")
          return { status: "off", items: [] };
        if (message.type === "GET_MEDIA_HELPER_STATUS")
          return {
            status: "ready",
            helperVersion: "test",
            capabilities: { "output.open": true, "output.reveal": true },
          };
        if (message.type === "REMOVE_DOMAIN_DECISION") {
          store[message.listName] = store[message.listName].filter(
            (domain) => domain !== message.domain,
          );
          return { status: "saved" };
        }
        if (message.type === "GET_STORAGE_HEALTH")
          return { status: "ok", unlimited: true, bytesInUse: 100 };
        if (message.type === "GET_NAVIGATION_DIAGNOSTICS")
          return { events: [] };
        throw new Error(`Unexpected request ${message.type}`);
      },
    },
  };
  const until = async (condition) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("Settings UI did not reach expected state");
  };
  try {
    window.eval(bundle.outputFiles[0].text);
    await until(
      () =>
        document.getElementById("protection-status").textContent ===
        "Assist · On",
    );
    assert.equal(
      messages.length,
      0,
      "initial page must not probe Helper or training/diagnostics",
    );
    const mode = document.getElementById("settings-mode");
    mode.value = "safe";
    mode.dispatchEvent(new window.Event("change"));
    await until(
      () =>
        document.getElementById("protection-status").textContent ===
        "Safe · On",
    );
    assert.equal(store.appSettings.protectionMode, "safe");
    assert.equal(store.appSettings.featureOverrides["dom.auto_hide"], false);
    window.location.hash = "sites";
    await until(
      () => document.querySelectorAll("#whitelist-list .item").length === 2,
    );
    const search = document.getElementById("sites-search");
    search.value = "two";
    search.dispatchEvent(new window.Event("input"));
    const visible = [
      ...document.querySelectorAll("#whitelist-list .item"),
    ].filter((row) => !row.hidden);
    assert.equal(visible.length, 1);
    visible[0].querySelector("button").click();
    await until(() => store.whitelist.length === 1);
    assert.deepEqual(store.whitelist, ["one.example"]);
    assert.equal(
      messages.find((message) => message.type === "REMOVE_DOMAIN_DECISION")
        .domain,
      "two.example",
    );
    window.location.hash = "downloads";
    await until(() => document.querySelector(".download-history-item"));
    const pause = [
      ...document.querySelectorAll(".download-history-controls button"),
    ].find((button) => button.textContent === "Pause");
    assert(pause);
    const intakeToggle = document.getElementById("browser-download-observe");
    intakeToggle.checked = true;
    intakeToggle.dispatchEvent(new window.Event("change"));
    await until(
      () =>
        store.appSettings.featureOverrides[
          "background.browser-download-observer"
        ] === true,
    );
    assert.equal(store.appSettings.featureOverrides["dom.auto_hide"], false);
    assert.equal(store.appSettings.protectionMode, "safe");
    assert.doesNotMatch(
      document.getElementById("browser-download-intake-status").textContent,
      /unavailable|Unexpected/,
    );
    const helperReads = messages.filter(
      (message) => message.type === "GET_MEDIA_HELPER_STATUS",
    ).length;
    for (const listener of listeners)
      listener({ "browserDownloadIntake.v1": {} }, "session");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      messages.filter((message) => message.type === "GET_MEDIA_HELPER_STATUS")
        .length,
      helperReads,
      "intake updates must not probe the Helper",
    );
    jobs[0].progress.downloadedBytes = 20;
    for (const listener of listeners)
      listener({ "adsfriendly.mediaDownloadJob.active": {} }, "session");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      [...document.querySelectorAll(".download-history-controls button")].find(
        (button) => button.textContent === "Pause",
      ),
      pause,
      "progress refresh must retain action nodes",
    );
    window.location.hash = "advanced";
    await until(() =>
      messages.some((message) => message.type === "GET_STORAGE_HEALTH"),
    );
    assert.equal(
      messages.some((message) => message.type === "GET_NAVIGATION_DIAGNOSTICS"),
      false,
    );
    const downloadReads = messages.filter(
      (message) => message.type === "GET_MEDIA_DOWNLOAD_JOBS",
    ).length;
    for (const listener of listeners)
      listener({ "adsfriendly.mediaDownloadJob.active": {} }, "session");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      messages.filter((message) => message.type === "GET_MEDIA_DOWNLOAD_JOBS")
        .length,
      downloadReads,
    );
    document.getElementById("diagnostics-details").open = true;
    await until(() =>
      messages.some((message) => message.type === "GET_NAVIGATION_DIAGNOSTICS"),
    );
    assert.equal(
      document.querySelectorAll(".settings-panel:not([hidden])").length,
      1,
    );
  } finally {
    window.dispatchEvent(new window.Event("unload"));
    dom.window.close();
  }
});
