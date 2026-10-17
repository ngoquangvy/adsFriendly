(function () {
  var consent = document.getElementById("dns-consent");
  var button = document.getElementById("export-dns");
  var status = document.getElementById("dns-status");
  var pending = false;
  function render() {
    button.disabled = pending || !consent.checked;
  }
  consent.addEventListener("change", render);
  window.handleDNSResult = function (result) {
    pending = false;
    status.textContent = result.message;
    status.className = result.kind === "error" ? "error" : "";
    render();
  };
  button.addEventListener("click", function () {
    if (!consent.checked || pending) return;
    try {
      var endpoint = document.getElementById("dns-endpoint").value.trim(),
        url = new URL(endpoint);
      if (url.protocol !== "https:" || url.username || url.password || url.hash)
        throw new Error(
          "Dùng endpoint HTTPS không chứa tài khoản hoặc fragment.",
        );
      if (!window.webkit?.messageHandlers?.controller)
        throw new Error("Mở trang này trong app AdsFriendly để tạo profile.");
      pending = true;
      render();
      status.textContent = "Đang tạo profile — chưa thay đổi DNS hệ thống.";
      window.webkit.messageHandlers.controller.postMessage({
        action: "exportDNSProfile",
        endpoint,
        consent: true,
      });
    } catch (error) {
      window.handleDNSResult({ kind: "error", message: error.message });
    }
  });
  document.getElementById("dns-guide").addEventListener("click", function () {
    if (window.webkit?.messageHandlers?.controller)
      window.webkit.messageHandlers.controller.postMessage({
        action: "dnsGuide",
      });
  });
  render();
})();
