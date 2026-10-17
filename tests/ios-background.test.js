import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const resources = new URL(
  "../ios/AdsFriendly_iOS/AdsFriendly_iOS Extension/Resources/",
  import.meta.url,
);
async function background() {
  let data = {
    appSettings: { enabled: true },
    settingsPackageState: { initialized: true },
  };
  const messages = [],
    changes = [],
    created = [],
    relays = [];
  const tabUrls = new Map([[1, "https://source.example/article"]]);
  const removed = [];
  const event = { addListener() {} };
  const api = {
    runtime: {
      lastError: null,
      getURL: (path) => "safari-web-extension://test/" + path,
      onMessage: { addListener: (listener) => messages.push(listener) },
    },
    storage: {
      onChanged: { addListener: (listener) => changes.push(listener) },
      local: {
        get(keys, callback) {
          const wanted = typeof keys === "string" ? [keys] : keys;
          callback(
            structuredClone(
              wanted
                ? Object.fromEntries(
                    wanted
                      .filter((key) => key in data)
                      .map((key) => [key, data[key]]),
                  )
                : data,
            ),
          );
        },
        set(value, callback) {
          const changed = Object.fromEntries(
            Object.entries(value).map(([key, newValue]) => [
              key,
              { newValue: structuredClone(newValue) },
            ]),
          );
          Object.assign(data, structuredClone(value));
          changes.forEach((fn) => fn(changed, "local"));
          callback?.();
        },
        remove(keys, callback) {
          for (const key of Array.isArray(keys) ? keys : [keys])
            delete data[key];
          callback?.();
        },
      },
    },
    tabs: {
      onCreated: event,
      onUpdated: event,
      onRemoved: event,
      get(id, callback) {
        callback({
          id,
          url: tabUrls.get(id) || "https://source.example/article",
        });
      },
      update(id, value, callback) {
        tabUrls.set(id, value.url);
        callback({ id, ...value });
      },
      remove(id, callback) {
        removed.push(id);
        callback();
      },
      query(query, callback) {
        callback([]);
      },
      create(value, callback) {
        created.push(value);
        callback({ ...value, id: created.length + 10 });
      },
      sendMessage(...args) {
        const callback = args.pop();
        relays.push(args);
        callback({});
      },
    },
    webNavigation: { onCreatedNavigationTarget: event, onCommitted: event },
  };
  const context = {
    browser: api,
    chrome: api,
    console,
    URL,
    Date,
    setTimeout,
    clearTimeout,
    fetch,
    crypto,
    TextEncoder,
    structuredClone,
  };
  context.window = context;
  vm.createContext(context);
  for (const file of [
    "utils/shared.js",
    "background/settings-package.js",
    "background/whitelist.js",
    "background/neutralize.js",
    "background/tab-tracker.js",
    "background.js",
  ])
    vm.runInContext(await readFile(new URL(file, resources), "utf8"), context, {
      filename: file,
    });
  await context.AFSettingsReady;
  const listener = messages.at(-1);
  const sender = {
    url: "https://source.example/article",
    tab: { id: 1, url: "https://source.example/article" },
    frameId: 0,
  };
  const extension = {
    url: api.runtime.getURL("packages/import.html"),
    tab: { id: 2, url: api.runtime.getURL("packages/import.html") },
  };
  return {
    data: () => data,
    created,
    relays,
    context,
    api,
    removed,
    tabUrls,
    sender,
    extension,
    send: (message, origin = sender) =>
      new Promise((resolve) => listener(message, origin, resolve)),
  };
}
test("popup choices persist in exportable root lists without opening any tab", async () => {
  const bg = await background();
  assert.equal(
    (
      await bg.send({
        action: "block_popups",
        urls: ["https://ads.example/popup"],
      })
    ).status,
    "saved",
  );
  assert.deepEqual(bg.data().blacklist, ["||ads.example^"]);
  assert.equal(bg.created.length, 0);
  await bg.send({
    action: "allow_popups",
    urls: ["https://ads.example/popup"],
  });
  assert.deepEqual(bg.data().whitelist, ["ads.example"]);
  assert.deepEqual(bg.data().blacklist, []);
  assert.equal(bg.created.length, 0);
});
test("Open once does not change the remembered block and validates URL schemes", async () => {
  const bg = await background();
  await bg.send({
    action: "block_popups",
    urls: ["https://ads.example/popup"],
  });
  assert.ok(
    (await bg.send({ action: "open_once", url: "javascript:alert(1)" })).error,
  );
  assert.equal(bg.created.length, 0);
  assert.equal(
    (await bg.send({ action: "open_once", url: "https://ads.example/popup" }))
      .status,
    "opened",
  );
  assert.equal(bg.created.length, 1);
  assert.deepEqual(bg.data().blacklist, ["||ads.example^"]);
});
test("banner visibility controls are extension-only and cannot target a changed tab", async () => {
  const bg = await background();
  const request = {
    action: "set_banner_visibility",
    visibility: "show",
    tabId: 1,
    hostname: "source.example",
  };
  assert.ok((await bg.send(request)).error);
  assert.ok(
    (await bg.send({ ...request, hostname: "different.test" }, bg.extension))
      .error,
  );
  assert.equal(bg.relays.length, 0);
  bg.api.tabs.sendMessage = (...args) => {
    const callback = args.pop();
    bg.relays.push(args);
    callback({ ready: true, dom: { hiddenCount: 0, shownOnPage: true } });
  };
  assert.equal((await bg.send(request, bg.extension)).dom.shownOnPage, true);
  assert.equal(bg.relays[0][2].frameId, 0);
  assert.equal(bg.created.length, 0);
  assert.equal(bg.data().whitelist, undefined);
});
test("DOM decisions use root exceptions and separate compact/wide rules", async () => {
  const bg = await background();
  const base = {
    action: "save_dom_decision",
    hostname: "source.example",
    selector: "#ad-slot",
    features: { tag: "div", id: "ad-slot" },
  };
  await bg.send({ ...base, layout: "wide", decision: "hide" });
  await bg.send({ ...base, layout: "compact", decision: "hide" });
  assert.equal(bg.data().userCustomRules["source.example"].length, 2);
  await bg.send({ ...base, layout: "compact", decision: "show" });
  assert.equal(bg.data().userCustomRules["source.example"][0].layout, "wide");
  assert.equal(
    bg.data().userElementExceptions["source.example"][0].layout,
    "compact",
  );
  assert.ok(
    (await bg.send({ ...base, hostname: "other.example", decision: "hide" }))
      .error,
  );
});
test("pages cannot import/undo packages and frame toasts are relayed to the main frame", async () => {
  const bg = await background();
  assert.ok((await bg.send({ action: "undo_settings_import" })).error);
  assert.equal(
    (await bg.send({ action: "get_import_state" }, bg.extension)).canUndo,
    false,
  );
  await bg.send(
    {
      action: "frame_popup_blocked",
      url: "https://ads.example/",
      remembered: true,
    },
    { ...bg.sender, frameId: 4 },
  );
  assert.equal(bg.relays.length, 1);
  assert.equal(bg.relays[0][2].frameId, 0);
});
test("parallel counter updates are serialized", async () => {
  const bg = await background();
  for (let i = 0; i < 10; i++)
    bg.context.bgRecordBlock("https://source.example/", "popup", 1);
  await bg.context.AFShared.serialMutation(async () => {});
  assert.equal(bg.data().blockedCount, 10);
});
test("neutralization reports only successful blocks and never closes a changed tab", async () => {
  const bg = await background();
  bg.context.neutralizeTab(9, 1, "https://ads.example/", true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await bg.context.AFShared.serialMutation(async () => {});
  assert.deepEqual(bg.removed, [9]);
  assert.equal(bg.data().blockedCount, 1);
  assert.equal(bg.relays[0][1].remembered, true);
  bg.api.tabs.update = (id, value, callback) => {
    bg.tabUrls.set(id, "https://user-navigation.example/");
    callback({});
  };
  bg.context.neutralizeTab(10, 1, "https://ads.example/", false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(bg.removed, [9]);
  bg.api.tabs.update = (id, value, callback) => {
    bg.api.runtime.lastError = { message: "Missing permission" };
    callback();
    bg.api.runtime.lastError = null;
  };
  bg.context.neutralizeTab(11, 1, "https://ads.example/", false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await bg.context.AFShared.serialMutation(async () => {});
  assert.equal(bg.data().blockedCount, 2);
  assert.equal(bg.data().afsDiagnostics.at(-1).reason, "neutralize_failed");
});
