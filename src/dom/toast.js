import { isHiddenByAdsFriendly } from "./actions.js";

const TOAST_ID = "adsfriendly-dom-toast";
const HIGHLIGHT_ID = "adsfriendly-dom-highlight";
const TOAST_TIMEOUT_MS = 10000;
const HIDDEN_TOAST_TIMEOUT_MS = 5000;
const queuedCandidates = [];
let active = null;
let hideTimer = null;
let highlightFrame = null;

export function showDomCandidateToast(candidate, handlers) {
  enqueueOrShow({ candidate, handlers, state: "review" });
}

export function showDomHiddenToast(candidate, handlers) {
  enqueueOrShow({ candidate, handlers, state: "hidden" });
}

function enqueueOrShow(entry) {
  if (!isEntryReviewable(entry)) return;
  if (active) {
    if (queuedCandidates.length < 8) queuedCandidates.push(entry);
    return;
  }
  active = entry;
  renderActiveToast();
}

function renderActiveToast() {
  if (!active) return;
  if (!isEntryReviewable(active)) {
    hideDomToast();
    return;
  }
  const toast = ensureToast();
  const label = active.candidate.features.tag.toUpperCase();
  const message = toast.querySelector(".adsfriendly-dom-message");
  const hideButton = toast.querySelector(".adsfriendly-dom-hide");
  const allowButton = toast.querySelector(".adsfriendly-dom-allow");

  const isSavedRuleSummary = active.candidate.isSavedRuleSummary === true;
  toast.querySelector(".adsfriendly-dom-scope").textContent = isSavedRuleSummary
    ? "PAGE"
    : "ELEMENT";
  if (active.state === "error") {
    message.textContent = saveFailureMessage(active.error);
    message.title = active.error?.message || "Could not save this rule";
    hideButton.hidden = true;
    allowButton.textContent = "Show";
    clearHighlight();
  } else if (active.state === "saving") {
    message.textContent = `${label} hidden · saving…`;
    message.title = "Waiting for settings storage confirmation";
    hideButton.hidden = true;
    allowButton.textContent = "Show";
    clearHighlight();
  } else if (active.state === "hidden") {
    const hiddenCount = active.candidate.hiddenCount || 1;
    message.textContent = isSavedRuleSummary
      ? `${hiddenCount} element${hiddenCount === 1 ? "" : "s"} hidden`
      : `${label} hidden · saved`;
    message.title = isSavedRuleSummary
      ? `Hidden by ${active.candidate.savedRuleCount || 1} saved rule${
          active.candidate.savedRuleCount === 1 ? "" : "s"
        }`
      : "Hidden by your saved rule";
    hideButton.hidden = true;
    allowButton.textContent = isSavedRuleSummary ? "Show all" : "Show";
    clearHighlight();
  } else {
    const confidence = Math.round(active.candidate.decision.confidence * 100);
    message.textContent = `${label} · ${confidence}%`;
    message.title =
      active.candidate.decision.reasons?.join(", ") || "Heuristic DOM signals";
    hideButton.hidden = false;
    hideButton.textContent = "Hide";
    allowButton.textContent = "Keep";
    highlightCandidate(active.candidate);
  }
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
    <span class="adsfriendly-dom-scope">ELEMENT</span>
    <span class="adsfriendly-dom-message"></span>
    <button class="adsfriendly-dom-hide" type="button">Hide</button>
    <button class="adsfriendly-dom-allow" type="button">Keep</button>
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
      max-width: min(390px, calc(100vw - 32px));
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
    #${HIGHLIGHT_ID} {
      position: fixed;
      z-index: 2147483646;
      pointer-events: none;
      box-sizing: border-box;
      border: 3px solid var(--adsfriendly-highlight-color, #f59e0b);
      border-radius: 4px;
      box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.72),
        0 0 16px var(--adsfriendly-highlight-color, #f59e0b);
    }
  `;

  toast.querySelector(".adsfriendly-dom-hide").onclick = () => {
    if (!active || active.state !== "review") return;
    const current = active;
    current.state = "saving";
    clearHighlight();
    renderActiveToast();
    current.pendingHide = Promise.resolve(
      current.handlers?.onHide?.(current.candidate),
    )
      .then(() => {
        current.state = "hidden";
        if (active === current) renderActiveToast();
        return true;
      })
      .catch((error) => {
        current.error = error;
        current.state = "error";
        if (active === current) renderActiveToast();
        return false;
      });
  };
  toast.querySelector(".adsfriendly-dom-allow").onclick = () => {
    if (!active) return;
    const current = active;
    const handler = ["saving", "hidden", "error"].includes(current.state)
      ? current.handlers?.onShow
      : current.handlers?.onAllow;
    Promise.resolve(current.pendingHide)
      .then(() => handler?.(current.candidate))
      .catch(() => {});
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

function saveFailureMessage(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (/quota|storage is full|bytes/.test(message))
    return "Hidden once · storage full";
  if (
    /invalidated|receiving end|message port|could not establish/.test(message)
  )
    return "Hidden once · reload extension";
  if (/ignored|outdated|could not save settings/.test(message))
    return "Hidden once · background outdated";
  return "Hidden once · save failed";
}

function highlightCandidate(candidate) {
  clearHighlight();
  const target = candidate.target || candidate.element;
  if (!target?.isConnected) return;
  const highlight = document.createElement("div");
  highlight.id = HIGHLIGHT_ID;
  highlight.style.setProperty(
    "--adsfriendly-highlight-color",
    highlightColor(candidate.decision.confidence),
  );
  (document.body || document.documentElement).appendChild(highlight);

  const update = () => {
    if (!active || !target.isConnected || !highlight.isConnected) return;
    if (isHiddenByAdsFriendly(target)) {
      hideDomToast();
      return;
    }
    const rect = target.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    highlight.style.left = `${left}px`;
    highlight.style.top = `${top}px`;
    highlight.style.width = `${Math.max(0, right - left)}px`;
    highlight.style.height = `${Math.max(0, bottom - top)}px`;
    highlight.hidden = right <= left || bottom <= top;
    highlightFrame = requestAnimationFrame(update);
  };
  update();
}

function isEntryReviewable(entry) {
  if (entry.state !== "review") return true;
  const target = entry.candidate.target || entry.candidate.element;
  if (!target?.isConnected || isHiddenByAdsFriendly(target)) return false;
  const rect = target.getBoundingClientRect();
  const style = getComputedStyle(target);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number.parseFloat(style.opacity || "1") > 0.05
  );
}

function highlightColor(confidence) {
  if (confidence >= 0.9) return "#ef4444";
  if (confidence >= 0.75) return "#f59e0b";
  return "#eab308";
}

function clearHighlight() {
  if (highlightFrame) cancelAnimationFrame(highlightFrame);
  highlightFrame = null;
  document.getElementById(HIGHLIGHT_ID)?.remove();
}

function scheduleHide() {
  pauseHide();
  if (active) {
    const timeout =
      active.state === "hidden" ? HIDDEN_TOAST_TIMEOUT_MS : TOAST_TIMEOUT_MS;
    hideTimer = setTimeout(hideDomToast, timeout);
  }
}

function pauseHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
}

function hideDomToast() {
  const toast = document.getElementById(TOAST_ID);
  if (toast) toast.classList.add("adsfriendly-dom-hidden");
  pauseHide();
  clearHighlight();
  active = null;
  const next = queuedCandidates.shift();
  if (next) setTimeout(() => enqueueOrShow(next), 180);
}
