import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsMutationStore } from "../src/background/settings-mutations.js";

test("serializes concurrent custom-rule writes without losing either rule", async () => {
  const storage = createStorage({ userCustomRules: {} }, 4);
  const store = createSettingsMutationStore(storage);
  await Promise.all([
    store.upsertCustomRules("example.test", [{ selector: "#ad-one" }]),
    store.upsertCustomRules("example.test", [{ selector: ".ad-two" }]),
  ]);
  const { userCustomRules } = await storage.get("userCustomRules");
  assert.deepEqual(
    userCustomRules["example.test"].map((rule) => rule.selector),
    ["#ad-one", ".ad-two"],
  );
});

test("domain decisions are mutually exclusive and verified", async () => {
  const storage = createStorage({
    whitelist: ["ads.example"],
    blacklist: [],
  });
  const store = createSettingsMutationStore(storage);
  const result = await store.saveDomainDecision("BLACKLIST", "ads.example");
  const snapshot = await storage.get(["whitelist", "blacklist"]);
  assert.equal(result.status, "saved");
  assert.deepEqual(snapshot.whitelist, []);
  assert.deepEqual(snapshot.blacklist, ["||ads.example^"]);
});

test("surfaces a shared-storage quota failure to the caller", async () => {
  const storage = createStorage({}, 0, new Error("QUOTA_BYTES exceeded"));
  const store = createSettingsMutationStore(storage);
  await assert.rejects(
    store.upsertCustomRules("example.test", [{ selector: "#ad" }]),
    /Settings storage is full/,
  );
});

test("restore removes only the requested personal rule and verifies storage", async () => {
  const storage = createStorage({
    userCustomRules: {
      "example.test": [
        { selector: "#first", fingerprint: { tag: "div" } },
        { selector: ".second", fingerprint: { tag: "aside" } },
      ],
    },
  });
  const store = createSettingsMutationStore(storage);
  const result = await store.restoreCustomRules("example.test", [".second"]);
  const snapshot = await storage.get(["userCustomRules", "siteResetHistory"]);
  assert.equal(result.restoredCount, 1);
  assert.deepEqual(
    snapshot.userCustomRules["example.test"].map((rule) => rule.selector),
    ["#first"],
  );
  assert.equal(snapshot.siteResetHistory, undefined);
});

test("site reset remains distinct and records correction history", async () => {
  const rule = { selector: "#ad", fingerprint: { tag: "div", id: "ad" } };
  const storage = createStorage({
    userCustomRules: { "example.test": [rule] },
    siteResetHistory: {},
  });
  const store = createSettingsMutationStore(storage);
  await store.resetCustomRules("example.test");
  const snapshot = await storage.get(["userCustomRules", "siteResetHistory"]);
  assert.equal(snapshot.userCustomRules["example.test"], undefined);
  assert.deepEqual(snapshot.siteResetHistory["example.test"].oldRules, [rule]);
});

test("removes a domain through the serialized settings store", async () => {
  const storage = createStorage({ blacklist: ["||ads.example^"] });
  const store = createSettingsMutationStore(storage);
  await store.removeDomainDecision("blacklist", "ads.example");
  assert.deepEqual((await storage.get("blacklist")).blacklist, []);
});

test("persists, forgets, and resets not-ad element decisions independently", async () => {
  const storage = createStorage({
    userCustomRules: { "example.test": [{ selector: ".hidden-ad" }] },
    userElementExceptions: {},
  });
  const store = createSettingsMutationStore(storage);
  const rule = {
    id: "not-ad-1",
    selector: "#site-header",
    fingerprint: { tag: "header", id: "site-header" },
  };
  await store.upsertElementExceptions("example.test", [rule]);
  assert.equal(
    (await storage.get("userElementExceptions")).userElementExceptions[
      "example.test"
    ][0].id,
    "not-ad-1",
  );
  await store.removeElementExceptions("example.test", ["not-ad-1"]);
  assert.equal(
    (await storage.get("userElementExceptions")).userElementExceptions[
      "example.test"
    ],
    undefined,
  );

  await store.upsertElementExceptions("example.test", [rule]);
  const result = await store.resetElementDecisions("example.test");
  const snapshot = await storage.get([
    "userCustomRules",
    "userElementExceptions",
    "siteResetHistory",
  ]);
  assert.equal(result.restoredCount, 1);
  assert.equal(result.forgottenCount, 1);
  assert.equal(snapshot.userCustomRules["example.test"], undefined);
  assert.equal(snapshot.userElementExceptions["example.test"], undefined);
  assert.equal(snapshot.siteResetHistory["example.test"].oldRules.length, 1);
});

test("serializes concurrent not-ad decisions without losing either fingerprint", async () => {
  const storage = createStorage({ userElementExceptions: {} }, 4);
  const store = createSettingsMutationStore(storage);
  await Promise.all([
    store.upsertElementExceptions("example.test", [
      {
        id: "not-ad-one",
        selector: "#header-one",
        fingerprint: { tag: "header", id: "header-one" },
      },
    ]),
    store.upsertElementExceptions("example.test", [
      {
        id: "not-ad-two",
        selector: "#header-two",
        fingerprint: { tag: "header", id: "header-two" },
      },
    ]),
  ]);
  const { userElementExceptions } = await storage.get("userElementExceptions");
  assert.deepEqual(
    userElementExceptions["example.test"].map((rule) => rule.id),
    ["not-ad-one", "not-ad-two"],
  );
});

function createStorage(initial = {}, delayMs = 0, setError = null) {
  const data = structuredClone(initial);
  return {
    async get(keys) {
      if (delayMs) await delay(delayMs);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        list
          .filter((key) => key in data)
          .map((key) => [key, structuredClone(data[key])]),
      );
    },
    async set(values) {
      if (delayMs) await delay(delayMs);
      if (setError) throw setError;
      Object.assign(data, structuredClone(values));
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
