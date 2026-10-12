(function () {
  var queue = AFShared.createReviewQueue(),
    host = null,
    shadow = null,
    timeout = null,
    busy = false;
  var recentlyClosed = new Map();
  var bannerReviews = AFShared.createBannerReviewGate();
  var reviewCleanup = null;
  function createUI() {
    if (host?.isConnected) return true;
    if (!document.body) return false;
    host = document.createElement("div");
    host.id = "adsfriendly-popup-container";
    host.setAttribute("data-afs-ui", "true");
    host.style.cssText =
      "all:initial!important;position:fixed!important;inset:auto 12px calc(12px + env(safe-area-inset-bottom)) 12px!important;z-index:2147483647!important;pointer-events:none!important;";
    shadow = host.attachShadow({ mode: "closed" });
    var style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: dark; }
      .card {
        box-sizing: border-box; width: max-content; max-width: min(440px, 100%);
        margin: auto; padding: 4px 4px 4px 12px; display: grid;
        grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center;
        background: #172235f5; color: #f1f5f9; border: 1px solid #ffffff20;
        border-radius: 14px; box-shadow: 0 4px 16px #0003; pointer-events: auto;
        font: 13px -apple-system, BlinkMacSystemFont, sans-serif;
      }
      .message {
        min-width: 0; max-width: 220px; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .actions { display: flex; gap: 3px; align-items: center; }
      button {
        box-sizing: border-box; min-height: 44px; min-width: 44px; padding: 6px 9px;
        border: 0; border-radius: 10px; color: #e2e8f0; background: #ffffff0d;
        font: inherit; font-weight: 600; white-space: nowrap; cursor: pointer;
      }
      button:first-child { background: #2563eb; color: #fff; }
      button.close {
        padding: 0; color: #94a3b8; background: transparent;
        font-size: 20px; font-weight: 400;
      }
      button:focus-visible { outline: 2px solid #93c5fd; outline-offset: -2px; }
      button:disabled { opacity: .5; }
      .error {
        grid-column: 1/-1; max-width: 100%; padding: 2px 4px 6px 0;
        color: #ffbbad; overflow-wrap: anywhere;
      }
      [hidden] { display: none !important; }
    `;
    shadow.appendChild(style);
    document.body.appendChild(host);
    return true;
  }
  function next() {
    if (busy || (queue.active && host?.isConnected)) return;
    var item = queue.take();
    if (!item) {
      if (host) host.remove();
      return;
    }
    if (item.element && !item.element.isConnected) {
      queue.finish();
      next();
      return;
    }
    if (item.banner && !item.isValid()) {
      queue.finish();
      next();
      return;
    }
    if (!createUI()) return;
    var previous = shadow.querySelector(".card");
    if (previous) previous.remove();
    var card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");
    var text = document.createElement("span");
    text.className = "message";
    text.textContent = item.message;
    text.title = item.message;
    card.appendChild(text);
    var actions = document.createElement("div");
    actions.className = "actions";
    var failure = document.createElement("span");
    failure.className = "error";
    failure.hidden = true;
    item.actions.forEach(function (action) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      if (action.description)
        button.setAttribute("aria-label", action.description);
      button.addEventListener("click", async function () {
        if (item.banner && !item.isValid()) {
          finish();
          return;
        }
        clearTimeout(timeout);
        busy = true;
        card.querySelectorAll("button").forEach((value) => {
          value.disabled = true;
        });
        try {
          if (item.banner) text.textContent = "Saving choice…";
          await action.run();
          finish();
        } catch (error) {
          busy = false;
          if (item.banner && !item.isValid()) {
            finish();
            return;
          }
          text.textContent = item.message;
          failure.textContent = error.message || "Could not save. Try again.";
          failure.hidden = false;
          card.querySelectorAll("button").forEach((value) => {
            value.disabled = false;
          });
        }
      });
      actions.appendChild(button);
    });
    var close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss");
    close.onclick = finish;
    actions.appendChild(close);
    card.appendChild(actions);
    card.appendChild(failure);
    shadow.appendChild(card);
    if (item.banner)
      reviewCleanup = AFShared.watchReviewTarget(item.element, {
        identity: item.identity,
        isValid: item.isValid,
        onInvalid: function () {
          if (!busy) finish();
        },
      });
    clearTimeout(timeout);
    timeout = setTimeout(
      finish,
      item.banner ? 8000 : item.remembered ? 6000 : 15000,
    );
  }
  function finish() {
    clearTimeout(timeout);
    if (reviewCleanup) reviewCleanup();
    reviewCleanup = null;
    busy = false;
    var item = queue.finish();
    if (item) {
      recentlyClosed.set(item.key, Date.now());
      if (item.dismiss) item.dismiss();
    }
    while (recentlyClosed.size > 100)
      recentlyClosed.delete(recentlyClosed.keys().next().value);
    next();
  }
  async function send(message) {
    var result = await AFShared.callApi(api.runtime, "sendMessage", message);
    if (!result || result.error)
      throw new Error(
        result?.error || "The extension did not respond. Try again.",
      );
    return result;
  }
  function enqueue(item) {
    if (Date.now() - (recentlyClosed.get(item.key) || 0) < 6000) return false;
    var accepted = queue.enqueue(item);
    if (accepted) next();
    return accepted;
  }
  window.notifyBlocked = function (url, remembered) {
    if (!AFShared.httpUrl(url)) return;
    if (window.top !== window) {
      api.runtime.sendMessage(
        { action: "frame_popup_blocked", url, remembered: remembered === true },
        function () {},
      );
      return;
    }
    var hostname = new URL(url).hostname;
    enqueue({
      key: "popup:" + hostname,
      remembered,
      message: (remembered ? "Blocked " : "Popup from ") + hostname,
      actions: remembered
        ? [
            {
              label: "Open once",
              run: () => send({ action: "open_once", url }),
            },
          ]
        : [
            {
              label: "Allow",
              run: () => send({ action: "allow_popups", urls: [url] }),
            },
            {
              label: "Block",
              run: () => send({ action: "block_popups", urls: [url] }),
            },
          ],
    });
  };
  window.notifyBannerCandidate = function (element, reason, handlers) {
    if (window.top !== window || !AFShared.isReviewTarget(element))
      return false;
    // Never queue a train of speculative banners behind a navigation review.
    // A future scan may retry, but only while the UI is idle and within budget.
    if (busy || queue.size) return false;
    var selector = handlers.selector || AFShared.buildDomSelector(element);
    if (!selector) return false;
    var key =
      "banner:" +
      getResponsiveLayout() +
      ":" +
      (handlers.reviewKey || selector);
    if (!bannerReviews.canPrompt(key, element)) return false;
    var identity = AFShared.reviewTargetIdentity(element);
    var accepted = enqueue({
      key,
      element,
      banner: true,
      identity,
      isValid: function () {
        return (
          AFShared.isReviewTarget(element) &&
          AFShared.reviewTargetIdentity(element) === identity &&
          (!handlers.isValid || handlers.isValid())
        );
      },
      message: "Marked area?",
      actions: [
        { label: "Hide", run: handlers.hide },
        {
          label: "Keep",
          description: "Keep / show this banner",
          run: handlers.show,
        },
      ],
      dismiss: handlers.dismiss,
    });
    if (accepted) bannerReviews.record(key, element);
    return accepted;
  };
  document.addEventListener("DOMContentLoaded", next, { once: true });
})();
