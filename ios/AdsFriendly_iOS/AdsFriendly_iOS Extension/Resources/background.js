var bgApi = typeof browser !== "undefined" ? browser : chrome;
function notifyPopupRulesUpdated() {
  bgApi.tabs.query({}, function (tabs) {
    (tabs || []).forEach(function (tab) {
      if (typeof tab.id === "number")
        bgApi.tabs.sendMessage(
          tab.id,
          { action: "popup_rules_updated" },
          function () {},
        );
    });
  });
}
function callbackTask(operation) {
  return new Promise((resolve, reject) =>
    operation((error, value) => (error ? reject(error) : resolve(value))),
  );
}
async function probeContent(tabId) {
  if (!Number.isInteger(tabId)) return {ready: false};
  var timeout;
  try {
    return await Promise.race([
      AFShared.callApi(bgApi.tabs, "sendMessage", tabId, {action: "protection_probe"}, {frameId: 0}),
      new Promise(resolve => { timeout = setTimeout(() => resolve({ready: false}), 750); }),
    ]) || {ready: false};
  } catch (_) { return {ready: false}; }
  finally { clearTimeout(timeout); }
}
function extensionPage(sender) {
  var prefix = bgApi.runtime.getURL("");
  return (
    !!sender.url &&
    sender.url.startsWith(prefix) &&
    !sender.tab?.url?.startsWith("http")
  );
}
bgApi.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  var actions = [
    "log_ad_event",
    "open_once",
    "allow_popups",
    "block_popups",
    "get_popup_rules",
    "flush_telemetry",
    "get_popup_state",
    "set_site_policy",
    "set_app_settings",
    "reset_blocked_count",
    "import_settings_package",
    "undo_settings_import",
    "get_import_state",
    "save_dom_decision",
    "injection_status",
    "get_diagnostics",
    "frame_popup_blocked",
  ];
  if (!request || !actions.includes(request.action)) return false;
  (async function () {
    await window.AFSettingsReady;
    var storage = AFShared.storageAdapter();
    if (request.action === "frame_popup_blocked") {
      if (sender.tab && sender.frameId && AFShared.httpUrl(request.url))
        await AFShared.callApi(
          bgApi.tabs,
          "sendMessage",
          sender.tab.id,
          {
            action: "popup_blocked",
            url: request.url,
            remembered: request.remembered === true,
          },
          { frameId: 0 },
        );
      return {};
    }
    if (
      [
        "import_settings_package",
        "undo_settings_import",
        "get_import_state",
        "get_diagnostics",
        "set_site_policy",
        "set_app_settings",
        "reset_blocked_count",
      ].includes(request.action) &&
      !extensionPage(sender)
    )
      throw new Error("This action is available only in the extension.");
    if (request.action === "log_ad_event") {
      if (!request.event) return {};
      bgRecordAdEvent(request.event);
      if (
        request.event.label === "ad" &&
        ["hide", "block", "disable"].includes(request.event.action)
      )
        bgRecordBlock(
          sender.url || request.event.pageUrl,
          request.event.ad_type || "popup",
          request.event.evidence?.count || 1,
        );
      return {};
    }
    if (request.action === "open_once") {
      if (!AFShared.httpUrl(request.url))
        throw new Error("Only HTTP(S) pages may be opened.");
      var token = bgAllowPopupOnce(request.url);
      try {
        var tab = await AFShared.callApi(bgApi.tabs, "create", {
          url: request.url,
          active: true,
        });
        window.bgBindPopupOnce(token, tab.id);
      } catch (error) {
        bgRevokePopupOnce(token);
        throw error;
      }
      return { status: "opened" };
    }
    if (
      request.action === "allow_popups" ||
      request.action === "block_popups"
    ) {
      if (
        !Array.isArray(request.urls) ||
        request.urls.length !== 1 ||
        !AFShared.httpUrl(request.urls[0])
      )
        throw new Error("Choose one popup destination at a time.");
      var host = new URL(request.urls[0]).hostname;
      await callbackTask((done) =>
        bgSetSitePolicy(
          host,
          request.action === "allow_popups" ? "allow" : "block",
          done,
        ),
      );
      notifyPopupRulesUpdated();
      return { status: "saved" };
    }
    if (request.action === "get_popup_rules") return bgGetPopupRules();
    if (request.action === "flush_telemetry") {
      bgFlushTelemetry();
      return {};
    }
    if (request.action === "get_popup_state") {
      if (window.AFNetworkReady) await window.AFNetworkReady;
      if (window.bgRefreshNetworkRules) await bgRefreshNetworkRules();
      var snapshot = await new Promise((resolve) =>
        bgGetRuntimeSnapshot(resolve),
      );
      if (snapshot.error) throw new Error(snapshot.error);
      var hostname = AFSettingsPackage.normalizeHost(request.hostname);
      return {
        hostname,
        policy: bgGetSitePolicy(hostname),
        appSettings: snapshot.appSettings,
        blockedCount: snapshot.blockedCount || 0,
        siteBlockedCount: snapshot.afsBlockedByHost[hostname]?.total || 0,
        packageState: snapshot.settingsPackageState || null,
        network: window.bgGetNetworkState ? bgGetNetworkState() : {state: "unavailable"},
        content: extensionPage(sender) ? await probeContent(request.tabId) : {ready: false},
      };
    }
    if (request.action === "set_site_policy") {
      var policy = await callbackTask((done) =>
        bgSetSitePolicy(request.hostname, request.policy, done),
      );
      notifyPopupRulesUpdated();
      return { status: "saved", policy };
    }
    if (request.action === "set_app_settings") {
      var settings = await callbackTask((done) =>
        bgSetAppSettings(request.settings, done),
      );
      notifyPopupRulesUpdated();
      return { status: "saved", settings };
    }
    if (request.action === "reset_blocked_count") {
      await AFShared.serialMutation(() =>
        storage.set({ blockedCount: 0, afsBlockedByHost: {} }),
      );
      return { status: "saved" };
    }
    if (request.action === "import_settings_package") {
      var summary = await AFShared.importPackage(request.package);
      notifyPopupRulesUpdated();
      return { status: "installed", summary };
    }
    if (request.action === "undo_settings_import") {
      await AFShared.undoImport();
      notifyPopupRulesUpdated();
      return { status: "restored" };
    }
    if (request.action === "get_import_state") {
      var data = await storage.get([
        "afsPackageBackup",
        "settingsPackageState",
      ]);
      return {
        canUndo: !!data.afsPackageBackup?.snapshot,
        state: data.settingsPackageState,
      };
    }
    if (request.action === "injection_status") {
      bgRecordDiagnostic({
        reason: request.ready ? "injection_ready" : "injection_unavailable",
        host: AFShared.httpUrl(sender.url)?.hostname || "",
        frameId: sender.frameId || 0,
      });
      return {};
    }
    if (request.action === "get_diagnostics")
      return {
        events: (await storage.get("afsDiagnostics")).afsDiagnostics || [],
      };
    if (request.action === "save_dom_decision") {
      var domHost = AFShared.httpUrl(sender.url)?.hostname;
      if (
        !domHost ||
        domHost !== AFSettingsPackage.normalizeHost(request.hostname)
      )
        throw new Error("Invalid DOM page.");
      var selector = String(request.selector || "").trim();
      if (!AFShared.safeDomSelector(selector))
        throw new Error("No safe selector to remember. Use ×.");
      var layout = ["compact", "wide"].includes(request.layout)
        ? request.layout
        : "any";
      if (!["hide", "show"].includes(request.decision))
        throw new Error("Invalid DOM decision.");
      var exception = AFShared.createElementException(
        { selector, features: request.features },
        { layout },
      );
      await AFShared.serialMutation(async function () {
        var data = await storage.get([
          "userCustomRules",
          "userElementExceptions",
          "afsAllowedDomSelectors",
        ]);
        var custom = data.userCustomRules || {},
          exceptions = data.userElementExceptions || {};
        var matches = (rule) =>
          (typeof rule === "string" ? rule : rule.selector) === selector &&
          (typeof rule === "string" ||
            !rule.layout ||
            rule.layout === "any" ||
            rule.layout === layout);
        var rules = (custom[domHost] || []).filter((rule) => !matches(rule));
        var keep = (exceptions[domHost] || []).filter((rule) => !matches(rule));
        if (request.decision === "hide")
          rules.push({
            selector,
            layout,
            confidence: 1,
            source: "ios_banner_review",
            fingerprint: exception.fingerprint,
          });
        else keep.push(exception);
        custom[domHost] = rules.slice(-250);
        exceptions[domHost] = keep.slice(-250);
        var legacy = data.afsAllowedDomSelectors || {};
        legacy[domHost] = (legacy[domHost] || []).filter(
          (rule) => !matches(rule),
        );
        var updates = {
          userCustomRules: custom,
          userElementExceptions: exceptions,
          afsAllowedDomSelectors: legacy,
        };
        await storage.set(updates);
        var saved = await storage.get(Object.keys(updates));
        if (!Object.keys(updates).every(key => AFShared.storageValuesEqual(saved[key], updates[key])))
          throw new Error("Storage verification failed for this DOM choice.");
      });
      return { status: "saved", decision: request.decision };
    }
  })().then(
    (result) => sendResponse(result || {}),
    (error) => sendResponse({ error: error.message || String(error) }),
  );
  return true;
});
