import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  iosNetworkRules,
  iosSiteAllowRules,
  isKnownAdUrl,
} from "../src/ios/network-rules.js";
import {
  shouldAutoHideIosBanner,
  iosBuiltinDomSelectors,
} from "../src/ios/automatic-dom.js";
const resources = new URL(
  "../ios/AdsFriendly_iOS/AdsFriendly_iOS Extension/Resources/",
  import.meta.url,
);

test("URL rules block known ad resources/paths without matching host spoofing or normal login/video", () => {
  const rules = iosNetworkRules();
  const matches = (url) =>
    rules.some((rule) => new RegExp(rule.condition.regexFilter, "i").test(url));
  for (const url of [
    "https://x.doubleclick.net/ads/x",
    "https://site.test/pagead/script.js",
    "https://ads.mgid.com/a",
  ])
    assert.equal(matches(url), true, url);
  for (const url of [
    "https://doubleclickXnet/x",
    "https://doubleclick.net.evil.test/x",
    "https://site.test/login",
    "https://site.test/watch/123",
    "https://site.test/banner/story",
    "https://site.test/?next=https://doubleclick.net/x",
  ])
    assert.equal(matches(url), false, url);
  assert.equal(new Set(rules.map((rule) => rule.id)).size, rules.length);
  assert.ok(
    rules.every((rule) => !rule.condition.resourceTypes.includes("main_frame")),
  );
  assert.equal(isKnownAdUrl("javascript:alert(1)"), false);
});
test("Allow applies to source frames and a more-specific Block cannot inherit blanket Allow", () => {
  const rules = iosSiteAllowRules(["example.test"], ["||ads.example.test^"]);
  const winning = (url) =>
    rules
      .filter((rule) => new RegExp(rule.condition.regexFilter).test(url))
      .sort((a, b) => b.priority - a.priority)[0];
  assert.equal(
    winning("https://example.test/").action.type,
    "allowAllRequests",
  );
  assert.equal(winning("https://ads.example.test/").action.type, "allow");
  assert.deepEqual(iosSiteAllowRules(["same.test"], ["||same.test^"]), []);
  assert.equal(
    iosSiteAllowRules(["http://user:pass@example.test"], []).length,
    0,
  );
});
test("automatic banner removal requires media plus known ad evidence, not a generic banner/external link", () => {
  const base = {
    visible: true,
    tag: "a",
    descendants: { imageCount: 1 },
    href: "https://www.shop.test/catalog",
  };
  assert.equal(shouldAutoHideIosBanner(base), false);
  assert.equal(
    shouldAutoHideIosBanner({ ...base, href: "https://ad.doubleclick.net/ad" }),
    true,
  );
  assert.equal(
    shouldAutoHideIosBanner({
      ...base,
      inProtectedArea: true,
      href: "https://ad.doubleclick.net/ad",
    }),
    false,
  );
  assert.equal(
    shouldAutoHideIosBanner({
      ...base,
      visible: false,
      href: "https://ad.doubleclick.net/ad",
    }),
    false,
  );
  assert.equal(
    shouldAutoHideIosBanner({
      ...base,
      id: "hero-banner",
      className: "banner",
      linkExternal: true,
    }),
    false,
  );
});
function autoHideBlock(features) {
  return shouldAutoHideIosBanner(features, { policy: "block" });
}
test("Block removes explicit linked-image grids and iframe slots without a known ad domain", () => {
  const shouldAutoHideIosBanner = (features) => autoHideBlock(features);
  const grid = {
    visible: true,
    tag: "div",
    className: "header-ads-pc",
    textLength: 0,
    rect: { width: 360, height: 210, areaRatio: 0.23 },
    descendants: {
      imageCount: 6,
      iframeCount: 0,
      linkCount: 6,
      externalLinkCount: 6,
      externalAdLinkCount: 0,
      imageCdnCount: 6,
    },
    signals: { classHasAdToken: true },
  };
  assert.equal(shouldAutoHideIosBanner(grid), true);
  assert.equal(
    shouldAutoHideIosBanner({ ...grid, className: "hero-banner" }),
    false,
  );
  assert.equal(shouldAutoHideIosBanner({ ...grid, textLength: 1500 }), false);
  assert.equal(
    shouldAutoHideIosBanner({ ...grid, inProtectedArea: true }),
    false,
  );
  assert.equal(
    shouldAutoHideIosBanner({
      ...grid,
      tag: "iframe",
      className: "ads-slot",
      descendants: {},
      rect: { width: 300, height: 250 },
    }),
    true,
  );
  assert.equal(
    shouldAutoHideIosBanner({
      ...grid,
      tag: "a",
      className: "",
      linkExternal: true,
      ancestry: [{ tag: "div", className: "header-ads-pc", childCount: 6 }],
      descendants: { imageCount: 1, linkCount: 0 },
    }),
    true,
  );
});
test("publisher cosmetic rules are narrowly scoped and never block the shared image CDN", () => {
  const publisher = iosBuiltinDomSelectors("animevietsub.sale");
  assert.ok(publisher.includes('div[id^="_preload-ads-"]'));
  assert.ok(
    publisher.some((selector) =>
      selector.includes("animevietsubapp-right-banner"),
    ),
  );
  assert.deepEqual(iosBuiltinDomSelectors("www.animevietsub.sale."), publisher);
  assert.ok(
    !iosBuiltinDomSelectors("animevietsub.sale.evil.test").some((selector) =>
      selector.includes("animevietsubapp"),
    ),
  );
  assert.ok(
    publisher.every((selector) => !selector.includes("googleusercontent")),
  );
});
test("DNR controller honors off/Allow, preserves unrelated IDs and exposes missing/failed APIs", async () => {
  let enabled = [],
    dynamic = [{ id: 7 }],
    data = {
      appSettings: { enabled: true },
      whitelist: ["source.test"],
      blacklist: [],
    };
  let fail = false;
  const api = {
    runtime: { lastError: null },
    storage: { onChanged: { addListener() {} } },
    declarativeNetRequest: {
      getEnabledRulesets(cb) {
        cb(enabled);
      },
      getDynamicRules(cb) {
        cb(dynamic);
      },
      updateEnabledRulesets(options, cb) {
        enabled = options.enableRulesetIds || [];
        cb();
      },
      updateDynamicRules(options, cb) {
        if (fail) throw new Error("DNR unavailable");
        dynamic = dynamic
          .filter((rule) => !options.removeRuleIds.includes(rule.id))
          .concat(options.addRules);
        cb();
      },
    },
  };
  const context = {
    browser: api,
    chrome: api,
    Promise,
    console,
    AFSettingsReady: Promise.resolve(),
    AFShared: {
      iosSiteAllowRules,
      iosNetworkRules,
      storageAdapter: () => ({ get: async () => data }),
      callApi: (object, method, ...args) =>
        new Promise((resolve, reject) => {
          try {
            object[method](...args, resolve);
          } catch (error) {
            reject(error);
          }
        }),
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    await readFile(new URL("background/network.js", resources), "utf8"),
    context,
  );
  await context.AFNetworkReady;
  assert.equal(context.bgGetNetworkState().state, "active");
  assert.equal(
    dynamic.find((rule) => rule.id === 20000).action.type,
    "allowAllRequests",
  );
  data = { appSettings: { enabled: false } };
  await context.bgRefreshNetworkRules();
  assert.equal(context.bgGetNetworkState().state, "disabled");
  assert.deepEqual(dynamic, [{ id: 7 }]);
  fail = true;
  await context.bgRefreshNetworkRules();
  assert.equal(context.bgGetNetworkState().state, "error");
  delete api.declarativeNetRequest.updateDynamicRules;
  await context.bgRefreshNetworkRules();
  assert.equal(context.bgGetNetworkState().state, "unavailable");
});
