import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_SECTIONS,
  resolveSettingsSection,
  matchesSettingsSearch,
} from "../src/options/section-catalog.js";
import { createSettingsNavigation } from "../src/options/section-navigation.js";
import {
  createSettingsListFilters,
  matchesDownloadFilter,
} from "../src/options/list-filters.js";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../packages/media-helper/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");

test("Settings sections are uniquely registered and Package remains before Downloads", () => {
  assert.equal(new Set(SETTINGS_SECTIONS.map((section) => section.id)).size, 6);
  assert(
    SETTINGS_SECTIONS.findIndex((section) => section.id === "packages") <
      SETTINGS_SECTIONS.findIndex((section) => section.id === "downloads"),
  );
  assert(Object.isFrozen(SETTINGS_SECTIONS));
});

test("actual Settings markup keeps unique controls in the right page", async () => {
  const html = await readFile(
    new URL("../options/options.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const section of SETTINGS_SECTIONS)
    assert(document.getElementById(`settings-panel-${section.id}`));
  for (const id of [
    "allowed-count",
    "blocked-sites-count",
    "page-decisions-count",
    "whitelist-count",
    "blacklist-count",
    "rule-sites-count",
    "workflow-count",
  ])
    assert(document.getElementById(id), id);
  for (const [id, section] of [
    ["settings-mode", "protection"],
    ["settings-enabled", "protection"],
    ["btn-package-import", "packages"],
    ["package-name", "packages"],
    ["btn-download-refresh", "downloads"],
    ["element-decisions", "sites"],
    ["learned-paths-container", "sites"],
    ["blocked-logs-container", "activity"],
    ["dom-samples-container", "advanced"],
    ["nav-diagnostics-preview", "advanced"],
    ["btn-reset", "advanced"],
    ["feedback-form", "advanced"],
  ]) {
    assert.equal(
      document.getElementById(id)?.closest(".settings-panel")?.id,
      `settings-panel-${section}`,
      id,
    );
  }
  dom.window.close();
});

test("router shows only one page and preserves legacy links, history, keyboard/select navigation and lifecycle cleanup", async () => {
  const html = await readFile(
    new URL("../options/options.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html, {
    url: "https://fixture.test/options.html?site=example.com#element-decisions",
  });
  dom.window.scrollTo = () => {};
  const calls = [];
  const nav = createSettingsNavigation({
    document: dom.window.document,
    window: dom.window,
    onActivate: (id) => calls.push(id),
  });
  const document = dom.window.document;
  assert.equal(nav.current(), "sites");
  assert.equal(
    document.querySelectorAll(".settings-panel:not([hidden])").length,
    1,
  );
  assert.equal(
    document.querySelector('[aria-current="page"]').getAttribute("href"),
    "#sites",
  );
  const waitChange = () =>
    new Promise((resolve) =>
      dom.window.addEventListener("hashchange", resolve, { once: true }),
    );
  let changed = waitChange();
  dom.window.location.hash = "downloads";
  await changed;
  assert.equal(nav.current(), "downloads");
  const select = document.getElementById("settings-section-select");
  select.value = "advanced";
  changed = waitChange();
  select.dispatchEvent(new dom.window.Event("change"));
  await changed;
  assert.equal(nav.current(), "advanced");
  assert.equal(
    document.querySelectorAll(".settings-panel:not([hidden])").length,
    1,
  );
  nav.stop();
  changed = waitChange();
  dom.window.location.hash = "protection";
  await changed;
  assert.equal(nav.current(), "advanced");
  assert.deepEqual(calls, ["sites", "downloads", "advanced"]);
  dom.window.close();
});
test("explicit and legacy links override remembered pages; invalid routes fall back safely", () => {
  assert.equal(resolveSettingsSection("#downloads", "sites").id, "downloads");
  assert.equal(
    resolveSettingsSection("#element-decisions", "downloads").id,
    "sites",
  );
  assert.equal(resolveSettingsSection("", "advanced").id, "advanced");
  assert.equal(resolveSettingsSection("#unknown", "advanced").id, "protection");
  assert.equal(resolveSettingsSection("", "removed").id, "protection");
});
test("Settings search is case-insensitive and empty queries retain every item", () => {
  assert.equal(
    matchesSettingsSearch(["video.example", "Hidden"], " VIDEO "),
    true,
  );
  assert.equal(matchesSettingsSearch(["video.example"], "other"), false);
  assert.equal(matchesSettingsSearch([], ""), true);
});

test("filters retain original rows, expanded decisions and delete targets; status filtering includes transitional active jobs", async () => {
  const html = await readFile(
    new URL("../options/options.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const list = document.getElementById("whitelist-list");
  list.innerHTML =
    '<div class="item" data-search-text="one.example"><button data-index="0">Remove</button></div><div class="item" data-search-text="two.example"><button data-index="1">Remove</button></div>';
  const second = list.children[1];
  const filters = createSettingsListFilters(document);
  const input = document.getElementById("sites-search");
  input.value = "two";
  input.dispatchEvent(new dom.window.Event("input"));
  assert.equal(list.children[0].hidden, true);
  assert.equal(second.hidden, false);
  assert.equal(second.querySelector("button").dataset.index, "1");
  input.value = "";
  input.dispatchEvent(new dom.window.Event("input"));
  assert.equal(list.children[1], second);
  assert.equal(list.children[0].hidden, false);
  assert(matchesDownloadFilter("pausing", "active"));
  assert(matchesDownloadFilter("cancelling", "active"));
  assert(matchesDownloadFilter("cancelled", "paused"));
  assert.equal(matchesDownloadFilter("completed", "active"), false);
  filters.stop();
  dom.window.close();
});
