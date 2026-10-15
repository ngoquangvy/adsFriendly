import {
  MEDIA_HELPER_HOST_NAME,
  MEDIA_HELPER_PROTOCOL_VERSION as V,
} from "../../media/helper-contract.js";
import {
  FILE_HELPER_REQUESTS as R,
  FILE_HELPER_EVENTS as E,
  FILE_HTTP_CAPABILITY,
} from "../../downloads/file-contract.js";

// One bounded native session per checked file, isolated from media job state.
export async function prepareFileHelper(chrome, payload, onProgress, signal) {
  signal?.throwIfAborted();
  const port = chrome.runtime.connectNative(MEDIA_HELPER_HOST_NAME);
  const pending = new Map();
  let closed = false,
    terminal = null,
    idleTimer = null;
  function failAll(error) {
    clearTimeout(idleTimer);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
    terminal?.reject(error);
    terminal = null;
  }
  function close() {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", onAbort);
    port.onMessage.removeListener(onMessage);
    port.onDisconnect.removeListener(onDisconnect);
    failAll(
      Error("Helper connection closed; the Chrome download must be resumed."),
    );
    port.disconnect();
  }
  const onDisconnect = () => {
    signal?.removeEventListener("abort", onAbort);
    void chrome.runtime.lastError;
    closed = true;
    failAll(Error("Helper disconnected; the Chrome download must be resumed."));
  };
  const onMessage = (message) => {
    if (message?.protocolVersion !== V || typeof message.requestId !== "string")
      return;
    if (message.payload?.jobId && message.payload.jobId !== payload.jobId)
      return;
    const wait = pending.get(message.requestId);
    if (wait) {
      pending.delete(message.requestId);
      clearTimeout(wait.timer);
      if (message.type === "helper.error" || message.type === E.FILE_FAILED)
        wait.reject(
          Error(message.payload?.message || "Helper rejected the file."),
        );
      else wait.resolve(message);
      return;
    }
    if (!terminal || message.requestId !== terminal.requestId) return;
    clearTimeout(idleTimer);
    if ([E.FILE_PROGRESS, E.FILE_STARTED].includes(message.type))
      idleTimer = setTimeout(() => {
        failAll(Error("Helper file transfer stalled. Returning to Chrome."));
        close();
      }, 45000);
    if (message.type === E.FILE_PROGRESS) onProgress(message.payload);
    if (message.type === E.FILE_COMPLETED) {
      const done = terminal;
      terminal = null;
      done.resolve(message.payload);
    }
    if (
      [E.FILE_FAILED, E.FILE_CANCELLED, "helper.error"].includes(message.type)
    ) {
      const done = terminal;
      terminal = null;
      done.reject(Error(message.payload?.message || "File transfer stopped."));
    }
  };
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);
  const onAbort = () => close();
  signal?.addEventListener("abort", onAbort, { once: true });
  function request(type, data, timeout = 18000) {
    if (closed) return Promise.reject(Error("Helper connection unavailable."));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(Error("Helper file check timed out."));
      }, timeout);
      pending.set(requestId, { resolve, reject, timer });
      try {
        port.postMessage({
          type,
          requestId,
          protocolVersion: V,
          payload: data,
        });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(error);
      }
    });
  }
  try {
    const hello = await request(
      "helper.hello",
      { extensionVersion: chrome.runtime.getManifest().version },
      8000,
    );
    if (
      hello.type !== "helper.ready" ||
      hello.payload?.capabilities?.[FILE_HTTP_CAPABILITY] !== true
    )
      throw Error("Update Media Helper to 0.25.0 or newer for file downloads.");
    const prepared = await request(R.FILE_PREPARE, payload);
    if (
      prepared.type !== E.FILE_PREPARED ||
      typeof prepared.payload?.token !== "string" ||
      prepared.payload.totalBytes !== payload.expected.size
    )
      throw Error("Helper returned an invalid file check.");
    return {
      filename: prepared.payload.filename,
      totalBytes: prepared.payload.totalBytes,
      isReady: () => !closed,
      start() {
        if (closed)
          return Promise.reject(
            Error("Prepared Helper session is no longer available."),
          );
        const requestId = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          terminal = { resolve, reject, requestId };
          idleTimer = setTimeout(() => {
            failAll(
              Error("Helper did not start the file. Returning to Chrome."),
            );
            close();
          }, 45000);
          try {
            port.postMessage({
              type: R.FILE_START,
              requestId,
              protocolVersion: V,
              payload: { jobId: payload.jobId, token: prepared.payload.token },
            });
          } catch (error) {
            terminal = null;
            reject(error);
          }
        });
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
