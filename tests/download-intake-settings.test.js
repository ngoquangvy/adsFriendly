import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createDownloadIntakePanel } from "../src/options/downloads/intake-panel.js";
import { DOWNLOAD_INTAKE_MESSAGES } from "../src/downloads/intake-contract.js";
const require = createRequire(
  new URL("../packages/media-helper/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture(t) {
  const dom = new JSDOM(`<input type="checkbox" id="browser-download-observe">
    <div id="browser-download-intake-status"></div><div id="browser-download-observations"></div>
    <button id="browser-download-intake-clear"></button><button id="browser-download-intake-refresh"></button><button id="browser-download-intake-copy" disabled></button><input type="checkbox" id="browser-file-auto-check">`);
  const { window } = dom,
    { document } = window;
  let enabled = false,
    autoEnabled = false,
    active = true,
    granted = true,
    handler = null,
    saveHandler = null;
  const autoSaves = [];
  const calls = [],
    saves = [];
  let snapshot = { status: "off", items: [] };
  const chrome = {
    permissions: {
      request: (request) => {
        calls.push({ permission: request });
        return Promise.resolve(granted);
      },
    },
    runtime: {
      sendMessage: async (message) => {
        calls.push(message);
        if (handler) return handler(message);
        if (message.type === DOWNLOAD_INTAKE_MESSAGES.CLEAR) {
          snapshot.items = [];
          return { status: "cleared" };
        }
        return snapshot;
      },
    },
  };
  const panel = createDownloadIntakePanel({
    document,
    chrome,
    isActive: () => active,
    getEnabled: () => enabled,
    saveEnabled: async (value) => {
      if (saveHandler) await saveHandler(value);
      enabled = value;
      saves.push(value);
      snapshot.status = value ? "observing" : "off";
    },
    getAutoCheckEnabled: () => autoEnabled,
    saveAutoCheckEnabled: async (value) => {
      autoEnabled = value;
      autoSaves.push(value);
    },
  });
  panel.bind();
  t.after(() => {
    panel.stop();
    window.close();
  });
  return {
    window,
    document,
    panel,
    calls,
    saves,
    autoSaves,
    chrome,
    toggle: document.getElementById("browser-download-observe"),
    status: () =>
      document.getElementById("browser-download-intake-status").textContent,
    snapshot: (value) => {
      snapshot = value;
    },
    active: (value) => {
      active = value;
    },
    grant: (value) => {
      granted = value;
    },
    handle: (fn) => {
      handler = fn;
    },
    saveWith: (fn) => {
      saveHandler = fn;
    },
  };
}

test("permission is requested directly from activation; denied permission never enables observation", async (t) => {
  const f = fixture(t);
  f.grant(false);
  f.toggle.checked = true;
  f.toggle.dispatchEvent(new f.window.Event("change"));
  assert.deepEqual(f.calls[0], { permission: { permissions: ["downloads"] } });
  await tick();
  assert.deepEqual(f.saves, []);
  assert.equal(f.toggle.checked, false);
  assert.equal(f.toggle.disabled, false);
  assert.match(f.status(), /Permission not granted/);
});

test("automatic checks need a separate activation-time Helper permission and never implicitly enable observation", async (t) => {
  const f = fixture(t),
    toggle = f.document.getElementById("browser-file-auto-check");
  f.grant(false);
  toggle.checked = true;
  toggle.dispatchEvent(new f.window.Event("change"));
  assert.deepEqual(f.calls[0], {
    permission: { permissions: ["downloads", "nativeMessaging"] },
  });
  await tick();
  assert.deepEqual(f.autoSaves, []);
  assert.equal(toggle.checked, false);
  f.grant(true);
  toggle.checked = true;
  toggle.dispatchEvent(new f.window.Event("change"));
  await tick();
  await tick();
  assert.deepEqual(f.autoSaves, [true]);
  assert.deepEqual(f.saves, []);
  f.panel.stop();
  toggle.checked = false;
  toggle.dispatchEvent(new f.window.Event("change"));
  await tick();
  assert.deepEqual(f.autoSaves, [true]);
});

test("enabling and disabling are independent of media/Helper; toggles bind once and clean up", async (t) => {
  const f = fixture(t);
  f.panel.bind();
  f.toggle.checked = true;
  f.toggle.dispatchEvent(new f.window.Event("change"));
  await tick();
  await tick();
  assert.deepEqual(f.saves, [true]);
  assert.match(f.status(), /Downloads stay in Chrome/);
  f.toggle.checked = false;
  f.toggle.dispatchEvent(new f.window.Event("change"));
  await tick();
  assert.deepEqual(f.saves, [true, false]);
  assert.equal(f.calls.filter((call) => call.permission).length, 1);
  assert.ok(!f.calls.some((call) => String(call.type).includes("HELPER")));
  f.panel.stop();
  f.toggle.checked = true;
  f.toggle.dispatchEvent(new f.window.Event("change"));
  await tick();
  assert.deepEqual(f.saves, [true, false]);
});

test("metadata display treats filenames as text and clear removes only observations", async (t) => {
  const f = fixture(t);
  f.snapshot({
    status: "observing",
    items: [
      {
        filename: "<img src=x onerror=alert(1)>.zip",
        host: "cdn.example",
        totalBytes: 1048576,
        state: "in_progress",
        assessment: { reason: "request_not_verified" },
      },
    ],
  });
  await f.panel.render();
  assert.equal(f.document.querySelector("img"), null);
  assert.match(
    f.document.getElementById("browser-download-observations").textContent,
    /1.0 MB.*in_progress/,
  );
  assert.match(f.document.querySelector("small").textContent, /not verified/);
  f.document.getElementById("browser-download-intake-clear").click();
  await tick();
  await tick();
  assert.ok(
    f.calls.some((call) => call.type === DOWNLOAD_INTAKE_MESSAGES.CLEAR),
  );
  assert.equal(f.document.querySelectorAll("article").length, 0);
  assert.ok(
    !f.calls.some((call) => /CANCEL|DELETE|DOWNLOAD_JOB/.test(call.type)),
  );
});

test("hidden/disposed panel ignores pending responses and performs no background polling", async (t) => {
  const f = fixture(t);
  f.active(false);
  await f.panel.render();
  f.panel.scheduleRefresh();
  assert.equal(f.calls.length, 0);
  f.active(true);
  let finish;
  f.handle(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.panel.render();
  f.panel.stop();
  finish({
    status: "observing",
    items: [{ filename: "Late.zip", assessment: {} }],
  });
  await pending;
  assert.equal(f.document.querySelectorAll("article").length, 0);
});

test("a settings write failure restores the checkbox and exposes the failure", async (t) => {
  const f = fixture(t);
  f.saveWith(() => {
    throw Error("Settings write failed");
  });
  f.toggle.checked = true;
  f.toggle.dispatchEvent(new f.window.Event("change"));
  await tick();
  assert.equal(f.toggle.checked, false);
  assert.match(f.status(), /Settings write failed/);
  assert.equal(f.toggle.disabled, false);
});

test("signed completed files still show detection and both reasons; report copies no sensitive source fields", async (t) => {
  const f = fixture(t);
  let copied;
  Object.defineProperty(f.window.navigator, "clipboard", {
    value: {
      writeText: async (text) => {
        copied = text;
      },
    },
  });
  f.snapshot({
    status: "observing",
    items: [
      {
        id: 11,
        filename: "build.zip",
        host: "cdn.example",
        authorizationHints: true,
        state: "complete",
        totalBytes: 500,
        assessment: { disposition: "browser_only", reason: "not_active" },
        sourceUrl: "https://cdn.example/file?sig=SECRET",
      },
    ],
  });
  await f.panel.render();
  assert.match(
    f.document.querySelector(".browser-download-detection").textContent,
    /Detected.*Completed in Chrome/,
  );
  assert.match(
    f.document.querySelector("small").textContent,
    /Signed\/session.*Already completed/,
  );
  assert.equal(f.document.querySelector(".file-check-controls button"), null);
  f.document.getElementById("browser-download-intake-copy").click();
  await tick();
  assert.equal(
    JSON.parse(copied).items[0].diagnostic,
    "signed_url_browser_only",
  );
  assert.doesNotMatch(copied, /SECRET|https:\/\//);
  assert.equal(f.calls.length, 1); // Copy is local; no new request/native call.
});

test("off/empty/denied messages distinguish lack of observation; failed refresh disables stale reports", async (t) => {
  const f = fixture(t);
  await f.panel.render();
  assert.match(f.status(), /Observation off/);
  assert.match(
    f.document.querySelector(".empty-msg").textContent,
    /Enable observation/,
  );
  f.snapshot({ status: "permission_required", items: [] });
  await f.panel.render();
  assert.match(f.status(), /detection unavailable/);
  f.snapshot({ status: "observing", items: [] });
  await f.panel.render();
  assert.match(f.status(), /0 detected/);
  assert.match(
    f.document.querySelector(".empty-msg").textContent,
    /does not prove/,
  );
  f.handle(() => {
    throw Error("Worker unreachable");
  });
  await f.panel.render();
  assert.equal(
    f.document.getElementById("browser-download-intake-copy").disabled,
    true,
  );
  assert.match(f.status(), /Worker unreachable/);
});
