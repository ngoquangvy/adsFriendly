(function() {
  var lastTrustedIntent = { url: null, time: 0 };
  var userAllowedPopupHosts = {};
  var userBlockedPopupHosts = {};

  function isBlankUrl(url) {
    return !url || url === '' || url.indexOf('about:') === 0 || url.indexOf('javascript:') === 0;
  }

  function hostKey(url) {
    try {
      return new URL(url, window.location.href).hostname.toLowerCase().replace(/\.$/, '');
    } catch(e) {
      return '';
    }
  }

  function isUserAllowedPopup(url) {
    var key = hostKey(url);
    return !!(key && userAllowedPopupHosts[key]);
  }

  function isUserBlockedPopup(url) {
    var key = hostKey(url);
    return !!(key && userBlockedPopupHosts[key]);
  }

  function refreshPopupRules() {
    try {
      api.runtime.sendMessage({ action: "get_popup_rules" }, function(rules) {
        if (!rules) return;
        userAllowedPopupHosts = rules.allowed || {};
        userBlockedPopupHosts = rules.blocked || {};
        if (isUserAllowedPopup(window.location.href) && typeof notifyAllowed === 'function') {
          notifyAllowed(window.location.href);
        }
      });
    } catch(e) {}
  }

  function isVisibleLink(a) {
    if (!a || !a.getBoundingClientRect) return false;
    var style = window.getComputedStyle(a);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity || '1') <= 0.1) return false;
    var rect = a.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    return true;
  }

  function isLikelyClickLayer(a) {
    if (!a || !a.getBoundingClientRect) return false;
    var style = window.getComputedStyle(a);
    var rect = a.getBoundingClientRect();
    var area = rect.width * rect.height;
    var viewportArea = window.innerWidth * window.innerHeight;
    var isHuge = viewportArea > 0 && area / viewportArea > 0.45;
    var isLayer = style.position === 'fixed' || style.position === 'absolute';
    return isLayer && isHuge && (parseFloat(style.opacity || '1') <= 0.2 || linkHasAdSignal(a));
  }

  function linkHasAdSignal(a) {
    if (!a || !a.href) return false;
    if (isAdLikeUrl(a.href)) return true;

    var sig = (
      (a.className || '') + ' ' +
      (a.id || '') + ' ' +
      (a.getAttribute('aria-label') || '') + ' ' +
      (a.getAttribute('title') || '')
    ).toLowerCase();
    return hasAdTokenSignal(sig);
  }

  function rememberTrustedIntent(a) {
    if (!a || !a.href || isBlankUrl(a.href)) return;
    if (isTrustedInitiatorPage() || isWhitelisted(a.href)) return;
    if (!isCrossOrigin(a.href)) return;
    if (!isVisibleLink(a) || isLikelyClickLayer(a)) return;

    lastTrustedIntent = { url: a.href, time: Date.now() };
    api.runtime.sendMessage({
      action: "trusted_click",
      url: a.href
    });
  }

  function matchesTrustedIntent(url) {
    if (!url || !lastTrustedIntent.url) return false;
    if (Date.now() - lastTrustedIntent.time > 2000) return false;
    return areSameSite(url, lastTrustedIntent.url);
  }

  function onPopupEvent(url, userInitiated) {
    if (userInitiated) {
      try {
        api.runtime.sendMessage({
          action: "trusted_popup",
          url: url || ""
        });
      } catch(e) {}
    }
    if (isBlankUrl(url)) {
      if (userInitiated || isTrustedInitiatorPage()) {
        document.documentElement.setAttribute('__afs_allow__', 'yes');
      }
      return;
    }
    if (isUserBlockedPopup(url)) {
      log("Chan popup theo user block-list:", url);
      if (typeof afsRecordTelemetry === 'function') afsRecordTelemetry({
        label: "ad",
        label_source: "user_block",
        targetUrl: url,
        reason: "user_block_list",
        action: "block",
        outcome: "prevented_window_open"
      });
      notifyBlocked(url);
      return;
    }
    if (userInitiated || isTrustedInitiatorPage() || !isCrossOrigin(url) || isWhitelisted(url) || isUserAllowedPopup(url) || matchesTrustedIntent(url)) {
      document.documentElement.setAttribute('__afs_allow__', 'yes');
      log("Cho phep popup:", url);
      return;
    }
    log("Chan popup:", url);
    if (typeof afsRecordTelemetry === 'function') afsRecordTelemetry({
      label: "ad",
      label_source: "heuristic_blocked",
      targetUrl: url,
      reason: "window_open_without_allowed_intent",
      action: "block",
      outcome: "prevented_window_open"
    });
    notifyBlocked(url);
  }

  window.addEventListener('__AFS_popup__', function(e) {
    try {
      var detail = JSON.parse(e.detail);
      onPopupEvent(detail.url, detail.userInitiated === true);
    } catch(err) {}
  });

  document.addEventListener('mousedown', function(e) {
    var a = e.target.closest('a');
    rememberTrustedIntent(a);
  }, true);

  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (!a || !a.href) return;
    rememberTrustedIntent(a);
  }, true);

  document.addEventListener('touchstart', function(e) {
    var a = e.target.closest('a');
    rememberTrustedIntent(a);
  }, { capture: true, passive: true });

  var pointerCount = 0;
  var pointerTimer = null;

  document.addEventListener('pointerdown', function(e) {
    pointerCount++;
    if (pointerTimer) clearTimeout(pointerTimer);
    pointerTimer = setTimeout(function() {
      if (pointerCount >= AF_CONFIG.popupBlocking.popUnderClickThreshold) {
        log("Nhieu thao tac lien tiep; giu nguyen cac link do nguoi dung mo.");
      }
      pointerCount = 0;
    }, AF_CONFIG.popupBlocking.popUnderTimeWindowMs);
  }, true);

  api.runtime.onMessage.addListener(function(message) {
    if (message.action === "popup_blocked") {
      log("Background da chan tab:", message.url);
      notifyBlocked(message.url);
    } else if (message.action === "popup_rules_updated") {
      refreshPopupRules();
    }
  });

  refreshPopupRules();
  log("Popup-blocker da khoi dong.");
})();
