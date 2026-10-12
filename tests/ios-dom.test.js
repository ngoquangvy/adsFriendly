import test from "node:test";
import assert from "node:assert/strict";
import { createHiddenElements } from "../src/ios/dom-state.js";
import {
  ruleMatchesResponsiveLayout,
  getResponsiveLayout,
} from "../src/dom/layout-context.js";
import {
  createElementException,
  matchesElementException,
} from "../src/dom/element-exceptions.js";
function element() {
  const values = new Map([["display", ["flex", ""]]]);
  return {
    isConnected: true,
    style: {
      getPropertyValue: (key) => values.get(key)?.[0] || "",
      getPropertyPriority: (key) => values.get(key)?.[1] || "",
      setProperty: (key, value, priority = "") =>
        values.set(key, [value, priority]),
      removeProperty: (key) => values.delete(key),
    },
  };
}
test("hiding restores original display when rule, layout, or protection changes", () => {
  const state = createHiddenElements(),
    node = element();
  assert.equal(state.hide(node, { selector: ".advert" }), true);
  assert.equal(state.hide(node, {}), false);
  state.reconcile(() => false);
  assert.equal(node.style.getPropertyValue("display"), "flex");
  assert.equal(node.style.getPropertyPriority("display"), "");
});
test("restore preserves a newer site style and forgets detached nodes", () => {
  const state = createHiddenElements(),
    node = element();
  state.hide(node, {});
  node.style.setProperty("display", "grid");
  state.restore(node);
  assert.equal(node.style.getPropertyValue("display"), "grid");
  state.hide(node, {});
  node.isConnected = false;
  state.reconcile(() => true);
  assert.equal(state.size, 0);
});
test("desktop viewport and mobile viewport rules stay separate", () => {
  assert.equal(getResponsiveLayout(980), "wide");
  assert.equal(
    ruleMatchesResponsiveLayout({ layout: "wide" }, getResponsiveLayout(390)),
    false,
  );
  assert.equal(
    ruleMatchesResponsiveLayout(
      { layout: "compact" },
      getResponsiveLayout(390),
    ),
    true,
  );
});
test("Keep exceptions match stable identity and reject reused slots", () => {
  const features = { tag: "a", id: "ad-slot", hrefHost: "shop.example" };
  const rule = createElementException(
    { selector: "#ad-slot", features },
    { layout: "compact" },
  );
  assert.equal(
    matchesElementException(rule, {
      selector: "#ad-slot",
      features,
      layout: "compact",
    }),
    true,
  );
  assert.equal(
    matchesElementException(rule, {
      selector: "#ad-slot",
      features: { ...features, hrefHost: "other.example" },
      layout: "compact",
    }),
    false,
  );
  assert.equal(
    matchesElementException(rule, {
      selector: "#ad-slot",
      features,
      layout: "wide",
    }),
    false,
  );
});
