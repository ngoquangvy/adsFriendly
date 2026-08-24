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
  process.env.DEBUG_PORT || 9300 + Math.floor(Math.random() * 500),
);
const TEST_ID = "img-_preload-ads-2";

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
  const profileDir = path.join(tmpdir(), `adsfriendly-e2e-${Date.now()}`);
  await mkdir(profileDir, { recursive: true });

  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>AdsFriendly DOM E2E</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; }
    main { padding: 24px; }
    .content-card { max-width: 680px; line-height: 1.5; }
    .ads-banner { display: block; width: 500px; height: 220px; background: #ef4444; object-fit: cover; }
  </style>
</head>
<body>
  <main>
    <article class="content-card">
      <h1>Normal article content</h1>
      <p>This block should remain visible and should not be treated as an ad.</p>
    </article>
  </main>
  <img class="ads-banner" id="${TEST_ID}" style="max-width:500px" alt="sponsored banner"
       src="https://lh3.googleusercontent.com/RhMpTLYS06F4EXgoXgi2GO_DDh_5NKGdbGPTzsWZV7KKwPWEXQZYQHlrFpxvNUo8i6sOKlW_D7nXPTDsIgIrJDi3QtkWw6sD9xciXDDsCOknrteV6driisxhXH8=s0">
</body>
</html>`);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const testUrl = `http://127.0.0.1:${server.address().port}/`;

  const chrome = spawn(
    CHROME,
    [
      `--user-data-dir=${profileDir}`,
      `--load-extension=${EXTENSION_PATH}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
      "--enable-unsafe-extension-debugging",
      "--enable-logging=stderr",
      "--v=1",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const chromeLogs = collectProcessLogs(chrome);

  try {
    await waitForChrome();
    const serviceWorker = await waitForTarget((target) => {
      return (
        target.url.startsWith("chrome-extension://") &&
        target.url.includes("background.js")
      );
    });
    const extensionId = new URL(serviceWorker.url).hostname;
    const worker = new CdpSession(serviceWorker.webSocketDebuggerUrl);
    await worker.send("Runtime.enable");
    await worker.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `new Promise(resolve => chrome.storage.local.set({ appSettings: { enabled: true, protectionMode: "auto", featureOverrides: {} }, isEnabled: true, friendlyMode: false, domTrainingSamples: [], afsTelemetryQueue: [], userCustomRules: {} }, resolve))`,
    });

    const pageTarget = await newPage(testUrl);
    const page = new CdpSession(pageTarget.webSocketDebuggerUrl);
    await page.send("Runtime.enable");
    await delay(4200);

    const pageResult = await evaluateJson(
      page,
      `(() => {
        const img = document.getElementById(${JSON.stringify(TEST_ID)});
        const style = img ? getComputedStyle(img) : null;
        const article = document.querySelector(".content-card");
        const articleStyle = article ? getComputedStyle(article) : null;
        return {
          imageExists: !!img,
          imageInlineOpacity: img?.style.opacity || "",
          imageComputedOpacity: style?.opacity || "",
          imageVisibility: style?.visibility || "",
          imagePointerEvents: style?.pointerEvents || "",
          articleVisibility: articleStyle?.visibility || "",
          articleOpacity: articleStyle?.opacity || ""
        };
      })()`,
    );

    const storageResult = await evaluateJson(
      worker,
      `new Promise(resolve => chrome.storage.local.get(["domTrainingSamples", "afsTelemetryQueue", "friendlyMode", "isEnabled"], resolve))`,
    );

    const samples = storageResult.domTrainingSamples || [];
    const telemetryQueue = storageResult.afsTelemetryQueue || [];
    const passed =
      pageResult.imageExists &&
      pageResult.imageComputedOpacity === "0" &&
      pageResult.imageVisibility === "hidden" &&
      pageResult.articleVisibility !== "hidden" &&
      samples.some(
        (sample) => sample.unit === "dom_element" && sample.label === "ad",
      ) &&
      telemetryQueue.some(
        (sample) =>
          sample.unit === "dom_element" &&
          sample.label === "ad" &&
          sample.identity?.client_id,
      );

    console.log(
      JSON.stringify(
        {
          passed,
          testUrl,
          extensionId,
          pageResult,
          sampleCount: samples.length,
          telemetryQueueCount: telemetryQueue.length,
          firstSample: samples[0] || null,
          firstTelemetryEvent: telemetryQueue[0] || null,
        },
        null,
        2,
      ),
    );

    if (!passed) process.exitCode = 1;
    page.close();
    worker.close();
  } catch (error) {
    error.message = `${error.message}\nChrome log tail:\n${chromeLogs.tail()}`;
    throw error;
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
  const targets = await listTargets().catch(() => []);
  throw new Error(
    `Timed out waiting for expected Chrome target. Targets: ${JSON.stringify(
      targets.map((target) => ({ type: target.type, url: target.url })),
    )}`,
  );
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

function collectProcessLogs(child) {
  let buffer = "";
  const append = (chunk) => {
    buffer = `${buffer}${chunk.toString()}`.slice(-6000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("error", (error) => append(`\n[process error] ${error.message}`));
  child.on("exit", (code, signal) =>
    append(`\n[process exit] code=${code} signal=${signal}`),
  );
  return {
    tail() {
      return buffer.trim();
    },
  };
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
