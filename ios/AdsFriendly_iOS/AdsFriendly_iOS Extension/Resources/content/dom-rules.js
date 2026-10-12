(function () {
  var hidden = AFShared.createHiddenElements();
  var pending = new Set(),
    timer = null,
    full = false;
  function rules() {
    return AF_CONFIG.customRules[window.location.hostname] || [];
  }
  function safe(element) {
    return (
      element &&
      !element.closest(
        'nav, header, form, [role="navigation"], [data-afs-ui]',
      ) &&
      !["HTML", "BODY", "HEAD", "MAIN"].includes(element.tagName)
    );
  }
  function candidate(element, selector) {
    return {
      selector: selector,
      features: AFShared.extractDomFeatures(element),
      layout: getResponsiveLayout(),
    };
  }
  function exception(element, selector) {
    var context;
    try {
      context = candidate(element, selector);
    } catch (_) {
      return false;
    }
    return (
      (AF_CONFIG.elementExceptions[window.location.hostname] || []).some(
        (rule) => {
          try {
            return (
              element.matches(rule.selector) &&
              AFShared.matchesElementException(rule, {
                ...context,
                selector: rule.selector,
              })
            );
          } catch (_) {
            return false;
          }
        },
      ) ||
      (AF_CONFIG.allowedDomSelectors[window.location.hostname] || []).some(
        (rule) =>
          rule.selector === selector &&
          AFShared.ruleMatchesResponsiveLayout(rule, getResponsiveLayout()),
      )
    );
  }
  function applicable(element, rule) {
    var selector = typeof rule === "string" ? rule : rule.selector;
    if (
      !AFShared.iosFeatureEnabled(
        AF_CONFIG.appSettings,
        "content.dom-static-blocker",
      ) ||
      getCurrentSitePolicy() === "allow" ||
      !safe(element) ||
      !AFShared.safeDomSelector(selector) ||
      !AFShared.ruleMatchesResponsiveLayout(rule, getResponsiveLayout())
    )
      return false;
    try {
      if (!element.matches(selector) || exception(element, selector))
        return false;
      if (
        rule.fingerprint &&
        !AFShared.matchesElementException(rule, candidate(element, selector))
      )
        return false;
      return true;
    } catch (_) {
      return false;
    }
  }
  function reconcile() {
    hidden.reconcile(function (element, saved) {
      return rules().some(
        (rule) =>
          applicable(element, rule) &&
          (typeof rule === "string" ? rule : rule.selector) === saved.selector,
      );
    });
  }
  function apply(root) {
    if (!AFShared.iosFeatureEnabled(AF_CONFIG.appSettings, "content.dom-static-blocker") || getCurrentSitePolicy() === "allow") return;
    var count = 0;
    rules().forEach(function (rule) {
      var selector = typeof rule === "string" ? rule : rule?.selector;
      if (!AFShared.safeDomSelector(selector)) return;
      try {
        var matches = root.matches?.(selector) ? [root] : [];
        if (root.querySelectorAll)
          matches = matches.concat(
            Array.from(root.querySelectorAll(selector)).slice(0, 500),
          );
        matches.forEach(function (element) {
          if (
            !hidden.has(element) &&
            applicable(element, rule) &&
            hidden.hide(element, { selector })
          )
            count++;
        });
      } catch (_) {}
    });
    if (count && typeof afsRecordTelemetry === "function")
      afsRecordTelemetry({
        unit: "dom_element",
        label: "ad",
        label_source: "confirmed_rule",
        ad_type: "dom",
        reason: "settings_package_rule",
        action: "hide",
        outcome: "hidden_element",
        evidence: { count, layout: getResponsiveLayout() },
      });
  }
  function schedule(root) {
    if (!root || root === document || pending.size >= 20) {
      full = true;
      pending.clear();
    } else if (!full) pending.add(root);
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      if (document.hidden) return;
      reconcile();
      if (full) apply(document);
      else pending.forEach(apply);
      full = false;
      pending.clear();
      if (window.AF_scanBanners) AF_scanBanners();
    }, 180);
  }
  window.AF_DOM = {
    isAllowed: exception,
    isHidden: (element) => hidden.has(element),
    hide: function (element, selector) {
      return safe(element) && hidden.hide(element, { selector });
    },
    restore: (element) => hidden.restore(element),
    schedule,
  };
  AF_CONFIG.whenReady(function () {
    schedule(document);
    var target = document.documentElement;
    if (target)
      new MutationObserver(function (changes) {
        changes.forEach(function (change) {
          if (change.target.closest?.("[data-afs-ui]")) return;
          schedule(change.target);
        });
      }).observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "id", "href", "src"],
      });
    api.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && ["appSettings", "whitelist", "blacklist", "userCustomRules", "userElementExceptions", "afsAllowedDomSelectors"].some(key => key in changes)) schedule(document);
    });
    window.addEventListener(
      "resize",
      function () {
        schedule(document);
      },
      { passive: true },
    );
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) schedule(document);
    });
  });
})();
