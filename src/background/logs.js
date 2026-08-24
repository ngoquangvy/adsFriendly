import { recordTelemetry } from "./telemetry.js";

export async function logBlockedNavigation(url, source) {
  const { blockedLogs = [] } = await chrome.storage.local.get(["blockedLogs"]);
  await chrome.storage.local.set({
    blockedLogs: [{ url, source, timestamp: Date.now() }, ...blockedLogs].slice(
      0,
      20,
    ),
  });
  await recordTelemetry({
    unit: "navigation",
    label: "ad",
    label_source: "heuristic_block",
    label_strength: "weak",
    ad_type: "popunder",
    targetUrl: url,
    sourceUrl: `https://${source}/`,
    action: "block",
    outcome: "auto_blocked_navigation",
    context: {
      source_host: source,
      target_host: safeHost(url),
      surface: "navigation_guard",
    },
  });
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}
