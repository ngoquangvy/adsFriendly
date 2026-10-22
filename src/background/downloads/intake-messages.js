import { DOWNLOAD_INTAKE_MESSAGES } from "../../downloads/intake-contract.js";
import { FILE_MESSAGES } from "../../downloads/file-contract.js";
import { ACTIONS as A } from "../../runtime/action-catalog.js";
import { FILE_OFFERS_MESSAGE } from "../../downloads/auto-check-policy.js";
const FILE_ACTIONS = Object.freeze({
  [FILE_MESSAGES.CHECK]: A.BROWSER_FILE_CHECK,
  [FILE_MESSAGES.ACCEPT]: A.BROWSER_FILE_ACCEPT,
  [FILE_MESSAGES.RETURN]: A.BROWSER_FILE_RETURN,
  [FILE_MESSAGES.OPEN]: A.BROWSER_FILE_OPEN,
  [FILE_MESSAGES.REVEAL]: A.BROWSER_FILE_REVEAL,
});

// Private Settings-only metadata endpoints; content scripts cannot read filenames.
export function routeDownloadIntakeMessage(
  message,
  sender,
  intake,
  chrome,
  handoff,
  automaticFiles,
) {
  if (message?.type === FILE_OFFERS_MESSAGE) {
    if (
      sender?.id !== chrome.runtime.id ||
      sender?.url?.split(/[?#]/)[0] !==
        chrome.runtime.getURL("popup/popup.html")
    )
      return { status: "ignored" };
    return (
      automaticFiles
        ?.snapshot()
        .then((value) => ({ status: "ok", items: value.offers })) || {
        status: "ok",
        items: [],
      }
    );
  }
  if (
    !Object.values(DOWNLOAD_INTAKE_MESSAGES).includes(message?.type) &&
    !FILE_ACTIONS[message?.type]
  )
    return null;
  if (
    sender?.id !== chrome.runtime.id ||
    sender?.url?.split(/[?#]/)[0] !==
      chrome.runtime.getURL("options/options.html")
  )
    return { status: "ignored" };
  if (FILE_ACTIONS[message.type])
    return (
      handoff?.execute(FILE_ACTIONS[message.type], {
        browserId: message.browserId,
        checkId: message.checkId,
        jobId: message.jobId,
      }) || { status: "unavailable" }
    );
  if (message.type === DOWNLOAD_INTAKE_MESSAGES.GET && handoff)
    return Promise.all([handoff.snapshot(), automaticFiles?.snapshot()]).then(
      ([extra, auto]) => ({ ...intake.snapshot(), ...extra, autoChecks: auto }),
    );
  return message.type === DOWNLOAD_INTAKE_MESSAGES.GET
    ? intake.snapshot()
    : intake.clear();
}
