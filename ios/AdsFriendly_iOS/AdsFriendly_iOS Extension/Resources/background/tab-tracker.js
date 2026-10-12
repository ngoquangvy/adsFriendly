(function () {
  var api = typeof browser !== "undefined" ? browser : chrome;
  var tracker = AFShared.createNavigationTracker();
  var intents = new Map();
  var evaluations = new Map();
  var latestUrls = new Map();
  window.bgAllowPopupOnce = function (url) {
    return tracker.grantOnce(url);
  };
  window.bgRevokePopupOnce = function (token) {
    tracker.revokeOnce(token);
  };
  window.bgBindPopupOnce = function (token, tabId) {
    tracker.bindOnce(token, tabId);
  };

  async function evaluate(tabId, url) {
    var candidate = tracker.candidate(tabId);
    if (!candidate || latestUrls.get(tabId) !== url || !AFShared.httpUrl(url))
      return;
    var ticket = {};
    evaluations.set(tabId, ticket);
    try {
      await window.AFSettingsReady;
      var source = await AFShared.callApi(
        api.tabs,
        "get",
        candidate.sourceTabId,
      );
      if (!source || !AFShared.httpUrl(source.url)) return;
      var pathKey =
        "p:" + new URL(source.url).hostname + ">" + new URL(url).hostname;
      var paths = await AFShared.storageAdapter().get(pathKey);
      if (
        !tracker.current(tabId, candidate) ||
        evaluations.get(tabId) !== ticket
      )
        return;
      if (tracker.consumeOnce(url, tabId)) {
        tracker.finish(tabId);
        return;
      }
      var decision = AFShared.navigationDecision({
        sourceUrl: source.url,
        targetUrl: url,
        enabled: bgIsProtectionEnabled(),
        sourcePolicy: bgGetSitePolicy(new URL(source.url).hostname),
        blocked: bgIsUserBlockedPopup(url) || bgIsBlacklisted(url),
        allowed:
          bgIsUserAllowedPopup(url) ||
          bgGetSitePolicy(new URL(url).hostname) === "allow",
        knownAd: bgIsAdLikeUrl(url),
        intent: intents.get(candidate.sourceTabId),
        trustedPath: !!paths[pathKey]?.isManual,
      });
      if (decision.action === "allow") {
        // Keep every web-created tab under observation through its redirect chain.
        // An exact click to a safe page is not permission for a later ad redirect.
        return;
      }
      tracker.finish(tabId);
      if (window.bgRecordDiagnostic)
        bgRecordDiagnostic({
          reason: decision.reason,
          action: decision.action,
          host: new URL(url).hostname,
        });
      neutralizeTab(
        tabId,
        candidate.sourceTabId,
        url,
        decision.action === "block",
      );
    } catch (error) {
      if (window.bgRecordDiagnostic)
        bgRecordDiagnostic({
          reason: "navigation_api_failure",
          error: String(error.message).slice(0, 120),
        });
    }
  }
  function linked(tabId, sourceTabId, url) {
    if (typeof sourceTabId !== "number" || sourceTabId < 0) return;
    if (tracker.link(tabId, sourceTabId)) {
      latestUrls.set(tabId, url);
      evaluations.delete(tabId);
      while (latestUrls.size > 100)
        latestUrls.delete(latestUrls.keys().next().value);
      setTimeout(function () {
        evaluate(tabId, url);
      }, 120);
    }
  }
  api.tabs.onCreated.addListener(function (tab) {
    linked(tab.id, tab.openerTabId, tab.url || tab.pendingUrl);
  });
  api.tabs.onUpdated.addListener(function (tabId, change, tab) {
    if (change.url) {
      linked(tabId, tab.openerTabId, change.url);
      if (tracker.candidate(tabId)) {
        latestUrls.set(tabId, change.url);
        evaluations.delete(tabId);
      }
      setTimeout(function () {
        evaluate(tabId, change.url);
      }, 120);
    }
  });
  if (api.tabs.onRemoved)
    api.tabs.onRemoved.addListener(function (id) {
      tracker.remove(id);
      intents.delete(id);
      evaluations.delete(id);
      latestUrls.delete(id);
    });
  if (api.webNavigation) {
    api.webNavigation.onCreatedNavigationTarget.addListener(function (details) {
      linked(details.tabId, details.sourceTabId, details.url);
    });
    api.webNavigation.onCommitted.addListener(function (details) {
      if (details.frameId && details.frameId !== 0) return;
      evaluations.delete(details.tabId);
      if (tracker.commit(details) === "user") {
        latestUrls.delete(details.tabId);
        return;
      }
      if (tracker.candidate(details.tabId)) {
        latestUrls.set(details.tabId, details.url);
        evaluate(details.tabId, details.url);
      }
    });
  }
  api.runtime.onMessage.addListener(function (message, sender) {
    if (
      message.action !== "trusted_click" ||
      !sender.tab ||
      !AFShared.httpUrl(message.url)
    )
      return;
    if (sender.frameId && sender.frameId !== 0) return;
    intents.set(sender.tab.id, { url: message.url, time: Date.now() });
    while (intents.size > 100) intents.delete(intents.keys().next().value);
  });
})();
