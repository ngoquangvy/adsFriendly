(function() {
  var hiddenBanners = new WeakSet();
  var toggledElements = new WeakSet();

  function isPositionedBanner(el) {
    var style = window.getComputedStyle(el);
    return style.position === 'fixed' || style.position === 'sticky';
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

  function hasAdContent(el) {
    var text = el.textContent.toLowerCase();
    var adKeywords = AF_CONFIG.bannerDetection.adContentKeywords;
    for (var i = 0; i < adKeywords.length; i++) {
      if (text.indexOf(adKeywords[i]) !== -1) return true;
    }
    var cls = (el.className + " " + el.id).toLowerCase();
    var clsPatterns = AF_CONFIG.bannerDetection.adClassPatterns;
    for (var i = 0; i < clsPatterns.length; i++) {
      if (cls.indexOf(clsPatterns[i]) !== -1) return true;
    }
    return false;
  }

  function isLoginForm(el) {
    if (el.querySelector('input[type="password"]')) return true;
    var text = el.textContent.toLowerCase();
    var loginText = AF_CONFIG.bannerDetection.loginTextSignatures;
    for (var i = 0; i < loginText.length; i++) {
      if (text.indexOf(loginText[i]) !== -1) return true;
    }
    var forms = el.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      var action = (forms[i].getAttribute('action') || '').toLowerCase();
      for (var j = 0; j < loginText.length; j++) {
        if (action.indexOf(loginText[j]) !== -1) return true;
      }
    }
    return false;
  }

  function isLargeOverlay(el) {
    var rect = el.getBoundingClientRect();
    var vpW = window.innerWidth;
    var vpH = window.innerHeight;
    if (rect.width <= 0 || rect.height <= 0) return false;
    var areaRatio = (rect.width * rect.height) / (vpW * vpH);
    if (areaRatio < 0.2) return false;
    var cx = vpW / 2, cy = vpH / 2;
    if (rect.left > cx + 100 || rect.right < cx - 100) return false;
    return true;
  }

  function isInvisibleOverlay(el) {
    var style = window.getComputedStyle(el);
    if (style.position !== 'fixed') return false;
    if (parseFloat(style.opacity) > 0.1) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < window.innerWidth * 0.8 || rect.height < window.innerHeight * 0.8) return false;
    return true;
  }

  var _arrowChars = ['\u25BC','\u25B2','\u25B6','\u25C0','\u25C8','\u25C2','\u25BE','\u25B4'];

  function hasToggleButton(el) {
    var btns = el.querySelectorAll('button, [role="button"], a[href]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (textMatchesSignature(b)) continue;
      var t = (b.textContent || '').trim();
      for (var j = 0; j < _arrowChars.length; j++) {
        if (t.indexOf(_arrowChars[j]) !== -1) return b;
      }
      if (b.getAttribute('aria-expanded') !== null) return b;
    }
    return null;
  }

  function hideBanner(el, reason) {
    if (hiddenBanners.has(el)) return;
    hiddenBanners.add(el);
    el.style.setProperty('display', 'none', 'important');
    log("Banner:", reason, "-", el.tagName + (el.id ? "#" + el.id : "") + (el.className ? "." + el.className : ""));
  }

  function toggleCollapse(el, toggleBtn) {
    if (toggledElements.has(el)) return;
    toggledElements.add(el);
    toggleBtn.click();
    log("Banner: collapsed via toggle");
  }

  function scanBanners() {
    var allEls = document.querySelectorAll('body *');
    var positioned = [];

    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      if (hiddenBanners.has(el)) continue;
      if (!isPositionedBanner(el)) continue;
      if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
      if (el.style.display === 'none') continue;
      positioned.push(el);
    }

    // Phase 1: Invisible overlays
    for (var i = 0; i < positioned.length; i++) {
      if (isInvisibleOverlay(positioned[i])) {
        hideBanner(positioned[i], "invisible overlay");
      }
    }

    // Phase 2: Elements with close button → classify
    for (var i = 0; i < positioned.length; i++) {
      var el = positioned[i];
      if (hiddenBanners.has(el)) continue;
      if (!hasCloseButton(el)) continue;

      if (hasAdContent(el)) {
        hideBanner(el, "ad (close + ad keywords)");
      } else if (isLoginForm(el)) {
        continue;
      } else if (isLargeOverlay(el)) {
        hideBanner(el, "ad (close + large overlay)");
      }
    }

    // Phase 3: Toggle button (arrow) → collapse gently
    for (var i = 0; i < positioned.length; i++) {
      var el = positioned[i];
      if (hiddenBanners.has(el)) continue;
      if (toggledElements.has(el)) continue;
      if (hasCloseButton(el)) continue;
      var toggleBtn = hasToggleButton(el);
      if (toggleBtn) {
        toggleCollapse(el, toggleBtn);
      }
    }
  }

  // Re-scan via direct close selectors (faster first pass)
  function scanCloseSelectors() {
    var sel = AF_CONFIG.bannerDetection.closeSelectors.join(',');
    try {
      var candidates = document.querySelectorAll(sel);
      for (var i = 0; i < candidates.length; i++) {
        if (textMatchesSignature(candidates[i])) {
          var banner = findBannerFromCloseButton(candidates[i]);
          if (banner && !hiddenBanners.has(banner)) {
            if (hasAdContent(banner)) {
              hideBanner(banner, "ad (close selector)");
            } else if (!isLoginForm(banner) && isLargeOverlay(banner)) {
              hideBanner(banner, "ad (close selector, large)");
            }
          }
        }
      }
    } catch(e) {}
  }

  function startPeriodicScan() {
    var start = Date.now();
    var maxDur = AF_CONFIG.bannerDetection.maxScanDurationMs;
    var interval = AF_CONFIG.bannerDetection.scanIntervalMs;
    function scan() {
      if (Date.now() - start > maxDur) {
        log("Banner: stopped periodic scan.");
        return;
      }
      scanCloseSelectors();
      scanBanners();
      setTimeout(scan, interval);
    }
    setTimeout(scan, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        scanCloseSelectors();
        scanBanners();
      }, 200);
      startPeriodicScan();
    });
  } else {
    setTimeout(function() {
      scanCloseSelectors();
      scanBanners();
    }, 200);
    startPeriodicScan();
  }

  window.AF_scanBanners = scanBanners;
  log("Banner detector started.");
})();
