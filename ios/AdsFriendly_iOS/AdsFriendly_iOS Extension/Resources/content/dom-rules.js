(function () {
  var hidden = AFShared.createHiddenElements();
  var shownOnPage = false;
  var temporaryShows = new Map(),
    reviewIds = new WeakMap(),
    reviewTargets = new Map(),
    nextReviewId = 0;
  var documentToken =
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
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
    for (var [shown, record] of temporaryShows) {
      if (!shown.isConnected || areaIdentity(shown) !== record.identity) {
        temporaryShows.delete(shown);
        continue;
      }
      if (shown.contains(element) || element.contains(shown)) return true;
    }
    return (
      (AF_CONFIG.elementExceptions[window.location.hostname] || []).some(
        (rule) => {
          try {
            var ancestor = element.closest(rule.selector);
            var matches = ancestor
              ? [ancestor]
              : Array.from(element.querySelectorAll(rule.selector));
            return matches.some((matched) =>
              AFShared.matchesElementException(
                rule,
                candidate(matched, rule.selector),
              ),
            );
          } catch (_) {
            return false;
          }
        },
      ) ||
      (AF_CONFIG.allowedDomSelectors[window.location.hostname] || []).some(
        (rule) =>
          AFShared.ruleMatchesResponsiveLayout(rule, getResponsiveLayout()) &&
          (function () {
            try {
              return (
                !!element.closest(rule.selector) ||
                !!element.querySelector(rule.selector)
              );
            } catch (_) {
              return false;
            }
          })(),
      )
    );
  }
  function areaIdentity(element) {
    var f = AFShared.extractDomFeatures(element);
    return JSON.stringify([
      f.tag,
      f.id,
      f.className,
      f.href,
      f.src,
      f.descendants.hrefHosts,
      f.descendants.srcHosts,
      (element.textContent || "").trim().slice(0, 500),
    ]);
  }
  function rootEntries() {
    return hidden.entries().filter(({ element }) => {
      if (!element.isConnected) return false;
      for (
        var parent = element.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (hidden.has(parent)) return false;
      return true;
    });
  }
  function rememberTemporary(element, selector, kind) {
    temporaryShows.set(element, {
      selector,
      kind,
      identity: areaIdentity(element),
    });
  }
  function restoreArea(element) {
    hidden.entries().forEach((entry) => {
      if (element.contains(entry.element)) hidden.restore(entry.element);
    });
  }
  function reviewState() {
    reviewTargets.clear();
    var items = [],
      seen = new Set();
    function add(element, selector, state, rect) {
      if (
        items.length >= 20 ||
        seen.has(element) ||
        !element.isConnected ||
        !safe(element) ||
        !AFShared.safeDomSelector(selector)
      )
        return;
      seen.add(element);
      var identity = areaIdentity(element),
        id = reviewIds.get(element);
      if (!id || id.identity !== identity) {
        id = { identity, token: documentToken + "-" + ++nextReviewId };
        reviewIds.set(element, id);
      }
      reviewTargets.set(id.token, { element, selector, identity, state });
      var f = AFShared.extractDomFeatures(element),
        bounds = rect || f.rect;
      var name =
        f.id ||
        f.className ||
        f.hrefHost ||
        f.descendants.hrefHosts[0] ||
        selector;
      var label =
        (f.fixedOrSticky ? "Overlay" : "Area") +
        " · " +
        String(name).slice(0, 65);
      if (bounds?.width && bounds?.height)
        label +=
          " · " + Math.round(bounds.width) + "×" + Math.round(bounds.height);
      items.push({ id: id.token, label, state });
    }
    var roots = rootEntries();
    roots.forEach(({ element, metadata }) =>
      add(element, metadata.selector, "hidden", metadata.rect),
    );
    for (var [element, record] of temporaryShows) {
      if (!element.isConnected || areaIdentity(element) !== record.identity) {
        temporaryShows.delete(element);
        continue;
      }
      add(element, record.selector, record.kind === "keep" ? "kept" : "shown");
    }
    var stored = (AF_CONFIG.elementExceptions[location.hostname] || []).concat(
      AF_CONFIG.allowedDomSelectors[location.hostname] || [],
    );
    for (var rule of stored) {
      if (items.length >= 20) break;
      if (
        !AFShared.safeDomSelector(rule.selector) ||
        !AFShared.ruleMatchesResponsiveLayout(rule, getResponsiveLayout())
      )
        continue;
      try {
        for (var element of document.querySelectorAll(rule.selector)) {
          if (items.length >= 20) break;
          if (
            !rule.fingerprint ||
            AFShared.matchesElementException(
              rule,
              candidate(element, rule.selector),
            )
          )
            add(element, rule.selector, "kept");
        }
      } catch (_) {}
    }
    return {
      hiddenCount: roots.length,
      shownOnPage,
      hasTemporaryShows: [...temporaryShows.values()].some(
        (record) => record.kind !== "keep",
      ),
      areas: items,
    };
  }
  async function changeArea(id, action) {
    if (!["show_once", "keep", "hide"].includes(action))
      throw new Error("Invalid area action.");
    var target = reviewTargets.get(id);
    if (
      !target ||
      !target.element.isConnected ||
      areaIdentity(target.element) !== target.identity
    )
      throw new Error("This area changed. Reopen the Safari popup.");
    if (
      !isProtectionEnabled() ||
      getCurrentSitePolicy() === "allow" ||
      !safe(target.element)
    )
      throw new Error("Enable protection and choose Default or Block first.");
    if (action !== "show_once") {
      var response = await AFShared.callApi(api.runtime, "sendMessage", {
        action: "save_dom_decision",
        hostname: location.hostname,
        selector: target.selector,
        layout: getResponsiveLayout(),
        decision: action === "keep" ? "show" : "hide",
        features: AFShared.extractDomFeatures(target.element),
      });
      if (!response || response.error || response.status !== "saved")
        throw new Error(
          response?.error || "Could not confirm the saved choice.",
        );
      // Do not apply an asynchronous response to a replacement creative.
      if (
        !target.element.isConnected ||
        areaIdentity(target.element) !== target.identity
      )
        throw new Error(
          "The area changed while saving. Reload before reviewing it again.",
        );
    }
    if (action === "hide") {
      shownOnPage = false;
      temporaryShows.delete(target.element);
      hidden.hide(target.element, {
        selector: target.selector,
        source: "saved",
      });
    } else {
      rememberTemporary(
        target.element,
        target.selector,
        action === "keep" ? "keep" : "once",
      );
      restoreArea(target.element);
    }
    schedule(document);
    return reviewState();
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
      if (saved.source === "builtin")
        return applicable(element, { selector: saved.selector });
      if (saved.source === "automatic") {
        if (
          getCurrentSitePolicy() === "allow" ||
          !safe(element) ||
          !AFShared.iosFeatureEnabled(
            AF_CONFIG.appSettings,
            "content.dom-static-blocker",
          ) ||
          saved.layout !== getResponsiveLayout() ||
          exception(element, saved.selector)
        )
          return false;
        if (!window.AF_getBannerInspection) return false;
        var inspection = AF_getBannerInspection(element, saved.rect);
        return AFShared.shouldAutoHideIosBanner(inspection.features, {
          policy: getCurrentSitePolicy(),
          evidence: inspection.evidence,
        });
      }
      return rules().some(
        (rule) =>
          applicable(element, rule) &&
          (typeof rule === "string" ? rule : rule.selector) === saved.selector,
      );
    });
  }
  function apply(root) {
    if (
      !AFShared.iosFeatureEnabled(
        AF_CONFIG.appSettings,
        "content.dom-static-blocker",
      ) ||
      getCurrentSitePolicy() === "allow"
    )
      return;
    var count = 0;
    var builtins = AFShared.iosBuiltinDomSelectors(
      window.location.hostname,
    ).map((selector) => ({ selector, source: "builtin" }));
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
    isHidden: function (element) {
      for (var node = element; node; node = node.parentElement)
        if (hidden.has(node)) return true;
      return false;
    },
    hide: function (element, selector) {
      return safe(element) && hidden.hide(element, { selector });
    },
    hideAutomatic: function (element, selector, inspection) {
      if (
        !safe(element) ||
        getCurrentSitePolicy() === "allow" ||
        !AFShared.iosFeatureEnabled(
          AF_CONFIG.appSettings,
          "content.dom-static-blocker",
        ) ||
        exception(element, selector) ||
        !inspection ||
        !AFShared.shouldAutoHideIosBanner(inspection.features, {
          policy: getCurrentSitePolicy(),
          evidence: inspection.evidence,
        })
      )
        return false;
      return hidden.hide(element, {
        selector,
        source: "automatic",
        layout: getResponsiveLayout(),
        rect: inspection.features.rect,
      });
    },
    state: reviewState,
    changeArea,
    setVisibility: function (visibility) {
      shownOnPage = visibility === "show";
      if (shownOnPage) {
        rootEntries().forEach(({ element, metadata }) =>
          rememberTemporary(element, metadata.selector, "once"),
        );
        hidden.reconcile(() => false);
      } else {
        temporaryShows.clear();
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
          if (
            change.attributeName === "style" &&
            hidden.has(change.target) &&
            change.target.style.getPropertyValue("display") === "none" &&
            change.target.style.getPropertyPriority("display") === "important"
          )
            return;
          schedule(change.target);
        });
      }).observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "id", "href", "src", "srcset"],
      });
    api.storage.onChanged.addListener(function (changes, area) {
      if (
        area === "local" &&
        [
          "appSettings",
          "whitelist",
          "blacklist",
          "userCustomRules",
          "userElementExceptions",
          "afsAllowedDomSelectors",
        ].some((key) => key in changes)
      )
        schedule(document);
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
    document.addEventListener(
      "load",
      function (event) {
        if (["IMG", "IFRAME", "VIDEO"].includes(event.target?.tagName))
          schedule(event.target.parentElement || event.target);
      },
      true,
    );
  });
})();
