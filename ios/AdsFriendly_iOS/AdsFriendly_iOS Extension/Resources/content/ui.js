var blockedUrls = [];
var hideTimeout = null;
var container = null;
var _throttleTimer = null;
var currentMode = "blocked";

function createUI() {
  if (container) return;

  container = document.createElement("div");
  container.id = "adsfriendly-popup-container";
  container.className = "adsfriendly-hidden";

  var messageSpan = document.createElement("span");
  messageSpan.className = "adsfriendly-message";

  var openBtn = document.createElement("button");
  openBtn.className = "adsfriendly-btn adsfriendly-primary";
  openBtn.innerText = "Restore";
  openBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    runPrimaryAction();
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
  var fullMsg = "";

  if (currentMode === "allowed") {
    try {
      var allowedHost = new URL(blockedUrls[0]).hostname;
      fullMsg = "Allowed " + truncateHostname(allowedHost, 20);
    } catch(e) {
      fullMsg = "Allowed popup";
    }
    primaryBtn.innerText = "Block";
  } else if (blockedUrls.length === 1) {
    try {
      var hostname = new URL(blockedUrls[0]).hostname;
      fullMsg = "Blocked " + truncateHostname(hostname, 20);
    } catch(e) {
      fullMsg = "Blocked popup";
    }
    primaryBtn.innerText = "Restore";
  } else {
    fullMsg = "Blocked " + blockedUrls.length + " popups";
    primaryBtn.innerText = "Restore";
  }

  messageSpan.innerText = fullMsg;
  messageSpan.title = fullMsg;
  container.classList.remove("adsfriendly-hidden");

  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(hideUI, 3000);
}

function hideUI() {
  if (container) {
    container.classList.add("adsfriendly-hidden");
  }
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = null;
  blockedUrls = [];
  currentMode = "blocked";
}

function runPrimaryAction() {
  if (blockedUrls.length > 0) {
    api.runtime.sendMessage({
      action: currentMode === "allowed" ? "block_tabs" : "restore_tabs",
      urls: blockedUrls
    });
  }
  hideUI();
}

function notifyBlocked(url) {
  if (!url) return;
  currentMode = "blocked";
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

function notifyAllowed(url) {
  if (!url) return;
  currentMode = "allowed";
  blockedUrls = [url];
  if (_throttleTimer) return;
  _throttleTimer = setTimeout(function() {
    _throttleTimer = null;
    updateUI();
  }, 500);
  updateUI();
}
