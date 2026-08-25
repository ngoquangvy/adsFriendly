(function() {
  var bannerScanTimer = null;

  function scheduleBannerScan() {
    if (bannerScanTimer || typeof AF_scanBanners !== 'function') return;
    bannerScanTimer = setTimeout(function() {
      bannerScanTimer = null;
      AF_scanBanners();
    }, 180);
  }

  function elementHasAdSignal(el) {
    if (!el) return false;
    var current = el;
    while (current && current !== document.body) {
      var sig = (
        (current.className || '') + ' ' +
        (current.id || '') + ' ' +
        (current.getAttribute ? (current.getAttribute('aria-label') || '') : '') + ' ' +
        (current.getAttribute ? (current.getAttribute('title') || '') : '')
      ).toLowerCase();
      if (hasAdTokenSignal(sig)) return true;
      current = current.parentElement;
    }

    return false;
  }

  function isInsideProtectedNavigation(el) {
    return !!(el && el.closest && el.closest('nav, header, [role="navigation"]'));
  }

  function processNewNode(node) {
    if (node.nodeType !== 1) return;
    if (!isProtectionEnabled() || isWhitelisted(window.location.href)) return;
    if (isTrustedInitiatorPage()) return;

    var links = node.tagName === 'A' ? [node] : (node.querySelectorAll ? node.querySelectorAll('a[target="_blank"]') : []);
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (!a.href || !isCrossOrigin(a.href) || isWhitelisted(a.href)) continue;

      var style = window.getComputedStyle(a);
      var isHidden = style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        style.opacity === '0' ||
        (a.offsetWidth === 0 && a.offsetHeight === 0);

      var isOverlay = style.position === 'fixed' || style.position === 'absolute' || style.position === 'sticky';

      if ((isHidden || isOverlay) && !isInsideProtectedNavigation(a) && (isAdLikeUrl(a.href) || elementHasAdSignal(a))) {
        var href = a.href;
        if (typeof afsRecordTelemetry === 'function') {
          afsRecordTelemetry({
            unit: "navigation",
            label: "ad",
            label_source: "heuristic_blocked",
            ad_type: "popup",
            targetUrl: href,
            reason: isHidden ? "hidden_target_blank_link" : "overlay_target_blank_link",
            element: a,
            action: "disable",
            outcome: "removed_href",
            evidence: {
              hidden: isHidden,
              overlay_position: isOverlay
            }
          });
        }
        a.removeAttribute('href');
        a.setAttribute('data-afs-href', href);
        a.style.setProperty('pointer-events', 'none', 'important');
        (function(link, blockedHref) {
          link.addEventListener('click', function(ev) {
            ev.preventDefault();
            notifyBlocked(blockedHref);
          }, true);
        })(a, href);
        log("Mutation watcher: vo hieu hoa a an/overlay:", href);
      }
    }

    if ((node.matches && node.matches('a[href], img, iframe, [style], [class], [role="dialog"]')) ||
        (node.querySelector && node.querySelector('a[href], img, iframe, [style], [class], [role="dialog"]'))) {
      scheduleBannerScan();
    }
  }

  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function(mutations) {
      for (var m = 0; m < mutations.length; m++) {
        if (mutations[m].type === 'attributes') {
          processNewNode(mutations[m].target);
          continue;
        }
        var added = mutations[m].addedNodes;
        for (var n = 0; n < added.length; n++) {
          processNewNode(added[n]);
        }
      }
    });

    var target = document.documentElement || document.body;
    if (target) {
      observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'href', 'target', 'src'] });
      processNewNode(target);
      log("Mutation watcher da bat dau.");
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'href', 'target', 'src'] });
        processNewNode(document.documentElement);
        log("Mutation watcher da bat dau (sau DOMContentLoaded).");
      });
    }
  } else {
    log("Mutation watcher: MutationObserver khong duoc ho tro.");
  }
})();
