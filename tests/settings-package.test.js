import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_PACKAGE_SCHEMA,
  createSettingsPackage,
  normalizeSettingsPackage,
  replaceSettingsWithPackage,
  summarizeSettingsPackage,
} from "../src/settings-package/schema.js";
import { initializeBundledSettingsPackage } from "../src/background/settings-package-seed.js";
import {
  getResponsiveLayout,
  ruleMatchesResponsiveLayout,
} from "../src/dom/layout-context.js";

const examplePackage = {
  schema_version: SETTINGS_PACKAGE_SCHEMA,
  metadata: {
    id: "community.example",
    name: "Example Pack",
    author: "Tester",
    version: "1.2.0",
  },
  settings: {
    app: {
      enabled: true,
      protectionMode: "assist",
      featureOverrides: {},
    },
    whitelist: ["Docs.Example"],
    blacklist: ["||ads.example^"],
    custom_rules: {
      "Video.Example": [
        {
          selector: "div.promo-banner",
          fingerprint: { tag: "div", classTokens: ["promo-banner"] },
          confidence: 0.93,
          layout: "wide",
        },
      ],
    },
    trusted_paths: [
      {
        source: "video.example",
        target: "player.example",
        visits: 99,
        isManual: true,
      },
    ],
  },
};

test("normalizes a shareable settings package", () => {
  const result = normalizeSettingsPackage(examplePackage);
  assert.equal(result.settings.app.protectionMode, "assist");
  assert.deepEqual(result.settings.whitelist, ["docs.example"]);
  assert.deepEqual(result.settings.blacklist, ["||ads.example^"]);
  assert.equal(result.settings.custom_rules["video.example"].length, 1);
  assert.equal(result.settings.custom_rules["video.example"][0].layout, "wide");
  assert.equal(result.settings.trusted_paths[0].isManual, true);
});

test("rejects unsupported packages and dangerous broad selectors", () => {
  assert.throws(
    () => normalizeSettingsPackage({ schema_version: "unknown" }),
    /Unsupported package schema/,
  );
  const result = normalizeSettingsPackage({
    ...examplePackage,
    settings: {
      ...examplePackage.settings,
      custom_rules: { "example.test": ["body", "div.ad-slot"] },
    },
  });
  assert.deepEqual(result.settings.custom_rules["example.test"], [
    "div.ad-slot",
  ]);
});

test("exports only shareable settings and trusted paths", () => {
  const result = createSettingsPackage(
    {
      appSettings: examplePackage.settings.app,
      whitelist: ["docs.example"],
      blacklist: ["||ads.example^"],
      userCustomRules: examplePackage.settings.custom_rules,
      "p:video.example>player.example":
        examplePackage.settings.trusted_paths[0],
      domTrainingSamples: [{ private: true }],
      blockedLogs: [{ private: true }],
    },
    { name: "My Pack" },
  );
  assert.equal(result.metadata.name, "My Pack");
  assert.equal(result.settings.trusted_paths.length, 1);
  assert.equal("domTrainingSamples" in result.settings, false);
  assert.equal("blockedLogs" in result.settings, false);
});

test("replaces managed settings without deleting diagnostics", async () => {
  const storage = createStorage({
    whitelist: ["old.example"],
    "p:old.example>target.example": { source: "old.example" },
    blockedLogs: [{ keep: true }],
  });
  await replaceSettingsWithPackage(examplePackage, storage, "test");
  const snapshot = await storage.get(null);
  assert.deepEqual(snapshot.whitelist, ["docs.example"]);
  assert.equal(snapshot["p:old.example>target.example"], undefined);
  assert.equal(snapshot["p:video.example>player.example"].isManual, true);
  assert.deepEqual(snapshot.blockedLogs, [{ keep: true }]);
  assert.equal(summarizeSettingsPackage(examplePackage).ruleCount, 1);
});

test("failed package write does not delete existing trusted paths", async () => {
  const storage = createStorage({
    "p:old.example>target.example": {
      source: "old.example",
      target: "target.example",
    },
  });
  const failingStorage = {
    get: storage.get,
    remove: storage.remove,
    async set() {
      throw new Error("storage unavailable");
    },
  };
  await assert.rejects(
    replaceSettingsWithPackage(examplePackage, failingStorage, "test"),
    /storage unavailable/,
  );
  assert.equal(
    (await storage.get(null))["p:old.example>target.example"].source,
    "old.example",
  );
});

test("bundled package preserves existing user settings", async () => {
  const storage = createStorage({ whitelist: ["mine.example"] });
  const result = await initializeBundledSettingsPackage(
    storage,
    async () => examplePackage,
  );
  assert.equal(result.status, "preserved_existing_settings");
  assert.deepEqual((await storage.get(null)).whitelist, ["mine.example"]);
});

test("bundled package initializes a fresh installation once", async () => {
  const storage = createStorage();
  const first = await initializeBundledSettingsPackage(
    storage,
    async () => examplePackage,
  );
  const second = await initializeBundledSettingsPackage(storage, async () => {
    throw new Error("must not reload the bundled package");
  });
  const snapshot = await storage.get(null);
  assert.equal(first.status, "installed_bundled_package");
  assert.equal(second.status, "already_initialized");
  assert.deepEqual(snapshot.whitelist, ["docs.example"]);
  assert.equal(snapshot.settingsPackageState.source, "bundled");
});

test("responsive DOM rules do not leak from desktop into mobile layouts", () => {
  assert.equal(getResponsiveLayout(390), "compact");
  assert.equal(getResponsiveLayout(1280), "wide");
  assert.equal(ruleMatchesResponsiveLayout({ layout: "wide" }, "compact"), false);
  assert.equal(ruleMatchesResponsiveLayout({ layout: "compact" }, "compact"), true);
  assert.equal(ruleMatchesResponsiveLayout({ layout: "any" }, "compact"), true);
  assert.equal(ruleMatchesResponsiveLayout(".legacy-rule", "compact"), true);
});

function createStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    async get(keys) {
      if (keys === null) return structuredClone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        list
          .filter((key) => key in data)
          .map((key) => [key, structuredClone(data[key])]),
      );
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}
