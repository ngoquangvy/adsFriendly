import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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
const server = createServer((request, response) => {
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
    Element.prototype.attachShadow = function(options) { const root = originalShadow.call(this, options); testShadows.push(root); return root; };
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
    /Banner ad\?HideKeep/,
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
    document.body.appendChild(testSlot); AF_scanBanners();
  `);
  assert.match(
    await session.evaluate("testShadows.at(-1).textContent"),
    /Banner ad\?HideKeep/,
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
  console.log(
    "iOS browser checks passed: rules, toast stability, save retry, 320–980px single-row/touch layout, mutation/resize/replaced-slot dedupe, timeout, banner budget and Hide/Keep.",
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
