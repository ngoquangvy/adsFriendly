const AD_TOKEN_RE =
  /(^|[-_])(?:ad|ads|adv|advert|banner|promo|sponsor|popup|preload)([-_]|$)/i;
const PROTECTED_SELECTOR =
  'nav, [role="navigation"], form, [data-testid*="login" i]';
const NAV_SELECTOR = 'nav, [role="navigation"]';

export function extractDomFeatures(element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const link = element.closest("a[href]");
  const src = element.currentSrc || element.src || "";
  const href = link?.href || element.href || "";
  const idTokens = tokenize(element.id);
  const classTokens = tokenize(
    typeof element.className === "string" ? element.className : "",
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
      areaRatio: viewportArea()
        ? (rect.width * rect.height) / viewportArea()
        : 0,
    },
    style: {
      position: style.position,
      display: style.display,
      visibility: style.visibility,
      opacity: Number.parseFloat(style.opacity || "1"),
      zIndex: style.zIndex,
      maxWidth: style.maxWidth,
    },
    visible: isVisible(element, rect, style),
    fixedOrSticky: style.position === "fixed" || style.position === "sticky",
    absoluteOrFixed:
      style.position === "absolute" || style.position === "fixed",
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
    parent: parent
      ? {
          tag: parent.tagName.toLowerCase(),
          id: parent.id || "",
          className:
            typeof parent.className === "string" ? parent.className : "",
          childCount: parent.children.length,
          inProtectedArea: !!parent.closest(PROTECTED_SELECTOR),
        }
      : null,
    signals: {
      idHasAdToken: tokensHaveAdSignal(idTokens),
      idLooksAdSlot: looksAdSlotId(element.id),
      classHasAdToken: tokensHaveAdSignal(classTokens),
      srcIsImageCdn: isImageCdn(src),
      hrefLooksAdLike: looksAdLikeUrl(href),
      hrefHostLooksCommercial: looksCommercialHost(href),
      descendantsHaveAdSignals:
        descendants.externalAdLinkCount > 0 ||
        descendants.imageCdnCount > 0 ||
        descendants.iframeCount > 0,
      hasAltOrTitle: !!(element.alt || element.title),
    },
  };
}

export function getSmallestSafeDomTarget(element, features) {
  const link = element.closest("a[href]");
  if (
    link &&
    features.linkExternal &&
    link.children.length <= 2 &&
    !link.closest(PROTECTED_SELECTOR)
  ) {
    return link;
  }
  return element;
}

export function buildDomSelector(element) {
  if (!element?.tagName) return null;
  const tag = element.tagName.toLowerCase();
  if (element.id && AD_TOKEN_RE.test(element.id))
    return `#${cssEscape(element.id)}`;
  const className =
    typeof element.className === "string"
      ? element.className.split(/\s+/).find((token) => AD_TOKEN_RE.test(token))
      : "";
  if (className) return `${tag}.${cssEscape(className)}`;
  if (element.id && !/\d{5,}/.test(element.id))
    return `#${cssEscape(element.id)}`;

  // Candidates such as image ads often have no useful id/class. A user click
  // on Hide must still be durable, so prefer a site-scoped resource or link
  // host before falling back to a narrow structural selector.
  const hrefHost = safeHost(element.getAttribute?.("href") || element.href);
  if (tag === "a" && hrefHost)
    return `a[href*="${cssAttributeValue(`//${hrefHost}`)}"]`;

  const srcHost = safeHost(
    element.getAttribute?.("src") || element.currentSrc || element.src,
  );
  if (["img", "iframe"].includes(tag) && srcHost)
    return `${tag}[src*="${cssAttributeValue(`//${srcHost}`)}"]`;

  const labelledSelector = buildLabelSelector(element, tag);
  if (labelledSelector) return labelledSelector;
  return buildStructuralSelector(element);
}

export function tokensHaveAdSignal(tokens) {
  return tokens.some((token) => AD_TOKEN_RE.test(token));
}

export function looksAdLikeUrl(url = "") {
  const value = url.toLowerCase();
  return /(?:[?&](?:utm_|aff_|clickid|adid|zoneid|bannerid)|\/(?:ad|ads|adv|advert|banner)(?:\/|\.|-|_))/i.test(
    value,
  );
}

function inspectDescendants(element) {
  const links = Array.from(element.querySelectorAll?.("a[href]") || []).slice(
    0,
    40,
  );
  const images = Array.from(element.querySelectorAll?.("img, iframe") || [])
    .slice(0, 40)
    .map((node) => ({
      tag: node.tagName.toLowerCase(),
      src: node.currentSrc || node.src || "",
      srcHost: safeHost(node.currentSrc || node.src || ""),
    }));
  const externalLinks = links.filter(
    (link) => safeHost(link.href) !== location.hostname,
  );
  const externalAdLinks = externalLinks.filter((link) => {
    const text = [
      link.id,
      typeof link.className === "string" ? link.className : "",
      link.href,
      link.textContent || "",
    ].join(" ");
    return (
      tokensHaveAdSignal(tokenize(text)) ||
      looksAdLikeUrl(link.href) ||
      looksCommercialHost(link.href)
    );
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
    srcHosts: uniqueHosts(images.map((item) => item.srcHost)),
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
      link.textContent || "",
    ].join(" ");
    return (
      tokensHaveAdSignal(tokenize(value)) ||
      looksAdLikeUrl(link.href) ||
      looksCommercialHost(link.href)
    );
  });
  return adLinks.length / links.length;
}

function looksCommercialHost(url = "") {
  const host = safeHost(url);
  return /(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|adcenter|admicro|doubleclick|googlesyndication|casino|bet|88|789|fun|click|track|promo)/i.test(
    host,
  );
}

function tokenize(value = "") {
  return String(value)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

function safeHost(url) {
  try {
    const base =
      typeof location === "undefined"
        ? "https://adsfriendly.invalid/"
        : location.href;
    return new URL(url, base).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isImageCdn(url = "") {
  const host = safeHost(url);
  return /(?:googleusercontent\.com|gstatic\.com|cloudfront\.net|akamaihd\.net|imgur\.com|cdn)/i.test(
    host,
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
    id,
  );
}

function isVisible(element, rect, style) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number.parseFloat(style.opacity || "1") > 0.05 &&
    element.getClientRects().length > 0
  );
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
        (child) => child.tagName?.toLowerCase() === tag,
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
      childCount: current.children.length,
    });
    current = current.parentElement;
  }
  return chain;
}

function getSiblingSummary(element) {
  const siblings = Array.from(element.parentElement?.children || []).filter(
    (node) => node !== element,
  );
  return {
    count: siblings.length,
    adLikeCount: siblings.filter((node) =>
      tokensHaveAdSignal(
        tokenize(
          [
            node.id,
            typeof node.className === "string" ? node.className : "",
            node.getAttribute?.("href") || "",
            node.getAttribute?.("src") || "",
          ].join(" "),
        ),
      ),
    ).length,
    tags: [
      ...new Set(siblings.map((node) => node.tagName.toLowerCase())),
    ].slice(0, 8),
  };
}
