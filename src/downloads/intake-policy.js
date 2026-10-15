// Pure assessment, not permission to cancel/replay a browser download.
// The future executor/coordinator must add proof of GET/session compatibility.
export function assessDownloadIntake(record) {
  let reason;
  if (record.credentialed) reason = "url_credentials";
  else if (!["https:", "http:"].includes(record.protocol))
    reason = "unsupported_source";
  else if (record.danger !== "safe") reason = "browser_safety_check";
  else if (record.state !== "in_progress") reason = "not_active";
  else if (record.paused) reason = "browser_paused";
  else if (record.authorizationHints) reason = "authorization_not_verified";
  else if (
    /^(text\/html|application\/(vnd.apple.mpegurl|x-mpegurl|dash\+xml))$/i.test(
      record.mime,
    )
  )
    reason = "not_direct_file";
  else reason = "request_not_verified";
  return {
    disposition:
      reason === "request_not_verified" ? "needs_validation" : "browser_only",
    reason,
    canTakeOver: false,
  };
}

export const INTAKE_REASON_LABELS = Object.freeze({
  request_not_verified:
    "HTTP file · request method and browser session not verified",
  authorization_not_verified: "Signed/session URL · replay not verified",
  url_credentials: "URL credentials · keep in Chrome",
  unsupported_source: "Browser-local or unsupported source · keep in Chrome",
  browser_safety_check: "Chrome safety status not clear · keep in Chrome",
  not_active: "Already finished or interrupted · keep in Chrome",
  browser_paused: "Paused in Chrome",
  not_direct_file: "Not a direct file · use the media workflow if applicable",
});
