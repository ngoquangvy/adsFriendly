(function () {
  var consent = document.getElementById("dns-consent");
  var button = document.getElementById("export-dns");
  var install = document.getElementById("install-dns");
  var custom = document.getElementById("install-custom-dns");
  var status = document.getElementById("dns-status");
  var pending = false;
  function render() {
    [button, install, custom].forEach(function (node) {
      node.disabled = pending || !consent.checked;
    });
  }
  consent.addEventListener("change", render);
  window.handleDNSResult = function (result) {
    pending = false;
    status.textContent = result.message;
    status.className = result.kind === "error" ? "error" : "";
    render();
  };
  window.handleDNSPreferences = function (preferences) {
    if (
      typeof preferences?.endpoint === "string" &&
      preferences.endpoint.length <= 2048
    )
      document.getElementById("dns-endpoint").value = preferences.endpoint;
  };
  function request(action, usesCustomEndpoint) {
    if (!consent.checked || pending) return;
    try {
      var endpoint;
      if (usesCustomEndpoint) {
        endpoint = document.getElementById("dns-endpoint").value.trim();
        var url = new URL(endpoint);
        if (
          url.protocol !== "https:" ||
          !url.hostname ||
          url.username ||
          url.password ||
          url.hash
        )
          throw new Error(
            "Dùng endpoint HTTPS không chứa tài khoản hoặc fragment.",
          );
      }
      if (!window.webkit?.messageHandlers?.controller)
        throw new Error("Mở trang này trong app AdsFriendly để tạo profile.");
      pending = true;
      render();
      status.textContent =
        action === "exportDNSProfile"
          ? "Đang xuất file dự phòng — chưa thay đổi DNS hệ thống."
          : "Đang chuẩn bị profile cho trình duyệt — chưa thay đổi DNS hệ thống.";
      var message = { action, consent: true };
      if (usesCustomEndpoint) message.endpoint = endpoint;
      window.webkit.messageHandlers.controller.postMessage(message);
    } catch (error) {
      window.handleDNSResult({ kind: "error", message: error.message });
    }
  }
  button.addEventListener("click", function () {
    request("exportDNSProfile", true);
  });
  install.addEventListener("click", function () {
    request("installDefaultDNSProfile", false);
  });
  custom.addEventListener("click", function () {
    request("installCustomDNSProfile", true);
  });
  document.getElementById("dns-guide").addEventListener("click", function () {
    if (window.webkit?.messageHandlers?.controller)
      window.webkit.messageHandlers.controller.postMessage({
        action: "dnsGuide",
      });
  });
  render();
})();
