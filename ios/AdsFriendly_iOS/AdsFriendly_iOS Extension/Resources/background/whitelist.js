(function() {
  var bgWhitelist = [
    "google.com", "accounts.google.com", "github.com",
    "microsoft.com", "login.microsoftonline.com", "live.com",
    "apple.com", "appleid.apple.com", "facebook.com"
  ];

  window.bgIsWhitelisted = function(url) {
    try {
      var hostname = new URL(url).hostname;
      return bgWhitelist.some(function(d) {
        return hostname === d || hostname.endsWith("." + d);
      });
    } catch(e) { return false; }
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
