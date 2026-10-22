import { FILE_EXTENSIONS } from "./file-contract.js";
import { INTAKE_REASON_LABELS } from "./intake-policy.js";

// Read-only presentation of observation vs ownership. This does NOT authorize
// a transfer or change the intake policy, even when the label says checkable.
export function describeDownloadIntake(item, snapshot = {}) {
  const job = snapshot.fileTransfers?.find((row) => row.browserId === item.id);
  const managed = {
    pause_requested: ["helper_preparing", "Preparing Helper transfer"],
    downloading: ["helper_downloading", "Downloading with Helper"],
    completed: ["helper_completed", "Completed with Helper"],
    returned_to_chrome: ["returned_to_chrome", "Returned to Chrome"],
    needs_browser_attention: ["browser_attention", "Check Chrome"],
  }[job?.status];
  if (managed)
    return {
      code: managed[0],
      label: `Detected · ${managed[1]}`,
      detail:
        job.status === "downloading"
          ? "Helper owns this transfer; Chrome is retained as fallback."
          : "See Browser file transfers below for the result and available actions.",
      tone: job.status === "needs_browser_attention" ? "warning" : "info",
    };
  const notes = [];
  if (item.authorizationHints)
    notes.push(
      "Signed/session URL hints · Helper handoff is not supported yet.",
    );
  if (item.state === "complete")
    notes.push("Already completed in Chrome; no Helper transfer was started.");
  if (item.state === "interrupted")
    notes.push("Interrupted in Chrome; no Helper transfer was started.");
  if (item.credentialed) notes.push("URL credentials · keep in Chrome.");
  const extension = String(item.filename || "")
    .split(".")
    .pop()
    .toLowerCase();
  const unsupported = !FILE_EXTENSIONS.includes(extension);
  if (unsupported) notes.push("File type not supported for Helper handoff.");
  if (notes.length)
    return {
      code: item.authorizationHints
        ? "signed_url_browser_only"
        : item.state === "complete"
          ? "browser_completed"
          : item.state === "interrupted"
            ? "browser_interrupted"
            : unsupported
              ? "unsupported_file_type"
              : "browser_only",
      label: `Detected · ${item.state === "complete" ? "Completed in Chrome" : item.state === "interrupted" ? "Interrupted in Chrome" : "Chrome only"}`,
      detail: notes.join(" "),
      tone: "neutral",
    };
  if (item.assessment?.disposition !== "needs_validation")
    return {
      code: "browser_only",
      label: "Detected · Chrome only",
      detail:
        INTAKE_REASON_LABELS[item.assessment?.reason] ||
        "Transfer eligibility is unknown; keep in Chrome.",
      tone: "neutral",
    };
  if (snapshot.checkErrors?.some((row) => row.browserId === item.id))
    return {
      code: "helper_check_failed",
      label: "Detected · Helper check failed",
      detail:
        "The file was detected, but the Helper check failed. Chrome still owns the download; see the error below.",
      tone: "warning",
    };
  if (snapshot.checks?.some((row) => row.browserId === item.id))
    return {
      code: "ready_for_handoff",
      label: "Detected · Ready to transfer",
      detail:
        "Same GET file verified · confirmation required. Chrome continues until you confirm.",
      tone: "ready",
    };
  return {
    code: "check_available",
    label: "Detected · Check available",
    detail:
      "HTTP file · request method and browser session not verified. Check with Helper first; no automatic takeover.",
    tone: "info",
  };
}

export function describeDownloadObserver(snapshot = {}) {
  const count = Array.isArray(snapshot.items) ? snapshot.items.length : 0;
  const states = {
    off: [
      "Observation off · downloads are not being recorded",
      "Enable observation before starting a new download. Existing Chrome history is not scanned.",
    ],
    starting: [
      "Starting download observation…",
      "Waiting for observation to become ready.",
    ],
    permission_required: [
      "Downloads permission required · detection unavailable",
      "Allow Downloads permission using the observation switch before testing again.",
    ],
    observing: [
      `Observing · ${count} detected · Downloads stay in Chrome until a confirmed transfer`,
      "No download event recorded in the current observation window. This does not prove a missed download: earlier, private-tab and extension-created downloads are not included.",
    ],
  };
  const state = states[snapshot.status] || [
    "Download observation unavailable",
    "Could not read observation state. Reload the extension and try again.",
  ];
  return {
    label:
      state[0] +
      (snapshot.storageFailed ? " · Session storage unavailable" : ""),
    empty: state[1],
  };
}

// Explicit allowlist: diagnostics never exports source URLs, signed query
// values, native tokens, cookies, output paths or free-form Helper errors.
export function buildDownloadIntakeDiagnosticReport(snapshot = {}) {
  const items = Array.isArray(snapshot.items)
    ? snapshot.items.slice(0, 50)
    : [];
  const text = (value, limit) => String(value || "").slice(0, limit);
  return {
    version: 1,
    observerStatus: [
      "off",
      "starting",
      "permission_required",
      "observing",
      "unavailable",
    ].includes(snapshot.status)
      ? snapshot.status
      : "unavailable",
    storageFailed: snapshot.storageFailed === true,
    scope: "Current observation window only; not Chrome download history",
    detectedCount: items.length,
    items: items.map((item) => {
      const diagnostic = describeDownloadIntake(item, snapshot);
      return {
        id: item.id,
        filename: text(item.filename, 180),
        host: text(item.host, 253),
        state: text(item.state, 32),
        mime: text(item.mime, 100),
        totalBytes:
          Number.isSafeInteger(item.totalBytes) && item.totalBytes >= 0
            ? item.totalBytes
            : null,
        authorizationHints: item.authorizationHints === true,
        paused: item.paused === true,
        diagnostic: diagnostic.code,
        reason: text(item.assessment?.reason, 64),
      };
    }),
  };
}
