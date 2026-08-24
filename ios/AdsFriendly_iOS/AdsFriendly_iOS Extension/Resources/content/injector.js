(function() {
  var injectionCode = [
    "(function() {",
    "  var _origOpen = window.open;",
    "  var _lastGestureAt = 0;",
    "  var _GESTURE_WIN = 1000;",
    "  document.addEventListener('pointerdown', function() { _lastGestureAt = Date.now(); }, { capture: true, passive: true });",
    "  document.addEventListener('touchstart', function() { _lastGestureAt = Date.now(); }, { capture: true, passive: true });",
    "  document.addEventListener('keydown', function() { _lastGestureAt = Date.now(); }, { capture: true, passive: true });",
    "  function isUserInitiated() {",
    "    return !!(navigator.userActivation && navigator.userActivation.isActive) || Date.now() - _lastGestureAt < _GESTURE_WIN;",
    "  }",
    "  window.open = function(url, target, features) {",
    "    try {",
    "      var ev = new CustomEvent('__AFS_popup__', {",
    "        detail: JSON.stringify({ url: url || '', target: target || '', userInitiated: isUserInitiated() })",
    "      });",
    "      window.dispatchEvent(ev);",
    "      var flag = document.documentElement.getAttribute('__afs_allow__');",
    "      if (flag === 'yes') {",
    "        document.documentElement.removeAttribute('__afs_allow__');",
    "        return _origOpen.call(window, url, target, features);",
    "      }",
      "      var noop = function(){};",
      "      return { closed: false, close: noop, focus: noop, blur: noop, postMessage: noop, document: { write: noop, close: noop }, location: { href: '', replace: noop } };",
    "    } catch(e) { return null; }",
    "  };",
    "})();"
  ].join("\n");

  function tryInject(methodIndex) {
    try {
      var s = document.createElement('script');
      if (methodIndex === 0) {
        s.textContent = injectionCode;
      } else if (methodIndex === 1) {
        var blob = new Blob([injectionCode], { type: 'application/javascript' });
        s.src = URL.createObjectURL(blob);
      } else {
        s.src = 'data:text/javascript;base64,' + btoa(injectionCode);
      }
      (document.documentElement || document.head).appendChild(s);
      setTimeout(function() { s.remove(); }, 0);
      return true;
    } catch(e) { return false; }
  }

  var injected = false;
  for (var i = 0; i < 3; i++) {
    if (tryInject(i)) { injected = true; break; }
  }
  log("Injector: script injected =", injected, "(method", i + ")");
})();
