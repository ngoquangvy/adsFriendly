import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXTENSION_PATH = ROOT.replace(/\\/g, "/");
const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(
  process.env.DEBUG_PORT || 9400 + Math.floor(Math.random() * 500),
);
const DEFAULT_URLS = [
  "https://animevietsub.wiki/",
  "https://phimmoir.cx/",
  "https://www.24h.com.vn/",
  "https://kenh14.vn/",
  "https://gamek.vn/",
];

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
  const argumentsList = process.argv.slice(2);
  const expectResolvedHls = argumentsList.includes("--expect-resolved-hls");
  const requestedUrls = argumentsList.filter(
    (value) => value !== "--" && value !== "--expect-resolved-hls",
  );
  const urls = requestedUrls.length ? requestedUrls : DEFAULT_URLS;
  const protectionMode = process.env.PROTECTION_MODE || "auto";
  const profileDir = path.join(tmpdir(), `adsfriendly-live-e2e-${Date.now()}`);
  const chrome = spawn(
    CHROME,
    [
      `--user-data-dir=${profileDir}`,
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-popup-blocking",
      "--enable-unsafe-extension-debugging",
      "--ignore-certificate-errors",
      "--disable-features=Translate,ChromeWhatsNewUI",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const sessions = [];
  try {
    await waitForChrome();
    const bootstrapTarget = await newPage(urls[0]);
    const workerTarget = await findTarget((target) => {
      return (
        target.url.startsWith("chrome-extension://") &&
        target.url.includes("background.js")
      );
    });
    await closeTarget(bootstrapTarget.id);
    const contentSource = workerTarget
      ? null
      : await readFile(path.join(ROOT, "content.js"), "utf8");
    const extensionId = workerTarget
      ? new URL(workerTarget.url).hostname
      : null;
    const mode = workerTarget ? "extension" : "injected-dom";
    const worker = workerTarget
      ? new CdpSession(workerTarget.webSocketDebuggerUrl)
      : null;
    if (worker) {
      sessions.push(worker);
      await worker.send("Runtime.enable");
      await setExtensionState(worker, {
        appSettings: {
          enabled: true,
          protectionMode,
          featureOverrides: {},
        },
        isEnabled: true,
        friendlyMode: false,
        domTrainingSamples: [],
        blockedLogs: [],
        userCustomRules: {},
        blacklist: [],
        whitelist: [],
      });
    }

    const results = [];
    for (const url of urls) {
      results.push(await testSite({ worker, contentSource, mode }, url));
    }

    console.log(JSON.stringify({ mode, extensionId, results }, null, 2));
    if (
      results.some((result) => result.error) ||
      (expectResolvedHls &&
        results.some((result) => !hasResolvedHls(result.mediaCatalogs)))
    )
      process.exitCode = 1;
  } finally {
    sessions.forEach((session) => session.close());
    chrome.kill();
    await waitForExit(chrome);
    await rmWithRetry(profileDir);
  }
}

function hasResolvedHls(catalogs = {}) {
  return Object.values(catalogs)
    .flat()
    .some(
      (item) =>
        item.kind === "hls" &&
        ["ready", "resolved"].includes(item.resolutionStatus) &&
        item.resolvedStream?.streamType === "vod" &&
        item.resolvedStream.segmentCount > 0,
    );
}

async function testSite(harness, url) {
  const beforeTargets = await listTargets();
  const beforePageIds = new Set(
    beforeTargets.filter(isPage).map((target) => target.id),
  );

  if (harness.worker) {
    await setExtensionState(harness.worker, {
      domTrainingSamples: [],
      blockedLogs: [],
      userCustomRules: {},
    });
  }

  let pageTarget;
  let page;
  let survivingPage;
  try {
    pageTarget = await newPage(url);
    page = new CdpSession(pageTarget.webSocketDebuggerUrl);
    await page.send("Runtime.enable");
    await page.send("Page.enable");

    await delay(Number(process.env.LOAD_WAIT_MS || 9000));
    if (harness.contentSource) {
      await injectDomHarness(page, harness.contentSource);
      await delay(Number(process.env.INJECT_WAIT_MS || 5200));
    }
    const beforeClick = await inspectPage(page);
    const clickPoint = await evaluateJson(
      page,
      `(() => ({ x: Math.round(window.innerWidth / 2), y: Math.min(420, Math.round(window.innerHeight / 2)) }))()`,
    );

    if (process.env.SKIP_CLICK !== "1") {
      await dispatchClick(page, clickPoint.x, clickPoint.y);
      await delay(Number(process.env.CLICK_WAIT_MS || 4500));
    }

    const afterTargets = await listTargets();
    const originalStillOpen = afterTargets.some(
      (target) => target.id === pageTarget.id,
    );
    let afterClick;
    if (originalStillOpen) {
      afterClick = await inspectPage(page);
    } else {
      const sourceHost = new URL(url).hostname;
      const survivingTarget = afterTargets
        .filter(isPage)
        .find((target) => {
          try {
            return new URL(target.url).hostname === sourceHost;
          } catch {
            return false;
          }
        });
      if (!survivingTarget) throw new Error("No surviving source tab found.");
      survivingPage = new CdpSession(survivingTarget.webSocketDebuggerUrl);
      await survivingPage.send("Runtime.enable");
      afterClick = await inspectPage(survivingPage);
    }
    const newPages = afterTargets
      .filter(isPage)
      .filter((target) => !beforePageIds.has(target.id))
      .map((target) => ({
        id: target.id,
        url: target.url,
        title: target.title,
      }));
    const storage = harness.worker
      ? await getExtensionStorage(harness.worker)
      : await getInjectedStorage(page);

    await closeExtraPages(afterTargets, beforePageIds, pageTarget.id);

    return {
      url,
      mode: harness.mode,
      loadedUrl: afterClick.url,
      title: afterClick.title,
      beforeClick,
      afterClick,
      originalTabClosed: !originalStillOpen,
      newPages,
      domSampleCount: storage.domTrainingSamples?.length || 0,
      domSamples: summarizeSamples(storage.domTrainingSamples || []),
      blockedLogCount: storage.blockedLogs?.length || 0,
      blockedLogs: (storage.blockedLogs || []).slice(-5),
      settings: storage.appSettings || null,
      mediaCatalogs: summarizeMediaCatalogs(storage.mediaCatalogs || {}),
    };
  } catch (error) {
    return { url, error: error.message };
  } finally {
    if (page) page.close();
    if (survivingPage) survivingPage.close();
  }
}

async function injectDomHarness(page, contentSource) {
  await page.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `(() => {
      const storage = {
        appSettings: {
          enabled: true,
          protectionMode: "auto",
          featureOverrides: {}
        },
        isEnabled: true,
        friendlyMode: false,
        domTrainingSamples: [],
        blockedLogs: [],
        userCustomRules: {},
        globalAdPatterns: []
      };
      const messages = [];
      const local = {
        get(keys, callback) {
          let result = {};
          if (keys == null) result = { ...storage };
          else if (Array.isArray(keys)) {
            for (const key of keys) result[key] = storage[key];
          } else if (typeof keys === "string") {
            result[keys] = storage[keys];
          } else {
            result = { ...keys };
            for (const key of Object.keys(keys)) {
              if (Object.prototype.hasOwnProperty.call(storage, key)) result[key] = storage[key];
            }
          }
          if (callback) setTimeout(() => callback(result), 0);
          return Promise.resolve(result);
        },
        set(items, callback) {
          Object.assign(storage, items || {});
          if (callback) setTimeout(callback, 0);
          return Promise.resolve();
        }
      };
      const chromeObj = window.chrome || {};
      chromeObj.storage = {
        local,
        onChanged: { addListener() {}, removeListener() {} }
      };
      chromeObj.runtime = {
        ...(chromeObj.runtime || {}),
        getURL() { return "data:text/javascript,"; },
        sendMessage(message, callback) {
          messages.push(message);
          if (callback) setTimeout(() => callback({ ok: true }), 0);
          return Promise.resolve({ ok: true });
        },
        onMessage: { addListener() {} }
      };
      Object.defineProperty(window, "chrome", { value: chromeObj, configurable: true });
      Object.defineProperty(window, "__adsFriendlyHarness", {
        value: { storage, messages },
        configurable: true
      });
    })()`,
  });
  await page.send("Runtime.evaluate", {
    expression: `(0, eval)(${JSON.stringify(contentSource)})`,
    awaitPromise: false,
  });
}

async function inspectPage(page) {
  return evaluateJson(
    page,
    `(() => {
      const adSelector = 'img, iframe, a[href], div[class*="ad" i], div[id*="ad" i], [class*="banner" i], [id*="banner" i], [class*="promo" i], [id*="promo" i]';
      const nodes = Array.from(document.querySelectorAll(adSelector)).slice(0, 1200);
      const rows = nodes.map((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const id = node.id || "";
        const className = typeof node.className === "string" ? node.className : "";
        const src = node.currentSrc || node.src || "";
        const href = node.href || node.closest("a[href]")?.href || "";
        const hidden = style.visibility === "hidden" || Number.parseFloat(style.opacity || "1") <= 0.05 || style.display === "none";
        const adLike = /(^|[-_\\s])(ad|ads|adv|advert|banner|promo|sponsor|popup|preload)([-_\\s]|$)/i.test(id + " " + className + " " + src + " " + href);
        return {
          tag: node.tagName.toLowerCase(),
          id,
          className,
          srcHost: safeHost(src),
          hrefHost: safeHost(href),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          hidden,
          adLike,
        };
      });
      const adLikeRows = rows.filter((row) => row.adLike);
      const navigationToast = document.getElementById('adsfriendly-nav-toast');
      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        candidateCount: rows.length,
        adLikeCount: adLikeRows.length,
        hiddenAdLikeCount: adLikeRows.filter((row) => row.hidden).length,
        visibleAdLikeCount: adLikeRows.filter((row) => !row.hidden).length,
        toastCount: document.querySelectorAll('[id^="adsfriendly-dom-toast"]').length,
        navigationToast: navigationToast
          ? {
              hidden: navigationToast.classList.contains('adsfriendly-toast-hidden'),
              text: navigationToast.textContent.replace(/\s+/g, ' ').trim()
            }
          : null,
        topHiddenAdLike: adLikeRows.filter((row) => row.hidden).slice(0, 8),
        topVisibleAdLike: adLikeRows.filter((row) => !row.hidden).slice(0, 8),
      };

      function safeHost(value) {
        try { return value ? new URL(value, location.href).hostname : ""; }
        catch { return ""; }
      }
    })()`,
  );
}

async function dispatchClick(page, x, y) {
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

async function setExtensionState(worker, patch) {
  const expression = `new Promise(resolve => chrome.storage.local.set(${JSON.stringify(
    patch,
  )}, resolve))`;
  await worker.send("Runtime.evaluate", { expression, awaitPromise: true });
}

async function getExtensionStorage(worker) {
  return evaluateJson(
    worker,
    `Promise.all([
      chrome.storage.local.get([
        "appSettings",
        "isEnabled",
        "friendlyMode",
        "domTrainingSamples",
        "blockedLogs"
      ]),
      chrome.storage.session.get(null)
    ]).then(([local, session]) => ({
      ...local,
      mediaCatalogs: Object.fromEntries(
        Object.entries(session).filter(([key, value]) =>
          key.startsWith("adsfriendly.mediaCatalog.") && Array.isArray(value)
        )
      )
    }))`,
  );
}

async function getInjectedStorage(page) {
  return evaluateJson(
    page,
    `(() => window.__adsFriendlyHarness?.storage || { domTrainingSamples: [], blockedLogs: [] })()`,
  );
}

function summarizeSamples(samples) {
  return samples.slice(0, 12).map((sample) => ({
    label: sample.label,
    outcome: sample.outcome,
    action: sample.action,
    confidence: sample.context?.confidence,
    selector: sample.context?.selector,
    site: sample.site?.hostname,
    reasons: sample.evidence?.reasons,
    tag: sample.evidence?.features?.tag,
    id: sample.evidence?.features?.id,
    className: sample.evidence?.features?.className,
    srcHost: sample.evidence?.features?.srcHost,
    hrefHost: sample.evidence?.features?.hrefHost,
  }));
}

function summarizeMediaCatalogs(catalogs) {
  return Object.fromEntries(
    Object.entries(catalogs).map(([key, items]) => [
      key,
      items.map((item) => ({
        id: item.id,
        kind: item.kind,
        manifestUrl: item.manifestUrl,
        probeStatus: item.probeStatus,
        probeError: item.probeError,
        playlistType: item.playlistType,
        streamType: item.streamType,
        duration: item.duration,
        segmentCount: item.segmentCount,
        probeCount: item.probeCount,
        resolutionStatus: item.resolutionStatus,
        selectedMediaId: item.selectedMediaId,
        resolvedStream: item.resolvedStream
          ? {
              streamType: item.resolvedStream.streamType,
              duration: item.resolvedStream.duration,
              segmentCount: item.resolvedStream.segmentCount,
            }
          : null,
      })),
    ]),
  );
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

async function waitForChrome() {
  for (let attempt = 0; attempt < 100; attempt++) {
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
  for (let attempt = 0; attempt < 100; attempt++) {
    const targets = await listTargets();
    const match = targets.find(predicate);
    if (match) return match;
    await delay(125);
  }
  const targets = await listTargets().catch(() => []);
  throw new Error(
    `Timed out waiting for expected Chrome target. Targets: ${JSON.stringify(
      targets.map((target) => ({ type: target.type, url: target.url })),
    )}`,
  );
}

async function findTarget(predicate) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const targets = await listTargets();
    const match = targets.find(predicate);
    if (match) return match;
    await delay(125);
  }
  return null;
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
  if (!response.ok) throw new Error(`Cannot open page: ${response.status}`);
  return response.json();
}

async function closeExtraPages(targets, keepIds, currentId) {
  await Promise.all(
    targets
      .filter(isPage)
      .filter((target) => !keepIds.has(target.id) || target.id === currentId)
      .map((target) =>
        fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${target.id}`).catch(
          () => {},
        ),
      ),
  );
}

async function closeTarget(targetId) {
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${targetId}`).catch(
    () => {},
  );
}

function isPage(target) {
  return target.type === "page";
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
