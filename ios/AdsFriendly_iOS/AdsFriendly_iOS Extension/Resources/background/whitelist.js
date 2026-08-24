(function() {
  var bgWhitelist = [
    "google.com", "accounts.google.com", "github.com",
    "bing.com", "duckduckgo.com", "yahoo.com", "search.yahoo.com",
    "baidu.com", "yandex.com",
    "microsoft.com", "login.microsoftonline.com", "live.com",
    "apple.com", "appleid.apple.com", "facebook.com", "accounts.facebook.com",
    "cloudflare.com", "challenges.cloudflare.com"
  ];

  var bgTrustedInitiators = [
    "google.com", "accounts.google.com", "github.com",
    "bing.com", "duckduckgo.com", "yahoo.com", "search.yahoo.com",
    "baidu.com", "yandex.com",
    "microsoft.com", "login.microsoftonline.com", "live.com",
    "apple.com", "appleid.apple.com", "facebook.com", "accounts.facebook.com",
    "cloudflare.com", "challenges.cloudflare.com"
  ];

  var bgAdLinkHostPatterns = [
    "doubleclick.net", "googlesyndication.com", "googleadservices.com",
    "adservice.google.com", "adnxs.com", "taboola.com", "outbrain.com",
    "mgid.com", "criteo.com", "popads.net", "propellerads.com"
  ];

  var bgAdLinkPathPatterns = [
    "/ad/", "/ads/", "/adv/", "/advert", "/banner",
    "utm_medium=cpc", "utm_source=ad", "adclick", "clickad",
    "doubleclick", "googlesyndication", "googleadservices"
  ];

  var bgApi = (typeof browser !== 'undefined') ? browser : chrome;
  var bgUserAllowedPopupHosts = {};
  var bgUserBlockedPopupHosts = {};
  var bgConfiguredWhitelist = [];
  var bgConfiguredBlacklist = [];

  function normalizeHost(hostname) {
    return (hostname || '').toLowerCase().replace(/\.$/, '');
  }

  function hostMatchesDomain(hostname, domain) {
    hostname = normalizeHost(hostname);
    domain = normalizeHost(domain);
    return hostname === domain || hostname.endsWith("." + domain);
  }

  function isGoogleHost(hostname) {
    hostname = normalizeHost(hostname);
    return /^(.+\.)?google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(hostname);
  }

  window.bgIsWhitelisted = function(url) {
    try {
      var hostname = new URL(url).hostname;
      return bgWhitelist.concat(bgConfiguredWhitelist).some(function(d) {
        return hostMatchesDomain(hostname, d);
      }) || isGoogleHost(hostname);
    } catch(e) { return false; }
  };

  function popupHostKey(url) {
    try {
      return normalizeHost(new URL(url).hostname);
    } catch(e) {
      return "";
    }
  }

  function savePopupRules(callback) {
    if (!bgApi.storage || !bgApi.storage.local) {
      if (callback) callback();
      return;
    }
    bgApi.storage.local.set({
      afsAllowedPopupHosts: bgUserAllowedPopupHosts,
      afsBlockedPopupHosts: bgUserBlockedPopupHosts
    }, function() {
      if (callback) callback();
    });
  }

  window.bgGetPopupHostKey = popupHostKey;

  window.bgGetPopupRules = function() {
    var allowed = Object.assign({}, bgUserAllowedPopupHosts);
    var blocked = Object.assign({}, bgUserBlockedPopupHosts);
    bgConfiguredWhitelist.forEach(function(entry) {
      var host = normalizeHost(String(entry || '').replace(/^\|\|/, '').replace(/\^$/, ''));
      if (host) allowed[host] = allowed[host] || { source: "settings_package" };
    });
    bgConfiguredBlacklist.forEach(function(entry) {
      var host = normalizeHost(String(entry || '').replace(/^\|\|/, '').replace(/\^$/, ''));
      if (host) blocked[host] = blocked[host] || { source: "settings_package" };
    });
    return {
      allowed: allowed,
      blocked: blocked
    };
  };

  window.bgIsUserAllowedPopup = function(url) {
    var key = popupHostKey(url);
    return !!(key && (bgUserAllowedPopupHosts[key] || bgConfiguredWhitelist.some(function(entry) {
      return hostMatchesDomain(key, entry);
    })));
  };

  window.bgIsUserBlockedPopup = function(url) {
    var key = popupHostKey(url);
    return !!(key && (bgUserBlockedPopupHosts[key] || bgConfiguredBlacklist.some(function(entry) {
      return hostMatchesDomain(key, String(entry || '').replace(/^\|\|/, '').replace(/\^$/, ''));
    })));
  };

  window.bgRememberAllowedPopup = function(url, callback) {
    var key = popupHostKey(url);
    if (!key) {
      if (callback) callback(false);
      return;
    }
    bgUserAllowedPopupHosts[key] = { url: url, time: Date.now() };
    delete bgUserBlockedPopupHosts[key];
    savePopupRules(function() {
      if (callback) callback(true);
    });
  };

  window.bgRememberBlockedPopup = function(url, callback) {
    var key = popupHostKey(url);
    if (!key) {
      if (callback) callback(false);
      return;
    }
    bgUserBlockedPopupHosts[key] = { url: url, time: Date.now() };
    delete bgUserAllowedPopupHosts[key];
    savePopupRules(function() {
      if (callback) callback(true);
    });
  };

  window.bgIsTrustedInitiator = function(url) {
    try {
      var hostname = new URL(url).hostname;
      return bgTrustedInitiators.some(function(d) {
        return hostMatchesDomain(hostname, d);
      }) || isGoogleHost(hostname);
    } catch(e) { return false; }
  };

  window.bgIsAdLikeUrl = function(url) {
    try {
      var parsed = new URL(url);
      var host = parsed.hostname.toLowerCase();
      var full = (parsed.hostname + parsed.pathname + parsed.search).toLowerCase();
      for (var i = 0; i < bgAdLinkHostPatterns.length; i++) {
        if (hostMatchesDomain(host, bgAdLinkHostPatterns[i])) return true;
      }
      for (var j = 0; j < bgAdLinkPathPatterns.length; j++) {
        if (full.indexOf(bgAdLinkPathPatterns[j].toLowerCase()) !== -1) return true;
      }
    } catch(e) {}
    return false;
  };

  window.bgGetRootDomain = function(url) {
    try {
      var hostname = new URL(url).hostname;
      var parts = hostname.split('.');
      return parts.slice(-2).join('.');
    } catch(e) { return ''; }
  };

  window.bgAreSameSite = function(url1, url2) {
    var r1 = bgGetRootDomain(url1);
    var r2 = bgGetRootDomain(url2);
    return r1 !== '' && r2 !== '' && r1 === r2;
  };

  if (bgApi.storage && bgApi.storage.local) {
    bgApi.storage.local.get(["afsAllowedPopupHosts", "afsBlockedPopupHosts", "whitelist", "blacklist"], function(result) {
      bgUserAllowedPopupHosts = result.afsAllowedPopupHosts || {};
      bgUserBlockedPopupHosts = result.afsBlockedPopupHosts || {};
      bgConfiguredWhitelist = result.whitelist || [];
      bgConfiguredBlacklist = result.blacklist || [];
    });
    bgApi.storage.onChanged.addListener(function(changes, areaName) {
      if (areaName !== "local") return;
      if (changes.afsAllowedPopupHosts) bgUserAllowedPopupHosts = changes.afsAllowedPopupHosts.newValue || {};
      if (changes.afsBlockedPopupHosts) bgUserBlockedPopupHosts = changes.afsBlockedPopupHosts.newValue || {};
      if (changes.whitelist) bgConfiguredWhitelist = changes.whitelist.newValue || [];
      if (changes.blacklist) bgConfiguredBlacklist = changes.blacklist.newValue || [];
    });
  }

  console.log("[AdsFriendly BG] whitelist.js loaded.");
})();
