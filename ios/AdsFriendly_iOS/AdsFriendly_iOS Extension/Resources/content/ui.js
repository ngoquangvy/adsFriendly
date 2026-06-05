// ============================================================
// ui.js - Giao diện thông báo popup bị chặn
// Hiển thị thanh thông báo dưới đáy, tự ẩn sau 5s, gộp thông báo
// ============================================================

let blockedUrls = [];
let hideTimeout = null;
let container = null;

function createUI() {
  if (container) return;

  container = document.createElement("div");
  container.id = "adsfriendly-popup-container";
  container.className = "adsfriendly-hidden";

  const messageSpan = document.createElement("span");
  messageSpan.className = "adsfriendly-message";
  
  const openBtn = document.createElement("button");
  openBtn.className = "adsfriendly-btn";
  openBtn.innerText = "Mở";
  openBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    openAllBlocked();
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "adsfriendly-btn close";
  closeBtn.innerText = "Bỏ qua";
  closeBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    hideUI();
  });

  container.appendChild(messageSpan);
  container.appendChild(openBtn);
  container.appendChild(closeBtn);

  // Chờ body sẵn sàng mới thêm vào
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

function updateUI() {
  if (!container) createUI();
  if (!container) return; // Phòng trường hợp body chưa sẵn sàng

  // Đảm bảo container đã nằm trong DOM
  if (!container.parentNode) {
    if (document.body) {
      document.body.appendChild(container);
    } else {
      return;
    }
  }
  
  const messageSpan = container.querySelector(".adsfriendly-message");
  
  if (blockedUrls.length === 1) {
    try {
      const hostname = new URL(blockedUrls[0]).hostname;
      messageSpan.innerText = "🛡 Đã chặn popup từ " + hostname;
    } catch(e) {
      messageSpan.innerText = "🛡 Đã chặn 1 popup";
    }
  } else {
    messageSpan.innerText = "🛡 Đã chặn " + blockedUrls.length + " popup ẩn";
  }

  container.classList.remove("adsfriendly-hidden");

  // Đặt lại đếm ngược 5 giây
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
    // Gửi lệnh cho Background Script mở các tab
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
