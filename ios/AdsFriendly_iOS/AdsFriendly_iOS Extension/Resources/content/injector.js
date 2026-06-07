(function() {
  var injectionCode = [
    "(function() {",
    "  var _origOpen = window.open;",
    "  window.open = function(url, target, features) {",
    "    try {",
    "      var ev = new CustomEvent('__AFS_popup__', {",
    "        detail: JSON.stringify({ url: url || '', target: target || '' })",
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
    "  var _origClick = HTMLAnchorElement.prototype.click;",
    "  HTMLAnchorElement.prototype.click = function() {",
    "    if (this.target === '_blank' && this.href) {",
    "      var ev = new CustomEvent('__AFS_popup__', {",
    "        detail: JSON.stringify({ url: this.href, target: '_blank' })",
    "      });",
    "      window.dispatchEvent(ev);",
    "      var flag = document.documentElement.getAttribute('__afs_allow__');",
    "      if (flag === 'yes') {",
    "        document.documentElement.removeAttribute('__afs_allow__');",
    "        return _origClick.call(this);",
    "      }",
    "    }",
    "    return _origClick.call(this);",
    "  };",
    "  var _gs = 0;",
    "  var _GS_WIN = 300;",
    "  document.addEventListener('pointerdown',function(){_gs=Date.now();},{capture:true,passive:true});",
    "  document.addEventListener('keydown',function(){_gs=Date.now();},{capture:true,passive:true});",
    "  var _locProto = window.location.constructor.prototype;",
    "  var _origReplace = _locProto.replace;",
    "  _locProto.replace = function(url) {",
    "    try {",
    "      if (Date.now() - _gs < _GS_WIN) return _origReplace.call(this, url);",
    "      var ev = new CustomEvent('__AFS_popup__', {",
    "        detail: JSON.stringify({ url: url || '', target: '' })",
    "      });",
    "      window.dispatchEvent(ev);",
    "      var flag = document.documentElement.getAttribute('__afs_allow__');",
    "      if (flag === 'yes') {",
    "        document.documentElement.removeAttribute('__afs_allow__');",
    "        return _origReplace.call(this, url);",
    "      }",
    "    } catch(e) {}",
    "  };",
    "  var _origAssign = _locProto.assign;",
    "  _locProto.assign = function(url) {",
    "    try {",
    "      if (Date.now() - _gs < _GS_WIN) return _origAssign.call(this, url);",
    "      var ev = new CustomEvent('__AFS_popup__', {",
    "        detail: JSON.stringify({ url: url || '', target: '' })",
    "      });",
    "      window.dispatchEvent(ev);",
    "      var flag = document.documentElement.getAttribute('__afs_allow__');",
    "      if (flag === 'yes') {",
    "        document.documentElement.removeAttribute('__afs_allow__');",
    "        return _origAssign.call(this, url);",
    "      }",
    "    } catch(e) {}",
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
