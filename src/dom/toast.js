const TOAST_ID = "adsfriendly-dom-toast";
let active = null;
let hideTimer = null;

export function showDomCandidateToast(candidate, handlers) {
  active = { candidate, handlers };
  const toast = ensureToast();
  const label = candidate.features.tag.toUpperCase();
  toast.querySelector(".adsfriendly-dom-message").textContent =
    `Possible ad: ${label} (${Math.round(candidate.decision.confidence * 100)}%)`;
  toast.classList.remove("adsfriendly-dom-hidden");

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hideDomToast, 4000);
}

function ensureToast() {
  let toast = document.getElementById(TOAST_ID);
  if (toast) return toast;

  toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "adsfriendly-dom-hidden";
  toast.innerHTML = `
    <span class="adsfriendly-dom-message"></span>
    <button class="adsfriendly-dom-hide" type="button">Hide</button>
    <button class="adsfriendly-dom-allow" type="button">Allow</button>
    <button class="adsfriendly-dom-close" type="button">x</button>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #${TOAST_ID} {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: min(440px, calc(100vw - 32px));
      padding: 8px 9px 8px 12px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.96);
      color: #f8fafc;
      box-shadow: 0 10px 30px rgba(0,0,0,0.32);
      font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      opacity: 1;
      transition: opacity 160ms ease, transform 160ms ease;
    }
    #${TOAST_ID}.adsfriendly-dom-hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px);
    }
    #${TOAST_ID} .adsfriendly-dom-message {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    #${TOAST_ID} .adsfriendly-dom-allow,
    #${TOAST_ID} .adsfriendly-dom-close {
      color: #94a3b8;
    }
  `;

  toast.querySelector(".adsfriendly-dom-hide").onclick = () => {
    active?.handlers?.onHide?.(active.candidate);
    hideDomToast();
  };
  toast.querySelector(".adsfriendly-dom-allow").onclick = () => {
    active?.handlers?.onAllow?.(active.candidate);
    hideDomToast();
  };
  toast.querySelector(".adsfriendly-dom-close").onclick = hideDomToast;

  (document.head || document.documentElement).appendChild(style);
  (document.body || document.documentElement).appendChild(toast);
  return toast;
}

function hideDomToast() {
  const toast = document.getElementById(TOAST_ID);
  if (toast) toast.classList.add("adsfriendly-dom-hidden");
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  active = null;
}
