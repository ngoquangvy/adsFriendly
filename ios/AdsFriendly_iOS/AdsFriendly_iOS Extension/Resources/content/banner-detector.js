(function() {
  var hiddenBanners = new WeakSet();

  function isPositionedBanner(el) {
    var style = window.getComputedStyle(el);
    return style.position === 'fixed' || style.position === 'sticky';
  }

  function isSuspiciousBanner(el) {
    if (!isPositionedBanner(el)) return false;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
    return true;
  }

  function findBannerFromCloseButton(closeEl) {
    var current = closeEl.parentElement;
    while (current && current !== document.body) {
      if (isPositionedBanner(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function textMatchesSignature(el) {
    if (!el || !el.textContent) return false;
    var text = el.textContent.trim();
    if (!text) return false;
    var sigs = AF_CONFIG.bannerDetection.closeTextSignatures;
    for (var i = 0; i < sigs.length; i++) {
      if (text === sigs[i]) return true;
    }
    return false;
  }

  function hasCloseButton(bannerEl) {
    var selectors = AF_CONFIG.bannerDetection.closeSelectors;
    for (var s = 0; s < selectors.length; s++) {
      try {
        var matches = bannerEl.querySelectorAll(selectors[s]);
        for (var m = 0; m < matches.length; m++) {
          if (textMatchesSignature(matches[m])) {
            return true;
          }
        }
      } catch(e) {}
    }

    var allChildren = bannerEl.querySelectorAll('*');
    for (var c = 0; c < allChildren.length; c++) {
      if (textMatchesSignature(allChildren[c])) return true;
    }
    return false;
  }

  function hideBanner(el, reason) {
    if (hiddenBanners.has(el)) return;
    hiddenBanners.add(el);
    el.style.setProperty('display', 'none', 'important');
    log("Banner detector: da an banner -", reason, "-", el.tagName + (el.id ? "#" + el.id : "") + (el.className ? "." + el.className : ""));
  }

  function scanBanners() {
    var selectors = AF_CONFIG.bannerDetection.closeSelectors;
    try {
      var closeCandidates = document.querySelectorAll(selectors.join(','));
      for (var i = 0; i < closeCandidates.length; i++) {
        if (textMatchesSignature(closeCandidates[i])) {
          var banner = findBannerFromCloseButton(closeCandidates[i]);
          if (banner && isSuspiciousBanner(banner)) {
            hideBanner(banner, "close-btn");
          }
        }
      }
    } catch(e) {
      log("Banner detector: querySelector error:", e.message);
    }

    var allElements = document.querySelectorAll('body *');
    for (var i = 0; i < allElements.length; i++) {
      var el = allElements[i];
      if (isSuspiciousBanner(el) && hasCloseButton(el)) {
        hideBanner(el, "fixed/sticky + close-btn");
      }
    }
  }

  function startPeriodicScan() {
    var startTime = Date.now();
    var maxDuration = AF_CONFIG.bannerDetection.maxScanDurationMs;
    var interval = AF_CONFIG.bannerDetection.scanIntervalMs;

    function scan() {
      if (Date.now() - startTime > maxDuration) {
        log("Banner detector: ket thuc scan dinh ky.");
        return;
      }
      scanBanners();
      setTimeout(scan, interval);
    }

    setTimeout(scan, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(scanBanners, 200);
      startPeriodicScan();
    });
  } else {
    setTimeout(scanBanners, 200);
    startPeriodicScan();
  }

  window.AF_scanBanners = scanBanners;

  log("Banner detector da khoi dong.");
})();
