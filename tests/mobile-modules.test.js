import test from "node:test";
import assert from "node:assert/strict";
import { mobileComposition, createMobileModules } from "../src/mobile/module-catalog.js";

test("mobile profile physically excludes media without requiring a Helper", () => {
  assert.deepEqual(mobileComposition("protection").modules.map(m => m.id), ["protection"]);
  assert.deepEqual(mobileComposition().modules.map(m => m.id), ["protection", "media"]);
  assert.throws(() => mobileComposition("invented"));
  for (const backend of Object.values(mobileComposition().backends)) assert.equal(backend.youtubeResolve, false);
  assert.equal(mobileComposition().backends["ios-safari"].directDownload, false);
  assert.equal(mobileComposition("protection").backends["android-app"].directDownload, false);
  assert.deepEqual(mobileComposition("protection").directFormats, []);
  const copy = mobileComposition(); copy.backends["android-app"].directDownload = false;
  copy.directFormats[0].mime.length = 0;
  assert.equal(mobileComposition().backends["android-app"].directDownload, true);
  assert.ok(mobileComposition().directFormats[0].mime.length);
});
test("module registration is mandatory, lazy and optional failures cannot break protection", () => {
  const calls = [], errors = [];
  const runtime = createMobileModules({ factories: {
    protection() { calls.push("protection"); return { dispose() { calls.push("disposed"); } }; },
    media() { throw Error("Unavailable backend"); },
  }, onError: id => errors.push(id) });
  assert.deepEqual(calls, []);
  assert.equal(runtime.open("protection"), runtime.open("protection"));
  assert.equal(runtime.open("media"), null);
  assert.throws(() => runtime.open("not-registered"));
  assert.deepEqual(errors, ["media"]);
  runtime.dispose(); assert.deepEqual(calls, ["protection", "disposed"]);
  const small = createMobileModules({ profile: "protection", factories: {} });
  assert.throws(() => small.open("media"));
});
