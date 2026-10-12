import test from "node:test";
import assert from "node:assert/strict";
import { importPackage, undoImport } from "../src/ios/shared.js";
import { createSettingsPackage } from "../src/settings-package/schema.js";
test("package retains separate compact and wide rules for the same selector", () => {
  const pack = createSettingsPackage({
    userCustomRules: {
      "site.example": [
        { selector: "#ad-slot", layout: "compact" },
        { selector: "#ad-slot", layout: "wide" },
        { selector: "#ad-slot", layout: "compact" },
      ],
    },
  });
  assert.equal(pack.settings.custom_rules["site.example"].length, 2);
});
function storage(initial) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      return structuredClone(
        keys === null
          ? data
          : Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys])
                .filter((k) => k in data)
                .map((k) => [k, data[k]]),
            ),
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
test("iOS imports full desktop schema and undo restores legacy choices without erasing counters", async () => {
  const s = storage({
    whitelist: ["old.example"],
    afsBlockedPopupHosts: { "old-ad.example": {} },
    blockedCount: 7,
    "p:old>target": {},
  });
  const pack = createSettingsPackage({
    whitelist: ["new.example"],
    userCustomRules: {
      "site.example": [{ selector: "#ad", layout: "compact" }],
    },
    userElementExceptions: {
      "site.example": [
        {
          selector: "#logo",
          fingerprint: { tag: "img", id: "logo" },
          layout: "compact",
        },
      ],
    },
    "p:source.example>target.example": {
      source: "source.example",
      target: "target.example",
      isManual: true,
    },
  });
  const summary = await importPackage(pack, s);
  assert.equal(summary.exceptionCount, 1);
  assert.equal(
    s.data.userElementExceptions["site.example"][0].fingerprint.id,
    "logo",
  );
  assert.ok(s.data["p:source.example>target.example"]);
  assert.equal(s.data["p:old>target"], undefined);
  assert.deepEqual(s.data.afsBlockedPopupHosts, {});
  s.data.blockedCount = 9;
  await undoImport(s);
  assert.deepEqual(s.data.whitelist, ["old.example"]);
  assert.ok(s.data.afsBlockedPopupHosts["old-ad.example"]);
  assert.equal(s.data.blockedCount, 9);
  await assert.rejects(undoImport(s), /No import/);
});
test("invalid schema leaves all user data untouched", async () => {
  const s = storage({ whitelist: ["safe.example"] });
  await assert.rejects(
    importPackage({ schema_version: "unknown" }, s),
    /Unsupported/,
  );
  assert.deepEqual(s.data, { whitelist: ["safe.example"] });
});
test("failed import rolls back managed settings", async () => {
  const s = storage({ blacklist: ["||old.example^"], blockedCount: 3 });
  const write = s.set;
  let failed = false;
  s.set = async (values) => {
    if (values.settingsPackageState && !failed) {
      failed = true;
      throw new Error("quota");
    }
    return write(values);
  };
  await assert.rejects(importPackage(createSettingsPackage({}), s), /quota/);
  assert.deepEqual(s.data.blacklist, ["||old.example^"]);
  assert.equal(s.data.blockedCount, 3);
  assert.equal(s.data.afsPackageBackup, undefined);
});
test("a failed second import keeps the previous successful import's Undo snapshot", async () => {
  const s = storage({ whitelist: ["original.example"] });
  await importPackage(createSettingsPackage({ whitelist: ["first.example"] }), s);
  const write = s.set;
  let failed = false;
  s.set = async values => {
    if (values.settingsPackageState && !failed) { failed = true; throw new Error("quota"); }
    return write(values);
  };
  await assert.rejects(importPackage(createSettingsPackage({ whitelist: ["second.example"] }), s), /quota/);
  assert.deepEqual(s.data.whitelist, ["first.example"]);
  await undoImport(s);
  assert.deepEqual(s.data.whitelist, ["original.example"]);
});
