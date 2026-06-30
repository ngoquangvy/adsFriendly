(function() {
  var bgWhitelist = [
    "google.com", "accounts.google.com", "github.com",
    "bing.com", "duckduckgo.com", "yahoo.com", "search.yahoo.com",
    "baidu.com", "yandex.com",
    "microsoft.com", "login.microsoftonline.com", "live.com",
    "apple.com", "appleid.apple.com", "facebook.com"
  ];

  var bgTrustedInitiators = [
    "google.com", "accounts.google.com", "github.com",
    "bing.com", "duckduckgo.com", "yahoo.com", "search.yahoo.com",
    "baidu.com", "yandex.com",
    "microsoft.com", "login.microsoftonline.com", "live.com",
    "apple.com", "appleid.apple.com", "facebook.com"
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
      return bgWhitelist.some(function(d) {
        return hostMatchesDomain(hostname, d);
      }) || isGoogleHost(hostname);
    } catch(e) { return false; }
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

  console.log("[AdsFriendly BG] whitelist.js loaded.");
})();
