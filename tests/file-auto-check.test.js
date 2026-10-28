import test from "node:test";
import assert from "node:assert/strict";
import {
  assessAutomaticFileCheck,
  FILE_AUTO_MIN_BYTES,
} from "../src/downloads/auto-check-policy.js";
import { assessDownloadIntake } from "../src/downloads/intake-policy.js";
import { createAutomaticFileChecks } from "../src/background/downloads/auto-file-checks.js";
import { routeDownloadIntakeMessage } from "../src/background/downloads/intake-messages.js";
import { FILE_OFFERS_MESSAGE } from "../src/downloads/auto-check-policy.js";
import { startBrowserFileOffers } from "../src/popup/browser-file-offers.js";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../packages/media-helper/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");
const row = (extra) => ({
  id: 1,
  filename: "file.zip",
  protocol: "https:",
  danger: "safe",
  state: "in_progress",
  totalBytes: FILE_AUTO_MIN_BYTES,
  ...extra,
});
test("signed links are checkable, never automatically transferable; small files stay in Chrome", () => {
  const signed = row({ authorizationHints: true });
  assert.equal(assessDownloadIntake(signed).disposition, "needs_validation");
  assert.equal(assessDownloadIntake(signed).canTakeOver, false);
  assert.equal(assessAutomaticFileCheck(signed).eligible, true);
  assert.equal(
    assessAutomaticFileCheck(
      row({ totalBytes: 465920, authorizationHints: true }),
    ).reason,
    "small_file",
  );
  for (const extra of [
    { protocol: "blob:" },
    { credentialed: true },
    { paused: true },
    { danger: "uncommon" },
    { state: "complete" },
  ])
    assert.equal(assessAutomaticFileCheck(row(extra)).eligible, false);
  assert.equal(
    assessAutomaticFileCheck(row({ totalBytes: null })).reason,
    "size_unknown",
  );
  assert.equal(
    assessAutomaticFileCheck(row({ filename: "app.exe" })).reason,
    "unsupported_file_type",
  );
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture(t) {
  let listener,
    checkListener,
    permitted = true,
    resolveCheck;
  const rows = [],
    checks = [],
    calls = [];
  const intake = {
    snapshot: () => ({ status: "observing", items: rows }),
    subscribe(fn) {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  };
  const handoff = {
    snapshot: async () => ({ checks }),
    subscribeChecks(fn) {
      checkListener = fn;
      return () => {};
    },
    discardCheck(id) {
      calls.push(["discard", id]);
      const index = checks.findIndex((row) => row.browserId === id);
      if (index >= 0) checks.splice(index, 1);
      checkListener?.();
    },
    async execute(action, payload) {
      calls.push([action, payload]);
      if (resolveCheck) await resolveCheck;
      checks.push({
        browserId: payload.browserId,
        expiresAt: Date.now() + 30000,
      });
      return { status: "ready_for_handoff" };
    },
  };
  const chrome = {
    permissions: { contains: async () => permitted },
    storage: {
      session: { set: async (value) => calls.push(["store", value]) },
    },
    action: { setBadgeText: async (value) => calls.push(["badge", value]) },
  };
  const service = createAutomaticFileChecks({ chrome, intake, handoff });
  const stop = service.startFeature({ require() {} });
  t.after(stop);
  function emit(extra = {}) {
    const value = row({ observedAt: Date.now(), ...extra });
    const prior = rows.findIndex((r) => r.id === value.id);
    if (prior >= 0) rows[prior] = value;
    else rows.push(value);
    listener?.({
      type: prior < 0 ? "create" : "change",
      row: value,
      id: value.id,
    });
  }
  return {
    emit,
    calls,
    service,
    stop,
    rows,
    handoff,
    permission(value) {
      permitted = value;
    },
    hold(promise) {
      resolveCheck = promise;
    },
  };
}
test("auto preflight skips small/unknown files, checks a signed GET candidate once and never accepts or mutates Chrome", async (t) => {
  const f = fixture(t);
  f.emit({ id: 1, totalBytes: 455 * 1024, authorizationHints: true });
  f.emit({ id: 2, totalBytes: null });
  await tick();
  assert.equal(
    f.calls.some((row) => row[0] === "downloads.file.auto_check"),
    false,
  );
  f.emit({ id: 3, authorizationHints: true });
  await tick();
  await tick();
  assert.equal(
    f.calls.filter((row) => row[0] === "downloads.file.auto_check").length,
    1,
  );
  assert.equal((await f.service.snapshot()).offers.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal(f.calls.filter((row) => row[0] === "badge").at(-1)[1].text, "1");
  f.emit({ id: 3 });
  await tick();
  assert.equal(
    f.calls.filter((row) => row[0] === "downloads.file.auto_check").length,
    1,
  );
  assert.ok(!f.calls.some((row) => /accept|pause|cancel|resume/.test(row[0])));
  f.emit({ id: 3, state: "complete" });
  await tick();
  assert.equal((await f.service.snapshot()).offers.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal(f.calls.filter((row) => row[0] === "badge").at(-1)[1].text, "");
});
test("permission denial and stop keep Chrome untouched; late checks cannot create an offer after stop", async (t) => {
  const f = fixture(t);
  f.permission(false);
  f.emit();
  await tick();
  assert.equal(
    f.calls.some((row) => row[0] === "downloads.file.auto_check"),
    false,
  );
  f.permission(true);
  let release;
  f.hold(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  f.emit({ id: 2 });
  await tick();
  f.stop();
  release();
  await tick();
  await tick();
  assert.equal((await f.service.snapshot()).enabled, false);
  assert.equal((await f.service.snapshot()).offers.length, 0);
  assert.ok(f.calls.some((row) => row[0] === "discard" && row[1] === 2));
});

test("offers endpoint is read-only and restricted to our popup, not content scripts or website URLs", async () => {
  const chrome = {
    runtime: {
      id: "fixture",
      getURL: (path) => "chrome-extension://fixture/" + path,
    },
  };
  const automatic = {
    snapshot: async () => ({
      offers: [{ filename: "file.zip", browserId: 1 }],
    }),
  };
  for (const sender of [
    { id: "fixture", url: "https://site.example/" },
    { id: "other", url: chrome.runtime.getURL("popup/popup.html") },
    { id: "fixture", url: chrome.runtime.getURL("options/options.html") },
  ])
    assert.deepEqual(
      routeDownloadIntakeMessage(
        { type: FILE_OFFERS_MESSAGE },
        sender,
        null,
        chrome,
        null,
        automatic,
      ),
      { status: "ignored" },
    );
  const result = await routeDownloadIntakeMessage(
    { type: FILE_OFFERS_MESSAGE },
    { id: "fixture", url: chrome.runtime.getURL("popup/popup.html") },
    null,
    chrome,
    null,
    automatic,
  );
  assert.equal(result.items[0].filename, "file.zip");
});

test("popup offer renders safely and only opens review; it cannot accept or start a transfer", async (t) => {
  const dom = new JSDOM(
    '<section id="browser-file-offers" hidden><div class="browser-file-offer-list"></div><button>Review transfer</button></section>',
  );
  const calls = [],
    changed = new Set();
  const chrome = {
    runtime: {
      getURL: (path) => "chrome-extension://fixture/" + path,
      sendMessage: async (message) => {
        calls.push(message);
        return { items: [{ filename: "<img src=x>.zip" }] };
      },
    },
    storage: {
      onChanged: {
        addListener: (fn) => changed.add(fn),
        removeListener: (fn) => changed.delete(fn),
      },
    },
    tabs: { create: async (input) => calls.push(input) },
  };
  const stop = startBrowserFileOffers({
    document: dom.window.document,
    window: dom.window,
    chrome,
  });
  t.after(() => {
    stop();
    dom.window.close();
  });
  await tick();
  assert.equal(dom.window.document.querySelector("section").hidden, false);
  assert.equal(dom.window.document.querySelector("img"), null);
  dom.window.document.querySelector("button").click();
  await tick();
  assert.equal(
    calls[1].url,
    "chrome-extension://fixture/options/options.html#downloads",
  );
  assert.equal(calls.filter((row) => row.type).length, 1);
  stop();
  assert.equal(changed.size, 0);
});
