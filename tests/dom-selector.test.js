import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKING_STRATEGIES,
  captureInlineVisibility,
  isHiddenByAdsFriendly,
  restoreInlineVisibility,
} from "../src/dom/actions.js";
import {
  buildDomSelector,
  isExplicitFullscreenAdOverlay,
  isReusableDomSelector,
  looksAdLikeUrl,
  normalizeUrlText,
} from "../src/dom/features.js";
import { decideDomCandidate } from "../src/dom/decision.js";
import { STATIC_AD_SELECTORS } from "../src/dom/ad-selectors.js";
import {
  createElementException,
  matchesElementException,
} from "../src/dom/element-exceptions.js";

function element(tag, attributes = {}, parentElement = null) {
  const node = {
    tagName: tag.toUpperCase(),
    id: attributes.id || "",
    className: attributes.class || "",
    href: attributes.href || "",
    src: attributes.src || "",
    currentSrc: attributes.src || "",
    parentElement,
    children: [],
    getAttribute(name) {
      return attributes[name] || "";
    },
  };
  if (parentElement) parentElement.children.push(node);
  return node;
}

test("URL heuristics accept SVG and URL objects without throwing", () => {
  const svgHref = { baseVal: "https://ads.example/banner/click" };
  assert.equal(normalizeUrlText(svgHref), svgHref.baseVal);
  assert.equal(looksAdLikeUrl(svgHref), true);
  assert.equal(looksAdLikeUrl(new URL("https://example.com/watch")), false);
  assert.equal(looksAdLikeUrl({}), false);
});

test("builds a durable host selector for an unlabelled ad link", () => {
  const link = element("a", {
    href: "https://hitclub.voting/?utm_source=example",
  });
  assert.equal(buildDomSelector(link), 'a[href*="//hitclub.voting"]');
});

test("generalizes randomized ad ids seen on live pages", () => {
  const firstLoad = element("div", { id: "ad-1zqzstb" });
  const secondLoad = element("div", { id: "ad-j50v72g" });
  assert.equal(buildDomSelector(firstLoad), 'div[id^="ad-"]');
  assert.equal(buildDomSelector(secondLoad), 'div[id^="ad-"]');
});

test("uses a resource host or accessible label before structure", () => {
  const image = element("img", {
    src: "https://cdn.example/banner-123.jpg",
    alt: "Sponsored banner",
  });
  assert.equal(buildDomSelector(image), 'img[src*="//cdn.example"]');

  const button = element("button", { "aria-label": "Close promotion" });
  assert.equal(
    buildDomSelector(button),
    'button[aria-label="Close promotion"]',
  );
});

test("recognizes the reported preload fullscreen banner as an explicit ad", () => {
  const overlay = element("div", {
    id: "_preload-ads-2",
    "time-click-close": "1",
    "time-click-image-to-hide": "1",
  });
  assert.equal(buildDomSelector(overlay), "#_preload-ads-2");
  assert.equal(
    STATIC_AD_SELECTORS.includes(
      'div[id^="_preload-ads-"][time-click-close][time-click-image-to-hide]',
    ),
    true,
  );

  const features = {
    visible: true,
    inProtectedArea: false,
    fixedOrSticky: true,
    rect: { areaRatio: 1 },
    style: { zIndex: "99999" },
    signals: {
      idHasAdToken: true,
      classHasAdToken: false,
      idLooksAdSlot: false,
    },
    descendants: { externalAdLinkCount: 1 },
  };
  assert.equal(isExplicitFullscreenAdOverlay(features), true);
  assert.equal(decideDomCandidate(features).action, "block");
  assert.equal(
    isExplicitFullscreenAdOverlay({
      ...features,
      signals: {
        idHasAdToken: false,
        classHasAdToken: false,
        idLooksAdSlot: false,
      },
    }),
    false,
  );
});

test("falls back to a narrow structural selector", () => {
  const body = element("body");
  const section = element("section", {}, body);
  const first = element("div", {}, section);
  const second = element("div", {}, section);
  assert.equal(buildDomSelector(second), "section > div:nth-of-type(2)");
  assert.notEqual(buildDomSelector(first), "div");
});

test("not-ad decisions match the same identity but not replacement ad content", () => {
  const candidate = {
    selector: 'a[href*="//docs.example"]',
    features: {
      tag: "img",
      id: "site-logo",
      className: "header-banner",
      idTokens: ["site", "logo"],
      classTokens: ["header", "banner"],
      hrefHost: "docs.example",
      srcHost: "static.example",
      alt: "Documentation",
      title: "",
    },
    decision: { confidence: 0.72 },
  };
  const rule = createElementException(candidate, {
    id: "not-ad-1",
    layout: "wide",
    timestamp: 1,
  });
  assert.equal(
    matchesElementException(rule, {
      selector: candidate.selector,
      features: candidate.features,
      layout: "wide",
    }),
    true,
  );
  assert.equal(
    matchesElementException(rule, {
      selector: candidate.selector,
      features: {
        ...candidate.features,
        hrefHost: "casino.example",
        srcHost: "ads.example",
        alt: "Sponsored",
      },
      layout: "wide",
    }),
    false,
  );
  assert.equal(
    matchesElementException(rule, {
      selector: candidate.selector,
      features: candidate.features,
      layout: "compact",
    }),
    false,
  );
});

test("selectorless page shells are excluded from review and auto-hide", () => {
  const body = element("body");
  const content = element("div", { class: "reader-shell" }, body);
  const selector = buildDomSelector(content);
  assert.equal(selector, null);
  assert.equal(isReusableDomSelector(selector), false);
  assert.throws(
    () =>
      createElementException({
        selector,
        target: content,
        features: {
          tag: "div",
          className: "reader-shell",
          classTokens: ["reader", "shell"],
        },
        decision: { confidence: 0.65 },
      }),
    /no stable identity/i,
  );
  for (const broadSelector of ["body", "html", ":root", "*"]) {
    assert.equal(
      isReusableDomSelector(broadSelector),
      false,
      `${broadSelector} should not become an actionable DOM rule`,
    );
  }
});

test("not-ad decisions require both stable identity and a reusable selector", () => {
  assert.throws(
    () =>
      createElementException({
        selector: null,
        features: { tag: "div", id: "stable-content" },
        decision: { confidence: 0.65 },
      }),
    /no stable identity/i,
  );
  assert.throws(
    () =>
      createElementException({
        selector: "#content",
        features: { tag: "div" },
        decision: { confidence: 0.65 },
      }),
    /no stable identity/i,
  );
});

test("marks hidden rule regions and restores their previous state", () => {
  const attributes = new Map();
  const properties = new Map();
  const target = {
    style: {
      getPropertyValue: (name) => properties.get(name)?.value || "",
      getPropertyPriority: (name) => properties.get(name)?.priority || "",
      setProperty: (name, value, priority) =>
        properties.set(name, { value, priority }),
      removeProperty: (name) => properties.delete(name),
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    closest: (selector) =>
      selector === "[data-adsfriendly-rule-hidden]" &&
      attributes.has("data-adsfriendly-rule-hidden")
        ? target
        : null,
    querySelector: () => null,
  };

  const snapshot = captureInlineVisibility(target);
  BLOCKING_STRATEGIES.STEALTH(target);
  assert.equal(isHiddenByAdsFriendly(target), true);
  restoreInlineVisibility(target, snapshot);
  assert.equal(isHiddenByAdsFriendly(target), false);
  assert.equal(properties.size, 0);
});
