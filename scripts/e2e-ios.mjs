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
  const toolbarFiles = {
    "/toolbar-popup": "popup.html",
    "/popup.js": "popup.js",
    "/popup.css": "popup.css",
  };
  if (toolbarFiles[request.url]) {
    response.writeHead(200, {
      "content-type": request.url.endsWith(".js")
        ? "text/javascript"
        : request.url.endsWith(".css")
          ? "text/css"
          : "text/html",
    });
    response.end(await readFile(new URL(toolbarFiles[request.url], resources)));
    return;
  }
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
  assert.match(
    await session.evaluate("testShadows.at(-1).textContent"),
    /Area hiddenShow/,
  );
  await session.evaluate("testShadows.at(-1).querySelector('.close').click()");
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

  // Sanitized structure observed on animevietsub.sale: dedicated ad grids with
  // shared-CDN images and unknown outbound hosts. Never block the whole CDN.
  await session.send("Page.navigate", {
    url:
      "http://127.0.0.1:" +
      server.address().port +
      "/publisher-banner-regression",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await session.evaluate(`
    testChange('blacklist', ['||127.0.0.1^']);
    window.fixtureImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="350" height="70"><rect width="350" height="70" fill="gold"/></svg>');
    window.fixtureLink = function(host, id='') {const a=document.createElement('a');a.href='https://'+host+'/placement';a.id=id;a.style.cssText='display:block;width:350px;height:70px';a.innerHTML='<img src="'+fixtureImage+'" style="width:350px;height:70px">';return a;};
    window.fixtureVisible = function(el) {for(let n=el;n;n=n.parentElement) if(getComputedStyle(n).display==='none') return false;return true;};
    window.siteGrid=document.createElement('div');siteGrid.className='header-ads-pc';siteGrid.style.cssText='display:grid;width:350px;height:auto';
    for(let i=0;i<6;i++) siteGrid.appendChild(fixtureLink('unknown-sponsor-'+i+'.test'));
    document.body.appendChild(siteGrid);
    window.siteFooter=document.createElement('div');siteFooter.className='pc_catfix_adv';siteFooter.style.cssText='width:350px;height:70px';siteFooter.appendChild(fixtureLink('different-sponsor.test'));document.body.appendChild(siteFooter);
    window.normalHero=document.createElement('div');normalHero.className='hero-banner';normalHero.style.cssText='width:350px;height:70px';normalHero.appendChild(fixtureLink('news.example'));document.body.appendChild(normalHero);
    window.normalPoster=fixtureLink('127.0.0.1');document.body.appendChild(normalPoster);
    window.protectedNav=document.createElement('nav');protectedNav.appendChild(fixtureLink('ad.doubleclick.net'));document.body.appendChild(protectedNav);
    window.keptGrid=siteGrid.cloneNode(true);keptGrid.querySelector('a').id='kept-creative';document.body.appendChild(keptGrid);
    testChange('userElementExceptions', {'127.0.0.1':[{selector:'#kept-creative',layout:'compact',fingerprint:{tag:'a',id:'kept-creative'}}]});
    window.unknownFrame=document.createElement('iframe');unknownFrame.className='ads-slot';unknownFrame.style.cssText='width:300px;height:250px';document.body.appendChild(unknownFrame);
    AF_scanBanners();
  `);
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(
    await session.evaluate(
      "[...siteGrid.querySelectorAll('a'),siteFooter,unknownFrame].every(el=>!fixtureVisible(el))",
    ),
    true,
    "Unknown ad grids, footer creatives and iframe-only slots must be removed in Block",
  );
  assert.equal(
    await session.evaluate(
      "[normalPoster,protectedNav,keptGrid.querySelector('#kept-creative')].every(fixtureVisible)",
    ),
    true,
    "Internal posters, navigation and a kept creative inside an ad grid stay visible",
  );
  assert.equal(
    await session.evaluate("fixtureVisible(normalHero)"),
    false,
    "Block deliberately includes unknown externally linked image banners; Default/Keep are the recovery",
  );
  assert.equal(
    await session.evaluate(
      "[...keptGrid.querySelectorAll('a')].slice(1).every(el=>!fixtureVisible(el))",
    ),
    true,
    "Keeping one creative must not exempt its sibling ads",
  );
  assert.equal(
    await session.evaluate(
      "document.getElementById('adsfriendly-popup-container')===null",
    ),
    true,
    "Automatic ad removal must not restart noisy Hide/Keep popups",
  );
  await session.evaluate(
    "siteFooter.style.setProperty('display','block','important')",
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate("fixtureVisible(siteFooter)"),
    false,
    "Slot evidence survives hiding and site display rewrites",
  );
  const shown = await session.evaluate(
    `new Promise(resolve => messageListeners.forEach(fn=>fn({action:'set_banner_visibility',visibility:'show'},{},resolve)))`,
  );
  assert.equal(shown.dom.shownOnPage, true);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate(
      "[...siteGrid.querySelectorAll('a'),siteFooter,unknownFrame].every(fixtureVisible)",
    ),
    true,
    "Show from the Safari popup restores actual tracked areas without changing saved choices",
  );
  await session.evaluate(
    "AF_scanBanners();document.body.classList.add('unrelated-animation')",
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate("fixtureVisible(siteFooter)"),
    true,
    "Show lasts through subsequent scans on this page",
  );
  await session.evaluate(
    `new Promise(resolve => messageListeners.forEach(fn=>fn({action:'set_banner_visibility',visibility:'hide'},{},resolve)))`,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(await session.evaluate("fixtureVisible(siteFooter)"), false);
  assert.equal(
    await session.evaluate(
      "fixtureVisible(keptGrid.querySelector('#kept-creative'))",
    ),
    true,
  );

  // Individual corrections must not require showing every ad or weakening Block.
  const reviewStorageMock = `
    const originalReviewSend=chrome.runtime.sendMessage;
    chrome.runtime.sendMessage=function(m,cb){
      if(m.action!=='save_dom_decision'||testFailSave) return originalReviewSend(m,cb);
      testMessages.push(m);
      const custom={...testData.userCustomRules},exceptions={...testData.userElementExceptions};
      const matches=r=>r.selector===m.selector&&r.layout===m.layout;
      custom[m.hostname]=(custom[m.hostname]||[]).filter(r=>!matches(r));
      exceptions[m.hostname]=(exceptions[m.hostname]||[]).filter(r=>!matches(r));
      const exception=AFShared.createElementException({selector:m.selector,features:m.features},{layout:m.layout});
      if(m.decision==='show') exceptions[m.hostname].push(exception);
      else custom[m.hostname].push({selector:m.selector,layout:m.layout,fingerprint:exception.fingerprint});
      testChange('userCustomRules',custom);testChange('userElementExceptions',exceptions);cb({status:'saved'});
    };
    window.reviewCommand=(id,choice)=>new Promise(resolve=>messageListeners.forEach(fn=>fn({action:'review_dom_area',id,choice},{},resolve)));
  `;
  await session.evaluate(reviewStorageMock);
  const heroArea = await session.evaluate(
    "AF_DOM.state().areas.find(area=>area.label.includes('hero-banner'))",
  );
  assert.ok(
    heroArea,
    "A strictly blocked region must be discoverable in individual-area review",
  );
  const beforeOnce = await session.evaluate(
    "JSON.stringify([testData.userCustomRules,testData.userElementExceptions])",
  );
  assert.equal(
    (
      await session.evaluate(
        `reviewCommand(${JSON.stringify(heroArea.id)},'show_once')`,
      )
    ).ready,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate(
      "fixtureVisible(normalHero) && !fixtureVisible(siteFooter)",
    ),
    true,
    "Show once restores only the selected region while other ads stay blocked",
  );
  assert.equal(
    await session.evaluate(
      "JSON.stringify([testData.userCustomRules,testData.userElementExceptions])",
    ),
    beforeOnce,
  );
  let shownHero = await session.evaluate(
    "AF_DOM.state().areas.find(area=>area.label.includes('hero-banner'))",
  );
  await session.evaluate(
    `reviewCommand(${JSON.stringify(shownHero.id)},'hide')`,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(await session.evaluate("fixtureVisible(normalHero)"), false);
  let hiddenHero = await session.evaluate(
    "AF_DOM.state().areas.find(area=>area.label.includes('hero-banner'))",
  );
  await session.evaluate("testFailSave=true");
  assert.match(
    (
      await session.evaluate(
        `reviewCommand(${JSON.stringify(hiddenHero.id)},'keep')`,
      )
    ).error,
    /Storage full/,
  );
  assert.equal(
    await session.evaluate("fixtureVisible(normalHero)"),
    false,
    "A failed Keep must not claim success or silently unhide the target",
  );
  await session.evaluate("testFailSave=false");
  await session.evaluate(
    `reviewCommand(${JSON.stringify(hiddenHero.id)},'keep')`,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(await session.evaluate("fixtureVisible(normalHero)"), true);
  const keptData = await session.evaluate("testData");
  const restoredRules = await session.send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source:
        `Object.entries(${JSON.stringify(keptData)}).forEach(([k,v])=>testChange(k,v));` +
        reviewStorageMock,
    },
  );
  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/remembered-area",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await session.evaluate(`
    window.revisitedHero=document.createElement('div');revisitedHero.className='hero-banner';revisitedHero.style.cssText='width:350px;height:70px';
    revisitedHero.innerHTML='<a href="https://news.example/placement" style="display:block;width:350px;height:70px"><img style="width:350px;height:70px"></a>';
    revisitedHero.querySelector('img').src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="350" height="70"><rect width="350" height="70" fill="gold"/></svg>');
    document.body.appendChild(revisitedHero);AF_scanBanners();
  `);
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.notEqual(
    await session.evaluate("getComputedStyle(revisitedHero).display"),
    "none",
    "Keep survives a fresh document in Block",
  );
  assert.match(
    (
      await session.evaluate(
        `reviewCommand(${JSON.stringify(hiddenHero.id)},'show_once')`,
      )
    ).error,
    /changed/,
    "An old document token cannot affect a new page",
  );
  const keptHero = await session.evaluate(
    "AF_DOM.state().areas.find(area=>area.label.includes('hero-banner'))",
  );
  assert.equal(keptHero.state, "kept");
  await session.evaluate(
    `reviewCommand(${JSON.stringify(keptHero.id)},'hide')`,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate("getComputedStyle(revisitedHero).display"),
    "none",
    "Hide again reverses a remembered Keep",
  );
  await session.send("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: restoredRules.identifier,
  });

  // Full-page ad owners can be appended after thousands of normal nodes. Hiding
  // just their image must not leave a dimming/click-catching layer and close X.
  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/late-ad-overlay",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await session.evaluate(`
    testChange('blacklist',['||127.0.0.1^']);
    const filler=document.createDocumentFragment();for(let i=0;i<2600;i++) filler.appendChild(document.createElement('span'));document.body.appendChild(filler);
    window.lateOverlay=document.createElement('div');lateOverlay.id='_preload-ads-1';lateOverlay.style.cssText='display:flex;position:fixed;inset:0;width:100vw;height:100vh;z-index:99984;background:rgba(0,0,0,.5)';
    lateOverlay.innerHTML='<div style="margin:auto"><a class="ads-banner" id="url-_preload-ads-1" href="https://unknown-sponsor.test/campaign"><img width="300" height="80"></a><div class="popup-icon-close">X</div></div>';
    lateOverlay.querySelector('img').src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="gold"/></svg>');
    document.body.appendChild(lateOverlay);
    window.loginDialog=document.createElement('div');loginDialog.id='ad-login-shell';loginDialog.style.cssText='position:fixed;inset:0';loginDialog.innerHTML='<form><input type="password"><button>Sign in</button></form>';document.body.appendChild(loginDialog);
    AF_scanBanners();
  `);
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(
    await session.evaluate("getComputedStyle(lateOverlay).display"),
    "none",
    "The whole late ad overlay, not only its image/link, must be hidden beyond the old 1500-node limit",
  );
  assert.notEqual(
    await session.evaluate("getComputedStyle(loginDialog).display"),
    "none",
    "Ad-like naming cannot authorize hiding a real sign-in dialog",
  );
  await session.evaluate(
    "lateOverlay.style.setProperty('display','flex','important')",
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate("getComputedStyle(lateOverlay).display"),
    "none",
  );
  await session.evaluate(
    `new Promise(resolve => messageListeners.forEach(fn=>fn({action:'set_banner_visibility',visibility:'show'},{},resolve)))`,
  );
  assert.equal(
    await session.evaluate("getComputedStyle(lateOverlay).display"),
    "flex",
  );
  await session.evaluate(
    `new Promise(resolve => messageListeners.forEach(fn=>fn({action:'set_banner_visibility',visibility:'hide'},{},resolve)))`,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate("getComputedStyle(lateOverlay).display"),
    "none",
  );
  await session.evaluate(`
    window.replacedOverlay=lateOverlay.cloneNode(true);replacedOverlay.id='_preload-ads-2';replacedOverlay.style.display='flex';document.body.appendChild(replacedOverlay);
  `);
  await new Promise((resolve) => setTimeout(resolve, 450));
  for (
    let attempt = 0;
    attempt < 100 &&
    (await session.evaluate(
      "getComputedStyle(replacedOverlay).display !== 'none'",
    ));
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    await session.evaluate("getComputedStyle(replacedOverlay).display"),
    "none",
    "A late replacement overlay must be caught by the observer without a manual rescan",
  );
  await session.evaluate(`
    const ordinaryLinks=document.createDocumentFragment();for(let i=0;i<650;i++){const a=document.createElement('a');a.href='/internal/'+i;a.textContent='Internal link';ordinaryLinks.appendChild(a);}document.body.appendChild(ordinaryLinks);
    const svgContainer=document.createElement('div');svgContainer.className='banner';svgContainer.innerHTML='<svg width="100" height="70"><a href="/internal/svg"><rect width="100" height="70"/></a></svg>';document.body.appendChild(svgContainer);
    window.unknownLinkedBanner=document.createElement('a');unknownLinkedBanner.href='https://new-sponsor.test/placement';unknownLinkedBanner.style.cssText='display:block;width:300px;height:70px;background:gold';document.body.appendChild(unknownLinkedBanner);
    window.cssAd=document.createElement('div');cssAd.className='ad-slot';cssAd.style.cssText='width:300px;height:70px;background:gold';cssAd.textContent='Advertisement';document.body.appendChild(cssAd);
    window.invisibleTrap=document.createElement('div');invisibleTrap.id='neutral-click-layer';invisibleTrap.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;opacity:0;pointer-events:auto;z-index:99990';document.body.appendChild(invisibleTrap);
    window.passiveLayer=document.createElement('div');passiveLayer.style.cssText='position:fixed;inset:0;opacity:0;pointer-events:none';document.body.appendChild(passiveLayer);
    AF_scanBanners();
  `);
  for (
    let attempt = 0;
    attempt < 120 &&
    (await session.evaluate(
      "[unknownLinkedBanner,cssAd,invisibleTrap].some(el=>getComputedStyle(el).display !== 'none')",
    ));
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    await session.evaluate(
      "[unknownLinkedBanner,cssAd,invisibleTrap].every(el=>getComputedStyle(el).display==='none')",
    ),
    true,
    "Block must cover the DOM/link tail, CSS-only ad slots and invisible click-catching overlays without a domain-specific rule",
  );
  assert.notEqual(
    await session.evaluate("getComputedStyle(passiveLayer).display"),
    "none",
    "A passive transparent layer must not be mistaken for a click catcher",
  );
  await session.evaluate("testChange('blacklist',[])");
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(
    await session.evaluate(
      "[unknownLinkedBanner,cssAd,invisibleTrap].every(el=>getComputedStyle(el).display!=='none')",
    ),
    true,
    "Switching Block to Default restores strict-only decisions rather than leaving the site broken",
  );

  // Route the local fixture through the same verified publisher profile. This
  // also exercises Default, where Block-only heuristic removal is unavailable.
  await session.evaluate(`
    const publisherSelectors=AFShared.iosBuiltinDomSelectors('animevietsub.sale');
    AFShared.iosBuiltinDomSelectors=()=>publisherSelectors;
    testChange('blacklist',[]);
    window.keptOverlay=lateOverlay.cloneNode(true);keptOverlay.id='_preload-ads-kept';keptOverlay.style.display='flex';keptOverlay.querySelector('a').id='kept-overlay-link';document.body.appendChild(keptOverlay);
    testChange('userElementExceptions',{'127.0.0.1':[{selector:'#kept-overlay-link',layout:'compact',fingerprint:{tag:'a',id:'kept-overlay-link'}}]});
    AF_DOM.schedule(document);
  `);
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(
    await session.evaluate("getComputedStyle(lateOverlay).display"),
    "none",
    "Verified publisher ad owners are hidden in Default as well as Block",
  );
  assert.notEqual(
    await session.evaluate("getComputedStyle(keptOverlay).display"),
    "none",
    "A publisher owner rule must still respect a remembered Keep on its creative",
  );
  await session.evaluate("testChange('whitelist',['127.0.0.1'])");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate("getComputedStyle(lateOverlay).display"),
    "flex",
    "Allow must restore the complete overlay's original display, not leave a dead wrapper",
  );

  // A prior dismissal in Default must not become an invisible Keep on Block.
  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/default-to-block",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await session.evaluate(`(async () => {
    window.transitionAd=document.createElement('div');transitionAd.className='ad-banner';transitionAd.style.cssText='width:300px;height:70px';
    transitionAd.innerHTML='<a href="https://unknown-sponsor.test/placement"><img style="width:300px;height:70px"></a>';
    transitionAd.querySelector('img').src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="70"><rect width="300" height="70" fill="gold"/></svg>');
    document.body.appendChild(transitionAd);
    await transitionAd.querySelector('img').decode();AF_scanBanners();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(
    await session.evaluate("testShadows.at(-1).textContent"),
    /Marked area/,
  );
  await session.evaluate(
    "testShadows.at(-1).querySelector('.close').click();testChange('blacklist',['||127.0.0.1^']);AF_scanBanners()",
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate("getComputedStyle(transitionAd).display"),
    "none",
    "Dismissed reviews must still obey a later Block policy",
  );

  // Successful manual Hide has a compact immediate Show recovery.
  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/manual-hide-show",
  });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await session.evaluate(`
    window.manualArea=document.createElement('div');manualArea.id='ad-manual-area';manualArea.style.cssText='width:300px;height:70px';manualArea.textContent='Advertisement';document.body.appendChild(manualArea);AF_scanBanners();
    testShadows.at(-1).querySelector('button').click();
  `);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.match(
    await session.evaluate("testShadows.at(-1).textContent"),
    /Area hiddenShow/,
  );
  await session.evaluate("testShadows.at(-1).querySelector('button').click()");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await session.evaluate("testMessages.at(-1).decision"), "show");
  assert.notEqual(
    await session.evaluate("getComputedStyle(manualArea).display"),
    "none",
  );

  const toolbarSeed = await session.send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `
    window.toolbarState={policy:'block',appSettings:{enabled:true},content:{ready:true,enabled:true,host:'127.0.0.1',version:'1.2.1',dom:{hiddenCount:6,shownOnPage:false}}};
    chrome.tabs={query(q,cb){cb([{id:7,url:location.origin+'/article'}]);}};
    chrome.runtime.sendMessage=function(m,cb){testMessages.push(m);if(m.action==='set_banner_visibility') toolbarState.content.dom=m.visibility==='show'?{hiddenCount:0,shownOnPage:true}:{hiddenCount:6,shownOnPage:false};cb(m.action==='get_popup_state'?toolbarState:{ready:true});};
  `,
    },
  );
  await session.send("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/toolbar-popup",
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    await session.evaluate("document.getElementById('show-banners').disabled"),
    false,
  );
  await session.evaluate("document.getElementById('show-banners').click()");
  assert.equal(
    await session.evaluate(
      "document.getElementById('banner-state').textContent",
    ),
    "Banners shown on this page",
  );
  assert.equal(
    await session.evaluate("document.getElementById('hide-banners').disabled"),
    false,
  );
  await session.evaluate("document.getElementById('hide-banners').click()");
  assert.equal(
    await session.evaluate(
      "document.getElementById('banner-state').textContent",
    ),
    "6 banner areas hidden",
  );
  assert.equal(
    await session.evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
    "Toolbar controls fit the phone viewport",
  );
  await session.evaluate(`
    toolbarState.content.dom.areas=[{id:'fixture-area',label:'Overlay · <img src=x onerror=alert(1)>',state:'hidden'}];
    loadState();document.getElementById('area-review').open=true;
  `);
  assert.equal(
    await session.evaluate(
      "document.querySelectorAll('#area-list button').length",
    ),
    2,
  );
  assert.equal(
    await session.evaluate("document.querySelector('#area-list img')===null"),
    true,
    "Website-derived labels must render as text, not HTML",
  );
  await session.evaluate("document.querySelector('#area-list button').click()");
  assert.equal(
    await session.evaluate(
      "testMessages.find(m=>m.action==='review_dom_area').choice",
    ),
    "show_once",
  );
  assert.equal(
    await session.evaluate(
      "testMessages.find(m=>m.action==='review_dom_area').id",
    ),
    "fixture-area",
  );
  for (const width of [320, 390, 768]) {
    await session.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    assert.equal(
      await session.evaluate(
        "document.documentElement.scrollWidth<=innerWidth",
      ),
      true,
      "Individual area controls must fit a phone",
    );
  }
  await session.send("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: toolbarSeed.identifier,
  });

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
