(function () {
  var queue = AFShared.createReviewQueue(),
    host = null,
    shadow = null,
    timeout = null,
    busy = false;
  var recentlyClosed = new Map();
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
    style.textContent =
      ":host{color-scheme:dark} .card{box-sizing:border-box;max-width:480px;margin:auto;padding:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#162033;color:#fff;border:1px solid #4b5973;border-radius:14px;box-shadow:0 4px 20px #0005;pointer-events:auto;font:14px -apple-system,BlinkMacSystemFont,sans-serif} .message{flex:1 1 140px;overflow-wrap:anywhere} button{min-height:44px;padding:8px 12px;border:0;border-radius:8px;color:#fff;background:#28598e;font:inherit} button:last-child{background:transparent} button:disabled{opacity:.5} .error{flex-basis:100%;color:#ffbbad} [hidden]{display:none!important}";
    shadow.appendChild(style);
    document.body.appendChild(host);
    return true;
  }
  function next() {
    if (busy) return;
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
    card.appendChild(text);
    var failure = document.createElement("span");
    failure.className = "error";
    failure.hidden = true;
    item.actions.forEach(function (action) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", async function () {
        clearTimeout(timeout);
        busy = true;
        card.querySelectorAll("button").forEach((value) => {
          value.disabled = true;
        });
        try {
          await action.run();
          finish();
        } catch (error) {
          busy = false;
          failure.textContent = error.message || "Could not save. Try again.";
          failure.hidden = false;
          card.querySelectorAll("button").forEach((value) => {
            value.disabled = false;
          });
        }
      });
      card.appendChild(button);
    });
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss");
    close.onclick = finish;
    card.appendChild(close);
    card.appendChild(failure);
    shadow.appendChild(card);
    clearTimeout(timeout);
    timeout = setTimeout(finish, item.remembered ? 6000 : 15000);
  }
  function finish() {
    clearTimeout(timeout);
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
    if (window.top !== window || !element) return false;
    return enqueue({
      key: element,
      element,
      message: "Possible banner ad",
      actions: [
        { label: "Hide", run: handlers.hide },
        { label: "Keep / Show", run: handlers.show },
      ],
      dismiss: handlers.dismiss,
    });
  };
  document.addEventListener("DOMContentLoaded", next, { once: true });
})();
