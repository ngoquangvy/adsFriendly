import {
  FILE_OFFERS_MESSAGE,
  FILE_AUTO_CHECK_KEY,
} from "../downloads/auto-check-policy.js";

// A read-only, trusted-popup invitation. It cannot accept transfers; review and
// the explicit confirmation stay in Settings. No signed URL/check ID is exposed.
export function startBrowserFileOffers({ document, chrome, window }) {
  const section = document.getElementById("browser-file-offers");
  if (!section) return () => {};
  let stopped = false,
    revision = 0;
  async function refresh() {
    const stamp = ++revision;
    try {
      const result = await chrome.runtime.sendMessage({
        type: FILE_OFFERS_MESSAGE,
      });
      if (stopped || stamp !== revision) return;
      const items = Array.isArray(result?.items)
        ? result.items.slice(0, 3)
        : [];
      section.hidden = !items.length;
      const list = section.querySelector(".browser-file-offer-list");
      list.replaceChildren();
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "media-details";
        row.textContent = item.filename;
        row.title = item.filename;
        list.append(row);
      }
    } catch {
      if (!stopped) section.hidden = true;
    }
  }
  const changed = (changes, area) => {
    if (area === "session" && FILE_AUTO_CHECK_KEY in changes) void refresh();
  };
  const review = () => {
    void chrome.tabs.create({
      url: chrome.runtime.getURL("options/options.html#downloads"),
    });
  };
  const button = section.querySelector("button");
  button.addEventListener("click", review);
  chrome.storage.onChanged.addListener(changed);
  const stop = () => {
    stopped = true;
    ++revision;
    button.removeEventListener("click", review);
    chrome.storage.onChanged.removeListener(changed);
    window.removeEventListener("unload", stop);
  };
  window.addEventListener("unload", stop);
  void refresh();
  return stop;
}
