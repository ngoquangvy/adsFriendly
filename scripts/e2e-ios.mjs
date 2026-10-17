import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const resources = new URL(
  "../ios/AdsFriendly_iOS/AdsFriendly_iOS Extension/Resources/",
  import.meta.url,
);
const chromePath =
  process.env.CHROME_PATH ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const profile = await mkdtemp(path.join(tmpdir(), "adsfriendly-ios-e2e-"));
let browserProcess, session;
const appResources = new URL(
  "../ios/AdsFriendly_iOS/AdsFriendly_iOS/",
  import.meta.url,
);
const appRoutes = {
  "/native-app": ["Base.lproj/Main.html", "text/html; charset=utf-8"],
  "/Style.css": ["Resources/Style.css", "text/css"],
  "/DNS.js": ["Resources/DNS.js", "text/javascript"],
};
const server = createServer(async (request, response) => {
  if (appRoutes[request.url]) {
    const [file, type] = appRoutes[request.url];
    response.writeHead(200, { "content-type": type });
    response.end(await readFile(new URL(file, appResources)));
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>div{display:flex;height:50px;width:240px}body{margin:0}</style>
    <div id="mobile-ad" class="mobile-ad">Mobile ad</div><div class="desktop-ad">Desktop ad</div>
    <div id="keep-ad" class="keep-ad">Keep this slot</div><form id="login"><input type="password"></form>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
    this.socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (!data.id) return;
      const callbacks = this.pending.get(data.id);
      if (!callbacks) return;
      this.pending.delete(data.id);
      data.error
        ? callbacks.reject(new Error(JSON.stringify(data.error)))
        : callbacks.resolve(data.result);
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    const promise = new Promise((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  }
}
try {
  let logs = "";
  browserProcess = spawn(
    chromePath,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      "--user-data-dir=" + profile,
      "about:blank",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Chrome did not start")),
      15000,
    );
    browserProcess.on("error", reject);
    browserProcess.stderr.on("data", (chunk) => {
      logs += chunk;
      const found = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (found) {
        clearTimeout(timeout);
        resolve(found[1]);
      }
    });
  });
  const port = new URL(endpoint).port;
  const targets = await (
    await fetch("http://127.0.0.1:" + port + "/json/list")
  ).json();
  session = new CDP(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  const shared = await readFile(new URL("utils/shared.js", resources), "utf8");
  const chromeToast = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/dom/toast.js", import.meta.url)),
    ],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "AFDomToast",
    target: ["chrome110"],
  });
  const chromeCollector = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/dom/collector.js", import.meta.url)),
    ],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "AFDomCollector",
    target: ["chrome110"],
  });
  const scripts = [
    "utils/config.js",
    "utils/helpers.js",
    "content/dom-rules.js",
    "content/ui.js",
    "content/popup-blocker.js",
    "content/banner-detector.js",
  ];
  const seed = `
    window.testMessages = []; window.testShadows = []; window.testFailSave = false;
    const originalShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { const root = originalShadow.call(this, options); if (this.id === 'adsfriendly-popup-container') testShadows.push(root); return root; };
    window.testData = {
      appSettings: { enabled: true }, whitelist: [], blacklist: [],
      userCustomRules: { "127.0.0.1": [
        { selector: ".mobile-ad", layout: "compact" }, { selector: ".desktop-ad", layout: "wide" }, { selector: ".keep-ad", layout: "any" }
      ] },
      userElementExceptions: { "127.0.0.1": [{ selector: ".keep-ad", layout: "any", fingerprint: { tag: "div", id: "keep-ad" } }] }
    };
    const changes = [], messageListeners = [];
    window.testChange = function(key, value) { testData[key] = value; changes.forEach(fn => fn({[key]:{newValue:value}}, "local")); };
    window.chrome = {
      storage: { local: { get(keys, callback) { callback(testData); } }, onChanged: { addListener(fn) { changes.push(fn); } } },
      runtime: { lastError: null, onMessage: { addListener(fn) { messageListeners.push(fn); } },
        sendMessage(message, callback) {
          testMessages.push(message);
          if (message.action === "get_popup_rules") { callback({ allowed: {}, blocked: {} }); return; }
          if (testFailSave && ["allow_popups", "block_popups", "save_dom_decision"].includes(message.action)) callback?.({error:"Storage full"});
          else callback?.({ status: "saved" });
        }
      }
    };
  `;
  const sources = await Promise.all(
    scripts.map((file) => readFile(new URL(file, resources), "utf8")),
  );
  await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source: seed + "\n" + shared + "\n" + sources.join("\n"),
  });
  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port,
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(
    await session.evaluate(
      "getComputedStyle(document.getElementById('mobile-ad')).display",
    ),
    "none",
  );
  assert.equal(
    await session.evaluate(
      "getComputedStyle(document.querySelector('.desktop-ad')).display",
    ),
    "flex",
  );
  assert.equal(
    await session.evaluate(
      "getComputedStyle(document.getElementById('keep-ad')).display",
    ),
    "flex",
  );
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 980,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(
    await session.evaluate(
      "getComputedStyle(document.getElementById('mobile-ad')).display",
    ),
    "flex",
  );
  assert.equal(
    await session.evaluate(
      "getComputedStyle(document.querySelector('.desktop-ad')).display",
    ),
    "none",
  );
  await session.evaluate("testChange('appSettings', {enabled:false})");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate(
      "getComputedStyle(document.querySelector('.desktop-ad')).display",
    ),
    "flex",
  );
  await session.evaluate("notifyBlocked('https://blocked.example/path', true)");
  assert.match(
    await session.evaluate("testShadows.at(-1).textContent"),
    /Blocked blocked.example/,
  );
  await session.evaluate("testShadows.at(-1).querySelector('button').click()");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    await session.evaluate("testMessages.at(-1).action"),
    "open_once",
  );
  await session.evaluate(
    "notifyBlocked('https://one.example/path', false); window.testActiveCard = testShadows.at(-1).querySelector('.card'); notifyBlocked('https://two.example/path', false)",
  );
  assert.equal(
    await session.evaluate(
      "testShadows.at(-1).querySelector('.card') === testActiveCard",
    ),
    true,
    "Enqueuing another review must not replace the active card or restart its timeout",
  );
  await session.evaluate(
    "testFailSave=true; testShadows.at(-1).querySelector('button').click()",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.match(
    await session.evaluate("testShadows.at(-1).textContent"),
    /Storage full/,
  );
  await session.evaluate(
    "testFailSave=false; testShadows.at(-1).querySelector('button').click()",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.match(
    await session.evaluate("testShadows.at(-1).textContent"),
    /two.example/,
  );
  assert.equal(
    await session.evaluate(
      "testMessages.filter(x=>x.action==='allow_popups').at(-1).urls.length",
    ),
    1,
  );
  await session.evaluate(
    "testShadows.at(-1).querySelector('button:last-of-type').click(); notifyBannerCandidate(document.getElementById('keep-ad'), 'test', {hide:async()=>{window.testBannerHidden=true},show:async()=>{},dismiss:()=>{}})",
  );
  assert.match(
    await session.evaluate("testShadows.at(-1).textContent"),
    /Marked area\?HideKeep/,
  );
  await session.evaluate("testShadows.at(-1).querySelector('button').click()");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await session.evaluate("window.testBannerHidden"), true);

  // Start a fresh document to test real detector/observer interactions rather
  // than only calling the notification function directly.
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 700,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/banner-regression",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await session.evaluate(`
    for (const [id, style, content] of [
      ['ad-empty', 'width:300px;height:70px', ''],
      ['ad-broken', 'width:300px;height:70px', '<img src="/broken" width="300" height="70">'],
      ['ad-offscreen', 'position:absolute;top:3000px;width:300px;height:70px', 'Advertisement'],
      ['ad-hidden-parent', 'opacity:0;width:300px;height:70px', '<div class="ad-banner" style="opacity:1">Advertisement</div>'],
      ['hero-banner', 'width:300px;height:70px', '<a class="banner" href="https://news.example/story">Normal featured story</a>'],
    ]) {
      const el = document.createElement('div'); el.id = id; el.style.cssText = style;
      el.innerHTML = content; document.body.appendChild(el);
    }
    AF_scanBanners();
  `);
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-popup-container') === null",
    ),
    true,
    "Empty slots, broken images, offscreen content, hidden ancestors and generic banners are not reviewable ads",
  );
  await session.evaluate(`
    window.testNow = 100000; Date.now = () => testNow;
    const realTimeout = window.setTimeout;
    window.setTimeout = function(fn, ms, ...args) {
      if (ms === 8000) window.testBannerTimeout = fn;
      return realTimeout(fn, ms, ...args);
    };
    window.testSlot = document.createElement('div');
    testSlot.id = 'ad-review-slot'; testSlot.className = 'ad-banner';
    testSlot.style.cssText = 'position:fixed;top:120px;left:10px;width:300px;height:70px';
    testSlot.innerHTML = '<a href="https://ads.example/ads/banner"><img alt="Advertisement" style="width:300px;height:70px"></a>';
    testSlot.querySelector('img').src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="70"><rect width="300" height="70" fill="#eab308"/></svg>');
    document.body.appendChild(testSlot);
    testSlot.querySelector('img').decode().then(() => AF_scanBanners());
  `);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(
    await session.evaluate("testShadows.at(-1).textContent"),
    /Marked area\?HideKeep/,
  );
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-review-target') !== null",
    ),
    true,
    "The exact reviewed region must be marked without hover",
  );
  const markerGeometry = await session.evaluate(`(() => {
    const marker = document.getElementById('adsfriendly-review-target').getBoundingClientRect();
    const image = testSlot.querySelector('img').getBoundingClientRect();
    return { markerHeight: marker.height, imageHeight: image.height, markerTop: marker.top, imageTop: image.top };
  })()`);
  assert.ok(
    markerGeometry.markerHeight >= markerGeometry.imageHeight &&
      markerGeometry.markerTop <= markerGeometry.imageTop,
    "An inline link marker must cover its actual visible image, not just a 17px text box",
  );
  for (const width of [320, 375, 390, 768, 980]) {
    await session.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 700,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    const geometry = await session.evaluate(`(() => {
      const root = testShadows.at(-1), card = root.querySelector('.card');
      const rect = card.getBoundingClientRect();
      const buttons = [...card.querySelectorAll('button')].map(b => b.getBoundingClientRect());
      return { width: rect.width, height: rect.height, left: rect.left, right: rect.right,
        viewport: innerWidth, aligned: buttons.every(b => b.top === buttons[0].top),
        touch: buttons.every(b => b.height >= 44 && b.width >= 44),
        whiteSpace: getComputedStyle(root.querySelector('.message')).whiteSpace };
    })()`);
    assert.ok(geometry.height <= 56, JSON.stringify(geometry));
    assert.ok(
      geometry.width <= 440 &&
        geometry.left >= 0 &&
        geometry.right <= geometry.viewport,
      JSON.stringify(geometry),
    );
    assert.equal(geometry.aligned, true);
    assert.equal(geometry.touch, true);
    assert.equal(geometry.whiteSpace, "nowrap");
  }
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 700,
    deviceScaleFactor: 1,
    mobile: true,
  });
  if (process.env.AF_IOS_SCREENSHOT) {
    const screenshot = await session.send("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(
      process.env.AF_IOS_SCREENSHOT,
      Buffer.from(screenshot.data, "base64"),
    );
  }
  await session.evaluate(`
    testBannerTimeout(); testNow += 70000;
    document.body.classList.add('unrelated-site-animation');
    testSlot.classList.add('refreshed');
    testSlot.querySelector('img').setAttribute('src', '/new-creative.png');
    window.dispatchEvent(new Event('resize'));
    testChange('appSettings', {enabled:true}); AF_scanBanners();
  `);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-popup-container') === null",
    ),
    true,
    "Unrelated mutations, storage changes and height resize must not repeat a dismissed banner",
  );
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-review-target') === null",
    ),
    true,
  );
  assert.equal(
    await session.evaluate(
      "testMessages.some(m => m.action === 'save_dom_decision')",
    ),
    false,
    "Automatic dismissal must not silently save a persistent Hide/Keep choice",
  );
  await session.evaluate(`
    const replacement = testSlot.cloneNode(true); testSlot.replaceWith(replacement);
    testSlot = replacement; AF_scanBanners();
  `);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-popup-container') === null",
    ),
    true,
    "Replacing the ad slot must not ask again through a new link or wrapper node",
  );
  await session.evaluate(`
    window.testOther = document.createElement('div');
    testOther.id = 'ad-other-slot'; testOther.className = 'ad-banner';
    testOther.style.cssText = 'position:fixed;top:220px;width:300px;height:70px';
    testOther.textContent = 'Advertisement'; document.body.appendChild(testOther); AF_scanBanners();
  `);
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-popup-container') !== null",
    ),
    true,
  );
  await session.evaluate("testShadows.at(-1).querySelector('button').click()");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    await session.evaluate("testMessages.at(-1).action"),
    "save_dom_decision",
  );
  assert.equal(await session.evaluate("testMessages.at(-1).decision"), "hide");
  assert.equal(
    await session.evaluate("getComputedStyle(testOther).display"),
    "none",
  );
  await session.evaluate(`
    testNow += 70000;
    for (let i = 0; i < 30; i++) {
      const el = document.createElement('div'); el.id = 'ad-flood-' + i;
      el.style.cssText = 'width:300px;height:70px'; el.textContent = 'Advertisement';
      document.body.appendChild(el);
    }
    AF_scanBanners();
    notifyBlocked('https://navigation-still-works.example/path', true);
  `);
  assert.match(
    await session.evaluate("testShadows.at(-1).textContent"),
    /Blocked navigation-still-works.example/,
    "Banner budget must not suppress real blocked-navigation notifications",
  );
  await session.evaluate(
    "testShadows.at(-1).querySelector('.close').click(); AF_scanBanners()",
  );
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-popup-container') === null",
    ),
    true,
    "A page flooding new ad slots must not start another automatic banner review",
  );

  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/ios-stale",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await session.evaluate(`
    const el = document.createElement('div'); el.id = 'ad-stale'; el.style.cssText = 'width:280px;height:70px';
    el.textContent = 'Advertisement'; document.body.appendChild(el); AF_scanBanners();
    const button = testShadows.at(-1).querySelector('button'); el.textContent = 'New unrelated content'; button.click();
  `);
  assert.equal(
    await session.evaluate(
      "testMessages.some(m => m.action === 'save_dom_decision')",
    ),
    false,
  );
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-review-target') === null",
    ),
    true,
  );

  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/banner-keep",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await session.evaluate(`
    const el = document.createElement('div'); el.id = 'ad-keep-choice';
    el.style.cssText = 'width:300px;height:70px'; el.textContent = 'Advertisement';
    document.body.appendChild(el); AF_scanBanners();
    testFailSave = true;
    testShadows.at(-1).querySelectorAll('button')[1].click();
  `);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.match(
    await session.evaluate(
      "testShadows.at(-1).querySelector('.error').textContent",
    ),
    /Storage full/,
  );
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-popup-container') !== null",
    ),
    true,
  );
  await session.evaluate(
    "testFailSave = false; testShadows.at(-1).querySelectorAll('button')[1].click()",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await session.evaluate("testMessages.at(-1).decision"), "show");
  assert.notEqual(
    await session.evaluate(
      "getComputedStyle(document.getElementById('ad-keep-choice')).display",
    ),
    "none",
  );
  await session.evaluate("AF_scanBanners()");
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-popup-container') === null",
    ),
    true,
  );
  const earlyPopup = await session.send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source:
        "notifyBlocked('https://a-very-long-blocked-advertising-domain.example/path', true)",
    },
  );
  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/early-popup",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.match(
    await session.evaluate(
      "testShadows.at(-1).querySelector('.message').textContent",
    ),
    /Blocked a-very-long-blocked-advertising-domain.example/,
    "A review received before document.body exists must render after DOMContentLoaded",
  );
  const longToast = await session.evaluate(`(() => {
    const rect = testShadows.at(-1).querySelector('.card').getBoundingClientRect();
    return { height: rect.height, left: rect.left, right: rect.right, viewport: innerWidth };
  })()`);
  assert.ok(
    longToast.height <= 56 &&
      longToast.left >= 0 &&
      longToast.right <= longToast.viewport,
  );
  await session.send("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: earlyPopup.identifier,
  });

  // Block must actually remove known ads even after the review budget is used.
  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/ios-block",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await session.evaluate(`
    testChange('blacklist', ['||127.0.0.1^']);
    window.blockBanner = document.createElement('div'); blockBanner.id = 'ad-strong-slot';
    blockBanner.style.cssText = 'width:300px;height:70px';
    blockBanner.innerHTML = '<a href="https://pagead2.googlesyndication.com/pagead/ad"><img style="width:300px;height:70px"></a>';
    document.body.appendChild(blockBanner);
    window.builtinBanner = document.createElement('ins'); builtinBanner.className = 'adsbygoogle';
    builtinBanner.style.cssText = 'display:block;width:300px;height:70px'; builtinBanner.textContent = 'Advertisement';
    document.body.appendChild(builtinBanner);
    window.keptBanner = blockBanner.cloneNode(true); keptBanner.id = 'ad-kept-slot'; keptBanner.style.display='block';
    document.body.appendChild(keptBanner);
    testChange('userElementExceptions', {'127.0.0.1': [{selector:'#ad-kept-slot', layout:'compact', fingerprint:{tag:'div',id:'ad-kept-slot'}}]});
    AF_scanBanners();
  `);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate("getComputedStyle(blockBanner).display"),
    "none",
  );
  assert.equal(
    await session.evaluate("getComputedStyle(builtinBanner).display"),
    "none",
  );
  assert.notEqual(
    await session.evaluate("getComputedStyle(keptBanner).display"),
    "none",
  );
  assert.notEqual(
    await session.evaluate(
      "getComputedStyle(keptBanner.querySelector('a')).display",
    ),
    "none",
    "Keep on a banner must also protect its ad-resource children",
  );
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-popup-container') === null",
    ),
    true,
    "Confirmed ads in Block must be removed without another review",
  );
  await session.evaluate(
    "blockBanner.style.setProperty('display','grid','important')",
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate("getComputedStyle(blockBanner).display"),
    "none",
    "Ad scripts cannot undo an active block by writing display again: " +
      (await session.evaluate(
        "JSON.stringify({tracked:AF_DOM.isHidden(blockBanner), policy:getCurrentSitePolicy(), features:AFShared.extractDomFeatures(blockBanner), allowed:AF_DOM.isAllowed(blockBanner, '#ad-strong-slot')})",
      )),
  );
  await session.evaluate(
    "testChange('whitelist',['127.0.0.1']); testChange('blacklist',[])",
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate("getComputedStyle(blockBanner).display"),
    "grid",
  );
  assert.equal(
    await session.evaluate("getComputedStyle(builtinBanner).display"),
    "block",
  );

  // Exercise the Chrome toast module itself, independently of Safari mocks.
  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/chrome-review",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await session.evaluate("testChange('appSettings', {enabled:false})");
  await session.evaluate(chromeToast.outputFiles[0].text);
  await session.evaluate(`
    window.testRootTarget = document.createElement('div'); testRootTarget.id = 'root-ad-target';
    testRootTarget.style.cssText = 'width:280px;height:70px;outline:1px solid red';
    testRootTarget.textContent = 'Advertisement to review'; document.body.appendChild(testRootTarget);
    window.testRootShows = 0;
    window.testRootCandidate = {target:testRootTarget, features:{tag:'div'}, decision:{confidence:0.81}};
    AFDomToast.showDomCandidateToast(testRootCandidate, {
      onHide: async () => {
        testRootTarget.style.visibility = 'hidden';
        throw new Error('Settings storage is full: Storage verification failed for userCustomRules.');
      },
      onShow: async () => { testRootShows++; testRootTarget.style.visibility = 'visible'; },
    });
  `);
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-review-target') !== null",
    ),
    true,
  );
  await session.evaluate(
    "document.querySelector('.adsfriendly-dom-hide').click()",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    await session.evaluate(
      "document.querySelector('.adsfriendly-dom-message').textContent",
    ),
    "Hidden once · save not verified",
  );
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-review-target') === null",
    ),
    true,
  );
  await session.evaluate(
    "document.querySelector('.adsfriendly-dom-allow').click()",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await session.evaluate("testRootShows"), 1);
  assert.equal(
    await session.evaluate("testRootTarget.style.outline"),
    "red solid 1px",
  );

  await session.evaluate(`
    AFDomToast.showDomCandidateToast({target:testRootTarget, features:{tag:'div'}, decision:{confidence:0.81}}, {
      onHide: async () => { testRootTarget.style.visibility = 'hidden'; throw new Error('QUOTA_BYTES quota exceeded'); }
    });
    document.querySelector('.adsfriendly-dom-hide').click();
  `);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    await session.evaluate(
      "document.querySelector('.adsfriendly-dom-message').textContent",
    ),
    "Hidden once · storage full",
  );
  await session.evaluate(
    "document.querySelector('.adsfriendly-dom-close').click(); testRootTarget.style.visibility = 'visible'",
  );
  await session.evaluate(`
    AFDomToast.showDomCandidateToast({target:testRootTarget, features:{tag:'div'}, decision:{confidence:0.81}}, {onHide:async()=>{testRootShows++}});
    window.testStaleButton = document.querySelector('.adsfriendly-dom-hide');
    testRootTarget.textContent = 'Different content'; testStaleButton.click();
  `);
  assert.equal(
    await session.evaluate("testRootShows"),
    1,
    "Changing the reviewed content must not call Hide",
  );
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-review-target') === null",
    ),
    true,
  );
  await session.evaluate(`
    const empty = document.createElement('div'); empty.style.cssText = 'width:280px;height:70px'; document.body.appendChild(empty);
    AFDomToast.showDomCandidateToast({target:empty, features:{tag:'div'}, decision:{confidence:0.81}}, {});
  `);
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-review-target') === null",
    ),
    true,
  );
  await session.evaluate(`
    AFDomToast.showDomCandidateToast({target:testRootTarget, features:{tag:'div'}, decision:{confidence:0.81}}, {});
    testRootTarget.style.opacity = '0';
  `);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-review-target') === null",
    ),
    true,
    "A blocker hiding the reviewed target must also remove the prompt and marker",
  );

  await session.evaluate(chromeCollector.outputFiles[0].text);
  await session.evaluate(`
    document.querySelectorAll('body > div, body > form').forEach(el => el.remove());
    window.testRootRequests = [];
    chrome.storage.local.get = async () => ({userElementExceptions:{}});
    chrome.storage.onChanged.removeListener = () => {};
    chrome.runtime.sendMessage = async message => {
      testRootRequests.push(message);
      if (message.type === 'RESTORE_CUSTOM_RULES') throw new Error('QUOTA_BYTES exceeded');
      if (message.type === 'UPSERT_CUSTOM_RULES' && window.testRootFailSave) throw new Error('QUOTA_BYTES exceeded');
      if (message.type === 'SYNC_LEARNING') throw new Error('Learning service unavailable');
      return {status:'saved'};
    };
    const link = document.createElement('a'); link.id = 'offer-link'; link.href = 'https://ads.example/ads/banner';
    link.innerHTML = '<img id="ad-selected-image" class="ads" style="width:280px;height:70px">';
    link.querySelector('img').src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="70"><rect width="280" height="70" fill="gold"/></svg>');
    document.body.appendChild(link); window.testActualLink = link;
    link.querySelector('img').decode().then(() => {
      window.testStopCollector = AFDomCollector.startDomCandidateCollector({can:id=>['dom.observe','dom.suggest'].includes(id)});
    });
  `);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(
    await session.evaluate(
      "document.querySelector('.adsfriendly-dom-message').textContent",
    ),
    /Marked A/,
    "The review label/fingerprint must describe the selected link, not its child image",
  );
  await session.evaluate(
    "document.querySelector('.adsfriendly-dom-hide').click()",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    await session.evaluate(
      "testRootRequests.find(m=>m.type==='UPSERT_CUSTOM_RULES').rules[0].fingerprint.tag",
    ),
    "a",
  );
  assert.equal(
    await session.evaluate("getComputedStyle(testActualLink).visibility"),
    "hidden",
  );
  assert.match(
    await session.evaluate(
      "document.querySelector('.adsfriendly-dom-message').textContent",
    ),
    /hidden · saved/,
    "A failed learning sync after a confirmed save must not report a settings error",
  );
  await session.evaluate(
    "document.querySelector('.adsfriendly-dom-close').click()",
  );
  await session.evaluate(`
    window.testRootFailSave = true;
    const next = testActualLink.cloneNode(true); next.id = 'offer-next'; next.href = 'https://other-ads.example/ads/banner';
    next.querySelector('img').id = 'ad-next-image'; next.removeAttribute('data-adsfriendly-rule-hidden');
    next.style.cssText = ''; document.body.appendChild(next); window.testNextLink = next;
  `);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await session.evaluate(
    "document.querySelector('.adsfriendly-dom-hide').click()",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    await session.evaluate(
      "document.querySelector('.adsfriendly-dom-message').textContent",
    ),
    "Hidden once · storage full",
  );
  await session.evaluate(
    "document.querySelector('.adsfriendly-dom-allow').click()",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    await session.evaluate("getComputedStyle(testNextLink).visibility"),
    "visible",
    "Show must restore an unsaved local hide even when storage remains unavailable",
  );
  assert.notEqual(
    await session.evaluate("getComputedStyle(testNextLink).opacity"),
    "0",
  );
  await session.evaluate("testStopCollector()");
  await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source:
      "window.nativeDNSMessages=[];window.webkit={messageHandlers:{controller:{postMessage:message=>nativeDNSMessages.push(message)}}}",
  });
  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/native-app",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  for (const width of [320, 390, 768]) {
    await session.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    assert.equal(
      await session.evaluate(
        "document.documentElement.scrollWidth <= innerWidth",
      ),
      true,
      "Native DNS page must not overflow horizontally",
    );
  }
  assert.equal(
    await session.evaluate("document.getElementById('export-dns').disabled"),
    true,
  );
  await session.evaluate(
    "document.getElementById('dns-consent').checked=true;document.getElementById('dns-consent').dispatchEvent(new Event('change'));document.getElementById('export-dns').click()",
  );
  assert.equal(await session.evaluate("nativeDNSMessages.length"), 1);
  assert.equal(
    await session.evaluate("nativeDNSMessages[0].action"),
    "exportDNSProfile",
  );
  assert.match(
    await session.evaluate("document.getElementById('dns-status').textContent"),
    /chưa thay đổi/,
  );
  await session.evaluate(
    "handleDNSResult({kind:'ready',message:'Export cancelled. No DNS settings were changed.'})",
  );
  assert.equal(
    await session.evaluate("document.getElementById('export-dns').disabled"),
    false,
  );
  console.log(
    "Chrome/iOS review browser checks passed: visible-content gates, automatic exact-region marker, stale-target cancellation, correct target fingerprint, storage verification vs quota errors, Show after quota failure, saved choices, dedupe and 320–980px layout.",
  );
} finally {
  session?.socket.close();
  if (browserProcess && browserProcess.exitCode === null) {
    const closed = new Promise((resolve) =>
      browserProcess.once("exit", resolve),
    );
    browserProcess.kill();
    await closed;
  }
  await new Promise((resolve) => server.close(resolve));
  const resolved = await realpath(profile),
    tempRoot = await realpath(tmpdir());
  if (
    resolved.startsWith(tempRoot + path.sep) &&
    path.basename(resolved).startsWith("adsfriendly-ios-e2e-")
  )
    await rm(resolved, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 300,
    });
}
