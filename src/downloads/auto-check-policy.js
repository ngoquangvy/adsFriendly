import { FILE_EXTENSIONS } from "./file-contract.js";
import { assessDownloadIntake } from "./intake-policy.js";

export const FILE_AUTO_CHECK_FEATURE = "background.browser-file-auto-check";
export const FILE_AUTO_MIN_BYTES = 8 * 1024 * 1024;
export const FILE_OFFERS_MESSAGE = "GET_BROWSER_FILE_OFFERS";
export const FILE_AUTO_CHECK_KEY = "browserFileChecks.v1";

export function assessAutomaticFileCheck(row) {
  if (assessDownloadIntake(row).disposition !== "needs_validation")
    return { eligible: false, reason: "browser_only" };
  if (!Number.isSafeInteger(row.totalBytes) || row.totalBytes <= 0)
    return { eligible: false, reason: "size_unknown" };
  if (row.totalBytes < FILE_AUTO_MIN_BYTES)
    return { eligible: false, reason: "small_file" };
  if (
    !FILE_EXTENSIONS.includes(
      String(row.filename || "")
        .split(".")
        .pop()
        .toLowerCase(),
    )
  )
    return { eligible: false, reason: "unsupported_file_type" };
  return { eligible: true, reason: "preflight_required" };
}
