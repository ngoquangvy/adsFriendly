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
  const disguisedGoogleAdUrl =
    "https://www.google.com/search?q=777hoky256jp.live+-%E2%9A%BD%EF%B8%8F&hl=id&gl=ID";
  const reverseGoogleAdUrl =
    "https://www.google.com/search?q=reverse-ad.example+-%E2%9A%A0%EF%B8%8F&hl=en";

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
    <button id="reverse-pop" type="button">Test reverse pop-under</button>
  </main>
  <script>
    document.getElementById("reverse-pop").onclick = () => {
      window.open(location.origin + location.pathname + "?kept=1", "_blank");
      setTimeout(() => location.href = ${JSON.stringify(reverseGoogleAdUrl)}, 350);
    };
  </script>
</body>
</html>`);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const testUrl = `http://127.0.0.1:${server.address().port}/`;
  const manualTabUrl = `http://localhost:${server.address().port}/manual-tab`;
  const reverseSourceUrl = `http://localhost:${server.address().port}/reverse`;

  const chrome = spawn(
    CHROME,
    [
      `--user-data-dir=${profileDir}`,
      `--load-extension=${EXTENSION_PATH}`,
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
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
    await page.send("Runtime.evaluate", {
      expression: `window.open(${JSON.stringify(disguisedGoogleAdUrl)}, "_blank")`,
    });
    await delay(1800);
    const navigationStorage = await evaluateJson(
      worker,
      `new Promise(resolve => chrome.storage.local.get(["blockedLogs"], resolve))`,
    );
    const googleAdBlocked = (navigationStorage.blockedLogs || []).some(
      (entry) => entry.url === disguisedGoogleAdUrl,
    );
    const googleAdTabClosed = !(await listTargets()).some((target) =>
      decodeURIComponent(target.url).includes("777hoky256jp.live"),
    );
    const blockedToast = await evaluateJson(
      page,
      `(() => {
        const toast = document.getElementById("adsfriendly-nav-toast");
        return {
          visible: Boolean(toast && !toast.classList.contains("adsfriendly-toast-hidden")),
          message: toast?.querySelector(".adsfriendly-toast-message")?.textContent || "",
          action: toast?.querySelector(".adsfriendly-toast-primary")?.textContent || "",
          secondary: toast?.querySelector(".adsfriendly-toast-block")?.textContent || ""
        };
      })()`,
    );
    await page.send("Runtime.evaluate", {
      expression: `window.open(${JSON.stringify(disguisedGoogleAdUrl)}, "_blank")`,
    });
    await delay(1200);
    const aggregatedBlockedToast = await evaluateJson(
      page,
      `(() => {
        const toast = document.getElementById("adsfriendly-nav-toast");
        return {
          visible: Boolean(toast && !toast.classList.contains("adsfriendly-toast-hidden")),
          message: toast?.querySelector(".adsfriendly-toast-message")?.textContent || "",
          action: toast?.querySelector(".adsfriendly-toast-primary")?.textContent || "",
          secondary: toast?.querySelector(".adsfriendly-toast-block")?.textContent || ""
        };
      })()`,
    );
    const allowSourceClicked = await evaluateJson(
      page,
      `(() => {
        const button = document.querySelector("#adsfriendly-nav-toast .adsfriendly-toast-block");
        if (!button) return false;
        button.click();
        return true;
      })()`,
    );
    await delay(1800);
    const userReopenedGoogleAd = (await listTargets()).some((target) =>
      decodeURIComponent(target.url).includes("777hoky256jp.live"),
    );
    const trustKey = `p:${new URL(testUrl).hostname}>google.com`;
    const trustedSearchPath = await evaluateJson(
      worker,
      `new Promise(resolve => chrome.storage.local.get(${JSON.stringify(trustKey)}, resolve))`,
    );
    const allowedTarget = (await listTargets()).find((target) =>
      decodeURIComponent(target.url).includes("777hoky256jp.live"),
    );
    const allowedChromeTab = await evaluateJson(
      worker,
      `new Promise(resolve => chrome.tabs.query({}, tabs => resolve(tabs.find(tab => decodeURIComponent(tab.url || "").includes("777hoky256jp.live")) || null)))`,
    );
    let allowedSearchToast = null;
    if (allowedTarget) {
      const allowedPage = new CdpSession(allowedTarget.webSocketDebuggerUrl);
      await allowedPage.send("Runtime.enable");
      await delay(1200);
      allowedSearchToast = await evaluateJson(
        allowedPage,
        `(() => {
          const toast = document.getElementById("adsfriendly-nav-toast");
          return {
            visible: Boolean(toast && !toast.classList.contains("adsfriendly-toast-hidden")),
            message: toast?.querySelector(".adsfriendly-toast-message")?.textContent || "",
            action: toast?.querySelector(".adsfriendly-toast-block")?.textContent || ""
          };
        })()`,
      );
      allowedPage.close();
    }
    const reverseSourceTarget = await newPage(reverseSourceUrl);
    const reversePage = new CdpSession(
      reverseSourceTarget.webSocketDebuggerUrl,
    );
    await reversePage.send("Runtime.enable");
    await delay(1800);
    const reverseSourceTab = await evaluateJson(
      worker,
      `new Promise(resolve => chrome.tabs.query({}, tabs => resolve(tabs.find(tab => tab.url === ${JSON.stringify(reverseSourceUrl)}) || null)))`,
    );
    await reversePage.send("Runtime.evaluate", {
      expression: `document.getElementById("reverse-pop").click()`,
    });
    await delay(2600);
    const tabsAfterReverse = await evaluateJson(
      worker,
      `new Promise(resolve => chrome.tabs.query({}, resolve))`,
    );
    const reverseSourceClosed = !tabsAfterReverse.some(
      (tab) => tab.id === reverseSourceTab?.id,
    );
    const reverseAdTabClosed = !tabsAfterReverse.some(
      (tab) => tab.url === reverseGoogleAdUrl,
    );
    const survivingCloneTab = tabsAfterReverse.find(
      (tab) => tab.url?.startsWith(`${reverseSourceUrl}?kept=1`),
    );
    let reverseToast = null;
    const survivingCloneTarget = (await listTargets()).find((target) =>
      target.url.startsWith(`${reverseSourceUrl}?kept=1`),
    );
    if (survivingCloneTarget) {
      const clonePage = new CdpSession(
        survivingCloneTarget.webSocketDebuggerUrl,
      );
      await clonePage.send("Runtime.enable");
      reverseToast = await evaluateJson(
        clonePage,
        `(() => {
          const toast = document.getElementById("adsfriendly-nav-toast");
          return {
            visible: Boolean(toast && !toast.classList.contains("adsfriendly-toast-hidden")),
            message: toast?.querySelector(".adsfriendly-toast-message")?.textContent || "",
            action: toast?.querySelector(".adsfriendly-toast-primary")?.textContent || ""
          };
        })()`,
      );
      clonePage.close();
    }

    const passed =
      pageResult.navVisible &&
      pageResult.headerVisible &&
      pageResult.visibleLinks === 7 &&
      pageResult.toastCount === 0 &&
      manualTabPreserved &&
      googleAdBlocked &&
      googleAdTabClosed &&
      blockedToast.visible &&
      blockedToast.message === "Blocked 1 ad tab" &&
      blockedToast.action === "Open" &&
      blockedToast.secondary === "Always allow site" &&
      aggregatedBlockedToast.visible &&
      aggregatedBlockedToast.message === "Blocked 2 ad tabs" &&
      aggregatedBlockedToast.action === "Open latest" &&
      aggregatedBlockedToast.secondary === "Always allow site" &&
      userReopenedGoogleAd &&
      allowSourceClicked &&
      trustedSearchPath[trustKey]?.isManual === true &&
      allowedSearchToast?.visible === true &&
      allowedSearchToast.action === "Block again" &&
      reverseSourceClosed &&
      reverseAdTabClosed &&
      Boolean(survivingCloneTab) &&
      reverseToast?.visible === true &&
      reverseToast.message === "Blocked 1 ad tab" &&
      reverseToast.action === "Open" &&
      (storageResult.domTrainingSamples || []).length === 0 &&
      (storageResult.blockedLogs || []).length === 0;

    console.log(
      JSON.stringify(
        {
          passed,
          testUrl,
          manualTabUrl,
          manualTabPreserved,
          disguisedGoogleAdUrl,
          googleAdBlocked,
          googleAdTabClosed,
          blockedToast,
          aggregatedBlockedToast,
          userReopenedGoogleAd,
          allowSourceClicked,
          trustedSearchPath: trustedSearchPath[trustKey] || null,
          allowedChromeTab,
          allowedSearchToast,
          reverseSourceUrl,
          reverseSourceClosed,
          reverseAdTabClosed,
          survivingCloneTab,
          reverseToast,
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
