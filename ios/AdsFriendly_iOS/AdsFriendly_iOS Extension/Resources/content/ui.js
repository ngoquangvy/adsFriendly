var blockedUrls = [];
var hideTimeout = null;
var container = null;
var _throttleTimer = null;
var rememberedBlock = false;
var bannerReview = null;

function createUI() {
  if (container) return;

  container = document.createElement("div");
  container.id = "adsfriendly-popup-container";
  container.className = "adsfriendly-hidden";

  var messageSpan = document.createElement("span");
  messageSpan.className = "adsfriendly-message";

  var openBtn = document.createElement("button");
  openBtn.className = "adsfriendly-btn adsfriendly-primary";
  openBtn.innerText = "Allow";
  openBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    runPrimaryAction();
  });

  var blockBtn = document.createElement("button");
  blockBtn.className = "adsfriendly-btn adsfriendly-danger";
  blockBtn.innerText = "Block";
  blockBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    rememberBlocked();
  });

  var closeBtn = document.createElement("button");
  closeBtn.className = "adsfriendly-btn close";
  closeBtn.innerText = "\u2715";
  closeBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    hideUI();
  });

  container.appendChild(messageSpan);
  container.appendChild(openBtn);
  container.appendChild(blockBtn);
  container.appendChild(closeBtn);

  function appendToBody() {
    if (document.body) {
      document.body.appendChild(container);
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        document.body.appendChild(container);
      });
    }
  }
  appendToBody();
}

function truncateHostname(hostname, maxLen) {
  if (hostname.length <= maxLen) return hostname;
  return hostname.substring(0, maxLen - 3) + "...";
}

function updateUI() {
  if (!container) createUI();
  if (!container) return;

  if (!container.parentNode) {
    if (document.body) {
      document.body.appendChild(container);
    } else {
      return;
    }
  }

  var messageSpan = container.querySelector(".adsfriendly-message");
  var primaryBtn = container.querySelector(".adsfriendly-primary");
  var blockBtn = container.querySelector(".adsfriendly-danger");
  var fullMsg = "";

  if (rememberedBlock && blockedUrls.length === 1) {
    try {
      var hostname = new URL(blockedUrls[0]).hostname;
      fullMsg = "Blocked " + truncateHostname(hostname, 20);
    } catch(e) {
      fullMsg = "Blocked popup";
    }
    primaryBtn.innerText = "Open once";
    blockBtn.style.display = "none";
  } else if (blockedUrls.length === 1) {
    try {
      var candidateHost = new URL(blockedUrls[0]).hostname;
      fullMsg = "Popup from " + truncateHostname(candidateHost, 20);
    } catch(e) {
      fullMsg = "Allow this popup source?";
    }
    primaryBtn.innerText = "Allow";
    blockBtn.style.display = "inline-block";
  } else {
    fullMsg = blockedUrls.length + " popup requests";
    primaryBtn.innerText = "Allow";
    blockBtn.style.display = "inline-block";
  }

  messageSpan.innerText = fullMsg;
  messageSpan.title = fullMsg;
  container.classList.remove("adsfriendly-hidden");

  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(hideUI, rememberedBlock ? 5000 : 8000);
}

function hideUI() {
  if (container) {
    container.classList.add("adsfriendly-hidden");
  }
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = null;
  blockedUrls = [];
  rememberedBlock = false;
}

function runPrimaryAction() {
  if (rememberedBlock && blockedUrls.length === 1) {
    api.runtime.sendMessage({ action: "open_once", url: blockedUrls[0] });
  } else if (blockedUrls.length > 0) {
    api.runtime.sendMessage({
      action: "allow_popups",
      urls: blockedUrls
    });
  }
  hideUI();
}

function rememberBlocked() {
  if (blockedUrls.length > 0) {
    api.runtime.sendMessage({ action: "block_popups", urls: blockedUrls });
  }
  hideUI();
}

function notifyBlocked(url, wasRemembered) {
  if (!url) return;
  rememberedBlock = wasRemembered === true;
  if (!blockedUrls.includes(url)) {
    blockedUrls.push(url);
  }
  if (_throttleTimer) return;
  _throttleTimer = setTimeout(function() {
    _throttleTimer = null;
    updateUI();
  }, 500);
  updateUI();
}

function notifyBannerCandidate(element, reason, handlers) {
  if (bannerReview || !element || !document.body) return false;
  handlers = handlers || {};
  var review = document.createElement("div");
  review.id = "adsfriendly-banner-review";
  review.innerHTML = '<span class="adsfriendly-message">Possible banner ad</span>' +
    '<button class="adsfriendly-btn adsfriendly-primary" type="button">Hide</button>' +
    '<button class="adsfriendly-btn adsfriendly-show" type="button">Keep</button>' +
    '<button class="adsfriendly-btn close" type="button">\u2715</button>';
  review.title = reason || "Suspected banner";
  document.body.appendChild(review);
  bannerReview = review;
  var previousOutline = element.style.getPropertyValue("outline");
  var previousOutlinePriority = element.style.getPropertyPriority("outline");
  var previousOutlineOffset = element.style.getPropertyValue("outline-offset");
  var previousOutlineOffsetPriority = element.style.getPropertyPriority("outline-offset");
  element.style.setProperty("outline", "2px solid #f59e0b", "important");
  element.style.setProperty("outline-offset", "-2px", "important");

  function restoreOutline() {
    if (previousOutline) element.style.setProperty("outline", previousOutline, previousOutlinePriority);
    else element.style.removeProperty("outline");
    if (previousOutlineOffset) element.style.setProperty("outline-offset", previousOutlineOffset, previousOutlineOffsetPriority);
    else element.style.removeProperty("outline-offset");
  }

  function finish(action) {
    if (!bannerReview) return;
    bannerReview.remove();
    bannerReview = null;
    restoreOutline();
    if (action === "hide" && handlers.hide) handlers.hide();
    else if (action === "show" && handlers.show) handlers.show();
    else if (handlers.dismiss) handlers.dismiss();
  }

  review.querySelector(".adsfriendly-primary").onclick = function() { finish("hide"); };
  review.querySelector(".adsfriendly-show").onclick = function() { finish("show"); };
  review.querySelector(".close").onclick = function() { finish("dismiss"); };
  setTimeout(function() { if (bannerReview === review) finish("dismiss"); }, 8000);
  return true;
}
