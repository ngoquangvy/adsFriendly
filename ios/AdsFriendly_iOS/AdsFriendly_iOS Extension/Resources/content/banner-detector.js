(function () {
  if (window.top !== window) return;
  var hiddenBanners = {
    has: function (element) {
      return AF_DOM.isHidden(element);
    },
  };
  var reviewedBanners = new WeakSet();
  var bannerSignals = AFShared.IOS_BANNER_CANDIDATE_SELECTOR;
  var reviewSignals =
    '[class*="banner" i], [id*="banner" i], [class*="advert" i], [id*="advert" i], [class~="ad" i], [id^="ad-" i]';
  var scanRun = null,
    scanAgain = false,
    scanTimer = null;
  var scanStatus = { running: false, visited: 0, total: 0 };

  function buildBannerSelector(el) {
    return AFShared.buildDomSelector(el) || "";
  }

  function reviewSlotSelector(el) {
    var slot = el;
    var parent = el.parentElement;
    // A link, image and its ad wrapper must share one review identity, including
    // when a site replaces the entire creative subtree during an ad refresh.
    for (
      var depth = 0;
      parent && parent !== document.body && depth < 5;
      depth++, parent = parent.parentElement
    ) {
      if (
        parent.matches(bannerSignals) &&
        !isProtectedNavigation(parent) &&
        hasBannerCreativeGeometry(parent)
      )
        slot = parent;
    }
    return buildBannerSelector(slot);
  }

  function isAllowedCandidate(selector, element) {
    return !!selector && AF_DOM.isAllowed(element, selector);
  }

  async function saveDomDecision(selector, decision, element) {
    var response = await AFShared.callApi(api.runtime, "sendMessage", {
      action: "save_dom_decision",
      hostname: window.location.hostname,
      selector,
      layout: getResponsiveLayout(),
      decision,
      features: AFShared.extractDomFeatures(element),
    });
    if (!response || response.error || response.status !== "saved")
      throw new Error(
        response?.error || "Could not confirm this saved choice.",
      );
  }

  function isPositionedBanner(el) {
    var style = window.getComputedStyle(el);
    if (style.position === "fixed" || style.position === "sticky") return true;
    if (style.position !== "absolute") return false;
    return (
      getStyleVal(el, "zIndex") >= 20 ||
      isBannerGeometry(el) ||
      isLargeOverlay(el)
    );
  }

  function textMatchesSignature(el) {
    if (!el) return false;
    var semantic =
      ((el.getAttribute && el.getAttribute("aria-label")) || "") +
      " " +
      ((el.getAttribute && el.getAttribute("title")) || "");
    if (/close|dismiss|skip|dong|tat|\u0111\u00f3ng|t\u1eaft/i.test(semantic))
      return true;
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
      } catch (e) {}
    }
    var controls = bannerEl.querySelectorAll(
      'button,[role="button"],[class*="close" i],[id*="close" i]',
    );
    for (var c = 0; c < controls.length; c++)
      if (textMatchesSignature(controls[c])) return true;
    return false;
  }

  function hasAdContent(el) {
    var text = String(el.textContent || "").toLowerCase();
    var adKeywords = AF_CONFIG.bannerDetection.adContentKeywords;
    for (var i = 0; i < adKeywords.length; i++) {
      if (adKeywords[i] === "powered by") continue;
      if (adKeywords[i] === "qc" && !/(^|[^a-z])qc([^a-z]|$)/i.test(text))
        continue;
      if (text.indexOf(adKeywords[i]) !== -1) return true;
    }
    var cls = (
      String(el.className || "") +
      " " +
      String(el.id || "")
    ).toLowerCase();
    return /(^|[\s_-])(?:ad|ads|adv|advert|advertisement|sponsored|sponsor)(?=$|[\s_-])/i.test(
      cls,
    );
  }

  function linkLooksLikeAd(a) {
    if (!a || !a.href) return false;
    var href =
      typeof a.href === "string" ? a.href : a.getAttribute("href") || "";
    if (isAdLikeUrl(href)) return true;

    var sig = (
      (a.className || "") +
      " " +
      (a.id || "") +
      " " +
      (a.getAttribute("aria-label") || "") +
      " " +
      (a.getAttribute("title") || "")
    ).toLowerCase();
    if (
      /(^|[\s_-])(?:ad|ads|adv|advert|advertisement|sponsored|sponsor)(?=$|[\s_-])/i.test(
        sig,
      )
    )
      return true;
    var image = a.querySelector && a.querySelector("img");
    var imageSignal = image
      ? [
          image.getAttribute("alt") || "",
          image.getAttribute("title") || "",
          image.className || "",
          image.id || "",
          image.getAttribute("src") || "",
        ].join(" ")
      : "";
    return /(^|[\s_-])(?:ad|ads|adv|advert|advertisement|sponsored|sponsor)(?=$|[\s_-])/i.test(
      imageSignal,
    );
  }

  function findAdLink(el) {
    if (el && el.tagName === "A" && linkLooksLikeAd(el)) return el;
    var links = el && el.querySelectorAll ? el.querySelectorAll("a[href]") : [];
    for (var i = 0; i < links.length; i++)
      if (linkLooksLikeAd(links[i])) return links[i];
    return null;
  }

  function getAdLinkStats(el) {
    var links = el.querySelectorAll ? el.querySelectorAll("a[href]") : [];
    var total = 0;
    var ad = 0;

    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href =
        typeof a.href === "string" ? a.href : a.getAttribute("href") || "";
      if (!href || href.indexOf("javascript:") === 0 || href.indexOf("#") === 0)
        continue;
      total++;
      if (linkLooksLikeAd(a)) ad++;
    }

    return {
      total: total,
      ad: ad,
      ratio: total > 0 ? ad / total : 0,
    };
  }

  function hasHighAdLinkRatio(el) {
    var stats = getAdLinkStats(el);
    var minLinks = AF_CONFIG.bannerDetection.minLinksForAdRatio || 3;
    var threshold = AF_CONFIG.bannerDetection.adLinkRatioThreshold || 0.8;
    return (
      (stats.total >= minLinks && stats.ratio >= threshold) ||
      (stats.ad >= 1 && stats.ratio >= 0.5)
    );
  }

  function isProtectedNavigation(el) {
    if (!el || !el.closest) return false;
    return (
      !!el.closest('nav, header, form, [role="navigation"], [data-afs-ui]') ||
      ["HTML", "BODY", "HEAD", "MAIN"].includes(el.tagName)
    );
  }

  function isLoginForm(el) {
    if (el.querySelector('input[type="password"]')) return true;
    var text = el.textContent.toLowerCase();
    var loginText = AF_CONFIG.bannerDetection.loginTextSignatures;
    for (var i = 0; i < loginText.length; i++) {
      if (text.indexOf(loginText[i]) !== -1) return true;
    }
    var forms = el.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) {
      var action = (forms[i].getAttribute("action") || "").toLowerCase();
      for (var j = 0; j < loginText.length; j++) {
        if (action.indexOf(loginText[j]) !== -1) return true;
      }
    }
    return false;
  }

  function getStyleVal(el, prop) {
    var v = window.getComputedStyle(el)[prop];
    return v === "auto" ? 0 : parseInt(v, 10) || 0;
  }

  function isLargeOverlay(el, originalRect) {
    var rect = originalRect || el.getBoundingClientRect();
    var vpW = window.innerWidth;
    var vpH = window.innerHeight;
    if (rect.width <= 0 || rect.height <= 0) return false;
    var areaRatio = (rect.width * rect.height) / (vpW * vpH);
    if (areaRatio < 0.2) return false;
    var cx = vpW / 2,
      cy = vpH / 2;
    if (rect.left > cx + 100 || rect.right < cx - 100) return false;
    var zi = getStyleVal(el, "zIndex");
    if (areaRatio >= 0.5 || zi >= 10000) return true;
    return false;
  }

  function isBannerGeometry(el, originalRect) {
    if (!el || !el.getBoundingClientRect) return false;
    var rect = originalRect || el.getBoundingClientRect();
    var vpW = Math.max(1, window.innerWidth || 1);
    var vpH = Math.max(1, window.innerHeight || 1);
    if (rect.width < 40 || rect.height < 24) return false;
    var wideStrip = rect.width >= vpW * 0.55 && rect.height <= vpH * 0.45;
    var sideCreative = rect.width >= vpW * 0.22 && rect.height >= vpH * 0.18;
    return wideStrip || sideCreative;
  }

  function hasBannerCreativeGeometry(el, originalRect) {
    if (isBannerGeometry(el, originalRect)) return true;
    var visual = el && el.querySelector && el.querySelector("img, iframe");
    return !!(visual && isBannerGeometry(visual));
  }

  function isInvisibleOverlay(el, originalRect) {
    var style = window.getComputedStyle(el);
    if (style.position !== "fixed") return false;
    if (style.pointerEvents === "none" || style.visibility === "hidden")
      return false;
    if (parseFloat(style.opacity) > 0.1) return false;
    var rect = originalRect || el.getBoundingClientRect();
    if (
      rect.width < window.innerWidth * 0.8 ||
      rect.height < window.innerHeight * 0.8
    )
      return false;
    return true;
  }

  var _arrowChars = [
    "\u25BC",
    "\u25B2",
    "\u25B6",
    "\u25C0",
    "\u25C8",
    "\u25C2",
    "\u25BE",
    "\u25B4",
  ];

  function hasToggleButton(el) {
    var btns = el.querySelectorAll('button, [role="button"], a[href]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (textMatchesSignature(b)) continue;
      var t = (b.textContent || "").trim();
      for (var j = 0; j < _arrowChars.length; j++) {
        if (t.indexOf(_arrowChars[j]) !== -1) return b;
      }
      if (b.getAttribute("aria-expanded") !== null) return b;
    }
    return null;
  }

  function inspectBanner(el, originalRect) {
    var protectedContent =
      isProtectedNavigation(el) ||
      !!el.querySelector(
        'nav,header,main,article,form,input,textarea,select,[contenteditable="true"],video[controls],audio[controls]',
      ) ||
      isLoginForm(el);
    if (protectedContent)
      return {
        features: { tag: el.tagName.toLowerCase(), inProtectedArea: true },
        evidence: { candidate: false, protectedContent: true },
        positioned: false,
      };
    var features = AFShared.extractDomFeatures(el);
    var rect = originalRect || el.getBoundingClientRect();
    if (!originalRect && rect.height < 24) {
      var visual = el.querySelector("img,iframe");
      if (visual && visual.getBoundingClientRect().height >= 24)
        rect = visual.getBoundingClientRect();
    }
    features.rect = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      areaRatio:
        (rect.width * rect.height) / Math.max(1, innerWidth * innerHeight),
    };
    if (originalRect)
      features.visible =
        rect.width > 0 &&
        rect.height > 0 &&
        features.style.visibility !== "hidden" &&
        features.style.opacity > 0.05;
    var positioned = isPositionedBanner(el);
    var geometry = hasBannerCreativeGeometry(el, rect);
    var adContent = hasAdContent(el);
    var directAdLink = !!findAdLink(el);
    var ratio = hasHighAdLinkRatio(el);
    var externalLink =
      features.linkExternal || features.descendants.externalLinkCount > 0;
    var closeButton = positioned && hasCloseButton(el);
    var largeOverlay = positioned && isLargeOverlay(el, rect);
    var invisibleOverlay = positioned && isInvisibleOverlay(el, rect);
    var strict = getCurrentSitePolicy() === "block";
    var candidate =
      invisibleOverlay ||
      (geometry &&
        (adContent || directAdLink || ratio || (strict && externalLink))) ||
      (closeButton &&
        (adContent || directAdLink || ratio || (strict && largeOverlay))) ||
      (positioned &&
        !!hasToggleButton(el) &&
        (adContent || directAdLink || ratio));
    return {
      features,
      evidence: {
        candidate,
        protectedContent,
        geometry,
        adContent,
        directAdLink,
        externalLink,
        closeButton,
        largeOverlay,
        invisibleOverlay,
      },
      positioned,
    };
  }

  function hideBanner(el, reason, inspection) {
    if (
      !isProtectionEnabled() ||
      getCurrentSitePolicy() === "allow" ||
      AF_DOM.isHidden(el)
    )
      return;
    inspection = inspection || inspectBanner(el);
    if (inspection.evidence.protectedContent || !inspection.evidence.candidate)
      return;
    var selector = buildBannerSelector(el);
    if (!AFShared.safeDomSelector(selector)) return;
    if (isAllowedCandidate(selector, el)) return;
    var context = {
      policy: getCurrentSitePolicy(),
      evidence: inspection.evidence,
    };
    if (AFShared.shouldAutoHideIosBanner(inspection.features, context)) {
      // Own the ad's backdrop/close controls as well as its linked creative.
      // Do not grow a selection into a page shell, form or a kept region.
      var parent = el.parentElement,
        target = el,
        targetInspection = inspection;
      for (
        var depth = 0;
        parent && parent !== document.body && depth < 7;
        depth++, parent = parent.parentElement
      ) {
        if (AF_DOM.isHidden(parent)) break;
        var owner = inspectBanner(parent);
        if (owner.evidence.protectedContent) break;
        var ownerSelector = buildBannerSelector(parent);
        if (
          owner.positioned &&
          (owner.evidence.closeButton || owner.evidence.largeOverlay) &&
          AFShared.safeDomSelector(ownerSelector) &&
          !isAllowedCandidate(ownerSelector, parent) &&
          AFShared.shouldAutoHideIosBanner(owner.features, {
            policy: getCurrentSitePolicy(),
            evidence: owner.evidence,
          })
        ) {
          target = parent;
          targetInspection = owner;
        }
      }
      if (
        !AF_DOM.hideAutomatic(
          target,
          buildBannerSelector(target),
          targetInspection,
        )
      )
        return;
      if (typeof afsRecordTelemetry === "function")
        afsRecordTelemetry({
          unit: "dom_element",
          label: "ad",
          label_source: "confirmed_rule",
          ad_type: "banner",
          reason:
            getCurrentSitePolicy() === "block"
              ? "block_policy_banner"
              : "default_confirmed_banner",
          action: "hide",
          outcome: "hidden_element",
          evidence: { count: 1 },
        });
      return;
    }
    if (reviewedBanners.has(el)) return;
    if (!AFShared.isReviewTarget(el)) return;
    if (typeof notifyBannerCandidate !== "function") return;
    var accepted = notifyBannerCandidate(el, reason, {
      selector: selector,
      reviewKey: reviewSlotSelector(el),
      isValid: function () {
        return (
          AFShared.iosFeatureEnabled(
            AF_CONFIG.appSettings,
            "content.dom-candidate-collector",
          ) &&
          isProtectionEnabled() &&
          getCurrentSitePolicy() !== "allow" &&
          !AF_DOM.isHidden(el) &&
          !isAllowedCandidate(selector, el)
        );
      },
      hide: async function () {
        await saveDomDecision(selector, "hide", el);
        if (AF_DOM.isHidden(el)) return; // The saved-rule observer may apply first.
        if (!AFShared.isReviewTarget(el) || !AF_DOM.hide(el, selector))
          throw new Error("This area is no longer available to hide.");
        if (typeof afsRecordTelemetry === "function")
          afsRecordTelemetry({
            unit: "ui_overlay",
            label: "ad",
            label_source: "user_hide",
            ad_type: "banner",
            reason: reason,
            element: el,
            action: "hide",
            outcome: "hidden_element",
            evidence: { count: 1, layout: getResponsiveLayout() },
          });
      },
      show: async function () {
        await saveDomDecision(selector, "show", el);
        AF_DOM.restore(el);
      },
      dismiss: function () {
        reviewedBanners.add(el);
      },
    });
    if (accepted) reviewedBanners.add(el);
  }

  function canScan() {
    return (
      !document.hidden &&
      isProtectionEnabled() &&
      !isWhitelisted(location.href) &&
      AFShared.iosFeatureEnabled(
        AF_CONFIG.appSettings,
        "content.dom-candidate-collector",
      )
    );
  }
  function processElement(el) {
    if (!el.isConnected || hiddenBanners.has(el) || isProtectedNavigation(el))
      return;
    var hinted = el.matches(
      getCurrentSitePolicy() === "block" ? bannerSignals : reviewSignals,
    );
    var positioned = isPositionedBanner(el);
    if (!hinted && !positioned) {
      // Ordinary navigation links are common on long pages. Reject them
      // before rich feature extraction (including sibling summaries).
      if (!el.matches("a[href]") || !hasBannerCreativeGeometry(el)) return;
      var href =
        typeof el.href === "string" ? el.href : el.getAttribute("href") || "";
      var external = false;
      try {
        external = new URL(href, location.href).hostname !== location.hostname;
      } catch (_) {}
      if (
        !linkLooksLikeAd(el) &&
        !(getCurrentSitePolicy() === "block" && external)
      )
        return;
    }
    var inspection = inspectBanner(el);
    if (inspection.evidence.candidate)
      hideBanner(
        el,
        inspection.evidence.invisibleOverlay
          ? "invisible overlay"
          : "banner candidate",
        inspection,
      );
  }
  function scanChunk() {
    scanTimer = null;
    if (!scanRun) return;
    if (!canScan() || scanRun.policy !== getCurrentSitePolicy()) {
      scanRun = null;
      scanStatus.running = false;
      if (canScan()) scanTimer = setTimeout(scanBanners, 0);
      return;
    }
    var start = performance.now(),
      processed = 0;
    while (
      scanRun.index < scanRun.nodes.length &&
      processed < 120 &&
      performance.now() - start < 8
    ) {
      try {
        processElement(scanRun.nodes[scanRun.index++]);
      } catch (error) {
        scanStatus.errors = (scanStatus.errors || 0) + 1;
        log("Banner candidate failed:", String(error));
      }
      processed++;
    }
    scanStatus.visited = scanRun.index;
    if (scanRun.index < scanRun.nodes.length) {
      scanTimer = setTimeout(scanChunk, 16);
      return;
    }
    scanRun = null;
    scanStatus.running = false;
    if (scanAgain) {
      scanAgain = false;
      scanTimer = setTimeout(scanBanners, 250);
    }
  }
  function scanBanners() {
    if (!canScan()) return;
    if (scanRun) {
      scanAgain = true;
      return;
    }
    if (scanTimer) clearTimeout(scanTimer);
    var nodes = document.querySelectorAll("body *");
    scanRun = { nodes, index: 0, policy: getCurrentSitePolicy() };
    scanStatus = { running: true, visited: 0, total: nodes.length, errors: 0 };
    // Prioritize obvious overlays/slots regardless of their DOM index. The
    // complete sweep still visits everything beyond this short priority pass.
    var priority = document.querySelectorAll(
      bannerSignals + ', [style*="position" i]',
    );
    var priorityStart = performance.now();
    for (
      var i = 0;
      i < priority.length && performance.now() - priorityStart < 8;
      i++
    ) {
      try {
        processElement(priority[i]);
      } catch (error) {
        scanStatus.errors++;
        log("Priority banner candidate failed:", String(error));
      }
    }
    scanChunk();
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
      scanBanners();
      setTimeout(scan, interval);
    }
    setTimeout(scan, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(function () {
        scanBanners();
      }, 200);
      startPeriodicScan();
    });
  } else {
    setTimeout(function () {
      scanBanners();
    }, 200);
    startPeriodicScan();
  }

  window.AF_scanBanners = scanBanners;
  window.AF_getBannerInspection = inspectBanner;
  window.AF_bannerScanStatus = () => ({ ...scanStatus });
  // Keep document-local review history across mutations, storage updates and
  // Safari toolbar/keyboard resize events. Saved Hide/Keep rules still reconcile
  // independently in AF_DOM; unrelated page churn must not ask the user again.
  log("Banner detector started.");
})();
