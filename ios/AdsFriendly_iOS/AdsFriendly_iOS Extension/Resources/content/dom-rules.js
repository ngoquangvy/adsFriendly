(function() {
  var hidden = typeof WeakSet !== "undefined" ? new WeakSet() : null;
  var scheduled = false;
  var dangerous = { "*": true, html: true, body: true, head: true, header: true, nav: true, main: true, form: true, div: true, span: true, p: true, a: true, li: true, ul: true, img: true, section: true, iframe: true, video: true };

  function rulesForPage() {
    var hostname = window.location.hostname.toLowerCase();
    var rules = AF_CONFIG.customRules[hostname] || [];
    var layout = getResponsiveLayout();
    return rules.filter(function(rule) {
      if (typeof rule === "string") return true;
      return !rule.layout || rule.layout === "any" || rule.layout === layout;
    });
  }

  function applyRules(root) {
    if (!isProtectionEnabled() || isWhitelisted(window.location.href)) return;
    var count = 0;
    rulesForPage().forEach(function(rule) {
      var selector = typeof rule === "string" ? rule : rule && rule.selector;
      if (!selector || dangerous[String(selector).trim().toLowerCase()] || String(selector).indexOf(":has(") >= 0) return;
      var matches = [];
      try {
        if (root && root.matches && root.matches(selector)) matches.push(root);
        if (root && root.querySelectorAll) matches = matches.concat(Array.prototype.slice.call(root.querySelectorAll(selector)));
      } catch(e) { return; }
      matches.forEach(function(element) {
        if (hidden && hidden.has(element)) return;
        if (element.closest && element.closest("nav, header, form, [role='navigation']")) return;
        if (hidden) hidden.add(element);
        element.style.setProperty("display", "none", "important");
        count++;
      });
    });
    if (count && typeof afsRecordTelemetry === "function") {
      afsRecordTelemetry({
        unit: "dom_element",
        label: "ad",
        label_source: "confirmed_rule",
        ad_type: "dom",
        reason: "settings_package_rule",
        action: "hide",
        outcome: "hidden_element",
        evidence: { count: count, layout: getResponsiveLayout() }
      });
    }
  }

  function schedule(root) {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function() { scheduled = false; applyRules(root || document); }, 120);
  }

  AF_CONFIG.whenReady(function() {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function() { applyRules(document); });
    else applyRules(document);
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(function(mutations) {
        var root = mutations.length && mutations[0].target;
        schedule(root || document);
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  });
})();
