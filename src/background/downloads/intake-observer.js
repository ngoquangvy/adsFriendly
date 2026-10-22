import {
  DOWNLOAD_INTAKE_KEY,
  INTAKE_LIMIT,
  INTAKE_MAX_AGE_MS,
  normalizeDownloadIntake,
  applyDownloadDelta,
  restoreDownloadIntake,
} from "../../downloads/intake-contract.js";
import { assessDownloadIntake } from "../../downloads/intake-policy.js";
import { CAPABILITIES } from "../../runtime/feature-catalog.js";

// A bounded ingress is installed synchronously at the background entry point.
// This retains the event waking MV3 while settings/session hydration is pending.
// No history search, network request or browser download mutation is performed.
export function createBrowserDownloadIntake({
  chrome,
  now = Date.now,
  onAvailability = () => {},
}) {
  let enabled = false,
    ready = false,
    attached = false,
    settled = false;
  let generation = 0,
    writeTimer = null,
    writeChain = Promise.resolve();
  let status = "off",
    storageFailed = false,
    pending = [];
  let clearSequence = 0,
    featurePolicy = null;
  const records = new Map();
  const subscribers = new Set();
  function emit(event) {
    for (const listener of subscribers) {
      try {
        listener(event);
      } catch {}
    }
  }

  function accept(event) {
    if (!ready) {
      if (!settled || enabled) {
        pending.push(event);
        if (pending.length > INTAKE_LIMIT * 2) pending.shift();
      }
      return;
    }
    if (!enabled) return;
    if (event.type !== "create" && !records.has(event.id)) return;
    if (event.type === "change" && !Object.keys(event.patch).length) return;
    apply(event);
    scheduleWrite();
  }
  const onCreated = (item) => {
    const row = normalizeDownloadIntake(item, now());
    if (row) accept({ type: "create", row });
  };
  const onChanged = (delta) => {
    if (Number.isInteger(delta?.id))
      accept({
        type: "change",
        id: delta.id,
        patch: applyDownloadDelta({}, delta),
      });
  };
  const onErased = (id) => accept({ type: "erase", id });
  function attach() {
    if (attached || !chrome.downloads?.onCreated) return;
    try {
      chrome.downloads.onCreated.addListener(onCreated);
      chrome.downloads.onChanged.addListener(onChanged);
      chrome.downloads.onErased.addListener(onErased);
      attached = true;
    } catch {
      detach();
      status = "permission_required";
    }
  }
  function detach() {
    chrome.downloads?.onCreated?.removeListener(onCreated);
    chrome.downloads?.onChanged?.removeListener(onChanged);
    chrome.downloads?.onErased?.removeListener(onErased);
    attached = false;
  }
  function prune() {
    for (const [id, row] of records)
      if (now() - row.observedAt > INTAKE_MAX_AGE_MS) records.delete(id);
    while (records.size > INTAKE_LIMIT)
      records.delete(records.keys().next().value);
  }
  function apply(event) {
    if (event.type === "create") {
      const previous = records.get(event.row.id);
      records.set(
        event.row.id,
        previous
          ? {
              ...event.row,
              observedAt: previous.observedAt,
              authorizationHints:
                previous.authorizationHints || event.row.authorizationHints,
              credentialed: previous.credentialed || event.row.credentialed,
            }
          : event.row,
      );
    } else if (event.type === "change" && records.has(event.id)) {
      const previous = records.get(event.id);
      records.set(event.id, {
        ...previous,
        ...event.patch,
        authorizationHints:
          previous.authorizationHints ||
          event.patch.authorizationHints === true,
        credentialed:
          previous.credentialed || event.patch.credentialed === true,
      });
    } else if (event.type === "erase") records.delete(event.id);
    prune();
    emit({
      type: event.type,
      row: records.get(event.row?.id ?? event.id),
      id: event.row?.id ?? event.id,
    });
  }
  function persist(remove = false) {
    clearTimeout(writeTimer);
    writeTimer = null;
    prune();
    const epoch = generation;
    const value = { version: 1, items: [...records.values()] };
    writeChain = writeChain
      .catch(() => {})
      .then(async () => {
        if (epoch !== generation) return;
        try {
          if (remove) await chrome.storage.session.remove(DOWNLOAD_INTAKE_KEY);
          else if (enabled && ready)
            await chrome.storage.session.set({ [DOWNLOAD_INTAKE_KEY]: value });
          storageFailed = false;
        } catch {
          storageFailed = true;
        }
      });
    return writeChain;
  }
  function scheduleWrite() {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
      void persist();
    }, 500);
  }
  function disable(nextStatus = "off") {
    onAvailability(false);
    ++generation;
    enabled = false;
    ready = false;
    status = nextStatus;
    pending = [];
    records.clear();
    emit({ type: "reset" });
    detach();
    void persist(true);
  }
  const onRemoved = (change) => {
    if (change.permissions?.includes("downloads"))
      disable("permission_required");
  };
  const onAdded = (change) => {
    if (change.permissions?.includes("downloads") && featurePolicy && !enabled)
      void start(featurePolicy);
  };
  async function start(policy) {
    policy.require(CAPABILITIES.BROWSER_DOWNLOAD_OBSERVE);
    featurePolicy = policy;
    const epoch = ++generation;
    enabled = true;
    onAvailability(true);
    ready = false;
    status = "starting";
    attach();
    chrome.permissions?.onRemoved?.addListener(onRemoved);
    chrome.permissions?.onAdded?.addListener(onAdded);
    try {
      const granted = await chrome.permissions.contains({
        permissions: ["downloads"],
      });
      if (epoch !== generation) return stop;
      if (!granted || !attached) {
        disable("permission_required");
        return stop;
      }
      try {
        const sequence = clearSequence;
        const saved = await chrome.storage.session.get(DOWNLOAD_INTAKE_KEY);
        if (epoch !== generation) return stop;
        if (sequence === clearSequence)
          for (const row of restoreDownloadIntake(
            saved?.[DOWNLOAD_INTAKE_KEY],
            now(),
          ))
            records.set(row.id, row);
      } catch {
        storageFailed = true;
      }
      if (epoch !== generation) return stop;
      ready = true;
      status = "observing";
      for (const event of pending.splice(0)) apply(event);
      scheduleWrite();
    } catch {
      if (epoch === generation) disable("permission_required");
    }
    return stop;
  }
  function stop() {
    featurePolicy = null;
    chrome.permissions?.onRemoved?.removeListener(onRemoved);
    chrome.permissions?.onAdded?.removeListener(onAdded);
    disable();
  }
  function settleBootstrap() {
    settled = true;
    if (!enabled) {
      onAvailability(false);
      pending = [];
      detach();
      // Remove stale session metadata even if the feature was disabled/imported.
      void persist(true);
    }
  }
  function snapshot() {
    const previousSize = records.size;
    prune();
    if (records.size !== previousSize && enabled && ready) scheduleWrite();
    return {
      status,
      storageFailed,
      observationOnly: true,
      maxItems: INTAKE_LIMIT,
      items: [...records.values()]
        .reverse()
        .map((row) => ({ ...row, assessment: assessDownloadIntake(row) })),
    };
  }
  async function clear() {
    ++clearSequence;
    records.clear();
    emit({ type: "reset" });
    pending = [];
    await persist(true);
    return { status: storageFailed ? "storage_error" : "cleared" };
  }
  return {
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    bootstrap: attach,
    start,
    startFeature(policy) {
      // Optional storage/permission hydration must not delay protection startup.
      void start(policy).catch(() => disable("unavailable"));
      return stop;
    },
    settleBootstrap,
    snapshot,
    clear,
    flush: () => persist(),
    stop,
  };
}
