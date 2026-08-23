import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKING_STRATEGIES,
  captureInlineVisibility,
  isHiddenByAdsFriendly,
  restoreInlineVisibility,
} from "../src/dom/actions.js";
import { buildDomSelector } from "../src/dom/features.js";

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

test("falls back to a narrow structural selector", () => {
  const body = element("body");
  const section = element("section", {}, body);
  const first = element("div", {}, section);
  const second = element("div", {}, section);
  assert.equal(buildDomSelector(second), "section > div:nth-of-type(2)");
  assert.notEqual(buildDomSelector(first), "div");
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
