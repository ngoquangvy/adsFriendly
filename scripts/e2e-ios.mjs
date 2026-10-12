import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, realpath } from "node:fs/promises";
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
          if (testFailSave && ["allow_popups", "block_popups"].includes(message.action)) callback?.({error:"Storage full"});
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
    "notifyBlocked('https://one.example/path', false); notifyBlocked('https://two.example/path', false); testFailSave=true; testShadows.at(-1).querySelector('button').click()",
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
    /Keep \/ Show/,
  );
  await session.evaluate("testShadows.at(-1).querySelector('button').click()");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await session.evaluate("window.testBannerHidden"), true);
  console.log(
    "iOS browser smoke checks passed: compact/wide, Keep identity, restore, toast, queue, save failure and banner actions.",
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
