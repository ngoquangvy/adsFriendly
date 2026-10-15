import { FILE_EXTENSIONS } from "../../downloads/file-contract.js";

// Response facts only, keyed by SHA-256 of the exact effective URL. No URLs,
// cookies, request bodies, headers payloads or keys are persisted.
export function createDownloadRequestEvidence({ chrome, now = Date.now }) {
  const records = new Map(),
    pending = new Set();
  let attached = false,
    generation = 0;
  async function capture(details) {
    if (
      details.statusCode < 200 ||
      details.statusCode >= 300 ||
      pending.size >= 200
    )
      return;
    const read = (name) =>
      details.responseHeaders?.find(
        (header) => header.name.toLowerCase() === name,
      )?.value || "";
    let url;
    try {
      url = new URL(details.url);
    } catch {
      return;
    }
    const mime = read("content-type").split(";")[0];
    if (
      !read("content-disposition").toLowerCase().includes("attachment") &&
      !FILE_EXTENSIONS.includes(url.pathname.split(".").pop().toLowerCase()) &&
      !/^(video\/|audio\/|application\/(zip|pdf|octet-stream))/.test(mime)
    )
      return;
    const epoch = generation;
    const key = await sourceKey(url.href);
    if (epoch !== generation) return;
    const total = Number(
      read("content-range").match(/\/(\d+)$/)?.[1] || read("content-length"),
    );
    const row = {
      method: String(details.method || "unknown").toUpperCase(),
      etag: read("etag"),
      size: Number.isSafeInteger(total) && total > 0 ? total : null,
      mime,
      capturedAt: Number(details.timeStamp) || now(),
    };
    const related = (records.get(key) || []).filter(
      (item) => now() - item.capturedAt < 3600000,
    );
    records.delete(key);
    records.set(key, [...related, row].slice(-10));
    while (records.size > 200) records.delete(records.keys().next().value);
  }
  const onHeaders = (details) => {
    const task = capture(details)
      .catch(() => {})
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  function start() {
    if (attached) return;
    chrome.webRequest.onHeadersReceived.addListener(
      onHeaders,
      {
        urls: ["http://*/*", "https://*/*"],
        types: ["main_frame", "sub_frame", "other", "xmlhttprequest", "media"],
      },
      ["responseHeaders"],
    );
    attached = true;
  }
  function stop() {
    ++generation;
    if (attached) chrome.webRequest.onHeadersReceived.removeListener(onHeaders);
    attached = false;
    records.clear();
  }
  async function forDownload(item) {
    await Promise.allSettled([...pending]);
    const key = await sourceKey(item.finalUrl || item.url);
    const started = Date.parse(item.startTime);
    const matches = (records.get(key) || []).filter(
      (row) =>
        Number.isFinite(started) &&
        row.capturedAt >= started - 1000 &&
        row.capturedAt <= started + 10000 &&
        now() - row.capturedAt < 3600000,
    );
    if (!matches.length || matches.some((row) => row.method !== "GET"))
      throw Error(
        "A matching GET download request was not observed. Keep this download in Chrome.",
      );
    const last = matches.at(-1);
    if (
      matches.some((row) => row.etag !== last.etag) ||
      !/^"[^"\r\n]{1,200}"$/.test(last.etag) ||
      !last.size
    )
      throw Error(
        "The file has no unambiguous strong validator and size. Keep it in Chrome.",
      );
    return { ...last, key };
  }
  return { bootstrap: start, start, stop, forDownload };
}

export async function sourceKey(value) {
  const url = new URL(value);
  url.hash = "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(url.href),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
