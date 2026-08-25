const api = (typeof browser !== 'undefined') ? browser : chrome;

function isWhitelisted(url) {
  try {
    if (typeof isBlacklisted === "function" && isBlacklisted(url)) return false;
    var hostname = new URL(url, window.location.href).hostname.toLowerCase();
    return AF_CONFIG.whitelist.some(function(d) {
      return hostMatchesDomain(hostname, d);
    }) || isGoogleHost(hostname);
  } catch(e) { return false; }
}

function isProtectionEnabled() {
  return !AF_CONFIG.appSettings || AF_CONFIG.appSettings.enabled !== false;
}

function normalizedPolicyDomain(value) {
  return normalizeHost(String(value || '').replace(/^\|\|/, '').replace(/\^$/, ''));
}

function listMatchesUrl(url, values) {
  try {
    var hostname = new URL(url, window.location.href).hostname.toLowerCase();
    return (values || []).some(function(value) {
      var domain = normalizedPolicyDomain(value);
      return domain && hostMatchesDomain(hostname, domain);
    });
  } catch(e) { return false; }
}

function isBlacklisted(url) {
  return listMatchesUrl(url, AF_CONFIG.blacklist);
}

function getCurrentSitePolicy() {
  if (isBlacklisted(window.location.href)) return "block";
  var explicitWhitelist = (AF_CONFIG.whitelist || []).slice((AF_CONFIG.baseWhitelist || []).length);
  return listMatchesUrl(window.location.href, explicitWhitelist) ? "allow" : "default";
}

function getProtectionMode() {
  return (AF_CONFIG.appSettings && AF_CONFIG.appSettings.protectionMode) || "safe";
}

function getResponsiveLayout() {
  var screenWidth = typeof screen !== "undefined" && screen.width ? screen.width : 1024;
  return Math.min(window.innerWidth || 1024, screenWidth) <= 767
    ? "compact" : "wide";
}

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

function isTrustedInitiator(url) {
  try {
    var hostname = new URL(url, window.location.href).hostname.toLowerCase();
    return AF_CONFIG.trustedInitiators.some(function(d) {
      return hostMatchesDomain(hostname, d);
    }) || isGoogleHost(hostname);
  } catch(e) { return false; }
}

function isTrustedInitiatorPage() {
  return isTrustedInitiator(window.location.href);
}

function isCrossOrigin(url) {
  try {
    var currentOrigin = window.location.origin;
    var targetUrl = new URL(url, window.location.href);
    return currentOrigin !== targetUrl.origin;
  } catch(e) { return true; }
}

function getRootDomain(url) {
  try {
    var hostname = new URL(url, window.location.href).hostname;
    var parts = hostname.split('.');
    return parts.slice(-2).join('.');
  } catch(e) { return ''; }
}

function areSameSite(url1, url2) {
  return getRootDomain(url1) === getRootDomain(url2);
}

function urlFromElement(el) {
  if (el.tagName === 'A' && el.href) return el.href;
  var link = el.querySelector('a[href]');
  return link ? link.href : null;
}

function hasCrossOriginLink(el) {
  if (!el || !el.querySelectorAll) return false;
  var links = el.querySelectorAll('a[href]');
  for (var i = 0; i < links.length; i++) {
    if (links[i].href && isCrossOrigin(links[i].href)) {
      return true;
    }
  }
  return false;
}

function isAdLikeUrl(url) {
  try {
    var parsed = new URL(url, window.location.href);
    var host = parsed.hostname.toLowerCase();
    var full = (parsed.hostname + parsed.pathname + parsed.search).toLowerCase();
    var hostPatterns = AF_CONFIG.bannerDetection.adLinkHostPatterns || [];
    var pathPatterns = AF_CONFIG.bannerDetection.adLinkPathPatterns || [];

    for (var i = 0; i < hostPatterns.length; i++) {
      if (hostMatchesDomain(host, hostPatterns[i])) return true;
    }
    for (var j = 0; j < pathPatterns.length; j++) {
      if (full.indexOf(pathPatterns[j].toLowerCase()) !== -1) return true;
    }
    var campaignSignal = [
      parsed.searchParams.get("utm_source"),
      parsed.searchParams.get("utm_medium"),
      parsed.searchParams.get("utm_campaign"),
      parsed.searchParams.get("utm_content")
    ].join(" ").toLowerCase();
    if (/(advert|banner|display|popup|sponsor|cpc|cpd|(^|[^a-z])ads?([^a-z]|$))/.test(campaignSignal)) return true;
  } catch(e) {}
  return false;
}

function hasAdTokenSignal(value) {
  return /(^|[\s_-])(?:ad|ads|adv|advert|banner|promo|sponsor|popup)(?=$|[\s_-])/i.test(
    String(value || '')
  );
}

function log() {
  if (AF_CONFIG.debug) {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[AdsFriendly]");
    console.log.apply(console, args);
  }
}
