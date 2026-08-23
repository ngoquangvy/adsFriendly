var AdsFriendlyContent = (() => {
  // src/content/spy-injector.js
  function injectSpy(settings = {}) {
    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("injected_spy.js");
      script.dataset.protectionMode = settings.protectionMode || "safe";
      script.dataset.protectionEnabled = String(settings.enabled !== false);
      (document.head || document.documentElement).appendChild(script);
      script.onload = () => script.remove();
    } catch (error) {
      console.error("[AdsFriendly] Injection failed:", error);
    }
  }

  // src/shared/url.js
  function parseUrl(value, base) {
    try {
      return new URL(value, base);
    } catch {
      return null;
    }
  }
  function sameHostnameOrSubdomain(hostname, parent) {
    if (!hostname || !parent) return false;
    const h = hostname.toLowerCase();
    const p = parent.toLowerCase();
    return h === p || h.endsWith(`.${p}`);
  }

  // src/navigation/shared/intent-classifier.js
  var STRONG_TRACKING_KEYS = /* @__PURE__ */ new Set([
    "adid",
    "aff_id",
    "affiliate",
    "bannerid",
    "clickid",
    "gclid",
    "pop_id",
    "popunder",
    "zoneid"
  ]);
  var PROMOTIONAL_TOKEN_RE = /(^|[^a-z0-9])(?:ad|ads|advert|banner|casino|hitclub|promo|sponsor|bet)([^a-z0-9]|$)/i;
  function classifyNavigationIntent({
    intentUrl,
    sourceUrl,
    evidence = ""
  } = {}) {
    const intent = parseUrl(intentUrl);
    const source = parseUrl(sourceUrl);
    const promotionalEvidence = PROMOTIONAL_TOKEN_RE.test(evidence);
    if (!intent || !/^https?:$/.test(intent.protocol)) {
      return {
        likelyAd: promotionalEvidence,
        reasons: promotionalEvidence ? ["promotional_element_or_destination"] : []
      };
    }
    const external = !source || !(sameHostnameOrSubdomain(intent.hostname, source.hostname) || sameHostnameOrSubdomain(source.hostname, intent.hostname));
    if (!external) return { likelyAd: false, reasons: [] };
    const keys = [...intent.searchParams.keys()].map((key) => key.toLowerCase());
    const strongTracking = keys.some((key) => STRONG_TRACKING_KEYS.has(key));
    const marketingCount = keys.filter((key) => key.startsWith("utm_")).length;
    const tokenEvidence = `${intent.hostname} ${intent.pathname} ${evidence}`;
    const promotionalToken = PROMOTIONAL_TOKEN_RE.test(tokenEvidence);
    const reasons = [];
    if (strongTracking) reasons.push("strong_tracking_parameter");
    if (marketingCount >= 2) reasons.push("multiple_campaign_parameters");
    if (promotionalToken) reasons.push("promotional_element_or_destination");
    return {
      likelyAd: reasons.length > 0,
      reasons
    };
  }

  // src/navigation/content/intent-tracker.js
  function startIntentTracker() {
    const recordIntent = (event) => {
      if (!event.isTrusted) return;
      try {
        const link = event.target?.closest?.("a[href]");
        const intent = classifyNavigationIntent({
          intentUrl: link?.href,
          sourceUrl: location.href,
          evidence: buildClickEvidence(link, event.target)
        });
        chrome.runtime.sendMessage({
          type: "TRUSTED_CLICK",
          intentUrl: link?.href || null,
          sourceUrl: location.href,
          intentKind: intent.likelyAd ? "promotional" : "navigation",
          intentReasons: intent.reasons
        });
      } catch {
      }
    };
    const onKeydown = (event) => {
      if (event.key === "Enter") recordIntent(event);
    };
    document.addEventListener("pointerdown", recordIntent, true);
    document.addEventListener("contextmenu", recordIntent, true);
    document.addEventListener("keydown", onKeydown, true);
    return () => {
      document.removeEventListener("pointerdown", recordIntent, true);
      document.removeEventListener("contextmenu", recordIntent, true);
      document.removeEventListener("keydown", onKeydown, true);
    };
  }
  function buildClickEvidence(link, target) {
    return [
      link?.id,
      typeof link?.className === "string" ? link.className : "",
      link?.title,
      target?.id,
      typeof target?.className === "string" ? target.className : "",
      target?.getAttribute?.("alt"),
      target?.getAttribute?.("title")
    ].filter(Boolean).join(" ");
  }

  // src/dom/actions.js
  var BLOCKING_STRATEGIES = {
    STEALTH(el) {
      el.setAttribute(HIDDEN_MARKER, "true");
      if (el.style.getPropertyValue("opacity") === "0" && el.style.getPropertyValue("visibility") === "hidden")
        return;
      el.style.setProperty("opacity", "0", "important");
      el.style.setProperty("visibility", "hidden", "important");
      el.style.setProperty("pointer-events", "none", "important");
    }
  };
  var HIDDEN_MARKER = "data-adsfriendly-rule-hidden";
  var VISIBILITY_PROPERTIES = ["opacity", "visibility", "pointer-events"];
  function captureInlineVisibility(element) {
    return {
      marker: element.getAttribute(HIDDEN_MARKER),
      properties: Object.fromEntries(
        VISIBILITY_PROPERTIES.map((property) => [
          property,
          {
            value: element.style.getPropertyValue(property),
            priority: element.style.getPropertyPriority(property)
          }
        ])
      )
    };
  }
  function restoreInlineVisibility(element, snapshot) {
    if (!element || !snapshot) return;
    const properties = snapshot.properties || snapshot;
    for (const property of VISIBILITY_PROPERTIES) {
      const previous = properties[property];
      if (previous?.value) {
        element.style.setProperty(property, previous.value, previous.priority);
      } else {
        element.style.removeProperty(property);
      }
    }
    if (snapshot.marker == null) element.removeAttribute(HIDDEN_MARKER);
    else element.setAttribute(HIDDEN_MARKER, snapshot.marker);
  }
  function isHiddenByAdsFriendly(element) {
    if (!element?.closest) return false;
    return !!(element.closest(`[${HIDDEN_MARKER}]`) || element.querySelector?.(`[${HIDDEN_MARKER}]`));
  }

  // src/shared/decision.js
  var DECISION_ACTIONS = Object.freeze({
    ALLOW: "allow",
    BLOCK: "block",
    TOAST: "toast",
    OBSERVE: "observe"
  });
  function createDecision(action, options = {}) {
    return {
      action,
      confidence: clampConfidence(options.confidence ?? 0),
      reasons: Array.isArray(options.reasons) ? options.reasons : [],
      target: options.target || null,
      metadata: options.metadata || {}
    };
  }
  function clampConfidence(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  // src/dom/decision.js
  function decideDomCandidate(features) {
    const reasons = [];
    let score = 0;
    if (!features.visible) {
      return createDecision(DECISION_ACTIONS.OBSERVE, {
        confidence: 0,
        reasons: ["not_visible"]
      });
    }
    if (features.inProtectedArea) {
      return createDecision(DECISION_ACTIONS.OBSERVE, {
        confidence: 0.1,
        reasons: ["protected_area"]
      });
    }
    if (features.signals.classHasAdToken) {
      score += 0.35;
      reasons.push("class_ad_token");
    }
    if (features.signals.idHasAdToken) {
      score += 0.35;
      reasons.push("id_ad_token");
    }
    if (features.signals.idLooksAdSlot) {
      score += 0.24;
      reasons.push("ad_slot_id");
    }
    if (features.signals.classHasAdToken && features.signals.idHasAdToken) {
      score += 0.08;
      reasons.push("class_and_id_ad_tokens");
    }
    if (features.signals.hrefLooksAdLike) {
      score += 0.25;
      reasons.push("ad_like_href");
    }
    if (features.signals.hrefHostLooksCommercial) {
      score += 0.18;
      reasons.push("commercial_or_tracking_host");
    }
    if (features.linkExternal) {
      score += 0.12;
      reasons.push("external_link");
    }
    if (features.linkExternal && (features.signals.classHasAdToken || features.signals.idHasAdToken)) {
      score += 0.2;
      reasons.push("external_link_with_ad_token");
    }
    if (features.fixedOrSticky) {
      score += 0.15;
      reasons.push("fixed_or_sticky");
    }
    if (features.rect.areaRatio > 0.08 && features.rect.areaRatio < 0.45) {
      score += 0.12;
      reasons.push("banner_sized_area");
    }
    if (features.compactBannerShape) {
      score += 0.12;
      reasons.push("compact_banner_shape");
    }
    if (features.billboardShape) {
      score += 0.12;
      reasons.push("billboard_ad_shape");
    }
    if (features.tallSidebarShape) {
      score += 0.12;
      reasons.push("sidebar_ad_shape");
    }
    if (features.tag === "iframe" && (features.signals.idHasAdToken || features.signals.idLooksAdSlot)) {
      score += 0.18;
      reasons.push("iframe_with_ad_slot_id");
    }
    if (features.signals.srcIsImageCdn && features.signals.classHasAdToken) {
      score += 0.12;
      reasons.push("cdn_image_with_ad_class");
    }
    if (features.descendants.externalAdLinkCount > 0) {
      score += 0.22;
      reasons.push("descendant_external_ad_link");
    }
    if (features.descendants.imageCdnCount > 0 && (features.signals.classHasAdToken || features.signals.idHasAdToken)) {
      score += 0.12;
      reasons.push("descendant_cdn_media_with_ad_token");
    }
    if (features.descendants.iframeCount > 0 && (features.signals.classHasAdToken || features.signals.idHasAdToken)) {
      score += 0.12;
      reasons.push("descendant_iframe_with_ad_token");
    }
    if (features.inNavigationArea && features.navAdLinkRatio >= 0.8) {
      score += 0.2;
      reasons.push("ad_heavy_navigation_area");
    }
    if (features.textLength > 500) {
      score -= 0.25;
      reasons.push("large_text_content");
    }
    const confidence = Math.max(0, Math.min(1, score));
    if (confidence >= 0.78) {
      return createDecision(DECISION_ACTIONS.BLOCK, { confidence, reasons });
    }
    if (confidence >= 0.55) {
      return createDecision(DECISION_ACTIONS.TOAST, { confidence, reasons });
    }
    return createDecision(DECISION_ACTIONS.OBSERVE, { confidence, reasons });
  }

  // src/dom/features.js
  var AD_TOKEN_RE = /(^|[-_])(?:ad|ads|adv|advert|banner|promo|sponsor|popup|preload)([-_]|$)/i;
  var PROTECTED_SELECTOR = 'nav, [role="navigation"], form, [data-testid*="login" i]';
  var NAV_SELECTOR = 'nav, [role="navigation"]';
  function extractDomFeatures(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const link = element.closest("a[href]");
    const src = element.currentSrc || element.src || "";
    const href = link?.href || element.href || "";
    const idTokens = tokenize(element.id);
    const classTokens = tokenize(
      typeof element.className === "string" ? element.className : ""
    );
    const parent = element.parentElement;
    const descendants = inspectDescendants(element);
    const navRoot = element.closest(NAV_SELECTOR);
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      className: typeof element.className === "string" ? element.className : "",
      idTokens,
      classTokens,
      src,
      srcHost: safeHost(src),
      href,
      hrefHost: safeHost(href),
      alt: element.alt || "",
      title: element.title || "",
      textLength: (element.textContent || "").trim().length,
      rect: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        area: Math.round(rect.width * rect.height),
        areaRatio: viewportArea() ? rect.width * rect.height / viewportArea() : 0
      },
      style: {
        position: style.position,
        display: style.display,
        visibility: style.visibility,
        opacity: Number.parseFloat(style.opacity || "1"),
        zIndex: style.zIndex,
        maxWidth: style.maxWidth
      },
      visible: isVisible(element, rect, style),
      fixedOrSticky: style.position === "fixed" || style.position === "sticky",
      absoluteOrFixed: style.position === "absolute" || style.position === "fixed",
      inProtectedArea: !!element.closest(PROTECTED_SELECTOR),
      inNavigationArea: !!navRoot,
      navAdLinkRatio: navRoot ? getAdLinkRatio(navRoot) : 0,
      linkExternal: href ? safeHost(href) !== location.hostname : false,
      compactBannerShape: isCompactBanner(rect),
      billboardShape: isBillboard(rect),
      tallSidebarShape: isTallSidebar(rect),
      descendants,
      ancestry: getAncestry(element),
      siblings: getSiblingSummary(element),
      parent: parent ? {
        tag: parent.tagName.toLowerCase(),
        id: parent.id || "",
        className: typeof parent.className === "string" ? parent.className : "",
        childCount: parent.children.length,
        inProtectedArea: !!parent.closest(PROTECTED_SELECTOR)
      } : null,
      signals: {
        idHasAdToken: tokensHaveAdSignal(idTokens),
        idLooksAdSlot: looksAdSlotId(element.id),
        classHasAdToken: tokensHaveAdSignal(classTokens),
        srcIsImageCdn: isImageCdn(src),
        hrefLooksAdLike: looksAdLikeUrl(href),
        hrefHostLooksCommercial: looksCommercialHost(href),
        descendantsHaveAdSignals: descendants.externalAdLinkCount > 0 || descendants.imageCdnCount > 0 || descendants.iframeCount > 0,
        hasAltOrTitle: !!(element.alt || element.title)
      }
    };
  }
  function getSmallestSafeDomTarget(element, features) {
    const link = element.closest("a[href]");
    if (link && features.linkExternal && link.children.length <= 2 && !link.closest(PROTECTED_SELECTOR)) {
      return link;
    }
    return element;
  }
  function buildDomSelector(element) {
    if (!element?.tagName) return null;
    const tag = element.tagName.toLowerCase();
    const dynamicAdIdSelector = buildDynamicAdIdSelector(element);
    if (dynamicAdIdSelector) return dynamicAdIdSelector;
    if (element.id && AD_TOKEN_RE.test(element.id))
      return `#${cssEscape(element.id)}`;
    const className = typeof element.className === "string" ? element.className.split(/\s+/).find((token) => AD_TOKEN_RE.test(token)) : "";
    if (className) return `${tag}.${cssEscape(className)}`;
    if (element.id && !/\d{5,}/.test(element.id))
      return `#${cssEscape(element.id)}`;
    const hrefHost = safeHost(element.getAttribute?.("href") || element.href);
    if (tag === "a" && hrefHost)
      return `a[href*="${cssAttributeValue(`//${hrefHost}`)}"]`;
    const srcHost = safeHost(
      element.getAttribute?.("src") || element.currentSrc || element.src
    );
    if (["img", "iframe"].includes(tag) && srcHost)
      return `${tag}[src*="${cssAttributeValue(`//${srcHost}`)}"]`;
    const labelledSelector = buildLabelSelector(element, tag);
    if (labelledSelector) return labelledSelector;
    return buildStructuralSelector(element);
  }
  function buildDynamicAdIdSelector(element) {
    if (!element?.tagName || !element.id) return null;
    const match = element.id.match(
      /^((?:ad|ads|adv|advert|banner|promo|sponsor|popup)[-_])(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{5,}$/i
    );
    if (!match) return null;
    return `${element.tagName.toLowerCase()}[id^="${cssAttributeValue(match[1])}"]`;
  }
  function tokensHaveAdSignal(tokens) {
    return tokens.some((token) => AD_TOKEN_RE.test(token));
  }
  function looksAdLikeUrl(url = "") {
    const value = url.toLowerCase();
    return /(?:[?&](?:utm_|aff_|clickid|adid|zoneid|bannerid)|\/(?:ad|ads|adv|advert|banner)(?:\/|\.|-|_))/i.test(
      value
    );
  }
  function inspectDescendants(element) {
    const links = Array.from(element.querySelectorAll?.("a[href]") || []).slice(
      0,
      40
    );
    const images = Array.from(element.querySelectorAll?.("img, iframe") || []).slice(0, 40).map((node) => ({
      tag: node.tagName.toLowerCase(),
      src: node.currentSrc || node.src || "",
      srcHost: safeHost(node.currentSrc || node.src || "")
    }));
    const externalLinks = links.filter(
      (link) => safeHost(link.href) !== location.hostname
    );
    const externalAdLinks = externalLinks.filter((link) => {
      const text = [
        link.id,
        typeof link.className === "string" ? link.className : "",
        link.href,
        link.textContent || ""
      ].join(" ");
      return tokensHaveAdSignal(tokenize(text)) || looksAdLikeUrl(link.href) || looksCommercialHost(link.href);
    });
    return {
      childCount: element.children?.length || 0,
      linkCount: links.length,
      externalLinkCount: externalLinks.length,
      externalAdLinkCount: externalAdLinks.length,
      imageCount: images.filter((item) => item.tag === "img").length,
      iframeCount: images.filter((item) => item.tag === "iframe").length,
      imageCdnCount: images.filter((item) => isImageCdn(item.src)).length,
      hrefHosts: uniqueHosts(externalLinks.map((link) => safeHost(link.href))),
      srcHosts: uniqueHosts(images.map((item) => item.srcHost))
    };
  }
  function getAdLinkRatio(root) {
    const links = Array.from(root.querySelectorAll?.("a[href]") || []);
    if (links.length < 3) return 0;
    const adLinks = links.filter((link) => {
      const value = [
        link.id,
        typeof link.className === "string" ? link.className : "",
        link.href,
        link.textContent || ""
      ].join(" ");
      return tokensHaveAdSignal(tokenize(value)) || looksAdLikeUrl(link.href) || looksCommercialHost(link.href);
    });
    return adLinks.length / links.length;
  }
  function looksCommercialHost(url = "") {
    const host = safeHost(url);
    return /(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|adcenter|admicro|doubleclick|googlesyndication|casino|bet|88|789|fun|click|track|promo)/i.test(
      host
    );
  }
  function tokenize(value = "") {
    return String(value).split(/[^a-z0-9]+/i).filter(Boolean).map((token) => token.toLowerCase());
  }
  function safeHost(url) {
    try {
      const base = typeof location === "undefined" ? "https://adsfriendly.invalid/" : location.href;
      return new URL(url, base).hostname.toLowerCase();
    } catch {
      return "";
    }
  }
  function isImageCdn(url = "") {
    const host = safeHost(url);
    return /(?:googleusercontent\.com|gstatic\.com|cloudfront\.net|akamaihd\.net|imgur\.com|cdn)/i.test(
      host
    );
  }
  function isCompactBanner(rect) {
    return rect.width >= 250 && rect.height >= 40 && rect.height <= 140;
  }
  function isBillboard(rect) {
    return rect.width >= 600 && rect.height >= 90 && rect.height <= 320;
  }
  function isTallSidebar(rect) {
    return rect.width >= 160 && rect.width <= 360 && rect.height >= 240;
  }
  function looksAdSlotId(id = "") {
    return /^(?:ads?|adv|advert|banner|native[-_]?ad|ad[-_]?place)(?:[-_]|$)/i.test(
      id
    );
  }
  function isVisible(element, rect, style) {
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number.parseFloat(style.opacity || "1") > 0.05 && element.getClientRects().length > 0;
  }
  function viewportArea() {
    return window.innerWidth * window.innerHeight;
  }
  function cssEscape(value) {
    if (typeof window !== "undefined" && window.CSS?.escape)
      return window.CSS.escape(value);
    return String(value).replace(/["\\#.;:[\],>+~*='()]/g, "\\$&");
  }
  function cssAttributeValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  function buildLabelSelector(element, tag) {
    for (const attribute of ["alt", "title", "aria-label"]) {
      const value = String(element.getAttribute?.(attribute) || "").trim();
      if (value.length >= 3 && value.length <= 120) {
        return `${tag}[${attribute}="${cssAttributeValue(value)}"]`;
      }
    }
    return null;
  }
  function buildStructuralSelector(element) {
    const segments = [];
    let current = element;
    while (current?.tagName && segments.length < 5) {
      const tag = current.tagName.toLowerCase();
      if (["html", "body"].includes(tag)) break;
      if (current.id && !/\d{5,}/.test(current.id)) {
        segments.unshift(`#${cssEscape(current.id)}`);
        return segments.join(" > ");
      }
      const parent = current.parentElement;
      let segment = tag;
      if (parent?.children) {
        const sameTag = Array.from(parent.children).filter(
          (child) => child.tagName?.toLowerCase() === tag
        );
        const index = sameTag.indexOf(current);
        if (sameTag.length > 1 && index >= 0)
          segment += `:nth-of-type(${index + 1})`;
      }
      segments.unshift(segment);
      current = parent;
    }
    return segments.length >= 2 ? segments.join(" > ") : null;
  }
  function uniqueHosts(hosts) {
    return [...new Set(hosts.filter(Boolean))].slice(0, 12);
  }
  function getAncestry(element) {
    const chain = [];
    let current = element.parentElement;
    while (current && chain.length < 5 && current !== document.documentElement) {
      chain.push({
        tag: current.tagName.toLowerCase(),
        id: current.id || "",
        className: typeof current.className === "string" ? current.className : "",
        role: current.getAttribute("role") || "",
        childCount: current.children.length
      });
      current = current.parentElement;
    }
    return chain;
  }
  function getSiblingSummary(element) {
    const siblings = Array.from(element.parentElement?.children || []).filter(
      (node) => node !== element
    );
    return {
      count: siblings.length,
      adLikeCount: siblings.filter(
        (node) => tokensHaveAdSignal(
          tokenize(
            [
              node.id,
              typeof node.className === "string" ? node.className : "",
              node.getAttribute?.("href") || "",
              node.getAttribute?.("src") || ""
            ].join(" ")
          )
        )
      ).length,
      tags: [
        ...new Set(siblings.map((node) => node.tagName.toLowerCase()))
      ].slice(0, 8)
    };
  }

  // src/dom/toast.js
  var TOAST_ID = "adsfriendly-dom-toast";
  var HIGHLIGHT_ID = "adsfriendly-dom-highlight";
  var TOAST_TIMEOUT_MS = 1e4;
  var HIDDEN_TOAST_TIMEOUT_MS = 5e3;
  var queuedCandidates = [];
  var active = null;
  var hideTimer = null;
  var highlightFrame = null;
  function showDomCandidateToast(candidate, handlers) {
    enqueueOrShow({ candidate, handlers, state: "review" });
  }
  function showDomHiddenToast(candidate, handlers) {
    enqueueOrShow({ candidate, handlers, state: "hidden" });
  }
  function enqueueOrShow(entry) {
    if (!isEntryReviewable(entry)) return;
    if (active) {
      if (queuedCandidates.length < 8) queuedCandidates.push(entry);
      return;
    }
    active = entry;
    renderActiveToast();
  }
  function renderActiveToast() {
    if (!active) return;
    if (!isEntryReviewable(active)) {
      hideDomToast();
      return;
    }
    const toast = ensureToast();
    const label = active.candidate.features.tag.toUpperCase();
    const message = toast.querySelector(".adsfriendly-dom-message");
    const hideButton = toast.querySelector(".adsfriendly-dom-hide");
    const allowButton = toast.querySelector(".adsfriendly-dom-allow");
    const isSavedRuleSummary = active.candidate.isSavedRuleSummary === true;
    toast.querySelector(".adsfriendly-dom-scope").textContent = isSavedRuleSummary ? "PAGE" : "ELEMENT";
    if (active.state === "error") {
      message.textContent = saveFailureMessage(active.error);
      message.title = active.error?.message || "Could not save this rule";
      hideButton.hidden = true;
      allowButton.textContent = "Show";
      allowButton.disabled = false;
      clearHighlight();
    } else if (active.state === "restoring") {
      message.textContent = `${label} restoring\u2026`;
      message.title = "Waiting for settings storage confirmation";
      hideButton.hidden = true;
      allowButton.textContent = "Restoring\u2026";
      allowButton.disabled = true;
      clearHighlight();
    } else if (active.state === "restore-error") {
      message.textContent = "Restore failed \xB7 saved rule kept";
      message.title = active.error?.message || "Could not restore this rule";
      hideButton.hidden = true;
      allowButton.textContent = "Retry";
      allowButton.disabled = false;
      clearHighlight();
    } else if (active.state === "saving") {
      message.textContent = `${label} hidden \xB7 saving\u2026`;
      message.title = "Waiting for settings storage confirmation";
      hideButton.hidden = true;
      allowButton.textContent = "Show";
      allowButton.disabled = false;
      clearHighlight();
    } else if (active.state === "hidden") {
      const hiddenCount = active.candidate.hiddenCount || 1;
      message.textContent = isSavedRuleSummary ? `${hiddenCount} element${hiddenCount === 1 ? "" : "s"} hidden` : `${label} hidden \xB7 saved`;
      message.title = isSavedRuleSummary ? `Hidden by ${active.candidate.savedRuleCount || 1} saved rule${active.candidate.savedRuleCount === 1 ? "" : "s"}` : "Hidden by your saved rule";
      hideButton.hidden = true;
      allowButton.textContent = isSavedRuleSummary ? "Show all" : "Show";
      allowButton.disabled = false;
      clearHighlight();
    } else {
      const confidence = Math.round(active.candidate.decision.confidence * 100);
      message.textContent = `${label} \xB7 ${confidence}%`;
      message.title = active.candidate.decision.reasons?.join(", ") || "Heuristic DOM signals";
      hideButton.hidden = false;
      hideButton.textContent = "Hide";
      allowButton.textContent = "Keep";
      allowButton.disabled = false;
      highlightCandidate(active.candidate);
    }
    toast.classList.remove("adsfriendly-dom-hidden");
    scheduleHide();
  }
  function ensureToast() {
    let toast = document.getElementById(TOAST_ID);
    if (toast) return toast;
    toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.className = "adsfriendly-dom-hidden";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `
    <span class="adsfriendly-dom-scope">ELEMENT</span>
    <span class="adsfriendly-dom-message"></span>
    <button class="adsfriendly-dom-hide" type="button">Hide</button>
    <button class="adsfriendly-dom-allow" type="button">Keep</button>
    <button class="adsfriendly-dom-close" type="button">x</button>
  `;
    const style = document.createElement("style");
    style.textContent = `
    #${TOAST_ID} {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: min(390px, calc(100vw - 32px));
      padding: 8px 9px 8px 12px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.96);
      color: #f8fafc;
      box-shadow: 0 10px 30px rgba(0,0,0,0.32);
      font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      opacity: 1;
      transition: opacity 160ms ease, transform 160ms ease;
    }
    #${TOAST_ID}.adsfriendly-dom-hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px);
    }
    #${TOAST_ID} .adsfriendly-dom-message {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${TOAST_ID} .adsfriendly-dom-scope {
      padding: 3px 5px;
      border-radius: 5px;
      background: rgba(96, 165, 250, 0.16);
      color: #93c5fd;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.04em;
      flex: 0 0 auto;
    }
    #${TOAST_ID} button {
      border: 0;
      background: transparent;
      color: #60a5fa;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      padding: 5px 6px;
      flex: 0 0 auto;
    }
    #${TOAST_ID} .adsfriendly-dom-allow,
    #${TOAST_ID} .adsfriendly-dom-close {
      color: #94a3b8;
    }
    #${HIGHLIGHT_ID} {
      position: fixed;
      z-index: 2147483646;
      pointer-events: none;
      box-sizing: border-box;
      border: 3px solid var(--adsfriendly-highlight-color, #f59e0b);
      border-radius: 4px;
      box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.72),
        0 0 16px var(--adsfriendly-highlight-color, #f59e0b);
    }
  `;
    toast.querySelector(".adsfriendly-dom-hide").onclick = () => {
      if (!active || active.state !== "review") return;
      const current = active;
      current.state = "saving";
      clearHighlight();
      renderActiveToast();
      current.pendingHide = Promise.resolve(
        current.handlers?.onHide?.(current.candidate)
      ).then(() => {
        if (current.state === "saving") {
          current.state = "hidden";
          if (active === current) renderActiveToast();
        }
        return true;
      }).catch((error) => {
        if (current.state === "saving") {
          current.error = error;
          current.state = "error";
          if (active === current) renderActiveToast();
        }
        return false;
      });
    };
    toast.querySelector(".adsfriendly-dom-allow").onclick = () => {
      if (!active) return;
      const current = active;
      if (current.state === "restoring") return;
      const isRestore = ["saving", "hidden", "error", "restore-error"].includes(
        current.state
      );
      const handler = isRestore ? current.handlers?.onShow : current.handlers?.onAllow;
      if (!isRestore) {
        Promise.resolve(handler?.(current.candidate)).catch(() => {
        });
        hideDomToast();
        return;
      }
      current.state = "restoring";
      current.error = null;
      renderActiveToast();
      Promise.resolve(current.pendingHide).then(() => handler?.(current.candidate)).then(() => {
        if (active === current) hideDomToast();
      }).catch((error) => {
        current.error = error;
        current.state = "restore-error";
        if (active === current) renderActiveToast();
      });
    };
    toast.querySelector(".adsfriendly-dom-close").onclick = hideDomToast;
    toast.addEventListener("mouseenter", pauseHide);
    toast.addEventListener("mouseleave", scheduleHide);
    toast.addEventListener("focusin", pauseHide);
    toast.addEventListener("focusout", scheduleHide);
    (document.head || document.documentElement).appendChild(style);
    (document.body || document.documentElement).appendChild(toast);
    return toast;
  }
  function saveFailureMessage(error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (/quota|storage is full|bytes/.test(message))
      return "Hidden once \xB7 storage full";
    if (/invalidated|receiving end|message port|could not establish/.test(message))
      return "Hidden once \xB7 reload extension";
    if (/ignored|outdated|could not save settings/.test(message))
      return "Hidden once \xB7 background outdated";
    return "Hidden once \xB7 save failed";
  }
  function highlightCandidate(candidate) {
    clearHighlight();
    const target = candidate.target || candidate.element;
    if (!target?.isConnected) return;
    const highlight = document.createElement("div");
    highlight.id = HIGHLIGHT_ID;
    highlight.style.setProperty(
      "--adsfriendly-highlight-color",
      highlightColor(candidate.decision.confidence)
    );
    (document.body || document.documentElement).appendChild(highlight);
    const update = () => {
      if (!active || !target.isConnected || !highlight.isConnected) return;
      if (isHiddenByAdsFriendly(target)) {
        hideDomToast();
        return;
      }
      const rect = target.getBoundingClientRect();
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(window.innerWidth, rect.right);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      highlight.style.left = `${left}px`;
      highlight.style.top = `${top}px`;
      highlight.style.width = `${Math.max(0, right - left)}px`;
      highlight.style.height = `${Math.max(0, bottom - top)}px`;
      highlight.hidden = right <= left || bottom <= top;
      highlightFrame = requestAnimationFrame(update);
    };
    update();
  }
  function isEntryReviewable(entry) {
    if (entry.state !== "review") return true;
    const target = entry.candidate.target || entry.candidate.element;
    if (!target?.isConnected || isHiddenByAdsFriendly(target)) return false;
    const rect = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number.parseFloat(style.opacity || "1") > 0.05;
  }
  function highlightColor(confidence) {
    if (confidence >= 0.9) return "#ef4444";
    if (confidence >= 0.75) return "#f59e0b";
    return "#eab308";
  }
  function clearHighlight() {
    if (highlightFrame) cancelAnimationFrame(highlightFrame);
    highlightFrame = null;
    document.getElementById(HIGHLIGHT_ID)?.remove();
  }
  function scheduleHide() {
    pauseHide();
    if (active) {
      if (active.state === "restoring") return;
      const timeout = active.state === "hidden" ? HIDDEN_TOAST_TIMEOUT_MS : TOAST_TIMEOUT_MS;
      hideTimer = setTimeout(hideDomToast, timeout);
    }
  }
  function pauseHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
  }
  function hideDomToast() {
    const toast = document.getElementById(TOAST_ID);
    if (toast) toast.classList.add("adsfriendly-dom-hidden");
    pauseHide();
    clearHighlight();
    active = null;
    const next = queuedCandidates.shift();
    if (next) setTimeout(() => enqueueOrShow(next), 180);
  }

  // src/runtime/feature-catalog.js
  var PROTECTION_MODES = Object.freeze({
    SAFE: "safe",
    ASSIST: "assist",
    AUTO: "auto"
  });
  var CAPABILITIES = Object.freeze({
    CORE_MESSAGING: "core.messaging",
    CORE_MAINTENANCE: "core.maintenance",
    NAVIGATION_GUARD: "navigation.guard",
    NAVIGATION_REVERSE_POPUNDER: "navigation.reverse_popunder",
    NAVIGATION_INTENT: "navigation.intent",
    NAVIGATION_FEEDBACK: "navigation.feedback",
    DOM_STATIC_RULES: "dom.static_rules",
    DOM_OBSERVE: "dom.observe",
    DOM_SUGGEST: "dom.suggest",
    DOM_AUTO_HIDE: "dom.auto_hide",
    DOM_MANUAL_PICKER: "dom.manual_picker",
    LEARNING_SEED: "learning.seed",
    LEARNING_FEEDBACK: "learning.feedback",
    LEARNING_APPLY: "learning.apply_patterns",
    TELEMETRY_QUEUE: "telemetry.queue",
    MEDIA_OBSERVE: "media.observe",
    VIDEO_OBSERVE: "video.observe",
    VIDEO_AUTO_ACTION: "video.auto_action"
  });
  var C = CAPABILITIES;
  var MODE_CAPABILITIES = Object.freeze({
    [PROTECTION_MODES.SAFE]: Object.freeze([
      C.CORE_MESSAGING,
      C.CORE_MAINTENANCE,
      C.NAVIGATION_GUARD,
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.DOM_STATIC_RULES,
      C.DOM_MANUAL_PICKER,
      C.LEARNING_SEED,
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    [PROTECTION_MODES.ASSIST]: Object.freeze([
      C.CORE_MESSAGING,
      C.CORE_MAINTENANCE,
      C.NAVIGATION_GUARD,
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.DOM_STATIC_RULES,
      C.DOM_OBSERVE,
      C.DOM_SUGGEST,
      C.DOM_MANUAL_PICKER,
      C.LEARNING_SEED,
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE,
      C.MEDIA_OBSERVE,
      C.VIDEO_OBSERVE
    ]),
    [PROTECTION_MODES.AUTO]: Object.freeze([
      C.CORE_MESSAGING,
      C.CORE_MAINTENANCE,
      C.NAVIGATION_GUARD,
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.DOM_STATIC_RULES,
      C.DOM_OBSERVE,
      C.DOM_SUGGEST,
      C.DOM_AUTO_HIDE,
      C.DOM_MANUAL_PICKER,
      C.LEARNING_SEED,
      C.LEARNING_FEEDBACK,
      C.LEARNING_APPLY,
      C.TELEMETRY_QUEUE,
      C.MEDIA_OBSERVE,
      C.VIDEO_OBSERVE,
      C.VIDEO_AUTO_ACTION
    ])
  });
  var FEATURE_CATALOG = Object.freeze([
    feature("background.message-router", "background", C.CORE_MESSAGING, [
      C.CORE_MAINTENANCE,
      C.NAVIGATION_INTENT,
      C.NAVIGATION_FEEDBACK,
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("background.navigation-guard", "background", C.NAVIGATION_GUARD, [
      C.NAVIGATION_REVERSE_POPUNDER,
      C.NAVIGATION_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("background.telemetry-flush", "background", C.TELEMETRY_QUEUE),
    feature("background.memory-cleanup", "background", C.CORE_MAINTENANCE),
    feature("background.pattern-seed", "background", C.LEARNING_SEED),
    feature(
      "background.training-store-migration",
      "background",
      C.CORE_MAINTENANCE
    ),
    feature("background.settings-package-seed", "background", C.CORE_MAINTENANCE),
    feature("content.spy-injector", "content", C.MEDIA_OBSERVE),
    feature("content.youtube-cleaner", "content", C.DOM_STATIC_RULES),
    feature("content.navigation-intent", "content", C.NAVIGATION_INTENT),
    feature("content.navigation-toast", "content", C.NAVIGATION_FEEDBACK),
    feature("content.dom-static-blocker", "content", C.DOM_STATIC_RULES, [
      C.LEARNING_FEEDBACK,
      C.TELEMETRY_QUEUE
    ]),
    feature("content.dom-candidate-collector", "content", C.DOM_OBSERVE, [
      C.DOM_SUGGEST,
      C.DOM_AUTO_HIDE,
      C.LEARNING_FEEDBACK
    ]),
    feature("content.dom-learned-blocker", "content", C.LEARNING_APPLY, [
      C.DOM_AUTO_HIDE
    ]),
    feature("video.surgeon", "video", C.VIDEO_OBSERVE, [C.VIDEO_AUTO_ACTION]),
    feature("picker.controller", "picker", C.DOM_MANUAL_PICKER, [
      C.LEARNING_FEEDBACK
    ]),
    feature("main-world.network-capture", "main-world", C.MEDIA_OBSERVE),
    feature("main-world.timer-control", "main-world", C.VIDEO_AUTO_ACTION)
  ]);
  var CAPABILITY_SET = new Set(Object.values(CAPABILITIES));
  var FEATURE_BY_ID = new Map(FEATURE_CATALOG.map((item) => [item.id, item]));
  validateCatalog();
  function getFeatureDefinition(featureId) {
    const definition = FEATURE_BY_ID.get(featureId);
    if (!definition) {
      throw new Error(
        `[FeatureRegistry] Unknown feature "${featureId}". Register it in feature-catalog.js before use.`
      );
    }
    return definition;
  }
  function getFeaturesForContext(context) {
    return FEATURE_CATALOG.filter(
      (featureItem) => featureItem.context === context
    );
  }
  function assertRegisteredCapability(capability) {
    if (!CAPABILITY_SET.has(capability)) {
      throw new Error(
        `[FeatureRegistry] Unknown capability "${capability}". Register it in feature-catalog.js before use.`
      );
    }
    return capability;
  }
  function getCapabilitiesForMode(mode) {
    const capabilities = MODE_CAPABILITIES[mode];
    if (!capabilities) {
      throw new Error(`[FeatureRegistry] Unknown protection mode "${mode}".`);
    }
    return capabilities;
  }
  function feature(id, context, startCapability, extraCapabilities = []) {
    return Object.freeze({
      id,
      context,
      startCapability,
      capabilities: Object.freeze([startCapability, ...extraCapabilities])
    });
  }
  function validateCatalog() {
    const ids = /* @__PURE__ */ new Set();
    for (const definition of FEATURE_CATALOG) {
      if (ids.has(definition.id)) {
        throw new Error(
          `[FeatureRegistry] Duplicate feature "${definition.id}".`
        );
      }
      ids.add(definition.id);
      for (const capability of definition.capabilities) {
        assertRegisteredCapability(capability);
      }
    }
    for (const [mode, capabilities] of Object.entries(MODE_CAPABILITIES)) {
      for (const capability of capabilities) {
        if (!CAPABILITY_SET.has(capability)) {
          throw new Error(
            `[FeatureRegistry] Mode "${mode}" uses unregistered capability "${capability}".`
          );
        }
      }
    }
  }

  // src/dom/collector.js
  var observed = /* @__PURE__ */ new WeakSet();
  var allowedSelectors = /* @__PURE__ */ new Set();
  var activePolicy = null;
  var scanIntervalId = null;
  var bodyObserver = null;
  var DOM_CANDIDATE_SELECTOR = [
    "img",
    "iframe",
    "a[href]",
    '[id*="ad" i]',
    '[class*="ad" i]',
    '[id*="adv" i]',
    '[class*="adv" i]',
    '[id*="banner" i]',
    '[class*="banner" i]',
    '[id*="promo" i]',
    '[class*="promo" i]',
    '[id*="sponsor" i]',
    '[class*="sponsor" i]'
  ].join(",");
  function startDomCandidateCollector(policy) {
    activePolicy = policy;
    scanIntervalId = setInterval(scanDomCandidates, 2500);
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => setTimeout(scanDomCandidates, 400)
      );
    } else {
      setTimeout(scanDomCandidates, 400);
    }
    const startObserver = () => {
      if (!activePolicy) return;
      if (!document.body) {
        setTimeout(startObserver, 100);
        return;
      }
      bodyObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) scanNode(node);
          }
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    };
    startObserver();
    return () => {
      if (scanIntervalId) clearInterval(scanIntervalId);
      scanIntervalId = null;
      bodyObserver?.disconnect();
      bodyObserver = null;
      activePolicy = null;
    };
  }
  function scanDomCandidates() {
    if (!activePolicy?.can(CAPABILITIES.DOM_OBSERVE)) return;
    scanNode(document);
  }
  function scanNode(root) {
    if (root.matches?.(DOM_CANDIDATE_SELECTOR)) evaluateElement(root);
    const candidates = root.querySelectorAll ? root.querySelectorAll(DOM_CANDIDATE_SELECTOR) : [];
    candidates.forEach(evaluateElement);
  }
  function evaluateElement(element) {
    if (observed.has(element) || element.id?.includes("adsfriendly") || isHiddenByAdsFriendly(element))
      return;
    const features = extractDomFeatures(element);
    const decision = decideDomCandidate(features);
    if (decision.action === "observe") return;
    observed.add(element);
    const target = getSmallestSafeDomTarget(element, features);
    if (isHiddenByAdsFriendly(target)) return;
    const selector = buildDomSelector(target);
    if (selector && allowedSelectors.has(selector)) return;
    const candidate = { element, target, selector, features, decision };
    if (decision.action === "block") {
      if (activePolicy?.can(CAPABILITIES.DOM_AUTO_HIDE)) {
        hideCandidate(candidate, "heuristic_block");
      } else if (activePolicy?.can(CAPABILITIES.DOM_SUGGEST)) {
        showCandidate(candidate);
      }
      return;
    }
    if (!activePolicy?.can(CAPABILITIES.DOM_SUGGEST)) return;
    showCandidate(candidate);
  }
  function showCandidate(candidate) {
    showDomCandidateToast(candidate, {
      onHide: (item) => hideCandidate(item, "user_hide"),
      onAllow: allowCandidate,
      onShow: restoreCandidate
    });
  }
  async function hideCandidate(candidate, outcome) {
    candidate.previousInlineVisibility ||= captureInlineVisibility(
      candidate.target
    );
    BLOCKING_STRATEGIES.STEALTH(candidate.target);
    if (activePolicy?.can(CAPABILITIES.LEARNING_FEEDBACK))
      recordDomSample(candidate, outcome, "ad");
    if (outcome === "user_hide") {
      if (!candidate.selector)
        throw new Error("This element does not have a reusable selector.");
      await persistCustomRule(candidate, outcome);
    }
    try {
      await chrome.runtime.sendMessage({
        type: "REPORT_AD_DENSITY",
        hostname: location.hostname,
        count: 1
      });
    } catch {
    }
  }
  function allowCandidate(candidate) {
    if (candidate.selector) allowedSelectors.add(candidate.selector);
    if (activePolicy?.can(CAPABILITIES.LEARNING_FEEDBACK))
      recordDomSample(candidate, "user_allow", "content");
  }
  async function restoreCandidate(candidate) {
    if (candidate.selector) {
      await removeCustomRule(candidate.selector);
      allowedSelectors.add(candidate.selector);
    }
    restoreInlineVisibility(candidate.target, candidate.previousInlineVisibility);
    if (activePolicy?.can(CAPABILITIES.LEARNING_FEEDBACK))
      recordDomSample(candidate, "user_show", "content");
  }
  async function persistCustomRule(candidate, outcome) {
    const rule = {
      selector: candidate.selector,
      fingerprint: {
        tag: candidate.features.tag,
        id: candidate.features.id || null,
        className: candidate.features.className || null,
        alt: candidate.features.alt || null,
        title: candidate.features.title || null,
        linkDomain: candidate.features.hrefHost || null,
        srcHost: candidate.features.srcHost || null,
        idTokens: candidate.features.idTokens,
        classTokens: candidate.features.classTokens
      },
      timestamp: Date.now(),
      timesZapped: 1,
      confidence: candidate.decision.confidence,
      source: outcome
    };
    const response = await chrome.runtime.sendMessage({
      type: "UPSERT_CUSTOM_RULES",
      hostname: location.hostname,
      rules: [rule]
    });
    assertSaved(response);
    await chrome.runtime.sendMessage({ type: "SYNC_LEARNING" });
  }
  async function removeCustomRule(selector) {
    const response = await chrome.runtime.sendMessage({
      type: "RESTORE_CUSTOM_RULES",
      hostname: location.hostname,
      selectors: [selector]
    });
    assertSaved(response);
    await chrome.runtime.sendMessage({ type: "SYNC_LEARNING" });
  }
  function assertSaved(response) {
    if (response?.status !== "saved")
      throw new Error(response?.error || "AdsFriendly could not save settings.");
  }
  async function recordDomSample(candidate, outcome, label) {
    try {
      const sample = {
        schema_version: "dataset.v1",
        sample_id: randomId(),
        unit: "dom_element",
        label,
        label_source: outcome,
        label_strength: outcome.startsWith("user_") ? "strong" : "weak",
        ad_type: "banner",
        site: {
          hostname: location.hostname,
          url: location.href.split("#")[0]
        },
        timestamp: Date.now(),
        context: {
          selector: candidate.selector,
          action: candidate.decision.action,
          confidence: candidate.decision.confidence
        },
        evidence: {
          reasons: candidate.decision.reasons,
          features: candidate.features
        },
        feedback: outcome.startsWith("user_") ? {
          user_action: outcome,
          surface: "dom_candidate_toast",
          correction: ["user_allow", "user_show"].includes(outcome) ? "false_positive" : null
        } : null,
        action: ["user_allow", "user_show"].includes(outcome) ? "allow" : "hide",
        outcome
      };
      await chrome.runtime.sendMessage({ type: "RECORD_DOM_SAMPLE", sample });
      await chrome.runtime.sendMessage({
        type: "RECORD_TELEMETRY",
        event: sample
      });
    } catch {
    }
  }
  function randomId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // src/dom/ad-selectors.js
  var STATIC_AD_SELECTORS = [
    '[id*="google_ads"]',
    '[class*="adsbygoogle"]',
    "ins.adsbygoogle",
    'iframe[src*="doubleclick"]',
    'a[href*="googleadservices.com"]',
    'a[href*="utm_"]',
    'a[href*="clickid="]',
    'a[href*="aff_id="]',
    'a[href*="javascript:hide_"]',
    'img[src*="googleusercontent.com"][title]',
    'img[src*="googleusercontent.com"][alt*="bet"]',
    'img[src*="googleusercontent.com"][alt*="win"]',
    'div[class*="popup-ad"]',
    'div[id*="popup-ad"]'
  ];
  var DANGEROUS_SELECTOR_TAGS = [
    "div",
    "span",
    "p",
    "a",
    "li",
    "ul",
    "img",
    "section"
  ];

  // src/shared/extension-context.js
  function isExtensionContextInvalidated(error) {
    return /extension context invalidated/i.test(String(error?.message || error));
  }

  // src/dom/rule-blocker.js
  var PROTECTED_SELECTOR2 = 'nav, header, [role="navigation"], form, [data-testid*="login" i]';
  var customRuleSnapshots = /* @__PURE__ */ new Map();
  var savedRuleApplications = /* @__PURE__ */ new Map();
  var suppressedCustomSelectors = /* @__PURE__ */ new Set();
  var initialCustomSelectors = null;
  var savedRuleSummaryShown = false;
  async function blockAdsOnPage() {
    const hostname = location.hostname;
    let customSelectors = [];
    let blockedCount = 0;
    let resetHistory = { oldRules: [] };
    try {
      const result = await chrome.storage.local.get([
        "userCustomRules",
        "siteResetHistory"
      ]);
      customSelectors = result.userCustomRules?.[hostname] || [];
      resetHistory = result.siteResetHistory?.[hostname] || resetHistory;
    } catch (error) {
      if (isExtensionContextInvalidated(error)) throw error;
    }
    if (!initialCustomSelectors) {
      initialCustomSelectors = new Set(
        customSelectors.map((rule) => typeof rule === "string" ? rule : rule.selector).filter(Boolean)
      );
    }
    const isBlacklisted = (el) => resetHistory.oldRules.some((oldRule) => {
      if (typeof oldRule === "string") return false;
      const f = oldRule.fingerprint;
      return f && (el.id && el.id === f.id || el.className && el.className === f.className && el.tagName.toLowerCase() === f.tag);
    });
    const hide = (selector, preserveProtectedArea = false) => document.querySelectorAll(selector).forEach((el) => {
      if (isBlacklisted(el)) return;
      if (preserveProtectedArea && el.closest(PROTECTED_SELECTOR2)) return;
      BLOCKING_STRATEGIES.STEALTH(el);
      blockedCount++;
    });
    customSelectors.forEach((rule) => {
      const selector = typeof rule === "string" ? rule : rule.selector;
      if (!selector || suppressedCustomSelectors.has(selector) || DANGEROUS_SELECTOR_TAGS.includes(selector.toLowerCase().trim()))
        return;
      const snapshots = customRuleSnapshots.get(selector) || /* @__PURE__ */ new Map();
      const matched = [];
      document.querySelectorAll(selector).forEach((element) => {
        if (isBlacklisted(element)) return;
        if (!snapshots.has(element)) {
          snapshots.set(element, captureInlineVisibility(element));
        }
        BLOCKING_STRATEGIES.STEALTH(element);
        matched.push(element);
        blockedCount++;
      });
      customRuleSnapshots.set(selector, snapshots);
      if (matched.length && initialCustomSelectors.has(selector))
        savedRuleApplications.set(selector, { rule, snapshots });
    });
    showSavedRuleSummary();
    STATIC_AD_SELECTORS.forEach((selector) => hide(selector, true));
    if (blockedCount > 0) {
      try {
        await chrome.runtime.sendMessage({
          type: "REPORT_AD_DENSITY",
          hostname,
          count: blockedCount
        });
      } catch (error) {
        if (isExtensionContextInvalidated(error)) throw error;
      }
      window.postMessage(
        {
          source: "adsfriendly-content",
          type: "AD_DENSITY_VALUE",
          value: blockedCount
        },
        "*"
      );
    }
  }
  function showSavedRuleSummary() {
    if (savedRuleSummaryShown || !savedRuleApplications.size) return;
    savedRuleSummaryShown = true;
    const applications = [...savedRuleApplications.entries()];
    const hiddenElements = /* @__PURE__ */ new Set();
    applications.forEach(
      ([, { snapshots }]) => snapshots.forEach((_, element) => hiddenElements.add(element))
    );
    const target = hiddenElements.values().next().value;
    if (!target) return;
    showDomHiddenToast(
      {
        target,
        hiddenCount: hiddenElements.size,
        savedRuleCount: applications.length,
        isSavedRuleSummary: true,
        features: { tag: "page" },
        decision: {
          confidence: 1,
          reasons: ["saved_user_rules"]
        }
      },
      {
        onShow: restoreSavedRules
      }
    );
  }
  async function restoreSavedRules() {
    const applications = [...savedRuleApplications.entries()];
    const selectors2 = new Set(applications.map(([selector]) => selector));
    const response = await chrome.runtime.sendMessage({
      type: "RESTORE_CUSTOM_RULES",
      hostname: location.hostname,
      selectors: [...selectors2]
    });
    if (response?.status !== "saved")
      throw new Error(response?.error || "Could not restore hidden elements.");
    selectors2.forEach((selector) => suppressedCustomSelectors.add(selector));
    applications.forEach(([selector, { snapshots }]) => {
      snapshots.forEach(
        (snapshot, element) => restoreInlineVisibility(element, snapshot)
      );
      customRuleSnapshots.delete(selector);
    });
    savedRuleApplications.clear();
    const fingerprints = applications.map(([, { rule }]) => typeof rule === "string" ? null : rule.fingerprint).filter(Boolean);
    fingerprints.forEach(
      (fingerprint) => chrome.runtime.sendMessage({
        type: "NEGATIVE_LEARNING",
        fingerprint
      })
    );
    chrome.runtime.sendMessage({
      type: "RECORD_TELEMETRY",
      event: {
        schema_version: "dataset.v1",
        sample_id: randomId2(),
        unit: "dom_element",
        label: "content",
        label_source: "user_show",
        label_strength: "strong",
        site: {
          hostname: location.hostname,
          url: location.href.split("#")[0]
        },
        timestamp: Date.now(),
        context: {
          selectors: [...selectors2],
          hidden_count: new Set(
            applications.flatMap(([, { snapshots }]) => [...snapshots.keys()])
          ).size,
          surface: "saved_rule_summary_toast"
        },
        evidence: { fingerprints },
        feedback: {
          user_action: "show",
          correction: "false_positive",
          surface: "saved_rule_summary_toast"
        },
        action: "allow",
        outcome: "user_show"
      }
    });
    chrome.runtime.sendMessage({ type: "SYNC_LEARNING" });
  }
  function randomId2() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // src/dom/prediction-runner.js
  function hidePredictedAds(patterns = []) {
    if (!patterns.length) return;
    document.querySelectorAll("img, div, a").forEach((el) => {
      if (el.style.opacity === "0" || el.id?.includes("adsfriendly")) return;
      const result = scoreElement(el, patterns);
      if (result.score >= 0.8) {
        console.log(
          `[AdsFriendly AI] Hiding predicted ad (${(result.score * 100).toFixed(0)}%)`,
          result.reasons,
          el
        );
        BLOCKING_STRATEGIES.STEALTH(el);
      }
    });
  }
  function scoreElement(el, patterns) {
    const reasons = [];
    let score = scoreTarget(el, patterns, reasons);
    if (score < 0.7 && el.children.length > 0) {
      let childAdCount = 0;
      const children = el.querySelectorAll("img, a");
      children.forEach((child) => {
        if (scoreTarget(child, patterns, reasons) >= 0.7) childAdCount++;
      });
      if (children.length >= 2 && childAdCount / children.length >= 0.6) {
        score = 1;
        reasons.push("Ad Cluster identified via children analysis");
      }
    }
    const link = el.closest("a");
    try {
      if (link?.href && new URL(link.href).hostname === location.hostname)
        score -= 1;
    } catch {
    }
    return { score, reasons };
  }
  function scoreTarget(target, patterns, reasons) {
    let score = 0;
    patterns.forEach((p) => {
      if (p.type === "alt" && target.alt === p.value) {
        score += p.confidence;
        reasons.push(`alt=${p.value}`);
      }
      if (p.type === "title" && target.title === p.value) {
        score += p.confidence;
        reasons.push(`title=${p.value}`);
      }
      if (p.type === "domain") {
        const link = target.closest("a");
        if (link?.href?.includes(p.value)) {
          score += p.confidence;
          reasons.push(`domain=${p.value}`);
        }
      }
      if (p.type === "class" && target.className === p.value) {
        score += p.confidence;
        reasons.push(`class=${p.value}`);
      }
      if (p.type === "id" && target.id === p.value) {
        score += p.confidence;
        reasons.push(`id=${p.value}`);
      }
      if (p.type === "srcHost" && target.src?.includes(p.value)) {
        score += p.confidence;
        reasons.push(`srcHost=${p.value}`);
      }
      if (p.type === "classToken" && typeof target.className === "string" && target.className.toLowerCase().split(/\s+/).includes(p.value)) {
        score += p.confidence;
        reasons.push(`classToken=${p.value}`);
      }
      if (p.type === "idToken" && target.id?.toLowerCase().split(/[^a-z0-9]+/i).includes(p.value)) {
        score += p.confidence;
        reasons.push(`idToken=${p.value}`);
      }
    });
    return score;
  }

  // src/shared/pattern-store.js
  var DOM_PATTERN_TYPES = /* @__PURE__ */ new Set([
    "alt",
    "title",
    "domain",
    "class",
    "id",
    "srcHost",
    "classToken",
    "idToken"
  ]);
  async function getGlobalPatterns() {
    const { globalAdPatterns = [] } = await chrome.storage.local.get("globalAdPatterns");
    return Array.isArray(globalAdPatterns) ? globalAdPatterns : [];
  }
  async function getDomPatterns() {
    return (await getGlobalPatterns()).filter(
      (pattern) => DOM_PATTERN_TYPES.has(pattern?.type)
    );
  }

  // src/dom/engine.js
  async function startStaticDomBlocker() {
    await blockAdsOnPage();
    return startManagedLoop(blockAdsOnPage, false);
  }
  function startLearnedDomBlocker() {
    return startManagedLoop(async () => {
      hidePredictedAds(await getDomPatterns());
    });
  }
  function startManagedLoop(task, runImmediately = true) {
    let stopped = false;
    let intervalId = null;
    const stop = () => {
      stopped = true;
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
    };
    const run = async () => {
      if (stopped) return;
      try {
        await task();
      } catch (error) {
        if (isExtensionContextInvalidated(error)) stop();
      }
    };
    intervalId = setInterval(run, 2e3);
    if (runImmediately) run();
    return stop;
  }

  // src/navigation/content/navigation-toast.js
  var TOAST_ID2 = "adsfriendly-nav-toast";
  var TOAST_TIMEOUT_MS2 = 1e4;
  var toastTimer = null;
  var pendingNavigation = null;
  function startNavigationToast() {
    const onMessage = (message) => {
      if (message?.type !== "SHOW_GRAY_NAVIGATION") return;
      pendingNavigation = {
        url: message.url,
        source: message.source,
        target: message.target,
        tabId: message.tabId
      };
      showNavigationToast();
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.runtime.sendMessage({ type: "NAVIGATION_TOAST_READY" }).catch(() => {
    });
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }
  function showNavigationToast() {
    if (!pendingNavigation?.url) return;
    const toast = ensureToast2();
    const host = safeHost2(pendingNavigation.url);
    toast.querySelector(".adsfriendly-toast-message").textContent = `${truncate(host, 28)} may be an ad`;
    toast.classList.remove("adsfriendly-toast-hidden");
    scheduleHide2();
  }
  function ensureToast2() {
    let toast = document.getElementById(TOAST_ID2);
    if (toast) return toast;
    toast = document.createElement("div");
    toast.id = TOAST_ID2;
    toast.className = "adsfriendly-toast-hidden";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `
    <span class="adsfriendly-toast-scope">NEW TAB</span>
    <span class="adsfriendly-toast-message"></span>
    <button class="adsfriendly-toast-primary" type="button">Keep tab</button>
    <button class="adsfriendly-toast-block" type="button">Block tab</button>
    <button class="adsfriendly-toast-close" type="button">x</button>
  `;
    const style = document.createElement("style");
    style.textContent = `
    #${TOAST_ID2} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: min(420px, calc(100vw - 32px));
      padding: 8px 9px 8px 12px;
      border-radius: 8px;
      background: rgba(17, 24, 39, 0.96);
      color: #f8fafc;
      box-shadow: 0 10px 30px rgba(0,0,0,0.32);
      font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      opacity: 1;
      transition: opacity 160ms ease, transform 160ms ease;
    }
    #${TOAST_ID2}.adsfriendly-toast-hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px);
    }
    #${TOAST_ID2} .adsfriendly-toast-message {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${TOAST_ID2} .adsfriendly-toast-scope {
      padding: 3px 5px;
      border-radius: 5px;
      background: rgba(245, 158, 11, 0.16);
      color: #fbbf24;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.04em;
      flex: 0 0 auto;
    }
    #${TOAST_ID2} button {
      border: 0;
      background: transparent;
      color: #60a5fa;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      padding: 5px 6px;
      flex: 0 0 auto;
    }
    #${TOAST_ID2} .adsfriendly-toast-close {
      color: #94a3b8;
    }
  `;
    toast.querySelector(".adsfriendly-toast-primary").onclick = () => submitNavigationDecision("KEEP_REVIEWED_TAB");
    toast.querySelector(".adsfriendly-toast-block").onclick = () => submitNavigationDecision("BLOCK_REVIEWED_TAB");
    toast.querySelector(".adsfriendly-toast-close").onclick = hideNavigationToast;
    toast.addEventListener("mouseenter", pauseHide2);
    toast.addEventListener("mouseleave", scheduleHide2);
    toast.addEventListener("focusin", pauseHide2);
    toast.addEventListener("focusout", scheduleHide2);
    (document.head || document.documentElement).appendChild(style);
    (document.body || document.documentElement).appendChild(toast);
    return toast;
  }
  async function submitNavigationDecision(type) {
    if (!pendingNavigation?.url) return;
    const toast = ensureToast2();
    const message = toast.querySelector(".adsfriendly-toast-message");
    const buttons = toast.querySelectorAll("button");
    buttons.forEach((button) => button.disabled = true);
    message.textContent = "Saving decision\u2026";
    try {
      const response = await chrome.runtime.sendMessage({
        type,
        ...pendingNavigation
      });
      if (!["ok", "saved"].includes(response?.status))
        throw new Error(response?.error || "Could not save this decision.");
      hideNavigationToast();
    } catch (error) {
      message.textContent = "Could not save \xB7 storage unavailable";
      message.title = error.message;
      buttons.forEach((button) => button.disabled = false);
      scheduleHide2();
    }
  }
  function scheduleHide2() {
    pauseHide2();
    if (pendingNavigation)
      toastTimer = setTimeout(hideNavigationToast, TOAST_TIMEOUT_MS2);
  }
  function pauseHide2() {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
  }
  function hideNavigationToast() {
    const toast = document.getElementById(TOAST_ID2);
    if (toast) toast.classList.add("adsfriendly-toast-hidden");
    pauseHide2();
    pendingNavigation = null;
  }
  function safeHost2(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "unknown";
    }
  }
  function truncate(value, max) {
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
  }

  // src/dom/youtube-cleaner.js
  var selectors = [
    "ytd-masthead-ad-v3-renderer",
    "ytd-promoted-video-renderer",
    "ytd-display-ad-renderer",
    "ytd-ad-slot-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "#masthead-ad",
    ".ytd-video-masthead-ad-v3-renderer",
    ".ytd-promoted-video-renderer"
  ];
  function startYouTubeCleaner() {
    const run = () => {
      if (location.hostname !== "www.youtube.com") return;
      selectors.forEach(
        (sel) => document.querySelectorAll(sel).forEach((el) => el.style.setProperty("display", "none", "important"))
      );
      document.querySelectorAll("ytd-rich-item-renderer, ytd-video-renderer").forEach((card) => {
        const text = card.innerText.trim().toLowerCase();
        if (text.includes("sponsored") || text.includes("\u0111\u01B0\u1EE3c t\xE0i tr\u1EE3") || text.includes("qu\u1EA3ng c\xE1o"))
          card.style.setProperty("display", "none", "important");
      });
    };
    run();
    const intervalId = setInterval(run, 2e3);
    return () => clearInterval(intervalId);
  }

  // src/runtime/settings-store.js
  var SETTINGS_KEY = "appSettings";
  var DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    protectionMode: PROTECTION_MODES.SAFE,
    featureOverrides: Object.freeze({})
  });
  function normalizeSettings(value = {}) {
    const protectionMode = Object.values(PROTECTION_MODES).includes(
      value.protectionMode
    ) ? value.protectionMode : DEFAULT_SETTINGS.protectionMode;
    return {
      enabled: value.enabled !== false,
      protectionMode,
      featureOverrides: value.featureOverrides && typeof value.featureOverrides === "object" ? { ...value.featureOverrides } : {}
    };
  }
  function migrateLegacySettings(stored = {}) {
    if (stored[SETTINGS_KEY]) return normalizeSettings(stored[SETTINGS_KEY]);
    const protectionMode = stored.friendlyMode === false ? PROTECTION_MODES.AUTO : PROTECTION_MODES.SAFE;
    return normalizeSettings({
      enabled: stored.isEnabled !== false,
      protectionMode
    });
  }
  async function loadSettings(storage = chrome.storage.local) {
    const stored = await storage.get([SETTINGS_KEY, "isEnabled", "friendlyMode"]);
    const settings = migrateLegacySettings(stored);
    if (!stored[SETTINGS_KEY]) await storage.set({ [SETTINGS_KEY]: settings });
    return settings;
  }
  function subscribeSettings(listener, storageArea = "local") {
    const onChanged = (changes, areaName) => {
      if (areaName !== storageArea || !changes[SETTINGS_KEY]) return;
      listener(normalizeSettings(changes[SETTINGS_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }

  // src/runtime/main-controller.js
  function createMainController({
    context,
    implementations,
    initialSettings = null,
    watchSettings = true,
    settingsLoader = loadSettings,
    settingsSubscriber = subscribeSettings,
    logger = console
  }) {
    const catalogFeatures = getFeaturesForContext(context);
    validateImplementations(context, catalogFeatures, implementations);
    let settings = normalizeSettings(initialSettings || DEFAULT_SETTINGS);
    let unsubscribe = null;
    let started = false;
    const lifecycles = /* @__PURE__ */ new Map();
    const listeners = /* @__PURE__ */ new Set();
    const controller2 = {
      context,
      async start() {
        if (started) return controller2;
        started = true;
        if (!initialSettings) settings = await settingsLoader();
        await reconcile();
        if (watchSettings) {
          unsubscribe = settingsSubscriber((nextSettings) => {
            controller2.updateSettings(nextSettings).catch(
              (error) => logger.error(
                `[MainController:${context}] reconcile failed`,
                error
              )
            );
          });
        }
        notify();
        return controller2;
      },
      async updateSettings(nextSettings) {
        settings = normalizeSettings(nextSettings);
        if (started) await reconcile();
        notify();
        return controller2.snapshot();
      },
      snapshot() {
        return {
          context,
          settings: {
            ...settings,
            featureOverrides: { ...settings.featureOverrides }
          },
          activeFeatures: [...lifecycles.entries()].filter(([, lifecycle]) => lifecycle.active).map(([featureId]) => featureId)
        };
      },
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async stop() {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        for (const [featureId, lifecycle] of lifecycles) {
          await stopLifecycle(featureId, lifecycle);
        }
        lifecycles.clear();
        started = false;
      }
    };
    async function reconcile() {
      validateFeatureOverrides(settings.featureOverrides);
      for (const definition of catalogFeatures) {
        const desired = shouldStartFeature(definition, settings);
        const lifecycle = lifecycles.get(definition.id);
        if (desired && !lifecycle?.active) {
          const policy = createFeaturePolicy(definition, () => settings);
          if (lifecycle?.started && !lifecycle.cleanup) {
            lifecycle.active = true;
            continue;
          }
          const result = implementations[definition.id]({
            controller: controller2,
            feature: definition,
            policy
          });
          const cleanup = isPromiseLike(result) ? await result : result;
          lifecycles.set(definition.id, {
            active: true,
            started: true,
            cleanup: typeof cleanup === "function" ? cleanup : null
          });
        } else if (!desired && lifecycle?.active) {
          if (lifecycle.cleanup) {
            await stopLifecycle(definition.id, lifecycle);
            lifecycles.delete(definition.id);
          } else {
            lifecycle.active = false;
          }
        }
      }
    }
    async function stopLifecycle(featureId, lifecycle) {
      if (!lifecycle.cleanup) {
        lifecycle.active = false;
        return;
      }
      try {
        await lifecycle.cleanup();
      } catch (error) {
        logger.error(
          `[MainController:${context}] failed to stop ${featureId}`,
          error
        );
      }
      lifecycle.active = false;
    }
    function notify() {
      const snapshot = controller2.snapshot();
      for (const listener of listeners) listener(snapshot);
    }
    return controller2;
  }
  function createFeaturePolicy(definitionOrId, readSettings) {
    const definition = typeof definitionOrId === "string" ? getFeatureDefinition(definitionOrId) : definitionOrId;
    const declared = new Set(definition.capabilities);
    function assertAllowed(capability) {
      assertRegisteredCapability(capability);
      if (!declared.has(capability)) {
        throw new Error(
          `[FeatureRegistry] Feature "${definition.id}" tried to use undeclared capability "${capability}". Add it to that feature in feature-catalog.js.`
        );
      }
    }
    return Object.freeze({
      featureId: definition.id,
      can(capability) {
        assertAllowed(capability);
        const settings = readSettings();
        if (!settings.enabled)
          return [
            CAPABILITIES.CORE_MESSAGING,
            CAPABILITIES.CORE_MAINTENANCE
          ].includes(capability);
        return getCapabilitiesForMode(settings.protectionMode).includes(
          capability
        );
      },
      require(capability) {
        if (!this.can(capability)) {
          const settings = readSettings();
          throw new Error(
            `[FeatureRegistry] Capability "${capability}" is disabled for feature "${definition.id}" in mode "${settings.protectionMode}".`
          );
        }
        return true;
      }
    });
  }
  function shouldStartFeature(definition, settings) {
    const override = settings.featureOverrides?.[definition.id];
    if (override === false) return false;
    if ([CAPABILITIES.CORE_MESSAGING, CAPABILITIES.CORE_MAINTENANCE].includes(
      definition.startCapability
    ))
      return true;
    if (!settings.enabled) return false;
    return getCapabilitiesForMode(settings.protectionMode).includes(
      definition.startCapability
    );
  }
  function validateFeatureOverrides(featureOverrides = {}) {
    for (const featureId of Object.keys(featureOverrides)) {
      getFeatureDefinition(featureId);
    }
  }
  function isPromiseLike(value) {
    return value && typeof value.then === "function";
  }
  function validateImplementations(context, catalogFeatures, implementations) {
    const expected = new Set(catalogFeatures.map((feature2) => feature2.id));
    for (const featureId of Object.keys(implementations)) {
      const definition = getFeatureDefinition(featureId);
      if (definition.context !== context) {
        throw new Error(
          `[FeatureRegistry] Feature "${featureId}" belongs to context "${definition.context}", not "${context}".`
        );
      }
    }
    for (const featureId of expected) {
      if (typeof implementations[featureId] !== "function") {
        throw new Error(
          `[FeatureRegistry] Feature "${featureId}" is registered for context "${context}" but has no implementation in its main feature list.`
        );
      }
    }
  }

  // src/content/index.js
  var controller = createMainController({
    context: "content",
    implementations: {
      "content.spy-injector": ({ controller: main }) => injectSpy(main.snapshot().settings),
      "content.youtube-cleaner": () => startYouTubeCleaner(),
      "content.navigation-intent": () => startIntentTracker(),
      "content.navigation-toast": () => startNavigationToast(),
      "content.dom-static-blocker": () => startStaticDomBlocker(),
      "content.dom-candidate-collector": ({ policy }) => startDomCandidateCollector(policy),
      "content.dom-learned-blocker": () => startLearnedDomBlocker()
    }
  });
  controller.onChange(({ settings }) => {
    window.postMessage(
      {
        source: "adsfriendly-content",
        type: "PROTECTION_SETTINGS_CHANGED",
        settings
      },
      "*"
    );
  });
  controller.start().catch(
    (error) => console.error("[AdsFriendly Content] MainController failed", error)
  );
})();
