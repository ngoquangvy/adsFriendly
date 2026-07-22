var bgApi = (typeof browser !== 'undefined') ? browser : chrome;

function notifyPopupRulesUpdated() {
  bgApi.tabs.query({}, function(tabs) {
    if (!tabs) return;
    tabs.forEach(function(tab) {
      if (!tab.id) return;
      bgApi.tabs.sendMessage(tab.id, { action: "popup_rules_updated" }, function() {});
    });
  });
}

bgApi.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "log_ad_event" && request.event) {
    bgRecordAdEvent(request.event);
  }

  if (request.action === "open_tabs" && request.urls) {
    request.urls.forEach(function(url) {
      bgApi.tabs.create({ url: url, active: false });
    });
  }

  if (request.action === "restore_tabs" && request.urls) {
    request.urls.forEach(function(url) {
      bgRememberAllowedPopup(url, function() {
        bgRecordAdEvent({
          unit: "feedback",
          label: "false_positive",
          label_source: "user_restore",
          ad_type: "popup",
          targetUrl: url,
          action: "restore",
          outcome: "user_allowed_popup",
          surface: "restore_toast"
        });
        notifyPopupRulesUpdated();
        bgApi.tabs.create({ url: url, active: true });
      });
    });
  }

  if (request.action === "block_tabs" && request.urls) {
    request.urls.forEach(function(url) {
      bgRecordAdEvent({
        unit: "feedback",
        label: "ad",
        label_source: "user_block",
        ad_type: "popup",
        targetUrl: url,
        action: "block",
        outcome: "user_blocked_popup",
        surface: "restore_toast"
      });
      bgRememberBlockedPopup(url, notifyPopupRulesUpdated);
    });
  }

  if (request.action === "get_popup_rules") {
    sendResponse(bgGetPopupRules());
  }

  if (request.action === "flush_telemetry") {
    bgFlushTelemetry();
  }
});

console.log("[AdsFriendly BG] Service Worker da khoi dong.");
