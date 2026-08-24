var bgApi = typeof browser !== "undefined" ? browser : chrome;

function notifyPopupRulesUpdated() {
  bgApi.tabs.query({}, function (tabs) {
    if (!tabs) return;
    tabs.forEach(function (tab) {
      if (!tab.id) return;
      bgApi.tabs.sendMessage(
        tab.id,
        { action: "popup_rules_updated" },
        function () {},
      );
    });
  });
}

bgApi.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "log_ad_event" && request.event) {
    bgRecordAdEvent(request.event);
    if (request.event.label === "ad" && ["hide", "block", "disable"].indexOf(request.event.action) >= 0) {
      var evidence = request.event.evidence || {};
      bgRecordBlock(request.event.pageUrl || request.event.sourceUrl || request.event.targetUrl, request.event.ad_type || "popup", evidence.count || 1);
    }
  }

  if (request.action === "open_once" && request.url) {
    if (typeof bgAllowPopupOnce === "function") bgAllowPopupOnce(request.url);
    bgRecordAdEvent({
      unit: "feedback",
      label: "content",
      label_source: "user_open_once",
      ad_type: "popup",
      targetUrl: request.url,
      action: "open_once",
      outcome: "user_opened_without_changing_rule",
      surface: "blocked_toast"
    });
    bgApi.tabs.create({ url: request.url, active: true });
  }

  if (request.action === "allow_popups" && request.urls) {
    request.urls.forEach(function (url) {
      var hostname = bgGetPopupHostKey(url);
      bgSetSitePolicy(hostname, "allow", function () {
        bgRecordAdEvent({
          unit: "feedback",
          label: "false_positive",
          label_source: "user_allow",
          ad_type: "popup",
          targetUrl: url,
          action: "allow",
          outcome: "remembered_without_opening_tab",
          surface: "decision_toast",
          feedback: {
            user_action: "allow",
            correction: "false_positive",
            surface: "decision_toast",
          },
        });
        notifyPopupRulesUpdated();
      });
    });
  }

  if (request.action === "block_popups" && request.urls) {
    request.urls.forEach(function (url) {
      bgRecordAdEvent({
        unit: "feedback",
        label: "ad",
        label_source: "user_block",
        ad_type: "popup",
        targetUrl: url,
        action: "block",
        outcome: "user_blocked_popup",
        surface: "decision_toast",
        feedback: {
          user_action: "block",
          surface: "decision_toast",
        },
      });
      bgSetSitePolicy(bgGetPopupHostKey(url), "block", function () {
        notifyPopupRulesUpdated();
      });
    });
  }

  if (request.action === "get_popup_rules") {
    sendResponse(bgGetPopupRules());
  }

  if (request.action === "flush_telemetry") {
    bgFlushTelemetry();
  }

  if (request.action === "get_popup_state") {
    var hostname = AFSettingsPackage.normalizeHost(request.hostname);
    bgGetRuntimeSnapshot(function (snapshot) {
      sendResponse({
        hostname: hostname,
        policy: bgGetSitePolicy(hostname),
        appSettings: snapshot.appSettings,
        blockedCount: snapshot.blockedCount || 0,
        siteBlockedCount: (snapshot.afsBlockedByHost[hostname] || {}).total || 0,
        packageState: snapshot.settingsPackageState || null
      });
    });
    return true;
  }

  if (request.action === "set_site_policy") {
    bgSetSitePolicy(request.hostname, request.policy, function (error, policy) {
      if (!error) notifyPopupRulesUpdated();
      sendResponse(error ? { error: error.message } : { status: "saved", policy: policy });
    });
    return true;
  }

  if (request.action === "set_app_settings") {
    bgSetAppSettings(request.settings, function (error, settings) {
      sendResponse(error ? { error: error.message } : { status: "saved", settings: settings });
    });
    return true;
  }

  if (request.action === "reset_blocked_count") {
    bgApi.storage.local.set({ blockedCount: 0, afsBlockedByHost: {} }, function () {
      sendResponse({ status: "saved" });
    });
    return true;
  }

  if (request.action === "save_dom_decision") {
    var domHost = AFSettingsPackage.normalizeHost(request.hostname);
    var domSelector = String(request.selector || "").trim().slice(0, 500);
    var domLayout = ["compact", "wide"].indexOf(request.layout) >= 0 ? request.layout : "any";
    var broad = ["*", "html", "body", "head", "header", "nav", "main", "form", "div", "span", "p", "a", "img", "section", "iframe", "video"];
    if (!domHost || !domSelector || broad.indexOf(domSelector.toLowerCase()) >= 0 || domSelector.indexOf(":has(") >= 0) {
      sendResponse({ error: "Unsafe DOM selector." });
      return false;
    }
    bgApi.storage.local.get(["userCustomRules", "afsAllowedDomSelectors"], function(snapshot) {
      var custom = snapshot.userCustomRules || {};
      var allowed = snapshot.afsAllowedDomSelectors || {};
      var rules = (custom[domHost] || []).filter(function(rule) {
        return (typeof rule === "string" ? rule : rule.selector) !== domSelector;
      });
      var allowedRules = (allowed[domHost] || []).filter(function(rule) {
        return !(rule.selector === domSelector && rule.layout === domLayout);
      });
      if (request.decision === "hide") {
        rules.push({ selector: domSelector, confidence: 1, source: "ios_banner_review", layout: domLayout });
      } else if (request.decision === "show") {
        allowedRules.push({ selector: domSelector, layout: domLayout, savedAt: Date.now() });
      } else {
        sendResponse({ error: "Invalid DOM decision." });
        return;
      }
      if (rules.length) custom[domHost] = rules.slice(-250); else delete custom[domHost];
      if (allowedRules.length) allowed[domHost] = allowedRules.slice(-250); else delete allowed[domHost];
      bgApi.storage.local.set({ userCustomRules: custom, afsAllowedDomSelectors: allowed }, function() {
        sendResponse({ status: "saved", decision: request.decision });
      });
    });
    return true;
  }
});

console.log("[AdsFriendly BG] Service Worker da khoi dong.");
