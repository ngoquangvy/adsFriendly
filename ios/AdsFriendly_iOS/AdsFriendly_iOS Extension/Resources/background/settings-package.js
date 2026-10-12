(function () {
  var api = typeof browser !== "undefined" ? browser : chrome;
  var storage = AFShared.storageAdapter();
  var snapshot = {
    appSettings: AFSettingsPackage.normalizeApp({}),
    whitelist: [],
    blacklist: [],
    afsBlockedByHost: {},
  };
  async function refresh() {
    snapshot = await storage.get(["appSettings", "whitelist", "blacklist", "blockedCount", "afsBlockedByHost", "settingsPackageState"]);
    snapshot.appSettings = AFSettingsPackage.normalizeApp(snapshot.appSettings);
    snapshot.afsBlockedByHost = snapshot.afsBlockedByHost || {};
    return snapshot;
  }
  window.AFSettingsReady = new Promise(function (resolve) {
    AFSettingsPackage.initialize(api.storage.local, function (error) {
      if (error) console.error("[AdsFriendly] initialization failed", error);
      refresh().then(resolve, resolve);
    });
  });
  window.bgIsProtectionEnabled = function () {
    return AFShared.iosFeatureEnabled(
      snapshot.appSettings,
      "background.navigation-guard",
    );
  };
  window.bgGetRuntimeSnapshot = function (callback) {
    window.AFSettingsReady.then(refresh).then(callback, function (error) {
      callback({ error: error.message });
    });
  };
  window.bgGetSitePolicy = function (host) {
    function matches(entry) {
      var domain = AFSettingsPackage.normalizeHost(entry);
      return !!domain && (host === domain || host.endsWith("." + domain));
    }
    return (snapshot.blacklist || []).some(matches)
      ? "block"
      : (snapshot.whitelist || []).some(matches)
        ? "allow"
        : "default";
  };
  window.bgSetSitePolicy = function (hostname, policy, callback) {
    var host = AFSettingsPackage.normalizeHost(hostname);
    if (!host || !["allow", "block", "default"].includes(policy)) {
      callback(new Error("Invalid site policy."));
      return;
    }
    AFShared.serialMutation(async function () {
      await window.AFSettingsReady;
      var data = await storage.get(["whitelist", "blacklist", "afsAllowedPopupHosts", "afsBlockedPopupHosts"]);
      var whitelist = (data.whitelist || []).filter(
        (entry) => AFSettingsPackage.normalizeHost(entry) !== host,
      );
      var blacklist = (data.blacklist || []).filter(
        (entry) => AFSettingsPackage.normalizeHost(entry) !== host,
      );
      if (policy === "allow") whitelist.push(host);
      if (policy === "block") blacklist.push("||" + host + "^");
      var allowed = data.afsAllowedPopupHosts || {},
        blocked = data.afsBlockedPopupHosts || {};
      delete allowed[host];
      delete blocked[host];
      await storage.set({
        whitelist,
        blacklist,
        afsAllowedPopupHosts: allowed,
        afsBlockedPopupHosts: blocked,
      });
      await refresh();
      return policy;
    }).then((value) => callback(null, value), callback);
  };
  window.bgSetAppSettings = function (next, callback) {
    AFShared.serialMutation(async function () {
      await window.AFSettingsReady;
      var appSettings = AFSettingsPackage.normalizeApp(next);
      await storage.set({
        appSettings,
        isEnabled: appSettings.enabled,
        friendlyMode: appSettings.protectionMode === "safe",
      });
      await refresh();
      return appSettings;
    }).then((value) => callback(null, value), callback);
  };
  window.bgRecordBlock = function (url, kind, amount) {
    AFShared.serialMutation(async function () {
      await window.AFSettingsReady;
      var host = AFShared.httpUrl(url)?.hostname || "unknown";
      var data = await storage.get(["blockedCount", "afsBlockedByHost"]);
      var byHost = data.afsBlockedByHost || {},
        current = byHost[host] || { total: 0 };
      var count = Math.max(1, Math.min(100, Number(amount) || 1));
      current.total = (Number(current.total) || 0) + count;
      current[kind] = (Number(current[kind]) || 0) + count;
      current.updatedAt = Date.now();
      byHost[host] = current;
      var hosts = Object.keys(byHost).sort(
        (a, b) => byHost[b].updatedAt - byHost[a].updatedAt,
      );
      hosts.slice(250).forEach((key) => delete byHost[key]);
      await storage.set({
        blockedCount: (Number(data.blockedCount) || 0) + count,
        afsBlockedByHost: byHost,
      });
    }).catch(console.error);
  };
  window.bgRecordDiagnostic = function (event) {
    AFShared.serialMutation(async function () {
      var data = await storage.get("afsDiagnostics");
      await storage.set({
        afsDiagnostics: [
          ...(data.afsDiagnostics || []),
          { ...event, time: Date.now() },
        ].slice(-50),
      });
    }).catch(console.error);
  };
  api.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && ["appSettings", "whitelist", "blacklist", "blockedCount", "afsBlockedByHost", "settingsPackageState"].some(key => key in changes)) refresh().catch(console.error);
  });
})();
