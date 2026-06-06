(function() {
  function processNewNode(node) {
    if (node.nodeType !== 1) return;

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

      if (isHidden || isOverlay) {
        var href = a.href;
        a.removeAttribute('href');
        a.setAttribute('data-afs-href', href);
        a.style.setProperty('pointer-events', 'none', 'important');
        a.addEventListener('click', function(ev) {
          ev.preventDefault();
          notifyBlocked(href);
        }, true);
        log("Mutation watcher: vo hieu hoa a an/overlay:", href);
      }
    }

    if (node.querySelectorAll && node.querySelectorAll('a[href]').length > 0) {
      if (typeof AF_scanBanners === 'function') AF_scanBanners();
    }
  }

  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function(mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes;
        for (var n = 0; n < added.length; n++) {
          processNewNode(added[n]);
        }
      }
    });

    var target = document.documentElement || document.body;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
      log("Mutation watcher da bat dau.");
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        log("Mutation watcher da bat dau (sau DOMContentLoaded).");
      });
    }
  } else {
    log("Mutation watcher: MutationObserver khong duoc ho tro.");
  }
})();
