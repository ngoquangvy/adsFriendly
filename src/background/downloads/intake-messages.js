import { DOWNLOAD_INTAKE_MESSAGES } from "../../downloads/intake-contract.js";

// Private Settings-only metadata endpoints; content scripts cannot read filenames.
export function routeDownloadIntakeMessage(message, sender, intake, chrome) {
  if (!Object.values(DOWNLOAD_INTAKE_MESSAGES).includes(message?.type))
    return null;
  if (
    sender?.id !== chrome.runtime.id ||
    sender?.url?.split(/[?#]/)[0] !==
      chrome.runtime.getURL("options/options.html")
  )
    return { status: "ignored" };
  return message.type === DOWNLOAD_INTAKE_MESSAGES.GET
    ? intake.snapshot()
    : intake.clear();
}
