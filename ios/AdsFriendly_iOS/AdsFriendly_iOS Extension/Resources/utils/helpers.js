const api = (typeof browser !== 'undefined') ? browser : chrome;

function isWhitelisted(url) {
  try {
    var hostname = new URL(url).hostname;
    return AF_CONFIG.whitelist.some(function(d) {
      return hostname === d || hostname.endsWith("." + d);
    });
  } catch(e) { return false; }
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
    var hostname = new URL(url).hostname;
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

function log() {
  if (AF_CONFIG.debug) {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[AdsFriendly]");
    console.log.apply(console, args);
  }
}
