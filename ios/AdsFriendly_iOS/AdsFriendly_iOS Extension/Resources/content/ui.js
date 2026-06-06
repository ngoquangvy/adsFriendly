var blockedUrls = [];
var hideTimeout = null;
var container = null;

function createUI() {
  if (container) return;

  container = document.createElement("div");
  container.id = "adsfriendly-popup-container";
  container.className = "adsfriendly-hidden";

  var messageSpan = document.createElement("span");
  messageSpan.className = "adsfriendly-message";

  var openBtn = document.createElement("button");
  openBtn.className = "adsfriendly-btn";
  openBtn.innerText = "Mo";
  openBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    openAllBlocked();
  });

  var closeBtn = document.createElement("button");
  closeBtn.className = "adsfriendly-btn close";
  closeBtn.innerText = "Bo qua";
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
  var fullMsg = "";

  if (blockedUrls.length === 1) {
    try {
      var hostname = new URL(blockedUrls[0]).hostname;
      fullMsg = "Da chan " + truncateHostname(hostname, 24);
    } catch(e) {
      fullMsg = "Da chan 1 popup";
    }
  } else {
    fullMsg = "Da chan " + blockedUrls.length + " popup";
  }

  messageSpan.innerText = fullMsg;
  messageSpan.title = fullMsg;
  container.classList.remove("adsfriendly-hidden");

  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(hideUI, 5000);
}

function hideUI() {
  if (container) {
    container.classList.add("adsfriendly-hidden");
  }
  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = null;
  blockedUrls = [];
}

function openAllBlocked() {
  if (blockedUrls.length > 0) {
    api.runtime.sendMessage({ action: "open_tabs", urls: blockedUrls });
  }
  hideUI();
}

function notifyBlocked(url) {
  if (!url) return;
  if (!blockedUrls.includes(url)) {
    blockedUrls.push(url);
  }
  updateUI();
}
