import {
  assessAutomaticFileCheck,
  FILE_AUTO_CHECK_KEY,
} from "../../downloads/auto-check-policy.js";
import { ACTIONS as A } from "../../runtime/action-catalog.js";
import { CAPABILITIES as C } from "../../runtime/feature-catalog.js";

// Opt-in scheduler over NEW sanitized observations. No history scan, raw URL
// cache, cookie access, download mutation, automatic acceptance or retries.
export function createAutomaticFileChecks({
  chrome,
  intake,
  handoff,
  now = Date.now,
}) {
  const states = new Map(),
    owned = new Set(),
    queue = [];
  let enabled = false,
    epoch = 0,
    startTime = 0,
    inFlight = false,
    timer = null;
  let unsubscribe = null,
    uncheck = null,
    revision = 0;
  async function snapshot() {
    const observed = intake.snapshot(),
      checked = await handoff.snapshot();
    const offers = !enabled
      ? []
      : (checked.checks || []).flatMap((check) => {
          const row = observed.items.find(
            (item) => item.id === check.browserId,
          );
          return row?.state === "in_progress" && !row.paused
            ? [
                {
                  browserId: row.id,
                  filename: row.filename,
                  totalBytes: row.totalBytes,
                  expiresAt: check.expiresAt,
                },
              ]
            : [];
        });
    return {
      enabled,
      status: enabled ? "on" : "off",
      items: [...states.values()],
      offers,
    };
  }
  function publish() {
    if (timer) return;
    const stamp = ++revision;
    timer = setTimeout(async () => {
      timer = null;
      try {
        const value = await snapshot();
        if (stamp !== revision) return;
        const count = enabled ? value.offers.length : 0;
        for (const id of owned)
          if (
            states.get(id)?.status === "ready" &&
            !value.offers.some((row) => row.browserId === id)
          ) {
            owned.delete(id);
            states.set(id, {
              browserId: id,
              status: "closed",
              reason: "check_closed",
            });
          }
        await chrome.action?.setBadgeBackgroundColor?.({ color: "#15803d" });
        await chrome.action?.setBadgeText?.({
          text: count ? String(count) : "",
        });
        await chrome.storage.session.set({
          [FILE_AUTO_CHECK_KEY]: {
            revision: stamp,
            enabled,
            count,
            items: value.items,
          },
        });
      } catch {} // A badge/storage failure must not interrupt Chrome/protection.
    }, 250);
  }
  function put(browserId, status, reason) {
    states.set(browserId, { browserId, status, reason });
    while (states.size > 50) states.delete(states.keys().next().value);
    publish();
  }
  async function drain() {
    if (inFlight || !enabled || !queue.length) return;
    inFlight = true;
    const generation = epoch,
      next = queue.shift();
    try {
      const row = intake.snapshot().items.find((row) => row.id === next.id);
      if (
        !row ||
        now() - next.at > 15000 ||
        !assessAutomaticFileCheck(row).eligible
      ) {
        put(next.id, "skipped", "source_changed");
        return;
      }
      const permitted = await chrome.permissions.contains({
        permissions: ["downloads", "nativeMessaging"],
      });
      if (!enabled || generation !== epoch) return;
      if (!permitted) {
        put(next.id, "skipped", "permission_required");
        return;
      }
      if (!enabled || generation !== epoch) return;
      owned.add(next.id);
      put(next.id, "checking", "preflight_required");
      const result = await handoff.execute(A.BROWSER_FILE_AUTO_CHECK, {
        browserId: next.id,
      });
      if (!enabled || generation !== epoch) return;
      const fresh = intake.snapshot().items.find((row) => row.id === next.id);
      put(
        next.id,
        result?.status === "ready_for_handoff"
          ? "ready"
          : fresh?.state !== "in_progress"
            ? "skipped"
            : "failed",
        result?.status === "ready_for_handoff"
          ? "verified"
          : fresh?.state !== "in_progress"
            ? "not_active"
            : "preflight_failed",
      );
      if (result?.status !== "ready_for_handoff") owned.delete(next.id);
    } catch {
      owned.delete(next.id);
      if (enabled && generation === epoch)
        put(next.id, "failed", "preflight_failed");
    } finally {
      inFlight = false;
      if (enabled) void drain();
    }
  }
  function reset() {
    ++epoch;
    queue.length = 0;
    for (const id of owned) handoff.discardCheck(id, true);
    owned.clear();
    states.clear();
    publish();
  }
  function onRecord(event) {
    if (!enabled) return;
    if (event.type === "reset") {
      reset();
      return;
    }
    const row = event.row;
    if (!row || row.state !== "in_progress" || row.paused) {
      if (owned.has(event.id)) handoff.discardCheck(event.id, true);
      owned.delete(event.id);
      const index = queue.findIndex((row) => row.id === event.id);
      if (index >= 0) queue.splice(index, 1);
      if (row || states.has(event.id)) put(event.id, "skipped", "not_active");
      return;
    }
    if (row.observedAt < startTime - 1000) return;
    const prior = states.get(row.id);
    if (
      prior &&
      !["size_unknown", "unsupported_file_type", "browser_only"].includes(
        prior.reason,
      )
    )
      return;
    const assessment = assessAutomaticFileCheck(row);
    if (!assessment.eligible) {
      put(row.id, "skipped", assessment.reason);
      return;
    }
    if (queue.length >= 10) {
      put(row.id, "skipped", "queue_full");
      return;
    }
    put(row.id, "queued", "preflight_required");
    queue.push({ id: row.id, at: now() });
    void drain();
  }
  const removed = (change) => {
    if (
      change.permissions?.some((name) =>
        ["downloads", "nativeMessaging"].includes(name),
      )
    )
      reset();
  };
  return {
    snapshot,
    refreshIndicators: publish,
    startFeature(policy) {
      policy.require(C.BROWSER_FILE_AUTO_CHECK);
      enabled = true;
      startTime = now();
      unsubscribe = intake.subscribe(onRecord);
      uncheck = handoff.subscribeChecks(publish);
      chrome.permissions?.onRemoved?.addListener(removed);
      publish();
      return () => {
        enabled = false;
        reset();
        unsubscribe?.();
        uncheck?.();
        chrome.permissions?.onRemoved?.removeListener(removed);
      };
    },
  };
}
