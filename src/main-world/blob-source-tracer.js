import { notifyContentScript } from "./bridge.js";
import { findRelatedMediaObservations } from "./media-observation-ledger.js";
import { stableMediaId } from "../media/detection.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";
import { CAPABILITIES } from "../runtime/feature-catalog.js";
import { publishCreatedBlob } from "./decrypted-manifest-observer.js";

const MAX_SOURCE_URLS = 32;
const MAX_MIME_TYPES = 8;
const REPORT_DELAY_MS = 200;
const CANARY_ARM_MS = 10 * 60 * 1000;
const MAX_CANARY_TRACKS = 4;
const MAX_CANARY_HANDOFF_BYTES_PER_TRACK = 1536 * 1024;
const MAX_CANARY_BYTES_PER_TRACK = 8 * 1024 * 1024;
const MAX_CANARY_BYTES_TOTAL = 16 * 1024 * 1024;
const MAX_CAPTURE_MESSAGE_BYTES = 1024 * 1024;
const MAX_CAPTURE_QUEUE_BYTES = 32 * 1024 * 1024;
const canaryStores = new Set();
let pendingCanaryEvidence = null;

export function armPlayerOutputCanary(evidence = {}) {
  pendingCanaryEvidence = {
    mediaId: typeof evidence.mediaId === "string" ? evidence.mediaId : null,
    manifestUrl:
      typeof evidence.manifestUrl === "string" ? evidence.manifestUrl : null,
    keyFormats: Array.isArray(evidence.keyFormats)
      ? evidence.keyFormats
          .filter((value) => typeof value === "string")
          .slice(0, 4)
      : [],
    armedAt: Date.now(),
    expiresAt: Date.now() + CANARY_ARM_MS,
  };
  for (const store of canaryStores) store.evidence = pendingCanaryEvidence;
}

export function readPlayerOutputCanary() {
  const stores = [...canaryStores]
    .filter((store) => store.evidence?.expiresAt > Date.now())
    .sort((left, right) => right.totalBytes - left.totalBytes);
  const tracks = [];
  for (const store of stores) {
    for (const track of store.tracks.values()) {
      if (!track.chunks.length || tracks.length >= MAX_CANARY_TRACKS) continue;
      const chunks = boundedChunks(
        track.chunks,
        MAX_CANARY_HANDOFF_BYTES_PER_TRACK,
      );
      tracks.push({
        id: track.id,
        mimeType: track.mimeType,
        appendFormats: [...track.appendFormats],
        appendCount: track.appendCount,
        capturedBytes: chunks.reduce(
          (total, chunk) => total + chunk.byteLength,
          0,
        ),
        chunks: chunks.map(bytesToBase64),
      });
    }
  }
  const evidence = stores[0]?.evidence || pendingCanaryEvidence;
  return {
    status: tracks.length ? "ready" : "empty",
    evidence: evidence
      ? {
          mediaId: evidence.mediaId,
          manifestUrl: evidence.manifestUrl,
          keyFormats: evidence.keyFormats,
          armedAt: evidence.armedAt,
        }
      : null,
    tracks,
    capturedBytes: tracks.reduce(
      (total, track) => total + track.capturedBytes,
      0,
    ),
  };
}

export function startPlayerOutputCapture({ captureId } = {}) {
  if (typeof captureId !== "string" || !captureId)
    return { status: "invalid_capture" };
  const store = [...canaryStores]
    .filter(
      (candidate) =>
        candidate.evidence?.expiresAt > Date.now() && candidate.tracks.size,
    )
    .sort((left, right) => right.totalBytes - left.totalBytes)[0];
  if (!store) {
    return {
      status: "reload_required",
      reason:
        "No player output is buffered. Reload the page and start capture shortly after playback begins.",
    };
  }
  if (
    store.saturated ||
    [...store.tracks.values()].some((track) => track.truncated)
  ) {
    return {
      status: "reload_required",
      reason:
        "The bounded start buffer is no longer continuous. Reload the page and start capture earlier.",
    };
  }
  if (store.fullCapture) return { status: "capture_already_running" };
  const capture = {
    id: captureId,
    queue: [],
    queuedBytes: 0,
    pending: null,
    sequenceByTrack: new Map(),
    finishing: false,
    finishSent: false,
  };
  store.fullCapture = capture;
  for (const track of store.tracks.values()) {
    for (const chunk of track.chunks) {
      enqueueCaptureBytes(store, track, chunk, track.appendFormats[0] || null);
    }
  }
  pumpCaptureQueue(store);
  return {
    status: "started",
    captureId,
    seededBytes: capture.queuedBytes,
    trackCount: store.tracks.size,
  };
}

export function acknowledgePlayerOutputCapture(message = {}) {
  for (const store of canaryStores) {
    const capture = store.fullCapture;
    if (!capture?.pending || capture.pending.requestId !== message.requestId)
      continue;
    const item = capture.pending;
    capture.pending = null;
    capture.queuedBytes = Math.max(
      0,
      capture.queuedBytes - item.bytes.byteLength,
    );
    if (message.status !== "accepted") {
      failFullCapture(
        store,
        message.error ||
          `Helper rejected ${item.trackId} sequence ${item.sequence}.`,
      );
      return true;
    }
    pumpCaptureQueue(store);
    return true;
  }
  return false;
}

export function stopPlayerOutputCapture(captureId) {
  for (const store of canaryStores) {
    if (store.fullCapture?.id !== captureId) continue;
    store.fullCapture.queue.length = 0;
    store.fullCapture = null;
    return { status: "stopped", captureId };
  }
  return { status: "not_running", captureId };
}

export function clearPlayerOutputCanary() {
  pendingCanaryEvidence = null;
  for (const store of canaryStores) {
    store.evidence = null;
    store.tracks.clear();
    store.totalBytes = 0;
    store.saturated = false;
    store.fullCapture = null;
  }
}

export function installBlobSourceTracer(
  policy,
  {
    observerStartedAt = Date.now(),
    observerDocumentState = currentDocumentState(),
  } = {},
) {
  const bufferSources = new WeakMap();
  const blobSources = new WeakMap();
  const mediaSourceStates = new WeakMap();
  const sourceBufferStates = new WeakMap();
  const objectUrlStates = new Map();
  const cleanups = [];
  const canaryStore = {
    evidence:
      pendingCanaryEvidence?.expiresAt > Date.now()
        ? pendingCanaryEvidence
        : null,
    tracks: new Map(),
    totalBytes: 0,
    nextTrackId: 1,
    saturated: false,
    fullCapture: null,
  };
  canaryStores.add(canaryStore);

  patchResponseArrayBuffer();
  patchResponseBlob();
  patchBlobArrayBuffer();
  patchXhrResponse();
  patchMediaSource();
  patchObjectUrls();
  const onVideoEnded = (event) => {
    if (event.target?.tagName === "VIDEO")
      requestFullCaptureFinish(canaryStore);
  };
  if (globalThis.document?.addEventListener) {
    document.addEventListener("ended", onVideoEnded, true);
    cleanups.push(() =>
      document.removeEventListener("ended", onVideoEnded, true),
    );
  }

  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
    for (const state of objectUrlStates.values()) clearTimeout(state.timerId);
    objectUrlStates.clear();
    canaryStore.tracks.clear();
    canaryStores.delete(canaryStore);
  };

  function patchResponseArrayBuffer() {
    const original = globalThis.Response?.prototype?.arrayBuffer;
    if (typeof original !== "function") return;
    const wrapper = async function (...args) {
      const value = await original.apply(this, args);
      rememberBuffer(value, responseSource(this));
      return value;
    };
    Response.prototype.arrayBuffer = wrapper;
    cleanups.push(() => {
      if (Response.prototype.arrayBuffer === wrapper)
        Response.prototype.arrayBuffer = original;
    });
  }

  function patchResponseBlob() {
    const original = globalThis.Response?.prototype?.blob;
    if (typeof original !== "function") return;
    const wrapper = async function (...args) {
      const value = await original.apply(this, args);
      if (value instanceof Blob) blobSources.set(value, responseSource(this));
      return value;
    };
    Response.prototype.blob = wrapper;
    cleanups.push(() => {
      if (Response.prototype.blob === wrapper)
        Response.prototype.blob = original;
    });
  }

  function patchBlobArrayBuffer() {
    const original = globalThis.Blob?.prototype?.arrayBuffer;
    if (typeof original !== "function") return;
    const wrapper = async function (...args) {
      const value = await original.apply(this, args);
      rememberBuffer(value, blobSources.get(this));
      return value;
    };
    Blob.prototype.arrayBuffer = wrapper;
    cleanups.push(() => {
      if (Blob.prototype.arrayBuffer === wrapper)
        Blob.prototype.arrayBuffer = original;
    });
  }

  function patchXhrResponse() {
    const prototype = globalThis.XMLHttpRequest?.prototype;
    const descriptor = prototype
      ? Object.getOwnPropertyDescriptor(prototype, "response")
      : null;
    if (
      !prototype ||
      typeof descriptor?.get !== "function" ||
      !descriptor.configurable
    )
      return;
    const getter = function () {
      const value = descriptor.get.call(this);
      const source = {
        url: this.responseURL || this.__adsfriendly_url || "",
        mimeType: safeXhrContentType(this),
        observedAt: Date.now(),
      };
      if (value instanceof ArrayBuffer) rememberBuffer(value, source);
      else if (value instanceof Blob) blobSources.set(value, source);
      return value;
    };
    Object.defineProperty(prototype, "response", {
      ...descriptor,
      get: getter,
    });
    cleanups.push(() => {
      const current = Object.getOwnPropertyDescriptor(prototype, "response");
      if (current?.get === getter)
        Object.defineProperty(prototype, "response", descriptor);
    });
  }

  function patchMediaSource() {
    const mediaSourcePrototype = globalThis.MediaSource?.prototype;
    const sourceBufferPrototype = globalThis.SourceBuffer?.prototype;
    const originalAdd = mediaSourcePrototype?.addSourceBuffer;
    const originalAppend = sourceBufferPrototype?.appendBuffer;
    const originalEndOfStream = mediaSourcePrototype?.endOfStream;
    if (typeof originalAdd === "function") {
      const addWrapper = function (mimeType) {
        const sourceBuffer = originalAdd.call(this, mimeType);
        const state = mediaSourceState(this);
        rememberBounded(
          state.mimeTypes,
          String(mimeType || ""),
          MAX_MIME_TYPES,
        );
        sourceBufferStates.set(sourceBuffer, {
          state,
          mimeType: String(mimeType || ""),
          canaryTrackId: `source-buffer-${canaryStore.nextTrackId++}`,
        });
        scheduleReport(state);
        return sourceBuffer;
      };
      mediaSourcePrototype.addSourceBuffer = addWrapper;
      cleanups.push(() => {
        if (mediaSourcePrototype.addSourceBuffer === addWrapper)
          mediaSourcePrototype.addSourceBuffer = originalAdd;
      });
    }
    if (typeof originalAppend === "function") {
      const appendWrapper = function (value) {
        const sourceBufferState = sourceBufferStates.get(this);
        if (sourceBufferState) {
          const state = sourceBufferState.state;
          const buffer = value instanceof ArrayBuffer ? value : value?.buffer;
          const source = bufferSources.get(buffer);
          state.appendCount += 1;
          state.totalAppendedBytes += Number(value?.byteLength || 0);
          state.lastAppendAt = Date.now();
          const appendFormat = classifyAppendedMediaBuffer(value);
          if (appendFormat)
            rememberBounded(state.appendFormats, appendFormat, 4);
          else state.unclassifiedAppendCount += 1;
          captureCanaryChunk(
            canaryStore,
            sourceBufferState,
            value,
            appendFormat,
          );
          captureFullOutputChunk(
            canaryStore,
            sourceBufferState,
            value,
            appendFormat,
          );
          if (source?.url) {
            rememberBounded(state.sourceUrls, source.url, MAX_SOURCE_URLS);
            if (source.mimeType)
              rememberBounded(state.mimeTypes, source.mimeType, MAX_MIME_TYPES);
          }
          scheduleReport(state);
        }
        return originalAppend.call(this, value);
      };
      sourceBufferPrototype.appendBuffer = appendWrapper;
      cleanups.push(() => {
        if (sourceBufferPrototype.appendBuffer === appendWrapper)
          sourceBufferPrototype.appendBuffer = originalAppend;
      });
    }
    if (typeof originalEndOfStream === "function") {
      const endWrapper = function (...args) {
        requestFullCaptureFinish(canaryStore);
        return originalEndOfStream.apply(this, args);
      };
      mediaSourcePrototype.endOfStream = endWrapper;
      cleanups.push(() => {
        if (mediaSourcePrototype.endOfStream === endWrapper)
          mediaSourcePrototype.endOfStream = originalEndOfStream;
      });
    }
  }

  function patchObjectUrls() {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    if (typeof originalCreate === "function") {
      const createWrapper = function (object) {
        const objectUrl = originalCreate.call(this, object);
        if (object instanceof Blob) publishCreatedBlob(object, objectUrl);
        if (object instanceof MediaSource) {
          const state = mediaSourceState(object);
          state.blobUrl = objectUrl;
          objectUrlStates.set(objectUrl, state);
          scheduleReport(state);
        } else if (object instanceof Blob) {
          const source = blobSources.get(object);
          if (source?.url) {
            const state = createTraceState(objectUrl, "blob_object");
            rememberBounded(state.sourceUrls, source.url, MAX_SOURCE_URLS);
            if (source.mimeType || object.type)
              rememberBounded(
                state.mimeTypes,
                source.mimeType || object.type,
                MAX_MIME_TYPES,
              );
            state.totalAppendedBytes = object.size || 0;
            objectUrlStates.set(objectUrl, state);
            scheduleReport(state);
          }
        }
        return objectUrl;
      };
      URL.createObjectURL = createWrapper;
      cleanups.push(() => {
        if (URL.createObjectURL === createWrapper)
          URL.createObjectURL = originalCreate;
      });
    }
    if (typeof originalRevoke === "function") {
      const revokeWrapper = function (objectUrl) {
        const state = objectUrlStates.get(String(objectUrl));
        if (state) {
          clearTimeout(state.timerId);
          objectUrlStates.delete(String(objectUrl));
        }
        return originalRevoke.call(this, objectUrl);
      };
      URL.revokeObjectURL = revokeWrapper;
      cleanups.push(() => {
        if (URL.revokeObjectURL === revokeWrapper)
          URL.revokeObjectURL = originalRevoke;
      });
    }
  }

  function mediaSourceState(mediaSource) {
    let state = mediaSourceStates.get(mediaSource);
    if (!state) {
      state = createTraceState(null, "media_source");
      mediaSourceStates.set(mediaSource, state);
    }
    return state;
  }

  function scheduleReport(state) {
    if (!state.blobUrl || !policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
    clearTimeout(state.timerId);
    state.timerId = setTimeout(() => reportState(state), REPORT_DELAY_MS);
  }

  function reportState(state) {
    state.timerId = null;
    if (!state.blobUrl || !policy.can(CAPABILITIES.MEDIA_OBSERVE)) return;
    const related = findRelatedMediaObservations(state.sourceUrls, {
      observedAt: state.lastAppendAt || Date.now(),
      allowedKinds:
        state.traceKind === "media_source" ? ["hls", "dash"] : ["direct"],
    });
    const signature = JSON.stringify({
      sourceUrls: state.sourceUrls,
      candidateIds: related.map((item) => item.id),
      appendCount: state.appendCount,
      totalAppendedBytes: state.totalAppendedBytes,
      appendFormats: state.appendFormats,
      unclassifiedAppendCount: state.unclassifiedAppendCount,
    });
    if (signature === state.lastReportSignature) return;
    state.lastReportSignature = signature;
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_BLOB_TRACED, {
        mediaId: stableMediaId("blob", state.blobUrl),
        pageUrl: location.href,
        blobUrl: state.blobUrl,
        sourceUrls: state.sourceUrls,
        candidateIds: related.map((item) => item.id),
        mimeTypes: state.mimeTypes,
        appendCount: state.appendCount,
        totalAppendedBytes: state.totalAppendedBytes,
        appendFormats: state.appendFormats,
        unclassifiedAppendCount: state.unclassifiedAppendCount,
        observerStartedAt,
        observerDocumentState,
        observedAt: Date.now(),
      }),
    });
  }

  function rememberBuffer(buffer, source) {
    if (buffer instanceof ArrayBuffer && source?.url)
      bufferSources.set(buffer, source);
  }
}

function captureCanaryChunk(store, sourceBufferState, value, appendFormat) {
  if (!store.evidence || store.evidence.expiresAt <= Date.now()) return;
  if (store.totalBytes >= MAX_CANARY_BYTES_TOTAL) {
    store.saturated = true;
    return;
  }
  let bytes;
  if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value))
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else return;
  let track = store.tracks.get(sourceBufferState.canaryTrackId);
  if (!track) {
    if (store.tracks.size >= MAX_CANARY_TRACKS) return;
    track = {
      id: sourceBufferState.canaryTrackId,
      mimeType: sourceBufferState.mimeType,
      appendFormats: [],
      appendCount: 0,
      capturedBytes: 0,
      chunks: [],
      truncated: false,
    };
    store.tracks.set(track.id, track);
  }
  track.appendCount += 1;
  if (appendFormat) rememberBounded(track.appendFormats, appendFormat, 4);
  const remaining = Math.min(
    MAX_CANARY_BYTES_PER_TRACK - track.capturedBytes,
    MAX_CANARY_BYTES_TOTAL - store.totalBytes,
  );
  if (remaining <= 0) {
    track.truncated = true;
    store.saturated = true;
    return;
  }
  const copy = bytes.slice(0, Math.min(bytes.byteLength, remaining));
  if (copy.byteLength < bytes.byteLength) {
    track.truncated = true;
    store.saturated = true;
  }
  track.chunks.push(copy);
  track.capturedBytes += copy.byteLength;
  store.totalBytes += copy.byteLength;
}

function captureFullOutputChunk(store, sourceBufferState, value, appendFormat) {
  if (!store.fullCapture || store.fullCapture.finishing) return;
  const bytes = mediaBytes(value);
  if (!bytes) return;
  const track = store.tracks.get(sourceBufferState.canaryTrackId) || {
    id: sourceBufferState.canaryTrackId,
    mimeType: sourceBufferState.mimeType,
    appendFormats: appendFormat ? [appendFormat] : [],
  };
  enqueueCaptureBytes(store, track, bytes, appendFormat);
  pumpCaptureQueue(store);
}

function enqueueCaptureBytes(store, track, bytes, appendFormat) {
  const capture = store.fullCapture;
  if (!capture || capture.finishing) return;
  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += MAX_CAPTURE_MESSAGE_BYTES
  ) {
    const copy = bytes.slice(
      offset,
      Math.min(bytes.byteLength, offset + MAX_CAPTURE_MESSAGE_BYTES),
    );
    if (capture.queuedBytes + copy.byteLength > MAX_CAPTURE_QUEUE_BYTES) {
      failFullCapture(
        store,
        "Player output queue exceeded 32 MB while waiting for the Helper.",
      );
      return;
    }
    const sequence = capture.sequenceByTrack.get(track.id) || 0;
    capture.sequenceByTrack.set(track.id, sequence + 1);
    capture.queue.push({
      trackId: track.id,
      sequence,
      mimeType: track.mimeType || null,
      appendFormat: appendFormat || track.appendFormats?.[0] || null,
      bytes: copy,
    });
    capture.queuedBytes += copy.byteLength;
  }
}

function pumpCaptureQueue(store) {
  const capture = store.fullCapture;
  if (!capture || capture.pending) return;
  const item = capture.queue.shift();
  if (!item) {
    if (capture.finishing && !capture.finishSent) {
      capture.finishSent = true;
      notifyContentScript({
        type: "PLAYER_OUTPUT_CAPTURE_FINISH",
        captureId: capture.id,
      });
    }
    return;
  }
  item.requestId =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  capture.pending = item;
  const playback = currentPlaybackState();
  notifyContentScript({
    type: "PLAYER_OUTPUT_CAPTURE_CHUNK",
    requestId: item.requestId,
    captureId: capture.id,
    trackId: item.trackId,
    sequence: item.sequence,
    mimeType: item.mimeType,
    appendFormat: item.appendFormat,
    processedSeconds: playback.currentTime,
    duration: playback.duration,
    data: bytesToBase64(item.bytes),
  });
}

function requestFullCaptureFinish(store) {
  const capture = store.fullCapture;
  if (!capture || capture.finishing) return;
  capture.finishing = true;
  pumpCaptureQueue(store);
}

function failFullCapture(store, error) {
  const capture = store.fullCapture;
  if (!capture) return;
  store.fullCapture = null;
  notifyContentScript({
    type: "PLAYER_OUTPUT_CAPTURE_FAILED",
    captureId: capture.id,
    error,
  });
}

function currentPlaybackState() {
  const videos = [...(globalThis.document?.querySelectorAll?.("video") || [])];
  const currentTime = Math.max(
    0,
    ...videos.map((video) => Number(video.currentTime) || 0),
  );
  const durations = videos
    .map((video) => Number(video.duration))
    .filter((value) => Number.isFinite(value) && value > 0);
  return {
    currentTime,
    duration: durations.length ? Math.max(...durations) : null,
  };
}

function mediaBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function boundedChunks(chunks, maximumBytes) {
  const result = [];
  let remaining = maximumBytes;
  for (const chunk of chunks) {
    if (remaining <= 0) break;
    const copy = chunk.slice(0, Math.min(chunk.byteLength, remaining));
    result.push(copy);
    remaining -= copy.byteLength;
  }
  return result;
}

function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}

function currentDocumentState() {
  const state = globalThis.document?.readyState;
  return ["loading", "interactive", "complete"].includes(state)
    ? state
    : "unknown";
}

function createTraceState(blobUrl, traceKind) {
  return {
    blobUrl,
    traceKind,
    sourceUrls: [],
    mimeTypes: [],
    appendCount: 0,
    totalAppendedBytes: 0,
    appendFormats: [],
    unclassifiedAppendCount: 0,
    lastAppendAt: null,
    lastReportSignature: null,
    timerId: null,
  };
}

export function classifyAppendedMediaBuffer(value) {
  let bytes;
  if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value))
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else return null;
  if (bytes.length < 4) return null;
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return "webm";
  if (
    bytes.length >= 8 &&
    ["ftyp", "styp", "moof", "moov", "sidx", "mdat"].includes(
      String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]),
    )
  )
    return "iso-bmff";
  if (hasMpegTsSync(bytes)) return "mpeg-ts";
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return "aac-adts";
  return null;
}

function hasMpegTsSync(bytes) {
  const maximumOffset = Math.min(187, bytes.length - 1);
  for (let offset = 0; offset <= maximumOffset; offset++) {
    if (bytes[offset] !== 0x47) continue;
    if (offset + 188 >= bytes.length || bytes[offset + 188] === 0x47)
      return true;
  }
  return false;
}

function responseSource(response) {
  return {
    url: response?.url || "",
    mimeType: response?.headers?.get?.("content-type") || "",
    observedAt: Date.now(),
  };
}

function safeXhrContentType(xhr) {
  try {
    return xhr.getResponseHeader("content-type") || "";
  } catch {
    return "";
  }
}

function rememberBounded(items, value, maximum) {
  if (!value || items.includes(value)) return;
  items.push(value);
  if (items.length > maximum) items.shift();
}
