import test from "node:test";
import assert from "node:assert/strict";
import { registerNavigationGuard } from "../src/navigation/background/guard.js";
import { navigationAttribution } from "../src/navigation/background/attribution.js";
import {
  managedNavigationTabs,
  openExtensionManagedTab,
} from "../src/navigation/background/managed-tabs.js";
import { CAPABILITIES as C } from "../src/runtime/feature-catalog.js";
import { isOwnedUiEvent } from "../src/navigation/content/owned-ui.js";
import { evaluateNavigationPolicy } from "../src/navigation/background/policy.js";
import { normalizeNavigationDiagnosticEvent } from "../src/navigation/background/diagnostics.js";
import { registerMessageRouter } from "../src/background/message-router.js";

const flush = async () => {
  for (let i = 0; i < 6; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
function harness(t, { feedback = true, read = null } = {}) {
  const previous = globalThis.chrome;
  const hooks = {};
  const tabs = new Map([
    [10, { id: 10, windowId: 1, url: "https://source.test/watch" }],
  ]);
  const closed = [],
    updates = [],
    messages = [];
  const local = {};
  const session = {};
  const event = (name) => ({
    addListener: (fn) => {
      hooks[name] = fn;
    },
    removeListener() {},
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.chrome = {
    tabs: {
      query: async () => [...tabs.values()],
      get: async (id) => {
        if (!tabs.has(id)) throw new Error("Tab gone");
        return { ...tabs.get(id) };
      },
      update: async (id, change) => {
        updates.push({ id, ...change });
        Object.assign(tabs.get(id) || {}, change);
        return tabs.get(id);
      },
      remove: async (id) => {
        closed.push(id);
        tabs.delete(id);
        hooks.removed(id);
      },
      sendMessage: async (id, message) => {
        messages.push({ id, ...message });
        return {};
      },
      onCreated: event("created"),
      onRemoved: event("removed"),
    },
    webNavigation: {
      onCreatedNavigationTarget: event("target"),
      onCommitted: event("committed"),
    },
    storage: {
      local: {
        get: async (keys) => {
          if (read) await read();
          return local;
        },
        set: async (values) => Object.assign(local, values),
      },
      session: {
        get: async () => session,
        set: async (values) => Object.assign(session, values),
      },
    },
    runtime: {
      id: "test-extension",
      getURL: (path) => `chrome-extension://test-extension/${path}`,
      onMessage: event("message"),
    },
  };
  const stop = registerNavigationGuard({
    can: (capability) =>
      [
        C.NAVIGATION_GUARD,
        C.NAVIGATION_REVERSE_POPUNDER,
        ...(feedback ? [C.NAVIGATION_FEEDBACK] : []),
      ].includes(capability),
  });
  t.after(async () => {
    stop();
    t.mock.timers.tick(20000);
    await flush();
    t.mock.timers.reset();
    globalThis.chrome = previous;
  });
  return {
    hooks,
    tabs,
    closed,
    updates,
    messages,
    local,
    stop,
    click: (overrides = {}) =>
      navigationAttribution.rememberIntent({
        tabId: 10,
        sourceFrameId: 0,
        sourceUrl: tabs.get(10).url,
        intentUrl: null,
        intentReasons: [],
        ...overrides,
      }),
    create: (url, overrides = {}) => {
      const tab = { id: 20, windowId: 1, url, ...overrides };
      tabs.set(tab.id, tab);
      hooks.created(tab);
      return tab;
    },
    commit: (id, url, overrides = {}) => {
      Object.assign(tabs.get(id), { url, pendingUrl: undefined });
      hooks.committed({
        tabId: id,
        frameId: 0,
        url,
        transitionType: "link",
        ...overrides,
      });
    },
    target: (url, overrides = {}) =>
      hooks.target({
        sourceTabId: 10,
        sourceFrameId: 0,
        tabId: 20,
        url,
        ...overrides,
      }),
  };
}

test("closed-shadow extension controls are not website click intent", () => {
  const host = {
    closest: (selector) =>
      selector.includes("[data-adsfriendly-ui]") ? {} : null,
  };
  assert.equal(
    isOwnedUiEvent({ target: {}, composedPath: () => [{}, host] }),
    true,
  );
  assert.equal(isOwnedUiEvent({ target: { closest: () => null } }), false);
});

test("timing-only and opener-only evidence cannot close or replace an unrelated HTTP tab", async (t) => {
  const h = harness(t, { feedback: false });
  h.click({
    intentKind: "promotional",
    intentUrl: "https://ads.test/?popunder=1",
  });
  h.create("https://ads.test/?popunder=1");
  h.commit(20, "https://ads.test/?popunder=1");
  await flush();
  assert.equal(navigationAttribution.get(20).attribution, "unconfirmed");
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
  h.create("https://ads.test/?popunder=1", { id: 21, openerTabId: 10 });
  h.commit(21, "https://ads.test/?popunder=1");
  await flush();
  assert.equal(navigationAttribution.get(21).attribution, "probable");
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
});

test("missing weak-review receiver never escalates to a blocking page or guessed-source workflow", async (t) => {
  const h = harness(t);
  chrome.tabs.sendMessage = async (id, message) => {
    h.messages.push({ id, ...message });
    throw new Error("No receiver");
  };
  const url = "https://ads.test/?utm_medium=popunder";
  h.click();
  h.create(url);
  h.commit(20, url);
  await flush();
  for (let i = 0; i < 6; i++) {
    t.mock.timers.tick(220);
    await flush();
  }
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
  assert.equal(h.messages[0].source, "");
  assert.equal(h.messages[0].navigationAttribution.attribution, "unconfirmed");
});

test("background UI routes register tab ownership before Chrome creates Settings tabs", async (t) => {
  const h = harness(t);
  const stopRouter = registerMessageRouter({ can: () => true });
  try {
    let nextTabId = 20;
    chrome.tabs.create = async (properties) => {
      const tab = h.create(properties.url, { id: nextTabId++ });
      h.commit(tab.id, properties.url);
      return tab;
    };
    h.click({ intentKind: "promotional" });
    const send = (message, sender) =>
      new Promise((resolve) => h.hooks.message(message, sender, resolve));
    const sender = {
      id: "test-extension",
      tab: h.tabs.get(10),
      frameId: 7,
      url: "https://frame.test/player",
    };
    assert.equal(
      (await send({ type: "OPEN_PLAYER_DOWNLOAD_MANAGER" }, sender)).status,
      "opened",
    );
    await flush();
    assert.equal(
      managedNavigationTabs.owns(20, h.tabs.get(20).url)?.reason,
      "download_manager",
    );
    assert.equal(
      (
        await send(
          { type: "OPEN_ELEMENT_DECISIONS", tabId: 10 },
          {
            id: "test-extension",
            url: chrome.runtime.getURL("popup/popup.html"),
          },
        )
      ).status,
      "opened",
    );
    await flush();
    assert.equal(
      managedNavigationTabs.owns(21, h.tabs.get(21).url)?.reason,
      "element_decisions",
    );
    await send(
      {
        type: "TRUSTED_CLICK",
        sourceUrl: "https://wrong-parent.test/",
        intentUrl: "https://target.test/",
      },
      sender,
    );
    assert.equal(
      navigationAttribution.getIntent(10, 7).sourceUrl,
      "https://source.test/watch",
    );
    assert.deepEqual(h.closed, []);
    assert.deepEqual(h.updates, []);
  } finally {
    stopRouter();
  }
});

test("Chrome-confirmed ad tab still closes and notifies the surviving source", async (t) => {
  const h = harness(t);
  const url = "https://ads.test/?utm_source=clickadu&utm_medium=popunder";
  h.create(url);
  h.target(url);
  h.commit(20, url);
  await flush();
  assert.deepEqual(h.closed, [20]);
  assert.equal(
    h.messages.find((message) => message.type === "SHOW_BLOCKED_NAVIGATION")
      ?.id,
    10,
  );
});

test("late confirmed evidence can upgrade an already observed weak source", async (t) => {
  const h = harness(t, { feedback: false });
  const url = "https://ads.test/?utm_source=clickadu&utm_medium=popunder";
  h.click();
  h.create(url);
  h.commit(20, url);
  await flush();
  assert.deepEqual(h.closed, []);
  h.target(url);
  await flush();
  assert.deepEqual(h.closed, [20]);
});

test("new click during a delayed decision does not contaminate its original intent", async (t) => {
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const h = harness(t, { read: () => gate });
  h.click({ intentUrl: "https://github.com/" });
  h.create("https://github.com/");
  h.target("https://github.com/");
  await flush();
  h.click({ intentUrl: "https://ads.test/", intentKind: "promotional" });
  finish();
  await flush();
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
  assert.deepEqual(h.messages, []);
});

test("confirmed source does not inherit an unrelated prior ad click", async (t) => {
  const h = harness(t);
  h.click({ intentUrl: "https://ads.test/", intentKind: "promotional" });
  h.create("https://github.com/");
  h.target("https://github.com/");
  await flush();
  assert.equal(
    navigationAttribution.get(20).intentAssociation,
    "temporal_only",
  );
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
  assert.deepEqual(h.messages, []);
});

test("same-frame overlay evidence without a destination cannot force a blocking page", async (t) => {
  const h = harness(t, { feedback: false });
  h.click({ intentUrl: null, intentKind: "promotional" });
  h.create("https://unclassified.test/");
  h.target("https://unclassified.test/");
  await flush();
  assert.equal(
    navigationAttribution.get(20).intentAssociation,
    "frame_temporal",
  );
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
});

test("address-bar intent cancels a pending ad decision and reverse candidate", async (t) => {
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const h = harness(t, { read: () => gate });
  const url = "https://ads.test/?utm_source=clickadu&utm_medium=popunder";
  h.create(url, { openerTabId: 10 });
  h.target(url);
  await flush();
  h.commit(20, "https://www.google.com/search?q=chosen-by-user", {
    transitionType: "generated",
    transitionQualifiers: ["from_address_bar"],
  });
  finish();
  await flush();
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
  assert.equal(navigationAttribution.get(20), null);
});

test("live destination check rejects a stale target even before its commit event arrives", async (t) => {
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const h = harness(t, { read: () => gate });
  const url = "https://ads.test/?utm_source=clickadu&utm_medium=popunder";
  h.create(url);
  h.target(url);
  await flush();
  h.tabs.get(20).url = "https://chosen-by-user.test/";
  finish();
  await flush();
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
});

test("removed targets and feature shutdown invalidate delayed decisions", async (t) => {
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const h = harness(t, { read: () => gate });
  const url = "https://ads.test/?utm_source=clickadu&utm_medium=popunder";
  h.create(url);
  h.target(url);
  await flush();
  h.tabs.delete(20);
  h.hooks.removed(20);
  h.stop();
  finish();
  await flush();
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
});

test("plus-button/history search with inherited opener stays out of the ad pipeline", async (t) => {
  const h = harness(t);
  h.click({ intentKind: "promotional" });
  h.create("chrome://newtab/", { openerTabId: 10 });
  h.commit(20, "https://www.google.com/search?q=chosen", {
    transitionType: "auto_bookmark",
  });
  h.commit(20, "https://www.google.com.vn/search?q=chosen", {
    transitionType: "link",
    transitionQualifiers: ["server_redirect"],
  });
  await flush();
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
});

test("managed HTTP tab is bound after early events, not exempted by recent website click", async (t) => {
  const h = harness(t);
  const url = "https://ads.test/?utm_source=clickadu&utm_medium=popunder";
  h.click({ intentKind: "promotional" });
  let finish;
  const opening = managedNavigationTabs.open(
    { url },
    {
      reason: "user_open_once",
      create: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  );
  h.create(url);
  h.target(url);
  h.commit(20, url);
  await flush();
  finish(h.tabs.get(20));
  await opening;
  await flush();
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
  // A later website-created destination in the same tab gets no URL-wide bypass.
  const next =
    "https://other-ads.test/?utm_source=clickadu&utm_medium=popunder";
  h.tabs.get(20).url = next;
  h.target(next);
  await flush();
  assert.deepEqual(h.closed, [20]);
});

test("reverse popunder confirms observed clone/redirect and notifies the clone even after source removal", async (t) => {
  const h = harness(t);
  h.click();
  h.create("https://source.test/watch", { openerTabId: 10 });
  h.commit(20, "https://source.test/watch");
  await flush();
  h.commit(10, "https://ads.test/?utm_source=clickadu&utm_medium=popunder");
  await flush();
  assert.deepEqual(h.closed, [10]);
  assert.equal(
    h.messages.find((message) => message.type === "SHOW_BLOCKED_NAVIGATION")
      ?.id,
    20,
  );
});

test("manual navigation in the original source cancels reverse enforcement", async (t) => {
  const h = harness(t);
  h.click();
  h.create("https://source.test/watch", { openerTabId: 10 });
  h.commit(20, "https://source.test/watch");
  await flush();
  h.commit(10, "https://ads.test/?popunder=1", { transitionType: "typed" });
  await flush();
  assert.deepEqual(h.closed, []);
  assert.deepEqual(h.updates, []);
});

test("policy keeps source confidence separate from blacklist and trusted workflows", async () => {
  const io = {
    storage: { get: async () => ({ blacklist: ["ads.test"] }) },
    readTrustedPath: async () => null,
  };
  const args = {
    sourceUrl: "https://source.test/",
    targetUrl: "https://ads.test/",
    context: { origin: "website", attribution: "unconfirmed" },
  };
  assert.equal(
    (await evaluateNavigationPolicy(args, io)).reviewSurface,
    "toast",
  );
  assert.equal(
    (
      await evaluateNavigationPolicy(
        { ...args, context: { origin: "website", attribution: "confirmed" } },
        io,
      )
    ).decision,
    "close",
  );
});

test("trace exports versioned attribution without capturing search, tokens or intent URLs", () => {
  const event = normalizeNavigationDiagnosticEvent({
    type: "policy_decided",
    navigationSchema: "navigation-context.v1",
    navigationId: "nav-abc-1",
    attribution: "unconfirmed",
    origin: "website",
    sourceFrameId: 7,
    revision: 2,
    attributionEvidence: ["recent_click_timing", "secret"],
    targetUrl: "https://target.test/?token=private",
    intent: { intentUrl: "https://private.test/" },
  });
  assert.equal(event.navigationSchema, "navigation-context.v1");
  assert.deepEqual(event.attributionEvidence, ["recent_click_timing"]);
  assert.equal(JSON.stringify(event).includes("private"), false);
  assert.equal("intent" in event, false);
});
