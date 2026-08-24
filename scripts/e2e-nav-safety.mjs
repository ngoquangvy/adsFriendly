import { createServer } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXTENSION_PATH = ROOT.replace(/\\/g, "/");
const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(
  process.env.DEBUG_PORT || 9500 + Math.floor(Math.random() * 500),
);

class CdpSession {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id) return;
      const pending = this.pending.get(payload.id);
      if (!pending) return;
      this.pending.delete(payload.id);
      if (payload.error)
        pending.reject(new Error(JSON.stringify(payload.error)));
      else pending.resolve(payload.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  close() {
    this.socket.close();
  }
}

async function main() {
  const profileDir = path.join(tmpdir(), `adsfriendly-nav-e2e-${Date.now()}`);
  await mkdir(profileDir, { recursive: true });

  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>AdsFriendly Nav Safety</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; }
    header { border-bottom: 1px solid #ddd; }
    nav { display: flex; gap: 18px; padding: 18px 24px; align-items: center; }
    nav a { color: #111; text-decoration: none; font-weight: 600; }
    main { padding: 32px 24px; max-width: 820px; }
    .product-card { border: 1px solid #ddd; padding: 18px; margin-top: 20px; }
  </style>
</head>
<body>
  <header id="site-header">
    <nav id="cloudflare-nav" aria-label="Primary navigation">
      <a href="/products/zero-trust/">Zero Trust</a>
      <a href="/products/application-services/">Application Services</a>
      <a href="/products/ddos-protection/">DDoS Protection</a>
      <a href="/products/bot-management/">Bot Management</a>
      <a href="/learning/privacy/what-is-ad-tracking/">Ad tracking guide</a>
      <a href="/plans/?utm_source=site-nav">Plans</a>
      <a href="/login/">Log in</a>
    </nav>
  </header>
  <main>
    <h1>Cloud service dashboard style page</h1>
    <p>This page intentionally contains product and learning links that mention ads, tracking, security, and login. The navigation must remain visible.</p>
    <section class="product-card" id="application-services">
      <h2>Application services</h2>
      <p>Normal content should remain visible too.</p>
    </section>
  </main>
</body>
</html>`);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const testUrl = `http://127.0.0.1:${server.address().port}/`;
  const manualTabUrl = `http://localhost:${server.address().port}/manual-tab`;

  const chrome = spawn(
    CHROME,
    [
      `--user-data-dir=${profileDir}`,
      `--load-extension=${EXTENSION_PATH}`,
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
      "--enable-unsafe-extension-debugging",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    await waitForChrome();
    const serviceWorker = await waitForTarget((target) => {
      return (
        target.url.startsWith("chrome-extension://") &&
        target.url.includes("background.js")
      );
    });
    const worker = new CdpSession(serviceWorker.webSocketDebuggerUrl);
    await worker.send("Runtime.enable");
    await worker.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `new Promise(resolve => chrome.storage.local.set({ appSettings: { enabled: true, protectionMode: "auto", featureOverrides: {} }, isEnabled: true, friendlyMode: false, domTrainingSamples: [], userCustomRules: {}, blockedLogs: [] }, resolve))`,
    });

    const pageTarget = await newPage(testUrl);
    const page = new CdpSession(pageTarget.webSocketDebuggerUrl);
    await page.send("Runtime.enable");
    await delay(4200);

    const pageResult = await evaluateJson(
      page,
      `(() => {
        const nav = document.getElementById("cloudflare-nav");
        const header = document.getElementById("site-header");
        const links = Array.from(nav.querySelectorAll("a"));
        const navStyle = getComputedStyle(nav);
        const headerStyle = getComputedStyle(header);
        return {
          navVisible: navStyle.visibility !== "hidden" && navStyle.opacity !== "0" && navStyle.display !== "none",
          headerVisible: headerStyle.visibility !== "hidden" && headerStyle.opacity !== "0" && headerStyle.display !== "none",
          visibleLinks: links.filter((link) => {
            const style = getComputedStyle(link);
            return style.visibility !== "hidden" && style.opacity !== "0" && style.display !== "none";
          }).length,
          toastCount: document.querySelectorAll('[id^="adsfriendly-dom-toast"]').length
        };
      })()`,
    );
    const storageResult = await evaluateJson(
      worker,
      `new Promise(resolve => chrome.storage.local.get(["domTrainingSamples", "blockedLogs"], resolve))`,
    );
    await page.send("Runtime.evaluate", {
      expression: `window.open(${JSON.stringify(manualTabUrl)}, "_blank")`,
    });
    await delay(1200);
    const manualTabPreserved = (await listTargets()).some((target) =>
      target.url.startsWith(manualTabUrl),
    );

    const passed =
      pageResult.navVisible &&
      pageResult.headerVisible &&
      pageResult.visibleLinks === 7 &&
      pageResult.toastCount === 0 &&
      manualTabPreserved &&
      (storageResult.domTrainingSamples || []).length === 0 &&
      (storageResult.blockedLogs || []).length === 0;

    console.log(
      JSON.stringify(
        {
          passed,
          testUrl,
          manualTabUrl,
          manualTabPreserved,
          pageResult,
          sampleCount: (storageResult.domTrainingSamples || []).length,
          blockedLogCount: (storageResult.blockedLogs || []).length,
        },
        null,
        2,
      ),
    );

    if (!passed) process.exitCode = 1;
    page.close();
    worker.close();
  } finally {
    chrome.kill();
    server.close();
    await waitForExit(chrome);
    await rmWithRetry(profileDir);
  }
}

async function waitForChrome() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${DEBUG_PORT}/json/version`,
      );
      if (response.ok) return;
    } catch {}
    await delay(125);
  }
  throw new Error("Chrome remote debugging endpoint did not start.");
}

async function waitForTarget(predicate) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const targets = await listTargets();
    const match = targets.find(predicate);
    if (match) return match;
    await delay(125);
  }
  throw new Error("Timed out waiting for expected Chrome target.");
}

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  if (!response.ok)
    throw new Error(`Cannot list Chrome targets: ${response.status}`);
  return response.json();
}

async function newPage(url) {
  const response = await fetch(
    `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  if (!response.ok)
    throw new Error(`Cannot open test page: ${response.status}`);
  return response.json();
}

async function evaluateJson(session, expression) {
  const result = await session.send("Runtime.evaluate", {
    expression: `(async () => JSON.stringify(await (${expression})))()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return JSON.parse(result.result.value);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child) {
  if (child.exitCode !== null || child.killed) return delay(800);
  return new Promise((resolve) => {
    child.once("exit", () => setTimeout(resolve, 800));
    setTimeout(resolve, 2500);
  });
}

async function rmWithRetry(target) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== "EBUSY" && error.code !== "EPERM") throw error;
      await delay(250 + attempt * 250);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
