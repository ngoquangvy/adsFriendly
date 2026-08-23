const TOAST_ID = "adsfriendly-dom-toast";
const TOAST_TIMEOUT_MS = 12000;
let active = null;
let hideTimer = null;

export function showDomCandidateToast(candidate, handlers) {
  active = { candidate, handlers };
  const toast = ensureToast();
  const label = candidate.features.tag.toUpperCase();
  const confidence = Math.round(candidate.decision.confidence * 100);
  toast.querySelector(".adsfriendly-dom-message").textContent =
    `${label} · ${confidence}% confidence`;
  toast.querySelector(".adsfriendly-dom-message").title =
    candidate.decision.reasons?.join(", ") || "Heuristic DOM signals";
  toast.classList.remove("adsfriendly-dom-hidden");

  scheduleHide();
}

function ensureToast() {
  let toast = document.getElementById(TOAST_ID);
  if (toast) return toast;

  toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "adsfriendly-dom-hidden";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.innerHTML = `
    <span class="adsfriendly-dom-scope">PAGE ELEMENT</span>
    <span class="adsfriendly-dom-message"></span>
    <button class="adsfriendly-dom-hide" type="button">Hide element</button>
    <button class="adsfriendly-dom-allow" type="button">Keep element</button>
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
    #${TOAST_ID} .adsfriendly-dom-scope {
      padding: 3px 5px;
      border-radius: 5px;
      background: rgba(96, 165, 250, 0.16);
      color: #93c5fd;
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
  if (active) hideTimer = setTimeout(hideDomToast, TOAST_TIMEOUT_MS);
}

function pauseHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
}

function hideDomToast() {
  const toast = document.getElementById(TOAST_ID);
  if (toast) toast.classList.add("adsfriendly-dom-hidden");
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  active = null;
}
