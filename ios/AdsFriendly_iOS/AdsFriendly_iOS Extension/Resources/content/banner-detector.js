(function() {
  var hiddenBanners = new WeakSet();
  var toggledElements = new WeakSet();
  var reviewedBanners = new WeakSet();

  function escapeCss(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function buildBannerSelector(el) {
    if (!el || !el.tagName) return "";
    var tag = el.tagName.toLowerCase();
    if (isStableToken(el.id)) {
      var idSelector = tag + "#" + escapeCss(el.id);
      if (selectorMatchCount(idSelector) === 1) return idSelector;
    }
    var classes = String(el.className || "").split(/\s+/).filter(function(token) {
      return isStableToken(token) && hasAdTokenSignal(token);
    });
    if (classes.length) return tag + "." + escapeCss(classes[0]);
    var stableClasses = String(el.className || "").split(/\s+/).filter(isStableToken);
    for (var i = 0; i < stableClasses.length; i++) {
      var classSelector = tag + "." + escapeCss(stableClasses[i]);
      var count = selectorMatchCount(classSelector);
      if (count > 0 && count <= 3) return classSelector;
    }
    var ariaLabel = el.getAttribute && el.getAttribute("aria-label");
    var title = el.getAttribute && el.getAttribute("title");
    var label = ariaLabel || title;
    if (label && /ad|advert|banner|sponsor|promo/i.test(label) && label.length <= 100) {
      var attribute = ariaLabel ? "aria-label" : "title";
      return tag + '[' + attribute + '="' + String(label).replace(/"/g, '\\"') + '"]';
    }
    var adLink = findAdLink(el);
    if (adLink) {
      try {
        var host = new URL(adLink.href).hostname;
        if (host) return 'a[href*="//' + String(host).replace(/"/g, '\\"') + '"]';
      } catch(e) {}
    }
    return "";
  }

  function isStableToken(value) {
    value = String(value || "");
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{2,79}$/.test(value)) return false;
    if (/\d{5,}|[a-f0-9]{12,}/i.test(value)) return false;
    return ["container", "wrapper", "content", "item", "active", "show", "visible"].indexOf(value.toLowerCase()) < 0;
  }

  function selectorMatchCount(selector) {
    try { return document.querySelectorAll(selector).length; } catch(e) { return 0; }
  }

  function isAllowedCandidate(selector) {
    if (!selector) return false;
    var hostname = window.location.hostname.toLowerCase();
    var layout = getResponsiveLayout();
    return (AF_CONFIG.allowedDomSelectors[hostname] || []).some(function(rule) {
      return rule.selector === selector && (!rule.layout || rule.layout === "any" || rule.layout === layout);
    });
  }

  function saveDomDecision(selector, decision) {
    if (!selector) return;
    api.runtime.sendMessage({
      action: "save_dom_decision",
      hostname: window.location.hostname,
      selector: selector,
      layout: getResponsiveLayout(),
      decision: decision
    });
  }

  function isPositionedBanner(el) {
    var style = window.getComputedStyle(el);
    if (style.position === 'fixed' || style.position === 'sticky') return true;
    if (style.position !== 'absolute') return false;
    return getStyleVal(el, 'zIndex') >= 20 || isBannerGeometry(el) || isLargeOverlay(el);
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
    if (!el) return false;
    var semantic = ((el.getAttribute && el.getAttribute("aria-label")) || "") + " " +
      ((el.getAttribute && el.getAttribute("title")) || "");
    if (/close|dismiss|skip|dong|tat|\u0111\u00f3ng|t\u1eaft/i.test(semantic)) return true;
    if (!el.textContent) return false;
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
    var text = String(el.textContent || "").toLowerCase();
    var adKeywords = AF_CONFIG.bannerDetection.adContentKeywords;
    for (var i = 0; i < adKeywords.length; i++) {
      if (text.indexOf(adKeywords[i]) !== -1) return true;
    }
    var cls = (String(el.className || "") + " " + String(el.id || "")).toLowerCase();
    return hasAdTokenSignal(cls);
  }

  function linkLooksLikeAd(a) {
    if (!a || !a.href) return false;
    if (isAdLikeUrl(a.href)) return true;

    var sig = (
      (a.className || '') + ' ' +
      (a.id || '') + ' ' +
      (a.getAttribute('aria-label') || '') + ' ' +
      (a.getAttribute('title') || '')
    ).toLowerCase();
    if (hasAdTokenSignal(sig)) return true;
    var image = a.querySelector && a.querySelector("img");
    var imageSignal = image ? [
      image.getAttribute("alt") || "",
      image.getAttribute("title") || "",
      image.className || "",
      image.id || "",
      image.getAttribute("src") || ""
    ].join(" ") : "";
    return hasAdTokenSignal(imageSignal);
  }

  function findAdLink(el) {
    if (el && el.tagName === "A" && linkLooksLikeAd(el)) return el;
    var links = el && el.querySelectorAll ? el.querySelectorAll('a[href]') : [];
    for (var i = 0; i < links.length; i++) if (linkLooksLikeAd(links[i])) return links[i];
    return null;
  }

  function getAdLinkStats(el) {
    var links = el.querySelectorAll ? el.querySelectorAll('a[href]') : [];
    var total = 0;
    var ad = 0;

    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (!a.href || a.href.indexOf('javascript:') === 0 || a.href.indexOf('#') === 0) continue;
      total++;
      if (linkLooksLikeAd(a)) ad++;
    }

    return {
      total: total,
      ad: ad,
      ratio: total > 0 ? ad / total : 0
    };
  }

  function hasHighAdLinkRatio(el) {
    var stats = getAdLinkStats(el);
    var minLinks = AF_CONFIG.bannerDetection.minLinksForAdRatio || 3;
    var threshold = AF_CONFIG.bannerDetection.adLinkRatioThreshold || 0.8;
    return (stats.total >= minLinks && stats.ratio >= threshold) ||
      (stats.ad >= 1 && stats.ratio >= 0.5);
  }

  function isProtectedNavigation(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('nav, header, [role="navigation"]');
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

  function getStyleVal(el, prop) {
    var v = window.getComputedStyle(el)[prop];
    return v === 'auto' ? 0 : (parseInt(v, 10) || 0);
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
    var zi = getStyleVal(el, 'zIndex');
    if (areaRatio >= 0.5 || zi >= 10000) return true;
    return false;
  }

  function isBannerGeometry(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var rect = el.getBoundingClientRect();
    var vpW = Math.max(1, window.innerWidth || 1);
    var vpH = Math.max(1, window.innerHeight || 1);
    if (rect.width < 40 || rect.height < 24) return false;
    var wideStrip = rect.width >= vpW * 0.55 && rect.height <= vpH * 0.45;
    var sideCreative = rect.width >= vpW * 0.22 && rect.height >= vpH * 0.18;
    return wideStrip || sideCreative;
  }

  function hasBannerCreativeGeometry(el) {
    if (isBannerGeometry(el)) return true;
    var visual = el && el.querySelector && el.querySelector("img, iframe");
    return !!(visual && isBannerGeometry(visual));
  }

  function isLikelyAdContainer(el) {
    return hasAdContent(el) || hasHighAdLinkRatio(el) ||
      (getCurrentSitePolicy() === "block" && hasBannerCreativeGeometry(el) && hasCrossOriginLink(el));
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

  function hideBanner(el, reason, hideAction) {
    if (!isProtectionEnabled() || isWhitelisted(window.location.href)) return;
    if (hiddenBanners.has(el) || reviewedBanners.has(el)) return;
    var selector = buildBannerSelector(el);
    if (isAllowedCandidate(selector)) {
      reviewedBanners.add(el);
      return;
    }
    if (shouldAutoHide(el, reason)) {
      hiddenBanners.add(el);
      if (hideAction) hideAction();
      else el.style.setProperty('display', 'none', 'important');
      if (typeof afsRecordTelemetry === 'function') {
        afsRecordTelemetry({
          unit: "ui_overlay",
          label: "ad",
          label_source: getCurrentSitePolicy() === "block" ? "user_block" : "heuristic_blocked",
          ad_type: "banner",
          reason: reason,
          element: el,
          action: "hide",
          outcome: "hidden_element",
          evidence: { count: 1, layout: getResponsiveLayout(), automatic: true }
        });
      }
      return;
    }
    if (typeof notifyBannerCandidate !== "function") return;
    var accepted = notifyBannerCandidate(el, reason, {
      hide: function() {
        hiddenBanners.add(el);
        if (hideAction) hideAction();
        else el.style.setProperty('display', 'none', 'important');
        saveDomDecision(selector, "hide");
        if (typeof afsRecordTelemetry === 'function') {
          afsRecordTelemetry({
            unit: "ui_overlay",
            label: "ad",
            label_source: "user_hide",
            ad_type: "banner",
            reason: reason,
            element: el,
            action: "hide",
            outcome: "hidden_element",
            evidence: {
              count: 1,
              layout: getResponsiveLayout(),
              has_close_button: hasCloseButton(el),
              high_ad_link_ratio: hasHighAdLinkRatio(el),
              large_overlay: isLargeOverlay(el)
            }
          });
        }
      },
      show: function() {
        reviewedBanners.add(el);
        saveDomDecision(selector, "show");
      },
      dismiss: function() { reviewedBanners.add(el); }
    });
    if (accepted) reviewedBanners.add(el);
  }

  function shouldAutoHide(el, reason) {
    if (getCurrentSitePolicy() === "block") return true;
    if (reason === "invisible overlay") return true;
    var directAdLink = !!findAdLink(el);
    return (directAdLink && (hasCloseButton(el) || hasBannerCreativeGeometry(el) || isLargeOverlay(el))) ||
      (hasAdContent(el) && hasCloseButton(el) && hasBannerCreativeGeometry(el));
  }

  function scanInlineCreatives() {
    var links = document.querySelectorAll('a[href]');
    var strict = getCurrentSitePolicy() === "block";
    for (var i = 0; i < links.length && i < 500; i++) {
      var link = links[i];
      if (hiddenBanners.has(link) || reviewedBanners.has(link)) continue;
      if (isProtectedNavigation(link) || !hasBannerCreativeGeometry(link)) continue;
      if (!linkLooksLikeAd(link) && !(strict && isCrossOrigin(link.href))) continue;
      hideBanner(link, "linked banner creative");
    }
    var signaled = [];
    try {
      signaled = document.querySelectorAll(
        '[class*="banner" i], [id*="banner" i], [class*="advert" i], [id*="advert" i], [class~="ad" i], [id^="ad-" i]'
      );
    } catch(e) {}
    for (var j = 0; j < signaled.length && j < 300; j++) {
      var candidate = signaled[j];
      if (hiddenBanners.has(candidate) || reviewedBanners.has(candidate)) continue;
      if (isProtectedNavigation(candidate) || !hasBannerCreativeGeometry(candidate)) continue;
      if (isLikelyAdContainer(candidate)) hideBanner(candidate, "inline banner signal");
    }
  }

  function toggleCollapse(el, toggleBtn) {
    if (toggledElements.has(el)) return;
    hideBanner(el, "toggle collapse", function() {
      toggledElements.add(el);
      toggleBtn.click();
      log("Banner: collapsed via toggle");
    });
  }

  function scanBanners() {
    if (!isProtectionEnabled() || isWhitelisted(window.location.href)) return;
    scanInlineCreatives();
    var allEls = document.querySelectorAll('body *');
    var positioned = [];

    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      if (hiddenBanners.has(el) || reviewedBanners.has(el)) continue;
      if (!isPositionedBanner(el)) continue;
      if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
      if (el.style.display === 'none') continue;
      positioned.push(el);
    }

    // Phase 1: Invisible overlays
    for (var i = 0; i < positioned.length; i++) {
      if (isProtectedNavigation(positioned[i])) continue;
      if (isInvisibleOverlay(positioned[i])) {
        hideBanner(positioned[i], "invisible overlay");
      }
    }

    // Phase 2: Elements with close button → classify
    for (var i = 0; i < positioned.length; i++) {
      var el = positioned[i];
      if (hiddenBanners.has(el)) continue;
      if (isProtectedNavigation(el)) continue;
      if (!hasCloseButton(el)) continue;

      if (isLikelyAdContainer(el)) {
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
      if (isProtectedNavigation(el)) continue;
      if (hasCloseButton(el)) continue;
      var toggleBtn = hasToggleButton(el);
      if (toggleBtn && isLikelyAdContainer(el)) {
        toggleCollapse(el, toggleBtn);
      }
    }

    // Phase 4: Mobile ads are commonly a single linked image without a close button.
    for (var i = 0; i < positioned.length; i++) {
      var creative = positioned[i];
      if (hiddenBanners.has(creative) || reviewedBanners.has(creative)) continue;
      if (isProtectedNavigation(creative) || hasCloseButton(creative)) continue;
      if (hasBannerCreativeGeometry(creative) && isLikelyAdContainer(creative)) {
        hideBanner(creative, "ad creative");
      }
    }
  }

  // Re-scan via direct close selectors (faster first pass)
  function scanCloseSelectors() {
    if (!isProtectionEnabled() || isWhitelisted(window.location.href)) return;
    var sel = AF_CONFIG.bannerDetection.closeSelectors.join(',');
    try {
      var candidates = document.querySelectorAll(sel);
      for (var i = 0; i < candidates.length; i++) {
        if (textMatchesSignature(candidates[i])) {
          var banner = findBannerFromCloseButton(candidates[i]);
          if (banner && !hiddenBanners.has(banner)) {
            if (isProtectedNavigation(banner)) continue;
            if (isLikelyAdContainer(banner)) {
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
