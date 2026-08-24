(function () {
  var bgApi = typeof browser !== "undefined" ? browser : chrome;
  var storage = bgApi.storage.local;
  var runtimeSnapshot = {
    appSettings: { enabled: true, protectionMode: "safe", featureOverrides: {} },
    whitelist: [],
    blacklist: [],
    userCustomRules: {},
    blockedCount: 0,
    afsBlockedByHost: {}
  };

  function refresh(callback) {
    storage.get([
      "appSettings", "whitelist", "blacklist", "userCustomRules",
      "blockedCount", "afsBlockedByHost", "settingsPackageState"
    ], function (result) {
      result = result || {};
      runtimeSnapshot.appSettings = AFSettingsPackage.normalizeApp(result.appSettings);
      runtimeSnapshot.whitelist = result.whitelist || [];
      runtimeSnapshot.blacklist = result.blacklist || [];
      runtimeSnapshot.userCustomRules = result.userCustomRules || {};
      runtimeSnapshot.blockedCount = Number(result.blockedCount) || 0;
      runtimeSnapshot.afsBlockedByHost = result.afsBlockedByHost || {};
      runtimeSnapshot.settingsPackageState = result.settingsPackageState || null;
      if (callback) callback(runtimeSnapshot);
    });
  }

  function normalizeDecisionLists(hostname, policy, snapshot) {
    var whitelist = (snapshot.whitelist || []).filter(function (entry) {
      return AFSettingsPackage.normalizeHost(entry) !== hostname;
    });
    var blacklist = (snapshot.blacklist || []).filter(function (entry) {
      return AFSettingsPackage.normalizeHost(entry) !== hostname;
    });
    if (policy === "allow") whitelist.push(hostname);
    if (policy === "block") blacklist.push("||" + hostname + "^");
    return { whitelist: whitelist, blacklist: blacklist };
  }

  window.bgIsProtectionEnabled = function () {
    return runtimeSnapshot.appSettings.enabled !== false;
  };

  window.bgGetRuntimeSnapshot = function (callback) {
    refresh(callback);
  };

  window.bgGetSitePolicy = function (hostname) {
    hostname = AFSettingsPackage.normalizeHost(hostname);
    var allowed = runtimeSnapshot.whitelist.some(function (entry) {
      return AFSettingsPackage.normalizeHost(entry) === hostname;
    });
    var blocked = runtimeSnapshot.blacklist.some(function (entry) {
      return AFSettingsPackage.normalizeHost(entry) === hostname;
    });
    return blocked ? "block" : (allowed ? "allow" : "default");
  };

  window.bgSetSitePolicy = function (hostname, policy, callback) {
    hostname = AFSettingsPackage.normalizeHost(hostname);
    if (!hostname || ["default", "allow", "block"].indexOf(policy) < 0) {
      callback(new Error("Invalid site policy."));
      return;
    }
    storage.get(["whitelist", "blacklist", "afsAllowedPopupHosts", "afsBlockedPopupHosts"], function (snapshot) {
      var lists = normalizeDecisionLists(hostname, policy, snapshot || {});
      var allowed = Object.assign({}, snapshot.afsAllowedPopupHosts || {});
      var blocked = Object.assign({}, snapshot.afsBlockedPopupHosts || {});
      delete allowed[hostname];
      delete blocked[hostname];
      if (policy === "allow") allowed[hostname] = { url: "https://" + hostname, time: Date.now() };
      if (policy === "block") blocked[hostname] = { url: "https://" + hostname, time: Date.now() };
      storage.set({
        whitelist: lists.whitelist,
        blacklist: lists.blacklist,
        afsAllowedPopupHosts: allowed,
        afsBlockedPopupHosts: blocked
      }, function () {
        refresh(function () { callback(null, policy); });
      });
    });
  };

  window.bgSetAppSettings = function (next, callback) {
    var settings = AFSettingsPackage.normalizeApp(next);
    storage.set({
      appSettings: settings,
      isEnabled: settings.enabled,
      friendlyMode: settings.protectionMode === "safe"
    }, function () {
      refresh(function () { callback(null, settings); });
    });
  };

  window.bgRecordBlock = function (pageUrl, kind, amount) {
    var hostname = "unknown";
    try { hostname = new URL(pageUrl).hostname.toLowerCase(); } catch (e) {}
    amount = Math.max(1, Math.min(100, Number(amount) || 1));
    storage.get(["blockedCount", "afsBlockedByHost"], function (snapshot) {
      var total = (Number(snapshot.blockedCount) || 0) + amount;
      var byHost = snapshot.afsBlockedByHost || {};
      var current = byHost[hostname] || { total: 0, popup: 0, banner: 0, dom: 0 };
      current.total += amount;
      current[kind] = (Number(current[kind]) || 0) + amount;
      current.updatedAt = Date.now();
      byHost[hostname] = current;
      storage.set({ blockedCount: total, afsBlockedByHost: byHost });
      runtimeSnapshot.blockedCount = total;
      runtimeSnapshot.afsBlockedByHost = byHost;
    });
  };

  bgApi.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === "local") refresh();
  });

  AFSettingsPackage.initialize(storage, function (error) {
    if (error) console.error("[AdsFriendly iOS] Settings package init failed", error);
    refresh();
  });
})();
