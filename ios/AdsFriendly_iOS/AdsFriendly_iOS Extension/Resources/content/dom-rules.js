(function () {
  var hidden = AFShared.createHiddenElements();
  var shownOnPage = false;
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
    if (shownOnPage) return true;
    return (
      (AF_CONFIG.elementExceptions[window.location.hostname] || []).some(
        (rule) => {
          try {
            var ancestor = element.closest(rule.selector);
            var matches = ancestor ? [ancestor] : Array.from(element.querySelectorAll(rule.selector));
            return matches.some(matched => AFShared.matchesElementException(rule,
              candidate(matched, rule.selector)));
          } catch (_) {
            return false;
          }
        },
      ) ||
      (AF_CONFIG.allowedDomSelectors[window.location.hostname] || []).some(
        (rule) =>
          AFShared.ruleMatchesResponsiveLayout(rule, getResponsiveLayout()) &&
          (function() { try { return !!element.closest(rule.selector) || !!element.querySelector(rule.selector); } catch (_) { return false; } })(),
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
      if (saved.source === "builtin") return applicable(element, {selector: saved.selector});
      if (saved.source === "automatic") {
        if (getCurrentSitePolicy() !== "block" || !safe(element) ||
          !AFShared.iosFeatureEnabled(AF_CONFIG.appSettings, "content.dom-static-blocker") ||
          saved.layout !== getResponsiveLayout() || exception(element, saved.selector)) return false;
        var features = AFShared.extractDomFeatures(element);
        return AFShared.shouldAutoHideIosBanner({...features, visible: true, rect: saved.rect || features.rect});
      }
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
    var builtins = AFShared.iosBuiltinDomSelectors(window.location.hostname).map(selector => ({selector, source: "builtin"}));
    builtins.concat(rules()).forEach(function (rule) {
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
            hidden.hide(element, { selector, source: rule.source || "saved" })
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
    hideAutomatic: function(element, selector) {
      if (!safe(element) || getCurrentSitePolicy() !== "block" ||
        !AFShared.iosFeatureEnabled(AF_CONFIG.appSettings, "content.dom-static-blocker") ||
        exception(element, selector)) return false;
      return hidden.hide(element, {selector, source: "automatic", layout: getResponsiveLayout(),
        rect: AFShared.extractDomFeatures(element).rect});
    },
    state: () => ({hiddenCount: hidden.size, shownOnPage}),
    setVisibility: function(visibility) {
      shownOnPage = visibility === "show";
      if (shownOnPage) hidden.reconcile(() => false);
      else {
        apply(document);
        if (window.AF_scanBanners) AF_scanBanners();
      }
      schedule(document);
      return this.state();
    },
    restore: (element) => hidden.restore(element),
    schedule,
  };
  AF_CONFIG.whenReady(function () {
    schedule(document);
    // At document_start <html> may not exist yet. Observe Document itself so
    // protection isn't silently left with no observer for the rest of the page.
    var target = document;
    if (target)
      new MutationObserver(function (changes) {
        changes.forEach(function (change) {
          if (change.target.closest?.("[data-afs-ui]")) return;
          if (change.attributeName === "style" && hidden.has(change.target) &&
            change.target.style.getPropertyValue("display") === "none" &&
            change.target.style.getPropertyPriority("display") === "important") return;
          schedule(change.target);
        });
      }).observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "id", "href", "src", "srcset"],
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
    document.addEventListener("load", function(event) {
      if (["IMG", "IFRAME", "VIDEO"].includes(event.target?.tagName)) schedule(event.target.parentElement || event.target);
    }, true);
  });
})();
