(function () {
  var api = typeof browser !== "undefined" ? browser : chrome;
  var rules = {};
  function host(url) {
    return AFShared.httpUrl(url)?.hostname || "";
  }
  function listed(url, list) {
    var key = host(url);
    return (
      !!key &&
      (list || []).some(function (entry) {
        var domain = AFSettingsPackage.normalizeHost(entry);
        return domain && (key === domain || key.endsWith("." + domain));
      })
    );
  }
  window.bgIsBlacklisted = (url) => listed(url, rules.blacklist);
  window.bgIsWhitelisted = (url) =>
    !bgIsBlacklisted(url) && listed(url, rules.whitelist);
  window.bgIsUserAllowedPopup = (url) =>
    !!(rules.afsAllowedPopupHosts || {})[host(url)] || bgIsWhitelisted(url);
  window.bgIsUserBlockedPopup = (url) =>
    !!(rules.afsBlockedPopupHosts || {})[host(url)] || bgIsBlacklisted(url);
  window.bgGetPopupRules = function () {
    return {
      allowed: rules.afsAllowedPopupHosts || {},
      blocked: rules.afsBlockedPopupHosts || {},
      whitelist: rules.whitelist || [],
      blacklist: rules.blacklist || [],
    };
  };
  window.bgRememberAllowedPopup = function (url, callback) {
    bgSetSitePolicy(host(url), "allow", (error) => callback(!error, error));
  };
  window.bgRememberBlockedPopup = function (url, callback) {
    bgSetSitePolicy(host(url), "block", (error) => callback(!error, error));
  };
  window.bgIsAdLikeUrl = function (url) {
    var key = host(url);
    return [
      "doubleclick.net",
      "googlesyndication.com",
      "googleadservices.com",
      "adnxs.com",
      "taboola.com",
      "outbrain.com",
      "mgid.com",
      "criteo.com",
      "popads.net",
      "propellerads.com",
    ].some((domain) => key === domain || key.endsWith("." + domain));
  };
  window.bgAreSameSite = AFShared.sameHostFamily;
  window.bgIsTrustedInitiator = () => false;
  function refresh() {
    return AFShared.storageAdapter()
      .get(["whitelist", "blacklist", "afsAllowedPopupHosts", "afsBlockedPopupHosts"])
      .then((data) => {
        rules = data;
      });
  }
  window.AFSettingsReady.then(refresh).catch(console.error);
  api.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && ["whitelist", "blacklist", "afsAllowedPopupHosts", "afsBlockedPopupHosts"].some(key => key in changes)) refresh().catch(console.error);
  });
})();
