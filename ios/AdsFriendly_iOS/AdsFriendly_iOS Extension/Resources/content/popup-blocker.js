(function() {
  function onPopupEvent(url) {
    if (!url || url === '' || url.startsWith('javascript:')) return;
    if (!isCrossOrigin(url) || isWhitelisted(url)) {
      document.documentElement.setAttribute('__afs_allow__', 'yes');
      log("Cho phep popup:", url);
      return;
    }
    log("Chan popup:", url);
    notifyBlocked(url);
  }

  window.addEventListener('__AFS_popup__', function(e) {
    try {
      onPopupEvent(JSON.parse(e.detail).url);
    } catch(err) {}
  });

  document.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    var a = e.target.closest('a');
    if (a && a.href && a.target === '_blank' && isCrossOrigin(a.href) && !isWhitelisted(a.href)) {
      e.preventDefault();
      e.stopPropagation();
      log("Chan mousedown -> a[target=_blank]:", a.href);
      notifyBlocked(a.href);
    }
  }, true);

  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (!a || !a.href) return;
    var opensNewTab = a.target === '_blank' || e.metaKey || e.ctrlKey;
    if (opensNewTab && isCrossOrigin(a.href) && !isWhitelisted(a.href)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      log("Chan click -> a[target=_blank]:", a.href);
      notifyBlocked(a.href);
    }
  }, true);

  document.addEventListener('touchstart', function(e) {
    var a = e.target.closest('a');
    if (a && a.href && a.target === '_blank' && isCrossOrigin(a.href) && !isWhitelisted(a.href)) {
      e.preventDefault();
      e.stopPropagation();
      log("Chan touchstart -> a[target=_blank]:", a.href);
      notifyBlocked(a.href);
    }
  }, { capture: true, passive: false });

  var pointerCount = 0;
  var pointerTimer = null;

  document.addEventListener('pointerdown', function(e) {
    pointerCount++;
    if (pointerTimer) clearTimeout(pointerTimer);
    pointerTimer = setTimeout(function() {
      if (pointerCount >= AF_CONFIG.popupBlocking.popUnderClickThreshold) {
        log("Pop-under detected (" + pointerCount + " clicks)");
        document.querySelectorAll('a[target="_blank"]').forEach(function(a) {
          if (a.href && isCrossOrigin(a.href) && !isWhitelisted(a.href)) {
            var href = a.href;
            a.removeAttribute('href');
            a.setAttribute('data-afs-href', href);
            a.addEventListener('click', function(ev) {
              ev.preventDefault();
              notifyBlocked(href);
            }, true);
          }
        });
      }
      pointerCount = 0;
    }, AF_CONFIG.popupBlocking.popUnderTimeWindowMs);
  }, true);

  api.runtime.onMessage.addListener(function(message) {
    if (message.action === "popup_blocked") {
      log("Background da chan tab:", message.url);
      notifyBlocked(message.url);
    }
  });

  log("Popup-blocker da khoi dong.");
})();
