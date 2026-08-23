const TOAST_ID = "adsfriendly-nav-toast";
const TOAST_TIMEOUT_MS = 10000;
let toastTimer = null;
let pendingNavigation = null;

export function startNavigationToast() {
  const onMessage = (message) => {
    if (message?.type !== "SHOW_GRAY_NAVIGATION") return;
    pendingNavigation = {
      url: message.url,
      source: message.source,
      target: message.target,
      tabId: message.tabId,
    };
    showNavigationToast();
  };
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.runtime
    .sendMessage({ type: "NAVIGATION_TOAST_READY" })
    .catch(() => {});
  return () => chrome.runtime.onMessage.removeListener(onMessage);
}

function showNavigationToast() {
  if (!pendingNavigation?.url) return;

  const toast = ensureToast();
  const host = safeHost(pendingNavigation.url);
  toast.querySelector(".adsfriendly-toast-message").textContent =
    `${truncate(host, 28)} may be an ad`;
  toast.classList.remove("adsfriendly-toast-hidden");

  scheduleHide();
}

function ensureToast() {
  let toast = document.getElementById(TOAST_ID);
  if (toast) return toast;

  toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "adsfriendly-toast-hidden";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.innerHTML = `
    <span class="adsfriendly-toast-scope">NEW TAB</span>
    <span class="adsfriendly-toast-message"></span>
    <button class="adsfriendly-toast-primary" type="button">Keep tab</button>
    <button class="adsfriendly-toast-block" type="button">Block tab</button>
    <button class="adsfriendly-toast-close" type="button">x</button>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #${TOAST_ID} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: min(420px, calc(100vw - 32px));
      padding: 8px 9px 8px 12px;
      border-radius: 8px;
      background: rgba(17, 24, 39, 0.96);
      color: #f8fafc;
      box-shadow: 0 10px 30px rgba(0,0,0,0.32);
      font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      opacity: 1;
      transition: opacity 160ms ease, transform 160ms ease;
    }
    #${TOAST_ID}.adsfriendly-toast-hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px);
    }
    #${TOAST_ID} .adsfriendly-toast-message {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${TOAST_ID} .adsfriendly-toast-scope {
      padding: 3px 5px;
      border-radius: 5px;
      background: rgba(245, 158, 11, 0.16);
      color: #fbbf24;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.04em;
      flex: 0 0 auto;
    }
    #${TOAST_ID} button {
      border: 0;
      background: transparent;
      color: #60a5fa;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      padding: 5px 6px;
      flex: 0 0 auto;
    }
    #${TOAST_ID} .adsfriendly-toast-close {
      color: #94a3b8;
    }
  `;

  toast.querySelector(".adsfriendly-toast-primary").onclick = () => {
    if (!pendingNavigation?.url) return;
    chrome.runtime.sendMessage({
      type: "KEEP_REVIEWED_TAB",
      ...pendingNavigation,
    });
    hideNavigationToast();
  };

  toast.querySelector(".adsfriendly-toast-block").onclick = () => {
    if (!pendingNavigation?.url) return;
    chrome.runtime.sendMessage({
      type: "BLOCK_REVIEWED_TAB",
      ...pendingNavigation,
    });
    hideNavigationToast();
  };

  toast.querySelector(".adsfriendly-toast-close").onclick = hideNavigationToast;
  toast.addEventListener("mouseenter", pauseHide);
  toast.addEventListener("mouseleave", scheduleHide);
  toast.addEventListener("focusin", pauseHide);
  toast.addEventListener("focusout", scheduleHide);

  (document.head || document.documentElement).appendChild(style);
  (document.body || document.documentElement).appendChild(toast);
  return toast;
}

function scheduleHide() {
  pauseHide();
  if (pendingNavigation)
    toastTimer = setTimeout(hideNavigationToast, TOAST_TIMEOUT_MS);
}

function pauseHide() {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
}

function hideNavigationToast() {
  const toast = document.getElementById(TOAST_ID);
  if (toast) toast.classList.add("adsfriendly-toast-hidden");
  pauseHide();
  pendingNavigation = null;
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
