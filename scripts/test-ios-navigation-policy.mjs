import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const IOS_RESOURCES = new URL(
  "../ios/AdsFriendly_iOS/AdsFriendly_iOS Extension/Resources/",
  import.meta.url,
);

await testAdTokenMatching();
await testBackgroundNewTabPolicy();
await testMainWorldPopupPolicy();
await testIosDecisionUiContract();

console.log("iOS navigation policy checks passed.");

async function testAdTokenMatching() {
  const helpers = await readFile(
    new URL("utils/helpers.js", IOS_RESOURCES),
    "utf8",
  );
  const context = {
    chrome: {},
    URL,
    window: {
      location: {
        href: "https://source.example/page",
        origin: "https://source.example",
      },
    },
  };
  vm.runInNewContext(
    `${helpers}
      globalThis.tokenResults = {
        download: hasAdTokenSignal("download-button"),
        address: hasAdTokenSignal("address-link"),
        explicitAd: hasAdTokenSignal("promo_ad_banner")
      };`,
    context,
  );

  assert.equal(context.tokenResults.download, false);
  assert.equal(context.tokenResults.address, false);
  assert.equal(context.tokenResults.explicitAd, true);
}

async function testBackgroundNewTabPolicy() {
  const source = await readFile(
    new URL("background/tab-tracker.js", IOS_RESOURCES),
    "utf8",
  );
  const listeners = {
    created: [],
    updated: [],
    activated: [],
    committed: [],
    createdTarget: [],
    messages: [],
  };
  const tabs = new Map([[1, { id: 1, url: "https://source.example/article" }]]);
  const neutralized = [];
  const add = (bucket) => ({
    addListener: (listener) => bucket.push(listener),
  });
  const browser = {
    tabs: {
      query(_query, callback) {
        callback([tabs.get(1)]);
      },
      get(tabId, callback) {
        callback(tabs.get(tabId));
      },
      onActivated: add(listeners.activated),
      onCreated: add(listeners.created),
      onUpdated: add(listeners.updated),
    },
    runtime: {
      lastError: null,
      onMessage: add(listeners.messages),
    },
    webNavigation: {
      onCreatedNavigationTarget: add(listeners.createdTarget),
      onCommitted: add(listeners.committed),
    },
  };
  const context = {
    browser,
    chrome: browser,
    console: { log() {} },
    Date,
    URL,
    setTimeout: (callback, ms) => (ms > 1000 ? 0 : setTimeout(callback, ms)),
    clearTimeout,
    bgIsWhitelisted: () => false,
    bgIsUserBlockedPopup: () => false,
    bgIsUserAllowedPopup: () => false,
    bgIsTrustedInitiator: () => false,
    bgAreSameSite: (left, right) =>
      new URL(left).hostname === new URL(right).hostname,
    bgIsAdLikeUrl: (url) => new URL(url).hostname.endsWith("doubleclick.net"),
    neutralizeTab(tabId, sourceTabId, url) {
      neutralized.push({ tabId, sourceTabId, url });
    },
  };
  context.window = context;
  vm.runInNewContext(source, context);

  const onCreatedTarget = listeners.createdTarget[0];
  onCreatedTarget({
    tabId: 2,
    sourceTabId: 1,
    url: "https://news.example/story",
  });
  await wait(240);
  assert.equal(
    neutralized.length,
    0,
    "an ambiguous cross-site tab must stay open",
  );

  onCreatedTarget({
    tabId: 3,
    sourceTabId: 1,
    url: "https://ads.doubleclick.net/ad/",
  });
  await wait(240);
  assert.equal(neutralized.length, 1, "an unsolicited known ad tab is blocked");

  listeners.messages[0](
    { action: "trusted_popup", url: "https://ads.doubleclick.net/ad/" },
    { tab: { id: 1 } },
  );
  onCreatedTarget({
    tabId: 4,
    sourceTabId: 1,
    url: "https://ads.doubleclick.net/ad/",
  });
  await wait(240);
  assert.equal(
    neutralized.length,
    1,
    "a popup opened during a real user gesture must stay open",
  );
}

async function testMainWorldPopupPolicy() {
  const injector = await readFile(
    new URL("content/injector.js", IOS_RESOURCES),
    "utf8",
  );
  let injectedCode = "";
  const outerDocument = {
    createElement() {
      return {
        textContent: "",
        remove() {},
      };
    },
    documentElement: {
      appendChild(script) {
        injectedCode = script.textContent;
      },
    },
    head: null,
  };
  vm.runInNewContext(injector, {
    Blob,
    URL,
    btoa: (value) => Buffer.from(value).toString("base64"),
    document: outerDocument,
    log() {},
    setTimeout,
  });

  assert.ok(injectedCode.includes("userInitiated: isUserInitiated()"));
  assert.ok(!injectedCode.includes("window.location.constructor.prototype"));

  const handlers = {};
  const attributes = new Map();
  const popupDetails = [];
  let opened = 0;
  const documentElement = {
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };
  const innerDocument = {
    documentElement,
    addEventListener(type, listener) {
      handlers[type] = listener;
    },
  };
  const innerWindow = {
    open() {
      opened++;
      return { opened: true };
    },
    dispatchEvent(event) {
      const detail = JSON.parse(event.detail);
      popupDetails.push(detail);
      if (detail.userInitiated) {
        documentElement.setAttribute("__afs_allow__", "yes");
      }
    },
  };
  const mainWorld = {
    window: innerWindow,
    document: innerDocument,
    navigator: { userActivation: { isActive: false } },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    Date,
  };
  innerWindow.window = innerWindow;
  vm.runInNewContext(injectedCode, mainWorld);

  innerWindow.open("https://news.example/no-gesture", "_blank");
  assert.equal(opened, 0);
  assert.equal(popupDetails.at(-1).userInitiated, false);

  handlers.pointerdown();
  innerWindow.open("https://news.example/user-opened", "_blank");
  assert.equal(opened, 1);
  assert.equal(popupDetails.at(-1).userInitiated, true);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testIosDecisionUiContract() {
  const [manifestSource, background, ui, popupBlocker, bannerDetector, canonicalPackage, iosPackage] =
    await Promise.all([
      readFile(new URL("manifest.json", IOS_RESOURCES), "utf8"),
      readFile(new URL("background.js", IOS_RESOURCES), "utf8"),
      readFile(new URL("content/ui.js", IOS_RESOURCES), "utf8"),
      readFile(new URL("content/popup-blocker.js", IOS_RESOURCES), "utf8"),
      readFile(new URL("content/banner-detector.js", IOS_RESOURCES), "utf8"),
      readFile(new URL("../packages/default-settings-package.json", import.meta.url), "utf8"),
      readFile(new URL("packages/default-settings-package.json", IOS_RESOURCES), "utf8"),
    ]);
  const manifest = JSON.parse(manifestSource);
  assert.ok(manifest.background.scripts.includes("utils/settings-package.js"));
  assert.ok(manifest.background.scripts.includes("background/settings-package.js"));
  assert.ok(manifest.content_scripts[0].js.includes("content/dom-rules.js"));
  assert.equal("options_ui" in manifest, false, "mobile keeps settings intentionally small");
  assert.equal(background.includes('request.action === "restore_tabs"'), false);
  assert.equal(background.includes('request.action === "open_tabs"'), false);
  assert.ok(background.includes('request.action === "open_once"'));
  assert.ok(ui.includes('action: "allow_popups"'));
  assert.ok(ui.includes('action: "block_popups"'));
  assert.ok(ui.includes('action: "open_once"'));
  assert.ok(popupBlocker.includes("notifyBlocked(url, true)"));
  assert.ok(popupBlocker.includes("notifyBlocked(url, false)"));
  assert.ok(ui.includes("notifyBannerCandidate"));
  assert.ok(ui.includes("Suspected ad banner"));
  assert.ok(bannerDetector.includes('saveDomDecision(selector, "hide")'));
  assert.ok(bannerDetector.includes('saveDomDecision(selector, "show")'));
  assert.deepEqual(JSON.parse(iosPackage), JSON.parse(canonicalPackage));
}
