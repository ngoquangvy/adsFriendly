import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserDownloadIntake } from "../src/background/downloads/intake-observer.js";
import { routeDownloadIntakeMessage } from "../src/background/downloads/intake-messages.js";
import {
  DOWNLOAD_INTAKE_KEY,
  DOWNLOAD_INTAKE_MESSAGES,
  DOWNLOAD_OBSERVER_FEATURE,
} from "../src/downloads/intake-contract.js";
import {
  CAPABILITIES,
  getFeaturesForContext,
} from "../src/runtime/feature-catalog.js";
import { createMainController } from "../src/runtime/main-controller.js";

function event() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    emit: (value) => {
      for (const fn of listeners) fn(value);
    },
    count: () => listeners.size,
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const item = (id, extra = {}) => ({
  id,
  url: `https://cdn.example/file-${id}.zip`,
  filename: `C:/secret/file-${id}.zip`,
  state: "in_progress",
  danger: "safe",
  ...extra,
});
function setup(t, saved = {}) {
  const events = { onCreated: event(), onChanged: event(), onErased: event() };
  const permissions = { onAdded: event(), onRemoved: event() };
  let granted = true,
    time = 10000,
    failWrite = false,
    getHandler = null;
  const storage = structuredClone(saved),
    writes = [];
  const chrome = {
    runtime: {
      id: "fixture",
      getURL: (path) => `chrome-extension://fixture/${path}`,
    },
    downloads: {
      ...events,
      cancel: () => assert.fail("observer must not cancel"),
      pause: () => assert.fail("observer must not pause"),
      download: () => assert.fail("observer must not replay"),
      search: () => assert.fail("observer must not scan history"),
    },
    permissions: { ...permissions, contains: async () => granted },
    storage: {
      session: {
        get: async (key) =>
          getHandler ? getHandler(key) : structuredClone(storage),
        set: async (values) => {
          if (failWrite) throw Error("quota");
          writes.push(structuredClone(values));
          Object.assign(storage, values);
        },
        remove: async (key) => {
          delete storage[key];
        },
      },
    },
  };
  const intake = createBrowserDownloadIntake({ chrome, now: () => time });
  t.after(async () => {
    intake.stop();
    await intake.flush();
  });
  const policy = {
    require: (cap) => assert.equal(cap, CAPABILITIES.BROWSER_DOWNLOAD_OBSERVE),
  };
  return {
    intake,
    chrome,
    events,
    permissions,
    storage,
    writes,
    policy,
    grant: (value) => {
      granted = value;
    },
    advance: (delta) => {
      time += delta;
    },
    failWrite: (value) => {
      failWrite = value;
    },
    getWith: (fn) => {
      getHandler = fn;
    },
  };
}

test("MV3 ingress retains a sanitized first event before settings load and never scans or mutates downloads", async (t) => {
  const f = setup(t);
  f.intake.bootstrap();
  assert.equal(f.events.onCreated.count(), 1);
  f.events.onCreated.emit(
    item(1, { url: "https://cdn.example/file?token=SECRET" }),
  );
  await f.intake.start(f.policy);
  f.intake.settleBootstrap();
  assert.equal(f.intake.snapshot().status, "observing");
  assert.equal(f.intake.snapshot().items.length, 1);
  await f.intake.flush();
  assert.doesNotMatch(
    JSON.stringify(f.storage),
    /SECRET|token=|secret\/|https:\/\//,
  );
  assert.equal(f.intake.snapshot().items[0].assessment.canTakeOver, false);
});

test("default-off bootstrap drops pending events, restores no old history and writes no URL", async (t) => {
  const f = setup(t);
  f.intake.bootstrap();
  f.events.onCreated.emit(item(1));
  f.intake.settleBootstrap();
  await f.intake.flush();
  assert.equal(f.events.onCreated.count(), 0);
  assert.equal(f.intake.snapshot().items.length, 0);
  assert.equal(f.intake.snapshot().status, "off");
});

test("created/changed events deduplicate, exclude incognito/extensions and keep sticky authorization hints", async (t) => {
  const f = setup(t);
  await f.intake.start(f.policy);
  f.events.onCreated.emit(item(1, { url: "https://cdn.example/a?sig=SECRET" }));
  f.events.onCreated.emit(item(1));
  f.events.onCreated.emit(item(2, { incognito: true }));
  f.events.onCreated.emit(item(3, { byExtensionId: "fixture" }));
  f.events.onCreated.emit(item(4, { byExtensionId: "another-extension" }));
  f.events.onChanged.emit({
    id: 99,
    filename: { current: "should-not-exist.mp4" },
  });
  f.events.onChanged.emit({
    id: 1,
    totalBytes: { current: 12345 },
    finalUrl: { current: "https://fresh.example/a.zip" },
  });
  const [row] = f.intake.snapshot().items;
  assert.equal(f.intake.snapshot().items.length, 1);
  assert.equal(row.totalBytes, 12345);
  assert.equal(row.authorizationHints, true);
  f.events.onErased.emit(1);
  assert.equal(f.intake.snapshot().items.length, 0);
});

test("retention is capped/expired, session hydration supports worker restart without scanning Chrome", async (t) => {
  const f = setup(t);
  await f.intake.start(f.policy);
  for (let id = 0; id < 75; id++) f.events.onCreated.emit(item(id));
  assert.equal(f.intake.snapshot().items.length, 50);
  await f.intake.flush();
  const second = setup(t, f.storage);
  second.intake.bootstrap();
  second.events.onChanged.emit({ id: 74, state: { current: "complete" } });
  await second.intake.start(second.policy);
  assert.equal(
    second.intake.snapshot().items.find((row) => row.id === 74).state,
    "complete",
  );
  second.advance(3600001);
  assert.equal(second.intake.snapshot().items.length, 0);
});

test("permission denial/revocation detaches, clears metadata and stale hydration cannot resurrect rows", async (t) => {
  const f = setup(t);
  f.grant(false);
  await f.intake.start(f.policy);
  assert.equal(f.intake.snapshot().status, "permission_required");
  assert.equal(f.events.onCreated.count(), 0);
  f.grant(true);
  f.permissions.onAdded.emit({ permissions: ["downloads"] });
  await tick();
  await tick();
  f.events.onCreated.emit(item(1));
  assert.equal(f.intake.snapshot().items.length, 1);
  f.grant(false);
  f.permissions.onRemoved.emit({ permissions: ["downloads"] });
  await f.intake.flush();
  assert.equal(f.intake.snapshot().items.length, 0);
  assert.equal(f.events.onChanged.count(), 0);
  assert.equal(f.storage[DOWNLOAD_INTAKE_KEY], undefined);
});

test("clear during hydration and queued writes cannot bring old records back", async (t) => {
  const f = setup(t);
  await f.intake.start(f.policy);
  f.events.onCreated.emit(item(1));
  await f.intake.flush();
  const saved = structuredClone(f.storage);
  f.intake.stop();
  await f.intake.flush();
  let release;
  f.getWith(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const start = f.intake.start(f.policy);
  await tick();
  await f.intake.clear();
  release(saved);
  await start;
  assert.equal(f.intake.snapshot().items.length, 0);
  f.events.onCreated.emit(item(2));
  await f.intake.clear();
  await f.intake.flush();
  assert.equal(f.intake.snapshot().items.length, 0);
  assert.equal(f.writes.at(-1)[DOWNLOAD_INTAKE_KEY].items.length, 0);
});

test("storage failure is visible but cannot interrupt the Chrome download", async (t) => {
  const f = setup(t);
  await f.intake.start(f.policy);
  f.events.onCreated.emit(item(1));
  f.failWrite(true);
  await f.intake.flush();
  assert.equal(f.intake.snapshot().storageFailed, true);
  assert.equal(f.intake.snapshot().items.length, 1);
});

test("optional hydration cannot block the main controller or revive data after cleanup", async (t) => {
  const f = setup(t);
  let release;
  f.getWith(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const stop = f.intake.startFeature(f.policy);
  assert.equal(typeof stop, "function");
  await tick();
  f.events.onCreated.emit(item(1));
  stop();
  release({});
  await tick();
  assert.equal(f.intake.snapshot().status, "off");
  assert.equal(f.intake.snapshot().items.length, 0);
  assert.equal(f.events.onCreated.count(), 0);
});

test("metadata messages are restricted to the exact Settings page, including content scripts with our extension id", async (t) => {
  const f = setup(t);
  const message = { type: DOWNLOAD_INTAKE_MESSAGES.GET };
  for (const sender of [
    { id: "fixture", url: "https://website.example/options/options.html" },
    { id: "other", url: "chrome-extension://fixture/options/options.html" },
    {
      id: "fixture",
      url: "chrome-extension://fixture/options/options.html.evil",
    },
  ])
    assert.deepEqual(
      routeDownloadIntakeMessage(message, sender, f.intake, f.chrome),
      { status: "ignored" },
    );
  assert.equal(
    routeDownloadIntakeMessage(
      message,
      {
        id: "fixture",
        url: "chrome-extension://fixture/options/options.html#downloads",
      },
      f.intake,
      f.chrome,
    ).observationOnly,
    true,
  );
});

test("opt-in feature is independent of ad mode, starts only when registered override is true, and cleans up once", async () => {
  const events = [];
  const implementations = Object.fromEntries(
    getFeaturesForContext("background").map((def) => [
      def.id,
      () => {
        events.push("start:" + def.id);
        return () => events.push("stop:" + def.id);
      },
    ]),
  );
  const controller = createMainController({
    context: "background",
    implementations,
    initialSettings: { enabled: false, protectionMode: "safe" },
    watchSettings: false,
  });
  await controller.start();
  assert.ok(!events.includes("start:" + DOWNLOAD_OBSERVER_FEATURE));
  await controller.updateSettings({
    enabled: false,
    protectionMode: "safe",
    featureOverrides: { [DOWNLOAD_OBSERVER_FEATURE]: true },
  });
  assert.equal(
    events.filter((event) => event === "start:" + DOWNLOAD_OBSERVER_FEATURE)
      .length,
    1,
  );
  await controller.updateSettings({ enabled: false, protectionMode: "safe" });
  assert.equal(
    events.filter((event) => event === "stop:" + DOWNLOAD_OBSERVER_FEATURE)
      .length,
    1,
  );
  await controller.stop();
});
