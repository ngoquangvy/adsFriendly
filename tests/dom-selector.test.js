import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(
    buildDomSelector(second),
    "section > div:nth-of-type(2)",
  );
  assert.notEqual(buildDomSelector(first), "div");
});
